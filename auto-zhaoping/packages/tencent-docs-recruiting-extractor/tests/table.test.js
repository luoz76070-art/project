const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { cleanRows, parseDelimitedText, parseExportedFile, rowsToCsv, writeCsv } = require('../scripts/lib/table');

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'extractor-table-test-'));
}

test('cleanRows normalizes cell values and trims trailing empty rows and columns', () => {
  const cleaned = cleanRows([
    ['Name', 'Notes', '', ''],
    ['Alice', 'line1\r\nline2', null, ''],
    ['Bob', 3, undefined, ''],
    ['', '', '', ''],
  ]);

  assert.deepEqual(cleaned, [
    ['Name', 'Notes'],
    ['Alice', 'line1\nline2'],
    ['Bob', '3'],
  ]);
});

test('rowsToCsv quotes commas, quotes, and newlines', () => {
  const csv = rowsToCsv([
    ['name', 'note'],
    ['Alice, Inc.', 'He said "hi"'],
    ['Bob', 'line1\nline2'],
  ]);

  assert.equal(csv, 'name,note\n"Alice, Inc.","He said ""hi"""\nBob,"line1\nline2"');
});

test('parseDelimitedText preserves quoted commas and embedded newlines in csv exports', () => {
  const rows = parseDelimitedText('name,note\n"Alice, Inc.","line1\nline2"\nBob,"said ""hi"""');

  assert.deepEqual(rows, [
    ['name', 'note'],
    ['Alice, Inc.', 'line1\nline2'],
    ['Bob', 'said "hi"'],
  ]);
});

test('parseDelimitedText keeps csv delimiter when quoted csv cell contains a tab', () => {
  const rows = parseDelimitedText('name,note\nAlice,"has\ttab"');

  assert.deepEqual(rows, [
    ['name', 'note'],
    ['Alice', 'has\ttab'],
  ]);
});

test('parseExportedFile preserves recruiter-style quoted csv exports from fixture', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'recruiter-export.csv');

  const parsed = await parseExportedFile(fixturePath);

  assert.equal(parsed.sheetName, 'recruiter-export.csv');
  assert.deepEqual(parsed.rows, [
    ['candidate', 'notes', 'location'],
    ['Alice, Inc.', 'Line 1\nLine 2 with, comma and\ttab', 'Shenzhen'],
    ['Bob', 'Says "hello"', 'Remote'],
  ]);
});

test('writeCsv writes serialized csv to disk', async () => {
  const tempDir = await makeTempDir();
  const csvPath = path.join(tempDir, 'rows.csv');

  await writeCsv(csvPath, [
    ['role', 'city'],
    ['Engineer', 'Shenzhen'],
  ]);

  const written = await fs.readFile(csvPath, 'utf8');
  assert.equal(written, 'role,city\nEngineer,Shenzhen');
});
