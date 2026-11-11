import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(file, overrides = {}, fetch) {
  const filename = new URL(`../src/${file}`, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 }, fileName: filename.pathname,
  });
  const exports = {};
  new Function("require", "exports", "fetch", outputText)(name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), exports, fetch);
  return exports;
}
const presets = load("lib/report-presets.ts"), localeModule = load("lib/locale.ts");
const tenantId = "11111111-1111-4111-8111-111111111111", companyId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333", otherBranch = "44444444-4444-4444-8444-444444444444";
const actorId = "55555555-5555-4555-8555-555555555555", otherCompany = "66666666-6666-4666-8666-666666666666";
const scope = { tenantId, companyId, branches: [{ id: branchId, name: "Muscat" }] };
const initial = { from: "2026-11-01", to: "2026-11-09", branchId, status: "ISSUED", q: "عميل + &/ ? # %" };
const baseProps = { kind: "invoices", scope, locale: "en" };
const pageQuery = { tenantId, companyId, kind: "INVOICE_REGISTER", ...initial };
const result = (count = 7) => ({ from: initial.from, to: initial.to, count, summary: [{ status: "ISSUED", currency: "OMR", count, amount: "123.456" }], categories: [], suppliers: [] });
function descendants(element) {
  return [element, ...React.Children.toArray(element?.props?.children).flatMap(child => React.isValidElement(child) ? descendants(child) : [])];
}
function elements(tree, type) { return descendants(tree).filter(element => element.type === type); }
function links(tree) { return elements(tree, "a").map(element => element.props.href); }
function pendingFetch() {
  const calls = [];
  const fetch = (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject }));
  return { calls, fetch, async respond(index, data = result(), ok = true) {
    calls[index].resolve({ ok, json: async () => data });
    await new Promise(resolve => setImmediate(resolve));
  }, async reject(index) {
    calls[index].reject(new Error("Network unavailable"));
    await new Promise(resolve => setImmediate(resolve));
  } };
}

// Run the real TSX and real effect bodies, with deterministic hooks and request timing.
// Keep old instances observable so tests also detect writes after unmount, even when fetch ignores AbortSignal.
function reportHarness(props, fetch) {
  let active, current, node, tree;
  const instances = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hook = () => [active, active.cursor++];
  const mockReact = { ...React,
    useState(initialValue) {
      const [instance, index] = hook();
      if (!(index in instance.slots)) instance.slots[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [instance.slots[index], value => {
        instance.writes++;
        const next = typeof value === "function" ? value(instance.slots[index]) : value;
        if (!Object.is(next, instance.slots[index])) { instance.slots[index] = next; instance.dirty = true; }
      }];
    },
    useRef(value) {
      const [instance, index] = hook();
      if (!(index in instance.slots)) instance.slots[index] = { current: value };
      return instance.slots[index];
    },
    useCallback(callback, deps) {
      const [instance, index] = hook(), previous = instance.slots[index];
      if (!previous || !same(previous.deps, deps)) instance.slots[index] = { callback, deps };
      return instance.slots[index].callback;
    },
    useEffect(effect, deps) {
      const [instance, index] = hook(), previous = instance.slots[index];
      if (!previous || !same(previous.deps, deps)) {
        const next = { deps, effect, cleanup: previous?.cleanup };
        instance.slots[index] = next;
        instance.effects.push(() => { next.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  const screen = load("app/accounting/financial-report.tsx", { react: mockReact, "@/lib/locale": localeModule, "@/lib/report-presets": presets }, fetch);
  function cleanup() { for (const slot of current?.slots ?? []) slot?.cleanup?.(); }
  function flush() {
    let rounds = 0;
    do {
      assert.ok(rounds++ < 10, "render effects should settle");
      current.dirty = false; current.cursor = 0; active = current;
      tree = node.type(node.props); active = undefined;
      const effects = current.effects.splice(0); for (const effect of effects) effect();
    } while (current.dirty);
    return tree;
  }
  function navigate(nextProps) {
    const next = screen.FinancialReport(nextProps);
    if (!node || next.key !== node.key || next.type !== node.type) {
      cleanup();
      current = { slots: [], cursor: 0, effects: [], dirty: true, writes: 0 };
      instances.push(current);
    }
    node = next;
    return flush();
  }
  navigate(props);
  return { flush, navigate, unmount: cleanup, replayEffects() {
    for (const slot of current.slots) if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); }
    return flush();
  }, get tree() { return tree; }, instances,
    edit(values) {
      for (const [name, value] of Object.entries(values)) {
        const input = [...elements(tree, "input"), ...elements(tree, "select")].find(element => element.props.name === name);
        input.props.onChange({ target: { value: value ?? "" } });
      }
      flush();
    },
    submit(values) {
      this.edit(values);
      const form = elements(tree, "form")[0];
      assert.equal(form.props.action, undefined, "read-only filter submission must not use React's resetting form action");
      let prevented = false;
      const work = form.props.onSubmit({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      return work;
    } };
}

function pageHarness({ actor = { id: actorId }, locale = "en", visible = null, company = { name: "Company A", branches: scope.branches }, failure } = {}) {
  const calls = { visibility: [], company: [], redirects: [] };
  const Report = () => null;
  const Page = load("app/reports/register/page.tsx", {
    "next/navigation": { redirect(path) { calls.redirects.push(path); throw new Error(`REDIRECT:${path}`); } },
    "@/lib/auth": { currentUser: async () => actor }, "@/lib/server-locale": { getLocale: async () => locale },
    "@/lib/locale": localeModule, "@/lib/report-presets": presets,
    "@/lib/saved-reports": { reportVisibility: async (...args) => { calls.visibility.push(args); return visible; } },
    "@/lib/db": { db: { company: { findUnique: async input => { calls.company.push(input); if (failure) throw failure; return company; } } } },
    "../../language-switcher": { LanguageSwitcher: () => null }, "../../accounting/financial-report": { FinancialReport: Report },
  }).default;
  return { calls, Report, render: query => Page({ searchParams: Promise.resolve(query) }) };
}

test("embedded register forms retain manual loading, localized meanings, limits and each status list", () => {
  const headings = { invoices: ["Invoice register report", "تقرير سجل الفواتير"], expenses: ["Expense report", "تقرير المصاريف"], quotes: ["Quote register report", "تقرير عروض الأسعار"], orders: ["Sales order report", "تقرير طلبات البيع"], "purchase-orders": ["Purchase order report", "تقرير أوامر الشراء"] };
  const meanings = { invoices: [/not collections or recognized revenue/, /لا يمثل التحصيل/], expenses: [/deductible VAT is excluded from cost/, /الضريبة القابلة للخصم/], quotes: [/does not represent revenue or collections/, /لا يمثل الإيراد أو التحصيل/], orders: [/do not represent recognized revenue or payments/, /لا تمثل الإيراد المعترف به/], "purchase-orders": [/not a payable or payment report/, /لا يمثل الذمم أو المدفوعات/] };
  for (const [preset, kind] of Object.entries(presets.registerTypes)) for (const [index, locale] of ["en", "ar"].entries()) {
    const pending = pendingFetch(), view = reportHarness({ ...baseProps, kind, locale }, pending.fetch);
    const html = renderToStaticMarkup(view.tree);
    assert.match(html, new RegExp(headings[kind][index])); assert.match(html, meanings[kind][index]);
    assert.match(html, /366/); assert.match(html, /5000/);
    const status = elements(view.tree, "select").find(element => element.props.name === "status");
    assert.deepEqual(elements(status, "option").map(element => element.props.value), ["", ...presets.registerStatuses[preset]]);
    assert.equal(pending.calls.length, 0); assert.deepEqual(links(view.tree), []);
    assert.equal(elements(view.tree, "input").find(element => element.props.name === "from").props.value, "");
    view.unmount();
  }
});

test("a valid opening preset populates fields and auto-runs exactly once with no-store GET", async () => {
  const pending = pendingFetch(), view = reportHarness({ ...baseProps, initial }, pending.fetch);
  assert.equal(pending.calls.length, 1);
  const call = pending.calls[0], url = new URL(call.url, "https://erp.test");
  assert.equal(url.pathname, "/api/invoices/report"); assert.equal(call.options.cache, "no-store"); assert.equal(call.options.method, undefined);
  for (const [key, value] of Object.entries({ tenantId, companyId, ...initial })) assert.equal(url.searchParams.get(key), value);
  for (const element of [...elements(view.tree, "input"), ...elements(view.tree, "select")]) assert.equal(element.props.value, initial[element.props.name]);
  assert.equal(elements(view.tree, "button")[0].props.disabled, true);
  view.navigate({ ...baseProps, scope: { ...scope, branches: [...scope.branches] }, initial: { ...initial } });
  assert.equal(pending.calls.length, 1, "equivalent props do not rerun the request");
  await pending.respond(0); view.flush();
  assert.equal(elements(view.tree, "button")[0].props.disabled, false);
  assert.match(renderToStaticMarkup(view.tree), /123.456 OMR/);
  view.unmount();
});

test("successful filters alone drive encoded Save and CSV links, without writing a preset", async () => {
  for (const locale of ["en", "ar"]) {
    const pending = pendingFetch(), view = reportHarness({ ...baseProps, locale }, pending.fetch);
    const submitted = { ...initial, q: `  ${initial.q}  ` };
    const work = view.submit(submitted); view.flush();
    assert.deepEqual(links(view.tree), []);
    await pending.respond(0); await work; view.flush();
    const [save, csv] = links(view.tree), target = new URL(save, "https://erp.test"), csvUrl = new URL(csv, "https://erp.test");
    assert.equal(target.pathname, "/saved-reports"); assert.equal(target.searchParams.get("kind"), "INVOICE_REGISTER");
    assert.equal(target.searchParams.get("dateMode"), "FIXED_RANGE");
    for (const [key, value] of Object.entries({ tenantId, companyId, ...initial })) { assert.equal(target.searchParams.get(key), value); assert.equal(csvUrl.searchParams.get(key), value); }
    assert.equal(csvUrl.searchParams.get("format"), "csv"); assert.equal(target.hash, "");
    assert.match(save, /%26/); assert.match(save, /%23/); assert.match(save, /%25/);
    assert.match(renderToStaticMarkup(view.tree), locale === "ar" ? /حفظ هذه الفلاتر/ : /Save these filters/);
    // Submitted controlled inputs remain intact instead of resetting to old preset defaults.
    for (const input of [...elements(view.tree, "input"), ...elements(view.tree, "select")]) assert.equal(input.props.value, submitted[input.props.name]);
    // Subsequent edits do not replace the successful snapshot before the user runs another report.
    view.edit({ q: "Not sent", status: "VOID", from: "2026-11-03" });
    assert.equal(elements(view.tree, "input").find(element => element.props.name === "q").props.value, "Not sent");
    assert.equal(elements(view.tree, "select").find(element => element.props.name === "status").props.value, "VOID");
    assert.deepEqual(links(view.tree), [save, csv]);
    assert.equal(pending.calls.length, 1); assert.equal(pending.calls[0].url.startsWith("/api/invoices/report?"), true);
    view.unmount();
  }
});

test("save links preserve each report kind, omit unselected branch and status, and encode empty search", async () => {
  for (const [kind, endpoint] of Object.entries(presets.registerTypes)) {
    const pending = pendingFetch(), view = reportHarness({ ...baseProps, kind: endpoint, initial: { from: initial.from, to: initial.to } }, pending.fetch);
    await pending.respond(0, result(0)); view.flush();
    const target = new URL(links(view.tree)[0], "https://erp.test");
    assert.equal(target.searchParams.get("kind"), kind); assert.equal(target.searchParams.get("q"), "");
    assert.equal(target.searchParams.has("branchId"), false); assert.equal(target.searchParams.has("status"), false);
    assert.equal(new URL(pending.calls[0].url, "https://erp.test").pathname, `/api/${endpoint}/report`);
    assert.match(renderToStaticMarkup(view.tree), /No matching records/); view.unmount();
  }
});

test("invalid initial ranges, statuses, branches and searches never auto-fetch or expose a Save link", () => {
  for (const changes of [{ from: "2026-02-30" }, { to: "2026-10-31" }, { from: "2025-01-01", to: "2026-01-02" }, { branchId: otherBranch }, { status: "POSTED" }, { q: "x".repeat(121) }, { q: "nul\0search" }]) {
    const pending = pendingFetch(), view = reportHarness({ ...baseProps, initial: { ...initial, ...changes } }, pending.fetch);
    assert.equal(pending.calls.length, 0); assert.deepEqual(links(view.tree), []);
    assert.match(renderToStaticMarkup(view.tree), /Invalid report filters/); view.unmount();
  }
});

test("the inclusive 366-day maximum succeeds but a 367-day range is refused", async () => {
  const pending = pendingFetch(), view = reportHarness(baseProps, pending.fetch);
  const allowed = view.submit({ from: "2024-01-01", to: "2024-12-31" });
  assert.equal(pending.calls.length, 1); await pending.respond(0); await allowed; view.flush();
  await view.submit({ from: "2024-01-01", to: "2025-01-01" }); view.flush();
  assert.equal(pending.calls.length, 1); assert.deepEqual(links(view.tree), []); view.unmount();
});

test("a superseded response, error and finally cannot overwrite the newer report or busy state", async () => {
  for (const staleOutcome of ["success", "error", "reject"]) {
    const pending = pendingFetch(), view = reportHarness(baseProps, pending.fetch);
    const old = view.submit(initial), newer = view.submit({ ...initial, q: "Newest" }); view.flush();
    assert.equal(pending.calls[0].options.signal.aborted, true);
    if (staleOutcome === "reject") await pending.reject(0);
    else await pending.respond(0, staleOutcome === "error" ? { error: "Private old failure" } : result(99), staleOutcome !== "error");
    await old; view.flush();
    assert.deepEqual(links(view.tree), []); assert.equal(elements(view.tree, "button")[0].props.disabled, true);
    assert.doesNotMatch(renderToStaticMarkup(view.tree), /Private old failure|99/);
    await pending.respond(1, result(2)); await newer; view.flush();
    assert.equal(new URL(links(view.tree)[0], "https://erp.test").searchParams.get("q"), "Newest");
    assert.equal(elements(view.tree, "button")[0].props.disabled, false); view.unmount();
  }
});

test("late JSON parsing from an older response cannot replace already completed newer results", async () => {
  const pending = pendingFetch(), view = reportHarness(baseProps, pending.fetch);
  const old = view.submit(initial);
  let releaseJSON;
  pending.calls[0].resolve({ ok: true, json: () => new Promise(resolve => { releaseJSON = resolve; }) });
  await new Promise(resolve => setImmediate(resolve));
  const newer = view.submit({ ...initial, q: "Second report" });
  await pending.respond(1, result(3)); await newer; view.flush();
  const successfulLinks = links(view.tree); releaseJSON(result(999)); await old; view.flush();
  assert.deepEqual(links(view.tree), successfulLinks); assert.doesNotMatch(renderToStaticMarkup(view.tree), /999/); view.unmount();
});

test("scope, kind, branch-permission and preset navigation remount inputs and block stale writes", async () => {
  const variants = [
    { scope: { ...scope, companyId: otherCompany } },
    { scope: { ...scope, tenantId: otherCompany } },
    { kind: "purchase-orders" },
    { scope: { ...scope, branches: [...scope.branches, { id: otherBranch, name: "Salalah" }] } },
    { initial: { ...initial, q: "Different preset" } },
  ];
  for (const changes of variants) {
    const pending = pendingFetch(), view = reportHarness({ ...baseProps, initial }, pending.fetch);
    const oldInstance = view.instances[0]; view.navigate({ ...baseProps, initial, ...changes });
    assert.equal(view.instances.length, 2); assert.equal(pending.calls[0].options.signal.aborted, true);
    const oldWrites = oldInstance.writes; assert.deepEqual(links(view.tree), []);
    await pending.respond(0, result(999)); view.flush();
    assert.equal(oldInstance.writes, oldWrites, "old request did not write state after cleanup");
    assert.deepEqual(links(view.tree), []); assert.equal(elements(view.tree, "button")[0].props.disabled, true);
    await pending.respond(1, result(4)); view.flush();
    const save = new URL(links(view.tree)[0], "https://erp.test");
    assert.equal(save.searchParams.get("companyId"), changes.scope?.companyId ?? companyId);
    assert.equal(save.searchParams.get("tenantId"), changes.scope?.tenantId ?? tenantId);
    assert.equal(save.searchParams.get("q"), changes.initial?.q ?? initial.q);
    assert.doesNotMatch(renderToStaticMarkup(view.tree), /999/); view.unmount();
  }
});

test("navigation clears completed results immediately, and browser-style back navigation reruns its preset", async () => {
  const pending = pendingFetch(), first = { ...baseProps, initial }, view = reportHarness(first, pending.fetch);
  await pending.respond(0); view.flush(); assert.equal(links(view.tree).length, 2);
  view.navigate({ ...first, scope: { ...scope, companyId: otherCompany } });
  assert.deepEqual(links(view.tree), []); assert.equal(pending.calls.length, 2);
  view.navigate(first); assert.deepEqual(links(view.tree), []); assert.equal(pending.calls.length, 3);
  assert.equal(pending.calls[1].options.signal.aborted, true);
  await pending.respond(2, result(5)); view.flush(); const currentLinks = links(view.tree);
  await pending.respond(1, result(888)); view.flush(); assert.deepEqual(links(view.tree), currentLinks);
  assert.equal(new URL(currentLinks[0], "https://erp.test").searchParams.get("companyId"), companyId); view.unmount();
});

test("HTTP and network failures show no Save or CSV links, with localized connection errors", async () => {
  for (const locale of ["en", "ar"]) {
    const pending = pendingFetch(), view = reportHarness({ ...baseProps, locale, initial }, pending.fetch);
    await pending.respond(0); view.flush(); assert.equal(links(view.tree).length, 2);
    const invalid = view.submit({ ...initial, q: "Too broad" }); view.flush();
    await pending.respond(1, { code: "RESULT_LIMIT", error: "Report exceeds 5000 records. Narrow the filters." }, false); await invalid; view.flush();
    assert.deepEqual(links(view.tree), []); assert.match(renderToStaticMarkup(view.tree), locale === "ar" ? /تتجاوز النتائج الحد/ : /result exceeds the supported record limit/);
    assert.doesNotMatch(renderToStaticMarkup(view.tree), /Report exceeds 5000/);
    const retry = view.submit(initial); await pending.reject(2); await retry; view.flush();
    assert.deepEqual(links(view.tree), []); assert.equal(elements(view.tree, "button")[0].props.disabled, false);
    assert.match(renderToStaticMarkup(view.tree), locale === "ar" ? /فشل الاتصال بالشبكة/ : /Network request failed/); view.unmount();
  }
});

test("unmount aborts the in-flight request and ignores its late rejected result", async () => {
  const pending = pendingFetch(), view = reportHarness({ ...baseProps, initial }, pending.fetch);
  const instance = view.instances[0]; view.unmount(); const writes = instance.writes;
  assert.equal(pending.calls[0].options.signal.aborted, true);
  await pending.reject(0); assert.equal(instance.writes, writes);
});

test("dedicated register page strictly validates URL filters before permission or company reads", async () => {
  const invalid = [
    {}, { ...pageQuery, tenantId: "not-a-uuid" }, { ...pageQuery, companyId: "" }, { ...pageQuery, kind: "CUSTOMER_BALANCES" },
    { ...pageQuery, from: "2026-02-30" }, { ...pageQuery, to: "2026-10-31" },
    { ...pageQuery, from: "2024-01-01", to: "2025-01-01" }, { ...pageQuery, q: "x".repeat(121) }, { ...pageQuery, q: "search\0" },
    { ...pageQuery, status: "POSTED" }, { ...pageQuery, status: "" }, { ...pageQuery, branchId: "" },
    { ...pageQuery, branchId: "invalid" }, { ...pageQuery, tenantId: [tenantId, tenantId] }, { ...pageQuery, q: ["a", "b"] },
    { ...pageQuery, from: [initial.from, initial.from] }, { ...pageQuery, kind: ["INVOICE_REGISTER", "INVOICE_REGISTER"] },
    { ...pageQuery, unknown: "ignored" }, { ...pageQuery, scope: `${tenantId}:${companyId}` },
  ];
  for (const query of invalid) {
    const page = pageHarness(), tree = await page.render(query);
    assert.equal(elements(tree, page.Report).length, 0); assert.match(renderToStaticMarkup(tree), /Register report unavailable/);
    assert.deepEqual(page.calls, { visibility: [], company: [], redirects: [] });
  }
});

test("dedicated page checks current visibility and exact company/branch ownership without choosing another scope", async () => {
  for (const visible of [false, [], [otherBranch]]) {
    const page = pageHarness({ visible }), tree = await page.render(pageQuery);
    assert.equal(elements(tree, page.Report).length, 0); assert.equal(page.calls.company.length, 0);
    assert.deepEqual(page.calls.visibility, [[actorId, tenantId, companyId, "INVOICE_REGISTER"]]); assert.deepEqual(page.calls.redirects, []);
  }
  for (const company of [null, { name: "Other branch", branches: [{ id: otherBranch, name: "Other" }] }, { name: "No branch", branches: [] }]) {
    const page = pageHarness({ company }), tree = await page.render(pageQuery);
    assert.equal(elements(tree, page.Report).length, 0); assert.equal(page.calls.company.length, 1);
    assert.deepEqual(page.calls.company[0].where, { tenantId_id: { tenantId, id: companyId } }); assert.deepEqual(page.calls.redirects, []);
  }
});

test("authorized register page supports all register kinds using only current register visibility", async () => {
  for (const [kind, endpoint] of Object.entries(presets.registerTypes)) for (const locale of ["ar", "en"]) {
    const status = presets.registerStatuses[kind][0], page = pageHarness({ locale, visible: [branchId] });
    const tree = await page.render({ ...pageQuery, kind, status });
    const report = elements(tree, page.Report)[0]; assert.ok(report);
    assert.equal(report.props.kind, endpoint); assert.equal(report.props.locale, locale);
    assert.deepEqual(report.props.scope, scope); assert.deepEqual(report.props.initial, { ...initial, status });
    assert.deepEqual(page.calls.visibility, [[actorId, tenantId, companyId, kind]]);
    assert.deepEqual(page.calls.company[0].select.branches.where, { tenantId, companyId, id: { in: [branchId] } });
    const html = renderToStaticMarkup(tree); assert.match(html, new RegExp(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`));
    assert.match(html, locale === "ar" ? /صلاحياتك الحالية/ : /current permissions/); assert.deepEqual(page.calls.redirects, []);
  }
});

test("company-wide page filters remain optional without silently adding a branch, status or search", async () => {
  const page = pageHarness(), tree = await page.render({ tenantId, companyId, kind: "EXPENSE_REGISTER", from: "2024-01-01", to: "2024-12-31" });
  const report = elements(tree, page.Report)[0]; assert.ok(report);
  assert.deepEqual(report.props.initial, { from: "2024-01-01", to: "2024-12-31", branchId: undefined, status: undefined, q: "" });
  assert.deepEqual(page.calls.company[0].select.branches.where, { tenantId, companyId });
});

test("page authentication redirects only to login; unexpected database failures do not become scope fallbacks", async () => {
  const unauthenticated = pageHarness({ actor: null });
  await assert.rejects(unauthenticated.render(pageQuery), /REDIRECT:\/login/);
  assert.deepEqual(unauthenticated.calls, { redirects: ["/login"], visibility: [], company: [] });
  const failed = pageHarness({ failure: new Error("database unavailable") });
  await assert.rejects(failed.render(pageQuery), /database unavailable/); assert.deepEqual(failed.calls.redirects, []);
});


test("opening preset inputs retain subsequent submissions and failures without resetting to saved defaults", async () => {
  const pending = pendingFetch(), view = reportHarness({ ...baseProps, initial }, pending.fetch);
  await pending.respond(0); view.flush();
  const edited = { from: "2026-10-01", to: "2026-10-31", branchId: "", status: "VOID", q: "Edited filters" };
  const next = view.submit(edited); await pending.respond(1); await next; view.flush();
  for (const input of [...elements(view.tree, "input"), ...elements(view.tree, "select")]) assert.equal(input.props.value, edited[input.props.name]);
  const save = new URL(links(view.tree)[0], "https://erp.test");
  assert.equal(save.searchParams.get("status"), "VOID"); assert.equal(save.searchParams.get("q"), edited.q);
  assert.equal(save.searchParams.get("from"), edited.from); assert.equal(save.searchParams.has("branchId"), false);
  const failure = view.submit({ ...edited, q: "Retry these filters" });
  await pending.respond(2, { error: "Forbidden" }, false); await failure; view.flush();
  assert.equal(elements(view.tree, "input").find(input => input.props.name === "q").props.value, "Retry these filters");
  assert.equal(elements(view.tree, "select").find(input => input.props.name === "status").props.value, "VOID");
  assert.deepEqual(links(view.tree), []); view.unmount();
});

test("invalid repeated submission cancels any older request without letting its result reappear", async () => {
  const pending = pendingFetch(), view = reportHarness(baseProps, pending.fetch);
  const older = view.submit(initial); await view.submit({ ...initial, from: "2026-02-30" }); view.flush();
  assert.equal(pending.calls[0].options.signal.aborted, true); assert.equal(pending.calls.length, 1);
  await pending.respond(0); await older; view.flush();
  assert.match(renderToStaticMarkup(view.tree), /Invalid report filters/); assert.deepEqual(links(view.tree), []);
  assert.equal(elements(view.tree, "button")[0].props.disabled, false); view.unmount();
});

test("StrictMode effect cleanup and restart aborts the first load while the replacement remains authoritative", async () => {
  const pending = pendingFetch(), view = reportHarness({ ...baseProps, initial }, pending.fetch);
  view.replayEffects(); assert.equal(pending.calls.length, 2); assert.equal(pending.calls[0].options.signal.aborted, true);
  await pending.respond(0, result(999)); view.flush(); assert.deepEqual(links(view.tree), []);
  assert.equal(elements(view.tree, "button")[0].props.disabled, true);
  await pending.respond(1, result(5)); view.flush(); assert.equal(links(view.tree).length, 2);
  assert.doesNotMatch(renderToStaticMarkup(view.tree), /999/); view.unmount();
});
