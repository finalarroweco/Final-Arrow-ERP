import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {PrismaClient} from "@prisma/client";
const origin="http://127.0.0.1:3221";
async function call(path,method="GET",body,cookie){
 const r=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
}
test("stock returns preserve sources, enforce scope and quantities, serialize reversals, and roll back atomically",{timeout:90000},async()=>{
 const db=new PrismaClient();
 const server=spawn("./node_modules/.bin/next",["start","-p","3221"],{env:{...process.env,ALLOW_REGISTRATION:"true"},stdio:["ignore","ignore","inherit"]});
 try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  async function owner(){const s=randomUUID().slice(0,8),r=await call("/api/auth/register","POST",{name:"Returns QA",email:`return-${s}@example.invalid`,password:"Return-test-password-2026",organization:"Return QA",slug:`return-${s}`});assert.equal(r.status,201);return r;}
  const actor=await owner(),outsider=await owner(),tenantId=actor.data.tenantId,cookie=actor.cookie;
  const create=async(path,body)=>{const r=await call(path,"POST",{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const {company}=await create("/api/companies",{name:"Return company",code:"RET",baseCurrency:"OMR"}),companyId=company.id;
  const {branch}=await create("/api/branches",{companyId,name:"Main",code:"MAIN"});
  const {branch:sibling}=await create("/api/branches",{companyId,name:"Other branch",code:"OTHER"});
  const {supplier}=await create("/api/suppliers",{companyId,branchId:branch.id,code:"RET-SUP",displayName:"Return supplier"});
  const {item:a}=await create("/api/inventory/items",{companyId,branchId:branch.id,sku:"RET-A",name:"First item",unit:"unit"});
  const {item:b}=await create("/api/inventory/items",{companyId,branchId:branch.id,sku:"RET-B",name:"Second item",unit:"unit"});
  async function receive(number,quantities=[10]){
   const {order}=await create("/api/purchase-orders",{companyId,branchId:branch.id,supplierId:supplier.id,number,lines:quantities.map((quantity,i)=>({description:`Return line ${i}`,quantity,unitPrice:"1.125"}))});
   assert.equal((await call(`/api/purchase-orders/${order.id}/status`,"PATCH",{tenantId,action:"issue"},cookie)).status,200);
   const r=await call(`/api/purchase-orders/${order.id}/receive`,"POST",{tenantId,branchId:branch.id,requestId:randomUUID(),lines:order.lines.map(l=>({orderLineId:l.id,itemId:l.position?b.id:a.id,quantity:l.quantity}))},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return {...r.data.receipt,order};
  }
  async function viewer(branchId){const invitation=await create("/api/invitations",{email:`return-view-${randomUUID().slice(0,8)}@example.invalid`,role:"Viewer",scope:{type:"BRANCH",companyId,branchId}});const r=await call("/api/invitations/accept","POST",{token:invitation.path.split("/").at(-1),name:"Return viewer",password:"Return-viewer-password-2026"});assert.equal(r.status,200);return r.cookie;}
  const viewerCookie=await viewer(branch.id),siblingCookie=await viewer(sibling.id);
  const receipt=await receive("PO-RETURN"),source=receipt.lines[0],path=`/api/purchase-orders/receipts/${receipt.id}/returns`;
  const body={tenantId,requestId:randomUUID(),reason:"Damaged delivery",lines:[{receiptLineId:source.id,quantity:3}]};
  assert.equal((await call(path,"POST",body)).status,401);
  assert.equal((await call(path,"POST",body,outsider.cookie)).status,403);
  assert.equal((await call(path,"POST",body,viewerCookie)).status,403);
  assert.equal((await call(path,"POST",body,siblingCookie)).status,403);
  for(const invalid of [{...body,requestId:undefined},{...body,reason:"x"},{...body,lines:[{...body.lines[0],quantity:0}]},{...body,lines:[{...body.lines[0],quantity:-1}]},{...body,lines:[{...body.lines[0],quantity:1.5}]},{...body,lines:[body.lines[0],body.lines[0]]},{...body,lines:[{...body.lines[0],receiptLineId:randomUUID()}]}])assert.equal((await call(path,"POST",invalid,cookie)).status,400);
  assert.equal((await call(path,"POST",{...body,lines:[{...body.lines[0],quantity:11}]},cookie)).status,409);
  const first=await Promise.all([call(path,"POST",body,cookie),call(path,"POST",body,cookie)]);
  assert.deepEqual(first.map(r=>r.status),[201,201],JSON.stringify(first));assert.deepEqual(first.map(r=>r.data.replayed).sort(),[false,true]);
  assert.equal(await db.goodsReturn.count({where:{receiptId:receipt.id}}),1);
  assert.equal(await db.auditLog.count({where:{tenantId,entityId:body.requestId,action:"purchase-order.stock_returned"}}),1);
  const balance=()=>db.stockBalance.findUnique({where:{tenantId_companyId_branchId_itemId:{tenantId,companyId,branchId:branch.id,itemId:a.id}}});
  assert.equal((await balance()).quantity.toString(),"7");assert.equal((await db.goodsReceiptLine.findUnique({where:{id:source.id}})).returnedQuantity,3);
  assert.equal((await db.purchaseOrderLine.findUnique({where:{id:source.orderLineId}})).receivedQuantity,10);
  assert.equal((await db.purchaseOrder.findUnique({where:{id:receipt.orderId}})).status,"RECEIVED");
  assert.equal((await call(path,"POST",{...body,reason:"Different reason"},cookie)).status,409);
  assert.equal((await call(path,"POST",{...body,lines:[{...body.lines[0],quantity:2}]},cookie)).status,409);
  const movement=await db.stockMovement.findUnique({where:{receiptLineId:source.id}}),returned=await db.goodsReturnLine.findFirst({where:{returnId:body.requestId}}),returnMovement=await db.stockMovement.findUnique({where:{returnLineId:returned.id}});
  assert.equal(returnMovement.type,"PURCHASE_RETURN");assert.equal(returnMovement.delta.toString(),"-3");
  const reverse=(id)=>call(`/api/inventory/movements/${id}/reverse`,"POST",{tenantId,reason:"Correct source stock"},cookie);
  assert.equal((await reverse(movement.id)).status,409);assert.equal((await reverse(returnMovement.id)).status,409);
  await assert.rejects(db.goodsReturn.update({where:{id:body.requestId},data:{reason:"Rewrite saved reason"}}));
  await assert.rejects(db.goodsReturnLine.update({where:{id:returned.id},data:{quantity:1}}));
  await assert.rejects(db.goodsReturnLine.delete({where:{id:returned.id}}));
  await assert.rejects(db.goodsReceiptLine.update({where:{id:source.id},data:{returnedQuantity:4}}));
  await assert.rejects(db.$transaction(async tx=>{const h=await tx.goodsReturn.create({data:{tenantId,receiptId:receipt.id,reason:"Excess source units",createdBy:receipt.createdBy}});await tx.goodsReturnLine.create({data:{tenantId,receiptId:receipt.id,returnId:h.id,receiptLineId:source.id,quantity:8}});}));
  const doc=await call(`/api/purchase-orders/returns/${body.requestId}`,"GET",undefined,viewerCookie);assert.equal(doc.status,200);assert.equal(doc.data.goodsReturn.lines[0].quantity,3);
  assert.equal((await call(`/api/purchase-orders/returns/${body.requestId}`,"GET",undefined,siblingCookie)).status,404);
  const print=await fetch(`${origin}/purchasing/returns/${body.requestId}`,{headers:{Cookie:cookie}});assert.equal(print.status,200);assert.match(await print.text(),/Damaged delivery/);
  const receiptPrint=await fetch(`${origin}/purchasing/receipts/${receipt.id}`,{headers:{Cookie:cookie}});assert.equal(receiptPrint.status,200);assert.match(await receiptPrint.text(),new RegExp(body.requestId));
  const query=new URLSearchParams({tenantId,companyId}),register=`/api/purchase-orders/returns?${query}`;
  assert.equal((await call(register,"GET",undefined,viewerCookie)).data.returns.length,1);
  assert.equal((await call(register,"GET",undefined,siblingCookie)).data.returns.length,0);
  assert.equal((await call(`${register}&page=-1`,"GET",undefined,cookie)).status,400);
  assert.equal((await call(`${register}&q=Damaged&q=other`,"GET",undefined,cookie)).status,400);
  assert.equal((await call(`${register}&q=${body.requestId}`,"GET",undefined,cookie)).data.returns[0].id,body.requestId);
  const stock=await call(`/api/inventory/stock?${query}&branchId=${branch.id}`,"GET",undefined,cookie);
  assert.equal(stock.data.movements.find(m=>m.id===returnMovement.id).returnId,body.requestId);assert.equal(stock.data.movements.find(m=>m.id===movement.id).hasReturns,true);
  await db.inventoryItem.update({where:{id:a.id},data:{archivedAt:new Date()}});
  const finalBody={...body,requestId:randomUUID(),lines:[{receiptLineId:source.id,quantity:7}]};
  const finish=await Promise.all([call(path,"POST",finalBody,cookie),call(path,"POST",{...finalBody,requestId:randomUUID()},cookie)]);assert.deepEqual(finish.map(r=>r.status).sort(),[201,409],JSON.stringify(finish));
  assert.equal((await balance()).quantity.toString(),"0");assert.equal((await call(path,"POST",body,cookie)).data.replayed,true);
  assert.equal((await db.goodsReceiptLine.findUnique({where:{id:source.id}})).quantity.toString(),"10");
  await db.inventoryItem.update({where:{id:a.id},data:{archivedAt:null}});
  // A stock shortage in the second line rolls back earlier deductions and counters.
  const rollback=await receive("PO-RETURN-ROLLBACK",[2,2]),ordered=[...rollback.lines].sort((x,y)=>x.id.localeCompare(y.id));
  const before=await db.stockBalance.findUnique({where:{tenantId_companyId_branchId_itemId:{tenantId,companyId,branchId:branch.id,itemId:ordered[0].itemId}}});
  await db.stockBalance.update({where:{tenantId_companyId_branchId_itemId:{tenantId,companyId,branchId:branch.id,itemId:ordered[1].itemId}},data:{quantity:0}});
  const movementCount=await db.stockMovement.count({where:{tenantId}}),returnCount=await db.goodsReturn.count({where:{tenantId}});
  const rejected=await call(`/api/purchase-orders/receipts/${rollback.id}/returns`,"POST",{tenantId,requestId:randomUUID(),reason:"Return both items",lines:ordered.map(l=>({receiptLineId:l.id,quantity:1}))},cookie);assert.equal(rejected.status,409);
  assert.equal(await db.stockMovement.count({where:{tenantId}}),movementCount);assert.equal(await db.goodsReturn.count({where:{tenantId}}),returnCount);
  assert.ok((await db.goodsReceiptLine.findMany({where:{receiptId:rollback.id}})).every(l=>l.returnedQuantity===0));assert.equal((await db.stockBalance.findUnique({where:{id:before.id}})).quantity.toString(),before.quantity.toString());
  // Reversal and return share the same source lock: exactly one may commit.
  const raceReceipt=await receive("PO-RETURN-RACE",[3]),raceSource=raceReceipt.lines[0],raceMovement=await db.stockMovement.findUnique({where:{receiptLineId:raceSource.id}});
  const race=await Promise.all([reverse(raceMovement.id),call(`/api/purchase-orders/receipts/${raceReceipt.id}/returns`,"POST",{tenantId,requestId:randomUUID(),reason:"Race return request",lines:[{receiptLineId:raceSource.id,quantity:1}]},cookie)]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409],JSON.stringify(race));
  const reversedReceipt=await receive("PO-REVERSED",[3]),reversedMovement=await db.stockMovement.findUnique({where:{receiptLineId:reversedReceipt.lines[0].id}});assert.equal((await reverse(reversedMovement.id)).status,201);
  assert.equal((await call(`/api/purchase-orders/receipts/${reversedReceipt.id}/returns`,"POST",{tenantId,requestId:randomUUID(),reason:"Already reversed stock",lines:[{receiptLineId:reversedReceipt.lines[0].id,quantity:1}]},cookie)).status,409);
  const viewerRole=await db.role.findUnique({where:{tenantId_name:{tenantId,name:"Viewer"}}});await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:viewerRole.id,permissionKey:"purchase-order:read"}}});
  assert.equal((await call(`/api/purchase-orders/returns/${body.requestId}`,"GET",undefined,viewerCookie)).status,404);assert.equal((await call(register,"GET",undefined,viewerCookie)).status,403);
  const stockOnly=await call(`/api/inventory/stock?${query}&branchId=${branch.id}`,"GET",undefined,viewerCookie);assert.equal(stockOnly.status,200);assert.ok(stockOnly.data.movements.every(m=>m.returnId===null&&m.receiptId===null));
 }finally{server.kill("SIGTERM");await db.$disconnect();}
});
