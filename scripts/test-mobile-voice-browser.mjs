// Synthetic loopback origin only. Open the printed URL to exercise real React lifecycle,
// WebCrypto and localStorage across a browser reload; never connects to a real Relay.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useVoiceRecovery } from './apps/mobile/src/features/voice/useVoiceRecovery';
import { voiceDraftHash, voiceRecoveryTtl } from './apps/mobile/src/features/voice/recovery';
import { saveThreadRuntimeCache, loadThreadRuntimeCache, defaultRuntime } from './apps/mobile/src/features/chat/runtime';
import { saveAgentDrafts, loadAgentDrafts } from './apps/mobile/src/features/agents/runtime';
const scope = 'synthetic-browser';
const recordKey = 'mobileCodexVoicePendingV1:' + scope;
async function boot() {
  if (!sessionStorage.getItem('reload-ready')) {
    saveThreadRuntimeCache({ original: { ...defaultRuntime(), draft: '原草稿' }, other: { ...defaultRuntime(), draft: '不要覆盖' } }, scope);
    saveAgentDrafts(scope, { 'deepseek:11111111-1111-4111-8111-111111111111': 'Agent原草稿' });
    const records = await Promise.all([['codex:original', '原草稿', 'asr'], ['deepseek:11111111-1111-4111-8111-111111111111', 'Agent原草稿', 'refine']].map(async ([thread, text, stage]) => ({ scope, thread, stage, requestId: crypto.randomUUID(), createdAt: Date.now(), draftHash: await voiceDraftHash(text) })));
    localStorage.setItem(recordKey, JSON.stringify(records));
    sessionStorage.setItem('reload-ready', '1'); location.reload(); return;
  }
  function Probe() {
    const recovery = useVoiceRecovery(scope, location.origin, 'synthetic-token');
    const [result, setResult] = useState('恢复中…');
    useEffect(() => {
      const timer = setInterval(async () => {
        if (localStorage.getItem(recordKey)) return;
        clearInterval(timer);
        const codex = loadThreadRuntimeCache(scope), agent = loadAgentDrafts(scope);
        const ok = codex.original?.draft === '原草稿\\n\\n取回的语音结果' && codex.other?.draft === '不要覆盖' && agent['deepseek:11111111-1111-4111-8111-111111111111'] === 'Agent原草稿\\n\\n取回的语音结果';
        setResult(JSON.stringify({ ok, codex: codex.original?.draft, other: codex.other?.draft, agent: agent['deepseek:11111111-1111-4111-8111-111111111111'], pendingCleared: true }, null, 2));
        await fetch('/report', { method: 'POST', body: JSON.stringify({ ok, pendingCleared: true }) });
      }, 100);
      return () => clearInterval(timer);
    }, []);
    return <main style={{maxWidth:420,margin:'32px auto',fontFamily:'sans-serif',padding:16}}><h1>V1 语音恢复验收</h1><p>重新加载后，只用 GET 恢复原会话</p><pre style={{whiteSpace:'pre-wrap'}}>{result}</pre><p role="status">{recovery.notice?.message}</p></main>;
  }
  createRoot(document.getElementById('root')).render(<React.StrictMode><Probe /></React.StrictMode>);
}
boot().catch(error => fetch('/report', {method:'POST', body:JSON.stringify({ok:false,error:String(error)})}));
` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', nodePaths: [`${process.cwd()}/apps/mobile/node_modules`], define: { 'process.env.NODE_ENV': '"development"' } });
let finish; const done = new Promise(resolve => { finish = resolve; });
let queries = 0, voicePosts = 0;
const server = createServer(async (req, res) => {
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  if (req.url.startsWith('/api/voice/')) {
    if (req.method !== 'GET') voicePosts++;
    queries++; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'completed', outcome: 'succeeded', requestId: req.url.split('/').at(-1), text: '取回的语音结果', expiresAt: Date.now() + 900000 })); return;
  }
  if (req.url === '/report') {
    let body = ''; for await (const chunk of req) body += chunk;
    res.end('ok'); finish({ ...JSON.parse(body), queries, voicePosts }); return;
  }
  res.setHeader('Content-Type', 'text/html;charset=utf-8');
  res.end('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>V1 语音恢复验收</title><div id="root"></div><script src="/app.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(`VOICE_BROWSER_TEST=http://127.0.0.1:${server.address().port}`);
const deadline = setTimeout(() => finish({ ok: false, error: 'Browser timed out' }), 180000);
try { const result = await done; console.log(JSON.stringify(result)); assert.equal(result.ok, true); assert.equal(result.voicePosts, 0); assert.ok(result.queries >= 2); }
finally { clearTimeout(deadline); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
