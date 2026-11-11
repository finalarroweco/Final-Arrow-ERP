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
const input = load('src/lib/internal-text-document-input.ts');
const directory = 'src/app/documents/';
const readInput = load(directory + 'read-input.ts', { '@/lib/internal-text-document-input': input });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorId = id(1), tenantId = id(2), companyId = id(3), documentId = id(4), branchId = id(5);
const payload = { tenantId, companyId, documentId, branchId, expectedActorId: actorId, requestId: id(7), expectedVersion: 0, reason: 'Operating instructions', action: 'create', title: 'Safety تشغيل', body: 'العربية English\n<script>alert(1)</script>\nhttps://example.test' };
const row = { id: id(8), requestId: payload.requestId, tenantId, companyId, documentId, branchId, version: 1, action: 'create', title: payload.title, body: payload.body, reason: payload.reason, archived: false, createdBy: actorId, createdAt: '2026-11-11T12:00:00.000Z' };
const current = { id: documentId, tenantId, companyId, branchId, version: 1, title: row.title, body: row.body, archived: false, createdBy: actorId, createdAt: row.createdAt, updatedAt: row.createdAt };
const scope = { tenantId, companyId, branchId, label: 'Company / Branch', canManage: true };
const detail = { actorId, document: current, events: [row], page: 0, nextPage: null, canManage: true };
const envelope = request => JSON.stringify({ version: 1, actorId, request });
function browser() {
 const storage = new Map(), held = new Set();
 return { storage, locks: { async request(key, options, fn) { assert.equal(options.ifAvailable, true); if (held.has(key)) return fn(null); held.add(key); try { return await fn({ name: key }); } finally { held.delete(key); } } } };
}
function harness({ raw, fetcher = async () => { throw Error('network'); }, storageFails = false, removalFails = false, shared = browser(), locking = true, onAuthorizationFailure, captureAuthorizationFailure } = {}) {
 const key = `erp-internal-text:v1:${actorId}:${tenantId}:${companyId}:${branchId}`, storage = shared.storage;
 if (raw !== undefined) storage.set(key, raw);
 const slots = [], listeners = new Set(); let index = 0, calls = 0, authorizationFailures = 0, actor = actorId, branch = branchId;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn, deps) { const i = index++, value = JSON.stringify(deps); if (slots[i]?.deps !== value) { slots[i]?.cleanup?.(); slots[i] = { deps: value, cleanup: fn() }; } } };
 const mod = load(directory + 'request.ts', { react: hooks, '@/lib/internal-text-document-input': input }, { navigator: { locks: locking ? shared.locks : undefined }, window: { addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); } }, localStorage: { getItem: k => storage.get(k) ?? null, setItem(k, v) { if (storageFails) throw Error('blocked'); storage.set(k, v); }, removeItem: k => { if (!removalFails) storage.delete(k); } }, fetch(...args) { calls++; return fetcher(...args); } });
 const render = () => { index = 0; return mod.useDocumentRequest(actor, tenantId, companyId, branch, () => { const notify = captureAuthorizationFailure ? captureAuthorizationFailure() : onAuthorizationFailure; return () => { authorizationFailures++; notify?.(); }; }); }; render();
 return { render, storage, key, get calls() { return calls; }, get authorizationFailures() { return authorizationFailures; }, event(eventKey = key) { listeners.forEach(fn => fn({ key: eventKey })); }, identity(nextActor, nextBranch = branchId) { actor = nextActor; branch = nextBranch; render(); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
test('document captures hydrate without writes and malformed or actor/scope substitutions remain blocked', () => {
 for (const raw of ['broken', envelope({ ...payload, branchId: id(99) }), JSON.stringify({ version: 1, actorId: id(9), request: payload }), envelope({ ...payload, expectedActorId: id(99) })]) {
  const h = harness({ raw }); assert.equal(h.render().blocked, true); assert.equal(h.render().pending, null); assert.equal(h.storage.get(h.key), raw); assert.equal(h.calls, 0);
 }
 const h = harness({ raw: envelope(payload) }); assert.deepEqual(h.render().pending, payload); assert.equal(h.calls, 0);
});
test('network errors and all HTTP failures retain exact document request for explicit same-body retry', async () => {
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
test('unknown and malformed successful responses do not clear pending document requests', async () => {
 for (const data of [{}, { event: {} }, { event: { ...row, createdBy: id(99) } }, { event: { ...row, branchId: id(99) } }, { event: { ...row, body: 'different' } }, { event: { ...row, version: 2 } }]) {
  const h = harness({ fetcher: async () => ({ ok: true, json: async () => data }) }); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.size, 1);
 }
 const h = harness({ fetcher: async () => ({ ok: true, json: async () => { throw Error('malformed JSON'); } }) }); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.size, 1);
});
test('verified document clears only its own exact capture, and failed removal remains unresolved', async () => {
 for (const removalFails of [false, true]) {
  const h = harness({ removalFails, fetcher: async () => ({ ok: true, json: async () => ({ event: row }) }) }); let saved = 0;
  await h.render().run(payload, () => saved++, () => {}); assert.equal(saved, removalFails ? 0 : 1); assert.equal(h.storage.size, removalFails ? 1 : 0);
 }
});
test('check-and-abandon clears only a matching tombstone; unknown outcomes remain retained', async () => {
 const cancellation = { id: payload.requestId, tenantId, companyId, branchId, documentId, createdBy: actorId, createdAt: row.createdAt, request: payload };
 for (const data of [{}, { cancellation: { ...cancellation, createdBy: id(99) } }, { cancellation }]) {
  let abandoned = 0; const h = harness({ raw: envelope(payload), fetcher: async (url, options) => { assert.equal(url, '/api/documents/resolve'); assert.deepEqual(JSON.parse(options.body), payload); return { ok: true, json: async () => data }; } });
  await h.render().abandon(() => assert.fail(), () => {}, () => abandoned++); const valid = data.cancellation?.createdBy === actorId;
  assert.equal(abandoned, valid ? 1 : 0); assert.equal(h.storage.size, valid ? 0 : 1);
 }
});
test('abandonment discovers an already recorded document without claiming cancellation', async () => {
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
 assert.deepEqual(readInput.verifiedDocumentDetail(detail, scope, documentId, 0, actorId), detail);
 for (const patch of [{ body: 'tampered' }, { title: 'tampered' }, { archived: true }, { version: 2 }, { branchId: null }, { id: id(99) }, { tenantId: id(99) }]) assert.equal(readInput.verifiedDocumentDetail({ ...detail, document: { ...current, ...patch } }, scope, documentId, 0, actorId), null);
 for (const patch of [{ documentId: id(99) }, { branchId: null }, { tenantId: id(99) }, { body: 'tampered' }, { version: 2 }]) assert.equal(readInput.verifiedDocumentDetail({ ...detail, events: [{ ...row, ...patch }] }, scope, documentId, 0, actorId), null);
 assert.equal(readInput.verifiedDocumentDetail({ ...detail, nextPage: 2 }, scope, documentId, 0, actorId), null);
 assert.equal(readInput.verifiedDocumentDetail({ ...detail, events: [] }, scope, documentId, 0, actorId), null);
 assert.equal(readInput.verifiedDocumentDetail({ ...detail, events: [row, row] }, scope, documentId, 0, actorId), null);
 assert.equal(readInput.verifiedDocumentDetail({ ...detail, events: Array(51).fill(row) }, scope, documentId, 0, actorId), null);
 const unicode = '😀'.repeat(200); assert.ok(readInput.documentMetadata.safeParse({ ...current, title: unicode }).success);
});
test('all explicit action payloads retain independent document and request identities through retries', async () => {
 for (const action of ['create', 'edit', 'archive', 'restore']) {
  const request = action === 'create' ? payload : action === 'edit' ? { ...payload, action, expectedVersion: 12 } : { tenantId, companyId, branchId, documentId, requestId: id(30), expectedActorId: actorId, expectedVersion: 12, action, reason: 'Explicit lifecycle reason' };
  const sent = [], h = harness({ fetcher: async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: false, json: async () => ({}) }; } });
  await h.render().run(request, () => assert.fail(), () => {}); await h.render().run(null, () => assert.fail(), () => {}); await h.render().abandon(() => assert.fail(), () => {}, () => assert.fail());
  assert.equal(sent.length, 3); for (const actual of sent) assert.deepEqual(actual, request);
 }
});
const localeModule = load('src/lib/locale.ts');
function workspaceHarness({ state = {}, scopeValue = scope, locale = 'en', pending = null, blocked = false, fetcher = async () => ({ ok: false, json: async () => ({}) }), effects = false } = {}) {
 const slots = [], refs = [], captured = [], callbacks = [], authorizationCallbacks = [], cleanups = []; let index = 0, refIndex = 0;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = Object.hasOwn(state, i) ? state[i] : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; }, useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial }; }, useEffect(fn) { if (effects) cleanups.push(fn()); }, useCallback(fn) { return fn; } };
 const mod = load(directory + 'workspace.tsx', { react: hooks, '@/lib/locale': localeModule, '@/lib/internal-text-document-input': input, './request': { useDocumentRequest: (...args) => (authorizationCallbacks.push(args[4]), { ready: true, blocked: blocked || !!pending, busy: false, pending, run: async (request, saved, failed) => { captured.push(request); callbacks.push({ saved, failed }); }, abandon: async () => {} }) }, './read-input': readInput }, { fetch: fetcher, crypto: { randomUUID: (() => { let n = 90; return () => id(n++); })() }, FormData: class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } } });
 function descendants(element) { return [element, ...React.Children.toArray(element?.props?.children).flatMap(child => React.isValidElement(child) ? descendants(child) : [])]; }
 return { mod, captured, callbacks, authorizationCallbacks, descendants, slots, render() { index = 0; refIndex = 0; return mod.DocumentScopeWorkspace({ actorId, scope: scopeValue, locale }); }, submit(form, values) { form.props.onSubmit({ preventDefault() {}, currentTarget: { values } }); }, unmount() { cleanups.forEach(fn => fn?.()); } };
}
test('Arabic and English renders treat script, URL, and mixed direction content as literal plain text', () => {
 for (const locale of ['en', 'ar']) {
  const h = workspaceHarness({ locale, state: { 7: detail, 8: row } }), html = renderToStaticMarkup(h.render());
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;')); assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('https://example.test')); assert.ok(!html.includes('href="https://example.test"'));
  assert.ok(html.includes('white-space:pre-wrap')); assert.ok(html.includes('unicode-bidi:plaintext'));
  assert.ok(html.includes(`/api/documents/${documentId}/export?`)); assert.ok(html.includes(`eventId=${row.id}`));
  assert.ok(html.includes(locale === 'en' ? 'This storage is not encrypted' : 'التخزين غير مشفر'));
 }
});
test('scope choice starts unselected and explains company-wide audience and explicit limits', () => {
 const h = workspaceHarness();
 const html = renderToStaticMarkup(h.mod.DocumentsWorkspace({ actorId, options: [scope], locale: 'en' }));
 assert.ok(html.includes('not private to its author')); assert.ok(html.includes('No attachments')); assert.ok(html.includes('Scope cannot change'));
 assert.ok(!html.includes('name="title"')); assert.ok(html.includes('value="" selected=""'));
});
test('create and edit forms bind actor, immutable scope and expected version; reasons never default', () => {
 const h = workspaceHarness({ state: { 7: detail, 8: row } }), forms = h.descendants(h.render()).filter(e => e.type === 'form');
 assert.equal(forms.length, 4);
 h.submit(forms[0], { title: 'Explicit title', body: 'Explicit body', reason: 'Explicit create', tenantId: id(99), branchId: id(99), expectedVersion: 99 });
 h.submit(forms[2], { title: 'Next title', body: 'Next body', reason: 'Explicit edit', documentId: id(99), expectedVersion: 99 });
 h.submit(forms[3], { reason: 'Explicit archive', body: 'ignored', title: 'ignored' });
 assert.equal(h.captured.length, 3);
 assert.deepEqual(h.captured[0], input.documentRequest.parse({ tenantId, companyId, branchId, expectedActorId: actorId, requestId: id(90), documentId: id(91), expectedVersion: 0, action: 'create', title: 'Explicit title', body: 'Explicit body', reason: 'Explicit create' }));
 assert.equal(h.captured[1].documentId, documentId); assert.equal(h.captured[1].expectedVersion, 1); assert.equal(h.captured[1].branchId, branchId);
 assert.equal(h.captured[2].action, 'archive'); assert.equal(h.captured[2].expectedVersion, 1); assert.ok(!('body' in h.captured[2]));
 const reasonHtml = renderToStaticMarkup(forms[0]); assert.ok(reasonHtml.includes('name="reason"')); assert.ok(!reasonHtml.includes('value="Explicit'));
});
test('read-only scopes and unresolved requests cannot submit; archived restore has no text inputs', () => {
 for (const options of [{ blocked: true }, { pending: payload }]) {
  const h = workspaceHarness(options), form = h.descendants(h.render()).find(e => e.type === 'form'); h.submit(form, { title: 'Title', body: 'Body', reason: 'Reason' }); assert.equal(h.captured.length, 0);
 }
 const readOnly = workspaceHarness({ scopeValue: { ...scope, canManage: false }, state: { 7: { ...detail, canManage: false }, 8: row } });
 const readOnlyHtml = renderToStaticMarkup(readOnly.render()); assert.ok(!readOnlyHtml.includes('name="reason"')); assert.ok(!readOnlyHtml.includes('name="body"'));
 const archived = workspaceHarness({ state: { 7: { ...detail, document: { ...current, version: 2, archived: true } }, 8: row } }), forms = archived.descendants(archived.render()).filter(e => e.type === 'form'), restore = forms[2];
 assert.equal(forms.length, 3); const restoreHtml = renderToStaticMarkup(restore); assert.ok(!restoreHtml.includes('name="body"')); assert.ok(restoreHtml.includes('Restore keeps the current text unchanged'));
 archived.submit(restore, { reason: 'Explicit restore', body: 'ignored' }); assert.equal(archived.captured[0].action, 'restore'); assert.equal(archived.captured[0].expectedVersion, 2); assert.ok(!('body' in archived.captured[0]));
});
test('out-of-order detail and close responses cannot expose stale history', async () => {
 const pending = [], h = workspaceHarness({ state: { 3: [{ ...current }, { ...current, id: id(40) }], 5: false }, effects: true, fetcher: async url => url.includes('/api/documents?') ? { ok: false, json: async () => ({}) } : new Promise(resolve => pending.push({ url, resolve })) });
 const buttons = h.descendants(h.render()).filter(e => e.type === 'button' && e.props.children === row.title);
 buttons[0].props.onClick(); buttons[1].props.onClick(); assert.equal(pending.length, 2);
 pending[1].resolve({ ok: true, json: async () => ({ ...detail, document: { ...current, id: id(40) }, events: [{ ...row, documentId: id(40) }] }) }); await new Promise(resolve => setImmediate(resolve));
 assert.equal(h.slots[7].document.id, id(40));
 pending[0].resolve({ ok: true, json: async () => detail }); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.slots[7].document.id, id(40));
 const close = h.descendants(h.render()).find(e => e.type === 'button' && e.props.children === 'Close document');
 buttons[0].props.onClick(); assert.equal(pending.length, 3); close.props.onClick();
 pending[2].resolve({ ok: true, json: async () => detail }); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.slots[7], null); assert.equal(h.slots[8], null);
 h.unmount();
});

test('read receipts reject a changed actor and all workspace read links bind the mounted identity',()=>{assert.equal(readInput.verifiedDocumentDetail({...detail,actorId:id(99)},scope,documentId,0,actorId),null);const source=readFileSync(directory+'workspace.tsx','utf8');assert.equal((source.match(/new URLSearchParams\(\{ expectedActorId: actorId/g)||[]).length,2);assert.match(source,/data\.actorId !== actorId/);});
test('changed-session JSON cannot populate register or document state in a mounted actor workspace',async()=>{
 const urls=[],h=workspaceHarness({effects:true,fetcher:async url=>{urls.push(url);return {ok:true,json:async()=>({actorId:id(99),documents:[current],page:0,nextPage:null})};}});h.render();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.slots[3],[]);assert.ok(urls.every(url=>new URL(url,'https://erp.test').searchParams.get('expectedActorId')===actorId));h.unmount();
 const detailUrls=[],d=workspaceHarness({state:{3:[current],5:false},effects:true,fetcher:async url=>{detailUrls.push(url);return url.includes('/api/documents?')?{ok:false,json:async()=>({})}:{ok:true,json:async()=>({...detail,actorId:id(99)})};}});const button=d.descendants(d.render()).find(e=>e.type==='button'&&e.props.children===row.title);button.props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(d.slots[7],null);assert.equal(d.slots[8],null);assert.ok(detailUrls.every(url=>new URL(url,'https://erp.test').searchParams.get('expectedActorId')===actorId));d.unmount();
 const links=workspaceHarness({state:{7:detail,8:row}});for(const link of links.descendants(links.render()).filter(e=>e.type==='a'&&(e.props.href.includes('/api/documents')||e.props.href.includes('/print?'))))assert.equal(new URL(link.props.href,'https://erp.test').searchParams.get('expectedActorId'),actorId);
});
const settleRead = () => new Promise(resolve => setImmediate(resolve));
test('shared read fence rejects delayed success in both channel directions and blocks captured output clicks',async()=>{
 for(const failureChannel of ['list','detail'])for(const failureKind of ['401','403','redirect','actor'])for(const successStage of ['headers','json']){
  const pending=[],savedRecovery=JSON.stringify(payload),h=workspaceHarness({pending:payload,state:{3:[current],5:false,7:detail,8:row},effects:true,fetcher:url=>new Promise(resolve=>pending.push({channel:url.includes('/api/documents?')?'list':'detail',resolve}))});
  const tree=h.render(),outputs=h.descendants(tree).filter(e=>e.type==='a'&&e.props.onClick),button=h.descendants(tree).find(e=>e.type==='button'&&e.props.children===row.title);button.props.onClick();
  const failure=pending.find(p=>p.channel===failureChannel),success=pending.find(p=>p.channel!==failureChannel);assert.ok(failure&&success);let jsonCalls=0,finishJson;
  const successData=success.channel==='list'?{actorId,documents:[current],page:0,nextPage:null}:detail;
  if(successStage==='json'){success.resolve({ok:true,status:200,json:()=>new Promise(resolve=>{finishJson=resolve;})});await settleRead();}
  failure.resolve(failureKind==='actor'?{ok:true,status:200,json:async()=>({actorId:id(99)})}:{ok:failureKind==='redirect',status:failureKind==='redirect'?200:Number(failureKind),redirected:failureKind==='redirect',json:async()=>{jsonCalls++;throw Error('non-JSON sign-in response');}});await settleRead();
  assert.equal(jsonCalls,0,'authentication status checked before JSON');
  if(successStage==='json')finishJson(successData);else success.resolve({ok:true,status:200,json:async()=>successData});await settleRead();
  assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[4],null);assert.equal(h.slots[5],false);assert.equal(h.slots[7],null);assert.equal(h.slots[8],null);assert.equal(h.slots[9],false);
  assert.ok(outputs.length>=3);for(const output of outputs){let prevented=false;output.props.onClick({preventDefault(){prevented=true;}});assert.equal(prevented,true,'stale CSV/text/print action is fenced');}
  assert.equal(JSON.stringify(payload),savedRecovery);assert.deepEqual(h.captured,[],'read failure never retries or clears mutation recovery');h.unmount();
 }
});
test('obsolete failures cannot fence a newer scope or a later current read',async()=>{
 const pending=[],h=workspaceHarness({state:{3:[current],5:false},effects:true,fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
 const button=h.descendants(h.render()).find(e=>e.type==='button'&&e.props.children===row.title);button.props.onClick();button.props.onClick();
 pending[2].resolve({ok:true,status:200,json:async()=>detail});await settleRead();assert.equal(h.slots[7].document.id,documentId);
 pending[1].resolve({ok:false,status:403,json:async()=>{throw Error('not JSON');}});await settleRead();assert.equal(h.slots[7].document.id,documentId,'obsolete detail denial does not clear newer selection');
 h.unmount();const nextScope={...scope,branchId:id(66)},nextCurrent={...current,branchId:nextScope.branchId};const next=workspaceHarness({scopeValue:nextScope,effects:true,fetcher:async()=>({ok:true,status:200,json:async()=>({actorId,documents:[nextCurrent],page:0,nextPage:null})})});next.render();await settleRead();assert.equal(next.slots[3][0].branchId,id(66));
 pending[0].resolve({ok:false,status:401,json:async()=>{throw Error('not JSON');}});await settleRead();assert.equal(next.slots[3][0].branchId,id(66),'unmounted scope failure cannot affect new scope');next.unmount();
});

test('shared read failure leaves verified mutation receipt handling independent',async()=>{let deny;const h=workspaceHarness({pending:payload,effects:true,fetcher:()=>new Promise(resolve=>{deny=resolve;})});const retry=h.descendants(h.render()).find(e=>e.type==='button'&&e.props.children==='Retry exact submitted request');retry.props.onClick();assert.deepEqual(h.captured,[null]);deny({ok:false,status:403,json:async()=>{throw Error('not JSON');}});await settleRead();assert.equal(h.callbacks.length,1);h.callbacks[0].saved(row);assert.match(h.slots[6],/Saved create at version 1/);assert.equal(h.slots[2],1);assert.equal(h.slots[7],null);h.unmount();});
test('mutation, retry and resolve authorization loss fence delayed document reads without changing frozen bytes',async()=>{
 for(const operation of ['submit','retry','resolve'])for(const kind of ['401','403','redirect','actor']){
  const reads=[],workspace=workspaceHarness({state:{3:[current],5:false},effects:true,fetcher:url=>new Promise(resolve=>reads.push({url,resolve}))});const button=workspace.descendants(workspace.render()).find(e=>e.type==='button'&&e.props.children===row.title);button.props.onClick();assert.equal(reads.length,2);
  let jsonCalls=0;const controller=harness({...(operation==='submit'?{}:{raw:envelope(payload)}),captureAuthorizationFailure:workspace.authorizationCallbacks[0],fetcher:async()=>kind==='actor'?{ok:true,status:200,json:async()=>({event:{...row,createdBy:id(99)}})}:{ok:kind==='redirect',status:kind==='redirect'?200:Number(kind),redirected:kind==='redirect',json:async()=>{jsonCalls++;throw Error('login is not JSON');}}});
  const before=operation==='submit'?envelope(input.documentRequest.parse(payload)):controller.storage.get(controller.key);let saved=0;
  if(operation==='resolve')await controller.render().abandon(()=>saved++,()=>{},()=>saved++);else await controller.render().run(operation==='submit'?payload:null,()=>saved++,()=>{});
  assert.equal(controller.authorizationFailures,1);assert.equal(saved,0);assert.equal(jsonCalls,0);assert.equal(controller.storage.get(controller.key),before);
  for(const read of reads)read.resolve({ok:true,status:200,json:async()=>read.url.includes('/api/documents?')?{actorId,documents:[current],page:0,nextPage:null}:detail});await settleRead();
  assert.deepEqual(workspace.slots[3],[]);assert.equal(workspace.slots[7],null);assert.equal(workspace.slots[8],null);assert.equal(workspace.slots[5],false);assert.equal(workspace.slots[9],false);workspace.unmount();controller.unmount();
 }
});
test('business conflicts and network errors retain pending data without revoking read epoch',async()=>{
 for(const kind of ['409','network']){let release;const workspace=workspaceHarness({effects:true,fetcher:()=>new Promise(resolve=>{release=resolve;})});workspace.render();const controller=harness({captureAuthorizationFailure:workspace.authorizationCallbacks[0],fetcher:async()=>{if(kind==='network')throw Error('offline');return {ok:false,status:409,json:async()=>({error:'Stale version'})};}});await controller.render().run(payload,()=>assert.fail(),()=>{});assert.equal(controller.authorizationFailures,0);assert.equal(controller.storage.size,1);release({ok:true,status:200,json:async()=>({actorId,documents:[current],page:0,nextPage:null})});await settleRead();assert.equal(workspace.slots[3][0].id,documentId);workspace.unmount();controller.unmount();}
});
test('obsolete mutation scope failures cannot notify current read authorization',async()=>{
 for(const change of ['actor','branch','unmount']){let release;const h=harness({fetcher:()=>new Promise(resolve=>{release=resolve;})});const pending=h.render().run(payload,()=>assert.fail(),()=>{}),raw=h.storage.get(h.key);if(change==='unmount')h.unmount();else h.identity(change==='actor'?id(99):actorId,change==='branch'?id(99):branchId);release({ok:false,status:403,json:async()=>{throw Error('not JSON');}});await pending;assert.equal(h.authorizationFailures,0);assert.equal(h.storage.get(h.key),raw);}
});
test('old same-scope mutation denial cannot invalidate a reauthenticated newer read epoch',async()=>{
 const reads=[],workspace=workspaceHarness({effects:true,fetcher:()=>new Promise(resolve=>reads.push(resolve))});workspace.render();let rejectMutation;const controller=harness({captureAuthorizationFailure:workspace.authorizationCallbacks[0],fetcher:()=>new Promise(resolve=>{rejectMutation=resolve;})});const mutation=controller.render().run(payload,()=>assert.fail(),()=>{}),frozen=controller.storage.get(controller.key);
 reads[0]({ok:false,status:403,json:async()=>{throw Error('not JSON');}});await settleRead();assert.deepEqual(workspace.slots[3],[]);
 workspace.render();assert.equal(reads.length,2);reads[1]({ok:true,status:200,json:async()=>({actorId,documents:[current],page:0,nextPage:null})});await settleRead();assert.equal(workspace.slots[3][0].id,documentId);
 rejectMutation({ok:false,status:401,json:async()=>{throw Error('not JSON');}});await mutation;assert.equal(controller.authorizationFailures,1);assert.equal(workspace.slots[3][0].id,documentId);assert.equal(controller.storage.get(controller.key),frozen);workspace.unmount();controller.unmount();
});
test('retained submit, retry and abandon handlers capture the epoch when each new attempt begins',async()=>{
 for(const operation of ['submit','retry','resolve']){
  const reads=[],workspace=workspaceHarness({effects:true,fetcher:()=>new Promise(resolve=>reads.push(resolve))});workspace.render();let denyMutation;const controller=harness({...(operation==='submit'?{}:{raw:envelope(payload)}),captureAuthorizationFailure:workspace.authorizationCallbacks[0],fetcher:()=>new Promise(resolve=>{denyMutation=resolve;})});const retained=controller.render();
  reads[0]({ok:false,status:403,json:async()=>{throw Error('not JSON');}});await settleRead();
  // No workspace rerender occurs between the fence and this retained handler's invocation.
  const attempt=operation==='resolve'?retained.abandon(()=>assert.fail(),()=>{},()=>assert.fail()):retained.run(operation==='submit'?payload:null,()=>assert.fail(),()=>{}),frozen=controller.storage.get(controller.key);
  workspace.render();reads[1]({ok:true,status:200,json:async()=>({actorId,documents:[current],page:0,nextPage:null})});await settleRead();assert.equal(workspace.slots[3][0].id,documentId);
  denyMutation({ok:false,status:401,json:async()=>{throw Error('not JSON');}});await attempt;assert.equal(controller.authorizationFailures,1);assert.deepEqual(workspace.slots[3],[],'new attempt captured epoch2 even through retained render callback');assert.equal(controller.storage.get(controller.key),frozen);workspace.unmount();controller.unmount();
 }
});
