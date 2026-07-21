const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSheetRows, resolveBackupSheet } = require('../scripts/lib/tencent-docs');

test('resolveBackupSheet rejects same-name foreign sheet collisions', () => {
  assert.throws(
    () =>
      resolveBackupSheet({
        backupSheetId: 'owned',
        backupSheetTitle: '__local_recruiting_backup__',
        sheets: [{ id: 'other', title: '__local_recruiting_backup__' }],
      }),
    /collision/i,
  );
});

test('normalizeSheetRows trims trailing empty rows and columns', () => {
  assert.deepEqual(
    normalizeSheetRows([[1, null, ''], ['a', 'b ', '', ''], ['', '']]),
    [['1', ''], ['a', 'b ']],
  );
});

test('normalizeSheetRows preserves visible text as strings', () => {
  assert.deepEqual(
    normalizeSheetRows([[0, undefined, true, false, 'x']]),
    [['0', '', 'true', 'false', 'x']],
  );
});
