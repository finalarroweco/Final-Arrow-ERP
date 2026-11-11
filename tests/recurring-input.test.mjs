import test from 'node:test';
import assert from 'node:assert/strict';
import {recurringRequest,recurringPreviewRequest,pendingRecurringRequest,canonicalRecurringRequest} from '../src/lib/recurring-input.ts';
const scope={tenantId:'11111111-1111-4111-8111-111111111111',companyId:'22222222-2222-4222-8222-222222222222',branchId:null};
const actor='33333333-3333-4333-8333-333333333333';
const plan={...scope,expectedActorId:actor,requestId:'44444444-4444-4444-8444-444444444444',action:'plan',planId:'55555555-5555-4555-8555-555555555555',expectedVersion:0,label:'Explicit service',currency:'OMR',lines:[{description:'Service',quantity:2,unitPrice:'123.450',treatment:'STANDARD'}],archived:false,reason:'Operator-defined plan'};
test('canonical billing request preserves decimal strings and explicit tax treatment',()=>{
 assert.deepEqual(recurringRequest.parse(plan),plan);
 assert.equal(JSON.stringify(canonicalRecurringRequest({...plan,lines:[{treatment:'STANDARD',unitPrice:'123.450',quantity:2,description:'Service'}]})),JSON.stringify(canonicalRecurringRequest(plan)));
 for(const changed of [{currency:'omr'},{unknown:1},{lines:[{...plan.lines[0],unitPrice:123.45}]},{lines:[{...plan.lines[0],treatment:undefined}]},{reason:'\u0000'}])assert.equal(recurringRequest.safeParse({...plan,...changed}).success,false);
});
test('durable pending requests are actor and exact-scope bound',()=>{
 const pending={version:1,actorId:actor,request:plan};assert.deepEqual(pendingRecurringRequest(pending,actor,scope),plan);
 assert.equal(pendingRecurringRequest(pending,plan.planId,scope),null);
 assert.equal(pendingRecurringRequest(pending,actor,{...scope,companyId:plan.planId}),null);
 assert.equal(pendingRecurringRequest({...pending,version:2},actor,scope),null);
 assert.equal(pendingRecurringRequest({...pending,request:{...plan,expectedActorId:plan.planId}},actor,scope),null);
});
test('correction requires both original source and explicit replacement price revision',()=>{
 const generate={...scope,expectedActorId:actor,requestId:plan.requestId,reason:'Generate configured period',action:'generate',subscriptionId:plan.planId,expectedVersion:1,periodIndex:0,previewHash:'a'.repeat(64),replacesSourceId:null,replacementPlanRevisionId:null};
 assert.equal(recurringRequest.safeParse(generate).success,true);
 assert.equal(recurringRequest.safeParse({...generate,action:'replace'}).success,false);
 assert.equal(recurringRequest.safeParse({...generate,action:'replace',replacesSourceId:plan.requestId,replacementPlanRevisionId:plan.planId}).success,true);
 assert.equal(recurringRequest.safeParse({...generate,replacementPlanRevisionId:plan.planId}).success,false);
 const preview={...scope,expectedActorId:actor,subscriptionId:plan.planId,offset:0,limit:50,backfill:false,replacesSourceId:null,replacementPlanRevisionId:null};
 assert.equal(recurringPreviewRequest.safeParse(preview).success,true);assert.equal(recurringPreviewRequest.safeParse({...preview,limit:51}).success,false);
});
