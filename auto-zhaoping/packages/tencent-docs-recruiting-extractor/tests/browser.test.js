const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');

const browserPath = require.resolve('../scripts/lib/browser');
const tablePath = require.resolve('../scripts/lib/table');

function loadBrowserWithStubs(stubs) {
  const original = new Map();
  const entries = Object.entries(stubs);

  for (const [modulePath, exports] of entries) {
    original.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = { exports, id: modulePath, filename: modulePath, loaded: true };
  }

  delete require.cache[browserPath];

  try {
    return require(browserPath);
  } finally {
    delete require.cache[browserPath];
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

function createLocator({ count = 1, click = async () => {}, hover = async () => {} } = {}) {
  return {
    first() {
      return this;
    },
    async count() {
      return count;
    },
    click,
    hover,
  };
}

test('waitForReady waits for read access after login appears', async () => {
  const { waitForReady } = require('../scripts/lib/browser');
  const snapshots = [
    { canExport: false, canRead: false, isLoggedIn: true, userInfo: { userType: 'wx' } },
    { canExport: true, canRead: true, isLoggedIn: true, userInfo: { userType: 'wx' } },
  ];
  const waits = [];
  const page = {
    async evaluate() {
      return snapshots.shift();
    },
    async waitForLoadState(state) {
      waits.push(state);
    },
    async waitForTimeout(ms) {
      waits.push(ms);
    },
  };
  const report = { permissionSnapshots: [], networkSamples: [], downloads: [], errors: [] };

  const ready = await waitForReady(page, report, 'source');

  assert.equal(ready.canRead, true);
  assert.equal(report.permissionSnapshots.length, 2);
  assert.deepEqual(waits, ['networkidle', 1000, 'networkidle', 2000]);
});

test('exportSourceRows falls back to clipboard when downloaded file parsing fails', async () => {
  const clipboardReads = [];
  const originalExecFileSync = childProcess.execFileSync;
  childProcess.execFileSync = (command) => {
    clipboardReads.push(command);
    if (command === 'pbpaste') {
      return 'name\tcity\nAlice\tShenzhen';
    }
    return '';
  };

  const { exportSourceRows } = loadBrowserWithStubs({
    [tablePath]: {
      parseDelimitedText(text) {
        return text.split('\n').map((line) => line.split('\t'));
      },
      async parseExportedFile() {
        throw new Error('broken downloaded export');
      },
      rowsToTsv(rows) {
        return rows.map((row) => row.join('\t')).join('\n');
      },
    },
  });

  const downloads = [
    {
      suggestedFilename() {
        return 'recruiter.csv';
      },
      async saveAs() {},
    },
  ];

  const page = {
    async waitForLoadState() {},
    async waitForTimeout() {},
    async evaluate() {
      return this._evaluations.shift();
    },
    _evaluations: [
      {
        canExport: true,
        canRead: true,
        docInfo: { padTitle: 'Recruiting' },
        isLoggedIn: true,
        userInfo: { userType: 'wx' },
      },
      { x: 10, y: 20 },
    ],
    locator(selector) {
      if (selector === '[aria-label="file"]') {
        return createLocator();
      }
      throw new Error(`Unexpected locator: ${selector}`);
    },
    getByRole(role, options) {
      const name = String(options.name);
      if (role !== 'menuitem') {
        throw new Error(`Unexpected role: ${role}`);
      }
      if (name.includes('导出为') || name.includes('Export')) {
        return createLocator();
      }
      if (name.includes('本地Excel表格') || name.includes('Excel')) {
        return createLocator({ count: 0 });
      }
      if (name.includes('本地CSV文件') || name.includes('CSV')) {
        return createLocator();
      }
      throw new Error(`Unexpected role query: ${name}`);
    },
    async waitForEvent(eventName) {
      assert.equal(eventName, 'download');
      return downloads.shift();
    },
    async waitForSelector(selector) {
      assert.equal(selector, 'input.bar-label');
    },
    mouse: {
      async click() {},
    },
    keyboard: {
      async press() {},
    },
  };
  const report = { permissionSnapshots: [], networkSamples: [], downloads: [], errors: [] };

  try {
    const result = await exportSourceRows(page, '/tmp/output', report);

    assert.equal(result.ok, true);
    assert.equal(result.method, 'clipboard');
    assert.deepEqual(result.rows, [
      ['name', 'city'],
      ['Alice', 'Shenzhen'],
    ]);
    assert.equal(result.sheetName, 'Recruiting');
    assert.match(report.errors[0], /broken downloaded export/);
    assert.deepEqual(clipboardReads, ['pbpaste']);
  } finally {
    childProcess.execFileSync = originalExecFileSync;
  }
});
