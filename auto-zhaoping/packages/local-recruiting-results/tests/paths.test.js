const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { buildProjectPaths, resolveRepoRoot } = require('../scripts/lib/paths');

test('buildProjectPaths anchors local results at the repo root', () => {
  const repoRoot = '/repo';

  assert.deepEqual(buildProjectPaths(repoRoot), {
    extractorOutputRoot: '/repo/packages/tencent-docs-recruiting-extractor/output',
    resultsRoot: '/repo/results/local-recruiting',
    latestRoot: '/repo/results/local-recruiting/latest',
    archiveRoot: '/repo/results/local-recruiting/archive',
    failedRoot: '/repo/results/local-recruiting/failed',
  });
});

test('resolveRepoRoot finds a repo root from a nested directory', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'local-results-paths-'));
  const nestedDir = path.join(tempRoot, 'a', 'b');

  await fs.mkdir(path.join(tempRoot, '.git'));
  await fs.mkdir(nestedDir, { recursive: true });

  assert.equal(resolveRepoRoot(nestedDir), tempRoot);
});

test('resolveRepoRoot accepts a .git file worktree marker', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'local-results-paths-worktree-'));
  const nestedDir = path.join(tempRoot, 'nested');

  await fs.writeFile(path.join(tempRoot, '.git'), 'gitdir: /tmp/example.git\n', 'utf8');
  await fs.mkdir(nestedDir, { recursive: true });

  assert.equal(resolveRepoRoot(nestedDir), tempRoot);
});
