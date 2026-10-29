#!/usr/bin/env bash
# Build the undesign-wasm package (Rust -> WebAssembly via wasm-pack).
# Output: src/wasm/pkg/ (generated, git-ignored). Requires: cargo, wasm-pack,
# and the wasm32-unknown-unknown target. Fails loudly when the toolchain is
# missing so a build never silently ships without the engine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

missing=()
command -v cargo >/dev/null 2>&1 || missing+=("cargo (https://rustup.rs)")
command -v wasm-pack >/dev/null 2>&1 || missing+=("wasm-pack (https://rustwasm.github.io/wasm-pack/installer/)")
if ((${#missing[@]} > 0)); then
  echo "error: missing WASM toolchain components:" >&2
  for m in "${missing[@]}"; do echo "  - $m" >&2; done
  echo "Install them, then re-run: npm run build:wasm" >&2
  exit 1
fi

if ! rustup target list --installed 2>/dev/null | grep -q "wasm32-unknown-unknown"; then
  echo "error: the wasm32-unknown-unknown target is not installed." >&2
  echo "Install it with: rustup target add wasm32-unknown-unknown" >&2
  exit 1
fi

mkdir -p src/wasm/pkg
wasm-pack build rust --target web --out-dir ../src/wasm/pkg --out-name undesign_wasm

# Optional size optimization (wasm-pack's own download is disabled in
# Cargo.toml because it needs direct network access). When wasm-opt is on
# PATH, shrink the module in place; otherwise keep working output.
WASM="src/wasm/pkg/undesign_wasm_bg.wasm"
if command -v wasm-opt >/dev/null 2>&1; then
  echo "Optimizing $WASM with wasm-opt…"
  wasm-opt -O3 "$WASM" -o "$WASM.opt" && mv "$WASM.opt" "$WASM"
else
  echo "note: wasm-opt not on PATH; shipping unoptimized output." >&2
fi
echo "WASM engine built to src/wasm/pkg/"
