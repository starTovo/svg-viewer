#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# SVG 查看器 —— 无 Android SDK 的 APK 构建脚本
#
# 所需的工具链（无需 Android SDK / Gradle），统称 <工具链目录>：
#   <工具链目录>/android.jar          API 34 编译桩（Robolectric android-all 14）
#   <工具链目录>/r8.jar               内含 D8，用于 class -> dex
#   <工具链目录>/bin/aapt2.exe        资源编译与链接
#   <工具链目录>/uber-apk-signer.jar  对齐 + 签名
#   <工具链目录>/svgview.keystore     自建签名库
#   <工具链目录>/keystore.properties  签名口令（不在本文件中，此仓库公开）
#
# 工具链目录按下面的顺序解析，取第一个存在的（详见 "工具链目录解析" 一节）：
#   1) $SVGVIEW_TOOLS                显式覆盖
#   2) <本脚本>/../../_local/tools   out-of-repo layout（把工具链放在仓库之外）
#   3) <本脚本>/../_local/tools      仓库同级的 _local
#   4) <本脚本>/.tools               新克隆的默认落点（由 setup-tools.sh 创建）
# 都找不到时，提示先运行：bash setup-tools.sh
# 工具链不入库（约 153MB），缺失时运行：bash setup-tools.sh
#
# 用法：在 git-bash 中执行  bash build.sh
# 产物：out/svgview-aligned-signed.apk
#
# 关键约束：
#   * aapt2.exe / javac / java 均为 Windows 原生程序，只认 盘符:/... 形式的路径，
#     因此所有传给它们的路径都必须经 cygpath -m 转换。
#   * aapt2.exe 必须在自身所在目录执行（Windows 会搜索父进程 cwd）。
#   * javac 必须 --release 11，否则 d8 无法解析 JDK 23 字节码。
#   * d8 输入必须是带完整包路径的 class 文件。
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# POSIX -> Windows（前向斜杠）路径转换，供原生 Windows 工具使用
wp() { cygpath -m "$1"; }

JDK="C:/Program Files/Java/jdk-23/bin"
JAVA="$JDK/java"
JAVAC="$JDK/javac"

# ---------------------------------------------------------------------------
# 工具链目录解析：按顺序取第一个存在的候选
#   1) $SVGVIEW_TOOLS   2) <脚本>/../../_local/tools   3) <脚本>/../_local/tools   4) <脚本>/.tools
resolve_tools() {
  for cand in "${SVGVIEW_TOOLS:-}" \
              "$ROOT/../../_local/tools" \
              "$ROOT/../_local/tools" \
              "$ROOT/.tools"; do
    if [ -n "$cand" ] && [ -d "$cand" ]; then
      printf '%s\n' "$cand"
      return 0
    fi
  done
  return 1
}

if ! TOOLS="$(resolve_tools)"; then
  printf 'error: build toolchain not found.\n' >&2
  printf '  run setup-tools.sh first (it downloads the toolchain into .tools/),\n' >&2
  printf '  or point $SVGVIEW_TOOLS at an existing toolchain directory.\n' >&2
  exit 1
fi
printf 'toolchain: %s\n' "$TOOLS"

ANDROID_JAR="$(wp "$TOOLS/android.jar")"
R8_JAR="$(wp "$TOOLS/r8.jar")"
AAPT2="$(wp "$TOOLS/bin/aapt2.exe")"
SIGNER="$(wp "$TOOLS/uber-apk-signer.jar")"

KS="$(wp "$TOOLS/svgview.keystore")"
KS_ALIAS="svgview"

# Signing credentials are NEVER hardcoded here -- this repo is public.
# Resolution order: $SVGVIEW_KS_PASS  ->  <工具链目录>/keystore.properties
KS_PROPS="$TOOLS/keystore.properties"
KS_PASS="${SVGVIEW_KS_PASS:-}"
if [ -z "$KS_PASS" ] && [ -f "$KS_PROPS" ]; then
  KS_PASS="$(sed -n 's/^storePassword=//p' "$KS_PROPS" | head -1)"
fi
if [ -z "$KS_PASS" ]; then
  printf 'error: keystore password not found.\n' >&2
  printf '  export SVGVIEW_KS_PASS=<pass>\n' >&2
  printf '  or create %s containing: storePassword=<pass>\n' "$KS_PROPS" >&2
  exit 1
fi

# 沙箱内 %LOCALAPPDATA% / ~/.uber-apk-signer 不可写，统一重定向
HOME_DIR="$(wp "$ROOT/.home")"
mkdir -p "$HOME_DIR"

SRC_RES="$(wp "$ROOT/src/res")"
SRC_ASSETS="$(wp "$ROOT/src/assets")"
SRC_JAVA="$ROOT/src/java"
MANIFEST="$(wp "$ROOT/src/AndroidManifest.xml")"
GEN="$ROOT/gen"
BUILD="$ROOT/build"
OUT="$ROOT/out"

# Single source of truth for the UI lives at repo-root app/index.html.
# src/assets/index.html is a build input only -- it is gitignored and always
# refreshed here, so the two can never drift apart.
APP_HTML="$(wp "$ROOT/../app/index.html")"
if [ -f "$APP_HTML" ]; then
  mkdir -p "$SRC_ASSETS"
  cp "$APP_HTML" "$SRC_ASSETS/index.html"
else
  printf 'warning: %s not found, using existing src/assets/index.html\n' "$APP_HTML" >&2
fi

log() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
log "0/5 清理中间产物"
rm -rf "$BUILD" "$GEN" "$OUT"
mkdir -p "$BUILD" "$GEN" "$OUT"
rm -f "$ROOT/unsigned.apk" "$ROOT/svgview.apk"

# ---------------------------------------------------------------------------
log "1/5 aapt2 编译资源并生成 R.java"
# aapt2.exe 在 Windows 下会搜索父进程 cwd，必须在它所在目录执行
pushd "$TOOLS/bin" >/dev/null
"$AAPT2" compile --dir "$SRC_RES" -o "$(wp "$BUILD/res.zip")"
"$AAPT2" link "$(wp "$BUILD/res.zip")" \
    -I "$ANDROID_JAR" \
    --java "$(wp "$GEN")" \
    --manifest "$MANIFEST" \
    -A "$SRC_ASSETS" \
    -o "$(wp "$BUILD/linked.apk")" \
    --auto-add-overlay \
    --min-sdk-version 26 \
    --target-sdk-version 34
popd >/dev/null
echo "R.java -> $(find "$GEN" -name 'R.java' | head -1)"

# ---------------------------------------------------------------------------
log "2/5 javac 编译 Java 源码（--release 11）"
# 不用 -sourcepath，直接列出全部 .java（argfile 内统一用 盘符:/ 前向斜杠路径）
find "$SRC_JAVA" "$GEN" -name '*.java' | while read -r f; do wp "$f"; done > "$BUILD/sources.txt"
echo "源文件数：$(wc -l < "$BUILD/sources.txt")"
cat "$BUILD/sources.txt" | sed 's|^|  |'
"$JAVAC" --release 11 -nowarn -encoding UTF-8 \
    -classpath "$ANDROID_JAR" \
    -d "$(wp "$BUILD/obj")" \
    @"$(wp "$BUILD/sources.txt")"
echo "生成 class："
find "$BUILD/obj" -name '*.class' | sed 's|^|  |'

# ---------------------------------------------------------------------------
log "3/5 d8 转换 dex（min-api 26）"
# d8 需要带完整包路径的 class 文件，因此以 build/ 为 cwd 使用相对路径
pushd "$BUILD" >/dev/null
CLASS_FILES="$(find obj -name '*.class' | tr '\n' ' ')"
echo "输入：$CLASS_FILES"
"$JAVA" -Duser.home="$HOME_DIR" -cp "$R8_JAR" \
    com.android.tools.r8.D8 \
    --lib "$ANDROID_JAR" \
    --min-api 26 \
    --output "$(wp "$BUILD")" \
    $CLASS_FILES
popd >/dev/null
ls -la "$BUILD/classes.dex"

# ---------------------------------------------------------------------------
log "4/5 合并 dex 进 APK"
cp "$BUILD/linked.apk" "$BUILD/svgview.apk"
pushd "$BUILD" >/dev/null
"$JDK/jar" uf "$(wp "$BUILD/svgview.apk")" classes.dex
popd >/dev/null
echo "APK 结构："
unzip -l "$BUILD/svgview.apk"

# ---------------------------------------------------------------------------
log "5/5 对齐 + 签名"
"$JAVA" -Duser.home="$HOME_DIR" -Djava.io.tmpdir="$HOME_DIR" -jar "$SIGNER" \
    -a "$(wp "$BUILD/svgview.apk")" \
    --ks "$KS" \
    --ksAlias "$KS_ALIAS" \
    --ksPass "$KS_PASS" \
    --ksKeyPass "$KS_PASS" \
    --allowResign \
    -o "$(wp "$OUT")" 2>&1 | grep -E '^(I:|E:|W:|Exception|Caused|error)|[Ss]igned' || true

# ---------------------------------------------------------------------------
log "6/6 验证产物"
APK="$(ls -1 "$OUT"/*.apk 2>/dev/null | head -1)"
echo "产物：$APK"
echo "大小：$(stat -c%s "$APK") 字节"

echo "--- aapt2 dump badging ---"
pushd "$TOOLS/bin" >/dev/null
"$AAPT2" dump badging "$(wp "$APK")" 2>&1 | grep -E "^package|[Ss]dkVersion|application-label|launchable-activity|uses-permission" || true
popd >/dev/null

echo "--- 签名校验 ---"
# keytool 是 Windows 原生程序，jarfile 路径同样必须经 cygpath -m 转换
"$JDK/keytool" -J-Duser.home="$HOME_DIR" -printcert -jarfile "$(wp "$APK")" 2>&1 \
    | grep -a -A1 "SHA256" | head -4 || true

echo "--- dex 桥接字符串（应含 SvgApp / saveSvg / SvgViewBridge）---"
TMPDEX="$BUILD/dexchk"
rm -rf "$TMPDEX" && mkdir -p "$TMPDEX"
unzip -o -q "$APK" classes.dex -d "$TMPDEX"
grep -a -o -E 'SvgApp|saveSvg|onBackPressed|setStatusBarHeight|SvgViewBridge|SvgViewNative|Android' \
    "$TMPDEX/classes.dex" | sort | uniq -c | sort -rn || true

# ---------------------------------------------------------------------------
log "构建完成 -> $OUT"
ls -la "$OUT"
