# Undesign change log

Undesign is a modification of the open-source FigCraft editor (MIT OR
Apache-2.0). This file records every local change against the imported
upstream revision so future syncs stay auditable.

- Upstream: `https://github.com/brydanforge/figcraft`
- Imported revision: `92682728e9d6a3a97ea25a99395be7a34a8db993`
  (`Follow-ups from the #1311 review (#1316)`, 2026-10-25)
- Prior history: the previous React + engine-bridge Undesign app remains in
  this repo's git history (up to `3847844`) and on `origin/main` before the
  replacement commit; nothing was force-pushed or deleted from history.

## 2026-10-29 — Full FigCraft import (change #1)

- Replaced the whole working tree with upstream FigCraft at the revision
  above (verified byte-identical, `diff -r`, excluding `.git`).
- Added the Undesign notice at the top of `README.md` (attribution only;
  no upstream content altered).
- Added this file.
- Removed stale build caches of the old app (`rust/target`, `node_modules`,
  old `dist/`, empty `src/`); all regenerable, none tracked.
- License compliance: `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`, and all
  copyright headers kept verbatim. ArtCraft trademarks (`docs/brand/`,
  separate brand license) are not reused and must stay out of Undesign
  branding.

## 2026-10-30 — AI removal + Undesign rebrand (change #2)

- Removed everything AI-facing: deleted `crates/mcp` (the MCP server for AI
  agents), the `undesign-cli mcp` subcommand, `docs/mcp.md` and
  `.coderabbit.yaml`, AI badges and links, and "agent" wording across code and
  docs (now "scripts" driving the CLI and the JSON control channel, which
  stay). `plugin publish` in the CLI now runs a headless engine session
  directly instead of through the deleted crate. Kept as history (not
  features): contributor-credit data naming AI models, and the "AI features"
  parity rows that record Figma AI functionality Undesign does not have.
- Rebrand FigCraft → Undesign, without exception outside the legal minimum:
  crate/binary names (`undesign-*`), the `.undesign` file extension and URL
  scheme, plugin manifest/ABI names, packaging ids
  (`io.github.palcchi.undesign`), docs, locales and the About dialog.
- New original brand: a placeholder U mark (SVG + generated PNGs/ICO, drawn
  for Undesign, MIT OR Apache-2.0), a matching `Logo` glyph drawn in code and
  an "Un"+"design" two-tone wordmark. The green palette is kept as
  Undesign's brand colour.
- No hosted collaboration server: the default server is now empty (was
  `wss://collab.craftapps.dev/`); deleted `docs/online-sharing-terms.md`.
  Share ▸ Online needs a server in Preferences or a self-hosted
  `undesign-server`.
- Deleted the ArtCraft trademarks (`docs/brand/`) entirely.
- Fresh product identity on Windows: new MSI UpgradeCode and component GUID.
- Kept verbatim for license compliance: `LICENSE-MIT` (upstream copyright),
  `LICENSE-APACHE`, the upstream copyright paragraph in `NOTICE`, and the
  `contributors/` history snapshot. These four are the only places that still
  name FigCraft/ArtCraft, plus this file's audit trail.

## 2026-10-30 — Standalone server and contributor data removed (change #3)

- Deleted the standalone collaboration server: `apps/undesign-server`,
  `packaging/server/` and `docs/server.md`. Gone with it: server releases, the
  deployment guide, open hosting, operator commands and the server-side halves
  of team libraries and the plugin directory. What stays: the collaboration
  protocol and client code (`crates/collab`, `crates/collab-net`, `collab.*` and
  `plugin.directory.*` commands, Share ▸ Online against any compatible server,
  hosting from the app, local-network sharing), still specified by
  `docs/collab-protocol.md`.
- Deleted the contributor-credit data: `contributors/` and
  `docs/contributors.md`. About ▸ Contributors now shows its empty-data note
  (no code change needed; `crates/ui-egui/build.rs` and the credits UI handle
  missing files). The upstream copyright in `LICENSE-MIT`/`NOTICE` is untouched.
- Reworded every present-tense reference to the deleted pieces (UI strings with
  their 18 non-English translations dropped back to English, CLI help, command
  docs, release workflow `has-server: false`, `Cargo.lock`, README and docs).
  Dated history rows still name them, as records of what shipped.
- Parity docs were reworded to past tense but NOT re-graded: percentages, hours
  and estimates still predate this removal (next re-measure must lower
  collaboration/ecosystem rows that counted the server).

## 2026-10-30 — Deeper dark theme, replaced starter templates (change #4)

- Dark theme deepened (`crates/ui-egui/src/theme.rs`: panels `#1B1B1B`,
  canvas `#101010`, matching borders, fields, rows and menus; text and accent
  colours unchanged) and the toast made theme-aware (a raised, outlined
  surface in the dark theme, `crates/ui-egui/src/lib.rs`).
- Starter templates replaced with new original designs built in code
  (`crates/engine/src/templates/`): a Simmer recipe app, a Pixel Summit
  conference page, a Pulse fitness dashboard, a design system starter in
  Undesign greens, a checkout wireframe kit, a Simmer launch announcement, a
  Simmer pitch deck and a redrawn 24-icon set (the glyph library's Mountain
  mark replaced by an original Sprout). Template ids, kinds, names, frame
  sizes and content-shape contracts are unchanged; the four changed
  descriptions are translated in Spanish, other drafts read English for them
  (stale keys removed from 13 locale files).
- Not re-graded: percentages, hours and estimates are unchanged by this
  re-skin (it adds no Figma behaviour).

## 2026-10-30 — Figma-look pass from reference screenshots (change #5)

- The left panel's header names the file's kind (Design/Board) under the file
  name instead of the stale "Drafts" (`crates/ui-egui/src/layers.rs`; "Board"
  is a new catalog key in English and Spanish, other drafts read English for
  it; the "Drafts" key is removed from all 18 catalogs that had it).
- The zoom readout in the Design/Prototype tabs row carries the accent, as
  Figma's blue zoom does (`crates/ui-egui/src/right.rs`).
- Guard test: every code-drawn icon stays on the 16-unit grid and keeps
  painting (`every_icon_stays_on_the_grid_and_paints` in
  `crates/ui-egui/src/icons.rs`), plus a header kind-label test
  (`board_ui_tests.rs`).
- Reference screenshots stay local under `plan/figma/screenshots/` (gitignored,
  never committed); only layout, density, theme and behaviour were matched, no
  Figma artwork was copied or traced. Not re-graded: numbers unchanged.

## 2026-10-30 — Locale catch-up: nine catalogs' UI keys to 100% (change #6)

- Indonesian (74 keys, previous commit) plus Spanish (11), French (35), German
  (118), Brazilian Portuguese (17), Czech (74), Dutch (38), Polish (39) and
  Russian (24) UI keys, all 1,795/1,795 (`crates/ui-egui/locales/`), drafted in
  each file's conventions and still drafts; Russian's additions welcome native
  re-confirm. Bengali, Finnish, Japanese, Georgian, Korean, Swedish, Turkish
  and Simplified Chinese still show English for their missing keys. Totals to
  re-measure with `cargo xtask i18n-report`. Not re-graded: numbers unchanged.

## 2026-10-30 — Icon redraw, toolbar pill, home Templates removed (change #7)

- All 159 code-drawn icons redrawn from scratch in a rounded geometric style
  on the 16-unit grid (`crates/ui-egui/src/icons.rs`); original artwork, no
  third-party iconography. Geometry written to the pinning tests' contracts
  (grid guard, inset Frame/Text, Slice knife coverage, corner marks, gradient
  fades); `cargo test` still to run on a machine with the toolchain.
- Toolbar pill content centred with symmetric 8 px insets plus a
  `pill_content_is_centred` test (`crates/ui-egui/src/toolbar.rs`).
- Home screen: the Templates tab, the first-run template row and File ▸ New
  from template… removed (`crates/ui-egui/src/home.rs`, `home_tests.rs`, the
  `home.templates` request arm in `lib.rs`, the catalog entry in
  `crates/engine/src/catalog.rs`); `file.newFromTemplate` without `template`
  returns the list without asking the UI to show a picker. The eight starter
  templates stay in the engine, the CLI and the control channel. Ten home UI
  keys removed and two added (`Search files`, `No files match your search`;
  nine catalogs at 1,787/1,787). Docs updated (`ui-parity.md`,
  `target-app-parity.md`, `control-protocol.md`, `README.md`, `ROADMAP.md`):
  discoverability ×0.94 → ×0.93, essentials 59.2% → 58.6% (~59%).

## 2026-10-31 — Icon stroke consistency (change #8)

- Kept the code-drawn FigCraft-derived glyph set with its upstream copyright and licence intact;
  the Undesign `Logo` glyph remains original. No Figma icon assets, tracing or third-party icon
  pack was introduced.
- Increased the native 16 px outline to a clearer 1.25 px and scaled it proportionally
  (1.875 px at 24, 2.5 px at 32), while retaining a 1 px floor for tiny glyphs.
- Added a regression test for the size-to-stroke relationship.

## 2026-10-31 — Motion document foundation (change #9)

- Added optional motion compositions to the document model. Existing files decode with an empty
  motion section and omit that section again when no compositions exist.
- Added composition validation, property animation tracks, ordered numeric keyframes, Step/Linear/
  Cubic Bezier interpolation and a pure frame-sampling evaluator.
- Added tests for sampling, disabled tracks, keyframe ordering and backwards-compatible decoding.
- Added undoable engine commands and an initial Motion tab for composition setup, track creation,
  playhead scrubbing and numeric keyframe entry. Playback/render evaluation, graph editing, effects
  and video export are not implemented yet.
- Added the provider-neutral AI Assistant architecture; provider transport and chat UI remain planned.

## 2026-11-01 — Motion playback preview (change #10)

- Added frame sampling across a composition (`Composition::sample_all`) and a render-only preview
  document (`preview_document`) that applies sampled values like manual edits, with a new
  centre-preserving scale helper in geom (`set_scale_about_center`, `scales`).
- The Motion tab plays and loops at the composition's fps with a time readout; while it is active
  the canvas renders the evaluated preview without touching the saved document, creating undo
  entries or marking it dirty. Selection outlines and hit-testing stay on base values.
- Added an original code-drawn `Pause` icon next to `Play` for the transport button.

## 2026-11-01 — Interface restyle (change #11)

- Restyled the interface after the owner-supplied references in the local `plan/` folder (layout
  unchanged, all original code): side panels float as rounded cards with shadows, controls use
  chunkier radii, segmented controls and buttons are pills, toolbar cells are round chips.
- The Motion tab follows the same language: section labels match the app convention, timeline rows
  are cards, actions use the shared button styles.

## 2026-11-01 — Motion timeline rewrite (change #12)

- Rebuilt the Motion tab on unwritten-studio timeline patterns (original code): layer rows with
  twirl-downs, per-property lanes with stopwatch toggles, a shared ruler and playhead, zoom-to-fit,
  keyframe snapping, transport with previous/next keyframe jumps, diamond drag-move and
  Delete-to-remove.
- Added an atomic `motion.keyframe.move` engine command (drop-onto-key merges) and a
  `current_value` helper so stopwatches key the property as shown; new transport/stopwatch icons
  are original code-drawn glyphs.

## 2026-11-01 — UI overhaul pass: window bed, icon redraws (change #13)

- Fixed the near-black gaps between the floating panels in the light theme: the root Ui now
  paints a full-window bed in the canvas colour before the cards (the GPU clear colour showed
  through their margins and rounded corners).
- Redrew six code-drawn icons whose geometry read poorly (original artwork): Hand, Slice, Bend,
  PaintBucket, Lasso, VariableWidth.
- Tests: every icon's ink must stay in its box (`every_icon_stays_in_its_box`); the root must
  paint the window bed (`the_root_paints_the_window_bed`). Also fixed the pre-existing
  `Shape::ConvexPolygon` compile break in the icon test helper (epaint 0.36 returns `Path`).
- Repaired two stale icon tests the compile fix surfaced (both fail at HEAD, neither touched by
  this pass): `frame_and_text_marks_are_inset` now allows the round caps on stroke ends, and
  `slice_is_one_connected_knife` asserts the blade and handle overlap geometrically instead of
  pinning an outline mechanism no helper produces.
- Full `undesign-ui-egui` suite: 674 passed, 14 failed, all 14 characterized as pre-existing
  (interaction-coordinate drift, copy drift, a missing `Motion` catalog key at HEAD, two
  font-sensitive width assertions in this container, one flaky textures-delta drop); none is
  caused by this pass.

## 2026-11-01 — UI overhaul pass: token consistency (change #14)

- Snapped three off-scale radii onto the documented scale: the align-grid indicator bars and
  the scale anchor dots from 1 to 2, the present navigation bar from 9 to 10. Verified the
  remaining odd values are geometry-dictated and left them (circular swatches and full-round
  pills at half height, a radius derived from its shrunken outer bubble, sharp canvas handles).
- Moved the last four direct `FontId` uses onto the `theme::regular` helper (motion ruler and
  lane labels, icon gallery labels); audited icon tooltips (55/55 present), disabled states and
  margins (8-based) as already consistent, so no churn there.

## 2026-11-01 — UI overhaul pass: narrow viewports (change #15)

- The main toolbar pill now fits the canvas and scrolls inside it (wheel or drag) instead of
  clipping unreachable buttons under the side panels on narrow windows; the help button hides
  exactly when it would collide with the pill (its items stay in the main menu).
- Added `ui.set {windowSize: [w, h]}` to the control channel for viewport QA (documented in
  `docs/control-protocol.md`).
- Tests: `toolbar_fits_narrow_canvases` pins the pill width and help visibility at wide, narrow
  and minimum canvas widths.

## 2026-11-01: Docked Motion timeline (change #16)

- Added a Motion toggle to the floating toolbar pill (an original code-drawn keyframe-diamond
  glyph): pressing it opens the Motion timeline docked along the bottom of the window, full
  width below the side panels, like the incumbent's Motion beta.
- Added a non-undoable `motion.timeline {on?}` engine command that requests the dock; the dock
  reuses the side tab's transport and timeline (composition picker, ruler, playhead, layer rows,
  stopwatches, keyframe drag-move, Delete-to-remove) with its own widget ids, a close button and
  a resizable 232 px default height. The canvas previews the directed composition while the dock
  (or the side tab) is open, without touching the saved document.
- Tests: engine (`motion_timeline_tests`: the UI request, `on` passthrough, no undo entry) and
  UI (`motion_timeline_tests`: toggle/set, the dock drawing empty and with tracks, the preview
  active); the toolbar centring test now counts the Motion button. Verified in container
  (toolchain 1.99.1): fmt, workspace clippy, layers, assets, wasm and 22 test suites
  green; the ui-egui suite keeps 12 failures that fail identically on the base commit
  (pre-existing, see the commit message); a screenshot still needs the owner's machine.

## 2026-11-01 — Hackathon agent track (change #17)

- New `undesign-agent` crate (L6, shared native and wasm, no UI toolkit, no network):
  a 14-command whitelist with registry-derived prompt docs (a renamed command fails
  closed), plan parsing (raw JSON or one fenced block, the `command.batch` shape),
  structural validation and clamping (capped steps, truncated strings, finite numbers,
  `opacity` clamped, `$step` refs preserved), a minimal chat context (canvas, selection,
  layer names, compositions), a poll-based `Provider` trait (no async runtime), and a
  turn driver (one retry on an unusable reply, atomic apply as one undo step).
- Providers: `MetaModelApi` (chat completions over an injectable transport, structured
  JSON output), `Replay` (recorded demo plans), `FallbackProvider` (primary, then
  replay), plus a scripted `FakeProvider` for tests.
- Agent panel: a new right-panel Agent tab (examples, prompt box, run, per-turn undo,
  status), `RightTab::Agent` with control-channel `rightTab: agent`, and the mode
  switcher treating Agent like Design. Documented in `docs/agent.md`.
- Wiring: workspace member, `undesign-ui-egui` dependency, layers-table entry (plus a
  same-layer edge, since the agent core is UI-toolkit-free), wasm check coverage.
- Landing fixes in the same commit: the M14.3 preview-scale test asserted row lengths
  instead of axis scales under rotation (corrected to `scales()`, plus a geom unit
  test pinning the convention); the right-panel header is now two rows (tabs, then the
  zoom combo), because the fourth tab overlapped the combo and keyboard focus skipped
  it; the missing `Agent` catalog key (English, Spanish); a shadowed test helper and a
  missing re-export in the agent crate; an egui-0.36 `TextEdit` frame call.

## 2026-11-04: Integration and UI audit pass (change #18)

- Merged the open branches into `main`: `work/ui-ux-implementation-2026-11-04` (Motion dock
  collapse, inspector track list, ruler gridlines and label steps, Home action buttons,
  `DESIGN.md`; main's newer editor shell, left panel and tab bar kept where the two
  conflicted), `interaction-audit-fixes-2026-11-04` (canvas pointer tests),
  `triangle/code-connect-publish` (`undesign-cli code-connect publish`), the dependabot
  actions bump, and the code part of `work/motion-007-icon-refresh`. The brand-asset draft
  (`brand-assets/`, PR #4) and the checkpoint PR #3 are not merged.
- Agent: an Anthropic Messages adapter beside the OpenAI-compatible one
  (`crates/ui-egui/src/agent_provider.rs`, `apps/undesign/src/agent_provider.rs`,
  `crates/ui-egui/src/agent_ui.rs`); provider tool names use `__` for dots.
- UI fixes from an on-screen check: one-row Motion timeline toolbar, padded Motion track list
  and Agent panel, a Developer Mode toggle beside the tools, rail labels, centred text-field
  editors, the Home folder list position, keyboard entry into the Interface size menu, an em
  dash removed from a UI label, translated Motion transport tips (English, Indonesian).
- Tests updated for the shipped layout (one left "Design" tab, the Developer Mode toggle).

## 2026-11-04: Editor in the UI3 arrangement (change #19)

- `crates/ui-egui/src/lib.rs`, `right.rs`, `layers.rs`: the full editor has no header bar or icon
  rail; `right::file_header` (main menu, file name, file-and-pages menu, save status) tops the
  left panel, `right::actions_header` (people, Chat, Present, Share, zoom) tops the right panel,
  `right::help_button` sits in the canvas corner. Side panels and the Motion dock are docked
  (1 px border, no margins or shadows). Narrow windows keep the rail and cards.
- `widgets.rs`, `theme.rs`: 24 px controls, radii 5 (inputs, buttons), 12 (panels, dialogs).
- `frame_labels.rs`, `canvas.rs`: status badges drawn only where they fit over their frame.
- Tests updated for the docked geometry.
