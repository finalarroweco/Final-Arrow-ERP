import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
test.after(()=>db.$disconnect());
async function fixture(){
 const tenant=await db.tenant.create({data:{name:'Manual reorder SQL QA',slug:'reorder-sql-'+randomUUID()}}),tenantId=tenant.id;
 const user=await db.user.create({data:{name:'Reorder operator',email:randomUUID()+'@example.invalid',passwordHash:'test-only-not-login'}}),createdBy=user.id;
 const member=await db.membership.create({data:{tenantId,userId:createdBy,status:'ACTIVE'}});
 const role=await db.role.create({data:{tenantId,name:'Reorder operator'}});
 for(const permissionKey of ['inventory-stock:read','inventory-reorder:manage'])await db.rolePermission.create({data:{tenantId,roleId:role.id,permissionKey}});
 const grant=await db.roleGrant.create({data:{tenantId,membershipId:member.id,roleId:role.id}});
 const scope=await db.accessScope.create({data:{tenantId,grantId:grant.id,type:'TENANT'}});
 const company=await db.company.create({data:{tenantId,name:'Reorder SQL',code:'REO'}}),companyId=company.id;
 const branch=await db.branch.create({data:{tenantId,companyId,name:'Concrete branch',code:'B'}});
 const item=await db.inventoryItem.create({data:{tenantId,companyId,sku:'SKU',name:'Original item',unit:'EA',createdBy}});
 const base={itemId:item.id,tenantId,companyId,branchId:branch.id,expectedActorId:createdBy,policyId:randomUUID(),unit:'EA',unitVersion:0};
 const request=(extra={})=>({...base,requestId:randomUUID(),action:'create',expectedVersion:0,minimumQuantity:'1.001',targetQuantity:'2.002',reason:'Explicit manual threshold',...extra});
 const lifecycle=(action,expectedVersion,extra={})=>({...base,requestId:randomUUID(),action,expectedVersion,reason:'Explicit manual lifecycle',...extra});
 const save=(p,outcome='COMMITTED',client=db)=>client.inventoryReorderRequest.create({data:{id:p.requestId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,itemId:p.itemId,policyId:p.policyId,createdBy:p.expectedActorId,action:p.action,expectedVersion:p.expectedVersion,request:p,outcome}});
 const current=()=>db.inventoryReorderPolicy.findUniqueOrThrow({where:{id:base.policyId}});
 return {base,request,lifecycle,save,current,role,member,scope,branch,item};
}
test('reorder SQL exact three-decimal lifecycle generates immutable snapshots without stock or financial side effects',async()=>{
 const f=await fixture(),p=f.request();
 const unchanged=async()=>({balances:await db.stockBalance.findMany({where:{tenantId:p.tenantId}}),movements:await db.stockMovement.findMany({where:{tenantId:p.tenantId}}),reservations:await db.stockReservation.findMany({where:{tenantId:p.tenantId}}),journals:await db.journalEntry.findMany({where:{tenantId:p.tenantId}}),salesOrders:await db.salesOrder.findMany({where:{tenantId:p.tenantId}}),purchaseOrders:await db.purchaseOrder.findMany({where:{tenantId:p.tenantId}})});
 const before=await unchanged(),r=await f.save(p),e=r.result;
 assert.equal(e.minimumQuantity,'1.001');assert.equal(e.targetQuantity,'2.002');assert.equal(e.unit,'EA');assert.equal(e.unitVersion,0);assert.equal(e.version,1);assert.equal(e.itemName,f.item.name);assert.equal(e.itemBranchId,null);assert.equal(e.reference,'REO-'+p.policyId);assert.match(e.createdAt,/Z$/);assert.notEqual(e.id,p.requestId);assert.notEqual(e.id,p.policyId);
 await db.inventoryItem.update({where:{id:p.itemId},data:{name:'Renamed',sku:'RENAMED'}});
 const edit=await f.save(f.request({action:'edit',expectedVersion:1,minimumQuantity:'0.000',targetQuantity:'999999999999999.999'}));
 assert.equal(edit.result.itemName,f.item.name);assert.equal(edit.result.itemSku,f.item.sku);assert.equal(edit.result.targetQuantity,'999999999999999.999');
 const archived=await f.save(f.lifecycle('archive',2));assert.equal(archived.result.archived,true);
 await assert.rejects(f.save(f.request({action:'edit',expectedVersion:3})));
 const restored=await f.save(f.lifecycle('restore',3));assert.equal(restored.result.archived,false);assert.equal(restored.result.version,4);
 assert.deepEqual(await unchanged(),before);assert.equal(await db.inventoryReorderRevision.count({where:{policyId:p.policyId}}),4);
 for(const operation of [()=>db.inventoryReorderPolicy.update({where:{id:p.policyId},data:{minimumQuantity:'0'}}),()=>db.inventoryReorderPolicy.update({where:{id:p.policyId},data:{branchId:randomUUID()}}),()=>db.inventoryReorderPolicy.delete({where:{id:p.policyId}}),()=>db.inventoryReorderRevision.update({where:{id:e.id},data:{reason:'forged'}}),()=>db.inventoryReorderRevision.delete({where:{id:e.id}}),()=>db.inventoryReorderRequest.update({where:{id:p.requestId},data:{outcome:'ABANDONED'}}),()=>db.inventoryReorderRequest.delete({where:{id:p.requestId}})])await assert.rejects(operation());
 const audit=await db.auditLog.findFirstOrThrow({where:{entity:'InventoryReorderRequest',entityId:p.requestId}});assert.deepEqual(audit.metadata,{outcome:'COMMITTED'});
 await assert.rejects(db.auditLog.delete({where:{id:audit.id}}));await assert.rejects(db.auditLog.update({where:{id:audit.id},data:{entity:'Other'}}));
 await assert.rejects(db.auditLog.create({data:{tenantId:p.tenantId,actorId:p.expectedActorId,entity:'InventoryReorderRequest',entityId:p.requestId,action:'forged'}}));
});
test('reorder SQL validates canonical identities, numeric bounds and transaction isolation',async()=>{
 const f=await fixture();
 for(const extra of [{unknown:'field'},{unit:' '},{unit:'x'.repeat(17)},{unit:'📦'.repeat(17)},{unit:null},{unitVersion:-1},{unitVersion:0.5},{unitVersion:2147483648},{minimumQuantity:1},{minimumQuantity:'1'},{minimumQuantity:'1.00'},{minimumQuantity:'01.000'},{minimumQuantity:'1e3'},{minimumQuantity:'-0.001'},{minimumQuantity:'+1.000'},{minimumQuantity:'1000000000000000.000'},{minimumQuantity:'0.0001'},{minimumQuantity:'NaN'},{minimumQuantity:'Infinity'},{targetQuantity:'0.000'},{targetQuantity:'1.000e0'},{reason:'\nforged'},{reason:' '},{reason:'\u00a0'},{reason:'\ufeff'},{reason:'\u2000\u2028\u3000'},{reason:'x'.repeat(301)},{expectedVersion:2147483647},{expectedVersion:1},{action:'edit',expectedVersion:0},{unit:'KG'},{unitVersion:1},{branchId:null},{branchId:randomUUID()}])await assert.rejects(f.save(f.request(extra)),JSON.stringify(extra));
 const p=f.request();await assert.rejects(f.save({...p,requestId:p.policyId}));
 await assert.rejects(db.$transaction(tx=>f.save(f.request(),'COMMITTED',tx),{isolationLevel:'RepeatableRead'}));
 const zero=await f.save(f.request({minimumQuantity:'0.000',targetQuantity:'0.000'}));assert.equal(zero.result.minimumQuantity,'0.000');assert.equal(zero.result.targetQuantity,'0.000');
});
test('reorder SQL serializes create duplicates, optimistic edits and archive restore races',async()=>{
 const f=await fixture();const creates=await Promise.allSettled([f.save(f.request()),f.save(f.request({policyId:randomUUID()}))]);assert.equal(creates.filter(x=>x.status==='fulfilled').length,1);
 const policy=await db.inventoryReorderPolicy.findFirstOrThrow({where:{itemId:f.item.id}});const id=policy.id;
 const edits=await Promise.allSettled([f.save(f.request({policyId:id,action:'edit',expectedVersion:1,minimumQuantity:'1.000'})),f.save(f.request({policyId:id,action:'edit',expectedVersion:1,minimumQuantity:'0.000'}))]);assert.equal(edits.filter(x=>x.status==='fulfilled').length,1);
 await f.save(f.lifecycle('archive',2,{policyId:id}));
 const secondId=randomUUID();await f.save(f.request({policyId:secondId}));
 await assert.rejects(f.save(f.lifecycle('restore',3,{policyId:id})));
 await f.save(f.lifecycle('archive',1,{policyId:secondId}));
 const restores=await Promise.allSettled([f.save(f.lifecycle('restore',3,{policyId:id})),f.save(f.lifecycle('restore',2,{policyId:secondId}))]);assert.equal(restores.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(await db.inventoryReorderPolicy.count({where:{itemId:f.item.id,archived:false}}),1);
});
test('reorder SQL terminal abandonment is immutable and race-safe, including stale source',async()=>{
 const f=await fixture(),pending=f.request();const outcomes=await Promise.allSettled([f.save(pending),f.save(pending,'ABANDONED')]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(await db.inventoryReorderRequest.count({where:{id:pending.requestId}}),1);
 const g=await fixture(),p=g.request();await db.inventoryItem.update({where:{id:g.item.id},data:{unit:'KG',archivedAt:new Date()}});
 const cancelled=await g.save(p,'ABANDONED');assert.equal(cancelled.result,null);assert.equal(await db.inventoryReorderPolicy.count({where:{id:p.policyId}}),0);
 await assert.rejects(g.save(p));await assert.rejects(g.save({...p,reason:'changed'},'ABANDONED'));
 await assert.rejects(g.save({...p,requestId:randomUUID(),unknown:'extra'},'ABANDONED'));
 const audit=await db.auditLog.findFirstOrThrow({where:{entity:'InventoryReorderRequest',entityId:p.requestId}});assert.deepEqual(audit.metadata,{outcome:'ABANDONED'});
 const h=await fixture(),deleted=h.request();await db.inventoryItem.delete({where:{id:h.item.id}});await assert.rejects(h.save(deleted));assert.equal((await h.save(deleted,'ABANDONED')).result,null);
});
test('reorder SQL permanently fences unit cycles without prohibiting item unit changes',async()=>{
 const f=await fixture(),p=f.request();await f.save(p);
 await assert.rejects(db.inventoryItem.update({where:{id:f.item.id},data:{reorderUnitVersion:1}}));
 await assert.rejects(db.inventoryItem.create({data:{tenantId:p.tenantId,companyId:p.companyId,sku:'FORGED',name:'Forged',unit:'EA',createdBy:p.expectedActorId,reorderUnitVersion:1}}));
 await db.inventoryItem.update({where:{id:f.item.id},data:{unit:'KG'}});assert.equal((await db.inventoryItem.findUniqueOrThrow({where:{id:f.item.id}})).reorderUnitVersion,1);
 await assert.rejects(f.save(f.request({action:'edit',expectedVersion:1})));
 await db.inventoryItem.update({where:{id:f.item.id},data:{unit:'EA'}});assert.equal((await db.inventoryItem.findUniqueOrThrow({where:{id:f.item.id}})).reorderUnitVersion,2);
 await assert.rejects(f.save(f.request({action:'edit',expectedVersion:1})));
 await f.save(f.lifecycle('archive',1));await assert.rejects(f.save(f.lifecycle('restore',2)));
 await assert.rejects(f.save(f.request({policyId:randomUUID(),unitVersion:0})));
 const fresh=await f.save(f.request({policyId:randomUUID(),unitVersion:2}));assert.equal(fresh.result.unitVersion,2);assert.equal((await f.current()).unitVersion,0);
 await assert.rejects(db.inventoryItem.delete({where:{id:f.item.id}}));
});
test('reorder SQL preserves immutable policy scope as source moves and archives',async()=>{
 const f=await fixture(),p=f.request();await f.save(p);
 const sibling=await db.branch.create({data:{tenantId:p.tenantId,companyId:p.companyId,name:'Sibling',code:'S'}});
 await db.inventoryItem.update({where:{id:f.item.id},data:{branchId:sibling.id}});
 await assert.rejects(f.save(f.request({action:'edit',expectedVersion:1})));
 await f.save(f.lifecycle('archive',1));await assert.rejects(f.save(f.lifecycle('restore',2)));
 assert.equal((await f.current()).branchId,p.branchId);assert.equal((await f.current()).itemBranchId,null);
 await db.inventoryItem.update({where:{id:f.item.id},data:{branchId:null,archivedAt:new Date()}});
 await assert.rejects(f.save(f.lifecycle('restore',2)));await assert.rejects(f.save(f.request({policyId:randomUUID()})));
 await db.inventoryItem.update({where:{id:f.item.id},data:{archivedAt:null}});await f.save(f.lifecycle('restore',2));
 const other=await db.company.create({data:{tenantId:p.tenantId,name:'Other company',code:'OTHER'}});
 await db.inventoryItem.update({where:{id:f.item.id},data:{companyId:other.id}});
 await assert.rejects(f.save(f.request({action:'edit',expectedVersion:3})));await f.save(f.lifecycle('archive',3));
 assert.equal((await f.current()).companyId,p.companyId);assert.equal((await f.current()).itemName,f.item.name);
});
test('reorder SQL requires current independent permission intersections and exact tenant company branch sources',async()=>{
 const f=await fixture(),g=await fixture();
 await assert.rejects(f.save(f.request({itemId:g.item.id})));
 await db.accessScope.update({where:{id:f.scope.id},data:{type:'BRANCH',companyId:f.base.companyId,branchId:f.branch.id}});
 // No company-wide catalog permission: a company-wide item remains eligible at this concrete branch.
 await f.save(f.request());
 const sibling=await db.branch.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,name:'Sibling',code:'S'}});
 await assert.rejects(f.save(f.request({policyId:randomUUID(),branchId:sibling.id})));
 const scoped=await db.inventoryItem.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,branchId:sibling.id,sku:'SIB',name:'Other branch',unit:'EA',createdBy:f.base.expectedActorId}});
 await assert.rejects(f.save(f.request({policyId:randomUUID(),itemId:scoped.id})));
 await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.base.tenantId,roleId:f.role.id,permissionKey:'inventory-reorder:manage'}}});
 const manageRole=await db.role.create({data:{tenantId:f.base.tenantId,name:'Other branch manager'}});await db.rolePermission.create({data:{tenantId:f.base.tenantId,roleId:manageRole.id,permissionKey:'inventory-reorder:manage'}});
 const grant=await db.roleGrant.create({data:{tenantId:f.base.tenantId,membershipId:f.member.id,roleId:manageRole.id}});await db.accessScope.create({data:{tenantId:f.base.tenantId,grantId:grant.id,type:'BRANCH',companyId:f.base.companyId,branchId:sibling.id}});
 await assert.rejects(f.save(f.request({action:'edit',expectedVersion:1})));await assert.rejects(f.save(f.request({action:'edit',expectedVersion:1}),'ABANDONED'));
 await db.rolePermission.create({data:{tenantId:f.base.tenantId,roleId:f.role.id,permissionKey:'inventory-reorder:manage'}});
 await db.membership.update({where:{id:f.member.id},data:{status:'SUSPENDED'}});await assert.rejects(f.save(f.lifecycle('archive',1)));
});
test('reorder SQL tables functions and audit resist untrusted roles and truncation',async()=>{
 const f=await fixture(),p=f.request(),r=await f.save(p);
 for(const table of ['InventoryReorderPolicy','InventoryReorderRevision','InventoryReorderRequest']){
  const [row]=await db.$queryRawUnsafe(`SELECT relrowsecurity FROM pg_class WHERE oid='"${table}"'::regclass`);assert.equal(row.relrowsecurity,true);
  const acl=await db.$queryRawUnsafe(`SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='"${table}"'::regclass AND a.grantee=0`);assert.equal(acl.length,0);
  for(const role of ['anon','authenticated']){const exists=await db.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname='${role}'`);if(exists.length){const [access]=await db.$queryRawUnsafe(`SELECT has_table_privilege('${role}','"${table}"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS yes`);assert.equal(access.yes,false);}}
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`));
 }
 for(const fn of ['erp_guard_reorder_item_unit','erp_guard_reorder_projection','erp_apply_reorder_request','erp_audit_reorder_request','erp_guard_reorder_audit','erp_guard_reorder_truncate']){
  const [row]=await db.$queryRawUnsafe(`SELECT prosecdef FROM pg_proc WHERE oid='${fn}()'::regprocedure`);assert.equal(row.prosecdef,false);
  const acl=await db.$queryRawUnsafe(`SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='${fn}()'::regprocedure AND a.grantee=0`);assert.equal(acl.length,0);
  for(const role of ['anon','authenticated']){const exists=await db.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname='${role}'`);if(exists.length){const [access]=await db.$queryRawUnsafe(`SELECT has_function_privilege('${role}','${fn}()','EXECUTE') AS yes`);assert.equal(access.yes,false);}}
 }
 await assert.rejects(db.$executeRawUnsafe('TRUNCATE TABLE "AuditLog" CASCADE'));assert.equal((await f.current()).version,1);assert.equal(await db.inventoryReorderRevision.count({where:{id:r.result.id}}),1);
});

test('reorder SQL checks fresh unit and permissions after blocking concurrent locks',async()=>{
 // Independent sessions also make the barrier valid with a one-connection pool.
 const blocker=new PrismaClient(),writer=new PrismaClient();
 async function afterObservedLock(lock,submit){
  let release,ready,rejectReady;
  const locked=new Promise((resolve,reject)=>{ready=resolve;rejectReady=reject;});
  const unblock=new Promise(resolve=>{release=resolve;});
  const holding=blocker.$transaction(async tx=>{
   const [{pid}]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
   await lock(tx);ready(pid);await unblock;
  },{timeout:15000});
  void holding.catch(rejectReady);
  let submitted;
  try{
   const holderPid=await locked;
   submitted=submit(writer).then(()=>false,()=>true);
   const deadline=Date.now()+5000;
   while(true){
    const [{waiting}]=await db.$queryRaw`SELECT EXISTS (
     SELECT 1 FROM pg_stat_activity
     WHERE datname=current_database() AND pid<>pg_backend_pid()
       AND wait_event_type='Lock' AND position('InventoryReorderRequest' in query)>0
       AND ${holderPid}::integer=ANY(pg_blocking_pids(pid))
    ) AS waiting`;
    if(waiting)break;
    assert.ok(Date.now()<deadline,'Expected reorder INSERT to wait on the specific held database lock');
    await new Promise(resolve=>setTimeout(resolve,20));
   }
  }finally{
   release();
   await holding;
   if(submitted)await submitted;
  }
  assert.equal(await submitted,true,'Write must reject using fresh state after the observed lock wait');
 }
 try{
  const f=await fixture();
  await afterObservedLock(tx=>tx.inventoryItem.update({where:{id:f.item.id},data:{unit:'KG'}}),client=>f.save(f.request(),'COMMITTED',client));
  assert.equal(await db.inventoryReorderPolicy.count({where:{itemId:f.item.id}}),0);
  const g=await fixture();
  await afterObservedLock(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${g.base.tenantId}::uuid FOR UPDATE`;
   await tx.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:g.base.tenantId,roleId:g.role.id,permissionKey:'inventory-reorder:manage'}}});
  },client=>g.save(g.request(),'COMMITTED',client));
  assert.equal(await db.inventoryReorderRequest.count({where:{tenantId:g.base.tenantId}}),0);
 }finally{await Promise.all([blocker.$disconnect(),writer.$disconnect()]);}
});

test('reorder SQL preserves legacy source text and arbitrary varchar16 unit snapshots exactly',async()=>{
 const cases=[
  {unit:'',name:'',sku:''},
  {unit:'وحدة\n\t📦',name:'اسم طويل\n'+('عربي 📦\t'.repeat(600)),sku:'\n='+('رمز'.repeat(150))+'📦\t'},
  {unit:'📦'.repeat(16),name:'\t'+('🚚'.repeat(300))+'\n',sku:'@رمز\n'+('🚚'.repeat(100))},
 ];
 for(const source of cases){
  const f=await fixture();
  const item=await db.inventoryItem.update({where:{id:f.item.id},data:source});
  assert.equal(item.unit,source.unit);assert.equal(item.reorderUnitVersion,1);
  const p=f.request({unit:source.unit,unitVersion:item.reorderUnitVersion});
  const saved=await f.save(p);
  for(const [key,value] of Object.entries({unit:source.unit,itemName:source.name,itemSku:source.sku}))assert.equal(saved.result[key],value);
  await db.inventoryItem.update({where:{id:f.item.id},data:{name:'Renamed after policy',sku:'Renamed after policy'}});
  const edited=await f.save(f.request({unit:source.unit,unitVersion:item.reorderUnitVersion,action:'edit',expectedVersion:1,minimumQuantity:'0.001'}));
  assert.equal(edited.result.itemName,source.name);assert.equal(edited.result.itemSku,source.sku);assert.equal(edited.result.unit,source.unit);
  const original=await db.inventoryReorderRevision.findUniqueOrThrow({where:{id:saved.result.id}});
  assert.equal(original.itemName,source.name);assert.equal(original.itemSku,source.sku);assert.equal(original.unit,source.unit);
 }
});
