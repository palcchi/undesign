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
- **Assets** — insertable components, color styles and text styles that apply
  to the selection
- **Properties** — contextual X/Y/W/H, rotation, radius, fill/stroke, full
  typography, opacity, alignment/distribution, selection SVG export
- **Document** — inline rename, undo/redo (60 steps), cut/copy/paste,
  duplicate, localStorage persistence with corrupt-data recovery, import/export
  JSON, fullscreen preview, keyboard shortcuts (`?` lists them)

## Architecture

```
src/
  types.ts                  Document model (pages, frames, design objects)
  utils.ts                  Geometry, ids, SVG serialization, downloads
  storage.ts                localStorage persistence + validation
  sample.ts                 Sample document built from real objects
  store.tsx                 Editor state, selection, viewport, undo/redo
  components/
    TopToolbar.tsx          Menus, tools, zoom, export/share dialogs
    LeftSidebar.tsx         Layers / Assets / Pages panels
    CanvasView.tsx          SVG canvas, selection, drag/resize/rotate
    PropertiesPanel.tsx     Contextual property controls
    ui.tsx                  Modal + context-menu primitives
  App.tsx                   Layout, shortcuts, preview overlay
```

State is a JSON-serializable document (`UndesignDoc`) with a past/present/future
history wrapper, so future AI-generation features can commit document patches
through the same undoable pipeline. Canvas, layers, and properties all read
from one store, so they stay synchronized.

## Scope notes

This milestone intentionally excludes AI generation, accounts, real-time
collaboration, billing, and deployment. Sharing works through portable JSON
(File → Import/Export) until cloud features are added.
