import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKerapi,reconcile,redactEvidence,difference,recomputeKerapi} from '../src/usage-reconciliation.mjs';
import {readAliyun,rpcBody} from '../src/aliyun-readonly.mjs';
const expr='(tier("base", p * 0.142857142857 + c * 0.571428571429 + cr * 0.002857142857)) * (weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") < 6 && hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12 ? 2 : 1) * (weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") < 6 && hour("Asia/Shanghai") >= 14 && hour("Asia/Shanghai") < 18 ? 2 : 1)';
const bill=(i=44,o=20,amount='0.000126')=>normalizeKerapi({request_id:'r1',model_name:'deepseek-v4.1-flash',created_at:1794284857,type:2,prompt_tokens:i,completion_tokens:o,quota:9,other:JSON.stringify({cache_tokens:0,billing_amount:amount,billing_currency:{code:'CNY',exchange_rate:7,quota_per_unit:500000},pricing_ratio:1,billing_mode:'tiered_expr',expr_b64:Buffer.from(expr).toString('base64'),duration_ms:1043})});
const local=(i=44,o=20)=>({upstream_request_id:'r1',model_id:'deepseek-v4.1-flash',input_tokens:i,cached_input_tokens:0,output_tokens:o,estimated_cost_yuan:null,latency_ms:2143});
test('all four observed billing amounts reproduce independently from local tokens including quota rounding',()=>{
 for(const [i,o,amount] of [[44,20,'0.000126'],[57,35,'0.000196'],[45,48,'0.000238'],[56,42,'0.000224']]){const r=reconcile(local(i,o),[bill(i,o,amount)]);assert.equal(r.status,'matched');assert.equal(Number(r.expected_amount),Number(amount));assert.equal(r.contract_verified,false)}
 const r=reconcile(local(),[bill()]);assert.equal(r.latency_difference_ms,1100);assert.equal(r.rule.multiplier,1);
});
test('missing cache and unknown formula or currency cannot produce a full billing match',()=>{
 const b=bill();assert.equal(reconcile({...local(),cached_input_tokens:null},[b]).status,'incomplete');
 assert.equal(reconcile(local(),[{...b,expression:'process.exit()'}]).status,'incomplete');
 assert.equal(reconcile(local(),[{...b,currency:'USD'}]).status,'incomplete');
 assert.equal(reconcile(local(),[]).status,'pending');assert.equal(reconcile(local(),[b,b]).status,'ambiguous');
 assert.equal(reconcile(local(),[{...b,model_id:'other'}]).status,'different');
 assert.equal(reconcile(local(),[{...b,input_tokens:45}]).status,'different');
 assert.equal(reconcile(local(),[{...b,amount:'0.000127'}]).status,'different');
});
test('peak rules use Beijing time and boundary-crossing calls remain unverified',()=>{
 const b={...bill(),created_at:'2026-11-10T03:07:29Z'};assert.equal(recomputeKerapi(local(),b).multiplier,2);
 assert.equal(recomputeKerapi({...local(),checks:{started_at:'2026-11-10T02:59:59Z'}},b),null);
 assert.equal(difference('0.000001','0.000003'),'-0.000002000000');
});
test('raw metadata keeps original field names but credentials are redacted',()=>{
 const d=redactEvidence({token_name:'team',token_id:12,authorization:'Bearer secret',other:'contains sk-live'},'sk-live');assert.equal(d.token_id,12);assert.equal(d.authorization,'[REDACTED]');assert.ok(!d.other.includes('sk-live'));
 assert.equal(bill().raw_other.cache_tokens,0);assert.equal(JSON.parse(bill().raw_log.other).cache_tokens,0);
});
test('Aliyun reader uses only fixed read operations and keeps denied billing unknown',async()=>{
 const calls=[];const d=await readAliyun({region:'cn-shanghai',product:'ecs'},async(a,s,op,p)=>{calls.push(op);if(s==='bss'){const e=Error();e.code='Forbidden';throw e}return {TotalCount:1,Instances:{Instance:[{InstanceId:'i-test',Status:'Running',InternetMaxBandwidthOut:5}]}}});
 assert.deepEqual(calls,['DescribeInstances','QueryAccountBill']);assert.equal(d.resources.items[0].bandwidth_out_mbps,5);assert.equal(d.billing.status,'unavailable');assert.equal(d.billing.items,undefined);
 const body=rpcBody({Action:'DescribeInstances',Format:'JSON',Timestamp:'2026-11-10T06:00:00Z'},'fixture');assert.ok(body.includes('Signature='));assert.ok(!body.includes('fixture'));
});
