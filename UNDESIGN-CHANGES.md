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
