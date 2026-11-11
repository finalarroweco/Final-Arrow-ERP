import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compile=(path,require)=>{const m={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,m,m.exports);return m.exports;};
const calls=[];let rights=new Set();
const {invoiceSourceWhere,invoiceSourceAllowed,invoiceDocumentWhere,invoiceDocumentSourceAllowed}=compile('src/lib/invoice-source.ts',name=>name==='./db'?{db:{}}:{canAccess:async (scope,tx)=>{calls.push({scope,tx});return rights.has(scope.permission+':'+(scope.branchId??'company'));}});
const base={tenantId:'tenant',companyId:'company',customer:{branchId:'customer'},orderId:null,serviceSourceId:'service',order:null,serviceSource:{branchId:'billing'}};
test('source filters separately authorize order and billing branches with exclusive source identities',()=>{
 assert.deepEqual(invoiceSourceWhere(false,false),{OR:[]});
 const mixed=invoiceSourceWhere(['sales'],['billing']);assert.equal(mixed.OR.length,2);
 assert.deepEqual(mixed.OR[0],{orderId:{not:null},serviceSourceId:null,projectTimeSourceId:null,order:{is:{branchId:{in:['sales']}}}});
 assert.deepEqual(mixed.OR[1],{orderId:null,serviceSourceId:{not:null},projectTimeSourceId:null,serviceSource:{is:{branchId:{in:['billing']}}}});
 assert.equal(invoiceSourceWhere(false,null).OR.length,1);assert.equal(invoiceSourceWhere(null,false).OR.length,1);
});
test('manual metadata grants and unrelated order grants cannot expose billing sources',async()=>{
 rights=new Set(['customer:read:customer','subscription:read:billing','order:read:billing']);assert.equal(await invoiceSourceAllowed('actor',base),false);
 rights.add('billing-subscription:read:billing');assert.equal(await invoiceSourceAllowed('actor',base),true);
 rights.delete('customer:read:customer');assert.equal(await invoiceSourceAllowed('actor',base),false);
});
test('legacy order source retains independent order and customer checks',async()=>{
 const order={...base,orderId:'order',serviceSourceId:null,projectTimeSourceId:null,order:{branchId:'sales'},serviceSource:null};
 rights=new Set(['customer:read:customer','billing-subscription:read:sales']);assert.equal(await invoiceSourceAllowed('actor',order),false);
 rights.add('order:read:sales');assert.equal(await invoiceSourceAllowed('actor',order),true);
});
test('missing or dual sources fail closed and current transaction is passed into permission checks',async()=>{
 rights=new Set(['customer:read:customer','billing-subscription:read:billing']);calls.length=0;
 for(const changed of [{serviceSourceId:null},{serviceSource:null},{orderId:'order'},{order:{branchId:'sales'}}])assert.equal(await invoiceSourceAllowed('actor',{...base,...changed}),false);
 assert.equal(calls.length,0);const tx={marker:true};assert.equal(await invoiceSourceAllowed('actor',base,tx),true);assert.ok(calls.every(c=>c.tx===tx&&c.scope.userId==='actor'&&c.scope.tenantId==='tenant'&&c.scope.companyId==='company'));
});
test('billing and customer report scopes allow source alternatives while generic ledger totals remain unchanged',()=>{
 const presets=compile('src/lib/report-presets.ts',name=>{if(name==='zod')return requireZod;throw new Error(name);});
 assert.deepEqual(presets.reportSourcePermissions('CUSTOMER_AGING'),['order:read','billing-subscription:read','project-time-invoice:read']);
 assert.deepEqual(presets.reportPermissions('CUSTOMER_AGING'),['customer:read','invoice:read','ledger:read']);
 assert.deepEqual(presets.reportSourcePermissions('SUPPLIER_BALANCES'),[]);
});
import * as requireZod from 'zod';

test('legacy invoice-only document contracts stay intact while service documents require both new scopes',async()=>{
 const order={...base,orderId:'order',serviceSourceId:null,projectTimeSourceId:null,order:{branchId:'sales'},serviceSource:null};
 rights=new Set();assert.equal(await invoiceDocumentSourceAllowed('actor',order),true);assert.equal(await invoiceDocumentSourceAllowed('actor',base),false);
 rights.add('billing-subscription:read:billing');assert.equal(await invoiceDocumentSourceAllowed('actor',base),false);
 rights.add('customer:read:customer');assert.equal(await invoiceDocumentSourceAllowed('actor',base),true);
 const legacyOnly=invoiceDocumentWhere(false,false);assert.deepEqual(legacyOnly,{OR:[{orderId:{not:null},serviceSourceId:null,projectTimeSourceId:null,order:{is:{}}}]});
 assert.equal(invoiceDocumentWhere(null,false).OR.length,1);assert.equal(invoiceDocumentWhere(false,null).OR.length,1);
 assert.deepEqual(invoiceDocumentWhere(['billing'],['customer']).OR[1],{orderId:null,serviceSourceId:{not:null},projectTimeSourceId:null,serviceSource:{is:{branchId:{in:['billing']}}},customer:{branchId:{in:['customer']}}});
});

test('project time sources require independent current project, time and customer rights',async()=>{
 const row={...base,serviceSourceId:null,serviceSource:null,projectTimeSourceId:'time',projectTimeSource:{branchId:'project'}};
 rights=new Set(['customer:read:customer','project:read:project','project-time:read:project','project-time-invoice:read:project']);assert.equal(await invoiceSourceAllowed('actor',row),true);
 for(const key of [...rights]){rights.delete(key);assert.equal(await invoiceSourceAllowed('actor',row),false);rights.add(key);}
 assert.equal(invoiceSourceWhere(false,false,null,null,null).OR.length,1);assert.equal(invoiceSourceWhere(false,false,null,false,null).OR.length,0);
 assert.equal(await invoiceSourceAllowed('actor',{...row,orderId:'forged'}),false);
});
