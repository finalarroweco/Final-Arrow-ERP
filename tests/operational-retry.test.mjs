import assert from "node:assert/strict";
import test from "node:test";
import {decodeOperationalRetry} from "../src/lib/operational-input.ts";
const tenantId="00000000-0000-4000-8000-000000000001",parentId="00000000-0000-4000-8000-000000000002",requestId="00000000-0000-4000-8000-000000000003";
test("operational retry restores original scoped contact/note IDs and rejects foreign caches",()=>{
 for(const record of [{version:1,kind:"contact",parentId,payload:{tenantId,requestId,displayName:"Contact",email:null,phone:null,title:null,notes:null}},{version:1,kind:"message",parentId,payload:{tenantId,requestId,body:"Original note"}}]){const raw=JSON.stringify(record);assert.deepEqual(decodeOperationalRetry(raw,record.kind,tenantId,parentId),record);assert.equal(decodeOperationalRetry(raw,record.kind,requestId,parentId),null);assert.equal(decodeOperationalRetry(raw,record.kind,tenantId,requestId),null);assert.equal(decodeOperationalRetry(raw,record.kind==="contact"?"message":"contact",tenantId,parentId),null);assert.equal(decodeOperationalRetry(JSON.stringify({...record,version:2}),record.kind,tenantId,parentId),null);}
 for(const raw of [null,"not json","x".repeat(20001),JSON.stringify({version:1,kind:"message",parentId,payload:{tenantId,requestId,body:" "}})])assert.equal(decodeOperationalRetry(raw,"message",tenantId,parentId),null);
});
