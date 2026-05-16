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

release_host="${MOBILE_CODEX_RELEASE_HOST:-root@8.153.100.129}"
ssh_key="${MOBILE_CODEX_RELEASE_SSH_KEY:-/Users/rorance/.ssh/hermes_scout_bridge_ed25519}"
remote_dir="${MOBILE_CODEX_RELEASE_DIR:-/var/www/mobile-codex/releases/android}"
base_url="${MOBILE_CODEX_RELEASE_BASE_URL:-https://zyzlz.xin/mobile-codex/releases/android}"

safe_version="$(printf '%s' "$version_name" | tr -c 'A-Za-z0-9._-' '-')"
apk_name="mobile-codex-${safe_version}.apk"
sha256="$(shasum -a 256 "$apk" | awk '{print $1}')"
size="$(wc -c < "$apk" | tr -d ' ')"
published_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
tmp_manifest="$(mktemp)"

cat > "$tmp_manifest" <<JSON
{
  "platform": "android",
  "versionName": "$version_name",
  "versionCode": $version_code,
  "apkUrl": "$base_url/$apk_name",
  "size": $size,
  "sha256": "$sha256",
  "mandatory": false,
  "notes": "$notes",
  "publishedAt": "$published_at"
}
JSON

ssh -i "$ssh_key" -o BatchMode=yes "$release_host" "mkdir -p '$remote_dir'"
scp -i "$ssh_key" -o BatchMode=yes "$apk" "$release_host:$remote_dir/$apk_name"
scp -i "$ssh_key" -o BatchMode=yes "$tmp_manifest" "$release_host:$remote_dir/latest.json"
ssh -i "$ssh_key" -o BatchMode=yes "$release_host" "chmod 644 '$remote_dir/$apk_name' '$remote_dir/latest.json'"
rm -f "$tmp_manifest"

echo "Update manifest: $base_url/latest.json"
echo "APK: $base_url/$apk_name"
