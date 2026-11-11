import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
test.after(()=>db.$disconnect());
async function fixture(){
 const tenant=await db.tenant.create({data:{name:'Physical sales SQL QA',slug:'sales-sql-'+randomUUID()}}),tenantId=tenant.id;
 const user=await db.user.create({data:{name:'Physical operator',email:randomUUID()+'@example.invalid',passwordHash:'test-only-not-login'}}),createdBy=user.id;
 const member=await db.membership.create({data:{tenantId,userId:createdBy,status:'ACTIVE'}});
 const role=await db.role.create({data:{tenantId,name:'SQL physical operator'}});
 for(const permissionKey of ['order:read','order-delivery:manage','order-reservation:manage','inventory-stock:read','inventory-stock:adjust'])await db.rolePermission.create({data:{tenantId,roleId:role.id,permissionKey}});
 const grant=await db.roleGrant.create({data:{tenantId,membershipId:member.id,roleId:role.id}});await db.accessScope.create({data:{tenantId,grantId:grant.id,type:'TENANT'}});
 const company=await db.company.create({data:{tenantId,name:'Physical SQL',code:'SQL'}}),companyId=company.id;
 const branch=await db.branch.create({data:{tenantId,companyId,name:'Original branch',code:'B'}}),branchId=branch.id;
 const customer=await db.customer.create({data:{tenantId,companyId,code:'C',displayName:'Private customer',createdBy}});
 const quote=await db.quote.create({data:{tenantId,companyId,customerId:customer.id,number:'Q',currency:'OMR',subtotal:'100',createdBy}});
 const order=await db.salesOrder.create({data:{tenantId,companyId,customerId:customer.id,quoteId:quote.id,number:'SO',customerName:'Private customer',currency:'OMR',subtotal:'100',createdBy}}),orderId=order.id;
 const line=await db.salesOrderLine.create({data:{tenantId,orderId,position:1,description:'Commercial descriptive units',quantity:1,unitPrice:'100',amount:'100'}});
 const item=await db.inventoryItem.create({data:{tenantId,companyId,name:'Original physical item',sku:'IT',unit:'kg',createdBy}}),itemId=item.id;
 // Intentional legacy balance with no dated movements: document must retain offset.
 const balance=await db.stockBalance.create({data:{tenantId,companyId,branchId,itemId,quantity:'20.125'}});
 const base={tenantId,companyId,orderId,branchId,itemId,lineId:line.id,quantity:'3.125',unit:'kg',reference:'Physical ref',reason:'Physical movement recorded',physicalConfirmed:true,createdBy};
 const create=(extra={})=>db.salesStockDocument.create({data:{...base,id:randomUUID(),kind:'DELIVERY',...extra}});
 const current=()=>db.stockBalance.findUniqueOrThrow({where:{id:balance.id}});
 return {base,create,current,balance,role,member,grant,line,item};
}
test('SQL independently binds exact movements, projections, return caps, corrections and immutable source identities',async()=>{
 const f=await fixture(),{base,create,current}=f;
 const d=await create({itemName:'FORGED',createdAt:new Date('2000-01-01'),delta:'100'});
 assert.equal(d.itemName,'Original physical item');assert.equal(d.delta.toFixed(3),'-3.125');assert.ok(d.createdAt>new Date('2026-01-01'));assert.equal(d.balanceId,f.balance.id);assert.equal((await current()).quantity.toFixed(3),'17.000');assert.equal((await current()).transferOpeningDelta.toFixed(3),'20.125');
 const ret=await create({kind:'RETURN',deliveryId:d.id,quantity:'1.125',reference:'Usable returned goods'});
 assert.equal((await current()).quantity.toFixed(3),'18.125');
 await assert.rejects(create({kind:'RETURN',deliveryId:d.id,quantity:'2.001'}));
 await assert.rejects(create({kind:'CORRECTION',correctsId:d.id,quantity:d.quantity,reference:d.reference}));
 const rc=await create({kind:'CORRECTION',correctsId:ret.id,quantity:ret.quantity,reference:ret.reference});assert.equal(rc.delta.toFixed(3),'-1.125');
 await assert.rejects(create({kind:'CORRECTION',correctsId:rc.id,quantity:rc.quantity,reference:rc.reference}));
 const race=await Promise.allSettled([create({kind:'RETURN',deliveryId:d.id,quantity:'2.000'}),create({kind:'RETURN',deliveryId:d.id,quantity:'2.000'})]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
 const latest=race.find(x=>x.status==='fulfilled').value;await create({kind:'CORRECTION',correctsId:latest.id,quantity:latest.quantity,reference:latest.reference});
 await create({kind:'CORRECTION',correctsId:d.id,quantity:d.quantity,reference:d.reference});assert.equal((await current()).quantity.toFixed(3),'20.125');
 await assert.rejects(create({kind:'RETURN',deliveryId:d.id,quantity:'0.001'}));await assert.rejects(create({kind:'CORRECTION',correctsId:d.id,quantity:d.quantity,reference:d.reference}));
 const movement=await db.stockMovement.findUniqueOrThrow({where:{salesDocumentId:d.id}}),audit=await db.auditLog.findFirstOrThrow({where:{entity:'SalesStockDocument',entityId:d.id}});
 for(const operation of [()=>db.salesStockDocument.delete({where:{id:d.id}}),()=>db.salesStockDocument.update({where:{id:d.id},data:{reason:'Changed history'}}),()=>db.stockMovement.delete({where:{id:movement.id}}),()=>db.stockMovement.update({where:{id:movement.id},data:{salesDocumentId:null}}),()=>db.auditLog.delete({where:{id:audit.id}}),()=>db.auditLog.update({where:{id:audit.id},data:{entity:'Other'}}),()=>db.stockBalance.update({where:{id:f.balance.id},data:{quantity:'999'}}),()=>db.stockBalance.update({where:{id:f.balance.id},data:{transferOpeningDelta:'0'}}),()=>db.salesOrder.update({where:{id:base.orderId},data:{customerName:'Changed source'}}),()=>db.salesOrderLine.update({where:{id:f.line.id},data:{quantity:2}}),()=>db.inventoryItem.update({where:{id:base.itemId},data:{branchId:base.branchId}})])await assert.rejects(operation());
 await assert.rejects(db.stockMovement.create({data:{tenantId:base.tenantId,balanceId:f.balance.id,type:'SALES_DELIVERY',delta:'-1',reason:'Sales physical stock document',actorId:base.createdBy,salesDocumentId:d.id}}));
 await assert.rejects(db.auditLog.create({data:{tenantId:base.tenantId,actorId:base.createdBy,entity:'StockMovement',entityId:movement.id,action:'inventory-stock.reversed',metadata:{}}}));
 await assert.rejects(create({unit:'box'}));await assert.rejects(create({quantity:'0'}));await assert.rejects(create({quantity:'999999999.999'}));await assert.rejects(create({physicalConfirmed:false}));
 const fresh=await create();await db.inventoryItem.update({where:{id:base.itemId},data:{archivedAt:new Date()}});await assert.rejects(create());await create({kind:'RETURN',deliveryId:fresh.id,quantity:'0.001'});
 await db.inventoryItem.update({where:{id:base.itemId},data:{unit:'box'}});await assert.rejects(create({kind:'RETURN',deliveryId:fresh.id,quantity:'0.001'}));
 await db.inventoryItem.update({where:{id:base.itemId},data:{unit:'kg'}});
 await db.salesOrder.update({where:{id:base.orderId},data:{status:'CANCELLED',cancelledAt:new Date()}});await create({kind:'RETURN',deliveryId:fresh.id,quantity:'0.001'});await assert.rejects(create());
});
async function hold(f,quantity='4.000'){
 const {base,balance}=f,id=randomUUID();
 await db.$transaction(async tx=>{
  const r=await tx.stockReservation.create({data:{id,tenantId:base.tenantId,balanceId:balance.id,quantity,reference:'Order-linked manual hold',createdBy:base.createdBy,sourceKind:'ORDER_MANUAL'}});
  await tx.orderStockReservation.create({data:{reservationId:id,tenantId:base.tenantId,companyId:base.companyId,branchId:base.branchId,balanceId:balance.id,itemId:base.itemId,orderId:base.orderId,lineId:base.lineId,note:'Manual full selected hold',orderNumber:'',customerName:'',itemSku:'',itemName:'',itemUnit:'kg',branchName:''}});
  await tx.auditLog.createMany({data:[{tenantId:base.tenantId,actorId:base.createdBy,entity:'StockReservation',entityId:id,action:'inventory-stock.reserved',metadata:{balanceId:balance.id,transactionId:r.creationTransaction}},{tenantId:base.tenantId,actorId:base.createdBy,entity:'OrderStockReservation',entityId:id,action:'order-stock.reserved',metadata:{orderId:base.orderId,transactionId:r.creationTransaction}}]});
 });return id;
}
test('SQL full selected hold delivery is atomic, unique, correctly audited and does not recreate holds',async()=>{
 const f=await fixture(),h=await hold(f);
 await assert.rejects(f.create({holdId:h,quantity:'3.999'}));assert.equal((await f.current()).reservedQuantity.toFixed(3),'4.000');
 const d=await f.create({holdId:h,quantity:'4.000'});assert.equal(d.releaseRequestId,d.id);assert.equal((await f.current()).reservedQuantity.toFixed(3),'0.000');assert.equal((await f.current()).quantity.toFixed(3),'16.125');
 const r=await db.stockReservation.findUniqueOrThrow({where:{id:h}});assert.equal(r.salesDeliveryId,d.id);assert.equal(r.releaseTransaction,d.transactionId);assert.equal(await db.auditLog.count({where:{entityId:h,action:{in:['inventory-stock.reservation-released','order-stock.released']}}}),2);
 await assert.rejects(f.create({holdId:h,quantity:'4.000'}));
 await f.create({kind:'CORRECTION',correctsId:d.id,quantity:d.quantity,reference:d.reference});assert.equal((await f.current()).reservedQuantity.toFixed(3),'0.000');assert.equal((await f.current()).quantity.toFixed(3),'20.125');
 await assert.rejects(db.stockReservation.update({where:{id:h},data:{salesDeliveryId:null}}));
 const releaseAudit=await db.auditLog.findFirstOrThrow({where:{entityId:h,action:'order-stock.released'}});await assert.rejects(db.auditLog.delete({where:{id:releaseAudit.id}}));
 await assert.rejects(db.stockReservation.create({data:{id:d.id,tenantId:f.base.tenantId,balanceId:f.balance.id,quantity:'1',reference:'Collision hold',createdBy:f.base.createdBy}}));
 const active=await hold(f);await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.base.tenantId,roleId:f.role.id,permissionKey:'order-reservation:manage'}}});await assert.rejects(f.create({holdId:active,quantity:'4.000'}));assert.equal((await f.current()).reservedQuantity.toFixed(3),'4.000');await f.create({quantity:'0.001'});
});
test('SQL save versus cancellation resolves once across actors, actions and reservation UUIDs',async()=>{
 const f=await fixture(),{base}=f,id=randomUUID();
 const request={action:'deliver',tenantId:base.tenantId,companyId:base.companyId,orderId:base.orderId,expectedActorId:base.createdBy,requestId:id,branchId:base.branchId,itemId:base.itemId,lineId:base.lineId,holdId:null,expectedUnit:'kg',quantity:'3.125',reference:base.reference,reason:base.reason,physicalConfirmed:true};
 const cancel=()=>db.salesStockCancellation.create({data:{id,tenantId:base.tenantId,companyId:base.companyId,createdBy:base.createdBy,request}});
 const race=await Promise.allSettled([f.create({id}),cancel()]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(await db.salesStockDocument.count({where:{id}})+await db.salesStockCancellation.count({where:{id}}),1);
 const cancelledId=randomUUID(),c=await db.salesStockCancellation.create({data:{id:cancelledId,tenantId:base.tenantId,companyId:base.companyId,createdBy:base.createdBy,request:{...request,requestId:cancelledId}}});
 await assert.rejects(f.create({id:cancelledId}));await assert.rejects(db.salesStockCancellation.delete({where:{id:c.id}}));await assert.rejects(db.stockReservation.create({data:{id:cancelledId,tenantId:base.tenantId,balanceId:f.balance.id,quantity:'1',reference:'Cancelled ID collision',createdBy:base.createdBy}}));
 await assert.rejects(db.salesStockCancellation.create({data:{id:randomUUID(),tenantId:base.tenantId,companyId:base.companyId,createdBy:base.createdBy,request}}));
 const active=await hold(f);await assert.rejects(f.create({id:active}));
 const noWrite=randomUUID();await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:base.tenantId,roleId:f.role.id,permissionKey:'order-delivery:manage'}}});await assert.rejects(f.create());await assert.rejects(db.salesStockCancellation.create({data:{id:noWrite,tenantId:base.tenantId,companyId:base.companyId,createdBy:base.createdBy,request:{...request,requestId:noWrite}}}));
});
test('SQL requires the company-wide source and actual stock-branch intersection independently',async()=>{
 const f=await fixture(),{base}=f;
 const scope=await db.accessScope.findFirstOrThrow({where:{grantId:f.grant.id}});
 await db.accessScope.update({where:{id:scope.id},data:{type:'BRANCH',companyId:base.companyId,branchId:base.branchId}});
 await assert.rejects(f.create(),'branch order permission cannot authorize company-wide source');
 const role=await db.role.create({data:{tenantId:base.tenantId,name:'Company source only'}});
 for(const permissionKey of ['order:read','order-delivery:manage'])await db.rolePermission.create({data:{tenantId:base.tenantId,roleId:role.id,permissionKey}});
 const grant=await db.roleGrant.create({data:{tenantId:base.tenantId,membershipId:f.member.id,roleId:role.id}});
 await db.accessScope.create({data:{tenantId:base.tenantId,grantId:grant.id,type:'COMPANY',companyId:base.companyId}});
 await f.create();
 await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:base.tenantId,roleId:f.role.id,permissionKey:'inventory-stock:read'}}});await assert.rejects(f.create());
 await db.rolePermission.create({data:{tenantId:base.tenantId,roleId:f.role.id,permissionKey:'inventory-stock:read'}});
 await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:base.tenantId,roleId:role.id,permissionKey:'order:read'}}});await assert.rejects(f.create());
});
test('SQL competing deliveries and return/correction races preserve exact capacity and rollback releases',async()=>{
 const f=await fixture(),h=await hold(f,'4.000');
 const race=await Promise.allSettled([f.create({holdId:h,quantity:'4.000'}),f.create({holdId:h,quantity:'4.000'})]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal((await f.current()).quantity.toFixed(3),'16.125');assert.equal((await f.current()).reservedQuantity.toFixed(3),'0.000');
 const d=race.find(x=>x.status==='fulfilled').value;
 const competing=await Promise.allSettled([f.create({kind:'RETURN',deliveryId:d.id,quantity:'0.001'}),f.create({kind:'CORRECTION',correctsId:d.id,quantity:d.quantity,reference:d.reference})]);assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);
 const h2=await hold(f,'1.000'),id=randomUUID(),before=await f.current();
 // Force a post-insert failure after the hold release and document effects. The whole
 // transaction must roll back, including both release audits and opening projection.
 await assert.rejects(db.$transaction(async tx=>{
  await tx.salesStockDocument.create({data:{...f.base,id,kind:'DELIVERY',holdId:h2,quantity:'1.000'}});
  await tx.$executeRaw`SELECT 1/0`;
 }));
 assert.equal((await f.current()).quantity.toFixed(3),before.quantity.toFixed(3));assert.equal((await f.current()).reservedQuantity.toFixed(3),before.reservedQuantity.toFixed(3));assert.equal((await db.stockReservation.findUniqueOrThrow({where:{id:h2}})).releasedAt,null);assert.equal(await db.salesStockDocument.count({where:{id}}),0);assert.equal(await db.auditLog.count({where:{entityId:h2,action:'order-stock.released'}}),0);
 // A previously committed ordinary release cannot be retroactively attached.
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${f.base.tenantId}::uuid FOR SHARE`;
  const releaseId=randomUUID();await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'stock-reservation-request:'+releaseId},0))`;
  await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE id=${f.balance.id}::uuid FOR UPDATE`;
  const r=await tx.stockReservation.update({where:{id:h2},data:{releaseRequestId:releaseId,releasedBy:f.base.createdBy,releaseReason:'Ordinary explicit release'}});
  await tx.auditLog.createMany({data:[{tenantId:f.base.tenantId,actorId:f.base.createdBy,entity:'StockReservation',entityId:h2,action:'inventory-stock.reservation-released',metadata:{balanceId:f.balance.id,transactionId:r.releaseTransaction,requestId:releaseId}},{tenantId:f.base.tenantId,actorId:f.base.createdBy,entity:'OrderStockReservation',entityId:h2,action:'order-stock.released',metadata:{orderId:f.base.orderId,transactionId:r.releaseTransaction,requestId:releaseId}}]});
 });await assert.rejects(f.create({holdId:h2,quantity:'1.000'}));
});
test('SQL first-document history edit race and overflow maintain the legacy offset without invented movement',async()=>{
 const f=await fixture(),{base}=f;
 const old=await db.stockMovement.create({data:{tenantId:base.tenantId,balanceId:f.balance.id,type:'ADJUSTMENT_IN',delta:'2.000',reason:'Legacy historical movement',actorId:base.createdBy}});
 const results=await Promise.allSettled([f.create(),db.stockMovement.update({where:{id:old.id},data:{delta:'3.000'}})]);
 assert.equal(results[0].status,'fulfilled');const b=await f.current(),sum=await db.stockMovement.aggregate({where:{balanceId:b.id},_sum:{delta:true}});assert.ok(b.quantity.eq(b.transferOpeningDelta.plus(sum._sum.delta)));assert.equal(await db.stockMovement.count({where:{balanceId:b.id}}),2);
 await assert.rejects(db.stockMovement.delete({where:{id:old.id}}));
 const d=results[0].value;
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE id=${b.id}::uuid FOR UPDATE`;
  const delta='999999999999982.999';
  await tx.stockBalance.update({where:{id:b.id},data:{quantity:{increment:delta}}});
  await tx.stockMovement.create({data:{tenantId:base.tenantId,balanceId:b.id,type:'ADJUSTMENT_IN',delta,reason:'Fill to maximum stock precision',actorId:base.createdBy}});
 });
 await assert.rejects(f.create({kind:'RETURN',deliveryId:d.id,quantity:'0.001'}));await assert.rejects(f.create({kind:'CORRECTION',correctsId:d.id,quantity:d.quantity,reference:d.reference}));
 // Vanilla PostgreSQL has no provider roles. Always inspect PUBLIC defaults and
 // object existence; only named-role checks depend on those roles being installed.
 const roles=await db.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`;
 const signatures=['erp_sales_stock_rights(uuid,uuid,uuid,uuid,uuid,boolean)','erp_prepare_sales_stock()','erp_apply_sales_stock()','erp_guard_sales_stock_movement()','erp_check_sales_stock_document()','erp_guard_sales_stock_audit()','erp_guard_sales_stock_source()','erp_guard_sales_hold_marker()','erp_check_sales_hold_marker()','erp_guard_sales_stock_cancellation()','erp_audit_sales_stock_cancellation()','erp_stock_reservation_request_guard()'];
 for(const signature of signatures){
  const rows=await db.$queryRaw`SELECT p.oid::text AS id,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicExecute" FROM pg_proc p WHERE p.oid=to_regprocedure(${signature})`;
  assert.equal(rows.length,1,`Required sales function missing: ${signature}`);assert.equal(rows[0].publicExecute,false,`PUBLIC EXECUTE: ${signature}`);
  for(const {rolname} of roles){const [row]=await db.$queryRaw`SELECT has_function_privilege(${rolname},${signature},'EXECUTE') AS allowed`;assert.equal(row.allowed,false,`${rolname} EXECUTE: ${signature}`);}
 }
 for(const table of ['"SalesStockDocument"','"SalesStockCancellation"']){
  const rows=await db.$queryRaw`SELECT c.relrowsecurity AS rls,EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS "publicPrivileges" FROM pg_class c WHERE c.oid=to_regclass(${table}) AND c.relkind='r'`;
  assert.equal(rows.length,1,`Required sales table missing: ${table}`);assert.equal(rows[0].rls,true,`RLS required: ${table}`);assert.equal(rows[0].publicPrivileges,false,`PUBLIC table privileges: ${table}`);
  for(const {rolname} of roles){const [row]=await db.$queryRaw`SELECT has_table_privilege(${rolname},${table},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed`;assert.equal(row.allowed,false,`${rolname} table privileges: ${table}`);}
 }
});
async function release(f,id,requestId=randomUUID()){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${f.base.tenantId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'stock-reservation-request:'+requestId},0))`;
  await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE id=${f.balance.id}::uuid FOR UPDATE`;
  const r=await tx.stockReservation.update({where:{id},data:{releaseRequestId:requestId,releasedBy:f.base.createdBy,releaseReason:'Concurrent ordinary release'}});
  await tx.auditLog.createMany({data:[{tenantId:f.base.tenantId,actorId:f.base.createdBy,entity:'StockReservation',entityId:id,action:'inventory-stock.reservation-released',metadata:{balanceId:f.balance.id,transactionId:r.releaseTransaction,requestId}},{tenantId:f.base.tenantId,actorId:f.base.createdBy,entity:'OrderStockReservation',entityId:id,action:'order-stock.released',metadata:{orderId:f.base.orderId,transactionId:r.releaseTransaction,requestId}}]});return r;
 });
}
test('SQL deliveries serialize with adjustments, full holds, ordinary releases and branch transfers',async()=>{
 const f=await fixture(),{base}=f;
 const adjustment=()=>db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id=${base.itemId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE id=${f.balance.id}::uuid FOR UPDATE`;
  await tx.stockBalance.update({where:{id:f.balance.id},data:{quantity:{increment:'1.000'}}});
  await tx.stockMovement.create({data:{tenantId:base.tenantId,balanceId:f.balance.id,type:'ADJUSTMENT_IN',delta:'1.000',reason:'Concurrent adjustment',actorId:base.createdBy}});
 });
 const h=await hold(f,'1.000');
 await db.rolePermission.create({data:{tenantId:base.tenantId,roleId:f.role.id,permissionKey:'inventory-transfer:manage'}});
 const dst=await db.branch.create({data:{tenantId:base.tenantId,companyId:base.companyId,name:'Transfer destination',code:'DST'}});
 const operations=await Promise.allSettled([f.create({quantity:'0.001'}),adjustment(),hold(f,'0.001'),release(f,h),db.stockTransfer.create({data:{id:randomUUID(),tenantId:base.tenantId,companyId:base.companyId,sourceBranchId:base.branchId,destinationBranchId:dst.id,itemId:base.itemId,quantity:'0.001',reference:'Concurrent transfer',reason:'Physical stock concurrency',unit:'kg',createdBy:base.createdBy}})]);
 assert.ok(operations.every(x=>x.status==='fulfilled'),operations.filter(x=>x.status==='rejected').map(x=>String(x.reason)).join('\n'));
 const balance=await f.current();assert.equal(balance.quantity.toFixed(3),'21.123');assert.equal(balance.reservedQuantity.toFixed(3),'0.001');
 const selected=await hold(f,'2.000'),race=await Promise.allSettled([f.create({holdId:selected,quantity:'2.000'}),release(f,selected)]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
 const r=await db.stockReservation.findUniqueOrThrow({where:{id:selected}});assert.ok(r.releasedAt);assert.equal((await f.current()).reservedQuantity.toFixed(3),'0.001');assert.equal(await db.salesStockDocument.count({where:{holdId:selected}}),r.salesDeliveryId?1:0);
 // Same release UUID in both paths cannot deadlock: request mutex is taken before balance.
 const selected2=await hold(f,'1.000'),id=randomUUID();const same=await Promise.allSettled([f.create({id,holdId:selected2,quantity:'1.000'}),release(f,selected2,id)]);assert.equal(same.filter(x=>x.status==='fulfilled').length,1);
});
test('SQL delivery versus current unit, source cancellation and permission revocation is serializable',async()=>{
 const a=await fixture();const unit=await Promise.allSettled([a.create(),db.inventoryItem.update({where:{id:a.base.itemId},data:{unit:'box'}})]);assert.equal(unit[1].status,'fulfilled');assert.ok(unit[0].status==='fulfilled'||String(unit[0].reason).includes('original unit'));await assert.rejects(a.create());
 const b=await fixture();const status=await Promise.allSettled([b.create(),db.salesOrder.update({where:{id:b.base.orderId},data:{status:'CANCELLED',cancelledAt:new Date()}})]);assert.equal(status[1].status,'fulfilled');await assert.rejects(b.create());assert.equal(await db.salesStockDocument.count({where:{orderId:b.base.orderId}}),status[0].status==='fulfilled'?1:0);
 const c=await fixture();const revoked=await Promise.allSettled([c.create(),db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:c.base.tenantId,roleId:c.role.id,permissionKey:'order-delivery:manage'}}})]);assert.equal(revoked[1].status,'fulfilled');await assert.rejects(c.create());assert.equal(await db.salesStockDocument.count({where:{orderId:c.base.orderId}}),revoked[0].status==='fulfilled'?1:0);
});
test('SQL delivery races with purchasing receipt and supplier return transaction lock orders without losing stock or source counters',async()=>{
 const f=await fixture(),{base}=f;
 const supplier=await db.supplier.create({data:{tenantId:base.tenantId,companyId:base.companyId,code:'SUP',displayName:'Purchasing concurrency fixture',createdBy:base.createdBy}});
 const purchase=await db.purchaseOrder.create({data:{tenantId:base.tenantId,companyId:base.companyId,branchId:base.branchId,supplierId:supplier.id,number:'PO-SALES-RACE',supplierName:supplier.displayName,currency:'OMR',subtotal:'5.000',status:'ISSUED',issuedAt:new Date(),createdBy:base.createdBy}});
 const line=await db.purchaseOrderLine.create({data:{tenantId:base.tenantId,orderId:purchase.id,position:0,description:'Five explicitly mapped stock units',quantity:5,unitPrice:'1.000',amount:'5.000'}});
 // Mirror the existing receive route's purchase-order UPDATE -> inventory-item
 // UPDATE -> stock UPDATE order, including its genuine receipt counter trigger.
 const receive=()=>db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id=${purchase.id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id=${base.itemId}::uuid FOR UPDATE`;
  const receipt=await tx.goodsReceipt.create({data:{tenantId:base.tenantId,companyId:base.companyId,branchId:base.branchId,orderId:purchase.id,createdBy:base.createdBy}});
  await tx.stockBalance.update({where:{id:f.balance.id},data:{quantity:{increment:'5.000'}}});
  const source=await tx.goodsReceiptLine.create({data:{tenantId:base.tenantId,companyId:base.companyId,orderId:purchase.id,receiptId:receipt.id,orderLineId:line.id,itemId:base.itemId,quantity:'5.000'}});
  const movement=await tx.stockMovement.create({data:{tenantId:base.tenantId,balanceId:f.balance.id,type:'PURCHASE_RECEIPT',delta:'5.000',reason:'Purchase order '+purchase.number,actorId:base.createdBy,receiptLineId:source.id}});
  await tx.purchaseOrder.update({where:{id:purchase.id},data:{status:'RECEIVED',receivedAt:new Date()}});
  await tx.auditLog.create({data:{tenantId:base.tenantId,actorId:base.createdBy,action:'purchase-order.received',entity:'PurchaseOrder',entityId:purchase.id,metadata:{receiptId:receipt.id,branchId:base.branchId,complete:true}}});
  return {receipt,source,movement};
 },{timeout:20000,maxWait:10000});
 const receiptRace=await Promise.allSettled([f.create({quantity:'1.125'}),receive()]);assert.ok(receiptRace.every(x=>x.status==='fulfilled'),receiptRace.filter(x=>x.status==='rejected').map(x=>String(x.reason)).join('\n'));
 assert.equal((await f.current()).quantity.toFixed(3),'24.000');assert.equal((await f.current()).transferOpeningDelta.toFixed(3),'20.125');assert.equal((await db.purchaseOrderLine.findUniqueOrThrow({where:{id:line.id}})).receivedQuantity,5);
 const {receipt,source,movement}=receiptRace[1].value;
 // Mirror the supplier-return route: receipt -> original movement -> balance.
 // This tests the real returned-quantity trigger and projection under delivery's
 // item -> balance -> sales-order -> source-document lock sequence.
 const returnSupplier=quantity=>db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "GoodsReceipt" WHERE id=${receipt.id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "StockMovement" WHERE id=${movement.id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE id=${f.balance.id}::uuid FOR UPDATE`;
  const current=await tx.stockBalance.findUniqueOrThrow({where:{id:f.balance.id}});
  if(current.quantity.minus(current.reservedQuantity).lt(quantity))throw new Error('Insufficient unreserved supplier-return stock');
  const header=await tx.goodsReturn.create({data:{tenantId:base.tenantId,receiptId:receipt.id,reason:'Concurrent supplier return',createdBy:base.createdBy}});
  await tx.stockBalance.update({where:{id:f.balance.id},data:{quantity:{decrement:quantity}}});
  const returned=await tx.goodsReturnLine.create({data:{tenantId:base.tenantId,receiptId:receipt.id,returnId:header.id,receiptLineId:source.id,quantity}});
  await tx.stockMovement.create({data:{tenantId:base.tenantId,balanceId:f.balance.id,type:'PURCHASE_RETURN',delta:-quantity,reason:'Goods return '+header.id,actorId:base.createdBy,returnLineId:returned.id}});
  await tx.auditLog.create({data:{tenantId:base.tenantId,actorId:base.createdBy,entity:'GoodsReturn',entityId:header.id,action:'purchase-order.stock_returned',metadata:{receiptId:receipt.id,branchId:base.branchId,reason:header.reason}}});return header;
 },{timeout:20000,maxWait:10000});
 const returnRace=await Promise.allSettled([f.create({quantity:'2.000'}),returnSupplier(4)]);assert.ok(returnRace.every(x=>x.status==='fulfilled'),returnRace.filter(x=>x.status==='rejected').map(x=>String(x.reason)).join('\n'));
 assert.equal((await f.current()).quantity.toFixed(3),'18.000');assert.equal((await db.goodsReceiptLine.findUniqueOrThrow({where:{id:source.id}})).returnedQuantity,4);assert.equal((await db.purchaseOrderLine.findUniqueOrThrow({where:{id:line.id}})).receivedQuantity,5);
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE id=${f.balance.id}::uuid FOR UPDATE`;
  await tx.stockBalance.update({where:{id:f.balance.id},data:{quantity:{decrement:'16.500'}}});
  await tx.stockMovement.create({data:{tenantId:base.tenantId,balanceId:f.balance.id,type:'ADJUSTMENT_OUT',delta:'-16.500',reason:'Leave competing stock capacity',actorId:base.createdBy}});
 });
 const shortage=await Promise.allSettled([f.create({quantity:'1.000'}),returnSupplier(1)]);assert.equal(shortage.filter(x=>x.status==='fulfilled').length,1);assert.equal((await f.current()).quantity.toFixed(3),'0.500');
 const supplierWon=shortage[1].status==='fulfilled';assert.equal((await db.goodsReceiptLine.findUniqueOrThrow({where:{id:source.id}})).returnedQuantity,supplierWon?5:4);assert.equal(await db.goodsReturn.count({where:{receiptId:receipt.id}}),supplierWon?2:1);
 const sum=await db.stockMovement.aggregate({where:{balanceId:f.balance.id},_sum:{delta:true}}),final=await f.current();assert.ok(final.quantity.eq(final.transferOpeningDelta.plus(sum._sum.delta)));assert.equal(final.reservedQuantity.toFixed(3),'0.000');
});
test('SQL recording and abandonment reject stale-snapshot isolation before all physical or tombstone effects',async()=>{
 const f=await fixture(),{base}=f,before=await f.current();
 const docCount=await db.salesStockDocument.count({where:{tenantId:base.tenantId}}),movementCount=await db.stockMovement.count({where:{tenantId:base.tenantId}}),auditCount=await db.auditLog.count({where:{tenantId:base.tenantId}});
 for(const isolationLevel of ['RepeatableRead','Serializable']){
  const id=randomUUID();
  await assert.rejects(db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${base.tenantId}::uuid`;
   return tx.salesStockDocument.create({data:{...base,id,kind:'DELIVERY'}});
  },{isolationLevel}),/READ COMMITTED/);
  const cancelId=randomUUID(),request={action:'deliver',tenantId:base.tenantId,companyId:base.companyId,orderId:base.orderId,expectedActorId:base.createdBy,requestId:cancelId,branchId:base.branchId,itemId:base.itemId,lineId:base.lineId,holdId:null,expectedUnit:'kg',quantity:'3.125',reference:base.reference,reason:base.reason,physicalConfirmed:true};
  await assert.rejects(db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${base.tenantId}::uuid`;
   return tx.salesStockCancellation.create({data:{id:cancelId,tenantId:base.tenantId,companyId:base.companyId,createdBy:base.createdBy,request}});
  },{isolationLevel}),/READ COMMITTED/);
  assert.equal(await db.salesStockDocument.count({where:{id}}),0);assert.equal(await db.salesStockCancellation.count({where:{id:cancelId}}),0);
 }
 assert.equal(await db.salesStockDocument.count({where:{tenantId:base.tenantId}}),docCount);assert.equal(await db.stockMovement.count({where:{tenantId:base.tenantId}}),movementCount);assert.equal(await db.auditLog.count({where:{tenantId:base.tenantId}}),auditCount);
 const after=await f.current();assert.ok(after.quantity.eq(before.quantity));assert.ok(after.reservedQuantity.eq(before.reservedQuantity));assert.equal(after.transferOpeningDelta,null);
 await f.create();
});
