import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenCharges,referencePriceSnapshot,estimateReference} from '../src/compare-pricing.mjs';
const usage={input_tokens:1000000,cached_input_tokens:100000,output_tokens:50000,reasoning_tokens:20000};
const off=new Date('2026-11-17T11:00:00Z'),peak=new Date('2026-11-17T02:00:00Z');
const reference={provider:'deepseek'};
test('token prices separate cached input and never double-charge reasoning tokens',()=>{
 const r=tokenCharges(usage,{input:'1',cached:'0.02',output:'4'});
 assert.equal(Number(r.total_yuan),1.102);assert.deepEqual(r.items.map(i=>i.tokens),[900000,100000,50000]);
 assert.equal(Number(r.items[2].amount_yuan),0.2);
 assert.equal(Number(tokenCharges({input_tokens:1,cached_input_tokens:0,output_tokens:0},{input:'0.000001',cached:'0',output:'0'}).total_yuan),1e-12);
});
test('official snapshot respects provider, exact model, peak time and holidays',()=>{
 assert.equal(referencePriceSnapshot(reference,'deepseek-flash',null,peak).multiplier,2);
 assert.equal(referencePriceSnapshot(reference,'deepseek-flash',null,off).multiplier,1);
 assert.equal(referencePriceSnapshot(reference,'deepseek-flash',null,peak,new Set(['2026-11-17'])).multiplier,1);
 assert.equal(referencePriceSnapshot({provider:'custom'},'deepseek-flash',null,peak).kind,'unavailable');
 assert.equal(referencePriceSnapshot({provider:'glm'},'deepseek-flash',null,peak).kind,'unavailable');
 assert.equal(referencePriceSnapshot(reference,'deepseek-flash-0910',null,peak).kind,'unavailable');
 assert.equal(referencePriceSnapshot({provider:'glm'},'GLM-5.3-Flash',null,peak).rates.input,'0.8');
});
test('estimated fees use the frozen request price and retain source and disclaimer',()=>{
 const snapshot=referencePriceSnapshot(reference,'deepseek-flash',null,peak);
 const r=estimateReference({status:'complete',usage,response_model:'deepseek-flash'},snapshot);
 assert.equal(r.status,'estimated');assert.equal(Number(r.total_yuan),2.204);assert.match(r.notice,/无法读取/);assert.match(r.source.source_url,/api-docs.deepseek.com/);assert.equal(r.source.at,peak.toISOString());
});
test('manual rates are validated, labelled unverified and never imply official pricing',()=>{
 for(const input of ['',-1,Infinity,'1e3','1.0000001','1000000'])assert.throws(()=>referencePriceSnapshot({provider:'custom'},'model',{mode:'manual',input,cached:'0',output:'1'}));
 const snapshot=referencePriceSnapshot({provider:'custom'},'model',{mode:'manual',input:'2',cached:'0.5',output:'6'},off);
 const r=estimateReference({status:'complete',usage},snapshot);assert.equal(Number(r.total_yuan),2.15);assert.equal(r.source.kind,'user_entered');assert.equal(r.source.source_url,undefined);
 const free=referencePriceSnapshot({provider:'custom'},'model',{mode:'manual',input:'0',cached:'0',output:'0'},off);assert.equal(Number(estimateReference({status:'complete',usage},free).total_yuan),0);
});
test('missing tokens, failure and unknown model never become zero-cost claims',()=>{
 const snapshot=referencePriceSnapshot(reference,'deepseek-flash',null,off);
 for(const u of [null,{input_tokens:2},{output_tokens:2},{input_tokens:2,output_tokens:2,cached_input_tokens:3}])assert.equal(estimateReference({status:'complete',usage:u},snapshot).status,'unavailable');
 for(const status of ['failed','cancelled','timeout'])assert.equal(estimateReference({status,usage},snapshot).status,'unavailable');
 assert.equal(estimateReference({status:'complete',usage},referencePriceSnapshot(reference,'unknown',null,off)).status,'unavailable');
 assert.equal(estimateReference({status:'truncated',usage},snapshot).status,'estimated','valid final usage still bills a truncated generation');
});
test('missing cache and extra writes are disclosed rather than silently counted as free',()=>{
 const r=estimateReference({status:'complete',usage:{input_tokens:1000000,output_tokens:50000,cached_input_tokens:null,cache_write_tokens:10},response_model:'different'},referencePriceSnapshot(reference,'deepseek-flash',null,off));
 assert.equal(Number(r.total_yuan),1.2);assert.equal(r.notes.length,3);assert.match(r.notes[0],/未提供/);assert.match(r.notes[1],/不包含/);
});
