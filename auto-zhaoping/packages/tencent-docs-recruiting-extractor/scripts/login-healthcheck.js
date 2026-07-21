const { authCheck } = require('./auth-check');
const { loadConfig, resolveConfigPath } = require('./lib/config');
const { createRunContext, writeJson } = require('./lib/run-context');

async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const configPath = resolveConfigPath(argv, cwd);
  const config = await loadConfig(configPath);
  const runContext = await createRunContext(cwd, { ...config, configPath });
  const report = {
    downloads: [],
    errors: [],
    networkSamples: [],
    permissionSnapshots: [],
    runId: runContext.runId,
    startedAt: runContext.startedAt,
  };

  const result = await authCheck(runContext, config, report);

  try {
    const summary = {
      accountId: result.accountId,
      ok: result.ok,
      sourceCanExport: Boolean(result.source?.canExport),
      sourceCanRead: Boolean(result.source?.canRead),
    };

    await writeJson(runContext.summaryPath, summary);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) {
      process.exitCode = 2;
    }
  } finally {
    await result.context.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
