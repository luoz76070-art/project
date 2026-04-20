const { schedulerGuard } = require('./scheduler-guard');

function getRunType() {
  const index = process.argv.indexOf('--run-type');
  return index >= 0 ? process.argv[index + 1] : 'main';
}

async function main() {
  const runType = getRunType();
  const decision = await schedulerGuard(runType);
  if (!decision.shouldRun) {
    console.log(`[scheduler] skip ${runType}: ${decision.reason}`);
    process.exitCode = 2;
    return;
  }

  process.argv.push('--run-type', runType);
  await require('./sync-once');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
