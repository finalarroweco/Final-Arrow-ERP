import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {reservationRequest,pendingReservation} from "../src/lib/stock-reservation-input.ts";
test("reservation retry retains exact actor/scope/payload and rejects corrupt or foreign storage",()=>{
 const scope={tenantId:randomUUID(),companyId:randomUUID(),branchId:randomUUID()},actorId=randomUUID(),request={...scope,action:"reserve",requestId:randomUUID(),itemId:randomUUID(),quantity:"999999999.999",reference:"Reference"},saved={version:1,actorId,request};
 assert.deepEqual(pendingReservation(saved,actorId,scope),request);assert.equal(pendingReservation(saved,randomUUID(),scope),null);assert.equal(pendingReservation(saved,actorId,{...scope,branchId:randomUUID()}),null);assert.equal(pendingReservation({...saved,version:2},actorId,scope),null);
 for(const quantity of ["0","-1","1e3","0.0001","1000000000","1.0000"])assert.equal(reservationRequest.safeParse({...request,quantity}).success,false);
 assert.equal(reservationRequest.safeParse({...request,reference:"xx"}).success,false);assert.equal(reservationRequest.safeParse({...request,extra:true}).success,false);
 const release={...scope,action:"release",requestId:randomUUID(),reservationId:randomUUID(),reason:"Release reason"};assert.deepEqual(pendingReservation({...saved,request:release},actorId,scope),release);
});
