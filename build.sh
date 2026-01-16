#!/usr/bin/env bash
# Packages the extension into a Chrome Web Store-ready zip with only required files.

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT_DIR="${ROOT_DIR}/dist"
ZIP_NAME="recharge.zip"
STAGE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/recharge-build.XXXXXX")

trap 'rm -rf "$STAGE_DIR"' EXIT

INCLUDE_FILES=(
  manifest.json
  background.js
  popup.js
  popup.html
  popup.css
  constants.js
  offscreen.html
  offscreen.js
  README.md
  icons
)

for item in "${INCLUDE_FILES[@]}"; do
  cp -R "${ROOT_DIR}/${item}" "$STAGE_DIR/"
done

mkdir -p "$OUT_DIR"
(
  cd "$STAGE_DIR"
  zip -r -q "${OUT_DIR}/${ZIP_NAME}" .
)

echo "Created ${OUT_DIR}/${ZIP_NAME}"
