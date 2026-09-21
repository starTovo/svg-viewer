#!/usr/bin/env bash
# ==========================================================================
# Download the APK build toolchain into _local/tools/
#
# Why this exists: the toolchain is ~153MB (android.jar alone is 132MB), which
# is both pointless to keep in git and over GitHub's 100MB per-file hard limit.
# So the whole _local/ folder is gitignored and rebuilt on demand by this
# script. _local/ holds everything local-only: toolchain, test env, screenshots.
#
# Usage (git-bash):
#   cd android && bash setup-tools.sh
#
# Requires: JDK 11+ (javac/keytool), curl, unzip
# ==========================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="$HERE/../../_local/tools"
BIN="$TOOLS/bin"
mkdir -p "$TOOLS" "$BIN"

# Prefer these JDKs if present; otherwise fall back to whatever is on PATH.
for cand in "C:/Program Files/Java/jdk-23" "C:/Program Files/Java/jdk-11.0.6"; do
  if [ -x "$cand/bin/keytool" ]; then JDK="$cand/bin"; break; fi
done
JDK="${JDK:-}"

say() { printf '\n==> %s\n' "$1"; }

download() { # download <url> <dest>
  if [ -s "$2" ]; then printf '    skip (already present): %s\n' "$(basename "$2")"; return; fi
  printf '    fetching %s\n' "$(basename "$2")"
  curl -fL --retry 3 --retry-delay 2 -o "$2.part" "$1"
  mv "$2.part" "$2"
}

# ---------------------------------------------------------------- r8 (D8) ---
say "r8.jar (contains D8)"
download "https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.5.35/r8-8.5.35.jar" \
         "$TOOLS/r8.jar"

# ----------------------------------------------------------------- aapt2 ---
say "aapt2 (Windows)"
download "https://dl.google.com/android/maven2/com/android/tools/build/aapt2/8.6.1-11315950/aapt2-8.6.1-11315950-windows.jar" \
         "$TOOLS/aapt2-win.jar"

# The aapt2 "jar" is really a zip holding aapt2.exe.
if [ ! -x "$BIN/aapt2.exe" ]; then
  tmp="$(mktemp -d)"
  unzip -o -q "$TOOLS/aapt2-win.jar" -d "$tmp"
  found="$(find "$tmp" -name 'aapt2.exe' | head -1)"
  [ -n "$found" ] || { echo "aapt2.exe not found inside the downloaded archive" >&2; exit 1; }
  cp "$found" "$BIN/aapt2.exe"
  rm -rf "$tmp"
  printf '    extracted -> %s\n' "$BIN/aapt2.exe"
fi

# ------------------------------------------------- uber-apk-signer ---
say "uber-apk-signer"
download "https://github.com/patrickfav/uber-apk-signer/releases/download/v1.3.0/uber-apk-signer-1.3.0.jar" \
         "$TOOLS/uber-apk-signer.jar"

# ------------------------------------------------------------ android.jar ---
# The official Sable/android-platforms host has been unreliable (connection
# resets / 403), so we use Robolectric's android-all jar: it bundles the
# framework resources aapt2 needs, and works with javac + d8 too.
say "android.jar (Robolectric android-all, API 34) — ~132MB, be patient"
download "https://repo1.maven.org/maven2/org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar" \
         "$TOOLS/android.jar"

# ------------------------------------------------------------- keystore ---
# NOT in git. Losing it means you can never push an in-place update to users
# who already installed the app (Android refuses to overwrite a package signed
# with a different key). Back it up somewhere safe.
say "signing keystore"
# The store password lives in _local/tools/keystore.properties (never in git).
# If neither that file nor $SVGVIEW_KS_PASS supplies one, generate a random one.
KS_PROPS="$TOOLS/keystore.properties"
KS_PASS="${SVGVIEW_KS_PASS:-}"
if [ -z "$KS_PASS" ] && [ -f "$KS_PROPS" ]; then
  KS_PASS="$(sed -n 's/^storePassword=//p' "$KS_PROPS" | head -1)"
fi
if [ -z "$KS_PASS" ]; then
  KS_PASS="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 28)"
fi
if [ ! -f "$KS_PROPS" ]; then
  printf 'storePassword=%s\nkeyPassword=%s\nkeyAlias=svgview\n' "$KS_PASS" "$KS_PASS" > "$KS_PROPS"
  printf '    wrote signing password -> %s\n' "$KS_PROPS"
fi
if [ -s "$TOOLS/svgview.keystore" ]; then
  printf '    skip (already present)\n'
else
  keytool_bin="${JDK:+$JDK/keytool}"
  keytool_bin="${keytool_bin:-keytool}"
  "$keytool_bin" -genkeypair \
    -keystore "$TOOLS/svgview.keystore" \
    -alias svgview \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=SVG Viewer, OU=Dev, O=SVGViewer, L=Unknown, ST=Unknown, C=CN"
  printf '    created %s (alias=svgview)\n' "$TOOLS/svgview.keystore"
  printf '    >> BACK THIS FILE UP. Losing it breaks future in-place updates.\n'
  printf '    >> Also back up %s.\n' "$KS_PROPS"
fi

# --------------------------------------------------------------- verify ---
say "verify"
if command -v cygpath >/dev/null 2>&1; then
  A2="$(cygpath -m "$BIN/aapt2.exe")"
else
  A2="$BIN/aapt2.exe"
fi
"$A2" version
"${JDK:+$JDK/java}java" -cp "$TOOLS/r8.jar" com.android.tools.r8.D8 --version 2>/dev/null || true

say "done — now run: bash build.sh"
