import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
// Compile the real TSX without a browser, a Next server, or a new test dependency.
function load(file, overrides = {}, document) {
  const filename = new URL(`../src/app/${file}`, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
    fileName: filename.pathname,
  });
  const exports = {};
  new Function("require", "exports", "document", outputText)(
    (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name), exports, document,
  );
  return exports;
}
const screen = load("_recovery/recovery-screen.tsx");
function render(props) {
  return renderToStaticMarkup(React.createElement(screen.RecoveryScreen, props));
}
function descendants(element) {
  return [element, ...React.Children.toArray(element?.props?.children).flatMap((child) =>
    React.isValidElement(child) ? descendants(child) : [])];
}

test("recovery messages are localized with explicit direction and accessible landmarks", () => {
  for (const locale of ["ar", "en"]) {
    const html = render({ locale, kind: "error", reset() {} });
    assert.match(html, new RegExp(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`));
    assert.match(html, /aria-labelledby="recovery-title"/);
    assert.match(html, /id="recovery-title"/);
    assert.match(html, /<nav aria-label=/);
    assert.match(html, /<p role="alert"/);
    assert.match(html, locale === "ar" ? /تعذّر عرض الصفحة/ : /Unable to display this page/);
    assert.match(html, locale === "ar" ? /تجنّب التكرار/ : /avoid duplicates/);
    assert.match(html, /:focus-visible/);
  }
});

test("retry invokes the supplied reset only on activation, including repeated attempts", () => {
  let attempts = 0;
  const tree = screen.RecoveryScreen({ locale: "en", kind: "error", reset: () => attempts++ });
  const button = descendants(tree).find((element) => element.type === "button");
  assert.equal(attempts, 0);
  assert.equal(button.props.type, "button");
  button.props.onClick();
  button.props.onClick();
  assert.equal(attempts, 2);
});

test("navigation uses full local requests to reauthorize without tenant or return URL data", () => {
  for (const kind of ["error", "not-found"]) {
    const tree = screen.RecoveryScreen({ locale: "en", kind });
    const links = descendants(tree).filter((element) => element.type === "a");
    assert.deepEqual(links.map((link) => link.props.href), ["/dashboard", "/login"]);
    assert.equal(descendants(tree).some((element) => element.type === "button"), false);
  }
});

test("both error boundaries exclude private errors, stacks and digests from output", () => {
  const error = Object.assign(new Error("private database credentials"), { digest: "private-digest" });
  for (const file of ["error.tsx", "global-error.tsx"]) {
    const Boundary = load(file, { "./_recovery/recovery-screen": screen }).default;
    const html = renderToStaticMarkup(React.createElement(Boundary, { error, reset() {} }));
    assert.doesNotMatch(html, /private database credentials|private-digest|Error:|at /);
    assert.match(html, /Try again/);
    assert.match(html, /Return to dashboard/);
  }
});

test("global fallback supplies its own document and usable inline styling", () => {
  for (const locale of ["ar", "en"]) {
    const GlobalError = load("global-error.tsx", {
      "./_recovery/recovery-screen": { ...screen, useRecoveryLocale: () => locale },
    }).default;
    const html = renderToStaticMarkup(React.createElement(GlobalError, { error: new Error(), reset() {} }));
    assert.match(html, new RegExp(`<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`));
    assert.match(html, /<body style="margin:0;background:#f7f7f7"/);
    assert.match(html, /padding:64px 24px/);
    assert.match(html, /font-family:var\(--font-tajawal, Tahoma\), Arial, sans-serif/);
    assert.doesNotMatch(html, /<link/);
  }
});

test("client recovery locale matches cookie preference and safely tolerates unavailable cookies", () => {
  function locale(document) {
    return load("_recovery/recovery-screen.tsx", {
      react: { useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    }, document).useRecoveryLocale();
  }
  assert.equal(locale({ cookie: "session=opaque; fa_locale=ar", documentElement: { lang: "en" } }), "ar");
  assert.equal(locale({ cookie: "fa_locale=en", documentElement: { lang: "ar" } }), "en");
  assert.equal(locale({ cookie: "fa_locale=unknown", documentElement: { lang: "ar" } }), "en");
  assert.equal(locale({ cookie: "", documentElement: { lang: "ar" } }), "ar");
  assert.equal(locale({ cookie: "unrelated_fa_locale=ar", documentElement: { lang: "en" } }), "en");
  assert.equal(locale({ get cookie() { throw new Error("Cookies unavailable"); } }), "en");
  assert.equal(locale(undefined), "en");
});

test("not-found uses the server locale and offers recovery without a misleading retry", async () => {
  for (const locale of ["ar", "en"]) {
    const NotFound = load("not-found.tsx", {
      "../lib/server-locale": { getLocale: async () => locale },
      "./_recovery/recovery-screen": screen,
    }).default;
    const html = renderToStaticMarkup(await NotFound());
    assert.match(html, locale === "ar" ? /الصفحة غير موجودة/ : /Page not found/);
    assert.match(html, /404/);
    assert.doesNotMatch(html, /<button|role="alert"/);
  }
});
