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
- **Status:** Accepted
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
