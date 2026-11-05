<p align="center">
  <img src="assets/app-icon/hicolor/256x256/apps/io.github.palcchi.undesign.png" width="128" height="128" alt="Undesign icon: a white U on a green tile">
</p>

<h1 align="center">Undesign</h1>

<p align="center">
  <b>An open-source interface design and prototyping app, written in Rust.</b><br>
  This repository includes a browser-based showcase of sample files and editor workflows.<br>
  Explore the demo first; treat the app as an early alpha, not a finished production tool.
</p>

<p align="center">
  <img alt="100% Rust" src="https://img.shields.io/badge/100%25-Rust-b7410e?style=flat-square&logo=rust">
  <img alt="macOS · Windows · Linux · FreeBSD · Web" src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux%20%C2%B7%20FreeBSD%20%C2%B7%20Web-native-0EA5C6?style=flat-square">
  <img alt="License: MIT OR Apache-2.0" src="https://img.shields.io/badge/license-MIT%20%2F%20Apache--2.0-3a3a3a?style=flat-square">
  <img alt="Status: early alpha" src="https://img.shields.io/badge/status-early%20alpha-d69e2e?style=flat-square">
</p>

<br>

<p align="center">
  <img src="docs/images/ui-editor.png" alt="Undesign in its dark theme with the Ridgeline app example: three phone screens on the canvas (Home in light mode with a Ready for dev badge, a trail detail page and Home in dark mode), the Featured trail card instance selected, the file name and layers on the left, and on the right the Share and zoom controls above the Design panel with the instance's properties, position, auto layout and appearance" width="100%">
  <br><sub><b>Editor preview</b>: a sample Ridgeline file open in the browser showcase, with its layers and design controls visible · <code>examples/ridgeline-app.undesign</code></sub>
</p>

<p align="center">
  <b>Open a ready-to-explore sample in your browser:</b><br>
  <a href="https://palcchi.github.io/undesign/?example=undesign-intro"><b>▶ Motion demo</b></a> (plays the Undesign intro sample) ·
  <a href="https://palcchi.github.io/undesign/?example=ridgeline-app"><b>Design demo</b></a> ·
  <a href="https://palcchi.github.io/undesign/?example=ridgeline-onboarding"><b>Prototype demo</b></a> ·
  <a href="https://palcchi.github.io/undesign/">open the app</a> (choose any sample from Home ▸ Examples)
</p>

<br>

<p align="center">
  <a href="#a-look-around">Screens and workflows</a> ·
  <a href="#examples">Browser examples</a> ·
  <a href="#made-in-undesign">Sample artwork</a> ·
  <a href="#features">What you can try</a> ·
  <a href="#scriptable-to-the-core">Automation</a> ·
  <a href="#under-the-hood">Implementation</a> ·
  <a href="#get-started">Build it</a>
</p>

<br>

<p>The images in this README are original project visuals. They show Undesign's interface and example designs; they are showcase material, while the linked browser sessions let you try the sample files yourself.</p>

<table>
  <tr>
    <td width="25%" valign="top">
      <h3>Design in one workspace</h3>
      Work with frames, layers, reusable components, styles, variables and vector shapes in a native interface.
    </td>
    <td width="25%" valign="top">
      <h3>Rust-powered editor</h3>
      A persistent document model lets edits focus on changed data. The desktop app uses egui rather than Electron or an embedded web view.
    </td>
    <td width="25%" valign="top">
      <h3>Local files by default</h3>
      Projects are <code>.undesign</code> files on your device. The app has no account or telemetry; online sharing is optional and described in <a href="#privacy-and-online-sharing">the privacy notes</a>.
    </td>
    <td width="25%" valign="top">
      <h3>Same engine, several ways</h3>
      Use the interface, command-line tools or JSON control channel to work with the document model.
    </td>
  </tr>
</table>

<br>

## A look around

<p>These screenshots pair the editor with sample documents, so you can see what the browser examples are meant to demonstrate.</p>

<table>
<tr>
<td width="50%" valign="top">
  <img src="docs/images/ui-motion.png" alt="The Undesign intro example in the Motion workspace: the canvas shows the U mark, the Undesign wordmark and the tagline part-way through their entrance with the first feature chip fading in, the Motion panel on the right lists sixteen property tracks, and the docked timeline below has the transport, the current time at frame 38, a ruler in seconds, the playhead and keyframe diamonds on the mark's rotation, scale and opacity lanes" width="100%">
  <p align="center"><sub><b>Motion workspace</b>: preview an animated intro with property tracks and keyframes · <code>examples/undesign-intro.undesign</code></sub></p>
</td>
<td width="50%" valign="top">
  <img src="docs/images/ui-home.png" alt="The Home screen: New design, New board, Import file and Join team buttons, a join-with-a-code field, the Getting started tips, and an Examples section with picture cards for Undesign intro, Daybreak motion study, Ridgeline app, Ridgeline onboarding, Ridgeline design system, Ridgeline Studio dashboard and Glass and vectors" width="100%">
  <p align="center"><sub><b>Home screen</b>: start a file, import one, or make a copy of a built-in example</sub></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
  <img src="docs/images/ui-prototype.png" alt="Four onboarding phone screens in the Prototype tab joined by connection curves; the Continue button on the second screen is selected and the Prototype panel shows its On click, Navigate to 3 Location interaction and its scroll behaviour" width="100%">
  <p align="center"><sub><b>Prototype view</b>: connect screens and test an interaction flow · <code>examples/ridgeline-onboarding.undesign</code></sub></p>
</td>
<td width="50%" valign="top">
  <img src="docs/images/ui-devmode.png" alt="Developer Mode on the Ridgeline home screen: a Ready for dev badge, a Development annotation callout on the trail card, red measurement lines from a selected trail row to its frame, and the Inspect panel listing the row's layout, auto layout, fills and effects" width="100%">
  <p align="center"><sub><b>Developer Mode</b>: inspect measurements, annotations and implementation details in the sample · <code>examples/ridgeline-app.undesign</code></sub></p>
</td>
</tr>
<tr>
<td colspan="2" valign="top">
  <img src="docs/images/ui-agent.png" alt="The Agent tab beside the onboarding screens: Design and Motion skills, a Provider switch set to Anthropic with the fixed Messages endpoint, empty Model ID and API key fields, notes that the key stays in memory for the session and that no request is sent until Send, and a Connect button" width="100%">
  <p align="center"><sub><b>Optional Agent tab</b>: connect your own OpenAI-compatible or Anthropic provider; review each proposed change before it is applied</sub></p>
</td>
</tr>
</table>

## Examples

The browser links below load built-in sample documents directly into the web app. Use **Home ▸ Examples** to open a fresh copy on desktop or web; your edits to that copy do not replace the bundled original. Motion examples open in the Motion workspace and start playing. The files are also listed in [`examples/`](examples).

| Sample file | Demo focus | Open in browser |
|---|---|---|
| [Undesign intro](examples/undesign-intro.undesign) | Animated logo and feature labels, arranged on a three-second timeline with 16 eased tracks | [Try the motion demo](https://palcchi.github.io/undesign/?example=undesign-intro) |
| [Daybreak motion study](examples/daybreak-motion-study.undesign) | Weather-screen composition with translucent panels, a sun and forecast animation | [Try the motion demo](https://palcchi.github.io/undesign/?example=daybreak-motion-study) |
| [Ridgeline app](examples/ridgeline-app.undesign) | Component-based mobile screens, light/dark colour variables and Dev Mode notes | [Try the design demo](https://palcchi.github.io/undesign/?example=ridgeline-app) |
| [Ridgeline onboarding](examples/ridgeline-onboarding.undesign) | Linked screens, transitions, back actions and a navigable prototype flow | [Try the prototype demo](https://palcchi.github.io/undesign/?example=ridgeline-onboarding) |
| [Ridgeline design system](examples/ridgeline-design-system.undesign) | Reusable component sets, variants and the Assets panel | [Open sample](https://palcchi.github.io/undesign/?example=ridgeline-design-system) |
| [Ridgeline Studio dashboard](examples/ridgeline-studio-dashboard.undesign) | A 12-column dashboard layout with styles and charts drawn from shapes | [Open sample](https://palcchi.github.io/undesign/?example=ridgeline-studio-dashboard) |
| [Glass and vectors](examples/glass-and-vectors.undesign) | Glass effects, editable boolean shapes and variable-width strokes | [Open sample](https://palcchi.github.io/undesign/?example=glass-and-vectors) |

## Made in Undesign

The compositions below are sample outputs made with Undesign's command API and exported at 2× with its renderer. Their editable source files are in [`examples/`](examples).

<p align="center">
  <img src="docs/images/made-undesign-intro.png" alt="The Undesign intro frame: the green U mark beside the white Undesign wordmark on a near-black background, the line Design, prototype and animate interfaces. Open source, written in Rust., and four outlined chips reading Auto layout, Components, Motion timeline and Dev Mode" width="100%">
  <br><sub><b>Undesign intro</b>: a still from the animated sample's final frame · <code>examples/undesign-intro.undesign</code></sub>
</p>

<table>
<tr>
<td width="33%" valign="top">
  <img src="docs/images/art-app-home.png" alt="Ridgeline home screen in light mode: a greeting, a search field, filter chips, a featured trail card with an illustrated mountain landscape, a list of nearby trails and a translucent tab bar" width="100%">
  <p align="center"><sub><b>Ridgeline home</b>: light theme</sub></p>
</td>
<td width="33%" valign="top">
  <img src="docs/images/art-app-trail.png" alt="Ridgeline trail detail screen: a dusk mountain illustration with glass buttons, a sheet with difficulty tags, the trail name, distance, elevation and duration stats, an elevation profile chart and a Start hike button" width="100%">
  <p align="center"><sub><b>Trail detail</b>: route information and elevation profile</sub></p>
</td>
<td width="33%" valign="top">
  <img src="docs/images/art-app-home-dark.png" alt="The same Ridgeline home screen in dark mode, its colours switched by the Theme variable collection's Dark mode" width="100%">
  <p align="center"><sub><b>Ridgeline home</b>: dark theme via a variable mode</sub></p>
</td>
</tr>
<tr>
<td colspan="3" valign="top">
  <img src="docs/images/art-dashboard.png" alt="Ridgeline Studio dashboard: a dark navy sidebar with navigation, KPI cards for active hikers, check-ins, average rating and open incidents with sparklines, a hikes-per-day grouped bar chart with a tooltip, a difficulty donut chart, a top trails table with condition badges and a visitors area chart" width="100%">
  <p align="center"><sub><b>Ridgeline Studio</b>: a dashboard assembled on a 12-column grid</sub></p>
</td>
</tr>
<tr>
<td colspan="2" valign="top">
  <img src="docs/images/art-glass-weather.png" alt="A glass weather widget over blurred teal, violet, rose and orange colour fields: a frosted card for Lake Louise showing 14 degrees and partly cloudy with a gradient sun behind a boolean-union cloud, an hourly forecast row, and smaller glass cards for air quality, wind and humidity" width="100%">
  <p align="center"><sub><b>Glass weather</b>: layered blur, frosted surfaces and vector shapes</sub></p>
</td>
<td width="33%" valign="top">
  <img src="docs/images/art-vector-marks.png" alt="Three tiles on a cream background: a gradient mountain mark made by unioning two peaks and subtracting a sun, a knot of three excluded rings with an angular gradient, and a tapered gradient wave with a leaf and a glowing four-point star" width="100%">
  <p align="center"><sub><b>Vector marks</b>: boolean operations, gradients and variable-width strokes</sub></p>
</td>
</tr>
<tr>
<td colspan="3" valign="top">
  <img src="docs/images/art-ds-colour.png" alt="Ridgeline UI colour ramps: six swatches each of Pine greens, Sunset oranges and Slate greys, each labelled with its name and hex value" width="100%">
  <p align="center"><sub><b>Ridgeline palette</b>: colour styles shown as reusable swatches</sub></p>
</td>
</tr>
</table>

## Features

The browser demo gives you a guided look at the editor. In the desktop app and web build, the current feature set includes:

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Layout and reusable design</h3>
      Build with auto layout, wrapping and grids; adjust spacing, sizing and constraints on the canvas. Create components and variants, then share local styles and colour, number, string or boolean variables across a file.
    </td>
    <td width="50%" valign="top">
      <h3>Vector, paint and type</h3>
      Draw and edit vector networks, combine editable shapes, and style them with gradients, images, blur, masks and other effects. Text supports mixed formatting, variable fonts, text styles, right-to-left scripts and system fonts.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Prototype and hand off</h3>
      Connect screens with triggers and transitions, use variables in interactions, preview flows, inspect measurements and annotations, and export layers as PNG, JPG, WebP, SVG or PDF. Handoff tools include a ready-for-dev list, change comparison and code views for CSS, HTML, React, Leptos, SwiftUI and Compose.
    </td>
    <td width="50%" valign="top">
      <h3>Motion</h3>
      Arrange position, scale, rotation, opacity and size tracks on a shared timeline. Set keyframes, adjust timing and preview playback on the canvas. This is an early feature slice; a graph editor and video export are not included yet.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Optional AI Agent</h3>
      Connect your own OpenAI-compatible endpoint or Anthropic Messages API; its key stays in memory for the session. The Agent reads the current page and suggests edits, sends no request until you press Send, and applies nothing until you approve the proposal. There is no shared or default provider.
    </td>
    <td width="50%" valign="top">
      <h3>Use your preferred workflow</h3>
      The same commands power the graphical interface, command-line tools, scripts and JSON control channel. Local design work does not require an account or a network connection.
    </td>
  </tr>
</table>

<br>

## Scriptable to the core

Undesign routes interface actions through a shared command registry of 400+ operations. That lets the desktop UI, CLI and JSON control channel work against the same document model.

```sh
# Render a document without opening the editor
undesign-cli render landing.undesign -o landing.png --scale 2
undesign-cli export landing.undesign -o out/ --format svg

# Apply a command script and save the result
undesign-cli run build-card.json --out card.undesign

# Find commands and their parameters
undesign-cli commands --filter autoLayout
```

The desktop build also has a loopback-only control channel for reading UI state, sending pointer or key events, and capturing screenshots. See [`docs/control-protocol.md`](docs/control-protocol.md) and [`docs/cli.md`](docs/cli.md).

## Under the hood

- **Document engine:** a data-focused model and command layer sit beneath a replaceable egui interface; workspace layering is checked by `cargo xtask layers`.
- **Incremental updates:** an immutable ordered map makes undo snapshots inexpensive and limits layout, component sync and text measurement to changed data.
- **Rendering and text:** tiny-skia draws the canvas and exports; geometry, booleans and text use Rust libraries including kurbo, linesweeper, skrifa and HarfRust.
- **Browser build:** the engine and interface compile to WebAssembly.
- **Accessibility:** tools and controls expose names, roles and states to assistive technology; keyboard navigation, reduced-motion preferences and contrast are supported.
- **Localization:** English, Russian and Turkish have native-speaker review; additional language drafts include Indonesian. Translation catalogs are documented in [`docs/translating.md`](docs/translating.md).
- **Plugins:** sandboxed WebAssembly extensions run through the command layer with manifest permissions. The SDK and examples are in [`plugins/`](plugins); see [`docs/plugins.md`](docs/plugins.md).
- **Live collaboration (preview):** invite collaborators to edit a shared file with synchronized changes, cursors and per-person undo. Review the connection and storage details in [`docs/collab-protocol.md`](docs/collab-protocol.md).
- **Clean-room implementation:** the project is based on public documentation and observed behaviour, not copied proprietary source or file formats.

## Get started

Build and test the desktop app with Rust:

```sh
git clone https://github.com/palcchi/undesign
cd undesign
cargo run --release -p undesign            # launch the desktop editor
cargo test --workspace                     # run the test suite
cargo xtask ci                             # formatting, lint, tests and checks
```

The UI and Text tool use fonts from [craft-fonts](https://github.com/storytold/craft-fonts), expected beside this repository at `../craft-fonts`. If they are absent, system fonts are used instead.

```sh
git clone https://github.com/storytold/craft-fonts ../craft-fonts
```

After adding the fonts to an already-built checkout, run `cargo clean -p undesign-text` before rebuilding so they are embedded.

Eight starter templates are generated by the app from synthetic content, including mobile, landing-page, dashboard, design-system, wireframe, announcement, presentation and icon-set starters. The web target can be built with [trunk](https://trunkrs.dev/) and `cargo xtask wasm`.

If you plan to contribute, read [`AGENTS.md`](AGENTS.md) and the material in [`docs/`](docs/) first. Installers for macOS, Windows, Linux, FreeBSD and web builds are attached to each [GitHub release](https://github.com/palcchi/undesign/releases); release steps are in [`docs/releasing.md`](docs/releasing.md).

> [!IMPORTANT]
> **Project status:** Undesign is an early alpha. Core editing workflows are implemented, but the browser links on this page are demonstrations built around sample files, not a guarantee of production readiness. `.fig` import is best-effort; live collaboration is a preview, with no accounts, teams or hosted cloud workspace; and the project has not been validated against real-world design documents. Check the [roadmap](ROADMAP.md), [`docs/parity-checklist.md`](docs/parity-checklist.md) and [`docs/target-app-parity.md`](docs/target-app-parity.md) for the current scope, and expect rough edges.

## Privacy and online sharing

The app can be used offline without an account or telemetry. It makes network requests when you join or share a file. Live collaboration is experimental, so understand the trade-offs before using it for anything sensitive:

- **Online sharing sends the document to a server.** Undesign does not ship its own hosted server; you configure a compatible server in Preferences. The file remains there after a session ends until it is removed with Share ▸ Advanced ▸ Remove from server…
- **Server-side files are not end-to-end encrypted.** TLS protects the connection, but the server stores readable file contents. Use a server you trust, or choose local-network sharing instead.
- **Invite codes grant access.** There are no accounts. Anyone holding an edit code or link can edit; a view code or link allows viewing. Stopping the session revokes access and disconnects others.
- **Local-network sharing avoids a server but is not encrypted.** The host app serves the session directly, so only use it on networks you trust.
- **Keep a separate copy.** The project makes no guarantee against loss; save your own copy before sharing.

---

## License and credits

You may use Undesign under either the [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) license. See [NOTICE](NOTICE) for required notices.

Undesign builds on the open-source FigCraft editor ([brydanforge/figcraft](https://github.com/brydanforge/figcraft), MIT OR Apache-2.0, © 2026 ArtCraft Team and FigCraft contributors). Changes made locally against the imported upstream revision are listed in [`UNDESIGN-CHANGES.md`](UNDESIGN-CHANGES.md).

The inherited UI glyph set is code-drawn and adapted from FigCraft. The U logo and app icon are original project artwork. With project-owner approval, the code also includes monochrome copies of eight common Figma editor toolbar glyphs based on the public Help Center toolbar reference; their licence is unconfirmed, so no CC BY 4.0 claim is made. The screenshot is not included. See [ATTRIBUTION.md](ATTRIBUTION.md) for details. Bundled fonts, images and other assets retain their applicable licences, authors and source notes.

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=palcchi/undesign&type=Date&legend=top-left)](https://www.star-history.com/?repos=palcchi%2Fundesign&type=date&legend=top-left)
