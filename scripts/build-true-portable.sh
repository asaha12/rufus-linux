#!/bin/bash
set -e

echo "=== Building True Portable Self-Contained App for Ubuntu 24.04/26.04+ ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_FILE="$PROJECT_DIR/Rufus-4.15-x86_64.AppImage"
DIST_DIR="$PROJECT_DIR/dist/linux-unpacked"

if [ ! -d "$DIST_DIR" ]; then
    echo "Directory $DIST_DIR does not exist. Building unpacked dir..."
    cd "$PROJECT_DIR"
    npx electron-builder --linux dir --publish never
fi

TEMP_TAR=$(mktemp /tmp/rufus_payload_XXXXXX.tar.gz)

echo "Compressing unpacked application directory..."
cd "$DIST_DIR"
tar -czf "$TEMP_TAR" .

echo "Creating self-extracting single-file portable executable..."

cat << 'HEADER_EOF' > "$OUTPUT_FILE"
#!/bin/bash
# =====================================================================
# Rufus 4.15 for Linux - Zero-Dependency Universal Portable Application
# Runs instantly on any Ubuntu / Debian / Linux desktop (no FUSE required)
# =====================================================================

set -e

APP_VERSION="4.15.0"
CACHE_BASE="${XDG_CACHE_HOME:-$HOME/.cache}/rufus-portable"
APP_DIR="$CACHE_BASE/v$APP_VERSION"

# Self-extraction logic: only unpack once per version
if [ ! -f "$APP_DIR/.ready" ]; then
    mkdir -p "$APP_DIR"
    PAYLOAD_LINE=$(grep --text --line-number '^__RUFUS_PAYLOAD_BEGIN__' "$0" | cut -d: -f1)
    tail -n +$((PAYLOAD_LINE + 1)) "$0" | tar -xzf - -C "$APP_DIR"
    touch "$APP_DIR/.ready"
fi

# Execute application transparently forwarding all command line parameters
exec "$APP_DIR/rufus" --no-sandbox "$@"

__RUFUS_PAYLOAD_BEGIN__
HEADER_EOF

cat "$TEMP_TAR" >> "$OUTPUT_FILE"
chmod +x "$OUTPUT_FILE"
rm -f "$TEMP_TAR"

echo "=== Successfully built True Portable Executable at: $OUTPUT_FILE ==="
ls -lh "$OUTPUT_FILE"
