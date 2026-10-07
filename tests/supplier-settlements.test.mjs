import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {PrismaClient} from "@prisma/client";
const origin="http://127.0.0.1:3224";
async function call(path,method="GET",body,cookie){const r=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};}
test("supplier payments and refunds are atomic, exact, scoped and reversible",{timeout:90000},async()=>{
 const db=new PrismaClient(),server=spawn("./node_modules/.bin/next",["start","-p","3224"],{env:{...process.env,ALLOW_REGISTRATION:"true"},stdio:["ignore","ignore","inherit"]});
 try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  async function owner(){const s=randomUUID().slice(0,8),r=await call("/api/auth/register","POST",{name:"Purchase finance QA",email:`purchase-gl-${s}@example.invalid`,password:"Purchase-ledger-password-2026",organization:"Purchase GL QA",slug:`purchase-gl-${s}`});assert.equal(r.status,201);return r;}
  const actor=await owner(),outsider=await owner(),tenantId=actor.data.tenantId,cookie=actor.cookie;
  const create=async(path,body)=>{const r=await call(path,"POST",{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const {company}=await create("/api/companies",{name:"Purchase finance company",code:"PGL",baseCurrency:"OMR"}),companyId=company.id;
  const {branch}=await create("/api/branches",{companyId,name:"Main",code:"MAIN"}),{branch:sibling}=await create("/api/branches",{companyId,name:"Sibling",code:"SIB"});
  const {supplier}=await create("/api/suppliers",{companyId,branchId:branch.id,code:"GL-SUP",displayName:"Accounting supplier"});
  const {item:a}=await create("/api/inventory/items",{companyId,branchId:branch.id,sku:"GL-A",name:"First item",unit:"unit"}),{item:b}=await create("/api/inventory/items",{companyId,branchId:branch.id,sku:"GL-B",name:"Second item",unit:"unit"});
  const account=async(code,type)=> (await create("/api/ledger/accounts",{companyId,code,name:`Account ${code}`,type})).account;
  const asset=await account("1400","ASSET"),expense=await account("5000","EXPENSE"),payable=await account("2000","LIABILITY"),otherPayable=await account("2100","LIABILITY"),revenue=await account("4000","REVENUE");
  const day=new Date().toISOString().slice(0,10),nextDay=new Date(Date.parse(day)+86400000).toISOString().slice(0,10),previousDay=new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
  const receiptBody={tenantId,entryDate:day,debitAccountId:asset.id,creditAccountId:payable.id},creditBody={tenantId,entryDate:day,debitAccountId:payable.id,creditAccountId:asset.id};
  const endpoint=(kind,id)=>`/api/ledger/documents/purchase-${kind}/${id}`;
  async function receive(number,quantities=[2,1]){
   const {order}=await create("/api/purchase-orders",{companyId,branchId:branch.id,supplierId:supplier.id,number,lines:[{description:"Purchase first",quantity:6,unitPrice:"1.125"},{description:"Purchase second",quantity:2,unitPrice:"2.375"}]});
   assert.equal((await call(`/api/purchase-orders/${order.id}/status`,"PATCH",{tenantId,action:"issue"},cookie)).status,200);
   const r=await call(`/api/purchase-orders/${order.id}/receive`,"POST",{tenantId,branchId:branch.id,requestId:randomUUID(),lines:order.lines.filter(l=>quantities[l.position]>0).map(l=>({orderLineId:l.id,itemId:l.position?b.id:a.id,quantity:quantities[l.position]}))},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return {...r.data.receipt,order};
  }
  async function returnStock(receipt,quantity=1){const source=receipt.lines.find(l=>l.itemId===a.id);const r=await call(`/api/purchase-orders/receipts/${receipt.id}/returns`,"POST",{tenantId,requestId:randomUUID(),reason:"Purchase finance return",lines:[{receiptLineId:source.id,quantity}]},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data.goodsReturn;}
  async function viewer(branchId){const invite=await create("/api/invitations",{email:`purchase-gl-view-${randomUUID().slice(0,8)}@example.invalid`,role:"Viewer",scope:{type:"BRANCH",companyId,branchId}});const r=await call("/api/invitations/accept","POST",{token:invite.path.split("/").at(-1),name:"GL viewer",password:"Purchase-gl-viewer-password-2026"});assert.equal(r.status,200);return r.cookie;}

  const cash=await account("1010","ASSET"),viewerCookie=await viewer(branch.id),siblingCookie=await viewer(sibling.id);
  const viewerRole=await db.role.findUnique({where:{tenantId_name:{tenantId,name:"Viewer"}}});await db.rolePermission.create({data:{tenantId,roleId:viewerRole.id,permissionKey:"ledger:read"}});
  const receipt=await receive("PO-SETTLEMENT"),path=`/api/purchasing/receipts/${receipt.id}/settlements`;
  const pay={tenantId,requestId:randomUUID(),kind:"PAYMENT",amount:"2.000",entryDate:day,assetAccountId:cash.id,reference:"Bank payment 1"};
  assert.equal((await call(path,"POST",pay)).status,401);assert.equal((await call(path,"POST",pay,outsider.cookie)).status,403);assert.equal((await call(path,"POST",pay,viewerCookie)).status,403);assert.equal((await call(path+`?tenantId=${tenantId}`,"GET",undefined,siblingCookie)).status,403);
  assert.equal((await call(path,"POST",pay,cookie)).status,409,"receipt must be posted first");
  const accrual=await call(endpoint("receipt",receipt.id),"POST",receiptBody,cookie);assert.equal(accrual.status,201);
  assert.equal((await call(path,"POST",{...pay,amount:"5"},cookie)).status,409);assert.equal((await call(path,"POST",{...pay,amount:"0"},cookie)).status,400);assert.equal((await call(path,"POST",{...pay,entryDate:previousDay},cookie)).status,409);assert.equal((await call(path,"POST",{...pay,assetAccountId:payable.id},cookie)).status,409);
  assert.equal((await call(path,"POST",{...pay,kind:"REFUND"},cookie)).status,409,"no refund before supplier debit balance");
  const foreign=await create("/api/companies",{name:"Other settlement company",code:"SC2"});const foreignAsset=await create("/api/ledger/accounts",{companyId:foreign.company.id,code:"1010",name:"Foreign cash",type:"ASSET"});assert.equal((await call(path,"POST",{...pay,assetAccountId:foreignAsset.account.id},cookie)).status,409);
  const makeNumber=(prefix,id)=>`${prefix}-${BigInt("0x"+id.replaceAll("-","")).toString(36).toUpperCase().padStart(25,"0")}`;
  // Direct database writes cannot bypass the source balance constraint, and rollback leaves no orphan journal.
  const badId=randomUUID();await assert.rejects(db.$transaction(async tx=>{const journal=await tx.journalEntry.create({data:{tenantId,companyId,branchId:branch.id,number:makeNumber("SYSD",badId),entryDate:new Date(day),currency:"OMR",total:"5",description:"Invalid overpayment",createdBy:(await tx.membership.findFirst({where:{tenantId},select:{userId:true}})).userId,lines:{create:[{accountId:payable.id,position:0,debit:"5",credit:"0"},{accountId:cash.id,position:1,debit:"0",credit:"5"}]}}});await tx.supplierSettlement.create({data:{id:badId,tenantId,companyId,branchId:branch.id,receiptId:receipt.id,entryId:journal.id,kind:"PAYMENT",amount:"5",reference:"Invalid source amount",createdBy:journal.createdBy}});}));assert.equal(await db.journalEntry.count({where:{number:makeNumber("SYSD",badId)}}),0);
  const duplicate=await Promise.all([call(path,"POST",pay,cookie),call(path,"POST",pay,cookie)]);assert.ok(duplicate.every(r=>r.status===201),JSON.stringify(duplicate));assert.equal(duplicate[0].data.settlement.entry.id,duplicate[1].data.settlement.entry.id);assert.equal(await db.supplierSettlement.count({where:{receiptId:receipt.id}}),1);
  assert.equal((await call(path,"POST",{...pay,amount:"1"},cookie)).status,409);assert.equal((await call(path,"POST",{...pay,assetAccountId:payable.id},cookie)).status,409,"a retry cannot replace the saved asset account");
  const firstPay=duplicate[0].data.settlement;await assert.rejects(db.supplierSettlement.update({where:{id:firstPay.id},data:{reference:"Changed"}}));await assert.rejects(db.supplierSettlement.delete({where:{id:firstPay.id}}));
  const reverse=(id,number,date=day)=>call(`/api/ledger/journals/${id}/reverse`,"POST",{tenantId,number,entryDate:date,reason:"Correct supplier settlement"},cookie);
  assert.equal((await reverse(accrual.data.entry.id,"SET-PARENT-BLOCK")).status,409);
  const creditOne=await returnStock(receipt);const firstCredit=await call(endpoint("return",creditOne.id),"POST",creditBody,cookie);assert.equal(firstCredit.status,201);
  const afterReturn=await call(path+`?tenantId=${tenantId}`,"GET",undefined,viewerCookie);assert.equal(afterReturn.status,200);assert.equal(afterReturn.data.balance,"1.500");
  const raced=await Promise.all([call(path,"POST",{...pay,requestId:randomUUID(),amount:"1.500",reference:"Bank payment 2"},cookie),call(path,"POST",{...pay,requestId:randomUUID(),amount:"1.500",reference:"Competing payment"},cookie)]);assert.deepEqual(raced.map(r=>r.status).sort(),[201,409],JSON.stringify(raced));const secondPay=raced.find(r=>r.status===201).data.settlement;
  const creditTwo=await returnStock(receipt);const secondCredit=await call(endpoint("return",creditTwo.id),"POST",creditBody,cookie);assert.equal(secondCredit.status,201);
  const refundState=await call(path+`?tenantId=${tenantId}`,"GET",undefined,cookie);assert.equal(refundState.data.balance,"-1.125");assert.equal(refundState.data.refundAvailable,"1.125");
  const refund={...pay,requestId:randomUUID(),kind:"REFUND",amount:"1.125",entryDate:nextDay,reference:"Supplier refund"};
  const refunds=await Promise.all([call(path,"POST",refund,cookie),call(path,"POST",{...refund,requestId:randomUUID()},cookie)]);assert.deepEqual(refunds.map(r=>r.status).sort(),[201,409],JSON.stringify(refunds));const savedRefund=refunds.find(r=>r.status===201).data.settlement;
  const originalRefundRequest={...refund,requestId:savedRefund.id};assert.equal((await call(path,"POST",originalRefundRequest,cookie)).status,201);
  const reportQuery=new URLSearchParams({tenantId,companyId,supplierId:supplier.id,from:day,to:nextDay});const statement=await call(`/api/purchasing/supplier-statement?${reportQuery}`,"GET",undefined,cookie);assert.equal(statement.status,200);assert.equal(statement.data.summary[0].closing,"0.000");assert.ok(statement.data.rows.some(r=>r.kind==="payment"));assert.ok(statement.data.rows.some(r=>r.kind==="refund"));
  const current=await call(`/api/purchasing/supplier-balances?${new URLSearchParams({tenantId,companyId,asOf:nextDay})}`,"GET",undefined,cookie);assert.equal(current.data.rows[0].balance,"0.000");const past=await call(`/api/purchasing/supplier-balances?${new URLSearchParams({tenantId,companyId,asOf:day})}`,"GET",undefined,cookie);assert.equal(past.data.rows[0].balance,"-1.125");
  const journal=await db.journalEntry.findUnique({where:{id:savedRefund.entry.id},include:{lines:{orderBy:{position:"asc"}}}});assert.equal(journal.lines[0].accountId,cash.id);assert.equal(journal.lines[1].accountId,payable.id);assert.equal(journal.lines[0].debit.toString(),"1.125");
  for(const prefix of ["SYSD","SYSC"]){assert.equal((await call("/api/ledger/journals","POST",{tenantId,companyId,branchId:branch.id,number:makeNumber(prefix,randomUUID()),entryDate:day,description:"Reserved settlement",lines:[{accountId:cash.id,debit:"1",credit:"0"},{accountId:payable.id,debit:"0",credit:"1"}]},cookie)).status,400);}
  const page=await fetch(origin+`/purchasing/receipts/${receipt.id}/settlements`,{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.match(await page.text(),/دفعة المورد|Supplier payment/);const register=await fetch(origin+"/purchasing/settlements",{headers:{Cookie:cookie}});assert.equal(register.status,200);assert.match(await register.text(),/Supplier refund/);
  assert.equal((await reverse(firstPay.entry.id,"SET-EARLY-REV")).status,409);
  for(const [index,s] of [firstPay,secondPay,savedRefund].entries())assert.equal((await reverse(s.entry.id,`SET-REVERSE-${index}`,nextDay)).status,201);
  assert.equal((await reverse(firstCredit.data.entry.id,"SET-CREDIT-REV-1",nextDay)).status,201);assert.equal((await reverse(secondCredit.data.entry.id,"SET-CREDIT-REV-2",nextDay)).status,201);assert.equal((await reverse(accrual.data.entry.id,"SET-RECEIPT-REV",nextDay)).status,201);
  assert.equal((await call(path,"POST",{...pay,requestId:randomUUID()},cookie)).status,409);assert.equal((await call(path,"POST",pay,cookie)).status,201,"exact retry still returns its saved corrected record");
  const lockedReceipt=await receive("PO-SET-LOCK"),lockedPath=`/api/purchasing/receipts/${lockedReceipt.id}/settlements`;assert.equal((await call(endpoint("receipt",lockedReceipt.id),"POST",receiptBody,cookie)).status,201);assert.equal((await call("/api/ledger/period-lock","PATCH",{tenantId,companyId,lockedThrough:day,expectedLockedThrough:null,reason:"Close period"},cookie)).status,200);assert.equal((await call(lockedPath,"POST",{...pay,requestId:randomUUID()},cookie)).status,409);assert.equal((await call(lockedPath,"POST",{...pay,requestId:randomUUID(),entryDate:nextDay},cookie)).status,201);
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:viewerRole.id,permissionKey:"ledger:read"}}});assert.equal((await call(path+`?tenantId=${tenantId}`,"GET",undefined,viewerCookie)).status,403);
 }finally{server.kill("SIGTERM");await db.$disconnect();}
});
