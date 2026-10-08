import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBankCsv} from '../src/lib/bank-csv.ts';
test('bank CSV preserves quoted references and exact signed decimal strings',()=>{
 assert.deepEqual(parseBankCsv('\uFEFFdate,reference,amount\r\n2026-10-01,"Bank ""receipt"", Oman",125.001\r\n2026-10-02,رسوم,-0.125\r\n'),[{bookingDate:'2026-10-01',reference:'Bank "receipt", Oman',amount:'125.001'},{bookingDate:'2026-10-02',reference:'رسوم',amount:'-0.125'}]);
 assert.deepEqual(parseBankCsv('date,reference,amount\n'),[]);
});
test('bank CSV rejects malformed quoting, columns, oversized imports and wrong headers',()=>{
 for(const csv of ['date,reference,amount\n2026-10-01,"Unclosed,1','date,reference,amount\n2026-10-01,Wrong"quote,1','date,reference,amount\n2026-10-01,"Closed"bad,1','date,reference,amount\n2026-10-01,ref,1,extra','DATE,reference,amount\n','x'.repeat(180001),'date,reference,amount\n'+Array(501).fill('2026-10-01,ref,1').join('\n')])assert.throws(()=>parseBankCsv(csv));
});
