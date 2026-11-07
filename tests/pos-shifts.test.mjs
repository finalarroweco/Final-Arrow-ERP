import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {PrismaClient} from "@prisma/client";
const origin="http://127.0.0.1:3235";
async function call(path,method="GET",body,cookie){const r=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{throw new Error(method+" "+path+": "+r.status+" "+text.slice(0,200));}return{status:r.status,data,cookie:r.headers.get("set-cookie")?.split(";")[0]};}
test("cash shifts freeze exact physical movements, source events, retries and closure races",{timeout:90000},async()=>{
 const db=new PrismaClient(),server=spawn("./node_modules/.bin/next",["start","-p","3235"],{env:{...process.env,ALLOW_REGISTRATION:"true"},stdio:["ignore","ignore","inherit"]});
 try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  async function owner(){const id=randomUUID().slice(0,8),r=await call("/api/auth/register","POST",{name:"Shift QA",email:"shift-"+id+"@example.invalid",password:"Shift-test-password-2026",organization:"Shift QA",slug:"shift-"+id});assert.equal(r.status,201);return r;}
  const actor=await owner(),outsider=await owner(),tenantId=actor.data.tenantId,cookie=actor.cookie;
  const create=async(path,body)=>{const r=await call(path,"POST",{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const {company}=await create("/api/companies",{name:"Shift company",code:"SHIFT",baseCurrency:"OMR"}),companyId=company.id,{branch}=await create("/api/branches",{companyId,name:"Main",code:"MAIN"}),{branch:other}=await create("/api/branches",{companyId,name:"Other",code:"OTHER"}),scope={tenantId,companyId,branchId:branch.id},query=new URLSearchParams(scope),path="/api/pos/shifts";
  const account=async(code,type)=>(await create("/api/ledger/accounts",{companyId,code,name:code,type})).account,cash=await account("1010","ASSET"),revenue=await account("4000","REVENUE");
  const {item}=await create("/api/pos/items",{companyId,branchId:branch.id,code:"MEAL",name:"Meal",category:"Food",price:"2.500"});
  async function member(name,permissions,branchId=branch.id){const {role}=await create("/api/roles",{name,permissions}),email="shift-"+randomUUID().slice(0,8)+"@example.invalid",invite=await create("/api/invitations",{email,roleId:role.id,scope:{type:"BRANCH",companyId,branchId}}),r=await call("/api/invitations/accept","POST",{token:invite.path.split("/").at(-1),name,password:"Shift-member-password-2026"});assert.equal(r.status,200);return{cookie:r.cookie,id:(await db.user.findUnique({where:{email}})).id};}
  const cashier=await member("Cashier",["company:read","branch:read","pos:read","pos:manage"]),reader=await member("Shift reader",["company:read","branch:read","pos:read"]),wrong=await member("Other shift",["company:read","branch:read","pos:read","pos:manage"],other.id);
  assert.equal((await call(path+"?"+query,"GET",undefined,cookie)).data.shifts.length,0);
  const opening={...scope,action:"open",requestId:randomUUID(),number:"DAY-01",openingCash:"10.000"};
  assert.equal((await call(path,"POST",opening)).status,401);assert.equal((await call(path,"POST",opening,outsider.cookie)).status,403);assert.equal((await call(path,"POST",opening,reader.cookie)).status,403);assert.equal((await call(path,"POST",opening,wrong.cookie)).status,403);
  const opened=await Promise.all([call(path,"POST",opening,cookie),call(path,"POST",opening,cookie)]);assert.deepEqual(opened.map(r=>r.status),[201,201]);assert.deepEqual(opened.map(r=>r.data.replayed).sort(),[false,true]);const shift=opened[0].data.shift;
  assert.equal((await call(path,"POST",{...opening,requestId:randomUUID()},cookie)).status,409);assert.equal((await call(path,"POST",{...opening,openingCash:"11"},cookie)).status,409);
  const order=async(number,quantity=1)=>(await create("/api/pos/orders",{companyId,branchId:branch.id,number,type:"TAKEAWAY",lines:[{itemId:item.id,quantity}]})).order;
  const cashOrder=await order("CASH",2),cardOrder=await order("CARD"),unpaid=await order("AFTER-CLOSE");
  const pay=async(o,card=false)=>call("/api/pos/orders/"+o.id,"PATCH",card?{tenantId,action:"pay-card",reference:"TERMINAL-001"}:{tenantId,action:"pay",method:"CASH",tendered:"20"},cashier.cookie);
  assert.equal((await pay(cashOrder)).status,200);assert.equal((await pay(cardOrder,true)).status,200);
  const payment=await db.posShiftEvent.findUnique({where:{orderId:cashOrder.id}});assert.equal(payment.cashDelta.toFixed(3),"5.000");assert.equal(payment.createdBy,cashier.id);assert.equal(payment.shiftId,shift.id);
  let summary=(await call(path+"?"+query,"GET",undefined,cookie)).data.shifts[0];assert.equal(summary.expectedCash,"15.000");assert.equal(summary.cashSales,"5.000");assert.equal(summary.cardSales,"2.500");
  const day=new Date().toISOString().slice(0,10),posting={tenantId,entryDate:day,debitAccountId:cash.id,creditAccountId:revenue.id};
  for(const o of [cashOrder,cardOrder])await create("/api/ledger/documents/pos/"+o.id,posting);
  const refundBase={tenantId,requestId:randomUUID(),entryDate:day,reference:"REFUND-CASH",reason:"Actual refund performed"},refunded=await create("/api/pos/orders/"+cashOrder.id+"/refunds",{...refundBase,lines:[{orderLineId:cashOrder.lines[0].id,quantity:1}]});
  await create("/api/pos/orders/"+cardOrder.id+"/refunds",{...refundBase,requestId:randomUUID(),reference:"REFUND-CARD"});
  summary=(await call(path+"?"+query,"GET",undefined,cookie)).data.shifts[0];assert.equal(summary.expectedCash,"12.500");assert.equal(summary.cashRefunds,"2.500");assert.equal(summary.cardRefunds,"2.500");
  assert.equal((await call("/api/ledger/journals/"+refunded.refund.entry.id+"/reverse","POST",{tenantId,number:"REFUND-CORRECTION",entryDate:day,reason:"Correct accounting record"},cookie)).status,201);
  assert.equal((await call(path+"?"+query,"GET",undefined,cookie)).data.shifts[0].expectedCash,"12.500","ledger reversal does not create physical cash");
  const movement={...scope,action:"move",shiftId:shift.id,requestId:randomUUID(),kind:"IN",amount:"2.500",reference:"=ACTUAL-CASH-RETURN",reason:"Physical cash returned"};
  const moves=await Promise.all([call(path,"POST",movement,cookie),call(path,"POST",movement,cookie)]);assert.deepEqual(moves.map(r=>r.status),[201,201]);assert.deepEqual(moves.map(r=>r.data.replayed).sort(),[false,true]);
  assert.equal((await call(path,"POST",{...movement,amount:"3.000"},cookie)).status,409);
  await create(path,{...movement,requestId:randomUUID(),kind:"OUT",amount:"1.000",reference:"PETTY-CASH",reason:"Actual cash paid out"});
  assert.equal((await call(path,"POST",{...movement,requestId:randomUUID(),kind:"OUT",amount:"99.000"},cookie)).status,409);
  summary=(await call(path+"?"+query,"GET",undefined,cookie)).data.shifts[0];assert.equal(summary.expectedCash,"14.000");assert.equal(summary.cashIn,"2.500");assert.equal(summary.cashOut,"1.000");assert.equal(summary.eventCount,6);
  await assert.rejects(db.posShiftEvent.update({where:{id:payment.id},data:{amount:"8"}}));await assert.rejects(db.posShiftEvent.delete({where:{id:payment.id}}));
  await assert.rejects(db.posShiftEvent.create({data:{id:randomUUID(),shiftId:shift.id,kind:"IN",amount:"1",cashDelta:"1",reference:"MISSING-AUDIT",reason:"Direct event",createdBy:cashier.id}}));
  await assert.rejects(db.posShiftEvent.create({data:{id:randomUUID(),shiftId:shift.id,kind:"PAYMENT",orderId:unpaid.id,amount:"2.5",cashDelta:"2.5",reference:"FORGED",reason:"Forged source",createdBy:cashier.id}}));
  await assert.rejects(db.posShift.update({where:{id:shift.id},data:{closedAt:new Date(),closedBy:cashier.id,expectedCash:"14",countedCash:null,difference:null,closeReason:"Invalid closure"}}));
  const close={...scope,action:"close",shiftId:shift.id,countedCash:"13.000",reason:""};
  assert.equal((await call(path,"POST",close,cookie)).status,409);const finalClose={...close,reason:"Counted one rial short"},closed=await call(path,"POST",finalClose,cookie);assert.equal(closed.status,201,JSON.stringify(closed.data));assert.equal(Number(closed.data.shift.expectedCash),14);assert.equal(Number(closed.data.shift.difference),-1);assert.equal((await call(path,"POST",finalClose,cookie)).data.replayed,true);assert.equal((await call(path,"POST",{...finalClose,countedCash:"14"},cookie)).status,409);
  assert.equal((await pay(unpaid)).status,409);assert.equal((await db.posOrder.findUnique({where:{id:unpaid.id}})).status,"OPEN");
  assert.equal((await call("/api/pos/orders/"+cashOrder.id+"/refunds","POST",{...refundBase,requestId:randomUUID()},cookie)).status,409);
  assert.equal((await call(path,"POST",{...movement,requestId:randomUUID()},cookie)).status,409);
  await assert.rejects(db.posShift.update({where:{id:shift.id},data:{closeReason:"Rewritten"}}));await assert.rejects(db.posShift.delete({where:{id:shift.id}}));
  const exportPath=path+"?"+new URLSearchParams({...scope,shiftId:shift.id,format:"csv"}),csv=await fetch(origin+exportPath,{headers:{Cookie:cookie}});assert.equal(csv.status,200);const csvText=await csv.text();assert.match(csvText,/'=ACTUAL-CASH-RETURN/);assert.match(csvText,/"14.000","13.000","'-1.000"/);assert.match(csvText,/"20.000","15.000"/);assert.equal((await call(path+"?"+query,"GET",undefined,reader.cookie)).status,200);assert.equal((await call(path+"?"+query,"GET",undefined,wrong.cookie)).status,403);
  const next=await create(path,{...opening,requestId:randomUUID(),number:"DAY-02",openingCash:"20.000"}),nextId=next.shift.id;
  const laterRefund=await create("/api/pos/orders/"+cashOrder.id+"/refunds",{...refundBase,requestId:randomUUID(),reference:"NEXT-SHIFT-REFUND"});assert.equal((await db.posShiftEvent.findUnique({where:{refundId:laterRefund.refund.id}})).shiftId,nextId);
  const race=await Promise.all([call(path,"POST",{...scope,action:"close",shiftId:nextId,countedCash:"15",reason:"Count checked at closure"},cookie),pay(unpaid)]);
  assert.equal(race[0].status,201);assert.ok([200,409].includes(race[1].status));const finalRow=await db.posShift.findUnique({where:{id:nextId}});assert.equal(finalRow.expectedCash.toFixed(3),race[1].status===200?"17.500":"15.000");assert.equal((await db.posShift.findUnique({where:{id:shift.id}})).expectedCash.toFixed(3),"14.000");
  assert.equal((await db.$queryRaw`SELECT count(*)::int n FROM pg_class WHERE relname IN('PosShift','PosShiftEvent') AND relrowsecurity`)[0].n,2);
  const html=await fetch(origin+"/pos",{headers:{Cookie:cookie}});assert.equal(html.status,200);assert.match(await html.text(),/Cash drawer shifts/);
 }finally{server.kill("SIGTERM");await db.$disconnect();}
});
