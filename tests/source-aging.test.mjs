import test from "node:test";
import assert from "node:assert/strict";
import {sourceAging,sourceAgingCsv} from "../src/lib/source-aging.ts";
const asOf="2026-10-16",party={id:"party",code:"=FORMULA",displayName:"A, \"customer\"",archivedAt:null};
const document=(days,balance="1.000",currency="OMR",id=String(days))=>({id,reference:"source-"+id,branchId:"branch",party,currency,balance,postedDate:new Date(Date.parse(asOf+"T00:00:00Z")-days*86400000).toISOString().slice(0,10)});
test("source aging uses UTC posting-day boundaries and reconciles signed document credits",()=>{
 const r=sourceAging(asOf,[0,30,31,60,61,90,91].map(d=>document(d)).concat([document(31,"-2.001","OMR","credit"),document(40,"0.000","OMR","zero"),document(31,"9.125","USD","foreign")]));
 assert.equal(r.documents.length,9);const omr=r.summary.find(s=>s.currency==="OMR");
 assert.equal(omr.days0to30,"2.000");assert.equal(omr.days31to60,"2.000");assert.equal(omr.days61to90,"2.000");assert.equal(omr.days91plus,"1.000");assert.equal(omr.credits,"-2.001");assert.equal(omr.balance,"4.999");assert.equal(r.summary.find(s=>s.currency==="USD").balance,"9.125");
 assert.equal(r.documents[0].ageDays,91);assert.equal(r.documents.find(d=>d.id==="credit").bucket,"credits");
 const netZero=sourceAging(asOf,[document(10,"1.000"),document(40,"-1.000")]);assert.equal(netZero.rows.length,1);assert.equal(netZero.rows[0].balance,"0.000");assert.equal(netZero.rows[0].documents,2);
});
test("source aging keeps exact large amounts, escapes CSV and rejects impossible ages",()=>{
 const r=sourceAging(asOf,[document(1,"999999999999999.999"),document(2,"0.001")]);assert.equal(r.summary[0].balance,"1000000000000000.000");
 const csv=sourceAgingCsv(r);assert.match(csv,/"'=FORMULA"/);assert.match(csv,/"A, ""customer"""/);assert.match(csv,/"DOCUMENT"/);assert.match(csv,/"TOTAL"/);
 assert.throws(()=>sourceAging(asOf,[document(-1)]));assert.throws(()=>sourceAging(asOf,[document(0,"1e3")]));assert.deepEqual(sourceAging(asOf,[]).summary,[]);
});

test("contractual due dates separate future, today, missing, overdue and negative balances",()=>{
 const input=[-1,0,1,30,31,60,61,90,91].map((days,i)=>({...document(100,"1.000","OMR",String(i)),paymentTerms:"Net 30",paymentDueDate:new Date(Date.parse(asOf+"T00:00:00Z")-days*86400000).toISOString().slice(0,10)}));
 input.push({...document(100,"2.500","OMR","legacy"),paymentDueDate:null});
 input.push({...document(100,"-1.001","OMR","credit"),paymentDueDate:null});
 input.push({...document(100,"0.000","OMR","zero"),paymentDueDate:null});
 const r=sourceAging(asOf,input,"PAYMENT_DUE_DATE"),s=r.summary[0];
 assert.equal(r.basis,"PAYMENT_DUE_DATE");assert.equal(s.notDue,"2.000");assert.equal(s.noDueDate,"2.500");assert.equal(s.days0to30,"2.000");assert.equal(s.days31to60,"2.000");assert.equal(s.days61to90,"2.000");assert.equal(s.days91plus,"1.000");assert.equal(s.credits,"-1.001");assert.equal(s.balance,"10.499");
 assert.equal(r.documents.find(d=>d.id==="legacy").bucket,"noDueDate");assert.equal(r.documents.find(d=>d.id==="credit").bucket,"credits");assert.equal(r.documents.find(d=>d.id==="1").overdueDays,0);assert.equal(r.documents.length,11);
 const posted=sourceAging(asOf,input);assert.equal(posted.summary[0].days91plus,"11.500");assert.equal(posted.summary[0].notDue,"0.000");assert.equal(posted.summary[0].noDueDate,"0.000");
 assert.match(sourceAgingCsv(r),/PAYMENT_DUE_DATE/);assert.match(sourceAgingCsv(r),/Due date UTC/);
});
