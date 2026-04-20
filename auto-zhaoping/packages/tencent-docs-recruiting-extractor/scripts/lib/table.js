const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function normalizeCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
  return String(value);
}

function normalizeRows(rows) {
  return rows.map((row) => row.map((cell) => normalizeCell(cell)));
}

function trimTrailingEmptyRows(rows) {
  const next = rows.slice();
  while (next.length > 0 && next[next.length - 1].every((cell) => normalizeCell(cell).trim() === '')) {
    next.pop();
  }
  return next;
}

function trimTrailingEmptyColumns(rows) {
  const maxNonEmptyIndex = rows.reduce((currentMax, row) => {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if (normalizeCell(row[index]).trim() !== '') {
        return Math.max(currentMax, index);
      }
    }
    return currentMax;
  }, -1);

  if (maxNonEmptyIndex < 0) {
    return rows.map(() => []);
  }

  return rows.map((row) => row.slice(0, maxNonEmptyIndex + 1).map((cell) => normalizeCell(cell)));
}

function cleanRows(rows) {
  return trimTrailingEmptyColumns(trimTrailingEmptyRows(normalizeRows(rows))).filter((row) =>
    row.some((cell) => cell.trim() !== '')
  );
}

function parseSeparatedText(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let index = 0;
  let inQuotes = false;

  while (index < text.length) {
    const char = text[index];

    if (char === '"') {
      const nextChar = text[index + 1];
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 2;
        continue;
      }

      inQuotes = !inQuotes;
      index += 1;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = '';
      index += 1;
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }

      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += 1;
      continue;
    }

    cell += char;
    index += 1;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function detectDelimiter(text) {
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      const nextChar = text[index + 1];
      if (inQuotes && nextChar === '"') {
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ',') {
      return ',';
    }

    if (!inQuotes && char === '\t') {
      return '\t';
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      break;
    }
  }

  return text.includes('\t') && !text.includes(',') ? '\t' : ',';
}

function parseDelimitedText(text) {
  if (!text || !text.trim()) {
    return [];
  }

  const normalized = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(normalized);
  const rows = parseSeparatedText(normalized, delimiter);

  if (rows.length === 0) {
    return [];
  }

  return cleanRows(rows);
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
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function detectEncodingIssues(rows) {
  const issues = [];

  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (/\uFFFD/.test(cell)) {
        issues.push({ row: rowIndex + 1, column: columnIndex + 1, issue: 'replacement_char', value: cell });
      }
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(cell)) {
        issues.push({ row: rowIndex + 1, column: columnIndex + 1, issue: 'control_char', value: cell });
      }
    });
  });

  return issues;
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

async function writeCsv(filePath, rows) {
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, rowsToCsv(rows), 'utf8');
}

async function writeRowsArtifacts(outputDir, rows, filePrefix = 'normalized') {
  const jsonPath = path.join(outputDir, `${filePrefix}.json`);
  const csvPath = path.join(outputDir, `${filePrefix}.csv`);

  await ensureParentDir(jsonPath);
  await fs.writeFile(jsonPath, `${JSON.stringify({ rows }, null, 2)}\n`, 'utf8');
  await writeCsv(csvPath, rows);

  return { jsonPath, csvPath };
}

module.exports = {
  cleanRows,
  contentHash,
  detectEncodingIssues,
  normalizeCell,
  parseDelimitedText,
  parseExportedFile,
  rowsToCsv,
  rowsToTsv,
  writeCsv,
  writeRowsArtifacts,
};
