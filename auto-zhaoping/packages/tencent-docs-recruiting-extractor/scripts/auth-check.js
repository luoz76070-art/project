const { openContext, openPage, waitForReady } = require('./lib/browser');

async function authCheck(runContext, config, report = null) {
  const context = await openContext(runContext, report);

  try {
    const sourcePage = await openPage(context, config.sourceUrl);
    const source = await waitForReady(sourcePage, report, 'source');

    return {
      accountId: source.userInfo?.userId || null,
      context,
      ok: Boolean(source.canRead),
      source,
    };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

module.exports = { authCheck };
