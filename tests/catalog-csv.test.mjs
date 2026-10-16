import test from "node:test";
import assert from "node:assert/strict";
import {parseCatalogCsv,catalogTemplate} from "../src/lib/catalog-csv.ts";
test("catalog CSV normalizes party codes and preserves quoted Unicode content",()=>{
 const parsed=parseCatalogCsv("CUSTOMER",'\uFEFFcode,displayName,email,phone,legalName,notes\r\n cu-1 ,"شركة، اختبار",a@example.invalid,,,"Line 1\nLine ""2"", note"\r\n');
 assert.equal(parsed.errors.length,0);assert.equal(parsed.rowCount,1);assert.equal(parsed.records[0].code,"CU-1");assert.equal(parsed.records[0].phone,null);assert.equal(parsed.records[0].notes,'Line 1\nLine "2", note');
 const item=parseCatalogCsv("ITEM",catalogTemplate("ITEM")+'sku-1,Item,PCS,');assert.equal(item.errors.length,0);assert.equal(item.records[0].sku,"SKU-1");
});
test("catalog CSV rejects duplicate normalized codes, bounds and malformed records before committing",()=>{
 const header=catalogTemplate("SUPPLIER");
 for(const csv of [header,header+'AA,Name,,,,\n aa ,Other,,,,',header+'AA,Name,bad,,,',header+'AA,N,,,,',header+'A!,Name,,,,',header+'AA,Name,,,,,extra',header+'AA,"Unclosed,,,,',header+'AA,Wrong"quote,,,,',header+'AA,"Name"bad,,,,',header+'AA,Name,,,,\0','wrong,columns\nAA,Name','x'.repeat(350001),header+Array(501).fill('AA,Name,,,,').join('\n')])assert.ok(parseCatalogCsv("SUPPLIER",csv).errors.length,csv.slice(0,100));
 assert.equal(parseCatalogCsv("ITEM",catalogTemplate("ITEM")+Array.from({length:500},(_,i)=>`IT-${i},Item,pcs,`).join('\n')).records.length,500);
});

import {pendingCatalogImport} from "../src/lib/catalog-import-input.ts";
import {randomUUID} from "node:crypto";
test("pending import retains exact file, scope and UUID and rejects altered cache shapes",()=>{
 const original={version:1,tenantId:randomUUID(),companyId:randomUUID(),branchId:randomUUID(),kind:"CUSTOMER",csv:'code,displayName,email,phone,legalName,notes\nAA,اسم,,,,',requestId:randomUUID(),previewDigest:"a".repeat(64),mode:"commit"};
 assert.deepEqual(pendingCatalogImport.parse(JSON.parse(JSON.stringify(original))),original);
 for(const changed of [{version:2},{kind:"EMPLOYEE"},{mode:"preview"},{requestId:"invalid"},{previewDigest:"bad"},{csv:"x".repeat(350001)},{extra:true}])assert.equal(pendingCatalogImport.safeParse({...original,...changed}).success,false);
});
