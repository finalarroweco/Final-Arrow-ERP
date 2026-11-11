import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {createReportInput,updateReportInput,reportTarget,decodeReportPending} from "../src/lib/report-presets.ts";
const scope={tenantId:randomUUID(),companyId:randomUUID(),branchId:randomUUID(),kind:"CUSTOMER_AGING"};
test("saved report target uses fixed internal routes, UTC date rules and encoded filters",()=>{
 const fixed={...scope,dateMode:"FIXED",asOf:"2024-02-29",q:'اسم & branchId=wrong //evil.invalid'};
 for(const [kind,path] of [["CUSTOMER_OVERDUE","/accounting/customer-overdue"],["SUPPLIER_OVERDUE","/purchasing/supplier-overdue"],["CUSTOMER_AGING","/accounting/customer-aging"],["CUSTOMER_BALANCES","/accounting/customer-balances"],["SUPPLIER_AGING","/purchasing/supplier-aging"],["SUPPLIER_BALANCES","/purchasing/supplier-balances"]]){const url=new URL(reportTarget({...fixed,kind}),"https://erp.example.invalid");assert.equal(url.pathname,path);assert.equal(url.searchParams.get("q"),fixed.q);assert.equal(url.searchParams.get("branchId"),scope.branchId);assert.equal(url.searchParams.get("asOf"),"2024-02-29");assert.equal(url.origin,"https://erp.example.invalid");}
 const previous=now=>new URL(reportTarget({...fixed,dateMode:"PREVIOUS_MONTH_END_UTC",asOf:null},new Date(now)),"https://erp.example.invalid").searchParams.get("asOf");
 assert.equal(previous("2024-03-01T00:00:00Z"),"2024-02-29");assert.equal(previous("2025-03-31T23:59:59Z"),"2025-02-28");assert.equal(previous("2026-01-01T00:00:00Z"),"2025-12-31");
 assert.equal(new URL(reportTarget({...fixed,dateMode:"TODAY_UTC",asOf:null},new Date("2026-10-18T23:59:59Z")),"https://erp.example.invalid").searchParams.get("asOf"),"2026-10-18");
});
test("saved report schema and pending retry reject unsafe dates, unknown fields and foreign caches",()=>{
 const input={...scope,requestId:randomUUID(),name:"  My report  ",dateMode:"FIXED",asOf:"2024-02-29",q:" Name "};const valid=createReportInput.parse(input);assert.equal(valid.name,"My report");assert.equal(valid.q,"Name");
 for(const change of [{asOf:"2025-02-29"},{asOf:null},{asOf:"0000-01-01"},{dateMode:"TODAY_UTC"},{dateMode:"LOCAL"},{kind:"FREE_SQL"},{name:"x"},{q:"\0"},{url:"https://evil.invalid"},{ownerId:randomUUID()}])assert.equal(createReportInput.safeParse({...input,...change}).success,false);
 assert.equal(updateReportInput.safeParse({tenantId:scope.tenantId,name:"Valid",dateMode:"TODAY_UTC",asOf:null,q:"",archived:false,expectedVersion:1000,requestId:randomUUID()}).success,false);
 const actorId=randomUUID(),pending={version:1,actorId,scope,request:{mode:"create",payload:valid}};
 assert.deepEqual(decodeReportPending(JSON.stringify(pending),actorId),pending);assert.equal(decodeReportPending(JSON.stringify(pending),randomUUID()),null);assert.equal(decodeReportPending(JSON.stringify({...pending,version:2}),actorId),null);assert.equal(decodeReportPending(JSON.stringify({...pending,scope:{...scope,companyId:randomUUID()}}),actorId),null);assert.equal(decodeReportPending("bad",actorId),null);
});

test("register presets resolve bounded fixed and UTC calendar ranges without changing as-of behavior", () => {
 const base = { ...scope, kind: "INVOICE_REGISTER", name: "Register", requestId: randomUUID(), dateMode: "FIXED_RANGE", asOf: null, from: "2024-01-01", to: "2024-12-31", status: "ISSUED", q: "حبيب & status=VOID //evil.invalid" };
 const url = new URL(reportTarget(createReportInput.parse(base)), "https://erp.example.invalid");
 assert.equal(url.pathname, "/reports/register"); assert.equal(url.origin, "https://erp.example.invalid");
 for (const key of ["tenantId", "companyId", "branchId", "kind", "from", "to", "status", "q"]) assert.equal(url.searchParams.get(key), base[key]);
 assert.equal(url.searchParams.has("asOf"), false); assert.equal(url.searchParams.has("scope"), false);
 for (const [now, mode, from, to] of [
  ["2024-03-01T00:00:00Z", "PREVIOUS_MONTH_UTC", "2024-02-01", "2024-02-29"],
  ["2025-03-31T23:59:59Z", "PREVIOUS_MONTH_UTC", "2025-02-01", "2025-02-28"],
  ["2026-01-01T00:00:00Z", "PREVIOUS_MONTH_UTC", "2025-12-01", "2025-12-31"],
  ["2026-01-01T00:00:00Z", "CURRENT_MONTH_UTC", "2026-01-01", "2026-01-01"],
  ["2026-11-10T23:59:59-02:00", "CURRENT_MONTH_UTC", "2026-11-01", "2026-11-11"],
 ]) {
  const target = new URL(reportTarget({ ...base, dateMode: mode, from: null, to: null, branchId: null, status: null }, new Date(now)), url.origin);
  assert.equal(target.searchParams.get("from"), from); assert.equal(target.searchParams.get("to"), to); assert.equal(target.searchParams.has("status"), false); assert.equal(target.searchParams.has("branchId"), false);
 }
 for (const change of [{ from: null }, { to: null }, { to: "2025-01-01" }, { to: "2023-12-31" }, { from: "2024-02-30" }, { asOf: "2024-02-01" }, { dateMode: "TODAY_UTC", from: null, to: null }, { dateMode: "CURRENT_MONTH_UTC" }, { status: "PAID" }, { status: "POSTED" }, { kind: "CUSTOMER_AGING" }]) assert.equal(createReportInput.safeParse({ ...base, ...change }).success, false, JSON.stringify(change));
});

test("register kinds accept only their source statuses and permissions", async () => {
 const { registerStatuses, reportPermissions, validReportKindFilters } = await import("../src/lib/report-presets.ts");
 const permissions = { INVOICE_REGISTER: "invoice:read", EXPENSE_REGISTER: "expense:read", QUOTE_REGISTER: "quote:read", SALES_ORDER_REGISTER: "order:read", PURCHASE_ORDER_REGISTER: "purchase-order:read" };
 for (const [kind, permission] of Object.entries(permissions)) {
  assert.deepEqual(reportPermissions(kind), [permission]);
  for (const status of [null, ...new Set(Object.values(registerStatuses).flat())]) {
   const base = { ...scope, kind, name: "Valid status", requestId: randomUUID(), dateMode: "CURRENT_MONTH_UTC", asOf: null, status, q: "" };
   const expected = status === null || registerStatuses[kind].includes(status);
   assert.equal(createReportInput.safeParse(base).success, expected, kind + " / " + status);
   const { tenantId, name, requestId, dateMode, asOf, q } = base;
   const update = updateReportInput.parse({ tenantId, name, requestId, dateMode, asOf, q, status, expectedVersion: 1, archived: false });
   assert.equal(validReportKindFilters(update, kind), expected);
   assert.equal(validReportKindFilters(update, "CUSTOMER_BALANCES"), false);
  }
 }
});

test("legacy canonical payloads and v1 retry caches retain exact byte order without new null defaults", () => {
 const oldCreate = { tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId, kind: scope.kind, name: "Legacy", dateMode: "TODAY_UTC", asOf: null, q: "", requestId: randomUUID() };
 const oldUpdate = { tenantId: scope.tenantId, name: "Legacy edit", dateMode: "FIXED", asOf: "2026-01-01", q: "Hello", archived: false, expectedVersion: 3, requestId: randomUUID() };
 assert.equal(JSON.stringify(createReportInput.parse(oldCreate)), JSON.stringify(oldCreate));
 assert.equal(JSON.stringify(updateReportInput.parse(oldUpdate)), JSON.stringify(oldUpdate));
 const actorId = randomUUID(), id = randomUUID();
 for (const request of [{ mode: "create", payload: oldCreate }, { mode: "update", id, payload: oldUpdate }]) {
  const pending = { version: 1, actorId, scope, request };
  assert.equal(JSON.stringify(decodeReportPending(JSON.stringify(pending), actorId)), JSON.stringify(pending));
 }
 const registerScope = { ...scope, kind: "EXPENSE_REGISTER" };
 const request = { mode: "create", payload: createReportInput.parse({ ...registerScope, name: "Range retry", dateMode: "FIXED_RANGE", from: "2026-01-01", to: "2026-01-31", status: "POSTED", requestId: randomUUID() }) };
 const pending = { version: 1, actorId, scope: registerScope, request };
 assert.deepEqual(decodeReportPending(JSON.stringify(pending), actorId), pending);
 assert.equal(decodeReportPending(JSON.stringify({ ...pending, scope: { ...registerScope, kind: "INVOICE_REGISTER" } }), actorId), null);
 assert.equal(decodeReportPending(JSON.stringify({ ...pending, request: { mode: "update", id, payload: { ...oldUpdate, dateMode: "CURRENT_MONTH_UTC", asOf: null, status: "ISSUED" } } }), actorId), null);
});
