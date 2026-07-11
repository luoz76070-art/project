#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

export MOBILE_CODEX_HOST="${MOBILE_CODEX_HOST:-0.0.0.0}"
export MOBILE_CODEX_PORT="${MOBILE_CODEX_PORT:-8787}"
if [[ -z "${MOBILE_CODEX_TOKEN:-}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    MOBILE_CODEX_TOKEN="mobile-codex-$(openssl rand -hex 24)"
  else
    MOBILE_CODEX_TOKEN="mobile-codex-$(uuidgen | tr -d '-')"
  fi
  export MOBILE_CODEX_TOKEN
fi
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export MOBILE_CODEX_DEFAULT_CWD="${MOBILE_CODEX_DEFAULT_CWD:-$PWD}"

if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack not found. Install Node.js 20+ first."
  exit 1
fi

corepack enable >/dev/null 2>&1 || true

if [ ! -d node_modules ]; then
  corepack pnpm install
fi

corepack pnpm mac:helper || {
  echo "Warning: Mobile Codex Input helper was not built. Relay will fall back to osascript."
  echo "If needed, install Xcode Command Line Tools: xcode-select --install"
}

local_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")"
echo ""
echo "Mobile Codex Relay"
echo "Endpoint on this Mac: http://127.0.0.1:${MOBILE_CODEX_PORT}"
echo "Endpoint for Android on same Wi-Fi: http://${local_ip}:${MOBILE_CODEX_PORT}"
echo "Token: ${MOBILE_CODEX_TOKEN}"
echo ""
echo "Keep this terminal open while using the Android phone."
echo ""

exec corepack pnpm dev:relay
