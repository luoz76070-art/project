# GitHub Source Package

This folder is prepared as a GitHub-ready source tree. It is not an installation package.

Included:
- TypeScript source for the mobile app and relay.
- Windows Manager/Watchdog source and build scripts.
- Android native project shell and resources.
- Generated protocol typings needed by the project.
- Stable documentation.

Excluded:
- `node_modules` and nested package-manager output.
- APK/EXE files and packaged install folders.
- `.env.local`, relay pid files, logs, upload data, and personal paths.
- Development smoke logs and local conversation notes.

Before publishing, run the checks in `docs/github-public-release-plan.md` and review every credential-like match manually.
