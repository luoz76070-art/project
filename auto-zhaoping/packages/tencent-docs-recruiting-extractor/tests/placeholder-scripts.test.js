const test = require('node:test');
const assert = require('node:assert/strict');
test('script modules expose the source-side entrypoints', () => {
  const extractOnce = require('../scripts/extract-once');
  const exportSource = require('../scripts/export-source');
  const authCheck = require('../scripts/auth-check');
  const browser = require('../scripts/lib/browser');

  assert.equal(typeof extractOnce.main, 'function');
  assert.equal(typeof extractOnce.runExtract, 'function');
  assert.equal(typeof exportSource.exportSource, 'function');
  assert.equal(typeof authCheck.authCheck, 'function');
  assert.deepEqual(Object.keys(exportSource).sort(), ['exportSource']);
  assert.deepEqual(Object.keys(authCheck).sort(), ['authCheck']);
  assert.deepEqual(Object.keys(browser).sort(), ['exportSourceRows', 'openContext', 'openPage', 'waitForReady']);
  assert.equal(typeof browser.openContext, 'function');
  assert.equal(typeof browser.openPage, 'function');
  assert.equal(typeof browser.waitForReady, 'function');
  assert.equal(typeof browser.exportSourceRows, 'function');
});
