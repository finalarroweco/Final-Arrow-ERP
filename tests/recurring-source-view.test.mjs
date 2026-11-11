import test from 'node:test';
import assert from 'node:assert/strict';
import {Prisma} from '@prisma/client';
import {billingSourceView} from '../src/lib/recurring-source-view.ts';
test('billing source register and history money retain exactly three decimals through JSON',()=>{
 for(const [subtotal,taxAmount] of [['25.010','0.000'],['1.000','0.050'],['999999999999999.999','0.001']]){
  const source={id:'source',subtotal:new Prisma.Decimal(subtotal),taxAmount:new Prisma.Decimal(taxAmount),invoice:{id:'invoice'}};
  const view=billingSourceView(source),decoded=JSON.parse(JSON.stringify(view));
  assert.equal(decoded.subtotal,subtotal);assert.equal(decoded.taxAmount,taxAmount);assert.equal(decoded.id,'source');assert.deepEqual(decoded.invoice,{id:'invoice'});
  assert.ok(source.subtotal instanceof Prisma.Decimal,'immutable source object was not mutated');
 }
});
