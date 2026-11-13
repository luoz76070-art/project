import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assistantImageReferences, RolloutImageReferences } from '../dist/store/imageReferences.js';

test('image reference matching follows rendered assistant Markdown, not code, plain paths, roles or remote URLs', () => {
  const cwd = '/synthetic/project', external = '/synthetic/隔离副本/截图 (1).png';
  const allowed = assistantImageReferences(cwd, [{ role: 'assistant', text: `![截图](<${external}>)\n![编码](${encodeURI(external)})\n![相对](../other.png)\n![URI](file:///synthetic/file.png)` }]);
  assert.deepEqual([...allowed].sort(), [external, '/synthetic/other.png', '/synthetic/file.png'].sort());
  for (const text of [`路径 ${external}`, `[链接](${external})`, `\`![示例](${external})\``, `\`\`\`md\n![示例](${external})\n\`\`\``, `**![加粗](${external})**`, '![远程](https://example.invalid/image.png)', '![坏](bad%00.png)', `![超长](${external})${'x'.repeat(8192)}`]) {
    assert.equal(assistantImageReferences(cwd, [{ role: 'assistant', text }]).size, 0, text.slice(0, 100));
  }
  for (const role of ['user', 'tool', 'developer', 'system']) assert.equal(assistantImageReferences(cwd, [{ role, text: `![图片](${external})` }]).size, 0);
});

test('outside image history scans have a per-request budget, resume older pages and invalidate on log mutation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'image-reference-budget-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'rollout.jsonl'), target = '/synthetic/old.png';
  const oldest = JSON.stringify({ role: 'assistant', text: `![旧图](${target})` }) + '\n';
  const filler = JSON.stringify({ role: 'tool', text: 'x'.repeat(500_000) }) + '\n';
  await fs.writeFile(file, oldest + filler.repeat(23));
  let visited = 0;
  const lookup = new RolloutImageReferences(value => { visited++; return [value]; });
  await assert.rejects(lookup.has(file, '/synthetic/project', target), { statusCode: 429, message: 'image_busy' });
  assert.ok(visited > 0 && visited < 24, 'one request does not scan the whole long conversation');
  assert.equal(await lookup.has(file, '/synthetic/project', target), true);
  const warm = visited;
  assert.equal(await lookup.has(file, '/synthetic/project', target), true);
  assert.equal(visited, warm, 'a warm image lookup reuses bounded reference cache');
  await fs.writeFile(file, JSON.stringify({ role: 'assistant', text: '图片已撤回' }) + '\n');
  assert.equal(await lookup.has(file, '/synthetic/project', target), false);
  await fs.appendFile(file, oldest);
  assert.equal(await lookup.has(file, '/synthetic/project', target), true);
  const many = Array.from({ length: 2100 }, (_, i) => `![图](/synthetic/${i}.png)`).join('\n');
  await fs.writeFile(file, JSON.stringify({ role: 'assistant', text: many }) + '\n');
  assert.equal(await lookup.has(file, '/synthetic/project', '/synthetic/0.png'), true, 'the requested file survives reference-cache capacity');
  assert.equal(await lookup.has(file, '/synthetic/project', '/synthetic/2099.png'), true);
  assert.equal(await lookup.has(file, '/synthetic/project', '/synthetic/0.png'), true, 'evicted references remain discoverable');
});
