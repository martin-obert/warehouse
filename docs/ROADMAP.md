# Roadmap

Living backlog for Warehouse. This file is read by every agent/dev session **before** starting
work and updated **after** finishing (see `CLAUDE.md`).

Rules:
- Checked-off items are never deleted or un-checked — they're the project's history.
- New phases are appended at the bottom, in order.
- A phase can be partially shipped; leave individual items unchecked until they're actually done.

## Phase 0 — Indexing & Metadata Pipeline (shipped)

- [x] Nitro background indexer plugin (`server/plugins/file-indexer.ts`) walks `NUXT_CONTENT_ROOT`
      on boot and continuously re-crawls.
- [x] 8 pluggable, failure-isolated metadata extractors (`server/lib/file-metadata/extractors/*`):
      filesystem, content-type, content-scan, exiftool, image, media (ffprobe), audio, pdf.
- [x] SQLite schema with a single JSONB `meta` blob per file + generated virtual columns, plus an
      FTS5 full-text index kept in sync via triggers.
- [x] Thumbnail generation (64px WebP) persisted at index time.
- [x] On-demand preview generation (800px WebP), uncached.
- [x] Flat paginated file list API (`GET /api/files`) + thumbnail/preview routes.

## Phase 1 — Process Scaffolding & Frontend Foundation (this plan)

- [x] `docs/ROADMAP.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md` created.
- [x] `CLAUDE.md` updated with the agent workflow loop (read roadmap/decisions before, update after).
- [x] `README.md` replaced with a real project description for human contributors.
- [x] `app/pages/index.vue` decomposed into `app/components/files/*` + `app/composables/*` +
      `app/utils/file-format.ts` (behavior-preserving — no new features).

## Phase 2 — Folder/Directory Navigation (shipped)

Goal: browsing feels like a standard file browser — open the app at the content root, see
subfolders and files, navigate in and out via breadcrumbs — instead of one flat list of every
indexed file. This is the primary stated use case (per the product owner: "navigate like a
standard browser ... for search and organize"). UX/layout spec: `docs/DESIGN.md`.

- [x] `directory` generated column + index on `files` (schema v3); `listFiles()` takes an
      optional `directory` filter (exact match, non-recursive).
- [x] `listChildFolders()` + `GET /api/folders?path` for sidebar tree lazy-loading.
- [x] `GET /api/files` scoped by `?path=` (default: content root), replacing the old flat-all-files
      default.
- [x] Collapsible sidebar folder tree (`FilesSidebar` + recursive `FilesFolderTreeNode`).
- [x] Breadcrumb bar (`FilesBreadcrumbs`, wraps `UBreadcrumb`).
- [x] Current folder reflected in the URL (`?path=`, see D016) — linkable/bookmarkable, survives
      refresh.
- [x] Table's "Path" column renamed to "Name", shows filename only (folder-scoped browsing makes
      the full relative path redundant — breadcrumbs already show it).
- [x] Table also lists subfolders (page 1 only, ahead of files, click-to-navigate) alongside
      files — supersedes the original sidebar-only navigation call; see D017.

## Phase 3 — Search UI (shipped)

`searchFiles()` in `server/utils/file-metadata-store.ts` does bm25-ranked FTS5 search with
snippet highlighting.

- [x] `GET /api/search?q` route exposing `searchFiles()`.
- [x] Persistent header search input (`FilesSearchInput`), live-debounced (~250ms).
- [x] Results view (`FilesSearchResults`) replaces the breadcrumb+table area while searching;
      sidebar stays visible, clearing the search returns to whatever folder was active. Global
      scope, not folder-scoped — see D018.
- [x] Snippet markers switched from literal `<mark>`/`</mark>` HTML to control-character
      delimiters, parsed and rendered client-side without `v-html` — see D019.

## Phase 3.5 — RAM optimization & two-phase indexing (shipped)

Goal: reduce peak RAM consumption so the indexer runs reliably on a Raspberry Pi 2 (1GB RAM)
without swap thrashing or OOM kills, and make the UI responsive during indexing.

- [x] `sharp.cache(false)` + `sharp.concurrency(1)` at startup — D023.
- [x] Sequential deep-mode image stats/perceptual hash (was parallel `Promise.all`) — D023.
- [x] Thumbnail generation bundled into `extractImage()` (`withThumbnail: true`) — eliminates
      redundant decode; `server/utils/thumbnail.ts` is now dead code — D023.
- [x] `extractFileMetadata()` returns `FileMetadataResult { metadata, thumbnail }` — D023.
- [x] Indexer concurrency configurable via `NUXT_INDEXER_CONCURRENCY` (default 1) — D023.
- [x] Dockerfile: `--max-old-space-size=384 --expose-gc` — D023.
- [x] Heap pressure backpressure: GC + 50ms pause when `heapUsed > 256MB` — D023.
- [x] `maxPdfBytes` default 256→64MB; ffprobe `maxBuffer` 64→8MB — D023.
- [x] Two-phase shallow/deep indexing — UI shows files after fast shallow pass; heavy deep pass
      follows with per-file error resilience — D024.
- [x] `indexerState.phase` exposed in status API and UI header — D024.
- [ ] Worker-thread isolation for heavy extractors — deferred, see D025.
- [ ] Stream-based PDF loading — blocked by pdf.js API, see D026.

## Phase 4 — Rich metadata & secondary features (future, additive)

- Surface the deep metadata already extracted (EXIF/GPS/camera/lens, audio tags, PDF text, etc.)
  in the preview — today only `kind`, `mime`, `size`, `modifiedAt`, `title` are shown.
- Albums/collections.
- Thumbnails/previews for non-image media types (audio, PDF, video) — only images are handled
  today (`generateThumbnail()` / `/api/files/:id/preview` both early-return for non-image mime
  types).

## Known Gaps (not scheduled)

- SQLite DB (`.data/app.sqlite3`) and generated thumbnails live in the container's writable layer;
  `docker-compose.yml` only volume-mounts the content root, so both are lost on every redeploy.
  *(Owner is handling this separately — not part of this roadmap.)*
- A stray, tracked 0-byte `identifier.sqlite` file sits at the repo root, unrelated to the real
  (gitignored) app database.
- `searchFiles()`/FTS5 exist and work but have no API route (see Phase 3).
- No lint, test, or typecheck script in `package.json`.
- A Vue "Hydration completed but contains mismatches" warning fires on every load of `/`.
  Confirmed pre-existing (2026-10-21): reproduces with the literal pre-Phase-1 `index.vue`
  restored, so it predates the Phase 1 refactor. Ruled out so far: a client-side refetch racing
  the background indexer (no second `/api/files` request happens after load — checked via the
  Network tab), `formatDate()` locale mismatch (server HTML and the live DOM render identical
  date strings), and `UTable`'s `sticky` prop (warning persists with it removed). Needs a proper
  Vue devtools session to find the actual mismatched node — the console only logs the one-line
  summary, not a per-node diff.
