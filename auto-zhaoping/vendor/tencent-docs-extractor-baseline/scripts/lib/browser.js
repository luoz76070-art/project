const fs = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');

const { chromium } = require('playwright');

const { ensureDir } = require('./env');
const { parseDelimitedText, parseExportedFile, rowsToTsv } = require('./table');

const LOGIN_WAIT_MS = 10 * 60 * 1000;

async function openContext(runContext, report) {
  await ensureDir(runContext.userDataDir);
  const context = await chromium.launchPersistentContext(runContext.userDataDir, {
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1440, height: 960 },
  });

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://docs.qq.com' }).catch(() => {});

  context.on('page', (page) => {
    page.on('response', async (response) => {
      try {
        if ((report.networkSamples || []).length >= 20) return;
        const requestType = response.request().resourceType();
        if (!['xhr', 'fetch', 'document'].includes(requestType)) return;
        const contentType = response.headers()['content-type'] || '';
        if (!/(json|text)/i.test(contentType)) return;
        const body = await response.text();
        if (!body || body.length < 80) return;
        const index = report.networkSamples.length + 1;
        const filePath = path.join(runContext.networkDir, `sample-${String(index).padStart(2, '0')}.txt`);
        await fs.writeFile(filePath, body.slice(0, 200000), 'utf8');
        report.networkSamples.push({ url: response.url(), status: response.status(), resourceType: requestType, filePath });
      } catch (error) {
        report.errors.push(`network_capture: ${error.message}`);
      }
    });
  });

  return context;
}

async function openPage(context, url) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.bringToFront();
  return page;
}

async function snapshotPermissions(page) {
  return page.evaluate(() => {
    const attr = window.basicClientVars?.authInfo?.attribute || {};
    const userInfo = window.basicClientVars?.userInfo || {};
    const docInfo = window.basicClientVars?.docInfo?.padInfo || {};
    return {
      attr,
      userInfo,
      docInfo,
      title: document.title,
      location: location.href,
      canRead: Boolean(attr.canRead),
      canExport: Boolean(attr.canExport),
      canEditTarget: Boolean(attr.canEdit || attr.canMultiEdit || attr.canFill),
      isLoggedIn: Boolean(attr.isAuth) || userInfo.userType !== 'guest',
    };
  });
}

async function waitForReady(page, report, label) {
  const start = Date.now();
  while (Date.now() - start < LOGIN_WAIT_MS) {
    const snapshot = await snapshotPermissions(page);
    report.permissionSnapshots.push({ label, at: new Date().toISOString(), snapshot });
    if (snapshot.canRead || snapshot.isLoggedIn) {
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);
      return snapshot;
    }
    await page.waitForTimeout(3000);
  }
  return await snapshotPermissions(page);
}

function readClipboardText() {
  try {
    return execFileSync('pbpaste', { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function writeClipboardText(text) {
  execFileSync('pbcopy', { input: text, encoding: 'utf8' });
}

async function focusTopLeftCell(page) {
  await page.waitForSelector('input.bar-label', { timeout: 15000 });
  const point = await page.evaluate(() => {
    const input = document.querySelector('input.bar-label');
    if (!input) return null;
    const rect = input.getBoundingClientRect();
    return {
      x: rect.left + 108,
      y: rect.bottom + 26,
    };
  });
  if (!point) throw new Error('Could not locate sheet coordinate input');
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(300);
}

async function selectAllUsedRange(page) {
  await focusTopLeftCell(page);
  await page.keyboard.press('Meta+A');
  await page.waitForTimeout(300);
}

async function copyCurrentSelection(page) {
  await page.keyboard.press('Meta+C');
  await page.waitForTimeout(800);
  return readClipboardText();
}

async function readUsedRangeRows(page) {
  await selectAllUsedRange(page);
  return parseDelimitedText(await copyCurrentSelection(page));
}

async function clearUsedRangeValues(page) {
  await selectAllUsedRange(page);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(800);
}

async function pasteRowsAtA1(page, rows) {
  await focusTopLeftCell(page);
  writeClipboardText(rowsToTsv(rows));
  await page.keyboard.press('Meta+V');
  await page.waitForTimeout(Math.min(8000, Math.max(1200, rows.length * 50)));
}

async function exportFromPage(page, outputDir, report) {
  async function waitAndSaveDownload(label, locator) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      locator.click({ force: true, timeout: 5000 }),
    ]);
    const suggestedFilename = download.suggestedFilename();
    const savePath = path.join(outputDir, suggestedFilename);
    await download.saveAs(savePath);
    report.downloads.push({ label, path: savePath, suggestedFilename });
    return savePath;
  }

  const fileButton = page.locator('[aria-label="file"]').first();
  if (!(await fileButton.count())) return [];
  await fileButton.click({ force: true, timeout: 5000 });
  await page.waitForTimeout(500);

  const exportMenu = page.getByRole('menuitem', { name: /导出为|Export/i }).first();
  if (!(await exportMenu.count())) return [];
  await exportMenu.hover({ force: true }).catch(async () => {
    await exportMenu.click({ force: true, timeout: 5000 });
  });
  await page.waitForTimeout(500);

  const files = [];
  const xlsxItem = page.getByRole('menuitem', { name: /本地Excel表格|\.xlsx|Excel/i }).first();
  if (await xlsxItem.count()) {
    files.push(await waitAndSaveDownload('xlsx', xlsxItem));
  }

  await fileButton.click({ force: true, timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  const exportMenuAgain = page.getByRole('menuitem', { name: /导出为|Export/i }).first();
  if (await exportMenuAgain.count()) {
    await exportMenuAgain.hover({ force: true }).catch(async () => {
      await exportMenuAgain.click({ force: true, timeout: 5000 });
    });
    await page.waitForTimeout(500);
    const csvItem = page.getByRole('menuitem', { name: /本地CSV文件|\.csv|CSV/i }).first();
    if (await csvItem.count()) {
      files.push(await waitAndSaveDownload('csv', csvItem));
    }
  }

  return files.filter(Boolean);
}

async function exportSourceRows(page, outputDir, report) {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const snapshot = await snapshotPermissions(page);
  if (snapshot.canExport) {
    const files = await exportFromPage(page, outputDir, report).catch((error) => {
      report.errors.push(`export_source: ${error.message}`);
      return [];
    });
    if (files.length) {
      const preferred = files.find((filePath) => filePath.toLowerCase().endsWith('.csv')) || files[0];
      const parsed = await parseExportedFile(preferred);
      return {
        ok: true,
        method: 'export',
        files,
        preferredFile: preferred,
        rows: parsed.rows,
        sheetName: parsed.sheetName,
      };
    }
  }

  if (snapshot.canRead) {
    const rows = await readUsedRangeRows(page);
    if (rows.length) {
      return {
        ok: true,
        method: 'clipboard',
        files: [],
        preferredFile: null,
        rows,
        sheetName: snapshot.docInfo?.padTitle || 'Sheet1',
      };
    }
  }

  return { ok: false, error: 'Unable to export or copy source rows' };
}

module.exports = {
  clearUsedRangeValues,
  copyCurrentSelection,
  exportSourceRows,
  focusTopLeftCell,
  openContext,
  openPage,
  pasteRowsAtA1,
  readUsedRangeRows,
  snapshotPermissions,
  waitForReady,
};
