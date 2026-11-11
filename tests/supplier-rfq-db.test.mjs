import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
test.after(()=>db.$disconnect());
async function fixture(){
 const tenant=await db.tenant.create({data:{name:'RFQ SQL QA',slug:'rfq-sql-'+randomUUID()}}),tenantId=tenant.id;
 const user=await db.user.create({data:{name:'RFQ operator',email:randomUUID()+'@example.invalid',passwordHash:'test-only'}}),createdBy=user.id;
 const member=await db.membership.create({data:{tenantId,userId:createdBy,status:'ACTIVE'}});
 const role=await db.role.create({data:{tenantId,name:'RFQ operator'}});
 for(const permissionKey of ['rfq:read','rfq:manage','supplier:read','purchase-order:read','purchase-order:create'])await db.rolePermission.create({data:{tenantId,roleId:role.id,permissionKey}});
 const grant=await db.roleGrant.create({data:{tenantId,membershipId:member.id,roleId:role.id}});
 const scope=await db.accessScope.create({data:{tenantId,grantId:grant.id,type:'TENANT'}});
 const company=await db.company.create({data:{tenantId,name:'RFQ company',code:'RFQ'}}),companyId=company.id;
 const branch=await db.branch.create({data:{tenantId,companyId,name:'RFQ branch',code:'B'}});
 const supplier=await db.supplier.create({data:{tenantId,companyId,code:'SUP',displayName:'  Legacy\nSupplier name  ',createdBy}});
 const base={tenantId,companyId,branchId:branch.id,expectedActorId:createdBy,rfqId:randomUUID()};
 const command=(action,expectedVersion,extra={})=>({...base,requestId:randomUUID(),action,expectedVersion,reason:'Explicit operator action',...extra});
 const create=(extra={})=>command('create',0,{title:'Required supplies',deadline:'2099-12-31',notes:'Internal RFQ; not sent',lines:[{position:0,description:'First item',quantity:3},{position:1,description:'Second item',quantity:2}],...extra});
 const offer=(expectedVersion,extra={})=>command('offer',expectedVersion,{offerId:randomUUID(),expectedOfferVersion:0,supplierId:supplier.id,requestRevision:1,currency:'OMR',validUntil:'2099-12-31',notes:'Operator-entered terms',lines:[{position:0,unitPrice:'1.001'},{position:1,unitPrice:'2.002'}],...extra});
 const award=(expectedVersion,o,extra={})=>command('award',expectedVersion,{offerId:o.offerId,expectedOfferVersion:1,requestRevision:1,purchaseOrderId:randomUUID(),purchaseOrderNumber:'PO-'+randomUUID().slice(0,8).toUpperCase(),evaluationDate:new Date().toISOString().slice(0,10),...extra});
 const save=(p,outcome='COMMITTED',client=db)=>client.supplierRfqRequest.create({data:{id:p.requestId,rfqId:p.rfqId,tenantId,companyId,branchId:p.branchId,createdBy,action:p.action,expectedVersion:p.expectedVersion,request:p,outcome}});
 const opened=async()=>{await save(create());await save(command('open',1));};
 return {tenantId,companyId,base,createdBy,role,member,scope,branch,supplier,command,create,offer,award,save,opened};
}
test('RFQ SQL atomic whole-offer award preserves exact immutable source and original DRAFT PO snapshot',async()=>{
 const f=await fixture();await f.opened();const o=f.offer(2);await f.save(o);await db.supplier.update({where:{id:f.supplier.id},data:{displayName:'Renamed'}});
 const a=f.award(3,o),r=await f.save(a),e=r.result;assert.equal(e.rfq.status,'AWARDED');assert.equal(e.purchaseOrder.status,'DRAFT');assert.equal(e.purchaseOrder.subtotal,'7.007');assert.equal(e.purchaseOrder.supplierName,f.supplier.displayName);assert.equal(e.offer.supplierName,f.supplier.displayName);assert.equal(e.purchaseOrder.lines[0].amount,'3.003');assert.equal(e.purchaseOrder.lines[1].amount,'4.004');assert.deepEqual(e.request,a);
 assert.equal(await db.stockMovement.count({where:{tenantId:f.tenantId}}),0);assert.equal(await db.stockBalance.count({where:{tenantId:f.tenantId}}),0);assert.equal(await db.journalEntry.count({where:{tenantId:f.tenantId}}),0);
 await db.purchaseOrder.update({where:{id:a.purchaseOrderId},data:{status:'ISSUED',issuedAt:new Date()}});assert.deepEqual((await db.supplierRfqRequest.findUniqueOrThrow({where:{id:a.requestId}})).result,e);await assert.rejects(f.save(f.command('cancel',4)));
 for(const action of [()=>db.supplierRfq.update({where:{id:f.base.rfqId},data:{status:'OPEN'}}),()=>db.supplierOffer.update({where:{id:o.offerId},data:{notes:'forged'}}),()=>db.supplierRfqRevision.update({where:{id:e.id},data:{request:{}}}),()=>db.supplierRfqRequest.delete({where:{id:a.requestId}})])await assert.rejects(action());
 const audit=await db.auditLog.findFirstOrThrow({where:{entity:'SupplierRfqRequest',entityId:a.requestId}});assert.deepEqual(audit.metadata,{outcome:'COMMITTED'});await assert.rejects(db.auditLog.update({where:{id:audit.id},data:{metadata:{leak:true}}}));await assert.rejects(db.auditLog.create({data:{tenantId:f.tenantId,actorId:f.createdBy,action:'forged',entity:'SupplierOffer',entityId:o.offerId,metadata:{}}}));
});
test('RFQ SQL races, terminal abandonment, conflicting PO numbers and response-loss identities are atomic',async()=>{
 const f=await fixture();await f.opened();const o=f.offer(2);await f.save(o);const a=f.award(3,o),b=f.award(3,o);const results=await Promise.allSettled([f.save(a),f.save(b),f.save(f.command('cancel',3))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(await db.purchaseOrder.count({where:{tenantId:f.tenantId}})<=1);
 const g=await fixture();await g.opened();const og=g.offer(2);await g.save(og);const ag=g.award(3,og);await db.purchaseOrder.create({data:{id:randomUUID(),tenantId:g.tenantId,companyId:g.companyId,branchId:g.branch.id,supplierId:g.supplier.id,supplierName:g.supplier.displayName,number:ag.purchaseOrderNumber,currency:'OMR',subtotal:'0.000',createdBy:g.createdBy}});await assert.rejects(g.save(ag));assert.equal(await db.supplierRfqRequest.count({where:{id:ag.requestId}}),0);assert.equal((await db.supplierRfq.findUniqueOrThrow({where:{id:g.base.rfqId}})).version,3);
 assert.equal((await g.save(ag,'ABANDONED')).result,null);await assert.rejects(g.save(ag));assert.equal(await db.purchaseOrder.count({where:{tenantId:g.tenantId}}),1);
 const h=await fixture(),c=h.create();const race=await Promise.allSettled([h.save(c),h.save(c,'ABANDONED')]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(await db.supplierRfqRequest.count({where:{id:c.requestId}}),1);
});
test('RFQ SQL rejects malformed calendars, fields, incomplete/expired/foreign-currency and stale offers',async()=>{
 const f=await fixture();for(const deadline of ['2026-02-29','2026-04-31','0000-01-01','2026-1-01'])await assert.rejects(f.save(f.create({deadline})));
 await assert.rejects(f.save(f.create({lines:[{position:1,description:'Bad order',quantity:1}]})));await assert.rejects(f.save(f.create({lines:[{position:0,description:'Too large',quantity:100001}]})));await assert.rejects(f.save({...f.create(),forged:true}));await assert.rejects(f.save(f.create({title:'\u00a0'})));await assert.rejects(f.save(f.create({lines:[{position:0,description:'\u00a0x',quantity:1}]})));await f.opened();await assert.rejects(f.save(f.offer(2,{lines:[{position:1,unitPrice:'1.000'},{position:0,unitPrice:'1.000'}]})));
 let version=2;for(const patch of [{lines:[]},{currency:'USD'},{validUntil:'2020-01-01'}]){const o=f.offer(version,patch);await f.save(o);version++;await assert.rejects(f.save(f.award(version,o,{evaluationDate:'2019-01-01'})));}
 const o=f.offer(version);await f.save(o);version++;await f.save(f.command('edit',version,{title:'Revised',deadline:null,notes:'Changed scope',lines:[{position:0,description:'New requirement',quantity:1}]}));version++;await f.save(f.command('open',version));version++;await assert.rejects(f.save(f.award(version,o)));await assert.rejects(f.save(f.offer(version,{requestRevision:1})));
 const fresh=f.offer(version,{offerId:o.offerId,expectedOfferVersion:1,requestRevision:2,lines:[{position:0,unitPrice:'0.001'}]});await f.save(fresh);version++;const result=await f.save(f.award(version,fresh,{requestRevision:2,expectedOfferVersion:2}));assert.equal(result.result.purchaseOrder.subtotal,'0.001');
});
test('RFQ SQL independently checks source/RFQ/PO scope, revocation and archival while preserving abandonment',async()=>{
 const f=await fixture();await f.opened();const o=f.offer(2);await f.save(o);await db.supplier.update({where:{id:f.supplier.id},data:{archivedAt:new Date()}});const a=f.award(3,o);await assert.rejects(f.save(a));assert.equal((await f.save(a,'ABANDONED')).result,null);
 await db.supplier.update({where:{id:f.supplier.id},data:{archivedAt:null}});await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.tenantId,roleId:f.role.id,permissionKey:'purchase-order:create'}}});await assert.rejects(f.save(f.award(3,o)));await assert.rejects(f.save(f.award(3,o),'ABANDONED'));
 await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.tenantId,roleId:f.role.id,permissionKey:'supplier:read'}}});await assert.rejects(f.save(f.offer(3)));assert.equal((await f.save(f.offer(3),'ABANDONED')).result,null);
 const g=await fixture();await db.accessScope.update({where:{id:g.scope.id},data:{type:'BRANCH',companyId:g.companyId,branchId:g.branch.id}});await g.opened();await assert.rejects(g.save(g.offer(2)));await db.supplier.update({where:{id:g.supplier.id},data:{branchId:g.branch.id}});await g.save(g.offer(2));
 const h=await fixture();await h.opened();const foreign=await db.supplier.create({data:{tenantId:f.tenantId,companyId:f.companyId,code:'FOREIGN',displayName:'Foreign',createdBy:f.createdBy}});await assert.rejects(h.save(h.offer(2,{supplierId:foreign.id})));assert.equal((await h.save(h.offer(2,{supplierId:foreign.id}),'ABANDONED')).result,null);
 await db.membership.update({where:{id:h.member.id},data:{status:'INVITED'}});await assert.rejects(h.save(h.command('cancel',2)));
});
test('RFQ SQL tables and helpers deny PUBLIC and provider roles and retain row security',async()=>{
 const tables=['SupplierRfq','SupplierOffer','SupplierRfqRevision','SupplierRfqRequest'];for(const table of tables){const r=await db.$queryRawUnsafe('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',`"${table}"`);assert.equal(r[0].relrowsecurity,true);const a=await db.$queryRawUnsafe("SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_name=$1 AND grantee IN ('PUBLIC','anon','authenticated')",table);assert.equal(a[0].n,0);await assert.rejects(db.$executeRawUnsafe(`TRUNCATE "${table}" CASCADE`));}
 const funcs=await db.$queryRaw`SELECT proname FROM pg_proc WHERE proname IN ('erp_rfq_date','erp_guard_rfq_projection','erp_apply_rfq_request','erp_audit_rfq_request','erp_guard_rfq_audit','erp_guard_rfq_truncate') AND EXISTS(SELECT 1 FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')`;assert.equal(funcs.length,0);
});
test('RFQ SQL serializes offer revisions and rejects total overflow without partial purchase orders',async()=>{
 const f=await fixture();await f.opened();const o=f.offer(2);await f.save(o);const r1=f.offer(3,{offerId:o.offerId,expectedOfferVersion:1,lines:[{position:0,unitPrice:'3.000'}]}),r2=f.offer(3,{offerId:o.offerId,expectedOfferVersion:1,lines:[{position:0,unitPrice:'4.000'}]});const race=await Promise.allSettled([f.save(r1),f.save(r2)]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal((await db.supplierOffer.findUniqueOrThrow({where:{id:o.offerId}})).version,2);assert.equal((await db.supplierRfqRevision.findMany({where:{rfqId:f.base.rfqId,action:'offer'}})).length,2);
 const g=await fixture(),lines=Array.from({length:50},(_,position)=>({position,description:'High quantity item',quantity:100000}));await g.save(g.create({lines}));await g.save(g.command('open',1));const big=g.offer(2,{lines:lines.map(l=>({position:l.position,unitPrice:'999999999.999'}))});await g.save(big);const a=g.award(3,big);await assert.rejects(g.save(a));assert.equal(await db.purchaseOrder.count({where:{tenantId:g.tenantId}}),0);assert.equal(await db.supplierRfqRequest.count({where:{id:a.requestId}}),0);assert.equal((await db.supplierRfq.findUniqueOrThrow({where:{id:g.base.rfqId}})).version,3);
});

test('RFQ SQL rejects invalid source currency only for new specifications and preserves history and cancellation',async()=>{
 const f=await fixture();
 for(const baseCurrency of ['', 'omr', 'OM', '1?!']){
  await db.company.update({where:{id:f.companyId},data:{baseCurrency}});const p=f.create();await assert.rejects(f.save(p));assert.equal(await db.supplierRfq.count({where:{tenantId:f.tenantId}}),0);assert.equal(await db.supplierRfqRequest.count({where:{tenantId:f.tenantId}}),0);assert.equal(await db.supplierRfqRevision.count({where:{tenantId:f.tenantId}}),0);
 }
 await db.company.update({where:{id:f.companyId},data:{baseCurrency:'OMR'}});const original=f.create(),created=await f.save(original);
 await db.company.update({where:{id:f.companyId},data:{baseCurrency:'omr'}});const edit={...original,action:'edit',expectedVersion:1,requestId:randomUUID(),title:'Changed'};await assert.rejects(f.save(edit));assert.equal(await db.supplierRfqRequest.count({where:{id:edit.requestId}}),0);assert.deepEqual((await db.supplierRfqRequest.findUniqueOrThrow({where:{id:original.requestId}})).result,created.result);assert.equal((await db.supplierRfq.findUniqueOrThrow({where:{id:f.base.rfqId}})).version,1);
 const abandoned=await f.save(edit,'ABANDONED');assert.equal(abandoned.outcome,'ABANDONED');assert.equal((await f.save(f.command('cancel',1))).result.rfq.status,'CANCELLED');assert.equal((await db.company.findUniqueOrThrow({where:{id:f.companyId}})).baseCurrency,'omr');assert.equal(await db.purchaseOrder.count({where:{tenantId:f.tenantId}}),0);assert.equal(await db.stockMovement.count({where:{tenantId:f.tenantId}}),0);assert.equal(await db.journalEntry.count({where:{tenantId:f.tenantId}}),0);
});
