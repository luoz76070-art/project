const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { loadWritebackConfig } = require('../scripts/lib/config');

test('loadWritebackConfig reads targetUrl from json', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-config-'));
  const configPath = path.join(tempRoot, 'writeback.config.json');

  await fs.writeFile(configPath, JSON.stringify({ targetUrl: 'https://example.com/docs' }));

  await assert.doesNotReject(async () => {
    const config = await loadWritebackConfig(configPath);
    assert.equal(config.targetUrl, 'https://example.com/docs');
  });
});

test('loadWritebackConfig rejects configs without targetUrl', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-config-'));
  const configPath = path.join(tempRoot, 'writeback.config.json');

  await fs.writeFile(configPath, JSON.stringify({}));

  await assert.rejects(loadWritebackConfig(configPath), /targetUrl/);
});

test('loadWritebackConfig rejects malformed targetUrl values', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-config-'));
  const configPath = path.join(tempRoot, 'writeback.config.json');

  await fs.writeFile(configPath, JSON.stringify({ targetUrl: 'javascript:alert(1)' }));

  await assert.rejects(loadWritebackConfig(configPath), /Invalid targetUrl/);
});

test('loadWritebackConfig rejects null json roots', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-config-'));
  const configPath = path.join(tempRoot, 'writeback.config.json');

  await fs.writeFile(configPath, 'null');

  await assert.rejects(loadWritebackConfig(configPath), /Invalid writeback config/);
});
