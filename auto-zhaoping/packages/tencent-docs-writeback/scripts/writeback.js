const path = require('node:path');

const { loadWritebackConfig } = require('./lib/config');
const { loadLatestResults } = require('./lib/input');
const { buildProjectPaths, resolveRepoRoot } = require('./lib/paths');
const { buildFailureReport, buildSuccessReport, writeReportArtifacts } = require('./lib/report');
const { loadState, saveState } = require('./lib/state');
const {
  clearPasteFormalSheetFromA1,
  copyFormalSheetToBackupSheet,
  findOrCreateReservedBackupSheet,
  normalizeSheetRows,
  readBackRows,
} = require('./lib/tencent-docs');

const {
  clearUsedRangeValues: clearUsedRangeValuesOnPage,
  openContext,
  openPage: openBaselinePage,
  pasteRowsAtA1: pasteRowsAtA1OnPage,
  readUsedRangeRows: readUsedRangeRowsOnPage,
  waitForReady: waitForReadyOnPage,
} = require('../../../vendor/tencent-docs-extractor-baseline/scripts/lib/browser');

const DEFAULT_CONFIG_PATH = path.join(
  'packages',
  'tencent-docs-writeback',
  'config',
  'writeback.config.json',
);
const DEFAULT_BACKUP_SHEET_NAME = '__local_recruiting_backup__';
const DEFAULT_BROWSER_PROFILE_DIR = path.join('results', 'tencent-docs-writeback', '.browser-profile');

function getRunId() {
  return `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function loadTargetConfig(configPath) {
  return loadWritebackConfig(configPath).then((config) => {
    const backupSheetName = String(config.backupSheetName || DEFAULT_BACKUP_SHEET_NAME).trim();
    if (!backupSheetName) {
      throw new Error(`Missing backupSheetName in ${configPath}`);
    }

    return {
      backupSheetName,
      targetUrl: config.targetUrl,
    };
  });
}

function rowsFromRecords(records) {
  if (!records.length) return [];

  const headers = Object.keys(records[0]);
  return [headers, ...records.map((record) => headers.map((header) => record[header] ?? ''))];
}

function rowsMatch(leftRows, rightRows) {
  return JSON.stringify(normalizeSheetRows(leftRows)) === JSON.stringify(normalizeSheetRows(rightRows));
}

async function createDefaultSessionFactory(repoRoot) {
  const userDataDir = path.join(repoRoot, DEFAULT_BROWSER_PROFILE_DIR);

  return async (targetUrl, existingState = null) => {
    const report = { permissionSnapshots: [], networkSamples: [], downloads: [], errors: [] };
    const context = await openContext({ userDataDir, networkDir: userDataDir }, report);
    const page = await openBaselinePage(context, targetUrl);
    const readySnapshot = await waitForReadyOnPage(page, report, 'writeback');
    let formalRows = await readUsedRangeRowsOnPage(page).catch(() => []);
    let backupSheet = null;

    async function discoverSheetTabs() {
      const tabs = [];

      for (const selector of ['[role="tab"]', 'button']) {
        const count = await page.locator(selector).count().catch(() => 0);
        if (!count) continue;

        const matches = await page.locator(selector).evaluateAll((elements) =>
          elements
            .map((element, index) => {
              const title = String(element.textContent || '').trim();
              const id =
                element.id ||
                element.getAttribute('aria-controls') ||
                element.getAttribute('data-id') ||
                `tab-${index}`;
              return title ? { id, title } : null;
            })
            .filter(Boolean)
        ).catch(() => []);

        for (const tab of matches) {
          if (!tabs.some((existing) => existing.id === tab.id || existing.title === tab.title)) {
            tabs.push(tab);
          }
        }
      }

      return tabs;
    }

    return {
      listSheets: async () => {
        const sheets = [{ id: 'formal-sheet', title: readySnapshot.docInfo?.padTitle || 'Formal Sheet' }];

        for (const tab of await discoverSheetTabs()) {
          if (!sheets.some((sheet) => sheet.id === tab.id || sheet.title === tab.title)) {
            sheets.push(tab);
          }
        }

        if (backupSheet) {
          sheets.push(backupSheet);
        }
        return sheets;
      },
      createSheet: async (title) => {
        backupSheet = backupSheet || { id: `backup-${Date.now()}`, title, rows: [] };
        backupSheet.title = title;
        return backupSheet;
      },
      copyFormalSheetToBackupSheet: async (sheet) => {
        backupSheet = {
          id: sheet?.id || backupSheet?.id || `backup-${Date.now()}`,
          title: sheet?.title || backupSheet?.title || DEFAULT_BACKUP_SHEET_NAME,
          rows: formalRows.map((row) => row.slice()),
        };
        return backupSheet;
      },
      clearUsedRangeValues: async () => {
        await clearUsedRangeValuesOnPage(page);
        formalRows = [];
      },
      pasteRowsAtA1: async (rows) => {
        await pasteRowsAtA1OnPage(page, rows);
        formalRows = rows.map((row) => row.slice());
      },
      readUsedRangeRows: async () => {
        const rows = await readUsedRangeRowsOnPage(page);
        formalRows = rows.map((row) => row.slice());
        return rows;
      },
      close: async () => {
        await context.close().catch(() => {});
      },
      page,
      context,
    };
  };
}

async function runWriteback({ repoRoot, configPath, sessionFactory }) {
  const resolvedRepoRoot = resolveRepoRoot(repoRoot || process.cwd());
  const paths = buildProjectPaths(resolvedRepoRoot);
  const resolvedConfigPath = configPath || path.join(resolvedRepoRoot, DEFAULT_CONFIG_PATH);
  const runId = getRunId();
  const runDir = path.join(paths.runsRoot, runId);

  const makeSession = sessionFactory || (await createDefaultSessionFactory(resolvedRepoRoot));

  let beforeTargetRows = [];
  let afterTargetRows = [];
  let backupSheet = null;
  let input;
  let config;
  let targetDocument = null;

  try {
    input = await loadLatestResults(resolvedRepoRoot);
    config = await loadTargetConfig(resolvedConfigPath);

    const existingState = loadState(paths.statePath);
    targetDocument = await makeSession(config.targetUrl, existingState);

    backupSheet = await findOrCreateReservedBackupSheet(targetDocument, {
      backupSheetId: existingState?.backup_sheet_id,
      backupSheetTitle: config.backupSheetName,
    });

    await saveState(paths.statePath, {
      backup_sheet_id: String(backupSheet.id || '').trim(),
      backup_sheet_title: String(backupSheet.title || config.backupSheetName).trim(),
    });

    beforeTargetRows = await readBackRows(targetDocument);
    await copyFormalSheetToBackupSheet(targetDocument, backupSheet);

    const mainRows = rowsFromRecords(input.rows);
    await clearPasteFormalSheetFromA1(targetDocument, mainRows);
    afterTargetRows = await readBackRows(targetDocument);

    if (!rowsMatch(afterTargetRows, mainRows)) {
      throw new Error('Readback rows do not match the local CSV');
    }

    const report = buildSuccessReport({
      runId,
      inputDir: input.latestInputRoot,
      snapshotDate: input.snapshotDate,
      targetUrl: config.targetUrl,
      backupSheetName: config.backupSheetName,
      mainRowCount: input.rows.length,
    });
    const artifacts = await writeReportArtifacts(runDir, report, beforeTargetRows, afterTargetRows);

    return {
      status: report.status,
      reportPath: artifacts.reportPath,
      beforeTargetCsvPath: artifacts.beforeTargetCsvPath,
      afterTargetCsvPath: artifacts.afterTargetCsvPath,
      statePath: paths.statePath,
      backupSheetId: String(backupSheet.id || '').trim(),
      backupSheetTitle: String(backupSheet.title || config.backupSheetName).trim(),
    };
  } catch (error) {
    const report = buildFailureReport({
      runId,
      inputDir: input?.latestInputRoot || path.join(resolvedRepoRoot, 'results', 'local-recruiting', 'latest'),
      snapshotDate: input?.snapshotDate || null,
      targetUrl: config?.targetUrl || 'unknown',
      backupSheetName: config?.backupSheetName || DEFAULT_BACKUP_SHEET_NAME,
      mainRowCount: input?.rows?.length || 0,
      failureStage: 'writeback',
      failureReason: error.message,
      suggestedAction: 'Review the Tencent Docs target or local input and retry.',
    });

    const artifacts = await writeReportArtifacts(runDir, report, beforeTargetRows, afterTargetRows);

    return {
      status: report.status,
      reportPath: artifacts.reportPath,
      beforeTargetCsvPath: artifacts.beforeTargetCsvPath,
      afterTargetCsvPath: artifacts.afterTargetCsvPath,
      statePath: paths.statePath,
      backupSheetId: backupSheet ? String(backupSheet.id || '').trim() : '',
      backupSheetTitle: backupSheet ? String(backupSheet.title || config?.backupSheetName || '').trim() : '',
      error,
    };
  } finally {
    if (targetDocument && typeof targetDocument.close === 'function') {
      await targetDocument.close().catch(() => {});
    }
  }
}

async function main(options = {}) {
  const repoRoot = resolveRepoRoot(options.repoRoot || process.cwd());
  const configPath = options.configPath || path.join(repoRoot, DEFAULT_CONFIG_PATH);

  const result = await runWriteback({
    repoRoot,
    configPath,
    sessionFactory: options.sessionFactory || (await createDefaultSessionFactory(repoRoot)),
  });

  if (result.status !== 'success') {
    const error = result.error || new Error('Writeback failed');
    process.exitCode = 1;
    throw error;
  }

  return result;
}

if (require.main === module) {
  main().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = { main, runWriteback };
