import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Prisma,PrismaClient} from '@prisma/client';
const origin='http://127.0.0.1:3227',actors=new Map();
async function call(path,method='GET',body,cookie,expectedActor=actors.get(cookie)){const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(expectedActor&&/\/(statements|matches|void|requests\/(?:check|abandon))$/.test(path)?{'X-Expected-Actor-Id':expectedActor}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
test('bank statements and matches are exact, immutable, scoped, reversible and balance-aware',{timeout:90000},async()=>{
 const db=new PrismaClient(),server=spawn('./node_modules/.bin/next',['start',"-H", "127.0.0.1", '-p','3227'],{env:{...process.env,ALLOW_REGISTRATION:'true'},stdio:['ignore','ignore','inherit']});
 try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  async function owner(){const s=randomUUID().slice(0,8),r=await call('/api/auth/register','POST',{name:'Bank QA',email:`bank-${s}@example.invalid`,password:'Bank-reconciliation-2026',organization:'Bank QA',slug:`bank-${s}`});assert.equal(r.status,201);actors.set(r.cookie,(await db.membership.findFirstOrThrow({where:{tenantId:r.data.tenantId}})).userId);return r;}
  const actor=await owner(),outsider=await owner(),tenantId=actor.data.tenantId,cookie=actor.cookie;
  const create=async(path,body)=>{const r=await call(path,'POST',{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const {company}=await create('/api/companies',{name:'Bank company',code:'BANK',baseCurrency:'OMR'}),companyId=company.id;
  const {branch}=await create('/api/branches',{companyId,name:'Main',code:'MAIN'});
  const account=async(code,type)=>(await create('/api/ledger/accounts',{companyId,code,name:code,type})).account;
  const bank=await account('1010','ASSET'),otherBank=await account('1020','ASSET'),revenue=await account('4000','REVENUE');
  const day=new Date().toISOString().slice(0,10),before=new Date(Date.parse(day)-86400000).toISOString().slice(0,10),after=new Date(Date.parse(day)+86400000).toISOString().slice(0,10),future=new Date(Date.parse(day)+172800000).toISOString().slice(0,10);
  async function journal(number,amount,date=day,accountId=bank.id){const incoming=!amount.startsWith('-'),abs=amount.replace('-','');const {entry}=await create('/api/ledger/journals',{companyId,branchId:branch.id,number,entryDate:date,description:number,lines:[{accountId,debit:incoming?abs:'0',credit:incoming?'0':abs},{accountId:revenue.id,debit:incoming?'0':abs,credit:incoming?abs:'0'}]});return {...entry,bankLine:entry.lines.find(l=>l.accountId===accountId)};}
  const opening=await journal('BANK-OPEN','100',before),pastIn=await journal('BANK-PAST-IN','1',before),pastOut=await journal('BANK-PAST-OUT','-1',before),receipt=await journal('BANK-IN','10.125'),payment=await journal('BANK-OUT','-3.125'),transitIn=await journal('BANK-TRANSIT-IN','2'),transitOut=await journal('BANK-TRANSIT-OUT','-1'),other=await journal('BANK-OTHER','10.125',day,otherBank.id),futureEntry=await journal('BANK-FUTURE','10.125',future);
  async function viewer(type){const email=`bank-view-${randomUUID().slice(0,8)}@example.invalid`,invite=await create('/api/invitations',{email,role:'Viewer',scope:{type,companyId,...(type==='BRANCH'?{branchId:branch.id}:{})}});const r=await call('/api/invitations/accept','POST',{token:invite.path.split('/').at(-1),name:'Bank viewer',password:'Bank-viewer-password-2026'});assert.equal(r.status,200);actors.set(r.cookie,(await db.user.findUniqueOrThrow({where:{email}})).id);return r.cookie;}
  const viewerCookie=await viewer('COMPANY'),branchCookie=await viewer('BRANCH'),viewerRole=await db.role.findUnique({where:{tenantId_name:{tenantId,name:'Viewer'}}});await db.rolePermission.create({data:{tenantId,roleId:viewerRole.id,permissionKey:'ledger:read'}});
  const payload={tenantId,companyId,requestId:randomUUID(),accountId:bank.id,reference:'BANK-CURRENT',from:day,to:after,opening:'100.000',closing:'107.000',lines:[{bookingDate:day,reference:'Bank receipt',amount:'10.125'},{bookingDate:after,reference:'Bank payment',amount:'-3.125'}]};
  assert.equal((await call('/api/bank/statements','POST',payload)).status,401);assert.equal((await call('/api/bank/statements','POST',payload,outsider.cookie)).status,403);assert.equal((await call('/api/bank/statements','POST',payload,viewerCookie)).status,403);assert.equal((await call(`/api/bank/statements?tenantId=${tenantId}&companyId=${companyId}`,'GET',undefined,branchCookie)).status,403);
  for(const changed of [{closing:'108'},{lines:[{bookingDate:before,reference:'Outside dates',amount:'7'}]},{lines:[{bookingDate:day,reference:'Zero movement',amount:'0'}]},{from:after,to:day}])assert.equal((await call('/api/bank/statements','POST',{...payload,...changed},cookie)).status,400);
  assert.equal((await call('/api/bank/statements','POST',{...payload,accountId:revenue.id},cookie)).status,404);
  const ownerId=actors.get(cookie);
  assert.equal((await call('/api/bank/statements','POST',payload,cookie,null)).data.code,'ACTOR_REQUIRED');
  assert.equal((await call('/api/bank/statements','POST',payload,cookie,'malformed')).data.code,'ACTOR_REQUIRED');
  // Two sessions with equal company-level write access still cannot claim each other's intended imports.
  await db.rolePermission.create({data:{tenantId,roleId:viewerRole.id,permissionKey:'ledger:post'}});
  assert.equal((await call('/api/bank/statements','POST',payload,viewerCookie,ownerId)).data.code,'ACTOR_MISMATCH');
  assert.equal(await db.bankStatement.count({where:{id:payload.requestId}}),0);
  const check=(data=payload,who=cookie,expected=actors.get(who))=>call('/api/bank/statements/requests/check','POST',data,who,expected);
  assert.equal((await check()).data.outcome,'UNKNOWN');assert.equal(await db.bankStatement.count({where:{id:payload.requestId}}),0);
  assert.equal((await check(payload,viewerCookie,ownerId)).data.code,'ACTOR_MISMATCH');
  const duplicated=await Promise.all([call('/api/bank/statements','POST',payload,cookie),call('/api/bank/statements','POST',payload,cookie)]);assert.ok(duplicated.every(r=>r.status===201),JSON.stringify(duplicated));assert.equal(duplicated[0].data.id,duplicated[1].data.id);const id=duplicated[0].data.id,path=`/api/bank/statements/${id}`;
  const importReceipt=duplicated[0].data,stored=await db.bankStatement.findUniqueOrThrow({where:{id}});
  const legacyNormalized={...payload,opening:new Prisma.Decimal(payload.opening).toFixed(3),closing:new Prisma.Decimal(payload.closing).toFixed(3),lines:payload.lines.map(l=>({...l,amount:new Prisma.Decimal(l.amount).toFixed(3)}))};assert.equal(stored.requestHash,createHash('sha256').update(JSON.stringify(legacyNormalized)).digest('hex'),'original actorless payload digest remains the immutable replay identity');
  for(const key of ['tenantId','companyId','accountId','requestHash','createdBy'])assert.equal(importReceipt[key],stored[key]);assert.equal(importReceipt.actorId,ownerId);assert.equal(importReceipt.requestId,id);
  const bodyBefore=JSON.stringify(await db.bankStatement.findUniqueOrThrow({where:{id},include:{lines:true}}));
  for(let attempt=0;attempt<3;attempt++){const replay=await call('/api/bank/statements','POST',payload,cookie);assert.equal(replay.status,201);assert.equal(replay.data.replayed,true);assert.equal(replay.data.requestHash,importReceipt.requestHash);assert.equal(replay.data.createdBy,ownerId);}
  const outcome=await check();assert.equal(outcome.status,200);assert.equal(outcome.data.outcome,'COMMITTED');assert.deepEqual(outcome.data.result,{...importReceipt,replayed:true});
  assert.equal((await call('/api/bank/statements','POST',payload,viewerCookie)).data.code,'REQUEST_CONFLICT');
  assert.equal((await check(payload,viewerCookie)).data.code,'REQUEST_CONFLICT');
  assert.equal(JSON.stringify(await db.bankStatement.findUniqueOrThrow({where:{id},include:{lines:true}})),bodyBefore);
  assert.equal(await db.auditLog.count({where:{tenantId,entity:'BankStatement',entityId:id,action:'bank-statement.imported'}}),1);
  assert.equal((await check({...payload,reference:'Changed exact request'})).status,409);
  const membership=await db.membership.findUniqueOrThrow({where:{tenantId_userId:{tenantId,userId:ownerId}}});await db.membership.update({where:{id:membership.id},data:{status:'SUSPENDED'}});
  assert.equal((await check()).status,403);assert.equal((await call('/api/bank/statements','POST',payload,cookie)).status,403);await db.membership.update({where:{id:membership.id},data:{status:'ACTIVE'}});
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:viewerRole.id,permissionKey:'ledger:post'}}});
  assert.equal((await call('/api/bank/statements','POST',{...payload,closing:'108',lines:[{bookingDate:day,reference:'Other receipt',amount:'8'}]},cookie)).status,409);
  assert.equal((await call('/api/bank/statements','POST',{...payload,requestId:randomUUID(),reference:'OVERLAP'},cookie)).status,409);
  // Permanent abandonment is a request fence, never a statement reversal.
  const abandon=(data=payload,who=cookie,expected=actors.get(who))=>call('/api/bank/statements/requests/abandon','POST',data,who,expected);
  const pending={...payload,requestId:randomUUID(),reference:'UNCOMMITTED-OVERLAP'};
  assert.equal((await call('/api/bank/statements','POST',pending,cookie)).status,409);
  assert.equal((await check(pending)).data.outcome,'UNKNOWN');
  assert.equal(await db.bankStatementImportCancellation.count({where:{id:pending.requestId}}),0,'read-only check must not create a fence');
  assert.equal((await abandon(pending,null)).status,401);
  assert.equal((await abandon(pending,cookie,null)).data.code,'ACTOR_REQUIRED');
  assert.equal((await abandon(pending,cookie,'malformed')).data.code,'ACTOR_REQUIRED');
  assert.equal((await abandon(pending,viewerCookie,ownerId)).data.code,'ACTOR_MISMATCH','actual cookie switch is fenced');
  assert.equal((await abandon(pending,viewerCookie)).status,403,'read permission alone cannot abandon');
  assert.equal((await abandon(pending,branchCookie)).status,403);
  assert.equal((await abandon(pending,outsider.cookie)).status,403);
  assert.equal((await abandon({...pending,extra:'not allowed'})).status,400);
  assert.equal((await abandon({...pending,closing:'108.000'})).status,400);
  const financialSnapshot=async()=>JSON.stringify(await Promise.all([
   db.bankStatement.findMany({where:{tenantId},orderBy:{id:'asc'}}),db.bankStatementLine.findMany({where:{tenantId},orderBy:{id:'asc'}}),
   db.bankMatch.findMany({where:{tenantId},orderBy:{id:'asc'}}),db.journalEntry.findMany({where:{tenantId},orderBy:{id:'asc'}}),
   db.journalLine.findMany({where:{tenantId},orderBy:{id:'asc'}}),db.ledgerAccount.findMany({where:{tenantId},orderBy:{id:'asc'}}),
   db.bankReconciliationCertificate.findMany({where:{tenantId},orderBy:{id:'asc'}}),db.bankReconciliationCertificateEvent.findMany({where:{tenantId},orderBy:{id:'asc'}})
  ]));
  const beforeAbandon=await financialSnapshot();
  const abandoned=await abandon(pending);assert.equal(abandoned.status,200,JSON.stringify(abandoned));assert.equal(abandoned.data.outcome,'ABANDONED');
  const tombstone=await db.bankStatementImportCancellation.findUniqueOrThrow({where:{id:pending.requestId}}),abandonedReceipt=abandoned.data.result;
  const normalizedPending={...pending,opening:new Prisma.Decimal(pending.opening).toFixed(3),closing:new Prisma.Decimal(pending.closing).toFixed(3),lines:pending.lines.map(l=>({...l,amount:new Prisma.Decimal(l.amount).toFixed(3)}))};
  assert.equal(tombstone.requestHash,createHash('sha256').update(JSON.stringify(normalizedPending)).digest('hex'));
  for(const key of ['tenantId','companyId','accountId','requestHash','createdBy','auditId'])assert.equal(abandonedReceipt[key],tombstone[key]);
  assert.equal(abandonedReceipt.requestId,pending.requestId);assert.equal(abandonedReceipt.actorId,ownerId);assert.equal(abandonedReceipt.createdBy,ownerId);assert.equal(abandonedReceipt.cancelledAt,tombstone.cancelledAt.toISOString());
  // Losing the first response does not require resending an import or making a new UUID.
  for(let i=0;i<3;i++){const replay=await abandon(pending);assert.equal(replay.status,200);assert.deepEqual(replay.data,abandoned.data);}
  const observedAbandon=await check(pending);assert.equal(observedAbandon.status,200);assert.deepEqual(observedAbandon.data,abandoned.data);
  assert.equal(await db.auditLog.count({where:{id:tombstone.auditId}}),1);
  assert.equal((await call('/api/bank/statements','POST',pending,cookie)).data.code,'REQUEST_ABANDONED','late original import is blocked');
  for(const changed of [{reference:'CHANGED-PENDING'},{accountId:otherBank.id},{opening:'101.000',closing:'108.000'}]){
   const altered={...pending,...changed};assert.equal((await abandon(altered)).data.code,'REQUEST_CONFLICT');assert.equal((await check(altered)).data.code,'REQUEST_CONFLICT');
   assert.equal((await call('/api/bank/statements','POST',altered,cookie)).data.code,'REQUEST_CONFLICT','UUID fence survives changed payload/account without revealing another request outcome');
  }
  await db.rolePermission.create({data:{tenantId,roleId:viewerRole.id,permissionKey:'ledger:post'}});
  assert.equal((await abandon(pending,viewerCookie)).status,409,'another permitted actor cannot claim the tombstone');
  assert.equal((await check(pending,viewerCookie)).status,409);
  const viewerPending={...pending,requestId:randomUUID(),reference:'VIEWER-OWN-ABANDONMENT'};
  const viewerAbandoned=await abandon(viewerPending,viewerCookie);assert.equal(viewerAbandoned.status,200);assert.equal(viewerAbandoned.data.outcome,'ABANDONED');
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:viewerRole.id,permissionKey:'ledger:post'}}});
  assert.equal((await db.membership.findUniqueOrThrow({where:{tenantId_userId:{tenantId,userId:actors.get(viewerCookie)}}})).status,'ACTIVE');
  assert.equal((await abandon(viewerPending,viewerCookie)).status,403,'abandoned replay requires current post permission even with active membership and read permission');
  assert.equal((await call('/api/bank/statements','POST',viewerPending,viewerCookie)).status,403,'late import also requires current post permission');
  const readOnlyAbandoned=await check(viewerPending,viewerCookie);assert.equal(readOnlyAbandoned.status,200);assert.deepEqual(readOnlyAbandoned.data,viewerAbandoned.data,'read-only check still observes own exact tombstone after post-only revocation');
  await db.membership.update({where:{id:membership.id},data:{status:'SUSPENDED'}});
  assert.equal((await abandon(pending)).status,403,'terminal replay still requires current authorization');assert.equal((await check(pending)).status,403);
  await db.membership.update({where:{id:membership.id},data:{status:'ACTIVE'}});
  const largePending={...payload,requestId:randomUUID(),reference:'تجربة UTF-8 🏦',opening:'-0',closing:'0.000',lines:Array.from({length:500},(_,i)=>({bookingDate:day,reference:`حركة ${i}`,amount:i%2?'-0.001':'0.001'}))};
  const largeResult=await abandon(largePending);assert.equal(largeResult.status,200);assert.equal(largeResult.data.outcome,'ABANDONED');
  const largeNormalized={...largePending,opening:new Prisma.Decimal(largePending.opening).toFixed(3),closing:new Prisma.Decimal(largePending.closing).toFixed(3),lines:largePending.lines.map(l=>({...l,amount:new Prisma.Decimal(l.amount).toFixed(3)}))};
  assert.equal(largeResult.data.result.requestHash,createHash('sha256').update(JSON.stringify(largeNormalized)).digest('hex'),'500 UTF-8 movements, negative zero and exact decimals retain original digest parity');
  assert.equal((await check(largePending)).data.result.requestHash,largeResult.data.result.requestHash);
  const committedAbandon=await abandon();assert.equal(committedAbandon.status,200);assert.equal(committedAbandon.data.outcome,'COMMITTED');assert.deepEqual(committedAbandon.data.result,{...importReceipt,replayed:true});
  assert.equal(await db.bankStatementImportCancellation.count({where:{id}}),0,'committed request never receives a tombstone');
  assert.equal(await financialSnapshot(),beforeAbandon,'abandonment does not change statements, allocations, journals, balances or certificates');
  const get=()=>call(path+`?tenantId=${tenantId}`,'GET',undefined,cookie);let state=(await get()).data;assert.equal(state.bookClosing,'108.000');assert.equal(state.reconciled,false);assert.equal(state.pendingBank,2);assert.equal((await call(path+`?tenantId=${tenantId}`,'GET',undefined,viewerCookie)).status,200);assert.equal((await call(path+`?tenantId=${tenantId}`,'GET',undefined,branchCookie)).status,403);
  const bankIn=state.statement.lines.find(l=>l.amount==='10.125'),bankOut=state.statement.lines.find(l=>l.amount==='-3.125'),match={tenantId,action:'match',requestId:randomUUID(),bankLineId:bankIn.id,journalLineId:receipt.bankLine.id};
  assert.equal((await call(path+'/matches','POST',match,viewerCookie)).status,403);
  for(const line of [payment.bankLine,other.bankLine,futureEntry.bankLine])assert.ok([404,409].includes((await call(path+'/matches','POST',{...match,journalLineId:line.id},cookie)).status));
  await assert.rejects(db.bankMatch.create({data:{id:randomUUID(),tenantId,companyId,accountId:bank.id,bankLineId:bankIn.id,journalLineId:payment.bankLine.id,createdBy:opening.createdBy}}));
  const racing=await Promise.all([call(path+'/matches','POST',match,cookie),call(path+'/matches','POST',{...match,requestId:randomUUID()},cookie)]);assert.deepEqual(racing.map(r=>r.status).sort(),[201,409]);const saved=racing.find(r=>r.status===201).data.match;const retry={...match,requestId:saved.id};assert.equal((await call(path+'/matches','POST',retry,cookie)).status,201);assert.equal((await call(path+'/matches','POST',{...retry,journalLineId:transitIn.bankLine.id},cookie)).status,409);
  assert.equal((await call(path+'/matches','POST',{tenantId,action:'match',requestId:randomUUID(),bankLineId:bankOut.id,journalLineId:payment.bankLine.id},cookie)).status,201);
  state=(await get()).data;assert.equal(state.pendingBank,0);assert.equal(state.difference,'-100.000');assert.equal(state.reconciled,false);
  const past=await create('/api/bank/statements',{...payload,requestId:randomUUID(),reference:'BANK-OPENING',from:before,to:before,opening:'0',closing:'100',lines:[{bookingDate:before,reference:'Opening deposit',amount:'100'},{bookingDate:before,reference:'Past in',amount:'1'},{bookingDate:before,reference:'Past out',amount:'-1'}]});const pastPath=`/api/bank/statements/${past.id}`,pastState=(await call(pastPath+`?tenantId=${tenantId}`,'GET',undefined,cookie)).data;
  for(const [amount,entry] of [['100.000',opening]])assert.equal((await call(pastPath+'/matches','POST',{tenantId,action:'match',requestId:randomUUID(),bankLineId:pastState.statement.lines.find(l=>l.amount===amount).id,journalLineId:entry.bankLine.id},cookie)).status,201);
  state=(await get()).data;assert.equal(state.bookClosing,'108.000');assert.equal(state.outstandingTotal,'1.000');assert.equal(state.adjustedBank,'108.000');assert.equal(state.difference,'0.000');assert.equal(state.pendingBank,2);assert.equal(state.reconciled,false,'zero difference cannot hide unmatched earlier offsetting bank movements');
  for(const [amount,entry] of [['1.000',pastIn],['-1.000',pastOut]])assert.equal((await call(pastPath+'/matches','POST',{tenantId,action:'match',requestId:randomUUID(),bankLineId:pastState.statement.lines.find(l=>l.amount===amount).id,journalLineId:entry.bankLine.id},cookie)).status,201);
  state=(await get()).data;assert.equal(state.pendingBank,0);assert.equal(state.reconciled,true);assert.equal(state.outstanding.length,2);assert.ok(state.outstanding.some(l=>l.id===transitOut.bankLine.id));
  assert.equal((await call(pastPath+'/matches','POST',retry,cookie)).status,409,'exact retries cannot move to another statement');
  await assert.rejects(db.bankMatch.update({where:{id:saved.id},data:{cancelledAt:new Date(),cancelledBy:opening.createdBy,cancelReason:null}}));
  const cancel={tenantId,action:'cancel',matchId:saved.id,reason:'Wrong bank reference'};const cancelled=await call(path+'/matches','POST',cancel,cookie);assert.equal(cancelled.status,201);assert.ok(cancelled.data.match.cancelledAt);assert.equal((await call(path+'/matches','POST',cancel,cookie)).status,201);assert.equal((await call(path+'/matches','POST',{...cancel,reason:'Changed cancellation'},cookie)).status,409);assert.equal((await call(path+'/matches','POST',retry,cookie)).data.match.cancelledAt,cancelled.data.match.cancelledAt);assert.equal((await get()).data.pendingBank,1);assert.equal((await get()).data.reconciled,false);
  const rematched=await call(path+'/matches','POST',{...match,requestId:randomUUID()},cookie);assert.equal(rematched.status,201);assert.equal((await get()).data.reconciled,true);
  await assert.rejects(db.bankMatch.delete({where:{id:saved.id}}));await assert.rejects(db.bankMatch.update({where:{id:saved.id},data:{cancelledAt:null,cancelledBy:null,cancelReason:null}}));await assert.rejects(db.bankStatement.update({where:{id},data:{reference:'Changed'}}));await assert.rejects(db.bankStatementLine.update({where:{id:bankIn.id},data:{amount:'11'}}));await assert.rejects(db.$transaction(async tx=>{await tx.bankStatementLine.createMany({data:[{id:randomUUID(),tenantId,companyId,accountId:bank.id,statementId:id,position:3,bookingDate:new Date(day),reference:'Late positive',amount:'1'},{id:randomUUID(),tenantId,companyId,accountId:bank.id,statementId:id,position:4,bookingDate:new Date(day),reference:'Late negative',amount:'-1'}]});}));
  const badId=randomUUID();await assert.rejects(db.$transaction(async tx=>{await tx.bankStatement.create({data:{id:badId,tenantId,companyId,accountId:otherBank.id,reference:'BAD-TOTAL',from:new Date(day),to:new Date(day),opening:'0',closing:'5',currency:'OMR',requestHash:'a'.repeat(64),createdBy:opening.createdBy}});}));assert.equal(await db.bankStatement.count({where:{id:badId}}),0);
  assert.equal((await call('/api/ledger/period-lock','PATCH',{tenantId,companyId,lockedThrough:after,expectedLockedThrough:null,reason:'Close bank book period'},cookie)).status,200);assert.equal((await call(path+'/matches','POST',{...cancel,matchId:rematched.data.match.id},cookie)).status,201,'a fresh cancellation works after ledger period close');assert.equal((await call(path+'/matches','POST',{...match,requestId:randomUUID()},cookie)).status,201,'a fresh match works after ledger period close');
  for(const url of ['/accounting/bank',`/accounting/bank/${id}`]){const r=await fetch(origin+url,{headers:{Cookie:cookie}});assert.equal(r.status,200,url);assert.match(await r.text(),/FINAL|Final Arrow/);}
  assert.equal((await fetch(origin+`/accounting/bank/${id}`,{headers:{Cookie:branchCookie}})).status,404);
  const voidBody={tenantId,action:'void',reason:'Correct imported statement reference'};
  assert.equal((await call(path+'/void','POST',voidBody,viewerCookie)).status,403);assert.equal((await call(path+'/void','POST',voidBody,cookie)).status,409);
  state=(await get()).data;for(const line of state.statement.lines)for(const m of line.matches.filter(m=>!m.cancelledAt))assert.equal((await call(path+'/matches','POST',{tenantId,action:'cancel',matchId:m.id,reason:'Replace incorrect statement'},cookie)).status,201);
  await assert.rejects(db.bankStatement.update({where:{id},data:{voidedAt:new Date(),voidedBy:opening.createdBy,voidReason:null}}));
  assert.equal((await call(path+'/void','POST',voidBody,cookie)).status,201);assert.equal((await call(path+'/void','POST',voidBody,cookie)).status,201);assert.equal((await call(path+'/void','POST',{...voidBody,reason:'Changed void reason'},cookie)).status,409);
  assert.equal((await call(path+'/matches','POST',{...match,requestId:randomUUID()},cookie)).status,409);await assert.rejects(db.bankMatch.create({data:{id:randomUUID(),tenantId,companyId,accountId:bank.id,bankLineId:bankIn.id,journalLineId:receipt.bankLine.id,createdBy:opening.createdBy}}));
  await assert.rejects(db.bankStatement.update({where:{id},data:{voidedAt:null,voidedBy:null,voidReason:null}}));await assert.rejects(db.bankStatement.delete({where:{id}}));
  const voidedReplay=await abandon();assert.equal(voidedReplay.status,200);assert.equal(voidedReplay.data.outcome,'COMMITTED');assert.deepEqual(voidedReplay.data.result,{...importReceipt,replayed:true});assert.equal(await db.bankStatementImportCancellation.count({where:{id}}),0);
  state=(await get()).data;assert.ok(state.statement.voidedAt);assert.equal(state.reconciled,false);assert.equal(state.pendingBank,0);
  assert.equal((await call('/api/bank/statements','POST',{...payload,requestId:randomUUID()},cookie)).status,409,'voided references remain reserved');
  const replacement=await create('/api/bank/statements',{...payload,requestId:randomUUID(),reference:'BANK-CORRECTED'});assert.notEqual(replacement.id,id);assert.equal((await get()).data.pendingBank,2);assert.equal(await db.bankStatement.count({where:{tenantId}}),3);
  assert.equal(await db.auditLog.count({where:{tenantId,action:'bank-statement.imported'}}),3);assert.equal(await db.auditLog.count({where:{tenantId,action:'bank-match.cancelled'}}),4);assert.equal(await db.auditLog.count({where:{tenantId,action:'bank-statement.voided'}}),1);assert.equal(await db.bankMatch.count({where:{tenantId}}),7);
  // UUID identity is case-insensitive; the original payload bytes/digest are not.
  // This operator has only a company-scoped grant, so uppercase company identity
  // must also match its stored lowercase scope without broadening permissions.
  await db.rolePermission.create({data:{tenantId,roleId:viewerRole.id,permissionKey:'ledger:post'}});
  const uppercase={tenantId:tenantId.toUpperCase(),companyId:companyId.toUpperCase(),requestId:randomUUID().toUpperCase(),accountId:otherBank.id.toUpperCase(),reference:'UPPERCASE-UUID-IMPORT',from:day,to:after,opening:'0.000',closing:'0.000',lines:[]};
  const upperImported=await call('/api/bank/statements','POST',uppercase,viewerCookie);assert.equal(upperImported.status,201,JSON.stringify(upperImported));
  for(const key of ['tenantId','companyId','accountId','requestId'])assert.equal(upperImported.data[key],uppercase[key].toLowerCase());
  assert.equal(upperImported.data.requestHash,createHash('sha256').update(JSON.stringify(uppercase)).digest('hex'),'uppercase UUID spelling remains in the original normalized digest');
  const upperReplay=await call('/api/bank/statements','POST',uppercase,viewerCookie);assert.equal(upperReplay.status,201);assert.deepEqual(upperReplay.data,{...upperImported.data,replayed:true});
  for(const result of [await check(uppercase,viewerCookie),await abandon(uppercase,viewerCookie)]){assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.outcome,'COMMITTED');assert.deepEqual(result.data.result,upperReplay.data);}
  const lowercaseBody=body=>({...body,tenantId:body.tenantId.toLowerCase(),companyId:body.companyId.toLowerCase(),requestId:body.requestId.toLowerCase(),accountId:body.accountId.toLowerCase()});
  const recasedCommitted=lowercaseBody(uppercase);
  for(const result of [await call('/api/bank/statements','POST',recasedCommitted,viewerCookie),await check(recasedCommitted,viewerCookie),await abandon(recasedCommitted,viewerCookie)])assert.equal(result.data.code,'REQUEST_CONFLICT','changing only UUID spelling changes the immutable digest');
  const upperPending={...uppercase,requestId:randomUUID().toUpperCase(),reference:'UPPERCASE-UUID-ABANDONMENT'};
  assert.equal((await call('/api/bank/statements','POST',upperPending,viewerCookie)).status,409,'overlapping uppercase request remains uncommitted');
  assert.equal((await check(upperPending,viewerCookie)).data.outcome,'UNKNOWN');
  const upperAbandoned=await abandon(upperPending,viewerCookie);assert.equal(upperAbandoned.status,200,JSON.stringify(upperAbandoned));assert.equal(upperAbandoned.data.outcome,'ABANDONED');
  for(const key of ['tenantId','companyId','accountId','requestId'])assert.equal(upperAbandoned.data.result[key],upperPending[key].toLowerCase());
  assert.equal(upperAbandoned.data.result.requestHash,createHash('sha256').update(JSON.stringify(upperPending)).digest('hex'));
  for(const result of [await check(upperPending,viewerCookie),await abandon(upperPending,viewerCookie)]){assert.equal(result.status,200);assert.deepEqual(result.data,upperAbandoned.data);}
  assert.equal((await call('/api/bank/statements','POST',upperPending,viewerCookie)).data.code,'REQUEST_ABANDONED');
  const recasedAbandoned=lowercaseBody(upperPending);
  for(const result of [await call('/api/bank/statements','POST',recasedAbandoned,viewerCookie),await check(recasedAbandoned,viewerCookie),await abandon(recasedAbandoned,viewerCookie)])assert.equal(result.data.code,'REQUEST_CONFLICT');
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:viewerRole.id,permissionKey:'ledger:post'}}});
 }finally{server.kill('SIGTERM');await db.$disconnect();}
});
