const fs = require('node:fs');
const path = require('node:path');

function resolveRepoRoot(startDir = process.cwd()) {
  let currentDir = path.resolve(startDir);

  for (;;) {
    const gitPath = path.join(currentDir, '.git');
    if (fs.existsSync(gitPath)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to resolve repository root from ${startDir}`);
    }

    currentDir = parentDir;
  }
}

function buildProjectPaths(repoRoot) {
  const resultsRoot = path.join(repoRoot, 'results', 'local-recruiting');

  return {
    extractorOutputRoot: path.join(repoRoot, 'packages', 'tencent-docs-recruiting-extractor', 'output'),
    resultsRoot,
    latestRoot: path.join(resultsRoot, 'latest'),
    archiveRoot: path.join(resultsRoot, 'archive'),
    failedRoot: path.join(resultsRoot, 'failed'),
  };
}

module.exports = {
  buildProjectPaths,
  resolveRepoRoot,
};
