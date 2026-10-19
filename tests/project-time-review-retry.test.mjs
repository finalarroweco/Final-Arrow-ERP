import assert from "node:assert/strict";
import test from "node:test";
import {decodeTimeReviewRetry} from "../src/lib/project-time-review-input.ts";
const tenantId="00000000-0000-4000-8000-000000000001",projectId="00000000-0000-4000-8000-000000000002",entryId="00000000-0000-4000-8000-000000000003",requestId="00000000-0000-4000-8000-000000000004",payload={tenantId,entryId,requestId,expectedSequence:2,state:"PENDING",reason:"Reset for correction"},encode=payload=>JSON.stringify({version:1,projectId,payload});
test("time review retry restores exact decision and rejects stale/foreign cache shapes",()=>{
 assert.deepEqual(decodeTimeReviewRetry(encode(payload),tenantId,projectId,entryId),payload);
 for(const raw of [null,"invalid",encode({...payload,expectedSequence:-1}),encode({...payload,state:"UNKNOWN"}),encode({...payload,reason:"x".repeat(501)}),JSON.stringify({version:2,projectId,payload})])assert.equal(decodeTimeReviewRetry(raw,tenantId,projectId,entryId),null);
 for(const args of [[requestId,projectId,entryId],[tenantId,requestId,entryId],[tenantId,projectId,requestId]])assert.equal(decodeTimeReviewRetry(encode(payload),...args),null);
});
