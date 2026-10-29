# Product shell × Engineering — integration contract

The product shell (`src/product/`) is a UI layer over **typed demo fixtures**.
It never touches the editor document model. This note lists what Engineering
needs to provide so each demo surface can become real, and what must NOT
change without coordination.

## Ownership (branch `feature/ui`)

| Area | Files | Rule |
|---|---|---|
| Product shell | `src/product/*` (new) | UI-owned, isolated |
| Boot | `src/main.tsx` | UI changed 3 lines (boots `ProductApp`, imports `product.css`) |
| Editor | `src/App.tsx`, `src/store.tsx`, `src/types.ts`, `src/components/*` (editor), `src/styles.css` | **Untouched by the product expansion** (only pre-existing UI-polish diffs) |

`ProductApp` renders the existing editor component verbatim on `#/files/:fileId`.
A floating “back to dashboard” link is overlaid by the wrapper so no shared
toolbar file was edited.

## What is demo-only today

- All users, workspaces, members, projects, folders, files, shares, invites,
  and activity come from `src/product/fixtures.ts`.
- Mutations (create/rename/move/share/favorite/trash/invite/profile) update
  React state in `src/product/store.tsx`, persisted to
  `localStorage["undesign.product.v1"]` — **this browser only**.
- Copy-link builds a hash URL; nothing is hosted publicly.
- The editor always opens its own local document; the `:fileId` in
  `#/files/:fileId` is currently display-only (shown in the back-link label).
- Notifications bell is a visual placeholder with an accessible name.
- Reset: Settings → About & data → “Reset demo data”.

## What Engineering will need to supply

1. **Identity & workspaces** — current user, workspace list, membership +
   roles, invite accept flow. Replaces: `me`, `members`, `workspaces`,
   `inviteMember`, `removeMember`.
2. **File metadata service** — list/get/create/rename/move/trash/restore for
   files, projects, folders (ids, names, parents, timestamps, owners).
   Replaces the `files`/`projects` slices. Keep the field names in
   `fixtures.ts` where possible; the UI already sorts/filters on them.
3. **Sharing & permissions** — audience (`private|workspace|anyone`),
   per-user roles, enforcement, real share links. Replaces: `setAudience`,
   `setFileRole`, link copy.
4. **Editor binding** — load/save the editor document by file id so
   `#/files/:fileId` opens the right document. Needs a store API such as
   `openFile(id)` / `currentFileId`. Until then the back-link label is the
   only file-id consumer.
5. **Activity feed** — real events to replace the fixture list on the
   dashboard.
6. **Search** — server search can replace the local filter in `SearchPage`;
   keep the `#/search?q=` route.
7. **Accounts backend** — password/sessions/billing (Settings → Account is
   intentionally read-only), plus a real dark-mode story before enabling the
   disabled Dark option (the editor is light-only today).

## Suggested seam

Keep `useProduct()` as the UI-facing API. When backends land, re-implement
`ProductProvider` internals against real endpoints (or React Query-style
hooks) without changing page components: pages only call the documented
`ProductApi` methods and read `ProductState`.

## Routing note

Hash routing (`#/…`) was chosen because it needs no server rewrites and works
under `vite preview` and any static host. If Engineering later serves the app
behind path-based routing with SPA fallback, `src/product/router.ts` is the
only file that must change (`parseHash`/`routeHref` → path equivalents);
all navigation goes through `link()`/`navigate()`.

## Do-not-break list

- Do not change the `ProductApi` method names without updating pages.
- Do not remove `data-density` handling (Settings → density is a real,
  persisted preference).
- The `.p-*` CSS namespace and `product.css` are UI-owned; editor styles live
  in `styles.css`. Shared primitives reused by product pages: `.btn`
  (+`.danger` in product.css), `.text-input`, `.seg`, `.modal`/`.dialog-*`,
  `.icon-btn`, `.mini-btn`, `.skip-link`, `[data-tip]`, `.ctx-*`.
