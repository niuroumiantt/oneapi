import test from 'node:test';
import assert from 'node:assert/strict';
import {readAliyun,reconcileCloudBills,retainSuccessfulSnapshot,syncAliyun,CLOUD_SYNC_INTERVAL_MS} from '../src/aliyun-readonly.mjs';
const auth={region:'cn-qingdao',product:'ecs'};
const fetcher=async(a,s,op,p)=>op==='DescribeInstances'?{TotalCount:0,Instances:{Instance:[]}}:op==='QueryAccountBill'?{Data:{TotalCount:1,Items:{Item:[{ProductName:'ECS',Currency:'CNY',PretaxAmount:'22.590001',PaymentAmount:'20',OutstandingAmount:'2.590001'}]}}}:{Data:{Items:[{InstanceID:'shared-host',Currency:'CNY',PretaxAmount:'22.590001'}]}};
test('actual bills retain precision; forecast and OneAPI allocations never inferred from account costs',async()=>{
 const d=await readAliyun(auth,fetcher);assert.equal(d.billing.items[0].pretax_amount,'22.590001');assert.equal(d.oneapi_cost.amount,null);assert.equal(d.forecast.status,'unavailable');assert.equal(d.instance_billing.items[0].allocation,'unallocated');
});
test('resource, product bill and instance bill pagination includes every page',async()=>{
 const seen=[];const d=await readAliyun(auth,async(a,s,op,p)=>{seen.push([op,p]);if(op==='DescribeInstances')return {TotalCount:2,Instances:{Instance:[{InstanceId:'i-'+p.PageNumber}]}};if(op==='QueryAccountBill')return {Data:{TotalCount:2,Items:{Item:[{ProductName:'p'+p.PageNum}]}}};return {Data:{Items:[{InstanceID:p.NextToken?'b':'a'}],NextToken:p.NextToken?'':'next'}}});
 assert.equal(d.resources.items.length,2);assert.equal(d.billing.items.length,2);assert.equal(d.instance_billing.items.length,2);assert.equal(seen.length,6);
});
test('broken pagination and denied reads cannot publish partial totals or zero costs',async()=>{
 const d=await readAliyun(auth,async(a,s,op,p)=>{if(op==='DescribeInstanceBill')return {Data:{Items:[{}],NextToken:'repeated'}};if(op==='QueryAccountBill')return {Data:{TotalCount:3,Items:{Item:p.PageNum===1?[{}]:[]}}};return fetcher(a,s,op,p)});
 assert.equal(d.billing.status,'unavailable');assert.equal(d.billing.error_code,'INCOMPLETE_PAGINATION');assert.equal(d.billing.items,undefined);assert.equal(d.instance_billing.status,'unavailable');
});
test('failed refresh retains dated successful snapshots, then successful refresh clears stale state',async()=>{
 const first=retainSuccessfulSnapshot(null,await readAliyun(auth,fetcher));
 const failed={...first,collected_at:'2026-12-01T00:00:00Z',billing:{status:'unavailable',error_code:'Forbidden'}};
 const kept=retainSuccessfulSnapshot(first,failed);assert.equal(kept.billing.stale,true);assert.equal(kept.billing.period,first.billing.period);assert.equal(kept.billing.last_success_at,first.collected_at);assert.equal(kept.billing.items[0].pretax_amount,'22.590001');assert.equal(kept.next_sync_at,'2026-12-01T06:00:00.000Z');
 const recovered=retainSuccessfulSnapshot(kept,await readAliyun(auth,fetcher));assert.equal(recovered.billing.stale,undefined);
});
function fakePool(snapshot,lock=true){let stored=snapshot,writes=0,reads=0;const db={release(){},async query(sql,args){if(sql.includes('pg_try_advisory_lock'))return {rows:[{ok:lock}]};if(sql.startsWith('SELECT *')){reads++;return {rows:[{snapshot:stored,region:auth.region,product:auth.product,credential_ciphertext:'sealed'}]}}if(sql.startsWith('UPDATE cloud')){stored=args[0];writes++}return {rows:[]}}};return {connect:async()=>db,get snapshot(){return stored},get writes(){return writes},get reads(){return reads}}}
test('scheduled sync persists once, reuses six-hour cadence across worker restarts; manual retries cached',async()=>{
 const p=fakePool(null),box={open:()=>({})};let requests=0;const reader=async()=>{requests++;return readAliyun(auth,fetcher)};
 await syncAliyun(p,box,{scheduled:true,reader});await syncAliyun(p,box,{scheduled:true,reader});await syncAliyun(p,box,{reader});assert.equal(requests,1);assert.equal(p.writes,1);assert.equal(Date.parse(p.snapshot.next_sync_at)-Date.parse(p.snapshot.last_attempt_at),CLOUD_SYNC_INTERVAL_MS);
 const locked=fakePool(null,false);assert.deepEqual(await syncAliyun(locked,box,{scheduled:true,reader}),{skipped:'busy'});assert.equal(locked.reads,0);
});

test('cloud UI shows failed refresh and keeps forecast and allocation visibly separate',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');const source=readFileSync(new URL('../private/supplier-lab.js',import.meta.url),'utf8');
 const snapshot=retainSuccessfulSnapshot(null,await readAliyun(auth,fetcher));snapshot.billing.stale=true;snapshot.billing.last_error='Forbidden';
 const ctx=vm.createContext({cloudData:{configured:true,snapshot},esc:String,when:String,stat:(...x)=>x.join(' ')});vm.runInContext(source.slice(source.indexOf('function cloudView('),source.indexOf('function configureCloud(')),ctx);
 const html=ctx.cloudView();assert.match(html,/每 6 小时自动同步/);assert.match(html,/预测费用 未接入/);assert.match(html,/OneAPI 已归属成本 待确认/);assert.match(html,/本次同步失败：Forbidden/);assert.match(html,/22.590001/);assert.match(html,/资源账单 · 待分配/);
});

test('account and instance bills reconcile exactly across currencies without assuming matching timestamps imply matching totals',()=>{
 const bill=items=>({status:'ok',period:'2026-11',items}),row=(amount,currency='CNY')=>({pretax_amount:amount,currency});
 assert.equal(reconcileCloudBills(bill([row('0.3')]),bill([row('0.1'),row('0.2')])).status,'matched');
 assert.equal(reconcileCloudBills(bill([row('0.3000000001')]),bill([row('0.3')])).status,'different');
 assert.equal(reconcileCloudBills(bill([row('1','CNY')]),bill([row('1','USD')])).status,'different');
 assert.equal(reconcileCloudBills({...bill([row('1')]),stale:true},bill([row('1')])).status,'unavailable');
 assert.equal(reconcileCloudBills(bill([]),bill([])).status,'unavailable');
 assert.equal(reconcileCloudBills(bill([row(null)]),bill([row('0')])).status,'unavailable');
});
