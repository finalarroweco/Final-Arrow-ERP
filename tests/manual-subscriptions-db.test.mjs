import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
test.after(()=>db.$disconnect());
async function fixture(){
 const tenant=await db.tenant.create({data:{name:'Internal subscription SQL QA',slug:'text-sql-'+randomUUID()}}),tenantId=tenant.id;
 const user=await db.user.create({data:{name:'Text operator',email:randomUUID()+'@example.invalid',passwordHash:'test-only-not-login'}}),createdBy=user.id;
 const member=await db.membership.create({data:{tenantId,userId:createdBy,status:'ACTIVE'}});
 const role=await db.role.create({data:{tenantId,name:'Text operator'}});
 for(const permissionKey of ['subscription:read','subscription:manage','customer:read'])await db.rolePermission.create({data:{tenantId,roleId:role.id,permissionKey}});
 const grant=await db.roleGrant.create({data:{tenantId,membershipId:member.id,roleId:role.id}});
 const scope=await db.accessScope.create({data:{tenantId,grantId:grant.id,type:'TENANT'}});
 const company=await db.company.create({data:{tenantId,name:'Text SQL',code:'TXT'}}),companyId=company.id;
 const branch=await db.branch.create({data:{tenantId,companyId,name:'Branch',code:'B'}});
 const customer=await db.customer.create({data:{tenantId,companyId,code:'C',displayName:'Customer snapshot',createdBy}});
 const base={customerId:customer.id,tenantId,companyId,branchId:null,expectedActorId:createdBy,subscriptionId:randomUUID()};
 const request=(extra={})=>({...base,requestId:randomUUID(),action:'create',expectedVersion:0,serviceLabel:'تعليمات التشغيل',description:'مرحبا\n<script>alert(1)</script>\nhttps://example.invalid',reason:'Explicit operating note',agreementReference:'AG-42',status:'PLANNED',startDate:'2024-02-29',endDate:'2025-02-28',nextReviewDate:'2024-12-01',...extra});
 const save=(p,outcome='COMMITTED',client=db)=>client.manualSubscriptionRequest.create({data:{id:p.requestId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,customerId:p.customerId,subscriptionId:p.subscriptionId,createdBy:p.expectedActorId,action:p.action,expectedVersion:p.expectedVersion,request:p,outcome}});
 const current=()=>db.manualSubscription.findUniqueOrThrow({where:{id:base.subscriptionId}});
 return {base,request,save,current,role,member,scope,branch,customer};
}
test('subscription SQL creates exact snapshots and immutable lifecycle with authoritative timestamps',async()=>{
 const f=await fixture(),p=f.request(),r=await f.save(p),e=r.result;
 assert.equal(e.serviceLabel,p.serviceLabel);assert.equal(e.description,p.description);assert.equal(e.version,1);assert.equal(e.archived,false);assert.notEqual(e.id,r.id);assert.notEqual(e.id,p.subscriptionId);assert.match(e.createdAt,/Z$/);assert.equal((await f.current()).version,1);
 const edit=f.request({action:'edit',expectedVersion:1,serviceLabel:'Second serviceLabel',description:'Second\nكامل'}),r2=await f.save(edit);assert.equal(r2.result.version,2);
 const {serviceLabel,description,agreementReference,status,startDate,endDate,nextReviewDate,...archive}=f.request({action:'archive',expectedVersion:2});void serviceLabel;void description;void agreementReference;void status;void startDate;void endDate;void nextReviewDate;
 const archived=await f.save(archive);assert.equal(archived.result.archived,true);assert.equal(archived.result.description,edit.description);
 await assert.rejects(f.save(f.request({action:'edit',expectedVersion:3})));
 await assert.rejects(f.save({...archive,requestId:randomUUID(),expectedVersion:3}));
 const restored=await f.save({...archive,requestId:randomUUID(),action:'restore',expectedVersion:3});assert.equal(restored.result.version,4);assert.equal(restored.result.archived,false);assert.equal(restored.result.description,edit.description);
 assert.equal((await db.manualSubscriptionRevision.findUniqueOrThrow({where:{id:e.id}})).description,p.description);
 assert.equal((await db.manualSubscriptionRequest.findUniqueOrThrow({where:{id:p.requestId}})).result.description,p.description);
 for(const operation of [()=>db.manualSubscription.update({where:{id:p.subscriptionId},data:{description:'forged'}}),()=>db.manualSubscription.update({where:{id:p.subscriptionId},data:{branchId:f.branch.id}}),()=>db.manualSubscription.delete({where:{id:p.subscriptionId}}),()=>db.manualSubscriptionRevision.update({where:{id:e.id},data:{reason:'forged'}}),()=>db.manualSubscriptionRevision.delete({where:{id:e.id}}),()=>db.manualSubscriptionRequest.update({where:{id:p.requestId},data:{outcome:'ABANDONED'}}),()=>db.manualSubscriptionRequest.delete({where:{id:p.requestId}})])await assert.rejects(operation());
 const audit=await db.auditLog.findFirstOrThrow({where:{entity:'ManualSubscriptionRequest',entityId:p.requestId}});
 assert.deepEqual(audit.metadata,{outcome:'COMMITTED'});
 await assert.rejects(db.auditLog.delete({where:{id:audit.id}}));await assert.rejects(db.auditLog.update({where:{id:audit.id},data:{entity:'Other'}}));
 await assert.rejects(db.auditLog.create({data:{tenantId:p.tenantId,actorId:p.expectedActorId,entity:'ManualSubscriptionRequest',entityId:p.requestId,action:'fake'}}));
});
test('subscription SQL serializes competing edits, lifecycle and request abandonment',async()=>{
 const f=await fixture();await f.save(f.request());
 const a=f.request({action:'edit',expectedVersion:1,serviceLabel:'First'}),b=f.request({action:'edit',expectedVersion:1,serviceLabel:'Second'});
 const edits=await Promise.allSettled([f.save(a),f.save(b)]);assert.equal(edits.filter(x=>x.status==='fulfilled').length,1);assert.equal((await f.current()).version,2);
 const {serviceLabel,description,agreementReference,status,startDate,endDate,nextReviewDate,...archive}=f.request({action:'archive',expectedVersion:2});void serviceLabel;void description;void agreementReference;void status;void startDate;void endDate;void nextReviewDate;
 const changes=await Promise.allSettled([f.save(archive),f.save(f.request({action:'edit',expectedVersion:2}))]);assert.equal(changes.filter(x=>x.status==='fulfilled').length,1);assert.equal((await f.current()).version,3);
 const g=await fixture(),pending=g.request();const outcomes=await Promise.allSettled([g.save(pending),g.save(pending,'ABANDONED')]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(await db.manualSubscriptionRequest.count({where:{id:pending.requestId}}),1);
 const h=await fixture(),cancel=h.request();const tombstone=await h.save(cancel,'ABANDONED');assert.equal(tombstone.result,null);await assert.rejects(h.save(cancel));await assert.rejects(h.save({...cancel,description:'Changed'}));assert.equal(await db.manualSubscription.count({where:{id:cancel.subscriptionId}}),0);
});
test('subscription SQL validates exact payload, scope, permissions, bytes and isolation',async()=>{
 const f=await fixture();
 for(const extra of [{unknown:'field'},{expectedActorId:randomUUID()},{serviceLabel:' '},{serviceLabel:'x'.repeat(201)},{description:'😀'.repeat(16385)},{reason:'\nforged'},{action:'edit',expectedVersion:0},{serviceLabel:12},{description:null},{startDate:'2025-02-29'},{endDate:'2024-02-28'},{nextReviewDate:'0000-01-01'},{startDate:'2024-04-31'},{startDate:'2024-1-01'},{status:'EXPIRED'},{agreementReference:'x'.repeat(201)},{expectedVersion:2147483647},{branchId:randomUUID()}])await assert.rejects(f.save(f.request(extra)));
 const maximum=f.request({description:'😀'.repeat(16384),serviceLabel:'  Exact serviceLabel  ',reason:'  Exact reason  '});const savedMaximum=await f.save(maximum);assert.equal(savedMaximum.result.serviceLabel,maximum.serviceLabel);assert.equal(savedMaximum.result.reason,maximum.reason);
 await assert.rejects(db.$transaction(tx=>f.save(f.request({subscriptionId:randomUUID()}),'COMMITTED',tx),{isolationLevel:'RepeatableRead'}));
 await db.accessScope.update({where:{id:f.scope.id},data:{type:'BRANCH',companyId:f.base.companyId,branchId:f.branch.id}});
 await assert.rejects(f.save(f.request({subscriptionId:randomUUID()})));
 const branchCustomer=await db.customer.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,branchId:f.branch.id,code:'B',displayName:'Branch source',createdBy:f.base.expectedActorId}});
 await assert.rejects(f.save(f.request({subscriptionId:randomUUID(),branchId:f.branch.id})));
 const branchRequest=f.request({subscriptionId:randomUUID(),branchId:f.branch.id,customerId:branchCustomer.id});await f.save(branchRequest);
 await assert.rejects(f.save({...branchRequest,requestId:randomUUID(),branchId:null,action:'edit',expectedVersion:1}));
 const sibling=await db.branch.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,name:'Sibling',code:'S'}});await assert.rejects(f.save(f.request({subscriptionId:randomUUID(),branchId:sibling.id})));
 await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.base.tenantId,roleId:f.role.id,permissionKey:'subscription:read'}}});await assert.rejects(f.save(f.request({subscriptionId:randomUUID(),branchId:f.branch.id})));
 await assert.rejects(f.save(f.request({subscriptionId:randomUUID(),branchId:f.branch.id}),'ABANDONED'));
});
test('subscription SQL exposes neither tables nor functions to browser/default roles',async()=>{
 for(const table of ['ManualSubscription','ManualSubscriptionRevision','ManualSubscriptionRequest']){
  const [row]=await db.$queryRawUnsafe(`SELECT relrowsecurity, relacl::text FROM pg_class WHERE oid='"${table}"'::regclass`);assert.equal(row.relrowsecurity,true);
  const publicAcl=await db.$queryRawUnsafe(`SELECT privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='"${table}"'::regclass AND a.grantee=0`);assert.equal(publicAcl.length,0);
  for(const role of ['anon','authenticated']){const exists=await db.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname='${role}'`);if(exists.length){const [access]=await db.$queryRawUnsafe(`SELECT has_table_privilege('${role}','"${table}"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS yes`);assert.equal(access.yes,false);}}
 }
 for(const fn of ['erp_guard_manual_subscription_projection','erp_apply_manual_subscription_request','erp_audit_manual_subscription_request','erp_guard_manual_subscription_audit','erp_guard_manual_subscription_truncate','erp_guard_manual_subscription_customer']){
  const [row]=await db.$queryRawUnsafe(`SELECT prosecdef FROM pg_proc WHERE oid='${fn}()'::regprocedure`);assert.equal(row.prosecdef,false);
  const acl=await db.$queryRawUnsafe(`SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='${fn}()'::regprocedure AND a.grantee=0`);assert.equal(acl.length,0);
  for(const role of ['anon','authenticated']){const exists=await db.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname='${role}'`);if(exists.length){const [access]=await db.$queryRawUnsafe(`SELECT has_function_privilege('${role}','${fn}()','EXECUTE') AS yes`);assert.equal(access.yes,false);}}
 }
});

test('subscription SQL rejects TRUNCATE and CASCADE paths without deleting durable data or audits',async()=>{
 const f=await fixture(),p=f.request();const saved=await f.save(p);
 for(const table of ['ManualSubscription','ManualSubscriptionRevision','ManualSubscriptionRequest','AuditLog']){
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE TABLE "${table}"`));
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`));
 }
 await assert.rejects(db.$executeRawUnsafe('TRUNCATE TABLE "ManualSubscription", "ManualSubscriptionRevision", "ManualSubscriptionRequest", "AuditLog" CASCADE'));
 assert.equal((await f.current()).version,1);
 assert.equal(await db.manualSubscriptionRevision.count({where:{id:saved.result.id}}),1);
 assert.equal(await db.manualSubscriptionRequest.count({where:{id:p.requestId}}),1);
 assert.equal(await db.auditLog.count({where:{entity:'ManualSubscriptionRequest',entityId:p.requestId}}),1);
});

test('subscription SQL preserves source identity, archived history and original label snapshots',async()=>{
 const f=await fixture(),p=f.request();const saved=await f.save(p);
 assert.equal(saved.result.customerName,f.customer.displayName);assert.equal(saved.result.customerCode,f.customer.code);assert.equal(saved.result.customerId,f.customer.id);assert.equal(saved.result.reference,'SUB-'+p.subscriptionId);
 for(const data of [{branchId:f.branch.id},{companyId:randomUUID()},{tenantId:randomUUID()}])await assert.rejects(db.customer.update({where:{id:f.customer.id},data}));
 await assert.rejects(db.customer.delete({where:{id:f.customer.id}}));
 await db.customer.update({where:{id:f.customer.id},data:{displayName:'Renamed source',archivedAt:new Date()}});
 const next=await f.save(f.request({action:'edit',expectedVersion:1,description:'Corrected historical record',startDate:null,endDate:null,nextReviewDate:null}));
 assert.equal(next.result.customerName,f.customer.displayName);assert.equal(next.result.startDate,null);assert.equal(next.result.endDate,null);assert.equal(next.result.nextReviewDate,null);
 await assert.rejects(f.save(f.request({subscriptionId:randomUUID()})));
 const sourceSnapshot=(await db.manualSubscriptionRevision.findUniqueOrThrow({where:{id:saved.result.id}}));assert.equal(sourceSnapshot.customerName,f.customer.displayName);
 const g=await fixture(),abandoned=g.request();await g.save(abandoned,'ABANDONED');
 await assert.rejects(db.customer.update({where:{id:g.customer.id},data:{branchId:g.branch.id}}));
 await assert.rejects(db.customer.delete({where:{id:g.customer.id}}));
});

test('subscription SQL requires intersection at actual customer scope and blocks cross-company/tenant source',async()=>{
 const f=await fixture(),g=await fixture();
 await assert.rejects(f.save(f.request({customerId:g.customer.id})));
 const company=await db.company.create({data:{tenantId:f.base.tenantId,name:'Other company',code:'OTHER'}});
 const other=await db.customer.create({data:{tenantId:f.base.tenantId,companyId:company.id,displayName:'Other company source',code:'O',createdBy:f.base.expectedActorId}});
 await assert.rejects(f.save(f.request({customerId:other.id})));
 const branchCustomer=await db.customer.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,branchId:f.branch.id,displayName:'Branch source',code:'B',createdBy:f.base.expectedActorId}});
 await assert.rejects(f.save(f.request({customerId:branchCustomer.id})));
 const sibling=await db.branch.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,name:'Sibling',code:'S'}});
 await assert.rejects(f.save(f.request({customerId:branchCustomer.id,branchId:sibling.id})));
 await f.save(f.request({customerId:branchCustomer.id,branchId:f.branch.id}));
 await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.base.tenantId,roleId:f.role.id,permissionKey:'customer:read'}}});
 await assert.rejects(f.save(f.request({action:'edit',expectedVersion:1,customerId:branchCustomer.id,branchId:f.branch.id})));
 await assert.rejects(f.save(f.request({subscriptionId:randomUUID()}),'ABANDONED'));
});

test('subscription SQL enforces calendar dates, explicit null clearing and large literal Unicode payloads',async()=>{
 const f=await fixture();
 for(const extra of [{startDate:'1900-02-29'},{startDate:'2100-02-29'},{endDate:'2024-02-30'},{nextReviewDate:'2024-13-01'},{nextReviewDate:'2024-00-01'},{nextReviewDate:'2024-01-00'},{startDate:'infinity'},{startDate:'2024-01-01T00:00:00Z'},{startDate:42},{nextReviewDate:undefined},{startDate:'0000-01-01'}])await assert.rejects(f.save(f.request(extra)));
 const p=f.request({startDate:'2000-02-29',endDate:'9999-12-31',nextReviewDate:'0001-01-01',serviceLabel:'😀'.repeat(200),agreementReference:'😀'.repeat(200),description:'\u0001'.repeat(65536)});
 const r=await f.save(p);assert.equal(r.result.description,p.description);assert.equal(r.result.startDate,'2000-02-29');assert.equal(r.result.nextReviewDate,'0001-01-01');
 const corrected=await f.save(f.request({action:'edit',expectedVersion:1,startDate:null,endDate:null,nextReviewDate:null,description:'',agreementReference:''}));assert.equal(corrected.result.startDate,null);assert.equal(corrected.result.description,'');
});

test('subscription SQL writes do not mutate any preexisting financial, stock or customer table',async()=>{
 const f=await fixture();
 const tables=await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','AuditLog','ManualSubscription','ManualSubscriptionRevision','ManualSubscriptionRequest') ORDER BY tablename`;
 const snapshots=async()=>{
  const result={};for(const {tablename} of tables){const quoted='"'+tablename.replaceAll('"','""')+'"';const [row]=await db.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(v,',' ORDER BY v),'')) digest FROM (SELECT row_to_json(t)::text || ':' || t.xmin::text v FROM ${quoted} t WHERE to_jsonb(t)->>'tenantId'=$1 OR ($3='Tenant' AND to_jsonb(t)->>'id'=$1) OR ($3='User' AND to_jsonb(t)->>'id'=$2)) s`,f.base.tenantId,f.base.expectedActorId,tablename);result[tablename]=row.digest;}return result;
 };
 // Scope snapshots to this fixture; other database test files execute concurrently.
 const before=await snapshots();const p=f.request();await f.save(p);await f.save(f.request({action:'edit',expectedVersion:1,status:'PAUSED'}));
 const {serviceLabel,description,agreementReference,status,startDate,endDate,nextReviewDate,...archive}=f.request({action:'archive',expectedVersion:2});void serviceLabel;void description;void agreementReference;void status;void startDate;void endDate;void nextReviewDate;
 await f.save(archive);await f.save({...archive,requestId:randomUUID(),action:'restore',expectedVersion:3});await f.save(f.request({subscriptionId:randomUUID()}),'ABANDONED');
 assert.deepEqual(await snapshots(),before);
});

test('subscription SQL rechecks permissions after an observed tenant lock wait',async()=>{
 const f=await fixture();const blocker=new PrismaClient(),observer=new PrismaClient();
 let locked,release;const ready=new Promise(r=>locked=r),gate=new Promise(r=>release=r);
 const holding=blocker.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${f.base.tenantId}::uuid FOR UPDATE`;
  await tx.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.base.tenantId,roleId:f.role.id,permissionKey:'customer:read'}}});
  locked();await gate;
 },{timeout:15000});
 try{
  await ready;const pending=f.save(f.request());let settled=false;const handled=pending.then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  let observed=false;for(let i=0;i<100;i++){const rows=await observer.$queryRaw`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%ManualSubscriptionRequest%'`;if(rows.length){observed=true;break;}await new Promise(r=>setTimeout(r,20));}
  assert.equal(observed,true,'write actually waited for locked tenant');assert.equal(settled,false);release();await holding;const outcome=await handled;assert.ok(outcome.error);assert.equal(await db.manualSubscription.count({where:{id:f.base.subscriptionId}}),0);
 }finally{release();await holding.catch(()=>{});await blocker.$disconnect();await observer.$disconnect();}
});

test('subscription SQL atomically rolls back projection, revision, request and required audit',async()=>{
 const f=await fixture(),p=f.request();
 await assert.rejects(db.$transaction(async tx=>{await f.save(p,'COMMITTED',tx);throw new Error('rollback proof');}));
 assert.equal(await db.manualSubscription.count({where:{id:p.subscriptionId}}),0);assert.equal(await db.manualSubscriptionRevision.count({where:{subscriptionId:p.subscriptionId}}),0);assert.equal(await db.manualSubscriptionRequest.count({where:{id:p.requestId}}),0);assert.equal(await db.auditLog.count({where:{entity:'ManualSubscriptionRequest',entityId:p.requestId}}),0);
 const r=await f.save(p);assert.equal(r.result.version,1);
 for(const data of [{createdAt:new Date(0)},{updatedAt:new Date(0)},{customerId:randomUUID()},{customerBranchId:f.branch.id},{customerName:'Forged snapshot'},{reference:'SUB-forged'},{version:20}])await assert.rejects(db.manualSubscription.update({where:{id:p.subscriptionId},data}));
 for(const data of [{createdAt:new Date(0)},{createdBy:randomUUID()},{customerCode:'Forged code'},{version:20}])await assert.rejects(db.manualSubscriptionRevision.update({where:{id:r.result.id},data}));
 const explicitTimestamp=f.request({subscriptionId:randomUUID()});
 const timestamped=await db.manualSubscriptionRequest.create({data:{id:explicitTimestamp.requestId,tenantId:explicitTimestamp.tenantId,companyId:explicitTimestamp.companyId,branchId:explicitTimestamp.branchId,customerId:explicitTimestamp.customerId,subscriptionId:explicitTimestamp.subscriptionId,createdBy:explicitTimestamp.expectedActorId,action:explicitTimestamp.action,expectedVersion:explicitTimestamp.expectedVersion,request:explicitTimestamp,outcome:'COMMITTED',createdAt:new Date(0),result:{forged:true}}});
 assert.ok(timestamped.createdAt.getTime()>Date.UTC(2020,0,1));assert.equal(timestamped.result.forged,undefined);assert.equal(timestamped.result.subscriptionId,explicitTimestamp.subscriptionId);
});
