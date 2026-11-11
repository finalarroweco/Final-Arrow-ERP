import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('local HTTP opt-in, durable queue, protected runner, source execution, history and current session',{timeout:300000},async()=>{
 const db=new PrismaClient(),port=3326,origin=`http://127.0.0.1:${port}`;
 // Synthetic ephemeral credential for this loopback-only child. Never written to
 // settings/files, reused elsewhere, or printed. This does not activate a scheduler.
 const credential=randomBytes(32).toString('hex');
 const url=new URL(process.env.DATABASE_URL);url.searchParams.set('connection_limit',process.env.AUTOMATION_POOL_LIMIT??'8');
 const server=spawn('./node_modules/.bin/next',['start','-H','127.0.0.1','-p',String(port)],{env:{...process.env,DATABASE_URL:url.toString(),ALLOW_REGISTRATION:'true',ERP_AUTOMATION_RUNNER_ENABLED:'true',ERP_AUTOMATION_RUNNER_TOKEN:credential},stdio:['ignore','ignore','inherit']});
 async function call(path,method='GET',body,cookie,headers={}){const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};}
 try{
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await pause(250);}assert.ok(ready);
 const slug='auto-'+randomUUID().slice(0,8),registered=await call('/api/auth/register','POST',{name:slug,email:slug+'@example.invalid',password:'Automation-2026-test',organization:slug,slug});assert.equal(registered.status,201,JSON.stringify(registered));const cookie=registered.cookie,tenantId=registered.data.tenantId,actorId=(await db.membership.findFirstOrThrow({where:{tenantId}})).userId;
 const co=await call('/api/companies','POST',{tenantId,name:'Automation company',code:'AUT',baseCurrency:'OMR'},cookie);assert.equal(co.status,201,JSON.stringify(co));const companyId=co.data.company.id;
 const scope={tenantId,companyId,branchId:null,expectedActorId:actorId},query=new URLSearchParams({...scope,branchId:'company',page:'0'}),endpoint='/api/automation';
 const list=()=>call(endpoint+'?'+query,'GET',undefined,cookie),post=p=>call(endpoint,'POST',p,cookie);
 assert.equal((await call(endpoint+'?'+query)).status,401);assert.deepEqual((await list()).data.jobs,[]);assert.deepEqual((await list()).data.runner,{enabled:true,configured:true});
 const page=await call('/automation','GET',undefined,cookie);assert.equal(page.status,200);assert.ok(typeof page.data==='string'&&!page.data.includes(credential));
 const ruleId=randomUUID(),rule={tenantId,companyId,expectedActorId:actorId,requestId:randomUUID(),ruleId,action:'create',expectedVersion:0,noticeId:null,config:{kind:'TICKET_DEADLINE',branchId:null,lookbackDays:1,horizonDays:1,priority:'ALL'}};
 assert.equal((await call('/api/private-alerts','POST',rule,cookie)).status,201);assert.equal((await call('/api/private-alerts','POST',{...rule,requestId:randomUUID(),action:'enable',expectedVersion:1,config:null},cookie)).status,201);
 const preview=await call(endpoint+'/preview','POST',{...scope,sourceId:ruleId,kind:'PRIVATE_ALERT'},cookie);assert.equal(preview.status,200,JSON.stringify(preview));assert.equal(preview.data.authorization.ruleVersion,2);
 const config={kind:'PRIVATE_ALERT',sourceId:ruleId,firstPeriod:null,lastPeriod:null,startsAt:new Date(Date.now()-5000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),intervalHours:1,maxRuns:1,sourceFingerprint:preview.data.sourceFingerprint};
 const command={...scope,requestId:randomUUID(),jobId:randomUUID(),action:'create',expectedVersion:0,config};const created=await Promise.all([post(command),post(command)]);assert.ok(created.every(r=>r.status===201),JSON.stringify(created));assert.deepEqual(created[0].data,created[1].data);assert.equal((await list()).data.jobs[0].state,'PAUSED');
 assert.equal((await post({...command,extra:true})).status,400);assert.equal((await post({...command,config:{...config,maxRuns:null},requestId:randomUUID(),jobId:randomUUID()})).status,400);assert.equal((await call(endpoint,'POST',command,cookie,{Origin:'https://other.invalid'})).status,403);
 const enable={...command,requestId:randomUUID(),action:'enable',expectedVersion:1,config:null};assert.equal((await post(enable)).status,201);assert.equal((await call(endpoint+'/runner','POST',undefined,cookie)).status,401);assert.equal((await call(endpoint+'/runner','GET')).status,405);assert.equal((await call(endpoint+'/runner','POST',undefined,undefined,{Authorization:'Bearer '+credential,Origin:origin})).status,403);
 const before=await db.privateAlertRequest.count({where:{ruleId}});await list();await call('/automation','GET',undefined,cookie);assert.equal(await db.privateAlertRequest.count({where:{ruleId}}),before,'page/read does not evaluate');
 const batch=await call(endpoint+'/runner','POST',undefined,undefined,{Authorization:'Bearer '+credential});assert.equal(batch.status,200,JSON.stringify(batch));assert.equal(batch.data.completed,1);assert.equal(await db.privateAlertRequest.count({where:{ruleId}}),before+1);assert.equal((await list()).data.jobs[0].state,'COMPLETED');
 const hist=await call(endpoint+'?'+query+'&jobId='+command.jobId,'GET',undefined,cookie);assert.equal(hist.status,200);assert.equal(hist.data.runs[0].state,'SUCCEEDED');for(const word of ['downstreamId','payload','leaseToken','tokenHash',credential])assert.ok(!JSON.stringify(hist.data).includes(word));
 assert.equal((await call(endpoint+'/runner','POST',undefined,undefined,{Authorization:'Bearer '+credential})).data.claimed,0);const resolved=await call(endpoint+'/resolve','POST',enable,cookie);assert.equal(resolved.status,200);assert.equal(resolved.data.receipt.outcome,'COMMITTED');
 const pending={...command,requestId:randomUUID(),jobId:randomUUID()};assert.equal((await call(endpoint+'/resolve','POST',pending,cookie)).data.receipt.outcome,'ABANDONED');assert.equal((await post(pending)).status,409);
 const other=await db.user.create({data:{email:randomUUID()+'@example.invalid',name:'Other',passwordHash:'not-login'}});await db.membership.create({data:{tenantId,userId:other.id,status:'ACTIVE'}});assert.equal((await post({...command,expectedActorId:other.id})).status,403);
 // Hold job before a new command, revoke its browser session while it waits.
 const newJob={...command,jobId:randomUUID(),requestId:randomUUID(),config:{...config,sourceFingerprint:(await call(endpoint+'/preview','POST',{...scope,kind:'PRIVATE_ALERT',sourceId:ruleId},cookie)).data.sourceFingerprint}};assert.equal((await post(newJob)).status,201);
 let held,release;const locked=new Promise(r=>held=r),go=new Promise(r=>release=r);const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "AutomationJob" WHERE id=${newJob.jobId}::uuid FOR UPDATE`;held();await go;},{timeout:20000});await locked;
 const request=post({...newJob,action:'enable',config:null,requestId:randomUUID(),expectedVersion:1});await pause(150);await db.session.deleteMany({where:{userId:actorId}});release();await blocker;assert.equal((await request).status,401);assert.equal((await db.automationJob.findUnique({where:{id:newJob.jobId}})).state,'PAUSED');assert.equal((await list()).status,401);
 }finally{server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));await db.$disconnect();}
});

test('missing dedicated runner configuration stays HTTP fail-closed despite a generic cron setting',{timeout:60000},async()=>{
 const port=3327,origin=`http://127.0.0.1:${port}`,server=spawn('./node_modules/.bin/next',['start','-H','127.0.0.1','-p',String(port)],{env:{...process.env,ERP_AUTOMATION_RUNNER_ENABLED:'false',ERP_AUTOMATION_RUNNER_TOKEN:'',CRON_SECRET:'synthetic-local-generic-not-authority'},stdio:['ignore','ignore','inherit']});
 try{let ready=false;for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await pause(250);}assert.ok(ready);const result=await fetch(origin+'/api/automation/runner',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-local-generic-not-authority'}});assert.equal(result.status,503);assert.equal((await result.json()).error,'Automation runner is disabled or unconfigured');}finally{server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
});
