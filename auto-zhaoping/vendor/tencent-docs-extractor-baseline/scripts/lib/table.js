const fs = require('fs/promises');
const path = require('path');
const XLSX = require('xlsx');

function normalizeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return String(value);
}

function normalizeRows(rows) {
  return rows.map((row) => row.map((cell) => normalizeCell(cell)));
}

function trimTrailingEmptyRows(rows) {
  const next = [...rows];
  while (next.length && next[next.length - 1].every((cell) => normalizeCell(cell).trim() === '')) {
    next.pop();
  }
  return next;
}

function trimTrailingEmptyCols(rows) {
  const maxNonEmptyIndex = rows.reduce((max, row) => {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if (normalizeCell(row[index]).trim() !== '') {
        return Math.max(max, index);
      }
    }
    return max;
  }, -1);

  if (maxNonEmptyIndex === -1) return rows.map(() => []);
  return rows.map((row) => row.slice(0, maxNonEmptyIndex + 1).map((cell) => normalizeCell(cell)));
}

function cleanRows(rows) {
  return trimTrailingEmptyCols(trimTrailingEmptyRows(normalizeRows(rows))).filter(
    (row) => row.some((cell) => cell.trim() !== '')
  );
}

function parseDelimitedText(text) {
  if (!text || !text.trim()) return [];
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  if (!lines.length) return [];
  const delimiter = lines.some((line) => line.includes('\t')) ? '\t' : ',';
  return cleanRows(lines.map((line) => line.split(delimiter)));
}

function rowsToTsv(rows) {
  return rows.map((row) => row.map((cell) => normalizeCell(cell)).join('\t')).join('\n');
}

function rowsToCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = normalizeCell(cell);
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(',')
    )
    .join('\n');
}

function contentHash(rows) {
  const text = JSON.stringify(rows);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function detectEncodingIssues(rows) {
  const issues = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (/\uFFFD/.test(cell)) {
        issues.push({ row: rowIndex + 1, column: columnIndex + 1, value: cell, issue: 'replacement_char' });
      }
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(cell)) {
        issues.push({ row: rowIndex + 1, column: columnIndex + 1, value: cell, issue: 'control_char' });
      }
    });
  });
  return issues;
}

function compareRows(beforeRows, afterRows, keepSamples = 50) {
  const maxRows = Math.max(beforeRows.length, afterRows.length);
  const diffItems = [];
  let updatedCount = 0;
  let addedCount = 0;
  let deletedCount = 0;

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const before = beforeRows[rowIndex] || [];
    const after = afterRows[rowIndex] || [];
    const beforeText = JSON.stringify(before);
    const afterText = JSON.stringify(after);
    if (beforeText === afterText) continue;

    if (rowIndex >= beforeRows.length) {
      addedCount += 1;
      if (diffItems.length < keepSamples) diffItems.push({ type: 'added', row: rowIndex + 1, after });
      continue;
    }

    if (rowIndex >= afterRows.length) {
      deletedCount += 1;
      if (diffItems.length < keepSamples) diffItems.push({ type: 'deleted', row: rowIndex + 1, before });
      continue;
    }

    updatedCount += 1;
    if (diffItems.length < keepSamples) {
      diffItems.push({ type: 'updated', row: rowIndex + 1, before, after });
    }
  }

  return {
    isEqual: updatedCount === 0 && addedCount === 0 && deletedCount === 0,
    addedCount,
    updatedCount,
    deletedCount,
    diffItems,
  };
}

async function parseExportedFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.csv' || extension === '.txt') {
    const text = await fs.readFile(filePath, 'utf8');
    return {
      sheetName: path.basename(filePath),
      rows: parseDelimitedText(text),
    };
  }

  const workbook = XLSX.readFile(filePath, { raw: false, cellText: true });
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false, blankrows: false });
  return {
    sheetName: firstSheetName,
    rows: cleanRows(rows),
  };
}

async function writeRowsArtifacts(outputDir, rows, filePrefix = 'normalized') {
  const jsonPath = path.join(outputDir, `${filePrefix}.json`);
  const csvPath = path.join(outputDir, `${filePrefix}.csv`);
  await fs.writeFile(jsonPath, JSON.stringify({ rows }, null, 2), 'utf8');
  await fs.writeFile(csvPath, rowsToCsv(rows), 'utf8');
  return { jsonPath, csvPath };
}

module.exports = {
  cleanRows,
  compareRows,
  contentHash,
  detectEncodingIssues,
  normalizeCell,
  parseDelimitedText,
  parseExportedFile,
  rowsToCsv,
  rowsToTsv,
  writeRowsArtifacts,
};
