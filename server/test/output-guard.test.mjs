import test from 'node:test';
import assert from 'node:assert/strict';
const init=body=>({method:'POST',headers:{},body:JSON.stringify(body)});
test('known unsafe output limits block before fetch, for streaming and non-streaming callers',async()=>{
 const {routeFetch}=await import('../src/output-guard.mjs');let calls=0;
 const pool={query:async()=>({rows:[{model_id:'unsafe'}]})},send=async()=>{calls++;return new Response('{}')};
 for(const stream of [false,true]){const r=await routeFetch(pool,send,'unsafe','https://supplier/v1/chat/completions',init({model:'unsafe',max_tokens:1,stream}));assert.equal(r.status,503);assert.equal((await r.json()).error.code,'UPSTREAM_OUTPUT_LIMIT_UNSAFE');}
 assert.equal(calls,0,'no supplier request means no new generation charge');
 assert.equal((await routeFetch(pool,send,'safe','u',init({model:'safe'}))).status,200);assert.equal(calls,1);
});
test('cost quarantine is fresh on each request and a failed flag lookup never sends upstream',async()=>{
 const {routeFetch}=await import('../src/output-guard.mjs');let blocked=false,calls=0;
 const send=async()=>{calls++;return new Response('{}')},pool={query:async()=>({rows:blocked?[{model_id:'m'}]:[]})};
 await routeFetch(pool,send,'m','u',init({model:'m'}));blocked=true;
 assert.equal((await routeFetch(pool,send,'m','u',init({model:'m'}))).status,503);assert.equal(calls,1);
 await assert.rejects(routeFetch({query:async()=>{throw Error('DB unavailable')}},send,'m','u',init({model:'m'})));assert.equal(calls,1);
});

test('manual probe wrapper applies the same cost quarantine without blocking model discovery',async()=>{
 const {costSafeFetch}=await import('../src/output-guard.mjs');const sent=[];
 const send=costSafeFetch({query:async()=>({rows:[{model_id:'unsafe'}]})},async(url)=>{sent.push(url);return new Response('{}')});
 assert.equal((await send('https://up/v1/chat/completions',init({model:'unsafe',stream:false}))).status,503);
 assert.equal((await send('https://up/v1/models',{method:'GET'})).status,200);assert.deepEqual(sent,['https://up/v1/models']);
});
