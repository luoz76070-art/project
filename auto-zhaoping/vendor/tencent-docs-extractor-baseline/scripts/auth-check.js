const { loadConfig } = require('./lib/env');
const { openContext, openPage, waitForReady } = require('./lib/browser');

async function authCheck(runContext, config = null, report = null) {
  const activeConfig = config || (await loadConfig());
  const activeReport =
    report ||
    {
      permissionSnapshots: [],
      networkSamples: [],
      downloads: [],
      errors: [],
    };

  const context = await openContext(runContext, activeReport);
  try {
    const sourcePage = await openPage(context, activeConfig.sourceUrl);
    const source = await waitForReady(sourcePage, activeReport, 'source');

    let target = null;
    if (activeConfig.targetUrl) {
      const targetPage = await openPage(context, activeConfig.targetUrl);
      target = await waitForReady(targetPage, activeReport, 'target');
    }

    return {
      ok: Boolean(source.canRead) && Boolean(target?.canEditTarget),
      context,
      source,
      target,
      accountId: source.userInfo?.userId || target?.userInfo?.userId || null,
    };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

if (require.main === module) {
  const { createRunContext } = require('./lib/env');
  (async () => {
    const runContext = await createRunContext('manual');
    const report = { permissionSnapshots: [], networkSamples: [], downloads: [], errors: [] };
    const result = await authCheck(runContext, null, report);
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          source: result.source,
          target: result.target,
          accountId: result.accountId,
        },
        null,
        2
      )
    );
    await result.context.close();
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { authCheck };
