const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const packageRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(packageRoot, 'scripts', 'login-healthcheck.js');

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'healthcheck-cli-test-'));
}

async function runHealthcheckCli(tempDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, '--config', 'config.json'], {
      cwd: tempDir,
      env: {
        ...process.env,
        NODE_OPTIONS: `--require ${path.join(tempDir, 'stub-loader.cjs')}`,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr, stdout }));
  });
}

async function writeHealthcheckFixture(tempDir, runContext, authCheckResult) {
  await fs.mkdir(runContext.outputDir, { recursive: true });
  await fs.writeFile(path.join(tempDir, 'config.json'), JSON.stringify({ sourceUrl: 'https://docs.qq.com/sheet/demo' }), 'utf8');
  await fs.writeFile(
    path.join(tempDir, 'stub-loader.cjs'),
    `'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const Module = require('node:module');
const runContext = ${JSON.stringify(runContext)};
const authCheckResult = ${JSON.stringify(authCheckResult)};
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
  const resolved = Module._resolveFilename(request, parent, isMain);
  if (resolved.endsWith(path.join('scripts', 'auth-check.js'))) {
    return {
      authCheck: async () => ({
        ...authCheckResult,
        context: { close: async () => {} },
      }),
    };
  }
  if (resolved.endsWith(path.join('scripts', 'lib', 'run-context.js'))) {
    return {
      createRunContext: async () => runContext,
      writeJson: async (filePath, data) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\\n', 'utf8');
      },
    };
  }
  return originalLoad(request, parent, isMain);
};
`,
    'utf8'
  );
}

test('login-healthcheck writes the same summary object it prints', async () => {
  const tempDir = await makeTempDir();
  const runContext = {
    outputDir: path.join(tempDir, 'output', 'run-1'),
    runId: 'run-1',
    startedAt: '2026-03-24T13:00:00.000Z',
    summaryPath: path.join(tempDir, 'output', 'run-1', 'run-summary.json'),
  };

  await writeHealthcheckFixture(tempDir, runContext, {
    accountId: 'user-123',
    ok: true,
    source: { canExport: true, canRead: true },
  });

  const { code, stderr, stdout } = await runHealthcheckCli(tempDir);
  assert.equal(code, 0, stderr);

  const written = JSON.parse(await fs.readFile(runContext.summaryPath, 'utf8'));
  const printed = JSON.parse(stdout.trim());

  assert.deepEqual(written, printed);
  assert.deepEqual(written, {
    accountId: 'user-123',
    ok: true,
    sourceCanExport: true,
    sourceCanRead: true,
  });
});

test('login-healthcheck stays unhealthy when source can export but cannot read', async () => {
  const tempDir = await makeTempDir();
  const runContext = {
    outputDir: path.join(tempDir, 'output', 'run-2'),
    runId: 'run-2',
    startedAt: '2026-03-24T14:00:00.000Z',
    summaryPath: path.join(tempDir, 'output', 'run-2', 'run-summary.json'),
  };

  await writeHealthcheckFixture(tempDir, runContext, {
    accountId: 'user-456',
    ok: false,
    source: { canExport: true, canRead: false },
  });

  const { code, stderr, stdout } = await runHealthcheckCli(tempDir);
  assert.equal(code, 2, stderr);

  const written = JSON.parse(await fs.readFile(runContext.summaryPath, 'utf8'));
  const printed = JSON.parse(stdout.trim());

  assert.deepEqual(written, printed);
  assert.deepEqual(written, {
    accountId: 'user-456',
    ok: false,
    sourceCanExport: true,
    sourceCanRead: false,
  });
});
