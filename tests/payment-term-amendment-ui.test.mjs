import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {randomUUID} from "node:crypto";
import ts from "typescript";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";

const require=createRequire(import.meta.url);
function load(file,overrides={},environment={}){
 const filename=new URL(`../src/${file}`,import.meta.url);
 const {outputText}=ts.transpileModule(readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020},fileName:filename.pathname});
 const exports={};
 new Function("require","exports","fetch","localStorage","window","crypto",outputText)(name=>Object.hasOwn(overrides,name)?overrides[name]:require(name),exports,environment.fetch,environment.localStorage,environment.window,{randomUUID});
 return exports;
}
const localeModule=load("lib/locale.ts"),inputModule=load("lib/payment-term-amendment-input.ts");
const actorId="11111111-1111-4111-8111-111111111111",tenantId="22222222-2222-4222-8222-222222222222",sourceId="33333333-3333-4333-8333-333333333333";
const baseProps={actorId,tenantId,kind:"invoice",sourceId,sequence:0,label:"Net 30",dueDate:"2026-12-01",canManage:true,locale:"en"};
const key=`payment-term-amendment:v1:${actorId}:${tenantId}:invoice:${sourceId}`;
const request=()=>({tenantId,requestId:randomUUID(),expectedSequence:0,paymentTerms:{label:"Net 60",dueDate:"2026-12-31"},reason:"Operator approved extension"});
const envelope=value=>JSON.stringify({version:1,actorId,kind:"invoice",sourceId,request:value});
const savedChange=(value,props=baseProps)=>({id:value.requestId,tenantId:value.tenantId,createdBy:props.actorId,invoiceId:props.kind==="invoice"?props.sourceId:null,receiptId:props.kind==="receipt"?props.sourceId:null,sequence:value.expectedSequence+1,paymentTerms:value.paymentTerms?.label??null,paymentDueDate:value.paymentTerms?.dueDate??null,reason:value.reason});
function descendants(element){return [element,...React.Children.toArray(element?.props?.children).flatMap(child=>React.isValidElement(child)?descendants(child):[])];}
function elements(tree,type){return descendants(tree).filter(element=>element.type===type);}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Execute real TSX and effects with deterministic hook state and request timing.
// No browser, Next server, database, or new dependency is needed.
function harness(props=baseProps,storage=new Map()){
 let slots=[],cursor=0,effects=[],tree,reloads=0,denied=false;
 const calls=[],listeners=new Set();
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const mockReact={...React,
  useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{slots[index]=typeof value==="function"?value(slots[index]):value;}];},
  useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},
  useEffect(effect,deps){const index=cursor++,previous=slots[index];if(!previous||!same(previous.deps,deps)){const slot={deps,cleanup:previous?.cleanup};slots[index]=slot;effects.push(()=>{slot.cleanup?.();slot.cleanup=effect();});}},
 };
 const environment={
  localStorage:{getItem(name){if(denied)throw new Error("Storage unavailable");return storage.get(name)??null;},setItem(name,value){if(denied)throw new Error("Storage unavailable");storage.set(name,value);},removeItem(name){if(denied)throw new Error("Storage unavailable");storage.delete(name);}},
  window:{addEventListener(type,listener){if(type==="storage")listeners.add(listener);},removeEventListener(type,listener){listeners.delete(listener);},location:{reload(){reloads++;}}},
  fetch:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject})),
 };
 const {PaymentTermAmendmentForm}=load("app/payment-term-amendment-form.tsx",{react:mockReact,"@/lib/locale":localeModule,"@/lib/payment-term-amendment-input":inputModule},environment);
 function render(){cursor=0;tree=PaymentTermAmendmentForm(props);const queued=effects.splice(0);for(const effect of queued)effect();return tree;}
 function mount(){for(const slot of slots)slot?.cleanup?.();slots=[];effects=[];render();render();}
 mount();
 return {calls,storage,render,mount,get reloads(){return reloads;},
  button(label){return elements(render(),"button").find(button=>button.props.children===label);},
  prepare(){elements(render(),"textarea")[0].props.onChange({target:{value:"Operator approved extension"}});render();},
  submit(){const submit=elements(render(),"form")[0].props.onSubmit;submit({preventDefault(){}});return submit;},
  async respond(index,status,data){calls[index].resolve({ok:status>=200&&status<300,status,json:async()=>data});await tick();render();},
  async reject(index){calls[index].reject(new Error("Lost response"));await tick();render();},
  notify(){for(const listener of listeners)listener({key});render();},
  denyStorage(){denied=true;mount();},
 };
}

test("double submit sends once and saves the exact request before fetch; network uncertainty locks editing",async()=>{
 const h=harness();h.prepare();const submit=h.submit();submit({preventDefault(){}});
 assert.equal(h.calls.length,1);const stored=JSON.parse(h.storage.get(key));assert.deepEqual(stored.request,JSON.parse(h.calls[0].options.body));
 assert.equal(h.calls[0].url,`/api/invoices/${sourceId}/payment-terms`);
 await h.reject(0);assert.equal(elements(h.render(),"fieldset")[0].props.disabled,true);
 assert.ok(h.button("Retry exact saved request"));assert.ok(!h.button("Discard rejected request and reload"));
 const message=elements(h.render(),"p").find(p=>p.props.role==="status");assert.match(message.props.children,/uncertain/);
});

test("remount restores a pending payload and exact replay clears it and reloads fresh history",async()=>{
 const saved=request(),h=harness(baseProps,new Map([[key,envelope(saved)]]));
 assert.equal(elements(h.render(),"fieldset")[0].props.disabled,true);h.mount();
 h.button("Retry exact saved request").props.onClick();assert.deepEqual(JSON.parse(h.calls[0].options.body),saved);
 await h.respond(0,200,{change:savedChange(saved),replayed:true});assert.equal(h.storage.has(key),false);assert.equal(h.reloads,1);
});

for(const status of [400,409])test(`${status} rejection requires explicit discard and reload, never automatic replacement`,async()=>{
 const saved=request(),h=harness(baseProps,new Map([[key,envelope(saved)]]));h.button("Retry exact saved request").props.onClick();
 await h.respond(0,status,{error:"Rejected request",requestOutcome:{code:"NOT_RECORDED",requestId:saved.requestId}});assert.equal(h.storage.get(key),envelope(saved));assert.equal(h.reloads,0);
 h.button("Discard rejected request and reload").props.onClick();assert.equal(h.storage.has(key),false);assert.equal(h.reloads,1);
});

for(const status of [400,409])test(`${status} without a matching explicit absence outcome preserves the pending request`,async()=>{
 for(const data of [{error:"Invalid payment-term amendment"},{error:"Request ID already used",requestOutcome:{code:"UNRESOLVED",requestId:randomUUID()}},{error:"Unknown conflict",requestOutcome:{code:"NEW_UNKNOWN_CODE",requestId:randomUUID()}},{error:"Rejected other request",requestOutcome:{code:"NOT_RECORDED",requestId:randomUUID()}}]){
  const saved=request(),h=harness(baseProps,new Map([[key,envelope(saved)]]));h.button("Retry exact saved request").props.onClick();
  await h.respond(0,status,data);assert.equal(h.storage.get(key),envelope(saved));assert.equal(h.reloads,0);assert.ok(!h.button("Discard rejected request and reload"));assert.equal(elements(h.render(),"fieldset")[0].props.disabled,true);
 }
});

test("lost response followed by a different signed-in actor's409 retains A's UUID until A can replay",async()=>{
 const h=harness();h.prepare();h.submit();const saved=JSON.parse(h.calls[0].options.body),persisted=h.storage.get(key);
 // Server committed as A, but the response was lost. The cookie then switches to B
 // while A's stale component and scoped browser storage remain in this tab.
 await h.reject(0);h.button("Retry exact saved request").props.onClick();assert.deepEqual(JSON.parse(h.calls[1].options.body),saved);
 await h.respond(1,409,{error:"Request ID already used with different amendment data",requestOutcome:{code:"UNRESOLVED",requestId:saved.requestId}});
 assert.equal(h.storage.get(key),persisted);assert.equal(h.reloads,0);assert.ok(!h.button("Discard rejected request and reload"));assert.equal(elements(h.render(),"fieldset")[0].props.disabled,true);
 assert.match(elements(h.render(),"p").find(p=>p.props.role==="status").props.children,/original operator/);
 // After restoring A's session, retry still sends exactly the original payload.
 h.button("Retry exact saved request").props.onClick();assert.deepEqual(JSON.parse(h.calls[2].options.body),saved);
 await h.respond(2,201,{change:savedChange(saved),replayed:true});assert.equal(h.storage.has(key),false);assert.equal(h.reloads,1);
});

for(const status of [401,403,404,500])test(`${status} cannot discard an uncertain previously committed request`,async()=>{
 const saved=request(),h=harness({...baseProps,canManage:false},new Map([[key,envelope(saved)]]));
 assert.equal(elements(h.render(),"fieldset")[0].props.disabled,true);h.button("Retry exact saved request").props.onClick();await h.respond(0,status,{error:"Unavailable"});
 assert.equal(h.storage.get(key),envelope(saved));assert.equal(h.reloads,0);assert.ok(!h.button("Discard rejected request and reload"));
});

test("ambiguous success payload remains unresolved rather than losing the request",async()=>{
 const saved=request(),h=harness(baseProps,new Map([[key,envelope(saved)]]));h.button("Retry exact saved request").props.onClick();await h.respond(0,200,{ok:true});
 assert.equal(h.storage.get(key),envelope(saved));assert.equal(h.reloads,0);assert.ok(!h.button("Discard rejected request and reload"));
});

test("mismatched200 acknowledgement identity or payload cannot resolve the pending request",async()=>{
 for(const patch of [{id:randomUUID()},{tenantId:randomUUID()},{createdBy:randomUUID()},{invoiceId:randomUUID()},{invoiceId:null,receiptId:sourceId},{sequence:7},{paymentTerms:"Different terms"},{paymentDueDate:null},{reason:"Different reason"}]){
  const saved=request(),h=harness(baseProps,new Map([[key,envelope(saved)]]));h.button("Retry exact saved request").props.onClick();
  await h.respond(0,200,{change:{...savedChange(saved),...patch},replayed:true});assert.equal(h.storage.get(key),envelope(saved));assert.equal(h.reloads,0);assert.ok(!h.button("Discard rejected request and reload"));assert.equal(elements(h.render(),"fieldset")[0].props.disabled,true);
 }
});

test("another tab's newer cache is neither overwritten on submit nor removed by an older successful response",async()=>{
 const h=harness();h.prepare();const saved=request();h.storage.set(key,envelope(saved));h.submit();assert.equal(h.calls.length,0);assert.equal(h.storage.get(key),envelope(saved));
 h.button("Retry exact saved request").props.onClick();const newer=request();h.storage.set(key,envelope(newer));h.notify();
 await h.respond(0,200,{change:savedChange(saved),replayed:false});assert.equal(h.storage.get(key),envelope(newer));assert.equal(h.reloads,1);
});

test("a successful response cannot clear a changed cached payload that reused the same UUID",async()=>{
 const saved=request(),h=harness(baseProps,new Map([[key,envelope(saved)]]));h.button("Retry exact saved request").props.onClick();
 const different={...saved,reason:"Different pending reason"};h.storage.set(key,envelope(different));h.notify();
 await h.respond(0,201,{change:savedChange(saved),replayed:true});assert.equal(h.storage.get(key),envelope(different));
});

test("explicit discard of an old rejected payload cannot clear another tab's newer cache",async()=>{
 const saved=request(),h=harness(baseProps,new Map([[key,envelope(saved)]]));h.button("Retry exact saved request").props.onClick();await h.respond(0,409,{error:"Conflict",requestOutcome:{code:"NOT_RECORDED",requestId:saved.requestId}});
 const discard=h.button("Discard rejected request and reload"),newer=request();h.storage.set(key,envelope(newer));discard.props.onClick();
 assert.equal(h.storage.get(key),envelope(newer));assert.equal(h.reloads,0);assert.equal(elements(h.render(),"fieldset")[0].props.disabled,true);
});

test("read-only, invalid saved requests, wrong actor scope, and unavailable storage fail closed",()=>{
 const readonly=harness({...baseProps,canManage:false});readonly.prepare();readonly.submit();assert.equal(readonly.calls.length,0);
 for(const raw of ["not-json",JSON.stringify({version:1}),envelope({...request(),tenantId:sourceId}),JSON.stringify({...JSON.parse(envelope(request())),actorId:sourceId})]){
  const h=harness(baseProps,new Map([[key,raw]]));assert.equal(elements(h.render(),"fieldset")[0].props.disabled,true);h.prepare();h.submit();assert.equal(h.calls.length,0);assert.equal(h.storage.get(key),raw);
 }
 const h=harness();h.denyStorage();assert.equal(elements(h.render(),"fieldset")[0].props.disabled,true);h.submit();assert.equal(h.calls.length,0);
});

const form=load("app/payment-term-amendment-form.tsx",{"@/lib/locale":localeModule,"@/lib/payment-term-amendment-input":inputModule});
const {PaymentTermHistory}=load("app/payment-term-history.tsx",{"@/lib/locale":localeModule,"./language-switcher":{LanguageSwitcher:()=>null},"./payment-term-amendment-form":form});
const details={source:{id:sourceId,tenantId,companyId:sourceId,branchId:null,reference:"INV-123",status:"ISSUED",kind:"invoice"},original:{paymentTerms:"Original Net 30",paymentDueDate:"2026-12-01"},current:{paymentTerms:"Updated Net 60",paymentDueDate:"2026-12-31",sequence:2,recordedAt:"2026-11-09T12:00:00.000Z"},canManage:true,changes:[{id:"change",sequence:2,paymentTerms:null,paymentDueDate:null,reason:"Approved removal <script>",createdBy:actorId,authorName:"Operator",createdAt:"2026-11-09T12:00:00.000Z"}],nextPage:2};

test("bilingual history retains original/current values, cleared audit rows, escaped reasons, and page navigation",()=>{
 for(const locale of ["en","ar"]){
  const html=renderToStaticMarkup(React.createElement(PaymentTermHistory,{details,actorId,locale,page:1}));
  for(const value of ["Original Net 30","Updated Net 60","2026-12-01","2026-12-31","payment-terms?page=0","payment-terms?page=2","Approved removal &lt;script&gt;",'min="2000-01-01"','max="2099-12-31"','maxLength="1000"'])assert.ok(html.includes(value),value);
  assert.ok(html.includes(locale==="en"?"Current effective terms":"شروط الدفع الحالية"));assert.ok(html.includes(locale==="en"?"Cleared":"ممسوح"));assert.ok(html.includes('disabled=""'));
 }
 const html=renderToStaticMarkup(React.createElement(PaymentTermHistory,{details:{...details,canManage:false,source:{...details.source,kind:"receipt"},changes:[],nextPage:null},actorId,locale:"en",page:0}));
 assert.ok(html.includes(`/purchasing/receipts/${sourceId}`));assert.ok(html.includes("Read-only"));assert.ok(html.includes("No amendments on this page."));assert.ok(!html.includes("Older amendments"));
});

test("invoice and receipt print pages keep original terms labeled and link to current history",()=>{
 for(const file of ["accounting/invoices/[id]/page.tsx","purchasing/receipts/[id]/page.tsx"]){
  const source=readFileSync(new URL(`../src/app/${file}`,import.meta.url),"utf8");
  assert.match(source,/Original payment terms \(immutable\)/);assert.match(source,/شروط الدفع الأصلية/);assert.match(source,/Current payment terms \/ history/);assert.match(source,/\/payment-terms/);
 }
 const source=readFileSync(new URL("../src/app/reports/source-aging.tsx",import.meta.url),"utf8");assert.match(source,/latest amendment recorded before the end of the selected UTC day/);
});


test("same-source revision refresh remounts the form with fresh terms and optimistic sequence",()=>{
 const node=value=>descendants(PaymentTermHistory({details:value,actorId,locale:"en",page:0})).find(element=>element.type===form.PaymentTermAmendmentForm);
 const before=node(details),updated={...details,current:{paymentTerms:"Newly approved Net 90",paymentDueDate:"2027-01-30",sequence:3,recordedAt:"2026-11-10T12:00:00.000Z"}},after=node(updated);
 assert.notEqual(before.key,after.key,"React must remount when the same source revision changes");
 assert.equal(before.props.sourceId,after.props.sourceId);
 assert.equal(node({...details,changes:[]}).key,before.key,"history pagination alone must not discard an unsent edit");
 const h=harness(after.props),inputs=elements(h.render(),"input");
 assert.ok(inputs.some(input=>input.props.value==="Newly approved Net 90"));
 assert.ok(inputs.some(input=>input.props.value==="2027-01-30"));
 assert.ok(!inputs.some(input=>input.props.value==="Updated Net 60"));
 h.prepare();h.submit();const sent=JSON.parse(h.calls[0].options.body);
 assert.equal(sent.expectedSequence,3);assert.deepEqual(sent.paymentTerms,{label:"Newly approved Net 90",dueDate:"2027-01-30"});
});

test("same-source revision remount restores an unresolved request without changing its old sequence or payload",async()=>{
 const saved=request(),storage=new Map([[key,envelope(saved)]]);
 const oldNode=descendants(PaymentTermHistory({details,actorId,locale:"en",page:0})).find(element=>element.type===form.PaymentTermAmendmentForm);
 const old=harness(oldNode.props,storage);assert.equal(elements(old.render(),"fieldset")[0].props.disabled,true);
 const updated={...details,current:{paymentTerms:null,paymentDueDate:null,sequence:3,recordedAt:"2026-11-10T12:00:00.000Z"}};
 const nextNode=descendants(PaymentTermHistory({details:updated,actorId,locale:"en",page:0})).find(element=>element.type===form.PaymentTermAmendmentForm);
 assert.notEqual(oldNode.key,nextNode.key);
 const refreshed=harness(nextNode.props,storage);assert.equal(elements(refreshed.render(),"fieldset")[0].props.disabled,true);
 refreshed.button("Retry exact saved request").props.onClick();assert.deepEqual(JSON.parse(refreshed.calls[0].options.body),saved);
 assert.equal(JSON.parse(refreshed.calls[0].options.body).expectedSequence,0);
 await refreshed.respond(0,200,{change:savedChange(saved),replayed:true});assert.equal(storage.has(key),false);assert.equal(refreshed.reloads,1);
});


test("retained-history limit disables new submissions but preserves exact pending replay",async()=>{
 for(const locale of ["en","ar"]){
  const h=harness({...baseProps,sequence:1000,locale});
  assert.equal(elements(h.render(),"fieldset")[0].props.disabled,true);h.prepare();h.submit();assert.equal(h.calls.length,0);
  const statuses=elements(h.render(),"p").filter(p=>p.props.role==="status").map(p=>p.props.children).join(" ");
  assert.match(statuses,locale==="en"?/retained-history limit of 1,000/:/حد السجل المحفوظ البالغ ١٠٠٠/);
 }
 const saved={...request(),expectedSequence:999},storage=new Map([[key,envelope(saved)]]);
 const pending=harness({...baseProps,sequence:1000},storage);
 assert.equal(elements(pending.render(),"fieldset")[0].props.disabled,true);
 const retry=pending.button("Retry exact saved request");assert.equal(retry.props.disabled,false);retry.props.onClick();
 assert.deepEqual(JSON.parse(pending.calls[0].options.body),saved);
 await pending.respond(0,200,{change:savedChange(saved),replayed:true});assert.equal(storage.has(key),false);assert.equal(pending.reloads,1);
 const available=harness({...baseProps,sequence:999});assert.equal(elements(available.render(),"fieldset")[0].props.disabled,false);
});
