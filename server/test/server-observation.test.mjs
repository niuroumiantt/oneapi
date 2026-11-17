import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMetrics} from '../src/server-observation.mjs';
const now=Date.now();
const fixture=()=>({schema:1,collected_at:new Date(now).toISOString(),cpu_percent:0,memory_total_bytes:100,memory_used_bytes:20,network:{interface:'eth0',rx_bps:0,tx_bps:12},services:[{name:'api',status:'running',health:'healthy',image:'oneapi:abc',restarts:0}],deployment:{api_sha:'a'.repeat(40),web_sha:'a'.repeat(40)},credential:'MUST_NOT_RETURN',environment:{SECRET:'MUST_NOT_RETURN'}});
test('host metrics whitelist preserves real zero and excludes arbitrary sensitive data',()=>{const r=projectMetrics(fixture(),now);assert.equal(r.status,'ok');assert.equal(r.cpu_percent,0);assert.equal(r.network.rx_bps,0);assert.equal(r.services.length,3);assert.equal(r.services[1].status,'unknown');assert.ok(!JSON.stringify(r).includes('MUST_NOT_RETURN'));});
test('old or future host samples are stale; invalid counters never look like healthy zeros',()=>{const f=fixture();f.collected_at=new Date(now-61000).toISOString();f.cpu_percent=101;f.network.rx_bps=-1;assert.equal(projectMetrics(f,now).status,'stale');assert.equal(projectMetrics(f,now).cpu_percent,null);assert.equal(projectMetrics(f,now).network.rx_bps,null);f.collected_at=new Date(now+10000).toISOString();assert.equal(projectMetrics(f,now).status,'stale');assert.throws(()=>projectMetrics({schema:1,collected_at:'bad'},now));});

test('project usage keeps observed counters without exposing raw identity or implying cloud cost allocation',()=>{
 const f=fixture();f.usage_meter={started_at:f.collected_at,collected_at:f.collected_at,allocation_ready:true,network_status:'ok',identity:'MUST_NOT_RETURN',days:[{date:'2026-11-17',rx_bytes:0,tx_bytes:100,observed_seconds:15,gaps:0}],backup:{status:'ok',bytes:120,files:2,path:'MUST_NOT_RETURN'}};
 const m=projectMetrics(f,now).usage_meter;assert.equal(m.days[0].tx_bytes,100);assert.equal(m.allocation_ready,false);assert.equal(m.public_egress_status,'not_separated');assert.equal(m.backup.bytes,120);assert.ok(!JSON.stringify(m).includes('MUST_NOT_RETURN'));
});
