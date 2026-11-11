import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import {PrismaClient} from "@prisma/client";
const inputModule={exports:{}};
new Function("require","module","exports",ts.transpileModule(readFileSync("src/lib/stock-transfer-input.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(createRequire(import.meta.url),inputModule,inputModule.exports);
const {stockTransferResponseMatches,stockTransferCancellationMatches}=inputModule.exports;
const origin="http://127.0.0.1:3291";
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,method="GET",body,cookie){const r=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data,cookie:r.headers.get("set-cookie")?.split(";")[0]};}
test("paired branch transfers conserve stock, protect holds, authorize both scopes and permanently resolve uncertain requests",{timeout:180000},async()=>{
 // Only a disposable local database. Fixtures are never applied to live ERP data.
 const db=new PrismaClient(),server=spawn("./node_modules/.bin/next",["start","-H","127.0.0.1","-p","3291"],{env:{...process.env,ALLOW_REGISTRATION:"true",DATABASE_URL:process.env.TRANSFER_ONE_POOL?process.env.DATABASE_URL.replace(/connection_limit=\d+/,"connection_limit=1"):process.env.DATABASE_URL},stdio:["ignore","ignore","inherit"]});
 try{
  let ready=false;for(let i=0;i<90;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready);
  const suffix=randomUUID().slice(0,8),reg=await call("/api/auth/register","POST",{name:"Transfer owner",email:`transfer-${suffix}@example.invalid`,password:"Stock-transfer-password-2026",organization:"Transfer QA",slug:`transfers-${suffix}`});assert.equal(reg.status,201,JSON.stringify(reg));
  const tenantId=reg.data.tenantId,cookie=reg.cookie,userId=(await db.membership.findFirstOrThrow({where:{tenantId}})).userId;
  const create=async(path,body)=>{const r=await call(path,"POST",{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r));return r.data;};
  const {company}=await create("/api/companies",{name:"Transfer Company",code:"TR",baseCurrency:"OMR"}),companyId=company.id;
  const {branch:source}=await create("/api/branches",{companyId,name:"Source branch",code:"SRC"}),{branch:destination}=await create("/api/branches",{companyId,name:"Private destination",code:"DST"});
  const {company:otherCo}=await create("/api/companies",{name:"Other company",code:"OTHER",baseCurrency:"OMR"}),{branch:other}=await create("/api/branches",{companyId:otherCo.id,name:"Other branch",code:"OTHER"});
  const {item}=await create("/api/inventory/items",{companyId,sku:"TR-1",name:"Original transfer item",unit:"kg"});
  const {item:owned}=await create("/api/inventory/items",{companyId,branchId:source.id,sku:"TR-OWN",name:"Branch owned item",unit:"kg"});
  const scope={tenantId,companyId},branchScope={...scope,branchId:source.id},endpoint="/api/inventory/transfers";
  const input={...scope,expectedActorId:userId,action:"transfer",requestId:randomUUID(),sourceBranchId:source.id,destinationBranchId:destination.id,itemId:item.id,expectedUnit:"kg",quantity:"3.125",reference:"=private reference",reason:"Private transfer reason"};
  const adjust=(branchId,quantity,action="in",itemId=item.id)=>create("/api/inventory/stock",{...scope,branchId,itemId,quantity,action,reason:"Isolated transfer QA adjustment"});
  await adjust(source.id,"20.125");
  async function member(branchId,role="Viewer"){
   const invitation=await create("/api/invitations",{email:`transfer-member-${randomUUID().slice(0,8)}@example.invalid`,role,scope:{type:"BRANCH",companyId,branchId}});
   const r=await call("/api/invitations/accept","POST",{token:invitation.path.split("/").at(-1),name:"Transfer operator",password:"Transfer-member-password-2026"});assert.equal(r.status,200);return r;
  }
  const viewer=await member(source.id),manager=await member(source.id,"Manager"),operator=await member(source.id);
  const operatorUser=(await db.session.findUniqueOrThrow({where:{tokenHash:(await import("node:crypto")).createHash("sha256").update(operator.cookie.split("=")[1]).digest("hex")}})).userId;
  const membership=await db.membership.findUniqueOrThrow({where:{tenantId_userId:{tenantId,userId:operatorUser}}});
  const custom=await db.role.create({data:{tenantId,name:`Transfer operator ${suffix}`,permissions:{create:["inventory-stock:read","inventory-stock:adjust","inventory-transfer:manage"].map(permissionKey=>({permissionKey}))}}});
  await db.roleGrant.create({data:{tenantId,membershipId:membership.id,roleId:custom.id,scopes:{create:[source.id,destination.id].map(branchId=>({type:"BRANCH",companyId,branchId}))}}});
  assert.equal((await call(endpoint,"POST",input)).status,401);assert.equal((await call(endpoint,"POST",input,viewer.cookie)).status,403);assert.equal((await call(endpoint,"POST",input,manager.cookie)).status,403,"Manager receives no automatic transfer permission");
  for(const changed of [{quantity:"0"},{quantity:"-1"},{quantity:"1e2"},{quantity:"1.0001"},{quantity:"1000000000"},{reference:"x"},{reason:"x"},{sourceBranchId:destination.id},{extra:true}])assert.equal((await call(endpoint,"POST",{...input,...changed},cookie)).status,400,JSON.stringify(changed));
  assert.equal((await call(endpoint,"POST",{...input,requestId:randomUUID(),destinationBranchId:other.id},cookie)).status,409);
  assert.equal((await call(endpoint,"POST",{...input,requestId:randomUUID(),itemId:owned.id},cookie)).status,409);
  const retry=await Promise.all([call(endpoint,"POST",input,cookie),call(endpoint,"POST",input,cookie)]);assert.ok(retry.every(r=>r.status===201),JSON.stringify(retry));assert.equal(retry[0].data.transfer.id,retry[1].data.transfer.id);assert.ok(stockTransferResponseMatches(input,retry[0].data.transfer),"actual API receipt resolves client pending request");
  const getBalance=branchId=>db.stockBalance.findUniqueOrThrow({where:{tenantId_companyId_branchId_itemId:{tenantId,companyId,branchId,itemId:item.id}}});
  assert.equal((await getBalance(source.id)).quantity.toFixed(3),"17.000");assert.equal((await getBalance(destination.id)).quantity.toFixed(3),"3.125");
  assert.equal(await db.stockMovement.count({where:{transferId:input.requestId}}),2);assert.equal(await db.auditLog.count({where:{entity:"StockTransfer",entityId:input.requestId}}),1);
  for(const changed of [{quantity:"3.124"},{reason:"Changed reason"},{reference:"Changed reference"},{destinationBranchId:source.id,sourceBranchId:destination.id}])assert.equal((await call(endpoint,"POST",{...input,...changed},cookie)).status,409);
  assert.equal((await call(endpoint,"POST",{...input,expectedActorId:operatorUser},operator.cookie)).status,409,"different authorized actor cannot replay");
  assert.equal((await call(endpoint,"POST",{...input,requestId:input.requestId.toUpperCase(),quantity:"3.125"},cookie)).status,201);
  const staleActor={...input,requestId:randomUUID()};
  assert.equal((await call(endpoint,"POST",staleActor,operator.cookie)).status,403);
  assert.equal((await call(endpoint+"/cancel","POST",staleActor,operator.cookie)).status,403);
  assert.equal(await db.stockTransfer.count({where:{id:staleActor.requestId}}),0);assert.equal(await db.stockTransferCancellation.count({where:{id:staleActor.requestId}}),0);
  const query="?"+new URLSearchParams(scope),read=await call(endpoint+query,"GET",undefined,operator.cookie);assert.equal(read.status,200);assert.equal(read.data.transfers.length,1);
  assert.equal((await call(endpoint+query,"GET",undefined,viewer.cookie)).status,403);
  assert.equal((await call(endpoint+`/${input.requestId}?tenantId=${tenantId}`,"GET",undefined,viewer.cookie)).status,404);
  assert.equal((await call(endpoint+query+"&format=csv","GET",undefined,viewer.cookie)).status,403);
  assert.equal((await call(endpoint+`/${input.requestId.toUpperCase()}?tenantId=${tenantId.toUpperCase()}`,"GET",undefined,cookie)).status,200);
  const upperCsv=await call(endpoint+"?"+new URLSearchParams({tenantId:tenantId.toUpperCase(),companyId:companyId.toUpperCase(),sourceBranchId:source.id.toUpperCase(),itemId:item.id.toUpperCase(),format:"csv"}),"GET",undefined,cookie);assert.equal(upperCsv.status,200);assert.match(upperCsv.data,new RegExp(input.requestId));
  const csv=await call(endpoint+query+"&format=csv","GET",undefined,cookie);assert.equal(csv.status,200);assert.match(csv.data,/"'=private reference"/);
  assert.equal((await call(endpoint+query+"&page=0&page=1","GET",undefined,cookie)).status,400);
  const own=await call("/api/inventory/stock?"+new URLSearchParams(branchScope),"GET",undefined,viewer.cookie);assert.equal(own.status,200);const ownLeg=own.data.movements.find(m=>m.type==="TRANSFER_OUT");assert.equal(ownLeg.transferId,null);assert.equal(ownLeg.reason,"Branch stock transfer");for(const secret of [destination.id,destination.name,input.reference,input.reason,input.requestId])assert.ok(!JSON.stringify(own).includes(secret),secret);
  const day=new Date().toISOString().slice(0,10);
  for(const format of ["json","csv"]){const report=await call("/api/inventory/stock/report?"+new URLSearchParams({...branchScope,itemId:item.id,from:day,to:day,timeZone:"UTC",format}),"GET",undefined,viewer.cookie);assert.equal(report.status,200);for(const secret of [destination.id,destination.name,input.reference,input.reason,input.requestId])assert.ok(!JSON.stringify(report.data).includes(secret),`stock ${format}: ${secret}`);}
  const full=await call("/api/inventory/stock?"+new URLSearchParams(branchScope),"GET",undefined,cookie);assert.equal(full.data.movements.find(m=>m.type==="TRANSFER_OUT").transferId,input.requestId);
  assert.equal((await call(`/api/inventory/movements/${ownLeg.id}/reverse`,"POST",{tenantId,reason:"Cannot reverse one leg"},cookie)).status,409);
  const reserve=await create("/api/inventory/reservations",{...branchScope,action:"reserve",requestId:randomUUID(),itemId:item.id,quantity:"16.000",reference:"Retain held source stock"});
  assert.equal((await call(endpoint,"POST",{...input,requestId:randomUUID(),quantity:"1.001"},cookie)).status,409);
  const small={...input,expectedActorId:operatorUser,requestId:randomUUID(),quantity:"0.001"};assert.equal((await call(endpoint,"POST",small,operator.cookie)).status,201);
  assert.equal((await getBalance(source.id)).reservedQuantity.toFixed(3),"16.000");
  const reverse={...scope,expectedActorId:userId,action:"correct",requestId:randomUUID(),transferId:input.requestId,reason:"Full paired correction"};
  const dstHold=await create("/api/inventory/reservations",{...scope,branchId:destination.id,action:"reserve",requestId:randomUUID(),itemId:item.id,quantity:"1",reference:"Keep destination hold"});
  assert.equal((await call(endpoint,"POST",reverse,cookie)).status,409);
  await create("/api/inventory/reservations",{...scope,branchId:destination.id,action:"release",requestId:randomUUID(),reservationId:dstHold.reservation.id,reason:"Allow source correction"});
  assert.equal((await call(`/api/inventory/items/${item.id}`,"PATCH",{tenantId,action:"update",unit:"box",name:"Renamed transfer item"},cookie)).status,200);
  assert.equal((await call(endpoint,"POST",reverse,cookie)).status,409,"unit mismatch blocks correction");
  assert.equal((await call(`/api/inventory/items/${item.id}`,"PATCH",{tenantId,action:"update",unit:"kg"},cookie)).status,200);
  const snapshots=(await call(endpoint+`/${input.requestId}?tenantId=${tenantId}`,"GET",undefined,cookie)).data.transfer;assert.equal(snapshots.itemName,"Original transfer item");assert.equal(snapshots.unit,"kg");
  const corrected=await Promise.all([call(endpoint,"POST",reverse,cookie),call(endpoint,"POST",{...reverse,requestId:randomUUID()},cookie)]);assert.deepEqual(corrected.map(r=>r.status).sort(),[201,409],JSON.stringify(corrected));
  const correction=corrected.find(r=>r.status===201).data.transfer;assert.equal(correction.quantity,"3.125");assert.equal(correction.sourceBranchId,destination.id);assert.equal(correction.destinationBranchId,source.id);
  assert.equal((await call(endpoint,"POST",{...reverse,requestId:correction.id},cookie)).status,201);
  assert.equal((await call(endpoint,"POST",{...reverse,requestId:randomUUID(),transferId:correction.id},cookie)).status,409);
  assert.equal((await call(endpoint,"POST",input,cookie)).status,201,"original replays after correction");
  await create("/api/inventory/reservations",{...branchScope,action:"release",requestId:randomUUID(),reservationId:reserve.reservation.id,reason:"Finish held source test"});
  const impossible={...input,requestId:randomUUID(),quantity:"999999999.999"};assert.equal((await call(endpoint,"POST",impossible,cookie)).status,409);
  const cancel=await call(endpoint+"/cancel","POST",impossible,cookie);assert.equal(cancel.status,200,JSON.stringify(cancel));assert.equal(cancel.data.cancellation.id,impossible.requestId);assert.ok(stockTransferCancellationMatches(impossible,cancel.data.cancellation,userId));
  assert.equal((await call(endpoint+"/cancel","POST",impossible,cookie)).status,200);assert.equal((await call(endpoint+"/cancel","POST",{...impossible,reason:"Different cancellation"},cookie)).status,409);assert.equal((await call(endpoint+"/cancel","POST",{...impossible,expectedActorId:operatorUser},operator.cookie)).status,409);
  assert.equal((await call(endpoint,"POST",impossible,cookie)).status,409,"tombstone prevents delayed original");
  const already=await call(endpoint+"/cancel","POST",input,cookie);assert.equal(already.status,200);assert.equal(already.data.transfer.id,input.requestId);
  const raceInput={...input,requestId:randomUUID(),quantity:"0.001"};const race=await Promise.all([call(endpoint,"POST",raceInput,cookie),call(endpoint+"/cancel","POST",raceInput,cookie)]);assert.ok([201,409].includes(race[0].status));assert.equal(race[1].status,200,JSON.stringify(race));assert.equal((await db.stockTransfer.count({where:{id:raceInput.requestId}}))+(await db.stockTransferCancellation.count({where:{id:raceInput.requestId}})),1);
  const before=(await getBalance(source.id)).quantity.plus((await getBalance(destination.id)).quantity);
  await adjust(destination.id,"5.000");
  const opposite=await Promise.all([call(endpoint,"POST",{...input,requestId:randomUUID(),quantity:"2.500"},cookie),call(endpoint,"POST",{...input,requestId:randomUUID(),sourceBranchId:destination.id,destinationBranchId:source.id,quantity:"2.500"},cookie)]);assert.ok(opposite.every(r=>r.status===201),JSON.stringify(opposite));
  assert.ok((await getBalance(source.id)).quantity.plus((await getBalance(destination.id)).quantity).eq(before.plus(5)));
  const balance=await getBalance(source.id),legs=await db.stockMovement.findMany({where:{transferId:input.requestId}});
  await assert.rejects(db.stockTransfer.update({where:{id:input.requestId},data:{reason:"Rewrite history"}}));await assert.rejects(db.stockTransfer.delete({where:{id:input.requestId}}));
  await assert.rejects(db.stockMovement.delete({where:{id:legs[0].id}}));await assert.rejects(db.stockMovement.update({where:{id:legs[0].id},data:{delta:"9"}}));
  await assert.rejects(db.stockMovement.create({data:{tenantId,balanceId:balance.id,type:"TRANSFER_OUT",delta:"-1",reason:"Branch stock transfer",actorId:userId,transferId:input.requestId}}));
  await assert.rejects(db.stockBalance.update({where:{id:balance.id},data:{quantity:{increment:"1"}}}));await assert.rejects(db.stockBalance.update({where:{id:balance.id},data:{transferOpeningDelta:"1"}}));await assert.rejects(db.stockBalance.update({where:{id:balance.id},data:{branchId:other.id}}));
  await assert.rejects(db.inventoryItem.update({where:{id:item.id},data:{branchId:source.id}}));
  const audit=await db.auditLog.findFirstOrThrow({where:{entity:"StockTransfer",entityId:input.requestId}});await assert.rejects(db.auditLog.delete({where:{id:audit.id}}));await assert.rejects(db.auditLog.update({where:{id:audit.id},data:{action:"forged"}}));
  await assert.rejects(db.auditLog.create({data:{tenantId,actorId:userId,action:"inventory-stock.reversed",entity:"StockMovement",entityId:legs[0].id,metadata:{reason:"Illegal one-leg reversal"}}}));
  await assert.rejects(db.stockTransferCancellation.delete({where:{id:impossible.requestId}}));
  const rawId=randomUUID();await db.stockTransfer.create({data:{id:rawId,tenantId,companyId,sourceBranchId:source.id,destinationBranchId:destination.id,itemId:item.id,quantity:"0.001",reference:"Raw guarded operation",reason:"Guard supplies pair and audit",createdBy:userId,itemName:"forged",createdAt:new Date("2001-01-01")}});
  const raw=await db.stockTransfer.findUniqueOrThrow({where:{id:rawId}});assert.equal(raw.unit,"kg");assert.notEqual(raw.itemName,"forged");assert.ok(raw.createdAt>new Date("2026-01-01"));assert.equal(await db.stockMovement.count({where:{transferId:rawId}}),2);
  assert.equal((await call(`/api/inventory/items/${item.id}`,"PATCH",{tenantId,action:"archive",archived:true},cookie)).status,200);assert.equal((await call(endpoint,"POST",{...input,requestId:randomUUID(),quantity:"0.001"},cookie)).status,409);assert.equal((await call(endpoint,"POST",input,cookie)).status,201);assert.equal((await call(`/api/inventory/items/${item.id}`,"PATCH",{tenantId,action:"archive",archived:false},cookie)).status,200);
  const concurrent=await Promise.all([call(endpoint,"POST",{...input,requestId:randomUUID(),quantity:"0.001"},cookie),call("/api/inventory/stock","POST",{...branchScope,itemId:item.id,action:"in",quantity:"0.001",reason:"Concurrent adjustment"},cookie),call("/api/inventory/reservations","POST",{...branchScope,action:"reserve",requestId:randomUUID(),itemId:item.id,quantity:"0.001",reference:"Concurrent reserve"},cookie)]);assert.ok(concurrent.every(r=>r.status===201),JSON.stringify(concurrent));
  // A legacy DELETE takes its balance lock before testing the first-transfer boundary.
  const {item:legacy}=await create("/api/inventory/items",{companyId,sku:"TR-LEGACY",name:"Legacy movement race",unit:"unit"});await adjust(source.id,"2","in",legacy.id);
  const legacyBalance=await db.stockBalance.findFirstOrThrow({where:{...branchScope,itemId:legacy.id}}),legacyMovement=await db.stockMovement.findFirstOrThrow({where:{balanceId:legacyBalance.id}});
  let deleted;const deletedGate=new Promise(r=>deleted=r);let releaseDelete;const deleteWait=new Promise(r=>releaseDelete=r);
  const deleting=db.$transaction(async tx=>{await tx.stockMovement.delete({where:{id:legacyMovement.id}});deleted();await deleteWait;});await deletedGate;
  const duringDelete=call(endpoint,"POST",{...input,requestId:randomUUID(),itemId:legacy.id,expectedUnit:"unit",quantity:"1"},cookie);
  let transferWaiting=false;for(let attempt=0;attempt<100;attempt++){const blocked=await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%StockTransfer%'`;if(blocked[0].count>0){transferWaiting=true;break;}await delay(10);}releaseDelete();await deleting;assert.ok(transferWaiting,"first transfer must wait for the legacy history edit balance lock");assert.equal((await duringDelete).status,201);
  const legacyAfter=await db.stockBalance.findUniqueOrThrow({where:{id:legacyBalance.id}});assert.equal(legacyAfter.transferOpeningDelta.toFixed(3),"2.000");assert.equal(legacyAfter.quantity.toFixed(3),"1.000");
  const offsetQuery=new URLSearchParams({...branchScope,itemId:legacy.id,from:day,to:day,timeZone:"UTC"});
  const offsetJson=await call("/api/inventory/stock/report?"+offsetQuery,"GET",undefined,viewer.cookie);assert.equal(offsetJson.status,200);assert.equal(offsetJson.data.basis,"RECORDED_MOVEMENTS_ONLY");assert.equal(offsetJson.data.undatedOpeningOffset,"2.000");assert.deepEqual(offsetJson.data.summary,{opening:"0.000",incoming:"0.000",outgoing:"1.000",closing:"-1.000",count:1});assert.equal(offsetJson.data.rows[0].balance,"-1.000");
  const offsetCsv=await call("/api/inventory/stock/report?"+offsetQuery+"&format=csv","GET",undefined,viewer.cookie);assert.equal(offsetCsv.status,200);
  const csvRows=offsetCsv.data.trim().split("\r\n").map(line=>line.replace(/^\uFEFF/,"").slice(1,-1).split('","'));
  assert.deepEqual(csvRows[0].slice(0,10),["SKU","Item","Unit","Branch","Time zone","Time","Type","Delta","Running balance","Reason"]);assert.deepEqual(csvRows[0].slice(10),["Report basis","Undated opening offset","Report note"]);
  assert.equal(csvRows[1][8],"0.000");assert.equal(csvRows[2][7],"'-1.000");assert.equal(csvRows[2][8],"'-1.000");assert.equal(csvRows[3][8],"'-1.000");
  for(const row of csvRows.slice(1)){assert.equal(row[10],"RECORDED_MOVEMENTS_ONLY");assert.equal(row[11],"2.000");assert.match(row[12],/not historical physical balances/);}
  assert.equal((await db.stockBalance.findUniqueOrThrow({where:{id:legacyBalance.id}})).quantity.toFixed(3),"1.000","report does not mutate physical balance");
  assert.equal((await call("/api/inventory/stock/report?"+offsetQuery,"GET",undefined,manager.cookie)).status,200);
  const deniedOffset=new URLSearchParams({...branchScope,branchId:destination.id,itemId:legacy.id,from:day,to:day,timeZone:"UTC"});assert.equal((await call("/api/inventory/stock/report?"+deniedOffset,"GET",undefined,viewer.cookie)).status,403);
  const legacyNew=await db.stockMovement.findFirstOrThrow({where:{balanceId:legacyBalance.id}});await assert.rejects(db.stockMovement.delete({where:{id:legacyNew.id}}));
  // Destination overflow rolls back both new projection anchors and both legs.
  const {item:bounded}=await create("/api/inventory/items",{companyId,sku:"TR-LIMIT",name:"Transfer boundary item",unit:"unit"});
  const srcBound=await db.stockBalance.create({data:{tenantId,companyId,branchId:source.id,itemId:bounded.id,quantity:"999999999.999"}});
  const uninitialized=await call("/api/inventory/stock/report?"+new URLSearchParams({...branchScope,itemId:bounded.id,from:day,to:day,timeZone:"UTC"}),"GET",undefined,cookie);assert.equal(uninitialized.status,200);assert.equal(uninitialized.data.basis,"RECORDED_MOVEMENTS_ONLY");assert.equal(uninitialized.data.undatedOpeningOffset,null);assert.equal(uninitialized.data.summary.closing,"0.000");
  const dstBound=await db.stockBalance.create({data:{tenantId,companyId,branchId:destination.id,itemId:bounded.id,quantity:"999999999999999.999"}});
  const boundInput={...input,itemId:bounded.id,expectedUnit:"unit",quantity:"0.001",requestId:randomUUID()};
  assert.equal((await call(endpoint,"POST",boundInput,cookie)).status,409);assert.equal((await db.stockBalance.findUniqueOrThrow({where:{id:srcBound.id}})).quantity.toFixed(3),"999999999.999");assert.equal(await db.stockTransfer.count({where:{id:boundInput.requestId}}),0);
  await db.stockBalance.update({where:{id:dstBound.id},data:{quantity:"0"}});
  assert.equal((await call(endpoint,"POST",{...boundInput,quantity:"999999999.999"},cookie)).status,201);
  // Item archive and unit edits serialize with creation, using a locked item snapshot.
  const {item:racy}=await create("/api/inventory/items",{companyId,sku:"TR-RACE",name:"Transfer catalog race",unit:"unit"});await adjust(source.id,"5.000","in",racy.id);
  for(const mode of ["archive","unit"]){
   let locked;const gate=new Promise(r=>locked=r);let release;const wait=new Promise(r=>release=r);
   const edit=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id=${racy.id}::uuid FOR UPDATE`;locked();await wait;await tx.inventoryItem.update({where:{id:racy.id},data:mode==="archive"?{archivedAt:new Date()}:{unit:"box"}});});
   await gate;const incoming=call(endpoint,"POST",{...input,requestId:randomUUID(),itemId:racy.id,expectedUnit:"unit",quantity:"1"},cookie);await delay(50);release();await edit;assert.equal((await incoming).status,409,mode);await db.inventoryItem.update({where:{id:racy.id},data:{unit:"unit",archivedAt:null}});
  }
  // Concurrent receipts, supplier returns, order-linked holds and opposite transfers.
  const {supplier}=await create("/api/suppliers",{companyId,branchId:source.id,code:"TR-SUP",displayName:"Transfer supplier"});
  const {order:po}=await create("/api/purchase-orders",{companyId,branchId:source.id,supplierId:supplier.id,number:"TR-PO",lines:[{description:"Transfer and receipt stock",quantity:4,unitPrice:"1"}]});assert.equal((await call(`/api/purchase-orders/${po.id}/status`,"PATCH",{tenantId,action:"issue"},cookie)).status,200);
  const receiptBody={tenantId,branchId:source.id,requestId:randomUUID(),lines:[{orderLineId:po.lines[0].id,itemId:item.id,quantity:2}]};
  const withReceipt=await Promise.all([call(`/api/purchase-orders/${po.id}/receive`,"POST",receiptBody,cookie),call(endpoint,"POST",{...input,requestId:randomUUID(),quantity:"0.001"},cookie)]);assert.ok(withReceipt.every(r=>r.status===201),JSON.stringify(withReceipt));
  const receipt=withReceipt[0].data.receipt;
  const withReturn=await Promise.all([call(`/api/purchase-orders/receipts/${receipt.id}/returns`,"POST",{tenantId,requestId:randomUUID(),reason:"Transfer concurrent stock return",lines:[{receiptLineId:receipt.lines[0].id,quantity:1}]},cookie),call(endpoint,"POST",{...input,requestId:randomUUID(),quantity:"0.001"},cookie)]);assert.ok(withReturn.every(r=>r.status===201),JSON.stringify(withReturn));
  const {customer}=await create("/api/customers",{companyId,branchId:source.id,code:"TR-CUST",displayName:"Transfer customer"});
  const {quote:salesQuote}=await create("/api/quotes",{companyId,branchId:source.id,customerId:customer.id,number:"TR-SO",lines:[{description:"Descriptive association only",quantity:1,unitPrice:"1"}]});
  for(const action of ["send","accept"])assert.equal((await call(`/api/quotes/${salesQuote.id}/status`,"PATCH",{tenantId,action},cookie)).status,200);
  const {order:so}=await create(`/api/quotes/${salesQuote.id}/order`,{number:"TR-SO"});
  const orderHold={...branchScope,action:"reserve",expectedActorId:userId,expectedUnit:"kg",requestId:randomUUID(),itemId:item.id,quantity:"0.001",note:"Transfer concurrent order hold"};
  const withOrder=await Promise.all([call(`/api/orders/${so.id}/reservations`,"POST",orderHold,cookie),call(endpoint,"POST",{...input,requestId:randomUUID(),quantity:"0.001"},cookie)]);assert.ok(withOrder.every(r=>r.status===201),JSON.stringify(withOrder));
  // Hide unauthorized transfers before paging: 51 transfers with a hidden branch do not change the visible page.
  const {branch:hidden}=await create("/api/branches",{companyId,name:"Hidden third branch",code:"HIDDEN"});
  await db.$transaction(async tx=>{for(let n=0;n<51;n++)await tx.stockTransfer.create({data:{id:randomUUID(),tenantId,companyId,sourceBranchId:source.id,destinationBranchId:hidden.id,itemId:item.id,quantity:"0.001",reference:`Hidden transfer ${n}`,reason:"Scope-before-pagination test",createdBy:userId}});},{timeout:15000});
  const visible=await call(endpoint+query,"GET",undefined,operator.cookie);assert.equal(visible.status,200);assert.equal(visible.data.nextPage,null);assert.ok(visible.data.transfers.every(row=>row.sourceBranchId!==hidden.id&&row.destinationBranchId!==hidden.id));

  let tenantLocked;const tenantGate=new Promise(r=>tenantLocked=r);let releaseTenant;const tenantWait=new Promise(r=>releaseTenant=r);
  const revoking=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR UPDATE`;tenantLocked();await tenantWait;await tx.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:custom.id,permissionKey:"inventory-transfer:manage"}}});});await tenantGate;
  const revokedAttempt=call(endpoint,"POST",{...small,requestId:randomUUID()},operator.cookie);await delay(50);releaseTenant();await revoking;assert.equal((await revokedAttempt).status,403,"transaction-local auth observes serialized revocation");
  assert.equal((await call(endpoint,"POST",small,operator.cookie)).status,403,"exact replay reauthorizes current role");
  const page=await fetch(origin+"/inventory/transfers",{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.match(await page.text(),/already transferred/i);
  assert.equal((await fetch(origin+`/inventory/transfers/${input.requestId}`,{headers:{Cookie:cookie}})).status,200);assert.equal((await fetch(origin+`/inventory/transfers/${input.requestId}`,{headers:{Cookie:viewer.cookie}})).status,404);
  for(const name of ["StockTransfer","StockTransferCancellation"]){const rows=await db.$queryRawUnsafe(`SELECT relrowsecurity FROM pg_class WHERE oid='"${name}"'::regclass`);assert.equal(rows[0].relrowsecurity,true);}
 }finally{server.kill("SIGTERM");await db.$disconnect();await delay(300);}
});
