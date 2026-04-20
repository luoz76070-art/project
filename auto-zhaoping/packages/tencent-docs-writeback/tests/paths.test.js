const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { buildProjectPaths, resolveRepoRoot } = require('../scripts/lib/paths');

test('buildProjectPaths anchors writeback paths at the repo root', () => {
  const repoRoot = '/repo';

  assert.deepEqual(buildProjectPaths(repoRoot), {
    latestInputRoot: '/repo/results/local-recruiting/latest',
    writebackRoot: '/repo/results/tencent-docs-writeback',
    runsRoot: '/repo/results/tencent-docs-writeback/runs',
    statePath: '/repo/results/tencent-docs-writeback/state.json',
  });
});

test('resolveRepoRoot finds a repo root from a nested directory', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-paths-'));
  const nestedDir = path.join(tempRoot, 'a', 'b');

  await fs.mkdir(path.join(tempRoot, '.git'));
  await fs.mkdir(nestedDir, { recursive: true });

  assert.equal(resolveRepoRoot(nestedDir), tempRoot);
});
