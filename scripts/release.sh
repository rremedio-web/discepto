#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE=""
OUTPUT_DIR=""
DENYLIST=""

usage() {
  echo "usage: release.sh --structural-only OUTPUT_DIR" >&2
  echo "       release.sh --private-denylist ABS_PATH OUTPUT_DIR" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --structural-only)
      MODE="structural-only"
      OUTPUT_DIR="${2:-}"
      shift 2
      ;;
    --private-denylist)
      MODE="private-denylist"
      DENYLIST="${2:-}"
      OUTPUT_DIR="${3:-}"
      shift 3
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$MODE" && -n "$OUTPUT_DIR" ]] || usage
[[ -e "$OUTPUT_DIR" ]] && { echo "output dir must not exist: $OUTPUT_DIR" >&2; exit 1; }

GIT_BIN="$(command -v git || true)"
[[ -n "$GIT_BIN" && -x "$GIT_BIN" ]] || { echo "git not found" >&2; exit 1; }
GIT_BIN="$(cd "$(dirname "$GIT_BIN")" && pwd -P)/$(basename "$GIT_BIN")"

GIT_ENV_PATH="$(dirname "$GIT_BIN"):/usr/bin:/bin"
GIT_HARDEN_FLAGS=(--no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false)

git_hardened() {
  env -i \
    PATH="$GIT_ENV_PATH" \
    LC_ALL=C \
    LANG=C \
    TZ=UTC \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_ATTR_NOSYSTEM=1 \
    GIT_OPTIONAL_LOCKS=0 \
    "$GIT_BIN" "${GIT_HARDEN_FLAGS[@]}" "$@"
}

if [[ -n "$(git_hardened status --porcelain=v1 -uall)" ]]; then
  echo "worktree must be clean" >&2
  exit 1
fi

HEAD_SHA="$(git_hardened rev-parse HEAD)"
TREE_SHA="$(git_hardened rev-parse HEAD^{tree})"

TMP_BASE="$(mktemp -d "${TMPDIR:-/tmp}/discepto-release.XXXXXX")"
cleanup() { rm -rf "$TMP_BASE"; }
trap cleanup EXIT

ZIP_A="$TMP_BASE/archive-a.zip"
ZIP_B="$TMP_BASE/archive-b.zip"

git_hardened archive --format=zip --prefix=discepto/ -o "$ZIP_A" HEAD
git_hardened archive --format=zip --prefix=discepto/ -o "$ZIP_B" HEAD

HASH_A="$(openssl dgst -sha256 -r "$ZIP_A" | awk '{print $1}')"
HASH_B="$(openssl dgst -sha256 -r "$ZIP_B" | awk '{print $1}')"
[[ "$HASH_A" == "$HASH_B" ]] || { echo "non-deterministic archive build" >&2; exit 1; }

EXTRACT_DIR="$TMP_BASE/extracted"
mkdir -p "$EXTRACT_DIR"
unzip -q "$ZIP_A" -d "$EXTRACT_DIR"

TRACKED_LIST="$TMP_BASE/tracked-files.txt"
git_hardened ls-files | LC_ALL=C sort > "$TRACKED_LIST"
TRACKED_COUNT="$(wc -l < "$TRACKED_LIST" | tr -d ' ')"

CHECK_STAGING="$TMP_BASE/check-staging"
mkdir -p "$CHECK_STAGING"
cp -R "$EXTRACT_DIR/discepto/." "$CHECK_STAGING/"
cp "$TRACKED_LIST" "$CHECK_STAGING/tracked-files.txt"

PYTHON="${PYTHON:-python3}"
CHECK_ARGS=()
if [[ "$MODE" == "structural-only" ]]; then
  CHECK_ARGS=(--structural-only)
elif [[ "$MODE" == "private-denylist" ]]; then
  [[ -f "$DENYLIST" ]] || { echo "denylist not found" >&2; exit 1; }
  CHECK_ARGS=(--private-denylist "$DENYLIST")
fi

"$PYTHON" "$ROOT/scripts/check_release.py" "${CHECK_ARGS[@]}" "$CHECK_STAGING"

NODE_VERSION="$(node -v 2>/dev/null || echo unknown)"
PYTHON_VERSION="$("$PYTHON" -V 2>&1 || echo unknown)"
OPENSSL_VERSION="$(openssl version 2>/dev/null || echo unknown)"
GIT_VERSION="$(git_hardened version | head -n1 || echo unknown)"

PARENT="$(dirname "$OUTPUT_DIR")"
BASE="$(basename "$OUTPUT_DIR")"
STAGING="$PARENT/.${BASE}.staging.$$"
mkdir -p "$STAGING"
cp "$ZIP_A" "$STAGING/discepto.zip"
cat > "$STAGING/receipt.json" <<EOF
{
  "status": "ok",
  "head": "$HEAD_SHA",
  "tree": "$TREE_SHA",
  "tracked_count": $TRACKED_COUNT,
  "sha256": "$HASH_A",
  "mode": "$MODE",
  "tools": {
    "node": "$NODE_VERSION",
    "python": "$PYTHON_VERSION",
    "openssl": "$OPENSSL_VERSION",
    "git": "$GIT_VERSION"
  }
}
EOF

mv "$STAGING" "$OUTPUT_DIR"

echo "release ok: $OUTPUT_DIR"
