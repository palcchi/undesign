# Undesign app icon

A **placeholder U mark**: a bold white U with round caps on the Undesign green
(`#02da96`) tile. Original work drawn for Undesign (see `LICENSE.txt`); a final
brand mark can replace it later.

## Palette

Exactly two colours:

| Colour | Hex | Used for |
|---|---|---|
| Undesign green (app colour) | `#02da96` | the full-bleed field |
| White | `#ffffff` | the U |

## Geometry

A 512-unit tile (`viewBox="0 0 512 512"`), rounded square with `rx=112`, no border. The U
is one stroked path: two stems (`x=160` and `x=352`, from `y=140` to `y=300`) joined by a
smooth cubic bottom (lowest `y=372`), stroke width 76, round caps and joins. The macOS
renders pad it onto Apple's 824/1024 icon grid; Windows and Linux use the tile edge to edge,
with its rounded corners.

## Files

- `undesign.svg`: canonical master.
- `undesign-small.svg`: lighter trace (same shapes, fewer digits); also the hicolor scalable icon.
- `undesign-<size>.png` (16–1024): renders on the macOS grid; `packaging/macos/package.sh` builds
  the `.icns` from them.
- `undesign.ico`: Windows icon, 16–256 px, embedded in the `.exe` by `apps/undesign/build.rs`.
- `hicolor/<size>/apps/io.github.palcchi.undesign.png` (16–512) and `hicolor/scalable/...svg`:
  Linux icon theme; the 256 px one is also the runtime window icon off macOS.

## Regenerate

Replace `undesign.svg` (and `undesign-small.svg`), then run `cargo xtask icon`. It needs `resvg`
(`cargo install resvg`).
