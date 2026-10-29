# FigCraft source reuse map (Undesign)

Upstream: `https://github.com/brydanforge/figcraft`
(see note on task-text org discrepancy below),
pinned revision `92682728e9d6a3a97ea25a99395be7a34a8db993`,
inspected at `/tmp/figcraft-upstream` (`git rev-parse HEAD` matches the pin).

Integration mode: **unmodified Cargo git dependency**
(`rust/Cargo.toml` pins `figcraft-engine`, `figcraft-doc`, `figcraft-svg`,
`figcraft-geom`; `rust/Cargo.lock` pins all 13 `figcraft-*` crates at v0.10.0
to the same revision). No upstream source is vendored or patched. License:
MIT OR Apache-2.0 at Undesign's option (see
[third-party/figcraft/README.md](../third-party/figcraft/README.md)).

Verdicts: `reuse-direct` (call upstream code as-is), `wrap` (thin typed
boundary over an upstream command), `adapt` (port a table/shape, behavior
stays upstream-owned where possible), `cannot-reuse` (no usable upstream
equivalent in this stack).

## 1. Main editor shell and workspace layout

| Upstream module | Undesign module | Ownership | Verdict | Deps / constraints | Action |
|---|---|---|---|---|---|
| `apps/figcraft/src/main.rs` + `crates/ui-egui` `FigApp`/`windows.rs`/`home.rs` | `src/main.tsx`, `src/App.tsx`, `src/engine/store.tsx` (`EngineProvider`) | Undesign-original React shell | `cannot-reuse` shell | eframe/egui (Rust) vs React; no shared UI runtime | Retain React shell; keep Undesign branding/routing |
| `crates/layout` + `engine::normalize` (`lib.rs`) | `src/layout.ts` (dead, tests-only) + engine passive layout | Upstream executes | `reuse-direct` (+ `wrap` for explicit cmds) | `layout.*` linked; resize/move already exercise `figcraft-layout` via `normalize` | Bridge `layout.add`/`layout.remove`; migrate UND layout/sizing/constraints in `convert.ts` |

## 2. Canvas rendering and viewport management

| Upstream module | Undesign module | Ownership | Verdict | Deps / constraints | Action |
|---|---|---|---|---|---|
| `crates/ui-egui/src/canvas.rs` | `src/components/EngineCanvas.tsx` | Undesign-original | `cannot-reuse` | egui immediate-mode; not portable to React | Retain React canvas + SVG overlay |
| `figcraft-svg::export_svg`, `figcraft-render` | `rust/src/lib.rs` `export_page_svg` → `adapter.svg()` | Upstream renders | `wrap` | `export_page_svg` errors on empty pages | Keep bridge; surface empty-page state in UI |
| `figcraft-geom` Affine | `src/engine/geometry.ts`, `src/transform.ts` | Split (TS overlay math necessarily retained) | `adapt` | CCW-positive engine vs CW-positive UND; sign flips verified both sides | Keep; no change |

## 3. Pointer events, hit testing, selection, multi-selection

| Upstream module | Undesign module | Ownership | Verdict | Deps / constraints | Action |
|---|---|---|---|---|---|
| `DocState.selection`, `Session::set_selection`, `select.*` (`cmd/edit.rs`) | `EngineCanvas` pointer handlers + `store.tsx` select/click/marquee | Upstream executes | `wrap` | `select.layersAt`/`select.area` verified; tolerance 0.5 | Keep; already bridged |
| `engine/src/snap.rs` + `tools.rs`/`vectoredit` gestures | `src/utils.ts` `snapMoveDelta` (implemented, tested, not wired live) | TS duplicate, unwired | `cannot-reuse` as-is | Upstream snap only reachable via unbridged egui gesture layer | Keep TS helper; bridge later or wire `snapMoveDelta` into drag |

## 4. Object creation, dragging, resizing, rotation, transformation

| Upstream module | Undesign module | Ownership | Verdict | Deps / constraints | Action |
|---|---|---|---|---|---|
| `shape.*`, `node.create`, `text.create`, `transform.*`, `align.*`, `distribute.*`, `arrange.*` | `adapter.ts` create/move/resize/align/distribute/arrange + `store.tsx` actions | Upstream executes | `wrap` | Rotation negated at boundary both directions | Extend `createShape` to polygon/star/arrow; add booleans, frame/mask, rasterize, swap-orientation |
| `bool.*`, `vector.*` (`cmd/structure.rs`) | none | Upstream-available | `wrap` | `{ids?}` params verified | Bridge `bool.union/subtract/intersect/exclude/flatten` |

## 5. Layer ordering and hierarchy

| Upstream module | Undesign module | Ownership | Verdict | Deps / constraints | Action |
|---|---|---|---|---|---|
| `node.reorder`, `node.reparent`, `object.rename/toggleVisible/toggleLock` | `EngineSidebar.tsx` + `tree.ts` + adapter reorder/reparent | Split (engine owns order; TS owns drag math) | `wrap` cmds; `cannot-reuse` `layers.rs` panel | TS drag via `elementFromPoint` | Keep; add `object.moveToPage` bridge |

## 6. Document state and history

| Upstream module | Undesign module | Ownership | Verdict | Deps / constraints | Action |
|---|---|---|---|---|---|
| `figcraft-doc` `Document`, `Session` history (`lib.rs`, `collab/history.rs`) | `rust/src/lib.rs` save/load/undo/redo + `adapter` + legacy `types.ts` UND schema | Upstream executes | `wrap` | Plain `Document` JSON, not `.figcraft` zip | Keep; legacy `history.ts` stays tests-only |
| `figcraft-format` (`save_bytes`, versions, thumbnail) | none | Upstream-available, unbridged | `wrap` (future) | Linked transitively | Optional later: `.figcraft` sharing |

## 7. Keyboard shortcuts and command dispatch

| Upstream module | Undesign module | Ownership | Verdict | Deps / constraints | Action |
|---|---|---|---|---|---|
| `engine/src/keymap.rs` (12 groups), `help.shortcuts` | `src/App.tsx` keydown + `TopToolbar` `SHORTCUTS` table | Undesign-original | `adapt` | React key handling; engine registry is the command source | Keep TS dispatch; add adapter methods on demand |
| 598-command registry (`cmd/*`) | `adapter.cmd()` passthrough + ~30 typed wrappers | Upstream executes | `wrap` | Every wrapped name verified in registry | Extend typed wrappers (styles, components, proto, text, image) |

## 8. Clipboard, serialization, import/export, persistence

| Upstream module | Undesign module | Ownership | Verdict | Deps / constraints | Action |
|---|---|---|---|---|---|
| `Session.clipboard`, `edit.copy/cut/paste*` | `store.tsx` copy/cut/paste (engine-internal, no OS mirror) | Upstream executes | `wrap` | No system-clipboard mirror | Keep |
| `file.placeImage` (`{path\|data, x?, y?}`) | `convert.ts` image→placeholder + warning | Upstream-available | `wrap` | Base64 `data` verified (data-URL prefix tolerated) | Bridge `placeImage`; add File→Place image; keep placeholder fallback in converter |
| `file.exportSvg`, `object.rasterize` | `exportSvg` bridge + `exportPng.ts` canvas raster | Split | `wrap` | — | Bridge `rasterize`; keep TS PNG path |
| localStorage persistence | `store.tsx` `undesign.engine.v1` (400ms debounce) | Undesign-original | `cannot-reuse` | Browser binding; upstream is file-based | Keep |

## 9. Text, shapes, images, frames, groups

| Upstream module | Undesign module | Ownership | Verdict | Deps / constraints | Action |
|---|---|---|---|---|---|
| `text.*` (53 specs), `shape.*`, `frame.*`, `object.group/frameSelection/mask` | adapter basics + `EngineInspector` | Split | `wrap` basics + advanced | `{ids?}` text toggles verified | Bridge text bold/italic/underline/align/size/case, frame select/remove/swap, mask |
| `image.*` adjust/presets | none | Upstream-available, unbridged | `wrap` (future) | Needs placed images first | Defer |

## 10. Components, variants, styles, constraints, auto-layout

| Upstream module | Undesign module | Ownership | Verdict | Deps / constraints | Action |
|---|---|---|---|---|---|
| `component.*`/`instance.*` (`cmd/component.rs`), `NodeKind::Component/Set/Instance` | `src/library.ts` (dead except `breakComponentCycles` shim) | Upstream-available | `wrap` | `component.create/list`, `instance.create/swap`, `detach/resetInstance` verified | Bridge component/instance ops; wire Create component + Detach/Reset |
| `style.*`/`variable.*`/`paint.documentColors` | `src/system.ts` (dead) | Upstream-available | `wrap` | Verified: create/apply/detach/update/duplicate/delete/list | Bridge style CRUD + document colors |
| `props.rs` layout/sizing/constraints keys, `layout.add/remove` | `convert.ts` warns + skips | Upstream-available | `wrap` | `node.set` keys verified (`layout`, `gap`, `padding*`, `mainAlign`, `crossAlign`, `sizingH/V`, `absolute`, `constraints`) | Migrate UND layout/sizing/constraints in converter |
| `proto.flow.*`, `proto.interaction.*` | `src/prototype.ts` (dead except `pruneLinks` shim); preview is static SVG | Upstream-available | `wrap` | Flow add/rename/remove + interaction clear/remove verified | Bridge flows; keep static preview |
| `crates/mcp` (headless/AI) | `src/ai.ts` (dead) | No counterpart (`AiEditOp` is UND-only; `mcp` not in Cargo closure) | `cannot-reuse` | — | Leave; needs adapt-only design |

## 11. UI components, panels, toolbars, inspector infrastructure

| Upstream module | Undesign module | Ownership | Verdict | Deps / constraints | Action |
|---|---|---|---|---|---|
| `crates/ui-egui` (`toolbar.rs`, `right.rs`, `layers.rs`, panels, menus, dialogs) | `TopToolbar.tsx`, `EngineInspector.tsx`, `EngineSidebar.tsx`, `EngineLab.tsx`, `ui.tsx` | Undesign-original | `cannot-reuse` | Rust-only egui, including `figcraft-web` eframe shell | Retain all React UI; extend menus/panels to expose bridged commands |

## Notes and discrepancies

- Task text names upstream org `moxassault/figcraft`, but every pin record
  (`rust/Cargo.toml`, `rust/Cargo.lock`, `third-party/figcraft/README.md`,
  `README.md`) names `brydanforge/figcraft`; the `moxassault` org was not
  checked. All evidence uses the pinned `brydanforge` URL.
- Upstream `crates/doc/src/components.rs` does not exist; the instance model
  lives in `crates/doc/src/library.rs` with kinds in `node.rs`.
- Dead-but-tested TS modules (`history`, `layout`, `system`, `assets`, `ai`,
  `docpatch`) stay in the tree because 20+ committed test suites import them;
  the live editor does not use them. Removing them would delete committed
  coverage without product gain.
- Undesign's own license is undeclared (no root `LICENSE`, no
  `package.json`/`Cargo.toml` license field); only the upstream choice
  (MIT OR Apache-2.0) is documented.
