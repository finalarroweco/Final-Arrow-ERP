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
const input = load('src/lib/stock-reorder-input.ts');
const directory = 'src/app/inventory/reordering/';
const readInput = load(directory + 'read-input.ts', { '@/lib/stock-reorder-input': input });
const csv = load(directory + 'csv.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorId = id(1), tenantId = id(2), companyId = id(3), policyId = id(4), branchId = id(5), itemId = id(6);
const payload = { itemId, tenantId, companyId, policyId, branchId, unit: 'pcs', unitVersion: 0, minimumQuantity: '2.000', targetQuantity: '5.000', expectedActorId: actorId, requestId: id(7), expectedVersion: 0, reason: 'العربية English\n<script>alert(1)</script>'.replaceAll('\n',' '), action: 'create' };
const row = { itemId, itemBranchId: null, itemName: '<script>literal</script>', itemSku: '=CMD()', unit: 'pcs', unitVersion: 0, minimumQuantity: '2.000', targetQuantity: '5.000', reference: `REO-${policyId}`, id: id(8), requestId: payload.requestId, tenantId, companyId, policyId, branchId, version: 1, action: 'create', reason: payload.reason, archived: false, createdBy: actorId, createdAt: '2026-11-11T12:00:00.000Z' };
const { id: _eventId, requestId: _requestId, policyId: _policyId, action: _action, reason: _reason, ...snapshot } = row;
const current = { ...snapshot, id: policyId, updatedAt: row.createdAt, status: 'BELOW_MINIMUM', physicalQuantity: '0.000', reservedQuantity: '0.000', availableQuantity: '0.000', quantityToTarget: '5.000' };
const scope = { tenantId, companyId, branchId, label: 'Company / Branch', canManage: true };
const detail = { actorId, policy: current, events: [row], page: 0, nextPage: null, canManage: true, observedAt: row.createdAt };
const list = { actorId, policies: [current], page: 0, nextPage: null, canManage: true, observedAt: row.createdAt };
const envelope = request => JSON.stringify({ version: 1, actorId, request });
function browser() {
 const storage = new Map(), held = new Set();
 return { storage, locks: { async request(key, options, fn) { assert.equal(options.ifAvailable, true); if (held.has(key)) return fn(null); held.add(key); try { return await fn({ name: key }); } finally { held.delete(key); } } } };
}
function harness({ onAccessDenied = () => {}, captureAccessDenied, raw, fetcher = async () => { throw Error('network'); }, storageFails = false, removalFails = false, shared = browser(), locking = true } = {}) {
 const key = `erp-stock-reorder:v1:${actorId}:${tenantId}:${companyId}:${branchId}`, storage = shared.storage;
 if (raw !== undefined) storage.set(key, raw);
 const slots = [], listeners = new Set(); let index = 0, calls = 0, denials = 0, actor = actorId, branch = branchId;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn, deps) { const i = index++, value = JSON.stringify(deps); if (slots[i]?.deps !== value) { slots[i]?.cleanup?.(); slots[i] = { deps: value, cleanup: fn() }; } } };
 const mod = load(directory + 'request.ts', { react: hooks, '@/lib/stock-reorder-input': input }, { navigator: { locks: locking ? shared.locks : undefined }, window: { addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); } }, localStorage: { getItem: k => storage.get(k) ?? null, setItem(k, v) { if (storageFails) throw Error('blocked'); storage.set(k, v); }, removeItem: k => { if (!removalFails) storage.delete(k); } }, fetch(...args) { calls++; return fetcher(...args); } });
 const render = () => { index = 0; return mod.useReorderRequest(actor, tenantId, companyId, branch, () => { const notify = captureAccessDenied ? captureAccessDenied() : onAccessDenied; return () => { denials++; notify(); }; }); }; render();
 return { render, storage, key, get calls() { return calls; }, get denials() { return denials; }, event(eventKey = key) { listeners.forEach(fn => fn({ key: eventKey })); }, identity(nextActor, nextBranch = branchId) { actor = nextActor; branch = nextBranch; render(); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
test('reorder captures hydrate without writes and malformed or actor/scope substitutions remain blocked', () => {
 for (const raw of ['broken', envelope({ ...payload, branchId: id(99) }), JSON.stringify({ version: 1, actorId: id(9), request: payload }), envelope({ ...payload, expectedActorId: id(99) })]) {
  const h = harness({ raw }); assert.equal(h.render().blocked, true); assert.equal(h.render().pending, null); assert.equal(h.storage.get(h.key), raw); assert.equal(h.calls, 0);
 }
 const h = harness({ raw: envelope(payload) }); assert.deepEqual(h.render().pending, payload); assert.equal(h.calls, 0);
});
test('network errors and all HTTP failures retain exact reorder request for explicit same-threshold retry', async () => {
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
test('unknown and malformed successful responses do not clear pending reorder requests', async () => {
 for (const data of [{}, { event: {} }, { event: { ...row, createdBy: id(99) } }, { event: { ...row, branchId: id(99) } }, { event: { ...row, minimumQuantity: '9.000' } }, { event: { ...row, version: 2 } }]) {
  const h = harness({ fetcher: async () => ({ ok: true, json: async () => data }) }); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.size, 1);
 }
 const h = harness({ fetcher: async () => ({ ok: true, json: async () => { throw Error('malformed JSON'); } }) }); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.size, 1);
});
test('verified reorder clears only its own exact capture, and failed removal remains unresolved', async () => {
 for (const removalFails of [false, true]) {
  const h = harness({ removalFails, fetcher: async () => ({ ok: true, json: async () => ({ event: row }) }) }); let saved = 0;
  await h.render().run(payload, () => saved++, () => {}); assert.equal(saved, removalFails ? 0 : 1); assert.equal(h.storage.size, removalFails ? 1 : 0);
 }
});
test('check-and-abandon clears only a matching tombstone; unknown outcomes remain retained', async () => {
 const cancellation = { itemId, id: payload.requestId, tenantId, companyId, branchId, policyId, createdBy: actorId, createdAt: row.createdAt, request: payload };
 for (const data of [{}, { cancellation: { ...cancellation, createdBy: id(99) } }, { cancellation }]) {
  let abandoned = 0; const h = harness({ raw: envelope(payload), fetcher: async (url, options) => { assert.equal(url, '/api/inventory/reordering/resolve'); assert.deepEqual(JSON.parse(options.body), payload); return { ok: true, json: async () => data }; } });
  await h.render().abandon(() => assert.fail(), () => {}, () => abandoned++); const valid = data.cancellation?.createdBy === actorId;
  assert.equal(abandoned, valid ? 1 : 0); assert.equal(h.storage.size, valid ? 0 : 1);
 }
});
test('abandonment discovers an already recorded reorder without claiming cancellation', async () => {
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
test('history detail rejects scope substitutions, incoherent latest text, version order and missing pagination', () => {
 assert.deepEqual(readInput.verifiedReorderDetail(detail, scope, policyId, 0, actorId), detail);
 for (const patch of [{ minimumQuantity: '9.000' }, { targetQuantity: '9.000' }, { archived: true }, { version: 2 }, { branchId: null }, { id: id(99) }, { tenantId: id(99) }]) assert.equal(readInput.verifiedReorderDetail({ ...detail, policy: { ...current, ...patch } }, scope, policyId, 0, actorId), null);
 for (const patch of [{ policyId: id(99) }, { branchId: null }, { tenantId: id(99) }, { minimumQuantity: '9.000' }, { version: 2 }]) assert.equal(readInput.verifiedReorderDetail({ ...detail, events: [{ ...row, ...patch }] }, scope, policyId, 0, actorId), null);
 assert.equal(readInput.verifiedReorderDetail({ ...detail, nextPage: 2 }, scope, policyId, 0, actorId), null);
 assert.equal(readInput.verifiedReorderDetail({ ...detail, events: [] }, scope, policyId, 0, actorId), null);
 assert.equal(readInput.verifiedReorderDetail({ ...detail, events: [row, row] }, scope, policyId, 0, actorId), null);
 assert.equal(readInput.verifiedReorderDetail({ ...detail, events: Array(51).fill(row) }, scope, policyId, 0, actorId), null);

});
test('all explicit action payloads retain independent reorder and request identities through retries', async () => {
 for (const action of ['create', 'edit', 'archive', 'restore']) {
  const request = action === 'create' ? payload : action === 'edit' ? { ...payload, action, expectedVersion: 12 } : { itemId, unit: 'pcs', unitVersion: 0, tenantId, companyId, branchId, policyId, requestId: id(30), expectedActorId: actorId, expectedVersion: 12, action, reason: 'Explicit lifecycle reason' };
  const sent = [], h = harness({ fetcher: async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: false, json: async () => ({}) }; } });
  await h.render().run(request, () => assert.fail(), () => {}); await h.render().run(null, () => assert.fail(), () => {}); await h.render().abandon(() => assert.fail(), () => {}, () => assert.fail());
  assert.equal(sent.length, 3); for (const actual of sent) assert.deepEqual(actual, request);
 }
});
const localeModule = load('src/lib/locale.ts');
const unitLabels = load(directory + 'unit-label.ts', { '@/lib/locale': localeModule });
function descendants(element) { return [element, ...React.Children.toArray(element?.props?.children).flatMap(child => React.isValidElement(child) ? descendants(child) : [])]; }
function workspaceHarness({ state = {}, scopeValue = scope, locale = 'en', pending = null, blocked = false, fetcher = async () => new Promise(() => {}), effects = true, globals = {} } = {}) {
 const slots = [], refs = [], captured = [], cleanups = []; let index = 0, refIndex = 0, requestCaptureAccessDenied;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = Object.hasOwn(state, i) ? state[i] : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; }, useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial }; }, useEffect(fn) { if (effects) cleanups.push(fn()); }, useCallback(fn) { return fn; } };
 const mod = load(directory + 'workspace.tsx', { react: hooks, '@/lib/locale': localeModule, './unit-label': unitLabels, '@/lib/stock-reorder-input': input, './csv': csv, './request': { useReorderRequest: (...args) => { requestCaptureAccessDenied = args[4]; return ({ ready: true, blocked: blocked || !!pending, busy: false, pending, run: async request => captured.push(request), abandon: async () => {} }); } }, './read-input': readInput, './item-picker': { ItemPicker: () => React.createElement('input', {name: 'itemId'}) } }, { fetch: fetcher, crypto: { randomUUID: (() => { let n = 90; return () => id(n++); })() }, FormData: class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } }, ...globals });
 return { mod, captured, descendants, slots, refs, get requestCaptureAccessDenied() { return requestCaptureAccessDenied; }, get requestAccessDenied() { return () => requestCaptureAccessDenied()(); }, render() { index = 0; refIndex = 0; return mod.ReorderScopeWorkspace({ actorId, scope: scopeValue, locale }); }, submit(form, values) { form.props.onSubmit({ preventDefault() {}, currentTarget: { values } }); }, unmount() { cleanups.forEach(fn => fn?.()); } };
}
function pickerHarness(fetcher, fence = { current: 0 }, externalDenied = () => {}, externalCurrent = null, locale = 'en') {
 let denied = 0; const onAccessDenied = () => { denied++; fence.current++; externalDenied(); }; const isReadCurrent = externalCurrent ?? (epoch => fence.current === epoch);
 const slots = [], effects = []; let index = 0; const pendingEffects = [];
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value]; }, useEffect(fn, deps) { const i = index++, key = JSON.stringify(deps); if (effects[i]?.key !== key) { effects[i]?.cleanup?.(); effects[i] = { key, cleanup: null }; pendingEffects.push(() => effects[i].cleanup = fn()); } } };
 const mod = load(directory + 'item-picker.tsx', { react: hooks, '@/lib/locale': localeModule, './unit-label': unitLabels, '@/lib/stock-reorder-input': input, './read-input': readInput }, { fetch: fetcher });
 return { slots, descendants, get denied() { return denied; }, render() { index = 0; const tree = mod.ItemPicker({actorId, onAccessDenied, readEpoch: fence, isReadCurrent, scope, locale}); pendingEffects.splice(0).forEach(fn => fn()); return tree; }, unmount() { effects.forEach(effect => effect?.cleanup?.()); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const rowButton = nodes => nodes.find(e => e.type === 'button' && Array.isArray(e.props.children) && e.props.children[0] === current.itemName);
const button = (nodes, text) => nodes.find(e => e.type === 'button' && e.props.children === text);
const authFailure = signal => signal === 'redirect' ? {ok:true,status:200,redirected:true,url:'https://erp.example.test/login?next=%2Finventory%2Freordering',json:async()=>assert.fail('Login HTML must not be parsed')} : signal === 'code' ? {ok:false,status:409,json:async()=>({code:'ACTOR_MISMATCH'})} : signal === 'nested-code' ? {ok:false,status:409,json:async()=>({error:{code:'ACTOR_MISMATCH'}})} : {ok:false,status:signal,json:async()=>assert.fail('Non-JSON auth denial must not be parsed')};
const performRequest = (controller, operation, saved = () => assert.fail()) => operation === 'resolve' ? controller.abandon(saved,()=>{},()=>assert.fail()) : controller.run(operation === 'submit' ? payload : null,saved,()=>{});

test('AR/EN policy workspace renders metadata literally, unit-cycle warning and no cross-unit totals', () => {
 for (const locale of ['en','ar']) {
  const h = workspaceHarness({locale,state:{3:[current],5:false,7:detail,8:row,12:true}}), html = renderToStaticMarkup(h.render());
  assert.ok(html.includes('&lt;script&gt;literal&lt;/script&gt;')); assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;')); assert.ok(html.includes('unicode-bidi:plaintext'));
  assert.ok(html.includes(locale==='en'?'including changing away and back':'حتى تغييرها ثم إعادتها'));
  assert.ok(html.includes(locale==='en'?'Informational gap to target':'الفجوة المعلوماتية للهدف'));
  assert.ok(!html.includes('type="number"')); h.unmount();
 }
 const h=workspaceHarness(),html=renderToStaticMarkup(h.mod.ReorderWorkspace({actorId,options:[scope],locale:'en'}));
 assert.ok(html.includes('Choose a concrete branch'));assert.ok(html.includes('equality is not below'));assert.ok(html.includes('Different items and units are never totaled'));h.unmount();
});
test('literal metadata CSV escapes formulas, tabs, quotes, newlines and excludes private reasons', () => {
 for(const text of ['=CMD()',' +SUM(A1)','\t@evil','-10+20','\r\n=HYPERLINK("bad")'])assert.ok(csv.reorderCsvCell(text).startsWith('"\''));
 assert.equal(csv.reorderCsvCell('Arabic العربية "quote"\nline'),'"Arabic العربية ""quote""\nline"');
 const result=csv.reorderPageCsv(list);assert.ok(result.includes('"\'=CMD()"'));assert.ok(result.includes('"0.000"'));assert.ok(result.includes('"5.000"'));assert.ok(!result.includes(payload.reason));assert.ok(!result.includes('reason'));
});
test('create and edit submit exact string thresholds and immutable identity without numeric quantity conversion', () => {
 const h=workspaceHarness({state:{7:detail,8:row,12:true}}),forms=descendants(h.render()).filter(e=>e.type==='form');
 h.submit(forms[0],{itemId,unit:'pcs',unitVersion:'0',minimumQuantity:'999999999999999.998',targetQuantity:'999999999999999.999',reason:'Explicit'});
 assert.equal(h.captured.length,1);assert.equal(h.captured[0].minimumQuantity,'999999999999999.998');
 h.slots[12]=true;const editing=descendants(h.render()).filter(e=>e.type==='form')[2];
 h.submit(editing,{itemId:id(99),unit:'kg',unitVersion:'5',minimumQuantity:'0.001',targetQuantity:'0.002',reason:'Correction'});
 assert.equal(h.captured[1].itemId,itemId);assert.equal(h.captured[1].unit,'pcs');assert.equal(h.captured[1].unitVersion,0);assert.equal(h.captured[1].expectedVersion,1);h.unmount();
});
test('read-only, pending, unavailable or unit-review policies do not expose threshold editing', () => {
 for(const status of ['UNIT_REVIEW','SOURCE_UNAVAILABLE','ARCHIVED']) {
  const policy={...current,status,archived:status==='ARCHIVED',physicalQuantity:null,reservedQuantity:null,availableQuantity:null,quantityToTarget:null};
  const h=workspaceHarness({state:{7:{...detail,policy},8:row,12:true}}),html=renderToStaticMarkup(h.render());
  assert.ok(!html.includes('Correct thresholds'));assert.ok(html.includes(status==='ARCHIVED'?'Restore policy':'Archive policy'));h.unmount();
 }
 const h=workspaceHarness({scopeValue:{...scope,canManage:false},state:{7:{...detail,canManage:false},8:row,12:true}});assert.ok(!renderToStaticMarkup(h.render()).includes('name="reason"'));h.unmount();
 for(const options of [{blocked:true},{pending:payload}]) {const x=workspaceHarness({...options,state:{12:true}}),form=descendants(x.render()).find(e=>e.type==='form');x.submit(form,{...payload,unitVersion:'0'});assert.equal(x.captured.length,0);x.unmount();}
});
test('picker pagination is not capped at 200 and same-search retry fences stale reads', async () => {
 const pending=[],h=pickerHarness(url=>new Promise(resolve=>pending.push({url,resolve}))),item={id:itemId,name:'<script>literal</script>',sku:'SKU',unit:'pcs',unitVersion:0};
 h.render();pending[0].resolve({ok:true,json:async()=>({actorId,items:[item],page:0,nextPage:1})});await tick();
 let nodes=descendants(h.render());nodes.find(e=>e.type==='select').props.onChange({target:{value:itemId}});nodes=descendants(h.render());assert.equal(nodes.find(e=>e.props?.name==='unitVersion').props.value,0);
 for(let page=1;page<=5;page++){button(nodes,'More items').props.onClick();h.render();assert.ok(pending.at(-1).url.includes(`page=${page}`));pending.at(-1).resolve({ok:true,json:async()=>({actorId,items:[item],page,nextPage:page+1})});await tick();nodes=descendants(h.render());}
 button(nodes,'Find items').props.onClick();h.render();const old=pending.at(-1);nodes=descendants(h.render());button(nodes,'Find items').props.onClick();h.render();const fresh=pending.at(-1);assert.notEqual(old,fresh);
 fresh.resolve({ok:true,json:async()=>({actorId,items:[],page:0,nextPage:null})});await tick();old.resolve({ok:true,json:async()=>({actorId:id(99)})});await tick();assert.equal(h.denied,0);assert.deepEqual(h.slots[4],[]);assert.equal(h.slots[5],null);h.unmount();
});
test('list, detail, picker and CSV authentication loss clears all current reads and fences delayed results', async () => {
 for(const channel of ['list','detail','picker','csv'])for(const signal of [401,403,'redirect','code','nested-code']) {
  const pending=[],h=workspaceHarness({state:{3:[current],5:false,7:detail,8:row,12:true},fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
  const nodes=descendants(h.render()),props=nodes.find(e=>e.props?.readEpoch)?.props;assert.ok(props);
  rowButton(nodes).props.onClick();button(nodes,'Download this page as metadata CSV').props.onClick();
  let pickerResponse;const picker=pickerHarness(()=>new Promise(resolve=>pickerResponse=resolve),props.readEpoch,props.onAccessDenied,props.isReadCurrent);picker.render();
  const responses={list:pending[0].resolve,detail:pending[1].resolve,csv:pending[2].resolve,picker:pickerResponse};responses[channel](authFailure(signal));await tick();
  assert.equal(h.slots[10],true);assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[7],null);assert.equal(h.slots[8],null);assert.equal(h.slots[11],null);
  for(const other of Object.keys(responses).filter(k=>k!==channel))responses[other]({ok:true,json:async()=>other==='picker'?{actorId,items:[{id:itemId,name:'Stale',sku:'S',unit:'pcs',unitVersion:0}],page:0,nextPage:null}:other==='detail'?detail:list});await tick();
  assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[7],null);assert.deepEqual(picker.slots[4],[]);assert.equal(picker.slots[5],null);picker.unmount();h.unmount();
 }
});
test('missing or mismatched actor receipts deny before private list, history or picker fields are consumed', async () => {
 for(const channel of ['list','detail','picker','csv'])for(const actor of [undefined,id(99),null]) {
  const pending=[],h=workspaceHarness({state:{3:[current],5:false,7:detail,8:row,12:true},fetcher:async()=>({ok:true,json:()=>new Promise(resolve=>pending.push(resolve))})});
  const nodes=descendants(h.render()),props=nodes.find(e=>e.props?.readEpoch)?.props;rowButton(nodes).props.onClick();button(nodes,'Download this page as metadata CSV').props.onClick();
  let pickerJson;const picker=pickerHarness(async()=>({ok:true,json:()=>new Promise(resolve=>pickerJson=resolve)}),props.readEpoch,props.onAccessDenied,props.isReadCurrent);picker.render();await tick();
  const raw={actorId:actor};Object.defineProperty(raw,channel==='detail'?'policy':channel==='picker'?'items':'policies',{get:()=>assert.fail('Private data consumed before actor receipt')});
  ({list:pending[0],detail:pending[1],csv:pending[2],picker:pickerJson})[channel](raw);await tick();assert.equal(h.slots[10],true);assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[7],null);picker.unmount();h.unmount();
 }
});
test('delayed details, closed panels and old account scopes cannot repopulate policy history', async () => {
 const pending=[],h=workspaceHarness({state:{3:[current],5:false,7:detail,8:row},fetcher:url=>url.includes('/reordering?')?new Promise(()=>{}):new Promise(resolve=>pending.push(resolve))});
 const nodes=descendants(h.render()),open=rowButton(nodes);open.props.onClick();open.props.onClick();
 pending[1]({ok:true,json:async()=>detail});await tick();pending[0]({ok:true,json:async()=>({actorId:id(99)})});await tick();assert.equal(h.slots[10],false);assert.deepEqual(h.slots[7],detail);
 open.props.onClick();button(nodes,'Close policy').props.onClick();pending[2]({ok:true,json:async()=>detail});await tick();assert.equal(h.slots[7],null);
 h.unmount();const before=pending.length;open.props.onClick();button(nodes,'Download this page as metadata CSV').props.onClick();assert.equal(pending.length,before);
});
test('submit, retry and resolution auth loss capture each attempt epoch and preserve pending bytes', async () => {
 for(const operation of ['submit','retry','resolve'])for(const signal of [401,403,'redirect','code','nested-code']) {
  let epoch=1,shown='old',invalidations=0,release;
  const captureAccessDenied=()=>{const captured=epoch;return()=>{if(captured===epoch){invalidations++;epoch++;shown=null;}};};
  const h=harness({raw:operation==='submit'?undefined:envelope(payload),captureAccessDenied,fetcher:()=>new Promise(resolve=>release=resolve)});
  const running=performRequest(h.render(),operation),frozen=h.storage.get(h.key);captureAccessDenied()();shown='new';release(authFailure(signal));await running;
  assert.equal(epoch,2);assert.equal(invalidations,1);assert.equal(shown,'new');assert.equal(h.storage.get(h.key),frozen);
  const retry=performRequest(h.render(),operation==='submit'?'retry':operation);release(authFailure(signal));await retry;assert.equal(epoch,3);assert.equal(shown,null);assert.equal(h.storage.get(h.key),frozen);h.unmount();
 }
});
test('extra response keys and simultaneous terminal results are rejected without clearing pending', async () => {
 for(const data of [{event:row,extra:true},{event:row,cancellation:{}},{event:row,actorId}]) {const h=harness({fetcher:async()=>({ok:true,json:async()=>data})});await h.render().run(payload,()=>assert.fail(),()=>{});assert.ok(h.storage.get(h.key));h.unmount();}
});

test('legacy empty units have explicit bilingual labels while requests, receipts, history and CSV preserve empty strings', async () => {
 const emptyPolicy={...current,unit:''},emptyEvent={...row,unit:''},emptyDetail={...detail,policy:emptyPolicy,events:[emptyEvent]};
 for(const locale of ['en','ar']) {
  const label=locale==='en'?'Unspecified unit (empty source value)':'وحدة غير محددة (قيمة المصدر فارغة)';
  const h=workspaceHarness({locale,state:{3:[emptyPolicy],5:false,7:emptyDetail,8:emptyEvent,12:true}}),tree=h.render(),html=renderToStaticMarkup(tree);
  assert.equal(html.split(label).length-1,3,'table, detail and selected history use explicit label');
  h.slots[12]=true;const forms=descendants(h.render()).filter(e=>e.type==='form');
  h.submit(forms[0],{itemId,unit:'',unitVersion:'0',minimumQuantity:'2.000',targetQuantity:'5.000',reason:'Explicit empty source snapshot'});
  assert.equal(h.captured[0].unit,'');assert.equal(input.reorderResponseMatches({...payload,unit:''},emptyEvent),true);
  assert.equal(readInput.verifiedReorderDetail(emptyDetail,scope,policyId,0,actorId).events[0].unit,'');
  const picker=pickerHarness(async()=>({ok:true,json:async()=>({actorId,items:[{id:itemId,name:'Legacy item',sku:'OLD',unit:'',unitVersion:0}],page:0,nextPage:null})}),undefined,undefined,null,locale);
  picker.render();await tick();let pickerNodes=descendants(picker.render());pickerNodes.find(e=>e.type==='select').props.onChange({target:{value:itemId}});pickerNodes=descendants(picker.render());
  assert.equal(pickerNodes.find(e=>e.props?.name==='unit').props.value,'');assert.equal(renderToStaticMarkup(picker.render()).split(label).length-1,2,'option and selected item label empty unit');
  const exported=csv.reorderPageCsv({...list,policies:[emptyPolicy]});assert.ok(!exported.includes(label));assert.ok(exported.includes(',"","0","1","2.000"'),'CSV retains original empty policy unit');
  picker.unmount();h.unmount();
 }
 for(const unit of ['كرتون','  ','first\nsecond','pcs'])assert.equal(unitLabels.reorderUnitLabel(unit,'en'),unit);
});
