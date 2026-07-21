const fs = require('fs/promises');
const path = require('path');

const { RUN_LOCK_PATH, ensureDir, readJson, writeJson } = require('./env');

async function isLocked() {
  try {
    await fs.access(RUN_LOCK_PATH);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function acquireLock(runContext) {
  await ensureDir(path.dirname(RUN_LOCK_PATH));
  const payload = {
    pid: process.pid,
    runId: runContext.runId,
    runType: runContext.runType,
    startedAt: runContext.startedAt,
  };

  try {
    const handle = await fs.open(RUN_LOCK_PATH, 'wx');
    await handle.writeFile(JSON.stringify(payload, null, 2), 'utf8');
    await handle.close();
    return payload;
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Another sync process is already running: ${RUN_LOCK_PATH}`);
    }
    throw error;
  }
}

async function releaseLock() {
  try {
    await fs.unlink(RUN_LOCK_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function loadRuntimeState(runContext) {
  return (await readJson(runContext.runtimeStatePath, {
    lastRun: null,
    byDate: {},
  })) || { lastRun: null, byDate: {} };
}

function getDateKey(isoString) {
  return isoString.slice(0, 10);
}

async function saveRuntimeState(runContext, state) {
  await writeJson(runContext.runtimeStatePath, state);
}

async function updateRuntimeState(runContext, patch) {
  const state = await loadRuntimeState(runContext);
  const dateKey = getDateKey(runContext.startedAt);
  const entry = state.byDate[dateKey] || { main: null, retry: null, manual: null };
  entry[runContext.runType] = {
    ...(entry[runContext.runType] || {}),
    ...patch,
  };
  state.byDate[dateKey] = entry;
  state.lastRun = {
    runType: runContext.runType,
    dateKey,
    ...patch,
  };
  await saveRuntimeState(runContext, state);
  return state;
}

module.exports = {
  acquireLock,
  getDateKey,
  isLocked,
  loadRuntimeState,
  releaseLock,
  saveRuntimeState,
  updateRuntimeState,
};
