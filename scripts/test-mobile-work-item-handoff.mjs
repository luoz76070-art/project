import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'work-item-handoff-'));
test.after(()=>fs.rm(dir,{recursive:true,force:true}));
await build({stdin:{contents:`export * from './apps/mobile/src/features/handoff/model'; export * from './apps/mobile/src/features/capture/model'; export * from './apps/mobile/src/features/connection/http';`,resolveDir:process.cwd()},outfile:path.join(dir,'model.mjs'),bundle:true,platform:'node',format:'esm',define:{'import.meta.env':'{}'}});
const {handoffClient,handoffLabels,agentLabels,captureApi,ensureHttpOk}=await import(path.join(dir,'model.mjs'));
const request=()=>({storeId:crypto.randomUUID(),expectedRevision:1,handoffId:crypto.randomUUID(),target:{agentId:'claude',sessionId:crypto.randomUUID()}});
const target={agentId:'claude',sessionId:crypto.randomUUID(),title:'已有会话',cwd:'/fixture/project with spaces'};
const preview={text:'确切文本\n原文保持',attachments:[],target,sendNumber:1,previewHash:'a'.repeat(64)};
const tick=()=>new Promise(r=>setImmediate(r));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.fail('condition not reached');}
test('cancel sends nothing; confirmed preview sends exact hash once; timeout cannot be replayed',async()=>{
  const calls=[],client=handoffClient(async(...args)=>{calls.push(args);throw new Error('network timeout');}),input=request();
  assert.equal(await client.confirm('item',input,preview,false),null);assert.equal(calls.length,0);
  await assert.rejects(client.confirm('item',input,preview,true),/timeout/);
  await assert.rejects(client.confirm('item',input,preview,true),/不会再次发送/);assert.equal(calls.length,1);
  assert.deepEqual(calls[0][2],{...input,confirmed:true,previewHash:preview.previewHash});
  await assert.rejects(client.read('item',input.handoffId));assert.equal(calls[1][1],undefined);
});
test('four existing-session lists filter Desktop and carry explicit agent identity and pagination',async()=>{
  const calls=[],client=handoffClient(async(route)=>{calls.push(route);return route.startsWith('/api/threads')?{threads:[{id:'desktop',source:'vscode',cwd:'/p',threadName:'D'},{id:'relay',source:'cli',cwd:'/p'}],hasMore:true,nextOffset:100}:{sessions:[{id:'one',title:'S',directory:'/p'}],cursor:'next'};});
  for(const agent of ['codex','claude','deepseek','opencode']){const result=await client.sessions(agent,'查询');assert.equal(result.sessions.length,1);assert.equal(result.sessions[0].agentId,agent);assert.ok(result.cursor);}
  assert.ok(calls.every(c=>!c.includes('create')));
});
test('preview 413 displays exact excess; 401 stops all subsequent handoff requests',async t=>{
  assert.throws(()=>ensureHttpOk(413,{error:'work_item_handoff_text_too_long',limit:20000,length:20042,excess:42}),/超出 42 字/);
  const before=globalThis.fetch;let requests=0;t.after(()=>{globalThis.fetch=before;});
  globalThis.fetch=async()=>{requests++;return new Response('{"error":"unauthorized"}',{status:401,headers:{'Content-Type':'application/json'}});};
  const api=captureApi('http://127.0.0.1:19876','revoked-handoff',new AbortController().signal),client=handoffClient(api.request),input=request();
  await assert.rejects(client.preview('item',input),/此设备已被撤销/);
  for(const operation of [()=>client.agents(),()=>client.sessions('claude'),()=>client.read('item',input.handoffId),()=>client.confirm('item',input,preview,true)])await assert.rejects(async()=>operation(),/此设备已被撤销/);
  assert.equal(requests,1);
});
const source=await fs.readFile('apps/mobile/src/features/handoff/ItemHandoff.tsx','utf8');
const ast=ts.createSourceFile('ItemHandoff.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const body=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n').replace('export function ItemHandoff','function ItemHandoff');
const js=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h',jsxFragmentFactory:'Fragment'}}).outputText;
function driver({fail=false,initialRecords=[]}={}){
  let cursor=0,dirty=true,tree;const slots=[],effects=[],calls=[],opened=[];
  const item={uid:crypto.randomUUID(),state:'todo',revision:1,handoffs:initialRecords},storeId=crypto.randomUUID();
  const props={item,disabled:false,onItem:value=>{props.item=value;dirty=true;},onOpenTarget:value=>opened.push(value),send:async(route,method='GET',body)=>{
    calls.push({route,method,body});
    if(route==='/api/agents')return {agents:[{id:'claude',sessionApi:1}]};
    if(route.startsWith('/api/threads'))return {threads:[{id:target.sessionId,threadName:target.title,cwd:target.cwd,source:'vscode'}],hasMore:false,nextOffset:1};
    if(route.endsWith('/preview'))return {...preview,target:{...target,agentId:'codex'},sendNumber:props.item.handoffs.length+1};
    if(method==='POST'){
      const record={...preview,target:{...target,agentId:'codex'},handoffId:body.handoffId,status:fail?'unknown':'delivered',sendNumber:props.item.handoffs.length+1};
      item.handoffs=[...item.handoffs,record];item.revision++;
      if(fail)throw new Error('timeout');return {handoffId:body.handoffId,accepted:true};
    }
    if(route.includes('/handoffs/'))return {handoff:item.handoffs.at(-1)};
    return {item:structuredClone(item),storeId};
  }};
  const useRef=value=>slots[cursor++]??={current:value};
  const useState=value=>{const i=cursor++;slots[i]??={value:typeof value==='function'?value():value};return[slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;dirty=true;}];};
  const useMemo=(fn,deps)=>{const i=cursor++;if(!slots[i]||deps.some((v,j)=>v!==slots[i].deps[j]))slots[i]={value:fn(),deps};return slots[i].value;};
  const useEffect=(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});};
  const h=(type,props,...children)=>({type,props:{...props,children}});
  const Component=new Function('useEffect','useMemo','useRef','useState','handoffClient','handoffLabels','agentLabels','deviceRevokedMessage','h','Fragment',js+';return ItemHandoff;')(useEffect,useMemo,useRef,useState,handoffClient,handoffLabels,agentLabels,'此设备已被撤销，请重新配对',h,'fragment');
  const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props.children)]:[];
  const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props.children):n??'';
  function render(){do{dirty=false;cursor=0;tree=Component(props);for(const f of effects.splice(0))f();}while(dirty);return tree;}
  function button(label){return nodes(render()).find(n=>n.type==='button'&&text(n)===label);}
  return {calls,opened,text:()=>text(render()),button,
    click(label){const b=button(label);assert.ok(b,`button ${label}`);assert.ok(!b.props.disabled,`disabled ${label}`);b.props.onClick();render();},
    select(){const select=nodes(render()).filter(n=>n.type==='select').at(-1);select.props.onChange({target:{value:target.sessionId}});render();},
    revoke(){props.disabled=true;render();},stop(){for(const slot of slots)slot?.cleanup?.();}};
}
async function choose(d){d.click(d.button('交给 Agent')?'交给 Agent':'手动再次交接');await until(()=>d.button('搜索 / 刷新会话')&&!d.button('搜索 / 刷新会话').props.disabled);d.select();d.click('预览交接');await until(()=>d.button('确认发送'));}
test('production component previews exact text, cancels with zero sends and has no new-session button',async t=>{
  const d=driver();t.after(()=>d.stop());await choose(d);assert.match(d.text(),/确切文本\n原文保持/);assert.match(d.text(),/Agent 需要能读取这些 Mac 本地路径/);assert.doesNotMatch(d.text(),/新建/);
  d.click('取消交接');assert.equal(d.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/preview')).length,0);
});
test('production component unknown state only reads on query, opens target, second send requires new preview and confirmation',async t=>{
  const d=driver({fail:true});t.after(()=>d.stop());await choose(d);d.click('确认发送');await until(()=>d.text().includes('timeout'));
  assert.match(d.text(),/结果不明/);assert.equal(d.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/preview')).length,1);
  d.click('去目标会话核对');assert.equal(d.opened[0].sessionId,target.sessionId);
  d.click('查询本次结果');await until(()=>d.button('手动再次交接'));await choose(d);
  assert.match(d.text(),/第2次发送，可能重复/);assert.equal(d.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/preview')).length,1);
  d.click('取消交接');d.revoke();assert.equal(d.button('手动再次交接').props.disabled,true);
});
test('resolve posts only the user outcome to the unknown record and maps the not-unknown conflict',async()=>{
  const calls=[],client=handoffClient(async(...args)=>{calls.push(args);return {handoff:{status:'rejected'}};});
  await client.resolve('item','id-1','not_received');
  assert.deepEqual(calls[0],['/api/work-items/item/handoffs/id-1/resolve','POST',{outcome:'not_received'}]);
  assert.throws(()=>ensureHttpOk(409,{error:'work_item_handoff_not_unknown'}),/已经有确定结果/);
});
