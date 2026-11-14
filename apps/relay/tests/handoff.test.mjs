import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { WorkItemStore } from '../dist/workItems/store.js';
import { CaptureAssetStore } from '../dist/capture/store.js';
import { HandoffService } from '../dist/workItems/handoffService.js';
import { openHandoffTarget } from '../dist/server/handoffChannels.js';
import { png } from './fixtures/capture.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'handoff with spaces-'));
  const sessionId = randomUUID(), calls = [], listeners = new Set();
  let outcome = 'confirmed', gate = null, cwd = root, busy = false, evidence = null, closed = 0;
  const view = agentId => ({ agentId, session: { id: sessionId, title: '目标会话', directory: cwd, updatedAt: new Date().toISOString() }, connected: true,
    status: busy ? 'running' : 'idle', messages: [], questions: [], permissions: [], activity: 'thinking', historyCursor: null, partialText: false,
    submission: evidence, control: { token: 'fixture-token', canSend: true, canSteer: true, canInterrupt: true } });
  const adapter = id => ({ validSessionId: value => value === sessionId,
    async watchSession(_id, listener) { listeners.add(listener); listener(view(id)); return () => { listeners.delete(listener); closed++; }; },
    async sendMessage(target, body) { calls.push({ agentId: id, target, text: body.text, id: body.clientMessageId, delivery: body.delivery }); if (gate) await gate; return { ok: true, delivery: outcome }; } });
  const desktopSnapshot = () => ({ threadId: sessionId, status: busy ? 'inProgress' : 'idle', messages: [], control: { transport: 'native', token: 'fixture-token', activeTurnId: busy ? 'turn' : null, canSend: true, submission: evidence, queue: { items: [] } } });
  const desktop = { stop: async () => {}, messageQueue: { stop: async () => {}, revoke: async () => {} },
    followThread() { return () => { closed++; }; }, getStreamSnapshot: desktopSnapshot,
    onStreamSnapshot(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async sendMessage(body) { calls.push({ agentId: 'codex', target: body.threadId, text: body.message, id: body.clientMessageId, delivery: body.mode }); if (gate) await gate; return { ok: true, delivery: outcome }; } };
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'admin', codexHome: path.join(root, 'empty'), defaultCwd: root }, services: {
    store: { close() {}, getThreadSummary: async id => id === sessionId ? { id, threadName: '目标会话', cwd, source: 'vscode', originator: 'desktop' } : null },
    live: { stop: async () => {} }, liveTurns: { stop: async () => {} }, desktopControl: desktop,
    agentGateway: { stop: async () => {}, sessions: adapter, snapshot: () => ['claude','deepseek','opencode'].map(id => ({ id, sessionApi: 1 })) },
  } });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const request = (method, url, payload, token = 'admin') => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
  async function create(extra = {}, token = 'admin') {
    const info = (await request('GET','/api/work-items',undefined,token)).json();
    const body = { uid: randomUUID(), mutationId: randomUUID(), expectedRevision: 0, title: '事项标题', detail: '备注 原样\n第二行', kind: 'task', assets: [], codeRefs: [], ...extra };
    const response = await request('POST','/api/work-items',{ ...body, storeId: info.storeId },token);
    assert.equal(response.statusCode, 200, response.body); return response.json();
  }
  async function prepare(created, agentId = 'codex', extra = {}, token = 'admin') {
    const input = { storeId: created.storeId, expectedRevision: created.item.revision, handoffId: randomUUID(), target: { agentId, sessionId }, ...extra };
    const response = await request('POST',`/api/work-items/${created.item.uid}/handoffs/preview`,input,token);
    assert.equal(response.statusCode,200,response.body);
    return { ...input, previewHash: response.json().previewHash, confirmed: true };
  }
  const submit = (uid, input, token) => request('POST',`/api/work-items/${uid}/handoffs`,input,token);
  const read = (uid, id, token) => request('GET',`/api/work-items/${uid}/handoffs/${id}`,undefined,token);
  const pair = async () => { const { code } = (await request('POST','/api/pairing')).json(); return (await app.inject({ method:'POST',url:'/api/pairing/consume',payload:{code,name:'test'} })).json(); };
  return { root, app, request, create, prepare, submit, read, pair, calls, sessionId, listeners, closed: () => closed,
    outcome: value => { outcome = value; }, evidence: value => { evidence = value; }, busy: () => { busy = true; }, cwd: value => { cwd = value; }, gate: value => { gate = value; } };
}
for (const agent of ['codex','claude','deepseek','opencode']) test(`${agent}: exact text, managed path, immutable raw voice and receipt; state stays todo`, async t => {
  const f = await fixture(t), captureId = randomUUID(), assetId = randomUUID();
  const upload = await f.request('POST','/api/uploads',{purpose:'capture',assetId,captureId,role:'original',originalAssetId:null,fileName:'截图.png',mimeType:'image/png',dataBase64:png().toString('base64')});
  assert.equal(upload.statusCode,200,upload.body);
  const item = await f.create({capture:{id:captureId,mode:'voice',createdAt:new Date().toISOString(),assetIds:[assetId],rawTranscript:'这是语音原文'}});
  const input = await f.prepare(item,agent);
  assert.equal(f.calls.length,0,'preview must not dispatch');
  const response = await f.submit(item.item.uid,input); assert.equal(response.statusCode,202,response.body);
  const result = (await f.read(item.item.uid,input.handoffId)).json().handoff;
  assert.equal(result.status,'delivered'); assert.equal(f.calls.length,1); assert.equal(f.calls[0].text,result.text); assert.equal(f.calls[0].id,input.handoffId);
  assert.ok(result.text.includes('这是语音原文')); assert.ok(result.text.includes('备注 原样\n第二行')); assert.ok(result.text.includes(JSON.stringify(await fs.realpath(path.join(f.root,upload.json().upload.relativePath)))));
  assert.equal(result.attachments.length,1); assert.equal(result.attachments[0].orientation,1);
  assert.equal(f.calls[0].delivery,agent==='codex'?'start':'queue');
  const latest=(await f.request('GET',`/api/work-items/${item.item.uid}`)).json().item; assert.equal(latest.state,'todo'); assert.equal(latest.everDispatched,true);
  assert.equal(latest.currentAttempt.delivery,'none'); assert.equal(latest.currentAttempt.lastTurn,null);
  assert.equal((await f.request('DELETE',`/api/work-items/${latest.uid}`,{mutationId:randomUUID(),expectedRevision:latest.revision})).statusCode,409);
  assert.equal((await f.request('POST',`/api/work-items/${latest.uid}/verify`,{mutationId:randomUUID(),expectedRevision:latest.revision,decision:'accept'})).statusCode,409);
  assert.deepEqual((await f.submit(item.item.uid,input)).json(),response.json()); assert.equal(f.calls.length,1);
  assert.equal((await f.submit(item.item.uid,{...input,previewHash:'0'.repeat(64)})).statusCode,409);
  assert.equal(f.listeners.size,0);
});
test('concurrent replay returns the same receipt and invokes adapter once', async t => {
  const f=await fixture(t), item=await f.create(), input=await f.prepare(item,'claude'); let release;
  f.gate(new Promise(resolve=>release=resolve)); const a=f.submit(item.item.uid,input), b=f.submit(item.item.uid,input);
  while(!f.calls.length) await tick(); release(); const [one,two]=await Promise.all([a,b]);
  assert.equal(one.statusCode,202,one.body); assert.deepEqual(one.json(),two.json()); assert.equal(f.calls.length,1);
});
test('unknown never retries; same target blocked across cards; explicit second send to other target',async t=>{
  const f=await fixture(t),item=await f.create(),input=await f.prepare(item,'deepseek'); f.outcome('uncertain');
  await f.submit(item.item.uid,input); assert.equal((await f.read(item.item.uid,input.handoffId)).json().handoff.status,'unknown');
  await f.submit(item.item.uid,input); assert.equal(f.calls.length,1);
  const current=(await f.request('GET',`/api/work-items/${item.item.uid}`)).json();
  const blocked=await f.request('POST',`/api/work-items/${item.item.uid}/handoffs/preview`,{...input,confirmed:undefined,previewHash:undefined,expectedRevision:current.item.revision,handoffId:randomUUID(),retryOf:input.handoffId}); assert.equal(blocked.statusCode,409);
  const other=await f.create(); const cross=await f.request('POST',`/api/work-items/${other.item.uid}/handoffs/preview`,{storeId:other.storeId,expectedRevision:1,handoffId:randomUUID(),target:input.target});assert.equal(cross.statusCode,409);
  const retry=await f.prepare(current,'opencode',{retryOf:input.handoffId}); f.outcome('confirmed');await f.submit(item.item.uid,retry);
  const record=(await f.read(item.item.uid,retry.handoffId)).json().handoff; assert.equal(record.sendNumber,2);assert.equal(record.retryOf,input.handoffId);assert.equal(f.calls.length,2);
});
test('same-ID authoritative receipt resolves unknown through GET without dispatch',async t=>{
  const f=await fixture(t), item=await f.create(), input=await f.prepare(item,'claude');f.outcome('submitted');await f.submit(item.item.uid,input);
  assert.equal((await f.read(item.item.uid,input.handoffId)).json().handoff.status,'submitted');
  f.evidence({clientMessageId:input.handoffId,action:'message',delivery:'confirmed'});
  assert.equal((await f.read(item.item.uid,input.handoffId)).json().handoff.status,'delivered');assert.equal(f.calls.length,1);
});
test('busy Desktop queues; no automatic steer; cancellation after preview has zero sends',async t=>{
  const f=await fixture(t), item=await f.create(); f.busy(); const input=await f.prepare(item);
  assert.equal(f.calls.length,0);assert.equal((await f.request('GET',`/api/work-items/${item.item.uid}`)).json().item.handoffs,undefined);
  await f.submit(item.item.uid,input);assert.equal(f.calls[0].delivery,'queue');assert.equal((await f.read(item.item.uid,input.handoffId)).json().handoff.status,'queued');
});
test('preview rejects non-todo and excessive text with exact excess; changed cwd/hash rejects before send',async t=>{
  const f=await fixture(t),long=await f.create({detail:'a'.repeat(20001)});
  const body={storeId:long.storeId,expectedRevision:1,handoffId:randomUUID(),target:{agentId:'opencode',sessionId:f.sessionId}};
  const over=await f.request('POST',`/api/work-items/${long.item.uid}/handoffs/preview`,body);assert.equal(over.statusCode,413);assert.equal(over.json().excess,over.json().length-20000);
  const item=await f.create(),input=await f.prepare(item);f.cwd(path.join(f.root,'changed'));
  const stale=await f.submit(item.item.uid,input);assert.equal(stale.statusCode,409);assert.equal(f.calls.length,0);
  await f.request('POST',`/api/work-items/${item.item.uid}/actions`,{mutationId:randomUUID(),expectedRevision:1,action:'start'});
  const nonTodo=await f.request('POST',`/api/work-items/${item.item.uid}/handoffs/preview`,{...body,expectedRevision:2,handoffId:randomUUID()});assert.equal(nonTodo.statusCode,409);
});
test('revoked in-flight device cannot write result, reconnect or replay; other devices can read',async t=>{
  const f=await fixture(t),device=await f.pair(),other=await f.pair(),item=await f.create({},device.token),input=await f.prepare(item,'claude',{},device.token);
  let release;f.gate(new Promise(resolve=>release=resolve));const sending=f.submit(item.item.uid,input,device.token);
  while(!f.calls.length)await tick(); await f.request('DELETE',`/api/devices/${device.device.id}`);release();
  assert.equal((await sending).statusCode,401);assert.equal((await f.submit(item.item.uid,input,device.token)).statusCode,401);
  const current=(await f.request('GET',`/api/work-items/${item.item.uid}`,undefined,other.token)).json();assert.equal(current.item.handoffs[0].status,'sending');
  assert.equal(f.calls.length,1);assert.equal(f.listeners.size,0);
});
test('durable sending reservation becomes unknown on restart; replay never invokes upstream',async t=>{
  const f=await fixture(t),item=await f.create(),input=await f.prepare(item);
  await f.submit(item.item.uid,input);
  const file=path.join(f.root,'.mobile-codex','work-items.json'),data=JSON.parse(await fs.readFile(file,'utf8'));
  data.entries[0].item.handoffs[0].status='sending';await fs.writeFile(file,JSON.stringify(data));
  const store=await WorkItemStore.open(f.root);assert.equal(store.get(item.item.uid).item.handoffs[0].status,'unknown');
  const service=new HandoffService(f.root,new CaptureAssetStore(f.root),async()=>store,async()=>assert.fail('restart replay must not open or send'));
  assert.deepEqual(await service.submit(item.item.uid,input,'admin',()=>{}),{handoffId:input.handoffId,accepted:true});assert.equal(f.calls.length,1);
});
test('failed reservation persists no record and never invokes a channel',async t=>{
  const f=await fixture(t),item=await f.create(),input=await f.prepare(item);
  const original=fs.open;
  t.mock.method(fs,'open',async(file,...args)=>{if(String(file).includes('work-items.json.') && !String(file).endsWith('.bak'))throw new Error('disk failed');return original(file,...args);});
  const result=await f.submit(item.item.uid,input);assert.equal(result.statusCode,503,result.body);assert.equal(f.calls.length,0);
});
test('channel subscription timeout releases late watch handles and prevents sends',async()=>{
  const controller=new AbortController();let resolve,closed=0;
  const open=openHandoffTarget({gateway:{sessions:()=>({validSessionId:()=>true,watchSession:()=>new Promise(r=>resolve=r)})}});
  const pending=open({agentId:'claude',sessionId:randomUUID()},controller.signal);controller.abort();await assert.rejects(pending);resolve(()=>closed++);await tick();assert.equal(closed,1);
});
test('initial Claude not-ready view waits for the authoritative snapshot before allowing preview',async()=>{
  const id=randomUUID(),controller=new AbortController();let listener,closed=0,opened=false;
  const snapshot={agentId:'claude',session:{id,title:'target',directory:'/fixture'},connected:true,control:{token:'token',canSend:false},submission:null};
  const open=openHandoffTarget({gateway:{sessions:()=>({validSessionId:()=>true,watchSession:async(_id,callback)=>{listener=callback;callback(snapshot);return()=>closed++;}})}});
  const pending=open({agentId:'claude',sessionId:id},controller.signal).then(value=>{opened=true;return value;});await tick();assert.equal(opened,false);
  listener({...snapshot,control:{token:'token',canSend:true}});const connection=await pending;assert.equal(connection.writable(),true);connection.close();assert.equal(closed,1);
});
test('32 handoffs are retained, capacity rejects the 33rd; corrupted duplicate IDs fail closed',async t=>{
  const f=await fixture(t),item=await f.create(),input=await f.prepare(item);await f.submit(item.item.uid,input);
  const store=await WorkItemStore.open(f.root);
  for(let i=1;i<32;i++){
    const current=store.get(item.item.uid).item,last=current.handoffs.at(-1),now=new Date().toISOString();
    const record={...last,handoffId:randomUUID(),retryOf:last.handoffId,sendNumber:i+1,status:'sending',createdAt:now,updatedAt:now};
    await store.reserveHandoff(item.item.uid,current.revision,record,()=>{});await store.settleHandoff(item.item.uid,record.handoffId,'delivered',null,()=>{});
  }
  const current=store.get(item.item.uid).item,last=current.handoffs.at(-1);
  await assert.rejects(store.reserveHandoff(item.item.uid,current.revision,{...last,handoffId:randomUUID(),retryOf:last.handoffId,sendNumber:33},()=>{}),{statusCode:507});
  assert.equal(store.get(item.item.uid).item.handoffs.length,32);
  const file=path.join(f.root,'.mobile-codex','work-items.json'),data=JSON.parse(await fs.readFile(file,'utf8'));
  data.entries[0].item.handoffs[1].handoffId=data.entries[0].item.handoffs[0].handoffId;await fs.writeFile(file,JSON.stringify(data));
  const corrupt=await WorkItemStore.open(f.root);assert.throws(()=>corrupt.info(),{statusCode:503});
});
test('changed image after preview rejects before dispatch; another paired device can hand off shared assets',async t=>{
  const f=await fixture(t),first=await f.pair(),second=await f.pair(),captureId=randomUUID(),assetId=randomUUID();
  const upload=await f.request('POST','/api/uploads',{purpose:'capture',assetId,captureId,role:'original',originalAssetId:null,fileName:'image.png',mimeType:'image/png',dataBase64:png().toString('base64')},first.token);
  const item=await f.create({capture:{id:captureId,mode:'image',createdAt:new Date().toISOString(),assetIds:[assetId],rawTranscript:null}},first.token);
  const input=await f.prepare(item,'claude',{},second.token);
  const file=path.join(f.root,upload.json().upload.relativePath),data=await fs.readFile(file);data[30]^=1;await fs.writeFile(file,data);
  assert.equal((await f.submit(item.item.uid,input,second.token)).statusCode,422);assert.equal(f.calls.length,0);
});
test('handoff SSE emits only identity/revisions and never text or file paths',async t=>{
  const f=await fixture(t),item=await f.create(),input=await f.prepare(item);
  const base=await f.app.listen({host:'127.0.0.1',port:0});const token=(await f.request('POST','/api/work-items/stream-token',{})).json().streamToken;
  const abort=new AbortController();t.after(()=>abort.abort());const stream=await fetch(`${base}/api/work-items/events?streamToken=${token}`,{signal:abort.signal});const reader=stream.body.getReader();await reader.read();
  await f.submit(item.item.uid,input);const event=Buffer.from((await reader.read()).value).toString();assert.match(event,/work-item.changed/);assert.ok(!event.includes('备注'));assert.ok(!event.includes(f.root));abort.abort();
});
test('after checking, the user can resolve an unknown result: not_received unlocks the target, delivered closes it; neither dispatches',async t=>{
  const f=await fixture(t),item=await f.create(),input=await f.prepare(item,'opencode'); f.outcome('uncertain');
  await f.submit(item.item.uid,input); assert.equal((await f.read(item.item.uid,input.handoffId)).json().handoff.status,'unknown');
  const resolve=(uid,id,outcome)=>f.request('POST',`/api/work-items/${uid}/handoffs/${id}/resolve`,{outcome});
  assert.equal((await resolve(item.item.uid,input.handoffId,'maybe')).statusCode,400);
  assert.equal((await resolve(item.item.uid,randomUUID(),'delivered')).statusCode,404);
  const done=await resolve(item.item.uid,input.handoffId,'not_received'); assert.equal(done.statusCode,200,done.body);
  assert.equal(done.json().handoff.status,'rejected'); assert.equal(done.json().handoff.reason,'user_confirmed_not_received');
  assert.equal((await resolve(item.item.uid,input.handoffId,'delivered')).statusCode,409,'only unknown results can be resolved');
  assert.equal(f.calls.length,1,'resolving never dispatches');
  const current=(await f.request('GET',`/api/work-items/${item.item.uid}`)).json(); assert.equal(current.item.state,'todo');
  f.outcome('uncertain'); const retry=await f.prepare(current,'opencode',{retryOf:input.handoffId});
  await f.submit(item.item.uid,retry); assert.equal((await f.read(item.item.uid,retry.handoffId)).json().handoff.status,'unknown');
  const seen=await resolve(item.item.uid,retry.handoffId,'delivered'); assert.equal(seen.statusCode,200,seen.body);
  assert.equal(seen.json().handoff.status,'delivered'); assert.equal(seen.json().handoff.reason,'user_confirmed_delivered');
  assert.equal(f.calls.length,2);
  const other=await f.create(); const unlocked=await f.request('POST',`/api/work-items/${other.item.uid}/handoffs/preview`,{storeId:other.storeId,expectedRevision:other.item.revision,handoffId:randomUUID(),target:input.target});
  assert.equal(unlocked.statusCode,200,unlocked.body);
});
