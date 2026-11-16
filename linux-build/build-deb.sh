#!/usr/bin/env bash
# Build the DeepSeek Harness Linux desktop package (.deb) from ./app.
# Produces linux-build/deepseek-harness_<version>_amd64.deb
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/app"
STAGE="$HERE/deb-stage"
OUT="$HERE/deepseek-harness_0.1.0_amd64.deb"
VERSION="0.1.0"

if [ ! -x "$SRC/deepseek-harness" ]; then
  echo "error: $SRC/deepseek-harness is missing" >&2
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/DEBIAN" "$STAGE/opt" "$STAGE/usr/bin" "$STAGE/usr/share/applications" "$STAGE/usr/share/icons/hicolor"

echo "Staging application files (hard links) ..."
# Hard links keep a 1.2 GB tree from being duplicated; dpkg reads them as-is.
cp -al "$SRC" "$STAGE/opt/deepseek-harness"

echo "Staging launcher ..."
cat > "$STAGE/usr/bin/deepseek-harness" <<'EOF'
#!/bin/sh
export ELECTRON_FORCE_IS_PACKAGED=1
# Local servers need no account, but the client refuses a route with no key
# reference at all, so these refs default to a placeholder that local OpenAI-
# compatible endpoints ignore. Export the real value (or type it on the Models
# page) when a local server does require a key.
export LMSTUDIO_API_KEY="${LMSTUDIO_API_KEY:-local}"
export OLLAMA_API_KEY="${OLLAMA_API_KEY:-local}"
APPDIR=/opt/deepseek-harness
# Discover local model servers and keyless search before the shell reads its
# profile. Silent and non-fatal: a failure leaves the previous profile intact.
if [ -f "$APPDIR/resources/app/bin/local-providers.mjs" ]; then
  ELECTRON_RUN_AS_NODE=1 "$APPDIR/deepseek-harness" "$APPDIR/resources/app/bin/local-providers.mjs" >/dev/null 2>&1 || true
fi
exec "$APPDIR/deepseek-harness" --no-sandbox --class=deepseek-harness "$@"
EOF
chmod 755 "$STAGE/usr/bin/deepseek-harness"

echo "Staging desktop entry ..."
cat > "$STAGE/usr/share/applications/deepseek-harness.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Version=1.0
Name=DeepSeek Harness
Comment=DeepSeek Harness desktop
Exec=/usr/bin/deepseek-harness %U
Icon=deepseek-harness
Terminal=false
Categories=Development;
StartupWMClass=deepseek-harness
StartupNotify=true
EOF

echo "Staging icons ..."
PY="$SRC/resources/runtime/primary-runtime/dependencies/python/bin/python3"
for size in 16 24 32 48 64 128 256 512; do
  mkdir -p "$STAGE/usr/share/icons/hicolor/${size}x${size}/apps"
  "$PY" - "$SRC/resources/icon.png" "$STAGE/usr/share/icons/hicolor/${size}x${size}/apps/deepseek-harness.png" "$size" <<'PY'
import sys
from PIL import Image
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
Image.open(src).convert("RGBA").resize((size, size), Image.LANCZOS).save(dst)
PY
done

echo "Writing control files ..."
INSTALLED_KB="$(du -sk "$STAGE" | cut -f1)"
cat > "$STAGE/DEBIAN/control" <<EOF
Package: deepseek-harness
Version: $VERSION
Section: devel
Priority: optional
Architecture: amd64
Maintainer: DeepSeek Harness Linux rebuild <local@localhost>
Installed-Size: $INSTALLED_KB
Depends: libgtk-3-0, libnss3, libnspr4, libglib2.0-0, libdbus-1-3, libatk-bridge2.0-0 | libatk-bridge2.0-0t64, libatspi2.0-0 | libatspi2.0-0t64, libcups2 | libcups2t64, libdrm2, libgbm1, libxkbcommon0, libx11-6, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxrandr2, libpango-1.0-0, libcairo2, libgdk-pixbuf-2.0-0, libasound2 | libasound2t64, hicolor-icon-theme, xdg-utils
Description: DeepSeek Harness desktop application (Linux)
 Native Linux build of the DeepSeek Harness desktop app: an agent workbench
 with local model support (Ollama, LM Studio, or any OpenAI-compatible
 endpoint), keyless web search, and fully local voice input. Providers
 are configured with your own API keys; no account is required.
EOF

cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
case "$1" in
  configure)
    # Standard Electron SUID helper; the launcher also passes --no-sandbox so a
    # nosuid mount cannot stop the app from starting.
    if [ -f /opt/deepseek-harness/chrome-sandbox ]; then
      chmod 4755 /opt/deepseek-harness/chrome-sandbox || true
    fi
    if command -v update-desktop-database >/dev/null 2>&1; then
      update-desktop-database -q /usr/share/applications || true
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
      gtk-update-icon-cache -q -f /usr/share/icons/hicolor || true
    fi
    ;;
esac
exit 0
EOF

cat > "$STAGE/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
case "$1" in
  remove|purge)
    if command -v update-desktop-database >/dev/null 2>&1; then
      update-desktop-database -q /usr/share/applications || true
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
      gtk-update-icon-cache -q -f /usr/share/icons/hicolor || true
    fi
    ;;
esac
# Keep ~/.dsh and ~/.config/DeepSeek Harness: they hold the user's models,
# sessions, and settings.
exit 0
EOF

chmod 755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/postrm"

echo "Building package (xz) ..."
fakeroot dpkg-deb --build --root-owner-group -Zxz "$STAGE" "$OUT" >/dev/null

ls -lh "$OUT"
echo "Built: $OUT"
