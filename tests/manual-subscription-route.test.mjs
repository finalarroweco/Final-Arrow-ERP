import {apiResponse} from "./helpers/api-response.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function compile(path,dependencies={}){const compiled={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>Object.hasOwn(dependencies,name)?dependencies[name]:(name === "@/lib/api-response" ? apiResponse : require(name)),compiled,compiled.exports);return compiled.exports;}
class SubscriptionError extends Error{constructor(message,status=409){super(message);this.status=status;}}
const input=compile('src/lib/manual-subscription-input.ts'),route=compile('src/lib/manual-subscription-route.ts',{'./manual-subscriptions':{SubscriptionError},'./manual-subscription-input':input});
const {boundedSubscriptionJson,uniqueSubscriptionQuery,csvSubscriptionCell,subscriptionFailure,subscriptionHeaders}=route;
const request=body=>new Request('http://localhost/api/manual-subscriptions',{method:'POST',body});
test('manual subscription JSON reader preserves maximum escaped plain text and bounds actual wire bytes',async()=>{
 const body={description:'\u0001'.repeat(65536)};assert.deepEqual(await boundedSubscriptionJson(request(JSON.stringify(body))),body);
 const exact=' '.repeat(input.SUBSCRIPTION_REQUEST_MAX_BYTES-2)+'{}';assert.deepEqual(await boundedSubscriptionJson(request(exact)),{});
 await assert.rejects(boundedSubscriptionJson(request(exact+' ')),error=>error instanceof SubscriptionError&&error.status===413);
 await assert.rejects(boundedSubscriptionJson(request(new Uint8Array([0xc3,0x28]))),error=>error.status===400);
 await assert.rejects(boundedSubscriptionJson(request('{broken')),error=>error.status===400);
 await assert.rejects(boundedSubscriptionJson(new Request('http://localhost/')),error=>error.status===400);
});
test('manual subscription query rejects duplicated plain or encoded filter keys',()=>{
 for(const query of ['?q=one&q=two','?q=x&%71=y','?page=0&page=0','?reviewFrom=2024-01-01&reviewFrom=2024-01-02'])assert.throws(()=>uniqueSubscriptionQuery(new Request('http://localhost/'+query)),error=>error.status===400);
 assert.deepEqual(uniqueSubscriptionQuery(new Request('http://localhost/?q=%D8%B9%D9%85%D9%8A%D9%84&page=0')),{q:'عميل',page:'0'});
});
test('manual subscription metadata CSV escapes formulas, quotes, line breaks and headers',()=>{
 for(const value of ['=SUM(A1:A2)','+cmd','-cmd','@cmd',' \t=cmd','\u0001@cmd'])assert.equal(csvSubscriptionCell(value),`"'${value}"`);
 assert.equal(csvSubscriptionCell('Customer "one"\nArabic عميل'),'"Customer ""one""\nArabic عميل"');
 assert.equal(csvSubscriptionCell(null),'""');assert.equal(csvSubscriptionCell('ordinary'),'"ordinary"');
 assert.equal(subscriptionHeaders['Cache-Control'],'private, no-store');assert.equal(subscriptionHeaders['X-Content-Type-Options'],'nosniff');
});
test('manual subscription errors return bounded generic details with no-store protection',async()=>{
 const response=subscriptionFailure(new SubscriptionError('Explicit conflict',409));assert.equal(response.status,409);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(await response.json(),{error:'Explicit conflict',code:'CONFLICT'});
 const unexpected=new Error('Unexpected database detail');assert.throws(()=>subscriptionFailure(unexpected),error=>error===unexpected);
});
