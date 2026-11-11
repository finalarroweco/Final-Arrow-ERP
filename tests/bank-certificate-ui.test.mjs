import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
const require=createRequire(import.meta.url);
const root="../src/app/accounting/bank/certificates/";
function load(file,overrides={},globals={}){
 const filename=new URL(root+file,import.meta.url);
 const {outputText}=ts.transpileModule(readFileSync(filename,"utf8"),{fileName:filename.pathname,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}});
 const exports={};new Function("require","exports",...Object.keys(globals),outputText)(name=>Object.hasOwn(overrides,name)?overrides[name]:require(name),exports,...Object.values(globals));return exports;
}
const tenant="00000000-0000-4000-8000-000000000001",actor="00000000-0000-4000-8000-000000000002",id="00000000-0000-4000-8000-000000000003",requestId="00000000-0000-4000-8000-000000000004";
const payload={tenantId:tenant,requestId,expectedDigest:"a".repeat(64),note:"review"};
function harness({saved,kind="create",fetch:fetcher=async()=>({ok:true,status:200,json:async()=>({id:requestId,replayed:false})}),storageFails=false,actorValue=actor,tenantValue=tenant,idValue=id}={}){
 const key=`erp-bank-certificate:${kind}:${actorValue.toLowerCase()}:${tenantValue.toLowerCase()}:${idValue.toLowerCase()}`,storage=new Map(saved?[[key,saved]]:[]),slots=[],cleanup=[];let index=0,clears=0,calls=0;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==="function"?value(slots[i]):value;}];},useRef(initial){const i=index++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=index++;const serialized=JSON.stringify(deps);if(slots[i]!==serialized){slots[i]=serialized;cleanup.push(fn());}}};
 const api=load("request.ts",{react:hooks},{sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{if(storageFails)throw Error("blocked");storage.set(k,v);},removeItem:k=>storage.delete(k)},fetch:(...args)=>{calls++;return fetcher(...args);}});
 const render=(scope={})=>{actorValue=scope.actor??actorValue;tenantValue=scope.tenant??tenantValue;idValue=scope.id??idValue;index=0;return api.useCertificateRequests(actorValue,tenantValue,idValue,kind,()=>clears++);};render();
 return {render,storage,key,get calls(){return calls;},get clears(){return clears;},unmount(){cleanup.forEach(fn=>fn?.());}};
}
test("restored capture is actor/tenant/statement scoped, validated, and never submitted automatically",()=>{
 const h=harness({saved:JSON.stringify(payload)});assert.deepEqual(h.render().pending,payload);assert.equal(h.calls,0);assert.match(h.key,new RegExp(`${actor}:${tenant}:${id}$`));
 for(const invalid of ["broken",JSON.stringify({...payload,tenantId:actor}),JSON.stringify({...payload,extra:true}),JSON.stringify({...payload,expectedDigest:"bad"}),JSON.stringify({...payload,note:"x".repeat(301)})]){const x=harness({saved:invalid});assert.equal(x.render().pending,null);assert.equal(x.storage.get(x.key),invalid);assert.equal(x.render().blocked,true);}
});
test("event retry validation requires replacement only for supersede, bounded version and reason",()=>{
 const base={tenantId:tenant,requestId,expectedVersion:0,action:"SUPERSEDE",replacementId:actor,reason:"correction"};
 assert.deepEqual(harness({kind:"event",saved:JSON.stringify(base)}).render().pending,base);
 for(const invalid of [{...base,replacementId:undefined},{...base,action:"RESTORE"},{...base,expectedVersion:1000},{...base,reason:"ab"},{...base,reason:"bad\nreason"}])assert.equal(harness({kind:"event",saved:JSON.stringify(invalid)}).render().pending,null);
});
test("uncertain capture preserves exact payload and retry reuses original request ID",async()=>{
 const sent=[];let attempts=0;const h=harness({fetch:async(_url,options)=>{sent.push(options.body);if(!attempts++)throw Error("network");return {ok:true,status:200,json:async()=>({id:requestId,replayed:false})};}});
 let errors=0,success=0;await h.render().run("/capture",payload,()=>success++,()=>errors++);assert.equal(errors,1);assert.deepEqual(h.render().pending,payload);
 await h.render().run("/capture",h.render().pending,()=>success++,()=>errors++);assert.equal(success,1);assert.equal(sent[0],sent[1]);assert.equal(h.storage.size,0);assert.equal(h.render().pending,null);
});
test("duplicate clicks are single-flight and unmounted responses cannot update the UI",async()=>{
 let release;const response=new Promise(resolve=>{release=resolve;});const h=harness({fetch:()=>response});let success=0,errors=0;
 const first=h.render().run("/capture",payload,()=>success++,()=>errors++);await h.render().run("/capture",payload,()=>success++,()=>errors++);assert.equal(h.calls,1);
 h.unmount();release({ok:true,status:200,json:async()=>({id:requestId,replayed:false})});await first;assert.equal(success,0);assert.equal(errors,0);assert.deepEqual(JSON.parse(h.storage.get(h.key)),payload);
});
test("authorization loss clears display but retains unresolved writes; only definite rejections clear retries",async()=>{
 for(const status of [400,401,403,404,409,413,422,500]){const h=harness({fetch:async()=>({ok:false,status,json:async()=>({error:"failure"})})});let received;
 await h.render().run("/capture",payload,()=>assert.fail(),e=>{received=e.status;});assert.equal(received,status);assert.equal(h.clears,[401,403,404].includes(status)?1:0);assert.equal(h.render().pending!==null,true);assert.equal(h.storage.size,1);}
});
test("storage failure blocks mutation before network so uncertain requests remain retryable",async()=>{
 const h=harness({storageFails:true});let error;await h.render().run("/capture",payload,()=>assert.fail(),e=>{error=e;});assert.equal(error.status,0);assert.equal(h.calls,0);
});
const locale={translate:(locale,en,ar)=>locale==="ar"?ar:en};
const snapshotModule=load("snapshot.tsx",{"@/lib/locale":locale});
const snapshot={version:1,tenantId:tenant,companyId:id,accountId:id,statementId:id,company:{id,name:"Company"},account:{id,code:"1001",name:"Bank"},statement:{id,reference:"S1",from:"2026-01-01",to:"2026-01-31",currency:"JOD",opening:"0.000",closing:"1.000",voidedAt:"2026-02-01T00:00:00Z",voidReason:"duplicate",createdAt:"2026-02-01T00:00:00Z",createdBy:actor},summary:{bookClosing:"1.000",outstandingTotal:"0.000",adjustedBank:"1.000",difference:"0.000",pendingBank:1,reconciled:false,bookLines:25,bankLines:0,outstandingLines:1},book:Array.from({length:25},(_,i)=>({id:`source-${i}`,description:`unique-row-${i}-end`,amount:"1.000",matchedThroughCutoff:false,match:null})),bank:[]};
test("snapshot renders localized incomplete/void warnings and print includes every captured source",()=>{
 for(const language of ["en","ar"]){const html=renderToStaticMarkup(React.createElement(snapshotModule.SnapshotView,{snapshot,locale:language,printAll:true}));
 assert.match(html,/certificate-print-only/);assert.match(html,/@media print/);assert.equal(html.match(/unique-row-0-end/g)?.length,2);assert.equal(html.match(/unique-row-24-end/g)?.length,1);assert.match(html,language==="en"?/Review incomplete at capture/:/المراجعة غير مكتملة وقت الحفظ/);assert.match(html,language==="en"?/Captured statement was voided/:/كان الكشف ملغى عند الحفظ/);assert.match(html,language==="en"?/Not a final period close or auditor approval/:/ليس إقفالاً نهائياً للفترة أو اعتماد مدقق/);}
});
test("preview confirmation captures digest, detail manages history and wrapper rechecks authentication",()=>{
 const widget=readFileSync(new URL(root+"widget.tsx",import.meta.url),"utf8"),detail=readFileSync(new URL(root+"[id]/detail.tsx",import.meta.url),"utf8"),page=readFileSync(new URL(root+"[id]/page.tsx",import.meta.url),"utf8");
 assert.match(widget,/expectedDigest:preview.digest/);assert.match(widget,/requestId:crypto.randomUUID\(\)/);assert.match(widget,/Confirm and save this preview/);assert.match(detail,/expectedVersion:data.version/);assert.match(detail,/<input required value=\{replacement\}/);assert.match(detail,/Print snapshot with all source lines/);assert.match(page,/currentUser\(\)/);assert.match(page,/redirect\("\/login"\)/);assert.match(page,/uuid\(\).safeParse\(rawTenantId\)/);assert.match(page,/parsedTenant.data.toLowerCase\(\)/);
});
function detailHarness(secondStatus=200,historyVersion=0){
 const slots=[],effects=[],frames=new Map(),listeners=new Map();let index=0,frameId=0,printed=0,requests=0,downloads=0;
 const hooks={
  useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==="function"?v(slots[i]):v;}];},
  useRef(initial){const i=index++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(fn,deps){const i=index++;const old=slots[i];if(!old||deps.some((value,j)=>value!==old.deps[j])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}
 };
 const initial={certificate:{id,tenantId:tenant,companyId:id,accountId:id,statementId:id,createdAt:"2026-01-31",observedAt:"2026-01-31",createdBy:actor,note:"captured",digest:"a".repeat(64),snapshot},events:[],version:historyVersion,supersededBy:null,canManage:true};
 const latest={...initial,version:1,supersededBy:actor,events:[{id:requestId,sequence:1,action:"SUPERSEDE",replacementId:actor,reason:"newer observation",createdAt:"2026-02-02",createdBy:actor}]};
 const request=load("request.ts",{react:hooks},{sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:async(url,options)=>{requests++;assert.ok([`/api/bank/certificates/${id}?tenantId=${tenant}`,`/api/bank/certificates/${id}?tenantId=${tenant}&format=json`].includes(url));assert.equal(options.cache,"no-store");assert.equal(options.method,undefined);const status=requests===1?200:secondStatus;return {ok:status===200,status,json:async()=>status===200?(requests===1?initial:latest):{error:"denied"}};}});
 const detail=load("[id]/detail.tsx",{react:hooks,"@/lib/locale":locale,"../snapshot":snapshotModule,"../request":request,"../download":{downloadCertificate(value,downloadId,downloadTenant){assert.equal(downloadId,id);assert.equal(downloadTenant,tenant);assert.equal(value.version,1);downloads++;}}},{window:{print(){printed++;},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:n=>frames.delete(n)});
 function render(){index=0;const tree=detail.CertificateDetail({actorId:actor,tenantId:tenant,id,locale:"en"});effects.splice(0).forEach(fn=>fn());return tree;}
 function descendants(element){return [element,...React.Children.toArray(element?.props?.children).flatMap(child=>React.isValidElement(child)?descendants(child):[])];}
 function click(tree,label){const button=descendants(tree).find(e=>e.type==="button"&&e.props.children===label);assert.ok(button,`button ${label}`);assert.equal(button.props.disabled,false);button.props.onClick();}
 return {render,click,get downloads(){return downloads;},afterPrint(){listeners.get("afterprint")?.();},get listenerCount(){return listeners.size;},get requests(){return requests;},get printed(){return printed;},get queuedFrames(){return frames.size;},flushFrames(){const queued=[...frames.values()];frames.clear();queued.forEach(fn=>fn());},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test("explicit print reauthorizes and renders current designation before opening print",async()=>{
 const h=detailHarness();h.render();let tree=h.render();h.click(tree,"Load / refresh snapshot");await settle();tree=h.render();
 h.click(tree,"Print snapshot with all source lines");assert.equal(h.requests,2);assert.equal(h.printed,0);await settle();assert.equal(h.printed,0);assert.equal(h.queuedFrames,0);
 tree=h.render();const html=renderToStaticMarkup(tree);assert.match(html,/Superseded snapshot/);assert.match(html,/newer observation/);assert.match(html,/unique-row-24-end/);assert.equal(h.queuedFrames,1);assert.equal(h.printed,0);h.flushFrames();assert.equal(h.printed,1);h.render();h.flushFrames();assert.equal(h.printed,1);h.afterPrint();const after=renderToStaticMarkup(h.render());assert.doesNotMatch(after,/unique-row-24-end/);assert.match(after,/Use Print snapshot with all source lines/);assert.equal(h.listenerCount,0);
});
test("revoked print authorization clears sensitive detail and never opens print",async()=>{
 for(const status of [401,403]){const h=detailHarness(status);h.render();h.click(h.render(),"Load / refresh snapshot");await settle();const loaded=h.render();assert.match(renderToStaticMarkup(loaded),/captured/);
 h.click(loaded,"Print snapshot with all source lines");await settle();const html=renderToStaticMarkup(h.render());assert.match(html,/Access is no longer available/);assert.doesNotMatch(html,/captured|Source digest|Print snapshot with all source lines/);h.flushFrames();assert.equal(h.printed,0);assert.equal(h.queuedFrames,0);}
});
test("queued authorized print is cancelled on unmount or newer refresh",async()=>{
 for(const action of ["unmount","refresh"]){const h=detailHarness();h.render();h.click(h.render(),"Load / refresh snapshot");await settle();h.click(h.render(),"Print snapshot with all source lines");await settle();const tree=h.render();assert.equal(h.queuedFrames,1);
 if(action==="unmount")h.unmount();else h.click(tree,"Load / refresh snapshot");h.flushFrames();assert.equal(h.printed,0);}
});

test("ordinary browsing renders only paginated source rows and warns on manual browser printing",()=>{
 for(const language of ["en","ar"]){const html=renderToStaticMarkup(React.createElement(snapshotModule.SnapshotView,{snapshot,locale:language}));assert.equal(html.match(/unique-row-0-end/g)?.length,1);assert.doesNotMatch(html,/unique-row-24-end/);assert.match(html,language==="en"?/Use Print snapshot with all source lines for complete document/:/استخدم طباعة التوثيق مع جميع سطور المصدر للحصول على المستند الكامل/);}
});

test("lost write response survives denied read and retry until permission returns with the same UUID",async()=>{
 let count=0;const bodies=[];const h=harness({fetch:async(_url,options)=>{count++;if(options.body)bodies.push(options.body);if(count===1)throw Error("lost committed response");if(count<4)return {ok:false,status:403,json:async()=>({error:"denied"})};return {ok:true,status:200,json:async()=>({id:requestId,replayed:true})};}});
 await h.render().run("/write",payload,()=>assert.fail(),()=>{});await h.render().run("/read",undefined,()=>assert.fail(),()=>{});assert.deepEqual(h.render().pending,payload);
 await h.render().run("/write",h.render().pending,()=>assert.fail(),()=>{});assert.deepEqual(JSON.parse(h.storage.get(h.key)),payload);
 let confirmed=false;await h.render().run("/write",h.render().pending,()=>{confirmed=true;},()=>assert.fail());assert.equal(confirmed,true);assert.equal(new Set(bodies).size,1);assert.equal(h.storage.size,0);
});
test("malformed successful responses preserve exact unresolved payload",async()=>{
 for(const status of [200,201])for(const body of [{},{id:requestId},{id,replayed:true},{id:requestId,replayed:"true"},null]){const h=harness({fetch:async()=>({ok:true,status,json:async()=>body})});await h.render().run("/write",payload,()=>assert.fail(),()=>{});assert.deepEqual(h.render().pending,payload);assert.deepEqual(JSON.parse(h.storage.get(h.key)),payload);}
 const h=harness({fetch:async()=>({ok:true,status:201,json:async()=>{throw Error("incomplete JSON");}})});await h.render().run("/write",payload,()=>assert.fail(),()=>{});assert.deepEqual(h.render().pending,payload);
});
test("corrupt storage blocks overwriting and valid unresolved requests block replacement payloads",async()=>{
 for(const raw of ["broken",JSON.stringify({...payload,extra:true}),JSON.stringify(payload)]){const h=harness({saved:raw});await h.render().run("/write",{...payload,requestId:actor},()=>assert.fail(),()=>{});assert.equal(h.calls,0);assert.equal(h.storage.get(h.key),raw);assert.equal(h.render().blocked,true);}
});
test("history limit hides new action form without hiding readable evidence",async()=>{
 const h=detailHarness(200,1000);h.render();h.click(h.render(),"Load / refresh snapshot");await settle();const html=renderToStaticMarkup(h.render());assert.match(html,/limit of 1,000 events/);assert.doesNotMatch(html,/Confirm review action/);assert.match(html,/captured/);
});
test("JSON export reauthorizes and never downloads cached data on denial",async()=>{
 for(const status of [200,401,403]){const h=detailHarness(status);h.render();h.click(h.render(),"Load / refresh snapshot");await settle();h.click(h.render(),"Download authorized JSON");await settle();assert.equal(h.requests,2);assert.equal(h.downloads,status===200?1:0);if(status!==200)assert.doesNotMatch(renderToStaticMarkup(h.render()),/Source digest|Download authorized JSON/);}
});
test("JSON download rejects malformed or wrong-scope detail before creating a Blob URL",()=>{
 let blobs=0,clicks=0,revokes=0;const timers=[];const d=load("download.ts",{},{setTimeout(callback,delay){assert.equal(delay,1000);timers.push(callback);},URL:{createObjectURL(){blobs++;return "blob:fixture";},revokeObjectURL(){revokes++;}},document:{body:{appendChild(){}},createElement(){return {click(){clicks++;},remove(){}};}}});
 const value={certificate:{id,tenantId:tenant,companyId:id,accountId:id,statementId:id,digest:"a".repeat(64),createdAt:"2026-01-31",observedAt:"2026-01-31",createdBy:actor,note:null,snapshot},events:[],version:0,supersededBy:null,canManage:true};
 for(const invalid of [{},null,{...value,certificate:{...value.certificate,tenantId:actor}},{...value,certificate:{...value.certificate,id:actor}},{...value,certificate:{...value.certificate,snapshot:{}}}])assert.throws(()=>d.downloadCertificate(invalid,id,tenant));assert.equal(blobs,0);d.downloadCertificate(value,id,tenant);assert.equal(blobs,1);assert.equal(clicks,1);assert.equal(revokes,0);assert.equal(timers.length,1);timers[0]();assert.equal(revokes,1);
});

test("actor-switch request conflict retains original UUID until original account replays successfully",async()=>{
 let attempt=0;const sent=[];const h=harness({fetch:async(_url,options)=>{sent.push(options.body);attempt++;if(attempt===1)throw Error("lost committed response from actor A");if(attempt===2)return {ok:false,status:409,json:async()=>({error:"request belongs to another actor",code:"REQUEST_CONFLICT"})};return {ok:true,status:201,json:async()=>({id:requestId,replayed:true})};}});
 await h.render().run("/write",payload,()=>assert.fail(),()=>{});let code;
 await h.render().run("/write",h.render().pending,()=>assert.fail(),e=>{code=e.code;});assert.equal(code,"REQUEST_CONFLICT");assert.deepEqual(h.render().pending,payload);assert.deepEqual(JSON.parse(h.storage.get(h.key)),payload);
 let saved=false;await h.render().run("/write",h.render().pending,()=>{saved=true;},()=>assert.fail());assert.equal(saved,true);assert.equal(new Set(sent).size,1);assert.equal(h.storage.size,0);assert.equal(h.render().pending,null);
});
test("409 clears pending only for explicit definite rejection codes",async()=>{
 for(const code of [undefined,"UNKNOWN","REQUEST_CONFLICT","REJECTED","STALE_SOURCE","STALE_DESIGNATION"]){const h=harness({fetch:async()=>({ok:false,status:409,json:async()=>({error:"conflict",...(code?{code}:{})})})});let received;
 await h.render().run("/write",payload,()=>assert.fail(),e=>{received=e.code;});const rejected=["REJECTED","STALE_SOURCE","STALE_DESIGNATION"].includes(code);assert.equal(received,code);assert.equal(h.render().pending!==null,!rejected);assert.equal(h.storage.size,rejected?0:1);}
});

test("unclassified 400 and 413 retain retry while coded source limit clears it",async()=>{
 for(const [status,code] of [[400,undefined],[413,undefined],[413,"SOURCE_LIMIT"],[400,"REJECTED"]]){const h=harness({fetch:async()=>({ok:false,status,json:async()=>({error:"request rejected",...(code?{code}:{})})})});await h.render().run("/write",payload,()=>assert.fail(),()=>{});assert.equal(h.render().pending!==null,!code);assert.equal(h.storage.size,code?0:1);}
});
test("invalid new input never persists or sends and cannot discard a valid pending request",async()=>{
 const valid={tenantId:tenant,requestId,expectedVersion:0,action:"SUPERSEDE",replacementId:actor,reason:"correction"};
 for(const saved of [undefined,JSON.stringify(valid)]){const h=harness({kind:"event",saved});let code;await h.render().run("/write",{...valid,reason:"   "},()=>assert.fail(),e=>{code=e.code;});assert.equal(code,"LOCAL_INPUT");assert.equal(h.calls,0);assert.equal(h.storage.size,saved?1:0);assert.deepEqual(h.render().pending,saved?valid:null);if(saved)assert.equal(h.storage.get(h.key),saved);}
 const h=harness();await h.render().run("/write",{...payload,note:"x".repeat(301)},()=>assert.fail(),()=>{});assert.equal(h.calls,0);assert.equal(h.storage.size,0);
});


test("uppercase identifiers restore and replay with one canonical storage key and UUID",async()=>{
 const a="AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",t="BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",source="CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC",r="DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD";
 const raw={...payload,tenantId:t,requestId:r},sent=[];
 const h=harness({actorValue:a,tenantValue:t,idValue:source,saved:JSON.stringify(raw),fetch:async(_url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,status:201,json:async()=>({id:r,replayed:true})};}});
 assert.equal(h.key,`erp-bank-certificate:create:${a.toLowerCase()}:${t.toLowerCase()}:${source.toLowerCase()}`);assert.equal(h.render().pending.requestId,r.toLowerCase());let success=false;
 await h.render().run("/write",h.render().pending,()=>success=true,()=>assert.fail());assert.equal(success,true);assert.equal(sent[0].requestId,r.toLowerCase());assert.equal(sent[0].tenantId,t.toLowerCase());assert.equal(h.storage.size,0);
});
test("download compares UUID scope case-insensitively",()=>{
 const d=load("download.ts"),upper="AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",upperTenant="BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
 const value={certificate:{id:upper.toLowerCase(),tenantId:upperTenant.toLowerCase(),companyId:id,accountId:id,statementId:id,digest:"a".repeat(64),createdAt:"2026-01-31",observedAt:"2026-01-31",createdBy:actor,note:null,snapshot:{...snapshot,tenantId:upperTenant.toLowerCase()}},events:[],version:0,supersededBy:null,canManage:true};
 assert.equal(d.validCertificateDownload(value,upper,upperTenant),true);
});

for(const kind of ["create","event"])test(`${kind} v1 retries use original scoped actor and preserve bytes across cookie and source changes`,async()=>{
 const original=kind==="create"?payload:{tenantId:tenant,requestId,expectedVersion:0,action:"RESTORE",reason:"Restore original"};
 const raw=JSON.stringify(original,null,2),headers=[],bodies=[];let authenticatedActor=id;
 const h=harness({kind,saved:raw,fetch:async(_url,options)=>{
  headers.push(options.headers["X-Expected-Actor-Id"]);bodies.push(options.body);
  return authenticatedActor===actor?{ok:true,status:201,json:async()=>({id:requestId,replayed:false})}:{ok:false,status:409,json:async()=>({code:"ACTOR_MISMATCH",error:"Original account required"})};
 }});
 const originalRun=h.render().run;
 await originalRun("/write",h.render().pending,()=>assert.fail(),()=>{});
 assert.equal(headers[0],actor);assert.equal(h.storage.get(h.key),raw);assert.deepEqual(h.render().pending,original);
 h.render({actor:id});assert.equal(h.render().pending,null);
 await originalRun("/write",original,()=>assert.fail(),()=>{});assert.equal(h.calls,1);assert.equal(h.storage.get(h.key),raw);
 h.render({actor, id:tenant});assert.equal(h.render().pending,null);assert.equal(h.storage.get(h.key),raw);
 h.render({id});assert.deepEqual(h.render().pending,original);
 authenticatedActor=actor;let done=false;await h.render().run("/write",h.render().pending,()=>{done=true;},()=>assert.fail());
 assert.equal(done,true);assert.deepEqual(headers,[actor,actor]);assert.equal(bodies[0],bodies[1]);assert.equal(h.storage.size,0);
});
