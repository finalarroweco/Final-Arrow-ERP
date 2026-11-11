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
 assert.deepEqual(mixed.OR[0],{orderId:{not:null},serviceSourceId:null,projectTimeSourceId:null,projectMilestoneSourceId:null,order:{is:{branchId:{in:['sales']}}}});
 assert.deepEqual(mixed.OR[1],{orderId:null,serviceSourceId:{not:null},projectTimeSourceId:null,projectMilestoneSourceId:null,serviceSource:{is:{branchId:{in:['billing']}}}});
 assert.equal(invoiceSourceWhere(false,null).OR.length,1);assert.equal(invoiceSourceWhere(null,false).OR.length,1);
});
test('manual metadata grants and unrelated order grants cannot expose billing sources',async()=>{
 rights=new Set(['customer:read:customer','subscription:read:billing','order:read:billing']);assert.equal(await invoiceSourceAllowed('actor',base),false);
 rights.add('billing-subscription:read:billing');assert.equal(await invoiceSourceAllowed('actor',base),true);
 rights.delete('customer:read:customer');assert.equal(await invoiceSourceAllowed('actor',base),false);
});
test('legacy order source retains independent order and customer checks',async()=>{
 const order={...base,orderId:'order',serviceSourceId:null,projectTimeSourceId:null,projectMilestoneSourceId:null,order:{branchId:'sales'},serviceSource:null};
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
 assert.deepEqual(presets.reportSourcePermissions('CUSTOMER_AGING'),['order:read','billing-subscription:read','project-time-invoice:read','project-milestone:read']);
 assert.deepEqual(presets.reportPermissions('CUSTOMER_AGING'),['customer:read','invoice:read','ledger:read']);
 assert.deepEqual(presets.reportSourcePermissions('SUPPLIER_BALANCES'),[]);
});
import * as requireZod from 'zod';

test('legacy invoice-only document contracts stay intact while service documents require both new scopes',async()=>{
 const order={...base,orderId:'order',serviceSourceId:null,projectTimeSourceId:null,projectMilestoneSourceId:null,order:{branchId:'sales'},serviceSource:null};
 rights=new Set();assert.equal(await invoiceDocumentSourceAllowed('actor',order),true);assert.equal(await invoiceDocumentSourceAllowed('actor',base),false);
 rights.add('billing-subscription:read:billing');assert.equal(await invoiceDocumentSourceAllowed('actor',base),false);
 rights.add('customer:read:customer');assert.equal(await invoiceDocumentSourceAllowed('actor',base),true);
 const legacyOnly=invoiceDocumentWhere(false,false);assert.deepEqual(legacyOnly,{OR:[{orderId:{not:null},serviceSourceId:null,projectTimeSourceId:null,projectMilestoneSourceId:null,order:{is:{}}}]});
 assert.equal(invoiceDocumentWhere(null,false).OR.length,1);assert.equal(invoiceDocumentWhere(false,null).OR.length,1);
 assert.deepEqual(invoiceDocumentWhere(['billing'],['customer']).OR[1],{orderId:null,serviceSourceId:{not:null},projectTimeSourceId:null,projectMilestoneSourceId:null,serviceSource:{is:{branchId:{in:['billing']}}},customer:{branchId:{in:['customer']}}});
});

test('project time sources require independent current project, time and customer rights',async()=>{
 const row={...base,serviceSourceId:null,serviceSource:null,projectTimeSourceId:'time',projectTimeSource:{branchId:'project'}};
 rights=new Set(['customer:read:customer','project:read:project','project-time:read:project','project-time-invoice:read:project']);assert.equal(await invoiceSourceAllowed('actor',row),true);
 for(const key of [...rights]){rights.delete(key);assert.equal(await invoiceSourceAllowed('actor',row),false);rights.add(key);}
 assert.equal(invoiceSourceWhere(false,false,null,null,null).OR.length,1);assert.equal(invoiceSourceWhere(false,false,null,false,null).OR.length,0);
 assert.equal(await invoiceSourceAllowed('actor',{...row,orderId:'forged'}),false);
});

test('milestone source visibility is independent from time rights, branch-bound and fail closed',async()=>{
 const row={...base,serviceSourceId:null,serviceSource:null,projectTimeSourceId:null,projectTimeSource:null,projectMilestoneSourceId:'milestone',projectMilestoneSource:{branchId:'project'}};
 rights=new Set(['customer:read:customer','project:read:project','project-milestone:read:project']);
 calls.length=0;const tx={marker:'milestone'};
 assert.equal(await invoiceSourceAllowed('actor',row,tx),true);
 assert.equal(await invoiceDocumentSourceAllowed('actor',row,tx),true);
 assert.ok(calls.every(c=>c.tx===tx&&!c.scope.permission.startsWith('project-time')));
 for(const key of [...rights]){rights.delete(key);assert.equal(await invoiceSourceAllowed('actor',row),false);rights.add(key);}
 rights=new Set(['customer:read:customer','project:read:project','project-time:read:project','project-time-invoice:read:project','order:read:project','billing-subscription:read:project']);
 assert.equal(await invoiceSourceAllowed('actor',row),false);
 rights.add('project-milestone:read:other');assert.equal(await invoiceSourceAllowed('actor',row),false);
 rights.add('project-milestone:read:project');
 for(const changed of [{projectMilestoneSource:null},{projectMilestoneSourceId:null},{orderId:'forged'},{order:{branchId:'project'}},{serviceSourceId:'forged'},{projectTimeSourceId:'forged'},{projectTimeSource:{branchId:'project'}}])assert.equal(await invoiceDocumentSourceAllowed('actor',{...row,...changed}),false);
 const scoped=invoiceSourceWhere(false,false,['project'],false,false,['milestone']);
 assert.deepEqual(scoped.OR,[{orderId:null,serviceSourceId:null,projectTimeSourceId:null,projectMilestoneSourceId:{not:null},projectMilestoneSource:{is:{AND:[{branchId:{in:['project']}},{branchId:{in:['milestone']}}]}}}]);
 assert.equal(invoiceSourceWhere(false,false,false,false,false,null).OR.length,0);
 assert.equal(invoiceDocumentWhere(false,false,null,false,false,null).OR.length,1);
 assert.equal(invoiceDocumentWhere(false,['customer'],null,false,false,null).OR.length,2);
 const all=invoiceSourceWhere(null,null,null,null,null,null);assert.equal(all.OR.length,4);
 assert.ok(all.OR.slice(0,3).every(x=>x.projectMilestoneSourceId===null));
});

test('milestone grants are owner-only at registration and never require time permissions',()=>{
 const source=readFileSync('src/app/api/auth/register/route.ts','utf8');
 for(const right of ['read','manage','approve','generate'])assert.ok(source.includes(`"project-milestone:${right}"`));
 assert.match(source,/viewerExcluded[^\n]+"project-milestone:read"/);
 assert.match(source,/permissions.filter[^\n]+key!=="project-milestone:read"/);
 const {requiredReads}=compile('src/lib/permission-labels.ts',()=>({translate:(_l,en)=>en}));
 assert.deepEqual(requiredReads('project-milestone:read',['project-milestone:read']),['project-milestone:read','project:read','customer:read']);
 const generate=requiredReads('project-milestone:generate',['project-milestone:read']);
 for(const permission of ['project-milestone:read','project:read','customer:read','invoice:read','invoice:create','project-billing:read','project-billing:manage'])assert.ok(generate.includes(permission));
 assert.ok(!generate.some(x=>x.startsWith('project-time')));
});
