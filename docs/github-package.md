# GitHub Source Package

This folder contains the source tree and a user-requested versioned Android preview delivery.

Included:
- TypeScript source for the mobile app and relay.
- Windows Manager/Watchdog source and build scripts.
- Android native project shell and resources.
- Generated protocol typings needed by the project.
- Stable documentation.
- The fixed Kelivo source, local dependencies, integration bridge and upstream license.
- Reviewed APK, matching source archive, gateway bundle and SHA256 under `releases/android/kelivo-preview/<version>/` (explicitly authorized on 2026-11-07).

Excluded:
- `node_modules` and nested package-manager output.
- Other APK/EXE files, build caches and local packaged installs.
- `.env.local`, relay pid files, logs, upload data, and personal paths.
- Development smoke logs and local conversation notes.

Before publishing, run the checks in `docs/github-public-release-plan.md` and review every credential-like match manually.
