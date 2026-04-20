const { authCheck } = require('./auth-check');
const { createRunContext, loadConfig, writeJson } = require('./lib/env');

async function main() {
  const config = await loadConfig();
  const runContext = await createRunContext('healthcheck');
  const report = {
    runId: runContext.runId,
    runType: 'healthcheck',
    startedAt: runContext.startedAt,
    permissionSnapshots: [],
    networkSamples: [],
    downloads: [],
    errors: [],
  };

  const result = await authCheck(runContext, config, report);
  const summary = {
    ok: result.ok,
    sourceCanRead: Boolean(result.source?.canRead),
    targetCanEdit: Boolean(result.target?.canEditTarget),
    accountId: result.accountId,
  };
  await writeJson(runContext.reportPath, { report, summary });
  await result.context.close();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
