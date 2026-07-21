const { RUNTIME_STATE_PATH, ensureBaseDirs, readJson } = require('./lib/env');

async function schedulerGuard(runType, now = new Date()) {
  await ensureBaseDirs();
  const state =
    (await readJson(RUNTIME_STATE_PATH, {
      lastRun: null,
      byDate: {},
    })) || { lastRun: null, byDate: {} };
  const dateKey = now.toISOString().slice(0, 10);
  const today = state.byDate[dateKey] || { main: null, retry: null };

  if (runType === 'main') {
    return { shouldRun: true, runType, reason: 'main_schedule' };
  }

  if (runType === 'retry') {
    if (!today.main || today.main.finalStatus !== 'failed') {
      return { shouldRun: false, runType, reason: 'main_not_failed' };
    }
    if (today.retry && today.retry.finalStatus === 'success') {
      return { shouldRun: false, runType, reason: 'retry_already_succeeded' };
    }
    return { shouldRun: true, runType, reason: 'retry_after_failure' };
  }

  return { shouldRun: false, runType, reason: 'unknown_run_type' };
}

if (require.main === module) {
  const runType = process.argv.includes('--run-type') ? process.argv[process.argv.indexOf('--run-type') + 1] : 'main';
  schedulerGuard(runType)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.shouldRun ? 0 : 2);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { schedulerGuard };
