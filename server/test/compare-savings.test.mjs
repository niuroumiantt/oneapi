import test from 'node:test';
import assert from 'node:assert/strict';
import savings from '../../web/compare-savings.js';
const fixture=(actual='0.000498',expected='0.001660')=>[
 {status:'complete',billing:{status:'settled',currency:'CNY',paid_equivalent_yuan:actual,charged_yuan:'0.00166',cash_booked_yuan:'0.00'}},
 {status:'complete',estimate:{status:'estimated',currency:'CNY',total_yuan:expected,source:{kind:'official_list',provider:'glm'}}}
];
test('uses purchased-pack cash equivalent, not face credit or cents-booked amount',()=>{
 const c=savings.compare(...fixture());assert.equal(c.difference_yuan,'0.001162');assert.equal(c.percentage,'70');assert.equal(c.direction,'less');assert.equal(c.label,'按官方预估价计算');assert.match(c.notice,/不是官方实际账单/);
});
test('honestly reports higher costs and equal costs',()=>{
 const higher=savings.compare(...fixture('3','2'));assert.equal(higher.direction,'more');assert.equal(higher.difference_yuan,'-1');assert.equal(higher.percentage,'50');
 const equal=savings.compare(...fixture('10.00','10'));assert.equal(equal.direction,'equal');assert.equal(equal.percentage,'0');assert.equal(equal.actual_yuan,'10');
});
test('zero estimate has a difference but never a division-by-zero percentage',()=>{
 for(const actual of ['0','0.1']){const c=savings.compare(...fixture(actual,'0'));assert.equal(c.percentage,null);assert.match(c.percentage_unavailable_reason,/为 0/);assert.equal(c.difference_yuan,actual==='0'?'0':'-0.1');}
 assert.equal(savings.compare(...fixture('0','1')).percentage,'100');
});
test('keeps sub-cent and long decimal ledger precision',()=>{
 const c=savings.compare(...fixture('0.0000000000000000003','0.000000000000000001'));assert.equal(c.difference_yuan,'0.0000000000000000007');assert.equal(c.percentage,'70');
 assert.equal(savings.compare(...fixture('0.9999999999','1')).percentage,'< 0.01');
 assert.equal(savings.compare(...fixture('0.3','0.4')).difference_yuan,'0.1');
});
test('missing, negative, nonfinite and malformed amounts do not become zero',()=>{
 for(const invalid of [null,undefined,'',NaN,Infinity,-1,'-0.1','garbage',{},true]){
  const actualPair=fixture(),expectedPair=fixture();actualPair[0].billing.paid_equivalent_yuan=invalid;expectedPair[1].estimate.total_yuan=invalid;
  assert.equal(savings.compare(...actualPair).status,'unavailable');
  assert.equal(savings.compare(...expectedPair).status,'unavailable');
 }
});
test('pending settlement, missing estimates and currency mismatch cannot claim savings',()=>{
 for(const mutate of [(a)=>a.billing.status='pending',(_a,b)=>b.estimate.status='unavailable',(a)=>delete a.billing.paid_equivalent_yuan,(a)=>a.billing.currency='USD',(_a,b)=>delete b.estimate.currency]){const pair=fixture();mutate(...pair);assert.equal(savings.compare(...pair).status,'unavailable');}
 assert.equal(savings.compare().status,'waiting');assert.equal(savings.compare(fixture()[0]).status,'waiting');
});
test('failed, truncated, cancelled or timed-out results have no savings conclusion',()=>{
 for(const status of ['failed','truncated','cancelled','timeout','filtered'])for(const side of [0,1]){const pair=fixture();pair[side].status=status;assert.equal(savings.compare(...pair).status,'unavailable');}
});
test('manual and third-party estimates are never labelled official',()=>{
 const pair=fixture();pair[1].estimate.source={kind:'user_entered',provider:'deepseek'};assert.equal(savings.compare(...pair).label,'按自填单价预估计算');
 pair[1].estimate.source={kind:'user_entered',provider:'custom'};assert.equal(savings.compare(...pair).basis,'manual');
 pair[1].estimate.source={kind:'official_list',provider:'custom'};assert.equal(savings.compare(...pair).basis,'reference');
});
test('comparison output is JSON-exportable and does not copy credentials',()=>{
 const pair=fixture();pair[1].estimate.source.key='secret-fixture';const json=JSON.stringify(savings.compare(...pair));assert.ok(!json.includes('secret-fixture'));assert.match(json,/difference_yuan/);assert.match(json,/formula/);
});

test('purchase discount uses the consumed credit, not current identity or last payment',()=>{
 const bill=fixture()[0].billing;assert.equal(savings.discount(bill),'3');
 assert.equal(savings.discount({...bill,charged_yuan:'1.501',paid_equivalent_yuan:'0.5005'}),'约 3.3344');
 assert.equal(savings.discount({...bill,paid_equivalent_yuan:bill.charged_yuan}),'10');
 assert.equal(savings.discount({...bill,charged_yuan:'0',paid_equivalent_yuan:'0'}),null);
 assert.equal(savings.discount({...bill,status:'pending'}),null);
 assert.equal(savings.discount({...bill,paid_equivalent_yuan:null}),null);
});

test('allocated credit uses confirmed half-price cost and exact savings',()=>{
 const pair=fixture();Object.assign(pair[0].billing,{funding_kind:'allocated',charged_yuan:'0.000017',paid_equivalent_yuan:null});pair[1].estimate.total_yuan='0.000017';
 const c=savings.compare(...pair);assert.equal(c.status,'compared');assert.equal(c.actual_yuan,'0.0000085');assert.equal(c.difference_yuan,'0.0000085');assert.equal(c.percentage,'50');assert.match(c.funding_cost_basis,/50%/);
 assert.equal(savings.actualCost({...pair[0].billing,charged_yuan:'0.000000000001'}),'0.0000000000005');
 assert.equal(savings.actualCost({...pair[0].billing,status:'pending'}),null);
 assert.equal(savings.actualCost({...pair[0].billing,charged_yuan:null}),null);
});
