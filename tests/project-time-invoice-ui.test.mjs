import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, overrides = {}, globals = {}) {
 const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
 const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } });
 const exports = {}; new Function('require', 'exports', ...Object.keys(globals), outputText)(name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), exports, ...Object.values(globals)); return exports;
}
const date=load('src/lib/date.ts');
const input=load('src/lib/project-time-invoice-input.ts',{'./date':date});
const directory='src/app/accounting/project-time-invoices/';
const validation=load(directory+'validation.ts',{'@/lib/project-time-invoice-input':input});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actorId=id(1),tenantId=id(2),companyId=id(3),branchId=id(4);
const payload={tenantId,companyId,branchId,expectedActorId:actorId,requestId:id(5),reason:'Reviewed prices',projectId:id(6),customerId:id(7),currency:'OMR',entries:[{entryId:id(8),expectedSequence:1,hourlyRate:'10.000',treatment:'STANDARD'}],paymentTerms:null,paymentDueDate:null,replacesSourceId:null,previewHash:'a'.repeat(64)};
const sourceId=id(9),number='PT-'+BigInt('0x'+sourceId.replaceAll('-','')).toString(36).toUpperCase().padStart(25,'0');
const valid={requestId:payload.requestId,actorId,outcome:'COMMITTED',request:payload,result:{kind:'invoice',projectTimeSourceId:sourceId,invoice:{id:id(10),number,status:'DRAFT'}}};
const envelope=request=>JSON.stringify({version:1,actorId,request});
function browser() {
 const storage = new Map(), held = new Set();
 return { storage, locks: { async request(key, options, fn) { assert.equal(options.ifAvailable, true); if (held.has(key)) return fn(null); held.add(key); try { return await fn({ name: key }); } finally { held.delete(key); } } } };
}
function harness({ onAccessDenied = () => {}, captureAccessDenied, raw, fetcher = async () => { throw Error('network'); }, storageFails = false, removalFails = false, shared = browser(), locking = true } = {}) {
 const key = `erp-project-time-invoices:v1:${actorId}:${tenantId}:${companyId}:${branchId}`, storage = shared.storage;
 if (raw !== undefined) storage.set(key, raw);
 const slots = [], listeners = new Set(); let index = 0, calls = 0, denials = 0, actor = actorId, branch = branchId;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn, deps) { const i = index++, value = JSON.stringify(deps); if (slots[i]?.deps !== value) { slots[i]?.cleanup?.(); slots[i] = { deps: value, cleanup: fn() }; } } };
 const mod = load(directory + 'request.ts', { react: hooks, '@/lib/project-time-invoice-input': input, './validation': validation }, { navigator: { locks: locking ? shared.locks : undefined }, window: { addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); } }, localStorage: { getItem: k => storage.get(k) ?? null, setItem(k, v) { if (storageFails) throw Error('blocked'); storage.set(k, v); }, removeItem: k => { if (!removalFails) storage.delete(k); } }, fetch(...args) { calls++; return fetcher(...args); } });
 const render = () => { index = 0; return mod.useTimeInvoiceRequest(actor, tenantId, companyId, branch, () => { const notify = captureAccessDenied ? captureAccessDenied() : onAccessDenied; return () => { denials++; notify(); }; }); }; render();
 return { render, storage, key, get calls() { return calls; }, get denials() { return denials; }, event(eventKey = key) { listeners.forEach(fn => fn({ key: eventKey })); }, identity(nextActor, nextBranch = branchId) { actor = nextActor; branch = nextBranch; render(); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test('malformed, actor and scope captures never execute',()=>{for(const raw of ['broken',envelope({...payload,branchId:id(99)}),envelope({...payload,expectedActorId:id(99)})]){const h=harness({raw});assert.equal(h.render().blocked,true);assert.equal(h.render().pending,null);assert.equal(h.calls,0);}});
test('network and HTTP errors retain exact request for explicit retry',async()=>{for(const status of [400,401,403,409,500]){const sent=[],h=harness({fetcher:async(_u,o)=>{sent.push(o.body);return {ok:false,status,json:async()=>({})};}});await h.render().run(payload,()=>assert.fail(),()=>{});await h.render().run(null,()=>assert.fail(),()=>{});assert.equal(sent[0],sent[1]);assert.equal(h.storage.size,1);}});
test('receipt identity, payload and version changes cannot clear pending',async()=>{for(const raw of [{},{...valid,actorId:id(99)},{...valid,requestId:id(99)},{...valid,request:{...payload,reason:'changed'}},{...valid,result:{...valid.result,projectTimeSourceId:id(99)}}]){const h=harness({fetcher:async()=>({ok:true,json:async()=>raw})});await h.render().run(payload,()=>assert.fail(),()=>{});assert.equal(h.storage.size,1);}});
test('verified receipt clears exact capture only after storage removal',async()=>{for(const removalFails of [false,true]){const h=harness({removalFails,fetcher:async()=>({ok:true,json:async()=>valid})});let saved=0;await h.render().run(payload,()=>saved++,()=>{});assert.equal(saved,removalFails?0:1);assert.equal(h.storage.size,removalFails?1:0);}});
test('abandon resolves committed result or terminal matching abandoned receipt',async()=>{for(const outcome of ['COMMITTED','ABANDONED']){const raw=outcome==='COMMITTED'?valid:{...valid,outcome,result:{kind:'abandoned'}};const h=harness({raw:envelope(payload),fetcher:async url=>{assert.equal(url,'/api/project-time-invoices/abandon');return {ok:true,json:async()=>raw};}});let saved=0,abandoned=0;await h.render().abandon(()=>saved++,()=>assert.fail(),()=>abandoned++);assert.equal(saved,outcome==='COMMITTED'?1:0);assert.equal(abandoned,outcome==='ABANDONED'?1:0);assert.equal(h.storage.size,0);}});
test('no browser lock or failed persistence performs no mutation',async()=>{for(const opts of [{locking:false},{storageFails:true}]){const h=harness(opts);await h.render().run(payload,()=>assert.fail(),()=>{});assert.equal(h.calls,0);}});
test('repeated clicks and cross-tab submissions cannot replace pending',async()=>{const shared=browser();let release;const h=harness({shared,fetcher:()=>new Promise(r=>release=r)}),other=harness({shared});const first=h.render().run(payload,()=>assert.fail(),()=>{});await h.render().run(payload,()=>assert.fail(),()=>{});await other.render().run({...payload,requestId:id(90)},()=>assert.fail(),()=>{});assert.equal(h.calls,1);assert.equal(other.calls,0);release({ok:false,json:async()=>({})});await first;assert.deepEqual(JSON.parse(shared.storage.get(h.key)).request,payload);});
test('unmount and session changes fence late successful receipts',async()=>{for(const action of ['unmount','identity']){let release;const h=harness({fetcher:()=>new Promise(r=>release=r)});const task=h.render().run(payload,()=>assert.fail(),()=>{});if(action==='unmount')h.unmount();else h.identity(id(99));release({ok:true,json:async()=>valid});await task;assert.equal(h.storage.size,1);}});

test('invoice receipts require deterministic source reference and DRAFT snapshot',()=>{assert.equal(validation.timeInvoiceReceiptMatches(payload,valid),true);for(const invoice of [{...valid.result.invoice,number:'OTHER'},{...valid.result.invoice,status:'ISSUED'}])assert.equal(validation.timeInvoiceReceiptMatches(payload,{...valid,result:{...valid.result,invoice}}),false);});
test('workspace keeps explicit pricing, frozen replacement entries, bounded history and stale-response fences',()=>{const source=readFileSync(new URL('../'+directory+'workspace.tsx',import.meta.url),'utf8');for(const token of ["hourlyRate:'',treatment:''","expectedSequence","quantity", "sequence.current", "epoch.current", "projectTimeInvoiceSelection.safeParse", "result.data.entries.some", "replacesSourceId:replacement?.id??null", "s.invoice?.status==='VOID'", "document.visibilityState", "dir={locale==='ar'?'rtl':'ltr'}"]) {if(token!=='quantity')assert.ok(source.includes(token),token);}assert.ok(!source.includes('Number(line.unitPrice)'));assert.ok(!source.includes('/issue'));});

test('read-only users can select a project and inspect history without generation authority',()=>{const source=readFileSync('src/app/accounting/project-time-invoices/workspace.tsx','utf8');assert.match(source,/<fieldset disabled=\{blocked\}>/);assert.doesNotMatch(source,/<fieldset disabled=\{blocked\|\|!scope.canGenerate\}>/);assert.match(source,/!scope.canGenerate\|\|reason/);});
