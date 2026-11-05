# Attribution

Every asset bundled in this repository (images, icons, fonts, data files) is listed here with its
author, source and licence. `cargo xtask assets` fails if a file under `assets/` or
`docs/images/` is missing from this list.

Undesign's inherited user-interface glyphs are drawn in code (`crates/ui-egui/src/icons.rs`) and are
adapted from FigCraft's original icon set, imported at the revision recorded in `NOTICE` and
`UNDESIGN-CHANGES.md`. The inherited glyph artwork remains under MIT OR Apache-2.0, with FigCraft
copyright retained in `LICENSE-MIT` and `NOTICE`. The Undesign `Logo` glyph is original artwork.

For the isolated `figma-editor-2026-11-04` task, the project owner explicitly expanded the earlier
eight-toolbar-glyph approval to the full editor-visible icon set, including Figma-like silhouettes
drawn as monochrome code paths. The public references are Figma's [toolbar article](https://help.figma.com/hc/en-us/articles/360041064174-Access-design-tools-from-the-toolbar),
[UI3 overview](https://www.figma.com/blog/our-approach-to-designing-ui3/),
[left-sidebar guide](https://help.figma.com/hc/en-us/articles/360039831974-Explore-the-navigation-bar-and-left-sidebar),
and [right-sidebar guide](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar).
This is task-scoped owner authorization, not a Figma licence or a general permission for future work.
The [official UI3 Community file listing](https://www.figma.com/community/file/1486123838948777078/ui3-figmas-ui-kit)
has no licence badge. Figma's [Community copyright and licensing guidance](https://help.figma.com/hc/en-us/articles/360042296374-Figma-Community-copyright-and-licensing)
says free Community files are CC BY 4.0; that general statement does not establish that the UI3 file
or Help Center references are covered by that licence. No CC BY 4.0, MIT, or Apache-2.0 claim is made
for Figma-derived glyph shapes; their redistribution status remains unconfirmed. No Figma screenshots,
bundled images, fonts, logos, or private app assets are used. Preserve the inherited FigCraft licence
for unchanged artwork and the original Undesign `Logo` attribution above.

## Assets in this repository

| Path | Author | Source | Licence | Notes |
|---|---|---|---|---|
| `assets/app-icon/` (all files: `undesign.svg`, `undesign-small.svg`, `undesign-*.png`, `undesign.ico`, `hicolor/`) | Undesign contributors | Original work, see [`assets/app-icon/README.md`](assets/app-icon/README.md); derived files rendered by `cargo xtask icon` | MIT OR Apache-2.0, [`assets/app-icon/LICENSE.txt`](assets/app-icon/LICENSE.txt) | Undesign app icon (U mark placeholder) |
| `docs/images/` (the upstream screenshots and exports: `shot-*.png`, `art-*.png`; the Undesign files in the next row excepted) | FigCraft contributors | Included unchanged from the upstream FigCraft revision recorded in `NOTICE`; screenshots and PNG exports of synthetic demo documents | MIT OR Apache-2.0, upstream FigCraft licence | No third-party artwork |
| `docs/images/ui-editor.png`, `docs/images/ui-home.png`, `docs/images/ui-motion.png`, `docs/images/ui-devmode.png`, `docs/images/ui-prototype.png`, `docs/images/ui-agent.png`, `docs/images/made-undesign-intro.png` | Undesign contributors | Original: screenshots of the Undesign app (2026-11-04, Inter from craft-fonts) showing the app and previously bundled synthetic samples, plus a render of `examples/undesign-intro.undesign` | MIT OR Apache-2.0 | The U mark is the Undesign app icon (`assets/app-icon/`); no third-party artwork |
| `docs/images/made-design-critique.png` | Undesign contributors | Original: a render of `examples/design-critique.undesign` (2026-11-05, system fallback fonts; no craft-fonts checkout) | MIT OR Apache-2.0 | Synthetic landing page and review copy; no third-party artwork |
| `docs/images/profile-card-design.png`, `docs/images/profile-card-native-prototype.png` | Undesign contributors | Original renders of the new profile-card example files, exported with the Undesign renderer | MIT OR Apache-2.0 | The supplied reference is not bundled; no third-party artwork |
| `examples/daybreak-motion-study.undesign` | FigCraft contributors | Imported unchanged from upstream `examples/daybreak-motion-study.figcraft` at the revision recorded in `NOTICE`; extension renamed for Undesign | MIT OR Apache-2.0, upstream FigCraft licence | Synthetic document; text uses Inter (OFL, from craft-fonts or the system) |
| `examples/undesign-intro.undesign` | Undesign contributors | Original sample created for this repository | MIT OR Apache-2.0 | Synthetic branding and interface copy; text uses Inter (OFL, from craft-fonts or the system) |
| `examples/profile-card-design.undesign`, `examples/profile-card-prototype.undesign` | Undesign contributors | Original sample files based on a user-supplied profile-card reference; the reference image itself is not included | MIT OR Apache-2.0 | Illustrative profile data and original editable shapes and text; no third-party artwork |

## Fonts (build input, not in this repository)

Release builds embed fonts from the optional craft-fonts build input
([storytold/craft-fonts](https://github.com/storytold/craft-fonts), `CRAFT_FONTS_DIR`). Its own
`ATTRIBUTION.md` and licence files are authoritative; the packages ship each font's licence.

| Family | Licence | Upstream |
|---|---|---|
| Inter | SIL Open Font License 1.1 | https://github.com/rsms/inter |
| Archivo | SIL Open Font License 1.1 | [Google Fonts / Archivo](https://github.com/google/fonts/tree/6c70c829f09ea345d3590406693220ea35c6553f/ofl/archivo) |
| Roboto, Montserrat, Lato, Open Sans, Poppins, Nunito Sans, Merriweather, Playfair Display, Source Sans 3, Source Serif 4, Carlito, Caladea | SIL Open Font License 1.1 | Google Fonts / upstream repositories (see craft-fonts) |
| Liberation Sans, Serif, Mono | SIL Open Font License 1.1 | https://github.com/liberationfonts |
| BIZ UDPGothic, BIZ UDMincho, Shippori Mincho, Noto Sans Arabic | SIL Open Font License 1.1 | Google Fonts (see craft-fonts) |

egui's default fonts (compiled into the `egui`/`epaint` crates) keep their own licences (OFL / Apache-2.0 / Ubuntu Font Licence); see those crates.
