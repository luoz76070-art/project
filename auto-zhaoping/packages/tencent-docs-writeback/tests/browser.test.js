const test = require('node:test');
const assert = require('node:assert/strict');

const { clearUsedRangeValues, pasteRowsAtA1, readUsedRangeRows } = require('../scripts/lib/browser');

test('browser helpers fail fast when page adapters are missing', async () => {
  await assert.rejects(() => clearUsedRangeValues({}), /missing clearUsedRangeValues/);
  await assert.rejects(() => pasteRowsAtA1({}, []), /missing pasteRowsAtA1/);
  await assert.rejects(() => readUsedRangeRows({}), /missing readUsedRangeRows/);
});
