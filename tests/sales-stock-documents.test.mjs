import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PrismaClient} from '@prisma/client';
const m={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync('src/lib/sales-stock-input.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(createRequire(import.meta.url),m,m.exports);
const {salesStockResponseMatches,salesStockCancellationMatches}=m.exports;
const origin='http://127.0.0.1:3298',pause=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,method='GET',body,cookie){const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
test('physical deliveries, usable returns, corrections and selected full holds are exact, private and recoverable',{timeout:180000},async()=>{
 const db=new PrismaClient(),url=new URL(process.env.DATABASE_URL);url.searchParams.set('connection_limit',process.env.SALES_STOCK_POOL_LIMIT??'8');
 const server=spawn('./node_modules/.bin/next',['start','-H','127.0.0.1','-p','3298'],{env:{...process.env,DATABASE_URL:url.toString(),ALLOW_REGISTRATION:'true'},stdio:['ignore','ignore','inherit']});
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await pause(250);}assert.ok(ready);
  const suffix=randomUUID().slice(0,8),reg=await call('/api/auth/register','POST',{name:'Delivery owner',email:`sales-stock-${suffix}@example.invalid`,password:'Sales-stock-password-2026',organization:'Sales stock QA',slug:`sales-stock-${suffix}`});assert.equal(reg.status,201,JSON.stringify(reg));
  const tenantId=reg.data.tenantId,cookie=reg.cookie,actorId=(await db.membership.findFirstOrThrow({where:{tenantId}})).userId;
  const create=async(path,body)=>{const r=await call(path,'POST',{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r));return r.data;};
  const {company}=await create('/api/companies',{name:'Delivery company',code:'DEL',baseCurrency:'OMR'}),companyId=company.id;
  const {branch}=await create('/api/branches',{companyId,name:'Original branch',code:'ORIG'}),{branch:sibling}=await create('/api/branches',{companyId,name:'Private other branch',code:'OTHER'});
  const {customer}=await create('/api/customers',{companyId,code:'CUSTOMER',displayName:'Private delivery customer'}),{item}=await create('/api/inventory/items',{companyId,sku:'DEL-1',name:'Original delivery item',unit:'kg'});
  const stockScope={tenantId,companyId,branchId:branch.id};
  await create('/api/inventory/stock',{...stockScope,itemId:item.id,action:'in',quantity:'50.125',reason:'Test opening movement'});
  async function makeOrder(number,branchId=branch.id){const {quote}=await create('/api/quotes',{companyId,branchId,customerId:customer.id,number:'Q-'+number,lines:[{description:'Commercial units are not stock units',quantity:1,unitPrice:'5'}]});for(const action of ['send','accept'])assert.equal((await call(`/api/quotes/${quote.id}/status`,'PATCH',{tenantId,action},cookie)).status,200);const {order}=await create(`/api/quotes/${quote.id}/order`,{number});return db.salesOrder.findUniqueOrThrow({where:{id:order.id},include:{lines:true}});}
  const order=await makeOrder('DEL-A'),otherOrder=await makeOrder('DEL-B'),wide=await makeOrder('DEL-WIDE',null);
  const scope={tenantId,companyId,orderId:order.id},endpoint='/api/sales/stock-documents',query='?'+new URLSearchParams(scope),detail=id=>`${endpoint}/${id}?tenantId=${tenantId}`;
  const input={...scope,action:'deliver',expectedActorId:actorId,requestId:randomUUID(),branchId:branch.id,itemId:item.id,lineId:order.lines[0].id,holdId:null,expectedUnit:'kg',quantity:'6.125',reference:'=private delivery reference',reason:'Private physical movement reason',physicalConfirmed:true};
  const post=(p,c=cookie)=>call(endpoint,'POST',p,c),ret=(deliveryId,quantity)=>({...scope,action:'return',expectedActorId:actorId,requestId:randomUUID(),deliveryId,expectedUnit:'kg',quantity,reference:'Usable return reference',reason:'Goods restored to usable stock',usableConfirmed:true}),correct=documentId=>({...scope,action:'correct',expectedActorId:actorId,requestId:randomUUID(),documentId,expectedUnit:'kg',reason:'Correct complete original record',physicalConfirmed:true});
  async function invite(permissions,name,type='BRANCH',branchId=branch.id){const {role}=await create('/api/roles',{name,permissions});const invitation=await create('/api/invitations',{email:`delivery-${randomUUID().slice(0,8)}@example.invalid`,roleId:role.id,scope:{type,companyId,...(type==='BRANCH'?{branchId}:{})}});const r=await call('/api/invitations/accept','POST',{token:invitation.path.split('/').at(-1),name,password:'Sales-stock-member-2026'});assert.equal(r.status,200);const user=await db.user.findFirstOrThrow({where:{name,memberships:{some:{tenantId}}}});return {cookie:r.cookie,id:user.id,roleId:role.id};}
  const stockOnly=await invite(['inventory-stock:read','inventory-stock:adjust'],'Stock only'),sourceOnly=await invite(['order:read','order-delivery:manage'],'Source only'),operator=await invite(['order:read','order-delivery:manage','inventory-stock:read','inventory-stock:adjust'],'Delivery operator');
  assert.equal((await call(endpoint,'POST',input)).status,401);
  for(const who of [stockOnly,sourceOnly])assert.equal((await post({...input,expectedActorId:who.id},who.cookie)).status,403);
  assert.equal((await post(input,operator.cookie)).status,403);assert.equal((await call(endpoint+'/cancel','POST',input,operator.cookie)).status,403);
  for(const patch of [{quantity:'0'},{quantity:'1e2'},{quantity:'1.0001'},{quantity:'1000000000'},{physicalConfirmed:false},{createdAt:'2001-01-01'},{reason:'bad\nlabel'}])assert.equal((await post({...input,...patch})).status,400);
  const initial=await Promise.all([post(input),post(input)]);assert.ok(initial.every(r=>r.status===201),JSON.stringify(initial));assert.ok(salesStockResponseMatches(input,initial[0].data.document));
  const balance=()=>db.stockBalance.findFirstOrThrow({where:{...stockScope,itemId:item.id}});assert.equal((await balance()).quantity.toFixed(3),'44.000');assert.equal((await balance()).transferOpeningDelta.toFixed(3),'0.000');
  assert.equal(await db.stockMovement.count({where:{salesDocumentId:input.requestId}}),1);assert.equal(await db.auditLog.count({where:{entity:'SalesStockDocument',entityId:input.requestId}}),1);
  for(const patch of [{quantity:'6.124'},{reason:'Different reason'},{expectedUnit:'box'},{orderId:otherOrder.id},{lineId:null},{holdId:randomUUID()}])assert.equal((await post({...input,...patch})).status,409);
  assert.equal((await post({...input,expectedActorId:operator.id},operator.cookie)).status,409);
  assert.equal((await call(endpoint+query,'GET',undefined,stockOnly.cookie)).status,403);assert.equal((await call(detail(input.requestId),'GET',undefined,stockOnly.cookie)).status,404);assert.equal((await call(endpoint+query+'&format=csv','GET',undefined,stockOnly.cookie)).status,403);
  const generic=await call('/api/inventory/stock?'+new URLSearchParams(stockScope),'GET',undefined,stockOnly.cookie);assert.equal(generic.status,200);for(const secret of [input.requestId,order.id,customer.displayName,input.reference,input.reason])assert.ok(!JSON.stringify(generic.data).includes(secret),secret);
  const movement=await db.stockMovement.findFirstOrThrow({where:{salesDocumentId:input.requestId}});assert.equal((await call(`/api/inventory/movements/${movement.id}/reverse`,'POST',{tenantId,reason:'Not a generic reversal'},cookie)).status,409);
  const csv=await call(endpoint+query+'&format=csv','GET',undefined,cookie);assert.equal(csv.status,200);assert.match(csv.data,/"'=private delivery reference"/);
  assert.equal((await call(endpoint+query+'&page=0&page=1','GET',undefined,cookie)).status,400);
  const returned=ret(input.requestId,'2.125'),rr=await post(returned);assert.equal(rr.status,201,JSON.stringify(rr));assert.ok(salesStockResponseMatches(returned,rr.data.document));assert.equal((await balance()).quantity.toFixed(3),'46.125');
  assert.equal((await post(ret(input.requestId,'4.001'))).status,409);assert.equal((await post(correct(input.requestId))).status,409);
  const rc=correct(returned.requestId),rcr=await post(rc);assert.equal(rcr.status,201,JSON.stringify(rcr));assert.equal((await balance()).quantity.toFixed(3),'44.000');assert.equal((await post(rc)).status,201);assert.equal((await post({...rc,documentId:input.requestId})).status,409);assert.equal((await post(correct(rc.requestId))).status,409);
  const dc=correct(input.requestId);assert.equal((await post(dc)).status,201);assert.equal((await balance()).quantity.toFixed(3),'50.125');assert.equal((await post(ret(input.requestId,'0.001'))).status,409);assert.equal((await post(input)).status,201);
  const totals=(await call(endpoint+query,'GET',undefined,cookie)).data.totals;assert.equal(totals.length,1);assert.equal(totals[0].delivered,'6.125');assert.equal(totals[0].returned,'2.125');assert.equal(totals[0].deliveryCorrections,'6.125');assert.equal(totals[0].returnCorrections,'2.125');assert.equal(totals[0].netOut,'0.000');
  // Completed order deliveries are intentionally independent of invoices and commercial quantity.
  for(const action of ['start','complete'])assert.equal((await call(`/api/orders/${order.id}/status`,'PATCH',{tenantId,action},cookie)).status,200);
  const closedDelivery={...input,requestId:randomUUID(),quantity:'4.000'};assert.equal((await post(closedDelivery)).status,201);
  assert.equal(await db.invoice.count({where:{orderId:order.id}}),0);assert.equal((await db.salesOrder.findUniqueOrThrow({where:{id:order.id}})).status,'COMPLETED');
  const closedReturn=ret(closedDelivery.requestId,'1.000');assert.equal((await post(closedReturn)).status,201);
  // Archive is allowed for source-derived usable returns; current unit equality is still mandatory.
  assert.equal((await call(`/api/inventory/items/${item.id}`,'PATCH',{tenantId,action:'archive',archived:true},cookie)).status,200);
  assert.equal((await post({...input,requestId:randomUUID()})).status,409);assert.equal((await post(ret(closedDelivery.requestId,'0.001'))).status,201);
  assert.equal((await call(`/api/inventory/items/${item.id}`,'PATCH',{tenantId,action:'archive',archived:false},cookie)).status,200);
  assert.equal((await call(`/api/inventory/items/${item.id}`,'PATCH',{tenantId,action:'update',unit:'box'},cookie)).status,200);
  const staleUnitBefore=(await balance()).quantity.toFixed(3);assert.equal((await post({...closedDelivery,requestId:randomUUID()})).status,409);assert.equal((await balance()).quantity.toFixed(3),staleUnitBefore);
  assert.equal((await post(closedDelivery)).status,201,'original-unit replay remains successful after unit change');assert.equal((await post(ret(closedDelivery.requestId,'0.001'))).status,409);assert.equal((await post(correct(closedReturn.requestId))).status,409);
  assert.equal((await call(`/api/inventory/items/${item.id}`,'PATCH',{tenantId,action:'update',unit:'kg'},cookie)).status,200);assert.equal((await call(`/api/inventory/items/${item.id}`,'PATCH',{tenantId,action:'archive',archived:false},cookie)).status,200);
  // Competing returns serialize on the balance and original delivery.
  const competition=await Promise.all([post(ret(closedDelivery.requestId,'2.000')),post(ret(closedDelivery.requestId,'2.000'))]);assert.deepEqual(competition.map(r=>r.status).sort(),[201,409]);
  // Explicit abandonment cannot cause delayed duplicate writes; it is not a movement reversal.
  const pending={...input,requestId:randomUUID(),quantity:'999999999.999'},cancel=await call(endpoint+'/cancel','POST',pending,cookie);assert.equal(cancel.status,200,JSON.stringify(cancel));assert.ok(salesStockCancellationMatches(pending,cancel.data.cancellation));assert.equal((await post(pending)).status,409);assert.equal((await call(endpoint+'/cancel','POST',{...pending,reason:'Different payload'},cookie)).status,409);
  const race={...input,requestId:randomUUID(),quantity:'0.001'},raceResults=await Promise.all([post(race),call(endpoint+'/cancel','POST',race,cookie)]);assert.equal(raceResults[1].status,200);const recorded=await db.salesStockDocument.count({where:{id:race.requestId}});assert.equal(recorded+await db.salesStockCancellation.count({where:{id:race.requestId}}),1);assert.equal((await post(race)).status,recorded?201:409);
  assert.ok(salesStockResponseMatches(input,(await call(endpoint+'/cancel','POST',input,cookie)).data.document));
  // Hold delivery is full, explicit, atomic and requires an independent hold-management right.
  const holdInput={...stockScope,action:'reserve',expectedActorId:actorId,expectedUnit:'kg',requestId:randomUUID(),itemId:item.id,quantity:'3.125',lineId:otherOrder.lines[0].id,note:'Explicit delivery hold'};
  const hold=await create(`/api/orders/${otherOrder.id}/reservations`,holdInput);
  const held={...input,orderId:otherOrder.id,requestId:randomUUID(),lineId:otherOrder.lines[0].id,holdId:hold.reservation.id,quantity:'3.125'};
  assert.equal((await post({...held,expectedActorId:operator.id},operator.cookie)).status,403);assert.equal((await post({...held,requestId:randomUUID(),quantity:'3.124'})).status,409);assert.equal((await db.stockReservation.findUniqueOrThrow({where:{id:held.holdId}})).releasedAt,null);
  const before=(await balance()).quantity,hs=await post(held);assert.equal(hs.status,201,JSON.stringify(hs));assert.ok(salesStockResponseMatches(held,hs.data.document));assert.equal((await balance()).quantity.toFixed(3),before.minus('3.125').toFixed(3));assert.equal((await balance()).reservedQuantity.toFixed(3),'0.000');
  const released=await db.stockReservation.findUniqueOrThrow({where:{id:held.holdId}});assert.equal(released.salesDeliveryId,held.requestId);assert.equal(released.releaseRequestId,held.requestId);assert.equal(await db.auditLog.count({where:{entityId:held.holdId,action:{in:['order-stock.released','inventory-stock.reservation-released']}}}),2);
  const ordinaryReplay=await call(`/api/orders/${otherOrder.id}/reservations`,'POST',{...stockScope,action:'release',expectedActorId:actorId,requestId:held.requestId,reservationId:held.holdId,reason:'Released for physical delivery'},cookie);assert.equal(ordinaryReplay.status,409,'a delivery release cannot replay as an ordinary release');
  assert.equal((await post(held)).status,201);assert.equal((await post({...held,requestId:randomUUID()})).status,409);assert.equal((await post({...correct(held.requestId),orderId:otherOrder.id})).status,201);assert.ok((await db.stockReservation.findUniqueOrThrow({where:{id:held.holdId}})).releasedAt);
  // Company-wide source access combines with branch-only stock authorization, never the reverse.
  const split=await invite(['order:read','order-delivery:manage'],'Split source','COMPANY');const membership=await db.membership.findUniqueOrThrow({where:{tenantId_userId:{tenantId,userId:split.id}}});await db.roleGrant.create({data:{tenantId,membershipId:membership.id,roleId:stockOnly.roleId,scopes:{create:{type:'BRANCH',companyId,branchId:branch.id}}}});
  const wideInput={...input,orderId:wide.id,lineId:null,requestId:randomUUID(),expectedActorId:split.id,quantity:'0.001'};assert.equal((await post(wideInput,split.cookie)).status,201);assert.equal((await post({...wideInput,requestId:randomUUID(),branchId:sibling.id},split.cookie)).status,403);assert.equal((await post({...wideInput,expectedActorId:operator.id,requestId:randomUUID()},operator.cookie)).status,403);
  await create('/api/inventory/stock',{...stockScope,branchId:sibling.id,itemId:item.id,action:'in',quantity:'5',reason:'Other branch initial stock'});
  const privateWide={...input,orderId:wide.id,lineId:null,branchId:sibling.id,requestId:randomUUID(),quantity:'1',reference:'HIDDEN-SIBLING-DELIVERY'};assert.equal((await post(privateWide)).status,201);
  const privateSearch=await call(endpoint+'?'+new URLSearchParams({tenantId,companyId,orderId:wide.id,q:privateWide.reference}),'GET',undefined,split.cookie);assert.equal(privateSearch.status,200);assert.equal(privateSearch.data.documents.length,0);assert.equal(privateSearch.data.totals.length,0);assert.equal(privateSearch.data.nextPage,null);
  assert.equal((await call(detail(privateWide.requestId),'GET',undefined,split.cookie)).status,404);
  const filtered=await call(endpoint+'?'+new URLSearchParams({tenantId,companyId,orderId:wide.id,branchId:sibling.id}),'GET',undefined,split.cookie);assert.equal(filtered.status,200);assert.equal(filtered.data.documents.length,0);assert.equal(filtered.data.totals.length,0);
  const genericAudit=await call('/api/audit?'+new URLSearchParams({tenantId,entity:'SalesStockDocument',entityId:input.requestId}),'GET',undefined,cookie);assert.equal(genericAudit.status,200);assert.equal(genericAudit.data.entries.length,0);
  // Current revocation applies to historical replay, abandonment, detail and source page/print.
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:split.roleId,permissionKey:'order-delivery:manage'}}});assert.equal((await post(wideInput,split.cookie)).status,403);assert.equal((await call(endpoint+'/cancel','POST',wideInput,split.cookie)).status,403);
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:split.roleId,permissionKey:'order:read'}}});assert.equal((await call(detail(wideInput.requestId),'GET',undefined,split.cookie)).status,404);assert.equal((await call(endpoint+'?'+new URLSearchParams({tenantId,companyId,orderId:wide.id}),'GET',undefined,split.cookie)).status,403);
  // Cancellation of order blocks new deliveries but keeps returns/corrections available.
  assert.equal((await call(`/api/orders/${otherOrder.id}/status`,'PATCH',{tenantId,action:'cancel'},cookie)).status,200);assert.equal((await post({...held,requestId:randomUUID(),holdId:null})).status,409);
  // Reads lock the source order after fresh tenant-locked authorization. A concurrent
  // writer must commit before any register rows/totals or detail history is observed.
  const coherentId=randomUUID();
  async function coherentRead(path,write){
   let release,locked;const gate=new Promise(r=>{release=r;}),entered=new Promise(r=>{locked=r;});
   const writing=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id=${item.id}::uuid FOR SHARE`;await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE "tenantId"=${tenantId}::uuid AND "branchId"=${branch.id}::uuid AND "itemId"=${item.id}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE id=${order.id}::uuid FOR UPDATE`;locked();await gate;await write(tx);},{timeout:15000});
   await entered;let settled=false;const reading=call(path,'GET',undefined,cookie).then(r=>{settled=true;return r;});await pause(150);assert.equal(settled,false,'read waits for source writer rather than mixing statement snapshots');release();await writing;const result=await reading;assert.equal(result.status,200,JSON.stringify(result));return result.data;
  }
  const coherentData={id:coherentId,tenantId,companyId,orderId:order.id,branchId:branch.id,itemId:item.id,lineId:order.lines[0].id,kind:'DELIVERY',quantity:'0.001',unit:'kg',reference:'Coherent register read',reason:'Read isolation test',physicalConfirmed:true,createdBy:actorId};
  const coherentList=await coherentRead(endpoint+query,tx=>tx.salesStockDocument.create({data:coherentData}));assert.ok(coherentList.documents.some(r=>r.id===coherentId));
  const exactNet=(await db.salesStockDocument.aggregate({where:scope,_sum:{delta:true}}))._sum.delta.negated().toFixed(3);assert.equal(coherentList.totals[0].netOut,exactNet);
  const coherentDetail=await coherentRead(detail(coherentId),tx=>tx.salesStockDocument.create({data:{...coherentData,id:randomUUID(),kind:'CORRECTION',correctsId:coherentId,reason:'Correct coherent detail'}}));assert.equal(coherentDetail.corrections.length,1);assert.equal(coherentDetail.canReturn,false);assert.equal(coherentDetail.canCorrect,false);assert.equal(coherentDetail.returnableQuantity,'0.000');
  const page=await call(`/sales/orders/${order.id}/deliveries`,'GET',undefined,cookie);assert.equal(page.status,200);assert.match(page.data,/Physical|التسليم/);
 }finally{server.kill('SIGTERM');await db.$disconnect();}
});
