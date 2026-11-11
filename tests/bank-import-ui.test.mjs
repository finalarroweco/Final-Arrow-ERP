import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,webcrypto} from 'node:crypto';
import ts from 'typescript';
import {Prisma} from '@prisma/client';
const require=createRequire(import.meta.url),uuid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const scope={actorId:uuid(1),tenantId:uuid(2),companyId:uuid(3)},input={tenantId:scope.tenantId,companyId:scope.companyId,requestId:uuid(4),accountId:uuid(5),reference:'كشف أول 😀',from:'2026-10-01',to:'2026-10-02',opening:'-0',closing:'1.25',lines:[{bookingDate:'2026-10-01',reference:'الوارد',amount:'1.25'}]};
function load(path,overrides={},globals={}){const exports={};new Function('require','exports',...Object.keys(globals),ts.transpileModule(readFileSync(new URL('../src/'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>overrides[name]??(name==='@/lib/browser-auth-loss'?authLoss:require(name)),exports,...Object.values(globals));return exports;}
const authLoss=load('lib/browser-auth-loss.ts');
const money=load('lib/exact-money.ts'),date=load('lib/date.ts'),schema=load('lib/bank-statement-input.ts',{'./date':date,'./exact-money':money});
const originalNormalized=s=>{const data={...s,opening:new Prisma.Decimal(s.opening).toFixed(3),closing:new Prisma.Decimal(s.closing).toFixed(3),lines:s.lines.map(l=>({...l,amount:new Prisma.Decimal(l.amount).toFixed(3)}))};return {data,hash:createHash('sha256').update(JSON.stringify(data)).digest('hex')};};
function harness({initialScope=scope,storage=new Map(),storageFails=false,removeFails=false,onAccessLost,captureAccessLoss=()=>onAccessLost}={}){
 let index=0,slots=[],effects=[],activeScope=initialScope,committed=0;const calls=[],outcomes=[];
 const hooks={useState(v){const i=index++;if(!(i in slots))slots[i]=v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(v){const i=index++;if(!(i in slots))slots[i]={current:v};return slots[i];},useEffect(f,deps){const i=index++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=f();});}}};
 const access=()=>{if(storageFails)throw Error('Storage disabled');};
 const api=load('app/accounting/bank/import-request.ts',{'react':hooks,'@/lib/bank-statement-input':schema},{crypto:webcrypto,sessionStorage:{getItem(k){access();return storage.get(k)??null;},setItem(k,v){access();storage.set(k,v);},removeItem(k){access();if(removeFails)throw Error("Removal disabled");storage.delete(k);}},fetch:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}))});
 function render(){index=0;const value=api.useBankImport(activeScope,async outcome=>{committed++;outcomes.push(outcome);},captureAccessLoss);effects.splice(0).forEach(f=>f());return value;}
 function unmount(){slots.forEach(s=>s?.cleanup?.());}
 render();return {api,render,storage,calls,outcomes,key:api.importKey(initialScope),legacy:api.legacyImportKey(initialScope),unmount,get committed(){return committed;},switch(next){activeScope=next;render();render();},remount(){unmount();slots=[];effects=[];render();render();},response(data,status=201){calls.at(-1).resolve({ok:status>=200&&status<300,status,json:async()=>data});}};
}
async function waitCall(h,count=1){for(let i=0;i<100&&h.calls.length<count;i++)await new Promise(r=>setTimeout(r,1));assert.equal(h.calls.length,count,h.render().error);}
function receipt(h,changes={}){const saved=JSON.parse(h.storage.get(h.key)),p=JSON.parse(saved.body);return {id:p.requestId,requestId:p.requestId,actorId:scope.actorId,createdBy:scope.actorId,tenantId:p.tenantId,companyId:p.companyId,accountId:p.accountId,requestHash:saved.requestHash,replayed:false,...changes};}
test('browser hash input exactly preserves original Prisma normalization, key order, decimals and 500-line UTF-8 payload',async()=>{
 const h=harness();
 for(const raw of [input,{...input,opening:'0.000',closing:'1.250'},{...input,opening:'-0.000',closing:'-1.125',lines:[{...input.lines[0],amount:'-1.125'}]},{...input,opening:'0',closing:'0',lines:[]},{...input,opening:'-0',closing:'500',reference:'  محفوظ عربي 😀  ',lines:Array.from({length:500},(_,i)=>({bookingDate:'2026-10-01',reference:`سطر ${i} 😀`,amount:'1'}))}]){
  const parsed=schema.bankStatementInput.parse(raw),old=originalNormalized(parsed);assert.equal(JSON.stringify(schema.statementHashInput(parsed)),JSON.stringify(old.data));assert.equal(await h.api.importHash(parsed),old.hash);
 }
});
test('legacy actorless raw imports are quarantined without exposing, submitting, upgrading or deleting bytes',async()=>{
 for(const raw of [JSON.stringify(input),'{broken legacy CSV']){const h=harness(),storage=new Map([[h.legacy,raw]]),x=harness({storage});assert.equal(x.render().pending,null);assert.equal(x.render().blocked,true);await x.render().run(input);await x.render().run(undefined,true);assert.equal(x.calls.length,0);assert.equal(storage.get(x.legacy),raw);assert.equal(storage.size,1);}
});
test('storage unavailable and corrupt actor envelopes fail closed before network',async()=>{
 const p=harness();for(const h of [harness({storageFails:true}),harness({storage:new Map([[p.key,'broken']])})]){assert.equal(h.render().blocked,true);await h.render().run(input);assert.equal(h.calls.length,0);}
});
test('lost response, duplicate clicks and remount retain exact serialized body and original actor until verified replay',async()=>{
 const h=harness();const first=h.render().run(input);await h.render().run(input);await waitCall(h);assert.equal(h.calls.length,1);const raw=h.storage.get(h.key),body=h.calls[0].options.body;assert.equal(h.calls[0].options.headers['X-Expected-Actor-Id'],scope.actorId);h.calls[0].reject(Error('lost response'));await first;assert.equal(h.storage.get(h.key),raw);h.remount();const second=h.render().run();await waitCall(h,2);assert.equal(h.calls.length,2);assert.equal(h.calls[1].options.body,body);h.response(receipt(h,{replayed:true}));await second;assert.equal(h.storage.size,0);assert.equal(h.committed,1);
});
test('generic failures and arbitrary or wrong-identity 2xx never discard pending',async()=>{
 for(const [status,change] of [[400,()=>({error:'invalid'})],[401,()=>({})],[403,()=>({})],[404,()=>({})],[409,()=>({code:'REQUEST_CONFLICT'})],[500,()=>({})],[200,()=>({})],[201,r=>({...r,createdBy:uuid(9)})],[201,r=>({...r,actorId:uuid(9)})],[201,r=>({...r,requestHash:'f'.repeat(64)})],[201,r=>({...r,accountId:uuid(9)})],[201,r=>({...r,requestId:uuid(9)})],[201,r=>({...r,id:uuid(9)})],[201,r=>({...r,extra:true})]]){
  const h=harness(),task=h.render().run(input);await waitCall(h);const raw=h.storage.get(h.key);h.response(change(receipt(h)),status);await task;assert.equal(h.storage.get(h.key),raw);assert.equal(h.committed,0);assert.ok(h.render().pending);
 }
});
test('read-only UNKNOWN is not safe abandonment and never clears saved request; exact COMMITTED can confirm',async()=>{
 const h=harness();let task=h.render().run(input);await waitCall(h);h.calls[0].reject(Error('network'));await task;const raw=h.storage.get(h.key),body=h.calls[0].options.body;
 task=h.render().run(undefined,true);await waitCall(h,2);assert.match(h.calls.at(-1).url,/requests\/check$/);assert.equal(h.calls.at(-1).options.body,body);h.response({outcome:'UNKNOWN'},200);await task;assert.equal(h.storage.get(h.key),raw);assert.match(h.render().error,/not safe abandonment/);
 task=h.render().run(undefined,true);await waitCall(h,3);h.response({outcome:'COMMITTED',result:receipt(h,{replayed:true})},200);await task;assert.equal(h.storage.size,0);assert.equal(h.committed,1);
});
test('changed cookie mismatch preserves original bytes, original account can retry; actor navigation and unmount fence callbacks',async()=>{
 for(const change of ['switch','unmount']){const h=harness(),task=h.render().run(input);await waitCall(h);const raw=h.storage.get(h.key),r=receipt(h);if(change==='switch')h.switch({...scope,actorId:uuid(9)});else h.unmount();h.response(r);await task;assert.equal(h.storage.get(h.key),raw);assert.equal(h.committed,0);}
 const h=harness();let task=h.render().run(input);await waitCall(h);const raw=h.storage.get(h.key);h.response({code:'ACTOR_MISMATCH'},409);await task;assert.equal(h.storage.get(h.key),raw);task=h.render().run();await waitCall(h,2);h.response(receipt(h));await task;assert.equal(h.committed,1);
});
test('changed storage during in-flight success cannot be cleared by an older response',async()=>{
 const h=harness(),task=h.render().run(input);await waitCall(h);const r=receipt(h),newer='manual recovery changed storage';h.storage.set(h.key,newer);h.response(r);await task;assert.equal(h.storage.get(h.key),newer);assert.equal(h.committed,0);assert.equal(h.render().blocked,true);
});

test('import mutation auth loss fences sibling read epoch and queued output, preserving saved bytes',async()=>{
 for(const verdict of ['401','403','login','actor','business']){
  let epoch=0,queuedOutput=true;const h=harness({onAccessLost:()=>{epoch++;queuedOutput=false;}}),capturedEpoch=epoch,task=h.render().run(input);await waitCall(h);const raw=h.storage.get(h.key);let parsed=false;
  const status=verdict==='actor'||verdict==='business'?409:verdict==='login'?200:Number(verdict);
  h.calls[0].resolve({ok:status===200,status,redirected:verdict==='login',url:'http://localhost/login',json:async()=>{parsed=true;if(verdict==='401'||verdict==='403'||verdict==='login')throw Error('HTML denial');return {code:verdict==='actor'?'ACTOR_MISMATCH':'REQUEST_CONFLICT'};}});await task;
  assert.equal(h.storage.get(h.key),raw);assert.equal(h.committed,0);assert.equal(epoch,verdict==='business'?0:1);assert.equal(queuedOutput,verdict==='business');assert.equal(capturedEpoch===epoch,verdict==='business','late read adoption is fenced by the shared epoch');assert.equal(parsed,verdict==='actor'||verdict==='business');
 }
 const source=readFileSync(new URL('../src/app/accounting/bank/workspace.tsx',import.meta.url),'utf8');assert.match(source,/if\(epoch===readGeneration.current\)denyReads\(\)/);
});
test('obsolete import mutation denial cannot clear a newer actor workspace',async()=>{
 let denied=0;const h=harness({onAccessLost:()=>denied++}),task=h.render().run(input);await waitCall(h);const raw=h.storage.get(h.key);h.switch({...scope,actorId:uuid(9)});h.response({code:'ACTOR_MISMATCH'},403);await task;assert.equal(denied,0);assert.equal(h.storage.get(h.key),raw);
});

test('same-scope old import auth denial cannot clear a newer authenticated read epoch',async()=>{
 let epoch=0,cleared=0;const captureAccessLoss=()=>{const expected=epoch;return()=>{if(epoch===expected){epoch++;cleared++;}};};const h=harness({captureAccessLoss}),task=h.render().run(input);await waitCall(h);const raw=h.storage.get(h.key);epoch++;const reauthenticatedEpoch=epoch;h.response({code:'ACTOR_MISMATCH'},409);await task;assert.equal(epoch,reauthenticatedEpoch);assert.equal(cleared,0);assert.equal(h.storage.get(h.key),raw);assert.equal(h.committed,0);
});
test('read-only import outcome auth loss clears read state but never pending import',async()=>{
 let losses=0;const h=harness({onAccessLost:()=>losses++});let task=h.render().run(input);await waitCall(h);h.calls[0].reject(Error('network'));await task;assert.equal(losses,0);const raw=h.storage.get(h.key);task=h.render().run(undefined,true);await waitCall(h,2);h.response({error:'permission lost'},403);await task;assert.equal(losses,1);assert.equal(h.storage.get(h.key),raw);assert.equal(h.committed,0);
});

function abandonedReceipt(h,changes={}){const {id:_,replayed:__,...r}=receipt(h);return {...r,cancelledAt:'2026-11-11T10:20:30.000Z',auditId:uuid(22),...changes};}
async function pendingHarness(options){const h=harness(options),task=h.render().run(input);await waitCall(h);h.calls[0].reject(Error('lost response'));await task;return h;}
test('explicit abandonment sends original body and actor, is single-flight, and clears only verified terminal receipt',async()=>{
 for(const outcome of ['ABANDONED','COMMITTED']){const h=await pendingHarness(),saved=h.render().pending,body=h.calls[0].options.body;const task=h.render().abandon(saved);await h.render().abandon(saved);await waitCall(h,2);assert.equal(h.calls[1].url,'/api/bank/statements/requests/abandon');assert.equal(h.calls[1].options.body,body);assert.equal(h.calls[1].options.headers['X-Expected-Actor-Id'],scope.actorId);h.response({outcome,result:outcome==='ABANDONED'?abandonedReceipt(h):receipt(h,{replayed:true})},200);await task;assert.equal(h.storage.size,0);assert.equal(h.committed,1);}
});
test('abandon confirmation is tied to unchanged displayed envelope, never adopts changed storage',async()=>{
 const h=await pendingHarness(),saved=h.render().pending,newer=JSON.stringify({...saved,requestHash:'f'.repeat(64)});h.storage.set(h.key,newer);await h.render().abandon(saved);assert.equal(h.calls.length,1);assert.equal(h.storage.get(h.key),newer);assert.equal(h.render().blocked,true);
});
test('lost abandonment response is recoverable through exact read-only ABANDONED receipt',async()=>{
 const h=await pendingHarness(),raw=h.storage.get(h.key);let task=h.render().abandon(h.render().pending);await waitCall(h,2);h.calls[1].reject(Error('lost response'));await task;assert.equal(h.storage.get(h.key),raw);h.remount();task=h.render().run(undefined,true);await waitCall(h,3);h.response({outcome:'ABANDONED',result:abandonedReceipt(h)},200);await task;assert.equal(h.storage.size,0);assert.equal(h.committed,1);
});
test('abandonment rejects every malformed or changed terminal identity and preserves original bytes',async()=>{
 for(const change of [r=>({...r,requestId:uuid(9)}),r=>({...r,actorId:uuid(9)}),r=>({...r,createdBy:uuid(9)}),r=>({...r,tenantId:uuid(9)}),r=>({...r,companyId:uuid(9)}),r=>({...r,accountId:uuid(9)}),r=>({...r,requestHash:'f'.repeat(64)}),r=>({...r,auditId:'bad'}),r=>({...r,cancelledAt:'yesterday'}),r=>({...r,extra:true})]){const h=await pendingHarness(),raw=h.storage.get(h.key),task=h.render().abandon(h.render().pending);await waitCall(h,2);h.response({outcome:'ABANDONED',result:change(abandonedReceipt(h))},200);await task;assert.equal(h.storage.get(h.key),raw);assert.equal(h.committed,0);}
 for(const data of [{outcome:'UNKNOWN'},{outcome:'ABANDONED'},{outcome:'COMMITTED'},{}]){const h=await pendingHarness(),raw=h.storage.get(h.key),task=h.render().abandon(h.render().pending);await waitCall(h,2);h.response(data,200);await task;assert.equal(h.storage.get(h.key),raw);assert.equal(h.committed,0);}
});
test('abandonment failure and actor/scope/unmount/cross-tab changes retain pending and fence stale completion',async()=>{
 for(const change of ['actor','scope','unmount','storage','403']){const h=await pendingHarness(),raw=h.storage.get(h.key),result=abandonedReceipt(h),task=h.render().abandon(h.render().pending);await waitCall(h,2);if(change==='actor')h.switch({...scope,actorId:uuid(9)});if(change==='scope')h.switch({...scope,companyId:uuid(9)});if(change==='unmount')h.unmount();if(change==='storage')h.storage.set(h.key,'newer bytes');h.response({outcome:'ABANDONED',result},change==='403'?403:200);await task;assert.equal(h.storage.get(h.key),change==='storage'?'newer bytes':raw);assert.equal(h.committed,0);}
});
test('each abandonment attempt captures current read epoch, and old-epoch denial never clears newer reads',async()=>{
 let epoch=0,cleared=0;const h=await pendingHarness({captureAccessLoss:()=>{const expected=epoch;return()=>{if(epoch===expected){epoch++;cleared++;}};}});let task=h.render().abandon(h.render().pending);await waitCall(h,2);epoch++;h.response({code:'ACTOR_MISMATCH'},409);await task;assert.equal(cleared,0);task=h.render().abandon(h.render().pending);await waitCall(h,3);h.response({},403);await task;assert.equal(cleared,1);assert.ok(h.storage.get(h.key));
});
test('abandon UI confirms exact request context, states permanence and never renders CSV',()=>{
 const source=readFileSync(new URL('../src/app/accounting/bank/workspace.tsx',import.meta.url),'utf8');assert.match(source,/window\.confirm/);assert.match(source,/Permanently abandon this exact saved import request/);assert.match(source,/This never undoes a saved statement/);assert.match(source,/await imports\.abandon\(saved\)/);for(const field of ['requestId','accountId','companyId','tenantId','reference','from','to'])assert.ok(source.includes(`request.${field}`));assert.match(source,/saved.requestHash/);assert.doesNotMatch(source,/request.lines|saved.body\}/);
});

test('verified abandonment storage-removal failure retains bytes and blocks a new request',async()=>{
 const h=await pendingHarness({removeFails:true}),raw=h.storage.get(h.key),task=h.render().abandon(h.render().pending);await waitCall(h,2);h.response({outcome:'ABANDONED',result:abandonedReceipt(h)},200);await task;assert.equal(h.storage.get(h.key),raw);assert.equal(h.render().blocked,true);assert.equal(h.committed,0);await h.render().run({...input,requestId:uuid(99)});assert.equal(h.calls.length,2);
});
test('verified abandonment identifies its terminal outcome and allows only a newly prepared UUID',async()=>{
 const h=await pendingHarness(),task=h.render().abandon(h.render().pending);await waitCall(h,2);h.response({outcome:'ABANDONED',result:abandonedReceipt(h)},200);await task;assert.deepEqual(h.outcomes,['ABANDONED']);const next=h.render().run({...input,requestId:uuid(99)});await waitCall(h,3);assert.equal(JSON.parse(h.calls[2].options.body).requestId,uuid(99));h.calls[2].reject(Error('network'));await next;assert.equal(JSON.parse(JSON.parse(h.storage.get(h.key)).body).requestId,uuid(99));
});

test('lost abandonment response retries the identical saved body, actor and UUID without generating a new request',async()=>{
 const h=await pendingHarness(),raw=h.storage.get(h.key),body=h.calls[0].options.body;let task=h.render().abandon(h.render().pending);await waitCall(h,2);h.calls[1].reject(Error('connection closed after commit'));await task;assert.equal(h.storage.get(h.key),raw);h.remount();task=h.render().abandon(h.render().pending);await waitCall(h,3);assert.equal(h.calls[2].url,h.calls[1].url);assert.equal(h.calls[2].options.body,body);assert.deepEqual(h.calls[2].options.headers,h.calls[1].options.headers);h.response({outcome:'ABANDONED',result:abandonedReceipt(h)},200);await task;assert.deepEqual(h.outcomes,['ABANDONED']);assert.equal(h.storage.size,0);
});
test('abandonment rejects invalid audit UUID, invalid ISO time and unrecognized terminal fields',async()=>{
 for(const change of [r=>({...r,auditId:null}),r=>({...r,auditId:'00000000-0000-0000-0000-00000000000z'}),r=>({...r,cancelledAt:'2026-13-40T25:61:61.000Z'}),r=>({...r,cancelledAt:'2026-11-11'}),r=>({...r,cancelledAt:null}),r=>({...r,transactionId:'123'})]){const h=await pendingHarness(),raw=h.storage.get(h.key),task=h.render().abandon(h.render().pending);await waitCall(h,2);h.response({outcome:'ABANDONED',result:change(abandonedReceipt(h))},200);await task;assert.equal(h.storage.get(h.key),raw);assert.equal(h.committed,0);}
 const h=await pendingHarness(),raw=h.storage.get(h.key),task=h.render().abandon(h.render().pending);await waitCall(h,2);h.response({outcome:'ABANDONED',result:abandonedReceipt(h),unverified:true},200);await task;assert.equal(h.storage.get(h.key),raw);assert.equal(h.committed,0);
});
test('abandonment cannot transmit a corrupt hash-bound envelope or legacy actorless body',async()=>{
 const h=await pendingHarness(),saved=h.render().pending;const changed={...saved,body:JSON.stringify({...input,reference:'Changed reference'})};h.storage.set(h.key,JSON.stringify(changed));h.remount();await h.render().abandon(h.render().pending);assert.equal(h.calls.length,1);assert.equal(h.render().blocked,true);assert.equal(h.storage.get(h.key),JSON.stringify(changed));
 const legacy=await pendingHarness(),raw=legacy.storage.get(legacy.key),legacyRaw=JSON.stringify(input);legacy.storage.set(legacy.legacy,legacyRaw);await legacy.render().abandon(legacy.render().pending);assert.equal(legacy.calls.length,1);assert.equal(legacy.storage.get(legacy.key),raw);assert.equal(legacy.storage.get(legacy.legacy),legacyRaw);assert.equal(legacy.render().blocked,true);
});

const alphaUuid=n=>`abcdef0${n}-abcd-4abc-8abc-abcdefabcdef`;
const caseScope={actorId:alphaUuid(1),tenantId:alphaUuid(2),companyId:alphaUuid(3)};
const caseInput={...input,tenantId:caseScope.tenantId.toUpperCase(),companyId:caseScope.companyId.toUpperCase(),requestId:alphaUuid(4).toUpperCase(),accountId:alphaUuid(5).toUpperCase()};
function caseReceipt(h){const saved=JSON.parse(h.storage.get(h.key));return {id:alphaUuid(4),requestId:alphaUuid(4),tenantId:caseScope.tenantId,companyId:caseScope.companyId,accountId:alphaUuid(5),actorId:caseScope.actorId,createdBy:caseScope.actorId,requestHash:saved.requestHash,replayed:true};}
test('uppercase original UUID bytes accept lowercase database identity without altering body, digest or storage key',async()=>{
 for(const outcome of ['IMPORT','COMMITTED','ABANDONED']){
  const h=harness({initialScope:caseScope});let task=h.render().run(caseInput);await waitCall(h);const raw=h.storage.get(h.key),saved=JSON.parse(raw),body=h.calls[0].options.body;assert.equal(body,JSON.stringify(schema.bankStatementInput.parse(caseInput)));assert.equal(saved.requestHash,originalNormalized(schema.bankStatementInput.parse(caseInput)).hash);assert.equal(h.key,`erp-bank-import:v2:${caseScope.actorId}:${caseScope.tenantId}:${caseScope.companyId}`);
  if(outcome==='IMPORT'){h.response(caseReceipt(h));}else{h.calls[0].reject(Error('lost response'));await task;h.remount();task=outcome==='ABANDONED'?h.render().abandon(h.render().pending):h.render().run(undefined,true);await waitCall(h,2);assert.equal(h.calls[1].options.body,body);const r=caseReceipt(h);if(outcome==='ABANDONED'){delete r.id;delete r.replayed;r.cancelledAt='2026-11-11T10:20:30.000Z';r.auditId=alphaUuid(6);}h.response({outcome,result:r},200);}
  await task;assert.equal(h.storage.size,0);assert.equal(h.committed,1);
 }
});
test('case-insensitive UUID identity never accepts the digest from a differently cased original request',async()=>{
 for(const outcome of ['COMMITTED','ABANDONED']){const h=harness({initialScope:caseScope});let task=h.render().run(caseInput);await waitCall(h);h.calls[0].reject(Error('lost response'));await task;const raw=h.storage.get(h.key),saved=h.render().pending,lowerInput={...caseInput,...caseScope,requestId:alphaUuid(4),accountId:alphaUuid(5)};delete lowerInput.actorId;const wrongHash=await h.api.importHash(lowerInput);assert.notEqual(wrongHash,saved.requestHash);task=h.render().run(undefined,true);await waitCall(h,2);const r={...caseReceipt(h),requestHash:wrongHash};if(outcome==='ABANDONED'){delete r.id;delete r.replayed;r.cancelledAt='2026-11-11T10:20:30.000Z';r.auditId=alphaUuid(6);}h.response({outcome,result:r},200);await task;assert.equal(h.storage.get(h.key),raw);assert.equal(h.committed,0);}
});
test('saved actor and scope UUID casing is identity-only, with no actor adoption or storage-key normalization',async()=>{
 const h=harness({initialScope:caseScope}),upperScope=Object.fromEntries(Object.entries(caseScope).map(([k,v])=>[k,v.toUpperCase()])),saved={version:2,...upperScope,body:JSON.stringify(caseInput),requestHash:await h.api.importHash(caseInput)};
 assert.ok(h.api.parsedImport(JSON.stringify(saved),caseScope));assert.notEqual(h.api.importKey(upperScope),h.api.importKey(caseScope));
 const r={id:alphaUuid(4),requestId:alphaUuid(4),tenantId:caseScope.tenantId,companyId:caseScope.companyId,accountId:alphaUuid(5),actorId:caseScope.actorId,createdBy:caseScope.actorId,requestHash:saved.requestHash,replayed:true};assert.equal(h.api.confirmedImport(r,saved,caseScope),true);assert.equal(h.api.confirmedImport({...r,actorId:alphaUuid(9)},saved,caseScope),false);assert.equal(h.api.parsedImport(JSON.stringify({...saved,actorId:alphaUuid(9)}),caseScope),null);
});
