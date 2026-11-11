import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";

const origin = "http://127.0.0.1:3247";

test("missing pages provide localized recovery and navigation retains authentication", { timeout: 90000 }, async () => {
  const server = spawn("./node_modules/.bin/next", ["start", "-H", "127.0.0.1", "-p", "3247"], {
    env: process.env, stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(origin + "/login")).ok) { ready = true; break; }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, "Next production server became ready");
    for (const locale of ["ar", "en"]) {
      const response = await fetch(origin + "/missing-page-path-canary?detail=query-canary", {
        headers: { cookie: `fa_locale=${locale}` },
      });
      assert.equal(response.status, 404);
      const html = await response.text();
      assert.match(html, new RegExp(`<html[^>]*lang="${locale}"[^>]*dir="${locale === "ar" ? "rtl" : "ltr"}"`));
      const main = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/)?.[0];
      assert.ok(main, "Recovery content has a main landmark");
      assert.match(main, locale === "ar" ? /الصفحة غير موجودة/ : /Page not found/);
      assert.match(main, /href="\/dashboard"/);
      assert.match(main, /href="\/login"/);
      assert.doesNotMatch(main, /missing-page-path-canary|query-canary|<button|role="alert"/);
      // Next may include the requested URL in routing payloads. The recovery UI
      // must not reflect it, and must not treat it as an error or a return URL.
    }
    const dashboard = await fetch(origin + "/dashboard", { redirect: "manual" });
    assert.equal(dashboard.status, 307);
    assert.equal(dashboard.headers.get("location"), "/login");
    const login = await fetch(origin + "/login");
    assert.equal(login.status, 200);
  } finally {
    server.kill("SIGTERM");
  }
});
