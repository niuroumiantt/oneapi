import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../private/supplier-lab.js',import.meta.url),'utf8');
test('historical acceptance preserves failures and timestamps without live status lights',()=>{
 const ctx=vm.createContext({data:{runs:[]},labView:'model',usageData:null,selectedSupplier:'supplier',supplierModel:null,number:String,money:String,when:String,esc:v=>String(v??'').replaceAll('<','&lt;')});
 vm.runInContext(source.slice(source.indexOf('function labState('),source.indexOf('function supplierStyle(')),ctx);
 const m={id:'e',model_id:'GLM',credential_label:'key',disabled_at:'disabled',lifetime_calls:4,month_calls:4,month_tokens:211,issues:3,last_error_code:'<TEST_ERROR>',last_test_at:'2026-11-16 20:00:00',last_latency_ms:1524};
 const html=ctx.labSection({models:[m]});
 assert.match(html,/历史验收 · 本台测试记录/);assert.match(html,/上次测试异常/);assert.match(html,/历史异常 3 笔/);assert.match(html,/2026-11-16 20:00:00/);assert.match(html,/&lt;TEST_ERROR>/);assert.match(html,/Key \/ 型号已停用/);assert.doesNotMatch(html,/lv-light|需诊断|最近正常/);assert.equal(m.issues,3);assert.equal(m.lifetime_calls,4);
 assert.equal(ctx.labState({...m,last_error_code:null})[1],'上次测试无报错');
 assert.equal(ctx.labState({...m,lifetime_calls:0})[1],'暂无验收记录');
 ctx.data.runs=[{status:'running',supplier_endpoint_id:'e'}];assert.equal(ctx.labState(m)[1],'验收执行中');
});
