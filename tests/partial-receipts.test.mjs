import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {PrismaClient} from "@prisma/client";
const origin="http://127.0.0.1:3219";
async function call(path,method="GET",body,cookie){
 const r=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
}
test("partial receipts are bounded, atomic, scoped and replay-safe",{timeout:90000},async()=>{
 // Isolated CI PostgreSQL only. Never insert these fixtures in the live ERP.
 const db=new PrismaClient();
 const server=spawn("./node_modules/.bin/next",["start","-p","3219"],{env:{...process.env,ALLOW_REGISTRATION:"true"},stdio:["ignore","ignore","inherit"]});
 try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  async function owner(){const suffix=randomUUID().slice(0,8);const r=await call("/api/auth/register","POST",{name:"Receipt QA",email:`partial-${suffix}@example.invalid`,password:"Partial-test-password-2026",organization:"Partial QA",slug:`partial-${suffix}`});assert.equal(r.status,201);return r;}
  const actor=await owner(),outsider=await owner(),tenantId=actor.data.tenantId,cookie=actor.cookie;
  const create=async(path,body)=>{const r=await call(path,"POST",{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const {company}=await create("/api/companies",{name:"Partial company",code:"PART",baseCurrency:"OMR"}),companyId=company.id;
  const {branch}=await create("/api/branches",{companyId,name:"Main",code:"MAIN"});
  const {branch:sibling}=await create("/api/branches",{companyId,name:"Sibling",code:"SIB"});
  const {supplier}=await create("/api/suppliers",{companyId,branchId:branch.id,code:"PART-SUP",displayName:"Delivery supplier"});
  const {item:itemA}=await create("/api/inventory/items",{companyId,branchId:branch.id,sku:"PART-A",name:"First item",unit:"unit"});
  const {item:itemB}=await create("/api/inventory/items",{companyId,branchId:branch.id,sku:"PART-B",name:"Second item",unit:"unit"});
  async function purchase(number,quantities=[5,4]){const {order}=await create("/api/purchase-orders",{companyId,branchId:branch.id,supplierId:supplier.id,number,lines:quantities.map((quantity,i)=>({description:`Delivery line ${i}`,quantity,unitPrice:"1.125"}))});assert.equal((await call(`/api/purchase-orders/${order.id}/status`,"PATCH",{tenantId,action:"issue"},cookie)).status,200);return order;}
  const order=await purchase("PO-PART"),path=`/api/purchase-orders/${order.id}/receive`;
  const lineA=order.lines[0],lineB=order.lines[1];
  const body={tenantId,branchId:branch.id,requestId:randomUUID(),lines:[{orderLineId:lineA.id,itemId:itemA.id,quantity:2}]};
  assert.equal((await call(path,"POST",body)).status,401);
  assert.equal((await call(path,"POST",body,outsider.cookie)).status,403);
  const invitation=await create("/api/invitations",{email:`part-view-${randomUUID().slice(0,8)}@example.invalid`,role:"Viewer",scope:{type:"BRANCH",companyId,branchId:branch.id}});
  const viewer=await call("/api/invitations/accept","POST",{token:invitation.path.split("/").at(-1),name:"Partial viewer",password:"Partial-viewer-password-2026"});assert.equal(viewer.status,200);
  assert.equal((await call(path,"POST",body,viewer.cookie)).status,403);
  for(const bad of [
   {...body,requestId:undefined},
   {...body,lines:[{...body.lines[0],quantity:0}]},
   {...body,lines:[{...body.lines[0],quantity:1.5}]},
   {...body,lines:[body.lines[0],body.lines[0]]},
   {...body,lines:[body.lines[0],{orderLineId:lineB.id,itemId:itemB.id}]},
   {...body,lines:[{...body.lines[0],orderLineId:randomUUID()}]}
  ])assert.equal((await call(path,"POST",bad,cookie)).status,400);
  assert.equal((await call(path,"POST",{...body,branchId:sibling.id},cookie)).status,409);
  assert.equal((await call(path,"POST",{...body,lines:[{...body.lines[0],quantity:6}]},cookie)).status,409);
  const {company:other}=await create("/api/companies",{name:"Foreign",code:"FOREIGN"});
  const {item:foreignItem}=await create("/api/inventory/items",{companyId:other.id,sku:"FOREIGN",name:"Foreign item",unit:"unit"});
  assert.equal((await call(path,"POST",{...body,lines:[{...body.lines[0],itemId:foreignItem.id}]},cookie)).status,409);
  const first=await Promise.all([call(path,"POST",body,cookie),call(path,"POST",body,cookie)]);
  assert.deepEqual(first.map(r=>r.status),[201,201]);
  assert.deepEqual(first.map(r=>r.data.replayed).sort(),[false,true]);
  assert.ok(first.every(r=>r.data.receipt.id===body.requestId&&r.data.orderStatus==="ISSUED"));
  assert.equal(await db.goodsReceipt.count({where:{orderId:order.id}}),1);
  assert.equal(await db.auditLog.count({where:{tenantId,entityId:order.id,action:"purchase-order.partially_received"}}),1);
  assert.equal((await db.purchaseOrderLine.findUnique({where:{id:lineA.id}})).receivedQuantity,2);
  assert.equal((await db.purchaseOrderLine.findUnique({where:{id:lineB.id}})).receivedQuantity,0);
  assert.equal((await call(path,"POST",{...body,lines:[{...body.lines[0],quantity:1}]},cookie)).status,409);
  const query=new URLSearchParams({tenantId,companyId});
  const visible=await call(`/api/purchase-orders?${query}`,"GET",undefined,viewer.cookie);
  assert.equal(visible.status,200);assert.equal(visible.data.orders[0].receipts.length,1);
  assert.equal(visible.data.orders[0].lines[0].receivedQuantity,2);
  const print=await fetch(`${origin}/purchasing/orders/${order.id}`,{headers:{Cookie:cookie}});assert.equal(print.status,200);assert.match(await print.text(),/مستلم جزئيًا|Partially received/);
  // Direct database changes cannot over-fulfil or rewrite saved lines.
  const original=await db.goodsReceiptLine.findFirst({where:{receiptId:body.requestId}});
  await assert.rejects(db.goodsReceiptLine.update({where:{id:original.id},data:{quantity:1}}));
  await assert.rejects(db.goodsReceiptLine.delete({where:{id:original.id}}));
  const creator=(await db.purchaseOrder.findUnique({where:{id:order.id}})).createdBy;
  await assert.rejects(db.$transaction(async tx=>{
   const invalid=await tx.goodsReceipt.create({data:{tenantId,companyId,branchId:branch.id,orderId:order.id,createdBy:creator}});
   await tx.goodsReceiptLine.create({data:{tenantId,companyId,orderId:order.id,receiptId:invalid.id,orderLineId:lineA.id,itemId:itemA.id,quantity:4}});
  }));
  assert.equal(await db.goodsReceipt.count({where:{orderId:order.id}}),1);
  const movement=await db.stockMovement.findUnique({where:{receiptLineId:original.id}});
  assert.equal((await call(`/api/inventory/movements/${movement.id}/reverse`,"POST",{tenantId,reason:"Correct delivery stock"},cookie)).status,201);
  assert.equal((await db.purchaseOrderLine.findUnique({where:{id:lineA.id}})).receivedQuantity,2,"stock correction must not reopen fulfilment");
  const replay=await call(path,"POST",body,cookie);assert.equal(replay.status,201);assert.equal(replay.data.replayed,true);
  assert.equal((await db.stockBalance.findUnique({where:{tenantId_companyId_branchId_itemId:{tenantId,companyId,branchId:branch.id,itemId:itemA.id}}})).quantity.toString(),"0");
  const finalBody={tenantId,branchId:branch.id,requestId:randomUUID(),lines:[{orderLineId:lineA.id,itemId:itemA.id,quantity:3},{orderLineId:lineB.id,itemId:itemB.id,quantity:4}]};
  const finalResults=await Promise.all([call(path,"POST",finalBody,cookie),call(path,"POST",{...finalBody,requestId:randomUUID()},cookie)]);
  assert.deepEqual(finalResults.map(r=>r.status).sort(),[201,409]);
  const final=finalResults.find(r=>r.status===201);assert.equal(final.data.orderStatus,"RECEIVED");
  assert.equal(await db.goodsReceipt.count({where:{orderId:order.id}}),2);
  const savedOrder=await db.purchaseOrder.findUnique({where:{id:order.id},include:{lines:true}});
  assert.ok(savedOrder.receivedAt);assert.equal(savedOrder.status,"RECEIVED");assert.ok(savedOrder.lines.every(l=>l.quantity===l.receivedQuantity));
  const balances=await db.stockBalance.findMany({where:{tenantId,companyId,branchId:branch.id}});
  assert.equal(balances.find(b=>b.itemId===itemA.id).quantity.toString(),"3");assert.equal(balances.find(b=>b.itemId===itemB.id).quantity.toString(),"4");
  assert.equal((await call(path,"POST",{...finalBody,requestId:final.data.receipt.id},cookie)).data.replayed,true);
  assert.equal((await call(path,"POST",{...body,requestId:randomUUID()},cookie)).status,409);
  const finalVisible=(await call(`/api/purchase-orders?${query}`,"GET",undefined,cookie)).data.orders[0];
  assert.equal(finalVisible.receipts.length,2);assert.equal(finalVisible._count.receipts,2);
  // A rejected stock increment rolls back the header, counters and all earlier movements.
  const rollbackOrder=await purchase("PO-ROLLBACK",[1,1]);
  const [low,high]=[itemA,itemB].sort((a,b)=>a.id.localeCompare(b.id));
  const lowBefore=await db.stockBalance.findUnique({where:{tenantId_companyId_branchId_itemId:{tenantId,companyId,branchId:branch.id,itemId:low.id}}});
  const movementsBefore=await db.stockMovement.count({where:{tenantId}});
  await db.stockBalance.update({where:{tenantId_companyId_branchId_itemId:{tenantId,companyId,branchId:branch.id,itemId:high.id}},data:{quantity:"999999999999999.999"}});
  const rollbackBody={tenantId,branchId:branch.id,requestId:randomUUID(),lines:rollbackOrder.lines.map((l,i)=>({orderLineId:l.id,itemId:i?high.id:low.id,quantity:1}))};
  const rollbackPath=`/api/purchase-orders/${rollbackOrder.id}/receive`;
  assert.equal((await call(rollbackPath,"POST",{...rollbackBody,requestId:body.requestId},cookie)).status,409,"request IDs cannot move to another order");
  assert.equal((await call(rollbackPath,"POST",rollbackBody,cookie)).status,409);
  assert.equal(await db.goodsReceipt.count({where:{orderId:rollbackOrder.id}}),0);
  assert.ok((await db.purchaseOrderLine.findMany({where:{orderId:rollbackOrder.id}})).every(l=>l.receivedQuantity===0));
  assert.equal(await db.stockMovement.count({where:{tenantId}}),movementsBefore);
  assert.equal((await db.stockBalance.findUnique({where:{id:lowBefore.id}})).quantity.toString(),lowBefore.quantity.toString());
  const viewerRole=await db.role.findUnique({where:{tenantId_name:{tenantId,name:"Viewer"}}});
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:viewerRole.id,permissionKey:"inventory-stock:read"}}});
  const purchaseOnly=await call(`/api/purchase-orders?${query}`,"GET",undefined,viewer.cookie);
  assert.equal(purchaseOnly.status,200);assert.ok(purchaseOnly.data.orders.every(o=>o.receipts.length===0&&o._count.receipts===0),"receipt references require receiving-stock read permission");
  assert.equal((await call(`/api/purchase-orders/receipts/${body.requestId}`,"GET",undefined,viewer.cookie)).status,404);
 }finally{server.kill("SIGTERM");await db.$disconnect();}
});
