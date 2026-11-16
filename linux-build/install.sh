#!/usr/bin/env bash
# Install the rebuilt DeepSeek Harness desktop app for the current Linux user.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/app"
PREFIX="${PREFIX:-$HOME/.local}"
APPDIR="$PREFIX/share/deepseek-harness"
LAUNCHER="$PREFIX/bin/deepseek-harness"
DESKTOP="$PREFIX/share/applications/deepseek-harness.desktop"
ICONROOT="$PREFIX/share/icons/hicolor"

if [ ! -x "$SRC/deepseek-harness" ]; then
  echo "error: $SRC/deepseek-harness is missing" >&2
  exit 1
fi

mkdir -p "$PREFIX/bin" "$PREFIX/share/applications" "$ICONROOT"

echo "Installing application files to $APPDIR ..."
rm -rf "$APPDIR"
cp -a "$SRC" "$APPDIR"

echo "Creating launcher $LAUNCHER ..."
cat > "$LAUNCHER" <<EOF
#!/bin/sh
export ELECTRON_FORCE_IS_PACKAGED=1
# Local servers need no account, but the client refuses a route with no key
# reference at all, so these refs default to a placeholder that local OpenAI-
# compatible endpoints ignore. Export the real value (or type it on the Models
# page) when a local server does require a key.
export LMSTUDIO_API_KEY="\${LMSTUDIO_API_KEY:-local}"
export OLLAMA_API_KEY="\${OLLAMA_API_KEY:-local}"
# Discover local model servers and keyless search before the shell reads its
# profile. Silent and non-fatal: a failure leaves the previous profile intact.
if [ -f "$APPDIR/resources/app/bin/local-providers.mjs" ]; then
  ELECTRON_RUN_AS_NODE=1 "$APPDIR/deepseek-harness" "$APPDIR/resources/app/bin/local-providers.mjs" >/dev/null 2>&1 || true
fi
exec "$APPDIR/deepseek-harness" --no-sandbox --class=deepseek-harness "\$@"
EOF
chmod 755 "$LAUNCHER"

echo "Installing icons ..."
PY="$APPDIR/resources/runtime/primary-runtime/dependencies/python/bin/python3"
for size in 16 24 32 48 64 128 256 512; do
  mkdir -p "$ICONROOT/${size}x${size}/apps"
  "$PY" - "$APPDIR/resources/icon.png" "$ICONROOT/${size}x${size}/apps/deepseek-harness.png" "$size" <<'PY'
import sys
from PIL import Image
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
Image.open(src).convert("RGBA").resize((size, size), Image.LANCZOS).save(dst)
PY
done

echo "Writing desktop entry $DESKTOP ..."
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=DeepSeek Harness
Comment=DeepSeek Harness desktop
Exec=$LAUNCHER %U
Icon=deepseek-harness
Terminal=false
Categories=Development;
StartupWMClass=deepseek-harness
StartupNotify=true
EOF

update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
gtk-update-icon-cache -f "$ICONROOT" >/dev/null 2>&1 || true

echo "Installed."
echo "  Application: $APPDIR"
echo "  Launcher:    $LAUNCHER"
echo "  Menu entry:  $DESKTOP"
