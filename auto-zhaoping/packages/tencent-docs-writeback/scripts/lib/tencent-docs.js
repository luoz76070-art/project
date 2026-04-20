function resolveBackupSheet({ backupSheetId, backupSheetTitle, sheets }) {
  const ownedId = String(backupSheetId || '');
  const reservedTitle = String(backupSheetTitle || '');
  const sameTitleSheets = (sheets || []).filter((sheet) => sheet && sheet.title === reservedTitle);

  if (ownedId) {
    const ownedSheet = (sheets || []).find((sheet) => sheet && sheet.id === ownedId);
    if (!ownedSheet) {
      if (sameTitleSheets.length > 0) {
        throw new Error(`Backup sheet collision for ${reservedTitle}`);
      }

      return null;
    }

    const foreignCollision = sameTitleSheets.some((sheet) => sheet.id !== ownedId);
    if (foreignCollision) {
      throw new Error(`Backup sheet collision for ${reservedTitle}`);
    }

    return ownedSheet;
  }

  if (sameTitleSheets.length > 0) {
    throw new Error(`Backup sheet collision for ${reservedTitle}`);
  }

  return null;
}

function normalizeSheetRows(rows) {
  const normalizedRows = (rows || []).map((row) => (row || []).map(normalizeCell));

  while (normalizedRows.length > 0 && normalizedRows[normalizedRows.length - 1].every((cell) => cell === '')) {
    normalizedRows.pop();
  }

  let width = 0;
  for (const row of normalizedRows) {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if (row[index] !== '') {
        width = Math.max(width, index + 1);
        break;
      }
    }
  }

  return normalizedRows.map((row) => {
    const nextRow = [];
    for (let index = 0; index < width; index += 1) {
      nextRow.push(row[index] ?? '');
    }
    return nextRow;
  });
}

async function findOrCreateReservedBackupSheet(targetDocument, options) {
  const sheets = typeof targetDocument.listSheets === 'function' ? await targetDocument.listSheets() : [];
  const resolvedSheet = resolveBackupSheet({ ...options, sheets });
  if (resolvedSheet) return resolvedSheet;

  if (typeof targetDocument.createBackupSheet === 'function') {
    return targetDocument.createBackupSheet(options.backupSheetTitle);
  }

  if (typeof targetDocument.createSheet === 'function') {
    return targetDocument.createSheet(options.backupSheetTitle);
  }

  throw new Error('Target document does not support backup sheet creation');
}

async function copyFormalSheetToBackupSheet(targetDocument, backupSheet) {
  if (typeof targetDocument.copyFormalSheetToBackupSheet === 'function') {
    return targetDocument.copyFormalSheetToBackupSheet(backupSheet);
  }

  if (typeof targetDocument.copyFormalSheet === 'function') {
    return targetDocument.copyFormalSheet(backupSheet);
  }

  throw new Error('Target document does not support backup sheet copy');
}

async function clearPasteFormalSheetFromA1(targetDocument, rows) {
  if (typeof targetDocument.clearUsedRangeValues === 'function') {
    await targetDocument.clearUsedRangeValues();
  }

  if (typeof targetDocument.pasteRowsAtA1 === 'function') {
    return targetDocument.pasteRowsAtA1(rows);
  }

  if (typeof targetDocument.pasteRows === 'function') {
    return targetDocument.pasteRows(rows);
  }

  throw new Error('Target document does not support pasting rows');
}

async function readBackRows(targetDocument) {
  if (typeof targetDocument.readUsedRangeRows === 'function') {
    return targetDocument.readUsedRangeRows();
  }

  if (typeof targetDocument.readRows === 'function') {
    return targetDocument.readRows();
  }

  return [];
}

function normalizeCell(value) {
  return value == null ? '' : String(value);
}

module.exports = {
  clearPasteFormalSheetFromA1,
  copyFormalSheetToBackupSheet,
  findOrCreateReservedBackupSheet,
  normalizeSheetRows,
  readBackRows,
  resolveBackupSheet,
};
