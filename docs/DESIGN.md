# Design — Browsing Shell

UX/visual direction for Warehouse's file-browsing experience. This is a structural spec (like
`docs/ARCHITECTURE.md`, but for UX) — it describes the agreed layout and interaction rules so
implementation sessions build against a settled design instead of re-deciding layout questions
mid-implementation. Rationale for *why* these choices were made lives in `docs/DECISIONS.md`
(D012–D014).

Current scope: **the browsing shell only** — layout, sidebar, breadcrumbs, header, file table.
Explicitly not covered here: the preview modal / rich metadata redesign (`docs/ROADMAP.md` Phase
4), and search or albums/collections UX (Phase 3/4) — no placeholders for those are added to the
header yet.

## Layout anatomy

```
+------------------------------------------------------------------+
| [=|>] Warehouse                                        20 files  |   <- header bar
+----------+---------------------------------------------------------+
| v Photos | Home / Photos / 2026 / Oct                              |   <- breadcrumb bar
|   v 2026 +---------------------------------------------------------+
|     > Sep|   [thumb] Path            Kind   MIME        Size   Mod |   <- table (files only)
|     > Oct|   ...                                                   |
|   > 2025 |                                                         |
| > Docs   |                                                         |
| > Audio  |                                        Page 1 of 3 [..] |   <- pagination footer
+----------+---------------------------------------------------------+
```

- **Header bar**: sidebar collapse/expand toggle, app title, file count (existing element,
  unchanged from today's `app/pages/index.vue`).
- **Sidebar**: folder tree rooted at the content root. Expand/collapse of a tree node is
  independent of selection — you can open a folder's children without navigating into it.
  The active/selected folder is highlighted. Collapsing the sidebar hides it entirely (not an
  icon rail) to maximize table width.
- **Breadcrumb bar**: path from root ("Home") to the current folder; every segment is clickable.
  Stays in sync with the sidebar's selected folder and with the URL.
- **Table**: unchanged in spirit from today's `FilesTable` — lists only files in the current
  folder (non-recursive). No folder rows mixed in (see D013).
- **Footer**: pagination, unchanged.

## Interaction rules

- Selecting a sidebar folder or a breadcrumb segment navigates to that folder: updates the URL,
  refetches the file list scoped to that folder, updates the breadcrumb trail, and highlights the
  folder in the sidebar.
- Root/"Home" = the content root; breadcrumbs always start there.
- An empty folder uses the table's existing empty state — no new design needed there.

## Visual / density guidelines

Utilitarian file-manager direction (D014) — dense, neutral, functional, not a card-heavy
modern-SaaS or media-first gallery aesthetic:

- Keep the current dark, neutral Nuxt UI theme and token usage (`bg-(--ui-bg)`,
  `text-(--ui-text-muted)`, `border-(--ui-border)`, etc.) — no new color palette introduced.
- Flat surfaces, minimal elevation/shadow — sidebar and table sit on the same background,
  separated by a 1px border, not cards-on-cards.
- Compact spacing throughout — sidebar rows as dense as table rows, not touch-sized.
- Continue using the existing lucide icon set via `UIcon`; no new icon style.

## Implementation note for Phase 2

Not a full technical spec — just enough so Phase 2 implementation isn't left guessing: the
current folder must be reflected in the URL (e.g. a catch-all route or a path query param) so
it's linkable/bookmarkable and survives a page refresh, not just held in in-memory state.
