import {opendir, stat} from 'node:fs/promises'
import {join, relative} from 'node:path'
import {extractFileMetadata} from "#server/lib/file-metadata";
import {isStoredMetadataFresh, saveFileMetadata, saveThumbnail} from "#server/utils/file-metadata-store.ts";

// Requires SQLite >= 3.45 (JSONB, concat_ws, contentless/external FTS5) — Node 22's node:sqlite qualifies.

const SCHEMA_VERSION = 3

// Heap usage threshold (bytes) above which the indexer pauses briefly to let GC reclaim.
const HEAP_PRESSURE_BYTES = 256 * 1024 * 1024

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
    async function run() {
        await createDatabase()

        const {contentRoot, forceReindex} = useRuntimeConfig()

        if (!contentRoot) {
            throw new Error('NUXT_CONTENT_ROOT is required')
        }

        if (forceReindex) console.log('NUXT_FORCE_REINDEX is set — skipping freshness checks, re-extracting all files.')
        console.log(`Crawling ${contentRoot} for media files...`)

        indexerState.status = 'running'
        indexerState.filesIndexed = 0
        indexerState.filesTotal = 0
        indexerState.currentFile = null
        indexerState.error = null

        try {

            for await (const filePath of walkDir(contentRoot)) {
                await indexerState.gate

                // Back off when heap usage is high so GC can reclaim before the next extraction.
                if (process.memoryUsage().heapUsed > HEAP_PRESSURE_BYTES) {
                    global.gc?.()
                    await new Promise((r) => setTimeout(r, 50))
                }

                indexerState.filesTotal++
                const displayPath = relative(contentRoot, filePath).replaceAll('\\', '/')
                indexerState.currentFile = displayPath

                if (!forceReindex) {
                    const st = await stat(filePath, {bigint: true})
                    if (await isStoredMetadataFresh(displayPath, st, {requireDeep: true})) continue
                }

                const { metadata: fileMetadata, thumbnail } = await extractFileMetadata(
                    {absolutePath: filePath, displayPath},
                    {deep: true, withThumbnail: true},
                )
                console.log('Saving file ' + fileMetadata.path.display)
                const fileId = await saveFileMetadata(fileMetadata)
                indexerState.filesIndexed++

                if (fileId && thumbnail) {
                    await saveThumbnail(fileId, thumbnail)
                }
            }
            console.log(`Indexing finished successfully.`)
            indexerState.status = 'finished'
            indexerState.currentFile = null
            indexerState.lastRun = new Date()

        } catch (err) {
            console.error('[file-indexer]', err)
            indexerState.status = 'error'
            indexerState.error = err instanceof Error ? err.message : String(err)
        }
        await new Promise((r) => setTimeout(r, 250))
    }

    run()

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

    -- Drop old-version objects so the schema can be recreated cleanly.
    -- Data is ephemeral (rebuilt from the content root on every boot).
    DROP TRIGGER IF EXISTS files_au;
    DROP TRIGGER IF EXISTS files_ad;
    DROP TRIGGER IF EXISTS files_ai;
    DROP TABLE IF EXISTS files_fts;
    DROP TABLE IF EXISTS file_thumbnails;
    DROP TABLE IF EXISTS file_embedded_docs;
    DROP TABLE IF EXISTS files;

    CREATE TABLE files (
      id          INTEGER PRIMARY KEY,
      path        TEXT NOT NULL UNIQUE,
      meta        BLOB NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

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
      directory   TEXT    GENERATED ALWAYS AS (meta ->> '$.path.directory') VIRTUAL,
      fs_mtime_ns TEXT    GENERATED ALWAYS AS (meta ->> '$.filesystem.times.modified.epochNs') VIRTUAL,
      fs_inode    TEXT    GENERATED ALWAYS AS (meta ->> '$.filesystem.inode') VIRTUAL,
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
    CREATE INDEX files_directory     ON files(directory);

    CREATE TABLE file_embedded_docs (
      file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      docs    BLOB NOT NULL
    );

    CREATE TABLE file_thumbnails (
      file_id  INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      data     BLOB NOT NULL,
      width    INTEGER NOT NULL,
      height   INTEGER NOT NULL
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
