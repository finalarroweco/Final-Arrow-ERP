import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {PrismaClient} from "@prisma/client";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
const origin="http://127.0.0.1:3249",actors=new Map();
async function call(path,method="GET",body,cookie,expectedActor=actors.get(cookie)){const response=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...(method==="POST"&&path.endsWith("/payment-terms")&&expectedActor!==null&&expectedActor!==undefined?{"X-Expected-Actor-Id":expectedActor}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json(),cookie:response.headers.get("set-cookie")?.split(";")[0],headers:response.headers};}
test("payment-term amendments are immutable, scoped, exactly retryable and historically bounded without accounting changes",{timeout:180000},async()=>{
 const db=new PrismaClient(),server=spawn("./node_modules/.bin/next",["start","-H","127.0.0.1","-p","3249"],{env:{...process.env,ALLOW_REGISTRATION:"true"},stdio:["ignore","ignore","inherit"]});
 try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}assert.ok(ready);
  async function owner(){const s=randomUUID().slice(0,8),r=await call("/api/auth/register","POST",{name:"Amendment owner",email:`amend-${s}@example.invalid`,password:"Amendments-password-2026",organization:"Amendments QA",slug:`amend-${s}`});assert.equal(r.status,201);actors.set(r.cookie,(await db.user.findUnique({where:{email:`amend-${s}@example.invalid`}})).id);return r;}
  const actor=await owner(),outsider=await owner(),tenantId=actor.data.tenantId,cookie=actor.cookie;
  const create=async(path,body)=>{const r=await call(path,"POST",{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const {company}=await create("/api/companies",{name:"Amendments company",code:"AMEND",baseCurrency:"OMR"}),companyId=company.id;
  const {company:foreign}=await create("/api/companies",{name:"Other company",code:"OTHER"});
  const {branch}=await create("/api/branches",{companyId,name:"Main",code:"MAIN"}),{branch:sibling}=await create("/api/branches",{companyId,name:"Sibling",code:"OTHER"});
  const invoicePermission="invoice-payment-term:manage",receiptPermission="receipt-payment-term:manage";
  const permissions=["invoice:read","inventory-stock:read","purchase-order:read",invoicePermission,receiptPermission];
  const {role}=await create("/api/roles",{name:"Terms operator",permissions}),{role:readerRole}=await create("/api/roles",{name:"Terms reader",permissions:permissions.filter(p=>p.endsWith(":read"))});
  async function invite(roleId,branchId,name,type="BRANCH",builtIn){const invitation=await create("/api/invitations",{email:`amend-member-${randomUUID().slice(0,8)}@example.invalid`,...(builtIn?{role:builtIn}:{roleId}),scope:{type,companyId,...(type==="BRANCH"?{branchId}:{})}});const result=await call("/api/invitations/accept","POST",{token:invitation.path.split("/").at(-1),name,password:"Amendment-member-2026"});assert.equal(result.status,200);const membership=await db.membership.findFirst({where:{tenantId,user:{name}}});assert.ok(membership);actors.set(result.cookie,membership.userId);return result.cookie;}
  const operator=await invite(role.id,branch.id,"Terms operator"),reader=await invite(readerRole.id,branch.id,"Terms reader"),wrongBranch=await invite(role.id,sibling.id,"Sibling operator"),manager=await invite(undefined,branch.id,"Default manager","COMPANY","Manager");
  const {customer}=await create("/api/customers",{companyId,code:"AMEND-C",displayName:"Amendment customer"});
  const {supplier}=await create("/api/suppliers",{companyId,code:"AMEND-S",displayName:"Amendment supplier"});
  const {item}=await create("/api/inventory/items",{companyId,branchId:branch.id,sku:"AMEND-I",name:"Amendment item",unit:"unit"});
  const original={label:"Original net 30",dueDate:"2020-01-31"},future={label:"Approved future payment",dueDate:"2090-12-31"};
  async function invoice(number,branchId=branch.id,terms=original){const {quote}=await create("/api/quotes",{companyId,branchId,customerId:customer.id,number:"Q-"+number,lines:[{description:"Service",quantity:1,unitPrice:"5"}]});for(const action of ["send","accept"])assert.equal((await call(`/api/quotes/${quote.id}/status`,"PATCH",{tenantId,action},cookie)).status,200);const {order}=await create(`/api/quotes/${quote.id}/order`,{number:"O-"+number});for(const action of ["start","complete"])assert.equal((await call(`/api/orders/${order.id}/status`,"PATCH",{tenantId,action},cookie)).status,200);return (await create(`/api/orders/${order.id}/invoice`,{number,...(terms?{paymentTerms:terms}:{})})).invoice;}
  async function receipt(number,orderBranch=branch.id,terms=original){const {order}=await create("/api/purchase-orders",{companyId,branchId:orderBranch,supplierId:supplier.id,number,lines:[{description:"Receipt goods",quantity:2,unitPrice:"3"}]});assert.equal((await call(`/api/purchase-orders/${order.id}/status`,"PATCH",{tenantId,action:"issue"},cookie)).status,200);return (await create(`/api/purchase-orders/${order.id}/receive`,{branchId:branch.id,requestId:randomUUID(),...(terms?{paymentTerms:terms}:{}),lines:[{orderLineId:order.lines[0].id,itemId:item.id,quantity:1}]})).receipt;}
  const inv=await invoice("AMEND-INV"),rec=await receipt("AMEND-PO"),wideInvoice=await invoice("AMEND-WIDE",null),wideOrderReceipt=await receipt("AMEND-WIDE-PO",null),otherInvoice=await invoice("AMEND-OTHER"),undated=await invoice("AMEND-UNDATED",branch.id,null);
  const endpoint=(kind,id)=>kind==="invoice"?`/api/invoices/${id}/payment-terms`:`/api/purchasing/receipts/${id}/payment-terms`,query=`?tenantId=${tenantId}`,first={tenantId,requestId:randomUUID(),expectedSequence:0,paymentTerms:future,reason:"Operator approved revised terms"};
  const invPath=endpoint("invoice",inv.id),recPath=endpoint("receipt",rec.id);
  assert.equal((await call(invPath+query)).status,401);assert.equal((await call(invPath,"POST",first)).status,401);
  for(const account of [reader,manager,wrongBranch,outsider.cookie])assert.equal((await call(invPath,"POST",first,account)).status,403);
  for(const path of [invPath,recPath]){assert.equal((await call(path+query,"GET",undefined,wrongBranch)).status,403);assert.equal((await call(path+query,"GET",undefined,outsider.cookie)).status,403);assert.equal((await call(path+`?tenantId=${outsider.data.tenantId}`,"GET",undefined,cookie)).status,404);}
  assert.equal((await call(endpoint("invoice",wideInvoice.id),"POST",first,operator)).status,403);
  assert.equal((await call(endpoint("receipt",wideOrderReceipt.id)+query,"GET",undefined,operator)).status,403,"receiving branch does not grant company-wide purchase-order visibility");
  assert.equal((await call(endpoint("receipt",wideOrderReceipt.id),"POST",first,operator)).status,403);
  assert.equal((await call(invPath+query+"&page=0&page=1","GET",undefined,reader)).status,400);
  assert.equal((await call(invPath+query+"&unknown=true","GET",undefined,reader)).status,400);
  for(const patch of [{createdAt:"2000-01-01T00:00:00Z"},{companyId},{branchId:branch.id},{expectedSequence:1000},{paymentTerms:{label:"No",dueDate:"2026-02-30"}}])assert.equal((await call(invPath,"POST",{...first,...patch},operator)).status,400);
  const initial=await call(invPath+query,"GET",undefined,reader);assert.equal(initial.status,200);assert.equal(initial.data.current.sequence,0);assert.equal(initial.data.canManage,false);assert.equal(initial.data.original.paymentTerms,original.label);assert.match(initial.headers.get("cache-control"),/no-store/);
  const noChange={...first,requestId:randomUUID(),paymentTerms:original};const noChangeResponse=await call(invPath,"POST",noChange,operator);assert.equal(noChangeResponse.status,409);assert.deepEqual(noChangeResponse.data.requestOutcome,{code:"NOT_RECORDED",requestId:noChange.requestId,actorId:actors.get(operator)});assert.equal(await db.paymentTermAmendment.count({where:{id:noChange.requestId}}),0);
  assert.equal((await call(endpoint("invoice",undated.id),"POST",{...first,paymentTerms:null},operator)).status,409);
  assert.equal((await call(endpoint("invoice",undated.id),"POST",{...first,requestId:randomUUID()},operator)).status,201,"undated originals can acquire explicit terms");
  const races=await Promise.all([call(invPath,"POST",first,operator),call(invPath.toUpperCase().replace("/API/INVOICES/","/api/invoices/").replace("/PAYMENT-TERMS","/payment-terms"),"POST",{...first,tenantId:tenantId.toUpperCase(),requestId:first.requestId.toUpperCase()},operator)]);assert.ok(races.every(r=>r.status===201),JSON.stringify(races));assert.deepEqual(races.map(r=>r.data.replayed).sort(),[false,true]);
  const saved=races[0].data.change,operatorId=saved.createdBy;assert.equal(saved.paymentDueDate,future.dueDate);assert.equal(saved.sequence,1);assert.equal(saved.createdAt.slice(0,10),new Date().toISOString().slice(0,10));
  const changedRetry=await call(invPath,"POST",{...first,reason:"Changed retry reason"},operator);assert.equal(changedRetry.status,409);assert.deepEqual(changedRetry.data.requestOutcome,{code:"UNRESOLVED",requestId:first.requestId});assert.equal((await call(invPath,"POST",first,cookie)).status,409,"different actor cannot adopt another request");
  assert.equal((await call(endpoint("invoice",otherInvoice.id),"POST",first,operator)).status,409);assert.equal((await call(recPath,"POST",first,operator)).status,409,"request identity is global across source kinds");
  const stale={...first,requestId:randomUUID()},staleResponse=await call(invPath,"POST",stale,operator);assert.equal(staleResponse.status,409,"stale sequence cannot append");assert.deepEqual(staleResponse.data.requestOutcome,{code:"NOT_RECORDED",requestId:stale.requestId,actorId:actors.get(operator)});assert.equal(await db.paymentTermAmendment.count({where:{id:stale.requestId}}),0);
  // A request not yet sent by A must never commit as equally authorized B,
  // even with a current sequence. Both source kinds exercise the write boundary.
  for(const [kind,source] of [["invoice",await invoice("AMEND-UNSENT")],["receipt",await receipt("AMEND-UNSENT-PO")]]){
   const path=endpoint(kind,source.id),pending={...first,requestId:randomUUID()},actorA=actors.get(operator);
   for(const expectedActor of [null,"bad",actorA+","+actorA,actorA]){
    const denied=await call(path,"POST",pending,cookie,expectedActor);assert.equal(denied.status,409);assert.notEqual(denied.data.requestOutcome?.code,"NOT_RECORDED");
    assert.equal(await db.paymentTermAmendment.count({where:{id:pending.requestId}}),0);assert.equal(await db.auditLog.count({where:{entityId:pending.requestId}}),0);
   }
   // Even a no-op or stale sequence must not produce a discardable absence verdict.
   for(const payload of [{...pending,paymentTerms:original},{...pending,expectedSequence:8}]){
    const denied=await call(path,"POST",payload,cookie,actorA);assert.equal(denied.status,409);assert.notEqual(denied.data.requestOutcome?.code,"NOT_RECORDED");
   }
   const resumed=await call(path,"POST",pending,operator,actorA.toUpperCase());assert.equal(resumed.status,201);assert.equal(resumed.data.change.createdBy,actorA);assert.equal(resumed.data.replayed,false);
   const replayB=await call(path,"POST",pending,cookie,actorA);assert.equal(replayB.status,409);assert.notEqual(replayB.data.requestOutcome?.code,"NOT_RECORDED");
   assert.equal((await call(path,"POST",pending,operator,actorA)).data.replayed,true);
   assert.equal(await db.paymentTermAmendment.count({where:{id:pending.requestId}}),1);assert.equal(await db.auditLog.count({where:{entityId:pending.requestId}}),1);
  }
  // A stale page keeps actor A's pending UUID after a lost successful response.
  // Session B has the same source rights, but may not adopt or discard A's record.
  const actorSwitchInvoice=await invoice("AMEND-ACTOR-SWITCH"),switchPath=endpoint("invoice",actorSwitchInvoice.id),lostRequest={...first,requestId:randomUUID()};
  assert.equal((await call(switchPath,"POST",lostRequest,operator)).status,201); // Discard the successful body, as if transport lost it.
  assert.equal((await call(switchPath+query,"GET",undefined,cookie)).data.canManage,true);
  const otherActorRetry=await call(switchPath,"POST",lostRequest,cookie);assert.equal(otherActorRetry.status,409);assert.deepEqual(otherActorRetry.data.requestOutcome,{code:"UNRESOLVED",requestId:lostRequest.requestId});
  const unclassifiedValidation=await call(switchPath,"POST",{...lostRequest,unrecognized:true},cookie);assert.equal(unclassifiedValidation.status,400);assert.notEqual(unclassifiedValidation.data.requestOutcome?.code,"NOT_RECORDED");
  const restoredActorRetry=await call(switchPath,"POST",lostRequest,operator);assert.equal(restoredActorRetry.status,201);assert.equal(restoredActorRetry.data.replayed,true);assert.equal(restoredActorRetry.data.change.createdBy,operatorId);
  assert.equal(await db.paymentTermAmendment.count({where:{invoiceId:actorSwitchInvoice.id}}),1);assert.equal(await db.auditLog.count({where:{tenantId,entity:"PaymentTermAmendment",entityId:lostRequest.requestId}}),1);
  const compete=await Promise.all([call(invPath,"POST",{...first,requestId:randomUUID(),expectedSequence:1,paymentTerms:{...future,label:"Approval A"}},operator),call(invPath,"POST",{...first,requestId:randomUUID(),expectedSequence:1,paymentTerms:{...future,label:"Approval B"}},operator)]);assert.deepEqual(compete.map(r=>r.status).sort(),[201,409]);
  const clear={...first,requestId:randomUUID(),expectedSequence:2,paymentTerms:null,reason:"Approved removal of terms and due date"};assert.equal((await call(invPath,"POST",clear,operator)).status,201);const cleared=await call(invPath+query,"GET",undefined,reader);assert.equal(cleared.data.current.paymentTerms,null);assert.equal(cleared.data.current.paymentDueDate,null);assert.equal(cleared.data.original.paymentTerms,original.label);assert.equal(cleared.data.changes[0].authorName,"Terms operator");
  assert.equal((await call(invPath,"POST",{...first,requestId:randomUUID(),expectedSequence:3,paymentTerms:original},operator)).status,201);assert.equal((await call(invPath,"POST",first,operator)).data.replayed,true,"exact replay survives newer changes");
  const recFirst={...first,requestId:randomUUID()};assert.equal((await call(recPath,"POST",recFirst,operator)).status,201);assert.equal((await call(recPath,"POST",recFirst,operator)).data.replayed,true);
  assert.equal((await call(recPath,"POST",{...recFirst,requestId:randomUUID(),expectedSequence:1,paymentTerms:null},operator)).status,201);
  assert.equal((await call(recPath+query,"GET",undefined,reader)).data.current.paymentDueDate,null);
  // Existing historical sources are fixture-dated; amendment event timestamps are never altered.
  const today=new Date().toISOString().slice(0,10),yesterday=new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
  await db.invoice.update({where:{id:inv.id},data:{status:"ISSUED",issuedAt:new Date(yesterday)}});
  await db.goodsReceipt.update({where:{id:rec.id},data:{createdAt:new Date(yesterday)}});
  const account=async(code,type)=>(await create("/api/ledger/accounts",{companyId,code,name:code,type})).account;
  const asset=await account("1100","ASSET"),revenue=await account("4000","REVENUE"),liability=await account("2000","LIABILITY");
  for(const [kind,id,credit] of [["invoice",inv.id,revenue.id],["purchase-receipt",rec.id,liability.id]]){const r=await call(`/api/ledger/documents/${kind}/${id}`,"POST",{tenantId,entryDate:yesterday,debitAccountId:asset.id,creditAccountId:credit},cookie);assert.equal(r.status,201,JSON.stringify(r.data));}
  const snapshot=async()=>JSON.stringify({invoice:await db.invoice.findUnique({where:{id:inv.id},include:{lines:true,vat:true}}),receipt:await db.goodsReceipt.findUnique({where:{id:rec.id},include:{lines:true}}),journals:await db.journalEntry.findMany({where:{tenantId},include:{lines:true},orderBy:{id:"asc"}}),stock:await db.stockBalance.findMany({where:{tenantId},orderBy:{id:"asc"}})}),before=await snapshot();
  const reports=kind=>`/api/${kind==="invoice"?"accounting/customer":"purchasing/supplier"}-overdue?`;
  const report=(kind,asOf)=>call(reports(kind)+new URLSearchParams({tenantId,companyId,asOf}),"GET",undefined,cookie);
  for(const [kind,id] of [["invoice",inv.id],["receipt",rec.id]]){const historical=await report(kind,yesterday);assert.equal(historical.status,200,JSON.stringify(historical.data));const row=historical.data.documents.find(d=>d.id===id);assert.equal(row.paymentTerms,original.label);assert.equal(row.paymentTermsSequence,0);assert.equal(row.paymentDueDate,original.dueDate);assert.equal(historical.data.paymentTermsCutoffExclusive,today+"T00:00:00.000Z");}
  const revise={...first,requestId:randomUUID(),expectedSequence:4};assert.equal((await call(invPath,"POST",revise,operator)).status,201);
  const futureReport=await report("invoice",today),invoiceRow=futureReport.data.documents.find(d=>d.id===inv.id);assert.equal(invoiceRow.paymentTermsSequence,5);assert.equal(invoiceRow.bucket,"notDue");assert.equal(invoiceRow.originalPaymentTerms,original.label);assert.equal(invoiceRow.balance,"5.000");
  const receiptReport=await report("receipt",today),receiptRow=receiptReport.data.documents.find(d=>d.id===rec.id);assert.equal(receiptRow.paymentTermsSequence,2);assert.equal(receiptRow.paymentDueDate,null);assert.equal(receiptRow.bucket,"noDueDate");assert.equal(receiptRow.balance,"3.000");
  assert.equal((await report("invoice",yesterday)).data.documents.find(d=>d.id===inv.id).paymentTermsSequence,0);assert.equal(before,await snapshot(),"amendment changes no source, amount, tax, stock or ledger row");
  const csv=await fetch(origin+reports("invoice")+new URLSearchParams({tenantId,companyId,asOf:today,format:"csv"}),{headers:{Cookie:cookie}});assert.equal(csv.status,200);assert.match(await csv.text(),/Terms cutoff UTC \(exclusive\)/);
  for(const [path,label] of [[`/accounting/invoices/${inv.id}/payment-terms`,"Permanent amendment history"],[`/purchasing/receipts/${rec.id}/payment-terms`,"Current effective terms"],[`/accounting/invoices/${inv.id}`,"Original payment terms"],[`/purchasing/receipts/${rec.id}`,"Original payment terms"]]){const page=await fetch(origin+path,{headers:{Cookie:reader}});assert.equal(page.status,200);assert.match(await page.text(),new RegExp(label));}
  for(const path of [`/accounting/invoices/${inv.id}/payment-terms`,`/purchasing/receipts/${rec.id}/payment-terms`])assert.equal((await fetch(origin+path,{headers:{Cookie:wrongBranch}})).status,404);
  const voidInvoice=await invoice("AMEND-VOID"),voidPath=endpoint("invoice",voidInvoice.id),voidFirst={...first,requestId:randomUUID()};assert.equal((await call(voidPath,"POST",voidFirst,operator)).status,201);assert.equal((await call(`/api/invoices/${voidInvoice.id}/status`,"PATCH",{tenantId,action:"void",reason:"Void fixture invoice"},cookie)).status,200);assert.equal((await call(voidPath,"POST",voidFirst,operator)).data.replayed,true);assert.equal((await call(voidPath,"POST",{...clear,requestId:randomUUID(),expectedSequence:1},operator)).status,409);assert.equal((await call(voidPath+query,"GET",undefined,reader)).data.canManage,false);
  for(const data of [{reason:"Rewrite history"},{paymentTerms:"Changed"},{createdAt:new Date("2000-01-01")},{companyId:foreign.id},{branchId:sibling.id}])await assert.rejects(db.paymentTermAmendment.update({where:{id:saved.id},data}));await assert.rejects(db.paymentTermAmendment.delete({where:{id:saved.id}}));
  for(const data of [{paymentTerms:"Rewritten original"},{paymentDueDate:null},{branchId:sibling.id}]){await assert.rejects(db.invoice.update({where:{id:inv.id},data}));await assert.rejects(db.goodsReceipt.update({where:{id:rec.id},data}));}
  assert.equal(await db.auditLog.count({where:{tenantId,entity:"PaymentTermAmendment",entityId:saved.id}}),1);
  const raw=await invoice("AMEND-RAW"),rawBase={id:randomUUID(),tenantId,companyId,branchId:branch.id,invoiceId:raw.id,sequence:1,paymentTerms:future.label,paymentDueDate:new Date(future.dueDate),reason:"Database guard fixture",createdBy:operatorId};
  async function rawWrite(data,audit=true){return db.$transaction(async tx=>{const row=await tx.paymentTermAmendment.create({data});if(audit){const [clock]=await tx.$queryRaw`SELECT txid_current()::text AS transaction`;await tx.auditLog.create({data:{tenantId:data.tenantId,actorId:data.createdBy,entity:"PaymentTermAmendment",entityId:row.id,action:"payment-term.amended",metadata:{parentId:data.invoiceId??data.receiptId,version:data.sequence,transaction:clock.transaction}}});}return row;});}
  await assert.rejects(rawWrite(rawBase,false));assert.equal(await db.paymentTermAmendment.count({where:{invoiceId:raw.id}}),0);
  for(const patch of [{companyId:foreign.id},{tenantId:outsider.data.tenantId},{branchId:sibling.id},{receiptId:rec.id},{invoiceId:null},{sequence:2},{paymentTerms:null},{createdBy:randomUUID()},{paymentTerms:"ab"},{reason:"x"}])await assert.rejects(rawWrite({...rawBase,id:randomUUID(),...patch}));
  const rawSaved=await rawWrite({...rawBase,createdAt:new Date("2001-01-01"),transactionId:"fake transaction"});assert.equal(rawSaved.createdAt.toISOString().slice(0,10),today);assert.notEqual(rawSaved.transactionId,"fake transaction");
  const long=await invoice("AMEND-LONG");await db.$transaction(async tx=>{const [clock]=await tx.$queryRaw`SELECT txid_current()::text AS transaction`;for(let sequence=1;sequence<=53;sequence++){const id=randomUUID();await tx.paymentTermAmendment.create({data:{...rawBase,id,invoiceId:long.id,sequence,paymentTerms:"Terms "+sequence}});await tx.auditLog.create({data:{tenantId,actorId:operatorId,entity:"PaymentTermAmendment",entityId:id,action:"payment-term.amended",metadata:{parentId:long.id,version:sequence,transaction:clock.transaction}}});}},{timeout:15000});
  const longPath=endpoint("invoice",long.id)+query,page1=await call(longPath,"GET",undefined,reader),page2=await call(longPath+"&page=1","GET",undefined,reader);assert.equal(page1.data.changes.length,50);assert.equal(page1.data.nextPage,1);assert.equal(page2.data.changes.length,3);assert.equal(page2.data.nextPage,null);assert.equal(page2.data.current.sequence,53);assert.equal(new Set([...page1.data.changes,...page2.data.changes].map(r=>r.id)).size,53);
  // Cross-source request races can commit only one global id and one audit.
  const shared={...first,requestId:randomUUID()},parallel=await Promise.all([call(endpoint("invoice",otherInvoice.id),"POST",shared,operator),call(endpoint("receipt",wideOrderReceipt.id),"POST",shared,cookie)]);assert.deepEqual(parallel.map(r=>r.status).sort(),[201,409]);assert.deepEqual(parallel.find(r=>r.status===409).data.requestOutcome,{code:"UNRESOLVED",requestId:shared.requestId});assert.equal(await db.auditLog.count({where:{tenantId,entity:"PaymentTermAmendment",entityId:shared.requestId}}),1);
  // The application permission editors take the same Tenant update lock. Verify
  // an already-started retry waits, then sees the committed revocation.
  let waitingRetry;
  await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR UPDATE`;
   waitingRetry=call(invPath,"POST",first,operator);
   let waiting=false;for(let i=0;i<80;i++){await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;const [state]=await tx.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock' AND query LIKE '%"Tenant"%FOR SHARE%') AS waiting`;if(state.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,25));}assert.ok(waiting,"retry waits at tenant authorization boundary");
   for(const permissionKey of [invoicePermission,receiptPermission])await tx.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:role.id,permissionKey}}});
  },{timeout:15000});assert.equal((await waitingRetry).status,403);
  assert.equal(await db.paymentTermAmendment.count({where:{id:first.requestId}}),1);
  assert.equal((await call(invPath,"POST",first,operator)).status,403);assert.equal((await call(recPath,"POST",recFirst,operator)).status,403);assert.equal((await call(invPath+query,"GET",undefined,operator)).status,200);
  await assert.rejects(rawWrite({...rawBase,id:randomUUID(),sequence:2,paymentTerms:"Unauthorized second terms"}));
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:role.id,permissionKey:"invoice:read"}}});assert.equal((await call(invPath+query,"GET",undefined,operator)).status,403);
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:role.id,permissionKey:"purchase-order:read"}}});assert.equal((await call(recPath+query,"GET",undefined,operator)).status,403);
  const readerMember=await db.membership.findFirst({where:{tenantId,user:{name:"Terms reader"}}});await db.membership.update({where:{id:readerMember.id},data:{status:"SUSPENDED"}});assert.equal((await call(invPath+query,"GET",undefined,reader)).status,403);
  assert.equal((await db.$queryRaw`SELECT relrowsecurity FROM pg_class WHERE oid='"PaymentTermAmendment"'::regclass`)[0].relrowsecurity,true);
 }finally{server.kill("SIGTERM");await db.$disconnect();}
});

// Exercise the production top-one query against a disposable temporary fixture,
// not by rewriting immutable event timestamps or disabling any live-table guard.
test("bounded amendment query honors exclusive UTC cutoff, equal timestamps and source/tenant isolation",async()=>{
 const require=createRequire(import.meta.url),exports={};
 const compiled=ts.transpileModule(readFileSync(new URL("../src/lib/payment-term-amendments.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function("require","exports",compiled)(id=>id==="./operational-records"?{OperationalError:class extends Error{}}:id.startsWith(".")?{}:require(id),exports);
 const db=new PrismaClient(),tenantId=randomUUID(),otherTenant=randomUUID(),a=randomUUID(),b=randomUUID(),c=randomUUID(),stamp=new Date("2026-02-01T23:59:59.999Z"),boundary=new Date("2026-02-02T00:00:00.000Z");
 try{await db.$transaction(async tx=>{
  await tx.$executeRaw`CREATE TEMP TABLE "PaymentTermAmendment" ("tenantId" UUID,"invoiceId" UUID,"receiptId" UUID,sequence INTEGER,"paymentTerms" TEXT,"paymentDueDate" DATE,"createdAt" TIMESTAMPTZ(3)) ON COMMIT DROP`;
  for(const row of [{tenantId,invoiceId:a,receiptId:null,sequence:1,paymentTerms:"First",createdAt:stamp},{tenantId,invoiceId:a,receiptId:null,sequence:2,paymentTerms:null,createdAt:stamp},{tenantId,invoiceId:a,receiptId:null,sequence:3,paymentTerms:"After cutoff",createdAt:boundary},{tenantId,invoiceId:b,receiptId:null,sequence:1,paymentTerms:"Other source",createdAt:stamp},{tenantId:otherTenant,invoiceId:a,receiptId:null,sequence:999,paymentTerms:"Other tenant",createdAt:stamp},{tenantId,invoiceId:null,receiptId:c,sequence:1,paymentTerms:"Receipt",createdAt:stamp}])await tx.$executeRaw`INSERT INTO "PaymentTermAmendment" VALUES(${row.tenantId}::uuid,${row.invoiceId}::uuid,${row.receiptId}::uuid,${row.sequence},${row.paymentTerms},NULL,${row.createdAt})`;
  const at=await exports.paymentTermAmendmentsAt(tx,tenantId,"invoice",[a,c],boundary);assert.equal(at.size,1);assert.equal(at.get(a).sequence,2);assert.equal(at.get(a).paymentTerms,null);
  assert.equal((await exports.paymentTermAmendmentsAt(tx,tenantId,"invoice",[a],stamp)).size,0);
  assert.equal((await exports.paymentTermAmendmentsAt(tx,tenantId,"invoice",[a],new Date(boundary.getTime()+1))).get(a).sequence,3);
  assert.equal((await exports.paymentTermAmendmentsAt(tx,tenantId,"receipt",[c,a],boundary)).get(c).paymentTerms,"Receipt");
  assert.equal((await exports.paymentTermAmendmentsAt(tx,tenantId,"receipt",[],boundary)).size,0);
 });}finally{await db.$disconnect();}
});
