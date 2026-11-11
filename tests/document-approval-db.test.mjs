import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();test.after(()=>db.$disconnect());
async function fixture(resource='DOCUMENT'){
 const t=await db.tenant.create({data:{name:'Approvals DB QA',slug:randomUUID()}}),tenantId=t.id;
 const co=await db.company.create({data:{tenantId,name:'Approval company',code:'AP'}}),companyId=co.id;
 const branch=await db.branch.create({data:{tenantId,companyId,name:'Branch',code:'B'}}),branchId=branch.id;
 const keys=['document:read','document:manage','document:approve'];
 const role=await db.role.create({data:{tenantId,name:'Owner'}});for(const permissionKey of keys)await db.rolePermission.create({data:{tenantId,roleId:role.id,permissionKey}});
 const users=[];for(let i=0;i<3;i++){const u=await db.user.create({data:{name:'Approver '+i,email:randomUUID()+'@example.invalid',passwordHash:'test-only'}});const m=await db.membership.create({data:{tenantId,userId:u.id,status:'ACTIVE'}});const g=await db.roleGrant.create({data:{tenantId,membershipId:m.id,roleId:role.id}});await db.accessScope.create({data:{tenantId,grantId:g.id,type:'TENANT'}});users.push({...u,memberId:m.id,grantId:g.id});}
 const actor=users[0],base={tenantId,companyId,branchId};
 const documentId=randomUUID();
 const edit=async(action='edit',expectedVersion=1,extra={},client=db)=>{
 const request={...base,expectedActorId:actor.id,documentId,requestId:randomUUID(),action,expectedVersion,reason:'Explicit revision',...(['create','edit'].includes(action)?{title:'إجراء داخلي',body:'مرحبا\n<script>literal</script> 😀'}:{}),...extra};
 return (await client.internalTextDocumentRequest.create({data:{id:request.requestId,tenantId,companyId,branchId,documentId,createdBy:request.expectedActorId,action:request.action,expectedVersion:request.expectedVersion,request,outcome:'COMMITTED'}})).result;
 };
 const source=await edit('create',0);
 const configuration={title:'Two step approval',enabled:true,resource,currency:null,minimumAmount:null,maximumAmount:null,excludeRequester:true,stages:[{name:'Review',quorum:1,userIds:[users[1].id],roleIds:[]},{name:'Final',quorum:1,userIds:[users[2].id],roleIds:[]}]};
 const policyCommand=(extra={})=>({...base,requestId:randomUUID(),expectedActorId:actor.id,policyId:randomUUID(),expectedVersion:0,configuration,...extra});
 const save=async(c,outcome='COMMITTED',client=db)=>{const rows=await client.$queryRawUnsafe('INSERT INTO "ApprovalCommand"(id,"tenantId","companyId","branchId","actorId",command,outcome) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::jsonb,$7) RETURNING result',c.requestId,c.tenantId,c.companyId,c.branchId,c.expectedActorId,JSON.stringify(c),outcome);return rows[0].result;};
 const snapshot=async()=>{const rows=await db.$queryRawUnsafe('SELECT md5(erp_approval_snapshot($1::uuid,$2,$3::uuid)::text) fingerprint',tenantId,resource,source.id);return rows[0].fingerprint;};
 const submit=async(p)=>({...base,requestId:randomUUID(),expectedActorId:actor.id,resource,sourceId:source.id,policyId:p.policyId,policyVersion:p.expectedVersion+1,sourceFingerprint:await snapshot()});
 const vote=(q,user=users[1],extra={})=>({...base,requestId:randomUUID(),expectedActorId:user.id,approvalId:q.id,expectedVersion:q.version,action:'APPROVE',reason:'',...extra});
 const configured=async()=>{const p=policyCommand();await save(p);return p;};
 const pending=async()=>{const p=await configured(),c=await submit(p),receipt=await save(c);return {p,c,q:receipt.approval};};
 return {base,users,actor,role,edit,documentId,source,resource,configuration,policyCommand,save,snapshot,submit,vote,configured,pending};
}
test('document exact revision approval never changes text or grants publication and is never inherited',async()=>{
 const f=await fixture(),before=await db.internalTextDocument.findUniqueOrThrow({where:{id:f.documentId}}),{q,p}=await f.pending();
 let a=(await f.save(f.vote(q))).approval;a=(await f.save(f.vote(a,f.users[2]))).approval;assert.equal(a.status,'APPROVED');assert.deepEqual(await db.internalTextDocument.findUniqueOrThrow({where:{id:f.documentId}}),before);
 assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalFinalizationPermit" WHERE "approvalId"=$1::uuid',q.id))[0].n,0);
 assert.equal((await db.$queryRawUnsafe('SELECT "eventId" FROM "DocumentApprovalSource" WHERE "approvalId"=$1::uuid',q.id))[0].eventId,f.source.id);
 await assert.rejects(f.save(await f.submit(p)),'approved revision cannot be enrolled again');
 const next=await f.edit();assert.equal(next.version,2);assert.notEqual(next.id,f.source.id);assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalRequest" WHERE "sourceId"=$1::uuid',next.id))[0].n,0);assert.equal((await db.$queryRawUnsafe('SELECT status FROM "ApprovalRequest" WHERE id=$1::uuid',q.id))[0].status,'APPROVED');
 await assert.rejects(db.$executeRawUnsafe('UPDATE "DocumentApprovalSource" SET "eventId"=$1::uuid WHERE "approvalId"=$2::uuid',next.id,q.id));await assert.rejects(db.$executeRawUnsafe('DELETE FROM "DocumentApprovalSource" WHERE "approvalId"=$1::uuid',q.id));await assert.rejects(db.$executeRawUnsafe('TRUNCATE "DocumentApprovalSource" CASCADE'));
});
test('editing, archive and restore retain immutable pending decisions but make old revisions ineligible',async()=>{
 for(const action of ['edit','archive']){const f=await fixture(),{q,p}=await f.pending();const voted=(await f.save(f.vote(q))).approval;await f.edit(action);await assert.rejects(f.save(f.vote(voted,f.users[2])));await assert.rejects(f.save(await f.submit(p)));assert.equal((await f.save(f.vote(voted,f.actor,{action:'CANCEL',reason:'Superseded revision'}))).approval.status,'CANCELLED');if(action==='archive'){await f.edit('restore',2);await assert.rejects(f.save(await f.submit(p)));}}
});
test('document policy has no monetary predicates; exact scope, current read and reviewer eligibility are independent',async()=>{
 const f=await fixture();for(const fields of [{currency:'USD'},{minimumAmount:'0.000'},{maximumAmount:'10.000',currency:'OMR'}])await assert.rejects(f.save(f.policyCommand({configuration:{...f.configuration,...fields}})));
 const {q}=await f.pending();await assert.rejects(f.save(f.vote(q,f.actor)));await assert.rejects(f.save({...f.vote(q),branchId:null}));
 const v=(await f.save(f.vote(q))).approval;await db.membership.update({where:{id:f.users[1].memberId},data:{status:'SUSPENDED'}});await assert.rejects(f.save(f.vote(v,f.users[2])));await db.membership.update({where:{id:f.users[1].memberId},data:{status:'ACTIVE'}});
 await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.base.tenantId,roleId:f.role.id,permissionKey:'document:read'}}});await assert.rejects(f.save(f.vote(v,f.users[2])));await assert.rejects(f.save(f.vote(v,f.actor,{action:'CANCEL',reason:'Owner is not source access'})));
});
test('document policy changes, abandonment, distinct quorum votes, revision author exclusion and late rollback',async()=>{
 const f=await fixture(),p=f.policyCommand({configuration:{...f.configuration,stages:[{name:'Quorum',quorum:2,userIds:[f.users[1].id,f.users[2].id],roleIds:[]}]}});await f.save(p);let q=(await f.save(await f.submit(p))).approval;
 const race=await Promise.allSettled([f.save(f.vote(q)),f.save(f.vote(q,f.users[2]))]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);const first=race.find(x=>x.status==='fulfilled').value;q=first.approval;const other=first.decision.actorId===f.users[1].id?f.users[2]:f.users[1];
 const c=f.vote(q,other);await f.save(c,'ABANDONED');await assert.rejects(f.save(c));
 await db.$executeRawUnsafe(`CREATE FUNCTION document_test_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${f.base.tenantId}'::uuid AND NEW.entity='ApprovalCommand' THEN RAISE EXCEPTION 'late test failure'; END IF;RETURN NEW;END $$`);await db.$executeRawUnsafe('CREATE TRIGGER document_test_late_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION document_test_late_failure()');
 const final=f.vote(q,other);try{await assert.rejects(f.save(final));assert.equal((await db.$queryRawUnsafe('SELECT status FROM "ApprovalRequest" WHERE id=$1::uuid',q.id))[0].status,'PENDING');assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalDecision" WHERE id=$1::uuid',final.requestId))[0].n,0);}finally{await db.$executeRawUnsafe('DROP TRIGGER document_test_late_failure ON "AuditLog"');await db.$executeRawUnsafe('DROP FUNCTION document_test_late_failure()');}
 await f.save(f.policyCommand({policyId:p.policyId,expectedVersion:1,configuration:{...p.configuration,enabled:false}}));await assert.rejects(f.save(final));await f.save(f.vote(q,f.actor,{action:'CANCEL',reason:'Policy paused'}));
 const g=await fixture(),rev=await g.edit('edit',1,{expectedActorId:g.users[1].id});g.source.id=rev.id;const pending=await g.pending();await assert.rejects(g.save(g.vote(pending.q)),'revision author cannot self review');
});
test('document source ACL is closed under provider defaults and vanilla; review/edit races serialize',async()=>{
 assert.equal((await db.$queryRawUnsafe("SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_name='DocumentApprovalSource' AND grantee IN('PUBLIC','anon','authenticated')"))[0].n,0);
 assert.equal((await db.$queryRawUnsafe("SELECT relrowsecurity FROM pg_class WHERE oid='\"DocumentApprovalSource\"'::regclass"))[0].relrowsecurity,true);
 const f=await fixture(),{q}=await f.pending(),a=(await f.save(f.vote(q))).approval;
 const race=await Promise.allSettled([f.save(f.vote(a,f.users[2])),f.edit('archive')]);assert.equal(race[1].status,'fulfilled');const status=(await db.$queryRawUnsafe('SELECT status FROM "ApprovalRequest" WHERE id=$1::uuid',q.id))[0].status;assert.ok(['APPROVED','PENDING'].includes(status));assert.equal((await db.internalTextDocument.findUniqueOrThrow({where:{id:f.documentId}})).archived,true);
});
test('document scoped roles do not confer source rights and policy exclusions are explicit',async()=>{
 const f=await fixture(),role=await db.role.create({data:{tenantId:f.base.tenantId,name:'Document reviewers'}}),other=await db.branch.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,name:'Other',code:'OTHER'}});
 const grant=await db.roleGrant.create({data:{tenantId:f.base.tenantId,membershipId:f.users[1].memberId,roleId:role.id}}),scoped=await db.accessScope.create({data:{tenantId:f.base.tenantId,grantId:grant.id,type:'BRANCH',companyId:f.base.companyId,branchId:other.id}});
 const p=f.policyCommand({configuration:{...f.configuration,stages:[{name:'Scoped role',quorum:1,userIds:[],roleIds:[role.id]}]}});await f.save(p);const q=(await f.save(await f.submit(p))).approval;await assert.rejects(f.save(f.vote(q)));await db.accessScope.update({where:{id:scoped.id},data:{branchId:f.base.branchId}});assert.equal((await f.save(f.vote(q))).approval.status,'APPROVED');
 const g=await fixture(),gp=g.policyCommand({configuration:{...g.configuration,excludeRequester:false,stages:[{name:'Explicit self review allowed',quorum:1,userIds:[g.actor.id],roleIds:[]}]}});await g.save(gp);const gq=(await g.save(await g.submit(gp))).approval;assert.equal((await g.save(g.vote(gq,g.actor))).approval.status,'APPROVED');
});
