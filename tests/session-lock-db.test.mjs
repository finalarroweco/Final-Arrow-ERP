import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {lockedSessionActive} from '../src/lib/session-lock.ts';
const db=new PrismaClient(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));test.after(()=>db.$disconnect());
test('shared identity lock evaluates expiry after unchanged-row waits for both session ID and token hash',{timeout:40000},async()=>{
 const user=await db.user.create({data:{name:'Session clock fixture',email:randomUUID()+'@example.invalid',passwordHash:'not-login'}});
 for(const lookup of ['id','tokenHash'])for(const expires of [true,false]){
  const session=await db.session.create({data:{userId:user.id,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+(expires?4000:3600000))}});
  let release,signal,pidReady;const gate=new Promise(r=>release=r),acquired=new Promise(r=>signal=r),readerPid=new Promise(r=>pidReady=r);
  const holding=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${session.id}::uuid FOR UPDATE`;signal();await gate;},{timeout:15000});await acquired;
  try{const reading=db.$transaction(async tx=>{const [row]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;pidReady(row.pid);return lockedSessionActive(tx,user.id,{[lookup]:session[lookup]});},{timeout:15000});const pid=await readerPid;
   let waited=false;for(let n=0;n<100;n++){const rows=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`;if(rows.length){waited=true;break;}await pause(25);}assert.ok(waited,lookup+' actually waited');await pause(expires?4500:50);release();await holding;assert.equal(await reading,!expires,lookup+' checks current post-lock clock');
  }finally{release();await holding;}
 }
});
test('shared lock is actor-bound and uses persisted UTC expiry under non-UTC database time zones',async()=>{
 const user=await db.user.create({data:{name:'Session UTC fixture',email:randomUUID()+'@example.invalid',passwordHash:'not-login'}}),fresh=await db.session.create({data:{userId:user.id,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}}),expired=await db.session.create({data:{userId:user.id,tokenHash:randomUUID(),expiresAt:new Date(Date.now()-60000)}});
 for(const zone of ['Pacific/Honolulu','Asia/Muscat'])await db.$transaction(async tx=>{await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${zone}'`);assert.equal(await lockedSessionActive(tx,user.id,{id:fresh.id}),true);assert.equal(await lockedSessionActive(tx,user.id,{tokenHash:expired.tokenHash}),false);assert.equal(await lockedSessionActive(tx,randomUUID(),{id:fresh.id}),false);});
});
