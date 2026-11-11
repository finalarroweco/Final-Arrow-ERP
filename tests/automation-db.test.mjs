import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),ts=require('typescript');
require.extensions['.ts']=(module,path)=>module._compile(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,path);
const {db}=require('../src/lib/db.ts');
const a=require('../src/lib/automation.ts');
const {mutateAlert}=require('../src/lib/private-alerts.ts');
const {mutateRecurringBilling}=require('../src/lib/recurring-billing.ts');
test.after(()=>db.$disconnect());
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(kind='PRIVATE_ALERT',patch={},sourcePatch={}){
 const tenant=await db.tenant.create({data:{name:'Durable automation',slug:randomUUID()}}),tenantId=tenant.id;
 const user=await db.user.create({data:{name:'Operator',email:randomUUID()+'@example.invalid',passwordHash:'not-login'}}),actorId=user.id;
 const member=await db.membership.create({data:{tenantId,userId:actorId,status:'ACTIVE'}}),role=await db.role.create({data:{tenantId,name:'Scoped operator'}});
 for(const permissionKey of ['automation:manage','ticket:read','billing-subscription:read','billing-subscription:manage','billing-subscription:generate','customer:read','invoice:read','invoice:create'])await db.rolePermission.create({data:{tenantId,roleId:role.id,permissionKey}});
 const grant=await db.roleGrant.create({data:{tenantId,membershipId:member.id,roleId:role.id}});await db.accessScope.create({data:{tenantId,grantId:grant.id,type:'TENANT'}});
 const company=await db.company.create({data:{tenantId,name:'Test',code:'AUT'}}),companyId=company.id;
 const scope={tenantId,companyId,branchId:null,expectedActorId:actorId};let sourceId=randomUUID();
 if(kind==='PRIVATE_ALERT'){
  const p={tenantId,companyId,expectedActorId:actorId,ruleId:sourceId,requestId:randomUUID(),action:'create',expectedVersion:0,config:{kind:'TICKET_DEADLINE',branchId:null,lookbackDays:1,horizonDays:1,priority:'ALL'},noticeId:null};await mutateAlert(actorId,p);await mutateAlert(actorId,{...p,config:null,requestId:randomUUID(),action:'enable',expectedVersion:1});
 }else{
  const customer=await db.customer.create({data:{tenantId,companyId,code:'C',displayName:'Customer',createdBy:actorId}}),planId=randomUUID(),today=new Date().toISOString().slice(0,10),horizon=new Date(Date.now()+40*86400000).toISOString().slice(0,10);
  await mutateRecurringBilling(actorId,{...scope,requestId:randomUUID(),reason:'Explicit fixture',action:'plan',planId,expectedVersion:0,label:'Approved',currency:'OMR',lines:[{description:'Configured service',quantity:1,unitPrice:'3.000',treatment:'ZERO'}],archived:false});
  await mutateRecurringBilling(actorId,{...scope,requestId:randomUUID(),reason:'Explicit fixture',action:'configure',subscriptionId:sourceId,customerId:customer.id,manualSubscriptionId:null,expectedVersion:0,anchor:today,cadence:{kind:'DAYS',days:1},effectivePeriod:0,planId,planVersion:1,horizon,status:'ACTIVE',terms:{kind:'NONE'},archived:false,...sourcePatch});
 }
 const preview=await a.automationSourcePreview(actorId,{...scope,kind,sourceId}),jobId=randomUUID(),config={kind,sourceId,firstPeriod:kind==='PRIVATE_ALERT'?null:0,lastPeriod:kind==='PRIVATE_ALERT'?null:2,startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),intervalHours:1,maxRuns:5,sourceFingerprint:preview.sourceFingerprint,...patch};
 const create={...scope,jobId,requestId:randomUUID(),action:'create',expectedVersion:0,config};
 const current=()=>db.automationJob.findUniqueOrThrow({where:{id:jobId}});
 const command=async(action)=>({...scope,jobId,requestId:randomUUID(),action,expectedVersion:(await current()).version,config:null});
 const run=()=>db.automationRun.findFirst({where:{jobId},orderBy:{sequence:'desc'}});
 const enable=async()=>a.mutateAutomation(actorId,await command('enable'));
 const claim=async()=>{const result=await a.claimAutomationJobs(10);const own=result.find(l=>l.jobId===jobId);assert.ok(own,JSON.stringify(result));return own;};
 return {tenantId,actorId,companyId,scope,role,member,jobId,sourceId,create,current,command,run,enable,claim};
}
test('paused opt-in creation, source rights, exact command replay/abandonment and projection guards',async()=>{
 const f=await fixture();const results=await Promise.all([a.mutateAutomation(f.actorId,f.create),a.mutateAutomation(f.actorId,f.create)]);assert.deepEqual(results[0],results[1]);assert.equal((await f.current()).state,'PAUSED');assert.equal(await f.run(),null);assert.ok(!(await a.claimAutomationJobs()).some(l=>l.jobId===f.jobId));
 await assert.rejects(a.mutateAutomation(f.actorId,{...f.create,config:{...f.create.config,maxRuns:99}}));
 const cmd=await f.command('enable');const abandoned=await a.mutateAutomation(f.actorId,cmd,true);assert.equal(abandoned.receipt.outcome,'ABANDONED');await assert.rejects(a.mutateAutomation(f.actorId,cmd));assert.equal((await f.current()).state,'PAUSED');
 for(const table of ['AutomationJob','AutomationRun','AutomationEvent'])await assert.rejects(db.$executeRawUnsafe(`TRUNCATE "${table}" CASCADE`));await assert.rejects(db.automationJob.update({where:{id:f.jobId},data:{state:'ENABLED'}}));await assert.rejects(db.automationEvent.delete({where:{id:f.create.requestId}}));
});
test('concurrent claims, saved alert identity, one atomic effect, lost response and stale fencing',async()=>{
 const f=await fixture();await a.mutateAutomation(f.actorId,f.create);await f.enable();const batches=await Promise.all([a.claimAutomationJobs(10),a.claimAutomationJobs(10)]),own=batches.flat().filter(l=>l.jobId===f.jobId);assert.equal(own.length,1);const l=own[0];await a.prepareAutomationRun(l);const saved=await f.run();assert.ok(saved.payload);await a.prepareAutomationRun(l);assert.deepEqual((await f.run()).payload,saved.payload);
 const results=await Promise.allSettled([a.executeAutomationRun(l),a.executeAutomationRun(l)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await f.run()).state,'SUCCEEDED');assert.equal(await db.privateAlertRequest.count({where:{id:saved.downstreamId}}),1);assert.equal((await db.privateAlertRule.findUnique({where:{id:f.sourceId}})).version,3);await assert.rejects(a.recordAutomationError(l));assert.equal((await f.run()).state,'SUCCEEDED');
});
test('recurring adapter produces a genuine DRAFT, permanent exact payload, no posting or duplicate effect',async()=>{
 const f=await fixture('RECURRING_DRAFT');await a.mutateAutomation(f.actorId,f.create);await f.enable();const l=await f.claim();await a.prepareAutomationRun(l);const before=await f.run();await a.executeAutomationRun(l);const source=await db.billingRequest.findUniqueOrThrow({where:{id:before.downstreamId}});assert.deepEqual(source.request,before.payload);assert.equal(await db.invoice.count({where:{tenantId:f.tenantId,status:'DRAFT'}}),1);assert.equal(await db.journalEntry.count({where:{tenantId:f.tenantId}}),0);await assert.rejects(a.executeAutomationRun(l));assert.equal(await db.invoice.count({where:{tenantId:f.tenantId}}),1);
});
test('pause and cancel serialize against leased work without undoing source effects',async()=>{
 const f=await fixture();await a.mutateAutomation(f.actorId,f.create);await f.enable();const l=await f.claim();await a.prepareAutomationRun(l);await a.mutateAutomation(f.actorId,await f.command('pause'));await assert.rejects(a.executeAutomationRun(l));assert.equal((await f.run()).state,'LEASED');await a.mutateAutomation(f.actorId,await f.command('cancel'));assert.equal((await f.run()).state,'CANCELLED');assert.equal(await db.privateAlertRequest.count({where:{id:(await f.run()).downstreamId}}),0);await assert.rejects(f.enable());
});
test('current revocation after tenant wait blocks source effects and hides all retained history',async()=>{
 const f=await fixture();await a.mutateAutomation(f.actorId,f.create);await f.enable();const l=await f.claim();await a.prepareAutomationRun(l);let locked,release;const gate=new Promise(r=>locked=r),go=new Promise(r=>release=r);const block=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${f.tenantId}::uuid FOR UPDATE`;locked();await go;await tx.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId:f.tenantId,roleId:f.role.id,permissionKey:'ticket:read'}}});},{timeout:20000});await gate;let ended=false;const pending=a.executeAutomationRun(l).then(()=>{ended=true;return true;},()=>{ended=true;return false;});await pause(100);assert.equal(ended,false);release();await block;assert.equal(await pending,false);const list=await a.listAutomation(f.actorId,{...f.scope,page:0,jobId:f.jobId});assert.deepEqual(list.jobs,[]);assert.deepEqual(list.runs,[]);assert.equal(list.nextPage,null);await a.mutateAutomation(f.actorId,await f.command('cancel'));assert.equal((await f.run()).state,'CANCELLED');
});
test('source reconfiguration requires fresh authorization and never silently changes commercial terms',async()=>{
 const f=await fixture();await a.mutateAutomation(f.actorId,f.create);await f.enable();await mutateAlert(f.actorId,{tenantId:f.tenantId,companyId:f.companyId,expectedActorId:f.actorId,ruleId:f.sourceId,requestId:randomUUID(),action:'disable',expectedVersion:2,config:null,noticeId:null});assert.ok(!(await a.claimAutomationJobs(10)).some(l=>l.jobId===f.jobId));assert.equal((await f.current()).state,'PAUSED');assert.equal((await f.current()).lastCode,'REAUTHORIZE');await assert.rejects(f.enable());
});
test('future due jobs do not execute; missed ticks coalesce into one bounded run',async()=>{
 const future=await fixture('PRIVATE_ALERT',{startsAt:new Date(Date.now()+3600000).toISOString()});await a.mutateAutomation(future.actorId,future.create);await future.enable();assert.ok(!(await a.claimAutomationJobs(10)).some(l=>l.jobId===future.jobId));await assert.rejects(a.mutateAutomation(future.actorId,await future.command('run')));
 const past=await fixture('PRIVATE_ALERT',{startsAt:new Date(Date.now()-10*86400000).toISOString(),maxRuns:1});await a.mutateAutomation(past.actorId,past.create);await past.enable();const l=await past.claim();assert.equal((await past.current()).runsUsed,1);assert.ok((await past.current()).nextDueAt>new Date());await a.prepareAutomationRun(l);await a.executeAutomationRun(l);assert.equal(await db.automationRun.count({where:{jobId:past.jobId}}),1);
});
test('runner config is separate, fail-closed and never emits credentials',async()=>{
 const before={enabled:process.env.ERP_AUTOMATION_RUNNER_ENABLED,token:process.env.ERP_AUTOMATION_RUNNER_TOKEN};try{delete process.env.ERP_AUTOMATION_RUNNER_ENABLED;delete process.env.ERP_AUTOMATION_RUNNER_TOKEN;process.env.CRON_SECRET='generic-secret';assert.deepEqual(a.automationRunnerStatus(),{enabled:false,configured:false});assert.equal(a.authorizeAutomationRunner('Bearer generic-secret'),false);await assert.rejects(a.runAutomationBatch());}finally{for(const [key,val] of Object.entries({ERP_AUTOMATION_RUNNER_ENABLED:before.enabled,ERP_AUTOMATION_RUNNER_TOKEN:before.token}))if(val===undefined)delete process.env[key];else process.env[key]=val;delete process.env.CRON_SECRET;}
});
test('provider roles denied despite permissive defaults; no public functions',async()=>{
 for(const table of ['AutomationJob','AutomationRun','AutomationEvent']){assert.equal((await db.$queryRawUnsafe('SELECT relrowsecurity AS enabled FROM pg_class WHERE oid=$1::regclass','"'+table+'"'))[0].enabled,true);for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await db.$queryRawUnsafe("SELECT has_table_privilege('public',$1,$2) AS allowed",'"'+table+'"',privilege))[0].allowed,false);}
 for(const table of ['AutomationJob','AutomationRun','AutomationEvent'])for(const role of ['anon','authenticated']){if(!(await db.$queryRawUnsafe('SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS yes',role))[0].yes)continue;for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await db.$queryRawUnsafe('SELECT has_table_privilege($1,$2,$3) AS yes',role,'"'+table+'"',p))[0].yes,false);}
 const funcs=await db.$queryRawUnsafe("SELECT p.oid::text AS id FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'erp_automation_%'");for(const f of funcs)assert.equal((await db.$queryRawUnsafe("SELECT has_function_privilege('public',$1::oid,'EXECUTE') AS yes",f.id))[0].yes,false);
});

test('SQL rejects malformed/null event fields, reconfiguration, forged scope and fences',async()=>{
 const f=await fixture();const insert=(data,jobId=f.jobId,operation='COMMAND')=>db.$queryRaw`INSERT INTO "AutomationEvent"(id,"jobId","actorId",operation,data) VALUES(${data.request?.requestId??randomUUID()}::uuid,${jobId}::uuid,${f.actorId}::uuid,${operation},${JSON.stringify(data)}::jsonb)`;
 for(const key of ['maxRuns','endsAt','startsAt','intervalHours','sourceFingerprint']){const request={...f.create,requestId:randomUUID(),config:{...f.create.config,[key]:null}};await assert.rejects(insert({request,outcome:'COMMITTED'}));}
 await a.mutateAutomation(f.actorId,f.create);await assert.rejects(insert({request:{...await f.command('enable'),expectedVersion:null},outcome:'COMMITTED'}));await assert.rejects(insert({request:{...await f.command('enable'),branchId:randomUUID()},outcome:'COMMITTED'}));await assert.rejects(insert({request:{...await f.command('enable'),config:f.create.config},outcome:'COMMITTED'}));
 await f.enable();const l=await f.claim();await a.prepareAutomationRun(l);await assert.rejects(insert({...l,fence:null,code:'COMMITTED'},f.jobId,'FINISH'));await assert.rejects(insert({...l,payload:{...(await f.run()).payload,expectedActorId:null}},f.jobId,'PREPARE'));
 await a.mutateAutomation(f.actorId,await f.command('cancel'));
});
test('a genuinely expired lease is fenced, recovered with original payload, and cannot overwrite a new attempt',{timeout:150000},async()=>{
 const f=await fixture();await a.mutateAutomation(f.actorId,f.create);await f.enable();const first=await f.claim();await a.prepareAutomationRun(first);const original=await f.run();
 // Real wall-clock boundary, not a forged database clock or disabled guard.
 await pause(Math.max(0,original.leaseUntil.getTime()-Date.now()+100));await assert.rejects(a.executeAutomationRun(first));const second=await f.claim();assert.equal(second.runId,first.runId);assert.equal(second.fence,first.fence+1);assert.notEqual(second.token,first.token);assert.deepEqual((await f.run()).payload,original.payload);await assert.rejects(a.recordAutomationError(first));await a.prepareAutomationRun(second);await a.executeAutomationRun(second);assert.equal((await f.run()).state,'SUCCEEDED');assert.equal((await f.run()).attempts,2);assert.equal(await db.privateAlertRequest.count({where:{id:original.downstreamId}}),1);
});
test('transaction failure after downstream work rolls back source plus completion; exact original request recovers',async()=>{
 const f=await fixture();await a.mutateAutomation(f.actorId,f.create);await f.enable();const l=await f.claim();await a.prepareAutomationRun(l);const saved=await f.run();
 // A temporary constraint trigger in this isolated test DB simulates a DB failure
 // at commit, after source evaluation and fenced completion were executed.
 await db.$executeRawUnsafe(`CREATE FUNCTION automation_test_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${saved.downstreamId}'::uuid THEN RAISE EXCEPTION 'synthetic commit failure';END IF;RETURN NEW;END $$`);
 await db.$executeRawUnsafe('CREATE CONSTRAINT TRIGGER automation_test_commit_failure AFTER INSERT ON "PrivateAlertRequest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION automation_test_commit_failure()');
 try{await assert.rejects(a.executeAutomationRun(l));assert.equal(await db.privateAlertRequest.count({where:{id:saved.downstreamId}}),0);assert.equal((await f.run()).state,'LEASED');assert.deepEqual((await f.run()).payload,saved.payload);}finally{await db.$executeRawUnsafe('DROP TRIGGER automation_test_commit_failure ON "PrivateAlertRequest"');await db.$executeRawUnsafe('DROP FUNCTION automation_test_commit_failure()');}
 await a.executeAutomationRun(l);assert.equal((await f.run()).state,'SUCCEEDED');assert.equal(await db.privateAlertRequest.count({where:{id:saved.downstreamId}}),1);
});
test('retry backoff persists sanitized metadata; no fresh identity or premature immediate claim',async()=>{
 const f=await fixture();await a.mutateAutomation(f.actorId,f.create);await f.enable();const l=await f.claim();await a.prepareAutomationRun(l);const saved=await f.run();await a.recordAutomationError(l);const after=await f.run();assert.equal(after.state,'RETRY');assert.ok(after.nextAttemptAt>Date.now());assert.deepEqual(after.payload,saved.payload);assert.equal(after.downstreamId,saved.downstreamId);assert.equal(after.code,'RETRY_REQUIRED');assert.ok(!(await a.claimAutomationJobs(10)).some(x=>x.jobId===f.jobId));await a.mutateAutomation(f.actorId,await f.command('cancel'));
});

test('two separately authorized jobs for the same period cannot duplicate a DRAFT, including existing VOID periods',async()=>{
 const f=await fixture('RECURRING_DRAFT');await a.mutateAutomation(f.actorId,f.create);await f.enable();const second={...f.create,jobId:randomUUID(),requestId:randomUUID()};await a.mutateAutomation(f.actorId,second);await a.mutateAutomation(f.actorId,{...second,action:'enable',config:null,requestId:randomUUID(),expectedVersion:1});
 const leases=(await a.claimAutomationJobs(10)).filter(l=>[f.jobId,second.jobId].includes(l.jobId));assert.equal(leases.length,2);
 const first=leases[0];await a.prepareAutomationRun(first);await a.executeAutomationRun(first);const invoice=await db.invoice.findFirstOrThrow({where:{tenantId:f.tenantId}});await db.invoice.update({where:{id:invoice.id},data:{status:'VOID'}});
 const other=leases[1];assert.equal((await a.prepareAutomationRun(other)).prepared,false);const saved=await db.automationRun.findUniqueOrThrow({where:{id:other.runId}});assert.equal(saved.code,'GENERATED');assert.equal(saved.state,'SKIPPED');assert.equal(await db.invoice.count({where:{tenantId:f.tenantId}}),1);assert.equal((await db.invoice.findUnique({where:{id:invoice.id}})).status,'VOID');
});
test('subscription and plan configuration changes plus raw VAT content changes pause the authorized job',async()=>{
 const f=await fixture('RECURRING_DRAFT');await a.mutateAutomation(f.actorId,f.create);await f.enable();await db.companyVatProfile.create({data:{tenantId:f.tenantId,companyId:f.companyId,enabled:false}});assert.ok(!(await a.claimAutomationJobs(10)).some(l=>l.jobId===f.jobId));assert.equal((await f.current()).lastCode,'REAUTHORIZE');
 const g=await fixture('RECURRING_DRAFT');await db.companyVatProfile.create({data:{tenantId:g.tenantId,companyId:g.companyId,enabled:false}});const pre=await a.automationSourcePreview(g.actorId,{...g.scope,sourceId:g.sourceId,kind:'RECURRING_DRAFT'});g.create.config.sourceFingerprint=pre.sourceFingerprint;await a.mutateAutomation(g.actorId,g.create);await g.enable();await db.companyVatProfile.update({where:{companyId:g.companyId},data:{sellerName:'Changed without revision increment'}});assert.ok(!(await a.claimAutomationJobs(10)).some(l=>l.jobId===g.jobId));assert.equal((await g.current()).state,'PAUSED');
});
test('own job/history remains tenant/branch isolated and membership suspension blocks commands and execution',async()=>{
 const f=await fixture();await a.mutateAutomation(f.actorId,f.create);await f.enable();const l=await f.claim();await a.prepareAutomationRun(l);const sibling=await db.branch.create({data:{tenantId:f.tenantId,companyId:f.companyId,name:'Sibling',code:'B'}});assert.equal((await a.listAutomation(f.actorId,{...f.scope,branchId:sibling.id,page:0})).jobs.length,0);const foreign=await fixture();assert.equal((await a.listAutomation(foreign.actorId,{...foreign.scope,companyId:f.companyId,tenantId:f.tenantId,page:0}).catch(()=>({jobs:[]}))).jobs.length,0);
 await db.membership.update({where:{id:f.member.id},data:{status:'SUSPENDED'}});await assert.rejects(a.executeAutomationRun(l));await assert.rejects(a.mutateAutomation(f.actorId,await f.command('cancel')));await assert.rejects(a.mutateAutomation(f.actorId,{...f.create,requestId:randomUUID()},true));await assert.rejects(a.listAutomation(f.actorId,{...f.scope,page:0}));
});

test('past billing periods require separate backfill and are only skipped; future periods consume finite budget',async()=>{
 const past=new Date(Date.now()-3*86400000).toISOString().slice(0,10),f=await fixture('RECURRING_DRAFT',{maxRuns:1},{anchor:past});await a.mutateAutomation(f.actorId,f.create);await f.enable();const l=await f.claim();assert.equal((await a.prepareAutomationRun(l)).prepared,false);assert.equal((await f.run()).code,'BACKFILL_REQUIRED');assert.equal((await f.current()).state,'COMPLETED');assert.equal(await db.invoice.count({where:{tenantId:f.tenantId}}),0);
 const g=await fixture('RECURRING_DRAFT',{firstPeriod:1,lastPeriod:2,maxRuns:1});await a.mutateAutomation(g.actorId,g.create);await g.enable();const future=await g.claim();assert.equal((await a.prepareAutomationRun(future)).prepared,false);assert.equal((await g.run()).code,'FUTURE');assert.equal((await g.current()).cursor,1);assert.equal((await g.current()).state,'COMPLETED');assert.equal(await db.invoice.count({where:{tenantId:g.tenantId}}),0);
});

test('simultaneously prepared same-period jobs retain both UUIDs while skipping the competing committed source',async()=>{
 const f=await fixture('RECURRING_DRAFT');await a.mutateAutomation(f.actorId,f.create);await f.enable();const second={...f.create,jobId:randomUUID(),requestId:randomUUID()};await a.mutateAutomation(f.actorId,second);await a.mutateAutomation(f.actorId,{...second,action:'enable',config:null,requestId:randomUUID(),expectedVersion:1});const leases=(await a.claimAutomationJobs(10)).filter(l=>[f.jobId,second.jobId].includes(l.jobId));assert.equal(leases.length,2);await Promise.all(leases.map(l=>a.prepareAutomationRun(l)));const originals=await db.automationRun.findMany({where:{jobId:{in:[f.jobId,second.jobId]}}});await Promise.all(leases.map(l=>a.executeAutomationRun(l)));assert.equal(await db.invoice.count({where:{tenantId:f.tenantId}}),1);const finished=await db.automationRun.findMany({where:{jobId:{in:[f.jobId,second.jobId]}}});assert.deepEqual(finished.map(r=>r.state).sort(),['SKIPPED','SUCCEEDED']);for(const old of originals){const source=await db.billingRequest.findUniqueOrThrow({where:{id:old.downstreamId}});assert.deepEqual(source.request,old.payload);}assert.deepEqual((await db.billingRequest.findMany({where:{id:{in:originals.map(r=>r.downstreamId)}}})).map(r=>r.outcome).sort(),['ABANDONED','COMMITTED']);
});

test('an abandoned saved downstream UUID never executes; a committed original receipt is recovered without duplicates',async()=>{
 const f=await fixture('RECURRING_DRAFT');await a.mutateAutomation(f.actorId,f.create);await f.enable();const l=await f.claim();await a.prepareAutomationRun(l);const saved=await f.run();await mutateRecurringBilling(f.actorId,saved.payload,true);await assert.rejects(a.executeAutomationRun(l));assert.equal(await db.invoice.count({where:{tenantId:f.tenantId}}),0);await a.mutateAutomation(f.actorId,await f.command('cancel'));
 const g=await fixture('RECURRING_DRAFT');await a.mutateAutomation(g.actorId,g.create);await g.enable();const lease=await g.claim();await a.prepareAutomationRun(lease);const retained=await g.run();await mutateRecurringBilling(g.actorId,retained.payload);await a.executeAutomationRun(lease);assert.equal((await g.run()).state,'SUCCEEDED');assert.equal(await db.invoice.count({where:{tenantId:g.tenantId}}),1);assert.equal(await db.billingRequest.count({where:{id:retained.downstreamId}}),1);
});
