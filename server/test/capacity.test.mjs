import test from 'node:test';
import assert from 'node:assert/strict';
import {assumptions,capacityModel,parseCgroup,fixedBandwidthMonthly,gatewayStats} from '../src/capacity.mjs';

// Two days shaped like production on 2026-11-12: a batch script and an agent tool.
const usage=()=>({days:1,calls:2000,ok:1900,input_tokens:90e6,cached_input_tokens:85e6,output_tokens:2.8e6,revenue_yuan:58,busy_seconds:2000*14,peak_concurrency:29,
 peak_minute:{at:'2026-11-12T03:10:00Z',input_tokens:2e6,cached_input_tokens:1.99e6,output_tokens:4000},
 clients:[{name:'WorkBuddy',calls:300,input_tokens:67.5e6,output_tokens:3e5,revenue_yuan:14},{name:'Node 脚本',calls:1700,input_tokens:3.5e6,output_tokens:2e6,revenue_yuan:42}],
 persons:[{name:'甲',calls:300,input_tokens:67.5e6,output_tokens:3e5,revenue_yuan:14,peak_concurrency:3}]});

test('bandwidth is egress bytes from tokens at the official per-GB price',()=>{
 const m=capacityModel(usage(),{cpu_limit_cores:0.75},assumptions());
 // 90M × 6.32 + 2.8M × 6.2 = 586.16 MB → ¥0.422 at ¥0.72/GB
 assert.equal(m.window.egress_gb,0.5862);assert.equal(m.window.bandwidth,0.422);
 assert.equal(m.window.per_million_input,0.00455);
 assert.equal(m.monthly.bandwidth,12.66);assert.equal(m.monthly.hardware,30.07);
 const agent=m.clients[0];assert.ok(agent.bandwidth_per_call>m.clients[1].bandwidth_per_call*50,'agent calls cost far more bandwidth than batch calls');
 assert.equal(m.people[0].hardware_monthly,Number((3*m.slot.hardware_monthly).toFixed(2)));
});
test('capacity names the first limit and keeps the uncached KerAPI line for comparison',()=>{
 const m=capacityModel(usage(),{cpu_limit_cores:0.75},assumptions());
 const by=Object.fromEntries(m.limits.map(x=>[x.key,x.slots]));
 assert.equal(by.gateway_cpu,43);// 0.75 × 70% ÷ 0.012
 assert.ok(by.kerapi_all<by.kerapi_uncached);
 assert.equal(m.first_limit.key,'gateway_cpu');
 const small=capacityModel(usage(),{cpu_limit_cores:0.75},assumptions({kerapi_tpm:'1000000'}));
 assert.equal(small.first_limit.key,'kerapi_all');
});
test('scale projections pick the cheapest instances and compare fixed bandwidth',()=>{
 const m=capacityModel(usage(),{cpu_limit_cores:0.75},assumptions());
 const [now,ten,hundred]=m.scales;
 assert.equal(now.plan,'现有共享机器');assert.equal(ten.multiplier,10);
 assert.equal(ten.vcpu_needed,4.97);assert.equal(ten.plan,'ecs.e-c1m2.2xlarge');assert.equal(ten.instances,1);assert.equal(hundred.plan,'ecs.e-c1m2.2xlarge');assert.equal(hundred.instances,7);
 assert.ok(hundred.server>ten.server);assert.equal(hundred.bandwidth,Number((now.bandwidth*100).toFixed(2)));
 assert.equal(m.scales.length,3,'the custom scale defaults to 10× and is not listed twice');
 assert.equal(capacityModel(usage(),{cpu_limit_cores:0.75},assumptions({scale:'3'})).scales.length,4);
});
test('fixed bandwidth follows the Qingdao step table',()=>{
 assert.equal(fixedBandwidthMonthly(0.2),20.7);assert.equal(fixedBandwidthMonthly(5),112.5);assert.equal(fixedBandwidthMonthly(10),472.5);assert.equal(fixedBandwidthMonthly(100),6952.5);
});
test('assumption overrides are bounded and only adjustable ones are accepted',()=>{
 assert.equal(assumptions({egress_yuan_per_gb:'0.8'}).egress_yuan_per_gb.value,0.8);
 assert.equal(assumptions({egress_yuan_per_gb:'0.8'}).egress_yuan_per_gb.overridden,true);
 assert.equal(assumptions({bytes_per_input_token:'1'}).bytes_per_input_token.value,6.32,'measured constants are not editable');
 assert.throws(()=>assumptions({gateway_share:'2'}),/超出范围/);assert.throws(()=>assumptions({peak_mbps:'abc'}),/超出范围/);
});
test('an empty window gives nulls, not divide-by-zero numbers',()=>{
 const empty={days:7,calls:0,ok:0,input_tokens:0,cached_input_tokens:0,output_tokens:0,revenue_yuan:0,busy_seconds:0,peak_concurrency:0,peak_minute:{at:null,input_tokens:0,cached_input_tokens:0,output_tokens:0},clients:[],persons:[]};
 const m=capacityModel(empty,{cpu_limit_cores:null},assumptions());
 assert.equal(m.window.bandwidth_per_call,null);assert.equal(m.slot.egress_mbps,null);assert.equal(m.first_limit,null);assert.equal(m.monthly.cost_ratio,null);
 assert.ok(!JSON.stringify(m).includes('NaN')&&!JSON.stringify(m).includes('Infinity'));
});
test('cgroup files parse into limits; unlimited and missing values are null',()=>{
 const c=parseCgroup({cpuStat:'usage_usec 143406791\nuser_usec 1\nnr_periods 1000\nnr_throttled 264\nthrottled_usec 7714640',cpuMax:'75000 100000',memoryCurrent:'93061120',memoryMax:'536870912',memoryPeak:'132120576'});
 assert.equal(c.cpu_limit_cores,0.75);assert.equal(c.usage_usec,143406791);assert.equal(c.nr_throttled,264);assert.equal(c.memory_limit_bytes,536870912);
 const open=parseCgroup({cpuMax:'max 100000',memoryMax:'max'});assert.equal(open.cpu_limit_cores,null);assert.equal(open.memory_limit_bytes,null);assert.equal(open.usage_usec,null);
});
test('gateway CPU is the usage delta over the sampling window',()=>{
 const at=Date.now(),old={at:at-60000,usage_usec:10e6,nr_periods:600,nr_throttled:0,cpu_limit_cores:0.75},now={at,usage_usec:16e6,nr_periods:1200,nr_throttled:60,cpu_limit_cores:0.75,memory_bytes:1,memory_limit_bytes:2};
 const g=gatewayStats(now,[old]);assert.equal(g.cpu_used_cores,0.1);assert.equal(g.cpu_window_seconds,60);assert.equal(g.throttled_share,0.1);
 assert.equal(gatewayStats(now,[]).cpu_used_cores,null);
});
