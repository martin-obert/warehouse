# Design — Browsing Shell

UX/visual direction for Warehouse's file-browsing experience. This is a structural spec (like
`docs/ARCHITECTURE.md`, but for UX) — it describes the agreed layout and interaction rules so
implementation sessions build against a settled design instead of re-deciding layout questions
mid-implementation. Rationale for *why* these choices were made lives in `docs/DECISIONS.md`
(D012, D014, D016, D017, D018, D019).

Covers the browsing shell and search (Phases 2–3). Explicitly not covered here: the preview
modal / rich metadata redesign, or albums/collections UX (`docs/ROADMAP.md` Phase 4).

## Layout anatomy

```
+------------------------------------------------------------------+
| [=|>] Warehouse   [ Search files...            ]       20 files  |   <- header bar
+----------+---------------------------------------------------------+
| v Photos | Home / Photos / 2026 / Oct                              |   <- breadcrumb bar
|   v 2026 +---------------------------------------------------------+
|     > Sep|   [folder] Sep             folder  --          --   --  |   <- table: folders first
|     > Oct|   [folder] Oct             folder  --          --   --  |      (page 1 only)
|   > 2025 |   [thumb]  img1.png        image   image/png   2KB  ... |   <- then paginated files
| > Docs   |   ...                                                   |
| > Audio  |                                        Page 1 of 3 [..] |   <- pagination footer
+----------+---------------------------------------------------------+

While searching, the breadcrumb+table area is replaced by a flat results list (sidebar stays):

+----------+---------------------------------------------------------+
| v Photos |   [thumb] nolzur/warrior/PXL_...COVER.jpg                |
|   v 2026 |            nolzur/warrior/PXL_...COVER.jpg (match)       |
|     > Sep|   [thumb] nolzur/warrior/PXL_...ORIGINAL.dng              |
|     > Oct|            nolzur/warrior/PXL_...ORIGINAL.dng (match)     |
|   > 2025 |   ...                                                     |
+----------+---------------------------------------------------------+
```

- **Header bar**: sidebar collapse/expand toggle, app title, a persistent search input, file count
  (existing element, unchanged from today's `app/pages/index.vue`).
- **Sidebar**: folder tree rooted at the content root. Expand/collapse of a tree node is
  independent of selection — you can open a folder's children without navigating into it.
  The active/selected folder is highlighted. Collapsing the sidebar hides it entirely (not an
  icon rail) to maximize table width. Stays visible and unchanged while searching.
- **Breadcrumb bar**: path from root ("Home") to the current folder; every segment is clickable.
  Stays in sync with the sidebar's selected folder and with the URL. Hidden while searching
  (replaced by the results list).
- **Table**: shows both subfolders and files of the current folder (non-recursive) — see D017.
  Subfolders render first (alphabetical, folder icon, `—` in MIME/Size/Modified/Title), only on
  page 1 so they don't repeat across pages; files follow in their existing order.
- **Search results list**: flat, global (not folder-scoped — D018), live-debounced as you type.
  Each row shows a thumbnail, full path, and a highlighted match snippet. No folders, no
  pagination at this scale.
- **Footer**: pagination, unchanged — based on file count only, unaffected by folder rows. Hidden
  while searching.

## Interaction rules

- Selecting a sidebar folder, a breadcrumb segment, or a **folder row in the table** navigates to
  that folder: updates the URL, refetches the listing scoped to that folder, updates the
  breadcrumb trail, and highlights the folder in the sidebar. All three are equivalent ways to
  navigate — use whichever is closest at hand.
- Clicking a **file row** in the table, or a **search result**, still opens the preview modal,
  unchanged.
- Typing in the search box switches the main content area to search results; clearing it reverts
  to whatever folder was being browsed before — browsing state isn't lost while searching.
- Root/"Home" = the content root; breadcrumbs always start there.
- An empty folder (no subfolders, no files) uses the table's existing empty state; a search with
  no matches gets its own "No results" state.

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
