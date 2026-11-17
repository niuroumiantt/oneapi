import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../private/supplier-lab.js',import.meta.url),'utf8');
test('live model table separates recent key probes from production traffic',()=>{
 const ctx=vm.createContext({Date,Set,number:String,esc:String,when:String,upWatch:{interval_minutes:30,last_run:{summary:{suppliers:[{key_results:[{credential_id:'key',shared_credential_ids:['twin'],results:[{model:'GLM',ok:true,ms:470,checked_at:new Date().toISOString()}]}]}]}}}});
 vm.runInContext(source.slice(source.indexOf('function latestModelWatch('),source.indexOf('function liveSection(')),ctx);
 const m={upstream_model:'GLM',routed:true,calls_24h:0,failed_24h:0};const d={models:[{model_id:'GLM',credential_id:'twin'}]};
 const p=ctx.latestModelWatch(m,d);assert.equal(p.ms,470);assert.equal(ctx.watchedLight(m,p)[0],'ok');assert.match(ctx.watchCell(p),/470 ms/);assert.equal(m.calls_24h,0);assert.equal(m.avg_latency,undefined);
 assert.equal(ctx.latestModelWatch(m,{models:[{model_id:'GLM',credential_id:'other'}]}),null);
 assert.equal(ctx.watchedLight(m,{...p,stale:true})[0],'idle');
 assert.equal(ctx.watchedLight(m,{...p,ok:false,error:'timeout'})[0],'bad');
 assert.equal(ctx.watchedLight({...m,paused:true},p)[0],'off');
 assert.equal(ctx.watchedLight(m,{...p,blocked:true})[1],'费用保护拦截');assert.match(ctx.watchCell({...p,blocked:true}),/未发送上游请求/);
 assert.equal(ctx.watchedLight({...m,calls_24h:2,failed_24h:1,last_fail_at:new Date().toISOString()},p)[1],'当前失败');
});
