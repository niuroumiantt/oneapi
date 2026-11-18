import test from 'node:test';
import assert from 'node:assert/strict';
import {billingRoutes} from '../src/billing.mjs';
for(const [name,enabled,channels,expected] of [
 ['enabled provider remains restricted for a customer outside its allowlist',true,[],'restricted'],
 ['eligible customer sees available channel',true,['alipay_f2f'],'available'],
 ['disabled provider never claims to be connected',false,[],'unavailable']
])test(name,async()=>{
 const routes=new Map(),app={get:(path,...handlers)=>routes.set(path,handlers.at(-1))};
 billingRoutes(app,{query:async()=>({rows:[]})},()=>{},{alipay:{enabled},wechat:{enabled:false}},{channelsFor:()=>channels});
 let result;await routes.get('/api/billing/personal')({customer:{id:'test-user'}},{json:value=>{result=value;}});
 assert.equal(result.recharge.channel_status.alipay_f2f,expected);
 assert.equal(result.recharge.channel_status.wechat_native,'unavailable');
 assert.deepEqual(result.recharge.channels,channels);
 assert.equal(result.payments_enabled,channels.length>0);
});
