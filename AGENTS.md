# Undesign — instructions for agents

Undesign is a clean-room, open-source, pure-Rust (egui) interface design and prototyping tool:
interface design, auto layout, components and variants, styles and variables, prototyping and
inspection. It runs natively on macOS, Windows, Linux and FreeBSD, and in the browser via WASM.
It is a modification of the open-source FigCraft editor; every local change against the imported
upstream revision is recorded in [`UNDESIGN-CHANGES.md`](UNDESIGN-CHANGES.md).

## Start every session here
1. Read [`ROADMAP.md`](ROADMAP.md) (stage, headline numbers, estimates) and
   [`docs/gaps.md`](docs/gaps.md) (the ranked work list). Unless the user gives you a task, pick
   work from the top of `docs/gaps.md`.
2. Read `plan/STATUS.md` and `plan/execution-plan.md` (local, gitignored) if present; behaviour
   reference notes are in `plan/figma/*.md`.
3. Orient → plan → implement + test → verify (screenshot) → record (ROADMAP, devlog) → commit.

`plan/` is gitignored (local only).

## Non-negotiables

### Clean-room
- Behaviour comes from public documentation and black-box observation of the running incumbent app
  with synthetic documents only. Never read, disassemble or copy anything inside the incumbent's
  application bundle, web bundle or network traffic (names and public listings only).
- Never copy GPL/AGPL code.
- Reference screenshots of the incumbent stay local under the gitignored `plan/figma/screenshots/`
  and are never committed, published or used as assets.

### Assets: third-party product assets prohibited, with this task-scoped owner approval
- **For the isolated `figma-editor-2026-11-04` task only, the project owner explicitly expanded the
  earlier eight-toolbar-glyph approval to Figma-like silhouettes across the full editor-visible icon
  set.** This applies only in `/workspace/undesign-figma-editor`; it supersedes the earlier eight-only
  wording for this pass, not for future tasks or other branches. Keep glyphs monochrome and draw them
  in code; do not add separate visual asset files.
- Use public references only: Figma's [toolbar article](https://help.figma.com/hc/en-us/articles/360041064174-Access-design-tools-from-the-toolbar),
  [UI3 overview](https://www.figma.com/blog/our-approach-to-designing-ui3/),
  [left-sidebar guide](https://help.figma.com/hc/en-us/articles/360039831974-Explore-the-navigation-bar-and-left-sidebar),
  and [right-sidebar guide](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar).
  Never use the references' screenshots as assets. Never inspect a logged-in app, proprietary app
  bundle, private web bundle, or private network traffic; the clean-room rules above still apply.
- **Figma-derived glyph licensing is unconfirmed.** The UI3 Community listing has no licence badge;
  Figma's general CC BY 4.0 guidance does not establish that these glyphs are covered. Record the
  condition in [`ATTRIBUTION.md`](ATTRIBUTION.md); do not claim CC BY 4.0, MIT, or Apache-2.0 for
  reproduced Figma shapes, and do not push, distribute, deploy, or integrate this task's local branch.
- Outside this explicit task, never add, copy, trace, redraw-from, embed or ship third-party icons,
  images, illustrations, cursors, logos, templates, UI kits, preset libraries, fonts or screenshots
  unless a separate owner approval and a compatible licence allow it.
- Every asset file must have a row in [`ATTRIBUTION.md`](ATTRIBUTION.md) (path, author, source,
  licence, notes). `cargo xtask assets` (part of `cargo xtask ci`) fails on any unlisted file under
  `assets/` or `docs/images/`.
- The inherited UI glyph set is drawn in code (`crates/ui-egui/src/icons.rs`) and adapted from
  FigCraft's original icon artwork. Preserve the upstream FigCraft copyright and licence notices.
  The Undesign `Logo` glyph is original. The full-set Figma-like shapes in this task are covered only
  by the owner's isolated task authorization above; future glyphs still require their own review.
- The app icon is a placeholder U mark drawn for Undesign (`assets/app-icon/README.md`);
  `cargo xtask icon` renders the PNGs and `.ico` from `assets/app-icon/undesign.svg`.
- **Fonts live in [storytold/craft-fonts](https://github.com/storytold/craft-fonts), never in this
  repo.** The app uses it only through the optional `CRAFT_FONTS_DIR` build input
  (`.cargo/config.toml` points it at `../craft-fonts` for local builds; `crates/text/build.rs`
  embeds it). Everything must build, test and run without it (system fonts are scanned at runtime).
- Demo and test content is synthetic or public domain; never personal photos or data.
- Code and original assets are MIT OR Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`).
  Upstream FigCraft code keeps its copyright (see `NOTICE` and `UNDESIGN-CHANGES.md`); never drop
  that attribution. This does not assert an open-source licence for the task-authorized Figma-derived
  glyph shapes.
- If the provenance of an asset is unclear, don't add it.

### Never crash
- No `unwrap()`, `expect()`, `panic!`, `unreachable!`, `todo!`, `unimplemented!` in shipped code
  (workspace clippy lints deny them; tests may use them). Return `Result`/`Option`; use `.get()` for
  data-derived indexes; slice strings only at char boundaries; check floats are finite; cap sizes.
- `undesign_engine::guard` turns a panicking command into `EngineError::Internal` and the document
  is rolled back; the desktop app also guards each UI frame and writes recovery copies. These are
  safety nets, not substitutes for `Result`.
- `unsafe_code = "forbid"` workspace-wide.
- Every crash fix comes with a regression test. The engine has a junk-parameter sweep over every
  command (`crates/engine/src/tests.rs`): extend fuzz/sweep tests when you add parsers or commands.

### Architecture
- **Everything is a command.** User-visible behaviour = a command in `crates/engine/src/cmd/*`
  (`spec!(id, label, params doc, undoable, run)`) + tests. The menus, shortcuts, Actions palette,
  CLI and control channel all dispatch the same command ids. Command ids follow the
  incumbent's menu catalog in `crates/engine/src/catalog.rs` (the parity metric: `cargo xtask parity`).
- **Programmatic calls never open dialogs.** Commands only *request* UI (`Session::request_ui`); the
  control channel drops dialog requests.
- **Layering** is enforced by `cargo xtask layers`: geom/color (L0) → doc (L1) → layout/text/pathops/plugin/collab
  (L2) → render/format (L3) → svg/pdf (L4) → engine (L5) → ui-egui/collab-net (L6) → apps. Nothing below
  L6 depends on egui/eframe/rfd/winit. **The UI crate is swappable.**
- **The UI is thin**: panels read engine state and act through `app.run(id, params)` /
  `app.set_props(ids, props)`. Colours come from `theme::Tokens`.
- **Time goes through `chrono`** (workspace dependency). Never hand-roll UTC/calendar conversion (days-to-date algorithms, leap-year math); a crate owns only its output format string. The one exception is range extension: past the years chrono can represent, shift the date by whole 400-year Gregorian cycles (146,097 days, after which the calendar repeats), let chrono compute the month and day, and add the cycles back to the year (splitting seconds into hours, minutes and seconds is plain arithmetic).
- **Rust only** (no handwritten JS/TS). **Never break wasm** (`cargo xtask wasm`).

### Quality gates (before every commit)
`cargo xtask ci` (fmt, clippy -D warnings, tests, layers, assets, wasm). One task per commit with a
milestone id in the message (`M2.1: auto layout wrap`). Commit after every landed arc of work; push
to `main`.

## Running and looking at the app
- `cargo run -p undesign -- --control <port> [file.undesign|file.svg|image]`. Pick a free port
  (`python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'`);
- Drive it with JSON lines, e.g.
  `{"id":1,"method":"engine.execute","params":{"command":"shape.rectangle","params":{"x":10,"y":10,"width":100,"height":50}}}`
  then `{"id":2,"method":"ui.screenshot","params":{"path":"/tmp/shot.png"}}`. Methods are documented
  in `crates/ui-egui/src/control.rs` and `docs/control-protocol.md`.
- **For UI work, look at the result** (take a screenshot and read the PNG). Compare with the
  incumbent side by side where the owner allows (`plan/figma/`).
- Headless: `undesign-cli` (`info`, `export`, `run`, `commands`).
- Shell gotcha on the owner's machine: `mv`/`cp` may be aliased interactive — use `/bin/mv -f`.
- Parallel agents: separate `CARGO_TARGET_DIR` per agent, edit only the crates/files you own,
  write manifests atomically, delete your target dir when done (disk is limited).

## Roadmap
Progress docs: [`ROADMAP.md`](ROADMAP.md) (one-page summary and stage),
[`docs/target-app-parity.md`](docs/target-app-parity.md) (the authoritative assessment),
[`docs/gaps.md`](docs/gaps.md) (ranked work list), [`docs/roadmap.md`](docs/roadmap.md)
(milestones), [`docs/architecture.md`](docs/architecture.md), the per-area `docs/*-parity.md` files
and the generated [`docs/parity-checklist.md`](docs/parity-checklist.md) (`cargo xtask parity`).
When a task lands, update the affected rows and the status line and revision history in the same
commit. Grade by behaviour against the incumbent, not by whether a menu item exists; err low.

## Contributor credits (About window)

- All contributor and model data was removed 2026-11-05: About ▸ Contributors and
  About ▸ Models both show their empty-data notes.
  `contributors/contributors.json` is hand-maintained until the craftrules generator runs again;
  each contributor adds only their own `people.toml` entry (see `docs/contributors.md`).

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly (use these paths even if a same-named global skill exists):
- Core filter, always on: `antislop`: `.agents/skills/antislop/SKILL.md`
- Copy & text: `antislop-copywriting`: `.agents/skills/antislop-copywriting/SKILL.md`
- People: `antislop-human`: `.agents/skills/antislop-human/SKILL.md`
- Mobile / responsive: `antislop-layoutmobile`: `.agents/skills/antislop-layoutmobile/SKILL.md`
- Code comments: `antislop-code`: `.agents/skills/antislop-code/SKILL.md`
Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
To update antislop later: `npx antislop-ai --update`, or run `npx antislop-ai` and pick Overwrite them.
<!-- antislop:end -->
