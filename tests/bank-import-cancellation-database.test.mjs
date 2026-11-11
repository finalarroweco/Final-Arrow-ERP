import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
const date=new Date('2026-01-10T00:00:00Z');
async function fixture(){
 const tenant=await db.tenant.create({data:{name:'Import cancellation SQL QA',slug:`import-cancel-${randomUUID()}`}}),tenantId=tenant.id;
 const user=await db.user.create({data:{name:'Synthetic actor',email:`${randomUUID()}@example.invalid`,passwordHash:'not-a-login-hash'}}),createdBy=user.id;
 const member=await db.membership.create({data:{tenantId,userId:createdBy,status:'ACTIVE'}});
 const role=await db.role.create({data:{tenantId,name:'Import SQL tester'}});
 await db.rolePermission.createMany({data:['ledger:read','ledger:post'].map(permissionKey=>({tenantId,roleId:role.id,permissionKey}))});
 const grant=await db.roleGrant.create({data:{tenantId,membershipId:member.id,roleId:role.id}});
 const scope=await db.accessScope.create({data:{tenantId,grantId:grant.id,type:'TENANT'}});
 const company=await db.company.create({data:{tenantId,name:'Synthetic company',code:'IMP'}}),companyId=company.id;
 const account=await db.ledgerAccount.create({data:{tenantId,companyId,code:'100',name:'Synthetic bank',type:'ASSET',createdBy}});
 const other=await db.ledgerAccount.create({data:{tenantId,companyId,code:'101',name:'Other bank',type:'ASSET',createdBy}});
 const base={tenantId,companyId,accountId:account.id,createdBy,requestHash:'a'.repeat(64)};
 const cancel=(patch={},client=db)=>client.bankStatementImportCancellation.create({data:{id:randomUUID(),...base,...patch}});
 const statement=(patch={},client=db)=>client.bankStatement.create({data:{id:randomUUID(),...base,reference:randomUUID(),from:date,to:date,opening:'0',closing:'0',currency:'OMR',...patch}});
 return {base,member,role,scope,other,cancel,statement};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function waitLocked(pid){for(let n=0;n<200;n++){const rows=await db.$queryRaw`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;if(rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error('Second connection never reached a PostgreSQL lock barrier');}
async function concurrent(first,second){
 const held=deferred(),release=deferred(),started=deferred();
 const a=db.$transaction(async tx=>{const value=await first(tx);held.resolve();await release.promise;return value;},{timeout:15000});
 await held.promise;
 const b=db.$transaction(async tx=>{const [{pid}]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;started.resolve(pid);return second(tx);},{timeout:15000}).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}));
 try{await waitLocked(await started.promise);}finally{release.resolve();}
 return [await a,await b];
}

test('import cancellation SQL guards preserve identity, audit and all financial sources',{timeout:60000},async()=>{
 const f=await fixture();
 for(const patch of [{requestHash:'a'.repeat(63)},{requestHash:'A'.repeat(64)},{requestHash:'x'.repeat(64)},{companyId:randomUUID()},{tenantId:randomUUID()},{accountId:randomUUID()},{createdBy:randomUUID()}])await assert.rejects(f.cancel(patch));
 for(const isolationLevel of ['RepeatableRead','Serializable'])await assert.rejects(db.$transaction(tx=>f.cancel({},tx),{isolationLevel}));
 const countOptions={where:{tenantId:f.base.tenantId}};
 const counts=()=>Promise.all([db.bankStatement.count(countOptions),db.bankStatementLine.count(countOptions),db.bankMatch.count(countOptions),db.journalEntry.count(countOptions),db.journalLine.count(countOptions),db.bankReconciliationCertificate.count(countOptions)]);
 const before=await counts();
 const c=await f.cancel({cancelledAt:new Date('2000-01-01'),transactionId:'0',auditId:randomUUID()});
 assert.ok(c.cancelledAt.getUTCFullYear()>2000);assert.notEqual(c.transactionId,'0');
 const audit=await db.auditLog.findUniqueOrThrow({where:{id:c.auditId}});
 assert.equal(audit.entityId,c.auditId);assert.notEqual(audit.entityId,c.id);assert.deepEqual(audit.metadata,{outcome:'ABANDONED'});assert.equal(audit.actorId,c.createdBy);assert.equal(audit.createdAt.toISOString(),c.cancelledAt.toISOString());
 const [row]=await db.$queryRaw`SELECT xmin::text FROM "BankStatementImportCancellation" WHERE id=${c.id}::uuid`;
 const [arow]=await db.$queryRaw`SELECT xmin::text FROM "AuditLog" WHERE id=${c.auditId}::uuid`;
 assert.equal(row.xmin,arow.xmin);assert.equal(BigInt(c.transactionId)%4294967296n,BigInt(row.xmin));
 for(const data of [{requestHash:'b'.repeat(64)},{createdBy:randomUUID()},{accountId:f.other.id},{cancelledAt:new Date()}])await assert.rejects(db.bankStatementImportCancellation.update({where:{id:c.id},data}));
 await assert.rejects(db.bankStatementImportCancellation.delete({where:{id:c.id}}));
 await assert.rejects(db.$executeRawUnsafe('TRUNCATE "BankStatementImportCancellation" CASCADE'));
 await assert.rejects(db.auditLog.update({where:{id:c.auditId},data:{entity:'Other'}}));
 await assert.rejects(db.auditLog.delete({where:{id:c.auditId}}));
 await assert.rejects(db.$executeRawUnsafe('TRUNCATE "AuditLog" CASCADE'));
 for(const data of [{entity:'BankStatementImportCancellation',action:'fake'},{entity:'Other',action:'bank-statement-import.abandoned'}])await assert.rejects(db.auditLog.create({data:{tenantId:f.base.tenantId,actorId:f.base.createdBy,entityId:randomUUID(),metadata:{outcome:'ABANDONED'},...data}}));
 const auditCount=await db.auditLog.count({where:{tenantId:f.base.tenantId}});
 const rollbackId=randomUUID();await assert.rejects(db.$transaction(async tx=>{await f.cancel({id:rollbackId},tx);throw Error('synthetic rollback');}));assert.equal(await db.bankStatementImportCancellation.count({where:{id:rollbackId}}),0);assert.equal(await db.auditLog.count({where:{tenantId:f.base.tenantId}}),auditCount);
 assert.deepEqual(await counts(),before);
 for(const patch of [{},{requestHash:'b'.repeat(64)},{accountId:f.other.id}])await assert.rejects(f.statement({id:c.id,...patch}));
 const other=await fixture();await assert.rejects(other.statement({id:c.id}));
 const secondUser=await db.user.create({data:{name:'Second actor',email:`${randomUUID()}@example.invalid`,passwordHash:'synthetic'}});
 const secondMember=await db.membership.create({data:{tenantId:f.base.tenantId,userId:secondUser.id,status:'ACTIVE'}});
 const secondGrant=await db.roleGrant.create({data:{tenantId:f.base.tenantId,membershipId:secondMember.id,roleId:f.role.id}});
 await db.accessScope.create({data:{tenantId:f.base.tenantId,grantId:secondGrant.id,type:'TENANT'}});
 for(const patch of [{requestHash:'b'.repeat(64)},{createdBy:secondUser.id},{accountId:f.other.id}]){await assert.rejects(f.cancel({id:c.id,...patch}));await assert.rejects(f.statement({id:c.id,...patch}));}
 await assert.rejects(other.cancel({id:c.id}));
 const liability=await db.ledgerAccount.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,code:'200',name:'Not a bank asset',type:'LIABILITY',createdBy:f.base.createdBy}});
 await assert.rejects(f.cancel({accountId:liability.id}));await assert.rejects(f.statement({accountId:liability.id}));
 const s=await f.statement();await assert.rejects(f.cancel({id:s.id}));await assert.rejects(other.cancel({id:s.id}));
 // A void is still a committed import and cannot receive a tombstone.
 await db.$transaction(async tx=>{
  await tx.bankStatement.update({where:{id:s.id},data:{voidedAt:new Date(),voidedBy:f.base.createdBy,voidReason:'Synthetic void'}});
  const [{transaction}]=await tx.$queryRaw`SELECT txid_current()::text AS transaction`;
  await tx.auditLog.create({data:{tenantId:f.base.tenantId,actorId:f.base.createdBy,entity:'BankStatement',entityId:s.id,action:'bank-statement.voided',metadata:{transaction,accountId:s.accountId,reason:'Synthetic void'}}});
 });
 await assert.rejects(f.cancel({id:s.id}));
 // Existing statement/line totals and mutation guards remain active.
 await assert.rejects(f.statement({accountId:f.other.id,closing:'1'}));
 await assert.rejects(db.bankStatement.update({where:{id:s.id},data:{reference:'changed'}}));
 await assert.rejects(db.bankStatement.delete({where:{id:s.id}}));
 await assert.rejects(db.bankStatementLine.create({data:{id:randomUUID(),tenantId:s.tenantId,companyId:s.companyId,accountId:s.accountId,statementId:s.id,position:0,bookingDate:date,reference:'late',amount:'1'}}));
});

test('import cancellation requires active current company-wide permissions',{timeout:60000},async()=>{
 const f=await fixture();
 await db.membership.update({where:{id:f.member.id},data:{status:'SUSPENDED'}});await assert.rejects(f.cancel());await assert.rejects(f.statement());
 await db.membership.update({where:{id:f.member.id},data:{status:'ACTIVE'}});
 const branch=await db.branch.create({data:{tenantId:f.base.tenantId,companyId:f.base.companyId,name:'Branch',code:'B'}});
 await db.accessScope.update({where:{id:f.scope.id},data:{type:'BRANCH',companyId:f.base.companyId,branchId:branch.id}});await assert.rejects(f.cancel());
 await db.accessScope.update({where:{id:f.scope.id},data:{type:'TENANT',companyId:null,branchId:null}});
 for(const permissionKey of ['ledger:read','ledger:post']){await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.base.tenantId,roleId:f.role.id,permissionKey}}});await assert.rejects(f.cancel());await assert.rejects(f.statement());await db.rolePermission.create({data:{tenantId:f.base.tenantId,roleId:f.role.id,permissionKey}});}
});

test('two-connection barriers prove import wins, abandon wins, old account-first compatibility and global collisions',{timeout:60000},async()=>{
 for(const mode of ['import','cancel','two-cancel','other-account','other-tenant']){
  const f=await fixture(),g=mode==='other-tenant'?await fixture():f,id=randomUUID();
  const [first,second]=await concurrent(async tx=>{
   // Deliberately emulate already-dispatched old code: account row BEFORE new trigger.
   await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${f.base.tenantId}::uuid FOR SHARE`;
   await tx.$queryRaw`SELECT id FROM "LedgerAccount" WHERE id=${f.base.accountId}::uuid FOR UPDATE`;
   return mode==='import'?f.statement({id},tx):f.cancel({id},tx);
  },tx=>mode==='import'||mode==='two-cancel'?g.cancel({id},tx):g.statement({id,...(mode==='other-account'?{accountId:f.other.id,requestHash:'b'.repeat(64)}:{})},tx));
  assert.equal(first.id,id);assert.equal(second.status,'rejected');
  assert.equal(await db.bankStatement.count({where:{id}})+await db.bankStatementImportCancellation.count({where:{id}}),1);
 }
});

test('role revocation waiter rechecks authorization after tenant lock',{timeout:60000},async()=>{
 const f=await fixture(),id=randomUUID();
 const [,second]=await concurrent(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${f.base.tenantId}::uuid FOR UPDATE`;
  await tx.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.base.tenantId,roleId:f.role.id,permissionKey:'ledger:post'}}});
 },tx=>f.cancel({id},tx));
 assert.equal(second.status,'rejected');assert.equal(await db.bankStatementImportCancellation.count({where:{id}}),0);
});

test('cancellation schema is invoker-only and denies public/provider grants',{timeout:60000},async()=>{
 const [table]=await db.$queryRaw`SELECT relrowsecurity FROM pg_class WHERE oid='"BankStatementImportCancellation"'::regclass`;assert.equal(table.relrowsecurity,true);
 const functions=await db.$queryRaw`SELECT proname,prosecdef FROM pg_proc WHERE proname IN ('erp_lock_bank_statement_import','erp_guard_bank_statement_import_fence','erp_guard_bank_statement_import_cancellation','erp_audit_bank_statement_import_cancellation','erp_guard_bank_statement_import_cancellation_audit','erp_guard_bank_statement_import_cancellation_truncate')`;
 assert.equal(functions.length,6);assert.ok(functions.every(f=>!f.prosecdef));
 const grants=await db.$queryRaw`SELECT grantee,privilege_type FROM information_schema.table_privileges WHERE table_name='BankStatementImportCancellation' AND grantee IN ('PUBLIC','anon','authenticated')`;assert.equal(grants.length,0);
 const publicFunctions=await db.$queryRaw`SELECT p.proname FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.proname LIKE '%bank_statement_import%' AND a.grantee=0`;assert.equal(publicFunctions.length,0);
});

test.after(async()=>{await db.$disconnect();});
