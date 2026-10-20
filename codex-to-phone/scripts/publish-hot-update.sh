#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

bundle="${1:-}"
version="${2:-}"
min_native_version_code="${3:-}"
notes="${4:-Mobile Codex hot update.}"
max_native_version_code="${MOBILE_CODEX_HOT_MAX_NATIVE_VERSION_CODE:-$min_native_version_code}"

if [[ -z "$bundle" || ! -f "$bundle" || -z "$version" || -z "$min_native_version_code" ]]; then
  echo "Usage: scripts/publish-hot-update.sh <single-file-html> <version> <minNativeVersionCode> [notes]"
  exit 2
fi

: "${MOBILE_CODEX_HOT_RELEASE_HOST:?Set MOBILE_CODEX_HOT_RELEASE_HOST, for example deploy@example.com}"
: "${MOBILE_CODEX_HOT_RELEASE_DIR:?Set MOBILE_CODEX_HOT_RELEASE_DIR, for example /var/www/mobile-codex/releases/hot}"
: "${MOBILE_CODEX_HOT_RELEASE_BASE_URL:?Set MOBILE_CODEX_HOT_RELEASE_BASE_URL, for example https://downloads.example.com/mobile-codex/hot}"

release_host="$MOBILE_CODEX_HOT_RELEASE_HOST"
ssh_key="${MOBILE_CODEX_HOT_RELEASE_SSH_KEY:-${MOBILE_CODEX_RELEASE_SSH_KEY:-}}"
remote_dir="$MOBILE_CODEX_HOT_RELEASE_DIR"
base_url="${MOBILE_CODEX_HOT_RELEASE_BASE_URL%/}"
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ && "$version" != *..* ]] || { echo "Invalid version"; exit 2; }
[[ "$remote_dir" =~ ^/[A-Za-z0-9/._-]+$ ]] || { echo "Release directory must be an absolute path without shell characters"; exit 2; }
[[ "$base_url" == https://* ]] || { echo "Release URL must use HTTPS"; exit 2; }
[[ "$min_native_version_code" =~ ^[0-9]+$ && "$max_native_version_code" =~ ^[0-9]+$ ]] || { echo "Invalid native version code"; exit 2; }
[[ "$min_native_version_code" -ge 16 ]] || { echo "This bundle requires native versionCode >= 16"; exit 2; }
[[ "$max_native_version_code" -ge "$min_native_version_code" ]] || { echo "Invalid native version range"; exit 2; }
sha256="$(shasum -a 256 "$bundle" | awk '{print $1}')"
size="$(wc -c < "$bundle" | tr -d ' ')"
bundle_name="mobile-codex-${version}-${sha256:0:12}.html"
published_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
tmp_manifest="$(mktemp)"
trap 'rm -f "$tmp_manifest"' EXIT

MANIFEST_VERSION="$version" \
MANIFEST_HTML_URL="$base_url/$bundle_name" \
MANIFEST_SHA256="$sha256" \
MANIFEST_SIZE="$size" \
MANIFEST_MIN_NATIVE_VERSION_CODE="$min_native_version_code" \
MANIFEST_MAX_NATIVE_VERSION_CODE="$max_native_version_code" \
MANIFEST_NOTES="$notes" \
MANIFEST_PUBLISHED_AT="$published_at" \
node <<'NODE' > "$tmp_manifest"
const manifest = {
  platform: "android",
  channel: "hot",
  version: process.env.MANIFEST_VERSION,
  htmlUrl: process.env.MANIFEST_HTML_URL,
  sha256: process.env.MANIFEST_SHA256,
  size: Number(process.env.MANIFEST_SIZE),
  minNativeVersionCode: Number(process.env.MANIFEST_MIN_NATIVE_VERSION_CODE),
  maxNativeVersionCode: Number(process.env.MANIFEST_MAX_NATIVE_VERSION_CODE),
  notes: process.env.MANIFEST_NOTES,
  publishedAt: process.env.MANIFEST_PUBLISHED_AT,
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
NODE

bash scripts/upload-release-atomically.sh "$bundle" "$tmp_manifest" "$release_host" "$remote_dir" "$bundle_name" "$ssh_key"

echo "Hot update manifest: $base_url/latest.json"
echo "Hot update bundle: $base_url/$bundle_name"
