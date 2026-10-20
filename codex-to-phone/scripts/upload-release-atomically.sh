#!/usr/bin/env bash
# Shared by APK and HTML publication. Calling this script uploads to the configured host.
set -euo pipefail
artifact="$1"; manifest="$2"; release_host="$3"; remote_dir="$4"; artifact_name="$5"; ssh_key="${6:-}"
[[ "$remote_dir" =~ ^/[A-Za-z0-9/._-]+$ && "$artifact_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]+$ ]] || { echo "Invalid release path"; exit 2; }
[[ "$release_host" =~ ^[A-Za-z0-9_][A-Za-z0-9_.@:-]*$ ]] || { echo "Invalid release host"; exit 2; }
artifact_sha="$(shasum -a 256 "$artifact" | awk '{print $1}')"
manifest_sha="$(shasum -a 256 "$manifest" | awk '{print $1}')"
artifact_size="$(wc -c < "$artifact" | tr -d ' ')"
publish_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
ssh_args=(-o BatchMode=yes)
if [[ -n "$ssh_key" ]]; then ssh_args+=(-i "$ssh_key"); fi
ssh "${ssh_args[@]}" "$release_host" "mkdir -p '$remote_dir'"
scp "${ssh_args[@]}" "$artifact" "$release_host:$remote_dir/.artifact-$publish_id.tmp"
scp "${ssh_args[@]}" "$manifest" "$release_host:$remote_dir/.manifest-$publish_id.tmp"
ssh "${ssh_args[@]}" "$release_host" "bash -s -- '$remote_dir' '$artifact_name' '$artifact_sha' '$artifact_size' '$publish_id' '$manifest_sha'" <<'REMOTE'
set -euo pipefail
cd "$1"
artifact_name="$2"; expected_sha="$3"; expected_size="$4"; publish_id="$5"; manifest_sha="$6"
artifact_tmp=".artifact-$publish_id.tmp"; manifest_tmp=".manifest-$publish_id.tmp"
trap 'rm -f "$artifact_tmp" "$manifest_tmp"' EXIT
mkdir .publish-lock || { echo "Another publication is active"; exit 3; }
trap 'rm -f "$artifact_tmp" "$manifest_tmp"; rmdir .publish-lock' EXIT
[[ "$(sha256sum "$artifact_tmp" | cut -d ' ' -f 1)" == "$expected_sha" ]]
[[ "$(wc -c < "$artifact_tmp" | tr -d ' ')" == "$expected_size" ]]
[[ "$(sha256sum "$manifest_tmp" | cut -d ' ' -f 1)" == "$manifest_sha" ]]
chmod 644 "$artifact_tmp" "$manifest_tmp"
if [[ -f "$artifact_name" ]]; then
  [[ "$(sha256sum "$artifact_name" | cut -d ' ' -f 1)" == "$expected_sha" ]]
  rm -f "$artifact_tmp"
else mv "$artifact_tmp" "$artifact_name"; fi
if [[ -f latest.json ]]; then cp latest.json ".previous-$publish_id.tmp"; mv -f ".previous-$publish_id.tmp" previous.json; fi
mv -f "$manifest_tmp" latest.json
REMOTE
