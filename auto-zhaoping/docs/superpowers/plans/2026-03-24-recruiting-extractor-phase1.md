# Recruiting Extractor Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build phase one of the recruiting pipeline by copying the existing Tencent Docs extractor into a safe baseline, trimming it into a source-only extractor package, and making it emit a fixed CSV contract.

**Architecture:** The repository is currently empty, so phase one starts by bootstrapping a small Node workspace. Keep the original extractor logic as an untouched baseline snapshot, then build a separate working package that reuses only the source-reading pieces, removes target-write/state-sync responsibilities, and exports one stable CSV plus run metadata.

**Tech Stack:** Node.js, npm workspaces, CommonJS, Playwright, xlsx, Node built-in test runner (`node:test`), Tencent Docs browser automation

---

## File Structure

- Create: `package.json` - root workspace manifest and shared scripts
- Create: `.gitignore` - ignore runtime output, browser profiles, local config, and dependencies
- Create: `README.md` - short repo-level setup notes
- Create: `vendor/tencent-docs-extractor-baseline/BASELINE.md` - documents source path, copy date, and excluded runtime folders
- Create: `vendor/tencent-docs-extractor-baseline/extract.js`
- Create: `vendor/tencent-docs-extractor-baseline/package.json`
- Create: `vendor/tencent-docs-extractor-baseline/package-lock.json`
- Create: `vendor/tencent-docs-extractor-baseline/config/sync-config.example.json`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/auth-check.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/export-source.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/login-healthcheck.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/normalize-data.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/lib/browser.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/lib/env.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/lib/table.js`
- Create: `packages/tencent-docs-recruiting-extractor/package.json` - source-only package manifest and scripts
- Create: `packages/tencent-docs-recruiting-extractor/README.md` - package usage and manual verification commands
- Create: `packages/tencent-docs-recruiting-extractor/config/extractor.config.example.json` - sanitized source-only config example
- Create: `packages/tencent-docs-recruiting-extractor/scripts/extract-once.js` - new source-only CLI entrypoint
- Create: `packages/tencent-docs-recruiting-extractor/scripts/auth-check.js` - source-only auth wrapper for healthcheck and extract flows
- Create: `packages/tencent-docs-recruiting-extractor/scripts/login-healthcheck.js` - source-only login/readiness check
- Create: `packages/tencent-docs-recruiting-extractor/scripts/export-source.js` - source export wrapper reused from baseline logic
- Create: `packages/tencent-docs-recruiting-extractor/scripts/normalize-records.js` - converts raw rows into fixed CSV contract rows
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/browser.js` - browser helpers copied and trimmed to source-side behavior
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/config.js` - loads and validates source-only config
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/run-context.js` - prepares output directories without target/state-sync concerns
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/table.js` - row cleanup, CSV output, file parsing helpers
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/contract.js` - fixed CSV headers, field normalization, record id generation
- Create: `packages/tencent-docs-recruiting-extractor/tests/config.test.js`
- Create: `packages/tencent-docs-recruiting-extractor/tests/table.test.js`
- Create: `packages/tencent-docs-recruiting-extractor/tests/contract.test.js`
- Create: `packages/tencent-docs-recruiting-extractor/tests/extract-once.test.js`
- Create: `packages/tencent-docs-recruiting-extractor/tests/fixtures/raw-source-rows.json`

## Phase Boundary

This plan only covers spec phase one:

- baseline copy
- minimal extractor identification
- source-only package creation
- fixed CSV contract
- local smoke verification for source extraction

This plan does **not** cover:

- daily snapshots
- diffing and `每日新增`
- Tencent Docs target writing
- scheduling/orchestration beyond local manual runs

### Task 1: Bootstrap The Empty Repo And Preserve A Baseline Snapshot

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `vendor/tencent-docs-extractor-baseline/BASELINE.md`
- Create: `vendor/tencent-docs-extractor-baseline/extract.js`
- Create: `vendor/tencent-docs-extractor-baseline/package.json`
- Create: `vendor/tencent-docs-extractor-baseline/package-lock.json`
- Create: `vendor/tencent-docs-extractor-baseline/config/sync-config.example.json`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/auth-check.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/export-source.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/login-healthcheck.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/normalize-data.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/lib/browser.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/lib/env.js`
- Create: `vendor/tencent-docs-extractor-baseline/scripts/lib/table.js`
- Create: `packages/tencent-docs-recruiting-extractor/package.json`
- Create: `packages/tencent-docs-recruiting-extractor/README.md`
- Create: `packages/tencent-docs-recruiting-extractor/config/extractor.config.example.json`

- [ ] **Step 1: Create the root workspace manifest**

```json
{
  "name": "zhaoping",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "test": "npm --workspaces --if-present test",
    "test:extractor": "npm --workspace @zhaoping/tencent-docs-recruiting-extractor test"
  }
}
```

- [ ] **Step 2: Add the root ignore rules before copying anything**

```gitignore
node_modules/
.DS_Store
output/
logs/
state/
.browser-profile/
*.local.json
```

- [ ] **Step 3: Copy a trimmed baseline snapshot from the existing local extractor**

Run:

```bash
mkdir -p vendor/tencent-docs-extractor-baseline/config vendor/tencent-docs-extractor-baseline/scripts/lib && rsync -a --exclude "node_modules" --exclude ".browser-profile" --exclude "output" --exclude "logs" --exclude "state" --exclude ".DS_Store" "/Users/rorance/workspace/tencent-docs-extractor/" "vendor/tencent-docs-extractor-baseline/"
```

Replace the command with this exact version if the source folder contains git metadata:

```bash
mkdir -p vendor/tencent-docs-extractor-baseline/config vendor/tencent-docs-extractor-baseline/scripts/lib && rsync -a --exclude ".git" --exclude "node_modules" --exclude ".browser-profile" --exclude "output" --exclude "logs" --exclude "state" --exclude ".DS_Store" "/Users/rorance/workspace/tencent-docs-extractor/" "vendor/tencent-docs-extractor-baseline/"
```

Expected: `vendor/tencent-docs-extractor-baseline/` exists with source files only and no runtime folders.

- [ ] **Step 4: Document the baseline origin so the copy is auditable**

```md
# Tencent Docs Extractor Baseline

- Source path: `/Users/rorance/workspace/tencent-docs-extractor`
- Copied for phase-one refactor work
- Excluded: `node_modules/`, `.browser-profile/`, `output/`, `logs/`, `state/`, `.DS_Store`
- Rule: this directory stays unchanged after the initial copy
```

- [ ] **Step 5: Create the working package manifest and example config skeleton**

```json
{
  "name": "@zhaoping/tencent-docs-recruiting-extractor",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "extract": "node scripts/extract-once.js",
    "healthcheck": "node scripts/login-healthcheck.js",
    "test": "node --test tests/*.test.js"
  },
  "dependencies": {
    "playwright": "^1.58.2",
    "xlsx": "^0.18.5"
  }
}
```

```json
{
  "sourceUrl": "https://docs.qq.com/sheet/REPLACE_ME",
  "timezone": "Asia/Shanghai",
  "outputDir": "./output",
  "userDataDir": "./.browser-profile"
}
```

- [ ] **Step 6: Install workspace dependencies**

Run: `npm install`
Expected: root lockfile is created and `npm run test:extractor` is now a valid command, even if tests do not exist yet.

- [ ] **Step 7: Commit the bootstrap and baseline snapshot**

```bash
git add .
git commit -m "chore: bootstrap repo and preserve extractor baseline"
```

### Task 2: Lock Down Source-Only Config And Table Helpers With Tests

**Files:**
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/config.js`
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/run-context.js`
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/table.js`
- Test: `packages/tencent-docs-recruiting-extractor/tests/config.test.js`
- Test: `packages/tencent-docs-recruiting-extractor/tests/table.test.js`

- [ ] **Step 1: Write the failing config tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { loadConfig } = require('../scripts/lib/config');

test('loadConfig requires sourceUrl and does not require targetUrl', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'extractor-config-'));
  const configPath = path.join(tempDir, 'extractor.config.json');

  await fs.writeFile(
    configPath,
    JSON.stringify({ sourceUrl: 'https://docs.qq.com/sheet/demo', timezone: 'Asia/Shanghai' })
  );

  const config = await loadConfig(configPath);
  assert.equal(config.sourceUrl, 'https://docs.qq.com/sheet/demo');
  assert.equal(config.timezone, 'Asia/Shanghai');
});

test('createRunContext derives snapshot_date in Asia/Shanghai', async () => {
  const { createRunContext } = require('../scripts/lib/run-context');
  const context = await createRunContext('/tmp/extractor', {
    outputDir: './output',
    userDataDir: './.browser-profile',
    timezone: 'Asia/Shanghai'
  }, new Date('2026-03-24T00:30:00.000Z'));

  assert.equal(context.snapshotDate, '2026-03-24');
  assert.match(context.csvPath, /recruiting\.csv$/);
  assert.match(context.summaryPath, /run-summary\.json$/);
});
```

- [ ] **Step 2: Run the config test and verify it fails**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- --test-name-pattern="loadConfig requires sourceUrl"`
Expected: FAIL with `Cannot find module '../scripts/lib/config'`.

- [ ] **Step 3: Implement the minimal source-only config loader and run context helper**

```js
const fs = require('fs/promises');
const path = require('path');

async function loadConfig(configPath) {
  const text = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(text);
  if (!config.sourceUrl) throw new Error('sourceUrl is required');
  return {
    timezone: config.timezone || 'Asia/Shanghai',
    outputDir: config.outputDir || './output',
    userDataDir: config.userDataDir || './.browser-profile',
    ...config,
  };
}

function resolvePackagePath(rootDir, relativePath) {
  return path.resolve(rootDir, relativePath);
}

function resolveConfigPath(argv, cwd = process.cwd()) {
  const flagIndex = argv.indexOf('--config');
  const relativePath = flagIndex >= 0 ? argv[flagIndex + 1] : 'config/extractor.config.local.json';
  return path.resolve(cwd, relativePath);
}

module.exports = { loadConfig, resolvePackagePath, resolveConfigPath };
```

```js
const fs = require('fs/promises');
const path = require('path');

async function createRunContext(rootDir, config, now = new Date()) {
  const startedAt = now.toISOString();
  const runId = startedAt.replace(/[:.]/g, '-');
  const outputRoot = path.resolve(rootDir, config.outputDir || './output');
  const outputDir = path.join(outputRoot, runId);
  const networkDir = path.join(outputDir, 'network');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(networkDir, { recursive: true });

  return {
    startedAt,
    runId,
    snapshotDate: new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone || 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now),
    outputDir,
    networkDir,
    csvPath: path.join(outputDir, 'recruiting.csv'),
    summaryPath: path.join(outputDir, 'run-summary.json'),
    userDataDir: path.resolve(rootDir, config.userDataDir || './.browser-profile'),
  };
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { createRunContext, writeJson };
```

- [ ] **Step 4: Write the failing table-helper tests for row cleanup and CSV writing**

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanRows, rowsToCsv } = require('../scripts/lib/table');

test('cleanRows trims trailing empty rows and columns', () => {
  assert.deepEqual(cleanRows([
    ['公司名称', '招聘岗位', ''],
    ['示例公司', '后端工程师', ''],
    ['', '', '']
  ]), [
    ['公司名称', '招聘岗位'],
    ['示例公司', '后端工程师']
  ]);
});

test('rowsToCsv quotes commas and newlines', () => {
  assert.equal(
    rowsToCsv([['company_name', 'job_title_raw'], ['ACME', '算法,平台\n工程师']]),
    'company_name,job_title_raw\nACME,"算法,平台\n工程师"'
  );
});

test('writeCsv writes headers and rows to disk', async () => {
  const fs = require('fs/promises');
  const os = require('os');
  const path = require('path');
  const { writeCsv } = require('../scripts/lib/table');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'extractor-csv-'));
  const csvPath = path.join(tempDir, 'recruiting.csv');

  await writeCsv(csvPath, ['company_name'], [{ company_name: 'ACME' }]);
  assert.equal(await fs.readFile(csvPath, 'utf8'), 'company_name\nACME');
});
```

- [ ] **Step 5: Run the table-helper tests and verify they fail**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- --test-name-pattern="cleanRows|rowsToCsv"`
Expected: FAIL because `../scripts/lib/table` does not exist.

- [ ] **Step 6: Port the minimal table helpers from the baseline package**

```js
function normalizeCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function cleanRows(rows) {
  return rows
    .map((row) => row.map((cell) => normalizeCell(cell)))
    .map((row) => {
      let end = row.length;
      while (end > 0 && row[end - 1].trim() === '') end -= 1;
      return row.slice(0, end);
    })
    .filter((row) => row.some((cell) => cell.trim() !== ''));
}

function parseDelimitedText(text) {
  if (!text || !text.trim()) return [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const delimiter = lines.some((line) => line.includes('\t')) ? '\t' : ',';
  return cleanRows(lines.map((line) => line.split(delimiter)));
}

function rowsToTsv(rows) {
  return rows.map((row) => row.map((cell) => normalizeCell(cell)).join('\t')).join('\n');
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map((cell) => /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(',')).join('\n');
}

function contentHash(rows) {
  return require('node:crypto').createHash('sha1').update(JSON.stringify(rows)).digest('hex');
}

function detectEncodingIssues(rows) {
  const issues = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (/\uFFFD/.test(cell)) issues.push({ row: rowIndex + 1, column: columnIndex + 1, issue: 'replacement_char' });
    });
  });
  return issues;
}

async function parseExportedFile(filePath) {
  const fs = require('fs/promises');
  const path = require('path');
  const XLSX = require('xlsx');
  if (path.extname(filePath).toLowerCase() === '.csv') {
    return { sheetName: path.basename(filePath), rows: parseDelimitedText(await fs.readFile(filePath, 'utf8')) };
  }

  const workbook = XLSX.readFile(filePath, { raw: false, cellText: true });
  const firstSheetName = workbook.SheetNames[0];
  return {
    sheetName: firstSheetName,
    rows: cleanRows(XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, raw: false, blankrows: false })),
  };
}

async function writeCsv(filePath, headers, records) {
  const fs = require('fs/promises');
  const path = require('path');
  const rows = [headers, ...records.map((record) => headers.map((header) => String(record[header] ?? '')))];
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, rowsToCsv(rows), 'utf8');
}

async function writeRowsArtifacts(outputDir, rows, filePrefix) {
  const fs = require('fs/promises');
  const path = require('path');
  const jsonPath = path.join(outputDir, `${filePrefix}.json`);
  const csvPath = path.join(outputDir, `${filePrefix}.csv`);
  await fs.writeFile(jsonPath, JSON.stringify({ rows }, null, 2), 'utf8');
  await fs.writeFile(csvPath, rowsToCsv(rows), 'utf8');
  return { jsonPath, csvPath };
}

module.exports = {
  cleanRows,
  contentHash,
  detectEncodingIssues,
  parseDelimitedText,
  parseExportedFile,
  rowsToCsv,
  rowsToTsv,
  writeCsv,
  writeRowsArtifacts,
};
```

- [ ] **Step 7: Run the package test suite and verify the new helpers pass**

Run: `npm run test:extractor`
Expected: PASS for `config.test.js` and `table.test.js`.

- [ ] **Step 8: Commit the source-only foundation**

```bash
git add package.json package-lock.json packages/tencent-docs-recruiting-extractor
git commit -m "test: add source-only config and table foundations"
```

- [ ] **Step 9: Write down the required dependency inventory for phase one**

Add this section to `packages/tencent-docs-recruiting-extractor/README.md`:

```md
## Phase-one dependency inventory

Required runtime:

- `playwright`
- `xlsx`

Required local runtime paths/config:

- `config/extractor.config.local.json` when commands run inside the package workspace
- `output/` for run artifacts
- `.browser-profile/` for Tencent Docs login persistence

Not carried over from the baseline flow:

- target sync scripts
- scheduler scripts
- runtime lock/state files
```

- [ ] **Step 10: Port the minimal source-side extraction chain unchanged enough to smoke-test it**

Copy these files from `vendor/tencent-docs-extractor-baseline/` into `packages/tencent-docs-recruiting-extractor/` before deeper refactors:

- `scripts/lib/browser.js`
- `scripts/export-source.js`
- `scripts/auth-check.js`
- `scripts/login-healthcheck.js`

Allowed edits in this step:

- swap imports from `env.js` to `config.js` / `run-context.js`
- remove target URL requirements
- remove target readiness checks

Do not change the extraction strategy yet.

- [ ] **Step 11: Add a temporary smoke path that proves `source -> rows -> csv` works before contract enrichment**

Create a temporary implementation in `packages/tencent-docs-recruiting-extractor/scripts/extract-once.js` that:

- loads config
- opens the Tencent Docs session
- exports source rows
- writes `raw-source.csv` using `rowsToCsv(exported.rows)` plus `fs.writeFile`

This temporary output can be deleted in Task 4 once the fixed contract is wired.

- [ ] **Step 12: Run the live smoke test against a local config before deeper refactors**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor run extract -- --config config/extractor.config.local.json`
Expected: one output folder containing `raw-source.csv` created from the live source document.

- [ ] **Step 13: Commit the proven minimal extraction chain**

```bash
git add packages/tencent-docs-recruiting-extractor
git commit -m "test: prove minimal source extraction chain"
```

### Task 3: Implement The Fixed CSV Contract And Stable Record Mapping

**Files:**
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/contract.js`
- Create: `packages/tencent-docs-recruiting-extractor/scripts/normalize-records.js`
- Create: `packages/tencent-docs-recruiting-extractor/tests/contract.test.js`
- Create: `packages/tencent-docs-recruiting-extractor/tests/fixtures/raw-source-rows.json`
- Modify: `packages/tencent-docs-recruiting-extractor/README.md`

- [ ] **Step 1: Add a tiny fixture that matches the current Tencent Docs column shape**

```json
[
  ["序号", "公司名称", "批次", "企业性质", "行业大类", "招聘对象", "招聘岗位", "网申状态", "工作地点", "更新时间", "截止时间", "官方公告", "投递方式", "内推码/备注", "官方公告_URL", "投递方式_URL"],
  ["1827", "南方电网", "春招", "央国企", "能源", "2026届 本科及以上", "电气类业务", "招聘中", "广东", "2026.03.13", "2026.03.23", "南方电网", "投递链接", "央企", "https://example.com/notice", "https://example.com/apply"]
]
```

- [ ] **Step 2: Write the failing CSV-contract tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const rows = require('./fixtures/raw-source-rows.json');

const { CSV_HEADERS, normalizeRowsToRecords } = require('../scripts/normalize-records');

test('normalizeRowsToRecords emits the fixed header order', () => {
  assert.deepEqual(CSV_HEADERS, [
    'record_id', 'snapshot_date', 'company_name', 'batch', 'company_type', 'industry',
    'target_candidates', 'job_title_raw', 'job_status_raw', 'location_raw', 'updated_at_raw',
    'deadline_raw', 'official_notice_text', 'apply_text', 'remark_raw', 'official_notice_url',
    'apply_url', 'job_keywords', 'major_keywords', 'location_tokens', 'degree_level',
    'is_closed', 'is_expired', 'deadline_date', 'updated_date', 'source_url', 'extracted_at'
  ]);
});

test('normalizeRowsToRecords creates one stable record per source row', () => {
  const result = normalizeRowsToRecords(rows, {
    snapshotDate: '2026-03-24',
    extractedAt: '2026-03-24T10:00:00.000Z',
    sourceUrl: 'https://docs.qq.com/sheet/demo'
  });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].company_name, '南方电网');
  assert.equal(result.records[0].job_keywords, '电气类业务');
  assert.equal(result.records[0].major_keywords, '电气类');
  assert.equal(result.records[0].location_tokens, '广东');
  assert.equal(result.records[0].is_closed, 'false');
  assert.equal(result.records[0].is_expired, 'false');
  assert.equal(result.records[0].updated_date, '2026-03-13');
  assert.equal(result.records[0].deadline_date, '2026-03-23');
  assert.equal(result.records[0].degree_level, '本科');
  assert.match(result.records[0].record_id, /^[a-f0-9]{64}$/);
});

test('normalizeRowsToRecords rejects same-snapshot record_id collisions', () => {
  try {
    normalizeRowsToRecords([rows[0], rows[1], rows[1]], {
      snapshotDate: '2026-03-24',
      extractedAt: '2026-03-24T10:00:00.000Z',
      sourceUrl: 'https://docs.qq.com/sheet/demo'
    });
    assert.fail('expected collision');
  } catch (error) {
    assert.match(error.message, /record_id collision/);
    assert.deepEqual(error.collisionSample.conflictingRows.length, 2);
  }
});

test('normalizeRowsToRecords fails loudly when required columns are missing', () => {
  assert.throws(() => normalizeRowsToRecords([
    ['公司名称', '招聘岗位'],
    ['南方电网', '电气类业务']
  ], {
    snapshotDate: '2026-03-24',
    extractedAt: '2026-03-24T10:00:00.000Z',
    sourceUrl: 'https://docs.qq.com/sheet/demo'
  }), /missing required columns: 工作地点, 更新时间, 截止时间/);
});
```

- [ ] **Step 3: Run the contract tests and verify they fail**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- --test-name-pattern="normalizeRowsToRecords"`
Expected: FAIL with `Cannot find module '../scripts/normalize-records'`.

- [ ] **Step 4: Implement the contract module with a fixed header list and stable id generation**

```js
const crypto = require('crypto');

const CSV_HEADERS = [
  'record_id', 'snapshot_date', 'company_name', 'batch', 'company_type', 'industry',
  'target_candidates', 'job_title_raw', 'job_status_raw', 'location_raw', 'updated_at_raw',
  'deadline_raw', 'official_notice_text', 'apply_text', 'remark_raw', 'official_notice_url',
  'apply_url', 'job_keywords', 'major_keywords', 'location_tokens', 'degree_level',
  'is_closed', 'is_expired', 'deadline_date', 'updated_date', 'source_url', 'extracted_at'
];

function buildRecordId(record) {
  const baseKey = [
    normalizeIdentityValue(record.company_name),
    normalizeIdentityValue(record.job_title_raw),
    normalizeIdentityValue(record.location_raw),
    normalizeIdentityValue(record.deadline_date || record.deadline_raw),
    normalizeIdentityValue(record.apply_url || record.official_notice_url),
    normalizeIdentityValue(record.official_notice_text),
  ].join('||');

  return crypto.createHash('sha256').update(baseKey).digest('hex');
}

function normalizeIdentityValue(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u3000\s]+/g, ' ')
    .replace(/[，。；;、]+$/g, '')
    .trim()
    .toLowerCase();
}

module.exports = { CSV_HEADERS, buildRecordId, normalizeIdentityValue };
```

- [ ] **Step 5: Implement `normalize-records.js` so raw Tencent rows become fixed contract records**

```js
const { CSV_HEADERS, buildRecordId } = require('./lib/contract');

function parseDate(raw) {
  const normalized = String(raw || '').trim().replace(/\./g, '-').replace(/\//g, '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return '';
  return normalized;
}

function uniqueTokens(tokens) {
  return [...new Set(tokens.filter(Boolean))];
}

function splitLocationTokens(raw) {
  return uniqueTokens(String(raw || '').split(/[\s,，/；;、]+/).map((token) => token.trim())).join('|');
}

function extractJobKeywords(raw) {
  return uniqueTokens(String(raw || '').split(/[\s,，/；;、]+/).map((token) => token.trim())).join('|');
}

function extractMajorKeywords(...texts) {
  const matches = texts.flatMap((text) => String(text || '').match(/[A-Za-z\u4e00-\u9fa5]+(?:专业|类|方向)/g) || []);
  return uniqueTokens(matches).join('|');
}

function deriveDegreeLevel(raw) {
  const text = String(raw || '');
  const levels = [
    ['博士', /博士/],
    ['硕士', /硕士/],
    ['本科', /本科/],
    ['专科', /大专|专科/],
    ['不限', /不限/],
  ].filter(([, pattern]) => pattern.test(text)).map(([label]) => label);

  return levels.length ? levels.join('|') : text.trim();
}

function normalizeRowsToRecords(rows, meta) {
  const [headerRow, ...dataRows] = rows;
  const index = Object.fromEntries(headerRow.map((name, i) => [name, i]));
  const seenRecordIds = new Set();
  const recordIdToRows = new Map();
  const requiredHeaders = ['公司名称', '招聘岗位', '工作地点', '更新时间', '截止时间'];
  const missingHeaders = requiredHeaders.filter((name) => !(name in index));

  if (missingHeaders.length) {
    throw new Error(`missing required columns: ${missingHeaders.join(', ')}`);
  }

  const records = dataRows.map((row) => {
    const updatedDate = parseDate(row[index['更新时间']]);
    const deadlineDate = parseDate(row[index['截止时间']]);
    const record = {
      snapshot_date: meta.snapshotDate,
      company_name: row[index['公司名称']] || '',
      batch: row[index['批次']] || '',
      company_type: row[index['企业性质']] || '',
      industry: row[index['行业大类']] || '',
      target_candidates: row[index['招聘对象']] || '',
      job_title_raw: row[index['招聘岗位']] || '',
      job_status_raw: row[index['网申状态']] || '',
      location_raw: row[index['工作地点']] || '',
      updated_at_raw: row[index['更新时间']] || '',
      deadline_raw: row[index['截止时间']] || '',
      official_notice_text: row[index['官方公告']] || '',
      apply_text: row[index['投递方式']] || '',
      remark_raw: row[index['内推码/备注']] || '',
      official_notice_url: row[index['官方公告_URL']] || '',
      apply_url: row[index['投递方式_URL']] || '',
      job_keywords: extractJobKeywords(row[index['招聘岗位']]),
      major_keywords: extractMajorKeywords(row[index['招聘岗位']], row[index['招聘对象']], row[index['内推码/备注']]),
      location_tokens: splitLocationTokens(row[index['工作地点']]),
      degree_level: deriveDegreeLevel(row[index['招聘对象']]),
      is_closed: /招满|已结束/.test(row[index['网申状态']] || '') ? 'true' : 'false',
      is_expired: deadlineDate !== '' && deadlineDate < meta.snapshotDate ? 'true' : 'false',
      deadline_date: deadlineDate,
      updated_date: updatedDate,
      source_url: meta.sourceUrl,
      extracted_at: meta.extractedAt,
    };

    record.record_id = buildRecordId(record);
    if (seenRecordIds.has(record.record_id)) {
      const error = new Error(`record_id collision: ${record.record_id}`);
      error.collisionSample = {
        recordId: record.record_id,
        conflictingRows: [...(recordIdToRows.get(record.record_id) || []), row],
      };
      throw error;
    }
    seenRecordIds.add(record.record_id);
    recordIdToRows.set(record.record_id, [...(recordIdToRows.get(record.record_id) || []), row]);
    return record;
  });

  return { headers: CSV_HEADERS, records };
}

module.exports = { CSV_HEADERS, normalizeRowsToRecords };
```

- [ ] **Step 6: Run the contract tests and make them pass**

Run: `npm run test:extractor`
Expected: PASS for `contract.test.js`, plus the earlier helper tests.

- [ ] **Step 7: Document the CSV contract in human-readable form**

Add this section to `packages/tencent-docs-recruiting-extractor/README.md`:

```md
## Fixed CSV contract

Headers:

- `record_id`, `snapshot_date`, `company_name`, `batch`, `company_type`, `industry`
- `target_candidates`, `job_title_raw`, `job_status_raw`, `location_raw`, `updated_at_raw`, `deadline_raw`
- `official_notice_text`, `apply_text`, `remark_raw`, `official_notice_url`, `apply_url`
- `job_keywords`, `major_keywords`, `location_tokens`, `degree_level`, `is_closed`, `is_expired`
- `deadline_date`, `updated_date`, `source_url`, `extracted_at`

Rules:

- `snapshot_date`: `YYYY-MM-DD` in `Asia/Shanghai`
- `updated_date` and `deadline_date`: parsed `YYYY-MM-DD` when possible, else empty string
- `record_id`: SHA-256 of normalized `company_name + job_title_raw + location_raw + deadline + link + official_notice_text`
- duplicate `record_id` values in the same extraction run write `record-id-collision.json` and fail the run
```

- [ ] **Step 8: Commit the fixed CSV contract**

```bash
git add packages/tencent-docs-recruiting-extractor/README.md packages/tencent-docs-recruiting-extractor/scripts packages/tencent-docs-recruiting-extractor/tests
git commit -m "feat: add recruiting csv contract mapping"
```

### Task 4: Build A Source-Only CLI That Produces CSV And Run Metadata

**Files:**
- Modify: `packages/tencent-docs-recruiting-extractor/scripts/lib/browser.js`
- Modify: `packages/tencent-docs-recruiting-extractor/scripts/auth-check.js`
- Modify: `packages/tencent-docs-recruiting-extractor/scripts/export-source.js`
- Modify: `packages/tencent-docs-recruiting-extractor/scripts/login-healthcheck.js`
- Modify: `packages/tencent-docs-recruiting-extractor/scripts/extract-once.js`
- Create: `packages/tencent-docs-recruiting-extractor/tests/extract-once.test.js`

- [ ] **Step 1: Write the failing CLI orchestration test using dependency injection**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { runExtract } = require('../scripts/extract-once');

test('runExtract writes one recruiting.csv and one run-summary.json', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'extract-run-'));

  const result = await runExtract({
    rootDir,
    config: {
      sourceUrl: 'https://docs.qq.com/sheet/demo',
      outputDir: './output',
      userDataDir: './.browser-profile',
      timezone: 'Asia/Shanghai'
    },
    openContext: async () => ({ close: async () => {} }),
    exportSource: async () => ({ ok: true, rows: require('./fixtures/raw-source-rows.json') })
  });

  const files = await fs.readdir(result.outputDir);
  assert(files.includes('recruiting.csv'));
  assert(files.includes('run-summary.json'));
});

test('runExtract persists a failure summary when extraction fails', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'extract-run-fail-'));

  await assert.rejects(() => runExtract({
    rootDir,
    config: {
      sourceUrl: 'https://docs.qq.com/sheet/demo',
      outputDir: './output',
      userDataDir: './.browser-profile',
      timezone: 'Asia/Shanghai'
    },
    openContext: async () => ({ close: async () => {} }),
    exportSource: async () => ({ ok: false, error: 'boom' })
  }), /boom/);
});
```

- [ ] **Step 2: Run the CLI orchestration test and verify it fails**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- --test-name-pattern="runExtract writes one recruiting.csv"`
Expected: FAIL because `runExtract` is not implemented.

- [ ] **Step 3: Refine the already-ported source-side helpers to expose the final API**

At this point the files already exist from Task 2. Tighten them so the final package contract is explicit:

- `scripts/lib/browser.js` exports exactly: `openContext`, `openPage`, `waitForReady`, `exportSourceRows`
- `scripts/export-source.js` exports exactly: `exportSource`
- `scripts/auth-check.js` exports exactly: `authCheck`
- `scripts/login-healthcheck.js` stays a thin CLI wrapper only

```js
async function exportSource(runContext, context, config, report) {
  const page = await openPage(context, config.sourceUrl);
  await waitForReady(page, report, 'source-export');
  const result = await exportSourceRows(page, runContext.outputDir, report);
  await page.close().catch(() => {});
  return result;
}

module.exports = { exportSource };
```

- [ ] **Step 4: Keep the source-only auth wrapper thin and reusable**

```js
const { openContext, openPage, waitForReady } = require('./lib/browser');

async function authCheck(runContext, config, report) {
  const context = await openContext(runContext, report);
  try {
    const sourcePage = await openPage(context, config.sourceUrl);
    const source = await waitForReady(sourcePage, report, 'source');

    return {
      context,
      source,
      accountId: source.userInfo?.userId || null,
      ok: Boolean(source.canRead),
    };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

module.exports = { authCheck };
```

- [ ] **Step 5: Implement the new source-only entrypoint with no target-write imports**

```js
async function runExtract({ rootDir, config, openContext = browser.openContext, exportSource = sourceExport.exportSource }) {
  const runContext = await createRunContext(rootDir, config);
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sourceUrl: config.sourceUrl,
    rowCount: 0,
    ok: false,
    error: null,
    errors: []
  };
  const context = await openContext(runContext, report);

  try {
    const exported = await exportSource(runContext, context, config, report);
    if (!exported.ok) throw new Error(exported.error || 'Failed to export source rows');

    const normalized = normalizeRowsToRecords(exported.rows, {
      snapshotDate: runContext.snapshotDate,
      extractedAt: runContext.startedAt,
      sourceUrl: config.sourceUrl,
    });

    report.finishedAt = new Date().toISOString();
    report.rowCount = normalized.records.length;
    report.ok = true;
    await writeCsv(runContext.csvPath, normalized.headers, normalized.records);
    await writeJson(runContext.summaryPath, report);
    return runContext;
  } catch (error) {
    report.finishedAt = new Date().toISOString();
    report.ok = false;
    report.error = error.message;
    if (error.collisionSample) {
      await writeJson(path.join(runContext.outputDir, 'record-id-collision.json'), error.collisionSample);
    }
    await writeJson(runContext.summaryPath, report);
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { runExtract };
```

- [ ] **Step 6: Add the actual CLI `main()` wrapper around `runExtract`**

```js
async function main() {
  const configPath = resolveConfigPath(process.argv);
  const config = await loadConfig(configPath);
  const runContext = await runExtract({ rootDir: process.cwd(), config });
  console.log(`CSV_PATH=${runContext.csvPath}`);
  console.log(`SUMMARY_PATH=${runContext.summaryPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
```

- [ ] **Step 7: Add a source-only healthcheck command**

```js
async function main() {
  const config = await loadConfig(resolveConfigPath(process.argv));
  const runContext = await createRunContext(process.cwd(), config);
  const report = { permissionSnapshots: [], networkSamples: [], downloads: [], errors: [] };
  const result = await authCheck(runContext, config, report);

  console.log(JSON.stringify({
    ok: Boolean(result.source?.canRead),
    sourceCanRead: Boolean(result.source?.canRead),
    sourceCanExport: Boolean(result.source?.canExport),
    accountId: result.accountId,
  }, null, 2));
  await result.context.close();
}
```

- [ ] **Step 8: Run the full package test suite and make it pass**

Run: `npm run test:extractor`
Expected: PASS for config, table, contract, and CLI orchestration tests.

- [ ] **Step 9: Commit the source-only CLI**

```bash
git add packages/tencent-docs-recruiting-extractor
git commit -m "feat: add source-only extractor cli"
```

### Task 5: Verify The Minimal Extractor End-To-End And Document The Required File Set

**Files:**
- Modify: `packages/tencent-docs-recruiting-extractor/README.md`
- Modify: `vendor/tencent-docs-extractor-baseline/BASELINE.md`

- [ ] **Step 1: Write down the exact minimal file set required for source extraction**

Update `packages/tencent-docs-recruiting-extractor/README.md` with a checklist like:

```md
## Minimal source-extraction file set

- `package.json`
- `config/extractor.config.example.json`
- `scripts/extract-once.js`
- `scripts/login-healthcheck.js`
- `scripts/export-source.js`
- `scripts/normalize-records.js`
- `scripts/lib/browser.js`
- `scripts/lib/config.js`
- `scripts/lib/run-context.js`
- `scripts/lib/table.js`
- `scripts/lib/contract.js`
```

- [ ] **Step 2: Add manual smoke-test instructions with exact commands**

```md
## Manual smoke test

1. Copy `packages/tencent-docs-recruiting-extractor/config/extractor.config.example.json` to `packages/tencent-docs-recruiting-extractor/config/extractor.config.local.json`
2. Fill in a real `sourceUrl`
3. Run `npm install`
4. Run `npm run test:extractor`
5. Run `npm --workspace @zhaoping/tencent-docs-recruiting-extractor run healthcheck -- --config config/extractor.config.local.json`
6. Run `npm --workspace @zhaoping/tencent-docs-recruiting-extractor run extract -- --config config/extractor.config.local.json`
7. Confirm `output/<run-id>/recruiting.csv` and `output/<run-id>/run-summary.json` exist
```

- [ ] **Step 3: Execute the automated tests before the manual smoke test**

Run: `npm run test:extractor`
Expected: PASS.

- [ ] **Step 4: Run the live healthcheck against a local config**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor run healthcheck -- --config config/extractor.config.local.json`
Expected: JSON output with `sourceCanRead: true` once the Tencent Docs session is logged in.

- [ ] **Step 5: Run the live extract command and verify the deliverables**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor run extract -- --config config/extractor.config.local.json`
Expected: one new output folder containing `recruiting.csv` and `run-summary.json`.

- [ ] **Step 6: Record the verified minimal dependency set in the baseline notes**

Append to `vendor/tencent-docs-extractor-baseline/BASELINE.md`:

```md
## Verified as phase-one necessary

- source-side Playwright browser helpers
- source export flow
- row cleanup helpers
- xlsx parsing for exported files

## Verified as intentionally excluded from the working package

- target write logic
- sync verification against target docs
- scheduler scripts
- runtime state lock files
```

- [ ] **Step 7: Commit the verification and documentation pass**

```bash
git add vendor/tencent-docs-extractor-baseline/BASELINE.md packages/tencent-docs-recruiting-extractor/README.md
git commit -m "docs: record extractor verification workflow"
```

## Done Criteria

- The repo contains an untouched trimmed baseline snapshot of the original extractor
- The working package can run without importing target-write or scheduler modules
- The working package emits one fixed CSV contract and one run summary per extraction run
- The required file/dependency set for source-only extraction is documented
- Automated tests cover config loading, table helpers, CSV contract mapping, and CLI orchestration
- Manual smoke-test instructions are written and verified against a local Tencent Docs config
