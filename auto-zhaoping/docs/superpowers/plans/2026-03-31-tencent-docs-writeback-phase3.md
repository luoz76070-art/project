# Tencent Docs Writeback Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write `results/local-recruiting/latest/main-current.csv` back into a Tencent Docs target sheet with backup-sheet protection, readback verification, and a local run report.

**Architecture:** Create a dedicated writeback workspace package that only consumes phase-two `latest/` output and a single Tencent Docs `targetUrl`. The package will validate the local result snapshot, preserve the current target sheet into a reserved backup tab, overwrite the formal sheet from A1, then read back the sheet and compare normalized cell text to the local CSV before marking the run successful.

**Tech Stack:** Node.js, npm workspaces, CommonJS, Playwright, Node built-in test runner (`node:test`), filesystem APIs

---

## File Structure

- Modify: `package.json` - add root helper scripts for the writeback workspace
- Create: `packages/tencent-docs-writeback/package.json` - workspace manifest and scripts
- Create: `packages/tencent-docs-writeback/README.md` - package usage and manual smoke test notes
- Create: `packages/tencent-docs-writeback/config/writeback.config.example.json` - sanitized target URL example
- Create: `packages/tencent-docs-writeback/scripts/writeback.js` - CLI entrypoint and `runWriteback`
- Create: `packages/tencent-docs-writeback/scripts/lib/paths.js` - repo-root path resolution and fixed input/output locations
- Create: `packages/tencent-docs-writeback/scripts/lib/csv.js` - CSV read/write helpers for local results and reports
- Create: `packages/tencent-docs-writeback/scripts/lib/config.js` - loads and validates the writeback config
- Create: `packages/tencent-docs-writeback/scripts/lib/input.js` - loads and validates `results/local-recruiting/latest/`
- Create: `packages/tencent-docs-writeback/scripts/lib/state.js` - persists backup-sheet ownership state
- Create: `packages/tencent-docs-writeback/scripts/lib/report.js` - success/failure report builders and artifact writers
- Create: `packages/tencent-docs-writeback/scripts/lib/browser.js` - minimal Playwright helpers copied and trimmed from the target-write side of the baseline
- Create: `packages/tencent-docs-writeback/scripts/lib/tencent-docs.js` - backup-sheet, overwrite, and readback operations
- Create: `packages/tencent-docs-writeback/tests/paths.test.js`
- Create: `packages/tencent-docs-writeback/tests/config.test.js`
- Create: `packages/tencent-docs-writeback/tests/input.test.js`
- Create: `packages/tencent-docs-writeback/tests/state.test.js`
- Create: `packages/tencent-docs-writeback/tests/report.test.js`
- Create: `packages/tencent-docs-writeback/tests/tencent-docs.test.js`
- Create: `packages/tencent-docs-writeback/tests/writeback.test.js`
- Create: `packages/tencent-docs-writeback/tests/fixtures/repo-root/results/local-recruiting/latest/main-current.csv`
- Create: `packages/tencent-docs-writeback/tests/fixtures/repo-root/results/local-recruiting/latest/summary.json`

### Task 1: Scaffold The Writeback Workspace And Repo-Root Path Rules

**Files:**
- Modify: `package.json`
- Create: `packages/tencent-docs-writeback/package.json`
- Create: `packages/tencent-docs-writeback/README.md`
- Create: `packages/tencent-docs-writeback/config/writeback.config.example.json`
- Create: `packages/tencent-docs-writeback/scripts/lib/paths.js`
- Create: `packages/tencent-docs-writeback/tests/paths.test.js`

- [ ] **Step 1: Write the failing path-resolution test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProjectPaths, resolveRepoRoot } = require('../scripts/lib/paths');

test('buildProjectPaths anchors the writeback roots at the repo root', () => {
  const repoRoot = '/repo';

  assert.deepEqual(buildProjectPaths(repoRoot), {
    latestInputRoot: '/repo/results/local-recruiting/latest',
    writebackRoot: '/repo/results/tencent-docs-writeback',
    runsRoot: '/repo/results/tencent-docs-writeback/runs',
    statePath: '/repo/results/tencent-docs-writeback/state.json',
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails first**

Run: `node --test packages/tencent-docs-writeback/tests/paths.test.js`
Expected: FAIL with `Cannot find module '../scripts/lib/paths'`.

- [ ] **Step 3: Create the workspace manifest and root scripts**

```json
{
  "name": "@zhaoping/tencent-docs-writeback",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "writeback": "node scripts/writeback.js",
    "test": "node --test tests/*.test.js"
  },
  "dependencies": {
    "playwright": "^1.58.2"
  }
}
```

Add root scripts:

```json
{
  "scripts": {
    "test": "npm --workspaces --if-present test",
    "test:extractor": "npm --workspace @zhaoping/tencent-docs-recruiting-extractor test",
    "test:local-results": "npm --workspace @zhaoping/local-recruiting-results test",
    "test:writeback": "npm --workspace @zhaoping/tencent-docs-writeback test",
    "generate:local-results": "npm --workspace @zhaoping/local-recruiting-results run generate",
    "writeback:tencent-docs": "npm --workspace @zhaoping/tencent-docs-writeback run writeback"
  }
}
```

- [ ] **Step 4: Implement the repo-root anchored path helper**

```js
const fs = require('node:fs');
const path = require('node:path');

function resolveRepoRoot(startDir = process.cwd()) {
  let currentDir = path.resolve(startDir);

  for (;;) {
    if (fs.existsSync(path.join(currentDir, '.git'))) return currentDir;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) throw new Error(`Unable to resolve repository root from ${startDir}`);
    currentDir = parentDir;
  }
}

function buildProjectPaths(repoRoot) {
  return {
    latestInputRoot: path.join(repoRoot, 'results', 'local-recruiting', 'latest'),
    writebackRoot: path.join(repoRoot, 'results', 'tencent-docs-writeback'),
    runsRoot: path.join(repoRoot, 'results', 'tencent-docs-writeback', 'runs'),
    statePath: path.join(repoRoot, 'results', 'tencent-docs-writeback', 'state.json'),
  };
}

module.exports = { buildProjectPaths, resolveRepoRoot };
```

- [ ] **Step 5: Add a minimal package README so the workspace is understandable**

```md
# @zhaoping/tencent-docs-writeback

Writes `results/local-recruiting/latest/main-current.csv` into a Tencent Docs target sheet.

## Commands

- `npm run writeback`
- `npm test`
```

- [ ] **Step 6: Run the writeback tests and verify the first test passes**

Run: `npm run test:writeback -- --test-name-pattern="buildProjectPaths|resolveRepoRoot"`
Expected: PASS for `paths.test.js`.

- [ ] **Step 7: Commit the workspace scaffold**

```bash
git add package.json packages/tencent-docs-writeback
git commit -m "feat: scaffold Tencent Docs writeback workspace"
```

### Task 2: Load And Validate The Latest Local Results

**Files:**
- Create: `packages/tencent-docs-writeback/scripts/lib/csv.js`
- Create: `packages/tencent-docs-writeback/scripts/lib/config.js`
- Create: `packages/tencent-docs-writeback/scripts/lib/input.js`
- Create: `packages/tencent-docs-writeback/tests/config.test.js`
- Create: `packages/tencent-docs-writeback/tests/input.test.js`
- Create: `packages/tencent-docs-writeback/tests/fixtures/repo-root/results/local-recruiting/latest/main-current.csv`
- Create: `packages/tencent-docs-writeback/tests/fixtures/repo-root/results/local-recruiting/latest/summary.json`

- [ ] **Step 1: Write the failing config and input tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWritebackConfig } = require('../scripts/lib/config');
const { loadLatestResults } = require('../scripts/lib/input');

test('loadWritebackConfig requires a targetUrl', async () => {
  await assert.rejects(() => loadWritebackConfig('/tmp/missing.json'), /targetUrl/);
});

test('loadLatestResults loads a successful latest snapshot', () => {
  const repoRoot = path.join(__dirname, 'fixtures', 'repo-root');
  const result = loadLatestResults(repoRoot);

  assert.equal(result.snapshotDate, '2026-03-31');
  assert.equal(result.records.length, 2);
  assert.equal(result.summary.status, 'success');
});
```

- [ ] **Step 2: Run the tests to confirm they fail first**

Run: `npm run test:writeback -- --test-name-pattern="loadWritebackConfig|loadLatestResults"`
Expected: FAIL with missing module errors.

- [ ] **Step 3: Implement the CSV, config, and latest-input loaders**

Implement `csv.js` with read/write helpers, `config.js` with `--config` loading and `targetUrl` validation, and `input.js` with latest-directory discovery and schema checks.

`loadLatestResults(repoRoot)` must:

- read `results/local-recruiting/latest/main-current.csv`
- read `results/local-recruiting/latest/summary.json`
- reject if either file is missing
- reject if `summary.status !== 'success'`
- reject if `summary.snapshot_date` is missing
- return parsed headers, records, summary, and snapshot date

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:writeback -- --test-name-pattern="loadWritebackConfig|loadLatestResults"`
Expected: PASS.

- [ ] **Step 5: Commit the input layer**

```bash
git add packages/tencent-docs-writeback/scripts/lib packages/tencent-docs-writeback/tests packages/tencent-docs-writeback/config
git commit -m "test: add writeback input loading"
```

### Task 3: Add State, Report, And Target-Document Helpers

**Files:**
- Create: `packages/tencent-docs-writeback/scripts/lib/state.js`
- Create: `packages/tencent-docs-writeback/scripts/lib/report.js`
- Create: `packages/tencent-docs-writeback/scripts/lib/browser.js`
- Create: `packages/tencent-docs-writeback/scripts/lib/tencent-docs.js`
- Create: `packages/tencent-docs-writeback/tests/state.test.js`
- Create: `packages/tencent-docs-writeback/tests/report.test.js`
- Create: `packages/tencent-docs-writeback/tests/tencent-docs.test.js`

- [ ] **Step 1: Write the failing helper tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { loadState, saveState } = require('../scripts/lib/state');
const { buildSuccessReport, buildFailureReport } = require('../scripts/lib/report');
const { normalizeSheetRows, resolveBackupSheet } = require('../scripts/lib/tencent-docs');

test('resolveBackupSheet rejects a same-name foreign sheet', () => {
  assert.throws(
    () =>
      resolveBackupSheet({
        backupSheetId: 'owned',
        backupSheetTitle: '__local_recruiting_backup__',
        sheets: [{ id: 'other', title: '__local_recruiting_backup__' }],
      }),
    /collision/
  );
});

test('normalizeSheetRows trims trailing empty rows and columns', () => {
  assert.deepEqual(
    normalizeSheetRows([[1, null, ''], ['a', 'b ', '', ''], ['', '']]),
    [['1', ''], ['a', 'b ']]
  );
});

test('buildSuccessReport includes required metadata fields', () => {
  const report = buildSuccessReport({
    runId: 'run-1',
    inputDir: '/repo/results/local-recruiting/latest',
    snapshotDate: '2026-03-31',
    targetUrl: 'https://docs.qq.com/sheet/demo',
    backupSheetName: '__local_recruiting_backup__',
    mainRowCount: 2,
  });

  assert.equal(report.status, 'success');
  assert.equal(report.input_dir, '/repo/results/local-recruiting/latest');
  assert.equal(report.snapshot_date, '2026-03-31');
  assert.equal(report.target_url, 'https://docs.qq.com/sheet/demo');
  assert.equal(report.backup_sheet_name, '__local_recruiting_backup__');
  assert.equal(report.main_row_count, 2);
});

test('buildFailureReport includes failure metadata', () => {
  const report = buildFailureReport({
    runId: 'run-2',
    inputDir: '/repo/results/local-recruiting/latest',
    snapshotDate: null,
    targetUrl: 'https://docs.qq.com/sheet/demo',
    backupSheetName: '__local_recruiting_backup__',
    failureStage: 'writeback',
    failureReason: 'target sheet is not editable',
    suggestedAction: 'Fix target permissions and retry',
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.failure_stage, 'writeback');
  assert.equal(report.failure_reason, 'target sheet is not editable');
  assert.equal(report.suggested_action, 'Fix target permissions and retry');
});

test('saveState persists the backup sheet id and title', async () => {
  const state = { backup_sheet_id: 'sheet-1', backup_sheet_title: '__local_recruiting_backup__' };

  await saveState('/tmp/state.json', state);
  assert.deepEqual(loadState('/tmp/state.json'), state);
});
```

- [ ] **Step 2: Run the tests to confirm they fail first**

Run: `npm run test:writeback -- --test-name-pattern="loadState|buildSuccessReport|normalizeSheetRows"`
Expected: FAIL with missing module errors.

- [ ] **Step 3: Port the minimal target-write helpers**

Add `state.js` to read/write `results/tencent-docs-writeback/state.json` with both `backup_sheet_id` and `backup_sheet_title`, `report.js` to build success/failure reports and write `runs/<run-id>/report.json` plus `before-target.csv` and `after-target.csv`, and `browser.js` / `tencent-docs.js` to encapsulate the Tencent Docs operations needed for:

- finding or creating the reserved backup sheet
- copying the formal sheet into the backup sheet
- clearing and pasting the formal sheet from A1
- reading back rows for verification
- normalizing sheet rows for string-based comparison

`report.json` must include at least:

- `status`
- `run_id`
- `input_dir`
- `snapshot_date`
- `target_url`
- `backup_sheet_name`
- `main_row_count`
- `failure_stage` when failed
- `failure_reason` when failed
- `suggested_action` when failed

Use the target-side behavior from `vendor/tencent-docs-extractor-baseline/scripts/update-target.js` and `verify-sync.js` as the reference for the browser flow.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:writeback -- --test-name-pattern="loadState|buildSuccessReport|normalizeSheetRows"`
Expected: PASS.

- [ ] **Step 5: Commit the helpers**

```bash
git add packages/tencent-docs-writeback/scripts/lib packages/tencent-docs-writeback/tests
git commit -m "feat: add writeback target helpers"
```

### Task 4: Implement The Writeback CLI, Backup Flow, And Docs

**Files:**
- Create: `packages/tencent-docs-writeback/scripts/writeback.js`
- Modify: `packages/tencent-docs-writeback/README.md`
- Modify: `README.md`
- Create: `packages/tencent-docs-writeback/tests/writeback.test.js`

- [ ] **Step 1: Write the failing orchestration test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { runWriteback } = require('../scripts/writeback');

function fakeSessionFactory() {
  return {
    openTargetDocument: async () => fakeTargetDocument,
  };
}

const fakeTargetDocument = {
  readRows: async () => [['record_id', 'snapshot_date'], ['alpha', '2026-03-31']],
  copyToBackupSheet: async () => ({ backupSheetId: 'backup-1', backupSheetTitle: '__local_recruiting_backup__' }),
  overwriteFromRows: async () => {},
  readBackRows: async () => [['record_id', 'snapshot_date'], ['alpha', '2026-03-31']],
  close: async () => {},
};

test('runWriteback backs up the target sheet before overwrite', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'writeback-'));
  const configPath = path.join(repoRoot, 'config', 'writeback.config.local.json');

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({ targetUrl: 'https://docs.qq.com/sheet/demo' }), 'utf8');

  const result = await runWriteback({ repoRoot, configPath, sessionFactory: fakeSessionFactory });

  assert.equal(result.status, 'success');
  assert.match(result.reportPath, /runs\/[^/]+\/report.json$/);
  assert.match(result.beforeTargetCsvPath, /runs\/[^/]+\/before-target.csv$/);
  assert.match(result.afterTargetCsvPath, /runs\/[^/]+\/after-target.csv$/);
});
```

- [ ] **Step 2: Run the test to confirm it fails first**

Run: `npm run test:writeback -- --test-name-pattern="runWriteback backs up the target sheet"`
Expected: FAIL because `runWriteback` is not implemented.

- [ ] **Step 3: Implement the CLI orchestration**

Implement `runWriteback({ repoRoot, configPath, sessionFactory })` and `main()` so it:

- resolves the repo root
- loads `results/local-recruiting/latest/`
- loads and validates the Tencent Docs target config
- opens the target document session
- creates or reuses the reserved backup sheet with local ownership tracking
- stores `backup_sheet_id` and `backup_sheet_title` in `results/tencent-docs-writeback/state.json`
- copies the formal sheet into the backup sheet
- clears and overwrites the formal sheet from A1 with `main-current.csv`
- reads the formal sheet back and verifies the normalized rows match
- writes `results/tencent-docs-writeback/runs/<run-id>/report.json`
- writes `results/tencent-docs-writeback/runs/<run-id>/before-target.csv`
- writes `results/tencent-docs-writeback/runs/<run-id>/after-target.csv`
- writes or updates `results/tencent-docs-writeback/state.json`
- exits non-zero on any hard failure

`runWriteback()` must return at least:

- `status`
- `reportPath`
- `beforeTargetCsvPath`
- `afterTargetCsvPath`
- `statePath`
- `backupSheetId`
- `backupSheetTitle`

The CLI should only accept the single latest input path and one `targetUrl` for this phase.

- [ ] **Step 4: Update the package and root READMEs**

Document:

- how to copy `config/writeback.config.example.json` to a local config
- the `npm --workspace @zhaoping/tencent-docs-writeback run writeback` command
- the fact that the backup sheet is reserved and may be recreated when its ownership is lost
- the run-report and state file locations
- the `before-target.csv` and `after-target.csv` audit snapshots

- [ ] **Step 5: Run the writeback tests and the full workspace suite**

Run:

```bash
npm run test:writeback
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit the writeback implementation and documentation**

```bash
git add README.md packages/tencent-docs-writeback
git commit -m "feat: add Tencent Docs writeback workflow"
```

## Done Criteria

- A separate `@zhaoping/tencent-docs-writeback` workspace exists
- The package resolves all fixed paths from repo root
- It only reads `results/local-recruiting/latest/`
- It validates the latest snapshot before touching Tencent Docs
- It creates or reuses a reserved backup sheet and copies the formal sheet into it
- It overwrites the formal sheet from A1 and verifies the final rows by readback
- It writes `results/tencent-docs-writeback/runs/<run-id>/report.json`
- It writes `results/tencent-docs-writeback/runs/<run-id>/before-target.csv` and `results/tencent-docs-writeback/runs/<run-id>/after-target.csv`
- It persists `backup_sheet_id` and `backup_sheet_title` in `results/tencent-docs-writeback/state.json`
- Tests cover path rules, input validation, helper behavior, and end-to-end orchestration
