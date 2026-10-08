import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {PrismaClient} from "@prisma/client";
const origin="http://127.0.0.1:3226";
async function call(path,method="GET",body,cookie){const r=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};}
test("invoice collections, refunds, corrections and statements preserve exact balances",{timeout:90000},async()=>{
 // Isolated CI PostgreSQL only. No live financial fixtures.
 const db=new PrismaClient(),server=spawn("./node_modules/.bin/next",["start","-p","3226"],{env:{...process.env,ALLOW_REGISTRATION:"true"},stdio:["ignore","ignore","inherit"]});
 try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  async function owner(){const s=randomUUID().slice(0,8),r=await call("/api/auth/register","POST",{name:"Customer finance QA",email:`collections-${s}@example.invalid`,password:"Collections-password-2026",organization:"Customer finance QA",slug:`collections-${s}`});assert.equal(r.status,201);return r;}
  const actor=await owner(),outsider=await owner(),tenantId=actor.data.tenantId,cookie=actor.cookie;
  const create=async(path,body)=>{const r=await call(path,"POST",{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const {company}=await create("/api/companies",{name:"Customer finance",code:"CGL",baseCurrency:"OMR"}),companyId=company.id;
  const {branch}=await create("/api/branches",{companyId,name:"Main",code:"MAIN"}),{branch:sibling}=await create("/api/branches",{companyId,name:"Sibling",code:"SIB"});
  const {customer}=await create("/api/customers",{companyId,branchId:branch.id,code:"CUST",displayName:"=Customer CSV safety"});
  const account=async(code,type,c=companyId)=>(await create("/api/ledger/accounts",{companyId:c,code,name:code,type})).account;
  const receivable=await account("1200","ASSET"),cash=await account("1010","ASSET"),bank=await account("1020","ASSET"),revenue=await account("4000","REVENUE"),liability=await account("2000","LIABILITY");
  const day=new Date().toISOString().slice(0,10),nextDay=new Date(Date.parse(day)+86400000).toISOString().slice(0,10),previousDay=new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
  async function invoice(number,b=branch.id){
   const {quote}=await create("/api/quotes",{companyId,branchId:b,customerId:customer.id,number:`Q-${number}`,lines:[{description:"Service",quantity:3,unitPrice:"2.125"}]});
   for(const action of ["send","accept"])assert.equal((await call(`/api/quotes/${quote.id}/status`,"PATCH",{tenantId,action},cookie)).status,200);
   const {order}=await create(`/api/quotes/${quote.id}/order`,{number:`O-${number}`});
   for(const action of ["start","complete"])assert.equal((await call(`/api/orders/${order.id}/status`,"PATCH",{tenantId,action},cookie)).status,200);
   return (await create(`/api/orders/${order.id}/invoice`,{number})).invoice;
  }
  async function viewer(branchId){const invite=await create("/api/invitations",{email:`collect-view-${randomUUID().slice(0,8)}@example.invalid`,role:"Viewer",scope:{type:"BRANCH",companyId,branchId}});const r=await call("/api/invitations/accept","POST",{token:invite.path.split("/").at(-1),name:"Collections viewer",password:"Collections-viewer-2026"});assert.equal(r.status,200);return r.cookie;}
  const viewerCookie=await viewer(branch.id),siblingCookie=await viewer(sibling.id),viewerRole=await db.role.findUnique({where:{tenantId_name:{tenantId,name:"Viewer"}}});await db.rolePermission.create({data:{tenantId,roleId:viewerRole.id,permissionKey:"ledger:read"}});
  const inv=await invoice("INV-COLLECT"),path=`/api/invoices/${inv.id}/settlements`,get=()=>call(path+`?tenantId=${tenantId}`,"GET",undefined,cookie);
  const pay={tenantId,requestId:randomUUID(),kind:"COLLECTION",amount:"2.000",entryDate:day,assetAccountId:cash.id,reference:"Bank collection 1"};
  assert.equal((await call(path,"POST",pay)).status,401);assert.equal((await call(path,"POST",pay,outsider.cookie)).status,403);assert.equal((await call(path,"POST",pay,viewerCookie)).status,403);assert.equal((await call(path+`?tenantId=${tenantId}`,"GET",undefined,siblingCookie)).status,403);
  assert.equal((await call(path,"POST",pay,cookie)).status,409);
  assert.equal((await call(`/api/invoices/${inv.id}/status`,"PATCH",{tenantId,action:"issue"},cookie)).status,200);
  const post=await call(`/api/ledger/documents/invoice/${inv.id}`,"POST",{tenantId,entryDate:day,debitAccountId:receivable.id,creditAccountId:revenue.id},cookie);assert.equal(post.status,201);
  for(const changed of [{amount:"7"},{amount:"0"},{entryDate:previousDay},{assetAccountId:receivable.id},{assetAccountId:liability.id},{kind:"REFUND"}])assert.ok([400,409].includes((await call(path,"POST",{...pay,...changed},cookie)).status));
  const foreign=await create("/api/companies",{name:"Foreign",code:"FOREIGN"}),foreignCash=await account("1010","ASSET",foreign.company.id);assert.equal((await call(path,"POST",{...pay,assetAccountId:foreignCash.id},cookie)).status,409);
  const makeNumber=(prefix,id)=>`${prefix}-${BigInt("0x"+id.replaceAll("-","")).toString(36).toUpperCase().padStart(25,"0")}`;
  const user=(await db.membership.findFirst({where:{tenantId},select:{userId:true}})).userId;
  const badId=randomUUID();await assert.rejects(db.$transaction(async tx=>{const entry=await tx.journalEntry.create({data:{tenantId,companyId,branchId:branch.id,number:makeNumber("SYSK",badId),entryDate:new Date(day),currency:"OMR",total:"7",description:"Overcollection",createdBy:user,lines:{create:[{position:0,accountId:cash.id,debit:"7",credit:"0"},{position:1,accountId:receivable.id,debit:"0",credit:"7"}]}}});await tx.customerSettlement.create({data:{id:badId,tenantId,companyId,branchId:branch.id,invoiceId:inv.id,entryId:entry.id,kind:"COLLECTION",amount:"7",reference:"Bad direct collection",createdBy:user}});}));assert.equal(await db.journalEntry.count({where:{number:makeNumber("SYSK",badId)}}),0);
  const duplicates=await Promise.all([call(path,"POST",pay,cookie),call(path,"POST",pay,cookie)]);assert.ok(duplicates.every(r=>r.status===201),JSON.stringify(duplicates));assert.equal(duplicates[0].data.settlement.entry.id,duplicates[1].data.settlement.entry.id);const first=duplicates[0].data.settlement;
  assert.equal((await get()).data.balance,"4.375");assert.equal((await get()).data.collected,"2.000");
  for(const change of [{amount:"1"},{assetAccountId:bank.id},{kind:"REFUND"},{reference:"Different payment"}])assert.equal((await call(path,"POST",{...pay,...change},cookie)).status,409);
  await assert.rejects(db.customerSettlement.update({where:{id:first.id},data:{reference:"Edited"}}));await assert.rejects(db.customerSettlement.delete({where:{id:first.id}}));
  const secondPayload={...pay,requestId:randomUUID(),amount:"4.375",reference:"Final collection"};const competing=await Promise.all([call(path,"POST",secondPayload,cookie),call(path,"POST",{...secondPayload,requestId:randomUUID()},cookie)]);assert.deepEqual(competing.map(r=>r.status).sort(),[201,409],JSON.stringify(competing));const second=competing.find(r=>r.status===201).data.settlement;assert.equal((await get()).data.balance,"0.000");
  const refund=await call(path,"POST",{...pay,requestId:randomUUID(),kind:"REFUND",amount:"1.125",entryDate:nextDay,reference:"Customer refund"},cookie);assert.equal(refund.status,201,JSON.stringify(refund.data));const savedRefund=refund.data.settlement;assert.equal((await get()).data.balance,"1.125");assert.equal((await get()).data.collected,"5.250");
  const reverse=(id,number,date=nextDay,c=cookie)=>call(`/api/ledger/journals/${id}/reverse`,"POST",{tenantId,number,entryDate:date,reason:"Correct customer settlement"},c);
  assert.equal((await reverse(post.data.entry.id,"C-PARENT-BLOCK")).status,409);assert.equal((await reverse(second.entry.id,"C-EARLY",day)).status,409);
  assert.equal((await call(path,"POST",{...pay,requestId:randomUUID(),kind:"REFUND",amount:"6" ,entryDate:nextDay},cookie)).status,409);
  const journal=await db.journalEntry.findUnique({where:{id:first.entry.id},include:{lines:{orderBy:{position:"asc"}}}});assert.equal(journal.lines[0].accountId,cash.id);assert.equal(journal.lines[1].accountId,receivable.id);assert.equal(journal.lines[0].debit.toFixed(3),"2.000");
  for(const prefix of ["SYSK","SYSF"])assert.equal((await call("/api/ledger/journals","POST",{tenantId,companyId,branchId:branch.id,number:makeNumber(prefix,randomUUID()),entryDate:day,description:"Reserved",lines:[{accountId:cash.id,debit:"1",credit:"0"},{accountId:receivable.id,debit:"0",credit:"1"}]},cookie)).status,400);
  const reportPath=(from,to)=>`/api/accounting/customer-statement?${new URLSearchParams({tenantId,companyId,customerId:customer.id,from,to})}`;
  const report=await call(reportPath(day,nextDay),"GET",undefined,cookie);assert.equal(report.status,200);assert.equal(report.data.summary[0].closing,"1.125");assert.ok(report.data.rows.some(r=>r.kind==="collection"));assert.ok(report.data.rows.some(r=>r.kind==="refund"));assert.equal((await call(reportPath(day,day),"GET",undefined,cookie)).data.summary[0].closing,"0.000");const opening=await call(reportPath(nextDay,nextDay),"GET",undefined,cookie);assert.equal(opening.data.summary[0].opening,"0.000");assert.equal(opening.data.rows.length,1);
  const csv=await fetch(origin+reportPath(day,nextDay)+"&format=csv",{headers:{Cookie:cookie}});assert.equal(csv.status,200);assert.match(await csv.text(),/"'=Customer CSV safety"/);
  assert.equal((await call(reportPath(day,nextDay),"GET",undefined,siblingCookie)).status,403);assert.equal((await call(reportPath(day,nextDay)+`&branchId=${sibling.id}`,"GET",undefined,viewerCookie)).status,403);
  for(const url of [`/accounting/invoices/${inv.id}/settlements`,`/accounting/collections?scope=${tenantId}:${companyId}`,`/accounting/customer-statement?${new URLSearchParams({scope:`${tenantId}:${companyId}`,customerId:customer.id,from:day,to:nextDay})}`,`/accounting/invoices/${inv.id}`]){const r=await fetch(origin+url,{headers:{Cookie:cookie}});assert.equal(r.status,200,url);assert.match(await r.text(),/FINAL|Final Arrow/);}
  // Refunding the remaining amount makes all collection corrections dependent
  // on reversing refunds first, both at the API and database boundary.
  const finalRefund=await call(path,"POST",{...pay,requestId:randomUUID(),kind:"REFUND",amount:"5.250",entryDate:nextDay,reference:"Remaining refund"},cookie);assert.equal(finalRefund.status,201);assert.equal((await reverse(first.entry.id,"C-REFUND-DEPENDENCY")).status,409);
  await assert.rejects(db.journalEntry.create({data:{tenantId,companyId,branchId:branch.id,number:"C-DIRECT-REV",entryDate:new Date(nextDay),currency:"OMR",total:journal.total,reversalOf:first.entry.id,description:"Direct bad correction",createdBy:user,lines:{create:journal.lines.map(l=>({position:l.position,accountId:l.accountId,debit:l.credit,credit:l.debit}))}}}));
  assert.equal((await reverse(savedRefund.entry.id,"C-REFUND-REV-1")).status,201);assert.equal((await reverse(finalRefund.data.settlement.entry.id,"C-REFUND-REV-2")).status,201);assert.equal((await reverse(first.entry.id,"C-COLLECT-REV-1")).status,201);assert.equal((await reverse(second.entry.id,"C-COLLECT-REV-2")).status,201);
  assert.equal((await reverse(post.data.entry.id,"C-PARENT-EARLY",day)).status,409);assert.equal((await reverse(post.data.entry.id,"C-PARENT-REV")).status,201);assert.equal((await get()).data.balance,"0.000");assert.equal((await call(path,"POST",pay,cookie)).status,201);assert.equal((await call(path,"POST",{...pay,requestId:randomUUID(),entryDate:nextDay},cookie)).status,409);
  assert.equal((await call(`/api/invoices/${inv.id}/status`,"PATCH",{tenantId,action:"void",reason:"Corrected invoice"},cookie)).status,200);assert.equal((await call(reportPath(day,nextDay),"GET",undefined,cookie)).data.summary[0].closing,"0.000");
  const locked=await invoice("INV-LOCK");assert.equal((await call(`/api/invoices/${locked.id}/status`,"PATCH",{tenantId,action:"issue"},cookie)).status,200);assert.equal((await call(`/api/ledger/documents/invoice/${locked.id}`,"POST",{tenantId,entryDate:day,debitAccountId:receivable.id,creditAccountId:revenue.id},cookie)).status,201);assert.equal((await call("/api/ledger/period-lock","PATCH",{tenantId,companyId,lockedThrough:day,expectedLockedThrough:null,reason:"Close collection period"},cookie)).status,200);assert.equal((await call(`/api/invoices/${locked.id}/settlements`,"POST",{...pay,requestId:randomUUID()},cookie)).status,409);assert.equal((await call(`/api/invoices/${locked.id}/settlements`,"POST",{...pay,requestId:randomUUID(),entryDate:nextDay},cookie)).status,201);
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:viewerRole.id,permissionKey:"order:read"}}});assert.equal((await call(path+`?tenantId=${tenantId}`,"GET",undefined,viewerCookie)).status,403);assert.equal((await call(reportPath(day,nextDay),"GET",undefined,viewerCookie)).status,403);
  assert.equal(await db.auditLog.count({where:{tenantId,action:"customer-settlement.recorded"}}),5);
 }finally{server.kill("SIGTERM");await db.$disconnect();}
});
