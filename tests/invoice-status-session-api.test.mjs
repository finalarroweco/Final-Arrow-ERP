import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
const logoutPort=3337,logoutOrigin=`http://127.0.0.1:${logoutPort}`,port=3326,origin=`http://127.0.0.1:${port}`,pause=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,method='GET',body,cookie,base=origin){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const expect=(r,status)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
test('invoice lifecycle revalidates the exact session after invoice and project waits',{timeout:240000},async()=>{
 const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1','Disposable loopback database required');url.searchParams.set('connection_limit',process.env.INVOICE_STATUS_POOL_LIMIT??'8');const applicationName='invoice-session-'+randomUUID();url.searchParams.set('application_name',applicationName);
 const logoutUrl=new URL(url);logoutUrl.searchParams.set('connection_limit','1');logoutUrl.searchParams.set('application_name',applicationName+'-logout');
 const db=new PrismaClient(),server=spawn('./node_modules/.bin/next',['start','-H','127.0.0.1','-p',String(port)],{env:{...process.env,DATABASE_URL:url.toString(),ALLOW_REGISTRATION:'true'},stdio:['ignore','ignore','inherit']});
 // A second real app instance must be able to revoke the browser session while
 // the first instance's sole connection is blocked on the external row barrier.
 // Awaiting logout on that same pool would deadlock the test's release protocol.
 const logoutServer=spawn('./node_modules/.bin/next',['start','-H','127.0.0.1','-p',String(logoutPort)],{env:{...process.env,DATABASE_URL:logoutUrl.toString(),ALLOW_REGISTRATION:'true'},stdio:['ignore','ignore','inherit']});
 try{
 for(const base of [origin,logoutOrigin]){let ready=false;for(let n=0;n<120;n++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await pause(250);}assert.ok(ready,'production server ready: '+base);}
 console.log(`Lifecycle app pool ${url.searchParams.get('connection_limit')}; independent logout app pool 1`);
 const suffix=randomUUID().slice(0,8),registration=await call('/api/auth/register','POST',{name:'Session lifecycle',email:`invoice-session-${suffix}@example.invalid`,password:'Invoice-session-QA-2026',organization:'Session lifecycle QA',slug:`invoice-session-${suffix}`});
 const {tenantId}=expect(registration,201),cookie=registration.cookie,actorId=(await db.membership.findFirstOrThrow({where:{tenantId}})).userId;
 const create=async(path,body)=>expect(await call(path,'POST',{tenantId,...body},cookie),201);
 const {company}=await create('/api/companies',{name:'Session company',code:'SESSION',baseCurrency:'OMR'}),companyId=company.id;
 const {customer}=await create('/api/customers',{companyId,code:'CUSTOMER',displayName:'Session customer'});
 const {project}=await create('/api/projects',{companyId,code:'PROJECT',name:'Session project'});
 expect(await call(`/api/projects/${project.id}`,'PATCH',{tenantId,action:'activate'},cookie),200);
 const scope={tenantId,companyId,branchId:null,projectId:project.id,expectedActorId:actorId};let counter=0;
 async function makeInvoice(kind){
 if(kind==='order'){
  const number='SESSION-'+(++counter),{quote}=await create('/api/quotes',{companyId,customerId:customer.id,number:'Q-'+number,lines:[{description:'Explicit service',quantity:1,unitPrice:'10.000'}]});
  for(const action of ['send','accept'])expect(await call(`/api/quotes/${quote.id}/status`,'PATCH',{tenantId,action},cookie),200);
  const {order}=await create(`/api/quotes/${quote.id}/order`,{number:'O-'+number});
  for(const action of ['start','complete'])expect(await call(`/api/orders/${order.id}/status`,'PATCH',{tenantId,action},cookie),200);
  return (await create(`/api/orders/${order.id}/invoice`,{number})).invoice.id;
 }

 if(kind==='time'){
 const {employee}=await create('/api/employees',{companyId,code:'TIME-'+(++counter),fullName:'Approved time operator'}),today=new Date().toISOString().slice(0,10),timePath=`/api/projects/${project.id}/time`;
 const {entry}=await create(timePath,{employeeId:employee.id,workDate:today,minutes:60,description:'Explicit source time'});expect(await call(timePath+'/reviews','POST',{tenantId,requestId:randomUUID(),entryId:entry.id,expectedSequence:0,state:'APPROVED',reason:'Explicit approved source'},cookie),201);
 const selection={...scope,customerId:customer.id,currency:'OMR',entries:[{entryId:entry.id,expectedSequence:1,hourlyRate:'10.000',treatment:'EXEMPT'}],paymentTerms:null,paymentDueDate:null,replacesSourceId:null},view=expect(await call('/api/project-time-invoices/preview','POST',selection,cookie),200);
 return expect(await call('/api/project-time-invoices','POST',{...selection,requestId:randomUUID(),previewHash:view.previewHash,reason:'Exact approved time source'},cookie),200).result.invoice.id;
 }
 const milestoneId=randomUUID(),definition={...scope,requestId:randomUUID(),milestoneId,kind:'CREATE',description:'Explicit milestone',customerId:customer.id,currency:'OMR',agreedPrice:'10.000',treatment:'EXEMPT',paymentTerms:null,paymentDueDate:null,reason:'Session regression agreement'};
 expect(await call('/api/project-milestones','POST',definition,cookie),200);
 for(const [kind,expectedSequence] of [['COMPLETE',0],['APPROVE',1]])expect(await call('/api/project-milestones','POST',{...scope,requestId:randomUUID(),milestoneId,kind,expectedSequence,reason:'Explicit review'},cookie),200);
 const selection={...scope,milestoneId,expectedSequence:2,customerId:customer.id,currency:'OMR',agreedPrice:'10.000',treatment:'EXEMPT',paymentTerms:null,paymentDueDate:null,replacesSourceId:null};
 const view=expect(await call('/api/project-milestone-invoices/preview','POST',selection,cookie),200);
 return expect(await call('/api/project-milestone-invoices','POST',{...selection,requestId:randomUUID(),previewHash:view.previewHash,reason:'Session regression draft'},cookie),200).result.invoice.id;
 }
 async function session(ttl=3600000){const token=randomBytes(32).toString('hex'),row=await db.session.create({data:{userId:actorId,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+ttl)}});return {id:row.id,cookie:'fa_erp_session='+token};}
 async function waitRace(kind,action,invalidate,lockKind='invoice'){
 const id=await makeInvoice(kind),s=await session(lockKind==='session'&&invalidate==='expire'?4000:3600000);
 if(action==='void')expect(await call(`/api/invoices/${id}/status`,'PATCH',{tenantId,action:'issue'},cookie),200);
 const original=action==='issue'?'DRAFT':'ISSUED',auditAction=action==='issue'?'invoice.issued':'invoice.voided';
 let release,signal;const gate=new Promise(r=>release=r),acquired=new Promise(r=>signal=r);
 const holding=db.$transaction(async tx=>{if(lockKind==='project')await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${project.id}::uuid FOR UPDATE`;else if(lockKind==='session')await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${s.id}::uuid FOR UPDATE`;else await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id=${id}::uuid FOR UPDATE`;signal();await gate;},{timeout:20000});
 await acquired;
 try{
 const pending=call(`/api/invoices/${id}/status`,'PATCH',{tenantId,action,...(action==='void'?{reason:'Session regression void'}:{})},s.cookie);
 let waited=false;for(let n=0;n<100;n++){const rows=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=${applicationName} AND wait_event_type='Lock' AND (query LIKE '%Project%' OR query LIKE '%Invoice%' OR query LIKE '%Session%') AND pid<>pg_backend_pid()`;if(rows.length){waited=true;break;}await pause(25);}assert.ok(waited,`${kind}/${action}/${lockKind} actually waited`);
 if(lockKind==='session'&&invalidate==='expire'){
 // No UPDATE while holding the session: exercise passage of time across the
 // SHARE wait without relying on PostgreSQL's concurrent-update recheck.
 await pause(4500);
 }
 if(invalidate==='expire'&&lockKind!=='session')await db.session.update({where:{id:s.id},data:{expiresAt:new Date(Date.now()-60000)}});
 if(invalidate==='logout'){
 expect(await call('/api/auth/logout','POST',{},s.cookie,logoutOrigin),200);
 assert.equal(await db.session.count({where:{id:s.id}}),0,'HTTP logout removed exact session before barrier release');
 }
 // Raw database revocation deliberately models a grant change during the wait;
 // the public role API serializes on Tenant and cannot overtake its SHARE lock.
 let revoked;
 if(invalidate==='actionGrant'||invalidate==='sourceGrant'){
 const role=await db.role.findUniqueOrThrow({where:{tenantId_name:{tenantId,name:'Owner'}}});
 const permissionKey=invalidate==='sourceGrant'?'project-milestone:read':`invoice:${action}`;
 revoked=await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:role.id,permissionKey}}});
 }
 release();await holding;const response=await pending;
 const vulnerable=process.env.INVOICE_SESSION_REPRO==='1';expect(response,invalidate==='valid'||vulnerable?200:revoked?403:401);
 assert.equal((await db.invoice.findUniqueOrThrow({where:{id}})).status,invalidate==='valid'||vulnerable?(action==='issue'?'ISSUED':'VOID'):original);
 assert.equal(await db.auditLog.count({where:{tenantId,entity:'Invoice',entityId:id,action:auditAction}}),invalidate==='valid'||vulnerable?1:0);
 if(revoked)await db.rolePermission.create({data:revoked});
 console.log(`${vulnerable?'REPRO':'VERIFIED'} ${kind}/${action}/${lockKind}/${invalidate}: HTTP ${response.status}`);
 if(!vulnerable&&invalidate!=='valid'){
 // A fresh authorized session can perform the unchanged transition. Repeated lifecycle actions stay conflicts.
 expect(await call(`/api/invoices/${id}/status`,'PATCH',{tenantId,action,...(action==='void'?{reason:'Recovered with valid session'}:{})},cookie),200);
 expect(await call(`/api/invoices/${id}/status`,'PATCH',{tenantId,action,...(action==='void'?{reason:'Recovered with valid session'}:{})},cookie),409);
 }
 }finally{release();await holding;}
 }
 for(const kind of ['order','milestone'])for(const action of ['issue','void'])for(const invalidation of ['expire','logout'])await waitRace(kind,action,invalidation);
 for(const action of ['issue','void'])for(const invalidation of ['expire','logout','actionGrant','sourceGrant','valid'])await waitRace('milestone',action,invalidation,'project');
 for(const action of ['issue','void'])await waitRace('milestone',action,'valid');
 if(process.env.INVOICE_SESSION_REPRO!=='1')for(const action of ['issue','void'])for(const invalidation of ['expire','valid'])await waitRace('milestone',action,invalidation,'session');
 if(process.env.INVOICE_SESSION_REPRO!=='1')for(const endpoint of ['project-time-invoices','automation'])for(const invalidation of ['expire','valid']){
 const s=await session(invalidation==='expire'?4000:3600000);let release,signal;const gate=new Promise(r=>release=r),acquired=new Promise(r=>signal=r);
 const holding=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${s.id}::uuid FOR UPDATE`;signal();await gate;},{timeout:20000});await acquired;
 try{const query=new URLSearchParams({tenantId,companyId,expectedActorId:actorId,...(endpoint==='automation'?{branchId:'company'}:{})});const pending=call('/api/'+endpoint+'?'+query,'GET',undefined,s.cookie);
 let waited=false;for(let n=0;n<100;n++){const rows=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%Session%' AND pid<>pg_backend_pid()`;if(rows.length){waited=true;break;}await pause(25);}assert.ok(waited,endpoint+' exact session lock waited');if(invalidation==='expire')await pause(4500);release();await holding;const response=await pending;expect(response,invalidation==='expire'?401:200);console.log(`VERIFIED ${endpoint}/session/${invalidation}: HTTP ${response.status}`);
 }finally{release();await holding;}
 }


 if(process.env.INVOICE_SESSION_REPRO!=='1')for(const kind of ['time','milestone'])for(const invalidation of ['expire','grant','valid']){
 const originalId=await makeInvoice(kind);expect(await call(`/api/invoices/${originalId}/status`,'PATCH',{tenantId,action:'void',reason:'Explicit correction of original'},cookie),200);
 const isTime=kind==='time',model=isTime?db.projectTimeInvoiceSource:db.projectMilestoneInvoiceSource,requestModel=isTime?db.projectTimeInvoiceRequest:db.projectMilestoneInvoiceRequest,source=await model.findFirstOrThrow({where:{invoice:{id:originalId}}}),endpoint=isTime?'/api/project-time-invoices':'/api/project-milestone-invoices';
 const selection={...scope,customerId:source.customerId,currency:source.currency,paymentTerms:null,paymentDueDate:null,replacesSourceId:source.id,...(isTime?{entries:source.entries.map(e=>({entryId:e.entryId,expectedSequence:e.reviewSequence,hourlyRate:'11.000',treatment:'EXEMPT'}))}:{milestoneId:source.milestoneId,expectedSequence:2,agreedPrice:'11.000',treatment:'EXEMPT'})};
 const preview=expect(await call(endpoint+'/preview','POST',selection,cookie),200),request={...selection,requestId:randomUUID(),previewHash:preview.previewHash,reason:'Explicit correction wait regression'},s=await session(invalidation==='expire'?4000:3600000);
 const before=await model.count({where:{tenantId}});let release,signal,revoked;const gate=new Promise(r=>release=r),acquired=new Promise(r=>signal=r);const holding=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id=${originalId}::uuid FOR UPDATE`;signal();await gate;},{timeout:20000});await acquired;
 try{const pending=call(endpoint,'POST',request,s.cookie);let waited=false;for(let n=0;n<100;n++){const rows=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=${applicationName} AND wait_event_type='Lock' AND pid<>pg_backend_pid()`;if(rows.length){waited=true;break;}await pause(25);}assert.ok(waited,kind+' correction prior invoice actually waited');
 if(invalidation==='expire')await pause(4500);if(invalidation==='grant'){const role=await db.role.findUniqueOrThrow({where:{tenantId_name:{tenantId,name:'Owner'}}});revoked=await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:role.id,permissionKey:isTime?'project-time-invoice:generate':'project-milestone:generate'}}});}
 release();await holding;const response=await pending;expect(response,invalidation==='expire'?401:invalidation==='grant'?403:200);assert.equal(await model.count({where:{tenantId}}),before+(invalidation==='valid'?1:0));if(invalidation!=='valid')assert.equal(await requestModel.count({where:{id:request.requestId}}),0);if(revoked)await db.rolePermission.create({data:revoked});
 // Fresh authorized recovery uses the exact same UUID/body after an expired attempt
 // or a lost success reply; it never creates another entitlement or replacement.
 const receipt=expect(await call(endpoint,'POST',request,cookie),200);assert.deepEqual(expect(await call(endpoint,'POST',request,cookie),200),receipt);if(invalidation==='valid')assert.deepEqual(receipt,response.data);assert.equal(await model.count({where:{tenantId}}),before+1);assert.equal(await (isTime?db.projectTimeInvoiceClaim:db.projectMilestoneInvoiceClaim).count({where:{sourceId:source.id}}),isTime?source.entries.length:1);const originalRequest=await requestModel.findUniqueOrThrow({where:{id:source.requestId}});assert.equal(expect(await call(endpoint,'POST',originalRequest.request,cookie),200).result.invoice.id,originalId);assert.equal((await db.invoice.findUniqueOrThrow({where:{id:originalId}})).status,'VOID');console.log(`VERIFIED ${kind}/correction/prior-invoice/${invalidation}: HTTP ${response.status}`);
 }finally{release();await holding;}
 }
 for(const kind of ['COMPLETE','APPROVE','CANCEL'])for(const invalidation of ['expire','grant','valid']){
 const milestoneId=randomUUID(),definition={...scope,requestId:randomUUID(),milestoneId,kind:'CREATE',description:'Customer wait milestone',customerId:customer.id,currency:'OMR',agreedPrice:'10.000',treatment:'EXEMPT',paymentTerms:null,paymentDueDate:null,reason:'Explicit agreement'};
 expect(await call('/api/project-milestones','POST',definition,cookie),200);
 if(kind==='APPROVE')expect(await call('/api/project-milestones','POST',{...scope,requestId:randomUUID(),milestoneId,kind:'COMPLETE',expectedSequence:0,reason:'Completed'},cookie),200);
 const request={...scope,requestId:randomUUID(),milestoneId,kind,expectedSequence:kind==='APPROVE'?1:0,reason:'Reviewed transition'},s=await session(invalidation==='expire'?4000:3600000);
 let release,signal,revoked;const gate=new Promise(r=>release=r),acquired=new Promise(r=>signal=r);const holding=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${customer.id}::uuid FOR UPDATE`;signal();await gate;},{timeout:20000});await acquired;
 try{const pending=call('/api/project-milestones','POST',request,s.cookie);let waited=false;for(let n=0;n<100;n++){const rows=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=${applicationName} AND wait_event_type='Lock' AND pid<>pg_backend_pid()`;if(rows.length){waited=true;break;}await pause(25);}assert.ok(waited);if(invalidation==='expire')await pause(4500);if(invalidation==='grant'){const role=await db.role.findUniqueOrThrow({where:{tenantId_name:{tenantId,name:'Owner'}}});revoked=await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:role.id,permissionKey:kind==='APPROVE'?'project-milestone:approve':'project-milestone:manage'}}});}release();await holding;const response=await pending;expect(response,invalidation==='expire'?401:invalidation==='grant'?403:200);assert.equal(await db.projectMilestoneAction.count({where:{id:request.requestId}}),invalidation==='valid'?1:0);assert.equal((await db.projectMilestone.findUniqueOrThrow({where:{id:milestoneId}})).sequence,request.expectedSequence+(invalidation==='valid'?1:0));if(revoked)await db.rolePermission.create({data:revoked});const receipt=expect(await call('/api/project-milestones','POST',request,cookie),200);assert.deepEqual(expect(await call('/api/project-milestones','POST',request,cookie),200),receipt);if(invalidation==='valid')assert.deepEqual(response.data,receipt);console.log(`VERIFIED ${kind}/customer/${invalidation}: HTTP ${response.status}`);}finally{release();await holding;}
 }
 }finally{server.kill('SIGTERM');logoutServer.kill('SIGTERM');await db.$disconnect();}
});
