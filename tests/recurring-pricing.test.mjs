import test from 'node:test';
import assert from 'node:assert/strict';
import {billingPriceSnapshot} from '../src/lib/recurring-pricing.ts';
const line={description:'خدمة / Service',quantity:1,unitPrice:'0.010',treatment:'STANDARD'};
test('billing uses exact HALF_UP three decimals and distinct zero/exempt treatments',()=>{
 const s=billingPriceSnapshot([line,{...line,treatment:'ZERO'},{...line,treatment:'EXEMPT'}],true,'OMR');
 assert.equal(s.subtotal,'0.030');assert.equal(s.taxAmount,'0.001');assert.equal(s.gross,'0.031');assert.deepEqual(s.lines.map(l=>l.treatment),['STANDARD','ZERO','EXEMPT']);
 assert.equal(billingPriceSnapshot([line],false,'USD').taxAmount,'0.000');
 assert.throws(()=>billingPriceSnapshot([line],true,'USD'));
});
test('money beyond safe JS integer precision remains exact with bounded totals',()=>{
 const s=billingPriceSnapshot([{...line,unitPrice:'90071992547409.913',quantity:2}],false,'OMR');assert.equal(s.subtotal,'180143985094819.826');
 assert.throws(()=>billingPriceSnapshot([{...line,unitPrice:'999999999999999.999',quantity:2}],false,'OMR'));
 assert.throws(()=>billingPriceSnapshot([{...line,unitPrice:'999999999999999.999'}],true,'OMR'));
});
test('new plan values must be explicit without truncating legacy snapshots',()=>{
 for(const changed of [{unitPrice:'1'},{unitPrice:'1.0001'},{unitPrice:'-1.000'},{unitPrice:1},{quantity:1.5},{quantity:2147483648},{treatment:'GUESSED'},{description:'\u0000'}])assert.throws(()=>billingPriceSnapshot([{...line,...changed}],false,'OMR'));
 const description='Legacy '.repeat(2000);assert.equal(billingPriceSnapshot([{...line,description}],false,'OMR').lines[0].description,description);
});
