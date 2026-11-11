import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PrismaClient} from '@prisma/client';
const compiled={exports:{}};
new Function('require','module','exports',ts.transpileModule(readFileSync('src/lib/internal-text-document-input.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(createRequire(import.meta.url),compiled,compiled.exports);
const {documentResponseMatches,documentCancellationMatches}=compiled.exports;
const port=3301,origin=`http://127.0.0.1:${port}`,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(path,method='GET',body,cookie,headers={}){
 const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 return {status:response.status,data,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
test('internal text documents are scoped, immutable, versioned and exactly recoverable',{timeout:240000},async()=>{
 const db=new PrismaClient(),url=new URL(process.env.DATABASE_URL);url.searchParams.set('connection_limit',process.env.INTERNAL_TEXT_DOCUMENT_POOL_LIMIT??'8');
 const server=spawn('./node_modules/.bin/next',['start','-H','127.0.0.1','-p',String(port)],{env:{...process.env,DATABASE_URL:url.toString(),ALLOW_REGISTRATION:'true'},stdio:['ignore','ignore','inherit']});
 try{
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await pause(250);}assert.ok(ready,'Next server ready');
  async function register(label){const suffix=randomUUID().slice(0,8),r=await call('/api/auth/register','POST',{name:label,email:`text-doc-${suffix}@example.invalid`,password:'Text-doc-password-2026',organization:label,slug:`text-doc-${suffix}`});assert.equal(r.status,201,JSON.stringify(r));const actorId=(await db.membership.findFirstOrThrow({where:{tenantId:r.data.tenantId}})).userId;return {tenantId:r.data.tenantId,cookie:r.cookie,actorId};}
  const owner=await register('Text document owner'),{tenantId,cookie,actorId}=owner;
  const builtInRoles=await db.role.findMany({where:{tenantId,name:{in:['Owner','Manager','Viewer']}},include:{permissions:true}});
  assert.equal(builtInRoles.length,3);
  for(const role of builtInRoles){const documentPermissions=role.permissions.map(p=>p.permissionKey).filter(p=>p.startsWith('document:')).sort();assert.deepEqual(documentPermissions,role.name==='Owner'?['document:approve','document:manage','document:read']:[],role.name+' document permissions remain opt-in');}
  const create=async(path,body)=>{const r=await call(path,'POST',{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r));return r.data;};
  const {company}=await create('/api/companies',{name:'Document company',code:'DOC',baseCurrency:'OMR'}),companyId=company.id;
  const {company:otherCompany}=await create('/api/companies',{name:'Other document company',code:'DOC2',baseCurrency:'OMR'});
  const {branch}=await create('/api/branches',{companyId,name:'Document branch',code:'TEXT'}),{branch:sibling}=await create('/api/branches',{companyId,name:'Sibling document branch',code:'SIB'});
  const endpoint='/api/documents',scope={tenantId,companyId,branchId:branch.id};
  const fresh=(patch={})=>({...scope,expectedActorId:actorId,requestId:randomUUID(),documentId:randomUUID(),expectedVersion:0,action:'create',title:'=Private Arabic reference',body:'تعليمات داخلية\nEnglish line\n<script>window.secret = true</script>\nhttps://example.invalid/no-autolink\n👩🏽‍💻',reason:'Explicit initial text',...patch});
  const post=(payload,c=cookie)=>call(endpoint,'POST',payload,c),resolve=(payload,c=cookie)=>call(endpoint+'/resolve','POST',payload,c);
  const query=(patch={})=>'?'+new URLSearchParams({tenantId,companyId,...patch});
  const detail=(id,patch={})=>endpoint+'/'+id+query(patch);
  const exportPath=(id,eventId,patch={})=>endpoint+'/'+id+'/export'+query({eventId,...patch});
  const printPath=(id,eventId,patch={})=>'/documents/'+id+'/print'+query({eventId,...patch});
  async function invite(permissions,name,type='BRANCH',targetBranch=branch.id){
   const {role}=await create('/api/roles',{name,permissions});
   const invitation=await create('/api/invitations',{email:`text-doc-${randomUUID().slice(0,8)}@example.invalid`,roleId:role.id,scope:{type,companyId,...(type==='BRANCH'?{branchId:targetBranch}:{})}});
   const r=await call('/api/invitations/accept','POST',{token:invitation.path.split('/').at(-1),name,password:'Text-doc-member-2026'});assert.equal(r.status,200,JSON.stringify(r));
   const user=await db.user.findFirstOrThrow({where:{name,memberships:{some:{tenantId}}}});return {id:user.id,cookie:r.cookie,roleId:role.id};
  }
  const reader=await invite(['document:read'],'Text branch reader'),manager=await invite(['document:read','document:manage'],'Text branch manager'),companyReader=await invite(['document:read'],'Text company reader','COMPANY'),unrelated=await invite(['customer:read'],'Text unrelated reader');
  const initial=fresh();assert.equal((await post(initial)).status,201);
  // Unauthenticated calls are deliberately separate from the default-cookie helper.
  assert.equal((await call(endpoint,'POST',fresh())).status,401);
  assert.equal((await call(endpoint+query())).status,401);
  assert.equal((await post(fresh({expectedActorId:reader.id}),reader.cookie)).status,403);
  assert.equal((await post(fresh(),manager.cookie)).status,403,'actor guard blocks another actor recovery');
  assert.equal((await resolve(initial,manager.cookie)).status,403);
  const csrf=await post(fresh());assert.equal(csrf.status,201);
  assert.equal((await call(endpoint,'POST',fresh(),cookie,{Origin:'https://evil.invalid'})).status,403);
  for(const patch of [{title:''},{title:'x'.repeat(201)},{body:'😀'.repeat(16385)},{reason:''},{reason:'x'.repeat(301)},{expectedVersion:-1},{title:'bad\u0000title'},{body:'bad\u0000body'},{createdAt:'2000-01-01'},{branchId:randomUUID()}]){
   const r=await post(fresh(patch));assert.ok([400,403,404,409].includes(r.status),JSON.stringify({patch,status:r.status}));
  }
  const duplicates=await Promise.all([post(initial),post(initial)]);assert.ok(duplicates.every(r=>r.status===201),JSON.stringify(duplicates));
  const original=duplicates[0].data.event;assert.ok(documentResponseMatches(initial,original));assert.deepEqual(duplicates[1].data.event,original);assert.notEqual(original.id,initial.requestId);assert.notEqual(original.id,initial.documentId);
  const loaded=await call(detail(initial.documentId),'GET',undefined,cookie);assert.equal(loaded.status,200);assert.equal(loaded.data.document.body,initial.body);assert.equal(loaded.data.events.length,1);assert.equal(loaded.data.canManage,true);
  assert.equal((await call(detail(initial.documentId),'GET',undefined,reader.cookie)).data.canManage,false);
  const exported=await call(exportPath(initial.documentId,original.id),'GET',undefined,reader.cookie);assert.equal(exported.status,200);assert.match(exported.headers.get('content-type'),/^text\/plain/);assert.match(exported.headers.get('content-disposition'),/^attachment;/);assert.equal(exported.headers.get('x-content-type-options'),'nosniff');assert.ok(exported.data.includes(initial.body),'complete literal selected revision');
  const printed=await call(printPath(initial.documentId,original.id),'GET',undefined,reader.cookie);assert.equal(printed.status,200);assert.ok(!printed.data.includes('<script>window.secret = true</script>'));assert.ok(printed.data.includes('&lt;script&gt;'),'plain text HTML escaping');
  // Another tab may switch the session cookie without changing the mounted workspace actor.
  const boundPaths=[endpoint+query({expectedActorId:actorId}),endpoint+query({format:'csv',expectedActorId:actorId}),detail(initial.documentId,{expectedActorId:actorId}),exportPath(initial.documentId,original.id,{expectedActorId:actorId}),printPath(initial.documentId,original.id,{expectedActorId:actorId})];
  for(const path of boundPaths){const switched=await call(path,'GET',undefined,reader.cookie);assert.ok([403,404].includes(switched.status),path);assert.ok(!JSON.stringify(switched.data).includes(initial.body));assert.ok(!JSON.stringify(switched.data).includes(initial.title));const own=await call(path,'GET',undefined,cookie);assert.equal(own.status,200,path);}
  assert.equal((await call(endpoint+query({expectedActorId:actorId}),'GET',undefined,cookie)).data.actorId,actorId);
  assert.equal((await call(detail(initial.documentId,{expectedActorId:reader.id}),'GET',undefined,reader.cookie)).data.actorId,reader.id);
  // Direct authenticated clients may omit the optional mounted-actor guard.
  assert.equal((await call(detail(initial.documentId),'GET',undefined,reader.cookie)).status,200);
  for(const path of [endpoint+query({expectedActorId:'invalid'}),detail(initial.documentId,{expectedActorId:'invalid'}),exportPath(initial.documentId,original.id,{expectedActorId:'invalid'}),endpoint+query({expectedActorId:actorId})+'&expectedActorId='+actorId])assert.equal((await call(path,'GET',undefined,cookie)).status,400,path);
  const metadata=await call(endpoint+query({format:'csv'}),'GET',undefined,cookie);assert.equal(metadata.status,200);assert.ok(metadata.data.includes("'=Private Arabic reference"));assert.ok(!metadata.data.includes(initial.body));assert.ok(!metadata.data.includes(initial.reason));
  for(const suffix of ['&page=0&page=1','&q=x&q=y','&unknown=true','&page=-1','&page=1.2','&state=DELETED','&q='+encodeURIComponent('x'.repeat(121))])assert.equal((await call(endpoint+query()+suffix,'GET',undefined,cookie)).status,400,suffix);
  for(const patch of [{title:'changed'},{body:'changed'},{reason:'changed'},{documentId:randomUUID()}])assert.equal((await post({...initial,...patch})).status,409);
  const edit={...initial,requestId:randomUUID(),action:'edit',expectedVersion:1,title:'Updated title',body:'المحتوى الثاني\nSecond full snapshot',reason:'Correct operating note'};
  const edited=await post(edit);assert.equal(edited.status,201,JSON.stringify(edited));assert.ok(documentResponseMatches(edit,edited.data.event));assert.equal(edited.data.event.version,2);
  assert.deepEqual((await post(initial)).data.event,original,'replay returns original, not current contents');assert.deepEqual((await resolve(initial)).data.event,original);
  assert.equal((await post({...edit,requestId:randomUUID()})).status,409,'new stale version rejected');
  const lifecycle=(action,version,patch={})=>({...scope,documentId:initial.documentId,requestId:randomUUID(),expectedActorId:actorId,action,expectedVersion:version,reason:'Explicit '+action,...patch});
  const archive=lifecycle('archive',2),archived=await post(archive);assert.equal(archived.status,201);assert.equal(archived.data.event.archived,true);assert.equal(archived.data.event.body,edit.body);assert.equal(archived.data.event.version,3);
  assert.ok(!(await call(endpoint+query(),'GET',undefined,cookie)).data.documents.some(d=>d.id===initial.documentId));
  assert.ok((await call(endpoint+query({state:'ARCHIVED'}),'GET',undefined,cookie)).data.documents.some(d=>d.id===initial.documentId));
  assert.equal((await call(exportPath(initial.documentId,original.id),'GET',undefined,reader.cookie)).status,200,'archive retains historical reads');
  assert.equal((await post({...edit,requestId:randomUUID(),expectedVersion:3})).status,409,'archived editing does not reactivate');
  const restore=lifecycle('restore',3),restored=await post(restore);assert.equal(restored.status,201);assert.equal(restored.data.event.archived,false);assert.equal(restored.data.event.body,edit.body);assert.equal(restored.data.event.version,4);assert.deepEqual((await post(archive)).data.event,archived.data.event);
  assert.equal((await post(lifecycle('restore',4))).status,409);assert.equal((await post(lifecycle('archive',4,{body:'implicit replacement'}))).status,400);
  const raceEdit={...edit,requestId:randomUUID(),expectedVersion:4,body:'Race winner edit'},raceArchive=lifecycle('archive',4);
  const race=await Promise.all([post(raceEdit),post(raceArchive)]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
  const racedDetail=(await call(detail(initial.documentId),'GET',undefined,cookie)).data;assert.equal(racedDetail.document.version,5);assert.equal(racedDetail.events.length,5);
  const abandoned=fresh(),cancelled=await resolve(abandoned);assert.equal(cancelled.status,200,JSON.stringify(cancelled));assert.ok(documentCancellationMatches(abandoned,cancelled.data.cancellation));assert.equal((await post(abandoned)).status,409);assert.deepEqual((await resolve(abandoned)).data,cancelled.data);assert.equal((await resolve({...abandoned,body:'different uncertain text'})).status,409);
  assert.equal((await call(detail(abandoned.documentId),'GET',undefined,cookie)).status,404);
  const uncertain=fresh(),resolutionRace=await Promise.all([post(uncertain),resolve(uncertain)]);assert.equal(resolutionRace[1].status,200);
  const resolution=resolutionRace[1].data;if(resolution.event){assert.ok(documentResponseMatches(uncertain,resolution.event));assert.equal((await post(uncertain)).status,201);}else{assert.ok(documentCancellationMatches(uncertain,resolution.cancellation));assert.equal((await post(uncertain)).status,409);}
  // Scope privacy applies before search, count, pagination, export and history.
  const privateDocs=[];
  for(const patch of [{branchId:null,title:'HIDDEN-WIDE-NOTE'},{branchId:sibling.id,title:'HIDDEN-SIBLING-NOTE'},{companyId:otherCompany.id,branchId:null,title:'HIDDEN-COMPANY-NOTE'}]){const p=fresh(patch),r=await post(p);assert.equal(r.status,201,JSON.stringify(r));privateDocs.push({p,event:r.data.event});}
  for(const {p,event} of privateDocs){
   const narrowed={tenantId,companyId:p.companyId};
   for(const path of [endpoint+'/'+p.documentId+'?'+new URLSearchParams(narrowed),exportPath(p.documentId,event.id,{companyId:p.companyId}),printPath(p.documentId,event.id,{companyId:p.companyId})]){const r=await call(path,'GET',undefined,reader.cookie);assert.ok([403,404].includes(r.status),path);assert.ok(!JSON.stringify(r.data).includes(p.title));}
   const altered={...p,expectedActorId:manager.id};assert.equal((await post(altered,manager.cookie)).status,403);assert.equal((await resolve(altered,manager.cookie)).status,403);
  }
  for(const title of ['HIDDEN-WIDE-NOTE','HIDDEN-SIBLING-NOTE']){const r=await call(endpoint+query({q:title,state:'ALL'}),'GET',undefined,reader.cookie);assert.equal(r.status,200);assert.equal(r.data.documents.length,0);assert.equal(r.data.nextPage,null);}
  const ownList=await call(endpoint+query({state:'ALL'}),'GET',undefined,reader.cookie);assert.equal(ownList.status,200);assert.ok(ownList.data.documents.every(d=>d.branchId===branch.id));assert.ok(ownList.data.documents.every(d=>!Object.hasOwn(d,'body')));
  const companyWide=privateDocs[0];assert.equal((await call(detail(companyWide.p.documentId),'GET',undefined,companyReader.cookie)).status,200);
  // Existing built-in operational roles do not silently gain this private library.
  for(const role of builtInRoles.filter(r=>r.name!=='Owner')){
   const invitation=await create('/api/invitations',{email:`text-doc-builtin-${randomUUID().slice(0,8)}@example.invalid`,roleId:role.id,scope:{type:'COMPANY',companyId}});
   const accepted=await call('/api/invitations/accept','POST',{token:invitation.path.split('/').at(-1),name:'Document built-in '+role.name,password:'Text-doc-member-2026'});assert.equal(accepted.status,200,JSON.stringify(accepted));
   for(const path of [endpoint+query({branchId:'company'}),detail(companyWide.p.documentId),exportPath(companyWide.p.documentId,companyWide.event.id),printPath(companyWide.p.documentId,companyWide.event.id)]){
    const denied=await call(path,'GET',undefined,accepted.cookie);assert.ok([403,404].includes(denied.status),role.name+' '+path);assert.ok(!JSON.stringify(denied.data).includes(companyWide.p.title));
   }
  }

  assert.equal((await call(endpoint+query(),'GET',undefined,unrelated.cookie)).status,403);
  const outsider=await register('Other tenant document owner');
  for(const path of [endpoint+query(),detail(initial.documentId),exportPath(initial.documentId,original.id),printPath(initial.documentId,original.id)]){const r=await call(path,'GET',undefined,outsider.cookie);assert.ok([403,404].includes(r.status),path);assert.ok(!JSON.stringify(r.data).includes(initial.title));}
  assert.equal((await post({...initial,expectedActorId:outsider.actorId},outsider.cookie)).status,403);
  const foreign=fresh({tenantId:outsider.tenantId,expectedActorId:outsider.actorId});assert.ok([403,404,409].includes((await post(foreign,outsider.cookie)).status));
  assert.equal((await call(exportPath(initial.documentId,companyWide.event.id),'GET',undefined,cookie)).status,404,'event cannot be exported through another document');
  for(const entity of ['InternalTextDocument','InternalTextDocumentEvent','InternalTextDocumentRequest']){const audit=await call('/api/audit?'+new URLSearchParams({tenantId,entity}),'GET',undefined,cookie);assert.equal(audit.status,200);assert.equal(audit.data.entries.length,0);const csv=await call('/api/audit?'+new URLSearchParams({tenantId,entity,format:'csv'}),'GET',undefined,cookie);if(csv.status===200)for(const secret of [initial.documentId,initial.requestId,initial.title,initial.body])assert.ok(!JSON.stringify(csv.data).includes(secret));}
  // A removed read right also removes manage, retries, resolution and old revisions.
  const managed=fresh({expectedActorId:manager.id}),managedResult=await post(managed,manager.cookie);assert.equal(managedResult.status,201);
  await db.rolePermission.delete({where:{tenantId_roleId_permissionKey:{tenantId,roleId:manager.roleId,permissionKey:'document:read'}}});
  assert.equal((await post(managed,manager.cookie)).status,403);assert.equal((await resolve(managed,manager.cookie)).status,403);
  for(const path of [endpoint+query(),detail(managed.documentId),exportPath(managed.documentId,managedResult.data.event.id),printPath(managed.documentId,managedResult.data.event.id)])assert.ok([403,404].includes((await call(path,'GET',undefined,manager.cookie)).status),path);
  // UTF-8 payload limits are independent of JSON's escaped wire representation.
  const controls=fresh({title:'Complete control-character text',body:'\u0001'.repeat(65536)});
  assert.ok(Buffer.byteLength(JSON.stringify(controls),'utf8')>100000);
  const controlsSaved=await post(controls);assert.equal(controlsSaved.status,201,JSON.stringify(controlsSaved));assert.ok(documentResponseMatches(controls,controlsSaved.data.event));
  assert.deepEqual((await post(controls)).data.event,controlsSaved.data.event);
  const controlsResolved=await resolve(controls);assert.equal(controlsResolved.status,200);assert.deepEqual(controlsResolved.data.event,controlsSaved.data.event);
  const controlsExport=await call(exportPath(controls.documentId,controlsSaved.data.event.id),'GET',undefined,cookie);assert.equal(controlsExport.status,200);assert.ok(controlsExport.data.includes(controls.body),'all 65,536 control bytes survive selected revision export');
  const oversizedWire=await fetch(origin+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:' '.repeat(420001)+JSON.stringify(fresh())});assert.equal(oversizedWire.status,413,'bounded JSON reader rejects oversized whitespace-padded request');
  // History is paginated rather than capped over the lifetime of a document.
  const longHistory=fresh({title:'Paginated revision history',body:'أ'.repeat(32768)}),longFirst=await post(longHistory);assert.equal(longFirst.status,201,'exact 64 KiB UTF-8 body accepted');
  for(let version=1;version<=51;version++){
   const next={...longHistory,action:'edit',requestId:randomUUID(),expectedVersion:version,title:'Paginated revision history',body:'Revision '+(version+1),reason:'Explicit history pagination fixture'};
   assert.equal((await post(next)).status,201,'revision '+(version+1));
  }
  const firstHistory=(await call(detail(longHistory.documentId),'GET',undefined,cookie)).data;
  assert.equal(firstHistory.document.version,52);assert.equal(firstHistory.events.length,50);assert.equal(firstHistory.nextPage,1);
  const secondHistory=(await call(detail(longHistory.documentId,{page:'1'}),'GET',undefined,cookie)).data;
  assert.equal(secondHistory.events.length,2);assert.equal(secondHistory.nextPage,null);
  assert.equal(new Set([...firstHistory.events,...secondHistory.events].map(e=>e.id)).size,52);
  const oldText=await call(exportPath(longHistory.documentId,longFirst.data.event.id),'GET',undefined,cookie);assert.equal(oldText.status,200);assert.ok(oldText.data.includes(longHistory.body),'old full 64 KiB snapshot remains downloadable');
  for(const path of [detail(initial.documentId)+'&page=0&page=1',detail(initial.documentId)+'&unknown=1',exportPath(initial.documentId,original.id)+'&eventId='+original.id,exportPath(initial.documentId,original.id)+'&unknown=1'])assert.equal((await call(path,'GET',undefined,cookie)).status,400,path);
  const page=await call('/documents','GET',undefined,cookie);assert.equal(page.status,200);assert.match(page.data,/Internal text documents|المستندات النصية/);
 }finally{server.kill('SIGTERM');await db.$disconnect();}
});
