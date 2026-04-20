const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { ensureDir } = require('./run-context');
const { parseDelimitedText, parseExportedFile, rowsToTsv } = require('./table');

const LOGIN_WAIT_MS = 10 * 60 * 1000;

function withReport(report) {
  return report || { downloads: [], errors: [], networkSamples: [], permissionSnapshots: [] };
}

async function openContext(runContext, report) {
  const activeReport = withReport(report);
  const { chromium } = require('playwright');

  await ensureDir(runContext.userDataDir);
  const context = await chromium.launchPersistentContext(runContext.userDataDir, {
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1440, height: 960 },
  });

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://docs.qq.com' }).catch(() => {});

  let captureIndex = 0;
  context.on('page', (page) => {
    page.on('response', async (response) => {
      try {
        if (activeReport.networkSamples.length >= 20) {
          return;
        }

        const requestType = response.request().resourceType();
        if (!['xhr', 'fetch', 'document'].includes(requestType)) {
          return;
        }

        const contentType = response.headers()['content-type'] || '';
        if (!/(json|text)/i.test(contentType)) {
          return;
        }

        const body = await response.text();
        if (!body || body.length < 80) {
          return;
        }

        captureIndex += 1;
        const index = captureIndex;
        const filePath = path.join(runContext.networkDir, `sample-${String(index).padStart(2, '0')}.txt`);
        await fs.writeFile(filePath, body.slice(0, 200000), 'utf8');
        activeReport.networkSamples.push({
          filePath,
          resourceType: requestType,
          status: response.status(),
          url: response.url(),
        });
      } catch (error) {
        activeReport.errors.push(`network_capture: ${error.message}`);
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
      canExport: Boolean(attr.canExport),
      canRead: Boolean(attr.canRead),
      docInfo,
      isLoggedIn: Boolean(attr.isAuth) || userInfo.userType !== 'guest',
      location: location.href,
      title: document.title,
      userInfo,
    };
  });
}

async function waitForReady(page, report, label) {
  const activeReport = withReport(report);
  const startedAt = Date.now();
  let hasSeenLogin = false;
  let lastSnapshot = null;

  while (Date.now() - startedAt < LOGIN_WAIT_MS) {
    const snapshot = await snapshotPermissions(page);
    lastSnapshot = snapshot;
    activeReport.permissionSnapshots.push({ at: new Date().toISOString(), label, snapshot });

    if (snapshot.canRead || snapshot.canExport) {
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);
      return snapshot;
    }

    if (snapshot.isLoggedIn && !hasSeenLogin) {
      hasSeenLogin = true;
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1000);
      continue;
    }

    await page.waitForTimeout(3000);
  }

  return lastSnapshot || snapshotPermissions(page);
}

function readClipboardText() {
  try {
    return execFileSync('pbpaste', { encoding: 'utf8' });
  } catch {
    return '';
  }
}

async function focusTopLeftCell(page) {
  await page.waitForSelector('input.bar-label', { timeout: 15000 });
  const point = await page.evaluate(() => {
    const input = document.querySelector('input.bar-label');
    if (!input) {
      return null;
    }

    const rect = input.getBoundingClientRect();
    return { x: rect.left + 108, y: rect.bottom + 26 };
  });

  if (!point) {
    throw new Error('Could not locate sheet coordinate input');
  }

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

async function exportFromPage(page, outputDir, report) {
  const activeReport = withReport(report);

  async function waitAndSaveDownload(label, locator) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      locator.click({ force: true, timeout: 5000 }),
    ]);

    const suggestedFilename = download.suggestedFilename();
    const savePath = path.join(outputDir, suggestedFilename);
    await download.saveAs(savePath);
    activeReport.downloads.push({ label, path: savePath, suggestedFilename });
    return savePath;
  }

  const fileButton = page.locator('[aria-label="file"]').first();
  if (!(await fileButton.count())) {
    return [];
  }

  await fileButton.click({ force: true, timeout: 5000 });
  await page.waitForTimeout(500);

  const exportMenu = page.getByRole('menuitem', { name: /导出为|Export/i }).first();
  if (!(await exportMenu.count())) {
    return [];
  }

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
  const activeReport = withReport(report);

  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const snapshot = await snapshotPermissions(page);

  if (snapshot.canExport) {
    const files = await exportFromPage(page, outputDir, activeReport).catch((error) => {
      activeReport.errors.push(`export_source: ${error.message}`);
      return [];
    });

    if (files.length > 0) {
      const preferredFile = files.find((filePath) => filePath.toLowerCase().endsWith('.csv')) || files[0];
      try {
        const parsed = await parseExportedFile(preferredFile);
        return {
          files,
          method: 'export',
          ok: true,
          preferredFile,
          rows: parsed.rows,
          sheetName: parsed.sheetName,
        };
      } catch (error) {
        activeReport.errors.push(`parse_exported_file: ${error.message}`);
      }
    }
  }

  if (snapshot.canRead) {
    const rows = await readUsedRangeRows(page);
    if (rows.length > 0) {
      return {
        files: [],
        method: 'clipboard',
        ok: true,
        preferredFile: null,
        rows,
        sheetName: snapshot.docInfo?.padTitle || 'Sheet1',
      };
    }
  }

  return { ok: false, error: 'Unable to export or copy source rows' };
}

module.exports = {
  exportSourceRows,
  openContext,
  openPage,
  waitForReady,
};
