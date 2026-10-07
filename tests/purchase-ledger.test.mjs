import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {PrismaClient} from "@prisma/client";
const origin="http://127.0.0.1:3223";
async function call(path,method="GET",body,cookie){const r=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};}
test("purchase accruals, credits and supplier statements are exact, scoped and source-dependent",{timeout:90000},async()=>{
 const db=new PrismaClient(),server=spawn("./node_modules/.bin/next",["start","-p","3223"],{env:{...process.env,ALLOW_REGISTRATION:"true"},stdio:["ignore","ignore","inherit"]});
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
  const viewerCookie=await viewer(branch.id),siblingCookie=await viewer(sibling.id),receipt=await receive("PO-PGL"),returned=await returnStock(receipt);
  const path=endpoint("receipt",receipt.id),returnPath=endpoint("return",returned.id);
  assert.equal((await call(path,"POST",receiptBody)).status,401);
  assert.equal((await call(path,"POST",receiptBody,outsider.cookie)).status,403);
  assert.equal((await call(path,"POST",receiptBody,viewerCookie)).status,403);
  assert.equal((await call(path+`?tenantId=${tenantId}`,"GET",undefined,siblingCookie)).status,403);
  assert.equal((await call(returnPath,"POST",creditBody,cookie)).status,409,"credit needs original receipt accrual");
  assert.equal((await call(path,"POST",{...receiptBody,entryDate:previousDay},cookie)).status,409);
  assert.equal((await call(path,"POST",{...receiptBody,debitAccountId:revenue.id},cookie)).status,409);
  assert.equal((await call(path,"POST",{...receiptBody,creditAccountId:asset.id},cookie)).status,409);
  const {company:foreign}=await create("/api/companies",{name:"Foreign accounts",code:"FGL"}),{account:foreignAccount}=await create("/api/ledger/accounts",{companyId:foreign.id,code:"1000",name:"Foreign asset",type:"ASSET"});
  assert.equal((await call(path,"POST",{...receiptBody,debitAccountId:foreignAccount.id},cookie)).status,409);
  const first=await Promise.all([call(path,"POST",receiptBody,cookie),call(path,"POST",receiptBody,cookie)]);assert.deepEqual(first.map(r=>r.status).sort(),[201,409],JSON.stringify(first));
  const original=await db.journalEntry.findUnique({where:{id:first.find(r=>r.status===201).data.entry.id},include:{lines:{orderBy:{position:"asc"}}}});
  assert.equal(original.total.toString(),"4.625");assert.equal(original.branchId,branch.id);assert.equal(original.lines[0].accountId,asset.id);assert.equal(original.lines[1].accountId,payable.id);assert.equal(original.lines[0].debit.toString(),"4.625");assert.equal(original.lines[1].credit.toString(),"4.625");
  const manual={tenantId,companyId,branchId:branch.id,number:original.number,entryDate:day,description:"Reserved source reference",lines:[{accountId:asset.id,debit:"1",credit:"0"},{accountId:payable.id,debit:"0",credit:"1"}]};
  assert.equal((await call("/api/ledger/journals","POST",manual,cookie)).status,400);
  assert.equal((await call("/api/ledger/journals","POST",{...manual,number:original.number.replace("SYSG-","SYST-")},cookie)).status,400);
  assert.equal((await call(returnPath+`?tenantId=${tenantId}`,"GET",undefined,viewerCookie)).status,403);
  const viewerRole=await db.role.findUnique({where:{tenantId_name:{tenantId,name:"Viewer"}}});
  await db.rolePermission.create({data:{tenantId,roleId:viewerRole.id,permissionKey:"ledger:read"}});
  const setup=await call(returnPath+`?tenantId=${tenantId}`,"GET",undefined,viewerCookie);assert.equal(setup.status,200);assert.equal(setup.data.purchaseSetup.debitAccountId,payable.id);assert.equal(setup.data.purchaseSetup.creditAccountId,asset.id);assert.equal(setup.data.amount,"1.125");
  assert.equal((await call(returnPath,"POST",{...creditBody,debitAccountId:otherPayable.id},cookie)).status,409);
  assert.equal((await call(returnPath,"POST",{...creditBody,creditAccountId:expense.id},cookie)).status,409);
  const credits=await Promise.all([call(returnPath,"POST",creditBody,cookie),call(returnPath,"POST",creditBody,cookie)]);assert.deepEqual(credits.map(r=>r.status).sort(),[201,409],JSON.stringify(credits));
  const credit=await db.journalEntry.findUnique({where:{id:credits.find(r=>r.status===201).data.entry.id},include:{lines:{orderBy:{position:"asc"}}}});assert.equal(credit.total.toString(),"1.125");assert.equal(credit.lines[0].accountId,payable.id);assert.equal(credit.lines[1].accountId,asset.id);
  assert.equal(await db.auditLog.count({where:{tenantId,entityId:returned.id,action:"purchase-return.ledger_posted"}}),1);
  assert.equal((await call("/api/ledger/journals","POST",{...manual,number:"PGL-UNRELATED-MANUAL",lines:[{accountId:expense.id,debit:"7",credit:"0"},{accountId:otherPayable.id,debit:"0",credit:"7"}]},cookie)).status,201);
  const statementParams=new URLSearchParams({tenantId,companyId,supplierId:supplier.id,from:day,to:day});
  const statementPath=`/api/purchasing/supplier-statement?${statementParams}`;
  assert.equal((await call(statementPath)).status,401);
  assert.equal((await call(statementPath,"GET",undefined,outsider.cookie)).status,403);
  assert.equal((await call(statementPath,"GET",undefined,siblingCookie)).status,403);
  assert.equal((await call(statementPath+`&branchId=${sibling.id}`,"GET",undefined,viewerCookie)).status,403);
  assert.equal((await call(statementPath+"&from="+day,"GET",undefined,cookie)).status,400);
  assert.equal((await call(statementPath.replace(`from=${day}`,"from=2026-02-30"),"GET",undefined,cookie)).status,400);
  const supplierReport=await call(statementPath,"GET",undefined,viewerCookie);assert.equal(supplierReport.status,200,JSON.stringify(supplierReport.data));
  assert.deepEqual(supplierReport.data.summary,[{currency:"OMR",opening:"0.000",increase:"4.625",decrease:"1.125",closing:"3.500"}]);
  assert.equal(supplierReport.data.rows.length,2);assert.equal(supplierReport.data.rows.at(-1).balance,"3.500");assert.ok(supplierReport.data.rows.every(r=>r.branchId===branch.id));
  const omittedBranch=await call(statementPath+`&branchId=${sibling.id}`,"GET",undefined,cookie);assert.equal(omittedBranch.status,200);assert.equal(omittedBranch.data.rows.length,0);
  const statementPage=await fetch(origin+`/purchasing/supplier-statement?${new URLSearchParams({scope:`${tenantId}:${companyId}`,supplierId:supplier.id,from:day,to:day})}`,{headers:{Cookie:cookie}});assert.equal(statementPage.status,200);assert.match(await statementPage.text(),/3\.500/);
  // Supplier names/codes remain CSV-safe even when they resemble spreadsheet formulas.
  await db.supplier.update({where:{id:supplier.id},data:{displayName:"=HYPERLINK(unsafe)",archivedAt:new Date()}});
  const csv=await fetch(origin+statementPath+"&format=csv",{headers:{Cookie:cookie}});assert.equal(csv.status,200);assert.match(csv.headers.get("cache-control"),/no-store/);const csvText=await csv.text();assert.match(csvText,/"'=HYPERLINK\(unsafe\)"/);assert.match(csvText,/CLOSING/);assert.match(csvText,/3\.500/);

  await db.supplier.update({where:{id:supplier.id},data:{displayName:"Accounting supplier",archivedAt:null}});
  const reverse=(id,number,date=day)=>call(`/api/ledger/journals/${id}/reverse`,"POST",{tenantId,number,entryDate:date,reason:"Correct purchase accounting"},cookie);
  assert.equal((await reverse(original.id,"PGL-PARENT-BLOCKED")).status,409);
  const query=new URLSearchParams({tenantId,companyId});
  const returnRegister=await call(`/api/purchase-orders/returns?${query}`,"GET",undefined,cookie);assert.equal(returnRegister.data.returns.find(r=>r.id===returned.id).financialStatus,"posted");
  const receiptRegister=await call(`/api/purchase-orders/receipts?${query}`,"GET",undefined,cookie);assert.equal(receiptRegister.data.receipts.find(r=>r.id===receipt.id).financialStatus,"posted");
  const report=await call(`/api/ledger/trial-balance?${query}`,"GET",undefined,cookie);assert.equal(report.status,200);assert.equal(report.data.rows.find(r=>r.accountId===asset.id).debitBalance,"3.500");assert.equal(report.data.rows.find(r=>r.accountId===payable.id).creditBalance,"3.500");
  const receiptPrint=await fetch(origin+`/purchasing/receipts/${receipt.id}`,{headers:{Cookie:cookie}});assert.equal(receiptPrint.status,200);assert.match(await receiptPrint.text(),/محاسبة استلام المشتريات|Purchase receipt accounting/);
  const returnPrint=await fetch(origin+`/purchasing/returns/${returned.id}`,{headers:{Cookie:cookie}});assert.equal(returnPrint.status,200);assert.match(await returnPrint.text(),/قيد إشعار مرتجع المشتريات|Purchase return credit/);
  assert.equal((await reverse(credit.id,"PGL-CREDIT-REV",nextDay)).status,201);
  assert.equal((await reverse(original.id,"PGL-PARENT-EARLY")).status,409,"source correction cannot precede its dependent return correction");
  assert.equal((await reverse(original.id,"PGL-PARENT-REV",nextDay)).status,201);
  const historical=await call(statementPath,"GET",undefined,cookie);assert.equal(historical.data.summary[0].closing,"3.500","future corrections cannot change past closing");
  const corrected=await call(statementPath.replace(`from=${day}`,`from=${nextDay}`).replace(`to=${day}`,`to=${nextDay}`),"GET",undefined,cookie);assert.equal(corrected.status,200);assert.deepEqual(corrected.data.summary,[{currency:"OMR",opening:"3.500",increase:"1.125",decrease:"4.625",closing:"0.000"}]);assert.ok(corrected.data.rows.every(r=>r.reversal));

  assert.equal((await call(path,"POST",receiptBody,cookie)).status,409,"reversed source journals cannot post again");
  assert.equal((await call(returnPath,"POST",creditBody,cookie)).status,409);
  // Receipt accounting and full stock correction compete under the same source lock.
  const physical=await receive("PO-PGL-PHYSICAL",[2,0]),movement=await db.stockMovement.findUnique({where:{receiptLineId:physical.lines[0].id}});
  const stockReverse=()=>call(`/api/inventory/movements/${movement.id}/reverse`,"POST",{tenantId,reason:"Correct received stock"},cookie);
  const raced=await Promise.all([call(endpoint("receipt",physical.id),"POST",receiptBody,cookie),stockReverse()]);assert.deepEqual(raced.map(r=>r.status).sort(),[201,409],JSON.stringify(raced));
  if(raced[0].status===201){assert.equal((await stockReverse()).status,409);assert.equal((await reverse(raced[0].data.entry.id,"PGL-STOCK-GL-REV")).status,201);assert.equal((await stockReverse()).status,201);}else assert.equal((await call(endpoint("receipt",physical.id),"POST",receiptBody,cookie)).status,409);
  const raceReceipt=await receive("PO-PGL-DEPENDENCY",[2,0]),raceReturn=await returnStock(raceReceipt);
  const racePosted=await call(endpoint("receipt",raceReceipt.id),"POST",{...receiptBody,debitAccountId:expense.id},cookie);assert.equal(racePosted.status,201);
  const dependent=await Promise.all([reverse(racePosted.data.entry.id,"PGL-DEPENDENCY-REV"),call(endpoint("return",raceReturn.id),"POST",{...creditBody,creditAccountId:expense.id},cookie)]);assert.deepEqual(dependent.map(r=>r.status).sort(),[201,409],JSON.stringify(dependent));
  const locked=await receive("PO-PGL-LOCKED",[1,0]);
  assert.equal((await call("/api/ledger/period-lock","PATCH",{tenantId,companyId,lockedThrough:day,expectedLockedThrough:null,reason:"Close accounting period"},cookie)).status,200);
  assert.equal((await call(endpoint("receipt",locked.id),"POST",receiptBody,cookie)).status,409);
  assert.equal((await call(endpoint("receipt",locked.id),"POST",{...receiptBody,entryDate:nextDay},cookie)).status,201);
  const lockedReturn=await returnStock(locked);assert.equal((await call(endpoint("return",lockedReturn.id),"POST",creditBody,cookie)).status,409);assert.equal((await call(endpoint("return",lockedReturn.id),"POST",{...creditBody,entryDate:nextDay},cookie)).status,201);
  const foreignCurrency=await receive("PO-PGL-USD",[1,0]);await db.purchaseOrder.update({where:{id:foreignCurrency.orderId},data:{currency:"USD"}});assert.equal((await call(endpoint("receipt",foreignCurrency.id),"POST",{...receiptBody,entryDate:nextDay},cookie)).status,409);
  // Removing ledger read hides journal references while preserving authorized stock-document access.
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:viewerRole.id,permissionKey:"ledger:read"}}});
  const noLedger=await call(`/api/purchase-orders/returns?${query}`,"GET",undefined,viewerCookie);assert.equal(noLedger.status,200);assert.ok(noLedger.data.returns.every(r=>r.entry===null&&r.financialStatus==="no_access"));
  const noLedgerReceipts=await call(`/api/purchase-orders/receipts?${query}`,"GET",undefined,viewerCookie);assert.equal(noLedgerReceipts.status,200);assert.ok(noLedgerReceipts.data.receipts.every(r=>r.entry===null&&r.financialStatus==="no_access"));
  assert.equal((await call(returnPath+`?tenantId=${tenantId}`,"GET",undefined,viewerCookie)).status,403);
  assert.equal((await call(statementPath,"GET",undefined,viewerCookie)).status,403);
  const deniedCsv=await fetch(origin+statementPath+"&format=csv",{headers:{Cookie:viewerCookie}});assert.equal(deniedCsv.status,403);
  const noLedgerPrint=await fetch(origin+`/purchasing/returns/${returned.id}`,{headers:{Cookie:viewerCookie}});assert.equal(noLedgerPrint.status,200);assert.doesNotMatch(await noLedgerPrint.text(),/قيد إشعار مرتجع المشتريات|Purchase return credit/);
 }finally{server.kill("SIGTERM");await db.$disconnect();}
});
