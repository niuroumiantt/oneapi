import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate,createSeatGate,estimateTokens,GATEWAY_DEFAULTS,SEAT_CONCURRENT,SEAT_TPM,rejectionLayer } from '../src/gateway-limits.mjs';

const limits={max_concurrent:3,tpm:10000,org_max_concurrent:2,org_tpm:4000};
const clock=()=>{let t=1_000_000;const now=()=>t;now.advance=ms=>{t+=ms;};return now;};
const blocked=(fn,code,pattern)=>assert.throws(fn,e=>e.status===429&&e.code===code&&pattern.test(e.message)&&e.retryAfter>=1);

test('decided defaults: company 50 at once and 15M TPM, each organization 10 and 2M; seat 10 / 3M',()=>{
 assert.deepEqual({...GATEWAY_DEFAULTS},{max_concurrent:50,tpm:15000000,org_max_concurrent:10,org_tpm:2000000});
 assert.deepEqual({max_concurrent:SEAT_CONCURRENT,tpm:SEAT_TPM},{max_concurrent:10,tpm:3000000});
 assert.equal(estimateTokens(4000),1000,'four bytes reserve one token');
 assert.equal(rejectionLayer('person_tpm_exceeded'),'person');
 assert.equal(rejectionLayer('gateway_busy'),'company');
 const gate=createGate(clock());gate.admit('a',1500000,GATEWAY_DEFAULTS).release();
 blocked(()=>gate.admit('a',600000,GATEWAY_DEFAULTS),'organization_limit_exceeded',/已用约 150 万 Token，上限 200 万/);
});

test('person seat TPM: one person shares the window across keys; cancel counts nothing',()=>{
 const now=clock(),seat=createSeatGate(now);
 const a=seat.admit('p1',2000000,SEAT_TPM);seat.admit('p1',900000,SEAT_TPM).release();
 blocked(()=>seat.admit('p1',200000,SEAT_TPM),'person_tpm_exceeded',/席位上限 300 万/);
 seat.admit('p2',3000000,SEAT_TPM).release();
 a.settle({input:1000,output:500,cached:0});a.release();
 now.advance(60001);
 assert.equal(seat.snapshot().people.find(x=>x.id==='p1')?.tpm||0,0);
 seat.admit('p1',3000000,SEAT_TPM).cancel();
 assert.deepEqual(seat.snapshot().people,[]);
});

test('concurrency: the organization limit stops its own calls, the company limit stops everyone',()=>{
 const gate=createGate(clock()),a1=gate.admit('a',1,limits);gate.admit('a',1,limits);
 blocked(()=>gate.admit('a',1,limits),'organization_limit_exceeded',/贵公司同时进行的请求已达 2 个上限/);
 const b1=gate.admit('b',1,limits);
 blocked(()=>gate.admit('c',1,limits),'gateway_busy',/全平台同时进行的请求已达 3 个上限/);
 a1.release();a1.release();
 assert.equal(gate.snapshot().active,2,'release is idempotent');
 gate.admit('c',1,limits);b1.release();
 assert.deepEqual(gate.snapshot().organizations.find(o=>o.id==='a').active,1);
});

test('tokens per minute: reserved while running, real count for a minute after the end',()=>{
 const now=clock(),gate=createGate(now);
 const s=gate.admit('a',3000,limits);
 blocked(()=>gate.admit('a',1500,limits),'organization_limit_exceeded',/已用约 3000 Token，上限 4000（/);
 // KerAPI counted fewer tokens than reserved: the real count replaces the reservation when the call ends.
 s.settle({input:1000,output:500,cached:900});s.release();s.release();
 assert.equal(gate.snapshot().tpm,1500);
 gate.admit('a',2500,limits).release();
 now.advance(30000);
 blocked(()=>gate.admit('a',100,limits),'organization_limit_exceeded',/最近一分钟已用约 4000 Token/);
 assert.throws(()=>gate.admit('a',100,limits),e=>e.retryAfter===30,'retry when the oldest finished call leaves the window');
 now.advance(30001);
 assert.equal(gate.snapshot().tpm,0);
 gate.admit('a',4000,limits).release();
});

test('a long call keeps its reservation until it ends, then counts its real tokens for one more minute',()=>{
 const now=clock(),gate=createGate(now),s=gate.admit('a',1000,limits);
 now.advance(90000);
 assert.equal(gate.snapshot().tpm,1000,'still running, still reserved');
 s.settle({input:3000,output:200,cached:2800});s.release();
 assert.equal(gate.snapshot().tpm,3200);
 now.advance(59000);assert.equal(gate.snapshot().tpm,3200);
 now.advance(1001);assert.equal(gate.snapshot().tpm,0);
});

test('a call without usage keeps its estimate for a minute; a call that never reached KerAPI counts nothing',()=>{
 const gate=createGate(clock());
 gate.admit('a',700,limits).release();
 gate.admit('a',900,limits).cancel();
 assert.deepEqual(gate.snapshot(),{active:0,tpm:700,organizations:[{id:'a',active:0,tpm:700}]});
});

test('a caller that hangs up frees the slot at once; the real count arriving later still replaces the estimate',()=>{
 const gate=createGate(clock()),s=gate.admit('a',5000,{...limits,org_tpm:10000});
 s.release();assert.equal(gate.snapshot().tpm,5000);
 s.settle({input:1200,output:30,cached:1000});assert.equal(gate.snapshot().tpm,1230);
 assert.equal(gate.snapshot().active,0);
});

test('company tokens per minute cover all organizations together',()=>{
 const gate=createGate(clock());
 gate.admit('a',4000,limits).release();gate.admit('b',4000,limits).release();
 blocked(()=>gate.admit('c',2500,limits),'gateway_busy',/最近一分钟的 Token 用量已到上限/);
 gate.admit('c',2000,limits).release();
 assert.equal(gate.snapshot().tpm,10000);
});

test('a refused request reserves nothing',()=>{
 const gate=createGate(clock());
 assert.throws(()=>gate.admit('a',5000,limits));
 assert.deepEqual(gate.snapshot(),{active:0,tpm:0,organizations:[]});
});
