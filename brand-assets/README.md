# Undesign brand + icon direction — draft 01

This is an isolated review draft. Nothing in `/workspace/undesign` or any web/showcase/packaging source was changed.

## Direction

**Open canvas, open path.** The mark is two opposing, rounded open contours: a small, ownable symbol for layered work surfaces and editable paths. The wordmark is lowercase and quiet. The app tile is graphite with a white mark; the brand mark and all default icons remain neutral.

**Color rule:** blue `#315BFF` is the only accent. Use it only for selected, active, and keyboard-focus states. The neutral set is graphite `#20242B`, fog `#F5F6F8`, paper `#FFFFFF`, muted gray `#747B85`, and divider `#E2E5EA`. No green, gradients, or extra accent hues.

**Icon rule:** one 24×24 optical grid, 1.7px strokes, round caps/joins, normalized breathing room, SVG `currentColor`. Keep line icons neutral by default; CSS owns state color. Similar toolbar/action roles share artwork only when they mean the same thing; other roles have their own glyph.

## Preview and files

Open `preview.html` directly in a browser. It includes the identity, state examples, and a searchable/filterable grid for all 170 currently registered `Icon::` roles. `icon-map.json` records role-to-asset and role-to-glyph mappings. Every role has its own SVG file under `icons/`; the eight intentional aliases are recorded in the JSON. The generation source is `build_assets.py` and the inline preview data is in `glyph-bodies.json`.

Logo exports in `logo/`:

- `undesign-mark.svg` — neutral adaptable mark
- `undesign-wordmark.svg` — mark + lowercase wordmark
- `app-icon.svg` — graphite tile, white mark
- `favicon.svg` — neutral favicon mark

## Review boundary

This is a draft for visual review, not an integration patch. It maps the complete registered editor icon role set from the read-only audit of `crates/ui-egui/src/icons.rs`. App shell, web favicon, and showcase usage should be integrated only after the identity is reviewed and the in-progress Motion work is clear.
