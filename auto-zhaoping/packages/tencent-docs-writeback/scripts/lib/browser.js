async function openPage(context, targetUrl) {
  const page = await context.newPage();

  if (typeof page.goto === 'function') {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  }

  return page;
}

async function waitForReady(page) {
  if (typeof page.waitForLoadState === 'function') {
    await page.waitForLoadState('domcontentloaded');
  }

  return { canEditTarget: page.canEditTarget !== false };
}

async function clearUsedRangeValues(page) {
  const method = page.clearUsedRangeValues || page.clear;
  if (typeof method !== 'function') {
    throw new Error('Unsupported page adapter: missing clearUsedRangeValues');
  }

  return method.call(page);
}

async function pasteRowsAtA1(page, rows) {
  const method = page.pasteRowsAtA1 || page.paste;
  if (typeof method !== 'function') {
    throw new Error('Unsupported page adapter: missing pasteRowsAtA1');
  }

  return method.call(page, rows);
}

async function readUsedRangeRows(page) {
  const method = page.readUsedRangeRows || page.readRows;
  if (typeof method !== 'function') {
    throw new Error('Unsupported page adapter: missing readUsedRangeRows');
  }

  return method.call(page);
}

module.exports = {
  clearUsedRangeValues,
  openPage,
  pasteRowsAtA1,
  readUsedRangeRows,
  waitForReady,
};
