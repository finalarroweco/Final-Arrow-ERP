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
const input = load('src/lib/manual-subscription-input.ts');
const directory = 'src/app/manual-subscriptions/';
const readInput = load(directory + 'read-input.ts', { '@/lib/manual-subscription-input': input });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorId = id(1), tenantId = id(2), companyId = id(3), subscriptionId = id(4), branchId = id(5);
const customerId = id(6), fields = { agreementReference: 'Agreement A', status: 'ACTIVE', startDate: '2024-02-29', endDate: null, nextReviewDate: '2026-12-01' };
const payload = { customerId, ...fields, tenantId, companyId, subscriptionId, branchId, expectedActorId: actorId, requestId: id(7), expectedVersion: 0, reason: 'Operating instructions', action: 'create', serviceLabel: 'Safety تشغيل', description: 'العربية English\n<script>alert(1)</script>\nhttps://example.test' };
const row = { customerId, customerBranchId: branchId, customerName: 'Customer', customerCode: 'C-1', reference: `SUB-${subscriptionId}`, ...fields, id: id(8), requestId: payload.requestId, tenantId, companyId, subscriptionId, branchId, version: 1, action: 'create', serviceLabel: payload.serviceLabel, description: payload.description, reason: payload.reason, archived: false, createdBy: actorId, createdAt: '2026-11-11T12:00:00.000Z' };
const current = { customerId, customerBranchId: branchId, customerName: row.customerName, customerCode: row.customerCode, reference: row.reference, ...fields, id: subscriptionId, tenantId, companyId, branchId, version: 1, serviceLabel: row.serviceLabel, description: row.description, archived: false, createdBy: actorId, createdAt: row.createdAt, updatedAt: row.createdAt };
const scope = { tenantId, companyId, branchId, label: 'Company / Branch', canManage: true };
const detail = { actorId, subscription: current, events: [row], page: 0, nextPage: null, canManage: true };
const envelope = request => JSON.stringify({ version: 1, actorId, request });
function browser() {
 const storage = new Map(), held = new Set();
 return { storage, locks: { async request(key, options, fn) { assert.equal(options.ifAvailable, true); if (held.has(key)) return fn(null); held.add(key); try { return await fn({ name: key }); } finally { held.delete(key); } } } };
}
function harness({ onAccessDenied = () => {}, captureAccessDenied, raw, fetcher = async () => { throw Error('network'); }, storageFails = false, removalFails = false, shared = browser(), locking = true } = {}) {
 const key = `erp-manual-subscription:v1:${actorId}:${tenantId}:${companyId}:${branchId}`, storage = shared.storage;
 if (raw !== undefined) storage.set(key, raw);
 const slots = [], listeners = new Set(); let index = 0, calls = 0, denials = 0, actor = actorId, branch = branchId;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn, deps) { const i = index++, value = JSON.stringify(deps); if (slots[i]?.deps !== value) { slots[i]?.cleanup?.(); slots[i] = { deps: value, cleanup: fn() }; } } };
 const mod = load(directory + 'request.ts', { react: hooks, '@/lib/manual-subscription-input': input }, { navigator: { locks: locking ? shared.locks : undefined }, window: { addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); } }, localStorage: { getItem: k => storage.get(k) ?? null, setItem(k, v) { if (storageFails) throw Error('blocked'); storage.set(k, v); }, removeItem: k => { if (!removalFails) storage.delete(k); } }, fetch(...args) { calls++; return fetcher(...args); } });
 const render = () => { index = 0; return mod.useSubscriptionRequest(actor, tenantId, companyId, branch, () => { const notify = captureAccessDenied ? captureAccessDenied() : onAccessDenied; return () => { denials++; notify(); }; }); }; render();
 return { render, storage, key, get calls() { return calls; }, get denials() { return denials; }, event(eventKey = key) { listeners.forEach(fn => fn({ key: eventKey })); }, identity(nextActor, nextBranch = branchId) { actor = nextActor; branch = nextBranch; render(); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
test('subscription captures hydrate without writes and malformed or actor/scope substitutions remain blocked', () => {
 for (const raw of ['broken', envelope({ ...payload, branchId: id(99) }), JSON.stringify({ version: 1, actorId: id(9), request: payload }), envelope({ ...payload, expectedActorId: id(99) })]) {
  const h = harness({ raw }); assert.equal(h.render().blocked, true); assert.equal(h.render().pending, null); assert.equal(h.storage.get(h.key), raw); assert.equal(h.calls, 0);
 }
 const h = harness({ raw: envelope(payload) }); assert.deepEqual(h.render().pending, payload); assert.equal(h.calls, 0);
});
test('network errors and all HTTP failures retain exact subscription request for explicit same-description retry', async () => {
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
test('unknown and malformed successful responses do not clear pending subscription requests', async () => {
 for (const data of [{}, { event: {} }, { event: { ...row, createdBy: id(99) } }, { event: { ...row, branchId: id(99) } }, { event: { ...row, description: 'different' } }, { event: { ...row, version: 2 } }]) {
  const h = harness({ fetcher: async () => ({ ok: true, json: async () => data }) }); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.size, 1);
 }
 const h = harness({ fetcher: async () => ({ ok: true, json: async () => { throw Error('malformed JSON'); } }) }); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.size, 1);
});
test('verified subscription clears only its own exact capture, and failed removal remains unresolved', async () => {
 for (const removalFails of [false, true]) {
  const h = harness({ removalFails, fetcher: async () => ({ ok: true, json: async () => ({ event: row }) }) }); let saved = 0;
  await h.render().run(payload, () => saved++, () => {}); assert.equal(saved, removalFails ? 0 : 1); assert.equal(h.storage.size, removalFails ? 1 : 0);
 }
});
test('check-and-abandon clears only a matching tombstone; unknown outcomes remain retained', async () => {
 const cancellation = { customerId, id: payload.requestId, tenantId, companyId, branchId, subscriptionId, createdBy: actorId, createdAt: row.createdAt, request: payload };
 for (const data of [{}, { cancellation: { ...cancellation, createdBy: id(99) } }, { cancellation }]) {
  let abandoned = 0; const h = harness({ raw: envelope(payload), fetcher: async (url, options) => { assert.equal(url, '/api/manual-subscriptions/resolve'); assert.deepEqual(JSON.parse(options.body), payload); return { ok: true, json: async () => data }; } });
  await h.render().abandon(() => assert.fail(), () => {}, () => abandoned++); const valid = data.cancellation?.createdBy === actorId;
  assert.equal(abandoned, valid ? 1 : 0); assert.equal(h.storage.size, valid ? 0 : 1);
 }
});
test('abandonment discovers an already recorded subscription without claiming cancellation', async () => {
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
 assert.deepEqual(readInput.verifiedSubscriptionDetail(detail, scope, subscriptionId, 0, actorId), detail);
 for (const patch of [{ description: 'tampered' }, { serviceLabel: 'tampered' }, { archived: true }, { version: 2 }, { branchId: null }, { id: id(99) }, { tenantId: id(99) }]) assert.equal(readInput.verifiedSubscriptionDetail({ ...detail, subscription: { ...current, ...patch } }, scope, subscriptionId, 0, actorId), null);
 for (const patch of [{ subscriptionId: id(99) }, { branchId: null }, { tenantId: id(99) }, { description: 'tampered' }, { version: 2 }]) assert.equal(readInput.verifiedSubscriptionDetail({ ...detail, events: [{ ...row, ...patch }] }, scope, subscriptionId, 0, actorId), null);
 assert.equal(readInput.verifiedSubscriptionDetail({ ...detail, nextPage: 2 }, scope, subscriptionId, 0, actorId), null);
 assert.equal(readInput.verifiedSubscriptionDetail({ ...detail, events: [] }, scope, subscriptionId, 0, actorId), null);
 assert.equal(readInput.verifiedSubscriptionDetail({ ...detail, events: [row, row] }, scope, subscriptionId, 0, actorId), null);
 assert.equal(readInput.verifiedSubscriptionDetail({ ...detail, events: Array(51).fill(row) }, scope, subscriptionId, 0, actorId), null);
 const unicode = '😀'.repeat(200), {description: _description, ...metadata} = current; assert.ok(readInput.subscriptionMetadata.safeParse({ ...metadata, serviceLabel: unicode }).success);
});
test('all explicit action payloads retain independent subscription and request identities through retries', async () => {
 for (const action of ['create', 'edit', 'archive', 'restore']) {
  const request = action === 'create' ? payload : action === 'edit' ? { ...payload, action, expectedVersion: 12 } : { customerId, tenantId, companyId, branchId, subscriptionId, requestId: id(30), expectedActorId: actorId, expectedVersion: 12, action, reason: 'Explicit lifecycle reason' };
  const sent = [], h = harness({ fetcher: async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: false, json: async () => ({}) }; } });
  await h.render().run(request, () => assert.fail(), () => {}); await h.render().run(null, () => assert.fail(), () => {}); await h.render().abandon(() => assert.fail(), () => {}, () => assert.fail());
  assert.equal(sent.length, 3); for (const actual of sent) assert.deepEqual(actual, request);
 }
});
const localeModule = load('src/lib/locale.ts');
function workspaceHarness({ state = {}, scopeValue = scope, locale = 'en', pending = null, blocked = false, fetcher = async () => ({ ok: false, json: async () => ({}) }), effects = false } = {}) {
 const slots = [], refs = [], captured = [], cleanups = []; let index = 0, refIndex = 0, requestCaptureAccessDenied;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = Object.hasOwn(state, i) ? state[i] : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; }, useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial }; }, useEffect(fn) { if (effects) cleanups.push(fn()); }, useCallback(fn) { return fn; } };
 const mod = load(directory + 'workspace.tsx', { react: hooks, '@/lib/locale': localeModule, '@/lib/manual-subscription-input': input, './request': { useSubscriptionRequest: (...args) => { requestCaptureAccessDenied = args[4]; return ({ ready: true, blocked: blocked || !!pending, busy: false, pending, run: async request => captured.push(request), abandon: async () => {} }); } }, './read-input': readInput, './customer-picker': { CustomerPicker: () => React.createElement('input', {name: 'customerId'}) } }, { fetch: fetcher, crypto: { randomUUID: (() => { let n = 90; return () => id(n++); })() }, FormData: class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } } });
 function descendants(element) { return [element, ...React.Children.toArray(element?.props?.children).flatMap(child => React.isValidElement(child) ? descendants(child) : [])]; }
 return { mod, captured, descendants, slots, // Test-only recovery simulation: production requires refresh/sign-in and remounts. Preserve the advanced epoch while restoring the same actor/scope read state.
 simulateSameActorReadRecovery() { slots[10] = false; refs[2].current = false; }, get requestCaptureAccessDenied() { return requestCaptureAccessDenied; }, get requestAccessDenied() { return () => requestCaptureAccessDenied()(); }, render() { index = 0; refIndex = 0; return mod.SubscriptionScopeWorkspace({ actorId, scope: scopeValue, locale }); }, submit(form, values) { form.props.onSubmit({ preventDefault() {}, currentTarget: { values } }); }, unmount() { cleanups.forEach(fn => fn?.()); } };
}
test('Arabic and English renders treat script, URL, and mixed direction content as literal plain text', () => {
 for (const locale of ['en', 'ar']) {
  const h = workspaceHarness({ locale, state: { 7: detail, 8: row } }), html = renderToStaticMarkup(h.render());
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;')); assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('https://example.test')); assert.ok(!html.includes('href="https://example.test"'));
  assert.ok(html.includes('white-space:pre-wrap')); assert.ok(html.includes('unicode-bidi:plaintext'));
  assert.ok(html.includes(`/api/manual-subscriptions/${subscriptionId}/export?`)); assert.ok(html.includes(`eventId=${row.id}`));
  assert.ok(html.includes(locale === 'en' ? 'This storage is not encrypted' : 'التخزين غير مشفر'));
 }
});
test('scope choice starts unselected and explains company-wide audience and explicit limits', () => {
 const h = workspaceHarness();
 const html = renderToStaticMarkup(h.mod.SubscriptionsWorkspace({ actorId, options: [scope], locale: 'en' }));
 assert.ok(html.includes('not private to their author')); assert.ok(html.includes('No billing')); assert.ok(html.includes('Scope and customer cannot change'));
 assert.ok(!html.includes('name="serviceLabel"')); assert.ok(html.includes('value="" selected=""'));
});
test('create and edit forms bind actor, immutable scope and expected version; reasons never default', () => {
 const h = workspaceHarness({ state: { 7: detail, 8: row } }), forms = h.descendants(h.render()).filter(e => e.type === 'form');
 assert.equal(forms.length, 4);
 h.submit(forms[0], { customerId, ...fields, serviceLabel: 'Explicit serviceLabel', description: 'Explicit description', reason: 'Explicit create', tenantId: id(99), branchId: id(99), expectedVersion: 99 });
 h.submit(forms[2], { ...fields, serviceLabel: 'Next serviceLabel', description: 'Next description', reason: 'Explicit edit', subscriptionId: id(99), expectedVersion: 99 });
 h.submit(forms[3], { reason: 'Explicit archive', description: 'ignored', serviceLabel: 'ignored' });
 assert.equal(h.captured.length, 3);
 assert.deepEqual(h.captured[0], input.subscriptionRequest.parse({ customerId, ...fields, tenantId, companyId, branchId, expectedActorId: actorId, requestId: id(90), subscriptionId: id(91), expectedVersion: 0, action: 'create', serviceLabel: 'Explicit serviceLabel', description: 'Explicit description', reason: 'Explicit create' }));
 assert.equal(h.captured[1].subscriptionId, subscriptionId); assert.equal(h.captured[1].expectedVersion, 1); assert.equal(h.captured[1].branchId, branchId);
 assert.equal(h.captured[2].action, 'archive'); assert.equal(h.captured[2].expectedVersion, 1); assert.ok(!('description' in h.captured[2]));
 const reasonHtml = renderToStaticMarkup(forms[0]); assert.ok(reasonHtml.includes('name="reason"')); assert.ok(!reasonHtml.includes('value="Explicit'));
});
test('read-only scopes and unresolved requests cannot submit; archived restore has no text inputs', () => {
 for (const options of [{ blocked: true }, { pending: payload }]) {
  const h = workspaceHarness(options), form = h.descendants(h.render()).find(e => e.type === 'form'); h.submit(form, { serviceLabel: 'Title', description: 'Body', reason: 'Reason' }); assert.equal(h.captured.length, 0);
 }
 const readOnly = workspaceHarness({ scopeValue: { ...scope, canManage: false }, state: { 7: { ...detail, canManage: false }, 8: row } });
 const readOnlyHtml = renderToStaticMarkup(readOnly.render()); assert.ok(!readOnlyHtml.includes('name="reason"')); assert.ok(!readOnlyHtml.includes('name="description"'));
 const archived = workspaceHarness({ state: { 7: { ...detail, subscription: { ...current, version: 2, archived: true } }, 8: row } }), forms = archived.descendants(archived.render()).filter(e => e.type === 'form'), restore = forms[2];
 assert.equal(forms.length, 3); const restoreHtml = renderToStaticMarkup(restore); assert.ok(!restoreHtml.includes('name="description"')); assert.ok(restoreHtml.includes('Restore keeps current metadata unchanged'));
 archived.submit(restore, { reason: 'Explicit restore', description: 'ignored' }); assert.equal(archived.captured[0].action, 'restore'); assert.equal(archived.captured[0].expectedVersion, 2); assert.ok(!('description' in archived.captured[0]));
});
test('out-of-order detail and close responses cannot expose stale history', async () => {
 const pending = [], h = workspaceHarness({ state: { 3: [{ ...current }, { ...current, id: id(40) }], 5: false }, effects: true, fetcher: async url => url.includes('/api/manual-subscriptions?') ? { ok: false, json: async () => ({}) } : new Promise(resolve => pending.push({ url, resolve })) });
 const buttons = h.descendants(h.render()).filter(e => e.type === 'button' && Array.isArray(e.props.children) && e.props.children[0] === row.serviceLabel);
 buttons[0].props.onClick(); buttons[1].props.onClick(); assert.equal(pending.length, 2);
 pending[1].resolve({ ok: true, json: async () => ({ ...detail, subscription: { ...current, id: id(40), reference: `SUB-${id(40)}` }, events: [{ ...row, subscriptionId: id(40), reference: `SUB-${id(40)}` }] }) }); await new Promise(resolve => setImmediate(resolve));
 assert.equal(h.slots[7].subscription.id, id(40));
 pending[0].resolve({ ok: true, json: async () => detail }); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.slots[7].subscription.id, id(40));
 const close = h.descendants(h.render()).find(e => e.type === 'button' && e.props.children === 'Close subscription');
 buttons[0].props.onClick(); assert.equal(pending.length, 3); close.props.onClick();
 pending[2].resolve({ ok: true, json: async () => detail }); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.slots[7], null); assert.equal(h.slots[8], null);
 h.unmount();
});
test('subscription snapshots reject changed customer identity, reference, status and calendar fields', () => {
 for (const patch of [{ customerId: id(99) }, { customerBranchId: null }, { customerName: 'Other customer' }, { customerCode: 'other' }, { reference: 'other' }, { status: 'PAUSED' }, { startDate: null }, { endDate: '2026-12-01' }, { nextReviewDate: null }, { agreementReference: 'Other agreement' }]) {
  assert.equal(readInput.verifiedSubscriptionDetail({ ...detail, events: [{ ...row, ...patch }] }, scope, subscriptionId, 0, actorId), null);
 }
});
test('explicit date clearing and status change preserve source identity on edit', () => {
 const h = workspaceHarness({ state: { 7: detail, 8: row } }), forms = h.descendants(h.render()).filter(e => e.type === 'form');
 h.submit(forms[2], { customerId: id(99), serviceLabel: 'New service label', description: '', agreementReference: '', status: 'PAUSED', startDate: '', endDate: '', nextReviewDate: '', reason: 'Correct recorded information' });
 assert.equal(h.captured.length, 1); const sent = h.captured[0];
 assert.equal(sent.customerId, customerId); assert.equal(sent.status, 'PAUSED'); assert.equal(sent.description, ''); assert.equal(sent.agreementReference, '');
 for (const field of ['startDate', 'endDate', 'nextReviewDate']) assert.equal(sent[field], null);
});
test('largest escaped description is frozen and transmitted without truncation for retry and resolution', async () => {
 const large = { ...payload, description: '\u0001'.repeat(65536) }, sent = [];
 const h = harness({ fetcher: async (_url, options) => { sent.push(options.body); return { ok: false, json: async () => ({}) }; } });
 await h.render().run(large, () => assert.fail(), () => {}); await h.render().run(null, () => assert.fail(), () => {}); await h.render().abandon(() => assert.fail(), () => {}, () => assert.fail());
 assert.equal(sent.length, 3); assert.ok(Buffer.byteLength(sent[0]) < input.SUBSCRIPTION_REQUEST_MAX_BYTES); for (const body of sent) assert.equal(JSON.parse(body).description, large.description);
});
function pickerHarness(fetcher, fence = { current: 0 }, externalDenied = () => {}, externalCurrent = null) {
 let denied = 0; const onAccessDenied = () => { denied++; fence.current++; externalDenied(); }; const isReadCurrent = externalCurrent ?? (epoch => fence.current === epoch);
 const slots = [], effects = []; let index = 0; const pendingEffects = [];
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value]; }, useEffect(fn, deps) { const i = index++, key = JSON.stringify(deps); if (effects[i]?.key !== key) { effects[i]?.cleanup?.(); effects[i] = { key, cleanup: null }; pendingEffects.push(() => effects[i].cleanup = fn()); } } };
 const mod = load(directory + 'customer-picker.tsx', { react: hooks, '@/lib/locale': localeModule, './read-input': readInput }, { fetch: fetcher });
 const descendants = element => [element, ...React.Children.toArray(element?.props?.children).flatMap(child => React.isValidElement(child) ? descendants(child) : [])];
 return { slots, descendants, get denied() { return denied; }, render() { index = 0; const tree = mod.CustomerPicker({actorId, onAccessDenied, readEpoch: fence, isReadCurrent, scope, locale: 'en'}); pendingEffects.splice(0).forEach(fn => fn()); return tree; }, unmount() { effects.forEach(effect => effect?.cleanup?.()); } };
}
test('customer picker validates pagination, keeps explicit selection and fences older search responses', async () => {
 const pending = [], h = pickerHarness(url => new Promise(resolve => pending.push({url, resolve}))), first = {id: customerId, name: '<script>Literal</script>', code: 'C-1'};
 h.render(); assert.equal(pending.length, 1); assert.ok(pending[0].url.includes(`branchId=${branchId}`));
 pending[0].resolve({ok:true,json:async()=>({actorId,customers:[first],page:0,nextPage:1})}); await new Promise(resolve=>setImmediate(resolve));
 let nodes=h.descendants(h.render()); const choose=nodes.find(e=>e.type==='select');choose.props.onChange({target:{value:customerId}});
 nodes=h.descendants(h.render());assert.equal(nodes.find(e=>e.type==='input'&&e.props.name==='customerId').props.value,customerId);
 const html=renderToStaticMarkup(h.render());assert.ok(html.includes('&lt;script&gt;Literal&lt;/script&gt;'));assert.ok(!html.includes('<script>'));
 nodes.find(e=>e.type==='button'&&e.props.children==='More customers').props.onClick();h.render();assert.ok(pending[1].url.includes('page=1'));
 h.slots[0]='new';nodes=h.descendants(h.render());nodes.find(e=>e.type==='button'&&e.props.children==='Find customers').props.onClick();h.render();assert.ok(pending[2].url.includes('q=new'));
 pending[2].resolve({ok:true,json:async()=>({actorId,customers:[],page:0,nextPage:null})});await new Promise(resolve=>setImmediate(resolve));
 pending[1].resolve({ok:true,json:async()=>({actorId,customers:[{id:id(99),name:'Stale customer',code:'STALE'}],page:1,nextPage:null})});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[4].id,customerId);h.unmount();
});
test('customer picker rejects oversized, malformed and contact-bearing responses', async () => {
 for(const response of [{actorId,customers:[{id:customerId,name:'Customer',code:'C',email:'private@example.test'}],page:0,nextPage:null},{actorId,customers:[],page:1,nextPage:null},{actorId,customers:[],page:0,nextPage:9},{actorId,customers:Array(51).fill({id:customerId,name:'Customer',code:'C'}),page:0,nextPage:1}]) {
  const h=pickerHarness(async()=>({ok:true,json:async()=>response}));h.render();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.slots[7],true);assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[4],null);h.unmount();
 }
});
test('all list, detail, CSV, text and print reads bind the mounted actor', async () => {
 const requested = [], h = workspaceHarness({ state: { 3: [current], 5: false, 7: detail, 8: row }, effects: true, fetcher: async url => { requested.push(url); return {ok:false,status:500,json:async()=>({})}; } });
 const tree = h.render(), nodes = h.descendants(tree), links = nodes.filter(e=>e.type==='a');
 assert.equal(links.length, 3);
 for (const link of links) assert.equal(new URL(link.props.href,'https://example.test').searchParams.get('expectedActorId'),actorId);
 nodes.find(e=>e.type==='button'&&Array.isArray(e.props.children)&&e.props.children[0]===row.serviceLabel).props.onClick();
 await new Promise(resolve=>setImmediate(resolve)); assert.equal(requested.length,2);
 for (const url of requested) assert.equal(new URL(url,'https://example.test').searchParams.get('expectedActorId'),actorId);
 h.unmount();
});
test('account switch denial from list or detail clears old records and blocks late successful reads', async () => {
 for (const denying of ['list','detail']) {
  const pending=[], h=workspaceHarness({state:{3:[current],5:false,7:detail,8:row},effects:true,fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
  const nodes=h.descendants(h.render()); nodes.find(e=>e.type==='button'&&Array.isArray(e.props.children)&&e.props.children[0]===row.serviceLabel).props.onClick();
  const denied=pending[denying==='list'?0:1],late=pending[denying==='list'?1:0];
  denied.resolve({ok:false,status:403,json:async()=>assert.fail('Denied response data must not be consumed')});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[7],null);assert.equal(h.slots[8],null);assert.equal(h.slots[10],true);
  late.resolve({ok:true,status:200,json:async()=>denying==='list'?detail:{actorId,subscriptions:[current],page:0,nextPage:null}});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[7],null);assert.equal(h.slots[8],null);
  const html=renderToStaticMarkup(h.render());assert.ok(html.includes('Refresh this page or sign in again'));assert.ok(!html.includes('<form'));assert.ok(!html.includes(row.serviceLabel));h.unmount();
 }
});
test('customer picker actor-switch denial clears selection and reports to its workspace', async () => {
 let resolve;const h=pickerHarness(url=>{assert.equal(new URL(url,'https://example.test').searchParams.get('expectedActorId'),actorId);return new Promise(done=>resolve=done);});
 h.slots[4]={id:customerId,name:'Prior customer',code:'OLD'};h.render();
 resolve({ok:false,status:403,json:async()=>assert.fail('Denied response data must not be consumed')});await new Promise(done=>setImmediate(done));
 assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[4],null);assert.equal(h.denied,1);h.unmount();
});
test('AR/EN abandonment notice explains persistent source constraints', () => {
 for(const locale of ['en','ar']) {
  const h=workspaceHarness({locale,pending:payload}),html=renderToStaticMarkup(h.render());
  assert.ok(html.includes(locale==='en'?'Even permanently abandoned requests retain customer identity and scope constraints':'حتى الطلبات الملغاة نهائيًا تحتفظ بقيود هوية العميل ونطاقه'));
 }
});
test('subscription-only roles may combine independent customer access grants', () => {
 const labels=load('src/lib/permission-labels.ts',{'./locale':localeModule});
 assert.deepEqual(labels.requiredReads('subscription:read',['subscription:read','customer:read']),['subscription:read']);
 assert.ok(!labels.requiredReads('subscription:manage',['subscription:read','customer:read']).includes('customer:read'));
});
test('picker denial fences detail waiting for JSON and retained native output callbacks', async () => {
 let detailJson;
 const h=workspaceHarness({state:{3:[current],5:false,7:detail,8:row},effects:true,fetcher:async url=>url.includes('/api/manual-subscriptions?')?new Promise(()=>{}):{ok:true,status:200,json:()=>new Promise(resolve=>detailJson=resolve)}});
 const nodes=h.descendants(h.render()), props=nodes.find(e=>e.props?.readEpoch)?.props, links=nodes.filter(e=>e.type==='a');
 assert.ok(props);assert.equal(links.length,3);
 for(const link of links)link.props.onClick({preventDefault:()=>assert.fail('Current links remain available')});
 nodes.find(e=>e.type==='button'&&Array.isArray(e.props.children)&&e.props.children[0]===row.serviceLabel).props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.ok(detailJson);
 const picker=pickerHarness(async()=>({ok:false,status:403,json:async()=>assert.fail('Non-JSON denial must not be parsed')}),props.readEpoch,props.onAccessDenied,props.isReadCurrent);
 picker.render();await new Promise(resolve=>setImmediate(resolve));
 detailJson(detail);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.slots[7],null);assert.equal(h.slots[8],null);assert.equal(h.slots[9],false);assert.equal(h.slots[10],true);assert.equal(picker.slots[6],false);
 for(const link of links){let prevented=false;link.props.onClick({preventDefault:()=>prevented=true});assert.ok(prevented,'A retained link cannot start CSV/text/print after known denial');}
 picker.unmount();h.unmount();
});
test('register and detail 401/403 fence picker JSON success and obsolete picker failure before unmount', async () => {
 for(const channel of ['register','detail']) for(const status of [401,403]) for(const outcome of ['success','denial']) {
  let registerResponse,detailResponse,pickerResponse,pickerJson;
  const h=workspaceHarness({state:{3:[current],5:false},effects:true,fetcher:async url=>url.includes('/api/manual-subscriptions?')?new Promise(resolve=>registerResponse=resolve):new Promise(resolve=>detailResponse=resolve)});
  const nodes=h.descendants(h.render()),props=nodes.find(e=>e.props?.readEpoch)?.props;
  const picker=pickerHarness(()=>new Promise(resolve=>pickerResponse=resolve),props.readEpoch,props.onAccessDenied,props.isReadCurrent);picker.render();
  if(outcome==='success'){pickerResponse({ok:true,status:200,json:()=>new Promise(resolve=>pickerJson=resolve)});await new Promise(resolve=>setImmediate(resolve));}
  nodes.find(e=>e.type==='button'&&Array.isArray(e.props.children)&&e.props.children[0]===row.serviceLabel).props.onClick();
  (channel==='register'?registerResponse:detailResponse)({ok:false,status,json:async()=>assert.fail('Non-JSON denial must not be parsed')});await new Promise(resolve=>setImmediate(resolve));const epoch=props.readEpoch.current;
  if(outcome==='success')pickerJson({actorId,customers:[{id:customerId,name:'Stale customer',code:'STALE'}],page:0,nextPage:null});
  else pickerResponse({ok:false,status:403,json:async()=>assert.fail('Obsolete denial must not be parsed')});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(picker.slots[3],[]);assert.equal(picker.slots[4],null);assert.equal(picker.denied,0);assert.equal(props.readEpoch.current,epoch);assert.equal(h.slots[10],true);
  picker.unmount();h.unmount();
 }
});
test('unmounted scope failures cannot invalidate a new scope or start retained native output', async () => {
 let oldResponse;const old=workspaceHarness({state:{3:[current],5:false,7:detail,8:row},effects:true,fetcher:()=>new Promise(resolve=>oldResponse=resolve)});
 const nodes=old.descendants(old.render()),props=nodes.find(e=>e.props?.readEpoch)?.props,oldLinks=nodes.filter(e=>e.type==='a');
 let pickerResponse;const picker=pickerHarness(()=>new Promise(resolve=>pickerResponse=resolve),props.readEpoch,props.onAccessDenied,props.isReadCurrent);picker.render();
 old.unmount();picker.unmount();const fresh=workspaceHarness({scopeValue:{...scope,branchId:id(99)},effects:true,fetcher:()=>new Promise(()=>{})});fresh.render();
 oldResponse({ok:false,status:403,json:async()=>assert.fail()});pickerResponse({ok:false,status:403,json:async()=>assert.fail()});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(old.slots[10],false);assert.equal(fresh.slots[10],false);assert.equal(picker.denied,0);
 for(const link of oldLinks){let prevented=false;link.props.onClick({preventDefault:()=>prevented=true});assert.ok(prevented);}
 fresh.unmount();
});
test('missing or mismatched actor receipts invalidate every read channel before consuming private rows', async () => {
 for(const channel of ['register','detail','picker']) for(const receipt of [undefined,id(99),null]) {
  const json={}, h=workspaceHarness({state:{3:[current],5:false,7:detail,8:row},effects:true,fetcher:async url=>({ok:true,status:200,json:()=>new Promise(resolve=>json[url.includes('/api/manual-subscriptions?')?'register':'detail']=resolve)})});
  const nodes=h.descendants(h.render()),props=nodes.find(e=>e.props?.readEpoch)?.props;
  nodes.find(e=>e.type==='button'&&Array.isArray(e.props.children)&&e.props.children[0]===row.serviceLabel).props.onClick();
  const picker=pickerHarness(async()=>({ok:true,status:200,json:()=>new Promise(resolve=>json.picker=resolve)}),props.readEpoch,props.onAccessDenied,props.isReadCurrent);picker.render();
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(Object.keys(json).sort(),['detail','picker','register']);
  const bad={actorId:receipt};Object.defineProperty(bad,channel==='register'?'subscriptions':channel==='detail'?'subscription':'customers',{get:()=>assert.fail('Actor receipt must be checked before private content')});
  json[channel](bad);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.slots[10],true);assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[7],null);assert.equal(h.slots[8],null);assert.equal(h.slots[5],false);assert.equal(h.slots[9],false);
  for(const other of ['register','detail','picker'].filter(value=>value!==channel))json[other](other==='detail'?detail:other==='register'?{actorId,subscriptions:[current],page:0,nextPage:null}:{actorId,customers:[{id:customerId,name:'Stale customer',code:'STALE'}],page:0,nextPage:null});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[7],null);assert.equal(h.slots[8],null);assert.deepEqual(picker.slots[3],[]);assert.equal(picker.slots[4],null);
  picker.unmount();h.unmount();
 }
});
test('obsolete detail and picker JSON actor mismatches cannot invalidate newer reads', async () => {
 const pending=[],h=workspaceHarness({state:{3:[current,{...current,id:id(40)}],5:false},effects:true,fetcher:async url=>url.includes('/api/manual-subscriptions?')?new Promise(()=>{}):{ok:true,status:200,json:()=>new Promise(resolve=>pending.push(resolve))}});
 const nodes=h.descendants(h.render()),buttons=nodes.filter(e=>e.type==='button'&&Array.isArray(e.props.children)&&e.props.children[0]===row.serviceLabel),props=nodes.find(e=>e.props?.readEpoch)?.props;
 buttons[0].props.onClick();await new Promise(resolve=>setImmediate(resolve));buttons[1].props.onClick();await new Promise(resolve=>setImmediate(resolve));
 pending[1]({...detail,subscription:{...current,id:id(40),reference:`SUB-${id(40)}`},events:[{...row,subscriptionId:id(40),reference:`SUB-${id(40)}`}]});await new Promise(resolve=>setImmediate(resolve));
 pending[0]({actorId:id(99)});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.slots[10],false);assert.equal(h.slots[7].subscription.id,id(40));
 const pickerJson=[],picker=pickerHarness(async()=>({ok:true,status:200,json:()=>new Promise(resolve=>pickerJson.push(resolve))}),props.readEpoch,props.onAccessDenied,props.isReadCurrent);
 picker.render();await new Promise(resolve=>setImmediate(resolve));picker.slots[1]='new search';picker.render();await new Promise(resolve=>setImmediate(resolve));
 pickerJson[1]({actorId,customers:[{id:customerId,name:'Current customer',code:'CURRENT'}],page:0,nextPage:null});await new Promise(resolve=>setImmediate(resolve));
 pickerJson[0]({});await new Promise(resolve=>setImmediate(resolve));assert.equal(picker.denied,0);assert.equal(h.slots[10],false);assert.equal(picker.slots[3][0].name,'Current customer');picker.unmount();h.unmount();
});
test('detail and list envelopes require the actual authenticated actor', () => {
 assert.equal(readInput.subscriptionActorMatches({actorId},actorId),true);
 for(const actor of [undefined,id(99),'invalid']) {
  assert.equal(readInput.subscriptionActorMatches({actorId:actor},actorId),false);
  assert.equal(readInput.verifiedSubscriptionDetail({...detail,actorId:actor},scope,subscriptionId,0,actorId),null);
 }
 const {description: _description,...metadata}=current;
 assert.ok(readInput.subscriptionList.safeParse({actorId,subscriptions:[metadata],page:0,nextPage:null}).success);
 assert.equal(readInput.subscriptionList.safeParse({subscriptions:[metadata],page:0,nextPage:null}).success,false);
});
const authFailure = signal => signal === 'redirect' ? {ok:true,status:200,redirected:true,url:'https://erp.example.test/login?next=%2Fmanual-subscriptions',json:async()=>assert.fail('Login HTML must not be parsed')} : signal === 'code' ? {ok:false,status:409,json:async()=>({code:'ACTOR_MISMATCH'})} : signal === 'nested-code' ? {ok:false,status:409,json:async()=>({error:{code:'ACTOR_MISMATCH'}})} : {ok:false,status:signal,json:async()=>assert.fail('Non-JSON auth denial must not be parsed')};
const performRequest = (controller, operation, saved = () => assert.fail()) => operation === 'resolve' ? controller.abandon(saved,()=>{},()=>assert.fail()) : controller.run(operation === 'submit' ? payload : null,saved,()=>{});
test('submit, retry and resolve auth loss fence delayed reads while preserving exact pending bytes', async () => {
 for(const operation of ['submit','retry','resolve']) for(const signal of [401,403,'redirect','code','nested-code']) {
  const json={},h=workspaceHarness({state:{3:[current],5:false,7:detail,8:row},effects:true,fetcher:async url=>({ok:true,status:200,json:()=>new Promise(resolve=>json[url.includes('/api/manual-subscriptions?')?'register':'detail']=resolve)})});
  const nodes=h.descendants(h.render()),props=nodes.find(e=>e.props?.readEpoch)?.props;
  nodes.find(e=>e.type==='button'&&Array.isArray(e.props.children)&&e.props.children[0]===row.serviceLabel).props.onClick();
  const picker=pickerHarness(async()=>({ok:true,status:200,json:()=>new Promise(resolve=>json.picker=resolve)}),props.readEpoch,props.onAccessDenied,props.isReadCurrent);picker.render();await new Promise(resolve=>setImmediate(resolve));
  let frozen;const mutation=harness({raw:operation==='submit'?undefined:envelope(payload),captureAccessDenied:h.requestCaptureAccessDenied,fetcher:async()=>{frozen=mutation.storage.get(mutation.key);return authFailure(signal);}});
  await performRequest(mutation.render(),operation);assert.equal(mutation.denials,1);assert.equal(mutation.storage.get(mutation.key),frozen);assert.equal(h.slots[10],true);
  json.register({actorId,subscriptions:[current],page:0,nextPage:null});json.detail(detail);json.picker({actorId,customers:[{id:customerId,name:'Late customer',code:'LATE'}],page:0,nextPage:null});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[7],null);assert.equal(h.slots[8],null);assert.deepEqual(picker.slots[3],[]);assert.equal(picker.slots[4],null);assert.equal(mutation.storage.get(mutation.key),frozen);
  mutation.unmount();picker.unmount();h.unmount();
 }
});
test('ordinary conflicts, network failure and unrelated redirects retain pending without authentication invalidation', async () => {
 for(const operation of ['submit','retry','resolve']) for(const outcome of ['network','conflict','redirect']) {
  const h=harness({raw:operation==='submit'?undefined:envelope(payload),fetcher:async()=>{if(outcome==='network')throw Error('network');return {ok:false,status:409,redirected:outcome==='redirect',url:'https://erp.example.test/unrelated',json:async()=>({code:'VERSION_CONFLICT'})};}});
  await performRequest(h.render(),operation);assert.equal(h.denials,0);assert.ok(h.storage.get(h.key));h.unmount();
 }
});
test('obsolete mutation auth failures cannot invalidate a different actor or scope, including delayed JSON codes', async () => {
 for(const operation of ['submit','retry','resolve']) for(const change of ['actor','scope']) for(const afterJson of [false,true]) {
  let release,releaseJson;const h=harness({raw:operation==='submit'?undefined:envelope(payload),fetcher:()=>new Promise(resolve=>release=resolve)}),running=performRequest(h.render(),operation);
  const frozen=h.storage.get(h.key);
  if(afterJson){release({ok:false,status:409,json:()=>new Promise(resolve=>releaseJson=resolve)});await new Promise(resolve=>setImmediate(resolve));}
  h.identity(change==='actor'?id(99):actorId,change==='scope'?id(98):branchId);
  if(afterJson)releaseJson({code:'ACTOR_MISMATCH'});else release(authFailure(403));await running;
  assert.equal(h.denials,0);assert.equal(h.storage.get(h.key),frozen);h.unmount();
 }
});
test('known read access loss does not erase pending bytes or discard an exact verified committed mutation', async () => {
 const h=workspaceHarness({state:{7:detail,8:row},effects:true,fetcher:()=>new Promise(()=>{})});h.render();let release,saved=0;
 const mutation=harness({raw:envelope(payload),captureAccessDenied:h.requestCaptureAccessDenied,fetcher:()=>new Promise(resolve=>release=resolve)});
 const running=mutation.render().run(null,()=>saved++,()=>assert.fail());h.requestAccessDenied();assert.equal(mutation.storage.get(mutation.key),envelope(payload));
 release({ok:true,status:200,json:async()=>({event:row})});await running;assert.equal(saved,1);assert.equal(mutation.storage.size,0);assert.equal(h.slots[10],true);mutation.unmount();h.unmount();
});
test('each same-scope mutation attempt captures its read epoch before delayed auth failures', async () => {
 for(const operation of ['submit','retry','resolve']) for(const signal of [401,403,'redirect','code']) {
  let epoch=1,shown='old read',invalidations=0,release;
  const captureAccessDenied=()=>{const captured=epoch;return()=>{if(captured===epoch){invalidations++;epoch++;shown=null;}};};
  const mutation=harness({raw:operation==='submit'?undefined:envelope(payload),captureAccessDenied,fetcher:()=>new Promise(resolve=>release=resolve)});
  const running=performRequest(mutation.render(),operation),frozen=mutation.storage.get(mutation.key);
  captureAccessDenied()();assert.equal(epoch,2);shown='new authenticated read under unchanged actor/scope';
  release(authFailure(signal));await running;
  assert.equal(epoch,2);assert.equal(invalidations,1);assert.equal(shown,'new authenticated read under unchanged actor/scope');assert.equal(mutation.storage.get(mutation.key),frozen);
  // A deliberate new attempt captures epoch2 and can invalidate that epoch.
  const retry=performRequest(mutation.render(),operation==='submit'?'retry':operation);release(authFailure(signal));await retry;
  assert.equal(epoch,3);assert.equal(invalidations,2);assert.equal(shown,null);assert.equal(mutation.storage.get(mutation.key),frozen);mutation.unmount();
 }
});
test('real workspace epoch callback preserves newer authenticated rows and detail against an older mutation auth failure', async () => {
 for(const operation of ['submit','retry','resolve']) for(const signal of [401,'code']) {
  const newer={...current,version:2,serviceLabel:'New authenticated revision'},newEvent={...row,version:2,action:'edit',serviceLabel:newer.serviceLabel},newDetail={...detail,subscription:newer,events:[newEvent]};
  const {description:_description,...metadata}=newer;
  const h=workspaceHarness({state:{3:[current],5:false,7:detail,8:row},effects:true,fetcher:async url=>({ok:true,status:200,json:async()=>url.includes('/api/manual-subscriptions?')?{actorId,subscriptions:[metadata],page:0,nextPage:null}:newDetail})});
  h.render();await new Promise(resolve=>setImmediate(resolve));let release;
  const mutation=harness({raw:operation==='submit'?undefined:envelope(payload),captureAccessDenied:h.requestCaptureAccessDenied,fetcher:()=>new Promise(resolve=>release=resolve)});
  const running=performRequest(mutation.render(),operation),frozen=mutation.storage.get(mutation.key);
  h.requestAccessDenied();assert.equal(h.slots[10],true);assert.deepEqual(h.slots[3],[]);assert.equal(h.slots[7],null);
  // Harness-only simulation of returning to the original account. Production requires page refresh/sign-in, not automatic recovery.
  h.simulateSameActorReadRecovery();h.render();await new Promise(resolve=>setImmediate(resolve));
  const nodes=h.descendants(h.render()),open=nodes.find(e=>e.type==='button'&&Array.isArray(e.props.children)&&e.props.children[0]===newer.serviceLabel);assert.ok(open);
  open.props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.slots[3],[metadata]);assert.deepEqual(h.slots[7],newDetail);assert.deepEqual(h.slots[8],newEvent);assert.equal(h.slots[10],false);
  release(authFailure(signal));await running;
  assert.deepEqual(h.slots[3],[metadata]);assert.deepEqual(h.slots[7],newDetail);assert.deepEqual(h.slots[8],newEvent);assert.equal(h.slots[10],false);assert.equal(mutation.storage.get(mutation.key),frozen);
  mutation.unmount();h.unmount();
 }
});
