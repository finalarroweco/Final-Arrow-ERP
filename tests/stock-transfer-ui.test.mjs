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
const input = load('src/lib/stock-transfer-input.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorId = id(1), tenantId = id(2), companyId = id(3);
const payload = { action: 'transfer', expectedActorId: actorId, requestId: id(4), tenantId, companyId, sourceBranchId: id(5), destinationBranchId: id(6), itemId: id(7), quantity: '2.500', expectedUnit: 'each', reference: 'REF-01', reason: 'Branch replenishment' };
const envelope = request => JSON.stringify({ version: 1, actorId, request });
function browser() {
 const storage = new Map(), held = new Set();
 return { storage, locks: { async request(key, options, fn) { assert.equal(options.ifAvailable, true); if (held.has(key)) return fn(null); held.add(key); try { return await fn({ name: key }); } finally { held.delete(key); } } } };
}
function harness({ raw, fetcher = async () => { throw Error('network'); }, storageFails = false, shared = browser(), locking = true } = {}) {
 const key = `erp-stock-transfer:${actorId}:${tenantId}:${companyId}`, storage = shared.storage;
 if (raw !== undefined) storage.set(key, raw);
 const slots = [], listeners = new Set(); let index = 0, calls = 0, actor = actorId, company = companyId;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn, deps) { const i = index++, value = JSON.stringify(deps); if (slots[i]?.deps !== value) { slots[i]?.cleanup?.(); slots[i] = { deps: value, cleanup: fn() }; } } };
 const mod = load('src/app/inventory/transfers/request.ts', { react: hooks, '@/lib/stock-transfer-input': input }, { navigator: { locks: locking ? shared.locks : undefined }, window: { addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); } }, localStorage: { getItem: k => storage.get(k) ?? null, setItem(k, v) { if (storageFails) throw Error('blocked'); storage.set(k, v); }, removeItem: k => storage.delete(k) }, fetch(...args) { calls++; return fetcher(...args); } });
 const render = () => { index = 0; return mod.useTransferRequest(actor, tenantId, company); }; render();
 return { render, storage, key, get calls() { return calls; }, event(eventKey = key) { listeners.forEach(fn => fn({ key: eventKey })); }, identity(nextActor, nextCompany = companyId) { actor = nextActor; company = nextCompany; render(); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
test('pending requests hydrate without automatic writes and malformed captures remain blocked', () => {
 for (const raw of ['broken', envelope({ ...payload, companyId: id(9) }), JSON.stringify({ version: 1, actorId: id(9), request: payload })]) { const h = harness({ raw }); assert.equal(h.render().blocked, true); assert.equal(h.render().pending, null); assert.equal(h.storage.get(h.key), raw); assert.equal(h.calls, 0); }
 const h = harness({ raw: envelope(payload) }); assert.deepEqual(h.render().pending, payload); assert.equal(h.calls, 0);
});
test('network and all HTTP errors preserve exact capture; explicit retries send identical body', async () => {
 for (const status of [400, 401, 403, 404, 409, 422, 500]) {
  const sent = [], h = harness({ fetcher: async (_url, options) => { sent.push(options.body); return { ok: false, status, json: async () => ({ error: 'failed' }) }; } });
  await h.render().run(payload, () => assert.fail(), () => {}); const raw = h.storage.get(h.key);
  await h.render().run(null, () => assert.fail(), () => {}); assert.equal(sent.length, 2); assert.equal(sent[0], sent[1]); assert.equal(h.storage.get(h.key), raw);
 }
});
test('storage failure prevents writes; concurrent clicks submit only once; unmount retains capture', async () => {
 const blocked = harness({ storageFails: true }); await blocked.render().run(payload, () => assert.fail(), () => {}); assert.equal(blocked.calls, 0);
 let release; const h = harness({ fetcher: () => new Promise(resolve => { release = resolve; }) });
 const first = h.render().run(payload, () => assert.fail(), () => {}); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.calls, 1); h.unmount(); release({ ok: false, json: async () => ({}) }); await first; assert.equal(h.storage.size, 1);
});
test('unknown success responses never erase pending writes', async () => {
 for (const data of [{}, { transfer: {} }, { transfer: { ...payload, id: payload.requestId, createdBy: id(9), createdAt: new Date().toISOString() } }]) {
  const h = harness({ fetcher: async () => ({ ok: true, json: async () => data }) }); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.storage.size, 1);
 }
});
test('server options filter both read and write access and use only active company-wide items', () => {
 const source = readFileSync(new URL('../src/app/inventory/transfers/page.tsx', import.meta.url), 'utf8');
 for (const literal of ['inventory-stock:read', 'inventory-stock:adjust', 'inventory-transfer:manage', 'branches.length < 2', 'branchId: null', 'archivedAt: null']) assert.ok(source.includes(literal));
 const detail = readFileSync(new URL('../src/app/inventory/transfers/[id]/page.tsx', import.meta.url), 'utf8'); assert.match(detail, /readStockTransfer\(user.id, id\)/); assert.match(detail, /currentUser\(\)/);
});

test('creation and full correction render localized labeled controls and immutable retry warning', () => {
 const form = load('src/app/inventory/transfers/form.tsx', {
  '@/lib/locale': { translate: (locale, en, ar) => locale === 'ar' ? ar : en },
  '@/lib/stock-transfer-input': input,
  './request': { useTransferRequest: () => ({ ready: true, pending: payload, blocked: true, busy: false }) },
 });
 const scope = { tenantId, companyId, label: 'Company', branches: [{ id: id(5), name: 'East', canWrite: true }, { id: id(6), name: 'West', canWrite: true }], items: [{ id: id(7), sku: 'SKU', name: 'Item', unit: 'each' }] };
 for (const locale of ['en', 'ar']) {
  const html = renderToStaticMarkup(React.createElement(form.TransferForm, { actorId, scope, locale, onSaved() {} }));
  assert.match(html, /fieldset disabled/); assert.match(html, /name="sourceBranchId"/); assert.match(html, /name="destinationBranchId"/); assert.match(html, /maxLength="120"/); assert.match(html, /maxLength="300"/);
  assert.ok(html.includes(locale === 'en' ? 'Retry saved request' : 'إعادة محاولة الطلب المحفوظ'));
  assert.ok(!html.includes('Discard saved request'));
  const correction = renderToStaticMarkup(React.createElement(form.TransferForm, { actorId, scope, locale, correction: { id: id(8), canCorrect: true }, onSaved() {} }));
  assert.ok(correction.includes(locale === 'en' ? 'Record full opposite transfer' : 'تسجيل التحويل المعاكس كاملاً'));
  assert.ok(!correction.includes('name="quantity"'));
 }
});
test('only matching canonical response from this actor clears saved transfer', async () => {
 const transfer = { ...payload, id: payload.requestId, createdBy: actorId, createdAt: '2026-11-11T12:00:00.000Z', correctsId: null, unit: 'each', itemName: 'Item', itemSku: 'SKU', companyName: 'Company', sourceBranchName: 'East', destinationBranchName: 'West', actorName: 'Actor' };
 for (const createdBy of [actorId, id(9)]) {
  const h = harness({ fetcher: async () => ({ ok: true, json: async () => ({ transfer: { ...transfer, createdBy } }) }) }); let success = 0;
  await h.render().run(payload, () => success++, () => {});
  assert.equal(success, createdBy === actorId ? 1 : 0); assert.equal(h.storage.size, createdBy === actorId ? 0 : 1);
 }
});
test('abandonment preserves unknown outcomes and clears only verified cancellation', async () => {
 const cancellation = { id: payload.requestId, tenantId, companyId, createdBy: actorId, createdAt: '2026-11-11T12:00:00.000Z', request: payload };
 for (const data of [{}, { cancellation: { ...cancellation, createdBy: id(9) } }, { cancellation }]) {
  let abandoned = 0;
  const raw = envelope(payload), h = harness({ raw, fetcher: async (url, options) => { assert.equal(url, '/api/inventory/transfers/cancel'); assert.deepEqual(JSON.parse(options.body), payload); assert.equal(JSON.parse(options.body).expectedActorId, actorId); return { ok: true, json: async () => data }; } });
  await h.render().abandon(() => assert.fail(), () => {}, () => abandoned++);
  const valid = data.cancellation?.createdBy === actorId;
  assert.equal(abandoned, valid ? 1 : 0); assert.equal(h.storage.size, valid ? 0 : 1);
  if (!valid) assert.equal(h.storage.get(h.key), raw);
 }
});
test('abandonment reports an already committed transfer rather than claiming cancellation', async () => {
 const transfer = { ...payload, id: payload.requestId, createdBy: actorId, createdAt: '2026-11-11T12:00:00.000Z', correctsId: null, unit: 'each', itemName: 'Item', itemSku: 'SKU', companyName: 'Company', sourceBranchName: 'East', destinationBranchName: 'West', actorName: 'Actor' };
 const h = harness({ raw: envelope(payload), fetcher: async () => ({ ok: true, json: async () => ({ transfer }) }) }); let success = 0;
 await h.render().abandon(() => success++, () => assert.fail(), () => assert.fail()); assert.equal(success, 1); assert.equal(h.storage.size, 0);
});
test('two empty controllers cannot overwrite or concurrently submit distinct requests', async () => {
 const shared = browser(); let release;
 const first = harness({ shared, fetcher: () => new Promise(resolve => { release = resolve; }) });
 const second = harness({ shared });
 const active = first.render().run(payload, () => assert.fail(), () => {});
 await second.render().run({ ...payload, requestId: id(20) }, () => assert.fail(), () => {});
 assert.equal(first.calls, 1); assert.equal(second.calls, 0); const raw = shared.storage.get(first.key);
 release({ ok: false, json: async () => ({ error: 'unknown' }) }); await active;
 await second.render().run({ ...payload, requestId: id(20) }, () => assert.fail(), () => {});
 assert.equal(second.calls, 0); assert.equal(shared.storage.get(first.key), raw); assert.deepEqual(second.render().pending, payload);
 // Storage events hydrate a peer, but do not turn a new submission into an implicit retry.
 second.event(); await second.render().run({ ...payload, requestId: id(20) }, () => assert.fail(), () => {});
 assert.equal(second.calls, 0); await second.render().run(null, () => assert.fail(), () => {}); assert.equal(second.calls, 1); assert.equal(shared.storage.get(first.key), raw);
});
test('storage changes before clearing never erase another capture, and storage events rehydrate', async () => {
 let release; const h = harness({ fetcher: () => new Promise(resolve => { release = resolve; }) });
 const running = h.render().abandon(() => assert.fail(), () => {}, () => assert.fail()); await running; // No pending cancellation sends nothing.
 const operation = h.render().run(payload, () => assert.fail(), () => {});
 const other = envelope({ ...payload, requestId: id(20) }); h.storage.set(h.key, other); h.event(); assert.equal(h.render().pending.requestId, id(20));
 release({ ok: true, json: async () => ({ transfer: { ...payload, id: payload.requestId, createdBy: actorId, createdAt: '2026-11-11T12:00:00.000Z', correctsId: null, unit: 'each', itemName: 'Item', itemSku: 'SKU', companyName: 'Company', sourceBranchName: 'East', destinationBranchName: 'West', actorName: 'Actor' } }) }); await operation;
 assert.equal(h.storage.get(h.key), other);
 h.storage.delete(h.key); h.event(); assert.equal(h.render().blocked, false);
});
test('actor or company changes fence late responses and unsupported locking prevents network writes', async () => {
 for (const change of ['actor', 'company']) {
  let release, callbacks = 0;
  const h = harness({ raw: envelope(payload), fetcher: () => new Promise(resolve => { release = resolve; }) });
  const operation = h.render().abandon(() => callbacks++, () => callbacks++, () => callbacks++);
  h.identity(change === 'actor' ? id(9) : actorId, change === 'company' ? id(10) : companyId);
  release({ ok: true, json: async () => ({ cancellation: { id: payload.requestId, tenantId, companyId, createdBy: actorId, createdAt: '2026-11-11T12:00:00.000Z', request: payload } }) }); await operation;
  assert.equal(callbacks, 0); assert.equal(h.storage.get(h.key), envelope(payload)); assert.equal(h.render().pending, null);
 }
 const h = harness({ locking: false }); assert.equal(h.render().ready, false); await h.render().run(payload, () => assert.fail(), () => {}); assert.equal(h.calls, 0); assert.equal(h.storage.size, 0);
});

test('frozen transfer and correction requests bind save and cancellation to the initiating actor', async () => {
 for (const request of [payload, { action: 'correct', expectedActorId: actorId, requestId: id(21), tenantId, companyId, transferId: id(22), reason: 'Full correction' }]) {
  const seen = [];
  const h = harness({ fetcher: async (url, options) => { seen.push({ url, body: JSON.parse(options.body) }); return { ok: false, json: async () => ({ error: 'actor changed' }) }; } });
  await h.render().run(request, () => assert.fail(), () => {}); const frozenRaw = h.storage.get(h.key);
  await h.render().abandon(() => assert.fail(), () => {}, () => assert.fail());
  assert.equal(seen.length, 2); assert.deepEqual(seen[0].body, request); assert.deepEqual(seen[1].body, request);
  assert.equal(seen[0].body.expectedActorId, actorId); assert.equal(h.storage.get(h.key), frozenRaw);
 }
 const invalid = harness({ raw: envelope({ ...payload, expectedActorId: id(9) }) });
 assert.equal(invalid.render().pending, null); assert.equal(invalid.render().blocked, true);
 await invalid.render().run(null, () => assert.fail(), () => {}); assert.equal(invalid.calls, 0);
});
const detailInput = load('src/app/inventory/transfers/detail-input.ts');
const printable = { tenantId, companyId, sourceBranchId: payload.sourceBranchId, destinationBranchId: payload.destinationBranchId, itemId: payload.itemId, quantity: payload.quantity, reference: payload.reference, reason: payload.reason, id: payload.requestId, createdBy: actorId, createdAt: '2026-11-11T12:00:00.000Z', correctsId: null, unit: 'each', itemName: 'Item', itemSku: 'SKU', companyName: 'Company', sourceBranchName: 'East', destinationBranchName: 'West', actorName: 'Actor', corrections: [], canCorrect: true };
function printHarness(response) {
 const slots = [], effects = [], frames = new Map(); let index = 0, printed = 0, fetches = 0, frameId = 0;
 const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn, deps) { const i = index++; if (!slots[i] || deps.some((value, j) => value !== slots[i].deps[j])) { const previous = slots[i]; slots[i] = { deps, cleanup: previous?.cleanup }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } } };
 const mod = load('src/app/inventory/transfers/[id]/detail.tsx', { react: hooks, 'next/navigation': { useRouter: () => ({ refresh() {} }) }, '@/lib/locale': { translate: (locale, en, ar) => locale === 'ar' ? ar : en }, '../detail-input': detailInput, '../form': { TransferForm: 'transfer-form' } }, { window: { print() { printed++; } }, requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame(id) { frames.delete(id); }, async fetch(url, options) { fetches++; assert.equal(url, `/api/inventory/transfers/${printable.id}?tenantId=${tenantId}`); assert.equal(options.cache, 'no-store'); return response; } });
 function render() { index = 0; const tree = mod.TransferDetail({ actorId, initial: printable, locale: 'en' }); effects.splice(0).forEach(fn => fn()); return tree; }
 function descendants(element) { return [element, ...React.Children.toArray(element?.props?.children).flatMap(child => React.isValidElement(child) ? descendants(child) : [])]; }
 return { render, descendants, click(tree) { descendants(tree).find(e => e.type === 'button').props.onClick(); }, get printed() { return printed; }, get fetches() { return fetches; }, flush() { const queued = [...frames.values()]; frames.clear(); queued.forEach(fn => fn()); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
const settlePrint = () => new Promise(resolve => setImmediate(resolve));
test('printing rechecks authorization and malformed or revoked responses never open print', async () => {
 for (const response of [{ ok: false, json: async () => ({ error: 'denied' }) }, { ok: true, json: async () => ({ transfer: { ...printable, createdBy: id(99) } }) }, { ok: true, json: async () => ({ transfer: { ...printable, corrections: undefined } }) }]) {
  const h = printHarness(response); let tree = h.render(); const beforeKey = h.descendants(tree).find(e => e.type === 'transfer-form').key;
  h.click(tree); await settlePrint(); tree = h.render(); h.flush(); assert.equal(h.printed, 0); assert.equal(h.fetches, 1); assert.ok(h.descendants(tree).some(e => e.props?.role === 'alert')); assert.equal(h.descendants(tree).find(e => e.type === 'transfer-form').key, beforeKey);
 }
});
test('printing refreshes corrections and current correction permission before DOM-committed print', async () => {
 const correction = { ...printable, id: id(30), correctsId: printable.id, sourceBranchId: printable.destinationBranchId, destinationBranchId: printable.sourceBranchId, reason: 'Corrected today' }; delete correction.canCorrect; delete correction.corrections;
 const h = printHarness({ ok: true, json: async () => ({ transfer: { ...printable, corrections: [correction], canCorrect: false } }) });
 let tree = h.render(); const beforeKey = h.descendants(tree).find(e => e.type === 'transfer-form').key; h.click(tree); await settlePrint(); assert.equal(h.printed, 0);
 tree = h.render(); const form = h.descendants(tree).find(e => e.type === 'transfer-form'); assert.equal(form.key, beforeKey); assert.equal(form.props.correction.canCorrect, false); assert.equal(form.props.correction.corrections[0].reason, 'Corrected today'); assert.equal(h.printed, 0); h.flush(); assert.equal(h.printed, 1);
 h.click(h.render()); await settlePrint(); h.render(); h.unmount(); h.flush(); assert.equal(h.printed, 1);
});

test('print validation rejects substituted immutable values and mismatched correction quantities', () => {
 for (const patch of [{ quantity: '9.000' }, { unit: 'box' }, { reference: 'OTHER' }, { reason: 'Changed reason' }, { createdAt: '2026-11-12T12:00:00.000Z' }]) assert.equal(detailInput.validatedTransferDetail({ ...printable, ...patch }, printable), null);
 const correction = { ...printable, id: id(30), correctsId: printable.id, sourceBranchId: printable.destinationBranchId, destinationBranchId: printable.sourceBranchId };
 for (const patch of [{ id: printable.id }, { quantity: '9.000' }, { unit: 'box' }, { reference: 'OTHER' }]) assert.equal(detailInput.validatedTransferDetail({ ...printable, canCorrect: false, corrections: [{ ...correction, ...patch }] }, printable), null);
});


test('Arabic stock reports localize both transfer directions without exposing raw enum labels', () => {
 const report = { basis: 'RECORDED_MOVEMENTS_ONLY', undatedOpeningOffset: null, from: '2026-11-11', to: '2026-11-11', timeZone: 'UTC', item: { sku: 'SKU', name: 'Item', unit: 'each', archivedAt: null }, summary: { opening: '0.000', incoming: '2.500', outgoing: '2.500', closing: '0.000', count: 2 }, rows: ['TRANSFER_IN', 'TRANSFER_OUT'].map((type, i) => ({ id: id(50 + i), timestamp: '2026-11-11 12:00:00', type, delta: i ? '-2.500' : '2.500', balance: i ? '0.000' : '2.500', reason: 'Branch stock transfer' })) };
 const hooks = { ...React, useState(initial) { return [initial === null ? report : initial, () => {}]; } };
 const mod = load('src/app/inventory/stock/report.tsx', { react: hooks, '@/lib/locale': { translate: (locale, en, ar) => locale === 'ar' ? ar : en } });
 const html = renderToStaticMarkup(React.createElement(mod.StockReport, { scope: { tenantId, companyId, branchId: id(5) }, items: [], locale: 'ar' }));
 assert.match(html, /تحويل مخزون وارد/); assert.match(html, /تحويل مخزون صادر/); assert.doesNotMatch(html, /TRANSFER_IN|TRANSFER_OUT/);
});


test('stock report warns in both languages only for a nonzero undated opening offset', () => {
 const base = { basis: 'RECORDED_MOVEMENTS_ONLY', from: '2026-11-11', to: '2026-11-11', timeZone: 'UTC', item: { sku: 'SKU', name: 'Item', unit: 'each', archivedAt: null }, summary: { opening: '0.000', incoming: '0.000', outgoing: '1.000', closing: '-1.000', count: 1 }, rows: [] };
 for (const locale of ['en', 'ar']) for (const offset of [null, '0.000', '2.000', '-2.000']) {
  const report = { ...base, undatedOpeningOffset: offset }, hooks = { ...React, useState(initial) { return [initial === null ? report : initial, () => {}]; } };
  const mod = load('src/app/inventory/stock/report.tsx', { react: hooks, '@/lib/locale': { translate: (language, en, ar) => language === 'ar' ? ar : en } });
  const html = renderToStaticMarkup(React.createElement(mod.StockReport, { scope: { tenantId, companyId, branchId: id(5) }, items: [], locale }));
  const warning = locale === 'en' ? /not historical physical balances/ : /ليست أرصدة فعلية تاريخية/;
  if (offset === null || offset === '0.000') assert.doesNotMatch(html, warning); else { assert.match(html, warning); assert.ok(html.includes(offset)); }
  assert.match(html, /-1.000/);
 }
});
