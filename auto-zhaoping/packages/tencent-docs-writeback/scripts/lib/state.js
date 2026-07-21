const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function normalizeState(statePath, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`Invalid state at ${statePath}`);
  }

  const backupSheetId = String(state.backup_sheet_id || '').trim();
  const backupSheetTitle = String(state.backup_sheet_title || '').trim();

  if (!backupSheetId || !backupSheetTitle) {
    throw new Error(`Invalid state at ${statePath}`);
  }

  return {
    backup_sheet_id: backupSheetId,
    backup_sheet_title: backupSheetTitle,
  };
}

function loadState(statePath) {
  try {
    const stateText = fs.readFileSync(statePath, 'utf8');
    const state = JSON.parse(stateText);

    return normalizeState(statePath, state);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid state at ${statePath}: ${error.message}`);
    }
    throw error;
  }
}

async function saveState(statePath, state) {
  const nextState = normalizeState(statePath, state);

  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  await fsp.writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`);
}

module.exports = { loadState, saveState };
