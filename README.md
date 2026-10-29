# Undesign — Visual Design Editor

A web-based visual design editor with a Figma-inspired workflow: pages, frames,
shapes, text, layers, contextual properties, and SVG/JSON export.

## Run it

Requires Node 18+. The WASM engine build additionally requires a Rust
toolchain (`cargo`, `wasm-pack`, and the `wasm32-unknown-unknown` target —
`npm run build:wasm` fails with setup instructions when any piece is missing).

```bash
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser.

Other commands:

- `npm run build` — build the WASM engine, type-check, and bundle to `dist/`
- `npm run build:wasm` — compile the Rust engine to `src/wasm/pkg/` only
- `npm run preview` — serve the production build locally
- `npm run typecheck` — TypeScript check only
- `npm test` — bundle and run the TypeScript regression suite with node
- `npm run test:rust` — run the Rust engine-bridge tests with cargo

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
  wasm/
    engine.ts               Lazy WASM loader + typed engine handle
    pkg/                    Generated wasm-pack output (git-ignored)
rust/
  Cargo.toml                undesign-wasm crate (pinned FigCraft git deps)
  src/lib.rs                JSON-boundary bridge + unit tests
third-party/figcraft/       Upstream license texts, NOTICE, reuse notes
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

## WASM engine (FigCraft integration)

Undesign embeds the FigCraft editor engine, compiled to WebAssembly, behind a
documented JSON boundary. The **main editor** runs on the engine: canvas,
selection, layers, properties, persistence, and export all operate on one
engine-owned document through the typed `EngineAdapter`
(`src/engine/adapter.ts`). The **Engine** button in the top toolbar opens the
Engine Lab, kept as a diagnostic view over a separate engine session.

- Upstream: [brydanforge/figcraft](https://github.com/brydanforge/figcraft),
  revision `92682728e9d6a3a97ea25a99395be7a34a8db993`
- License: MIT OR Apache-2.0 (texts and NOTICE in `third-party/figcraft/`);
  © 2026 ArtCraft Team and the FigCraft contributors
- Reuse: the `figcraft-engine`, `figcraft-doc`, `figcraft-svg`, and
  `figcraft-geom` crates, **unmodified**, via pinned Cargo git dependencies
  (`rust/Cargo.toml`, `rust/Cargo.lock`). No upstream files are vendored or
  patched; the bridge in `rust/src/`, the loader in `src/wasm/`, the adapter
  and converter in `src/engine/`, and the editor UI are original Undesign
  code.
- Boundary: the engine owns its document exclusively. The React app crosses
  into it only through `execute` / `undo` / `redo` / selection / tree
  describe / hit-test / SVG export / save+load (see `rust/src/lib.rs`). There
  is no second editable TypeScript document model.
- Migration: legacy JSON documents convert explicitly via
  `src/engine/convert.ts` (UND→FC) and read back via
  `src/engine/readback.ts` (FC→UND); unsupported properties (components,
  variants, styles, auto-layout, images, shadows) produce recorded warnings
  and safe placeholders, never silent data loss. Rotation is clockwise in
  UND/SVG and counter-clockwise in the engine; the boundary negates it.
- Brand and separately licensed material (ArtCraft trademarks, OFL fonts) are
  not reused.

If a future change patches or vendors upstream files, the modification must be
recorded in `third-party/figcraft/README.md` with the file list.
