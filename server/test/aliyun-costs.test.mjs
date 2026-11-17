import test from 'node:test';
import assert from 'node:assert/strict';
import {billComparison,allocateBills,estimateForecast} from '../src/aliyun-costs.mjs';
const row=(amount,extra={})=>({id:'shared',product:'ECS',product_code:'ecs',owner_id:'owner',billing_item_code:'NetworkOut',currency:'CNY',pretax_amount:amount,...extra});
const bill=items=>({status:'ok',period:'2026-11',items});
test('three-source comparison preserves lag, fractional differences and negative adjustments',()=>{
 const d=billComparison(bill([row('7.100001')]),bill([row('6.7')]),bill([row('7.104'),row('-0.004')]));assert.equal(d.rows[0].difference,'0.000001');assert.equal(d.rows[0].summary_difference,'0.400001');assert.equal(d.rows[0].status,'subcent_difference');
 assert.equal(billComparison(bill([]),bill([]),{...bill([]),stale:true}).status,'unavailable');
});
test('allocation requires exact resource, owner, item and month; no automatic 25 percent',()=>{
 const r={resource_id:'shared',product_code:'ecs',owner_id:'owner',billing_item_code:'NetworkOut',period:'2026-11',basis_points:3000,basis:'Approved monthly usage ratio'};
 const d=bill([row('10'),row('-1'),row('20',{id:'other'}),row('30',{billing_item_code:'backup'})]);
 assert.deepEqual(allocateBills(d).totals,[]);const a=allocateBills(d,[r]);assert.equal(a.totals[0].amount,'2.7');assert.equal(a.items[1].oneapi_amount,'-0.3');assert.equal(a.items[2].oneapi_amount,null);assert.equal(a.items[3].oneapi_amount,null);assert.equal(a.status,'partial');
 assert.equal(allocateBills(d,[{...r,period:'2026-10'}]).totals.length,0);assert.equal(allocateBills(d,[r,r]).totals.length,0);assert.equal(allocateBills(d,[{...r,basis_points:10001}]).status,'unavailable');
});
test('forecast projects postpaid trend only, counts subscription once and refuses missing days',()=>{
 const daily=Array.from({length:7},(_,i)=>({status:'ok',date:'2026-11-0'+(i+1),items:[row('2',{subscription_type:'PayAsYouGo'}),...(i===0?[row('100',{subscription_type:'Subscription'})]:[])]}));
 const f=estimateForecast(daily,'2026-11','2026-11-07');assert.equal(f.status,'estimated');assert.equal(f.items[0].forecast,'160');assert.equal(f.items[0].closed_actual,'114');assert.equal(f.scope,'aliyun_account_all_projects');assert.equal(f.official_status,'not_connected');
 assert.equal(estimateForecast(daily.slice(1),'2026-11','2026-11-07').status,'unavailable');assert.equal(estimateForecast([...daily,{status:'unavailable'}],'2026-11','2026-11-08').status,'unavailable');
});
