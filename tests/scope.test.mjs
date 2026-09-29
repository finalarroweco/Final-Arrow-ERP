import assert from "node:assert/strict";
import test from "node:test";
import { scopeMatches } from "../src/lib/scope.ts";

test("tenant grant covers its hierarchy", () => {
  const scope = { type: "TENANT", companyId: null, branchId: null };
  assert.equal(scopeMatches(scope, {}), true);
  assert.equal(scopeMatches(scope, { companyId: "a", branchId: "x" }), true);
});

test("company grant does not cross companies or cover tenant settings", () => {
  const scope = { type: "COMPANY", companyId: "a", branchId: null };
  assert.equal(scopeMatches(scope, { companyId: "a", branchId: "x" }), true);
  assert.equal(scopeMatches(scope, { companyId: "b", branchId: "x" }), false);
  assert.equal(scopeMatches(scope, {}), false);
});

test("branch grant does not cover sibling branches or its entire company", () => {
  const scope = { type: "BRANCH", companyId: "a", branchId: "x" };
  assert.equal(scopeMatches(scope, { companyId: "a", branchId: "x" }), true);
  assert.equal(scopeMatches(scope, { companyId: "a", branchId: "y" }), false);
  assert.equal(scopeMatches(scope, { companyId: "a" }), false);
  assert.equal(scopeMatches(scope, { companyId: "b", branchId: "x" }), false);
  assert.equal(scopeMatches(scope, { branchId: "x" }), false);
});
