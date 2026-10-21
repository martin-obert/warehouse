# Decisions

Append-only log of technical and UI decisions. The point is to stop future sessions from
accidentally re-litigating or silently reversing something that was already decided on purpose.

Rules:
- **Never edit or delete a past entry.** If a decision changes, add a new entry and mark the old
  one `Superseded by D0xx`.
- Add a new entry here for any non-trivial technical/UI decision you make (see `CLAUDE.md`).

---

## D001 — No authentication

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** Warehouse runs inside a trusted internal network, considered secure under a
  zero-trust network model at the infra layer.
- **Decision:** The app itself has no login, session, or authorization layer.
- **Consequences:** Don't add auth UI/middleware without first revisiting this decision with the
  product owner — it's a deliberate choice, not an oversight.

## D002 — Nuxt UI v4 is the sole component library

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** `@nuxt/ui` (v4, built on Tailwind v4) is already used for every existing UI piece
  (`UTable`, `UModal`, `UPagination`, `UCard`, `UButton`, `UIcon`).
- **Decision:** Build new UI with Nuxt UI primitives first. Don't introduce a second component
  kit or hand-roll a primitive Nuxt UI already provides (e.g. use `UBreadcrumb` for Phase 2
  folder navigation, not a custom breadcrumb).
- **Consequences:** Styling uses Nuxt UI's CSS custom-property tokens via Tailwind arbitrary-value
  syntax (`bg-(--ui-bg)`, `text-(--ui-text-muted)`, etc.) — keep using that pattern.

## D003 — SQLite (db0) + FTS5 for storage and search

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** All indexed metadata and the full-text search index live in one SQLite file
  (`.data/app.sqlite3`, via Nitro's `db0`).
- **Decision:** No separate search engine (Elasticsearch, Meilisearch, etc.). `searchFiles()` in
  `server/utils/file-metadata-store.ts` is the one search backend any future UI calls into.
- **Consequences:** Scaling search means tuning SQLite/FTS5, not swapping engines.

## D004 — Single JSONB `meta` blob + generated virtual columns

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** The `files` table (`server/plugins/file-indexer.ts`) stores the entire
  `FileMetadata` object as a JSONB blob in one `meta` column. Every filterable/sortable column
  (`kind`, `mime`, `size`, `modified_at`, `sha256`, `phash`, `lat`, `lon`, `title`, `author`,
  `description`, `keywords`, `location`, `extra`, `body`, ...) is `GENERATED ALWAYS AS (meta ->>
  '$...') VIRTUAL`.
- **Decision:** Writes always touch exactly one column (`meta`). New filterable fields get a new
  generated column pointing into the existing blob — never a second, independently-written column
  that could drift out of sync.
- **Consequences:** Adding a new filter/sort field means a schema migration (see D009) that adds a
  generated column, not an application-level write path change.

## D005 — Pluggable, independently-reporting extractors

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** `server/lib/file-metadata/extractors/*` has 8 extractors (filesystem, content-type,
  content-scan, exiftool, image, media/ffprobe, audio, pdf), each with its own timeout and a
  per-extractor status (`ok`/`skipped`/`failed`/`timeout`) so one failing tool never sinks the
  whole extraction.
- **Decision:** New file-type support is added as a new extractor module following this pattern,
  not folded into an existing one.
- **Consequences:** Keep extractors independent and failure-isolated; don't make one extractor
  depend on another's success.

## D006 — Deep extraction always on; re-extraction gated by staleness

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** `file-indexer.ts` always calls `extractFileMetadata(..., { deep: true })`.
  `saveFileMetadata()` only overwrites an existing row if the incoming data is deep, the stored
  data isn't deep yet, or the file's mtime/size/inode changed.
- **Decision:** Don't add a "shallow mode" toggle to the indexer without reconsidering this
  staleness logic — a shallower write is designed to never clobber a deeper one for an unchanged
  file.

## D007 — Thumbnails persisted, previews generated on demand

- **Date:** 2026-10-21
- **Status:** Superseded by D022
- **Context:** `server/utils/thumbnail.ts` generates a 64px/quality-50 WebP once at index time,
  stored in `file_thumbnails`. `server/api/files/[id]/preview.get.ts` regenerates an 800px/
  quality-75 WebP from the source file on every request, relying only on an HTTP `Cache-Control`
  header — nothing is persisted server-side for previews.
- **Decision:** Keep this split. Don't "fix the inconsistency" by persisting previews or
  regenerating thumbnails on demand without first deciding it's worth the tradeoff (storage vs.
  repeated `sharp` decode cost).

## D008 — Flat, folder-agnostic indexing/API surface is interim

- **Date:** 2026-10-21
- **Status:** Accepted (superseded by Phase 2 work when it lands)
- **Context:** `GET /api/files` returns one flat, paginated list of *all* indexed files, in
  `modified_at DESC` order, with no path/folder filter and no folder-browsing endpoint.
- **Decision:** This is explicitly a placeholder, not the intended final UX — see
  `docs/ROADMAP.md` Phase 2. Don't build frontend code that assumes "always one flat list" as a
  long-term invariant.

## D009 — Schema migrations via one hand-written SQL block

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** `file-indexer.ts` gates schema creation on `PRAGMA user_version` against a single
  `SCHEMA_VERSION` constant; the whole schema (tables, indexes, FTS5 table, triggers) lives in one
  SQL block run once.
- **Decision:** No migration library (drizzle-kit, umzug, etc.) for now. Schema changes mean
  bumping `SCHEMA_VERSION` and extending that SQL block.
- **Consequences:** This only works because the block is idempotent/one-shot (`if (user_version >=
  SCHEMA_VERSION) return`) — any future incremental-migration need should revisit this decision.

## D010 — In-repo markdown is the backlog/decision log, not GitHub Issues

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** Chosen over GitHub Issues/Projects for a solo-maintainer, agent-driven workflow.
- **Decision:** `docs/ROADMAP.md` and `docs/DECISIONS.md` are the backlog and decision record.
  They're read before and updated after every work session (enforced via `CLAUDE.md`).

## D011 — Frontend convention: feature component folders, composables own state

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** Set while decomposing `app/pages/index.vue` (Phase 1) into a real component
  structure for the first time.
- **Decision:**
  - Components live under `app/components/<feature>/` (e.g. `app/components/files/`). Nuxt's
    directory-based auto-prefix already supplies the feature name as a component-name prefix, so
    files inside the folder omit repeating it — `app/components/files/Table.vue` registers as
    `<FilesTable>`, not `<FilesFilesTable>`.
  - Composables under `app/composables/` own data fetching and stateful logic (refs, `useFetch`)
    and return plain refs/computed values.
  - Components take props and emit events; they hold no independent `useFetch` call or
    standalone state — they're presentational, composed together by pages.
- **Consequences:** Follow this pattern for all future UI work (Phase 2+), not just Phase 1.

## D012 — Sidebar tree + breadcrumbs together as the navigation model

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** Decided while designing the Phase 2 browsing shell (see `docs/DESIGN.md`), via
  direct discussion with the product owner. Options considered: sidebar-only, breadcrumb-only, or
  both together.
- **Decision:** Both together — a persistent, collapsible sidebar folder tree for jumping between
  distant folders, plus a breadcrumb bar for showing/navigating the current path. Not one or the
  other.
- **Consequences:** Phase 2 implementation needs both a tree component and a breadcrumb component
  (Nuxt UI ships `UBreadcrumb`, per D002), kept in sync with each other and with the URL.

## D013 — The file table lists files only; folders never appear as table rows

- **Date:** 2026-10-21
- **Status:** Superseded by D017
- **Context:** Decided alongside D012. Alternative considered: the classic Explorer pattern of
  showing subfolders at the top of the table (click to descend) followed by files.
- **Decision:** Folder traversal happens exclusively via the sidebar/breadcrumbs. The table always
  shows just the files within the currently selected folder — no mixed row types, no folder rows.
- **Consequences:** The table/`FilesTable` component and its backing API never need to represent a
  "folder" row type — simpler column model, simpler click handling (every row is always a file,
  opens the preview modal).

## D014 — Utilitarian/dense visual direction for the browsing shell

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** Decided while designing the Phase 2 browsing shell (see `docs/DESIGN.md`). Options
  considered: utilitarian file-manager (Finder/Explorer/VS Code), modern SaaS dashboard
  (Linear/Notion-like), or media-first gallery (Google Photos/Immich-like).
- **Decision:** Utilitarian file-manager — dense, neutral, functional. Flat surfaces, minimal
  elevation/shadow, compact spacing, no new color palette beyond the existing Nuxt UI dark theme
  tokens.
- **Consequences:** Don't introduce card-heavy layouts, large whitespace, or decorative visual
  elements in browsing-shell UI without revisiting this decision first.

## D015 — Folder tree nodes own their own lazy-loaded state (exception to D011)

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** Implementing the Phase 2 sidebar (`app/components/files/FolderTreeNode.vue`,
  `Sidebar.vue`). D011 says composables own fetching/state and components stay presentational —
  but a folder tree is recursive and each node's children are only known/loaded on first expand;
  there's no single flat list a shared composable could sensibly own ahead of time.
- **Decision:** `FolderTreeNode` is a self-referencing recursive component that owns its own
  `expanded`/`children` state locally and lazy-fetches `/api/folders?path=...` via `$fetch` on
  first expand. `Sidebar` similarly fetches the root level itself via `useFetch` on mount.
- **Consequences:** This is a deliberate, scoped exception to D011 for recursive/lazy tree
  structures specifically — don't use it as precedent for giving other (non-recursive) components
  their own fetch/state; the Phase 1 convention still applies everywhere else.

## D016 — Current folder lives in a `?path=` query param, not a catch-all route

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** `docs/DESIGN.md`'s implementation note for Phase 2 required the current folder to
  be reflected in the URL (linkable/bookmarkable, survives refresh), without mandating a specific
  routing mechanism. Alternative considered: a catch-all route (`app/pages/[...path].vue`) giving
  prettier URLs (`/Photos/2026/Oct` vs `/?path=Photos%2F2026%2FOct`).
- **Decision:** A `?path=` query param on the existing `/` route, read/written through
  `app/composables/useCurrentFolder.ts`. Matches the existing precedent of query-param-driven
  state in this app (pagination's `page` param) and avoids catch-all splat-param array handling.
- **Consequences:** URLs are less pretty than a path-based route. If that becomes a real complaint,
  revisit this decision rather than mixing both schemes.

## D017 — The file table shows folders too (supersedes D013)

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** User request, directly reversing D013. The sidebar-only navigation model felt less
  familiar/expected than the classic Explorer pattern of folders-and-files mixed in one listing.
- **Decision:** The table shows subfolders of the current folder (alphabetical, folder icon,
  `—` in MIME/Size/Modified/Title, click navigates into it) ahead of the paginated files — but
  only on page 1, so folders don't repeat on every page. Sidebar and breadcrumbs are unchanged and
  remain the way to jump between distant folders without descending one level at a time.
- **Consequences:** `FilesTable`'s rows are a `ListRow` discriminated union
  (`app/composables/useFileList.ts`), not plain `FileRow[]` — every column is now a custom `cell`
  function branching on `rowType` instead of a plain `accessorKey`. Folder click handling lives
  inside `FilesTable` itself (calls `useCurrentFolder().navigate()` directly); the component's
  public `select` event still only ever fires for file rows, unchanged.

## D018 — Search is global, not scoped to the current folder

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** Decided while building Phase 3 (search UI). Alternative considered: scope results
  to the current folder (+ subfolders), like Explorer's default "search here" — would have needed
  a new `directory` prefix filter added to `searchFiles()`.
- **Decision:** The search box (`app/composables/useSearch.ts`) always searches the whole indexed
  library via `searchFiles()` exactly as it already works, regardless of which folder is currently
  browsed. No backend filter changes.
- **Consequences:** Search results can point anywhere in the tree — each result's full path is
  shown so it's unambiguous. If folder-scoped search is wanted later, it's an additive filter on
  `searchFiles()`, not a redesign.

## D019 — Search snippets render without `v-html`, via control-character delimiters

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** `searchFiles()`'s SQL used SQLite FTS5's `snippet()` with literal `'<mark>'`/
  `'</mark>'` as highlight markers, returning the **unescaped** underlying indexed text (filenames,
  EXIF/PDF/audio metadata pulled from files on disk). Rendering that via `v-html` would be a real
  (if narrow — requires write access to a file that gets indexed) XSS vector: any HTML/script
  characters already present in a file's embedded metadata would execute unescaped.
- **Decision:** `snippet()` now uses `'\x01'`/`'\x02'` control characters as markers instead of
  HTML tags. `app/components/files/SearchResults.vue` splits the snippet string on those
  characters and renders each segment as plain Vue text interpolation (auto-escaped), wrapping
  matched segments in a real `<mark>` element — no `v-html` anywhere in the search UI.
- **Consequences:** Any future UI that consumes `FileSearchHit.snippet` must follow the same
  parse-don't-inject pattern — never pipe it through `v-html` directly.

## D020 — Vendor `@img/sharp-wasm32` into `.output` via a Nuxt module

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** Production container crashed on boot on a Raspberry Pi 2 (32-bit ARM, Alpine/musl)
  with `Could not load the "sharp" module using the linuxmusl-arm runtime` / `ENOENT` on
  `@img/sharp-wasm32/lib/sharp-wasm32-0.35.5.node.wasm`. Sharp 0.35.5 has no native binary for
  `linuxmusl-arm` at all (only `linux-arm` glibc and `linuxmusl-arm64` exist) — `@img/sharp-wasm32`
  is the only runtime that can ever work on this board/OS combination, and `cdc8959` already made
  it a non-optional dependency so `npm ci` always installs it. The actual gap: that package's
  loader resolves its `.wasm` binary through a runtime-computed `fs.readFileSync` call, which
  Nitro's static dependency tracer can't follow, so `.output` shipped the small JS glue but not
  the 9MB binary. This is the same class of problem `modules/exiftool-vendored.ts` already works
  around for `exiftool-vendored.pl`/`.exe`'s dynamic import — confirmed the build-stage platform
  pinning (`BUILDPLATFORM`) is not a contributing cause, since `@img/sharp-wasm32` has no
  `os`/`cpu` restrictions and installs identically on any build host.
- **Decision:** Added `modules/sharp-wasm32-vendored.ts`, a Nuxt module mirroring
  `exiftool-vendored.ts`'s pattern exactly — on Nitro's `compiled` hook, resolve
  `@img/sharp-wasm32` via `createRequire` and `cp` the whole package into
  `.output/server/node_modules/@img/sharp-wasm32`, so the binary ships regardless of what the
  tracer could statically see.
- **Consequences:** If a future sharp version bump changes `@img/sharp-wasm32`'s internal
  structure or its own dependencies' load mechanism (e.g. `@emnapi/runtime`), this module may
  need updating or extending — same caveat already implicitly accepted for the exiftool module.

## D021 — Indexer pause/resume via in-memory Promise gate

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** The background indexer crawl can take minutes for large content roots. Users need
  to pause it (e.g. to reduce CPU load during interactive use) and resume without restarting the
  server.
- **Decision:** A Promise-based gate in `server/utils/file-indexer-state.ts`. The indexer
  `await`s `indexerState.gate` before each file. When unpaused, the gate is `Promise.resolve()`
  (zero overhead). When paused, a new unresolved Promise is created; `setPaused(false)` resolves
  it. State is in-memory only — not persisted, resets to "running" on server restart. Controlled
  via `POST /api/indexer/pause` with `{ paused: boolean }` body; status exposed via
  `GET /api/indexer/status`. Frontend polls status every 3 seconds via `useIndexerStatus()`.
- **Consequences:** Pause state does not survive server restarts (deliberate — the crawl re-runs
  from scratch on boot anyway). If persistent pause-on-boot is needed, it would require a
  `NUXT_INDEXER_PAUSED` env var or a DB flag — not implemented now.

## D022 — Preview streams the full original file from disk (supersedes D007)

- **Date:** 2026-10-21
- **Status:** Accepted
- **Context:** D007 left previews generated on demand via `sharp` (800px resize + WebP encode) on
  every request. On a Raspberry Pi 2B this took multiple seconds per image — the entire decode +
  resize + encode pipeline ran before any bytes reached the client.
- **Decision:** The preview route now streams the original file directly from disk via
  `fs.createReadStream` with zero CPU processing. Supports HTTP Range requests (206 partial
  content), ETag-based conditional requests (304), and `Cache-Control`. Thumbnails remain
  persisted in `file_thumbnails` (unchanged from D007).
- **Consequences:** Preview images are full-size originals, not resized. The client receives the
  file's real MIME type (e.g. `image/jpeg`) instead of `image/webp`. Bandwidth increases vs. the
  old 800px WebP, but delivery is instant on any hardware.
