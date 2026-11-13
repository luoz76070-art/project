#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

apk="${1:-}"
build_gradle="apps/mobile/android/app/build.gradle"
default_version_name="$(awk '/versionName/ { gsub(/"/, "", $2); print $2; exit }' "$build_gradle")"
default_version_code="$(awk '/versionCode/ { print $2; exit }' "$build_gradle")"
version_name="${2:-$default_version_name}"
version_code="${3:-$default_version_code}"
notes="${4:-Mobile Codex Android update.}"

if [[ -z "$apk" || ! -f "$apk" ]]; then
  echo "Usage: scripts/publish-android-update.sh <apk> [versionName] [versionCode] [notes]"
  exit 2
fi

if [[ -z "$version_name" || -z "$version_code" ]]; then
  echo "Could not resolve Android versionName/versionCode from $build_gradle"
  exit 2
fi

: "${MOBILE_CODEX_RELEASE_HOST:?Set MOBILE_CODEX_RELEASE_HOST, for example deploy@example.com}"
: "${MOBILE_CODEX_RELEASE_DIR:?Set MOBILE_CODEX_RELEASE_DIR, for example /var/www/mobile-codex/releases/android}"
: "${MOBILE_CODEX_RELEASE_BASE_URL:?Set MOBILE_CODEX_RELEASE_BASE_URL, for example https://downloads.example.com/mobile-codex/android}"

release_host="$MOBILE_CODEX_RELEASE_HOST"
ssh_key="${MOBILE_CODEX_RELEASE_SSH_KEY:-}"
remote_dir="$MOBILE_CODEX_RELEASE_DIR"
base_url="${MOBILE_CODEX_RELEASE_BASE_URL%/}"

[[ "$version_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ && "$version_name" != *..* && "$version_code" =~ ^[0-9]+$ ]] || { echo "Invalid Android version"; exit 2; }
[[ "$base_url" == https://* ]] || { echo "Release URL must use HTTPS"; exit 2; }
sha256="$(shasum -a 256 "$apk" | awk '{print $1}')"
size="$(wc -c < "$apk" | tr -d ' ')"
apk_name="mobile-codex-${version_name}-${sha256:0:12}.apk"
published_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
tmp_manifest="$(mktemp)"
trap 'rm -f "$tmp_manifest"' EXIT

MANIFEST_VERSION_NAME="$version_name" \
MANIFEST_VERSION_CODE="$version_code" \
MANIFEST_APK_URL="$base_url/$apk_name" \
MANIFEST_SIZE="$size" \
MANIFEST_SHA256="$sha256" \
MANIFEST_NOTES="$notes" \
MANIFEST_PUBLISHED_AT="$published_at" \
node <<'NODE' > "$tmp_manifest"
const manifest = {
  platform: "android",
  versionName: process.env.MANIFEST_VERSION_NAME,
  versionCode: Number(process.env.MANIFEST_VERSION_CODE),
  apkUrl: process.env.MANIFEST_APK_URL,
  size: Number(process.env.MANIFEST_SIZE),
  sha256: process.env.MANIFEST_SHA256,
  mandatory: false,
  notes: process.env.MANIFEST_NOTES,
  publishedAt: process.env.MANIFEST_PUBLISHED_AT,
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
NODE

bash scripts/upload-release-atomically.sh "$apk" "$tmp_manifest" "$release_host" "$remote_dir" "$apk_name" "$ssh_key"

echo "Update manifest: $base_url/latest.json"
echo "APK: $base_url/$apk_name"
