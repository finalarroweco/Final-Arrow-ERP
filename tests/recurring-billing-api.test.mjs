import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
const port=3310,origin=`http://127.0.0.1:${port}`,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const dateOffset=(value,days)=>new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
async function call(path,method='GET',body,cookie,headers={}){
 const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
 return {status:response.status,data,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
function status(response,expected,label=''){assert.equal(response.status,expected,label+' '+JSON.stringify(response.data));return response.data;}
test('recurring configured service invoices are genuine drafts with exact recovery, independent scopes, accounting and explicit corrections',{timeout:300000},async()=>{
 const db=new PrismaClient(),url=new URL(process.env.DATABASE_URL);url.searchParams.set('connection_limit',process.env.RECURRING_BILLING_POOL_LIMIT??'8');url.searchParams.set('application_name','recurring-billing-api-tests');
 const server=spawn('./node_modules/.bin/next',[process.env.RECURRING_BILLING_NEXT_MODE==='dev'?'dev':'start','-H','127.0.0.1','-p',String(port)],{env:{...process.env,DATABASE_URL:url.toString(),ALLOW_REGISTRATION:'true'},stdio:['ignore','ignore','inherit']});
 try{
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await pause(250);}assert.ok(ready,'Next server ready');
  const suffix=randomUUID().slice(0,8),registered=await call('/api/auth/register','POST',{name:'Recurring owner '+suffix,email:`recurring-${suffix}@example.invalid`,password:'Recurring-test-password-2026',organization:'Recurring isolated '+suffix,slug:'recurring-'+suffix});
  const {tenantId}=status(registered,201),cookie=registered.cookie,actorId=(await db.membership.findFirstOrThrow({where:{tenantId}})).userId;
  const defaultRoles=await db.role.findMany({where:{tenantId,name:{in:['Owner','Manager','Viewer']}},include:{permissions:true}});
  assert.equal(defaultRoles.length,3);for(const role of defaultRoles)assert.deepEqual(role.permissions.map(p=>p.permissionKey).filter(p=>p.startsWith('billing-subscription:')).sort(),role.name==='Owner'?['billing-subscription:generate','billing-subscription:manage','billing-subscription:read']:[],role.name+' recurring financial authority remains opt-in');
  const create=async(path,body)=>status(await call(path,'POST',{tenantId,...body},cookie),201,path);
  const {company}=await create('/api/companies',{name:'Recurring company',code:'REC',baseCurrency:'OMR'}),companyId=company.id;
  const {branch}=await create('/api/branches',{companyId,name:'Recurring branch',code:'REC'}),{branch:sibling}=await create('/api/branches',{companyId,name:'Sibling',code:'SIB'});
  const {customer}=await create('/api/customers',{companyId,branchId:branch.id,code:'REC-CUSTOMER',displayName:'Service customer',email:'private-recurring@example.invalid',phone:'PRIVATE-RECURRING-PHONE'});
  const {customer:otherCustomer}=await create('/api/customers',{companyId,branchId:sibling.id,code:'REC-SIB',displayName:'Other scoped customer'});
  const account=async(code,type)=>(await create('/api/ledger/accounts',{companyId,code,name:code,type})).account;
  const ar=await account('1200','ASSET'),cash=await account('1010','ASSET'),revenue=await account('4000','REVENUE'),output=await account('2200','LIABILITY');
  const today=new Date().toISOString().slice(0,10),scope={tenantId,companyId,branchId:branch.id},endpoint='/api/recurring-billing';
  const body=(patch={})=>({...scope,expectedActorId:actorId,requestId:randomUUID(),reason:'Operator explicit recurring configuration',...patch});
  const post=(p,c=cookie)=>call(endpoint,'POST',p,c),abandon=(p,c=cookie)=>call(endpoint+'/abandon','POST',p,c);
  const list=(patch={},c=cookie)=>call(endpoint+'?'+new URLSearchParams({tenantId,companyId,branchId:branch.id,expectedActorId:actorId,...patch}),'GET',undefined,c);
  const plan=(patch={})=>body({action:'plan',planId:randomUUID(),expectedVersion:0,label:'Explicit service tariff',currency:'OMR',archived:false,lines:[{description:'Standard service',quantity:2,unitPrice:'10.005',treatment:'STANDARD'},{description:'Zero-rated service',quantity:1,unitPrice:'3.000',treatment:'ZERO'},{description:'Exempt service',quantity:1,unitPrice:'2.000',treatment:'EXEMPT'}],...patch});
  const p=plan(),planReceipt=status(await post(p),201);assert.equal(planReceipt.outcome,'COMMITTED');assert.equal(planReceipt.actorId,actorId);assert.equal(planReceipt.result.version,1);
  const configure=(patch={})=>body({action:'configure',subscriptionId:randomUUID(),customerId:customer.id,manualSubscriptionId:null,expectedVersion:0,anchor:today,cadence:{kind:'DAYS',days:30},effectivePeriod:0,planId:p.planId,planVersion:1,horizon:dateOffset(today,90),status:'ACTIVE',terms:{kind:'OFFSET',label:'Thirty days after start',days:30,base:'PERIOD_START'},archived:false,...patch});
  const c=configure(),configured=status(await post(c),201);assert.equal(configured.result.version,1);
  const preview=(subscriptionId=c.subscriptionId,patch={},session=cookie)=>call(endpoint+'/preview','POST',{...scope,expectedActorId:actorId,subscriptionId,offset:0,limit:50,backfill:false,replacesSourceId:null,replacementPlanRevisionId:null,...patch},session);
  const prepare=(row,patch={})=>body({action:'generate',subscriptionId:row.subscriptionId,expectedVersion:row.subscriptionVersion,periodIndex:row.period.index,previewHash:row.previewHash,replacesSourceId:null,replacementPlanRevisionId:null,...patch});
  const first=status(await preview(),200);assert.equal(first.count,3);assert.equal(first.complete,true);assert.equal(first.nextOffset,null);assert.deepEqual(first.periods.map(r=>r.outcome),['READY','FUTURE','FUTURE']);assert.equal(first.periods[0].paymentDueDate,dateOffset(today,30));
  const paged=status(await preview(c.subscriptionId,{limit:1}),200);assert.equal(paged.nextOffset,1);assert.equal(paged.complete,false);assert.equal(status(await preview(c.subscriptionId,{offset:3}),200).count,0);
  status(await preview(c.subscriptionId,{limit:51}),400);status(await preview(c.subscriptionId,{offset:-1}),400);
  status(await call(endpoint,'POST',p),401);status(await call(endpoint,'POST',plan(),cookie,{Origin:'https://evil.invalid'}),403);
  status(await call(endpoint+'?'+new URLSearchParams({tenantId,companyId,expectedActorId:actorId})+'&tenantId='+tenantId,'GET',undefined,cookie),400);
  for(const patch of [{lines:[{description:'Missing tax',quantity:1,unitPrice:'1.000'}]},{lines:[{description:'Fraction',quantity:1.5,unitPrice:'1.000',treatment:'ZERO'}]},{currency:'omr'},{expectedActorId:randomUUID()},{lines:[{description:'Too precise',quantity:1,unitPrice:'1.0001',treatment:'ZERO'}]}])assert.ok([400,403].includes((await post(plan(patch))).status));
  status(await post(configure({customerId:otherCustomer.id})),403);status(await post(configure({horizon:today})),400);
  // VAT changes invalidate previews, including previews of earlier service dates.
  const vatPath=`/api/companies/${companyId}/vat`,vat={tenantId,expectedRevision:0,enabled:true,taxNumber:'OM-REC-'+suffix,sellerName:'Recurring seller',sellerAddress:'Isolated fixture address',effectiveFrom:today,outputAccountId:output.id};
  status(await call(vatPath,'PUT',vat,cookie),200);status(await post(prepare(first.periods[0])),409);
  const taxed=status(await preview(),200).periods[0];assert.equal(taxed.prices.subtotal,'25.010');assert.equal(taxed.prices.taxAmount,'1.001');assert.equal(taxed.prices.gross,'26.011');
  const generation=prepare(taxed),raced=await Promise.all([post(generation),post({...generation,requestId:randomUUID()})]);
  assert.equal(raced.filter(r=>r.status===201).length,1,JSON.stringify(raced));assert.ok(raced.every(r=>[201,409].includes(r.status)));
  // The identical request recovers a lost response. If the other identity won,
  // recover its exact committed request rather than treating the loser as success.
  const committed=await db.billingRequest.findFirstOrThrow({where:{tenantId,action:'generate',outcome:'COMMITTED'}}),exact=committed.request;
  const generated=status(await post(exact),201);assert.deepEqual(status(await post(exact),201),generated);assert.deepEqual(status(await abandon(exact),200),generated);
  assert.equal(generated.result.invoice.status,'DRAFT');const invoiceId=generated.result.invoice.id,sourceId=generated.result.serviceSourceId;
  status(await post({...exact,reason:'Changed payload with same identity'}),409);
  const invoice=await db.invoice.findUniqueOrThrow({where:{id:invoiceId},include:{lines:true,vat:true}});assert.equal(invoice.orderId,null);assert.equal(invoice.serviceSourceId,sourceId);assert.equal(invoice.status,'DRAFT');assert.equal(invoice.lines.length,3);assert.equal(invoice.vat.taxAmount.toFixed(3),'1.001');assert.deepEqual(invoice.vat.details.map(x=>x.treatment),['STANDARD','ZERO','EXEMPT']);
  const sourceRegister=status(await list(),200).subscriptions.find(s=>s.id===c.subscriptionId).sources.find(s=>s.id===sourceId);assert.equal(sourceRegister.subtotal,'25.010');assert.equal(sourceRegister.taxAmount,'1.001');for(const key of ['subtotal','taxAmount'])assert.match(sourceRegister[key],/^\d+\.\d{3}$/,'register preserves exact three-decimal '+key);
  assert.equal(await db.salesOrder.count({where:{tenantId}}),0);assert.equal(await db.serviceInvoiceSource.count({where:{subscriptionId:c.subscriptionId,periodIndex:0}}),1);
  const again=status(await preview(),200).periods[0],duplicate=status(await post(prepare(again)),201);assert.equal(duplicate.result.alreadyGenerated,true);assert.equal(duplicate.result.invoice.id,invoiceId);assert.equal(await db.invoice.count({where:{tenantId}}),1);
  const abandonedPlan=plan(),cancelled=status(await abandon(abandonedPlan),200);assert.equal(cancelled.outcome,'ABANDONED');assert.deepEqual(status(await abandon(abandonedPlan),200),cancelled);status(await post(abandonedPlan),409);assert.equal(await db.billingPlan.count({where:{id:abandonedPlan.planId}}),0);
  // Financial permissions never come from the old manual-subscription register.
  async function invite(permissions,label,target=branch.id){
   const name=label+' '+randomUUID().slice(0,8),{role}=await create('/api/roles',{name,permissions});const invitation=await create('/api/invitations',{email:'rec-role-'+randomUUID().slice(0,8)+'@example.invalid',roleId:role.id,scope:{type:'BRANCH',companyId,branchId:target}});
   const accepted=await call('/api/invitations/accept','POST',{token:invitation.path.split('/').at(-1),name,password:'Recurring-member-2026'});status(accepted,200);
   const user=await db.user.findFirstOrThrow({where:{name,memberships:{some:{tenantId}}}});return {id:user.id,cookie:accepted.cookie,roleId:role.id};
  }
  const invoiceRights=['invoice:read','customer:read','ledger:read'];
  const billingReader=await invite(['billing-subscription:read',...invoiceRights],'Billing reader'),billingOnly=await invite(['billing-subscription:read','customer:read'],'Billing only'),orderReader=await invite(['order:read',...invoiceRights],'Order reader'),manual=await invite(['subscription:read','subscription:manage',...invoiceRights],'Manual only'),siblingReader=await invite(['billing-subscription:read',...invoiceRights],'Sibling reader',sibling.id);
  const invoiceQuery='?'+new URLSearchParams({tenantId,companyId});
  assert.equal(status(await call('/api/invoices'+invoiceQuery,'GET',undefined,billingReader.cookie),200).invoices[0].id,invoiceId);
  assert.equal(status(await call('/api/invoices'+invoiceQuery,'GET',undefined,orderReader.cookie),200).invoices.length,0);
  assert.equal(status(await call('/api/invoices'+invoiceQuery,'GET',undefined,manual.cookie),200).invoices.length,0,'legacy invoice read does not grant service-source visibility');
  assert.equal(status(await call('/api/invoices'+invoiceQuery,'GET',undefined,siblingReader.cookie),200).invoices.length,0);
  for(const reader of [orderReader,manual,siblingReader])status(await call('/accounting/invoices/'+invoiceId,'GET',undefined,reader.cookie),404);
  status(await post(configure({expectedActorId:manual.id}),manual.cookie),403);status(await post(exact,billingReader.cookie),403);
  const billingOnlyList=status(await list({expectedActorId:billingOnly.id},billingOnly.cookie),200);assert.ok(!JSON.stringify(billingOnlyList).includes(invoiceId),'billing read cannot expose invoice link');assert.ok(!JSON.stringify(billingOnlyList).includes('PRIVATE-RECURRING-PHONE'));
  const billingOnlyPreview=status(await preview(c.subscriptionId,{expectedActorId:billingOnly.id},billingOnly.cookie),200);assert.equal(billingOnlyPreview.periods[0].invoice,null);
  status(await list({expectedActorId:actorId},billingReader.cookie),403);
  const generator=await invite(['billing-subscription:read','billing-subscription:generate','customer:read','invoice:read','invoice:create'],'Generator');
  const genRow=status(await preview(c.subscriptionId,{expectedActorId:generator.id},generator.cookie),200).periods[0],genRequest=prepare(genRow,{expectedActorId:generator.id});status(await post(genRequest,generator.cookie),201);
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:generator.roleId,permissionKey:'invoice:read'}}});status(await post(genRequest,generator.cookie),403);status(await abandon(genRequest,generator.cookie),403);
  const manager=await invite(['billing-subscription:read','billing-subscription:manage','customer:read'],'Billing manager'),managed=configure({expectedActorId:manager.id});status(await post(managed,manager.cookie),201);
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:manager.roleId,permissionKey:'customer:read'}}});status(await post(managed,manager.cookie),403);status(await abandon(managed,manager.cookie),403);
  // DRAFT -> explicit issue -> existing posting -> collection -> source reports.
  status(await call(`/api/invoices/${invoiceId}/status`,'PATCH',{tenantId,action:'issue'},cookie),200);
  const posting=await create(`/api/ledger/documents/invoice/${invoiceId}`,{entryDate:today,debitAccountId:ar.id,creditAccountId:revenue.id});
  assert.equal((await db.journalEntry.findUniqueOrThrow({where:{id:posting.entry.id}})).total.toFixed(3),'26.011');
  const ledgerOnly=await invite(['ledger:read'],'Ledger totals reader');
  const trial=status(await call('/api/ledger/trial-balance?'+new URLSearchParams({tenantId,companyId,from:today,to:today}),'GET',undefined,ledgerOnly.cookie),200);assert.equal(trial.summary[0].debit,'26.011');assert.equal(trial.summary[0].credit,'26.011');assert.equal(trial.summary[0].balanced,true,'source restrictions must not unbalance ledger totals');status(await call('/api/ledger/documents/invoice/'+invoiceId+'?tenantId='+tenantId,'GET',undefined,ledgerOnly.cookie),403);
  const balances=(session=cookie)=>call('/api/accounting/customer-balances?'+new URLSearchParams({tenantId,companyId,asOf:today}),'GET',undefined,session);
  const statement=()=>call('/api/accounting/customer-statement?'+new URLSearchParams({tenantId,companyId,customerId:customer.id,from:today,to:today}),'GET',undefined,cookie);
  assert.equal(status(await balances(billingReader.cookie),200).rows.find(r=>r.customer.id===customer.id).balance,'26.011');assert.equal(status(await balances(orderReader.cookie),200).rows.length,0);
  assert.equal(status(await statement(),200).summary[0].closing,'26.011');
  const aging=status(await call('/api/accounting/customer-aging?'+new URLSearchParams({tenantId,companyId,asOf:today}),'GET',undefined,billingReader.cookie),200);assert.equal(aging.documents.find(d=>d.id===invoiceId).balance,'26.011');
  const pay={tenantId,requestId:randomUUID(),kind:'COLLECTION',amount:'6.011',entryDate:today,assetAccountId:cash.id,reference:'Recurring partial collection'};
  const collection=status(await call(`/api/invoices/${invoiceId}/settlements`,'POST',pay,cookie),201);assert.equal(status(await statement(),200).summary[0].closing,'20.000');
  status(await call(`/api/invoices/${invoiceId}/status`,'PATCH',{tenantId,action:'void',reason:'Must reverse original first'},cookie),409);
  const reverse=(id,number)=>call(`/api/ledger/journals/${id}/reverse`,'POST',{tenantId,number,entryDate:today,reason:'Explicit recurring correction'},cookie);
  status(await reverse(posting.entry.id,'REC-PARENT-BLOCK'),409);status(await reverse(collection.settlement.entry.id,'REC-COLLECTION-REV'),201);status(await reverse(posting.entry.id,'REC-INVOICE-REV'),201);
  status(await call(`/api/invoices/${invoiceId}/status`,'PATCH',{tenantId,action:'void',reason:'Replace with explicitly selected corrected tariff'},cookie),200);assert.equal(status(await statement(),200).summary[0].closing,'0.000');
  assert.equal(status(await post(exact),201).result.invoice.id,invoiceId,'void never silently regenerates original request');
  const revisedPlan={...p,requestId:randomUUID(),expectedVersion:1,reason:'Correct explicit service tariff',lines:p.lines.map(l=>({...l,unitPrice:'1.000'}))},revised=status(await post(revisedPlan),201);
  const correctedPreview=status(await preview(c.subscriptionId,{replacesSourceId:sourceId,replacementPlanRevisionId:revised.result.revisionId}),200).periods[0];assert.equal(correctedPreview.prices.subtotal,'4.000');
  const correction=prepare(correctedPreview,{action:'replace',replacesSourceId:sourceId,replacementPlanRevisionId:revised.result.revisionId,reason:'Explicit void-linked corrected invoice'}),replacement=status(await post(correction),201);
  assert.notEqual(replacement.result.invoice.id,invoiceId);assert.notEqual(replacement.result.invoice.number,invoice.number);assert.equal(replacement.result.invoice.status,'DRAFT');
  const replacementSource=await db.serviceInvoiceSource.findUniqueOrThrow({where:{id:replacement.result.serviceSourceId}});assert.equal(replacementSource.replacesSourceId,sourceId);assert.equal(replacementSource.correctionIndex,1);assert.equal(replacementSource.periodIndex,0);assert.equal(await db.salesOrder.count({where:{tenantId}}),0);
  status(await post({...correction,requestId:randomUUID()}),409);assert.equal(status(await post(correction),201).result.invoice.id,replacement.result.invoice.id);
  // Calendar history stays on its original anchor. Explicit backfill uses today's VAT.
  const historical=configure({anchor:dateOffset(today,-60),horizon:dateOffset(today,30)});status(await post(historical),201);
  assert.equal(status(await preview(historical.subscriptionId),200).periods[0].outcome,'BACKFILL_REQUIRED');
  const oldPeriod=status(await preview(historical.subscriptionId,{backfill:true}),200).periods[0];assert.equal(oldPeriod.vatActive,true);const backfilled=status(await post(prepare(oldPeriod,{action:'backfill'})),201);assert.equal((await db.invoiceVat.findUniqueOrThrow({where:{invoiceId:backfilled.result.invoice.id}})).taxAmount.toFixed(3),'1.001');
  const paused={...historical,requestId:randomUUID(),expectedVersion:1,effectivePeriod:1,status:'PAUSED',reason:'Explicit pause at next ungenerated boundary'};status(await post(paused),201);
  const pausePreview=status(await preview(historical.subscriptionId),200);assert.equal(pausePreview.periods[1].outcome,'SKIPPED');status(await post(prepare(pausePreview.periods[1])),409);
  assert.equal(await db.serviceInvoiceSource.count({where:{subscriptionId:historical.subscriptionId,periodIndex:1}}),0);
  const explicitPast=status(await preview(historical.subscriptionId,{backfill:true}),200).periods[1];assert.equal(explicitPast.outcome,'READY');const skippedBackfill=status(await post(prepare(explicitPast,{action:'backfill',reason:'Explicit reviewed backfill of skipped paused period'})),201);assert.equal(skippedBackfill.result.periodIndex,1);
  const resumed={...paused,requestId:randomUUID(),expectedVersion:2,effectivePeriod:2,status:'ACTIVE',reason:'Resume original period identities'};status(await post(resumed),201);
  const resumePreview=status(await preview(historical.subscriptionId),200);assert.equal(resumePreview.periods[1].outcome,'SKIPPED');assert.equal(resumePreview.periods[2].period.start,today);assert.equal(resumePreview.periods[2].outcome,'READY');
  status(await post({...resumed,requestId:randomUUID(),expectedVersion:3,effectivePeriod:0}),409);
  // Correcting an existing entitlement never requires reactivating billing.
  for(const billingState of ['PAUSED','ENDED']){
   const stopped=configure({anchor:dateOffset(today,-30),horizon:today,status:billingState});status(await post(stopped),201);
   assert.equal(status(await preview(stopped.subscriptionId),200).periods[0].outcome,'SKIPPED');
   const stoppedPeriod=status(await preview(stopped.subscriptionId,{backfill:true}),200).periods[0];assert.equal(stoppedPeriod.outcome,'READY');
   const stoppedRequest=prepare(stoppedPeriod,{action:'backfill',reason:'Explicit completed entitlement '+billingState}),stoppedInvoice=status(await post(stoppedRequest),201);
   const stoppedInvoiceId=stoppedInvoice.result.invoice.id,stoppedSourceId=stoppedInvoice.result.serviceSourceId;
   status(await call(`/api/invoices/${stoppedInvoiceId}/status`,'PATCH',{tenantId,action:'issue'},cookie),200);
   const stoppedPosting=await create(`/api/ledger/documents/invoice/${stoppedInvoiceId}`,{entryDate:today,debitAccountId:ar.id,creditAccountId:revenue.id});
   const stoppedCollection=status(await call(`/api/invoices/${stoppedInvoiceId}/settlements`,'POST',{...pay,requestId:randomUUID(),amount:'1.000',reference:'Reviewed '+billingState+' entitlement'},cookie),201);
   status(await call(`/api/invoices/${stoppedInvoiceId}/status`,'PATCH',{tenantId,action:'void',reason:'Must preserve financial dependencies'},cookie),409);
   const replacementOptions={replacesSourceId:stoppedSourceId,replacementPlanRevisionId:revised.result.revisionId};
   assert.equal(status(await preview(stopped.subscriptionId,replacementOptions),200).periods[0].outcome,'REPLACEMENT_REQUIRES_LATEST_VOID');
   status(await reverse(stoppedPosting.entry.id,'REC-'+billingState+'-BLOCK'),409);
   status(await reverse(stoppedCollection.settlement.entry.id,'REC-'+billingState+'-COL-REV'),201);
   status(await reverse(stoppedPosting.entry.id,'REC-'+billingState+'-INV-REV'),201);
   status(await call(`/api/invoices/${stoppedInvoiceId}/status`,'PATCH',{tenantId,action:'void',reason:'Explicit corrected existing '+billingState+' entitlement'},cookie),200);
   const stoppedCorrection=status(await preview(stopped.subscriptionId,replacementOptions),200).periods[0];assert.equal(stoppedCorrection.outcome,'READY');
   const stoppedCorrectionRequest=prepare(stoppedCorrection,{action:'replace',...replacementOptions,reason:'Correct existing entitlement without reactivation'}),stoppedReplacement=status(await post(stoppedCorrectionRequest),201);
   assert.equal(stoppedReplacement.result.invoice.status,'DRAFT');assert.notEqual(stoppedReplacement.result.invoice.id,stoppedInvoiceId);
   const replacementHistory=await db.serviceInvoiceSource.findUniqueOrThrow({where:{id:stoppedReplacement.result.serviceSourceId}});
   assert.equal(replacementHistory.replacesSourceId,stoppedSourceId);assert.equal(replacementHistory.periodIndex,0);assert.equal(replacementHistory.correctionIndex,1);assert.equal(replacementHistory.periodStart.toISOString().slice(0,10),stopped.anchor);assert.equal(replacementHistory.periodEnd.toISOString().slice(0,10),today);
   const unchanged=await db.billingSubscription.findUniqueOrThrow({where:{id:stopped.subscriptionId},include:{revisions:true}});assert.equal(unchanged.version,1);assert.equal(unchanged.revisions.length,1);assert.equal(unchanged.revisions[0].status,billingState);
   assert.equal(status(await post(stoppedRequest),201).result.invoice.id,stoppedInvoiceId);assert.equal(status(await post(stoppedCorrectionRequest),201).result.invoice.id,stoppedReplacement.result.invoice.id);
   status(await post({...stoppedCorrectionRequest,requestId:randomUUID()}),409);assert.equal(await db.serviceInvoiceSource.count({where:{subscriptionId:stopped.subscriptionId,periodIndex:0}}),2);
   assert.equal(status(await preview(stopped.subscriptionId),200).periods[0].outcome,'SKIPPED','correction does not activate billing');
  }
  const partial=configure({horizon:dateOffset(today,15)});status(await post(partial),201);const partialRow=status(await preview(partial.subscriptionId),200).periods[0];assert.equal(partialRow.outcome,'PARTIAL_REVIEW');status(await post(prepare(partialRow)),409);
  const futureVat={...vat,expectedRevision:1,effectiveFrom:dateOffset(today,1)};status(await call(vatPath,'PUT',futureVat,cookie),200);
  const notTaxedConfig=configure();status(await post(notTaxedConfig),201);const notTaxed=status(await preview(notTaxedConfig.subscriptionId),200).periods[0];assert.equal(notTaxed.vatActive,false);const untaxed=status(await post(prepare(notTaxed)),201);assert.equal(await db.invoiceVat.findUnique({where:{invoiceId:untaxed.result.invoice.id}}),null);
  status(await call(vatPath,'PUT',{...futureVat,expectedRevision:2,enabled:false},cookie),200);
  const usd=plan({currency:'USD'}),usdPlan=status(await post(usd),201);assert.ok(usdPlan.result.revisionId);
  status(await post({...c,requestId:randomUUID(),expectedVersion:1,effectivePeriod:1,planId:usd.planId,planVersion:1}),409,'subscription currency immutable');
  // Service amounts above Number's safe milliscaled range remain exact through
  // existing invoice print, CSV, posting and independent-currency reports.
  const {company:usdCompany}=await create('/api/companies',{name:'Explicit USD service company',code:'RECUSD',baseCurrency:'USD'}),usdCompanyId=usdCompany.id;
  const {branch:usdBranch}=await create('/api/branches',{companyId:usdCompanyId,name:'USD branch',code:'USD'}),{customer:usdCustomer}=await create('/api/customers',{companyId:usdCompanyId,branchId:usdBranch.id,code:'USD-CUSTOMER',displayName:'USD service customer'});
  const {account:usdAr}=await create('/api/ledger/accounts',{companyId:usdCompanyId,code:'1200',name:'USD receivable',type:'ASSET'}),{account:usdRevenue}=await create('/api/ledger/accounts',{companyId:usdCompanyId,code:'4000',name:'USD revenue',type:'REVENUE'});
  const usdScope={companyId:usdCompanyId,branchId:usdBranch.id},huge='90071992547409.913',largePlan=plan({...usdScope,currency:'USD',label:'Exact large service tariff',lines:[{description:'Exact large service',quantity:1,unitPrice:huge,treatment:'ZERO'}]});status(await post(largePlan),201);
  const largeConfig=configure({...usdScope,customerId:usdCustomer.id,planId:largePlan.planId});status(await post(largeConfig),201);
  const largePeriod=status(await preview(largeConfig.subscriptionId,usdScope),200).periods[0];assert.equal(largePeriod.prices.subtotal,huge);assert.equal(largePeriod.prices.gross,huge);
  const largeGenerated=status(await post(prepare(largePeriod,usdScope)),201),largeInvoiceId=largeGenerated.result.invoice.id;
  const largeRegister=status(await call('/api/invoices?'+new URLSearchParams({tenantId,companyId:usdCompanyId}),'GET',undefined,cookie),200).invoices.find(i=>i.id===largeInvoiceId);assert.equal(largeRegister.subtotal,huge);assert.equal(largeRegister.gross,huge);
  assert.ok(status(await call('/accounting/invoices/'+largeInvoiceId,'GET',undefined,cookie),200).includes(huge),'print preserves exact large three-decimal service amount');
  const largeCsv=status(await call('/api/invoices/report?'+new URLSearchParams({tenantId,companyId:usdCompanyId,from:today,to:today,format:'csv'}),'GET',undefined,cookie),200);assert.ok(largeCsv.includes(huge),'invoice CSV preserves exact large amount');
  status(await call(`/api/invoices/${largeInvoiceId}/status`,'PATCH',{tenantId,action:'issue'},cookie),200);
  const largePosting=await create(`/api/ledger/documents/invoice/${largeInvoiceId}`,{entryDate:today,debitAccountId:usdAr.id,creditAccountId:usdRevenue.id});assert.equal((await db.journalEntry.findUniqueOrThrow({where:{id:largePosting.entry.id}})).total.toFixed(3),huge);
  const largeTrial=status(await call('/api/ledger/trial-balance?'+new URLSearchParams({tenantId,companyId:usdCompanyId,from:today,to:today}),'GET',undefined,cookie),200).summary.find(s=>s.currency==='USD');assert.equal(largeTrial.debit,huge);assert.equal(largeTrial.credit,huge);assert.equal(largeTrial.balanced,true);
  const largeBalances=status(await call('/api/accounting/customer-balances?'+new URLSearchParams({tenantId,companyId:usdCompanyId,asOf:today}),'GET',undefined,cookie),200);assert.equal(largeBalances.rows.find(r=>r.customer.id===usdCustomer.id&&r.currency==='USD').balance,huge,'customer balance remains exact and currency-separated');
  const archived={...revisedPlan,requestId:randomUUID(),expectedVersion:2,archived:true,reason:'Archive prevents new draft generation'};status(await post(archived),201);assert.equal(status(await preview(),200).periods[0].outcome,'ARCHIVED');assert.equal(status(await post(exact),201).result.invoice.id,invoiceId);
  // Both histories and printing stay bounded and source authorized.
  const historyQuery=new URLSearchParams({tenantId,companyId,branchId:branch.id,expectedActorId:actorId,kind:'subscription',id:c.subscriptionId,page:'0'});
  const history=status(await call(endpoint+'/history?'+historyQuery,'GET',undefined,cookie),200);assert.equal(history.actorId,actorId);const historicSource=history.sources.find(s=>s.id===sourceId);assert.equal(historicSource.subtotal,'25.010');assert.equal(historicSource.taxAmount,'1.001');for(const key of ['subtotal','taxAmount'])assert.match(historicSource[key],/^\d+\.\d{3}$/,'history preserves exact three-decimal '+key);status(await call(endpoint+'/history?'+historyQuery,'GET',undefined,billingReader.cookie),403);
  for(const path of ['/accounting/invoices/'+invoiceId,'/accounting/invoices/'+replacement.result.invoice.id]){const page=status(await call(path,'GET',undefined,cookie),200);assert.match(page,/Service customer/);}
  const exported=await call('/api/invoices/report?'+new URLSearchParams({tenantId,companyId,from:today,to:today,format:'csv'}),'GET',undefined,billingReader.cookie);status(exported,200);assert.match(exported.data,/SUB-/);assert.match(exported.headers.get('content-type'),/text\/csv/);
  assert.equal(await db.salesOrder.count({where:{tenantId}}),0,'no fabricated SalesOrder in any recurring flow');
 }finally{server.kill('SIGTERM');await db.$disconnect();}
});
