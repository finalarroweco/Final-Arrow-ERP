import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
const origin='http://127.0.0.1:3259',actors=new Map();
async function call(path,method='GET',body,cookie,expectedActor=actors.get(cookie)){const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(method==='POST'&&/\/certificates(?:\/[^/]+\/events)?$/.test(path)&&expectedActor?{'X-Expected-Actor-Id':expectedActor}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cache:r.headers.get('cache-control'),disposition:r.headers.get('content-disposition'),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
test('bank snapshots freeze complete exact observations, preserve corrections, enforce current scopes and audited reversible designations',{timeout:120000},async()=>{
 const db=new PrismaClient(),server=spawn('./node_modules/.bin/next',['start','-H','127.0.0.1','-p','3259'],{env:{...process.env,ALLOW_REGISTRATION:'true'},stdio:['ignore','ignore','inherit']});
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  const createOwner=async()=>{const tag=randomUUID().slice(0,8),r=await call('/api/auth/register','POST',{name:'Certificate QA',email:`cert-${tag}@example.invalid`,password:'Certificate-QA-password-2026',organization:'Certificates QA',slug:`cert-${tag}`});assert.equal(r.status,201,JSON.stringify(r.data));actors.set(r.cookie,(await db.membership.findFirstOrThrow({where:{tenantId:r.data.tenantId}})).userId);return r;};
  const checksumFixture={array:[null,true,false,12,{z:'عربي\n"\\\t',a:'😀'}],text:'slash/ and line\u2028separator'};
  const canonical=v=>Array.isArray(v)?v.map(canonical):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)])):v;
  const jsDigest=createHash('sha256').update(JSON.stringify(canonical(checksumFixture))).digest('hex');
  const [sqlDigest]=await db.$queryRaw`SELECT erp_bank_certificate_digest(${JSON.stringify(checksumFixture)}::jsonb) AS digest`;assert.equal(sqlDigest.digest,jsDigest);
  const actor=await createOwner(),outside=await createOwner(),tenantId=actor.data.tenantId,cookie=actor.cookie;
  const create=async(path,data)=>{const r=await call(path,'POST',{tenantId,...data},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const {company}=await create('/api/companies',{name:'Certificate company',code:'CERT',baseCurrency:'OMR'}),companyId=company.id;
  const {branch}=await create('/api/branches',{companyId,name:'Main',code:'MAIN'});
  const bank=(await create('/api/ledger/accounts',{companyId,code:'1010',name:'Bank',type:'ASSET'})).account,revenue=(await create('/api/ledger/accounts',{companyId,code:'4000',name:'Revenue',type:'REVENUE'})).account;
  const day='2026-03-02',before='2026-03-01';
  async function journal(number,amount,date=day){const negative=amount.startsWith('-'),abs=amount.replace('-','');const {entry}=await create('/api/ledger/journals',{companyId,branchId:branch.id,number,entryDate:date,description:number,lines:[{accountId:bank.id,debit:negative?'0':abs,credit:negative?abs:'0'},{accountId:revenue.id,debit:negative?abs:'0',credit:negative?'0':abs}]});return {...entry,bankLine:entry.lines.find(l=>l.accountId===bank.id)};}
  const opening=await journal('OPEN','100',before),pastIn=await journal('PAST-IN','1',before),pastOut=await journal('PAST-OUT','-1',before),incoming=await journal('CURRENT','10');await journal('TRANSIT-IN','2');await journal('TRANSIT-OUT','-1');
  const statement=async(reference,from,to,opening,closing,lines)=>create('/api/bank/statements',{companyId,requestId:randomUUID(),accountId:bank.id,reference,from,to,opening,closing,lines:lines.map(([bookingDate,reference,amount])=>({bookingDate,reference,amount}))});
  const past=await statement('PAST',before,before,'0','100',[[before,'Opening','100'],[before,'Offset in','1'],[before,'Offset out','-1']]),current=await statement('CURRENT',day,day,'100','110',[[day,'Receipt','10']]);
  const live=async id=>(await call(`/api/bank/statements/${id}?tenantId=${tenantId}`,'GET',null,cookie)).data;
  const match=async(id,bankLineId,journalLineId)=>{const r=await call(`/api/bank/statements/${id}/matches`,'POST',{tenantId,action:'match',requestId:randomUUID(),bankLineId,journalLineId},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data.match;};
  const pastState=await live(past.id),currentState=await live(current.id);
  await match(past.id,pastState.statement.lines.find(l=>l.amount==='100.000').id,opening.bankLine.id);
  const base=`/api/bank/statements/${current.id}/certificates`,query=`?tenantId=${tenantId}`,preview=()=>call(base+'/preview'+query,'GET',null,cookie);
  const firstPreview=await preview();assert.equal(firstPreview.status,200,JSON.stringify(firstPreview.data));assert.equal(firstPreview.data.snapshot.bank.length,4);assert.equal(firstPreview.data.snapshot.book.length,6);assert.equal(firstPreview.data.snapshot.summary.pendingBank,3);assert.match(firstPreview.cache,/no-store/);
  const currentMatch=await match(current.id,currentState.statement.lines[0].id,incoming.bankLine.id);
  assert.equal((await call(base,'POST',{tenantId,requestId:randomUUID(),expectedDigest:firstPreview.data.digest,note:'stale'},cookie)).status,409);
  const p=(await preview()).data;assert.equal(p.snapshot.summary.difference,'0.000');assert.equal(p.snapshot.summary.pendingBank,2);assert.equal(p.snapshot.summary.reconciled,false);
  const payload={tenantId,requestId:randomUUID(),expectedDigest:p.digest,note:'Observed incomplete review'};
  assert.equal((await call(base,'POST',payload)).status,401);assert.equal((await call(base,'POST',payload,outside.cookie)).status,403);
  const upperBase=`/api/bank/statements/${current.id.toUpperCase()}/certificates`,upperPayload={...payload,tenantId:tenantId.toUpperCase(),requestId:payload.requestId.toUpperCase()};assert.equal((await call(upperBase+'/preview?tenantId='+tenantId.toUpperCase(),'GET',null,cookie)).data.digest,p.digest);
  const created=await Promise.all([call(upperBase,'POST',upperPayload,cookie),call(upperBase,'POST',upperPayload,cookie)]);assert.ok(created.every(r=>r.status===201),JSON.stringify(created));assert.equal(created[0].data.id,created[1].data.id);
  const id=created[0].data.id,detail=`/api/bank/certificates/${id}`,get=()=>call(detail+query,'GET',null,cookie),frozen=(await get()).data.certificate;
  const downloaded=await call(detail+query+'&format=json','GET',null,cookie);assert.equal(downloaded.status,200);assert.deepEqual(downloaded.data.certificate,frozen);assert.match(downloaded.disposition,new RegExp(`attachment; filename="bank-reconciliation-${id}.json"`));assert.match(downloaded.cache,/no-store/);
  assert.equal((await call(detail+query+'&format=csv','GET',null,cookie)).status,400);assert.equal((await call(detail+query+'&format=json&format=json','GET',null,cookie)).status,400);
  assert.equal(id,payload.requestId);assert.equal((await call(upperBase,'POST',upperPayload,cookie)).data.replayed,true);assert.equal((await call(`/api/bank/certificates/${id.toUpperCase()}?tenantId=${tenantId.toUpperCase()}&format=json`,'GET',null,cookie)).data.certificate.id,id);
  assert.equal(frozen.digest,p.digest);assert.deepEqual(frozen.snapshot,p.snapshot);assert.equal(await db.bankReconciliationCertificate.count({where:{tenantId}}),1);assert.equal(await db.auditLog.count({where:{tenantId,action:'bank-certificate.created'}}),1);
  assert.equal((await call(base,'POST',{...payload,note:'Changed request'},cookie)).status,409);
  for(const [amount,entry] of [['1.000',pastIn],['-1.000',pastOut]])await match(past.id,pastState.statement.lines.find(l=>l.amount===amount).id,entry.bankLine.id);
  await journal('LATE-RECORDED','3',before);
  assert.equal((await live(current.id)).reconciled,true);assert.deepEqual((await get()).data.certificate,frozen);assert.equal((await call(base,'POST',payload,cookie)).data.replayed,true,'uncertain retry returns original after source changed');
  const nextPreview=(await preview()).data,next=(await call(base,'POST',{...payload,requestId:randomUUID(),expectedDigest:nextPreview.digest,note:'Updated observation'},cookie)).data;
  assert.ok(next.id);const event={tenantId,requestId:randomUUID(),expectedVersion:0,action:'SUPERSEDE',replacementId:next.id,reason:'Later observed inputs'};
  assert.equal((await call(detail+'/events','POST',event,cookie)).status,201);assert.equal((await call(detail+'/events','POST',event,cookie)).data.replayed,true);assert.equal((await get()).data.supersededBy,next.id);assert.equal((await call(`/api/bank/certificates/${id.toUpperCase()}/events`,'POST',{...event,tenantId:tenantId.toUpperCase(),requestId:event.requestId.toUpperCase(),replacementId:next.id.toUpperCase()},cookie)).data.replayed,true);
  assert.equal((await call(detail+'/events','POST',{...event,reason:'Changed reason'},cookie)).status,409);
  assert.equal((await call(detail+'/events','POST',{tenantId,requestId:randomUUID(),expectedVersion:0,action:'RESTORE',reason:'Restore observation'},cookie)).status,409);
  const restore={tenantId,requestId:randomUUID(),expectedVersion:1,action:'RESTORE',reason:'Keep the earlier observation available'};
  assert.equal((await call(detail+'/events','POST',restore,cookie)).status,201);assert.equal((await call(detail+'/events','POST',restore,cookie)).data.replayed,true);assert.equal((await get()).data.supersededBy,null);assert.equal((await get()).data.version,2);assert.deepEqual((await get()).data.certificate,frozen);
  assert.equal((await call(`/api/bank/certificates/${next.id}/events`,'POST',{...event,requestId:randomUUID(),replacementId:id},cookie)).status,409,'replacement cannot be an older snapshot');
  const eventRace=await Promise.all([call(detail+'/events','POST',{...event,requestId:randomUUID(),expectedVersion:2},cookie),call(detail+'/events','POST',{...event,requestId:randomUUID(),expectedVersion:2},cookie)]);assert.deepEqual(eventRace.map(r=>r.status).sort(),[201,409]);
  assert.equal((await call(detail+'/events','POST',{...restore,requestId:randomUUID(),expectedVersion:3},cookie)).status,201);
  await assert.rejects(db.$transaction(async tx=>{const id=randomUUID(),[{transaction}]=await tx.$queryRaw`SELECT txid_current()::text AS transaction`;await tx.bankReconciliationCertificateEvent.create({data:{id,tenantId,companyId,accountId:bank.id,certificateId:created[0].data.id,sequence:5,action:'SUPERSEDE',replacementId:next.id,reason:'Missing matching audit version',requestDigest:'a'.repeat(64),createdBy:frozen.createdBy}});await tx.auditLog.create({data:{tenantId,actorId:frozen.createdBy,entity:'BankReconciliationCertificateEvent',entityId:id,action:'bank-certificate.supersede',metadata:{transaction,certificateId:created[0].data.id,sequence:1}}});}),/same-transaction audit/);
  const invite=async(type,role='Manager')=>{const invitation=await create('/api/invitations',{email:`cert-reader-${randomUUID().slice(0,8)}@example.invalid`,role,scope:{type,companyId,...(type==='BRANCH'?{branchId:branch.id}:{})}});const r=await call('/api/invitations/accept','POST',{token:invitation.path.split('/').at(-1),name:'Certificate reader',password:'Certificate-reader-password-2026'});assert.equal(r.status,200);actors.set(r.cookie,(await db.session.findUniqueOrThrow({where:{tokenHash:createHash('sha256').update(decodeURIComponent(r.cookie.split('=').slice(1).join('='))).digest('hex')}})).userId);return r.cookie;};
  const managerCookie=await invite('COMPANY'),branchCookie=await invite('BRANCH');
  assert.equal((await call(detail+query,'GET',null,managerCookie)).status,200);assert.equal((await call(base,'POST',{...payload,requestId:randomUUID()},managerCookie)).status,403);assert.equal((await call(detail+'/events','POST',{...event,requestId:randomUUID(),expectedVersion:2},managerCookie)).status,403);
  for(const url of [base+query,base+'/preview'+query,detail+query,detail+query+'&format=json'])assert.equal((await call(url,'GET',null,branchCookie)).status,403,url);
  assert.equal((await call(detail+query,'GET',null,outside.cookie)).status,403);
  const mgr=await db.role.findUnique({where:{tenantId_name:{tenantId,name:'Manager'}}});const managerActor=(await db.membership.findFirst({where:{tenantId,roleGrants:{some:{roleId:mgr.id,scopes:{some:{type:'COMPANY',companyId}}}}}})).userId;await db.rolePermission.create({data:{tenantId,roleId:mgr.id,permissionKey:'bank-reconciliation:create'}});
  // Both accounts may create/manage; a cookie switch must not claim even an uncommitted request.
  await db.rolePermission.createMany({data:[{tenantId,roleId:mgr.id,permissionKey:'bank-reconciliation:manage'}],skipDuplicates:true});
  const originalActor=actors.get(cookie),pendingCapture={...payload,requestId:randomUUID(),expectedDigest:(await preview()).data.digest};
  const pendingEvent={...event,requestId:randomUUID(),replacementId:pendingCapture.requestId,expectedVersion:0};
  for(const [url,body,model] of [[base,pendingCapture,db.bankReconciliationCertificate],[`/api/bank/certificates/${next.id}/events`,pendingEvent,db.bankReconciliationCertificateEvent]]){
   for(const [session,guard] of [[managerCookie,originalActor],[cookie,null],[cookie,'invalid']]){
    const denied=await call(url,'POST',body,session,guard);assert.equal(denied.status,409);assert.ok(['ACTOR_REQUIRED','ACTOR_MISMATCH'].includes(denied.data.code));assert.equal(denied.data.outcome,undefined);
    assert.equal(await model.count({where:{id:body.requestId}}),0);assert.equal(await db.auditLog.count({where:{entityId:body.requestId}}),0);
   }
   assert.equal((await call(url,'POST',body,cookie,originalActor)).status,201);
   const deniedReplay=await call(url,'POST',body,managerCookie,originalActor);assert.equal(deniedReplay.status,409);assert.equal(deniedReplay.data.code,'ACTOR_MISMATCH');
   assert.equal((await call(url,'POST',body,cookie,originalActor)).data.replayed,true);assert.equal(await model.count({where:{id:body.requestId}}),1);assert.equal(await db.auditLog.count({where:{entityId:body.requestId}}),1);
  }
  const delegated={...payload,requestId:randomUUID(),expectedDigest:(await preview()).data.digest};assert.equal((await call(base,'POST',delegated,managerCookie)).status,201);const switched=await call(base,'POST',delegated,cookie);assert.equal(switched.status,409,'retry cannot switch actor');assert.equal(switched.data.code,'REQUEST_CONFLICT');
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:mgr.id,permissionKey:'bank-reconciliation:create'}}});assert.equal((await call(base,'POST',delegated,managerCookie)).status,403,'revoked creation denies even exact retries');
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:mgr.id,permissionKey:'ledger:read'}}});assert.equal((await call(detail+query,'GET',null,managerCookie)).status,403,'saved document does not retain revoked read rights');assert.equal((await call(detail+query+'&format=json','GET',null,managerCookie)).status,403,'download cannot retain revoked read rights');
  await assert.rejects(db.bankReconciliationCertificate.update({where:{id},data:{note:'Altered'}}));await assert.rejects(db.bankReconciliationCertificate.delete({where:{id}}));await assert.rejects(db.bankReconciliationCertificateEvent.delete({where:{id:event.requestId}}));await assert.rejects(db.bankReconciliationCertificateEvent.update({where:{id:event.requestId},data:{reason:'Altered'}}));
  // Direct inserts cannot spoof snapshots or skip their same-transaction audit.
  const raw=await db.bankReconciliationCertificate.findUnique({where:{id:next.id}});const invalid={...raw,id:randomUUID(),observedAt:new Date(),createdAt:new Date(),transactionId:'ignored'};
  await assert.rejects(db.bankReconciliationCertificate.create({data:{...invalid,snapshot:{...raw.snapshot,summary:{...raw.summary,pendingBank:99}},summary:{...raw.summary,pendingBank:99}}}));
  await assert.rejects(db.bankReconciliationCertificate.create({data:{...invalid,id:randomUUID()}}));
  await assert.rejects(db.$transaction(async tx=>{const [{observedAt}]=await tx.$queryRaw`SELECT statement_timestamp() AS "observedAt"`;await tx.bankReconciliationCertificate.create({data:{...invalid,id:randomUUID(),observedAt,digest:'0'.repeat(64)}});}),/digest mismatch/);
  await assert.rejects(db.$transaction(async tx=>{const [{observedAt,transaction}]=await tx.$queryRaw`SELECT statement_timestamp() AS "observedAt",txid_current()::text AS transaction`;const id=randomUUID();await tx.bankReconciliationCertificate.create({data:{...invalid,id,observedAt}});await tx.auditLog.create({data:{tenantId,actorId:raw.createdBy,entity:'BankReconciliationCertificate',entityId:id,action:'bank-certificate.created',metadata:{transaction,statementId:randomUUID(),digest:raw.digest}}});}),/same-transaction audit/);
  await assert.rejects(db.bankReconciliationCertificate.create({data:{...invalid,id:randomUUID(),createdBy:managerActor}}),/company-wide permissions/);
  await assert.rejects(db.bankReconciliationCertificateEvent.create({data:{id:randomUUID(),tenantId,companyId,accountId:bank.id,certificateId:id,sequence:5,action:'SUPERSEDE',replacementId:next.id,reason:'Low-privilege actor attempt',requestDigest:'a'.repeat(64),createdBy:managerActor}}),/company-wide permissions/);
  // Tenant lock makes a waiting read see revocation rather than stale privileges.
  await db.rolePermission.create({data:{tenantId,roleId:mgr.id,permissionKey:'ledger:read'}});
  let notifyLocked,releaseLock;const locked=new Promise(r=>notifyLocked=r),release=new Promise(r=>releaseLock=r);
  const revoke=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR UPDATE`;await tx.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:mgr.id,permissionKey:'ledger:read'}}});notifyLocked();await release;});
  await locked;const waitingRead=call(detail+query,'GET',null,managerCookie);await new Promise(r=>setTimeout(r,50));releaseLock();await revoke;assert.equal((await waitingRead).status,403);
  await db.rolePermission.createMany({data:['ledger:read','bank-reconciliation:create','bank-reconciliation:manage'].map(permissionKey=>({tenantId,roleId:mgr.id,permissionKey})),skipDuplicates:true});
  const branchActor=(await db.membership.findFirst({where:{tenantId,roleGrants:{some:{roleId:mgr.id,scopes:{some:{type:'BRANCH',companyId}}}}}})).userId;
  await assert.rejects(db.bankReconciliationCertificate.create({data:{...invalid,id:randomUUID(),createdBy:branchActor}}),/company-wide permissions/);
  await assert.rejects(db.bankReconciliationCertificateEvent.create({data:{id:randomUUID(),tenantId,companyId,accountId:bank.id,certificateId:id,sequence:5,action:'SUPERSEDE',replacementId:next.id,reason:'Branch actor attempt',requestDigest:'a'.repeat(64),createdBy:branchActor}}),/company-wide permissions/);
  // Direct SQL guard must wait for the same revocation boundary as API authorization.
  const revokeDb=new PrismaClient({datasourceUrl:process.env.DIRECT_DATABASE_URL});
  let signalRaw,releaseRaw;const lockedRaw=new Promise(r=>signalRaw=r),unlockRaw=new Promise(r=>releaseRaw=r);
  const rawRevoke=revokeDb.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR UPDATE`;await tx.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:mgr.id,permissionKey:'bank-reconciliation:create'}}});signalRaw();await unlockRaw;});
  await lockedRaw;const rawPending=assert.rejects(db.bankReconciliationCertificate.create({data:{...invalid,id:randomUUID(),createdBy:managerActor}}),/company-wide permissions/);await new Promise(r=>setTimeout(r,50));releaseRaw();await rawRevoke;await rawPending;await revokeDb.$disconnect();

  const cancel=await call(`/api/bank/statements/${current.id}/matches`,'POST',{tenantId,action:'cancel',matchId:currentMatch.id,reason:'Correct bank source'},cookie);assert.equal(cancel.status,201);
  assert.equal((await call(`/api/bank/statements/${current.id}/void`,'POST',{tenantId,action:'void',reason:'Replace imported source'},cookie)).status,201);
  const replacementStatement=await statement('CURRENT-REPLACED',day,day,'100','110',[[day,'Corrected receipt','10']]);
  const voidPreview=(await preview()).data;assert.ok(voidPreview.snapshot.statement.voidedAt);assert.equal(voidPreview.snapshot.summary.reconciled,false);assert.equal(voidPreview.snapshot.bank.filter(b=>b.statementId===current.id).length,1);assert.equal(voidPreview.snapshot.bank.filter(b=>!b.statementVoidedAt&&!b.match).length,1);
  assert.equal((await call(base,'POST',{...payload,requestId:randomUUID(),expectedDigest:voidPreview.digest,note:'Retained voided-source observation'},cookie)).status,201);
  assert.deepEqual((await get()).data.certificate,frozen);
  assert.equal((await call(base+query+'&tenantId='+tenantId,'GET',null,cookie)).status,400);
  assert.equal((await call(base+query+'&unexpected=true','GET',null,cookie)).status,400);
  const page=await fetch(origin+`/accounting/bank/certificates/${id}?tenantId=${tenantId}`,{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.match(await page.text(),/FINAL|Final Arrow/);
  assert.equal((await call(base+query,'GET',null,cookie)).data.certificates.length,5);
  const replacementState=await live(replacementStatement.id);
  const [during]=await Promise.all([preview(),match(replacementStatement.id,replacementState.statement.lines[0].id,incoming.bankLine.id)]);
  assert.equal(during.status,200);const observedBank=during.data.snapshot.bank.find(b=>b.statementId===replacementStatement.id),observedBook=during.data.snapshot.book.find(b=>b.id===incoming.bankLine.id);
  assert.equal(observedBank.match?.id??null,observedBook.match?.id??null,'one capture must not combine pre-match bank data with post-match book data');assert.equal(observedBook.matchedThroughCutoff,!!observedBank.match);

 }finally{server.kill('SIGTERM');await db.$disconnect();}
});
