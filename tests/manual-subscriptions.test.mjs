import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PrismaClient} from '@prisma/client';
const compiled={exports:{}};
new Function('require','module','exports',ts.transpileModule(readFileSync('src/lib/manual-subscription-input.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(createRequire(import.meta.url),compiled,compiled.exports);
const {subscriptionResponseMatches,subscriptionCancellationMatches}=compiled.exports;
const port=3302,origin=`http://127.0.0.1:${port}`,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(path,method='GET',body,cookie,headers={}){
 const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 return {status:response.status,data,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
test('manual subscriptions are scoped, source-authorized, immutable, versioned and exactly recoverable',{timeout:240000},async()=>{
 const db=new PrismaClient(),url=new URL(process.env.DATABASE_URL);url.searchParams.set('connection_limit',process.env.MANUAL_SUBSCRIPTION_POOL_LIMIT??'8');
 url.searchParams.set('application_name','manual-subscription-api-tests');
 const server=spawn('./node_modules/.bin/next',['start','-H','127.0.0.1','-p',String(port)],{env:{...process.env,DATABASE_URL:url.toString(),ALLOW_REGISTRATION:'true'},stdio:['ignore','ignore','inherit']});
 try{
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await pause(250);}assert.ok(ready,'Next server ready');
  async function register(label){const suffix=randomUUID().slice(0,8),r=await call('/api/auth/register','POST',{name:label,email:`text-doc-${suffix}@example.invalid`,password:'Text-doc-password-2026',organization:label,slug:`text-doc-${suffix}`});assert.equal(r.status,201,JSON.stringify(r));const actorId=(await db.membership.findFirstOrThrow({where:{tenantId:r.data.tenantId}})).userId;return {tenantId:r.data.tenantId,cookie:r.cookie,actorId};}
  const owner=await register('Text document owner'),{tenantId,cookie,actorId}=owner;
  const builtInRoles=await db.role.findMany({where:{tenantId,name:{in:['Owner','Manager','Viewer']}},include:{permissions:true}});
  assert.equal(builtInRoles.length,3);
  for(const role of builtInRoles){const subscriptionPermissions=role.permissions.map(p=>p.permissionKey).filter(p=>p.startsWith('subscription:')).sort();assert.deepEqual(subscriptionPermissions,role.name==='Owner'?['subscription:manage','subscription:read']:[],role.name+' document permissions remain opt-in');}
  const create=async(path,body)=>{const r=await call(path,'POST',{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r));return r.data;};
  const {company}=await create('/api/companies',{name:'Document company',code:'DOC',baseCurrency:'OMR'}),companyId=company.id;
  const {company:otherCompany}=await create('/api/companies',{name:'Other document company',code:'DOC2',baseCurrency:'OMR'});
  const {branch}=await create('/api/branches',{companyId,name:'Document branch',code:'TEXT'}),{branch:sibling}=await create('/api/branches',{companyId,name:'Sibling document branch',code:'SIB'});
  const {customer}=await create('/api/customers',{companyId,branchId:branch.id,code:'SUB-CUSTOMER',displayName:'Subscription source customer',email:'private-source@example.invalid',phone:'PRIVATE-PHONE',notes:'PRIVATE-CUSTOMER-NOTE'});
  const {customer:wideCustomer}=await create('/api/customers',{companyId,branchId:null,code:'SUB-WIDE',displayName:'Company-wide source'});
  const {customer:siblingCustomer}=await create('/api/customers',{companyId,branchId:sibling.id,code:'SUB-SIB',displayName:'Sibling source'});
  const {customer:otherCustomer}=await create('/api/customers',{companyId:otherCompany.id,branchId:null,code:'SUB-OTHER',displayName:'Other company source'});
  const endpoint='/api/manual-subscriptions',scope={tenantId,companyId,branchId:branch.id,customerId:customer.id};
  const fresh=(patch={})=>({...scope,expectedActorId:actorId,requestId:randomUUID(),subscriptionId:randomUUID(),expectedVersion:0,action:'create',serviceLabel:'=Private Arabic reference',description:'تعليمات داخلية\nEnglish line\n<script>window.secret = true</script>\nhttps://example.invalid/no-autolink\n👩🏽‍💻',reason:'Explicit initial text',agreementReference:'Known agreement reference',status:'PLANNED',startDate:'2024-02-29',endDate:null,nextReviewDate:'2027-01-15',...patch});
  const post=(payload,c=cookie)=>call(endpoint,'POST',payload,c),resolve=(payload,c=cookie)=>call(endpoint+'/resolve','POST',payload,c);
  const query=(patch={})=>'?'+new URLSearchParams({tenantId,companyId,...patch});
  const detail=(id,patch={})=>endpoint+'/'+id+query(patch);
  const exportPath=(id,eventId,patch={})=>endpoint+'/'+id+'/export'+query({eventId,...patch});
  const printPath=(id,eventId,patch={})=>'/manual-subscriptions/'+id+'/print'+query({eventId,...patch});
  async function invite(permissions,name,type='BRANCH',targetBranch=branch.id){
   const {role}=await create('/api/roles',{name,permissions});
   const invitation=await create('/api/invitations',{email:`text-doc-${randomUUID().slice(0,8)}@example.invalid`,roleId:role.id,scope:{type,companyId,...(type==='BRANCH'?{branchId:targetBranch}:{})}});
   const r=await call('/api/invitations/accept','POST',{token:invitation.path.split('/').at(-1),name,password:'Text-doc-member-2026'});assert.equal(r.status,200,JSON.stringify(r));
   const user=await db.user.findFirstOrThrow({where:{name,memberships:{some:{tenantId}}}});return {id:user.id,cookie:r.cookie,roleId:role.id};
  }
  const reader=await invite(['subscription:read','customer:read'],'Text branch reader'),manager=await invite(['subscription:read','subscription:manage','customer:read'],'Text branch manager'),companyReader=await invite(['subscription:read','customer:read'],'Text company reader','COMPANY'),unrelated=await invite(['customer:read'],'Text unrelated reader');
  const protectedTables=['Customer','CustomerContact','CompanyVatProfile','Invoice','InvoiceLine','CustomerSettlement','SupplierSettlement','JournalEntry','JournalLine','InvoiceVat','PurchaseVat','ExpenseVat','PosVat','StockBalance','StockMovement','StockReservation','SalesStockDocument','SalesStockCancellation'];
  async function protectedSnapshot(){const result={};for(const table of protectedTables){result[table]=await db.$queryRawUnsafe(`SELECT row_to_json(t)::text AS row, xmin::text AS row_version FROM "${table}" t WHERE "tenantId"=$1::uuid ORDER BY row`,tenantId);}return result;}
  // Nonempty, isolated fixtures prove the register cannot mutate existing money/stock.
  const account=async(code,type)=>(await create('/api/ledger/accounts',{companyId,code,name:code,type})).account;
  const ar=await account('1200','ASSET'),cash=await account('1010','ASSET'),revenue=await account('4000','REVENUE'),output=await account('2200','LIABILITY'),day=new Date().toISOString().slice(0,10);
  assert.equal((await call(`/api/companies/${companyId}/vat`,'PUT',{tenantId,expectedRevision:0,enabled:true,taxNumber:'OM-SUB-TEST',sellerName:'Subscription test seller',sellerAddress:'Isolated test address',effectiveFrom:day,outputAccountId:output.id},cookie)).status,200);
  const {quote}=await create('/api/quotes',{companyId,branchId:branch.id,customerId:customer.id,number:'SUB-Q-1',lines:[{description:'Existing independent invoice',quantity:1,unitPrice:'10.000'}]});
  for(const action of ['send','accept'])assert.equal((await call(`/api/quotes/${quote.id}/status`,'PATCH',{tenantId,action},cookie)).status,200);
  const {order}=await create(`/api/quotes/${quote.id}/order`,{number:'SUB-O-1'});
  for(const action of ['start','complete'])assert.equal((await call(`/api/orders/${order.id}/status`,'PATCH',{tenantId,action},cookie)).status,200);
  const {invoice}=await create(`/api/orders/${order.id}/invoice`,{number:'SUB-I-1',vat:[{position:0,treatment:'STANDARD'}]});
  assert.equal((await call(`/api/invoices/${invoice.id}/status`,'PATCH',{tenantId,action:'issue'},cookie)).status,200);
  await create(`/api/ledger/documents/invoice/${invoice.id}`,{entryDate:day,debitAccountId:ar.id,creditAccountId:revenue.id});
  await create(`/api/invoices/${invoice.id}/settlements`,{requestId:randomUUID(),kind:'COLLECTION',amount:'2.000',entryDate:day,assetAccountId:cash.id,reference:'Independent fixture collection'});
  const {item}=await create('/api/inventory/items',{companyId,sku:'SUB-STOCK',name:'Independent fixture stock',unit:'piece'});
  await create('/api/inventory/stock',{companyId,branchId:branch.id,itemId:item.id,action:'in',quantity:'7.125',reason:'Independent fixture opening stock'});
  const financialBefore=await protectedSnapshot();
  const initial=fresh();assert.equal((await post(initial)).status,201);
  // Unauthenticated calls are deliberately separate from the default-cookie helper.
  assert.equal((await call(endpoint,'POST',fresh())).status,401);
  assert.equal((await call(endpoint+query())).status,401);
  assert.equal((await post(fresh({expectedActorId:reader.id}),reader.cookie)).status,403);
  assert.equal((await post(fresh(),manager.cookie)).status,403,'actor guard blocks another actor recovery');
  assert.equal((await resolve(initial,manager.cookie)).status,403);
  const csrf=await post(fresh());assert.equal(csrf.status,201);
  assert.equal((await call(endpoint,'POST',fresh(),cookie,{Origin:'https://evil.invalid'})).status,403);
  for(const patch of [{serviceLabel:''},{serviceLabel:'x'.repeat(201)},{description:'😀'.repeat(16385)},{reason:''},{reason:'x'.repeat(301)},{expectedVersion:-1},{serviceLabel:'bad\u0000title'},{description:'bad\u0000body'},{createdAt:'2000-01-01'},{branchId:randomUUID()},{startDate:'2023-02-29'},{endDate:'2026-04-31'},{nextReviewDate:'2026-13-01'},{status:'RENEWED'},{agreementReference:'x'.repeat(201)},{billingAmount:'100'}]){
   const r=await post(fresh(patch));assert.ok([400,403,404,409].includes(r.status),JSON.stringify({patch,status:r.status}));
  }
  const duplicates=await Promise.all([post(initial),post(initial)]);assert.ok(duplicates.every(r=>r.status===201),JSON.stringify(duplicates));
  const original=duplicates[0].data.event;assert.ok(subscriptionResponseMatches(initial,original));assert.deepEqual(duplicates[1].data.event,original);assert.notEqual(original.id,initial.requestId);assert.notEqual(original.id,initial.subscriptionId);
  const loaded=await call(detail(initial.subscriptionId),'GET',undefined,cookie);assert.equal(loaded.status,200);assert.equal(loaded.data.subscription.description,initial.description);assert.equal(loaded.data.events.length,1);assert.equal(loaded.data.canManage,true);
  assert.equal((await call(detail(initial.subscriptionId),'GET',undefined,reader.cookie)).data.canManage,false);
  const exported=await call(exportPath(initial.subscriptionId,original.id),'GET',undefined,reader.cookie);assert.equal(exported.status,200);assert.match(exported.headers.get('content-type'),/^text\/plain/);assert.match(exported.headers.get('content-disposition'),/^attachment;/);assert.equal(exported.headers.get('x-content-type-options'),'nosniff');assert.ok(exported.data.includes(initial.description),'complete literal selected revision');
  const printed=await call(printPath(initial.subscriptionId,original.id),'GET',undefined,reader.cookie);assert.equal(printed.status,200);assert.ok(!printed.data.includes('<script>window.secret = true</script>'));assert.ok(printed.data.includes('&lt;script&gt;'),'plain text HTML escaping');
  // Mounted actor context remains bound even after another tab changes the cookie.
  const actorReadPaths=[endpoint+query(),endpoint+query({format:'csv'}),detail(initial.subscriptionId),detail(initial.subscriptionId,{page:'0'}),exportPath(initial.subscriptionId,original.id),printPath(initial.subscriptionId,original.id),endpoint+'/customers'+query({branchId:branch.id})];
  for(const path of actorReadPaths){
   const matched=await call(path+'&expectedActorId='+actorId,'GET',undefined,cookie);assert.equal(matched.status,200,path);
   for(const [expectedActorId,session] of [[reader.id,cookie],[actorId,reader.cookie]]){const denied=await call(path+'&expectedActorId='+expectedActorId,'GET',undefined,session);assert.ok([403,404].includes(denied.status),path+' actor mismatch '+denied.status);for(const secret of [initial.serviceLabel,initial.description,customer.displayName])assert.ok(!JSON.stringify(denied.data).includes(secret),'no switched-actor data '+path);}
  }
  const metadata=await call(endpoint+query({format:'csv'}),'GET',undefined,cookie);assert.equal(metadata.status,200);assert.ok(metadata.data.includes("'=Private Arabic reference"));assert.ok(!metadata.data.includes(initial.description));assert.ok(!metadata.data.includes(initial.reason));
  for(const suffix of ['&page=0&page=1','&q=x&q=y','&unknown=true','&page=-1','&page=1.2','&state=DELETED','&q='+encodeURIComponent('x'.repeat(121))])assert.equal((await call(endpoint+query()+suffix,'GET',undefined,cookie)).status,400,suffix);
  for(const patch of [{serviceLabel:'changed'},{description:'changed'},{reason:'changed'},{subscriptionId:randomUUID()}])assert.equal((await post({...initial,...patch})).status,409);
  const edit={...initial,requestId:randomUUID(),action:'edit',expectedVersion:1,serviceLabel:'Updated title',description:'المحتوى الثاني\nSecond full snapshot',reason:'Correct operating note',startDate:null,endDate:'2025-01-01',nextReviewDate:null,status:'PAUSED',agreementReference:''};
  const edited=await post(edit);assert.equal(edited.status,201,JSON.stringify(edited));assert.ok(subscriptionResponseMatches(edit,edited.data.event));assert.equal(edited.data.event.version,2);assert.equal(edited.data.event.startDate,null);assert.equal(edited.data.event.nextReviewDate,null);assert.equal(edited.data.event.endDate,'2025-01-01');assert.equal(edited.data.event.status,'PAUSED');assert.equal(edited.data.event.agreementReference,'');
  assert.deepEqual((await post(initial)).data.event,original,'replay returns original, not current contents');assert.deepEqual((await resolve(initial)).data.event,original);
  assert.equal((await post({...edit,requestId:randomUUID()})).status,409,'new stale version rejected');
  const lifecycle=(action,version,patch={})=>({...scope,subscriptionId:initial.subscriptionId,requestId:randomUUID(),expectedActorId:actorId,action,expectedVersion:version,reason:'Explicit '+action,...patch});
  const archive=lifecycle('archive',2),archived=await post(archive);assert.equal(archived.status,201);assert.equal(archived.data.event.archived,true);assert.equal(archived.data.event.description,edit.description);assert.equal(archived.data.event.version,3);assert.equal(archived.data.event.status,'PAUSED','archive does not end an agreement');
  assert.ok(!(await call(endpoint+query(),'GET',undefined,cookie)).data.subscriptions.some(d=>d.id===initial.subscriptionId));
  assert.ok((await call(endpoint+query({state:'ARCHIVED'}),'GET',undefined,cookie)).data.subscriptions.some(d=>d.id===initial.subscriptionId));
  assert.equal((await call(exportPath(initial.subscriptionId,original.id),'GET',undefined,reader.cookie)).status,200,'archive retains historical reads');
  assert.equal((await post({...edit,requestId:randomUUID(),expectedVersion:3})).status,409,'archived editing does not reactivate');
  const restore=lifecycle('restore',3),restored=await post(restore);assert.equal(restored.status,201);assert.equal(restored.data.event.archived,false);assert.equal(restored.data.event.description,edit.description);assert.equal(restored.data.event.version,4);assert.deepEqual((await post(archive)).data.event,archived.data.event);
  assert.equal((await post(lifecycle('restore',4))).status,409);assert.equal((await post(lifecycle('archive',4,{description:'implicit replacement'}))).status,400);
  const raceEdit={...edit,requestId:randomUUID(),expectedVersion:4,description:'Race winner edit'},raceArchive=lifecycle('archive',4);
  const race=await Promise.all([post(raceEdit),post(raceArchive)]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
  const racedDetail=(await call(detail(initial.subscriptionId),'GET',undefined,cookie)).data;assert.equal(racedDetail.subscription.version,5);assert.equal(racedDetail.events.length,5);
  const abandoned=fresh(),cancelled=await resolve(abandoned);assert.equal(cancelled.status,200,JSON.stringify(cancelled));assert.ok(subscriptionCancellationMatches(abandoned,cancelled.data.cancellation));assert.equal((await post(abandoned)).status,409);assert.deepEqual((await resolve(abandoned)).data,cancelled.data);assert.equal((await resolve({...abandoned,description:'different uncertain text'})).status,409);
  assert.equal((await call(detail(abandoned.subscriptionId),'GET',undefined,cookie)).status,404);
  const uncertain=fresh(),resolutionRace=await Promise.all([post(uncertain),resolve(uncertain)]);assert.equal(resolutionRace[1].status,200);
  const resolution=resolutionRace[1].data;if(resolution.event){assert.ok(subscriptionResponseMatches(uncertain,resolution.event));assert.equal((await post(uncertain)).status,201);}else{assert.ok(subscriptionCancellationMatches(uncertain,resolution.cancellation));assert.equal((await post(uncertain)).status,409);}
  // Scope privacy applies before search, count, pagination, export and history.
  const privateDocs=[];
  for(const patch of [{branchId:null,customerId:wideCustomer.id,serviceLabel:'HIDDEN-WIDE-NOTE'},{branchId:sibling.id,customerId:siblingCustomer.id,serviceLabel:'HIDDEN-SIBLING-NOTE'},{companyId:otherCompany.id,branchId:null,customerId:otherCustomer.id,serviceLabel:'HIDDEN-COMPANY-NOTE'}]){const p=fresh(patch),r=await post(p);assert.equal(r.status,201,JSON.stringify(r));privateDocs.push({p,event:r.data.event});}
  for(const {p,event} of privateDocs){
   const narrowed={tenantId,companyId:p.companyId};
   for(const path of [endpoint+'/'+p.subscriptionId+'?'+new URLSearchParams(narrowed),exportPath(p.subscriptionId,event.id,{companyId:p.companyId}),printPath(p.subscriptionId,event.id,{companyId:p.companyId})]){const r=await call(path,'GET',undefined,reader.cookie);assert.ok([403,404].includes(r.status),path);assert.ok(!JSON.stringify(r.data).includes(p.serviceLabel));}
   const altered={...p,expectedActorId:manager.id};assert.equal((await post(altered,manager.cookie)).status,403);assert.equal((await resolve(altered,manager.cookie)).status,403);
  }
  for(const title of ['HIDDEN-WIDE-NOTE','HIDDEN-SIBLING-NOTE']){const r=await call(endpoint+query({q:title,state:'ALL'}),'GET',undefined,reader.cookie);assert.equal(r.status,200);assert.equal(r.data.subscriptions.length,0);assert.equal(r.data.nextPage,null);}
  const ownList=await call(endpoint+query({state:'ALL'}),'GET',undefined,reader.cookie);assert.equal(ownList.status,200);assert.ok(ownList.data.subscriptions.every(d=>d.branchId===branch.id));assert.ok(ownList.data.subscriptions.every(d=>!Object.hasOwn(d,'description')));
  const companyWide=privateDocs[0];assert.equal((await call(detail(companyWide.p.subscriptionId),'GET',undefined,companyReader.cookie)).status,200);
  // Existing built-in operational roles do not silently gain this private library.
  for(const role of builtInRoles.filter(r=>r.name!=='Owner')){
   const invitation=await create('/api/invitations',{email:`text-doc-builtin-${randomUUID().slice(0,8)}@example.invalid`,roleId:role.id,scope:{type:'COMPANY',companyId}});
   const accepted=await call('/api/invitations/accept','POST',{token:invitation.path.split('/').at(-1),name:'Document built-in '+role.name,password:'Text-doc-member-2026'});assert.equal(accepted.status,200,JSON.stringify(accepted));
   for(const path of [endpoint+query({branchId:'company'}),detail(companyWide.p.subscriptionId),exportPath(companyWide.p.subscriptionId,companyWide.event.id),printPath(companyWide.p.subscriptionId,companyWide.event.id)]){
    const denied=await call(path,'GET',undefined,accepted.cookie);assert.ok([403,404].includes(denied.status),role.name+' '+path);assert.ok(!JSON.stringify(denied.data).includes(companyWide.p.serviceLabel));
   }
  }

  // Record-scope rights do not imply customer rights, including snapshot rights.
  const recordOnly=await invite(['subscription:read','subscription:manage'],'Subscription rights only'),sourceOnly=await invite(['customer:read'],'Customer rights only');
  for(const who of [recordOnly,sourceOnly]){
   assert.equal((await post(fresh({expectedActorId:who.id}),who.cookie)).status,403);
   for(const path of [detail(initial.subscriptionId),exportPath(initial.subscriptionId,original.id),printPath(initial.subscriptionId,original.id)])assert.ok([403,404].includes((await call(path,'GET',undefined,who.cookie)).status),path);
   const list=await call(endpoint+query({q:initial.serviceLabel,state:'ALL'}),'GET',undefined,who.cookie);assert.ok(list.status===403||list.status===200&&list.data.subscriptions.length===0);assert.ok(!JSON.stringify(list.data).includes(customer.displayName));
  }
  const wideSource=fresh({customerId:wideCustomer.id,serviceLabel:'HIDDEN-CUSTOMER-SCOPE'}),wideSaved=await post(wideSource);assert.equal(wideSaved.status,201);
  for(const path of [detail(wideSource.subscriptionId),exportPath(wideSource.subscriptionId,wideSaved.data.event.id),printPath(wideSource.subscriptionId,wideSaved.data.event.id)])assert.ok([403,404].includes((await call(path,'GET',undefined,reader.cookie)).status),path);
  const wideSearch=await call(endpoint+query({q:wideSource.serviceLabel,state:'ALL'}),'GET',undefined,reader.cookie);assert.equal(wideSearch.status,200);assert.deepEqual(wideSearch.data.subscriptions,[]);assert.equal(wideSearch.data.nextPage,null);
  assert.equal((await post(fresh({customerId:wideCustomer.id,expectedActorId:manager.id}),manager.cookie)).status,403,'branch customer read does not authorize company-wide customer');
  const split=await invite(['customer:read'],'Company customer reader','COMPANY'),membership=await db.membership.findUniqueOrThrow({where:{tenantId_userId:{tenantId,userId:split.id}}});
  await db.roleGrant.create({data:{tenantId,membershipId:membership.id,roleId:recordOnly.roleId,scopes:{create:{type:'BRANCH',companyId,branchId:branch.id}}}});
  const splitInput=fresh({customerId:wideCustomer.id,expectedActorId:split.id}),splitSaved=await post(splitInput,split.cookie);assert.equal(splitSaved.status,201,'company-wide customer rights plus branch register rights compose');
  assert.equal((await post(fresh({customerId:wideCustomer.id,branchId:sibling.id,expectedActorId:split.id}),split.cookie)).status,403);
  assert.equal((await post(fresh({customerId:wideCustomer.id,branchId:null,expectedActorId:split.id}),split.cookie)).status,403);
  for(const patch of [{customerId:siblingCustomer.id},{customerId:otherCustomer.id},{branchId:null},{customerId:customer.id,branchId:sibling.id}])assert.ok([403,404,409].includes((await post(fresh(patch))).status),'incompatible source '+JSON.stringify(patch));
  assert.equal((await post({...edit,customerId:wideCustomer.id,requestId:randomUUID(),expectedVersion:5})).status,409,'source identity cannot be reassigned');
  const choices=path=>endpoint+'/customers'+query(path);
  const branchChoices=await call(choices({branchId:branch.id}),'GET',undefined,manager.cookie);assert.equal(branchChoices.status,200);assert.ok(branchChoices.data.customers.some(c=>c.id===customer.id));assert.ok(branchChoices.data.customers.every(c=>c.id!==wideCustomer.id&&c.id!==siblingCustomer.id));
  const splitChoices=await call(choices({branchId:branch.id}),'GET',undefined,split.cookie);assert.equal(splitChoices.status,200);assert.ok(splitChoices.data.customers.some(c=>c.id===wideCustomer.id));assert.ok(!splitChoices.data.customers.some(c=>c.id===siblingCustomer.id));
  for(const result of [branchChoices,splitChoices,loaded])for(const secret of ['private-source@example.invalid','PRIVATE-PHONE','PRIVATE-CUSTOMER-NOTE'])assert.ok(!JSON.stringify(result.data).includes(secret),'no contact snapshots');
  assert.ok([403,404].includes((await call(choices({branchId:branch.id}),'GET',undefined,reader.cookie)).status),'read-only user cannot populate create sources');
  for(const suffix of ['&q=x&q=y','&unknown=1','&page=-1'])assert.equal((await call(choices({branchId:branch.id})+suffix,'GET',undefined,cookie)).status,400);
  // The inverse split is legal too: broad register permission, narrow source permission.
  const inverse=await invite(['subscription:read','subscription:manage'],'Company register branch customer','COMPANY'),inverseMembership=await db.membership.findUniqueOrThrow({where:{tenantId_userId:{tenantId,userId:inverse.id}}});
  await db.roleGrant.create({data:{tenantId,membershipId:inverseMembership.id,roleId:sourceOnly.roleId,scopes:{create:{type:'BRANCH',companyId,branchId:branch.id}}}});
  assert.equal((await post(fresh({expectedActorId:inverse.id}),inverse.cookie)).status,201);
  assert.equal((await post(fresh({expectedActorId:inverse.id,customerId:wideCustomer.id}),inverse.cookie)).status,403);
  assert.equal((await post(fresh({expectedActorId:inverse.id,customerId:siblingCustomer.id,branchId:sibling.id}),inverse.cookie)).status,403);
  assert.equal((await call(detail(initial.subscriptionId),'GET',undefined,inverse.cookie)).status,200);
  assert.ok([403,404].includes((await call(detail(wideSource.subscriptionId),'GET',undefined,inverse.cookie)).status));
  const inverseSearch=await call(endpoint+query({q:wideSource.serviceLabel,state:'ALL'}),'GET',undefined,inverse.cookie);assert.equal(inverseSearch.status,200);assert.equal(inverseSearch.data.subscriptions.length,0);assert.equal(inverseSearch.data.nextPage,null);
  // Customer read revocation affects old snapshots and exact committed recovery.
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:split.roleId,permissionKey:'customer:read'}}});
  for(const path of [detail(splitInput.subscriptionId),exportPath(splitInput.subscriptionId,splitSaved.data.event.id),printPath(splitInput.subscriptionId,splitSaved.data.event.id)])assert.ok([403,404].includes((await call(path,'GET',undefined,split.cookie)).status),path);
  assert.equal((await post(splitInput,split.cookie)).status,403);assert.equal((await resolve(splitInput,split.cookie)).status,403);
  // Permission is checked after a real tenant-lock wait, rather than cached before it.
  const waiting=await invite(['subscription:read','subscription:manage','customer:read'],'Waiting source rights');
  const waitingInput=fresh({expectedActorId:waiting.id});let release,entered;const gate=new Promise(r=>{release=r;}),locked=new Promise(r=>{entered=r;});
  const revoking=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR UPDATE`;entered();await gate;await tx.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:waiting.roleId,permissionKey:'customer:read'}}});},{timeout:20000});
  await locked;const waitingPost=post(waitingInput,waiting.cookie);let observed=false;
  try{for(let i=0;i<120;i++){const rows=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE application_name='manual-subscription-api-tests' AND wait_event_type='Lock' AND query LIKE '%Tenant%'`;if(rows.length){observed=true;break;}await pause(50);}assert.ok(observed,'server actually waits for tenant authorization lock');}finally{release();}
  await revoking;assert.equal((await waitingPost).status,403);assert.equal(await db.manualSubscription.count({where:{id:waitingInput.subscriptionId}}),0);
  // A current detail and its history must observe the same committed projection.
  const coherentInput=fresh({serviceLabel:'Coherent detail fixture'});assert.equal((await post(coherentInput)).status,201);
  const coherentEdit={...coherentInput,action:'edit',expectedVersion:1,requestId:randomUUID(),serviceLabel:'Committed coherent revision'};
  let releaseWriter,writerReady;const writerGate=new Promise(r=>{releaseWriter=r;}),writerEntered=new Promise(r=>{writerReady=r;});
  const writer=db.$transaction(async tx=>{await tx.manualSubscriptionRequest.create({data:{id:coherentEdit.requestId,tenantId,companyId,branchId:branch.id,subscriptionId:coherentEdit.subscriptionId,customerId:customer.id,createdBy:actorId,action:coherentEdit.action,expectedVersion:1,request:coherentEdit,outcome:'COMMITTED'}});writerReady();await writerGate;},{timeout:20000});
  await writerEntered;const coherentRead=call(detail(coherentInput.subscriptionId),'GET',undefined,cookie);let observedRead=false;
  try{for(let i=0;i<120;i++){const rows=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE application_name='manual-subscription-api-tests' AND wait_event_type='Lock' AND query LIKE '%ManualSubscription%'`;if(rows.length){observedRead=true;break;}await pause(50);}assert.ok(observedRead,'detail waits for current projection writer');}finally{releaseWriter();}
  await writer;const coherent=await coherentRead;assert.equal(coherent.status,200);assert.equal(coherent.data.subscription.version,2);assert.equal(coherent.data.subscription.serviceLabel,coherentEdit.serviceLabel);assert.deepEqual(coherent.data.events.map(e=>e.version),[2,1]);
  // Date/status filters are operator-entered metadata, not service transitions.
  const reviewRecord=fresh({serviceLabel:'REVIEW-RANGE-ONLY',status:'ACTIVE',startDate:'2000-01-01',endDate:'2000-02-01',nextReviewDate:'2027-01-15'});assert.equal((await post(reviewRecord)).status,201);
  const inside=await call(endpoint+query({q:'REVIEW-RANGE-ONLY',status:'ACTIVE',reviewFrom:'2027-01-15',reviewTo:'2027-01-15'}),'GET',undefined,cookie);assert.equal(inside.status,200);assert.equal(inside.data.subscriptions.length,1);assert.equal(inside.data.subscriptions[0].status,'ACTIVE','past end date does not change reported status');
  const outside=await call(endpoint+query({q:'REVIEW-RANGE-ONLY',reviewFrom:'2027-01-16'}),'GET',undefined,cookie);assert.equal(outside.status,200);assert.equal(outside.data.subscriptions.length,0);
  for(const patch of [{reviewFrom:'2023-02-29'},{reviewTo:'2026-04-31'},{reviewFrom:'2027-02-01',reviewTo:'2027-01-01'},{status:'RENEWED'}])assert.equal((await call(endpoint+query(patch),'GET',undefined,cookie)).status,400);
  assert.equal((await call(endpoint+query(),'GET',undefined,unrelated.cookie)).status,403);
  const outsider=await register('Other tenant document owner');
  for(const path of [endpoint+query(),detail(initial.subscriptionId),exportPath(initial.subscriptionId,original.id),printPath(initial.subscriptionId,original.id)]){const r=await call(path,'GET',undefined,outsider.cookie);assert.ok([403,404].includes(r.status),path);assert.ok(!JSON.stringify(r.data).includes(initial.serviceLabel));}
  assert.equal((await post({...initial,expectedActorId:outsider.actorId},outsider.cookie)).status,403);
  const foreign=fresh({tenantId:outsider.tenantId,expectedActorId:outsider.actorId});assert.ok([403,404,409].includes((await post(foreign,outsider.cookie)).status));
  assert.equal((await call(exportPath(initial.subscriptionId,companyWide.event.id),'GET',undefined,cookie)).status,404,'event cannot be exported through another document');
  for(const entity of ['ManualSubscription','ManualSubscriptionRevision','ManualSubscriptionRequest']){const audit=await call('/api/audit?'+new URLSearchParams({tenantId,entity}),'GET',undefined,cookie);assert.equal(audit.status,200);assert.equal(audit.data.entries.length,0);const csv=await call('/api/audit?'+new URLSearchParams({tenantId,entity,format:'csv'}),'GET',undefined,cookie);if(csv.status===200)for(const secret of [initial.subscriptionId,initial.requestId,initial.serviceLabel,initial.description])assert.ok(!JSON.stringify(csv.data).includes(secret));}
  // A removed read right also removes manage, retries, resolution and old revisions.
  const managed=fresh({expectedActorId:manager.id}),managedResult=await post(managed,manager.cookie);assert.equal(managedResult.status,201);
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:manager.roleId,permissionKey:'subscription:read'}}});
  assert.equal((await post(managed,manager.cookie)).status,403);assert.equal((await resolve(managed,manager.cookie)).status,403);
  for(const path of [endpoint+query(),detail(managed.subscriptionId),exportPath(managed.subscriptionId,managedResult.data.event.id),printPath(managed.subscriptionId,managedResult.data.event.id)])assert.ok([403,404].includes((await call(path,'GET',undefined,manager.cookie)).status),path);
  // UTF-8 payload limits are independent of JSON's escaped wire representation.
  const controls=fresh({serviceLabel:'Complete control-character text',description:'\u0001'.repeat(65536)});
  assert.ok(Buffer.byteLength(JSON.stringify(controls),'utf8')>100000);
  const controlsSaved=await post(controls);assert.equal(controlsSaved.status,201,JSON.stringify(controlsSaved));assert.ok(subscriptionResponseMatches(controls,controlsSaved.data.event));
  assert.deepEqual((await post(controls)).data.event,controlsSaved.data.event);
  const controlsResolved=await resolve(controls);assert.equal(controlsResolved.status,200);assert.deepEqual(controlsResolved.data.event,controlsSaved.data.event);
  const controlsExport=await call(exportPath(controls.subscriptionId,controlsSaved.data.event.id),'GET',undefined,cookie);assert.equal(controlsExport.status,200);assert.ok(controlsExport.data.includes(controls.description),'all 65,536 control bytes survive selected revision export');
  const oversizedWire=await fetch(origin+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:' '.repeat(420001)+JSON.stringify(fresh())});assert.equal(oversizedWire.status,413,'bounded JSON reader rejects oversized whitespace-padded request');
  // History is paginated rather than capped over the lifetime of a document.
  const longHistory=fresh({serviceLabel:'Paginated revision history',description:'أ'.repeat(32768)}),longFirst=await post(longHistory);assert.equal(longFirst.status,201,'exact 64 KiB UTF-8 body accepted');
  for(let version=1;version<=51;version++){
   const next={...longHistory,action:'edit',requestId:randomUUID(),expectedVersion:version,serviceLabel:'Paginated revision history',description:'Revision '+(version+1),reason:'Explicit history pagination fixture'};
   assert.equal((await post(next)).status,201,'revision '+(version+1));
  }
  const firstHistory=(await call(detail(longHistory.subscriptionId),'GET',undefined,cookie)).data;
  assert.equal(firstHistory.subscription.version,52);assert.equal(firstHistory.events.length,50);assert.equal(firstHistory.nextPage,1);
  const secondHistory=(await call(detail(longHistory.subscriptionId,{page:'1'}),'GET',undefined,cookie)).data;
  assert.equal(secondHistory.events.length,2);assert.equal(secondHistory.nextPage,null);
  assert.equal(new Set([...firstHistory.events,...secondHistory.events].map(e=>e.id)).size,52);
  const oldText=await call(exportPath(longHistory.subscriptionId,longFirst.data.event.id),'GET',undefined,cookie);assert.equal(oldText.status,200);assert.ok(oldText.data.includes(longHistory.description),'old full 64 KiB snapshot remains downloadable');
  for(const path of [detail(initial.subscriptionId)+'&page=0&page=1',detail(initial.subscriptionId)+'&unknown=1',exportPath(initial.subscriptionId,original.id)+'&eventId='+original.id,exportPath(initial.subscriptionId,original.id)+'&unknown=1'])assert.equal((await call(path,'GET',undefined,cookie)).status,400,path);
  assert.deepEqual(await protectedSnapshot(),financialBefore,'all register operations preserve existing operational data');
  const {customer:archiveSource}=await create('/api/customers',{companyId,branchId:branch.id,code:'ARCHIVE-SOURCE',displayName:'Archive\nsource customer'});
  const archiveInput=fresh({customerId:archiveSource.id}),archiveSaved=await post(archiveInput);assert.equal(archiveSaved.status,201,JSON.stringify(archiveSaved));assert.equal(archiveSaved.data.event.customerName,archiveSource.displayName,'existing multiline customer names stay literal');
  assert.equal((await call('/api/customers/'+archiveSource.id,'PATCH',{tenantId,action:'archive',archived:true},cookie)).status,200);
  assert.equal((await post(fresh({customerId:archiveSource.id}))).status,409,'new register does not attach archived customer');
  assert.equal((await call(detail(archiveInput.subscriptionId),'GET',undefined,reader.cookie)).status,200);
  assert.equal((await call(exportPath(archiveInput.subscriptionId,archiveSaved.data.event.id),'GET',undefined,reader.cookie)).status,200);
  const corrected={...archiveInput,action:'edit',expectedVersion:1,requestId:randomUUID(),serviceLabel:'Historical correction after source archive'};assert.equal((await post(corrected)).status,201);
  assert.deepEqual((await post(archiveInput)).data.event,archiveSaved.data.event,'source archive preserves exact committed replay');
  const noArchivedChoices=await call(choices({branchId:branch.id}),'GET',undefined,cookie);assert.equal(noArchivedChoices.status,200);assert.ok(!noArchivedChoices.data.customers.some(c=>c.id===archiveSource.id));
  const archiveBaseline=await protectedSnapshot();const archiveCorrection={...corrected,expectedVersion:2,requestId:randomUUID(),description:'Second explicit historical correction'};assert.equal((await post(archiveCorrection)).status,201);assert.deepEqual(await protectedSnapshot(),archiveBaseline,'historical correction does not change archived customer or financials');
  // Existing DB source snapshots are not constrained by the current customer-entry form.
  for (const [index, legacyName] of ['عميل قديم 👩🏽‍💻\n\tLegacy source '.repeat(80), ''].entries()) {
   const legacy = await db.customer.create({data:{tenantId,companyId,branchId:branch.id,code:'LEGACY-'+index,displayName:legacyName,createdBy:actorId}});
   const before = await protectedSnapshot();
   const input = fresh({customerId:legacy.id}), saved = await post(input);
   assert.equal(saved.status,201,JSON.stringify(saved));
   assert.equal(saved.data.event.customerName,legacyName,'complete legacy source name survives receipt parsing');
   assert.ok(subscriptionResponseMatches(input,saved.data.event));
   assert.equal(await db.manualSubscriptionRequest.count({where:{id:input.requestId}}),1);
   assert.equal(await db.manualSubscriptionRevision.count({where:{subscriptionId:input.subscriptionId}}),1);
   const replay = await post(input), resolved = await resolve(input);
   assert.equal(replay.status,201); assert.equal(resolved.status,200);
   assert.deepEqual(replay.data.event,saved.data.event); assert.deepEqual(resolved.data.event,saved.data.event);
   const read = await call(detail(input.subscriptionId),'GET',undefined,reader.cookie);
   assert.equal(read.status,200); assert.equal(read.data.subscription.customerName,legacyName); assert.equal(read.data.events[0].customerName,legacyName);
   const exported = await call(exportPath(input.subscriptionId,saved.data.event.id),'GET',undefined,reader.cookie);
   assert.equal(exported.status,200); assert.ok(exported.data.includes('Customer snapshot: '+legacyName+' (LEGACY-'+index+')'));
   const printed = await call(printPath(input.subscriptionId,saved.data.event.id),'GET',undefined,reader.cookie);
   assert.equal(printed.status,200); if (legacyName) assert.ok(printed.data.includes(legacyName),'print preserves complete literal Unicode source');
   assert.deepEqual(await protectedSnapshot(),before,'lossless source support never rewrites existing customers or financials');
  }
  const page=await call('/manual-subscriptions','GET',undefined,cookie);assert.equal(page.status,200);assert.match(page.data,/Manual subscription register|سجل الاشتراكات/);
 }finally{server.kill('SIGTERM');await db.$disconnect();}
});
