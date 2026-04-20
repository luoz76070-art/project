const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { runWriteback } = require('../scripts/writeback');

const fixtureRoot = path.join(__dirname, 'fixtures', 'repo-root');

test('runWriteback backs up the target sheet', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-run-'));
  const latestInputRoot = path.join(repoRoot, 'results', 'local-recruiting', 'latest');
  const configPath = path.join(repoRoot, 'writeback.config.json');

  await fs.mkdir(path.join(repoRoot, '.git'));
  await fs.mkdir(latestInputRoot, { recursive: true });
  await fs.copyFile(
    path.join(fixtureRoot, 'results', 'local-recruiting', 'latest', 'main-current.csv'),
    path.join(latestInputRoot, 'main-current.csv'),
  );
  await fs.copyFile(
    path.join(fixtureRoot, 'results', 'local-recruiting', 'latest', 'summary.json'),
    path.join(latestInputRoot, 'summary.json'),
  );
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        targetUrl: 'https://docs.qq.com/sheet/demo',
        backupSheetName: '__local_recruiting_backup__',
      },
      null,
      2,
    ),
  );

  let backupSheetId = null;
  let currentRows = [['legacy', 'row']];
  let copyCount = 0;
  let clearCount = 0;
  let pasteRows = null;

  const sessionFactory = async (targetUrl) => {
    assert.equal(targetUrl, 'https://docs.qq.com/sheet/demo');

    return {
      listSheets: async () => [{ id: 'formal-sheet', title: 'Formal Sheet' }],
      createSheet: async (title) => {
        assert.equal(title, '__local_recruiting_backup__');
        backupSheetId = 'backup-sheet-1';
        return { id: backupSheetId, title };
      },
      copyFormalSheetToBackupSheet: async (sheet) => {
        copyCount += 1;
        assert.equal(sheet.id, 'backup-sheet-1');
        assert.equal(sheet.title, '__local_recruiting_backup__');
      },
      clearUsedRangeValues: async () => {
        clearCount += 1;
        currentRows = [];
      },
      pasteRowsAtA1: async (rows) => {
        pasteRows = rows;
        currentRows = rows;
      },
      readUsedRangeRows: async () => currentRows,
    };
  };

  await runWriteback({ repoRoot, configPath, sessionFactory });

  assert.equal(backupSheetId, 'backup-sheet-1');
  assert.equal(copyCount, 1);
  assert.equal(clearCount, 1);
  assert.deepEqual(pasteRows, [
    ['company', 'title', 'location'],
    ['Acme', 'Engineer', 'Remote'],
  ]);

  const statePath = path.join(repoRoot, 'results', 'tencent-docs-writeback', 'state.json');
  const runsRoot = path.join(repoRoot, 'results', 'tencent-docs-writeback', 'runs');
  const [runId] = await fs.readdir(runsRoot);
  const runDir = path.join(runsRoot, runId);

  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.deepEqual(state, {
    backup_sheet_id: 'backup-sheet-1',
    backup_sheet_title: '__local_recruiting_backup__',
  });

  const report = JSON.parse(await fs.readFile(path.join(runDir, 'report.json'), 'utf8'));
  assert.equal(report.status, 'success');
  assert.equal(report.target_url, 'https://docs.qq.com/sheet/demo');

  assert.equal(await fs.readFile(path.join(runDir, 'before-target.csv'), 'utf8'), 'legacy,row\n');
  assert.equal(
    await fs.readFile(path.join(runDir, 'after-target.csv'), 'utf8'),
    'company,title,location\nAcme,Engineer,Remote\n',
  );
});
