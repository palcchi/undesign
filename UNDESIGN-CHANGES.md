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
