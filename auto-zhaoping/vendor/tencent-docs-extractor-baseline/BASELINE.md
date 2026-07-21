# Tencent Docs Extractor Baseline

- Source path: `/Users/rorance/workspace/tencent-docs-extractor`
- Purpose: preserve an auditable baseline snapshot for phase-one refactor work
- Repository positioning: vendor reference baseline for the `zhaoping` cleanup effort; this snapshot documents the preserved upstream extractor state and is not the active implementation source of truth
- Excluded runtime folders/files: `node_modules/`, `.browser-profile/`, `output/`, `logs/`, `state/`, `.DS_Store`
- Excluded committed live config: `config/sync-config.json`
- Excluded non-portable scheduler plists: `scheduler/*.plist`
- Rule: this directory stays unchanged after the initial copy

## Verified as phase-one necessary

The following source-side helpers are required for phase-one extraction:

- `scripts/extract-once.js` — main extraction orchestration
- `scripts/login-healthcheck.js` — browser login verification
- `scripts/export-source.js` — raw data export from Tencent Docs
- `scripts/normalize-records.js` — record normalization to fixed contract
- `scripts/lib/browser.js` — Playwright browser setup and navigation
- `scripts/lib/config.js` — config file loading and validation
- `scripts/lib/run-context.js` — per-run output directory management
- `scripts/lib/table.js` — table parsing helpers
- `scripts/lib/contract.js` — CSV contract and record-id generation
- `config/extractor.config.example.json` — config template

## Verified as intentionally excluded from the working package

The following items exist in the original extractor but are intentionally excluded from the phase-one working package:

- Target-side write logic (database sync, API push, or file-based target output)
- Sync verification scripts (comparison between source and target)
- Scheduler scripts (cron/launchd/plist-based scheduling)
- Runtime state lock files (run locks, in-flight markers, `.lock` files)
