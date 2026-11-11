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
 const bank=load('bank-reconciliation',{'./bank-certificate-snapshot':load('bank-certificate-snapshot',{'./exact-money':money}),'./exact-money':money,'./access':{},'./bank-statement-input':load('bank-statement-input',{'./date':load('date'),'./exact-money':money})}),rows=[...Array(250).fill({bookingDate:'2026-01-01',reference:'Incoming',amount:'999999999999999.999'}),...Array(250).fill({bookingDate:'2026-01-01',reference:'Outgoing',amount:'-999999999999999.999'})];
 assert.equal(bank.normalizedStatement({tenantId:id,companyId:id,accountId:id,requestId:id,reference:'Import exact',from:'2026-01-01',to:'2026-01-01',opening:'0',closing:'0',lines:rows}).closing,'0.000');
});

test('creation and designation route boundaries reject missing, malformed and switched actors before service writes or replay',async()=>{
 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 let authenticated=owner,calls=0;const records=new Map();
 class CertificateError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}}
 const services={CertificateError,certificateFailure:e=>Response.json({error:e.message,code:e.code},{status:e.status}),
  createCertificate:write,recordCertificateEvent:write};
 async function write(actor,source,payload){calls++;const replayed=records.has(payload.requestId);records.set(payload.requestId,{actor,source,payload});return {id:payload.requestId,replayed};}
 const route=load('bank-certificate-route',{'./auth':{currentUser:async()=>authenticated?{id:authenticated}:null},'./bank-certificates':services});
 for(const [path,body] of [['bank/statements/[id]/certificates/route.ts',{tenantId:id,requestId:id,expectedDigest:'a'.repeat(64),note:'Original'}],['bank/certificates/[id]/events/route.ts',{tenantId:id,requestId:id,expectedVersion:0,action:'RESTORE',reason:'Original'}]]){
  records.clear();calls=0;
  const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL('../src/app/api/'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(name=>({'@/lib/bank-certificate-route':route,'@/lib/bank-certificate-input':input,'@/lib/bank-certificates':services}[name]??require(name)),exports);
  const post=guard=>exports.POST(new Request('http://localhost/write',{method:'POST',headers:{'Content-Type':'application/json',...(guard===undefined?{}:{'X-Expected-Actor-Id':guard})},body:JSON.stringify(body)}),{params:Promise.resolve({id})});
  authenticated=other;
  for(const guard of [undefined,'invalid',owner,owner+','+other]){const r=await post(guard),data=await r.json();assert.equal(r.status,409);assert.ok(['ACTOR_REQUIRED','ACTOR_MISMATCH'].includes(data.code));assert.equal(data.outcome,undefined);assert.equal(records.size,0);assert.equal(calls,0);}
  authenticated=owner;const accepted=await post(owner.toUpperCase());assert.equal(accepted.status,201);assert.deepEqual(await accepted.json(),{id,replayed:false});assert.equal(records.get(id).actor,owner);
  authenticated=other;assert.equal((await post(owner)).status,409);assert.equal(calls,1);
  authenticated=owner;assert.deepEqual(await (await post(owner)).json(),{id,replayed:true});assert.equal(calls,2);
  authenticated=null;assert.equal((await post(owner)).status,401);assert.equal(calls,2);
 }
});

test('v2 signed residuals distinguish earlier cutoff from already consumed current capacity',()=>{
 const data={...base(),version:2};
 data.book=[{id:'incoming',amount:'10.001',currency:'OMR',allocated:'10.001',currentRemaining:'0.000',cutoffRemaining:'6.001',allocations:[{id:'early',amount:'4.000'},{id:'later',amount:'6.001'}]},{id:'outgoing',amount:'-2.001',currency:'OMR',allocated:'1.000',currentRemaining:'1.001',cutoffRemaining:'1.001',allocations:[{id:'out',amount:'1.000'}]}];
 data.statement.closing='3.000';
 let result=certificateSnapshot(data);
 assert.equal(result.summary.bookClosing,'8.000');assert.equal(result.summary.outstandingTotal,'5.000');assert.equal(result.summary.adjustedBank,'8.000');assert.equal(result.summary.difference,'0.000');assert.equal(result.summary.outstandingLines,2);
 data.bank=[{id:'in',amount:'1.001',statementCurrency:'OMR',statementVoidedAt:null,allocated:'1.000',currentRemaining:'0.001',cutoffRemaining:'0.001',allocations:[]},{id:'out',amount:'-1.001',statementCurrency:'OMR',statementVoidedAt:null,allocated:'1.000',currentRemaining:'0.001',cutoffRemaining:'0.001',allocations:[]}];
 result=certificateSnapshot(data);assert.equal(result.summary.pendingBank,2);assert.equal(result.summary.reconciled,false);
});
test('v2 history and residual bounds fail without truncation; v1 values and digests remain unchanged',()=>{
 const v1=base(),before=JSON.stringify(v1),expected=certificateHash(certificateSnapshot(v1));
 const data={...base(),version:2};data.book=[{amount:'999999999999999.999',currency:'OMR',allocated:'0.001',currentRemaining:'999999999999999.998',cutoffRemaining:'999999999999999.998',allocations:[{id:'one',amount:'0.001'}]}];
 assert.equal(certificateSnapshot(data).summary.outstandingTotal,'999999999999999.998');
 data.book[0].allocations=Array.from({length:20001},(_,i)=>({id:String(i),amount:'0.001'}));assert.throws(()=>certificateSnapshot(data),/20000 allocation/);
 data.book=Array(5001).fill({...data.book[0],allocations:[]});assert.throws(()=>certificateSnapshot(data),/5000/);
 assert.equal(JSON.stringify(v1),before);assert.equal(certificateHash(certificateSnapshot(v1)),expected);
});

test('pre-upgrade committed capture retries bypass v2 recapture; stale unsaved previews are rejected',async()=>{
 const inputs={...base(),version:2},current=certificateSnapshot(inputs),original={tenantId:id,requestId:id,expectedDigest:certificateHash(certificateSnapshot(base())),note:'Saved before upgrade'};
 const originalRequestHash=certificateHash({actorId:id,id,...original});let prior={id,tenantId:id,statementId:id,createdBy:id,requestDigest:originalRequestHash,snapshot:certificateSnapshot(base())},captures=0;
 const tx={$queryRaw:async strings=>{if(strings[0].includes('erp_bank_reconciliation_inputs')){captures++;return [{inputs,observedAt:new Date()}];}return [];},membership:{findUnique:async()=>({id,status:'ACTIVE'})},roleGrant:{findMany:async()=>[{scopes:[{type:'TENANT'}],role:{permissions:[{permissionKey:'ledger:read'},{permissionKey:'bank-reconciliation:create'}]}}]},bankStatement:{findFirst:async()=>({companyId:id,accountId:id})},bankReconciliationCertificate:{findUnique:async()=>prior}};
 const service=load('bank-certificates',{'./db':{db:{$transaction:fn=>fn(tx)}},'./scope':{scopeMatches:()=>true},'./bank-reconciliation':{lockBankAccount:async()=>{}},'./bank-certificate-snapshot':{certificateSnapshot,certificateHash,CertificateError:load('bank-certificate-snapshot',{'./exact-money':money}).CertificateError}});
 assert.deepEqual(await service.createCertificate(id,id,original),{id,replayed:true});assert.equal(captures,0);assert.equal(prior.snapshot.version,1);
 prior=null;assert.notEqual(certificateHash(current),original.expectedDigest);await assert.rejects(service.createCertificate(id,id,original),e=>e.code==='STALE_SOURCE');assert.equal(captures,1);
});
