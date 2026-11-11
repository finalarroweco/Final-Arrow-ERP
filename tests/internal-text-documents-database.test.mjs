import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
test.after(()=>db.$disconnect());
async function fixture(){
 const tenant=await db.tenant.create({data:{name:'Internal text SQL QA',slug:'text-sql-'+randomUUID()}}),tenantId=tenant.id;
 const user=await db.user.create({data:{name:'Text operator',email:randomUUID()+'@example.invalid',passwordHash:'test-only-not-login'}}),createdBy=user.id;
 const member=await db.membership.create({data:{tenantId,userId:createdBy,status:'ACTIVE'}});
 const role=await db.role.create({data:{tenantId,name:'Text operator'}});
 for(const permissionKey of ['document:read','document:manage'])await db.rolePermission.create({data:{tenantId,roleId:role.id,permissionKey}});
 const grant=await db.roleGrant.create({data:{tenantId,membershipId:member.id,roleId:role.id}});
 const scope=await db.accessScope.create({data:{tenantId,grantId:grant.id,type:'TENANT'}});
 const company=await db.company.create({data:{tenantId,name:'Text SQL',code:'TXT'}}),companyId=company.id;
 const branch=await db.branch.create({data:{tenantId,companyId,name:'Branch',code:'B'}});
 const base={tenantId,companyId,branchId:null,expectedActorId:createdBy,documentId:randomUUID()};
 const request=(extra={})=>({...base,requestId:randomUUID(),action:'create',expectedVersion:0,title:'تعليمات التشغيل',body:'مرحبا\n<script>alert(1)</script>\nhttps://example.invalid',reason:'Explicit operating note',...extra});
 const save=(p,outcome='COMMITTED',client=db)=>client.internalTextDocumentRequest.create({data:{id:p.requestId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,documentId:p.documentId,createdBy:p.expectedActorId,action:p.action,expectedVersion:p.expectedVersion,request:p,outcome}});
 const current=()=>db.internalTextDocument.findUniqueOrThrow({where:{id:base.documentId}});
 return {base,request,save,current,role,member,scope,branch};
}
test('text SQL creates exact snapshots and immutable lifecycle with authoritative timestamps',async()=>{
 const f=await fixture(),p=f.request(),r=await f.save(p),e=r.result;
 assert.equal(e.title,p.title);assert.equal(e.body,p.body);assert.equal(e.version,1);assert.equal(e.archived,false);assert.notEqual(e.id,r.id);assert.notEqual(e.id,p.documentId);assert.match(e.createdAt,/Z$/);assert.equal((await f.current()).version,1);
 const edit=f.request({action:'edit',expectedVersion:1,title:'Second title',body:'Second\nكامل'}),r2=await f.save(edit);assert.equal(r2.result.version,2);
 const {title,body,...archive}=f.request({action:'archive',expectedVersion:2});void title;void body;
 const archived=await f.save(archive);assert.equal(archived.result.archived,true);assert.equal(archived.result.body,edit.body);
 await assert.rejects(f.save(f.request({action:'edit',expectedVersion:3})));
 await assert.rejects(f.save({...archive,requestId:randomUUID(),expectedVersion:3}));
 const restored=await f.save({...archive,requestId:randomUUID(),action:'restore',expectedVersion:3});assert.equal(restored.result.version,4);assert.equal(restored.result.archived,false);assert.equal(restored.result.body,edit.body);
 assert.equal((await db.internalTextDocumentEvent.findUniqueOrThrow({where:{id:e.id}})).body,p.body);
 assert.equal((await db.internalTextDocumentRequest.findUniqueOrThrow({where:{id:p.requestId}})).result.body,p.body);
 for(const operation of [()=>db.internalTextDocument.update({where:{id:p.documentId},data:{body:'forged'}}),()=>db.internalTextDocument.update({where:{id:p.documentId},data:{branchId:f.branch.id}}),()=>db.internalTextDocument.delete({where:{id:p.documentId}}),()=>db.internalTextDocumentEvent.update({where:{id:e.id},data:{reason:'forged'}}),()=>db.internalTextDocumentEvent.delete({where:{id:e.id}}),()=>db.internalTextDocumentRequest.update({where:{id:p.requestId},data:{outcome:'ABANDONED'}}),()=>db.internalTextDocumentRequest.delete({where:{id:p.requestId}})])await assert.rejects(operation());
 const audit=await db.auditLog.findFirstOrThrow({where:{entity:'InternalTextDocumentRequest',entityId:p.requestId}});
 assert.deepEqual(audit.metadata,{outcome:'COMMITTED'});
 await assert.rejects(db.auditLog.delete({where:{id:audit.id}}));await assert.rejects(db.auditLog.update({where:{id:audit.id},data:{entity:'Other'}}));
 await assert.rejects(db.auditLog.create({data:{tenantId:p.tenantId,actorId:p.expectedActorId,entity:'InternalTextDocumentRequest',entityId:p.requestId,action:'fake'}}));
});
test('text SQL serializes competing edits, lifecycle and request abandonment',async()=>{
 const f=await fixture();await f.save(f.request());
 const a=f.request({action:'edit',expectedVersion:1,title:'First'}),b=f.request({action:'edit',expectedVersion:1,title:'Second'});
 const edits=await Promise.allSettled([f.save(a),f.save(b)]);assert.equal(edits.filter(x=>x.status==='fulfilled').length,1);assert.equal((await f.current()).version,2);
 const {title,body,...archive}=f.request({action:'archive',expectedVersion:2});void title;void body;
 const changes=await Promise.allSettled([f.save(archive),f.save(f.request({action:'edit',expectedVersion:2}))]);assert.equal(changes.filter(x=>x.status==='fulfilled').length,1);assert.equal((await f.current()).version,3);
 const g=await fixture(),pending=g.request();const outcomes=await Promise.allSettled([g.save(pending),g.save(pending,'ABANDONED')]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(await db.internalTextDocumentRequest.count({where:{id:pending.requestId}}),1);
 const h=await fixture(),cancel=h.request();const tombstone=await h.save(cancel,'ABANDONED');assert.equal(tombstone.result,null);await assert.rejects(h.save(cancel));await assert.rejects(h.save({...cancel,body:'Changed'}));assert.equal(await db.internalTextDocument.count({where:{id:cancel.documentId}}),0);
});
test('text SQL validates exact payload, scope, permissions, bytes and isolation',async()=>{
 const f=await fixture();
 for(const extra of [{unknown:'field'},{expectedActorId:randomUUID()},{title:' '},{title:'x'.repeat(201)},{body:'😀'.repeat(16385)},{reason:'\nforged'},{action:'edit',expectedVersion:0},{title:12},{body:null},{body:''},{expectedVersion:2147483647},{branchId:randomUUID()}])await assert.rejects(f.save(f.request(extra)));
 const maximum=f.request({body:'😀'.repeat(16384),title:'  Exact title  ',reason:'  Exact reason  '});const savedMaximum=await f.save(maximum);assert.equal(savedMaximum.result.title,maximum.title);assert.equal(savedMaximum.result.reason,maximum.reason);
 await assert.rejects(db.$transaction(tx=>f.save(f.request({documentId:randomUUID()}),'COMMITTED',tx),{isolationLevel:'RepeatableRead'}));
 await db.accessScope.update({where:{id:f.scope.id},data:{type:'BRANCH',companyId:f.base.companyId,branchId:f.branch.id}});
 await assert.rejects(f.save(f.request({documentId:randomUUID()})));
 const branchRequest=f.request({documentId:randomUUID(),branchId:f.branch.id});await f.save(branchRequest);
 await assert.rejects(f.save({...branchRequest,requestId:randomUUID(),branchId:null,action:'edit',expectedVersion:1}));
 const sibling=await db.branch.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,name:'Sibling',code:'S'}});await assert.rejects(f.save(f.request({documentId:randomUUID(),branchId:sibling.id})));
 await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.base.tenantId,roleId:f.role.id,permissionKey:'document:read'}}});await assert.rejects(f.save(f.request({documentId:randomUUID(),branchId:f.branch.id})));
 await assert.rejects(f.save(f.request({documentId:randomUUID(),branchId:f.branch.id}),'ABANDONED'));
});
test('text SQL exposes neither tables nor functions to browser/default roles',async()=>{
 for(const table of ['InternalTextDocument','InternalTextDocumentEvent','InternalTextDocumentRequest']){
  const [row]=await db.$queryRawUnsafe(`SELECT relrowsecurity, relacl::text FROM pg_class WHERE oid='"${table}"'::regclass`);assert.equal(row.relrowsecurity,true);
  const publicAcl=await db.$queryRawUnsafe(`SELECT privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='"${table}"'::regclass AND a.grantee=0`);assert.equal(publicAcl.length,0);
  for(const role of ['anon','authenticated']){const exists=await db.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname='${role}'`);if(exists.length){const [access]=await db.$queryRawUnsafe(`SELECT has_table_privilege('${role}','"${table}"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS yes`);assert.equal(access.yes,false);}}
 }
 for(const fn of ['erp_guard_internal_text_projection','erp_apply_internal_text_request','erp_audit_internal_text_request','erp_guard_internal_text_audit','erp_guard_internal_text_truncate']){
  const [row]=await db.$queryRawUnsafe(`SELECT prosecdef FROM pg_proc WHERE oid='${fn}()'::regprocedure`);assert.equal(row.prosecdef,false);
  const acl=await db.$queryRawUnsafe(`SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='${fn}()'::regprocedure AND a.grantee=0`);assert.equal(acl.length,0);
  for(const role of ['anon','authenticated']){const exists=await db.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname='${role}'`);if(exists.length){const [access]=await db.$queryRawUnsafe(`SELECT has_function_privilege('${role}','${fn}()','EXECUTE') AS yes`);assert.equal(access.yes,false);}}
 }
});

test('text SQL rejects TRUNCATE and CASCADE paths without deleting durable data or audits',async()=>{
 const f=await fixture(),p=f.request();const saved=await f.save(p);
 for(const table of ['InternalTextDocument','InternalTextDocumentEvent','InternalTextDocumentRequest','AuditLog']){
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE TABLE "${table}"`));
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`));
 }
 await assert.rejects(db.$executeRawUnsafe('TRUNCATE TABLE "InternalTextDocument", "InternalTextDocumentEvent", "InternalTextDocumentRequest", "AuditLog" CASCADE'));
 assert.equal((await f.current()).version,1);
 assert.equal(await db.internalTextDocumentEvent.count({where:{id:saved.result.id}}),1);
 assert.equal(await db.internalTextDocumentRequest.count({where:{id:p.requestId}}),1);
 assert.equal(await db.auditLog.count({where:{entity:'InternalTextDocumentRequest',entityId:p.requestId}}),1);
});
