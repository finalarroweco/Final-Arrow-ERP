import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();test.after(()=>db.$disconnect());
async function fixture(resource='PURCHASE'){
 const t=await db.tenant.create({data:{name:'Approvals DB QA',slug:randomUUID()}}),tenantId=t.id;
 const co=await db.company.create({data:{tenantId,name:'Approval company',code:'AP'}}),companyId=co.id;
 const branch=await db.branch.create({data:{tenantId,companyId,name:'Branch',code:'B'}}),branchId=branch.id;
 const keys=['purchase-order:read','purchase-order:manage','expense:read','expense:post','leave:read','leave:decide'];
 const role=await db.role.create({data:{tenantId,name:'Owner'}});for(const permissionKey of keys)await db.rolePermission.create({data:{tenantId,roleId:role.id,permissionKey}});
 const users=[];for(let i=0;i<3;i++){const u=await db.user.create({data:{name:'Approver '+i,email:randomUUID()+'@example.invalid',passwordHash:'test-only'}});const m=await db.membership.create({data:{tenantId,userId:u.id,status:'ACTIVE'}});const g=await db.roleGrant.create({data:{tenantId,membershipId:m.id,roleId:role.id}});await db.accessScope.create({data:{tenantId,grantId:g.id,type:'TENANT'}});users.push({...u,memberId:m.id,grantId:g.id});}
 const actor=users[0],base={tenantId,companyId,branchId};
 const supplier=await db.supplier.create({data:{tenantId,companyId,code:'S',displayName:'Legacy\nSupplier',createdBy:actor.id}});
 let source;if(resource==='PURCHASE')source=await db.purchaseOrder.create({data:{...base,supplierId:supplier.id,number:'PO1',supplierName:supplier.displayName,currency:'OMR',subtotal:'100.001',createdBy:actor.id,lines:{create:{position:0,description:'Legacy\nLine',quantity:1,unitPrice:'100.001',amount:'100.001'}}}});
 else if(resource==='EXPENSE')source=await db.expense.create({data:{...base,number:'EX1',description:'Travel',category:'Travel',amount:'100.001',currency:'OMR',expenseDate:new Date(),createdBy:actor.id}});
 else {const employee=await db.employee.create({data:{...base,code:'EMP',fullName:'Private employee',createdBy:actor.id}});source=await db.leaveRequest.create({data:{...base,employeeId:employee.id,type:'ANNUAL',startDate:new Date('2030-01-01'),endDate:new Date('2030-01-03'),createdBy:actor.id}});}
 const configuration={title:'Two step approval',enabled:true,resource,currency:null,minimumAmount:null,maximumAmount:null,excludeRequester:true,stages:[{name:'Review',quorum:1,userIds:[users[1].id],roleIds:[]},{name:'Final',quorum:1,userIds:[users[2].id],roleIds:[]}]};
 const policyCommand=(extra={})=>({...base,requestId:randomUUID(),expectedActorId:actor.id,policyId:randomUUID(),expectedVersion:0,configuration,...extra});
 const save=async(c,outcome='COMMITTED',client=db)=>{const rows=await client.$queryRawUnsafe('INSERT INTO "ApprovalCommand"(id,"tenantId","companyId","branchId","actorId",command,outcome) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::jsonb,$7) RETURNING result',c.requestId,c.tenantId,c.companyId,c.branchId,c.expectedActorId,JSON.stringify(c),outcome);return rows[0].result;};
 const snapshot=async()=>{const rows=await db.$queryRawUnsafe('SELECT md5(erp_approval_snapshot($1::uuid,$2,$3::uuid)::text) fingerprint',tenantId,resource,source.id);return rows[0].fingerprint;};
 const submit=async(p)=>({...base,requestId:randomUUID(),expectedActorId:actor.id,resource,sourceId:source.id,policyId:p.policyId,policyVersion:p.expectedVersion+1,sourceFingerprint:await snapshot()});
 const vote=(q,user=users[1],extra={})=>({...base,requestId:randomUUID(),expectedActorId:user.id,approvalId:q.id,expectedVersion:q.version,action:'APPROVE',reason:'',...extra});
 const configured=async()=>{const p=policyCommand();await save(p);return p;};
 const pending=async()=>{const p=await configured(),c=await submit(p),receipt=await save(c);return {p,c,q:receipt.approval};};
 return {base,users,actor,role,supplier,source,resource,configuration,policyCommand,save,snapshot,submit,vote,configured,pending};
}
test('approval SQL retains no-policy transitions and all three source workflows atomically',async()=>{
 for(const resource of ['PURCHASE','EXPENSE','LEAVE']){const f=await fixture(resource),{q}=await f.pending();let r=await f.save(f.vote(q));assert.equal(r.approval.stage,1);assert.equal(r.approval.status,'PENDING');r=await f.save(f.vote(r.approval,f.users[2]));assert.equal(r.approval.status,'APPROVED');const table={PURCHASE:'PurchaseOrder',EXPENSE:'Expense',LEAVE:'LeaveRequest'}[resource];const rows=await db.$queryRawUnsafe(`SELECT status FROM "${table}" WHERE id=$1::uuid`,f.source.id);assert.equal(rows[0].status,{PURCHASE:'ISSUED',EXPENSE:'POSTED',LEAVE:'APPROVED'}[resource]);assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalFinalizationPermit" WHERE "approvalId"=$1::uuid',q.id))[0].n,1);}
 const legacy=await fixture();await db.purchaseOrder.update({where:{id:legacy.source.id},data:{status:'ISSUED',issuedAt:new Date()}});
});
test('approval SQL prevents direct source/projection/history bypass and edits while pending',async()=>{
 const f=await fixture();const p=await f.configured();await assert.rejects(db.purchaseOrder.update({where:{id:f.source.id},data:{status:'ISSUED',issuedAt:new Date()}}));const c=await f.submit(p),r=await f.save(c),q=r.approval;
 await assert.rejects(db.purchaseOrder.update({where:{id:f.source.id},data:{notes:'Changed'}}));await assert.rejects(db.purchaseOrderLine.updateMany({where:{orderId:f.source.id},data:{description:'Changed'}}));await assert.rejects(db.$executeRawUnsafe('UPDATE "ApprovalRequest" SET status=\'APPROVED\' WHERE id=$1::uuid',q.id));await assert.rejects(db.$executeRawUnsafe('DELETE FROM "ApprovalCommand" WHERE id=$1::uuid',c.requestId));await assert.rejects(db.$executeRawUnsafe('DELETE FROM "AuditLog" WHERE id=$1::uuid',c.requestId));
 const canceled=await f.save(f.vote(q,f.actor,{action:'CANCEL',reason:'Source needs revision'}));assert.equal(canceled.approval.status,'CANCELLED');await db.purchaseOrder.update({where:{id:f.source.id},data:{notes:'Changed'}});const fresh=await f.save(await f.submit(p));assert.equal(fresh.approval.status,'PENDING');
});
test('approval SQL checks current eligibility, creator exclusion, policy revisions and stale previews',async()=>{
 const f=await fixture(),{p,q}=await f.pending();await assert.rejects(f.save(f.vote(q,f.actor)));let r=await f.save(f.vote(q));await db.membership.update({where:{id:f.users[1].memberId},data:{status:'SUSPENDED'}});await assert.rejects(f.save(f.vote(r.approval,f.users[2])));assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalDecision" WHERE "approvalId"=$1::uuid',q.id))[0].n,1);
 await db.membership.update({where:{id:f.users[1].memberId},data:{status:'ACTIVE'}});await f.save(f.policyCommand({policyId:p.policyId,expectedVersion:1,configuration:{...f.configuration,enabled:false}}));await assert.rejects(f.save(f.vote(r.approval,f.users[2])));await f.save(f.vote(r.approval,f.actor,{action:'CANCEL',reason:'Paused policy'}));
 const g=await fixture(),gp=await g.configured(),sc=await g.submit(gp);await db.purchaseOrder.update({where:{id:g.source.id},data:{notes:'Change after preview'}});await assert.rejects(g.save(sc));
});
test('approval SQL currency thresholds and scope overlap are explicit',async()=>{
 const f=await fixture();const p=f.policyCommand({configuration:{...f.configuration,currency:'USD',minimumAmount:'0.000'}});await f.save(p);await assert.rejects(f.save(await f.submit(p)));const good=f.policyCommand({configuration:{...f.configuration,currency:'OMR',minimumAmount:'100.001',maximumAmount:'100.001'}});await f.save(good);await assert.rejects(f.save(f.policyCommand({configuration:{...f.configuration,currency:'OMR',minimumAmount:'99.000'}})));await f.save(await f.submit(good));
});
test('approval SQL serializes simultaneous votes, actor identity collisions and abandonment',async()=>{
 const f=await fixture(),{q}=await f.pending();const c=f.vote(q),race=await Promise.allSettled([f.save(c),f.save(c)]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);await assert.rejects(f.save({...c,expectedActorId:f.users[2].id}));
 const r=race.find(x=>x.status==='fulfilled').value.approval;const next=f.vote(r,f.users[2]);const abandon=await f.save(next,'ABANDONED');assert.equal(abandon.outcome,'ABANDONED');assert.equal(abandon.approval,undefined);await assert.rejects(f.save(next));const final=await f.save(f.vote(r,f.users[2]));assert.equal(final.approval.status,'APPROVED');
});
test('approval SQL scopes, malformed configs, archival, ACL and immutable audit checks',async()=>{
 const f=await fixture();for(const configuration of [{...f.configuration,enabled:null},{...f.configuration,stages:[]},{...f.configuration,unexpected:1},{...f.configuration,stages:[{name:'Missing',quorum:null,userIds:[f.users[1].id],roleIds:[]}]}])await assert.rejects(f.save(f.policyCommand({configuration})));
 const p=await f.configured();await db.supplier.update({where:{id:f.supplier.id},data:{archivedAt:new Date()}});await assert.rejects(f.save(await f.submit(p)));
 for(const table of ['ApprovalPolicy','ApprovalPolicyRevision','ApprovalCommand','ApprovalRequest','ApprovalDecision','ApprovalFinalizationPermit']){assert.equal((await db.$queryRawUnsafe('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',`"${table}"`))[0].relrowsecurity,true);await assert.rejects(db.$executeRawUnsafe(`TRUNCATE "${table}" CASCADE`));assert.equal((await db.$queryRawUnsafe("SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_name=$1 AND grantee IN('PUBLIC','anon','authenticated')",table))[0].n,0);}
});
test('approval SQL scopes role eligibility independently from action permissions and checks request identity',async()=>{
 const f=await fixture(),eligibleRole=await db.role.create({data:{tenantId:f.base.tenantId,name:'Eligible only'}}),other=await db.branch.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,name:'Other',code:'C'}});
 const member=f.users[1],grant=await db.roleGrant.create({data:{tenantId:f.base.tenantId,membershipId:member.memberId,roleId:eligibleRole.id}});
 const scope=await db.accessScope.create({data:{tenantId:f.base.tenantId,grantId:grant.id,type:'BRANCH',companyId:f.base.companyId,branchId:other.id}});
 const p=f.policyCommand({configuration:{...f.configuration,stages:[{name:'Named role',quorum:1,userIds:[],roleIds:[eligibleRole.id]}]}});await f.save(p);const q=(await f.save(await f.submit(p))).approval;
 await assert.rejects(f.save(f.vote(q)));await assert.rejects(f.save({...f.vote(q),branchId:other.id}));await assert.rejects(f.save({...f.vote(q),expectedActorId:randomUUID()}));
 await db.accessScope.update({where:{id:scope.id},data:{branchId:f.base.branchId}});assert.equal((await f.save(f.vote(q))).approval.status,'APPROVED');
});
test('approval SQL distinct concurrent quorum voters require fresh version and never double finalize',async()=>{
 const f=await fixture(),p=f.policyCommand({configuration:{...f.configuration,stages:[{name:'Quorum',quorum:2,userIds:[f.users[1].id,f.users[2].id],roleIds:[]}]}});await f.save(p);const q=(await f.save(await f.submit(p))).approval;
 const race=await Promise.allSettled([f.save(f.vote(q)),f.save(f.vote(q,f.users[2]))]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);const r=race.find(x=>x.status==='fulfilled').value;assert.equal(r.approval.status,'PENDING');const other=r.decision.actorId===f.users[1].id?f.users[2]:f.users[1];const final=await f.save(f.vote(r.approval,other));assert.equal(final.approval.status,'APPROVED');assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalFinalizationPermit" WHERE "approvalId"=$1::uuid AND consumed',q.id))[0].n,1);await assert.rejects(f.save(f.vote(final.approval,other)));
});
test('approval SQL late source-audit failure rolls back final vote, source, request, permit and command',async()=>{
 const f=await fixture(),{q}=await f.pending(),r=(await f.save(f.vote(q))).approval,c=f.vote(r,f.users[2]);
 await db.$executeRawUnsafe(`CREATE FUNCTION approval_test_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${f.base.tenantId}'::uuid AND NEW.action='purchase-order.issued' THEN RAISE EXCEPTION 'isolated late audit fixture failure'; END IF;RETURN NEW;END $$`);
 await db.$executeRawUnsafe('CREATE TRIGGER approval_test_late_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION approval_test_late_failure()');
 try {await assert.rejects(f.save(c));assert.equal((await db.purchaseOrder.findUniqueOrThrow({where:{id:f.source.id}})).status,'DRAFT');assert.equal((await db.$queryRawUnsafe('SELECT version,status FROM "ApprovalRequest" WHERE id=$1::uuid',q.id))[0].version,r.version);assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalCommand" WHERE id=$1::uuid',c.requestId))[0].n,0);assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalDecision" WHERE id=$1::uuid',c.requestId))[0].n,0);assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalFinalizationPermit" WHERE "approvalId"=$1::uuid',q.id))[0].n,0);} finally {await db.$executeRawUnsafe('DROP TRIGGER approval_test_late_failure ON "AuditLog"');await db.$executeRawUnsafe('DROP FUNCTION approval_test_late_failure()');}
 const final=await f.save(c);assert.equal(final.approval.status,'APPROVED');const audit=await db.auditLog.findFirstOrThrow({where:{tenantId:f.base.tenantId,action:'purchase-order.issued'}});assert.deepEqual(audit.metadata,{approvalCommandId:c.requestId,approvalId:q.id});await assert.rejects(db.auditLog.delete({where:{id:audit.id}}));
});
test('approval SQL prevents raw inserts, source movement, stale permit reuse and retention truncation',async()=>{
 const f=await fixture(),{q}=await f.pending();await assert.rejects(db.$executeRawUnsafe('INSERT INTO "ApprovalFinalizationPermit"("approvalId","decisionId","transactionId","sourceAuditId") VALUES($1::uuid,$2::uuid,txid_current(),$3::uuid)',q.id,randomUUID(),randomUUID()));
 const other=await db.branch.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,name:'Other',code:'C'}});await assert.rejects(db.purchaseOrder.update({where:{id:f.source.id},data:{branchId:other.id}}));for(const table of ['PurchaseOrder','PurchaseOrderLine','AuditLog'])await assert.rejects(db.$executeRawUnsafe(`TRUNCATE "${table}" CASCADE`));
 const r=(await f.save(f.vote(q))).approval;await db.$transaction(async tx=>{await f.save(f.vote(r,f.users[2]),'COMMITTED',tx);await tx.purchaseOrder.update({where:{id:f.source.id},data:{status:'DRAFT',issuedAt:null}});await assert.rejects(tx.purchaseOrder.update({where:{id:f.source.id},data:{status:'ISSUED',issuedAt:new Date()}}));}).catch(()=>{});
 assert.equal((await db.purchaseOrder.findUniqueOrThrow({where:{id:f.source.id}})).status,'DRAFT');assert.equal((await db.$queryRawUnsafe('SELECT status FROM "ApprovalRequest" WHERE id=$1::uuid',q.id))[0].status,'PENDING');
});
test('approval SQL snapshots preserve high precision money and matching never rounds currencies',async()=>{
 const f=await fixture();await db.purchaseOrder.update({where:{id:f.source.id},data:{subtotal:'999999999999999.999'}});await db.purchaseOrderLine.updateMany({where:{orderId:f.source.id},data:{unitPrice:'999999999999999.999',amount:'999999999999999.999'}});
 const p=f.policyCommand({configuration:{...f.configuration,currency:'OMR',minimumAmount:'999999999999999.999',maximumAmount:'999999999999999.999'}});await f.save(p);const q=(await f.save(await f.submit(p))).approval;assert.equal(q.sourceSnapshot.subtotal,'999999999999999.999');assert.equal(q.sourceSnapshot.lines[0].amount,'999999999999999.999');let r=await f.save(f.vote(q));r=await f.save(f.vote(r.approval,f.users[2]));assert.equal(r.approval.status,'APPROVED');
 const e=await fixture('EXPENSE');await db.expense.update({where:{id:e.source.id},data:{amount:'999999999999999.999'}});const ep=await e.configured(),eq=(await e.save(await e.submit(ep))).approval;assert.equal(eq.sourceSnapshot.amount,'999999999999999.999');let er=await e.save(e.vote(eq));er=await e.save(e.vote(er.approval,e.users[2]));assert.equal(er.approval.status,'APPROVED');
});
test('approval SQL can pause an obsolete policy without restoring a deleted historical role',async()=>{
 const f=await fixture(),role=await db.role.create({data:{tenantId:f.base.tenantId,name:'Temporary reviewer'}}),configuration={...f.configuration,stages:[{name:'Review',quorum:1,userIds:[],roleIds:[role.id]}]},p=f.policyCommand({configuration});await f.save(p);await db.role.delete({where:{id:role.id}});const paused=await f.save(f.policyCommand({policyId:p.policyId,expectedVersion:1,configuration:{...configuration,enabled:false}}));assert.equal(paused.policy.configuration.enabled,false);await assert.rejects(f.save(f.policyCommand({policyId:p.policyId,expectedVersion:2,configuration})));
});
test('approval SQL rejects stale-snapshot isolation for command mutations only',async()=>{
 const f=await fixture(),p=f.policyCommand();
 for(const isolationLevel of ['RepeatableRead','Serializable']){
  await assert.rejects(db.$transaction(tx=>f.save(p,'COMMITTED',tx),{isolationLevel}),/READ COMMITTED/);
  await assert.rejects(db.$transaction(tx=>f.save(p,'ABANDONED',tx),{isolationLevel}),/READ COMMITTED/);
  assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalCommand" WHERE id=$1::uuid',p.requestId))[0].n,0);
  await db.$transaction(tx=>tx.company.findUniqueOrThrow({where:{id:f.base.companyId}}),{isolationLevel});
 }
 await f.save(p);const q=(await f.save(await f.submit(p))).approval;
 for(const isolationLevel of ['RepeatableRead','Serializable'])await assert.rejects(db.$transaction(tx=>f.save(f.vote(q),'COMMITTED',tx),{isolationLevel}),/READ COMMITTED/);
 assert.equal((await f.save(f.vote(q))).approval.stage,1);
});
test('approval SQL tuple fences stop old RR raw-source writers missing activation or pending enrollment',async()=>{
 const side=new PrismaClient();try {
  const f=await fixture(),p=f.policyCommand();
  await assert.rejects(db.$transaction(async tx=>{
   await tx.purchaseOrder.findUniqueOrThrow({where:{id:f.source.id}});
   await f.save(p,'COMMITTED',side);
   await tx.purchaseOrder.update({where:{id:f.source.id},data:{status:'ISSUED',issuedAt:new Date()}});
  },{isolationLevel:'RepeatableRead'}),error=>error.code==='P2034');
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({where:{id:f.source.id}})).status,'DRAFT');
  const c=await f.submit(p);
  await assert.rejects(db.$transaction(async tx=>{
   await tx.purchaseOrder.findUniqueOrThrow({where:{id:f.source.id}});
   await f.save(c,'COMMITTED',side);
   await tx.purchaseOrder.update({where:{id:f.source.id},data:{notes:'Stale writer'}});
  },{isolationLevel:'RepeatableRead'}),error=>error.code==='P2034');
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({where:{id:f.source.id}})).notes,null);
  const legacy=await fixture();await db.$transaction(tx=>tx.purchaseOrder.update({where:{id:legacy.source.id},data:{status:'ISSUED',issuedAt:new Date()}}),{isolationLevel:'RepeatableRead'});
 }finally{await side.$disconnect();}
});
test('approval SQL referential integrity retains sources and audits across stale RR truncation',async()=>{
 const references=await db.$queryRaw`SELECT conrelid::regclass::text AS child,confrelid::regclass::text AS parent,condeferrable,condeferred,convalidated FROM pg_constraint WHERE contype='f' AND conrelid IN('"ApprovalRequest"'::regclass,'"ApprovalCommand"'::regclass,'"ApprovalFinalizationPermit"'::regclass)`;
 for(const parent of ['"PurchaseOrder"','"Expense"','"LeaveRequest"'])assert.ok(references.some(r=>r.child==='"ApprovalRequest"'&&r.parent===parent&&r.convalidated));
 for(const child of ['"ApprovalCommand"','"ApprovalFinalizationPermit"'])assert.ok(references.some(r=>r.child===child&&r.parent==='"AuditLog"'&&r.convalidated&&r.condeferrable&&r.condeferred));
 const side=new PrismaClient();try{
  for(const resource of ['PURCHASE','EXPENSE','LEAVE']){
   const f=await fixture(resource),p=await f.configured(),c=await f.submit(p),table={PURCHASE:'PurchaseOrder',EXPENSE:'Expense',LEAVE:'LeaveRequest'}[resource];
   await assert.rejects(db.$transaction(async tx=>{
    // Establish an old snapshot without taking source/audit relation locks that
    // would artificially block the concurrent configured enrollment.
    await tx.$queryRaw`SELECT count(*) FROM "ApprovalRequest"`;
    await f.save(c,'COMMITTED',side);
    assert.equal((await tx.$queryRawUnsafe('SELECT count(*)::int n FROM \"ApprovalRequest\" WHERE id=$1::uuid',c.requestId))[0].n,0);
    await tx.$executeRawUnsafe(`TRUNCATE "${table}" CASCADE`);
   },{isolationLevel:'RepeatableRead'}),/cannot be truncated|command managed|history|truncate/i);
   assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalRequest" WHERE id=$1::uuid',c.requestId))[0].n,1);
   assert.equal((await db.$queryRawUnsafe(`SELECT count(*)::int n FROM "${table}" WHERE id=$1::uuid`,f.source.id))[0].n,1);
  }
  const f=await fixture(),p=f.policyCommand();
  await assert.rejects(db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT count(*) FROM "ApprovalCommand"`;
   await f.save(p,'COMMITTED',side);
   await tx.$executeRawUnsafe('TRUNCATE "AuditLog" CASCADE');
  },{isolationLevel:'RepeatableRead'}),/cannot be truncated|command managed|history|truncate/i);
  assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int n FROM "ApprovalCommand" WHERE id=$1::uuid',p.requestId))[0].n,1);
  assert.equal(await db.auditLog.count({where:{id:p.requestId}}),1);
 }finally{await side.$disconnect();}
});
