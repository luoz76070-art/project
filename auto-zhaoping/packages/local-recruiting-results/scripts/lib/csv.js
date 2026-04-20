const fs = require('node:fs');
const path = require('node:path');

function parseCsv(text) {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error('unterminated CSV quote');
  }

  if (field.length > 0 || row.length > 0 || source.endsWith(',')) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function readCsvFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);

  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = rows[0].map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, '') : header));
  const records = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const values = rows[rowIndex];
    if (values.every((value) => value === '')) {
      continue;
    }

    const record = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      record[headers[columnIndex]] = values[columnIndex] ?? '';
    }

    records.push(record);
  }

  return { headers, records };
}

function quoteCsvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
  if (rows.length === 0) {
    return '';
  }

  return `${rows.map((row) => row.map((value) => quoteCsvCell(value)).join(',')).join('\n')}\n`;
}

function writeCsvFile(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rowsToCsv(rows), 'utf8');
}

module.exports = {
  parseCsv,
  readCsvFile,
  rowsToCsv,
  writeCsvFile,
};
