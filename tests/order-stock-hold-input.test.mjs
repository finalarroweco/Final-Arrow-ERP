import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),exports={};
new Function('require','exports',ts.transpileModule(readFileSync(new URL('../src/lib/order-stock-hold-input.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,exports);
const {orderStockHoldRequest,pendingOrderStockHold,confirmedOrderStockHold,orderHoldCsv}=exports;
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,actorId=id(1),source={id:id(2),tenantId:id(3),companyId:id(4)};
const request={tenantId:source.tenantId,companyId:source.companyId,branchId:id(5),action:'reserve',expectedActorId:actorId,expectedUnit:'box',requestId:id(6),itemId:id(7),quantity:'1.250',note:'Explicit manual hold'};
const row={id:request.requestId,tenantId:source.tenantId,balanceId:id(8),quantity:'1.25',reference:'Order-linked manual hold',createdBy:actorId,createdAt:'2026-11-10T12:00:00.000Z',releasedBy:null,releasedAt:null,releaseReason:null,releaseRequestId:null,orderLink:{orderId:source.id,lineId:null,note:request.note,orderNumber:'SO-1',customerName:'Customer',linePosition:null,lineDescription:null,itemSku:'SKU',itemName:'Original item',itemUnit:'box',branchName:'Main'},balance:{itemId:request.itemId,branchId:request.branchId,companyId:source.companyId}};
export {id,actorId,source,request,row};
test('strict positive decimal quantities, source UUID normalization and optional descriptive line',()=>{
 assert.equal(orderStockHoldRequest.parse(request).quantity,'1.250');
 for(const quantity of ['0','0.000','-1','1e2','1.0001','01','1000000000'])assert.equal(orderStockHoldRequest.safeParse({...request,quantity}).success,false);
 for(const patch of [{note:'a'},{note:'evil\nline'},{lineId:null},{extra:true},{reference:'private ref'}])assert.equal(orderStockHoldRequest.safeParse({...request,...patch}).success,false);
 assert.equal(orderStockHoldRequest.parse({...request,lineId:id(9)}).lineId,id(9));
 const upper='ABCDEFAB-1234-4123-8123-ABCDEFABCDEF';assert.equal(orderStockHoldRequest.parse({...request,itemId:upper}).itemId,upper.toLowerCase());
});
test('pending envelope binds actor, source and company without replacing branch',()=>{
 const envelope={version:1,actorId,orderId:source.id,request};assert.deepEqual(pendingOrderStockHold(envelope,actorId,source),request);
 for(const patch of [{version:2},{actorId:id(9)},{orderId:id(9)},{extra:true},{request:{...request,tenantId:id(9)}},{request:{...request,companyId:id(9)}}])assert.equal(pendingOrderStockHold({...envelope,...patch},actorId,source),null);
});
test('success means exact actor/source/scope/payload including later release',()=>{
 assert.equal(confirmedOrderStockHold({reservation:row},request,actorId,source.id),true);
 for(const patch of [{id:id(9)},{createdBy:id(9)},{quantity:'1.251'},{tenantId:id(9)},{orderLink:{...row.orderLink,note:'Altered'}},{orderLink:{...row.orderLink,lineId:id(9)}},{orderLink:{...row.orderLink,orderId:id(9)}},{balance:{...row.balance,branchId:id(9)}}])assert.equal(confirmedOrderStockHold({reservation:{...row,...patch}},request,actorId,source.id),false);
 assert.equal(confirmedOrderStockHold({reservation:{id:row.id}},request,actorId,source.id),false);
 const release={tenantId:source.tenantId,companyId:source.companyId,branchId:request.branchId,action:'release',expectedActorId:actorId,requestId:id(10),reservationId:row.id,reason:'Release approved'};
 const released={...row,releasedAt:'2026-11-11T12:00:00.000Z',releasedBy:actorId,releaseRequestId:release.requestId,releaseReason:release.reason};
 assert.equal(confirmedOrderStockHold({reservation:released},request,actorId,source.id),true);
 assert.equal(confirmedOrderStockHold({reservation:released},release,actorId,source.id),true);
 assert.equal(confirmedOrderStockHold({reservation:{...released,releaseRequestId:id(9)}},release,actorId,source.id),false);
});
test('CSV current page identifies limited history, snapshot units, actors and escapes formulas',()=>{
 const csv=orderHoldCsv([{...row,orderLink:{...row.orderLink,itemName:'=1+1',note:'a,"b"'}}],2);
 assert.match(csv,/current page only/);assert.match(csv,/"3"/);assert.match(csv,/Unit snapshot/);assert.match(csv,/"box"/);assert.match(csv,/"'=1\+1"/);assert.match(csv,/a,""b""/);assert.match(csv,/Released by/);
});
test('CSV guards formula prefixes hidden behind whitespace or controls and preserves quoted Arabic',()=>{
 for(const itemName of ['  =1+1','\n=1+1',' \t\r\n+SUM(1,2)','\u0000@formula',' -1+2']){const csv=orderHoldCsv([{...row,orderLink:{...row.orderLink,itemName,note:'وحدة "صندوق"'}}],0);assert.ok(csv.includes(`"'${itemName}"`));assert.ok(csv.includes('"وحدة ""صندوق"""'));}
});
test('source role UI requires order read without forcing company-wide inventory read',()=>{
 const labels={};
 new Function('require','exports',ts.transpileModule(readFileSync(new URL('../src/lib/permission-labels.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='./locale'?{translate:(_locale,en)=>en}:require(name),labels);
 assert.deepEqual(labels.requiredReads('order-reservation:manage',['order:read','inventory-stock:read']),['order:read']);
});
test('new holds require an exact case-sensitive catalog unit and both actions require expected actor',()=>{
 for(const expectedUnit of [undefined,null,'',' box','box ','box/unit','box_unit','x'.repeat(17),'وحدة','box\n'])assert.equal(orderStockHoldRequest.safeParse({...request,expectedUnit}).success,false);
 for(const expectedUnit of ['box','BOX','Box-12'])assert.equal(orderStockHoldRequest.parse({...request,expectedUnit}).expectedUnit,expectedUnit);
 assert.equal(orderStockHoldRequest.safeParse({...request,expectedActorId:undefined}).success,false);
 const release={tenantId:source.tenantId,companyId:source.companyId,branchId:request.branchId,action:'release',requestId:id(10),reservationId:row.id,reason:'Full release'};
 assert.equal(orderStockHoldRequest.safeParse(release).success,false);assert.equal(orderStockHoldRequest.safeParse({...release,expectedActorId:actorId}).success,true);
});
test('saved requests preserve original expected unit and bind envelope, request and current actor',()=>{
 const envelope={version:1,actorId,orderId:source.id,request:{...request,expectedUnit:'BOX'}};
 assert.equal(pendingOrderStockHold(envelope,actorId,source).expectedUnit,'BOX');
 for(const patch of [{expectedUnit:undefined},{expectedActorId:undefined},{expectedActorId:id(90)}])assert.equal(pendingOrderStockHold({...envelope,request:{...envelope.request,...patch}},actorId,source),null);
 assert.equal(pendingOrderStockHold({...envelope,actorId:id(90)},id(90),source),null);
});
test('receipts bind original snapshot unit and expected actor, not current catalog unit or changed signed-in user',()=>{
 assert.equal(confirmedOrderStockHold({reservation:{...row,balance:{...row.balance,item:{unit:'crate'}}}},request,actorId,source.id),true);
 assert.equal(confirmedOrderStockHold({reservation:{...row,orderLink:{...row.orderLink,itemUnit:'BOX'}}},request,actorId,source.id),false);
 assert.equal(confirmedOrderStockHold({reservation:{...row,createdBy:id(90)}},request,id(90),source.id),false);
 const release={tenantId:source.tenantId,companyId:source.companyId,branchId:request.branchId,action:'release',expectedActorId:actorId,requestId:id(10),reservationId:row.id,reason:'Full release'};
 const released={...row,releaseRequestId:release.requestId,releasedBy:id(90),releasedAt:'2026-11-11T12:00:00.000Z',releaseReason:release.reason};
 assert.equal(confirmedOrderStockHold({reservation:released},release,id(90),source.id),false);
});
