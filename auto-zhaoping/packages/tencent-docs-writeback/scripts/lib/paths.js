const fs = require('node:fs');
const path = require('node:path');

function resolveRepoRoot(startDir = process.cwd()) {
  let currentDir = path.resolve(startDir);

  for (;;) {
    if (fs.existsSync(path.join(currentDir, '.git'))) return currentDir;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to resolve repository root from ${startDir}`);
    }

    currentDir = parentDir;
  }
}

function buildProjectPaths(repoRoot) {
  return {
    latestInputRoot: path.join(repoRoot, 'results', 'local-recruiting', 'latest'),
    writebackRoot: path.join(repoRoot, 'results', 'tencent-docs-writeback'),
    runsRoot: path.join(repoRoot, 'results', 'tencent-docs-writeback', 'runs'),
    statePath: path.join(repoRoot, 'results', 'tencent-docs-writeback', 'state.json'),
  };
}

module.exports = { buildProjectPaths, resolveRepoRoot };
