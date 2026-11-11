import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';

// Synthetic fixtures only. No server or browser is required for these SQL invariants.
const db=new PrismaClient();
const date=new Date('2026-01-10T00:00:00Z');
const millis=s=>BigInt(s.replace('.',''));
const text=n=>`${n<0n?'-':''}${(n<0n?-n:n)/1000n}.${String((n<0n?-n:n)%1000n).padStart(3,'0')}`;
async function fixture(){
 const tenant=await db.tenant.create({data:{name:'Allocation SQL QA',slug:`alloc-sql-${randomUUID()}`}}),tenantId=tenant.id;
 const user=await db.user.create({data:{name:'SQL tester',email:`${randomUUID()}@example.invalid`,passwordHash:'not-a-login-hash'}}),createdBy=user.id;
 const member=await db.membership.create({data:{tenantId,userId:createdBy,status:'ACTIVE'}});
 const role=await db.role.create({data:{tenantId,name:'Allocation tester'}});
 await db.rolePermission.createMany({data:['ledger:read','ledger:post'].map(permissionKey=>({tenantId,roleId:role.id,permissionKey}))});
 const grant=await db.roleGrant.create({data:{tenantId,membershipId:member.id,roleId:role.id}});
 const scope=await db.accessScope.create({data:{tenantId,grantId:grant.id,type:'TENANT'}});
 const company=await db.company.create({data:{tenantId,name:'Synthetic allocation company',code:'ALC'}}),companyId=company.id;
 const bank=await db.ledgerAccount.create({data:{tenantId,companyId,code:'100',name:'Synthetic bank',type:'ASSET',createdBy}});
 const contra=await db.ledgerAccount.create({data:{tenantId,companyId,code:'400',name:'Synthetic contra',type:'REVENUE',createdBy}});
 const base={tenantId,companyId,accountId:bank.id};
 async function journal(amount='10.000',overrides={}){
  const negative=amount.startsWith('-'),abs=amount.replace('-','');
  return db.$transaction(async tx=>{const entry=await tx.journalEntry.create({data:{tenantId,companyId,number:randomUUID(),entryDate:date,description:'Synthetic allocation fixture',currency:'OMR',total:abs,createdBy,...overrides}}); const lines=await Promise.all([tx.journalLine.create({data:{...base,entryId:entry.id,position:0,debit:negative?'0':abs,credit:negative?abs:'0'}}),tx.journalLine.create({data:{...base,accountId:contra.id,entryId:entry.id,position:1,debit:negative?abs:'0',credit:negative?'0':abs}})]);return lines[0];});
 }
 async function statement(amounts=['10.000'],from=date){
  return db.$transaction(async tx=>{const id=randomUUID(),total=amounts.reduce((n,v)=>n+millis(v),0n),closing=text(total);const s=await tx.bankStatement.create({data:{...base,id,reference:randomUUID(),from,to:from,opening:'0',closing,currency:'OMR',requestHash:'0'.repeat(64),createdBy}});const lines=[];for(let i=0;i<amounts.length;i++)lines.push(await tx.bankStatementLine.create({data:{...base,id:randomUUID(),statementId:id,position:i,bookingDate:from,reference:'Synthetic source',amount:amounts[i]}}));return {...s,lines};});
 }
 async function audit(tx,m,statementId,action='bank-match.created',patch={}){const [{transaction}]=await tx.$queryRaw`SELECT txid_current()::text AS transaction`;return tx.auditLog.create({data:{tenantId,actorId:action==='bank-match.created'?m.createdBy:m.cancelledBy,entity:'BankMatch',entityId:m.id,action,metadata:{transaction,statementId,bankLineId:m.bankLineId,journalLineId:m.journalLineId,amount:m.amount.toFixed(3),kind:m.kind,...(action==='bank-match.cancelled'?{reason:m.cancelReason}:{}),...patch}}});}
 async function allocate(s,j,amount='1.000',options={}){return db.$transaction(async tx=>{const m=await tx.bankMatch.create({data:{...base,id:randomUUID(),bankLineId:s.lines[0].id,journalLineId:j.id,createdBy,amount,kind:'allocate',...options.data}});if(options.audit!==false)await audit(tx,m,s.id,'bank-match.created',options.metadata);return m;},options.transaction);}
 async function cancel(m,s,options={}){return db.$transaction(async tx=>{const changed=await tx.bankMatch.update({where:{id:m.id},data:{cancelledAt:new Date(),cancelledBy:createdBy,cancelReason:'Synthetic correction',...options.data}});if(options.audit!==false)await audit(tx,changed,s.id,'bank-match.cancelled',options.metadata);return changed;});}
 async function voidStatement(s,options={}){return db.$transaction(async tx=>{const changed=await tx.bankStatement.update({where:{id:s.id},data:{voidedAt:new Date(),voidedBy:createdBy,voidReason:'Synthetic void',...options.data}});const [{transaction}]=await tx.$queryRaw`SELECT txid_current()::text AS transaction`;if(options.audit!==false)await tx.auditLog.create({data:{tenantId,actorId:changed.voidedBy,entity:'BankStatement',entityId:changed.id,action:'bank-statement.voided',metadata:{transaction,accountId:changed.accountId,reason:changed.voidReason,...options.metadata}}});return changed;},options.transaction);}
 return {tenantId,companyId,createdBy,base,member,role,scope,journal,statement,allocate,cancel,audit,voidStatement};
}

test('allocation SQL guards enforce capacity, scope, audit, immutable corrections and isolation',{timeout:60000},async()=>{
 const f=await fixture(),s=await f.statement(['10.000','-10.000']),j=await f.journal(),j2=await f.journal(),out=await f.journal('-10.000');
 for(const amount of ['0.000','-1.000','10.001'])await assert.rejects(f.allocate(s,j,amount));
 await assert.rejects(f.allocate(s,out));
 await assert.rejects(f.allocate(s,j,'1.000',{audit:false}));
 for(const metadata of [{transaction:'0'},{amount:'2.000'},{kind:'match'},{bankLineId:randomUUID()},{journalLineId:randomUUID()},{statementId:randomUUID()}])await assert.rejects(f.allocate(s,j,'1.000',{metadata}));
 for(const isolationLevel of ['RepeatableRead','Serializable'])await assert.rejects(f.allocate(s,j,'1.000',{transaction:{isolationLevel}}));
 await assert.rejects(f.allocate(s,j,'1.000',{data:{kind:'match'}}));
 await assert.rejects(f.allocate(s,j,'1.000',{data:{createdBy:randomUUID()}}));
 await assert.rejects(f.allocate(s,j,'1.000',{data:{companyId:randomUUID()}}));
 await assert.rejects(f.allocate(s,j,'1.000',{data:{tenantId:randomUUID()}}));
 const future=await f.journal('10.000',{entryDate:new Date('2026-01-11T00:00:00Z')}),foreignCurrency=await f.journal('10.000',{currency:'USD'});
 await assert.rejects(f.allocate(s,future));await assert.rejects(f.allocate(s,foreignCurrency));
 const m=await f.allocate(s,j,'3.001');await f.allocate(s,j2,'6.999');
 assert.equal((await db.bankMatch.aggregate({where:{bankLineId:s.lines[0].id,cancelledAt:null},_sum:{amount:true}}))._sum.amount.toFixed(3),'10.000');
 await assert.rejects(f.allocate(s,j,'0.001'));
 for(const data of [{amount:'3.000'},{kind:'match'},{createdBy:randomUUID()},{createdAt:new Date('2000-01-01')},{journalLineId:j2.id}])await assert.rejects(db.bankMatch.update({where:{id:m.id},data}));
 await assert.rejects(db.bankMatch.delete({where:{id:m.id}}));await assert.rejects(f.cancel(m,s,{audit:false}));await assert.rejects(f.cancel(m,s,{metadata:{reason:'Other reason'}}));
 await assert.rejects(db.bankStatement.update({where:{id:s.id},data:{voidedAt:new Date(),voidedBy:f.createdBy,voidReason:'Synthetic void'}}));
 const cancelled=await f.cancel(m,s);assert.ok(cancelled.cancelledAt);
 await assert.rejects(f.cancel(m,s));await assert.rejects(db.bankMatch.update({where:{id:m.id},data:{cancelledAt:null,cancelledBy:null,cancelReason:null}}));
 await f.allocate(s,j,'3.001');
 assert.equal((await db.bankStatementLine.findUnique({where:{id:s.lines[0].id}})).amount.toFixed(3),'10.000');assert.equal((await db.journalLine.findUnique({where:{id:j.id}})).debit.toFixed(3),'10.000');
 // Revoked and branch-only access cannot insert or cancel existing allocations.
 await db.membership.update({where:{id:f.member.id},data:{status:'SUSPENDED'}});await assert.rejects(f.allocate({...s,lines:[s.lines[1]]},out));
 const active=await db.bankMatch.findFirst({where:{bankLineId:s.lines[0].id,cancelledAt:null}});await assert.rejects(f.cancel(active,s));
 await db.membership.update({where:{id:f.member.id},data:{status:'ACTIVE'}});
 const branch=await db.branch.create({data:{tenantId:f.tenantId,companyId:f.companyId,name:'Branch',code:'B'}});
 await db.accessScope.update({where:{id:f.scope.id},data:{type:'BRANCH',companyId:f.companyId,branchId:branch.id}});await assert.rejects(f.allocate({...s,lines:[s.lines[1]]},out));await assert.rejects(f.cancel(active,s));
 await db.accessScope.update({where:{id:f.scope.id},data:{type:'TENANT',companyId:null,branchId:null}});
 await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.tenantId,roleId:f.role.id,permissionKey:'ledger:read'}}});await assert.rejects(f.allocate({...s,lines:[s.lines[1]]},out));
});

test('account serialization protects competing bank and journal capacities and cancellation races',{timeout:60000},async()=>{
 const f=await fixture(),s=await f.statement(['10.000','10.000']),a=await f.journal(),b=await f.journal();
 const race=await Promise.allSettled([f.allocate(s,a,'7.000'),f.allocate(s,b,'7.000')]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 const first=race.find(r=>r.status==='fulfilled').value;await f.cancel(first,s);
 const s2={...s,lines:[s.lines[1]]};
 const bookRace=await Promise.allSettled([f.allocate(s,a,'7.000'),f.allocate(s2,a,'7.000')]);assert.equal(bookRace.filter(r=>r.status==='fulfilled').length,1);
 const active=bookRace.find(r=>r.status==='fulfilled').value;
 const source=active.bankLineId===s.lines[0].id?s:s2;
 const replacement=await Promise.allSettled([f.cancel(active,s),f.allocate(source,a,'4.000')]);assert.equal(replacement[0].status,'fulfilled');
 const sums=await db.bankMatch.aggregate({where:{journalLineId:a.id,cancelledAt:null},_sum:{amount:true}});assert.ok(!sums._sum.amount||sums._sum.amount.lte('10.000'));
 // A void and new allocation serialize. Exactly one can survive when starting empty.
 for(const m of await db.bankMatch.findMany({where:{tenantId:f.tenantId,cancelledAt:null}}))await f.cancel(m,s);
 const voidRace=await Promise.allSettled([f.voidStatement(s),f.allocate(s,b,'1.000')]);assert.equal(voidRace.filter(r=>r.status==='fulfilled').length,1);
 const saved=await db.bankStatement.findUnique({where:{id:s.id}});if(saved.voidedAt)assert.equal(await db.bankMatch.count({where:{bankLineId:{in:s.lines.map(l=>l.id)},cancelledAt:null}}),0);
});

test('outgoing milli-unit and maximum allocations stay exact without rewriting sources',{timeout:60000},async()=>{
 const f=await fixture(),maximum='999999999999999.999',j=await f.journal(`-${maximum}`),s=await f.statement([`-${maximum}`]);
 await f.allocate(s,j,'999999999999999.998');await f.allocate(s,j,'0.001');
 assert.equal((await db.bankMatch.aggregate({where:{bankLineId:s.lines[0].id,cancelledAt:null},_sum:{amount:true}}))._sum.amount.toFixed(3),maximum);
 await assert.rejects(f.allocate(s,j,'0.001'));
 assert.equal((await db.bankStatementLine.findUnique({where:{id:s.lines[0].id}})).amount.toFixed(3),`-${maximum}`);
});

test('direct SQL cancellation waits for account lock and current permission revocation wins',{timeout:60000},async()=>{
 const f=await fixture(),s=await f.statement(),j=await f.journal(),m=await f.allocate(s,j,'1.000');
 let release,locked;const hasLock=new Promise(r=>{locked=r;}),releaseLock=new Promise(r=>{release=r;});
 const holder=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "LedgerAccount" WHERE id=${f.base.accountId}::uuid FOR UPDATE`;locked();await releaseLock;},{timeout:15000});
 await hasLock;let settled=false;const cancellation=f.cancel(m,s).finally(()=>{settled=true;});
 await new Promise(r=>setTimeout(r,80));assert.equal(settled,false,'Cancellation must acquire the same account lock as allocation/capture/void');release();await holder;await cancellation;
 let releaseRevoke,tenantLocked;const hasTenantLock=new Promise(r=>{tenantLocked=r;}),finishRevoke=new Promise(r=>{releaseRevoke=r;});
 const revoke=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${f.tenantId}::uuid FOR UPDATE`;await tx.membership.update({where:{id:f.member.id},data:{status:'SUSPENDED'}});tenantLocked();await finishRevoke;},{timeout:15000});
 await hasTenantLock;let insertionSettled=false;const insertion=f.allocate(s,j,'1.000').then(v=>({value:v}),e=>({error:e})).finally(()=>{insertionSettled=true;});
 await new Promise(r=>setTimeout(r,80));assert.equal(insertionSettled,false);releaseRevoke();await revoke;assert.ok((await insertion).error,'Permission must be rechecked after obtaining tenant lock');
});

test('direct SQL statement void requires exact same-transaction audit and current actor',{timeout:60000},async()=>{
 const f=await fixture(),s=await f.statement();
 await assert.rejects(f.voidStatement(s,{audit:false}));
 for(const metadata of [{transaction:'0'},{accountId:randomUUID()},{reason:'Different reason'}])await assert.rejects(f.voidStatement(s,{metadata}));
 for(const isolationLevel of ['RepeatableRead','Serializable'])await assert.rejects(f.voidStatement(s,{transaction:{isolationLevel}}));
 await assert.rejects(f.voidStatement(s,{data:{voidedBy:randomUUID()}}));
 assert.equal((await db.bankStatement.findUnique({where:{id:s.id}})).voidedAt,null);
 assert.ok((await f.voidStatement(s)).voidedAt);await assert.rejects(f.voidStatement(s));
});

test('abandoned request tombstones are scoped, audited, immutable and block late allocations',{timeout:60000},async()=>{
 const f=await fixture(),s=await f.statement(),j=await f.journal();
 const request={tenantId:f.tenantId,requestId:randomUUID(),action:'allocate',bankLineId:s.lines[0].id,journalLineId:j.id,amount:'1.000'};
 async function abandon(req,options={}){return db.$transaction(async tx=>{
  const [{digest}]=await tx.$queryRaw`SELECT erp_bank_certificate_digest(${JSON.stringify({actorId:f.createdBy,statementId:s.id,request:req})}::jsonb) AS digest`;
  const result=await tx.bankRequestResolution.create({data:{...f.base,id:req.requestId,statementId:s.id,actorId:f.createdBy,request:req,requestDigest:digest,createdAt:new Date('2000-01-01'),...options.data}});
  const [{transaction}]=await tx.$queryRaw`SELECT txid_current()::text AS transaction`;
  if(options.audit!==false)await tx.auditLog.create({data:{tenantId:f.tenantId,actorId:f.createdBy,entity:'BankRequestResolution',entityId:result.id,action:result.outcome==='COMMITTED'?'bank-request.committed':'bank-request.abandoned',metadata:{transaction,statementId:s.id,requestDigest:digest,...options.metadata}}});return result;
 });}
 await assert.rejects(abandon(request,{audit:false}));await assert.rejects(abandon(request,{metadata:{transaction:'0'}}));await assert.rejects(abandon(request,{data:{requestDigest:'0'.repeat(64)}}));
 for(const patch of [{amount:'0.000'},{amount:'1'},{amount:'-1.000'},{extra:'bad'},{action:'other'},{tenantId:randomUUID()},{bankLineId:'INVALID'}])await assert.rejects(abandon({...request,...patch}));
 const resolution=await abandon(request);assert.ok(resolution.createdAt.getUTCFullYear()>2000);
 await assert.rejects(f.allocate(s,j,'1.000',{data:{id:request.requestId}}));
 await assert.rejects(db.bankRequestResolution.delete({where:{id:resolution.id}}));await assert.rejects(db.bankRequestResolution.update({where:{id:resolution.id},data:{requestDigest:'0'.repeat(64)}}));
 const committed=await f.allocate(s,j,'1.000',{data:{createdAt:new Date('2000-01-01')}});assert.ok(committed.createdAt.getUTCFullYear()>2000);
 await assert.rejects(abandon({...request,requestId:committed.id}));
 const cancelled=await f.cancel(committed,s,{data:{cancelledAt:new Date('2000-01-01')}});assert.ok(cancelled.cancelledAt.getUTCFullYear()>2000);
 const creationReceipt=await abandon({...request,requestId:committed.id},{data:{outcome:'COMMITTED'}});assert.equal(creationReceipt.outcome,'COMMITTED');
 const cancelRequest={tenantId:f.tenantId,requestId:randomUUID(),action:'cancel',matchId:committed.id,reason:'Synthetic correction'};
 const cancelReceipt=await abandon(cancelRequest,{data:{outcome:'COMMITTED'}});assert.equal(cancelReceipt.outcome,'COMMITTED');
 await assert.rejects(f.allocate(s,j,'1.000',{data:{id:cancelReceipt.id}}));await assert.rejects(abandon({...request,requestId:cancelReceipt.id}));
 await assert.rejects(abandon({...cancelRequest,requestId:committed.id},{data:{outcome:'COMMITTED'}}));
 await assert.rejects(abandon({...cancelRequest,requestId:randomUUID(),reason:'Wrong effect'},{data:{outcome:'COMMITTED'}}));
 await assert.rejects(abandon({...request,requestId:randomUUID()},{data:{outcome:'COMMITTED'}}));
 // Global request UUID uniqueness holds across a different tenant/account.
 const other=await fixture(),otherStatement=await other.statement(),otherJournal=await other.journal();
 await assert.rejects(other.allocate(otherStatement,otherJournal,'1.000',{data:{id:cancelReceipt.id}}));

 for(const action of ['match','cancel','void']){const req={tenantId:f.tenantId,requestId:randomUUID(),action,...(action==='match'?{bankLineId:s.lines[0].id,journalLineId:j.id}:action==='cancel'?{matchId:committed.id,reason:'Synthetic rejected cancellation'}:{reason:'Synthetic rejected void'})};assert.ok((await abandon(req)).id);}
 const racingRequest={...request,requestId:randomUUID()};const outcomes=await Promise.allSettled([abandon(racingRequest),f.allocate(s,j,'1.000',{data:{id:racingRequest.requestId}})]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await db.bankRequestResolution.count({where:{id:racingRequest.requestId}}))+(await db.bankMatch.count({where:{id:racingRequest.requestId}})),1);
 for(const m of await db.bankMatch.findMany({where:{tenantId:f.tenantId,cancelledAt:null}}))await f.cancel(m,s);
 const voided=await f.voidStatement(s,{data:{voidedAt:new Date('2000-01-01')}});assert.ok(voided.voidedAt.getUTCFullYear()>2000);
 const voidRequest={tenantId:f.tenantId,requestId:randomUUID(),action:'void',reason:'Synthetic void'};
 const voidReceipt=await abandon(voidRequest,{data:{outcome:'COMMITTED'}});assert.equal(voidReceipt.outcome,'COMMITTED');
 await assert.rejects(other.allocate(otherStatement,otherJournal,'1.000',{data:{id:voidReceipt.id}}));
 await assert.rejects(abandon({...voidRequest,requestId:randomUUID(),reason:'Wrong void'},{data:{outcome:'COMMITTED'}}));

 assert.ok((await abandon({...request,requestId:randomUUID()})).id,'Rejected requests may be abandoned after statement void');
});

test.after(async()=>{await db.$disconnect();});

test('bank allocation SQL entry points reject PUBLIC and available API role grants',async()=>{
 const signatures=['erp_validate_bank_match()','erp_bank_allocation_audit()','erp_bank_statement_correction()','erp_bank_statement_void_audit()','erp_bank_reconciliation_inputs(uuid,uuid)','erp_bank_certificate_guard()','erp_bank_request_resolution_guard()','erp_bank_request_resolution_audit()'];
 // Vanilla PostgreSQL has neither provider role. Catalog assertions still run,
 // including acldefault: a NULL function ACL grants PUBLIC EXECUTE by default.
 const roles=await db.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`;
 for(const signature of signatures){
  const rows=await db.$queryRaw`SELECT p.oid::text AS id,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicExecute" FROM pg_proc p WHERE p.oid=to_regprocedure(${signature})`;
  assert.equal(rows.length,1,`Required function missing: ${signature}`);assert.equal(rows[0].publicExecute,false,`PUBLIC EXECUTE: ${signature}`);
  for(const {rolname} of roles){const [row]=await db.$queryRaw`SELECT has_function_privilege(${rolname},${signature},'EXECUTE') AS allowed`;assert.equal(row.allowed,false,`${rolname} EXECUTE: ${signature}`);}
 }
 const tables=await db.$queryRaw`SELECT c.relrowsecurity AS rls,EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS "publicPrivileges" FROM pg_class c WHERE c.oid=to_regclass('"BankRequestResolution"') AND c.relkind='r'`;
 assert.equal(tables.length,1,'Required request registry missing');assert.equal(tables[0].rls,true,'Request registry RLS required');assert.equal(tables[0].publicPrivileges,false,'PUBLIC registry privileges must be revoked');
 for(const {rolname} of roles){const [row]=await db.$queryRaw`SELECT has_table_privilege(${rolname},'"BankRequestResolution"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed`;assert.equal(row.allowed,false,`${rolname} registry privileges`);}
});
