// server/utils/file-metadata-store.ts


import {EmbeddedMetadata, FileKind, FileMetadata} from "#server/lib/file-metadata";

type EmbeddedDocs = Pick<EmbeddedMetadata, 'embeddedDocuments' | 'embeddedDocumentsTruncated'>

// db0 shares one connection; awaits between BEGIN and COMMIT would let another request
// interleave its own BEGIN. Serialize writes through a tiny promise-chain lock.
let writeChain: Promise<unknown> = Promise.resolve()
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = writeChain.then(fn, fn)
    writeChain = run.catch(() => {})
    return run
}

function splitEmbeddedDocs(meta: FileMetadata): { core: FileMetadata; docs: EmbeddedDocs | null } {
    if (!meta.embedded?.embeddedDocuments) return { core: meta, docs: null }
    const { embeddedDocuments, embeddedDocumentsTruncated, ...embedded } = meta.embedded
    return { core: { ...meta, embedded }, docs: { embeddedDocuments, embeddedDocumentsTruncated } }
}

/**
 * Insert or update a file's metadata.
 * A shallow extraction never overwrites a deep one unless the file changed (mtime, size or inode).
 * Returns the row id, or null when the write was skipped for that reason.
 */
export function saveFileMetadata(meta: FileMetadata): Promise<number | null> {
    return withWriteLock(async () => {
        const db = useDatabase()
        const { core, docs } = splitEmbeddedDocs(meta)

        await db.exec('BEGIN IMMEDIATE')
        try {
            const row = (await db.prepare(`
        INSERT INTO files (path, meta) VALUES (?, jsonb(?))
        ON CONFLICT(path) DO UPDATE SET
          meta       = excluded.meta,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE excluded.meta ->> '$.extraction.deep'
           OR NOT files.deep
           OR excluded.meta ->> '$.filesystem.times.modified.epochNs' IS NOT files.fs_mtime_ns
           OR excluded.meta ->> '$.filesystem.size'                   IS NOT files.size
           OR excluded.meta ->> '$.filesystem.inode'                  IS NOT files.fs_inode
        RETURNING id
      `).get(meta.path.display, JSON.stringify(core))) as { id: number } | undefined

            if (row) {
                if (docs) {
                    await db.prepare(`
            INSERT INTO file_embedded_docs (file_id, docs) VALUES (?, jsonb(?))
            ON CONFLICT(file_id) DO UPDATE SET docs = excluded.docs
          `).run(row.id, JSON.stringify(docs))
                } else {
                    // Row was rewritten without embedded docs: any stored ones are stale.
                    await db.prepare('DELETE FROM file_embedded_docs WHERE file_id = ?').run(row.id)
                }
            }

            await db.exec('COMMIT')
            return row?.id ?? null
        } catch (err) {
            await db.exec('ROLLBACK')
            throw err
        }
    })
}

export async function getFileMetadata(path: string, { withEmbeddedDocs = false } = {}): Promise<FileMetadata | null> {
    const row = (await useDatabase().prepare(`
    SELECT json(f.meta) AS meta, ${withEmbeddedDocs ? 'json(d.docs)' : 'NULL'} AS docs
    FROM files f LEFT JOIN file_embedded_docs d ON d.file_id = f.id
    WHERE f.path = ?
  `).get(path)) as { meta: string; docs: string | null } | undefined
    if (!row) return null

    const meta = JSON.parse(row.meta) as FileMetadata
    if (row.docs && meta.embedded) Object.assign(meta.embedded, JSON.parse(row.docs))
    return meta
}

/** Cheap check before re-extracting: pass `fs.stat(path, { bigint: true })`. */
export async function isStoredMetadataFresh(
    path: string,
    stat: { mtimeNs: bigint; size: bigint; ino: bigint },
    { requireDeep = false } = {},
): Promise<boolean> {
    const row = (await useDatabase().prepare(
        'SELECT fs_mtime_ns, size, fs_inode, deep FROM files WHERE path = ?',
    ).get(path)) as { fs_mtime_ns: string; size: number; fs_inode: string; deep: number } | undefined

    return !!row
        && row.fs_mtime_ns === stat.mtimeNs.toString()
        && BigInt(row.size) === stat.size
        && row.fs_inode === stat.ino.toString()
        && (!requireDeep || row.deep === 1)
}

export async function deleteFileMetadata(path: string): Promise<void> {
    await withWriteLock(() => useDatabase().prepare('DELETE FROM files WHERE path = ?').run(path))
}

export interface FileSearchQuery {
    q?: string
    kind?: FileKind
    limit?: number
    offset?: number
}

export interface FileSearchHit {
    id: number
    path: string
    kind: FileKind
    mime: string
    size: number
    modifiedAt: string
    title: string | null
    snippet: string | null
}

/** Quote every term (raw input breaks MATCH syntax) and prefix-match it. */
function toMatchExpression(q: string): string {
    return q.trim().split(/\s+/).map(t => `"${t.replace(/"/g, '""')}"*`).join(' ')
}

export async function searchFiles({ q, kind, limit = 50, offset = 0 }: FileSearchQuery): Promise<FileSearchHit[]> {
    const hasText = !!q?.trim()
    const where: string[] = []
    const params: unknown[] = []

    if (hasText) { where.push('files_fts MATCH ?'); params.push(toMatchExpression(q!)) }
    if (kind) { where.push('f.kind = ?'); params.push(kind) }
    params.push(Math.min(limit, 200), offset)

    // bm25 weights follow the FTS column order: path, title, author, description, keywords, location, extra, body
    const sql = `
    SELECT f.id, f.path, f.kind, f.mime, f.size, f.modified_at AS modifiedAt, f.title,
           ${hasText ? `snippet(files_fts, -1, '<mark>', '</mark>', '…', 10)` : 'NULL'} AS snippet
    FROM ${hasText ? 'files_fts JOIN files f ON f.id = files_fts.rowid' : 'files f'}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${hasText ? 'bm25(files_fts, 4, 10, 4, 3, 6, 3, 1, 1)' : 'f.modified_at DESC'}
    LIMIT ? OFFSET ?`

    return (await useDatabase().prepare(sql).all(...params)) as FileSearchHit[]
}

export interface FileListRow {
    id: number
    path: string
    kind: FileKind
    mime: string
    size: number
    modifiedAt: string
    title: string | null
}

export interface FileListResult {
    rows: FileListRow[]
    total: number
}

export async function listFiles({ page = 1, pageSize = 20, directory }: { page?: number; pageSize?: number; directory?: string } = {}): Promise<FileListResult> {
    const db = useDatabase()
    const limit = Math.max(1, Math.min(pageSize, 200))
    const offset = (Math.max(1, page) - 1) * limit

    const [rows, countRow] = await Promise.all([
        db.prepare(
            `SELECT id, path, kind, mime, size, modified_at AS modifiedAt, title FROM files
             WHERE directory = ? ORDER BY modified_at DESC LIMIT ? OFFSET ?`,
        ).all(directory ?? '', limit, offset) as Promise<FileListRow[]>,
        db.prepare('SELECT COUNT(*) AS total FROM files WHERE directory = ?').get(directory ?? '') as Promise<{ total: number }>,
    ])

    return { rows, total: countRow.total }
}

/** Immediate child folder names under `parent` ('' for the content root), alphabetically sorted. */
export async function listChildFolders(parent: string): Promise<string[]> {
    const rows = (await useDatabase().prepare(
        parent
            ? `SELECT DISTINCT directory FROM files WHERE directory = ? OR directory LIKE ? || '/%'`
            : `SELECT DISTINCT directory FROM files WHERE directory != ''`,
    ).all(...(parent ? [parent, parent] : []))) as { directory: string }[]

    const children = new Set<string>()
    for (const { directory } of rows) {
        if (directory === parent) continue
        const rest = parent ? directory.slice(parent.length + 1) : directory
        const slash = rest.indexOf('/')
        children.add(slash === -1 ? rest : rest.slice(0, slash))
    }
    return [...children].sort()
}

export function saveThumbnail(fileId: number, thumb: { data: Buffer; width: number; height: number }): Promise<void> {
    return withWriteLock(async () => {
        await useDatabase().prepare(`
            INSERT INTO file_thumbnails (file_id, data, width, height) VALUES (?, ?, ?, ?)
            ON CONFLICT(file_id) DO UPDATE SET data = excluded.data, width = excluded.width, height = excluded.height
        `).run(fileId, thumb.data, thumb.width, thumb.height)
    })
}

export async function getThumbnail(fileId: number): Promise<Buffer | null> {
    const row = (await useDatabase().prepare(
        'SELECT data FROM file_thumbnails WHERE file_id = ?',
    ).get(fileId)) as { data: Buffer } | undefined
    return row?.data ?? null
}

/** Exact duplicates by content hash (deep-mode records only). */
export async function findDuplicates(sha256: string): Promise<string[]> {
    const rows = (await useDatabase().prepare(
        'SELECT path FROM files WHERE sha256 = ? ORDER BY path',
    ).all(sha256)) as { path: string }[]
    return rows.map(r => r.path)
}