import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function module(path,overrides={}){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(name=>overrides[name]??require(name),m,m.exports);return m.exports;}
const input=module('src/lib/sales-stock-input.ts');
function fixture(mode){const log=[],actor=randomUUID(),scope={tenantId:randomUUID(),companyId:randomUUID(),orderId:randomUUID()},branchId=randomUUID(),id=randomUUID();let options;
 const tx={$queryRaw:async strings=>{log.push(strings.join(''));return [];},salesOrder:{findFirst:async()=>({id:scope.orderId,branchId:null,status:'NEW'})},branch:{findMany:async()=>[{id:branchId}]},salesStockDocument:{findFirst:async()=>({id,...scope,branchId,kind:'DELIVERY'}),findMany:async args=>{log.push(args);return mode==='detail'&&args.where.deliveryId?Array(5001).fill({}):[];},groupBy:async args=>{log.push(args);return Array(5001).fill({});}}};
 const service=module('src/lib/sales-stock.ts',{'./db':{db:{$transaction:async(fn,settings)=>{options=settings;return fn(tx);}}},'./access':{canAccess:async()=>true},'./sales-stock-input':input});return {log,actor,scope,id,service,get options(){return options;}};
}
test('register rejects excessive total groups before publishing partial rows or totals and locks coherent source',async()=>{const f=fixture('list');await assert.rejects(f.service.listSalesStockDocuments(f.actor,{...f.scope,page:0,format:'json'}),e=>e.status===413);assert.equal(f.options.isolationLevel,'ReadCommitted');assert.match(f.log[0],/Tenant.*FOR SHARE/);assert.match(f.log[1],/SalesOrder.*FOR SHARE/);assert.equal(f.log.find(x=>x?.by)?.take,5001);});
test('complete detail rejects oversized return history before any partial print data and locks coherent source',async()=>{const f=fixture('detail');await assert.rejects(f.service.readSalesStockDocument(f.actor,f.id,f.scope.tenantId),e=>e.status===413);assert.equal(f.options.isolationLevel,'ReadCommitted');assert.match(f.log[0],/Tenant.*FOR SHARE/);assert.match(f.log[1],/SalesOrder.*FOR SHARE/);assert.equal(f.log.find(x=>x?.where?.deliveryId)?.take,5001);});
