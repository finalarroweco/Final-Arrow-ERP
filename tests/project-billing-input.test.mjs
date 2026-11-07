import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {billingSummary,billingCsv,projectBillingInput,billingPending} from "../src/lib/project-billing-input.ts";
const row=(id,extra={})=>({id,invoiceId:id,number:id,invoiceStatus:"ISSUED",currency:"OMR",gross:"10.000",posted:"10.000",collected:"2.000",balance:"8.000",note:"=Invoice note",createdAt:"2026-10-31T12:00:00Z",unlinkedAt:null,unlinkReason:null,...extra});
test("project billing separates unposted, voided and unlinked sources and retains exact currencies",()=>{
 const rows=[row("a"),row("b",{gross:"5.000",posted:"0.000",collected:"0.000",balance:"0.000"}),row("c",{invoiceStatus:"VOID"}),row("d",{unlinkedAt:"2026-10-31T13:00:00Z"}),row("e",{currency:"USD"})],s=billingSummary(rows),omr=s.find(x=>x.currency==="OMR");assert.equal(omr.gross,"15.000");assert.equal(omr.posted,"10.000");assert.equal(omr.unposted,"5.000");assert.equal(omr.collected,"2.000");assert.equal(omr.balance,"8.000");assert.equal(omr.issued,2);assert.equal(omr.voided,1);assert.equal(s.find(x=>x.currency==="USD").gross,"10.000");
 const large=billingSummary([row("a",{gross:"999999999999999.999"}),row("b",{gross:"0.001"})])[0];assert.equal(large.gross,"1000000000000000.000");assert.deepEqual(billingSummary([]),[]);
 assert.match(billingCsv({tenantId:"t",companyId:"c",projectId:"p",projectCode:"+CODE",state:"ALL",q:""},rows),/"'=Invoice note"/);
});
test("project invoice retry cache is scoped to actor, project and tenant and accepts only reference changes",()=>{
 const actorId=randomUUID(),projectId=randomUUID(),tenantId=randomUUID(),request={tenantId,requestId:randomUUID(),action:"LINK",invoiceId:randomUUID(),note:"Source assignment"},raw={version:1,actorId,projectId,request};assert.deepEqual(billingPending(raw,actorId,projectId,tenantId),request);assert.equal(billingPending(raw,randomUUID(),projectId,tenantId),null);assert.equal(billingPending(raw,actorId,randomUUID(),tenantId),null);assert.equal(billingPending({...raw,version:2},actorId,projectId,tenantId),null);assert.equal(projectBillingInput.safeParse({...request,amount:"10"}).success,false);assert.equal(projectBillingInput.safeParse({...request,note:"x"}).success,false);
 const unlink={tenantId,requestId:randomUUID(),action:"UNLINK",linkId:randomUUID(),reason:"Correct wrong assignment"};assert.deepEqual(billingPending({...raw,request:unlink},actorId,projectId,tenantId),unlink);
});
