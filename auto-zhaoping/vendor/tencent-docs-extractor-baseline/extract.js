const { chromium } = require('playwright');
const fs = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');

const DOC_URL = process.argv[2] || 'https://docs.qq.com/sheet/REPLACE_ME';
const ROOT_DIR = __dirname;
const USER_DATA_DIR = path.join(ROOT_DIR, '.browser-profile');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = path.join(ROOT_DIR, 'output', RUN_ID);
const NETWORK_DIR = path.join(OUTPUT_DIR, 'network');
const REPORT_PATH = path.join(OUTPUT_DIR, 'report.json');
const RESULT_JSON_PATH = path.join(OUTPUT_DIR, 'table.json');
const RESULT_CSV_PATH = path.join(OUTPUT_DIR, 'table.csv');
const CLIPBOARD_PATH = path.join(OUTPUT_DIR, 'clipboard.txt');
const SCREENSHOT_PATH = path.join(OUTPUT_DIR, 'final.png');

const MAX_NETWORK_SAMPLES = 25;
const LOGIN_WAIT_MS = 10 * 60 * 1000;
const SHORT_WAIT_MS = 2500;
let networkSampleCounter = 0;

const report = {
  docUrl: DOC_URL,
  startedAt: new Date().toISOString(),
  stages: [],
  permissionSnapshots: [],
  networkSamples: [],
  downloads: [],
  extractedFrom: null,
  errors: [],
};

function log(message) {
  const line = `[extractor] ${message}`;
  report.stages.push({ at: new Date().toISOString(), message });
  console.log(line);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function stringifyCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyCell).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const keys = ['text', 'displayText', 'formattedText', 'value', 'v', 'm', 'label', 'title', 'name'];
    for (const key of keys) {
      if (key in value) {
        const text = stringifyCell(value[key]);
        if (text) return text;
      }
    }
  }
  return '';
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = stringifyCell(cell).replace(/\r?\n/g, ' ');
          if (/[",\n]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
          }
          return text;
        })
        .join(',')
    )
    .join('\n');
}

function parseTabularText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (!lines.length) return null;

  const delimiter = lines.some((line) => line.includes('\t')) ? '\t' : null;
  if (!delimiter) return null;

  const rows = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  const hasMultipleCols = rows.some((row) => row.length > 1);
  return hasMultipleCols ? rows : null;
}

function scoreRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const nonEmptyRows = rows.filter((row) => Array.isArray(row) && row.some((cell) => stringifyCell(cell)));
  const maxCols = nonEmptyRows.reduce((max, row) => Math.max(max, row.length), 0);
  const cellCount = nonEmptyRows.reduce(
    (sum, row) => sum + row.filter((cell) => stringifyCell(cell)).length,
    0
  );
  return nonEmptyRows.length * 10 + maxCols * 5 + cellCount;
}

function isProbableDocumentTable(rows) {
  const normalized = normalizeRows(rows);
  if (!normalized.length) return false;
  const flattened = normalized.flat();
  const componentLike = flattened.filter((cell) => /^docs-component-/.test(cell)).length;
  const eagerLike = flattened.filter((cell) => /^(EAGER|ON_DEMAND)$/.test(cell)).length;
  if (flattened.length && componentLike + eagerLike > flattened.length * 0.7) {
    return false;
  }
  return scoreRows(normalized) >= 20;
}

function normalizeRows(rows) {
  return rows
    .map((row) => row.map((cell) => stringifyCell(cell)))
    .filter((row) => row.some((cell) => cell));
}

function collectCandidateTables(value, candidates = [], trail = []) {
  if (!value) return candidates;

  if (Array.isArray(value)) {
    if (value.length && value.every((item) => Array.isArray(item))) {
      const normalized = normalizeRows(value);
      if (scoreRows(normalized) >= 20) {
        candidates.push({ source: trail.join('.'), rows: normalized, score: scoreRows(normalized) });
      }
    }

    if (value.length && value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const rowLike = value.map((item) => {
        if (Array.isArray(item.cells)) return item.cells;
        if (Array.isArray(item.values)) return item.values;
        return Object.values(item);
      });
      const normalized = normalizeRows(rowLike);
      if (scoreRows(normalized) >= 20) {
        candidates.push({ source: trail.join('.'), rows: normalized, score: scoreRows(normalized) });
      }
    }

    value.forEach((item, index) => collectCandidateTables(item, candidates, trail.concat(String(index))));
    return candidates;
  }

  if (typeof value === 'object') {
    const rowKeys = ['rows', 'data', 'cells', 'sheetData', 'table', 'tableData', 'gridData'];
    for (const key of rowKeys) {
      if (Array.isArray(value[key])) {
        collectCandidateTables(value[key], candidates, trail.concat(key));
      }
    }

    for (const [key, nested] of Object.entries(value)) {
      if (nested && (typeof nested === 'object' || Array.isArray(nested))) {
        collectCandidateTables(nested, candidates, trail.concat(key));
      }
    }
  }

  return candidates;
}

async function saveResult(rows, source) {
  const normalized = normalizeRows(rows);
  if (!isProbableDocumentTable(normalized)) return false;

  await writeJson(RESULT_JSON_PATH, { source, rows: normalized });
  await fs.writeFile(RESULT_CSV_PATH, toCsv(normalized), 'utf8');
  report.extractedFrom = source;
  return true;
}

async function readClipboard() {
  try {
    return execFileSync('pbpaste', { encoding: 'utf8' });
  } catch (error) {
    report.errors.push(`clipboard-read: ${error.message}`);
    return '';
  }
}

function looksInteresting(url, text) {
  if (!/docs\.qq\.com|docs\.gtimg\.com|gtimg\.com/.test(url)) return false;
  if (/\/components\/|\/blankpage\/|assets\.v1\.json|metadata\.v1\.json|\.css($|\?)/i.test(url)) return false;
  if (!text || text.length < 80) return false;
  return /(sheet|cell|row|col|table|grid|clipboard|copy|export|tab|padId|sheetData|range)/i.test(text);
}

async function recordNetworkResponse(response) {
  try {
    if (report.networkSamples.length >= MAX_NETWORK_SAMPLES) return;
    const url = response.url();
    const resourceType = response.request().resourceType();
    const headers = response.headers();
    const contentType = headers['content-type'] || '';
    if (!['xhr', 'fetch', 'document'].includes(resourceType)) return;
    if (!/(json|text)/i.test(contentType)) return;
    const body = await response.text();
    if (!looksInteresting(url, body)) return;

    networkSampleCounter += 1;
    const baseName = `sample-${String(networkSampleCounter).padStart(2, '0')}.txt`;
    const fileName = path.join(NETWORK_DIR, baseName);
    await fs.writeFile(fileName, body.slice(0, 200000), 'utf8');

    report.networkSamples.push({
      url,
      contentType,
      resourceType,
      status: response.status(),
      savedTo: fileName,
    });
  } catch (error) {
    report.errors.push(`network-capture: ${error.message}`);
  }
}

async function snapshotPermissions(page, label) {
  try {
    const snapshot = await page.evaluate(() => {
      const attr = window.basicClientVars?.authInfo?.attribute || null;
      const docInfo = window.basicClientVars?.docInfo?.padInfo || null;
      const userInfo = window.basicClientVars?.userInfo || null;
      return {
        title: document.title,
        attr,
        docInfo,
        userInfo,
        location: location.href,
      };
    });
    report.permissionSnapshots.push({ label, at: new Date().toISOString(), snapshot });
    return snapshot;
  } catch (error) {
    report.errors.push(`permission-snapshot(${label}): ${error.message}`);
    return null;
  }
}

async function waitForAuthorizedView(page) {
  log('Waiting for manual login or document render');
  const start = Date.now();

  while (Date.now() - start < LOGIN_WAIT_MS) {
    const snapshot = await snapshotPermissions(page, 'poll');
    const attr = snapshot?.attr || {};
    const userType = snapshot?.userInfo?.userType || 'guest';
    const canRead = Boolean(attr.canRead);
    const canExport = Boolean(attr.canExport);
    const isLoggedIn = Boolean(attr.isAuth) || userType !== 'guest';

    if (canRead) {
      return { ready: true, loggedIn: isLoggedIn, canRead: true, canExport };
    }

    if (isLoggedIn) {
      await sleep(3000);
      return { ready: true, loggedIn: true, canRead: false, canExport };
    }

    await sleep(3000);
  }

  return { ready: false, loggedIn: false, canRead: false, canExport: false };
}

async function tryDomExtraction(page) {
  log('Trying DOM extraction');
  const rows = await page.evaluate(() => {
    const selectors = [
      '[role="gridcell"]',
      '[role="cell"]',
      'td',
      '.sheet-cell',
      '.table-cell',
      '.cell',
    ];

    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return null;
          const text = [
            element.textContent,
            element.getAttribute('title'),
            element.getAttribute('aria-label'),
          ]
            .filter(Boolean)
            .join(' ')
            .trim();
          if (!text) return null;
          return {
            text,
            top: Math.round(rect.top),
            left: Math.round(rect.left),
          };
        })
        .filter(Boolean);

      if (elements.length >= 4) {
        const grouped = new Map();
        for (const item of elements) {
          const key = String(item.top);
          const row = grouped.get(key) || [];
          row.push(item);
          grouped.set(key, row);
        }

        return Array.from(grouped.values())
          .map((row) => row.sort((a, b) => a.left - b.left).map((item) => item.text))
          .filter((row) => row.length > 0);
      }
    }

    return [];
  });

  if (isProbableDocumentTable(rows)) {
    return rows;
  }
  return null;
}

async function focusSheet(page) {
  const selectors = ['canvas', '[role="grid"]', '.sheet', '.sheet-app', 'body'];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.click({ timeout: 2000, force: true });
        return true;
      } catch (error) {
        report.errors.push(`focus(${selector}): ${error.message}`);
      }
    }
  }
  return false;
}

async function tryClipboardExtraction(page) {
  log('Trying clipboard extraction');
  await focusSheet(page);
  await sleep(500);

  for (let i = 0; i < 2; i += 1) {
    await page.keyboard.press('Meta+A');
    await sleep(200);
  }
  await page.keyboard.press('Meta+C');
  await sleep(1000);

  const clipboardText = await readClipboard();
  if (clipboardText) {
    await fs.writeFile(CLIPBOARD_PATH, clipboardText, 'utf8');
  }
  return parseTabularText(clipboardText);
}

async function tryUiDownload(page) {
  log('Trying page export or download actions');

  async function waitAndSaveDownload(actionLabel, clicker) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        clicker(),
      ]);
      const suggested = download.suggestedFilename();
      const savePath = path.join(OUTPUT_DIR, suggested);
      await download.saveAs(savePath);
      report.downloads.push({ label: actionLabel, path: savePath, suggestedFilename: suggested });
      return savePath;
    } catch (error) {
      report.errors.push(`download(${actionLabel}): ${error.message}`);
      return null;
    }
  }

  async function openFileMenu() {
    const fileButton = page.locator('[aria-label="file"]').first();
    if (!(await fileButton.count())) return false;
    await fileButton.click({ force: true, timeout: 5000 });
    await sleep(400);
    return true;
  }

  async function revealExportSubmenu() {
    const exportItem = page.getByRole('menuitem', { name: /导出为|Export/i }).first();
    if (!(await exportItem.count())) return false;
    await exportItem.hover({ force: true, timeout: 5000 }).catch(async () => {
      await exportItem.click({ force: true, timeout: 5000 });
    });
    await sleep(500);
    return true;
  }

  async function exportByLabel(actionLabel, itemPattern) {
    const opened = await openFileMenu();
    if (!opened) return null;
    const revealed = await revealExportSubmenu();
    if (!revealed) return null;

    const menuItem = page.getByRole('menuitem', { name: itemPattern }).first();
    if (!(await menuItem.count())) return null;

    return waitAndSaveDownload(actionLabel, () => menuItem.click({ force: true, timeout: 5000 }));
  }

  const downloadedFiles = [];
  const xlsxPath = await exportByLabel('xlsx', /本地Excel表格|\.xlsx|Excel/i);
  if (xlsxPath) downloadedFiles.push(xlsxPath);
  const csvPath = await exportByLabel('csv', /本地CSV文件|\.csv|CSV/i);
  if (csvPath) downloadedFiles.push(csvPath);

  if (downloadedFiles.length) return downloadedFiles;

  const fallbackLabels = ['导出', '下载', '另存为', 'Export', 'Download'];
  for (const label of fallbackLabels) {
    const locator = page.getByText(label, { exact: false }).first();
    if (!(await locator.count())) continue;
    try {
      await locator.click({ timeout: 1500, force: true });
      await sleep(1000);
    } catch (error) {
      report.errors.push(`ui-click(${label}): ${error.message}`);
    }
  }

  for (const entry of [
    { label: 'xlsx-fallback', pattern: /xlsx|Excel/i },
    { label: 'csv-fallback', pattern: /csv|CSV/i },
  ]) {
    const locator = page.getByText(entry.pattern, { exact: false }).first();
    if (!(await locator.count())) continue;
    const savePath = await waitAndSaveDownload(entry.label, () => locator.click({ force: true, timeout: 5000 }));
    if (savePath) downloadedFiles.push(savePath);
  }

  return downloadedFiles;
}

async function tryNetworkExtraction() {
  log('Trying network response extraction');
  let best = null;
  for (const sample of report.networkSamples) {
    try {
      const text = await fs.readFile(sample.savedTo, 'utf8');
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        const match = text.match(/\{[\s\S]*\}$/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch {
            parsed = null;
          }
        }
      }

      if (!parsed) continue;
      const candidates = collectCandidateTables(parsed);
      for (const candidate of candidates) {
        if (!isProbableDocumentTable(candidate.rows)) continue;
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      }
    } catch (error) {
      report.errors.push(`network-parse(${sample.savedTo}): ${error.message}`);
    }
  }
  return best?.rows || null;
}

async function main() {
  await ensureDir(OUTPUT_DIR);
  await ensureDir(NETWORK_DIR);

  log(`Output directory: ${OUTPUT_DIR}`);
  log('Launching Chromium with persistent local profile');

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1440, height: 960 },
  });

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'https://docs.qq.com',
  }).catch(() => {});

  context.on('page', (page) => {
    page.on('response', (response) => {
      void recordNetworkResponse(response);
    });
  });

  const page = context.pages()[0] || (await context.newPage());
  page.on('response', (response) => {
    void recordNetworkResponse(response);
  });

  log('Browser opened. Please complete Tencent Docs login in the GUI if prompted.');
  await page.goto(DOC_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.bringToFront();
  await sleep(SHORT_WAIT_MS);
  await snapshotPermissions(page, 'after-goto');

  const ready = await waitForAuthorizedView(page);
  log(
    ready.ready
      ? `Document wait finished; loggedIn=${ready.loggedIn}, canRead=${ready.canRead}, canExport=${ready.canExport}`
      : 'Did not detect a logged-in authorized view before timeout'
  );

  if (ready.canRead) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await sleep(3000);
  }

  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }).catch(() => {});

  let downloadedFiles = [];
  if (ready.ready && ready.canExport) {
    downloadedFiles = await tryUiDownload(page);
    if (downloadedFiles.length) {
      log(`Export download succeeded: ${downloadedFiles.join(', ')}`);
      report.extractedFrom = 'export';
    } else {
      log('Export flow finished without downloaded files');
    }
  } else {
    log('Current session does not have export permission; trying fallback extraction');
    const domRows = ready.ready ? await tryDomExtraction(page) : null;
    if (domRows && (await saveResult(domRows, 'dom'))) {
      log(`DOM extraction succeeded: ${RESULT_CSV_PATH}`);
    } else {
      const clipboardRows = ready.ready ? await tryClipboardExtraction(page) : null;
      if (clipboardRows && (await saveResult(clipboardRows, 'clipboard'))) {
        log(`Clipboard extraction succeeded: ${RESULT_CSV_PATH}`);
      } else {
        const networkRows = await tryNetworkExtraction();
        if (networkRows && (await saveResult(networkRows, 'network'))) {
          log(`Network extraction succeeded: ${RESULT_CSV_PATH}`);
        } else {
          log('No extraction method produced a table yet');
        }
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  await writeJson(REPORT_PATH, report);

  if (report.extractedFrom) {
    downloadedFiles.forEach((filePath, index) => {
      console.log(`DOWNLOADED_FILE_${index + 1}=${filePath}`);
    });
    console.log(`REPORT_JSON=${REPORT_PATH}`);
    await context.close();
    return;
  }

  console.log(`REPORT_JSON=${REPORT_PATH}`);
  await context.close();
  process.exitCode = 2;
}

main().catch(async (error) => {
  report.finishedAt = new Date().toISOString();
  report.errors.push(error.stack || error.message);
  try {
    await ensureDir(OUTPUT_DIR);
    await writeJson(REPORT_PATH, report);
  } catch {
    // ignore
  }
  console.error(error);
  process.exit(1);
});
