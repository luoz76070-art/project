const test = require('node:test');
const assert = require('node:assert/strict');

const scriptPath = require.resolve('../scripts/auth-check');
const browserPath = require.resolve('../scripts/lib/browser');

function loadAuthCheckWithStubs(stubs) {
  const original = new Map();
  const entries = Object.entries(stubs);

  for (const [modulePath, exports] of entries) {
    original.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = { exports, id: modulePath, filename: modulePath, loaded: true };
  }

  delete require.cache[scriptPath];

  try {
    return require(scriptPath);
  } finally {
    delete require.cache[scriptPath];
    for (const [modulePath] of entries) {
      const cached = original.get(modulePath);
      if (cached) {
        require.cache[modulePath] = cached;
      } else {
        delete require.cache[modulePath];
      }
    }
  }
}

test('authCheck requires source read access to report healthy', async () => {
  const context = { close: async () => {} };
  const source = {
    canExport: true,
    canRead: false,
    userInfo: { userId: 'user-789' },
  };

  const { authCheck } = loadAuthCheckWithStubs({
    [browserPath]: {
      openContext: async () => context,
      openPage: async () => ({ page: true }),
      waitForReady: async () => source,
    },
  });

  const result = await authCheck({ outputDir: '/tmp/output' }, { sourceUrl: 'https://docs.qq.com/sheet/demo' });

  assert.equal(result.accountId, 'user-789');
  assert.equal(result.ok, false);
  assert.equal(result.source, source);
  assert.equal(result.context, context);
});
