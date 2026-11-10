import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const load=(name,overrides={})=>{const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(n=>overrides[n]??require(n),exports);return exports;};
const money=load('exact-money'),{certificateSnapshot,certificateHash}=load('bank-certificate-snapshot',{'./exact-money':money}),input=load('bank-certificate-input');
const id='11111111-1111-4111-8111-111111111111';
const base=()=>({version:1,tenantId:id,companyId:id,accountId:id,statementId:id,company:{id,name:'Company'},account:{id,code:'BANK',name:'Bank'},statement:{id,reference:'Bank',from:'2026-01-01',to:'2026-01-31',currency:'OMR',opening:'0.000',closing:'0.000',voidedAt:null,voidReason:null,createdAt:'2026-01-01T00:00:00.000Z',createdBy:id},book:[],bank:[]});
test('frozen calculation handles exact large totals, signed offsetting inputs and voids',()=>{
 const data=base();data.book=Array.from({length:1000},()=>({amount:'999999999999999.999',currency:'OMR',matchedThroughCutoff:false}));let result=certificateSnapshot(data);assert.equal(result.summary.bookClosing,'999999999999999999.000');assert.equal(result.summary.difference,'0.000');assert.equal(result.summary.reconciled,true);
 data.bank=[{amount:'1.000',statementCurrency:'OMR',statementVoidedAt:null,match:null},{amount:'-1.000',statementCurrency:'OMR',statementVoidedAt:null,match:null}];result=certificateSnapshot(data);assert.equal(result.summary.pendingBank,2);assert.equal(result.summary.reconciled,false);
 data.bank.forEach(b=>b.match={id});data.statement.voidedAt='2026-02-01T00:00:00.000Z';assert.equal(certificateSnapshot(data).summary.reconciled,false);
});
test('snapshot rejects mixed currencies and limits without truncation',()=>{
 const data=base();data.book=[{amount:'1.000',currency:'USD',matchedThroughCutoff:false}];assert.throws(()=>certificateSnapshot(data),/currency/);
 data.book=Array(5001).fill({amount:'1.000',currency:'OMR',matchedThroughCutoff:false});assert.throws(()=>certificateSnapshot(data),/5000/);
 data.book=Array(20001).fill({amount:'1.000',currency:'OMR',matchedThroughCutoff:true});assert.throws(()=>certificateSnapshot(data),/20000/);
 data.book=[];data.bank=Array(20001).fill({statementCurrency:'OMR'});assert.throws(()=>certificateSnapshot(data),/20000/);
 data.bank=[];data.company.name='x'.repeat(16*1024*1024);assert.throws(()=>certificateSnapshot(data),/MiB/);
});
test('content digest ignores object insertion order but observes changed amounts and source identities',()=>{assert.equal(certificateHash({a:1,b:{x:2,y:3}}),certificateHash({b:{y:3,x:2},a:1}));assert.notEqual(certificateHash({a:'1.000'}),certificateHash({a:'1.001'}));assert.notEqual(certificateHash({id}),certificateHash({id:'other'}));});
test('strict create and reasoned event inputs reject forged data and invalid transitions',()=>{
 const upper='AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';assert.equal(input.certificateCreateInput.parse({tenantId:upper,requestId:upper,expectedDigest:'a'.repeat(64)}).requestId,upper.toLowerCase());assert.equal(input.certificateEventInput.parse({tenantId:upper,requestId:upper,expectedVersion:0,action:'SUPERSEDE',replacementId:upper,reason:'Canonical identifiers'}).replacementId,upper.toLowerCase());
 const request={tenantId:id,requestId:id,expectedDigest:'a'.repeat(64),note:'  Review  '};assert.equal(input.certificateCreateInput.parse(request).note,'Review');assert.equal(input.certificateCreateInput.safeParse({...request,snapshot:{}}).success,false);
 const event={tenantId:id,requestId:id,expectedVersion:0,action:'SUPERSEDE',replacementId:id,reason:'Corrected observation'};assert.equal(input.certificateEventInput.safeParse(event).success,true);assert.equal(input.certificateEventInput.safeParse({...event,replacementId:null}).success,false);assert.equal(input.certificateEventInput.safeParse({...event,action:'RESTORE'}).success,false);assert.equal(input.certificateEventInput.safeParse({...event,reason:'\0bad'}).success,false);assert.equal(input.certificateEventInput.safeParse({...event,expectedVersion:1000}).success,false);
});
test('import totals preserve balanced maximum-sized CSV cancellation',()=>{
 const bank=load('bank-reconciliation',{'./exact-money':money,'./access':{},'./date':{dueDate:require('zod').z.string()}}),rows=[...Array(250).fill({bookingDate:'2026-01-01',reference:'Incoming',amount:'999999999999999.999'}),...Array(250).fill({bookingDate:'2026-01-01',reference:'Outgoing',amount:'-999999999999999.999'})];
 assert.equal(bank.normalizedStatement({tenantId:id,companyId:id,accountId:id,requestId:id,reference:'Import exact',from:'2026-01-01',to:'2026-01-01',opening:'0',closing:'0',lines:rows}).closing,'0.000');
});
