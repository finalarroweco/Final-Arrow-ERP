import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {apiResponse,locale} from './helpers/api-response.mjs';
const require=createRequire(import.meta.url);
function load(path,dependencies={}){
 const exports={};new Function('require','exports',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>dependencies[name]??(name==='@/lib/api-response'?apiResponse:require(name)),exports);return exports;
}
class AutomationError extends Error {constructor(message,status=409){super(message);this.status=status;}}
const boundary=load('src/lib/automation-route.ts',{'./automation':{AutomationError}});
const security=load('src/lib/request-security.ts');
const base='http://localhost/api/automation';
const request=(path='',body={},headers={})=>new Request(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
function fixture(){
 const state={actor:{id:'original-actor',sessionId:'original-session'},invalid:false,failure:null,calls:[]};
 const services={AutomationError,currentAutomationActor:async()=>state.actor,
  mutateAutomation:async(...args)=>{state.calls.push(args);if(state.failure)throw state.failure;return {actorId:args[0],command:args[1],resolved:args[2]};},
  listAutomation:async(...args)=>{state.calls.push(args);if(state.failure)throw state.failure;return {jobs:[],runs:[]};},
  automationSourcePreview:async(...args)=>{state.calls.push(args);if(state.failure)throw state.failure;return {preview:args[1]};}};
 const schema={safeParse:value=>state.invalid?{success:false}:{success:true,data:value}};
 const deps={'@/lib/automation':services,'@/lib/automation-session':{currentAutomationActor:services.currentAutomationActor},'@/lib/automation-route':boundary,'@/lib/request-security':security,'@/lib/automation-input':{automationCommand:schema,automationPreview:schema,automationQuery:schema}};
 return {state,route:path=>load(`src/app/api/automation/${path?path+'/':''}route.ts`,deps)};
}
test('automation command boundaries add categories without changing actor, session, exact command or receipts',async()=>{
 const command={requestId:'exact-id',expectedActorId:'original-actor',previewHash:'f'.repeat(64),action:'CREATE',reason:'نص المستخدم',config:{startAt:'2026-11-11T00:00:00.000Z'}};
 for(const path of ['', 'resolve','preview']){
  const f=fixture(),route=f.route(path);let response=await route.POST(request(path?'/'+path:'',command));
  assert.equal(response.status,path?200:201);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(f.state.calls[0][1],command);assert.equal(f.state.calls[0][0],'original-actor');
  if(path!=='preview'){assert.equal(f.state.calls[0][2],path==='resolve');assert.equal(f.state.calls[0][3],'original-session');assert.deepEqual(await response.json(),{actorId:'original-actor',command,resolved:path==='resolve'});}
  else {assert.equal(f.state.calls[0][2],'original-session');assert.deepEqual(await response.json(),{preview:command});}
  f.state.actor=null;response=await route.POST(request('/'+path,command));assert.equal(response.status,401);assert.equal((await response.json()).code,'UNAUTHENTICATED');assert.equal(f.state.calls.length,1);
  f.state.actor={id:'original-actor',sessionId:'original-session'};f.state.invalid=true;response=await route.POST(request('/'+path,command));assert.equal(response.status,400);assert.equal((await response.json()).code,'INVALID_INPUT');assert.equal(f.state.calls.length,1);
  f.state.invalid=false;f.state.failure=new AutomationError('Version changed',409);response=await route.POST(request('/'+path,command));assert.equal(response.status,409);assert.equal((await response.json()).code,'CONFLICT');
  response=await route.POST(request('/'+path,command,{'Sec-Fetch-Site':'cross-site'}));assert.equal(response.status,403);assert.equal((await response.json()).code,'FORBIDDEN');assert.equal(f.state.calls.length,2);
 }
});
test('automation listing and bounded body failures use the public contract without triggering source writes',async()=>{
 const f=fixture(),route=f.route('');f.state.actor=null;let response=await route.GET(new Request(base));assert.equal(response.status,401);assert.equal((await response.json()).code,'UNAUTHENTICATED');
 f.state.actor={id:'actor',sessionId:'session'};response=await route.GET(new Request(base+'?page=0&page=1'));assert.equal(response.status,400);assert.equal((await response.json()).code,'INVALID_INPUT');assert.equal(f.state.calls.length,0);
 response=await route.POST(new Request(base,{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'}));assert.equal(response.status,400);assert.equal((await response.json()).code,'INVALID_INPUT');assert.equal(f.state.calls.length,0);
 response=boundary.automationFailure(new Error('SECRET query and source details'));const data=await response.json();assert.equal(response.status,409);assert.equal(data.code,'CONFLICT');assert.doesNotMatch(JSON.stringify(data),/SECRET/);
 for(const language of ['ar','en'])assert.doesNotMatch(locale.presentApiError((en,ar)=>locale.translate(language,en,ar),data,409),/SECRET|Automation conflict/);
});
test('automation runner retains safe text, HTTP protection, headers and aggregate-only success',async()=>{
 const state={enabled:false,configured:false,authorized:false,failed:false,calls:0,authCalls:0};
 const aggregate={claimed:2,completed:1,pending:1};
 const route=load('src/app/api/automation/runner/route.ts',{'@/lib/automation-route':boundary,'@/lib/automation':{
  automationRunnerStatus:()=>({enabled:state.enabled,configured:state.configured}),
  authorizeAutomationRunner:()=>{state.authCalls++;return state.authorized;},
  runAutomationBatch:async()=>{state.calls++;if(state.failed)throw Error('SECRET credential and invoice details');return aggregate;},
 }});
 let response=await route.POST(request('/runner'));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Automation runner is disabled or unconfigured',code:'UNAVAILABLE'});assert.equal(state.authCalls,0);
 state.enabled=state.configured=true;response=await route.POST(request('/runner'));assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'Runner authorization required',code:'UNAUTHENTICATED'});assert.equal(state.calls,0);
 state.authorized=true;for(const headers of [{'Origin':'http://localhost'},{'Sec-Fetch-Site':'same-origin'}]){response=await route.POST(request('/runner',{},headers));assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'Server runner only',code:'FORBIDDEN'});}assert.equal(state.calls,0);
 response=await route.POST(request('/runner'));assert.equal(response.status,200);assert.deepEqual(await response.json(),aggregate);assert.equal(state.calls,1);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 state.failed=true;response=await route.POST(request('/runner'));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Runner unavailable; durable work remains pending',code:'UNAVAILABLE'});assert.equal(state.calls,2);
});
