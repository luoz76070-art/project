#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

if [ -n "${HUGO_BIN:-}" ] && [ -x "${HUGO_BIN}" ]; then
  RESOLVED_HUGO_BIN="${HUGO_BIN}"
elif [ -x "./bin/hugo" ]; then
  RESOLVED_HUGO_BIN="./bin/hugo"
elif command -v hugo >/dev/null 2>&1; then
  RESOLVED_HUGO_BIN="$(command -v hugo)"
else
  echo "未检测到 hugo，可优先使用仓库内 ./bin/hugo，或先在系统中安装 Hugo。"
  exit 1
fi

HUGO_CACHEDIR="${HUGO_CACHEDIR:-${PROJECT_ROOT}/.tmp/hugo_cache}"
mkdir -p "${HUGO_CACHEDIR}"

"${RESOLVED_HUGO_BIN}" server -D --cacheDir "${HUGO_CACHEDIR}" "$@"
