import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as reportPresets from "../src/lib/report-presets.ts";
import * as localeModule from "../src/lib/locale.ts";

const require = createRequire(import.meta.url);
const filename = new URL("../src/app/saved-reports/workspace.tsx", import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  fileName: filename.pathname,
});
const actorId = randomUUID();
const tenantId = randomUUID();
const branchId = randomUUID();
const secondBranchId = randomUUID();
const statuses = {
  INVOICE_REGISTER: ["DRAFT", "ISSUED", "VOID"],
  EXPENSE_REGISTER: ["DRAFT", "POSTED", "VOID"],
  QUOTE_REGISTER: ["DRAFT", "SENT", "ACCEPTED", "REJECTED"],
  SALES_ORDER_REGISTER: ["NEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
  PURCHASE_ORDER_REGISTER: ["DRAFT", "ISSUED", "RECEIVED", "CANCELLED"],
};
const options = [
  { tenantId, companyId: randomUUID(), label: "First company", kinds: ["CUSTOMER_AGING", ...Object.keys(statuses), "SUPPLIER_BALANCES"].map(kind => ({ kind, branches: [{ id: branchId, name: "First branch" }] })) },
  { tenantId: randomUUID(), companyId: randomUUID(), label: "Second company", kinds: ["QUOTE_REGISTER", "CUSTOMER_AGING"].map(kind => ({ kind, branches: [{ id: secondBranchId, name: "Second branch" }] })) },
];
const initial = { companyIndex: 0, kind: "INVOICE_REGISTER", branchId: "", dateMode: "CURRENT_MONTH_UTC", asOf: "2026-11-09", from: "2026-11-01", to: "2026-11-09", status: "", q: "" };
const labels = {
  en: { company: "Company", kind: "Report type", branch: "Source branch", name: "Preset name", mode: "Date rule", status: "Status", from: "From (UTC)", to: "To (UTC)", asOf: "As of (UTC)", search: "Register search", retry: "Retry same request", edit: "Edit filters", archive: "Archive", restore: "Restore" },
  ar: { company: "الشركة", kind: "نوع التقرير", branch: "فرع المستند", name: "اسم الإعداد المحفوظ", mode: "قاعدة التاريخ", status: "الحالة", from: "من (UTC)", to: "إلى (UTC)", asOf: "حتى تاريخ (UTC)", search: "بحث السجل", retry: "إعادة الطلب نفسه", edit: "تعديل الفلاتر", archive: "أرشفة", restore: "استعادة" },
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(data = {}, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}
function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}
function textOf(element) {
  if (typeof element === "string" || typeof element === "number") return String(element);
  return React.Children.toArray(element?.props?.children).map(textOf).join("");
}

// Exercise the real component and Zod parsers with React elements, deterministic
// hook rerenders, effect cleanup, storage and fetch. No browser or added package.
function workspace(config = {}) {
  let props = { options, actorId, locale: "en", initial, ...config.props };
  const slots = [], effects = new Map(), calls = [];
  const storage = new Map(config.cache ? [["erp-saved-report:v1:" + props.actorId, config.cache]] : []);
  let cursor = 0, dirty = true, tree;
  const hooks = {
    useState(value) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof value === "function" ? value() : value };
      return [slots[index].value, next => {
        const value = typeof next === "function" ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(value) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: { current: value } };
      return slots[index].value;
    },
    useCallback(callback, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) slots[index] = {deps, callback};
      return slots[index].callback;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.set(index, effect);
      }
    },
  };
  const sessionStorage = {
    getItem(key) { if (config.storageError) throw new Error("Storage unavailable"); return storage.get(key) ?? null; },
    setItem(key, value) { if (config.storageError) throw new Error("Storage unavailable"); storage.set(key, value); },
    removeItem(key) { if (config.storageError) throw new Error("Storage unavailable"); storage.delete(key); },
  };
  const fetch = (url, init = {}) => {
    const call = { url, ...init };
    calls.push(call);
    try {
      return Promise.resolve(init.method
        ? config.mutate?.(call, calls.filter(call => call.method).length) ?? response()
        : config.list?.(call, calls.filter(call => !call.method).length) ?? response({ presets: [], nextPage: null }));
    } catch (error) { return Promise.reject(error); }
  };
  const overrides = { react: hooks, "@/lib/report-presets": reportPresets, "@/lib/locale": localeModule, "./saved.module.css": { default: { workspace: "workspace", list: "list" } } };
  const exports = {};
  new Function("require", "exports", "sessionStorage", "fetch", "crypto", outputText)(
    name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), exports, sessionStorage, fetch, { randomUUID },
  );
  function renderOnly() {
    cursor = 0; dirty = false;
    tree = exports.SavedReportsWorkspace(props);
    return tree;
  }
  function commit() {
    for (let count = 0; count < 30; count++) {
      if (dirty || !tree) renderOnly();
      const pending = [...effects];
      effects.clear();
      for (const [index, effect] of pending) {
        slots[index].cleanup?.();
        slots[index].cleanup = effect();
      }
      if (!dirty && !effects.size) return tree;
    }
    assert.fail("Workspace hook effects did not settle");
  }
  const view = {
    calls, storage, commit, renderOnly,
    get tree() { return tree; },
    get mutations() { return calls.filter(call => call.method); },
    get lists() { return calls.filter(call => !call.method); },
    get cache() { return storage.get("erp-saved-report:v1:" + props.actorId); },
    get html() { return renderToStaticMarkup(tree); },
    elements(type) { return descendants(tree).filter(element => element.type === type); },
    control(label) {
      const element = descendants(tree).find(element => element.type === "label" && textOf(element.props.children[0]) === label);
      assert.ok(element, `Missing control label: ${label}`);
      const control = descendants(element).find(element => element.type === "input" || element.type === "select");
      assert.ok(control, `Missing input for ${label}`);
      return control;
    },
    button(label) {
      const button = descendants(tree).find(element => element.type === "button" && textOf(element) === label);
      assert.ok(button, `Missing button: ${label}`);
      return button;
    },
    change(label, value) {
      const control = this.control(label);
      assert.notEqual(control.props.disabled, true, `Cannot change disabled control: ${label}`);
      control.props.onChange({ target: { value } });
      commit();
    },
    click(label) {
      const button = this.button(label);
      assert.notEqual(button.props.disabled, true, `Cannot activate disabled button: ${label}`);
      const result = button.props.onClick();
      commit();
      return result;
    },
    submit() {
      const result = this.elements("form")[0].props.onSubmit({ preventDefault() {} });
      commit();
      return result;
    },
    async settle() {
      for (let count = 0; count < 16; count++) { await Promise.resolve(); commit(); }
      return this;
    },
    updateProps(update) { props = { ...props, ...update }; dirty = true; commit(); },
  };
  commit();
  return view;
}

function preset(overrides = {}) {
  return { id: randomUUID(), tenantId, companyId: options[0].companyId, branchId, kind: "INVOICE_REGISTER", name: "Private register", dateMode: "FIXED_RANGE", asOf: null, from: "2026-10-01", to: "2026-10-31", status: "ISSUED", q: "ACME & reference", version: 7, archivedAt: null, updatedAt: "2026-11-01T00:00:00.000Z", ...overrides };
}
function optionValues(control) {
  return descendants(control).filter(element => element.type === "option").map(element => element.props.value);
}
function assertLocked(view, locale = "en") {
  const t = labels[locale];
  for (const label of [t.company, t.kind, t.branch, t.name, t.mode]) assert.equal(view.control(label).props.disabled, true, label);
  assert.ok(view.elements("input").every(input => input.props.disabled));
}

test("English and Arabic register controls expose the exact statuses and range rules for all five document types", async () => {
  for (const locale of ["en", "ar"]) {
    const t = labels[locale];
    for (const [kind, expectedStatuses] of Object.entries(statuses)) {
      const view = await workspace({ props: { locale, initial: { ...initial, kind } } }).settle();
      assert.deepEqual(optionValues(view.control(t.status)), ["", ...expectedStatuses]);
      assert.deepEqual(optionValues(view.control(t.mode)), ["CURRENT_MONTH_UTC", "PREVIOUS_MONTH_UTC", "FIXED_RANGE"]);
      assert.match(view.html, locale === "ar" ? /الإعدادات خاصة بحسابك/ : /Presets are private to your account/);
      assert.match(view.html, locale === "ar" ? /حتى 366 يوماً و5000 سجل/ : /Maximum 366 days and 5000 records/);
      assert.match(view.html, locale === "ar" ? /كل الحالات/ : /All statuses/);
      assert.doesNotMatch(view.html, /undefined/);
      if (locale === "ar") assert.ok(descendants(view.control(t.status)).filter(element => element.type === "option" && element.props.value).every(element => !textOf(element).match(/^[A-Z_]+$/)));
      view.change(t.mode, "FIXED_RANGE");
      assert.equal(view.control(t.from).props.type, "date");
      assert.equal(view.control(t.to).props.required, true);
      assert.equal(view.control(t.search).props.maxLength, 120);
    }
  }
});

test("switching report families resets incompatible rules, status and branch without leaking register fields into legacy saves", async () => {
  const view = await workspace({ props: { initial: { ...initial, kind: "CUSTOMER_AGING", dateMode: "FIXED", branchId } } }).settle();
  assert.deepEqual(optionValues(view.control("Date rule")), ["TODAY_UTC", "PREVIOUS_MONTH_END_UTC", "FIXED"]);
  assert.equal(view.control("As of (UTC)").props.value, initial.asOf);
  view.change("Report type", "INVOICE_REGISTER");
  assert.equal(view.control("Date rule").props.value, "CURRENT_MONTH_UTC");
  assert.equal(view.control("Source branch").props.value, "");
  view.change("Status", "ISSUED");
  view.change("Date rule", "FIXED_RANGE");
  view.change("Source branch", branchId);
  view.change("Report type", "EXPENSE_REGISTER");
  assert.equal(view.control("Date rule").props.value, "FIXED_RANGE");
  assert.equal(view.control("Status").props.value, "");
  assert.equal(view.control("Source branch").props.value, "");
  view.change("Status", "POSTED");
  view.change("Report type", "SUPPLIER_BALANCES");
  assert.equal(view.control("Date rule").props.value, "TODAY_UTC");
  assert.ok(!view.elements("label").some(label => textOf(label).startsWith("Status")));
  view.change("Date rule", "FIXED");
  view.change("Preset name", "Supplier balances");
  await view.submit(); await view.settle();
  const payload = JSON.parse(view.mutations[0].body);
  assert.equal(payload.kind, "SUPPLIER_BALANCES");
  assert.equal(payload.asOf, initial.asOf);
  for (const field of ["from", "to", "status"]) assert.equal(Object.hasOwn(payload, field), false, field);
});

test("new range and relative presets send the selected register filters with explicit null relative dates", async () => {
  for (const dateMode of ["FIXED_RANGE", "CURRENT_MONTH_UTC", "PREVIOUS_MONTH_UTC"]) {
    const view = await workspace({ props: { initial: { ...initial, kind: "SALES_ORDER_REGISTER", dateMode, status: "IN_PROGRESS", branchId, q: "Order & client" } } }).settle();
    view.change("Preset name", "  Active sales orders  ");
    await view.submit(); await view.settle();
    assert.equal(view.mutations.length, 1);
    const { requestId, ...body } = JSON.parse(view.mutations[0].body);
    assert.match(requestId, /^[\da-f-]{36}$/i);
    assert.deepEqual(body, { tenantId, companyId: options[0].companyId, branchId, kind: "SALES_ORDER_REGISTER", name: "Active sales orders", dateMode, asOf: null, q: "Order & client", from: dateMode === "FIXED_RANGE" ? initial.from : null, to: dateMode === "FIXED_RANGE" ? initial.to : null, status: "IN_PROGRESS" });
    assert.equal(view.cache, undefined);
    assert.match(view.html, /Saved report updated successfully/);
  }
});

test("invalid register ranges and type-mismatched statuses never reach the save endpoint", async () => {
  for (const change of [{ from: "2026-11-10", to: "2026-11-09" }, { from: "2025-11-01", to: "2026-11-02" }, { from: "2026-02-30" }, { status: "POSTED" }]) {
    const view = await workspace({ props: { initial: { ...initial, dateMode: "FIXED_RANGE", ...change } } }).settle();
    view.change("Preset name", "Invalid filters");
    await view.submit(); await view.settle();
    assert.equal(view.mutations.length, 0);
    assert.equal(view.cache, undefined);
    assert.match(view.html, /Check the name, date and search filters/);
  }
});

test("old v1 and new range caches restore their scope and retry the unchanged original body and ID", async () => {
  for (const range of [false, true]) {
    for (const mode of ["create", "update"]) {
      const scope = { tenantId: options[1].tenantId, companyId: options[1].companyId, branchId: secondBranchId, kind: range ? "QUOTE_REGISTER" : "CUSTOMER_AGING" };
      const fields = { name: "Recovered filters", dateMode: range ? "FIXED_RANGE" : "FIXED", asOf: range ? null : "2024-02-29", q: "Client & reference", ...(range ? { from: "2026-10-01", to: "2026-10-31", status: "ACCEPTED" } : {}) };
      const payload = mode === "create"
        ? reportPresets.createReportInput.parse({ ...scope, ...fields, requestId: randomUUID() })
        : reportPresets.updateReportInput.parse({ tenantId: scope.tenantId, ...fields, archived: true, expectedVersion: 4, requestId: randomUUID() });
      const request = mode === "create" ? { mode, payload } : { mode, id: randomUUID(), payload };
      const pending = { version: 1, actorId, scope, request };
      const view = await workspace({ cache: JSON.stringify(pending), mutate: (_call, number) => number === 1 ? response({ error: "Result uncertain" }, 503) : response() }).settle();
      assert.equal(view.control("Company").props.value, 1);
      assert.equal(view.control("Report type").props.value, scope.kind);
      assert.equal(view.control("Source branch").props.value, secondBranchId);
      assert.equal(view.control("Preset name").props.value, fields.name);
      assert.equal(view.control(range ? "From (UTC)" : "As of (UTC)").props.value, range ? fields.from : fields.asOf);
      if (range) assert.equal(view.control("Status").props.value, "ACCEPTED");
      assertLocked(view);
      assert.equal(view.mutations.length, 0, "Restoring a cache must not submit it automatically");
      await view.click("Retry same request"); await view.settle();
      assertLocked(view);
      assert.deepEqual(JSON.parse(view.cache), pending);
      assert.match(view.html, /could not confirm the outcome/);
      assert.doesNotMatch(view.html, /Result uncertain/);
      await view.click("Retry same request"); await view.settle();
      assert.equal(view.mutations.length, 2);
      for (const call of view.mutations) {
        assert.equal(call.method, mode === "create" ? "POST" : "PATCH");
        assert.equal(call.url, "/api/saved-reports" + (mode === "update" ? "/" + request.id : ""));
        assert.equal(call.body, JSON.stringify(payload));
        assert.deepEqual(call.headers, { "Content-Type": "application/json" });
      }
      assert.equal(view.cache, undefined);
      assert.equal(view.control("Company").props.disabled, false);
    }
  }
});

test("network uncertainty and repeated activation keep one request in flight and retry its exact persisted body", async () => {
  const first = deferred(), retry = deferred();
  const view = await workspace({ mutate: (_call, number) => number === 1 ? first.promise : retry.promise }).settle();
  view.change("Preset name", "Never duplicate");
  const submit = view.elements("form")[0].props.onSubmit;
  const firstAttempt = submit({ preventDefault() {} });
  const duplicateAttempt = submit({ preventDefault() {} });
  view.commit();
  assert.equal(view.mutations.length, 1, "Guard must apply before React rerenders disabled controls");
  const originalBody = view.mutations[0].body;
  assert.deepEqual(JSON.parse(view.cache).request.payload, JSON.parse(originalBody));
  assertLocked(view);
  assert.equal(view.button("Retry same request").props.disabled, true);
  first.reject(new Error("Network disconnected after submission"));
  await Promise.all([firstAttempt, duplicateAttempt]); await view.settle();
  assertLocked(view);
  assert.match(view.html, /outcome could not be verified/);
  assert.doesNotMatch(view.html, /Network disconnected after submission/);
  const activateRetry = view.button("Retry same request").props.onClick;
  const retryAttempt = activateRetry(), duplicateRetry = activateRetry();
  view.commit();
  assert.equal(view.mutations.length, 2);
  assert.equal(view.mutations[1].body, originalBody);
  assert.equal(view.mutations[1].url, view.mutations[0].url);
  assert.equal(view.button("Discard request and reload list").props.disabled, true);
  retry.resolve(response());
  await Promise.all([retryAttempt, duplicateRetry]); await view.settle();
  assert.equal(view.cache, undefined);
  assert.equal(view.control("Preset name").props.value, "");
  assert.equal(view.control("Company").props.disabled, false);
});

test("editing freezes company, report kind and branch, and uncertain updates retain the original record and version", async () => {
  const item = preset();
  const view = await workspace({ list: () => response({ presets: [item], nextPage: null }), mutate: (_call, number) => number === 1 ? response({ error: "Unconfirmed edit" }, 500) : response() }).settle();
  view.click("Edit filters");
  for (const label of ["Company", "Report type", "Source branch"]) assert.equal(view.control(label).props.disabled, true, label);
  assert.equal(view.control("Report type").props.value, item.kind);
  assert.equal(view.control("Source branch").props.value, item.branchId);
  assert.equal(view.control("From (UTC)").props.value, item.from);
  assert.equal(view.control("Status").props.value, item.status);
  assert.equal(view.control("Preset name").props.disabled, false);
  view.change("Preset name", "Edited register");
  view.change("Status", "VOID");
  await view.submit(); await view.settle();
  assertLocked(view);
  assert.equal(view.button("Cancel editing").props.disabled, true);
  const call = view.mutations[0], body = JSON.parse(call.body);
  assert.equal(call.url, "/api/saved-reports/" + item.id);
  assert.equal(call.method, "PATCH");
  assert.equal(body.expectedVersion, item.version);
  assert.equal(body.tenantId, item.tenantId);
  assert.equal(body.name, "Edited register");
  assert.equal(body.status, "VOID");
  assert.equal(body.from, item.from);
  assert.equal(body.to, item.to);
  assert.equal(body.archived, false);
  for (const field of ["companyId", "branchId", "kind"]) assert.equal(Object.hasOwn(body, field), false, field);
  await view.click("Retry same request"); await view.settle();
  assert.equal(view.mutations[1].body, call.body);
  assert.equal(view.mutations[1].url, call.url);
  assert.equal(view.cache, undefined);
});

test("archiving and restoring every register type preserve dates, status, search and optimistic version", async () => {
  for (const [kind, allowedStatuses] of Object.entries(statuses)) {
    for (const archived of [false, true]) {
      const item = preset({ kind, status: allowedStatuses[1], archivedAt: archived ? "2026-11-01T00:00:00.000Z" : null, ...(archived ? { dateMode: "PREVIOUS_MONTH_UTC", from: null, to: null } : {}) });
      const view = await workspace({ list: () => response({ presets: [item], nextPage: null }) }).settle();
      await view.click(archived ? "Restore" : "Archive"); await view.settle();
      assert.equal(view.mutations.length, 1);
      const call = view.mutations[0], { requestId, ...body } = JSON.parse(call.body);
      assert.match(requestId, /^[\da-f-]{36}$/i);
      assert.equal(call.method, "PATCH");
      assert.equal(call.url, "/api/saved-reports/" + item.id);
      assert.deepEqual(body, { tenantId: item.tenantId, name: item.name, dateMode: item.dateMode, asOf: item.asOf, q: item.q, from: item.from, to: item.to, status: item.status, expectedVersion: item.version, archived: !archived });
    }
  }
});

test("company changes hide the prior list before effects and discard late responses from abandoned scopes", async () => {
  const old = preset({ name: "Old company register" });
  const stale = preset({ tenantId: options[1].tenantId, companyId: options[1].companyId, branchId: secondBranchId, kind: "QUOTE_REGISTER", status: "SENT", name: "Abandoned company response" });
  const fresh = preset({ name: "Fresh authorized response" });
  const otherList = deferred(), refreshedList = deferred();
  const view = await workspace({ list: (_call, number) => number === 1 ? response({ presets: [old], nextPage: 1 }) : number === 2 ? otherList.promise : refreshedList.promise }).settle();
  assert.match(view.html, /Old company register/);
  assert.equal(view.button("Next").props.disabled, false);
  view.control("Company").props.onChange({ target: { value: "1" } });
  view.renderOnly();
  assert.doesNotMatch(view.html, /Old company register|\/api\/saved-reports\/.*\/open/);
  assert.equal(view.button("Next").props.disabled, true);
  assert.equal(view.control("Report type").props.value, "QUOTE_REGISTER");
  assert.equal(view.control("Date rule").props.value, "CURRENT_MONTH_UTC");
  view.commit();
  assert.equal(new URL(view.lists[1].url, "https://erp.invalid").searchParams.get("companyId"), options[1].companyId);
  view.change("Company", "0");
  assert.equal(view.lists[1].signal.aborted, true);
  otherList.resolve(response({ presets: [stale], nextPage: 4 }));
  await view.settle();
  assert.doesNotMatch(view.html, /Old company register|Abandoned company response/);
  assert.equal(view.button("Next").props.disabled, true);
  refreshedList.resolve(response({ presets: [fresh], nextPage: null }));
  await view.settle();
  assert.match(view.html, /Fresh authorized response/);
  assert.doesNotMatch(view.html, /Old company register|Abandoned company response/);
  const links = view.elements("a");
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, `/api/saved-reports/${fresh.id}/open?tenantId=${fresh.tenantId}`);
});

test("foreign actor, removed company, inaccessible branch and corrupt caches are discarded without replay", async () => {
  const scope = { tenantId, companyId: options[0].companyId, branchId, kind: "INVOICE_REGISTER" };
  const payload = reportPresets.createReportInput.parse({ ...scope, name: "Untrusted cache", dateMode: "CURRENT_MONTH_UTC", asOf: null, q: "", from: null, to: null, status: null, requestId: randomUUID() });
  const pending = { version: 1, actorId, scope, request: { mode: "create", payload } };
  for (const cache of ["invalid JSON", JSON.stringify({ ...pending, actorId: randomUUID() }), ...["companyId", "branchId"].map(field => {
    const id = randomUUID();
    return JSON.stringify({ ...pending, scope: { ...scope, [field]: id }, request: { mode: "create", payload: { ...payload, [field]: id } } });
  })]) {
    const view = await workspace({ cache }).settle();
    assert.equal(view.cache, undefined);
    assert.equal(view.mutations.length, 0);
    assert.equal(view.control("Preset name").props.value, "");
    assert.equal(view.control("Company").props.disabled, false);
    assert.doesNotMatch(view.html, /Save result is unconfirmed/);
  }
});

test("storage failure warns in both languages while preserving an uncertain request for an in-memory retry", async () => {
  for (const locale of ["en", "ar"]) {
    const t = labels[locale];
    const view = await workspace({ storageError: true, props: { locale }, mutate: (_call, number) => number === 1 ? response({ error: "Uncertain" }, 503) : response() }).settle();
    assert.match(view.html, locale === "ar" ? /التخزين في علامة التبويب غير متاح/ : /Tab storage is unavailable/);
    view.change(t.name, "Storage unavailable report");
    await view.submit(); await view.settle();
    assertLocked(view, locale);
    assert.equal(view.mutations.length, 1);
    await view.click(t.retry); await view.settle();
    assert.equal(view.mutations.length, 2);
    assert.equal(view.mutations[1].body, view.mutations[0].body);
    assert.equal(view.control(t.company).props.disabled, false);
  }
});

test('AR/EN unknown mutation outcomes and failed JSON preserve exact pending bodies and safe notices', async () => {
 for(const language of ['ar','en'])for(const failure of ['unknown','json','network']){
  const t=labels[language];
  const view=await workspace({props:{locale:language},mutate:(_call,number)=>{
   if(number>1)return response();
   if(failure==='network')throw new Error('SECRET transport details');
   if(failure==='json')return {ok:true,status:200,json:async()=>{throw new SyntaxError('SECRET invalid JSON');}};
   return response({code:'FUTURE_UNKNOWN',error:'SECRET internal details'},503);
  }}).settle();
  view.change(t.name,'Human title must stay unchanged');await view.submit();await view.settle();assertLocked(view,language);
  assert.ok(view.cache);assert.doesNotMatch(view.html,/SECRET|SyntaxError|TypeError/);
  assert.match(view.html,language==='ar'?/تعذر.*النتيجة/:/could not.*(outcome|verified)/);
  const original=view.mutations[0].body;
  await view.click(t.retry);await view.settle();assert.equal(view.mutations.length,2);assert.equal(view.mutations[1].body,original);assert.equal(view.cache,undefined);
 }
});
