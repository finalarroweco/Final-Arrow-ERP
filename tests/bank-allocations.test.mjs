import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
const origin='http://127.0.0.1:3264',actors=new Map();
async function call(path,method='GET',body,cookie,expected=actors.get(cookie)){
 const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(expected?{'X-Expected-Actor-Id':expected}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
test('explicit bank allocations preserve capacity, cutoff residuals, identity and correction history',{timeout:150000},async()=>{
 const db=new PrismaClient(),observer=new PrismaClient(),server=spawn('./node_modules/.bin/next',['start','-H','127.0.0.1','-p','3264'],{env:{...process.env,ALLOW_REGISTRATION:'true',DATABASE_URL:`${process.env.DATABASE_URL}&application_name=bank_allocation_api`},stdio:['ignore','ignore','inherit']});
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  const tag=randomUUID().slice(0,8),owner=await call('/api/auth/register','POST',{name:'Allocation QA',email:`allocation-${tag}@example.invalid`,password:'Allocation-QA-password-2026',organization:'Allocation QA',slug:`allocation-${tag}`});assert.equal(owner.status,201);
  const tenantId=owner.data.tenantId,cookie=owner.cookie,actor=(await db.membership.findFirstOrThrow({where:{tenantId}})).userId;actors.set(cookie,actor);
  const create=async(path,data)=>{const r=await call(path,'POST',{tenantId,...data},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const {company}=await create('/api/companies',{name:'Allocation company',code:'ALLOC',baseCurrency:'OMR'}),companyId=company.id;
  const {branch}=await create('/api/branches',{companyId,name:'Main',code:'MAIN'});
  const bank=(await create('/api/ledger/accounts',{companyId,code:'1010',name:'Bank',type:'ASSET'})).account,revenue=(await create('/api/ledger/accounts',{companyId,code:'4000',name:'Revenue',type:'REVENUE'})).account;
  async function journal(number,amount,date='2026-04-01',accountId=bank.id){const neg=amount.startsWith('-'),abs=amount.replace('-','');const {entry}=await create('/api/ledger/journals',{companyId,branchId:branch.id,number,entryDate:date,description:number,lines:[{accountId,debit:neg?'0':abs,credit:neg?abs:'0'},{accountId:revenue.id,debit:neg?abs:'0',credit:neg?'0':abs}]});return entry.lines.find(l=>l.accountId===accountId);}
  const live=async id=>{const r=await call(`/api/bank/statements/${id}?tenantId=${tenantId}`,'GET',null,cookie);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
  async function statement(reference,date,amounts,opening='0',closing,accountId=bank.id){const sum=amounts.reduce((n,a)=>n+BigInt(a.replace('.','')),0n);assert.ok(sum!==undefined);const s=await create('/api/bank/statements',{companyId,requestId:randomUUID(),accountId,reference,from:date,to:date,opening,closing,lines:amounts.map((amount,i)=>({bookingDate:date,reference:`${reference}-${i}`,amount}))});return {id:s.id,...await live(s.id)};}
  const a=await journal('ALLOC-A','10.000'),b=await journal('ALLOC-B','5.000'),out=await journal('OUT','-6.000'),future=await journal('FUTURE','1.000','2026-04-03');
  const first=await statement('FIRST','2026-04-01',['6.000','3.000','-4.000'],'0','5.000'),second=await statement('SECOND','2026-04-02',['6.000','-2.000'],'5.000','9.000');
  const uppercaseRead=await call(`/api/bank/statements/${first.id.toUpperCase()}?tenantId=${tenantId.toUpperCase()}`,'GET',null,cookie);assert.equal(uppercaseRead.status,200);assert.equal(uppercaseRead.data.statement.tenantId,tenantId);assert.equal(uppercaseRead.data.statement.lines.length,first.statement.lines.length);
  const path=id=>`/api/bank/statements/${id}/matches`;
  const payload=(bankLineId,journalLineId,amount)=>({tenantId,action:'allocate',requestId:randomUUID(),bankLineId,journalLineId,amount});
  const allocate=async(id,p)=>{const r=await call(path(id),'POST',p,cookie);assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.actorId,actor);assert.equal(r.data.statementId,id);return r.data.match;};
  const p=payload(first.statement.lines[0].id,a.id,'4.000');
  assert.equal((await call(path(first.id),'POST',p,cookie,null)).data.code,'ACTOR_REQUIRED');assert.equal((await call(path(first.id),'POST',p,cookie,randomUUID())).data.code,'ACTOR_MISMATCH');
  for(const amount of ['0','-1','0.0001','1000000000000000'])assert.equal((await call(path(first.id),'POST',{...p,amount},cookie)).status,400);
  for(const journalLineId of [out.id,future.id])assert.equal((await call(path(first.id),'POST',{...p,journalLineId},cookie)).status,409);
  assert.equal((await call(path(first.id),'POST',{...p,action:'match',amount:undefined},cookie)).status,409,'legacy unequal full match remains rejected');
  const dupe=await Promise.all([call(path(first.id),'POST',p,cookie),call(path(first.id.toUpperCase()),'POST',{...p,tenantId:tenantId.toUpperCase(),requestId:p.requestId.toUpperCase(),amount:'4'},cookie,actor.toUpperCase())]);assert.ok(dupe.every(r=>r.status===201),JSON.stringify(dupe));assert.equal(dupe.filter(r=>r.data.replayed).length,1);
  const resolve=(id,request,who=cookie)=>call(`/api/bank/statements/${id}/requests/resolve`,'POST',{tenantId,request},who);
  const existing=await resolve(first.id,p);assert.equal(existing.status,200,JSON.stringify(existing.data));assert.equal(existing.data.outcome,'committed');assert.equal(existing.data.result.match.id,p.requestId);
  assert.equal((await call(path(first.id),'POST',{...p,amount:'3'},cookie)).status,409);
  await allocate(first.id,payload(first.statement.lines[0].id,b.id,'2')); // one bank -> two books
  await allocate(first.id,payload(first.statement.lines[1].id,a.id,'3')); // one book -> two banks
  await allocate(first.id,payload(first.statement.lines[2].id,out.id,'4'));
  await allocate(second.id,payload(second.statement.lines[0].id,a.id,'3'));
  await allocate(second.id,payload(second.statement.lines[0].id,b.id,'3'));
  await allocate(second.id,payload(second.statement.lines[1].id,out.id,'2'));
  let current=await live(second.id);assert.equal(current.pendingBank,0);assert.equal(current.outstandingTotal,'0.000');assert.equal(current.reconciled,true);
  let earlier=await live(first.id);assert.equal(earlier.outstandingTotal,'4.000');assert.equal(earlier.pendingBank,0);assert.equal(earlier.reconciled,true);
  const residual=earlier.outstanding.find(l=>l.id===a.id);assert.equal(residual.amount,'10.000');assert.equal(residual.allocatedAmount,'10.000');assert.equal(residual.remainingAmount,'0.000');assert.equal(residual.cutoffRemainingAmount,'3.000');
  assert.equal((await call(path(first.id),'POST',payload(first.statement.lines[1].id,a.id,'0.001'),cookie)).status,409,'earlier-cutoff outstanding never reoffers consumed capacity');
  const captured=await call(`/api/bank/statements/${first.id}/certificates/preview?tenantId=${tenantId}`,'GET',null,cookie);assert.equal(captured.status,200);assert.equal(captured.data.snapshot.version,2);assert.deepEqual(captured.data.snapshot.summary.outstandingTotal,earlier.outstandingTotal);
  const cancel={tenantId,action:'cancel',requestId:randomUUID(),matchId:p.requestId,reason:'Correct the allocation source'};
  const cancelled=await call(path(first.id),'POST',cancel,cookie);assert.equal(cancelled.status,201);assert.equal(cancelled.data.match.cancelledBy,actor);
  assert.equal((await call(path(first.id),'POST',p,cookie)).data.match.cancelledAt,cancelled.data.match.cancelledAt);
  assert.equal((await call(path(first.id),'POST',{...cancel,reason:'different reason'},cookie)).status,409);
  assert.equal((await resolve(first.id,cancel)).data.outcome,'committed');
  assert.equal((await call(path(first.id),'POST',{...cancel,matchId:first.statement.lines[0].id},cookie)).status,409,'committed cancellation UUID binds target');
  assert.equal((await call(path(first.id),'POST',{...p,requestId:cancel.requestId},cookie)).status,409,'cancel UUID cannot become allocation');
  const history=(await live(first.id)).statement.lines[0].matches;assert.equal(history.length,2);assert.equal(history.filter(m=>m.cancelledAt).length,1);
  // A suspended member cannot replay old allocations or corrections.
  const membership=await db.membership.findUniqueOrThrow({where:{tenantId_userId:{tenantId,userId:actor}}});await db.membership.update({where:{id:membership.id},data:{status:'SUSPENDED'}});
  assert.equal((await call(path(first.id),'POST',p,cookie)).status,403);assert.equal((await call(path(first.id),'POST',cancel,cookie)).status,403);await db.membership.update({where:{id:membership.id},data:{status:'ACTIVE'}});
  // Revocation locks the tenant without updating its row. Reader must authorize
  // after the wait using a fresh snapshot, then capture sources in one statement.
  let locked,release;const held=new Promise(r=>locked=r),finish=new Promise(r=>release=r);
  const revoke=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR UPDATE`;await tx.membership.update({where:{id:membership.id},data:{status:'SUSPENDED'}});locked();await finish;},{timeout:15000});
  await held;const read=call(`/api/bank/statements/${first.id}?tenantId=${tenantId}`,'GET',null,cookie);let waiting=false;for(let i=0;i<200;i++){const [activity]=await observer.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='bank_allocation_api' AND wait_event_type='Lock' AND query LIKE '%Tenant%FOR SHARE%'`;if(activity.count>0){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}release();await revoke;assert.ok(waiting,'Reader must demonstrably wait on tenant authorization lock');assert.equal((await read).status,403,'post-lock authorization must see committed revocation');await db.membership.update({where:{id:membership.id},data:{status:'ACTIVE'}});
  const abandoned=payload(first.statement.lines[0].id,a.id,'5.000');assert.equal((await call(path(first.id),'POST',abandoned,cookie)).status,409);
  const resolved=await resolve(first.id,abandoned);assert.equal(resolved.status,200,JSON.stringify(resolved.data));assert.equal(resolved.data.outcome,'abandoned');assert.equal((await resolve(first.id,abandoned)).data.requestDigest,resolved.data.requestDigest);
  assert.equal((await call(path(first.id),'POST',abandoned,cookie)).data.code,'REQUEST_ABANDONED');
  await allocate(first.id,{...p,requestId:randomUUID()});
  // Millis and racing current capacity, outgoing included.
  const raceBook=await journal('RACE','1.001','2026-04-04'),raceBook2=await journal('RACE2','1.001','2026-04-04');
  const race=await statement('RACE','2026-04-04',['1.001','1.001'],'9','11.002');
  const races=await Promise.all([call(path(race.id),'POST',payload(race.statement.lines[0].id,raceBook.id,'1.001'),cookie),call(path(race.id),'POST',payload(race.statement.lines[0].id,raceBook2.id,'1.001'),cookie)]);assert.deepEqual(races.map(r=>r.status).sort(),[201,409]);
  const used=races.find(r=>r.status===201).data.match,remainingBook=used.journalLineId===raceBook.id?raceBook2:raceBook;
  assert.equal((await call(path(race.id),'POST',payload(race.statement.lines[1].id,used.journalLineId,'0.001'),cookie)).status,409);
  await allocate(race.id,payload(race.statement.lines[1].id,remainingBook.id,'0.001'));let partial=await live(race.id);assert.equal(partial.pendingBank,1);assert.equal(partial.statement.lines[1].remainingAmount,'1.000');
  // Offset incomplete movements cannot turn pending into a reconciled state.
  const offset=await statement('OFFSET','2026-04-05',['1.000','-1.000'],'11.002','11.002');assert.ok((await live(offset.id)).pendingBank>=2);
  // Void then exact replay is still the original cancelled receipt.
  const raceLive=await live(race.id);for(const line of raceLive.statement.lines)for(const m of line.matches.filter(m=>!m.cancelledAt))assert.equal((await call(path(race.id),'POST',{tenantId,action:'cancel',matchId:m.id,reason:'Void race fixture'},cookie)).status,201);
  const voidRequest={tenantId,action:'void',requestId:randomUUID(),reason:'Void race fixture'},voided=await call(`/api/bank/statements/${race.id}/void`,'POST',voidRequest,cookie);assert.equal(voided.status,201);assert.equal(voided.data.actorId,actor);assert.equal((await resolve(race.id,voidRequest)).data.outcome,'committed');assert.equal((await call(`/api/bank/statements/${first.id}/void`,'POST',voidRequest,cookie)).status,409);
  assert.equal((await call(path(race.id),'POST',{tenantId,action:'allocate',requestId:used.id,bankLineId:used.bankLineId,journalLineId:used.journalLineId,amount:'1.001'},cookie)).status,201);
  assert.equal((await call(path(race.id),'POST',payload(used.bankLineId,used.journalLineId,'1'),cookie)).status,409);
  const racingRequest=payload(offset.statement.lines[0].id,raceBook.id,'1.000'),recoveryRace=await Promise.all([call(path(offset.id),'POST',racingRequest,cookie),resolve(offset.id,racingRequest)]);
  assert.equal(recoveryRace[1].status,200,JSON.stringify(recoveryRace));
  if(recoveryRace[1].data.outcome==='abandoned'){assert.equal(recoveryRace[0].status,409);assert.equal(await db.bankMatch.count({where:{id:racingRequest.requestId}}),0);}else{assert.equal(recoveryRace[0].status,201);assert.equal(recoveryRace[1].data.result.match.id,racingRequest.requestId);}
  // Ledger locks do not prohibit non-journal reconciliation.
  assert.equal((await call('/api/ledger/period-lock','PATCH',{tenantId,companyId,lockedThrough:'2026-04-05',expectedLockedThrough:null,reason:'Close period'},cookie)).status,200);
  const newOut=await journal('UNUSED', '1.000','2026-04-06');assert.ok(newOut);
  assert.equal((await call(path(first.id),'POST',{tenantId,action:'cancel',matchId:p.requestId,reason:cancel.reason},cookie)).status,201);
  assert.equal((await db.journalLine.findUniqueOrThrow({where:{id:a.id}})).debit.toFixed(3),'10.000');assert.equal((await db.bankStatementLine.findUniqueOrThrow({where:{id:first.statement.lines[0].id}})).amount.toFixed(3),'6.000');
 }finally{server.kill('SIGTERM');await db.$disconnect();await observer.$disconnect();}
});
