#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

version="${1:-mac-local}"
if [[ "$version" == "--" ]]; then
  version="${2:-mac-local}"
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Run scripts/setup-android-tools-mac.sh first."
  exit 1
fi

if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -x "$(brew --prefix openjdk 2>/dev/null)/bin/java" ]]; then
    export JAVA_HOME="$(brew --prefix openjdk)/libexec/openjdk.jdk/Contents/Home"
  else
    export JAVA_HOME="$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home"
  fi
fi
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
cmdline_tools_bin="$(dirname "$(command -v sdkmanager 2>/dev/null || true)")"
export PATH="$cmdline_tools_bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/35.0.0:$JAVA_HOME/bin:$PATH"

if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "Java 17 not found. Run scripts/setup-android-tools-mac.sh first."
  exit 1
fi
if ! command -v sdkmanager >/dev/null 2>&1 || ! command -v gradle >/dev/null 2>&1; then
  echo "Android command line tools or Gradle not found. Run scripts/setup-android-tools-mac.sh first."
  exit 1
fi

corepack pnpm --filter @mobile-codex/mobile build
corepack pnpm --filter @mobile-codex/mobile exec cap sync android

pushd apps/mobile/android >/dev/null
gradle assembleDebug --no-daemon
popd >/dev/null

mkdir -p dist-apk
apk="dist-apk/mobile-codex-${version}-debug.apk"
cp apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk "$apk"
echo "APK=$PWD/$apk"
