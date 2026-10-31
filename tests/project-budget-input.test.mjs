import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {budgetSummary,budgetCsv,projectBudgetInput,budgetPending} from "../src/lib/project-budget-input.ts";
const event=(sequence,kind,amount,extra={})=>({id:String(sequence),sequence,kind,amount,currency:"OMR",costDate:kind==="SET_BUDGET"?null:"2026-10-31",reversesId:null,note:"=Unsafe spreadsheet note",createdAt:"2026-10-31T12:00:00.000Z",...extra});
test("budget costs reconcile revisions, overspending and exact original-cost corrections",()=>{
 const events=[event(1,"SET_BUDGET","10.000"),event(2,"COST","12.125")];let r=budgetSummary(events,"OMR");assert.equal(r.budget,"10.000");assert.equal(r.cost,"12.125");assert.equal(r.remaining,"-2.125");assert.equal(r.overBudget,"2.125");
 events.push(event(3,"SET_BUDGET","20.000"),event(4,"REVERSE_COST","12.125",{reversesId:"2"}));r=budgetSummary(events,"OMR");assert.equal(r.budget,"20.000");assert.equal(r.cost,"0.000");assert.equal(r.remaining,"20.000");assert.equal(r.costEntries,0);
 const big=budgetSummary([event(1,"SET_BUDGET","999999999999999.999"),event(2,"COST","999999999999999.999"),event(3,"COST","999999999999999.999")],"OMR");assert.equal(big.cost,"1999999999999999.998");assert.equal(big.remaining,"-999999999999999.999");
 assert.throws(()=>budgetSummary([...events,event(5,"REVERSE_COST","12.125",{reversesId:"2"})],"OMR"));assert.throws(()=>budgetSummary([event(1,"COST","1.000")],"OMR"));assert.throws(()=>budgetSummary([event(1,"SET_BUDGET","1.000",{currency:"USD"})],"OMR"));assert.throws(()=>budgetSummary([event(2,"SET_BUDGET","1.000")],"OMR"));
 assert.equal(budgetSummary([],"OMR").budget,null);assert.match(budgetCsv({tenantId:"t",companyId:"c",branchId:null,projectId:"p",projectCode:"+project"},events,"OMR"),/"'=Unsafe spreadsheet note"/);
});
test("budget input and pending UUIDs preserve actor/source, exact amounts and calendar dates",()=>{
 const actorId=randomUUID(),projectId=randomUUID(),tenantId=randomUUID(),request={tenantId,requestId:randomUUID(),expectedSequence:0,currency:"OMR",kind:"SET_BUDGET",amount:"0",note:"Initial budget"},raw={version:1,actorId,projectId,request};assert.deepEqual(budgetPending(raw,actorId,tenantId,projectId),request);
 assert.equal(budgetPending(raw,randomUUID(),tenantId,projectId),null);assert.equal(budgetPending(raw,actorId,tenantId,randomUUID()),null);assert.equal(budgetPending({...raw,version:2},actorId,tenantId,projectId),null);
 for(const amount of ["-1","1e3","0.0001","1000000000000000","01"])assert.equal(projectBudgetInput.safeParse({...request,amount}).success,false);
 for(const costDate of ["2026-02-30","1999-12-31","2100-01-01"])assert.equal(projectBudgetInput.safeParse({...request,kind:"COST",amount:"1",costDate}).success,false);
 assert.equal(projectBudgetInput.safeParse({...request,kind:"COST",amount:"0",costDate:"2026-10-31"}).success,false);
});
