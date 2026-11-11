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
const input = load('src/lib/supplier-rfq-input.ts');
const directory = 'src/app/purchasing/rfqs/';
const readInput = load(directory + 'read-input.ts', { '@/lib/supplier-rfq-input': input });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorId = id(1), tenantId = id(2), companyId = id(3), rfqId = id(4), branchId = id(5);
const supplierId=id(6), stamp='2026-11-11T12:00:00.000Z';
const payload={tenantId,companyId,branchId,rfqId,expectedActorId:actorId,requestId:id(7),expectedVersion:0,reason:'Explicit operating reason',action:'create',title:'Safety تشغيل',deadline:null,notes:'العربية English\n<script>alert(1)</script>\nhttps://example.test',lines:[{position:0,description:'Safety sign',quantity:2}]};
const current={id:rfqId,tenantId,companyId,branchId,title:payload.title,deadline:null,notes:payload.notes,lines:payload.lines,currency:'OMR',version:1,requestRevision:1,status:'DRAFT',createdBy:actorId,createdAt:stamp,updatedAt:stamp,purchaseOrderId:null};
const row={id:id(8),requestId:payload.requestId,rfqId,tenantId,companyId,branchId,version:1,action:'create',createdBy:actorId,createdAt:stamp,request:payload,rfq:current,offer:null,purchaseOrder:null};
const scope={tenantId,companyId,branchId,label:'Company / Branch',canManage:true,canAward:true};
const detail={actorId,rfq:current,events:[row],page:0,nextPage:null,canManage:true,canAward:true,observedAt:stamp};
const envelope = request => JSON.stringify({ version: 1, actorId, request });
function browser() {
 const storage = new Map(), held = new Set();
 return { storage, locks: { async request(key, options, fn) { assert.equal(options.ifAvailable, true); if (held.has(key)) return fn(null); held.add(key); try { return await fn({ name: key }); } finally { held.delete(key); } } } };
}
function harness({ onAccessDenied = () => {}, captureAccessDenied, raw, fetcher = async () => { throw Error('network'); }, storageFails = false, removalFails = false, shared = browser(), locking = true } = {}) {
 const key = `erp-supplier-rfq:v1:${actorId}:${tenantId}:${companyId}:${branchId}`, storage = shared.storage;
 if (raw !== undefined) storage.set(key, raw);
 const slots = [], listeners = new Set(); let index = 0, calls = 0, denials = 0, actor = actorId, branch = branchId;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn, deps) { const i = index++, value = JSON.stringify(deps); if (slots[i]?.deps !== value) { slots[i]?.cleanup?.(); slots[i] = { deps: value, cleanup: fn() }; } } };
 const mod = load(directory + 'request.ts', { react: hooks, '@/lib/supplier-rfq-input': input }, { navigator: { locks: locking ? shared.locks : undefined }, window: { addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); } }, localStorage: { getItem: k => storage.get(k) ?? null, setItem(k, v) { if (storageFails) throw Error('blocked'); storage.set(k, v); }, removeItem: k => { if (!removalFails) storage.delete(k); } }, fetch(...args) { calls++; return fetcher(...args); } });
 const render = () => { index = 0; return mod.useRfqRequest(actor, tenantId, companyId, branch, () => { const notify = captureAccessDenied ? captureAccessDenied() : onAccessDenied; return () => { denials++; notify(); }; }); }; render();
 return { render, storage, key, get calls() { return calls; }, get denials() { return denials; }, event(eventKey = key) { listeners.forEach(fn => fn({ key: eventKey })); }, identity(nextActor, nextBranch = branchId) { actor = nextActor; branch = nextBranch; render(); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
test('rfq captures hydrate without writes and malformed or actor/scope substitutions remain blocked', () => {
 for (const raw of ['broken', envelope({ ...payload, branchId: id(99) }), JSON.stringify({ version: 1, actorId: id(9), request: payload }), envelope({ ...payload, expectedActorId: id(99) })]) {
  const h = harness({ raw }); assert.equal(h.render().blocked, true); assert.equal(h.render().pending, null); assert.equal(h.storage.get(h.key), raw); assert.equal(h.calls, 0);
 }
 const h = harness({ raw: envelope(payload) }); assert.deepEqual(h.render().pending, payload); assert.equal(h.calls, 0);
});
test('network errors and all HTTP failures retain exact rfq request for explicit same-description retry', async () => {
 for (const status of [400, 401, 403, 404, 409, 422, 500]) {
  const sent = [], h = harness({ fetcher: async (_url, options) => { sent.push(options.body); return { ok: false, status, json: async () => ({ error: 'failed' }) }; } });
  await h.render().run(payload, () => assert.fail(), () => {}); const raw = h.storage.get(h.key);
  await h.render().run(null, () => assert.fail(), () => {}); assert.equal(sent.length, 2); assert.equal(sent[0], sent[1]); assert.equal(h.storage.get(h.key), raw);
 }
 const h = harness(); await h.render().run(payload, () => assert.fail(), () => {}); assert.deepEqual(JSON.parse(h.storage.get(h.key)).request, payload);
});
test('unsupported locks or failed persistence never write; concurrent clicks send once and unmount retains capture', async () => {
 for (const options of [{ storageFails: true }, { locking: false }]) { const h = harness(options); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.calls, 0); }
 let release; const h = harness({ fetcher: () => new Promise(resolve => { release = resolve; }) });
 const first = h.render().run(payload, () => assert.fail(), () => {}); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.calls, 1); h.unmount(); release({ ok: false, json: async () => ({}) }); await first; assert.equal(h.storage.size, 1);
});
test('unknown and malformed successful responses do not clear pending rfq requests', async () => {
 for (const data of [{}, { event: {} }, { event: { ...row, createdBy: id(99) } }, { event: { ...row, branchId: id(99) } }, { event: { ...row, request: {...payload, notes:'different'} } }, { event: { ...row, version: 2 } }]) {
  const h = harness({ fetcher: async () => ({ ok: true, json: async () => data }) }); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.size, 1);
 }
 const h = harness({ fetcher: async () => ({ ok: true, json: async () => { throw Error('malformed JSON'); } }) }); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.size, 1);
});
test('verified rfq clears only its own exact capture, and failed removal remains unresolved', async () => {
 for (const removalFails of [false, true]) {
  const h = harness({ removalFails, fetcher: async () => ({ ok: true, json: async () => ({ event: row }) }) }); let saved = 0;
  await h.render().run(payload, () => saved++, () => {}); assert.equal(saved, removalFails ? 0 : 1); assert.equal(h.storage.size, removalFails ? 1 : 0);
 }
});
test('check-and-abandon clears only a matching tombstone; unknown outcomes remain retained', async () => {
 const cancellation = { id: payload.requestId, tenantId, companyId, branchId, rfqId, createdBy: actorId, createdAt: row.createdAt, request: payload };
 for (const data of [{}, { cancellation: { ...cancellation, createdBy: id(99) } }, { cancellation }]) {
  let abandoned = 0; const h = harness({ raw: envelope(payload), fetcher: async (url, options) => { assert.equal(url, '/api/supplier-rfqs/resolve'); assert.deepEqual(JSON.parse(options.body), payload); return { ok: true, json: async () => data }; } });
  await h.render().abandon(() => assert.fail(), () => {}, () => abandoned++); const valid = data.cancellation?.createdBy === actorId;
  assert.equal(abandoned, valid ? 1 : 0); assert.equal(h.storage.size, valid ? 0 : 1);
 }
});
test('abandonment discovers an already recorded rfq without claiming cancellation', async () => {
 const h = harness({ raw: envelope(payload), fetcher: async () => ({ ok: true, json: async () => ({ event: row }) }) }); let saved = 0;
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
 release({ ok: true, json: async () => ({ event: row }) }); await running; assert.equal(h.storage.get(h.key), other);
 h.storage.delete(h.key); h.event(); assert.equal(h.render().blocked, false);
});
test('actor and scope switches fence late responses and leave old requests unchanged', async () => {
 for (const change of ['actor', 'branch']) {
  let release, callbacks = 0; const h = harness({ raw: envelope(payload), fetcher: () => new Promise(resolve => { release = resolve; }) });
  const running = h.render().abandon(() => callbacks++, () => callbacks++, () => callbacks++);
  h.identity(change === 'actor' ? id(99) : actorId, change === 'branch' ? id(98) : branchId);
  release({ ok: true, json: async () => ({ event: row }) }); await running;
  assert.equal(callbacks, 0); assert.equal(h.storage.get(h.key), envelope(payload)); assert.equal(h.render().pending, null);
 }
});
const localeModule=load('src/lib/locale.ts');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function descendants(element){return[element,...React.Children.toArray(element?.props?.children).flatMap(child=>React.isValidElement(child)?descendants(child):[])];}
function workspaceHarness({state={},scopeValue=scope,locale='en',pending=null,blocked=false,fetcher=()=>new Promise(()=>{})}={}){
 const slots=[],refs=[],captured=[],effects=[],callbacks=[],downloads=[];let index=0,refIndex=0,effectIndex=0,callbackIndex=0,requestCaptureAccessDenied;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=Object.hasOwn(state,i)?state[i]:initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=refIndex++;return refs[i]??={current:initial};},useEffect(fn,deps){const i=effectIndex++,prev=effects[i];if(!prev||!deps||deps.some((v,j)=>v!==prev.deps[j])){prev?.cleanup?.();effects[i]={deps,cleanup:fn()};}},useCallback(fn,deps){const i=callbackIndex++,previous=callbacks[i];if(!previous||deps.some((v,j)=>v!==previous.deps[j]))callbacks[i]={fn,deps};return callbacks[i].fn;}};
 const mod=load(directory+'workspace.tsx',{react:hooks,'@/lib/locale':localeModule,'@/lib/supplier-rfq-input':input,'./request':{useRfqRequest:(...args)=>{requestCaptureAccessDenied=args[4];return{ready:true,blocked:blocked||!!pending,busy:false,pending,run:async request=>captured.push(request),abandon:async()=>{}};}},'./read-input':readInput,'./supplier-picker':{SupplierPicker:()=>React.createElement('input',{name:'supplierId'})}},{fetch:fetcher,URL:{createObjectURL:()=>{downloads.push('prepared');return 'blob:test';},revokeObjectURL:()=>{}},document:{createElement:()=>({click:()=>downloads.push('downloaded')})},window:{confirm:()=>true},crypto:{randomUUID:(()=>{let n=90;return()=>id(n++);})()},FormData:class{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}getAll(key){return this.values[key]??[];}}});
 return{slots,refs,captured,downloads,mod,get captureAccessDenied(){return requestCaptureAccessDenied;},render(){index=0;refIndex=0;effectIndex=0;callbackIndex=0;return mod.RfqScopeWorkspace({actorId,scope:scopeValue,locale});},submit(form,values){form.props.onSubmit({preventDefault(){},currentTarget:{values}});},unmount(){effects.forEach(effect=>effect.cleanup?.());}};
}
const list={actorId,rfqs:[current],page:0,nextPage:null,canManage:true,canAward:true,observedAt:stamp};
const offer={id:id(20),rfqId,tenantId,companyId,branchId,supplierId,supplierBranchId:branchId,supplierName:'Legacy supplier\n<script>bad</script>',supplierCode:'S-1',version:1,requestRevision:1,currency:'OMR',validUntil:null,notes:'Quoted',lines:[{position:0,unitPrice:'0.001'}],createdBy:actorId,createdAt:stamp,updatedAt:stamp,status:'CURRENT',complete:true,total:'0.002',canAward:true,validityKnown:false};
const comparison={actorId,offers:[offer],page:0,nextPage:null,totalOffers:1,comparisonComplete:true,rfqVersion:1,requestRevision:1,asOf:'2026-11-11',observedAt:stamp};
test('read envelopes bind actor, scope, request, version order and honest comparison paging',()=>{
 assert.deepEqual(readInput.verifiedRfqList(list,scope,0,actorId,'ALL'),list);
 assert.deepEqual(readInput.verifiedRfqDetail(detail,scope,rfqId,0,actorId,current),detail);
 for(const bad of [{...detail,actorId:id(99)},{...detail,rfq:{...current,companyId:id(99)}},{...detail,events:[{...row,rfqId:id(99)}]},{...detail,events:[row,row]},{...detail,events:[{...row,rfq:{...current,title:'Tampered'}}]},{...detail,nextPage:2}])assert.equal(readInput.verifiedRfqDetail(bad,scope,rfqId,0,actorId,current),null);
 // Source-filtered history can be empty or start before the current version.
 assert.ok(readInput.verifiedRfqDetail({...detail,events:[]},scope,rfqId,0,actorId,current));
 assert.ok(readInput.verifiedRfqDetail({...detail,rfq:{...current,version:3,status:'AWARDED'},events:[row]},scope,rfqId,0,actorId,current));
 assert.ok(readInput.verifiedRfqOffers(comparison,scope,rfqId,0,actorId,current));
 for(const patch of [{actorId:id(99)},{page:1},{nextPage:2},{comparisonComplete:false},{totalOffers:0},{offers:[{...offer,companyId:id(99)}]},{offers:[{...offer,rfqId:id(99)}]}])assert.equal(readInput.verifiedRfqOffers({...comparison,...patch},scope,rfqId,0,actorId,current),null);
 assert.ok(readInput.verifiedRfqOffers({...comparison,totalOffers:51,comparisonComplete:false,nextPage:1},scope,rfqId,0,actorId,current));
});
test('AR/EN workspace shows bounded comparison, unknown validity, incomplete expired offers and literal supplier names',()=>{
 for(const locale of ['en','ar']){
  const partial={...comparison,comparisonComplete:false,totalOffers:51,nextPage:1,offers:[{...offer,complete:false,total:null,validUntil:'2026-11-01',status:'INCOMPLETE',canAward:false,validityKnown:true}]};
  const h=workspaceHarness({locale,state:{7:detail,8:row,10:partial,11:partial.offers[0]}});const html=renderToStaticMarkup(h.render());
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="https://example.test"'));
  assert.ok(html.includes(locale==='en'?'partial comparison page':'صفحة مقارنة جزئية'));assert.ok(html.includes(locale==='en'?'Expired as of comparison date':'منتهي الصلاحية في تاريخ المقارنة'));assert.ok(html.includes(locale==='en'?'Missing line prices':'أسعار بنود ناقصة'));
  assert.ok(html.includes('51'));assert.ok(html.includes('2026-11-11'));assert.ok(html.includes(locale==='en'?'Download complete selected internal event':'تنزيل الحدث الداخلي المحدد كاملًا'));
  assert.ok(html.includes(locale==='en'?'unencrypted':'دون تشفير'));h.unmount();
 }
});
test('scope selection starts blank and never claims supplier communication or issuing',()=>{
 const h=workspaceHarness();const html=renderToStaticMarkup(h.mod.RfqsWorkspace({actorId,options:[scope],locale:'en'}));assert.ok(html.includes('Choose company-wide or branch scope'));assert.ok(html.includes('Opening a request does not send it'));assert.ok(html.includes('one DRAFT purchase order only'));assert.ok(!html.includes('Save draft request'));h.unmount();
});
test('create request captures explicit lines and actor; empty quantities and invalid dates never submit',async()=>{
 const h=workspaceHarness();h.render();h.slots[15]=true;const forms=descendants(h.render()).filter(e=>e.type==='form'),create=forms[0];
 const values={title:'New RFQ',deadline:'2024-02-29',notes:'',description:['Safety sign'],quantity:['2'],reason:'Explicit'};
 h.submit(create,values);assert.equal(h.captured.length,1);assert.equal(h.captured[0].action,'create');assert.deepEqual(h.captured[0].lines,[{position:0,description:'Safety sign',quantity:2}]);assert.equal(h.captured[0].expectedActorId,actorId);assert.equal(h.captured[0].expectedVersion,0);
 for(const patch of [{deadline:'2025-02-29'},{quantity:['']},{reason:''},{description:[' x ']}])h.submit(create,{...values,...patch});assert.equal(h.captured.length,1);h.unmount();
});
test('award uses explicit PO number and selected offer revision; prices never become Number',()=>{
 const open={...detail,rfq:{...current,status:'OPEN',version:4}},h=workspaceHarness({state:{7:open,10:comparison,11:offer,13:'2026-11-12'}});h.render();h.slots[15]=true;
 const forms=descendants(h.render()).filter(e=>e.type==='form'),award=forms.find(form=>descendants(form).some(node=>node.type==='input'&&node.props.name==='purchaseOrderNumber'));
 assert.ok(award);h.submit(award,{purchaseOrderNumber:'RFQ-PO-1',reason:'Explicit supplier selection'});assert.equal(h.captured.length,1);
 assert.equal(h.captured[0].action,'award');assert.equal(h.captured[0].offerId,offer.id);assert.equal(h.captured[0].expectedOfferVersion,1);assert.equal(h.captured[0].expectedVersion,4);assert.equal(h.captured[0].evaluationDate,'2026-11-12');assert.equal(h.captured[0].purchaseOrderNumber,'RFQ-PO-1');assert.ok(!('unitPrice'in h.captured[0]));
 h.submit(award,{purchaseOrderNumber:'',reason:'Explicit'});assert.equal(h.captured.length,1);h.unmount();
});
test('read-only and pending scopes cannot submit new requests',()=>{
 for(const opts of [{scopeValue:{...scope,canManage:false}},{pending:payload},{blocked:true}]){
  const h=workspaceHarness(opts);h.render();h.slots[15]=true;const html=renderToStaticMarkup(h.render());if(opts.scopeValue)assert.ok(!html.includes('Save draft request'));else assert.ok(html.includes('disabled=""'));assert.equal(h.captured.length,0);h.unmount();
 }
});
function button(tree,text){return descendants(tree).find(e=>e.type==='button'&&(e.props.children===text||(Array.isArray(e.props.children)&&e.props.children.includes(text))));}
test('out-of-order detail, close and scope unmount fence late request data',async()=>{
 const pending=[],h=workspaceHarness({fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});h.render();h.slots[3]=[current,{...current,id:id(40),title:'Another RFQ'}];h.slots[5]=false;
 button(h.render(),current.title).props.onClick();button(h.render(),'Another RFQ').props.onClick();
 const first=pending.filter(p=>p.url.includes(`/supplier-rfqs/${rfqId}?`)).at(-1),second=pending.filter(p=>p.url.includes(`/supplier-rfqs/${id(40)}?`)).at(-1);
 second.resolve({ok:true,status:200,json:async()=>({...detail,rfq:{...current,id:id(40)},events:[]})});await flush();first.resolve({ok:true,status:200,json:async()=>detail});await flush();assert.equal(h.slots[7].rfq.id,id(40));
 button(h.render(),current.title).props.onClick();const close=button(h.render(),'Close request');close.props.onClick();pending.at(-1).resolve({ok:true,status:200,json:async()=>detail});await flush();assert.equal(h.slots[7],null);
 button(h.render(),current.title).props.onClick();h.unmount();pending.at(-1).resolve({ok:false,status:403,json:async()=>assert.fail()});await flush();assert.equal(h.slots[14],false);
});
test('every read denial fences late detail and comparison and retained export/submit callbacks',async()=>{
 for(const channel of ['list','detail','offers']){
  const pending=[],h=workspaceHarness({state:{7:detail,8:row,10:comparison,11:offer},fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});h.render();h.slots[15]=true;const tree=h.render(),link=button(tree,'Download complete selected internal event'),create=descendants(tree).find(e=>e.type==='form');
  const comparisonForm=descendants(tree).filter(e=>e.type==='form').find(f=>descendants(f).some(n=>n.type==='input'&&n.props.name==='evaluationDate'));
  h.submit(comparisonForm,{evaluationDate:'2026-11-12'});button(tree,'Refresh current request').props.onClick();
  // Opening detail invalidates older offer reads; start a fresh offer read via retained current detail handler for this test.
  h.submit(comparisonForm,{evaluationDate:'2026-11-12'});
  const selected=pending.filter(p=>channel==='list'?p.url.includes('/supplier-rfqs?'):channel==='offers'?p.url.includes('/offers?'):p.url.includes(`/supplier-rfqs/${rfqId}?`)).at(-1);
  selected.resolve({ok:false,status:403,json:async()=>assert.fail('Do not consume denial body')});await flush();assert.equal(h.slots[14],true);assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[7],null);assert.equal(h.slots[10],null);assert.equal(h.slots[11],null);
  for(const p of pending.filter(p=>p!==selected))p.resolve({ok:true,status:200,json:async()=>p.url.includes('/offers?')?comparison:p.url.includes('/supplier-rfqs?')?list:detail});await flush();assert.equal(h.slots[7],null);assert.equal(h.slots[10],null);
  const calls=pending.length;link.props.onClick();assert.equal(pending.length,calls);h.submit(create,{title:'New',deadline:'',notes:'',description:['Sign'],quantity:['1'],reason:'Explicit'});assert.equal(h.captured.length,0);h.unmount();
 }
});
test('actor envelope rejection happens before private data and never repopulates after denial',async()=>{
 const responses=[],h=workspaceHarness({fetcher:()=>new Promise(resolve=>responses.push(resolve))});h.render();const bad={actorId:id(99)};Object.defineProperty(bad,'rfqs',{get(){assert.fail('Private data must not be consumed');}});responses[0]({ok:true,status:200,json:async()=>bad});await flush();assert.equal(h.slots[14],true);assert.deepEqual(h.slots[3],[]);h.unmount();
});
const authFailure=signal=>signal==='redirect'?{ok:true,status:200,redirected:true,url:'https://erp.example.test/login',json:async()=>assert.fail()}:signal==='code'?{ok:false,status:409,json:async()=>({code:'ACTOR_MISMATCH'})}:{ok:false,status:signal,json:async()=>assert.fail()};
test('each mutation attempt captures its read epoch and preserves exact pending bytes on authentication loss',async()=>{
 for(const operation of ['submit','retry','resolve'])for(const signal of [401,403,'redirect','code']){
  let epoch=1,invalidations=0,release;const captureAccessDenied=()=>{const captured=epoch;return()=>{if(captured===epoch){invalidations++;epoch++;}};};
  const h=harness({raw:operation==='submit'?undefined:envelope(payload),captureAccessDenied,fetcher:()=>new Promise(resolve=>release=resolve)});
  const run=()=>operation==='resolve'?h.render().abandon(()=>assert.fail(),()=>{},()=>assert.fail()):h.render().run(operation==='submit'&&!h.storage.size?payload:null,()=>assert.fail(),()=>{});
  const first=run(),frozen=h.storage.get(h.key);captureAccessDenied()();release(authFailure(signal));await first;assert.equal(invalidations,1);assert.equal(epoch,2);assert.equal(h.storage.get(h.key),frozen);
  const next=run();release(authFailure(signal));await next;assert.equal(epoch,3);assert.equal(invalidations,2);assert.equal(h.storage.get(h.key),frozen);h.unmount();
 }
});
test('comparison from another RFQ revision is rejected instead of relabeling new totals with old quantities',async()=>{
 for(const patch of [{rfqVersion:2},{requestRevision:2}]){
  assert.equal(readInput.verifiedRfqOffers({...comparison,...patch},scope,rfqId,0,actorId,current),null);
  const pending=[],h=workspaceHarness({state:{7:detail},fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
  const tree=h.render(),form=descendants(tree).filter(e=>e.type==='form').find(f=>descendants(f).some(n=>n.type==='input'&&n.props.name==='evaluationDate'));
  h.submit(form,{evaluationDate:'2026-11-12'});pending.find(p=>p.url.includes('/offers?')).resolve({ok:true,status:200,json:async()=>({...comparison,...patch})});await flush();assert.equal(h.slots[10],null);assert.ok(h.slots[6].includes('Refresh the request'));h.unmount();
 }
});
test('export verifies current actor and exact immutable receipt and fences close, selection change, denial and unmount',async()=>{
 for(const outcome of ['success','close','selection','denial','unmount','actor','tamper']){
  const pending=[],h=workspaceHarness({state:{7:detail,8:row},fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
  const tree=h.render();button(tree,'Download complete selected internal event').props.onClick();const output=pending.find(p=>p.url.includes('/export?'));assert.ok(output);
  let json;output.resolve({ok:true,status:200,headers:{get:()=>outcome==='actor'?id(99):actorId},json:()=>new Promise(resolve=>json=resolve)});await flush();
  if(outcome==='actor'){assert.equal(h.slots[14],true);assert.equal(json,undefined);assert.deepEqual(h.downloads,[]);h.unmount();continue;}
  if(outcome==='close')button(tree,'Close request').props.onClick();
  if(outcome==='selection')descendants(tree).find(n=>n.type==='button'&&n.props['aria-pressed']===true).props.onClick();
  if(outcome==='denial')h.captureAccessDenied()();
  if(outcome==='unmount')h.unmount();
  json({notice:'Internal snapshot only.',event:outcome==='tamper'?{...row,rfq:{...current,title:'Changed'}}:row});await flush();
  assert.deepEqual(h.downloads,outcome==='success'?['prepared','downloaded']:[]);
  if(outcome==='tamper')assert.ok(h.slots[6].includes('Nothing was downloaded'));
  h.unmount();
 }
});
test('offer form preserves exact decimals and blanks, updates selected identity only, and uses current specification revision',()=>{
 const open={...detail,rfq:{...current,status:'OPEN',version:4,lines:[...current.lines,{position:1,description:'Second sign',quantity:3}]}},h=workspaceHarness({state:{7:open,10:comparison,11:offer}});h.render();h.slots[15]=true;
 const form=descendants(h.render()).filter(e=>e.type==='form').find(f=>descendants(f).some(n=>n.type==='input'&&n.props.name==='price-0'));
 h.submit(form,{currency:'OMR',validUntil:'',notes:'Operator quote','price-0':'0.001','price-1':'',reason:'Explicit revision'});
 assert.equal(h.captured.length,1);assert.equal(h.captured[0].supplierId,supplierId);assert.equal(h.captured[0].offerId,offer.id);assert.equal(h.captured[0].expectedOfferVersion,offer.version);assert.deepEqual(h.captured[0].lines,[{position:0,unitPrice:'0.001'}]);
 h.submit(form,{currency:'OMR',validUntil:'2025-02-29',notes:'','price-0':'0.001',reason:'Explicit'});assert.equal(h.captured.length,1);h.unmount();
});
test('independent supplier permission is never implied by RFQ permission labels',()=>{
 const labels=load('src/lib/permission-labels.ts',{'./locale':localeModule});
 assert.deepEqual(labels.requiredReads('rfq:read',['rfq:read','supplier:read']),['rfq:read']);
 assert.ok(!labels.requiredReads('rfq:manage',['rfq:read','supplier:read','purchase-order:read']).includes('supplier:read'));
});
function pickerHarness(fetcher,sharedEpoch={current:0},parentDenied=()=>{},parentCurrent=epoch=>sharedEpoch.current===epoch){
 const slots=[],effects=[];let index=0,effectIndex=0,denied=0,mounted=true;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useEffect(fn,deps){const i=effectIndex++,previous=effects[i];if(!previous||deps.some((v,j)=>v!==previous.deps[j])){previous?.cleanup?.();effects[i]={deps,cleanup:fn()};}}};
 const onAccessDenied=()=>{denied++;parentDenied();},isReadCurrent=epoch=>mounted&&parentCurrent(epoch);
 const mod=load(directory+'supplier-picker.tsx',{react:hooks,'@/lib/locale':localeModule,'./read-input':readInput},{fetch:fetcher});
 return{slots,get denied(){return denied;},render(){index=0;effectIndex=0;return mod.SupplierPicker({actorId,scope,locale:'en',onAccessDenied,readEpoch:sharedEpoch,isReadCurrent});},unmount(){mounted=false;effects.forEach(e=>e.cleanup?.());}};
}
test('supplier picker requires exact actor and source scope and reports denial to shared workspace',async()=>{
 for(const outcome of ['actor','denial','scope','valid']){
  const supplier={id:supplierId,displayName:offer.supplierName,code:'S-1',branchId:outcome==='scope'?id(99):branchId};
  const h=pickerHarness(async()=>({ok:outcome!=='denial',status:outcome==='denial'?403:200,json:async()=>({actorId:outcome==='actor'?id(99):actorId,suppliers:[supplier],page:0,nextPage:null})}));
  h.render();h.slots[4]=supplier;await flush();assert.equal(h.denied,['actor','denial'].includes(outcome)?1:0);
  assert.deepEqual(h.slots[3],outcome==='valid'?[supplier]:[]);if(outcome!=='valid')assert.equal(h.slots[4],null);h.unmount();
 }
});
test('shared workspace denial fences supplier picker delayed JSON and unmount fences obsolete denial',async()=>{
 let json;const epoch={current:0},h=pickerHarness(async()=>({ok:true,status:200,json:()=>new Promise(resolve=>json=resolve)}),epoch);h.render();await flush();epoch.current++;
 json({actorId,suppliers:[{id:supplierId,displayName:'Late supplier',code:'LATE',branchId}],page:0,nextPage:null});await flush();assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[4],null);assert.equal(h.denied,0);h.unmount();
 let release;const old=pickerHarness(()=>new Promise(resolve=>release=resolve));old.render();old.unmount();release({ok:false,status:403,json:async()=>assert.fail()});await flush();assert.equal(old.denied,0);
});
test('supplier picker denial clears whole workspace and prevents late comparison reconstruction',async()=>{
 const pending=[],h=workspaceHarness({state:{7:{...detail,rfq:{...current,status:'OPEN'}},10:comparison},fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
 const tree=h.render(),pickerProps=descendants(tree).find(n=>n.props?.readEpoch)?.props;assert.ok(pickerProps);
 const form=descendants(tree).filter(e=>e.type==='form').find(f=>descendants(f).some(n=>n.type==='input'&&n.props.name==='evaluationDate'));
 h.submit(form,{evaluationDate:'2026-11-11'});
 const picker=pickerHarness(async()=>({ok:false,status:403,json:async()=>assert.fail()}),pickerProps.readEpoch,pickerProps.onAccessDenied,pickerProps.isReadCurrent);picker.render();await flush();assert.equal(h.slots[14],true);
 pending.find(p=>p.url.includes('/offers?')).resolve({ok:true,status:200,json:async()=>comparison});await flush();assert.equal(h.slots[10],null);assert.equal(h.slots[7],null);picker.unmount();h.unmount();
});

test('uppercase pending UUID bytes retry unchanged and canonical receipts clear only that exact capture',async()=>{
 const canonical={...payload,requestId:'abcdefab-0000-4000-8000-000000000007'},upper={...canonical,requestId:canonical.requestId.toUpperCase()},raw=envelope(upper),sent=[];
 const receipt={...row,requestId:canonical.requestId,request:canonical};let saved=0;
 const h=harness({raw,fetcher:async(_url,options)=>{sent.push(options.body);return{ok:true,json:async()=>({event:receipt})};}});
 assert.equal(h.render().pending.requestId,canonical.requestId);assert.equal(h.storage.get(h.key),raw);
 await h.render().run(null,()=>saved++,()=>assert.fail());assert.equal(sent[0],JSON.stringify(upper));assert.equal(saved,1);assert.equal(h.storage.size,0);h.unmount();
});
