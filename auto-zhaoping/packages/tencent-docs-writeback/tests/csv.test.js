const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCsv, stringifyCsv } = require('../scripts/lib/csv');

test('parseCsv preserves embedded newlines inside quoted cells', () => {
  const rows = parseCsv('company,title\n"Acme","Line 1\nLine 2"\n');

  assert.deepEqual(rows, [
    { company: 'Acme', title: 'Line 1\nLine 2' },
  ]);
});

test('stringifyCsv quotes values with embedded newlines', () => {
  const csv = stringifyCsv([
    { company: 'Acme', title: 'Line 1\nLine 2' },
  ]);

  assert.equal(csv, 'company,title\nAcme,"Line 1\nLine 2"');
});

test('parseCsv strips a UTF-8 BOM from the first header', () => {
  const rows = parseCsv('\uFEFFcompany,title\nAcme,Engineer\n');

  assert.deepEqual(rows, [
    { company: 'Acme', title: 'Engineer' },
  ]);
});

test('parseCsv rejects malformed quote placement', () => {
  assert.throws(() => parseCsv('company,title\nAcme,"Engineer"oops\n'), /Invalid CSV quote placement/);
});

test('parseCsv rejects rows with extra cells', () => {
  assert.throws(() => parseCsv('company,title\nAcme,Engineer,Extra\n'), /more cells than headers/);
});
