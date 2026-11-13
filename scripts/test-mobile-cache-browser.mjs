// Open the printed loopback URL in a browser. Tests use a fresh, synthetic origin;
// no real profiles, messages, model requests or desktop control are involved.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({ entryPoints: [path.join(root, 'apps/mobile/src/features/chat/runtime.ts')], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'CacheProbe', define: { 'import.meta.env': '{}' } });
function probe() {
  const api = CacheProbe, scope = 'browser-probe';
  const bodyKey = `mobileCodexThreadRuntimeCacheV2:${scope}`;
  const inputKey = `mobileCodexThreadInputCacheV1:${scope}`;
  const check = (value, label) => { if (!value) throw new Error(label); };
  const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`thread-${i}`, { ...api.defaultRuntime(), draft: `draft-${i}`, pendingMessageId: `client-${i}`, pendingMessageText: `pending-${i}` }]));
  check(api.saveThreadRuntimeCache(many, scope).status === 'saved', '25 drafts save');
  const restored = api.loadThreadRuntimeCache(scope);
  check(Object.keys(restored).length === 25 && Object.keys(many).every(id => restored[id].pendingMessageId === many[id].pendingMessageId), '25 identities restored');
  const large = Object.fromEntries(Array.from({ length: 6 }, (_, t) => [`thread-${t}`, { ...api.defaultRuntime(), draft: `new-draft-${t}`, pendingMessageId: `new-client-${t}`, pendingMessageText: `pending-${t}`, messages: Array.from({ length: 120 }, (_, i) => ({ id: `message-${t}-${i}`, role: 'assistant', kind: 'message', timestamp: '2026-10-29', text: `${t}-${i}:` + 'x'.repeat(8192) })) }]));
  const largeResult = api.saveThreadRuntimeCache(large, scope);
  const largeRestored = api.loadThreadRuntimeCache(scope);
  check(Object.keys(large).every(id => largeRestored[id]?.draft === large[id].draft), 'large history preserved new drafts');
  const bodyBytes = localStorage.getItem(bodyKey).length * 2;
  check(bodyBytes <= 2 * 1024 * 1024, 'body byte budget');
  let rawQuota = '';
  try { localStorage.setItem('oversized-synthetic-history', 'x'.repeat(6 * 1024 * 1024)); }
  catch (error) { rawQuota = error.name; }
  localStorage.removeItem('oversized-synthetic-history');
  check(rawQuota === 'QuotaExceededError', 'real browser quota enforced');
  const fillers = [];
  function fillOrigin() {
    for (const size of [1024 * 1024, 256 * 1024, 16 * 1024, 1024, 128]) {
      for (let n = 0; n < 64; n++) {
        const key = `synthetic-unrelated-${fillers.length}`;
        try { localStorage.setItem(key, 'z'.repeat(size)); fillers.push(key); }
        catch (error) { check(error.name === 'QuotaExceededError', 'fill reached quota'); break; }
      }
    }
  }
  fillOrigin();
  const occupied = fillers.map(key => [key, localStorage.getItem(key).length]);
  const newDraft = '新草稿'.repeat(5000);
  const state = { thread: { ...api.defaultRuntime(), draft: newDraft, pendingMessageId: 'stable-client', pendingMessageText: 'uncertain' } };
  const retry = api.saveThreadRuntimeCache(state, scope);
  check(retry.status === 'history-reduced', 'full origin released owned body');
  check(api.loadThreadRuntimeCache(scope).thread?.draft === newDraft, 'input saved after freeing history');
  check(occupied.every(([key, length]) => localStorage.getItem(key)?.length === length), 'unrelated storage untouched');
  fillOrigin();
  const previous = localStorage.getItem(inputKey);
  const blocked = api.saveThreadRuntimeCache({ thread: { ...state.thread, draft: newDraft.repeat(3) } }, scope);
  check(blocked.status === 'input-failed', 'input failure surfaced');
  check(localStorage.getItem(inputKey) === previous, 'last durable input preserved');
  check(api.threadCacheSaveNotice(blocked).includes('尚未保存'), 'honest failure notice');
  for (const key of fillers) localStorage.removeItem(key);
  check(api.saveThreadRuntimeCache(state, scope).status === 'saved', 'retry after capacity restored');
  check(api.loadThreadRuntimeCache(scope).thread.pendingMessageId === 'stable-client', 'pending identity retained');
  return { ok: true, browser: navigator.userAgent, draftsRecovered: 25, largeThreads: 6, messagesPerThread: 120, bodyBytes, largeStatus: largeResult.status, rawQuota, quotaRetryStatus: retry.status, blockedStatus: blocked.status, unrelatedStoragePreserved: true, retryRecovered: true };
}

let resolveResult;
const finished = new Promise(resolve => { resolveResult = resolve; });
const server = createServer(async (req, res) => {
  if (req.url === '/cache.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle.outputFiles[0].text); return; }
  if (req.url === '/result' && req.method === 'POST') {
    let text = ''; for await (const chunk of req) text += chunk;
    const result = JSON.parse(text); res.end('ok'); resolveResult(result); return;
  }
  res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
  res.end(`<!doctype html><html><meta charset="utf-8"><title>缓存容量回归</title><body><h1>隔离的浏览器缓存测试</h1><pre id="result">运行中</pre><script src="/cache.js"></script><script>let result;try{result=(${probe.toString()})();}catch(error){result={ok:false,error:error.message};}document.getElementById('result').textContent=JSON.stringify(result,null,2);fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});</script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(`CACHE_BROWSER_TEST=http://127.0.0.1:${server.address().port}`);
const timeout = setTimeout(() => resolveResult({ ok: false, error: 'No browser result within 120s' }), 120000);
try {
  const result = await finished;
  const out = path.join(root, 'output/audit/2026-10-29/reliability');
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'browser-cache.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result)); assert.equal(result.ok, true, result.error);
} finally { clearTimeout(timeout); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
