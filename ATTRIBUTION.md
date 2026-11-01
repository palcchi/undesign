# Attribution

Every asset bundled in this repository (images, icons, fonts, data files) is listed here with its
author, source and licence. `cargo xtask assets` fails if a file under `assets/` or
`docs/images/` is missing from this list.

Undesign's user-interface glyphs are drawn in code (`crates/ui-egui/src/icons.rs`) and are
adapted from FigCraft's original icon set, imported at the revision recorded in `NOTICE` and
`UNDESIGN-CHANGES.md`. The inherited glyph artwork remains under MIT OR Apache-2.0, with FigCraft
copyright retained in `LICENSE-MIT` and `NOTICE`. The Undesign `Logo` glyph is original artwork.
No third-party icon sets are used.

## Assets in this repository

| Path | Author | Source | Licence | Notes |
|---|---|---|---|---|
| `assets/app-icon/` (all files: `undesign.svg`, `undesign-small.svg`, `undesign-*.png`, `undesign.ico`, `hicolor/`) | Undesign contributors | Original work, see [`assets/app-icon/README.md`](assets/app-icon/README.md); derived files rendered by `cargo xtask icon` | MIT OR Apache-2.0, [`assets/app-icon/LICENSE.txt`](assets/app-icon/LICENSE.txt) | Undesign app icon (U mark placeholder) |
| `docs/images/` (all screenshots and exports: `shot-*.png`, `art-*.png`) | FigCraft contributors | Included unchanged from the upstream FigCraft revision recorded in `NOTICE`; screenshots and PNG exports of synthetic demo documents | MIT OR Apache-2.0, upstream FigCraft licence | No third-party artwork |
| `examples/*.undesign` | FigCraft contributors | Imported unchanged from upstream `examples/*.figcraft` at the revision recorded in `NOTICE`; extension renamed for Undesign | MIT OR Apache-2.0, upstream FigCraft licence | Synthetic documents; text uses Inter (OFL, from craft-fonts or the system) |

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
