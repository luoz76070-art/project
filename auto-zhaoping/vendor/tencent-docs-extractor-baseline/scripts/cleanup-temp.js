const fs = require('fs/promises');

async function cleanupTemp(tempFiles, shouldDelete) {
  const deletedFiles = [];
  const keptFiles = [];

  for (const filePath of tempFiles.filter(Boolean)) {
    if (!shouldDelete) {
      keptFiles.push(filePath);
      continue;
    }
    try {
      await fs.unlink(filePath);
      deletedFiles.push(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      keptFiles.push(filePath);
    }
  }

  return { deletedFiles, keptFiles };
}

module.exports = { cleanupTemp };
