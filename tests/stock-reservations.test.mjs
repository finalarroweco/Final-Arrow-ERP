import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {PrismaClient} from "@prisma/client";
const origin="http://127.0.0.1:3241";
async function call(path,method="GET",body,cookie){const r=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};}
test("manual stock reservations protect physical stock, audit history, source scopes and exact retries",{timeout:90000},async()=>{
 // Disposable CI database only. Never insert production QA stock or reservations.
 const db=new PrismaClient(),server=spawn("./node_modules/.bin/next",["start","-p","3241"],{env:{...process.env,ALLOW_REGISTRATION:"true"},stdio:["ignore","ignore","inherit"]});
 try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  async function owner(){const s=randomUUID().slice(0,8),r=await call("/api/auth/register","POST",{name:"Reservation QA",email:`reserve-${s}@example.invalid`,password:"Reservation-password-2026",organization:"Reservation QA",slug:`reserve-${s}`});assert.equal(r.status,201);return r;}
  const actor=await owner(),outsider=await owner(),tenantId=actor.data.tenantId,cookie=actor.cookie;
  const create=async(path,body)=>{const r=await call(path,"POST",{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const {company}=await create("/api/companies",{name:"Reservation company",code:"RES",baseCurrency:"OMR"}),companyId=company.id;
  const {branch}=await create("/api/branches",{companyId,name:"Main",code:"MAIN"}),{branch:sibling}=await create("/api/branches",{companyId,name:"Sibling",code:"SIB"});
  const {item}=await create("/api/inventory/items",{companyId,sku:"RES-ITEM",name:"Reserved item",unit:"unit"});
  const scope={tenantId,companyId,branchId:branch.id},endpoint="/api/inventory/reservations",stockQuery=new URLSearchParams(scope),list=(extra={})=>endpoint+"?"+new URLSearchParams({...scope,...extra});
  const adjustment={...scope,itemId:item.id,action:"in",quantity:"10.125",reason:"Initial physical stock"};await create("/api/inventory/stock",adjustment);
  const balance=await db.stockBalance.findFirstOrThrow({where:{...scope,itemId:item.id}}),userId=(await db.membership.findFirstOrThrow({where:{tenantId}})).userId;
  const reserve={...scope,action:"reserve",requestId:randomUUID(),itemId:item.id,quantity:"6.125",reference:"Customer manual hold"};
  async function member(branchId,role="Viewer"){const invitation=await create("/api/invitations",{email:`reserve-view-${randomUUID().slice(0,8)}@example.invalid`,role,scope:{type:"BRANCH",companyId,branchId}});const r=await call("/api/invitations/accept","POST",{token:invitation.path.split("/").at(-1),name:"Reservation operator",password:"Reservation-viewer-2026"});assert.equal(r.status,200);return r;}
  const viewer=await member(branch.id),siblingViewer=await member(sibling.id),manager=await member(branch.id,"Manager");
  assert.equal((await call(endpoint,"POST",reserve)).status,401);assert.equal((await call(endpoint,"POST",reserve,outsider.cookie)).status,403);assert.equal((await call(endpoint,"POST",reserve,viewer.cookie)).status,403);assert.equal((await call(endpoint,"POST",{...reserve,branchId:sibling.id},manager.cookie)).status,403);
  assert.equal((await call(list())).status,401);assert.equal((await call(list(),"GET",undefined,outsider.cookie)).status,403);assert.equal((await call(list(),"GET",undefined,siblingViewer.cookie)).status,403);assert.equal((await call(list()+"&state=ACTIVE&state=ALL","GET",undefined,cookie)).status,400);
  for(const changed of [{quantity:"0"},{quantity:"1.0001"},{quantity:"1e2"},{quantity:"-1"},{reference:"x"},{extra:true}])assert.equal((await call(endpoint,"POST",{...reserve,...changed},cookie)).status,400);
  await assert.rejects(db.stockReservation.create({data:{id:randomUUID(),tenantId,balanceId:balance.id,quantity:"1",reference:"Missing audit",createdBy:userId}}));
  assert.equal((await db.stockBalance.findUniqueOrThrow({where:{id:balance.id}})).reservedQuantity.toFixed(3),"0.000");
  const exact=await Promise.all([call(endpoint,"POST",reserve,cookie),call(endpoint,"POST",reserve,cookie)]);assert.ok(exact.every(r=>r.status===201),JSON.stringify(exact));assert.equal(exact[0].data.reservation.id,exact[1].data.reservation.id);
  for(const changed of [{quantity:"5"},{reference:"Different reference"}])assert.equal((await call(endpoint,"POST",{...reserve,...changed},cookie)).status,409);
  const readStock=()=>call("/api/inventory/stock?"+stockQuery,"GET",undefined,cookie);
  let stock=(await readStock()).data.balances[0];assert.equal(stock.quantity,"10.125");assert.equal(stock.reservedQuantity,"6.125");assert.equal(stock.availableQuantity,"4.000");
  const competition=await Promise.all([1,2].map(i=>call(endpoint,"POST",{...reserve,requestId:randomUUID(),quantity:"4",reference:`Last available ${i}`},cookie)));assert.deepEqual(competition.map(r=>r.status).sort(),[201,409]);const last=competition.find(r=>r.status===201).data.reservation;
  assert.equal((await call("/api/inventory/stock","POST",{...adjustment,action:"out",quantity:"0.001"},cookie)).status,409);
  const firstMovement=await db.stockMovement.findFirstOrThrow({where:{balanceId:balance.id},orderBy:{createdAt:"asc"}});assert.equal((await call(`/api/inventory/movements/${firstMovement.id}/reverse`,"POST",{tenantId,reason:"Reserved source reversal"},cookie)).status,409);
  await assert.rejects(db.stockBalance.update({where:{id:balance.id},data:{quantity:"0"}}));await assert.rejects(db.stockBalance.update({where:{id:balance.id},data:{reservedQuantity:"0"}}));await assert.rejects(db.stockBalance.update({where:{id:balance.id},data:{branchId:sibling.id}}));
  await assert.rejects(db.stockReservation.delete({where:{id:reserve.requestId}}));await assert.rejects(db.stockReservation.update({where:{id:reserve.requestId},data:{reference:"Altered immutable reference"}}));
  const release={...scope,action:"release",requestId:randomUUID(),reservationId:reserve.requestId,reason:"Customer cancelled hold"};
  await assert.rejects(db.stockReservation.update({where:{id:reserve.requestId},data:{releaseRequestId:randomUUID(),releasedBy:userId,releaseReason:"Missing release audit"}}));assert.equal((await db.stockBalance.findUniqueOrThrow({where:{id:balance.id}})).reservedQuantity.toFixed(3),"10.125");
  const released=await Promise.all([call(endpoint,"POST",release,manager.cookie),call(endpoint,"POST",release,manager.cookie)]);assert.ok(released.every(r=>r.status===201),JSON.stringify(released));assert.ok(released[0].data.reservation.releasedAt);
  assert.equal((await call(endpoint,"POST",{...release,requestId:randomUUID()},manager.cookie)).status,409);assert.equal((await call(endpoint,"POST",release,cookie)).status,409,"different actor cannot replay release receipt");assert.equal((await call(endpoint,"POST",reserve,cookie)).status,201,"original reserve receipt replays after release");
  await assert.rejects(db.stockReservation.update({where:{id:reserve.requestId},data:{releasedAt:null,releaseRequestId:null,releasedBy:null,releaseReason:null,releaseTransaction:null}}));
  stock=(await readStock()).data.balances[0];assert.equal(stock.reservedQuantity,"4.000");assert.equal(stock.availableQuantity,"6.125");
  await create("/api/inventory/stock",{...adjustment,action:"out",quantity:"6.125"});assert.equal((await call(endpoint,"POST",{...reserve,requestId:randomUUID()},cookie)).status,409);
  assert.equal((await call(list(),"GET",undefined,viewer.cookie)).data.reservations.length,1);assert.equal((await call(list({state:"RELEASED"}),"GET",undefined,viewer.cookie)).data.reservations.length,1);assert.equal((await call(list({itemId:randomUUID()}),"GET",undefined,cookie)).data.reservations.length,0);
  assert.equal((await call(endpoint,"POST",{...release,reservationId:last.id,requestId:randomUUID()},cookie)).status,201);assert.equal((await readStock()).data.balances[0].availableQuantity,"4.000");
  const branchReservation={...reserve,requestId:randomUUID(),quantity:"1"};const races=await Promise.all([call(endpoint,"POST",{...branchReservation,quantity:"4"},cookie),call("/api/inventory/stock","POST",{...adjustment,action:"out",quantity:"4"},cookie)]);assert.deepEqual(races.map(r=>r.status).sort(),[201,409]);
  const after=(await readStock()).data.balances[0];assert.ok(Number(after.quantity)>=Number(after.reservedQuantity));
  // Exercise paged immutable history without live business data.
  await create("/api/inventory/stock",{...adjustment,action:"in",quantity:"1"});
  await db.$transaction(async tx=>{for(let i=0;i<52;i++){const row=await tx.stockReservation.create({data:{id:randomUUID(),tenantId,balanceId:balance.id,quantity:"0.001",reference:`History ${i}`,createdBy:userId}});await tx.auditLog.create({data:{tenantId,actorId:userId,action:"inventory-stock.reserved",entity:"StockReservation",entityId:row.id,metadata:{balanceId:balance.id,transactionId:row.creationTransaction}}});}},{timeout:15000});
  const history=await call(list({state:"ALL"}),"GET",undefined,cookie);assert.equal(history.data.reservations.length,50);assert.equal(history.data.nextPage,1);assert.ok((await call(list({state:"ALL",page:"1"}),"GET",undefined,cookie)).data.reservations.length>0);
  const {supplier}=await create("/api/suppliers",{companyId,branchId:branch.id,code:"RES-SUP",displayName:"Reservation supplier"});
  const {order}=await create("/api/purchase-orders",{companyId,branchId:branch.id,supplierId:supplier.id,number:"RES-PO",lines:[{description:"Return protected stock",quantity:1,unitPrice:"1.000"}]});assert.equal((await call(`/api/purchase-orders/${order.id}/status`,"PATCH",{tenantId,action:"issue"},cookie)).status,200);
  const {receipt}=await create(`/api/purchase-orders/${order.id}/receive`,{branchId:branch.id,requestId:randomUUID(),lines:[{orderLineId:order.lines[0].id,itemId:item.id,quantity:1}]});
  const allAvailable=(await readStock()).data.balances[0].availableQuantity,returnHold={...reserve,requestId:randomUUID(),quantity:allAvailable};assert.equal((await call(endpoint,"POST",returnHold,cookie)).status,201);
  const returnBody={tenantId,requestId:randomUUID(),reason:"Real source return in isolated QA",lines:[{receiptLineId:receipt.lines[0].id,quantity:1}]},returnPath=`/api/purchase-orders/receipts/${receipt.id}/returns`;
  assert.equal((await call(returnPath,"POST",returnBody,cookie)).status,409,"supplier return cannot consume held goods");assert.equal((await call(endpoint,"POST",{...release,requestId:randomUUID(),reservationId:returnHold.requestId},cookie)).status,201);assert.equal((await call(returnPath,"POST",returnBody,cookie)).status,201);
  const newId=randomUUID();await db.inventoryItem.update({where:{id:item.id},data:{archivedAt:new Date()}});assert.equal((await call(endpoint,"POST",{...reserve,requestId:newId,quantity:"0.001"},cookie)).status,409);assert.equal((await call(endpoint,"POST",reserve,cookie)).status,201);
  const remaining=await db.stockReservation.findFirstOrThrow({where:{balanceId:balance.id,releasedAt:null}});assert.equal((await call(endpoint,"POST",{...release,requestId:randomUUID(),reservationId:remaining.id},cookie)).status,201,"archived item holds can be released");
  const managerRole=await db.role.findUniqueOrThrow({where:{tenantId_name:{tenantId,name:"Manager"}}});await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:managerRole.id,permissionKey:"inventory-stock:adjust"}}});assert.equal((await call(endpoint,"POST",release,manager.cookie)).status,403);
  const page=await fetch(origin+"/inventory/stock",{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.match(await page.text(),/Stock reservations/);
  assert.equal((await db.$queryRaw`SELECT relrowsecurity FROM pg_class WHERE oid='"StockReservation"'::regclass`)[0].relrowsecurity,true);
 }finally{server.kill("SIGTERM");await db.$disconnect();}
});
