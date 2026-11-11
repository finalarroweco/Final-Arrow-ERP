import test from 'node:test';
import assert from 'node:assert/strict';
import {apiResponse,locale} from './helpers/api-response.mjs';
const {apiJson}=apiResponse;
const {apiErrorCode,presentApiError,presentCaughtError,LocalizedPresentationError,translate}=locale;
const cases=[[400,'INVALID_INPUT'],[401,'UNAUTHENTICATED'],[403,'FORBIDDEN'],[404,'NOT_FOUND'],[409,'CONFLICT'],[412,'CONFLICT'],[413,'PAYLOAD_TOO_LARGE'],[415,'UNSUPPORTED_MEDIA_TYPE'],[422,'INVALID_INPUT'],[429,'RATE_LIMITED'],[500,'UNKNOWN'],[502,'UNAVAILABLE'],[503,'UNAVAILABLE'],[504,'UNAVAILABLE'],[418,'UNKNOWN']];
for(const [status,code] of cases)test(`error envelope and bilingual presentation: ${status} ${code}`,async()=>{
 const original={error:'Private database and user content: SECRET marker'};
 const response=apiJson(original,{status,headers:{'Cache-Control':'private, no-store','Retry-After':'30'}});
 assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('retry-after'),'30');
 const body=await response.json();assert.equal(body.code,code);assert.equal(apiErrorCode(status),code);assert.deepEqual(original,{error:'Private database and user content: SECRET marker'});
 if(status>=500)assert.doesNotMatch(JSON.stringify(body),/SECRET/);
 const messages=['en','ar'].map(language=>presentApiError((en,ar)=>translate(language,en,ar),body,status));
 assert.notEqual(messages[0],messages[1]);assert.match(messages[1],/[\u0600-\u06ff]/);for(const message of messages)assert.doesNotMatch(message,/SECRET|Private database|undefined|object Object/);
});
test('success identity, business data, request body and success headers pass through without codes',async()=>{
 const body={actorId:'actor',request:{requestId:'request',reason:'Human text stays unchanged'},outcome:{code:'human-entered'}};
 const response=apiJson(body,{status:201,headers:{'X-Receipt':'receipt'}});assert.equal(response.status,201);assert.equal(response.headers.get('x-receipt'),'receipt');assert.deepEqual(await response.json(),body);
});
test('domain and nested actor codes survive the adapter; HTTP auth boundaries win presentation',async()=>{
 for(const code of ['ACTOR_MISMATCH','NOT_RECORDED_CLOSED','REQUEST_CONFLICT']){
  const body={error:'Legacy text',code,outcome:{requestId:'same'}};assert.deepEqual(await apiJson(body,{status:409}).json(),body);
 }
 const nested=await apiJson({error:{code:'ACTOR_MISMATCH',message:'SECRET'}},{status:409}).json();assert.equal(nested.code,'ACTOR_MISMATCH');
 const english=(en)=>en;assert.match(presentApiError(english,nested,409),/original account/);
 assert.match(presentApiError(english,nested,401),/Sign in again/);assert.match(presentApiError(english,nested,403),/Access is not allowed/);
});
test('unknown codes, malformed JSON values and untrusted Error text never become user copy',()=>{
 for(const value of [null,undefined,'SECRET',1,[],{error:'SECRET'},{code:'__proto__'},{code:'constructor'},{code:'SECRET'},{code:[]},{error:{code:'SECRET',message:'SECRET'}},new Error('SECRET')]){
  for(const language of ['ar','en']){const text=presentApiError((en,ar)=>translate(language,en,ar),value);assert.doesNotMatch(text,/SECRET|undefined|object Object/);assert.match(text,language==='ar'?/تعذر التحقق/:/could not be verified/);}
 }
 assert.match(presentCaughtError(en=>en,new SyntaxError('PRIVATE malformed response')),/could not be verified/);
 assert.equal(presentCaughtError(en=>en,new LocalizedPresentationError('راجع التاريخ')),'راجع التاريخ');
});
test('conflict and unknown outcomes never promise rollback, success or request disposal',()=>{
 for(const status of [409,500,503,0]){const text=presentApiError(en=>en,{},status);assert.match(text,/pending request/);assert.match(text,/duplicate/);assert.doesNotMatch(text,/nothing was saved|successfully|has been cancelled|was discarded/i);}
});
