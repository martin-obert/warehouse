import {opendir} from 'node:fs/promises'
import {join, relative} from 'node:path'
import {extractFileMetadata} from "#server/lib/file-metadata";
import {saveFileMetadata} from "#server/utils/file-metadata-store.ts";

// Requires SQLite >= 3.45 (JSONB, concat_ws, contentless/external FTS5) — Node 22's node:sqlite qualifies.

const SCHEMA_VERSION = 1

async function* walkDir(dir: string): AsyncGenerator<string> {
    const d = await opendir(dir)
    for await (const entry of d) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
            yield* walkDir(fullPath)
        } else {
            yield fullPath
        }
    }
}

export default defineNitroPlugin((nitroApp) => {

    let running = true

    async function run() {
        await createDatabase()

        const {contentRoot} = useRuntimeConfig()

        if (!contentRoot) {
            throw new Error('NUXT_CONTENT_ROOT is required')
        }


        console.log(`Crawling ${contentRoot} for media files...`)

        while (running) {
            try {

                for await (const filePath of walkDir(contentRoot)) {
                    const displayPath = relative(contentRoot, filePath).replaceAll('\\', '/')
                    const fileMetadata = await extractFileMetadata({absolutePath: filePath, displayPath}, {deep: true})
                    console.log('Saving file ' + fileMetadata.path.display)
                    await saveFileMetadata(fileMetadata)
                }

            } catch (err) {
                console.error('[file-indexer]', err)
            }
            await new Promise((r) => setTimeout(r, 250))
        }
    }

    run()

    nitroApp.hooks.hook('close', () => {
        running = false
    })
})


async function createDatabase() {
    console.log("Ensuring database schema is up to date...")

    const db = useDatabase()

    await db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `)

    const {user_version} = (await db.prepare('PRAGMA user_version').get()) as { user_version: number }
    if (user_version >= SCHEMA_VERSION) return

    await db.exec(`
    BEGIN;

    -- One row per file. "meta" is the whole FileMetadata (minus embedded documents) as JSONB.
    -- Every other column is derived from it, so writes touch exactly one value and nothing can drift.
    CREATE TABLE files (
      id          INTEGER PRIMARY KEY,
      path        TEXT NOT NULL UNIQUE,          -- path.display (never a server path)
      meta        BLOB NOT NULL,                 -- JSONB
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

      -- filters / sorting
      kind        TEXT    GENERATED ALWAYS AS (meta ->> '$.summary.kind') VIRTUAL,
      mime        TEXT    GENERATED ALWAYS AS (meta ->> '$.summary.mime') VIRTUAL,
      size        INTEGER GENERATED ALWAYS AS (meta ->> '$.filesystem.size') VIRTUAL,
      modified_at TEXT    GENERATED ALWAYS AS (meta ->> '$.summary.modifiedAt') VIRTUAL,
      created_at  TEXT    GENERATED ALWAYS AS (meta ->> '$.summary.createdAt') VIRTUAL,
      sha256      TEXT    GENERATED ALWAYS AS (meta ->> '$.summary.sha256') VIRTUAL,
      phash       TEXT    GENERATED ALWAYS AS (meta ->> '$.image.perceptualHash') VIRTUAL,
      lat         REAL    GENERATED ALWAYS AS (meta ->> '$.summary.gps.latitude') VIRTUAL,
      lon         REAL    GENERATED ALWAYS AS (meta ->> '$.summary.gps.longitude') VIRTUAL,
      deep        INTEGER GENERATED ALWAYS AS (meta ->> '$.extraction.deep') VIRTUAL,

      -- staleness detection
      fs_mtime_ns TEXT    GENERATED ALWAYS AS (meta ->> '$.filesystem.times.modified.epochNs') VIRTUAL,
      fs_inode    TEXT    GENERATED ALWAYS AS (meta ->> '$.filesystem.inode') VIRTUAL,

      -- full-text sources (keywords is the JSON array text; the tokenizer drops the punctuation)
      title       TEXT GENERATED ALWAYS AS (meta ->> '$.summary.title') VIRTUAL,
      author      TEXT GENERATED ALWAYS AS (meta ->> '$.summary.author') VIRTUAL,
      description TEXT GENERATED ALWAYS AS (meta ->> '$.summary.description') VIRTUAL,
      keywords    TEXT GENERATED ALWAYS AS (meta -> '$.summary.keywords') VIRTUAL,
      location    TEXT GENERATED ALWAYS AS (meta ->> '$.summary.location') VIRTUAL,
      extra       TEXT GENERATED ALWAYS AS (concat_ws(' ',
                    meta ->> '$.summary.camera', meta ->> '$.summary.lens', meta ->> '$.summary.software')) VIRTUAL,
      body        TEXT GENERATED ALWAYS AS (meta ->> '$.pdf.text.excerpt') VIRTUAL
    );

    CREATE INDEX files_kind_modified ON files(kind, modified_at DESC);
    CREATE INDEX files_modified      ON files(modified_at DESC);
    CREATE INDEX files_sha256        ON files(sha256) WHERE sha256 IS NOT NULL;
    CREATE INDEX files_geo           ON files(lat, lon) WHERE lat IS NOT NULL;

    -- Deep-mode embedded documents (timed GPS/sensor samples etc.) can be huge:
    -- kept out of the hot row and loaded only for the detail view.
    CREATE TABLE file_embedded_docs (
      file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      docs    BLOB NOT NULL             -- JSONB { embeddedDocuments, embeddedDocumentsTruncated }
    );

    CREATE VIRTUAL TABLE files_fts USING fts5(
      path, title, author, description, keywords, location, extra, body,
      content='files', content_rowid='id',
      tokenize='unicode61 remove_diacritics 2',
      prefix='2 3'
    );

    CREATE TRIGGER files_ai AFTER INSERT ON files BEGIN
      INSERT INTO files_fts(rowid, path, title, author, description, keywords, location, extra, body)
      VALUES (new.id, new.path, new.title, new.author, new.description, new.keywords, new.location, new.extra, new.body);
    END;

    CREATE TRIGGER files_ad AFTER DELETE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, path, title, author, description, keywords, location, extra, body)
      VALUES ('delete', old.id, old.path, old.title, old.author, old.description, old.keywords, old.location, old.extra, old.body);
    END;

    CREATE TRIGGER files_au AFTER UPDATE OF path, meta ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, path, title, author, description, keywords, location, extra, body)
      VALUES ('delete', old.id, old.path, old.title, old.author, old.description, old.keywords, old.location, old.extra, old.body);
      INSERT INTO files_fts(rowid, path, title, author, description, keywords, location, extra, body)
      VALUES (new.id, new.path, new.title, new.author, new.description, new.keywords, new.location, new.extra, new.body);
    END;

    PRAGMA user_version = ${SCHEMA_VERSION};
    COMMIT;
  `)
}
