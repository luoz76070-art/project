import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { voiceInputDriver } from './helpers/voice-input-driver.mjs';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'mobile-capture-'));
test.after(()=>fs.rm(temp,{recursive:true,force:true}));
await build({stdin:{contents:`export * from './apps/mobile/src/features/capture/model'; export * from './apps/mobile/src/features/voice/model'; export * from './apps/mobile/src/features/voice/recovery'; export * from './apps/mobile/src/features/connection/authorization';`,resolveDir:process.cwd()},outfile:path.join(temp,'model.mjs'),bundle:true,platform:'node',format:'esm',define:{'import.meta.env':'{}'}});
const {captureTitle,captureTransaction,captureClient,captureApi,canvasPreview,mergeVoiceDraft,voiceError,voiceDraftHash}=await import(path.join(temp,'model.mjs'));
const tick=()=>new Promise(r=>setImmediate(r));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.fail('condition not reached');}
const file=()=>new File(['fixture'],'screenshot.png',{type:'image/png'});
const draft=(extra={})=>({title:'',detail:'说明',rawTranscript:null,files:[file()],...extra});
function server({failAt,unauthorized=false}={}){
  let fail=failAt,stored,storeId=crypto.randomUUID();const calls=[],assets=new Map();
  return {calls,assets,setStore:()=>{storeId=crypto.randomUUID();},
    send:async(route,method='GET',body)=>{
      calls.push({route,method,body:body?structuredClone(body):undefined});
      if(unauthorized)throw Object.assign(new Error('401'),{status:401});
      if(route.startsWith('/api/work-items?'))return {storeId,items:stored&&!stored.deleted?[stored.response.item]:[],nextCursor:null};
      if(route==='/api/uploads'){
        const existing=assets.get(body.assetId);if(existing){assert.deepEqual(existing.body,body);return {upload:existing.asset};}
        const asset={id:body.assetId,captureId:body.captureId,role:body.role,originalAssetId:body.originalAssetId,mimeType:body.mimeType};assets.set(body.assetId,{asset,body:structuredClone(body)});
        if(fail==='upload'){fail=null;throw new Error('lost upload response');}return {upload:asset};
      }
      if(route.startsWith('/api/capture-assets/'))return {asset:{},dataBase64:'fixture'};
      if(method==='PATCH'){
        if(body.expectedRevision!==stored.response.item.revision)throw Object.assign(new Error('conflict'),{status:409});
        stored.response.item={...stored.response.item,...body,revision:body.expectedRevision+1};return stored.response;
      }
      if(method==='DELETE'){stored.deleted=true;return {uid:stored.response.item.uid,deleted:true,revision:body.expectedRevision+1};}
      if(method==='POST'){
        if(stored)assert.deepEqual(stored.body,body);
        else stored={body:structuredClone(body),response:{storeId,item:{...body,revision:1,state:'todo',currentAttempt:{delivery:'none'}}}};
        if(fail==='create'){fail=null;throw new Error('lost create response');}return stored.response;
      }
      if(fail==='read'){fail=null;throw new Error('lost read response');}
      return stored.response;
    }};
}
test('defaults and bounds: image and raw voice create independent todo transactions',()=>{
  const date=new Date('2026-11-14T02:00:00Z');assert.match(captureTitle('', 'image',date),/^图片事项 /);assert.match(captureTitle('', 'voice',date),/^语音事项 /);assert.equal(captureTitle(' 用户标题 ','voice'), '用户标题');
  const tx=captureTransaction(draft(),date);assert.equal(tx.capture.mode,'image');assert.equal(tx.posted,false);
  const voice=captureTransaction(draft({files:[],rawTranscript:'原始识别',detail:'编辑的说明'}),date);assert.equal(voice.capture.rawTranscript,'原始识别');assert.equal(voice.detail,'编辑的说明');
  for(const extra of [{files:[]},{files:[new File(['<svg/>'],'fake.png',{type:'image/svg+xml'})]},{files:Array.from({length:17},file)},{title:'字'.repeat(201)},{detail:'字'.repeat(30000)}])assert.throws(()=>captureTransaction(draft(extra)));
});
test('upload original then canvas preview then create and read back, no chat endpoints',async()=>{
  const f=server(),tx=captureTransaction(draft()),client=captureClient(f.send);let previews=0;
  const saved=await client.save(tx,async()=>{previews++;return new File(['preview'],'preview.png',{type:'image/png'});},async f=>f.text());
  assert.equal(saved.item.state,'todo');assert.equal(tx.confirmed,true);assert.equal(previews,1);
  assert.deepEqual(f.calls.map(c=>c.method),['GET','POST','GET','POST','POST','GET']);assert.equal(f.calls[1].body.role,'original');assert.equal(f.calls[3].body.role,'preview');
  assert.equal(f.calls[4].body.expectedRevision,0);assert.equal(f.calls[4].body.capture.assetIds.length,2);assert.deepEqual(f.calls[4].body.assets,[]);
  assert.ok(f.calls.every(c=>!c.route.includes('threads')&&!c.route.includes('turns')));
});
for(const failAt of ['upload','create','read'])test(`lost ${failAt} response retries fixed IDs and payload without duplicate assets`,async()=>{
  const f=server({failAt}),tx=captureTransaction(draft()),client=captureClient(f.send),preview=async()=>new File(['preview'],'preview.png',{type:'image/png'});
  await assert.rejects(client.save(tx,preview,async f=>f.text()));assert.equal(tx.confirmed,false);
  const saved=await client.save(tx,preview,async f=>f.text());assert.equal(saved.item.uid,tx.uid);assert.equal(f.assets.size,2);assert.equal(tx.confirmed,true);
});
test('duplicate clicks lock synchronously, changed Relay store blocks retry before uploads',async()=>{
  const f=server(),tx=captureTransaction(draft()),client=captureClient(f.send);let release;const gate=new Promise(r=>release=r);
  const saving=client.save(tx,async()=>{await gate;return file();},async f=>f.text());
  await assert.rejects(client.save(tx,async()=>file()),/正在保存/);release();await saving;
  f.setStore();const n=f.calls.length;await assert.rejects(client.save(tx,async()=>file()),/存储已变化/);assert.equal(f.calls.length,n+1);
});
test('real HTTP 401 revokes capture authorization and no later retry/edit/delete/read issues requests',async t=>{
  const original=globalThis.fetch;let calls=0;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>{calls++;return new Response('{"error":"unauthorized"}',{status:401,headers:{'Content-Type':'application/json'}});};
  const controller=new AbortController(),client=captureApi('http://127.0.0.1:18789',crypto.randomUUID(),controller.signal),tx=captureTransaction(draft());
  await assert.rejects(client.save(tx,async()=>file()),{status:401});
  for(const action of [()=>client.save(tx,async()=>file()),()=>client.list(),()=>client.get(tx.uid),()=>client.remove(tx.uid,{mutationId:crypto.randomUUID(),expectedRevision:1}),()=>client.edit(tx.uid,{mutationId:crypto.randomUUID(),expectedRevision:1,title:'x',detail:'x'}),()=>client.image(crypto.randomUUID())])await assert.rejects(async()=>action(),{status:401});
  await new Promise(r=>setTimeout(r,25));assert.equal(calls,1);
});
test('offline and scope cancellation perform no upload or polling',async t=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),fetch=globalThis.fetch;let calls=0;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});globalThis.fetch=async()=>{calls++;throw new Error('unexpected');};
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;globalThis.fetch=fetch;});
  const controller=new AbortController(),client=captureApi('http://127.0.0.1:18790','offline-fixture',controller.signal);
  await assert.rejects(async()=>client.list(),/需要连接电脑/);controller.abort();await assert.rejects(async()=>client.list(),{name:'AbortError'});assert.equal(calls,0);
});
test('canvas applies controlled orientation and downsizes only the preview to 1600px',async t=>{
  const before={Image:globalThis.Image,document:globalThis.document};let transform,drawn=false;
  globalThis.Image=class{naturalWidth=4000;naturalHeight=2000;async decode(){}};
  const canvas={width:0,height:0,getContext:()=>({setTransform:(...v)=>transform=v,drawImage:()=>{drawn=true;}}),toBlob:callback=>callback(new Blob(['preview'],{type:'image/png'}))};
  globalThis.document={createElement:type=>{assert.equal(type,'canvas');return canvas;}};
  t.after(()=>{for(const [k,v]of Object.entries(before)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
  const file=await canvasPreview({asset:{width:4000,height:2000,orientation:6,mimeType:'image/jpeg'},dataBase64:'fixture'});
  assert.equal(canvas.width,800);assert.equal(canvas.height,1600);assert.deepEqual(transform,[0,.4,-.4,0,800,0]);assert.ok(drawn);assert.equal(file.type,'image/png');
});
test('capture VoiceInput uses ASR only, raw text is read-only and adoption freezes original separately',async t=>{
  let refined=0,raw=null;
  const driver=voiceInputDriver({api:{config:async()=>({qwenConfigured:true,deepseekConfigured:false}),transcribe:async()=> '原始转写',refine:async()=>{refined++;return '改写';},cancel:async()=>{}},
    recovery:{submit:async(_r,post)=>post(crypto.randomUUID()),cancel(){},detach(){}},mergeVoiceDraft,voiceError,voiceDraftHash,findMissingVoiceDetails:()=>[],buildAsrHints:()=>[],voiceContextEnabled:()=>false});
  t.after(()=>driver.unmount());driver.render({capture:true,onCapture:text=>{raw=text;},draft:''});driver.click('语音输入');assert.equal(driver.button('整理提示词'),undefined);
  driver.click('开始录音');await until(()=>driver.calls.start===1);driver.recording();await until(()=>driver.original()==='原始转写');
  driver.edit('语音识别原文','篡改');assert.equal(driver.original(),'原始转写');assert.equal(driver.button('重新整理'),undefined);
  driver.click('采用原文');assert.equal(raw,'原始转写');assert.equal(driver.drafts[0],'原始转写');assert.equal(refined,0);
  const tx=captureTransaction(draft({files:[],rawTranscript:raw,detail:'用户修改说明'}));assert.equal(tx.capture.rawTranscript,'原始转写');
});

// Exercise the production panel's actual handlers, hooks and JSX with isolated ports.
// This does not claim browser layout or DOM scheduling coverage.
const panelSource=await fs.readFile(new URL('../apps/mobile/src/features/capture/CapturePanel.tsx',import.meta.url),'utf8');
const panelAst=ts.createSourceFile('CapturePanel.tsx',panelSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const panelBody=panelAst.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(panelAst)).join('\n').replace('export function CapturePanel','function CapturePanel');
const panelJs=ts.transpileModule(panelBody,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h',jsxFragmentFactory:'Fragment'}}).outputText;
function panelDriver(client){
  const slots=[],effects=[];let cursor=0,dirty=true,tree,revoked=false;
  const props={endpoint:'http://127.0.0.1:18794',token:'panel',scope:'panel',open:true,onClose:()=>{props.open=false;dirty=true;}};
  const useRef=value=>slots[cursor++]??={current:value};
  const useState=initial=>{const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return [slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;dirty=true;}];};
  const useMemo=(fn,deps)=>{const i=cursor++;if(!slots[i]||deps.some((v,j)=>v!==slots[i].deps[j]))slots[i]={value:fn(),deps};return slots[i].value;};
  const useEffect=(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});};
  const h=(type,props,...children)=>({type,props:{...props,children}});
  const document={body:{},activeElement:null},window={addEventListener(){},removeEventListener(){},confirm:()=>true};
  const factory=new Function('useEffect','useMemo','useRef','useState','createPortal','VoiceInput','useDeviceRevoked','deviceRevokedMessage','captureApi','canvasPreview','captureTransaction','useCaptureVoice','voiceDraftHash','document','window','navigator','h','Fragment',panelJs+';return CapturePanel');
  const component=factory(useEffect,useMemo,useRef,useState,v=>v,'voice',()=>revoked,'此设备已被撤销，请重新配对',()=>client,async()=>file(),captureTransaction,()=>({}),voiceDraftHash,document,window,{onLine:true},h,'fragment');
  function render(){do{dirty=false;cursor=0;tree=component(props);for(const fn of effects.splice(0))fn();}while(dirty);return tree;}
  const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
  const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props.children):n??'';
  return {render,nodes:()=>nodes(render()),text:()=>text(render()),revoke(){revoked=true;render();},
    button(label){return nodes(render()).find(n=>n.type==='button'&&text(n)===label);},
    click(label){const b=this.button(label);assert.ok(b,`button ${label}`);assert.ok(!b.props.disabled,`disabled ${label}`);b.props.onClick({});render();},
    edit(label,value){const field=nodes(render()).find(n=>n.props?.['aria-label']===label);assert.ok(field&&!field.props.disabled);field.props.onChange({target:{value}});render();},
    select(files){nodes(render()).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files,value:''}});render();},
    stop(){for(const slot of slots)slot?.cleanup?.();}};
}
test('panel selects photos, creates, edits and deletes saved capture cards through the production client',async t=>{
  const f=server(),client=captureClient(f.send),save=client.save.bind(client);
  client.save=(tx,preview)=>save(tx,preview,async file=>file.text());
  const driver=panelDriver(client);t.after(()=>driver.stop());driver.render();driver.select([file()]);driver.edit('事项标题','截图记录');driver.edit('事项说明','第一版');
  driver.click('保存事项');await until(()=>driver.text().includes('事项已保存'));
  assert.match(driver.text(),/待处理/);assert.ok(driver.button('保存修改'));
  driver.edit('事项说明','编辑后');driver.click('保存修改');await until(()=>driver.text().includes('修改已保存'));
  assert.equal(f.calls.find(c=>c.method==='PATCH').body.expectedRevision,1);
  driver.click('删除事项');await until(()=>driver.text().includes('捕获卡已删除'));assert.equal(f.calls.find(c=>c.method==='DELETE').body.expectedRevision,2);
});
test('panel retains frozen transaction on create timeout and only retries the same item',async t=>{
  const f=server({failAt:'create'}),client=captureClient(f.send),save=client.save.bind(client);client.save=(tx,preview)=>save(tx,preview,async f=>f.text());
  const driver=panelDriver(client);t.after(()=>driver.stop());driver.render();driver.select([file()]);driver.click('保存事项');await until(()=>driver.text().includes('lost create response'));
  assert.ok(driver.nodes().find(n=>n.props?.['aria-label']==='事项说明').props.disabled);assert.ok(!driver.button('新建另一张'));
  driver.click('重试保存并核对');await until(()=>driver.text().includes('事项已保存'));
  const posts=f.calls.filter(c=>c.route==='/api/work-items'&&c.method==='POST');assert.equal(posts.length,2);assert.deepEqual(posts[0].body,posts[1].body);
});
test('panel revoked state disables all network actions and displays the pairing instruction',async t=>{
  const f=server(),driver=panelDriver(captureClient(f.send));t.after(()=>driver.stop());driver.render();driver.revoke();
  assert.match(driver.text(),/此设备已被撤销，请重新配对/);assert.equal(driver.button('保存事项').props.disabled,true);assert.equal(driver.button('从相册选图').props.disabled,true);assert.equal(driver.button('刷新').props.disabled,true);assert.equal(f.calls.length,0);
});
