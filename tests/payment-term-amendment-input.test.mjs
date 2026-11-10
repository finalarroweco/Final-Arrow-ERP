import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {paymentTermAmendmentInput,pendingPaymentTermAmendment,paymentTermsCutoff,recordedPaymentTerms} from "../src/lib/payment-term-amendment-input.ts";
import {sourceAging,sourceAgingCsv} from "../src/lib/source-aging.ts";
test("amendments require explicit replacement or clearing and canonical scoped retry identities",()=>{
 const actorId=randomUUID(),tenantId=randomUUID(),sourceId=randomUUID(),request={tenantId,requestId:randomUUID(),expectedSequence:0,paymentTerms:{label:" Net 30 ",dueDate:"2028-02-29"},reason:" Approved revised agreement "};
 const canonical=paymentTermAmendmentInput.parse({...request,requestId:request.requestId.toUpperCase(),tenantId:tenantId.toUpperCase()});assert.equal(canonical.paymentTerms.label,"Net 30");assert.equal(canonical.reason,"Approved revised agreement");assert.equal(canonical.requestId,request.requestId);
 assert.equal(paymentTermAmendmentInput.parse({...request,paymentTerms:null}).paymentTerms,null);
 for(const patch of [{paymentTerms:undefined},{paymentTerms:{label:"Net",dueDate:"2026-02-29"}},{paymentTerms:{label:"Net",dueDate:"2100-01-01"}},{paymentTerms:{label:"Net",dueDate:null}},{paymentTerms:{label:null,dueDate:null}},{paymentTerms:{label:"xx",dueDate:"2026-01-01"}},{paymentTerms:{label:"Bad\0label",dueDate:"2026-01-01"}},{reason:"x"},{reason:"bad\nreason"},{reason:"x".repeat(1001)},{expectedSequence:1000},{expectedSequence:-1},{expectedSequence:1.5},{createdAt:"2001-01-01T00:00:00Z"},{companyId:randomUUID()}])assert.equal(paymentTermAmendmentInput.safeParse({...request,...patch}).success,false,JSON.stringify(patch));
 const pending={version:1,actorId,kind:"invoice",sourceId,request:canonical};assert.deepEqual(pendingPaymentTermAmendment(pending,actorId,tenantId,"invoice",sourceId),canonical);
 for(const args of [[randomUUID(),tenantId,"invoice",sourceId],[actorId,randomUUID(),"invoice",sourceId],[actorId,tenantId,"receipt",sourceId],[actorId,tenantId,"invoice",randomUUID()]])assert.equal(pendingPaymentTermAmendment(pending,...args),null);
 for(const raw of [null,"bad",{...pending,version:2},{...pending,extra:true}])assert.equal(pendingPaymentTermAmendment(raw,actorId,tenantId,"invoice",sourceId),null);
});
test("UTC report cutoff, explicit clearing and restoration preserve originals and amounts",()=>{
 for(const [day,next] of [["2024-02-28","2024-02-29"],["2024-02-29","2024-03-01"],["2026-12-31","2027-01-01"],["2026-03-28","2026-03-29"]])assert.equal(paymentTermsCutoff(day).toISOString(),next+"T00:00:00.000Z");
 for(const value of ["2026-02-30","bad","2026-1-01"])assert.throws(()=>paymentTermsCutoff(value));
 const original={paymentTerms:"Original net 30",paymentDueDate:new Date("2026-01-31")},clear={paymentTerms:null,paymentDueDate:null,sequence:2,createdAt:new Date("2026-02-02T12:00:00.000Z")};
 assert.equal(recordedPaymentTerms(original).paymentDueDate,"2026-01-31");const cleared=recordedPaymentTerms(original,clear);assert.equal(cleared.paymentDueDate,null);assert.equal(cleared.paymentTerms,null);assert.equal(cleared.originalPaymentDueDate,"2026-01-31");assert.equal(cleared.paymentTermsSequence,2);
 const restored=recordedPaymentTerms(original,{...clear,...original,sequence:3});assert.equal(restored.paymentDueDate,"2026-01-31");assert.equal(restored.paymentTermsSequence,3);
 const doc={id:randomUUID(),reference:"Test source",branchId:null,party:{id:"party",code:"TEST",displayName:"Party",archivedAt:null},currency:"OMR",postedDate:"2026-01-01",balance:"9999999999.999"};
 const report=sourceAging("2026-02-03",[{...doc,...cleared}],"PAYMENT_DUE_DATE");assert.equal(report.summary[0].noDueDate,doc.balance);assert.equal(report.summary[0].balance,doc.balance);assert.equal(report.paymentTermsCutoffExclusive,"2026-02-04T00:00:00.000Z");
 const csv=sourceAgingCsv(report);assert.match(csv,/Original payment terms/);assert.match(csv,/LATEST_RECORDED_AMENDMENT_BEFORE_UTC_CUTOFF_OR_ORIGINAL/);assert.match(csv,/2026-02-02T12:00:00.000Z/);assert.match(csv,/Original net 30/);const lines=csv.trim().split("\r\n");assert.equal(lines[0].split(",").length,lines[1].split(",").length);assert.equal(lines[0].split(",").length,lines.at(-1).split(",").length);
});
