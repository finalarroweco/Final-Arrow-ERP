import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();test.after(()=>db.$disconnect());
async function fixture(treatment='ZERO',forgedCreator=false,status='ACTIVE'){
 const tenant=await db.tenant.create({data:{name:'Recurring SQL',slug:randomUUID()}}),tenantId=tenant.id;
 const user=await db.user.create({data:{name:'Billing operator',email:randomUUID()+'@example.invalid',passwordHash:'not-login'}}),createdBy=user.id;
 const member=await db.membership.create({data:{tenantId,userId:createdBy,status:'ACTIVE'}});
 const role=await db.role.create({data:{tenantId,name:'Billing operator'}});
 for(const permissionKey of ['billing-subscription:read','billing-subscription:manage','billing-subscription:generate','customer:read','invoice:create','invoice:read'])await db.rolePermission.create({data:{tenantId,roleId:role.id,permissionKey}});
 const grant=await db.roleGrant.create({data:{tenantId,membershipId:member.id,roleId:role.id}});await db.accessScope.create({data:{tenantId,grantId:grant.id,type:'TENANT'}});
 const company=await db.company.create({data:{tenantId,name:'Billing company',code:'BILL'}}),companyId=company.id;
 const customer=await db.customer.create({data:{tenantId,companyId,code:'C',displayName:'Original customer',createdBy}});
 const scope={tenantId,companyId,branchId:null},base={...scope,createdBy},actor={...scope,expectedActorId:createdBy,reason:'Explicit SQL fixture'};
 const lines=[{description:'Service / خدمة',quantity:2,unitPrice:'3.005',treatment}];
 const planId=randomUUID(),planRevisionId=randomUUID(),subscriptionId=randomUUID(),revisionId=randomUUID();
 const save=(tx,p,result)=>tx.billingRequest.create({data:{...base,id:p.requestId,action:p.action,request:p,result,outcome:'COMMITTED'}});
 let headCreatedBy=createdBy;if(forgedCreator){const other=await db.user.create({data:{name:'Other',email:randomUUID()+'@example.invalid',passwordHash:'not-login'}});await db.membership.create({data:{tenantId,userId:other.id,status:'ACTIVE'}});headCreatedBy=other.id;}
 const planRequest={...actor,action:'plan',requestId:randomUUID(),planId,expectedVersion:0,label:'Plan',currency:'OMR',lines,archived:false};
 await db.$transaction(async tx=>{
 await tx.billingPlan.create({data:{...base,createdBy:headCreatedBy,id:planId,version:1,label:'Plan',currency:'OMR',archived:false}});
 await tx.billingPlanRevision.create({data:{...base,id:planRevisionId,planId,version:1,label:'Plan',currency:'OMR',lines,archived:false,reason:actor.reason,requestId:planRequest.requestId}});
 await save(tx,planRequest,{kind:'plan',planId,revisionId:planRevisionId,version:1});
 });
 const config={...actor,action:'configure',requestId:randomUUID(),subscriptionId,customerId:customer.id,manualSubscriptionId:null,expectedVersion:0,anchor:'2024-01-31',cadence:{kind:'MONTHLY',months:1,rule:'CLAMP_ORIGINAL_DAY'},effectivePeriod:0,planId,planVersion:1,horizon:'2099-01-31',status,terms:{kind:'NONE'},archived:false};
 await db.$transaction(async tx=>{
 await tx.billingSubscription.create({data:{...base,id:subscriptionId,customerId:customer.id,anchor:new Date(config.anchor),cadence:config.cadence,currency:'OMR',version:1}});
 await tx.billingSubscriptionRevision.create({data:{...base,id:revisionId,subscriptionId,version:1,effectivePeriod:0,planRevisionId,horizon:new Date(config.horizon),status:config.status,terms:config.terms,archived:false,reason:actor.reason,requestId:config.requestId}});
 await save(tx,config,{kind:'configuration',subscriptionId,revisionId,version:1});
 });
 async function generate(overrides={},transform=async()=>{},afterInvoice=async()=>{},invoiceExtra={}){
 const id=randomUUID(),invoiceId=randomUUID(),requestId=randomUUID(),number='SUB-'+id.replaceAll('-','').slice(0,25).toUpperCase();
 const p={...actor,action:'backfill',requestId,subscriptionId,expectedVersion:1,periodIndex:0,previewHash:'a'.repeat(64),replacesSourceId:null,replacementPlanRevisionId:null,...overrides};
 return db.$transaction(async tx=>{
 const source={...base,id,customerId:customer.id,customerName:customer.displayName,subscriptionId,subscriptionRevisionId:revisionId,planRevisionId,periodIndex:p.periodIndex,periodStart:new Date('2024-01-31'),periodEnd:new Date('2024-02-29'),correctionIndex:0,replacesSourceId:p.replacesSourceId,currency:'OMR',lines:[{position:0,...lines[0],amount:'6.010',tax:'0.000'}],subtotal:'6.010',taxAmount:'0.000',reason:p.reason,requestId};
 await transform({source,p,tx});
 await tx.serviceInvoiceSource.create({data:source});
 const invoice=await tx.invoice.create({data:{...base,id:invoiceId,customerId:customer.id,customerName:customer.displayName,serviceSourceId:id,number,currency:'OMR',subtotal:'6.010',lines:{create:[{position:0,description:lines[0].description,quantity:2,unitPrice:'3.005',amount:'6.010'}]},...invoiceExtra}});
 await afterInvoice({tx,source,invoice,p});
 await save(tx,p,{kind:'invoice',subscriptionId,periodIndex:p.periodIndex,serviceSourceId:id,invoice:{id:invoiceId,number,status:'DRAFT'},alreadyGenerated:false});
 return {source,invoice,p};
 });
 }
 return {...base,actor,customer,member,planId,planRevisionId,subscriptionId,revisionId,config,planRequest,save,generate};
}
test('recurring source creates a genuine immutable DRAFT invoice without a SalesOrder',async()=>{
 const f=await fixture(),before=await db.salesOrder.count({where:{tenantId:f.tenantId}}),g=await f.generate();
 assert.equal(g.invoice.status,'DRAFT');assert.equal(g.invoice.orderId,null);assert.equal(await db.salesOrder.count({where:{tenantId:f.tenantId}}),before);
 for(const action of [()=>db.serviceInvoiceSource.update({where:{id:g.source.id},data:{reason:'forged'}}),()=>db.serviceInvoiceSource.delete({where:{id:g.source.id}}),()=>db.billingRequest.delete({where:{id:g.p.requestId}}),()=>db.invoice.update({where:{id:g.invoice.id},data:{serviceSourceId:null}}),()=>db.invoiceLine.create({data:{tenantId:f.tenantId,invoiceId:g.invoice.id,position:1,description:'late',quantity:1,unitPrice:'1.000',amount:'1.000'}}),()=>db.billingPlan.update({where:{id:f.planId},data:{version:2,label:'No revision'}})])await assert.rejects(action());
 const audit=await db.auditLog.findFirstOrThrow({where:{entity:'BillingRequest',entityId:g.p.requestId}});await assert.rejects(db.auditLog.delete({where:{id:audit.id}}));
 await assert.rejects(f.generate());
});
test('SQL source parity rejects forged scope, amounts, periods, request and classifications atomically',async()=>{
 const f=await fixture();
 for(const changes of [{subtotal:'6.011'},{customerName:'Forged'},{periodEnd:new Date('2024-02-28')},{lines:[{position:0,description:'wrong',quantity:2,unitPrice:'3.005',amount:'6.010',treatment:'ZERO',tax:'0.000'}]},{taxAmount:'0.001'},{planRevisionId:randomUUID()}])await assert.rejects(f.generate({},async({source})=>Object.assign(source,changes)));
 await assert.rejects(f.generate({action:'generate'}));
 await assert.rejects(f.generate({},async({p})=>p.expectedVersion=2));
 assert.equal(await db.invoice.count({where:{tenantId:f.tenantId}}),0);assert.equal(await db.serviceInvoiceSource.count({where:{tenantId:f.tenantId}}),0);
 await f.generate();
});
test('SQL calendar and money independently preserve original anchors and exact HALF_UP',async()=>{
 const rows=await db.$queryRaw`SELECT erp_billing_boundary('2024-01-31'::date,'{"kind":"MONTHLY","months":1,"rule":"CLAMP_ORIGINAL_DAY"}'::jsonb,2)::text AS d, erp_billing_prices('[{"description":"x","quantity":1,"unitPrice":"0.010","treatment":"STANDARD"}]'::jsonb,true) AS prices`;
 assert.equal(rows[0].d,'2024-03-31');assert.equal(rows[0].prices.taxAmount,'0.001');
});
test('SQL rejects absent/null tax, cadence and payment-term members',async()=>{
 for(const treatment of [null,undefined,'']){
 const line={description:'x',quantity:1,unitPrice:'1.000',treatment};
 await assert.rejects(db.$queryRaw`SELECT erp_billing_prices(${JSON.stringify([line])}::jsonb,false)`);
 }
 for(const cadence of [{kind:'MONTHLY',months:null,rule:null},{kind:'ANNUAL',years:1,leapDay:null},{kind:'DAYS',days:null}])await assert.rejects(db.$queryRaw`SELECT erp_billing_boundary('2024-01-31'::date,${JSON.stringify(cadence)}::jsonb,0)`);
 for(const terms of [{kind:'OFFSET',days:1,label:null,base:null},{kind:'OFFSET',days:1,label:'Net',base:null}])await assert.rejects(db.$queryRaw`SELECT erp_billing_due('2024-01-31'::date,'2024-02-29'::date,${JSON.stringify(terms)}::jsonb)`);
});
test('explicit replacement preserves original period and requires previous VOID invoice',async()=>{
 const f=await fixture(),original=await f.generate();
 const request={action:'replace',replacesSourceId:original.source.id,replacementPlanRevisionId:f.planRevisionId};
 await assert.rejects(f.generate(request,async({source})=>source.correctionIndex=1));
 await db.invoice.update({where:{id:original.invoice.id},data:{status:'VOID',voidedAt:new Date(),voidReason:'Explicit correction'}});
 const replacement=await f.generate(request,async({source})=>source.correctionIndex=1);
 assert.equal(replacement.source.periodIndex,0);assert.notEqual(replacement.invoice.number,original.invoice.number);
 await assert.rejects(f.generate(request,async({source})=>source.correctionIndex=2));
 assert.equal(await db.salesOrder.count({where:{tenantId:f.tenantId}}),0);
});
test('raw abandoned requests cannot authorize work or be reused, and stale actor loses billing authority',async()=>{
 const f=await fixture();
 const p={...f.actor,action:'backfill',requestId:randomUUID(),subscriptionId:f.subscriptionId,expectedVersion:1,periodIndex:0,previewHash:'a'.repeat(64),replacesSourceId:null,replacementPlanRevisionId:null};
 const data={id:p.requestId,tenantId:f.tenantId,companyId:f.companyId,branchId:null,createdBy:f.createdBy,action:p.action,request:p,result:{kind:'abandoned'},outcome:'ABANDONED'};
 await db.billingRequest.create({data});await assert.rejects(db.billingRequest.create({data}));await assert.rejects(db.billingRequest.update({where:{id:p.requestId},data:{outcome:'COMMITTED'}}));
 await assert.rejects(db.billingRequest.create({data:{...data,id:f.subscriptionId,request:{...p,requestId:f.subscriptionId}}}));
 await db.membership.update({where:{id:f.member.id},data:{status:'SUSPENDED'}});await assert.rejects(f.generate());
});
test('recurring ACLs and TRUNCATE blockers preserve durable histories',async()=>{
 for(const table of ['BillingPlan','BillingPlanRevision','BillingSubscription','BillingSubscriptionRevision','BillingRequest','ServiceInvoiceSource']){
 const rows=await db.$queryRaw`SELECT relrowsecurity AS enabled FROM pg_class WHERE oid=${'"'+table+'"'}::regclass`;assert.equal(rows[0].enabled,true);
 for(const role of ['anon','authenticated']){const exists=await db.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${role}) AS exists`;if(!exists[0].exists)continue;const p=await db.$queryRaw`SELECT has_table_privilege(${role},${'"'+table+'"'},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed`;assert.equal(p[0].allowed,false);}
 await assert.rejects(db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`));
 }
});
test('backfill uses current invoice-date VAT profile, never historical service-date regime',async()=>{
 const f=await fixture('STANDARD');
 const output=await db.ledgerAccount.create({data:{tenantId:f.tenantId,companyId:f.companyId,code:'VAT',name:'Output VAT',type:'LIABILITY',createdBy:f.createdBy}});
 const profile=await db.companyVatProfile.create({data:{tenantId:f.tenantId,companyId:f.companyId,enabled:true,effectiveFrom:new Date('2025-01-01'),taxNumber:'VAT-123',sellerName:'Billing seller',sellerAddress:'Muscat address',outputAccountId:output.id}});
 await assert.rejects(f.generate());
 const transform=async({source})=>{source.vatProfileRevision=profile.revision;source.taxAmount='0.301';source.lines[0].tax='0.301';};
 const after=async({tx,invoice})=>tx.invoiceVat.create({data:{invoiceId:invoice.id,tenantId:f.tenantId,companyId:f.companyId,taxAmount:'0.301',outputAccountId:output.id,taxNumber:profile.taxNumber,sellerName:profile.sellerName,sellerAddress:profile.sellerAddress,details:[{position:0,treatment:'STANDARD',net:'6.010',tax:'0.301'}]}});
 const g=await f.generate({},transform,after);assert.equal(g.source.periodStart.toISOString().slice(0,10),'2024-01-31');
 assert.equal((await db.invoiceVat.findUniqueOrThrow({where:{invoiceId:g.invoice.id}})).taxAmount.toFixed(3),'0.301');
 await assert.rejects(db.invoiceVat.update({where:{invoiceId:g.invoice.id},data:{taxAmount:'0.000'}}));
 await assert.rejects(db.invoiceLine.create({data:{tenantId:f.tenantId,invoiceId:g.invoice.id,position:1,description:'late tax line',quantity:1,unitPrice:'1.000',amount:'1.000'}}));
});
test('missing or both invoice sources and incomplete order source are rejected',async()=>{
 const f=await fixture(),base={tenantId:f.tenantId,companyId:f.companyId,customerId:f.customer.id,customerName:f.customer.displayName,currency:'OMR',subtotal:'6.010',createdBy:f.createdBy,number:'MISSING'};
 await assert.rejects(db.invoice.create({data:base}));
 const quote=await db.quote.create({data:{tenantId:f.tenantId,companyId:f.companyId,customerId:f.customer.id,number:'Q',currency:'OMR',subtotal:'6.010',createdBy:f.createdBy}});
 const order=await db.salesOrder.create({data:{quoteId:quote.id,tenantId:f.tenantId,companyId:f.companyId,customerId:f.customer.id,customerName:f.customer.displayName,number:'ORDER',currency:'OMR',subtotal:'6.010',createdBy:f.createdBy}});
 await assert.rejects(db.invoice.create({data:{...base,number:'INCOMPLETE',orderId:order.id}}));
 const g=await f.generate();await assert.rejects(db.invoice.create({data:{...base,number:'BOTH',orderId:order.id,serviceSourceId:g.source.id}}));
});
test('new request for generated VOID period replays its original source without a second entitlement',async()=>{
 const f=await fixture(),g=await f.generate();await db.invoice.update({where:{id:g.invoice.id},data:{status:'VOID',voidedAt:new Date(),voidReason:'Explicit void'}});
 const p={...g.p,requestId:randomUUID()},result={kind:'invoice',subscriptionId:f.subscriptionId,periodIndex:0,serviceSourceId:g.source.id,invoice:{id:g.invoice.id,number:g.invoice.number,status:'VOID'},alreadyGenerated:true};
 await db.$transaction(tx=>f.save(tx,p,result));assert.equal(await db.serviceInvoiceSource.count({where:{subscriptionId:f.subscriptionId}}),1);
 await assert.rejects(db.$transaction(tx=>f.save(tx,{...p,requestId:randomUUID()},{...result,serviceSourceId:randomUUID()})));
 await assert.rejects(db.$transaction(tx=>f.save(tx,{...p,requestId:randomUUID()},result),{isolationLevel:'RepeatableRead'}));
});

test('invoice, line and VAT truncation cannot orphan recurring history',async()=>{
 for(const table of ['Invoice','InvoiceLine','InvoiceVat'])await assert.rejects(db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`));
});

test('service invoice creation date is normalized to source creation, never caller backdating',async()=>{
 for(const claimed of ['2000-01-01','2099-12-31']){const f=await fixture(),g=await f.generate({},async()=>{},async()=>{},{createdAt:new Date(claimed)}),source=await db.serviceInvoiceSource.findUniqueOrThrow({where:{id:g.source.id}});assert.equal(g.invoice.createdAt.toISOString(),source.createdAt.toISOString());assert.notEqual(g.invoice.createdAt.toISOString().slice(0,10),claimed);}
});
test('billing SQL helpers deny default and optional provider EXECUTE grants',async()=>{
 const rows=await db.$queryRaw`SELECT count(*)::int AS n FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'erp_billing_%' OR p.proname IN ('erp_service_source_complete','erp_invoice_source_insert')) AND a.privilege_type='EXECUTE' AND (a.grantee=0 OR r.rolname IN ('anon','authenticated'))`;
 assert.equal(rows[0].n,0);
});

test('initial billing identity cannot attribute its creator to another member',async()=>{await assert.rejects(fixture('ZERO',true));});
test('raw forged VOID cannot replace an invoice with an active posting; reversal allows correction',async()=>{
 for(const audited of [false,true]){
 const f=await fixture(),g=await f.generate();
 const ar=await db.ledgerAccount.create({data:{tenantId:f.tenantId,companyId:f.companyId,code:'AR',name:'Receivable',type:'ASSET',createdBy:f.createdBy}}),revenue=await db.ledgerAccount.create({data:{tenantId:f.tenantId,companyId:f.companyId,code:'REV',name:'Revenue',type:'REVENUE',createdBy:f.createdBy}});
 const number='SYSI-'+BigInt('0x'+g.invoice.id.replaceAll('-','')).toString(36).toUpperCase().padStart(25,'0');
 const checked=await db.$queryRaw`SELECT erp_billing_invoice_journal(${g.invoice.id}::uuid) AS number`;assert.equal(checked[0].number,number);
 const data={tenantId:f.tenantId,companyId:f.companyId,number:audited?'AUDIT-LINKED-POSTING':number,entryDate:new Date(),description:'Original invoice posting',currency:'OMR',total:'6.010',createdBy:f.createdBy,lines:{create:[{accountId:ar.id,position:0,debit:'6.010',credit:'0.000'},{accountId:revenue.id,position:1,debit:'0.000',credit:'6.010'}]}};
 const journal=await db.journalEntry.create({data});
 if(audited)await db.auditLog.create({data:{tenantId:f.tenantId,actorId:f.createdBy,entity:'Invoice',entityId:g.invoice.id,action:'invoice.ledger_posted',metadata:{journalId:journal.id}}});
 await db.invoice.update({where:{id:g.invoice.id},data:{status:'VOID',voidedAt:new Date(),voidReason:'Forged raw status'}});
 const replacement={action:'replace',replacesSourceId:g.source.id,replacementPlanRevisionId:f.planRevisionId};
 await assert.rejects(f.generate(replacement,async({source})=>source.correctionIndex=1));
 await db.journalEntry.create({data:{...data,number:'REVERSE-'+journal.id.slice(0,8),reversalOf:journal.id,description:'Explicit reversal',lines:{create:[{accountId:ar.id,position:0,debit:'0.000',credit:'6.010'},{accountId:revenue.id,position:1,debit:'6.010',credit:'0.000'}]}}});
 const corrected=await f.generate(replacement,async({source})=>source.correctionIndex=1);assert.equal(corrected.invoice.status,'DRAFT');
 }
});
test('SQL canonical invoice journal uses exact integer division across all UUID bits',async()=>{
 for(const id of ['00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff','80000000-0000-0000-0000-000000000001',...Array.from({length:24},()=>randomUUID())]){
 const rows=await db.$queryRaw`SELECT erp_billing_invoice_journal(${id}::uuid) AS number`;
 assert.equal(rows[0].number,'SYSI-'+BigInt('0x'+id.replaceAll('-','')).toString(36).toUpperCase().padStart(25,'0'));
 }
});

test('explicit PAUSED and ENDED backfill corrections preserve configuration and one original entitlement',async()=>{
 for(const status of ['PAUSED','ENDED']){
 const f=await fixture('ZERO',false,status);
 await assert.rejects(f.generate({action:'generate'}));
 const original=await f.generate();
 const replacement={action:'replace',replacesSourceId:original.source.id,replacementPlanRevisionId:f.planRevisionId};
 await assert.rejects(f.generate(replacement,async({source})=>source.correctionIndex=1));
 await db.invoice.update({where:{id:original.invoice.id},data:{status:'VOID',voidedAt:new Date(),voidReason:'Explicit correction of historical backfill'}});
 const corrected=await f.generate(replacement,async({source})=>source.correctionIndex=1);
 assert.equal(corrected.invoice.status,'DRAFT');assert.equal(corrected.source.periodIndex,original.source.periodIndex);
 assert.equal(corrected.source.periodStart.toISOString(),original.source.periodStart.toISOString());assert.equal(corrected.source.periodEnd.toISOString(),original.source.periodEnd.toISOString());
 assert.notEqual(corrected.invoice.number,original.invoice.number);
 const current=await db.billingSubscription.findUniqueOrThrow({where:{id:f.subscriptionId},include:{revisions:true}});
 assert.equal(current.version,1);assert.equal(current.archived,false);assert.equal(current.revisions.length,1);assert.equal(current.revisions[0].status,status);assert.equal(current.revisions[0].horizon.toISOString().slice(0,10),f.config.horizon);
 assert.equal(await db.serviceInvoiceSource.count({where:{subscriptionId:f.subscriptionId,periodIndex:0,correctionIndex:0}}),1);
 assert.equal(await db.serviceInvoiceSource.count({where:{subscriptionId:f.subscriptionId,periodIndex:0}}),2);
 await assert.rejects(f.generate(replacement,async({source})=>source.correctionIndex=1));
 await assert.rejects(f.generate({...replacement,replacesSourceId:corrected.source.id},async({source})=>source.correctionIndex=2));
 assert.equal(await db.salesOrder.count({where:{tenantId:f.tenantId}}),0);
 }
});
