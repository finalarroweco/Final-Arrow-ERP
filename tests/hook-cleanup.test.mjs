import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import React from "react";

const require = createRequire(import.meta.url);
function load(file, overrides = {}, globals = {}) {
  const filename = new URL("../src/" + file, import.meta.url);
  const {outputText} = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022},
    fileName: filename.pathname,
  });
  const exports = {};
  new Function("require", "exports", ...Object.keys(globals), outputText)(
    name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), exports, ...Object.values(globals));
  return exports;
}
const locale = load("lib/locale.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));
function descendants(element) {
  return [element, ...React.Children.toArray(element?.props?.children).flatMap(child =>
    React.isValidElement(child) ? descendants(child) : [])];
}
// Deterministic effect lifecycle harness, matching the existing UI tests. StrictMode
// coverage explicitly replays setup/cleanup with preserved hook state, not a browser.
function harness(file, exported, initialProps) {
  let cursor = 0, props = initialProps, writes = 0;
  const slots = [], pending = [], calls = [], refs = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => { writes++; slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) { slots[i] = {current: initial}; refs.push(slots[i]); }
      return slots[i];
    },
    useCallback(callback, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = {deps, callback};
      return slots[i].callback;
    },
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i];
      if (!same(previous?.deps, deps)) {
        const slot = {deps, effect, cleanup: previous?.cleanup};
        slots[i] = slot;
        pending.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
  const Component = load(file, {react: hooks, "@/lib/locale": locale}, {
    fetch: (url, options) => new Promise((resolve, reject) => calls.push({url, options, resolve, reject})),
  })[exported];
  function render(next = props) {
    props = next; cursor = 0;
    const tree = Component(props);
    pending.splice(0).forEach(effect => effect());
    return tree;
  }
  function cleanup() { for (const slot of slots) slot?.cleanup?.(); }
  render();
  return {
    calls, refs, render, cleanup, get writes() { return writes; },
    replay() { cleanup(); for (const slot of slots) if (slot?.effect) slot.cleanup = slot.effect(); },
    async respond(index, data) { calls[index].resolve({ok: true, json: async () => data}); await tick(); },
    async reject(index) { calls[index].reject(new Error("Interrupted")); await tick(); },
  };
}
const pickerProps = {locale: "en", tenantId: "tenant", companyId: "company-a", disabled: false, selectedId: "", onChoose() {}};
const picker = () => harness("app/payment-term-template-picker.tsx", "PaymentTermTemplatePicker", pickerProps);
const template = id => ({id, name: id, label: id, days: 30});

test("cleanup increments the live counter after pagination and fences interrupted unmounted requests", async () => {
  for (const outcome of ["resolve", "reject"]) {
    const h = picker();
    await h.respond(0, {templates: [template("initial")], nextPage: 1});
    const button = descendants(h.render()).find(e => e.type === "button");
    button.props.onClick();
    assert.equal(h.calls.length, 2);
    assert.equal(h.refs[0].current, 2);
    h.cleanup();
    assert.equal(h.refs[0].current, 3, "cleanup must not restore an effect-setup counter snapshot");
    const before = h.writes;
    if (outcome === "resolve") await h.respond(1, {templates: [template("late")], nextPage: null});
    else await h.reject(1);
    assert.equal(h.writes, before, "neither completion nor catch/finally may update an unmounted component");
  }
});

test("StrictMode effect replay and changed company scope reject obsolete responses without refetch loops", async () => {
  const h = picker();
  h.replay();
  assert.equal(h.calls.length, 2);
  assert.equal(h.refs[0].current, 3);
  let before = h.writes;
  await h.respond(0, {templates: [template("stale-strict")], nextPage: null});
  assert.equal(h.writes, before);
  h.render({...pickerProps, companyId: "company-b"});
  assert.equal(h.calls.length, 3);
  before = h.writes;
  await h.reject(1);
  assert.equal(h.writes, before);
  await h.respond(2, {templates: [template("current")], nextPage: null});
  const options = descendants(h.render()).filter(e => e.type === "option").map(e => e.props.value);
  assert.deepEqual(options, ["", "current"]);
  h.render();
  assert.equal(h.calls.length, 3);
});

test("recovery status uses the changed locale and aborts replayed, replaced and unmounted effects", async () => {
  const props = {locale: "en", email: "user@example.test"};
  const h = harness("app/settings/security/recovery.tsx", "RecoveryCodes", props);
  h.replay();
  assert.equal(h.calls[0].options.signal.aborted, true);
  h.render({...props, locale: "ar"});
  assert.equal(h.calls[1].options.signal.aborted, true);
  const before = h.writes;
  await h.reject(0); await h.reject(1);
  assert.equal(h.writes, before);
  await h.reject(2);
  const status = descendants(h.render()).find(e => e.props?.role === "status");
  assert.equal(status.props.children, "تعذر تحميل حالة الاستعادة. حدّث الصفحة أو سجّل الدخول مجددًا.");
  h.render(); h.render();
  assert.equal(h.calls.length, 3, "message state changes must not retrigger the status fetch");
  h.render(props);
  h.cleanup();
  assert.equal(h.calls[3].options.signal.aborted, true);
  const unmountedWrites = h.writes;
  await h.respond(3, {count: 10});
  assert.equal(h.writes, unmountedWrites);
});

test('project error notices select AR/EN categories without rendering server details', async () => {
 const rights={canReadBilling:false,canReadBudget:false,canReadTime:false,canCreate:false,canManage:false,canCreateTask:false,canManageTask:false};
 const options=[{tenantId:'tenant',companyId:'company',label:'Human company label',companyPermissions:rights,branches:[]}];
 for(const language of ['ar','en'])for(const status of [400,401,403,404,409,429,500,503]){
  const h=harness('app/projects/workspace.tsx','ProjectsWorkspace',{options,locale:language});
  h.calls[0].resolve({ok:false,status,json:async()=>({error:'SECRET internal English server text'})});await tick();
  const notice=descendants(h.render()).find(e=>e.props?.role==='status');assert.ok(notice);
  assert.equal(notice.props.children,locale.presentApiError((en,ar)=>locale.translate(language,en,ar),{},status));
  assert.doesNotMatch(notice.props.children,/SECRET/);h.render();assert.equal(h.calls.length,1);h.cleanup();
 }
});
