# Attribution

Every asset bundled in this repository (images, icons, fonts, data files) is listed here with its
author, source and licence. `cargo xtask assets` fails if a file under `assets/` or
`docs/images/` is missing from this list.

Undesign's inherited user-interface glyphs are drawn in code (`crates/ui-egui/src/icons.rs`) and are
adapted from FigCraft's original icon set, imported at the revision recorded in `NOTICE` and
`UNDESIGN-CHANGES.md`. The inherited glyph artwork remains under MIT OR Apache-2.0, with FigCraft
copyright retained in `LICENSE-MIT` and `NOTICE`. The Undesign `Logo` glyph is original artwork.

The project owner has explicitly approved a narrow, code-only exception for monochrome copies of
these common Figma editor toolbar glyphs: Move, Frame, Rectangle, Pen, Text, Comment, Actions/sparkle,
and Dev Mode/Code. The visual reference is the toolbar shown in Figma's public
[Help Center article](https://help.figma.com/hc/en-us/articles/360041064174-Access-design-tools-from-the-toolbar).
The [official UI3 Community file listing](https://www.figma.com/community/file/1486123838948777078/ui3-figmas-ui-kit)
is noted as related public context, but it does not show a licence badge. Figma's
[Community copyright and licensing guidance](https://help.figma.com/hc/en-us/articles/360042296374-Figma-Community-copyright-and-licensing)
says free Community files are CC BY 4.0; that general statement does not establish that this UI3 file
or the Help Center screenshot is covered by that licence. Neither the listing nor the screenshot/article
states a redistribution licence for the referenced glyphs, so no CC BY 4.0 claim is made for them and
their source/licence status remains unconfirmed. The local reference screenshot is not bundled or used
as an image asset. This exception records the owner's authorization for the specified glyphs; it is
not a determination of third-party licensing. No other third-party iconography is permitted.

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
