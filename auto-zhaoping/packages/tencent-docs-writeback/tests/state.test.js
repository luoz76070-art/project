const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { loadState, saveState } = require('../scripts/lib/state');

test('saveState persists backup sheet metadata and loadState reads it back', async () => {
  const statePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-state-')), 'state.json');
  const state = {
    backup_sheet_id: 'sheet-1',
    backup_sheet_title: '__local_recruiting_backup__',
  };

  await saveState(statePath, state);

  assert.deepEqual(loadState(statePath), state);
});

test('loadState rejects corrupted state files', async () => {
  const statePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-state-')), 'state.json');

  await fs.writeFile(statePath, JSON.stringify({ backup_sheet_id: '', backup_sheet_title: '__local_recruiting_backup__' }));

  assert.throws(() => loadState(statePath), /Invalid state/);
});
