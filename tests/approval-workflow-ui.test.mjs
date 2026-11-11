import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function load(path, overrides = {}, globals = {}) {
 const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
 const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } });
 const exports = {}; new Function('require', 'exports', ...Object.keys(globals), outputText)(name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), exports, ...Object.values(globals)); return exports;
}
const input=load('src/lib/approval-workflow-input.ts');
const directory='src/app/approvals/workflows/';
const readInput=load(directory+'read-input.ts',{'@/lib/approval-workflow-input':input});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actorId=id(1),tenantId=id(2),companyId=id(3),branchId=id(4);
const scope={tenantId,companyId,branchId,label:'Company / Branch'},stamp='2026-11-11T12:00:00.000Z';
const configuration={title:'Policy',enabled:false,resource:'PURCHASE',currency:null,minimumAmount:null,maximumAmount:null,excludeRequester:true,stages:[{name:'Review',quorum:1,userIds:[id(9)],roleIds:[]}]};
const payload={tenantId,companyId,branchId,requestId:id(5),expectedActorId:actorId,policyId:id(6),expectedVersion:0,configuration};
const row={requestId:payload.requestId,actorId,tenantId,companyId,branchId,command:payload,outcome:'COMMITTED',policy:{id:payload.policyId,tenantId,companyId,branchId,version:1,configuration}};
const envelope=command=>JSON.stringify({version:1,actorId,command});
function browser() {
 const storage = new Map(), held = new Set();
 return { storage, locks: { async request(key, options, fn) { assert.equal(options.ifAvailable, true); if (held.has(key)) return fn(null); held.add(key); try { return await fn({ name: key }); } finally { held.delete(key); } } } };
}
function harness({ onAccessDenied = () => {}, captureAccessDenied, raw, fetcher = async () => { throw Error('network'); }, storageFails = false, removalFails = false, shared = browser(), locking = true } = {}) {
 const key = `erp-approval-workflow:v1:${actorId}:${tenantId}:${companyId}:${branchId}`, storage = shared.storage;
 if (raw !== undefined) storage.set(key, raw);
 const slots = [], listeners = new Set(); let index = 0, calls = 0, denials = 0, actor = actorId, branch = branchId;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn, deps) { const i = index++, value = JSON.stringify(deps); if (slots[i]?.deps !== value) { slots[i]?.cleanup?.(); slots[i] = { deps: value, cleanup: fn() }; } } };
 const mod = load(directory + 'request.ts', { react: hooks, '@/lib/approval-workflow-input': input }, { navigator: { locks: locking ? shared.locks : undefined }, window: { addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); } }, localStorage: { getItem: k => storage.get(k) ?? null, setItem(k, v) { if (storageFails) throw Error('blocked'); storage.set(k, v); }, removeItem: k => { if (!removalFails) storage.delete(k); } }, fetch(...args) { calls++; return fetcher(...args); } });
 const render = () => { index = 0; return mod.useApprovalRequest(actor, tenantId, companyId, branch, () => { const notify = captureAccessDenied ? captureAccessDenied() : onAccessDenied; return () => { denials++; notify(); }; }); }; render();
 return { render, storage, key, get calls() { return calls; }, get denials() { return denials; }, event(eventKey = key) { listeners.forEach(fn => fn({ key: eventKey })); }, identity(nextActor, nextBranch = branchId) { actor = nextActor; branch = nextBranch; render(); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
test('approval captures hydrate without writes and malformed or actor/scope substitutions remain blocked', () => {
 for (const raw of ['broken', envelope({ ...payload, branchId: id(99) }), JSON.stringify({ version: 1, actorId: id(9), command: payload }), envelope({ ...payload, expectedActorId: id(99) })]) {
  const h = harness({ raw }); assert.equal(h.render().blocked, true); assert.equal(h.render().pending, null); assert.equal(h.storage.get(h.key), raw); assert.equal(h.calls, 0);
 }
 const h = harness({ raw: envelope(payload) }); assert.deepEqual(h.render().pending, payload); assert.equal(h.calls, 0);
});
test('network errors and all HTTP failures retain exact approval request for explicit same-description retry', async () => {
 for (const status of [400, 401, 403, 404, 409, 422, 500]) {
  const sent = [], h = harness({ fetcher: async (_url, options) => { sent.push(options.body); return { ok: false, status, json: async () => ({ error: 'failed' }) }; } });
  await h.render().run(payload, () => assert.fail(), () => {}); const raw = h.storage.get(h.key);
  await h.render().run(null, () => assert.fail(), () => {}); assert.equal(sent.length, 2); assert.equal(sent[0], sent[1]); assert.equal(h.storage.get(h.key), raw);
 }
 const h = harness(); await h.render().run(payload, () => assert.fail(), () => {}); assert.deepEqual(JSON.parse(h.storage.get(h.key)).command, payload);
});
test('unsupported locks or failed persistence never write; concurrent clicks send once and unmount retains capture', async () => {
 for (const options of [{ storageFails: true }, { locking: false }]) { const h = harness(options); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.calls, 0); }
 let release; const h = harness({ fetcher: () => new Promise(resolve => { release = resolve; }) });
 const first = h.render().run(payload, () => assert.fail(), () => {}); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.calls, 1); h.unmount(); release({ ok: false, json: async () => ({}) }); await first; assert.equal(h.storage.size, 1);
});
test('malformed success actor scope command and projection never clear capture',async()=>{
 for(const data of [{},{receipt:{}},{receipt:{...row,actorId:id(99)}},{receipt:{...row,branchId:id(99)}},{receipt:{...row,command:{...payload,expectedVersion:1}}},{receipt:{...row,policy:{...row.policy,version:2}}}]){
  const h=harness({fetcher:async()=>({ok:true,json:async()=>data})});await h.render().run(payload,()=>assert.fail(),()=>{});assert.equal(h.storage.size,1);
 }
});
test('verified approval clears only its own exact capture, and failed removal remains unresolved', async () => {
 for (const removalFails of [false, true]) {
  const h = harness({ removalFails, fetcher: async () => ({ ok: true, json: async () => ({ receipt: row }) }) }); let saved = 0;
  await h.render().run(payload, () => saved++, () => {}); assert.equal(saved, removalFails ? 0 : 1); assert.equal(h.storage.size, removalFails ? 1 : 0);
 }
});
test('check-and-abandon requires matching actor-bound tombstone',async()=>{
 const cancellation={...row,outcome:'ABANDONED',policy:undefined};
 for(const data of [{},{receipt:{...cancellation,actorId:id(99)}},{receipt:cancellation}]){
  let abandoned=0;const h=harness({raw:envelope(payload),fetcher:async(url,options)=>{assert.equal(url,'/api/approval-workflows/abandon');assert.deepEqual(JSON.parse(options.body),payload);return{ok:true,json:async()=>data};}});
  await h.render().abandon(()=>assert.fail(),()=>{},()=>abandoned++);const valid=data.receipt?.actorId===actorId;
  assert.equal(abandoned,valid?1:0);assert.equal(h.storage.size,valid?0:1);
 }
});
test('abandonment discovers an already recorded approval without claiming cancellation', async () => {
 const h = harness({ raw: envelope(payload), fetcher: async () => ({ ok: true, json: async () => ({ receipt: row }) }) }); let saved = 0;
 await h.render().abandon(() => saved++, () => assert.fail(), () => assert.fail()); assert.equal(saved, 1); assert.equal(h.storage.size, 0);
});
test('two tabs cannot replace pending requests or implicitly retry on a new submission', async () => {
 const shared = browser(); let release; const first = harness({ shared, fetcher: () => new Promise(resolve => { release = resolve; }) }), second = harness({ shared });
 const active = first.render().run(payload, () => assert.fail(), () => {}); await second.render().run({ ...payload, requestId: id(20) }, () => assert.fail(), () => {});
 assert.equal(first.calls, 1); assert.equal(second.calls, 0); const raw = shared.storage.get(first.key);
 release({ ok: false, json: async () => ({}) }); await active;
 second.event(); await second.render().run({ ...payload, requestId: id(20) }, () => assert.fail(), () => {}); assert.equal(second.calls, 0); assert.equal(shared.storage.get(first.key), raw);
 await second.render().run(null, () => assert.fail(), () => {}); assert.equal(second.calls, 1); assert.equal(shared.storage.get(first.key), raw);
});
test('late responses cannot erase a changed capture and storage events rehydrate without sending', async () => {
 let release; const h = harness({ fetcher: () => new Promise(resolve => { release = resolve; }) });
 const running = h.render().run(payload, () => assert.fail(), () => {}), other = envelope({ ...payload, requestId: id(20) });
 h.storage.set(h.key, other); h.event(); assert.equal(h.render().pending.requestId, id(20));
 release({ ok: true, json: async () => ({ receipt: row }) }); await running; assert.equal(h.storage.get(h.key), other);
 h.storage.delete(h.key); h.event(); assert.equal(h.render().blocked, false);
});
test('actor and scope switches fence late responses and leave old requests unchanged', async () => {
 for (const change of ['actor', 'branch']) {
  let release, callbacks = 0; const h = harness({ raw: envelope(payload), fetcher: () => new Promise(resolve => { release = resolve; }) });
  const running = h.render().abandon(() => callbacks++, () => callbacks++, () => callbacks++);
  h.identity(change === 'actor' ? id(99) : actorId, change === 'branch' ? id(98) : branchId);
  release({ ok: true, json: async () => ({ receipt: row }) }); await running;
  assert.equal(callbacks, 0); assert.equal(h.storage.get(h.key), envelope(payload)); assert.equal(h.render().pending, null);
 }
});
const localeModule=load('src/lib/locale.ts');
const auth=load('src/lib/browser-auth-loss.ts');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const source={id:id(20),tenantId,companyId,branchId,number:'Legacy\n<script>alert(1)</script>'+'.'.repeat(700),notes:'Private reason',status:'DRAFT',subtotal:'3.000',currency:'OMR'};
const approval={...scope,id:id(21),resource:'PURCHASE',sourceId:source.id,policyId:payload.policyId,policyVersion:1,policySnapshot:configuration,sourceSnapshot:source,sourceFingerprint:'a'.repeat(32),requesterId:actorId,status:'PENDING',stage:0,version:1,createdAt:stamp};
const list={actorId,tenantId,companyId,branchId,items:[approval],page:0,nextPage:null,canManagePolicies:true};
function descendants(element){return[element,...React.Children.toArray(element?.props?.children).flatMap(child=>React.isValidElement(child)?descendants(child):[])];}
function workspaceHarness({state={},locale='en',fetcher=()=>new Promise(()=>{})}={}){
 const slots=[],refs=[],effects=[],callbacks=[],sent=[];let index=0,refIndex=0,effectIndex=0,callbackIndex=0,capture;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=Object.hasOwn(state,i)?state[i]:typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=refIndex++;return refs[i]??={current:initial};},useEffect(fn,deps){const i=effectIndex++,prev=effects[i];if(!prev||!deps||deps.some((v,j)=>v!==prev.deps[j])){prev?.cleanup?.();effects[i]={deps,cleanup:fn()};}},useCallback(fn,deps){const i=callbackIndex++,prev=callbacks[i];if(!prev||deps.some((v,j)=>v!==prev.deps[j]))callbacks[i]={fn,deps};return callbacks[i].fn;}};
 const mod=load(directory+'workspace.tsx',{react:hooks,'@/lib/locale':localeModule,'@/lib/approval-workflow-input':input,'@/lib/browser-auth-loss':auth,'./read-input':readInput,'./policy-editor':{PolicyEditor:()=>React.createElement('div')},'./request':{useApprovalRequest:(...args)=>{capture=args[4];return{ready:true,blocked:false,busy:false,pending:null,run:async command=>sent.push(command),abandon:async()=>{}};}}},{fetch:fetcher,crypto:{randomUUID:()=>id(70)}});
 return{slots,refs,sent,get capture(){return capture;},render(){index=0;refIndex=0;effectIndex=0;callbackIndex=0;return mod.ScopeWorkspace({actorId,scope,locale});},unmount(){effects.forEach(e=>e.cleanup?.());}};
}
test('AR/EN exact-source inbox preserves and escapes long legacy labels',()=>{
 for(const locale of ['en','ar']){const h=workspaceHarness({locale});h.render();h.slots[2]=[approval];h.slots[6]={approval,decisions:[{id:id(30),approvalId:approval.id,actorId:id(9),stage:0,action:'APPROVE',reason:'private <script>reason</script>',createdAt:stamp}],page:0,nextPage:1,eligible:true,canCancel:true};const html=renderToStaticMarkup(h.render());assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('.'.repeat(700)));assert.ok(!html.includes('<script>'));assert.ok(html.includes(locale==='en'?'Next page':'الصفحة التالية'));assert.ok(html.includes(`sourceId=${source.id}`));h.unmount();}
});
test('read identities validate actor exact scope and unbounded historical source labels',()=>{
 assert.ok(readInput.listSchema.safeParse(list).success);assert.ok(readInput.responseIdentity(list,actorId,scope));assert.equal(readInput.responseIdentity({...list,actorId:id(99)},actorId,scope),false);assert.equal(readInput.responseIdentity({...list,branchId:null},actorId,scope),false);assert.equal(readInput.listSchema.safeParse({...list,items:[{...approval,stage:-1}]}).success,false);
});
test('late authentication failure clears all visible lanes despite a newer read in same mount',async()=>{
 const pending=[];const h=workspaceHarness({fetcher:()=>new Promise(resolve=>pending.push(resolve))});h.render();h.slots[2]=[approval];h.slots[6]={approval,decisions:[],page:0,nextPage:null,eligible:true,canCancel:true};h.slots[1]=1;h.render();assert.equal(pending.length,2);
 pending[0]({ok:false,status:403});await flush();h.render();assert.equal(h.slots[14],true);assert.deepEqual(h.slots[2],[]);assert.equal(h.slots[6],null);
 pending[1]({ok:true,status:200,json:async()=>list});await flush();assert.deepEqual(h.slots[2],[]);h.unmount();
});
test('old successful list responses cannot replace a new page; unmount fences pending responses',async()=>{
 const pending=[];const h=workspaceHarness({fetcher:()=>new Promise(resolve=>pending.push(resolve))});h.render();h.slots[0]=1;h.render();pending[0]({ok:true,status:200,json:async()=>list});await flush();assert.deepEqual(h.slots[2],[]);h.unmount();pending[1]({ok:true,status:200,json:async()=>({...list,page:1})});await flush();assert.deepEqual(h.slots[2],[]);
});
test('source submit uses exact fingerprint and policy revision without invoking legacy actions',()=>{
 const h=workspaceHarness();h.render();h.slots[5]={resource:'PURCHASE',sourceId:source.id,source,sourceFingerprint:'b'.repeat(32),policy:row.policy,approval:null};const buttons=descendants(h.render()).filter(e=>e.type==='button');buttons.find(b=>b.props.children==='Submit this exact preview').props.onClick();assert.equal(h.sent.length,1);assert.equal(h.sent[0].sourceFingerprint,'b'.repeat(32));assert.equal(h.sent[0].policyVersion,1);assert.equal(h.sent[0].expectedActorId,actorId);assert.equal(h.slots[5],null);h.unmount();
});
test('late mutation authentication callback from a prior epoch cannot erase newer state',()=>{
 const h=workspaceHarness();h.render();const delayed=h.capture();h.refs[1].current++;h.slots[2]=[approval];delayed();assert.equal(h.slots[14],false);assert.deepEqual(h.slots[2],[approval]);h.unmount();
});
test('changing source identity fences the outstanding preview and clears earlier detail',async()=>{
 const pending=[];const h=workspaceHarness({fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});h.render();const tree=h.render(),form=descendants(tree).find(e=>e.type==='form');form.props.onSubmit({preventDefault(){}});const preview=pending.find(p=>p.url.includes('/preview?'));assert.ok(preview);
 const inputField=descendants(h.render()).find(e=>e.type==='input');inputField.props.onChange({target:{value:id(99)}});
 preview.resolve({ok:true,status:200,json:async()=>({actorId,tenantId,companyId,branchId,resource:'PURCHASE',sourceId:source.id,source,sourceFingerprint:'a'.repeat(32),policy:row.policy,approval:null})});await flush();assert.equal(h.slots[5],null);assert.equal(h.slots[6],null);h.unmount();
});
