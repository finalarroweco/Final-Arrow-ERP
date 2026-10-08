import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
const origin='http://127.0.0.1:3228';
async function call(path,method='GET',body,cookie){const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],cache:r.headers.get('cache-control')};}
test('account recovery codes are private, replaceable, single-use and revoke credentials atomically',{timeout:90000},async()=>{
 const db=new PrismaClient(),server=spawn('./node_modules/.bin/next',['start','-p','3228'],{env:{...process.env,ALLOW_REGISTRATION:'true'},stdio:['ignore','ignore','inherit']});
 try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  const password='Recovery-old-password-2026',nextPassword='Recovery-new-password-2026',email=`recovery-${randomUUID().slice(0,8)}@example.invalid`;
  const owner=await call('/api/auth/register','POST',{name:'Recovery QA',email,password,organization:'Recovery QA',slug:`recovery-${randomUUID().slice(0,8)}`});assert.equal(owner.status,201);const cookie=owner.cookie,user=await db.user.findUnique({where:{email}}),tenantId=owner.data.tenantId;
  const codesPath='/api/auth/recovery/codes',resetPath='/api/auth/recovery/reset';
  assert.equal((await call(codesPath)).status,401);assert.equal((await call(codesPath,'POST',{currentPassword:password})).status,401);assert.equal((await call(codesPath,'POST',{currentPassword:'wrong'},cookie)).status,403);assert.equal((await call(codesPath,'GET',undefined,cookie)).data.count,0);
  const first=await call(codesPath,'POST',{currentPassword:password},cookie);assert.equal(first.status,201);assert.equal(first.cache,'no-store');assert.equal(first.data.codes.length,10);assert.equal(new Set(first.data.codes).size,10);assert.ok(first.data.codes.every(c=>/^(?:[a-f0-9]{4}-){7}[a-f0-9]{4}$/.test(c)));
  const stored=await db.recoveryCode.findMany({where:{userId:user.id}});assert.equal(stored.length,10);assert.ok(stored.every(c=>/^[a-f0-9]{64}$/.test(c.codeHash)));assert.ok(stored.every(c=>!first.data.codes.includes(c.codeHash)));assert.ok(stored.some(c=>c.codeHash===createHash('sha256').update('erp-recovery:'+first.data.codes[0].replaceAll('-','')).digest('hex')));
  assert.deepEqual((await call(codesPath,'GET',undefined,cookie)).data,{count:10});
  for(const body of [{email,code:'invalid',newPassword:nextPassword},{email:'unknown@example.invalid',code:first.data.codes[0],newPassword:nextPassword},{email,code:first.data.codes[0],newPassword:password}])assert.equal((await call(resetPath,'POST',body)).status,403);
  const second=await call(codesPath,'POST',{currentPassword:password},cookie);assert.equal(second.status,201);assert.equal(await db.recoveryCode.count({where:{userId:user.id}}),10);assert.equal((await call(resetPath,'POST',{email,code:first.data.codes[0],newPassword:nextPassword})).status,403);
  const secondSession=await call('/api/auth/login','POST',{email,password});assert.equal(secondSession.status,200);
  const racing=await Promise.all([call(resetPath,'POST',{email:email.toUpperCase(),code:second.data.codes[0].toUpperCase(),newPassword:nextPassword}),call(resetPath,'POST',{email,code:second.data.codes[1],newPassword:nextPassword})]);assert.deepEqual(racing.map(r=>r.status).sort(),[200,403]);
  assert.equal(await db.recoveryCode.count({where:{userId:user.id}}),0);assert.equal(await db.session.count({where:{userId:user.id}}),0);for(const c of [cookie,secondSession.cookie])assert.equal((await call(codesPath,'GET',undefined,c)).status,401);
  assert.equal((await call('/api/auth/login','POST',{email,password})).status,401);const login=await call('/api/auth/login','POST',{email,password:nextPassword});assert.equal(login.status,200);
  assert.equal((await call(resetPath,'POST',{email,code:second.data.codes[0],newPassword:'Another-recovery-password-2026'})).status,429,'sixth attempt is throttled even after successful recovery');
  const generated=await call(codesPath,'POST',{currentPassword:nextPassword},login.cookie);assert.equal(generated.status,201);
  const changed=await call('/api/auth/password','POST',{currentPassword:nextPassword,newPassword:'Changed-with-current-password-2026'},login.cookie);assert.equal(changed.status,200);assert.equal(await db.recoveryCode.count({where:{userId:user.id}}),0);assert.equal(await db.session.count({where:{userId:user.id}}),0);
  const logs=await db.auditLog.findMany({where:{tenantId,action:{in:['account.recovered','account.recovery-codes.replaced']}}});assert.equal(logs.filter(l=>l.action==='account.recovered').length,1);assert.equal(logs.filter(l=>l.action==='account.recovery-codes.replaced').length,3);for(const code of [...first.data.codes,...second.data.codes,...generated.data.codes])assert.ok(!JSON.stringify(logs).includes(code));
  for(const path of ['/recover','/login']){const r=await fetch(origin+path);assert.equal(r.status,200);assert.match(await r.text(),/Recovery|recovery|recover|استعادة/);}
  const unknown=`throttle-${randomUUID()}@example.invalid`;for(let i=0;i<5;i++)assert.equal((await call(resetPath,'POST',{email:unknown,code:second.data.codes[0],newPassword:nextPassword})).status,403);assert.equal((await call(resetPath,'POST',{email:unknown,code:second.data.codes[0],newPassword:nextPassword})).status,429);
  await assert.rejects(db.recoveryCode.create({data:{userId:user.id,codeHash:'plaintext'}}));
 }finally{server.kill('SIGTERM');await db.$disconnect();}
});
