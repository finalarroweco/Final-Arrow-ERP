import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),holder={exports:{}};
new Function('require','module','exports',ts.transpileModule(readFileSync('src/lib/bank-allocation-input.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(require,holder,holder.exports);
const {bankMatchInput}=holder.exports;
const pair={tenantId:'AAAAAAAA-AAAA-4AAA-AAAA-AAAAAAAAAAAA',requestId:'BBBBBBBB-BBBB-4BBB-BBBB-BBBBBBBBBBBB',bankLineId:'CCCCCCCC-CCCC-4CCC-ACCC-CCCCCCCCCCCC',journalLineId:'DDDDDDDD-DDDD-4DDD-ADDD-DDDDDDDDDDDD'};
test('allocation identities canonicalize and amounts preserve exact milli units',()=>{
 for(const [amount,expected] of [['1','1.000'],['1.1','1.100'],['0.001','0.001'],['999999999999999.999','999999999999999.999']]){
  const p=bankMatchInput.parse({...pair,action:'allocate',amount});assert.equal(p.amount,expected);assert.equal(p.tenantId,pair.tenantId.toLowerCase());
 }
 for(const amount of ['0','0.000','-1','01','1.0001','1e2',' 1','1000000000000000','NaN',1,null])assert.equal(bankMatchInput.safeParse({...pair,action:'allocate',amount}).success,false,String(amount));
});
test('legacy full match cannot silently become a partial request',()=>{
 assert.equal(bankMatchInput.safeParse({...pair,action:'match'}).success,true);
 assert.equal(bankMatchInput.safeParse({...pair,action:'match',amount:'1'}).success,false);
 assert.equal(bankMatchInput.safeParse({...pair,action:'allocate'}).success,false);
 assert.equal(bankMatchInput.safeParse({...pair,action:'allocate',amount:'1',actorId:pair.tenantId}).success,false);
});
test('cancellation is a bounded reasoned immutable identity',()=>{
 const p=bankMatchInput.parse({tenantId:pair.tenantId,action:'cancel',matchId:pair.requestId,reason:'  correction needed  '});assert.equal(p.reason,'correction needed');
 for(const reason of ['x',' '.repeat(8),'a'.repeat(301)])assert.equal(bankMatchInput.safeParse({...p,reason}).success,false);
});
