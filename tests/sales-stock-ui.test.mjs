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
const input = load('src/lib/sales-stock-input.ts');
const holdInput = load('src/lib/order-stock-hold-input.ts');
const directory = 'src/app/sales/orders/[id]/deliveries/';
const detailInput = load(directory + 'detail-input.ts', { '@/lib/sales-stock-input': input });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorId = id(1), tenantId = id(2), companyId = id(3), orderId = id(4), branchId = id(5), itemId = id(6);
const payload = { tenantId, companyId, orderId, expectedActorId: actorId, requestId: id(7), expectedUnit: 'each', reason: 'Physical goods delivered', action: 'deliver', branchId, itemId, lineId: null, holdId: null, quantity: '2.500', reference: 'DEL-001', physicalConfirmed: true };
const row = { id: payload.requestId, tenantId, companyId, orderId, lineId: null, branchId, itemId, balanceId: id(8), kind: 'DELIVERY', deliveryId: null, correctsId: null, holdId: null, releaseRequestId: null, quantity: '2.500', delta: '-2.500', unit: 'each', reference: payload.reference, reason: payload.reason, physicalConfirmed: true, createdBy: actorId, createdAt: '2026-11-11T12:00:00.000Z', orderNumber: 'SO-001', customerName: 'Customer', linePosition: null, lineDescription: null, itemName: 'Item', itemSku: 'SKU', branchName: 'East', companyName: 'Company', actorName: 'Actor' };
const detail = { document: row, corrections: [], returns: [], returnCorrections: [], canCorrect: true, canReturn: true, returnableQuantity: '2.500' };
const envelope = request => JSON.stringify({ version: 1, actorId, orderId, request });
function browser() {
 const storage = new Map(), held = new Set();
 return { storage, locks: { async request(key, options, fn) { assert.equal(options.ifAvailable, true); if (held.has(key)) return fn(null); held.add(key); try { return await fn({ name: key }); } finally { held.delete(key); } } } };
}
function harness({ raw, fetcher = async () => { throw Error('network'); }, storageFails = false, removalFails = false, shared = browser(), locking = true } = {}) {
 const key = `erp-sales-stock:v1:${actorId}:${tenantId}:${companyId}:${orderId}`, storage = shared.storage;
 if (raw !== undefined) storage.set(key, raw);
 const slots = [], listeners = new Set(); let index = 0, calls = 0, actor = actorId, order = orderId;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn, deps) { const i = index++, value = JSON.stringify(deps); if (slots[i]?.deps !== value) { slots[i]?.cleanup?.(); slots[i] = { deps: value, cleanup: fn() }; } } };
 const mod = load(directory + 'request.ts', { react: hooks, '@/lib/sales-stock-input': input }, { navigator: { locks: locking ? shared.locks : undefined }, window: { addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); } }, localStorage: { getItem: k => storage.get(k) ?? null, setItem(k, v) { if (storageFails) throw Error('blocked'); storage.set(k, v); }, removeItem: k => { if (!removalFails) storage.delete(k); } }, fetch(...args) { calls++; return fetcher(...args); } });
 const render = () => { index = 0; return mod.useSalesStockRequest(actor, tenantId, companyId, order); }; render();
 return { render, storage, key, get calls() { return calls; }, event(eventKey = key) { listeners.forEach(fn => fn({ key: eventKey })); }, identity(nextActor, nextOrder = orderId) { actor = nextActor; order = nextOrder; render(); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
test('sales captures hydrate without writes and malformed or actor/source substitutions remain blocked', () => {
 for (const raw of ['broken', envelope({ ...payload, orderId: id(99) }), JSON.stringify({ version: 1, actorId: id(9), orderId, request: payload }), envelope({ ...payload, expectedActorId: id(99) })]) {
  const h = harness({ raw }); assert.equal(h.render().blocked, true); assert.equal(h.render().pending, null); assert.equal(h.storage.get(h.key), raw); assert.equal(h.calls, 0);
 }
 const h = harness({ raw: envelope(payload) }); assert.deepEqual(h.render().pending, payload); assert.equal(h.calls, 0);
});
test('network errors and all HTTP failures retain exact sales request for explicit same-body retry', async () => {
 for (const status of [400, 401, 403, 404, 409, 422, 500]) {
  const sent = [], h = harness({ fetcher: async (_url, options) => { sent.push(options.body); return { ok: false, status, json: async () => ({ error: 'failed' }) }; } });
  await h.render().run(payload, () => assert.fail(), () => {}); const raw = h.storage.get(h.key);
  await h.render().run(null, () => assert.fail(), () => {}); assert.equal(sent.length, 2); assert.equal(sent[0], sent[1]); assert.equal(h.storage.get(h.key), raw);
 }
 const h = harness(); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.get(h.key), envelope(payload));
});
test('unsupported locks or failed persistence never write; concurrent clicks send once and unmount retains capture', async () => {
 for (const options of [{ storageFails: true }, { locking: false }]) { const h = harness(options); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.calls, 0); }
 let release; const h = harness({ fetcher: () => new Promise(resolve => { release = resolve; }) });
 const first = h.render().run(payload, () => assert.fail(), () => {}); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.calls, 1); h.unmount(); release({ ok: false, json: async () => ({}) }); await first; assert.equal(h.storage.size, 1);
});
test('unknown and malformed successful responses do not clear pending sales requests', async () => {
 for (const data of [{}, { document: {} }, { document: { ...row, createdBy: id(99) } }, { document: { ...row, orderId: id(99) } }, { document: { ...row, unit: 'box' } }, { document: { ...row, holdId: id(99) } }]) {
  const h = harness({ fetcher: async () => ({ ok: true, json: async () => data }) }); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.size, 1);
 }
 const h = harness({ fetcher: async () => ({ ok: true, json: async () => { throw Error('malformed JSON'); } }) }); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.size, 1);
});
test('verified document clears only its own exact capture, and failed removal remains unresolved', async () => {
 for (const removalFails of [false, true]) {
  const h = harness({ removalFails, fetcher: async () => ({ ok: true, json: async () => ({ document: row }) }) }); let saved = 0;
  await h.render().run(payload, () => saved++, () => {}); assert.equal(saved, removalFails ? 0 : 1); assert.equal(h.storage.size, removalFails ? 1 : 0);
 }
});
test('check-and-abandon clears only a matching tombstone; unknown outcomes remain retained', async () => {
 const cancellation = { id: payload.requestId, tenantId, companyId, createdBy: actorId, createdAt: row.createdAt, request: payload };
 for (const data of [{}, { cancellation: { ...cancellation, createdBy: id(99) } }, { cancellation }]) {
  let abandoned = 0; const h = harness({ raw: envelope(payload), fetcher: async (url, options) => { assert.equal(url, '/api/sales/stock-documents/cancel'); assert.deepEqual(JSON.parse(options.body), payload); return { ok: true, json: async () => data }; } });
  await h.render().abandon(() => assert.fail(), () => {}, () => abandoned++); const valid = data.cancellation?.createdBy === actorId;
  assert.equal(abandoned, valid ? 1 : 0); assert.equal(h.storage.size, valid ? 0 : 1);
 }
});
test('abandonment discovers an already recorded document without claiming cancellation', async () => {
 const h = harness({ raw: envelope(payload), fetcher: async () => ({ ok: true, json: async () => ({ document: row }) }) }); let saved = 0;
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
 release({ ok: true, json: async () => ({ document: row }) }); await running; assert.equal(h.storage.get(h.key), other);
 h.storage.delete(h.key); h.event(); assert.equal(h.render().blocked, false);
});
test('actor and source switches fence late responses and leave old requests unchanged', async () => {
 for (const change of ['actor', 'order']) {
  let release, callbacks = 0; const h = harness({ raw: envelope(payload), fetcher: () => new Promise(resolve => { release = resolve; }) });
  const running = h.render().abandon(() => callbacks++, () => callbacks++, () => callbacks++);
  h.identity(change === 'actor' ? id(99) : actorId, change === 'order' ? id(98) : orderId);
  release({ ok: true, json: async () => ({ document: row }) }); await running;
  assert.equal(callbacks, 0); assert.equal(h.storage.get(h.key), envelope(payload)); assert.equal(h.render().pending, null);
 }
});
test('deliver, source-return and correction recovery retain the original actor, unit and action UUID', async () => {
 const common = { tenantId, companyId, orderId, expectedActorId: actorId, expectedUnit: 'each', reason: 'Historical correction', requestId: id(21) };
 for (const request of [payload, { ...payload, holdId: id(50) }, { ...common, action: 'return', deliveryId: row.id, quantity: '0.125', reference: 'RET-001', usableConfirmed: true }, { ...common, action: 'correct', documentId: row.id, physicalConfirmed: true }]) {
  const seen = [], h = harness({ fetcher: async (url, options) => { seen.push({ url, body: JSON.parse(options.body) }); return { ok: false, json: async () => ({}) }; } });
  await h.render().run(request, () => assert.fail(), () => {}); const frozen = h.storage.get(h.key);
  await h.render().abandon(() => assert.fail(), () => {}, () => assert.fail()); assert.equal(seen.length, 2); assert.deepEqual(seen[0].body, request); assert.deepEqual(seen[1].body, request); assert.equal(h.storage.get(h.key), frozen);
 }
});
test('print details reject substituted immutable snapshots, incorrect source and correction quantities', () => {
 assert.deepEqual(detailInput.validatedDeliveryDetail(detail, row), detail);
 for (const patch of [{ quantity: '3.000' }, { unit: 'box' }, { orderNumber: 'OTHER' }, { customerName: 'OTHER' }, { branchName: 'OTHER' }, { reason: 'OTHER' }, { actorName: 'OTHER' }]) assert.equal(detailInput.validatedDeliveryDetail({ ...detail, document: { ...row, ...patch } }, row), null);
 assert.equal(detailInput.validatedDeliveryDetail({ ...detail, returnCorrections: undefined }, row), null);
 assert.equal(detailInput.validatedDeliveryDetail({ ...detail, returns: Array(5001).fill(row) }, row), null);
 assert.equal(detailInput.validatedDeliveryDetail({ ...detail, returnCorrections: Array(5001).fill(row) }, row), null);
 const correction = { ...row, id: id(30), kind: 'CORRECTION', correctsId: row.id, delta: '2.500' };
 for (const patch of [{ quantity: '1.000' }, { unit: 'box' }, { correctsId: id(99) }, { kind: 'RETURN' }, { branchId: id(99) }]) assert.equal(detailInput.validatedDeliveryDetail({ ...detail, corrections: [{ ...correction, ...patch }], canCorrect: false, canReturn: false }, row), null);
 assert.equal(detailInput.validatedDeliveryDetail({ ...detail, corrections: [correction] }, row), null);
 const returned = { ...row, id: id(31), kind: 'RETURN', deliveryId: row.id, delta: '1.000', quantity: '1.000' }, returnCorrection = { ...row, id: id(32), kind: 'CORRECTION', correctsId: returned.id, delta: '-1.000', quantity: '1.000' };
 const valid = { ...detail, returns: [returned], returnCorrections: [returnCorrection] };
 assert.ok(detailInput.validatedDeliveryDetail(valid, row));
 assert.equal(detailInput.validatedDeliveryDetail({ ...valid, returnCorrections: [{ ...returnCorrection, correctsId: id(99) }] }, row), null);
 assert.equal(detailInput.validatedDeliveryDetail({ ...valid, returns: [{ ...returned, deliveryId: id(99) }] }, row), null);
});
const order = { id: orderId, tenantId, companyId, branchId, number: row.orderNumber, status: 'COMPLETED', lines: [] };
const branches = [{ id: branchId, name: 'East', canManage: true, canDeliverHold: true, items: [{ id: itemId, sku: 'SKU', name: 'Item', unit: 'each' }] }];
const localized = { translate: (locale, en, ar) => locale === 'ar' ? ar : en };
const commonOverrides = { '@/lib/locale': localized, '@/lib/sales-stock-input': input, '@/lib/order-stock-hold-input': holdInput, './detail-input': detailInput };
test('workspace renders bilingual explicit movement/usable confirmation, independent lifecycle and recovery controls', () => {
 const mod = load(directory + 'workspace.tsx', { ...commonOverrides, './request': { useSalesStockRequest: () => ({ ready: true, pending: payload, blocked: true, busy: false }) } });
 for (const locale of ['en', 'ar']) {
  const html = renderToStaticMarkup(React.createElement(mod.SalesStockWorkspace, { actorId, order, branches, locale }));
  assert.match(html, /fieldset disabled/); assert.match(html, /name="physicalConfirmed"/); assert.match(html, /name="quantity"/); assert.match(html, /maxLength="120"/); assert.match(html, /maxLength="300"/);
  for (const text of locale === 'en' ? ['Retry exact saved request', 'Check and abandon request', 'Entire explicitly selected order hold', 'does not complete an order', 'No totals across different units'] : ['إعادة إرسال الطلب المحفوظ نفسه', 'التحقق من الطلب وإلغاؤه', 'كامل حجز الطلب المختار صراحةً', 'التسليم لا يكمل الطلب', 'لا جمع لوحدات مختلفة']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('Discard saved request'));
 }
});
test('options page intersects order source and actual stock rights within tenant lock, not global client', () => {
 const page = readFileSync(new URL('../' + directory + 'page.tsx', import.meta.url), 'utf8');
 for (const literal of ['FOR SHARE', 'order:read', 'inventory-stock:read', 'order-delivery:manage', 'order-reservation:manage', 'inventory-stock:adjust', 'archivedAt:null', 'branchId:null', 'canDeliverHold', 'if(!data || !data.branches.length)notFound()']) assert.ok(page.includes(literal), literal);
 assert.match(page, /canAccess\(\{\.\.\.scope,permission:"order:read"\},tx\)/);
});
function printHarness(response) {
 const slots = [], effects = [], frames = new Map(); let index = 0, printed = 0, fetches = 0, frameId = 0;
 const hooks = { useCallback(fn) { return fn; }, useState(initial) { const i = index++; if (!(i in slots)) slots[i] = i === 15 ? detail : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn, deps) { const i = index++; if (i === 24 || i === 25) return; if (!slots[i] || deps.some((value, j) => value !== slots[i].deps[j])) { const previous = slots[i]; slots[i] = { deps, cleanup: previous?.cleanup }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } } };
 const mod = load(directory + 'workspace.tsx', { ...commonOverrides, react: hooks, './request': { useSalesStockRequest: () => ({ ready: true, pending: null, blocked: false, busy: false }) } }, { window: { print() { printed++; } }, requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame(id) { frames.delete(id); }, async fetch(url, options) { fetches++; assert.equal(url, `/api/sales/stock-documents/${row.id}?tenantId=${tenantId}`); assert.equal(options.cache, 'no-store'); return typeof response === 'function' ? response() : response; } });
 function render() { index = 0; const wrapper = mod.SalesStockWorkspace({ actorId, order, branches, locale: 'en' }), tree = wrapper.type(wrapper.props); effects.splice(0).forEach(fn => fn()); return tree; }
 function descendants(element) { return [element, ...React.Children.toArray(element?.props?.children).flatMap(child => React.isValidElement(child) ? descendants(child) : [])]; }
 return { render, descendants, click(tree) { descendants(tree).find(e => e.type === 'button' && e.props.children === 'Verify and print document').props.onClick(); }, get printed() { return printed; }, get fetches() { return fetches; }, flush() { const queued = [...frames.values()]; frames.clear(); queued.forEach(fn => fn()); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('print reauthorizes and revoked or malformed responses never print stale source details', async () => {
 for (const response of [{ ok: false, json: async () => ({ error: 'denied' }) }, { ok: true, json: async () => ({ ...detail, document: { ...row, createdBy: id(99) } }) }, { ok: true, json: async () => ({ ...detail, corrections: undefined }) }]) {
  const h = printHarness(response); h.click(h.render()); await settle(); const tree = h.render(); h.flush(); assert.equal(h.printed, 0); assert.equal(h.fetches, 1); assert.equal(tree.props['data-print-ready'], 'no');
 }
});
test('print uses refreshed corrections only after DOM commit and unmount fences delayed print', async () => {
 const correction = { ...row, id: id(30), kind: 'CORRECTION', correctsId: row.id, delta: '2.500', reason: 'Corrected today' };
 const h = printHarness({ ok: true, json: async () => ({ ...detail, corrections: [correction], canCorrect: false, canReturn: false }) });
 h.click(h.render()); await settle(); assert.equal(h.printed, 0); const tree = h.render(); assert.equal(tree.props['data-print-ready'], 'yes');
 assert.ok(h.descendants(tree).some(e => e.type === 'p' && React.Children.toArray(e.props.children).includes('Corrected today'))); h.flush(); assert.equal(h.printed, 1);
 h.click(h.render()); await settle(); h.render(); h.unmount(); h.flush(); assert.equal(h.printed, 1);
});
function formHarness({ state = {}, detailValue = null, branchOptions = branches, pending = null, locale = 'en' } = {}) {
 let index = 0; const captured = [], slots = [], hooks = { useCallback(fn) { return fn; }, useEffect() {}, useRef(initial) { return { current: initial }; }, useState(initial) { const i = index++; if (!(i in slots)) slots[i] = Object.hasOwn(state, i) ? state[i] : i === 15 ? detailValue : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; } };
 const mod = load(directory + 'workspace.tsx', { ...commonOverrides, react: hooks, './request': { useSalesStockRequest: () => ({ ready: true, pending, blocked: Boolean(pending), busy: false, async run(request) { captured.push(request); } }) } }, { crypto: { randomUUID: () => id(90) }, FormData: class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } } });
 function render() { index = 0; const wrapper = mod.SalesStockWorkspace({ actorId, order, branches: branchOptions, locale }); return wrapper.type(wrapper.props); }
 function descendants(element) { return [element, ...React.Children.toArray(element?.props?.children).flatMap(child => React.isValidElement(child) ? descendants(child) : [])]; }
 return { render, descendants, captured, submit(form, values) { form.props.onSubmit({ preventDefault() {}, currentTarget: { values } }); } };
}
test('selected hold uses exact entire source item, branch, line, unit and quantity without editable quantity', async () => {
 const hold = { id: id(70), tenantId, balanceId: id(8), quantity: '1.125', reference: 'Order-linked manual hold', createdBy: actorId, createdAt: row.createdAt, releasedBy: null, releasedAt: null, releaseReason: null, releaseRequestId: null, orderLink: { orderId, lineId: id(71), note: 'Selected exact hold', orderNumber: 'SO-001', customerName: 'Customer', linePosition: 1, lineDescription: 'Descriptive line', itemSku: 'SKU', itemName: 'Item', itemUnit: 'each', branchName: 'East' }, balance: { itemId, branchId, companyId } };
 const h = formHarness({ state: { 1: 'hold', 2: hold.id, 3: [hold] } }), tree = h.render(), html = renderToStaticMarkup(h.descendants(tree).find(e => e.type === 'form'));
 assert.ok(html.includes('1.125 each')); assert.ok(!html.includes('name="quantity"')); assert.ok(!html.includes('name="itemId"')); assert.ok(!html.includes('name="lineId"'));
 const form = h.descendants(tree).find(e => e.type === 'form');
 h.submit(form, { quantity: '0.100', itemId: id(99), lineId: id(99), reference: 'DEL-HOLD', reason: 'Full physical delivery', physicalConfirmed: 'on' }); await settle();
 assert.equal(h.captured.length, 1); assert.deepEqual(h.captured[0], { ...payload, requestId: id(90), holdId: hold.id, lineId: hold.orderLink.lineId, quantity: hold.quantity, reason: 'Full physical delivery', reference: 'DEL-HOLD' });
});
test('full-hold mode is absent without independent reservation management and disabled request cannot submit', async () => {
 const h = formHarness({ branchOptions: [{ ...branches[0], canDeliverHold: false }] }), html = renderToStaticMarkup(h.render());
 assert.ok(!html.includes('Entire explicitly selected order hold'));
 const blocked = formHarness({ pending: payload }), tree = blocked.render();
 blocked.submit(blocked.descendants(tree).find(e => e.type === 'form'), { itemId, quantity: '1', reference: 'REF-001', reason: 'Physical stock', physicalConfirmed: 'on' }); await settle(); assert.equal(blocked.captured.length, 0);
});
test('return and correction forms bind original document unit and require explicit movement confirmations', async () => {
 for (const locale of ['en', 'ar']) {
  const h = formHarness({ detailValue: detail, locale }), tree = h.render(), html = renderToStaticMarkup(tree), forms = h.descendants(tree).filter(e => e.type === 'form');
  assert.match(html, /name="usableConfirmed"/); assert.ok(html.includes(locale === 'en' ? 'Correct dependent returns first' : 'صحح المرتجعات التابعة أولًا'));
  h.submit(forms[2], { quantity: '0.125', reference: 'RET-001', reason: 'Usable goods returned', usableConfirmed: 'on', itemId: id(99), branchId: id(99), expectedUnit: 'box' }); await settle();
  assert.deepEqual(h.captured[0], { tenantId, companyId, orderId, expectedActorId: actorId, requestId: id(90), expectedUnit: 'each', reason: 'Usable goods returned', action: 'return', deliveryId: row.id, quantity: '0.125', reference: 'RET-001', usableConfirmed: true });
  h.submit(forms[3], { quantity: '0.001', reason: 'Full document correction', physicalConfirmed: 'on' }); await settle();
  assert.deepEqual(h.captured[1], { tenantId, companyId, orderId, expectedActorId: actorId, requestId: id(90), expectedUnit: 'each', reason: 'Full document correction', action: 'correct', documentId: row.id, physicalConfirmed: true });
 }
 const h = formHarness({ detailValue: detail }), forms = h.descendants(h.render()).filter(e => e.type === 'form');
 h.submit(forms[2], { quantity: '0.125', reference: 'RET-001', reason: 'Usable goods returned' }); h.submit(forms[3], { reason: 'Full document correction' }); await settle(); assert.equal(h.captured.length, 0);
});
