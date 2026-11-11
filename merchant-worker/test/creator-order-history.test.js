import test from 'node:test';
import assert from 'node:assert/strict';
import { creatorPlayOrderIds } from '../src/creator-program.js';

const base = 'GPA.1111-2222-3333-44444';
test('missing intermediate renewals are requested, not assumed to be paid', () => {
  assert.deepEqual(creatorPlayOrderIds(base), [base]);
  assert.deepEqual(creatorPlayOrderIds(base+'..2', ['payment:android:'+base]),
    [base,base+'..0',base+'..1',base+'..2']);
  assert.deepEqual(creatorPlayOrderIds(base+'..0', [],base+'..2'),
    [base,base+'..0',base+'..1',base+'..2']);
  assert.deepEqual(creatorPlayOrderIds(base, ['payment:android:'+base+'..1']),
    [base,base+'..0',base+'..1']);
});
test('history is bounded and cannot cross purchase chains or interpolate malformed IDs', () => {
  for(const id of [null,base+'..-1',base+'..01',base+'..199',base+'..999999',base+'/other','not-order']) {
    assert.throws(()=>creatorPlayOrderIds(id));
  }
  assert.equal(creatorPlayOrderIds(base+'..198').length,200);
  assert.throws(()=>creatorPlayOrderIds(base,['payment:ios:'+base]));
  assert.throws(()=>creatorPlayOrderIds(base,['payment:android:GPA.0000-0000-0000-00000']));
  assert.throws(()=>creatorPlayOrderIds(base,[], 'GPA.0000-0000-0000-00000'));
  assert.throws(()=>creatorPlayOrderIds(base,Array(201).fill('payment:android:'+base)));
});
