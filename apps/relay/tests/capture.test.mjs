import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sanitizeCaptureImage } from '../dist/capture/image.js';
import { CaptureAssetStore } from '../dist/capture/store.js';
import { WorkItemStore } from '../dist/workItems/store.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { chunk, exif, png, jpeg, segment, webp, riffChunk, entropy } from './fixtures/capture.mjs';
const payload = (data = png(), fields = {}) => ({ purpose: 'capture', assetId: randomUUID(), captureId: randomUUID(), role: 'original', originalAssetId: null, fileName: '截图.png', mimeType: 'image/png', dataBase64: data.toString('base64'), ...fields });
const mutation = expectedRevision => ({ mutationId: randomUUID(), expectedRevision });
const creation = (captureId, assetIds, mode = 'image') => ({ uid: randomUUID(), ...mutation(0), title: '事项', detail: '用户说明', kind: 'task', assets: [], codeRefs: [], capture: { id: captureId, mode, createdAt: new Date().toISOString(), assetIds, rawTranscript: mode === 'voice' ? '不能丢失的原文' : null } });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-'));
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'admin', codexHome: path.join(root, 'empty'), defaultCwd: root }, services: {
    store: { close() {} }, live: { stop: async () => {} }, liveTurns: { stop: async () => {} }, desktopControl: { stop: async () => {}, messageQueue: { stop: async () => {}, revoke: async () => {} } }, agentGateway: { stop: async () => {} },
  } });
  t.after(async () => { app.server.closeAllConnections(); await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const request = async (method, url, body, token = 'admin') => {
    if (method === 'POST' && url === '/api/work-items' && body?.capture && !body.storeId) {
      const info = await app.inject({ method: 'GET', url: '/api/work-items', headers: { authorization: `Bearer ${token}` } }); body = { ...body, storeId: info.json().storeId };
    }
    return app.inject({ method, url, payload: body, headers: { authorization: `Bearer ${token}` } });
  };
  const pair = async () => { const { code } = (await request('POST', '/api/pairing')).json(); return (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code, name: 'capture device' } })).json(); };
  return { root, app, request, pair };
}
test('JPEG strips EXIF/XMP/IPTC while preserving every scan byte and orientation', () => {
  const image = jpeg([segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), exif()])), segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0secret')), segment(0xed, Buffer.from('IPTC secret'))]);
  const clean = sanitizeCaptureImage(image, 'image/jpeg');
  assert.equal(clean.orientation, 6); assert.deepEqual(clean.data, jpeg()); assert.ok(clean.data.includes(entropy));
  assert.equal(clean.width, 2); assert.equal(clean.height, 1);
});
test('PNG strips metadata with exact unchanged IDAT bytes, valid CRC and full resolution', () => {
  const source = png([chunk('eXIf', exif(8)), ...['tEXt','iTXt','zTXt'].map(t => chunk(t, Buffer.from('private')))]);
  const result = sanitizeCaptureImage(source, 'image/png'); assert.deepEqual(result.data, png()); assert.equal(result.orientation, 8);
});
test('WebP strips EXIF/XMP, repairs RIFF size and VP8X flags without changing VP8L payload', () => {
  const result = sanitizeCaptureImage(webp([riffChunk('EXIF', exif(3)), riffChunk('XMP ', Buffer.from('secret'))], 12), 'image/webp');
  assert.equal(result.orientation, 3); assert.equal(result.data[20], 0); assert.equal(result.data.readUInt32LE(4), result.data.length - 8);
  const raw = riffChunk('VP8L', Buffer.from([0x2f,0,0,0,0,0x10])); assert.ok(result.data.includes(raw)); assert.ok(!result.data.includes(Buffer.from('EXIF')));
});
test('reject forged MIME, SVG, animation, declared dimension bombs, corrupt structures and truncated data', () => {
  for (const [data, mime] of [[png(),'image/jpeg'],[Buffer.from('<svg/>'),'image/png'],[png([chunk('acTL',Buffer.alloc(8))]),'image/png'],
    [webp([],2),'image/webp'],[webp([riffChunk('ANIM',Buffer.alloc(6))]),'image/webp'],[png([],16385,1),'image/png'],[png([],10000,10000),'image/png'],
    [Buffer.concat([png(),Buffer.from('extra')]),'image/png']]) assert.throws(() => sanitizeCaptureImage(data,mime));
  for (const [data,mime] of [[jpeg(),'image/jpeg'],[png(),'image/png'],[webp(),'image/webp']]) for(let n=0;n<data.length;n++) assert.throws(() => sanitizeCaptureImage(data.subarray(0,n),mime));
  const bad=png(); bad[29]^=1; assert.throws(() => sanitizeCaptureImage(bad,'image/png'));
  assert.throws(() => sanitizeCaptureImage(png([chunk('eXIf',exif(9))]),'image/png'));
});
test('asset receipts survive restart, reject same ID changed bytes/owner and bind previews', async t => {
  const f=await fixture(t), store=new CaptureAssetStore(f.root), p=payload(png([chunk('tEXt',Buffer.from('secret'))]));
  const a=await store.save(p,'admin',()=>{}); assert.deepEqual((await store.read(a.id)).data,png());
  assert.deepEqual(await new CaptureAssetStore(f.root).save(p,'admin',()=>{}),a);
  await assert.rejects(store.save({...p,dataBase64:png().toString('base64')},'admin',()=>{}),{statusCode:409});
  await assert.rejects(store.save(p,'other',()=>{}),{statusCode:409});
  const preview=await store.save(payload(png(),{captureId:p.captureId,role:'preview',originalAssetId:a.id}),'admin',()=>{});
  assert.equal((await store.validate([a.id,preview.id],p.captureId,'admin')).length,2);
  await assert.rejects(store.validate([a.id],p.captureId,'other'),{statusCode:403});
  await assert.rejects(store.validate([preview.id],p.captureId,'admin'),{statusCode:413});
  await assert.rejects(store.save(payload(png(),{captureId:p.captureId,role:'preview',originalAssetId:a.id}),'admin',()=>{}),{statusCode:422});
  assert.equal((await fs.stat(path.join(f.root,a.relativePath))).mode & 0o777,0o600);
});
test('card count/preview dimension limits reject excess rather than evict', async t => {
  const f=await fixture(t), store=new CaptureAssetStore(f.root), id=randomUUID();
  let original;
  for(let i=0;i<16;i++) original=await store.save(payload(png(),{captureId:id}),'admin',()=>{});
  await assert.rejects(store.save(payload(png(),{captureId:id}),'admin',()=>{}),{statusCode:507});
  await assert.rejects(store.save(payload(png([],1601,1),{captureId:id,role:'preview',originalAssetId:original.id}),'admin',()=>{}),{statusCode:422});
});
test('capture API authenticates images, derives source, freezes evidence, CAS edits and durable deletion', async t => {
  const f=await fixture(t), p=payload(), upload=await f.request('POST','/api/uploads',p);
  assert.equal(upload.statusCode,200,upload.body); const a=upload.json().upload;
  assert.equal((await f.app.inject(`/api/capture-assets/${a.id}`)).statusCode,401);
  const image=await f.request('GET',`/api/capture-assets/${a.id}`); assert.deepEqual(image.rawPayload,png()); assert.equal(image.headers['cache-control'],'no-store');
  assert.equal((await f.request('POST','/api/uploads',{...p,fileName:'changed'})).statusCode,409);
  const body=creation(p.captureId,[a.id]); let res=await f.request('POST','/api/work-items',body); assert.equal(res.statusCode,200,res.body);
  assert.equal(res.json().item.source.kind,'capture'); assert.equal(res.json().item.state,'todo'); assert.equal(res.json().item.assets[0].managed,true);
  assert.equal((await f.request('POST','/api/work-items',body)).json().item.uid,body.uid);
  assert.equal((await f.request('POST','/api/work-items',{...body,uid:randomUUID(),mutationId:randomUUID()})).statusCode,409);
  assert.equal((await f.request('PATCH',`/api/work-items/${body.uid}`,{...mutation(1),capture:{}})).statusCode,400);
  assert.equal((await f.request('PATCH',`/api/work-items/${body.uid}`,{...mutation(1),assets:[]})).statusCode,400);
  res=await f.request('PATCH',`/api/work-items/${body.uid}`,{...mutation(1),title:'已修改',detail:'编辑'}); assert.equal(res.statusCode,200,res.body);
  assert.equal((await f.request('DELETE',`/api/work-items/${body.uid}`,mutation(1))).statusCode,409);
  const deletion=mutation(2); res=await f.request('DELETE',`/api/work-items/${body.uid}`,deletion); assert.equal(res.statusCode,200,res.body);
  assert.equal((await f.request('DELETE',`/api/work-items/${body.uid}`,deletion)).statusCode,200);
  assert.equal((await f.request('POST','/api/work-items',body)).statusCode,410);
  assert.equal((await f.request('GET',`/api/work-items/${body.uid}`)).statusCode,410);
  assert.equal((await f.request('GET','/api/work-items?source=capture')).json().items.length,0);
  const restored=await WorkItemStore.open(f.root); assert.throws(()=>restored.get(body.uid),{statusCode:410});
  assert.equal((await restored.deleteCapture(body.uid,deletion,'admin',()=>{})).deleted,true);
  assert.deepEqual(await fs.readFile(path.join(f.root,a.relativePath)),png());
  const legacy=await f.request('POST','/api/uploads',{fileName:'note.txt',dataBase64:Buffer.from('legacy').toString('base64')}); assert.equal(legacy.statusCode,200);
});
test('voice original is immutable; non-todo and previously dispatched cards cannot be deleted', async t => {
  const f=await fixture(t), body=creation(randomUUID(),[],'voice');
  let res=await f.request('POST','/api/work-items',body); assert.equal(res.statusCode,200,res.body);
  res=await f.request('PATCH',`/api/work-items/${body.uid}`,{...mutation(1),detail:'edited'}); assert.equal(res.json().item.capture.rawTranscript,body.capture.rawTranscript);
  await f.request('POST',`/api/work-items/${body.uid}/actions`,{...mutation(2),action:'start'});
  assert.equal((await f.request('DELETE',`/api/work-items/${body.uid}`,mutation(3))).statusCode,409);
  const store=await WorkItemStore.open(f.root); await store.action(body.uid,'return','test',mutation(3),'admin',()=>{}); await store.action(body.uid,'reopen',null,mutation(4),'admin',()=>{}); const current=store.get(body.uid).item;
  const binding={...current.currentAttempt,channel:'agent',agentId:'fixture',sessionId:'s',delivery:'delivered',clientMessageId:randomUUID(),message:'x'};
  await store.recordDelivery(body.uid,binding,'agent',mutation(5));
  await store.action(body.uid,'return','test',mutation(6),'admin',()=>{});
  await store.action(body.uid,'reopen',null,mutation(7),'admin',()=>{});
  await assert.rejects(store.deleteCapture(body.uid,mutation(8),'admin',()=>{}),{statusCode:409});
});
test('delete SSE has only identity and revocation stops assets and writes',{timeout:5000},async t=>{
  const f=await fixture(t), device=await f.pair(), other=await f.pair(), p=payload();
  assert.equal((await f.request('POST','/api/uploads',p,device.token)).statusCode,200);
  const body=creation(p.captureId,[p.assetId]); await f.request('POST','/api/work-items',body,device.token);
  const base=await f.app.listen({host:'127.0.0.1',port:0}), ticket=(await f.request('POST','/api/work-items/stream-token',{},other.token)).json().streamToken;
  const abort=new AbortController(); t.after(()=>abort.abort());
  const response=await fetch(`${base}/api/work-items/events?streamToken=${ticket}`,{signal:abort.signal}); const reader=response.body.getReader(); await reader.read();
  await f.request('DELETE',`/api/work-items/${body.uid}`,mutation(1),device.token);
  const event=Buffer.from((await reader.read()).value).toString(); assert.match(event,/work-item.deleted/); assert.ok(!event.includes(body.detail));
  await f.request('DELETE',`/api/devices/${device.device.id}`);
  for(const url of [`/api/capture-assets/${p.assetId}`,'/api/work-items']) assert.equal((await f.request('GET',url,undefined,device.token)).statusCode,401);
  assert.equal((await f.request('POST','/api/uploads',payload(),device.token)).statusCode,401);
  assert.equal((await f.request('GET',`/api/capture-assets/${p.assetId}`,undefined,other.token)).statusCode,200);
  abort.abort();
});
test('revoked upload cannot publish receipt after disk wait; corrupt asset receipts fail closed',async t=>{
  const f=await fixture(t), d=await f.pair(), p=payload();
  const original=fs.open; let entered, release; const gate=new Promise(r=>release=r), hit=new Promise(r=>entered=r); t.after(()=>release());
  t.mock.method(fs,'open',async function(file,...args){ const handle=await original(file,...args); if(String(file).endsWith('/receipt.json')) { const sync=handle.sync.bind(handle); handle.sync=async()=>{entered();await gate;return sync();}; } return handle; });
  const pending=f.request('POST','/api/uploads',p,d.token).then(x=>x); await hit;
  await f.request('DELETE',`/api/devices/${d.device.id}`); release(); assert.equal((await pending).statusCode,401);
  assert.equal((await f.request('GET',`/api/capture-assets/${p.assetId}`)).statusCode,404);
  t.mock.restoreAll(); const store=new CaptureAssetStore(f.root), a=await store.save(payload(),'admin',()=>{});
  await fs.writeFile(path.join(f.root,path.dirname(a.relativePath),'receipt.json'),'{broken');
  await assert.rejects(new CaptureAssetStore(f.root).get(a.id),{statusCode:503});
});

test('JPEG multi-scan payload, extended XMP and SOF bomb boundaries',()=>{
  const extended=segment(0xe1,Buffer.from('http://ns.adobe.com/xmp/extension/\0secret'));
  const result=sanitizeCaptureImage(jpeg([extended]),'image/jpeg');assert.deepEqual(result.data,jpeg());
  const multi=Buffer.concat([jpeg().subarray(0,-2),segment(0xed,Buffer.from('private')),segment(0xda,Buffer.from([1,1,0,0,63,0])),entropy,Buffer.from([255,217])]);
  const clean=sanitizeCaptureImage(multi,'image/jpeg').data;assert.ok(!clean.includes(Buffer.from('private')));assert.equal(clean.indexOf(entropy)!==clean.lastIndexOf(entropy),true);
  const bomb=jpeg();const sof=bomb.indexOf(Buffer.from([255,192]));bomb.writeUInt16BE(16385,sof+7);assert.throws(()=>sanitizeCaptureImage(bomb,'image/jpeg'),{statusCode:413});
});
test('WebP VP8 dimensions, extended canvas consistency, animation chunks and size boundaries',()=>{
  function riff(chunks){const data=Buffer.concat(chunks),h=Buffer.alloc(12);h.write('RIFF');h.writeUInt32LE(data.length+4,4);h.write('WEBP',8);return Buffer.concat([h,data]);}
  const vp8=Buffer.from([0x10,0,0,0x9d,1,0x2a,2,0,1,0,0]);
  const plain=riff([riffChunk('VP8 ',vp8)]),clean=sanitizeCaptureImage(plain,'image/webp');assert.equal(clean.width,2);assert.deepEqual(clean.data,plain);
  const x=Buffer.alloc(10);x.writeUIntLE(16384,4,3);assert.throws(()=>sanitizeCaptureImage(riff([riffChunk('VP8X',x),riffChunk('VP8 ',vp8)]),'image/webp'),{statusCode:413});
  x.writeUIntLE(0,4,3);assert.throws(()=>sanitizeCaptureImage(riff([riffChunk('VP8X',x),riffChunk('VP8 ',vp8)]),'image/webp'));
  assert.throws(()=>sanitizeCaptureImage(webp([riffChunk('ANMF',Buffer.alloc(16))]),'image/webp'));
  const broken=plain.subarray();broken.writeUInt32LE(999999,16);assert.throws(()=>sanitizeCaptureImage(broken,'image/webp'));
});
test('HTTP rejects forged MIME, SVG, animation, bomb and client-controlled capture source',async t=>{
  const f=await fixture(t);
  for(const p of [payload(png(),{mimeType:'image/jpeg'}),payload(Buffer.from('<svg/>')),payload(png([chunk('acTL',Buffer.alloc(8))])),payload(png([],16385,1))]){
    const response=await f.request('POST','/api/uploads',p);assert.ok([400,413,422].includes(response.statusCode),response.body);
  }
  const body=creation(randomUUID(),[],'voice');
  assert.equal((await f.request('POST','/api/work-items',{...body,source:{kind:'manual'}})).statusCode,400);
  assert.equal((await f.request('POST','/api/work-items',{...body,storeId:randomUUID()})).statusCode,409);
  const item=(await f.request('POST','/api/work-items',body)).json().item;
  for(const field of [{capture:{...item.capture,rawTranscript:'edited'}},{source:{kind:'capture'}},{state:'done'}])assert.equal((await f.request('PATCH',`/api/work-items/${body.uid}`,{...mutation(1),...field})).statusCode,400);
});
test('managed store rejects upload-root symlinks without writing through them',async t=>{
  const f=await fixture(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'capture-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.symlink(outside,path.join(f.root,'mobile-uploads'));
  await assert.rejects(new CaptureAssetStore(f.root).save(payload(),'admin',()=>{}),{statusCode:503});
  assert.deepEqual(await fs.readdir(outside),[]);
});
