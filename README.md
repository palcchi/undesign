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
- `npm run test:e2e` — run the adapter + converter against the real built
  WASM engine in node (no browser needed)

In GitHub Codespaces the port forwards automatically; use the forwarded
address for port 5173 if `localhost` is unreachable.

## What works

Everything below runs on the FigCraft engine (compiled to WASM) through the
typed `EngineAdapter`; the React app keeps no parallel editable document.

- **Canvas** — pan (space/middle-mouse/hand/scroll), zoom (Ctrl+scroll,
  buttons, presets, fit, reset), marquee selection, engine-rendered SVG with
  a selection/handle overlay
- **Objects** — frames, rectangles, ellipses, polygons, stars, lines, arrows,
  text, placed images; move, resize (8 handles), rotate handle,
  auto-parenting into frames
- **Structure** — group/ungroup, frame selection, masks, boolean
  union/subtract/intersect/exclude + flatten, rasterize, swap orientation
- **Layers** — hierarchy tree, expand/collapse, select, rename, visibility,
  lock, drag reorder + reparenting
- **Pages** — add, select, rename, duplicate, delete, move selection to page
- **Assets** — engine shared styles (create from selection, apply, delete)
  and components (create, insert instances, detach, reset)
- **Auto layout** — add/remove on frames; gap, padding, alignment, Fixed/Hug
  (frames/text) /Fill sizing, absolute children, min/max clamps migrate from
  legacy documents where the engine accepts them
- **Text** — content, font, size, alignment, bold/italic/underline/
  strikethrough toggles, size stepping, case
- **Properties** — contextual X/Y/W/H, rotation, radius, fill/stroke,
  opacity, clip, alignment/distribution
- **Document** — engine undo/redo, cut/copy/paste, duplicate, localStorage
  persistence, import/export (engine JSON, UND JSON, SVG, PNG), fullscreen
  page preview, keyboard shortcuts (`?` lists them, suppressed while typing
  or while a dialog is open)

## Architecture

```
src/
  App.tsx                   Product shell, layout, global shortcuts, preview
  main.tsx                  React entry point
  types.ts                  Legacy UND document model (import/export format)
  storage.ts                UND validation + legacy localStorage migration
  sample.ts                 Sample document seed
  utils.ts                  Zoom/viewport math, ids, downloads (+ legacy SVG)
  transform.ts              Overlay matrix math for canvas interactions
  exportPng.ts              PNG rasterization of exported SVG
  engine/
    adapter.ts              Typed boundary over engine commands (the only
                            JSON-boundary crosser for editor operations)
    store.tsx               React snapshot over the engine-owned document
    convert.ts              UND→FC migration (explicit warnings, no silent loss)
    readback.ts             FC→UND round-trip for export
    geometry.ts             Engine-space geometry for the canvas overlay
    tree.ts                 Layer-tree flattening + drag math
  components/
    TopToolbar.tsx          Menus, history, zoom, import/export/share dialogs
    ToolPalette.tsx         Floating bottom tool palette (FigCraft grouping)
    EngineSidebar.tsx       Layers / Pages / Assets panels
    EngineCanvas.tsx        Engine SVG + selection overlay + pointer tools
    EngineInspector.tsx     Single/multi-selection property controls
    EngineLab.tsx           Diagnostic view over a separate engine session
    ui.tsx                  Modal + context-menu primitives
  wasm/
    engine.ts               Lazy WASM loader + typed engine handle
    pkg/                    Committed wasm-pack output (rebuilt by build:wasm)
rust/
  Cargo.toml                undesign-wasm crate (pinned FigCraft git deps)
  src/lib.rs                JSON-boundary bridge + real-engine unit tests
third-party/figcraft/       Upstream license texts, NOTICE, reuse notes
docs/
  FIGCRAFT_REUSE_MAP.md     Source-level upstream→Undesign reuse mapping
tests/
  run.mjs                   Bundles *.test.ts with esbuild, runs with node
scripts/
  e2e-engine.mjs            Real-WASM E2E runner (node, needs built glue)
  e2e-driver.ts             Migration-triangle + command checks vs real engine
```

The engine owns the document, selection, and history exclusively. Every edit
flows through `EngineAdapter` into `Session::execute`, then the store
re-reads the snapshot (pages, tree, selection, SVG, undo depths) and
persists it — canvas, layers, and inspector stay synchronized with one undo
step per edit. The legacy TypeScript modules (`history.ts`, `layout.ts`,
`library.ts`, `system.ts`, `assets.ts`, `ai.ts`, `docpatch.ts`) are not used
by the live editor; they remain only as committed, tested reference
implementations of the UND format.

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
  code. The adapter wraps the engine's real command registry — pages,
  shapes, text, transforms, alignment, booleans, frames, masks, rasterize,
  auto-layout, shared styles, components/instances, prototype flows, text
  styling, and image placement — with every command name verified against
  upstream source at the pinned revision
  (see `docs/FIGCRAFT_REUSE_MAP.md`).
- Boundary: the engine owns its document exclusively. The React app crosses
  into it only through `execute` / `undo` / `redo` / selection / tree
  describe / hit-test / SVG export / save+load (see `rust/src/lib.rs`). There
  is no second editable TypeScript document model.
- Migration: legacy JSON documents convert explicitly via
  `src/engine/convert.ts` (UND→FC) and read back via
  `src/engine/readback.ts` (FC→UND). Auto-layout, child sizing (where the
  engine accepts it: fill needs a layout parent, hug needs layout or text),
  and constraints migrate; still-unsupported properties (component defs,
  variant sets, shared style defs, prototype links, images, gradients beyond
  their solid fallback, shadows) produce recorded warnings and safe
  placeholders, never silent data loss. Rotation is clockwise in UND/SVG and
  counter-clockwise in the engine; the boundary negates it.
- Not reused: the upstream `ui-egui` editor shell (Rust-only, no React
  equivalent — Undesign keeps its own product shell and panels), the
  `mcp`/headless crates, and brand/separately licensed material (ArtCraft
  trademarks, OFL fonts).

If a future change patches or vendors upstream files, the modification must be
recorded in `third-party/figcraft/README.md` with the file list.
