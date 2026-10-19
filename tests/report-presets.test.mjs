import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {createReportInput,updateReportInput,reportTarget,decodeReportPending} from "../src/lib/report-presets.ts";
const scope={tenantId:randomUUID(),companyId:randomUUID(),branchId:randomUUID(),kind:"CUSTOMER_AGING"};
test("saved report target uses fixed internal routes, UTC date rules and encoded filters",()=>{
 const fixed={...scope,dateMode:"FIXED",asOf:"2024-02-29",q:'اسم & branchId=wrong //evil.invalid'};
 for(const [kind,path] of [["CUSTOMER_AGING","/accounting/customer-aging"],["CUSTOMER_BALANCES","/accounting/customer-balances"],["SUPPLIER_AGING","/purchasing/supplier-aging"],["SUPPLIER_BALANCES","/purchasing/supplier-balances"]]){const url=new URL(reportTarget({...fixed,kind}),"https://erp.example.invalid");assert.equal(url.pathname,path);assert.equal(url.searchParams.get("q"),fixed.q);assert.equal(url.searchParams.get("branchId"),scope.branchId);assert.equal(url.searchParams.get("asOf"),"2024-02-29");assert.equal(url.origin,"https://erp.example.invalid");}
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
