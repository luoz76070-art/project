const fs = require('node:fs/promises');

function parseCsv(text) {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let current = '';
  let inQuotes = false;
  let justClosedQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === '"') {
      if (inQuotes && source[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }

      if (inQuotes) {
        inQuotes = false;
        justClosedQuote = true;
      } else {
        if (current.length > 0) {
          throw new Error('Invalid CSV quote placement');
        }

        inQuotes = true;
      }
      continue;
    }

    if (justClosedQuote) {
      if (char === ',') {
        row.push(current);
        current = '';
        justClosedQuote = false;
        continue;
      }

      if (char === '\n' || char === '\r') {
        if (char === '\r' && source[index + 1] === '\n') {
          index += 1;
        }

        row.push(current);
        rows.push(row);
        row = [];
        current = '';
        justClosedQuote = false;
        continue;
      }

      throw new Error('Invalid CSV quote placement');
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && source[index + 1] === '\n') {
        index += 1;
      }

      row.push(current);
      rows.push(row);
      row = [];
      current = '';
      continue;
    }

    if (char === '"') {
      throw new Error('Invalid CSV quote placement');
    }

    current += char;
  }

  if (inQuotes) {
    throw new Error('Unterminated CSV quote');
  }

  if (justClosedQuote || current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const [headerRow, ...dataRows] = rows;
  return dataRows
    .filter((values) => values.some((value) => value !== ''))
    .map((values) => {
      if (values.length > headerRow.length) {
        throw new Error('CSV row has more cells than headers');
      }

      const rowObject = {};
      headerRow.forEach((header, index) => {
        rowObject[header] = values[index] ?? '';
      });
      return rowObject;
    });
}

function stringifyCsv(rows) {
  if (!rows.length) return '';

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];

  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvValue(row[header] ?? '')).join(','));
  }

  return lines.join('\n');
}

async function readCsvFile(filePath) {
  return parseCsv(await fs.readFile(filePath, 'utf8'));
}

async function writeCsvFile(filePath, rows) {
  await fs.writeFile(filePath, `${stringifyCsv(rows)}\n`);
}

function escapeCsvValue(value) {
  const text = String(value);

  if (/[,"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

module.exports = { parseCsv, readCsvFile, stringifyCsv, writeCsvFile };
