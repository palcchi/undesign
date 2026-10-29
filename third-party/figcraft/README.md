# FigCraft (upstream engine crates)

- Upstream: <https://github.com/brydanforge/figcraft>
- Revision used: `92682728e9d6a3a97ea25a99395be7a34a8db993`
- License: MIT OR Apache-2.0, at Undesign's option (texts: `LICENSE-MIT`,
  `LICENSE-APACHE`; upstream notice: `NOTICE`).
- Copyright: (c) 2026 ArtCraft Team and the FigCraft contributors.

## What is reused

The `undesign-wasm` crate (`rust/`) depends on the upstream
`figcraft-engine`, `figcraft-doc`, `figcraft-svg`, and `figcraft-geom` crates **unmodified**
via pinned Cargo git dependencies (see `rust/Cargo.toml` and `rust/Cargo.lock`).
No upstream source files are vendored or patched; all integration code in
`rust/src/` is original Undesign work.

## Modifications to upstream code

None. If a future change patches or vendors upstream files, the modification
must be recorded here with the file list and a description.

## Brand and separate-license material

NOT reused: the ArtCraft trademarks in upstream `docs/brand/` (not open
source), the optional craft-fonts build input (OFL), and any other
separately licensed assets. The WASM build compiles Rust code only.
