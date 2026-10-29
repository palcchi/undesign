# Undesign — Visual Design Editor

A web-based visual design editor with a Figma-inspired workflow: pages, frames,
shapes, text, layers, contextual properties, and SVG/JSON export.

## Run it

Requires Node 18+.

```bash
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser.

Other commands:

- `npm run build` — type-check and build the production bundle to `dist/`
- `npm run preview` — serve the production build locally
- `npm run typecheck` — TypeScript check only
- `npm test` — bundle and run the regression suite with node

In GitHub Codespaces the port forwards automatically; use the forwarded
address for port 5173 if `localhost` is unreachable.

## What works

- **Canvas** — pan (space/middle-mouse/hand/scroll), zoom (Ctrl+scroll, buttons,
  presets, fit, reset), dot grid, marquee selection, inline text editing
- **Objects** — frames, rectangles, ellipses, text, lines; move, resize (8
  handles), rotate handle, line-endpoint editing, auto-parenting into frames
- **Layers** — hierarchy tree, expand/collapse, select, rename, visibility,
  lock, drag reorder + reparenting, context menus
- **Pages** — add, select, rename, delete
- **Assets** — insertable components and variant sets, color/text/effect
  styles that apply to the selection, per-style update-from-selection
- **Components** — create from selection, instances with overrides, variant
  switching, boolean/text properties, nested instances with cycle guards,
  compatible swap, exposed properties with per-property reset, detach
- **Styles** — shared color, typography, and drop-shadow styles with
  cross-page propagation and detach-on-manual-edit
- **Auto layout** — horizontal/vertical frames with gap, padding, alignment,
  Fixed/Hug/Fill sizing, absolute children, and min/max clamps
- **Properties** — contextual X/Y/W/H, rotation, radius, fill/stroke, full
  typography, drop shadow (offset/blur/spread/color/opacity), layout and
  sizing, component/variant controls, opacity, alignment/distribution
- **Document** — inline rename, undo/redo (60 steps), cut/copy/paste,
  duplicate, localStorage persistence with corrupt-data recovery, import/export
  JSON, fullscreen prototype preview, keyboard shortcuts (`?` lists them,
  suppressed while typing or while a dialog is open)

## Architecture

```
src/
  types.ts                  Document model (pages, objects, styles, variants)
  utils.ts                  Geometry, ids, SVG serialization, shadow filters
  transform.ts              Matrices, hit-testing, zoom math
  storage.ts                localStorage persistence + validation/migration
  history.ts                Undo/redo (past/present/future, transient sessions)
  layout.ts                 Constraints + auto-layout solver, text measurement
  library.ts                Components, variants, props, nested expansion
  system.ts                 Shared-style propagation passes
  assets.ts                 Image asset store, SVG/PNG export entry points
  exportPng.ts              PNG rasterization
  prototype.ts              Prototype link helpers
  ai.ts                     AI-op object builder (applies through the store)
  sample.ts                 Sample document built from real objects
  store.tsx                 Editor state, selection, viewport, update pipeline
  components/
    TopToolbar.tsx          Menus, tools, zoom, export/share/shortcut dialogs
    LeftSidebar.tsx         Layers / Assets / Pages panels, style managers
    CanvasView.tsx          SVG canvas, selection, drag/resize/rotate
    PropertiesPanel.tsx     Contextual property + layout + component controls
    ui.tsx                  Modal + context-menu primitives
  App.tsx                   Layout, global shortcuts, prototype preview
tests/
  run.mjs                   Bundles *.test.ts with esbuild, runs with node
```

State is a JSON-serializable document (`UndesignDoc`) with a past/present/future
history wrapper. Every edit flows through one pipeline — instance regen,
auto-layout, constraints, then style propagation — so canvas, layers, and
properties stay synchronized and share a single undo step per edit.

## Scope notes

This milestone intentionally excludes accounts, real-time collaboration,
billing, and deployment. Sharing works through portable JSON
(File → Import/Export) until cloud features are added.

## Relationship to FigCraft

FigCraft ([brydanforge/figcraft](https://github.com/brydanforge/figcraft),
inspected at `9268272`, dual-licensed MIT OR Apache-2.0) was evaluated as a
possible editor foundation and deliberately **not** integrated: it is a
self-contained native Rust/egui application whose browser story is the whole
app cross-compiled to WebAssembly — not an embeddable engine with a document
API the React UI could drive. Embedding it would have meant either a
superficial frame around a second editor or a bespoke Rust/WASM bridge with
two document models, while Undesign's own TypeScript engine already covers
the same capabilities (components, variants, auto layout, styles, undo/redo,
SVG/PNG export) with a tested migration path for existing documents.

FigCraft therefore serves as a behavioral reference only. No FigCraft source,
assets, branding, or dependencies are vendored in this repository, so no
upstream license texts or notices ship with it. If FigCraft code is ever
reused here, its MIT/Apache-2.0 texts, NOTICE, and per-file attribution must
be added alongside it.
