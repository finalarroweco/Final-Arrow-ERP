import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
const port=3304,origin=`http://127.0.0.1:${port}`,pause=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,method='GET',body,cookie,headers={}){const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
test('manual reorder API: exact thresholds, coherent stock, scoped source privacy and durable actor-bound outcomes',{timeout:300000},async()=>{
 const db=new PrismaClient(),url=new URL(process.env.DATABASE_URL);url.searchParams.set('connection_limit',process.env.STOCK_REORDER_POOL_LIMIT??'8');url.searchParams.set('application_name','reorder-api-tests');
 const server=spawn('./node_modules/.bin/next',['start','-H','127.0.0.1','-p',String(port)],{env:{...process.env,DATABASE_URL:url.toString(),ALLOW_REGISTRATION:'true'},stdio:['ignore','ignore','inherit']});
 try{
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await pause(250);}assert.ok(ready);
  async function register(){const slug='reorder-'+randomUUID().slice(0,8),r=await call('/api/auth/register','POST',{name:slug,email:slug+'@example.invalid',password:'Reorder-password-2026',organization:slug,slug});assert.equal(r.status,201,JSON.stringify(r));return {...r.data,cookie:r.cookie,actorId:(await db.membership.findFirstOrThrow({where:{tenantId:r.data.tenantId}})).userId};}
  const owner=await register(),{tenantId,cookie,actorId}=owner;
  async function create(path,body){const r=await call(path,'POST',{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r));return r.data;}
  const {company}=await create('/api/companies',{name:'Reorder company',code:'REO',baseCurrency:'OMR'}),companyId=company.id;
  const {branch}=await create('/api/branches',{companyId,name:'Reorder branch',code:'REO'}),{branch:sibling}=await create('/api/branches',{companyId,name:'Sibling',code:'SIB'});
  const {item}=await create('/api/inventory/items',{companyId,sku:'REO-WIDE',name:'=Literal item name',unit:'piece'}),{item:branchItem}=await create('/api/inventory/items',{companyId,branchId:branch.id,sku:'REO-BRANCH',name:'Branch item',unit:'piece'});
  const scope={tenantId,companyId,branchId:branch.id},endpoint='/api/inventory/reordering';
  const fresh=(patch={})=>({...scope,expectedActorId:actorId,requestId:randomUUID(),policyId:randomUUID(),itemId:item.id,unit:'piece',unitVersion:0,action:'create',expectedVersion:0,minimumQuantity:'1.125',targetQuantity:'3.000',reason:'Initial threshold',...patch});
  const post=(p,c=cookie)=>call(endpoint,'POST',p,c),resolve=(p,c=cookie)=>call(endpoint+'/resolve','POST',p,c),query=(p={})=>'?'+new URLSearchParams({...scope,...p}),list=(p={},c=cookie)=>call(endpoint+query(p),'GET',undefined,c),detail=(id,p={},c=cookie)=>call(endpoint+'/'+id+query(p),'GET',undefined,c);
  const roles=await db.role.findMany({where:{tenantId,name:{in:['Owner','Manager','Viewer']}},include:{permissions:true}});for(const role of roles)assert.equal(role.permissions.some(p=>p.permissionKey==='inventory-reorder:manage'),role.name==='Owner');
  async function member(permissions,name,target=branch.id){const {role}=await create('/api/roles',{name,permissions});const inv=await create('/api/invitations',{email:randomUUID()+'@example.invalid',roleId:role.id,scope:{type:'BRANCH',companyId,branchId:target}});const r=await call('/api/invitations/accept','POST',{token:inv.path.split('/').at(-1),name,password:'Reorder-member-2026'});assert.equal(r.status,200);return {cookie:r.cookie,id:(await db.user.findFirstOrThrow({where:{name,memberships:{some:{tenantId}}}})).id,roleId:role.id};}
  const reader=await member(['inventory-stock:read'],'Reorder reader'),manager=await member(['inventory-stock:read','inventory-reorder:manage'],'Reorder manager'),siblingReader=await member(['inventory-stock:read'],'Sibling reorder reader',sibling.id);
  assert.equal((await call(endpoint+query())).status,401);assert.equal((await post(fresh(),reader.cookie)).status,403);assert.equal((await post(fresh({expectedActorId:manager.id}),manager.cookie)).status,201,'branch stock rights permit company-wide source without catalog rights');
  const existing=(await list()).data.policies[0],initial={...fresh(),policyId:existing.id,requestId:(await db.inventoryReorderRevision.findFirstOrThrow({where:{policyId:existing.id}})).requestId,expectedActorId:manager.id};
  const originalRequest=(await db.inventoryReorderRequest.findUniqueOrThrow({where:{id:initial.requestId}})).request;
  const first=await detail(existing.id);assert.equal(first.status,200);assert.equal(first.data.policy.availableQuantity,'0.000');assert.equal(first.data.policy.quantityToTarget,'3.000');assert.equal(first.data.policy.status,'BELOW_MINIMUM');assert.equal(await db.stockBalance.count({where:{tenantId,itemId:item.id}}),0);
  const actorDetail=await detail(existing.id,{page:'0',expectedActorId:actorId});assert.equal(actorDetail.status,200,JSON.stringify(actorDetail));assert.equal(actorDetail.data.actorId,actorId);assert.equal(actorDetail.data.page,0);
  assert.equal((await post(originalRequest,manager.cookie)).status,201);assert.equal((await post({...originalRequest,reason:'Changed'},manager.cookie)).status,409);assert.equal((await resolve(originalRequest,reader.cookie)).status,403);assert.equal((await post({...fresh(),expectedActorId:actorId},manager.cookie)).status,403);
  const duplicate=await Promise.all([post(fresh()),post(fresh())]);assert.ok(duplicate.every(r=>r.status===409),'one active branch/item policy');
  for(const patch of [{minimumQuantity:'1e3'},{minimumQuantity:'1000000000000000.000'},{minimumQuantity:1},{minimumQuantity:'-0.001'},{targetQuantity:'1.124'},{branchId:null},{extra:true}])assert.equal((await post(fresh(patch))).status,400);
  for(const r of [await list({},siblingReader.cookie),await detail(existing.id,{},siblingReader.cookie),await list({expectedActorId:reader.id}),await detail(existing.id,{expectedActorId:reader.id}),await call(endpoint+'/items'+query({expectedActorId:reader.id}),'GET',undefined,cookie)])assert.equal(r.status,403);
  assert.equal((await call(endpoint,'POST',fresh(),cookie,{Origin:'https://evil.invalid'})).status,403);
  for(const suffix of ['&q=a&q=b','&unknown=true','&belowOnly=true','&page=-1'])assert.equal((await call(endpoint+query()+suffix,'GET',undefined,cookie)).status,400);
  const stock=async(action,quantity)=>create('/api/inventory/stock',{...scope,itemId:item.id,action,quantity,reason:'Reorder observation fixture'});
  await stock('in','1.125');let current=(await detail(existing.id)).data.policy;assert.equal(current.status,'AT_OR_ABOVE_MINIMUM');assert.equal(current.quantityToTarget,'1.875');assert.equal((await list({belowOnly:'1'})).data.policies.length,0);
  const held=await create('/api/inventory/reservations',{...scope,action:'reserve',requestId:randomUUID(),itemId:item.id,quantity:'0.125',reference:'Reorder test hold'});
  current=(await detail(existing.id)).data.policy;assert.equal(current.availableQuantity,'1.000');assert.equal(current.reservedQuantity,'0.125');assert.equal(current.status,'BELOW_MINIMUM');
  await create('/api/inventory/reservations',{...scope,action:'release',requestId:randomUUID(),reservationId:held.reservation.id,reason:'Release observation fixture'});
  await stock('in','3.000');current=(await detail(existing.id)).data.policy;assert.equal(current.availableQuantity,'4.125');assert.equal(current.quantityToTarget,'0.000');
  const snapshots=async()=>Object.fromEntries(await Promise.all(['StockBalance','StockMovement','StockReservation','JournalEntry','JournalLine','SalesOrder','PurchaseOrder'].map(async table=>[table,await db.$queryRawUnsafe(`SELECT row_to_json(t)::text AS row,xmin::text AS version FROM "${table}" t WHERE "tenantId"=$1::uuid ORDER BY row`,tenantId)])));
  const before=await snapshots();
  const edit={...originalRequest,expectedActorId:actorId,requestId:randomUUID(),action:'edit',expectedVersion:1,minimumQuantity:'4.125',targetQuantity:'999999999999999.999',reason:'Exact threshold edit'};
  const edits=await Promise.all([post(edit),post(edit)]);assert.ok(edits.every(r=>r.status===201),JSON.stringify(edits));assert.deepEqual(edits[0].data,edits[1].data);assert.equal((await post({...edit,requestId:randomUUID()})).status,409);
  const csv=await list({format:'csv'});assert.equal(csv.status,200);assert.ok(csv.data.includes("'=Literal item name"));assert.ok(!csv.data.includes(edit.reason));assert.equal(csv.headers.get('x-reorder-actor-id'),actorId);
  const archive={...edit,requestId:randomUUID(),action:'archive',expectedVersion:2,reason:'Archive old thresholds'};delete archive.minimumQuantity;delete archive.targetQuantity;assert.equal((await post(archive)).status,201);assert.equal((await detail(existing.id)).data.policy.physicalQuantity,null);
  const replacement=fresh();assert.equal((await post(replacement)).status,201);assert.equal((await post({...archive,requestId:randomUUID(),action:'restore',expectedVersion:3})).status,409);
  const replacementArchive={...archive,policyId:replacement.policyId,requestId:randomUUID(),expectedVersion:1};assert.equal((await post(replacementArchive)).status,201);
  assert.equal((await post({...archive,requestId:randomUUID(),action:'restore',expectedVersion:3})).status,201);
  await db.inventoryItem.update({where:{id:item.id},data:{unit:'kg'}});assert.equal((await detail(existing.id)).data.policy.status,'UNIT_REVIEW');await db.inventoryItem.update({where:{id:item.id},data:{unit:'piece'}});assert.equal((await detail(existing.id)).data.policy.status,'UNIT_REVIEW','away-and-back cannot reuse old generation');
  assert.equal((await post({...edit,requestId:randomUUID(),expectedVersion:4})).status,409);
  await db.inventoryItem.update({where:{id:item.id},data:{branchId:sibling.id,name:'PRIVATE MOVED NAME'}});current=(await detail(existing.id)).data.policy;assert.equal(current.status,'SOURCE_UNAVAILABLE');assert.equal(current.itemName,'=Literal item name');assert.ok(!JSON.stringify(current).includes('PRIVATE MOVED NAME'));
  const movedArchive={...archive,requestId:randomUUID(),expectedVersion:4};assert.equal((await post(movedArchive)).status,201,'archive historical source after move');
  assert.deepEqual(await snapshots(),before,'policy operations and item source changes leave stock/ledger/orders untouched');
  const pending=fresh({itemId:branchItem.id}),cancelled=await resolve(pending);assert.equal(cancelled.status,200);assert.ok(cancelled.data.cancellation);assert.deepEqual((await resolve(pending)).data,cancelled.data);assert.equal((await post(pending)).status,409);assert.equal((await resolve({...pending,reason:'changed'})).status,409);
  const {item:deleted}=await create('/api/inventory/items',{companyId,sku:'REO-DELETED',name:'Deleted pending source',unit:'piece'}),deletedPending=fresh({itemId:deleted.id});await db.inventoryItem.delete({where:{id:deleted.id}});assert.equal((await resolve(deletedPending)).status,200,'deleted unsubmitted source still permits terminal abandonment');
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:manager.roleId,permissionKey:'inventory-reorder:manage'}}});assert.equal((await post(originalRequest,manager.cookie)).status,403);assert.equal((await resolve(originalRequest,manager.cookie)).status,403,'replay rechecks current authorization');
  const foreign=await register();assert.equal((await list({},foreign.cookie)).status,403);
  // More than the legacy picker cap. Each policy created through the guarded API.
  const many=Array.from({length:207},(_,i)=>({id:randomUUID(),tenantId,companyId,branchId:null,sku:`REO-PAGE-${String(i).padStart(3,'0')}`,name:`Paged ${String(i).padStart(3,'0')}`,unit:'piece',createdBy:actorId}));await db.inventoryItem.createMany({data:many});
  for(let i=0;i<many.length;i+=8){const results=await Promise.all(many.slice(i,i+8).map(x=>post(fresh({itemId:x.id,minimumQuantity:'0.000',targetQuantity:'0.000'}))));assert.ok(results.every(r=>r.status===201),JSON.stringify(results.find(r=>r.status!==201)));}
  let seen=[],page=0;do{const r=await list({q:'Paged',page:String(page)});assert.equal(r.status,200);seen.push(...r.data.policies.map(x=>x.itemId));page=r.data.nextPage;}while(page!==null);assert.equal(new Set(seen).size,207);
  const lastPicker=await call(endpoint+'/items'+query({q:'Paged',page:'4'}),'GET',undefined,reader.cookie);assert.equal(lastPicker.status,200);assert.equal(lastPicker.data.items.length,7);assert.equal(lastPicker.data.nextPage,null);
  assert.equal((await list({q:'Paged',belowOnly:'1'})).data.policies.length,0,'zero threshold equal to zero is not below');
  // Database-valid legacy metadata is a lossless snapshot, not newly entered catalog input.
  const legacyFixtures=[
   {unit:'',name:'',sku:'LEGACY-EMPTY-NAME',q:'LEGACY-EMPTY-NAME'},
   {unit:'وحدة\nقديمة',name:'Legacy-unit-Arabic\n'+ 'عربي🙂\t'.repeat(90),sku:'',q:'Legacy-unit-Arabic'},
   {unit:'\u0001'.repeat(14)+'\\"',name:'Legacy-unit-escaped',sku:'LEGACY-ESCAPED',q:'Legacy-unit-escaped',reason:'🙂'.repeat(300)},
   {unit:'🙂'.repeat(16),name:'Legacy-unit-emoji\n'+ 'عربي🙂'.repeat(90),sku:'=LEGACY\n'+ 'رمز🙂'.repeat(80),q:'Legacy-unit-emoji'},
  ];
  for(const fixture of legacyFixtures){
   const legacy=await db.inventoryItem.create({data:{tenantId,companyId,branchId:null,createdBy:actorId,unit:fixture.unit,name:fixture.name,sku:fixture.sku}});
   const request=fresh({itemId:legacy.id,unit:fixture.unit,...(fixture.reason?{reason:fixture.reason}:{})});assert.ok(new TextEncoder().encode(JSON.stringify(request)).length<=12000);
   const committed=await post(request);assert.equal(committed.status,201,JSON.stringify(committed));assert.equal(committed.data.event.unit,fixture.unit);assert.equal(committed.data.event.itemName,fixture.name);assert.equal(committed.data.event.itemSku,fixture.sku);
   const picker=await call(endpoint+'/items'+query({q:fixture.q}),'GET',undefined,reader.cookie);assert.equal(picker.status,200);assert.deepEqual(picker.data.items.map(x=>({id:x.id,name:x.name,sku:x.sku,unit:x.unit})),[{id:legacy.id,name:fixture.name,sku:fixture.sku,unit:fixture.unit}]);
   const reported=await list({q:fixture.q});assert.equal(reported.status,200);assert.equal(reported.data.policies.length,1);assert.equal(reported.data.policies[0].unit,fixture.unit);assert.equal(reported.data.policies[0].itemName,fixture.name);assert.equal(reported.data.policies[0].itemSku,fixture.sku);
   const exported=await list({q:fixture.q,format:'csv'});assert.equal(exported.status,200);const csvCell=value=>'"'+(/^[\s\u0000-\u001f]*[=+@-]/u.test(value)?"'"+value:value).replaceAll('"','""')+'"';for(const value of [fixture.unit,fixture.name,fixture.sku])assert.ok(exported.data.includes(csvCell(value)),'lossless formula-safe legacy CSV metadata');
   await db.inventoryItem.update({where:{id:legacy.id},data:{name:'Renamed current legacy source',sku:'RENAMED-'+legacy.id}});
   const history=await detail(request.policyId);assert.equal(history.status,200);assert.equal(history.data.policy.itemName,fixture.name);assert.equal(history.data.policy.itemSku,fixture.sku);assert.equal(history.data.policy.unit,fixture.unit);assert.equal(history.data.events[0].itemName,fixture.name);assert.equal(history.data.events[0].itemSku,fixture.sku);assert.equal(history.data.events[0].unit,fixture.unit);
  }
  const audit=await call('/api/audit?'+new URLSearchParams({tenantId,entity:'InventoryReorder'}),'GET',undefined,cookie);assert.equal(audit.status,200);assert.deepEqual(audit.data.entries,[],'generic audit excludes private policy metadata');
 }finally{server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),pause(5000)]);await db.$disconnect();}
});
