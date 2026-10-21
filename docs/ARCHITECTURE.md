# Architecture

Structural snapshot of the system — **what exists and where**, not why (see `docs/DECISIONS.md`)
or what's next (see `docs/ROADMAP.md`). Update this file whenever directory layout, the DB
schema, or the API surface changes.

## 1. System overview

Warehouse is a single Nuxt 4 process. Nitro (Nuxt's server engine) hosts both the HTTP API and a
background indexer plugin in the same process — there is no separate backend service.

- Content root: a directory on disk, configured via `NUXT_CONTENT_ROOT` (env) /
  `runtimeConfig.contentRoot` (`nuxt.config.ts`).
- Persistence: one SQLite file, `.data/app.sqlite3`, accessed through Nitro's `db0` connector
  (`nitro.database.default` in `nuxt.config.ts`).
- `src/index.ts` is an unused stub placeholder; all real server logic lives under `server/`.

## 2. Backend: indexing pipeline

`server/plugins/file-indexer.ts` runs on boot:
1. `createDatabase()` — ensures the schema exists (see §3), gated by `PRAGMA user_version`.
2. An infinite loop: `walkDir(contentRoot)` recursively yields every file, then for each one:
   - `extractFileMetadata({ absolutePath, displayPath }, { deep: true })` — runs the full
     extractor pipeline (see below).
   - `saveFileMetadata(meta)` — upserts into `files` (skipped as a no-op if the file didn't
     change — see §3 generated staleness columns).
   - If an id was returned (row actually written) and the file is an image: `generateThumbnail()`
     → `saveThumbnail()`.
   - 250ms pause between full passes. No filesystem watcher — this is a continuous re-crawl.

`server/lib/file-metadata/index.ts` orchestrates extraction. `extractFileMetadata()` runs 8
extractors (`server/lib/file-metadata/extractors/*.ts`), bounded by a `maxConcurrent` semaphore
(default 4), each isolated with its own timeout/abort signal and a per-extractor status
(`ok`/`skipped`/`failed`/`timeout`) recorded in `extraction.extractors`:

| Extractor | File | What it adds |
|---|---|---|
| filesystem | `filesystem.ts` | size, times (ns precision), mode, owner, inode, symlink/sparse info |
| contentType | `content-type.ts` | real MIME from magic bytes (`file-type`) + extension, spoofed-extension check |
| contentScan | `content-scan.ts` | sha256 (and other hashes), byte entropy, line count/endings (deep mode only) |
| exiftool | `exiftool.ts` | EXIF/IPTC/XMP/ICC/MakerNotes, QuickTime, ID3, PDF/Office metadata, GPS |
| image | `image.ts` | decoded geometry, colour/alpha/animation, perceptual hash (deep mode) |
| media | `media.ts` | ffprobe streams/codecs, HDR/colour, chapters, rotation (audio/video) |
| audio | `audio.ts` | normalized tags (ID3/Vorbis/APE/MP4), cover art |
| pdf | `pdf.ts` | pages, paper size, permissions, forms, text layer excerpt |

`server/lib/file-metadata/summary.ts` (`buildSummary()`) reduces all of the above into one
normalized `summary` object (kind, mime, dates, camera/lens, GPS, title/author/description/
keywords, etc.) — this is what the generated SQL columns in §3 are derived from.

Thumbnail/preview image generation: `server/utils/thumbnail.ts` → `generateThumbnail()` uses
`sharp` to resize to 64px wide, WebP quality 50 — only for `image/*` mime types, persisted at
index time. Full-size previews are generated separately, on demand (see §4).

## 3. Data model

SQLite, schema version gated by `PRAGMA user_version` against a `SCHEMA_VERSION` constant in
`server/plugins/file-indexer.ts` (currently `3`). No migration library — schema changes are one
hand-written SQL block, applied once. Because the block uses plain `CREATE TABLE` (no `IF NOT
EXISTS`), bumping `SCHEMA_VERSION` against an existing lower-versioned database errors rather than
migrating it in place — see D009 in `docs/DECISIONS.md`. In practice this is harmless in
production (the DB isn't volume-mounted, so every deploy already starts from an empty file — see
`docs/ROADMAP.md` known gaps), but a local dev `.data/app.sqlite3` must be deleted by hand after a
schema bump so the indexer can rebuild it.

- **`files`** — one row per file. `meta` is the entire `FileMetadata` object (minus large embedded
  documents) as a JSONB blob; every other column is `GENERATED ALWAYS AS (meta ->> '$...')
  VIRTUAL`:
  `kind`, `mime`, `size`, `modified_at`, `created_at`, `sha256`, `phash`, `lat`, `lon`, `deep`,
  `directory` (file's parent folder, `''` for files at the content root — powers Phase 2 folder
  browsing), `fs_mtime_ns`, `fs_inode` (staleness detection), `title`, `author`, `description`,
  `keywords`, `location`, `extra` (camera/lens/software), `body` (PDF text excerpt).
  Indexes: `(kind, modified_at DESC)`, `(modified_at DESC)`, `(sha256)` where not null, `(lat,
  lon)` where not null, `(directory)`.
- **`file_embedded_docs`** — large deep-mode embedded documents (e.g. timed GPS/sensor tracks),
  split out of the hot `files` row; one row per file, loaded only for detail views.
- **`file_thumbnails`** — `file_id`, `data` (WebP blob), `width`, `height`.
- **`files_fts`** — FTS5 virtual table (contentless, `unicode61` tokenizer with diacritics
  removal, prefix index on 2-3 chars) over `path, title, author, description, keywords, location,
  extra, body`, kept in sync with `files` via `AFTER INSERT/DELETE/UPDATE` triggers.

Access layer: `server/utils/file-metadata-store.ts` — `saveFileMetadata`, `getFileMetadata`,
`isStoredMetadataFresh`, `deleteFileMetadata`, `listFiles` (now takes an optional `directory`
filter — exact match, non-recursive), `listChildFolders` (immediate child folder names under a
given parent, for the sidebar tree), `saveThumbnail`, `getThumbnail`, `findDuplicates`, and
`searchFiles` (bm25-ranked FTS5 query with `snippet()` highlighting — **implemented but not yet
exposed through any API route**). All writes are serialized through a promise-chain lock
(`withWriteLock`) since `db0` shares a single connection.

## 4. API surface (current)

- `GET /api/files?path&page&pageSize` → `{ rows, total, page, pageSize }`. Folder-scoped,
  non-recursive: `path` (default `''`, the content root) selects files whose `directory` exactly
  matches it. Each row: `id, path, kind, mime, size, modifiedAt, title`.
- `GET /api/folders?path` → `{ folders: string[] }`. Immediate child folder names under `path`
  (default `''`), alphabetically sorted — powers the sidebar tree's lazy expand/collapse.
- `GET /api/files/:id/thumbnail` → stored WebP blob from `file_thumbnails` (`image/webp`,
  `Cache-Control: public, max-age=86400`).
- `GET /api/files/:id/preview` → on-the-fly 800px/quality-75 WebP via `sharp`, regenerated from
  the source file on every request (images only; 415 for non-images, 404 if the file row doesn't
  exist).

Missing (tracked in `docs/ROADMAP.md`): a search route backed by `searchFiles()`.

## 5. Frontend structure

`app/` (Nuxt 4 app layer), Nuxt UI v4 (`@nuxt/ui`, Tailwind v4) as the sole component library —
see `docs/DECISIONS.md` D002, D011.

```
app/
├── app.vue                          <UApp><NuxtRouteAnnouncer/><NuxtPage/></UApp>
├── assets/css/main.css              @import "tailwindcss"; @import "@nuxt/ui";
├── pages/
│   └── index.vue                    composition-only: header, sidebar, breadcrumbs, table, modal
├── components/files/
│   ├── Table.vue                    <FilesTable> — UTable wrapper, owns `columns`, emits `select`
│   ├── Thumbnail.vue                <FilesThumbnail> — 40×40 image or fallback icon
│   ├── PreviewModal.vue             <FilesPreviewModal> — UModal wrapper, composes the two below
│   ├── PreviewImage.vue             <FilesPreviewImage> — large preview image or placeholder
│   ├── MetadataGrid.vue             <FilesMetadataGrid> — 2-column metadata display
│   ├── Pagination.vue               <FilesPagination> — UPagination wrapper + "Page X of Y"
│   ├── Sidebar.vue                  <FilesSidebar> — root-level folder list (fetches once)
│   ├── FolderTreeNode.vue           <FilesFolderTreeNode> — recursive node, lazy-loads own children
│   └── Breadcrumbs.vue              <FilesBreadcrumbs> — UBreadcrumb wrapper from useCurrentFolder
├── composables/
│   ├── useFileList.ts               owns page/pageSize + GET /api/files fetch, scoped by folder
│   ├── useFilePreview.ts            owns preview modal open/file state
│   └── useCurrentFolder.ts          current folder path (route `?path=`) + navigate()
└── utils/
    └── file-format.ts               humanSize(), formatDate() — pure formatting helpers
```

No `app/layouts/`, `app/middleware/`, `app/plugins/`, or `app/stores/` exist — `app.vue` is the
only layout wrapper. The current folder lives in the URL (`?path=`), read via `useCurrentFolder`;
`FolderTreeNode` and `Sidebar` are an intentional exception to D011 — each tree node owns its own
lazy-loaded expand/children state locally, since that doesn't fit a single shared composable (see
D015 in `docs/DECISIONS.md`).

## 6. Build & deploy

- `Dockerfile`: multi-stage, `node:22-alpine`, builds with `npm run build`, runtime image copies
  only `.output`. `PORT=3000`.
- `docker-compose.yml`: one `app` service, image from `ghcr.io/martin-obert/warehouse`, port
  `3000:3000`, volume-mounts the content root to `/data`, sets `NUXT_CONTENT_ROOT=/data`. The
  SQLite DB and thumbnails are **not** volume-mounted (see `docs/ROADMAP.md` known gaps).
- `.github/workflows/publish.yml`: builds/pushes a multi-arch Docker image to GHCR on manual
  dispatch or PR merge to `main`. No test/lint/typecheck gate — `package.json` has no such
  scripts.
- `modules/exiftool-vendored.ts`: Nuxt module that copies the vendored ExifTool binaries into
  `.output` so EXIF extraction works in the built image. `ffprobe` is expected on PATH as an
  external binary (not bundled).
