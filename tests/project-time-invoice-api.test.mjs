import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
const origin='http://127.0.0.1:3315',pause=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,method='GET',body,cookie,headers={}){const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const status=(r,expected,label='')=>{assert.equal(r.status,expected,label+' '+JSON.stringify(r.data));return r.data;};
test('approved time to genuine draft, issue, posting, collection, reports, reversal and explicit corrections',{timeout:300000},async()=>{
 const db=new PrismaClient(),url=new URL(process.env.DATABASE_URL);url.searchParams.set('connection_limit',process.env.PROJECT_TIME_INVOICE_POOL_LIMIT??'8');
 const server=spawn('./node_modules/.bin/next',[process.env.PROJECT_TIME_INVOICE_NEXT_MODE==='dev'?'dev':'start','-H','127.0.0.1','-p','3315'],{env:{...process.env,DATABASE_URL:url.toString(),ALLOW_REGISTRATION:'true'},stdio:['ignore','ignore','inherit']});
 try{
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await pause(250);}assert.ok(ready);
 const suffix=randomUUID().slice(0,8),reg=await call('/api/auth/register','POST',{name:'Time owner '+suffix,email:`time-invoice-${suffix}@example.invalid`,password:'Time-invoice-password-2026',organization:'Time invoice QA',slug:'time-invoice-'+suffix});
 const {tenantId}=status(reg,201),cookie=reg.cookie,actorId=(await db.membership.findFirstOrThrow({where:{tenantId}})).userId;
 const roles=await db.role.findMany({where:{tenantId,name:{in:['Owner','Manager','Viewer']}},include:{permissions:true}});for(const r of roles)assert.deepEqual(r.permissions.map(p=>p.permissionKey).filter(k=>k.startsWith('project-time-invoice:')).sort(),r.name==='Owner'?['project-time-invoice:generate','project-time-invoice:read']:[]);
 const create=async(path,body)=>status(await call(path,'POST',{tenantId,...body},cookie),201,path);
 const {company}=await create('/api/companies',{name:'Time company',code:'TIME',baseCurrency:'OMR'}),companyId=company.id;
 const {branch}=await create('/api/branches',{companyId,name:'Main',code:'MAIN'}),{branch:sibling}=await create('/api/branches',{companyId,name:'Sibling',code:'SIB'});
 const {customer}=await create('/api/customers',{companyId,branchId:branch.id,code:'CUS',displayName:'Time customer'}),{customer:other}=await create('/api/customers',{companyId,branchId:sibling.id,code:'OTH',displayName:'Other customer'});
 const {employee}=await create('/api/employees',{companyId,branchId:branch.id,code:'EMP',fullName:'Private time employee'});
 const {project}=await create('/api/projects',{companyId,branchId:branch.id,code:'PRJ',name:'Time project'}),projectId=project.id;
 status(await call(`/api/projects/${projectId}`,'PATCH',{tenantId,action:'activate'},cookie),200);
 const today=new Date().toISOString().slice(0,10),timePath=`/api/projects/${projectId}/time`;
 const record=async(minutes=61)=> (await create(timePath,{employeeId:employee.id,workDate:today,minutes,description:'Approved consulting effort'})).entry;
 const review=(entry,state='APPROVED',expectedSequence=0)=>call(timePath+'/reviews','POST',{tenantId,requestId:randomUUID(),entryId:entry.id,expectedSequence,state,reason:'Explicit approved correction'},cookie);
 const entry=await record(),pending=await record(30);status(await review(entry),201);
 const scope={tenantId,companyId,branchId:branch.id},endpoint='/api/project-time-invoices';
 const projectReport=(c=cookie)=>call(`/api/projects/${projectId}/billing?tenantId=${tenantId}`,'GET',undefined,c);
 const selected={...scope,projectId,expectedActorId:actorId,customerId:customer.id,currency:'OMR',entries:[{entryId:entry.id,expectedSequence:1,hourlyRate:'1.001',treatment:'STANDARD'}],paymentTerms:'Thirty days',paymentDueDate:today,replacesSourceId:null};
 const preview=(p=selected,c=cookie)=>call(endpoint+'/preview','POST',p,c);
 const prepare=(v,p=selected)=>({...p,requestId:randomUUID(),previewHash:v.previewHash,reason:'Explicit approved time invoice'});
 const post=(p,c=cookie)=>call(endpoint,'POST',p,c),abandon=(p,c=cookie)=>call(endpoint+'/abandon','POST',p,c);
 const list=(extra={},c=cookie)=>call(endpoint+'?'+new URLSearchParams({tenantId,companyId,projectId,expectedActorId:actorId,...extra}),'GET',undefined,c);
 const initial=status(await preview(),200);assert.equal(initial.prices.subtotal,'1.018');assert.equal(initial.prices.lines[0].quantity,1);assert.equal(initial.prices.taxAmount,'0.000');
 status(await preview({...selected,customerId:other.id}),403);status(await preview({...selected,entries:[{...selected.entries[0],entryId:pending.id}]}),409);status(await preview({...selected,entries:[{...selected.entries[0],hourlyRate:'1.00'}]}),400);
 const account=async(code,type)=>(await create('/api/ledger/accounts',{companyId,code,name:code,type})).account;
 const ar=await account('1200','ASSET'),cash=await account('1010','ASSET'),revenue=await account('4000','REVENUE'),vat=await account('2200','LIABILITY');
 status(await call(`/api/companies/${companyId}/vat`,'PUT',{tenantId,expectedRevision:0,enabled:true,taxNumber:'OM-TIME-'+suffix,sellerName:'Time company',sellerAddress:'Test address',effectiveFrom:today,outputAccountId:vat.id},cookie),200);
 status(await post(prepare(initial)),409);
 let v=status(await preview(),200);assert.equal(v.prices.taxAmount,'0.051');assert.equal(v.prices.gross,'1.069');
 // Legacy profile SQL permits unchanged revision: actual fields must still invalidate the preview.
 await db.companyVatProfile.update({where:{companyId},data:{sellerName:'Explicit amended seller'}});status(await post(prepare(v)),409);v=status(await preview(),200);
 await db.companyVatProfile.update({where:{companyId},data:{enabled:false}});status(await post(prepare(v)),409);
 await db.companyVatProfile.update({where:{companyId},data:{enabled:true}});v=status(await preview(),200);
 const request=prepare(v),raced=await Promise.all([post(request),post(request)]);assert.ok(raced.every(r=>r.status===200),JSON.stringify(raced));assert.deepEqual(raced[0].data,raced[1].data);
 const receipt=raced[0].data,invoiceId=receipt.result.invoice.id,sourceId=receipt.result.projectTimeSourceId;assert.equal(receipt.result.invoice.status,'DRAFT');assert.deepEqual(status(await abandon(request),200),receipt);status(await post({...request,reason:'Changed request'}),409);
 assert.equal(await db.salesOrder.count({where:{tenantId}}),0);assert.equal(await db.billingSubscription.count({where:{tenantId}}),0);assert.equal(await db.projectTimeInvoiceClaim.count({where:{entryId:entry.id}}),1);
 assert.equal(status(await list(),200).sources[0].subtotal,'1.018');assert.equal(status(await list(),200).entries.find(e=>e.id===entry.id).claimed,true);
 assert.equal(status(await projectReport(),200).rows[0].gross,'1.069');assert.equal(status(await projectReport(),200).summary[0].drafts,1);assert.equal(status(await projectReport(),200).summary[0].voided,0);assert.equal(status(await projectReport(),200).summary[0].posted,'0.000');
 const generatedLink=await db.projectInvoiceLink.findFirstOrThrow({where:{invoiceId}});status(await call(`/api/projects/${projectId}/billing`,'POST',{tenantId,requestId:randomUUID(),action:'UNLINK',linkId:generatedLink.id,reason:'Attempt to detach generated source'},cookie),409);
 status(await review(entry,'PENDING',1),409);
 const canceled=prepare(v);assert.equal(status(await abandon(canceled),200).outcome,'ABANDONED');status(await post(canceled),409);
 status(await call(endpoint,'POST',request),401);status(await call(endpoint,'POST',request,cookie,{Origin:'https://evil.invalid'}),403);
 async function invite(permissions,label,target=branch.id){const name=label+' '+randomUUID().slice(0,8),{role}=await create('/api/roles',{name,permissions});const invitation=await create('/api/invitations',{email:'time-role-'+randomUUID().slice(0,8)+'@example.invalid',roleId:role.id,scope:{type:'BRANCH',companyId,branchId:target}});const accepted=await call('/api/invitations/accept','POST',{token:invitation.path.split('/').at(-1),name,password:'Time-member-2026'});status(accepted,200);return {id:(await db.user.findFirstOrThrow({where:{name,memberships:{some:{tenantId}}}})).id,cookie:accepted.cookie,roleId:role.id};}
 const rights=['invoice:read','customer:read','ledger:read'];
 const reader=await invite([...rights,'project:read','project-time:read','project-time-invoice:read','project-billing:read'],'Time reader'),orderOnly=await invite([...rights,'order:read'],'Order reader'),otherReader=await invite([...rights,'project:read','project-time:read','project-time-invoice:read'],'Wrong branch',sibling.id),ledgerOnly=await invite(['ledger:read'],'Ledger only');
 const iq='?'+new URLSearchParams({tenantId,companyId});assert.equal(status(await call('/api/invoices'+iq,'GET',undefined,reader.cookie),200).invoices.length,1);
 for(const actor of [orderOnly,otherReader]){assert.equal(status(await call('/api/invoices'+iq,'GET',undefined,actor.cookie),200).invoices.length,0);status(await call('/accounting/invoices/'+invoiceId,'GET',undefined,actor.cookie),404);}
 status(await call(timePath+'/reviews','POST',{tenantId,requestId:randomUUID(),entryId:pending.id,expectedSequence:0,state:'APPROVED',reason:'Reader has no approval capability'},reader.cookie),403);
 assert.equal(status(await projectReport(reader.cookie),200).rows[0].invoiceId,invoiceId);
 status(await list({expectedActorId:reader.id},reader.cookie),200);status(await list({expectedActorId:actorId},reader.cookie),403);status(await post(request,reader.cookie),403);
 status(await call(`/api/invoices/${invoiceId}/status`,'PATCH',{tenantId,action:'issue'},cookie),200);
 const posting=await create(`/api/ledger/documents/invoice/${invoiceId}`,{entryDate:today,debitAccountId:ar.id,creditAccountId:revenue.id});assert.equal((await db.journalEntry.findUniqueOrThrow({where:{id:posting.entry.id}})).total.toFixed(3),'1.069');
 const trial=status(await call('/api/ledger/trial-balance?'+new URLSearchParams({tenantId,companyId,from:today,to:today}),'GET',undefined,ledgerOnly.cookie),200);assert.equal(trial.summary[0].debit,'1.069');assert.equal(trial.summary[0].balanced,true);status(await call('/api/ledger/documents/invoice/'+invoiceId+'?tenantId='+tenantId,'GET',undefined,ledgerOnly.cookie),403);
 const balances=(c=cookie)=>call('/api/accounting/customer-balances?'+new URLSearchParams({tenantId,companyId,asOf:today}),'GET',undefined,c),statement=()=>call('/api/accounting/customer-statement?'+new URLSearchParams({tenantId,companyId,customerId:customer.id,from:today,to:today}),'GET',undefined,cookie);
 assert.equal(status(await balances(reader.cookie),200).rows[0].balance,'1.069');assert.equal(status(await balances(orderOnly.cookie),200).rows.length,0);assert.equal(status(await statement(),200).summary[0].closing,'1.069');
 const collection=await create(`/api/invoices/${invoiceId}/settlements`,{requestId:randomUUID(),kind:'COLLECTION',amount:'0.069',entryDate:today,assetAccountId:cash.id,reference:'Time invoice partial collection'});assert.equal(status(await statement(),200).summary[0].closing,'1.000');assert.equal(status(await projectReport(reader.cookie),200).summary[0].balance,'1.000');
 const aging=status(await call('/api/accounting/customer-aging?'+new URLSearchParams({tenantId,companyId,asOf:today}),'GET',undefined,reader.cookie),200);assert.equal(aging.documents.find(d=>d.id===invoiceId).balance,'1.000');
 status(await call(`/api/invoices/${invoiceId}/status`,'PATCH',{tenantId,action:'void',reason:'Must reverse first'},cookie),409);
 const reverse=(id,number)=>call(`/api/ledger/journals/${id}/reverse`,'POST',{tenantId,number,entryDate:today,reason:'Explicit time correction'},cookie);
 status(await reverse(posting.entry.id,'TIME-BLOCK'),409);status(await reverse(collection.settlement.entry.id,'TIME-COL-REV'),201);status(await reverse(posting.entry.id,'TIME-INV-REV'),201);
 status(await call(`/api/invoices/${invoiceId}/status`,'PATCH',{tenantId,action:'void',reason:'Correct exact hourly tariff'},cookie),200);assert.equal(status(await statement(),200).summary[0].closing,'0.000');assert.equal(status(await projectReport(reader.cookie),200).summary[0].posted,'0.000');
 const correction={...selected,replacesSourceId:sourceId,entries:[{...selected.entries[0],hourlyRate:'2.000'}]},cv=status(await preview(correction),200),corrected=status(await post(prepare(cv,correction)),200);assert.equal(corrected.result.invoice.status,'DRAFT');assert.notEqual(corrected.result.invoice.id,invoiceId);assert.equal(await db.projectTimeInvoiceClaim.count({where:{entryId:entry.id}}),1);
 status(await review(entry,'PENDING',1),409);status(await call(`/api/invoices/${corrected.result.invoice.id}/status`,'PATCH',{tenantId,action:'void',reason:'Correct original recorded time'},cookie),200);status(await review(entry,'PENDING',1),201);
 status(await call(timePath,'PATCH',{tenantId,entryId:entry.id,reason:'Wrong minutes; replace with newly approved record'},cookie),200);
 const newEntry=await record(30);status(await review(newEntry),201);const correctedTime={...selected,entries:[{...selected.entries[0],entryId:newEntry.id}]};assert.equal(status(await post(prepare(status(await preview(correctedTime),200),correctedTime)),200).result.invoice.status,'DRAFT');
 status(await preview({...correction,replacesSourceId:corrected.result.projectTimeSourceId}),409);
 const exported=status(await call('/api/invoices/report?'+new URLSearchParams({tenantId,companyId,from:today,to:today,format:'csv'}),'GET',undefined,reader.cookie),200);assert.match(exported,/PT-/);
 // Completion permits final approved-time billing; cancellation permits corrections only.
 const finalEntry=await record(45);status(await review(finalEntry),201);status(await call(`/api/projects/${projectId}`,'PATCH',{tenantId,action:'complete'},cookie),200);
 const finalSelection={...selected,entries:[{...selected.entries[0],entryId:finalEntry.id}]},finalInvoice=status(await post(prepare(status(await preview(finalSelection),200),finalSelection)),200);
 status(await call(`/api/invoices/${finalInvoice.result.invoice.id}/status`,'PATCH',{tenantId,action:'void',reason:'Correct completed-project tariff'},cookie),200);
 const finalCorrection={...finalSelection,replacesSourceId:finalInvoice.result.projectTimeSourceId};status(await post(prepare(status(await preview(finalCorrection),200),finalCorrection)),200);
 assert.equal((await db.project.findUniqueOrThrow({where:{id:projectId}})).status,'COMPLETED');assert.equal((await db.projectTimeEntry.findUniqueOrThrow({where:{id:finalEntry.id}})).reviewSequence,1);assert.equal(await db.projectTimeInvoiceClaim.count({where:{entryId:finalEntry.id}}),1);status(await review(finalEntry,'PENDING',1),409);
 const {project:cancelProject}=await create('/api/projects',{companyId,branchId:branch.id,code:'CANCEL-TIME',name:'Cancelled financial corrections'});status(await call(`/api/projects/${cancelProject.id}`,'PATCH',{tenantId,action:'activate'},cookie),200);
 const cancelEntries=[];for(let n=0;n<2;n++){const e=(await create(`/api/projects/${cancelProject.id}/time`,{employeeId:employee.id,workDate:today,minutes:20+n,description:'Approved before cancellation'})).entry;status(await call(`/api/projects/${cancelProject.id}/time/reviews`,'POST',{tenantId,requestId:randomUUID(),entryId:e.id,expectedSequence:0,state:'APPROVED',reason:'Reviewed before cancellation'},cookie),201);cancelEntries.push(e);}
 const cancelSelection={...selected,projectId:cancelProject.id,entries:[{...selected.entries[0],entryId:cancelEntries[0].id}]},cancelOriginal=status(await post(prepare(status(await preview(cancelSelection),200),cancelSelection)),200);
 status(await call(`/api/projects/${cancelProject.id}`,'PATCH',{tenantId,action:'cancel'},cookie),200);status(await call(`/api/invoices/${cancelOriginal.result.invoice.id}/status`,'PATCH',{tenantId,action:'void',reason:'Correct existing cancelled-project entitlement'},cookie),200);
 const cancelCorrection={...cancelSelection,replacesSourceId:cancelOriginal.result.projectTimeSourceId};status(await post(prepare(status(await preview(cancelCorrection),200),cancelCorrection)),200);
 const freshCancelled={...cancelSelection,entries:[{...cancelSelection.entries[0],entryId:cancelEntries[1].id}]},blockedPreview=status(await preview(freshCancelled),200);assert.equal(blockedPreview.outcome,'UNAVAILABLE');status(await post(prepare(blockedPreview,freshCancelled)),409);
 assert.equal((await db.project.findUniqueOrThrow({where:{id:cancelProject.id}})).status,'CANCELLED');assert.equal(await db.projectTimeEntry.count({where:{projectId:cancelProject.id}}),2);assert.equal(await db.projectTimeInvoiceClaim.count({where:{projectId:cancelProject.id}}),1);assert.equal((await db.projectTimeEntry.findUniqueOrThrow({where:{id:cancelEntries[0].id}})).reviewSequence,1);
 // Both grants and the exact session are checked after waiting for source locks.
 const generateRights=[...rights,'project:read','project-time:read','project-time-invoice:read','project-time-invoice:generate','project-billing:read','project-billing:manage','invoice:create'];
 async function blockedMutation(actor,change){
  const body={...correctedTime,expectedActorId:actor.id},view=status(await preview(body,actor.cookie),200),request=prepare(view,body);
  let release,locked;const gate=new Promise(r=>release=r),acquired=new Promise(r=>locked=r);
  const holding=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId}::uuid FOR UPDATE`;locked();await gate;},{timeout:15000});
  await acquired;const pending=post(request,actor.cookie);await pause(300);await change(actor);release();await holding;return pending;
 }
 const grantActor=await invite(generateRights,'Wait grant');status(await blockedMutation(grantActor,a=>db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:a.roleId,permissionKey:'project-time-invoice:generate'}}})),403);
 const expiryActor=await invite(generateRights,'Wait expiry');status(await blockedMutation(expiryActor,a=>db.session.updateMany({where:{userId:a.id},data:{expiresAt:new Date(Date.now()-60000)}})),401);
 const sessionActor=await invite(generateRights,'Wait session');status(await blockedMutation(sessionActor,a=>db.session.deleteMany({where:{userId:a.id}})),401);
 await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:reader.roleId,permissionKey:'project-time:read'}}});assert.equal(status(await call('/api/invoices'+iq,'GET',undefined,reader.cookie),200).invoices.length,0);status(await call('/accounting/invoices/'+invoiceId,'GET',undefined,reader.cookie),404);status(await list({expectedActorId:reader.id},reader.cookie),403);assert.equal(status(await projectReport(reader.cookie),200).rows.length,0);
 assert.equal((await db.projectTimeInvoiceSource.findUniqueOrThrow({where:{id:sourceId}})).entries[0].minutes,61);
 }finally{server.kill('SIGTERM');await db.$disconnect();}
});
