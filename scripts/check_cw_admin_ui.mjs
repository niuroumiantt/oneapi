import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
// Run with an isolated local fixture and a dedicated Chrome DevTools instance.
// Usage: node scripts/check_cw_admin_ui.mjs <fixture.json> [http://127.0.0.1:9336]
assert.ok(process.argv[2], 'Pass the local CW fixture JSON path');
const fixture=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const cdp=process.argv[3] || 'http://127.0.0.1:9336';
for (const url of [fixture.origin, cdp]) assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname), 'Only isolated localhost test environments are allowed');
const tab=await(await fetch(cdp+'/json/new?about:blank',{method:'PUT'})).json();const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let seq=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const x=JSON.parse(e.data);if(x.id){pending.get(x.id)?.(x);pending.delete(x.id);}if(x.method==='Runtime.exceptionThrown')errors.push(x.params.exceptionDetails.text);};
const cmd=(method,params={})=>new Promise(r=>{const id=++seq;pending.set(id,r);ws.send(JSON.stringify({id,method,params}));});const ev=async expression=>(await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.result?.value;
const pause=()=>new Promise(r=>setTimeout(r,300));const ready=async expression=>{for(let i=0;i<30;i++){if(await ev(expression))return;await pause();}throw Error('Not ready: '+expression);};
await cmd('Page.enable');await cmd('Runtime.enable');await cmd('Network.enable');await cmd('Network.setCacheDisabled',{cacheDisabled:true});

const checks=[];
await cmd('Network.setCookies',{cookies:fixture.staffCookies.map(([name,value])=>({name,value,url:fixture.origin}))});
await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await cmd('Page.navigate',{url:fixture.origin+'/cw.html?staff=1'});await ready("document.querySelector('[data-partner]')");
assert.equal(await ev('document.title'),'CW 合作伙伴管理 · semifly.ai');
for(const section of ['manage','settlement']){
 await ev(`document.querySelector('#cw-nav [data-tab="${section}"]').click()`);
 assert.equal(await ev("document.querySelector('#cw-content button[data-tab=overview]').textContent"),'返回合作伙伴列表');
 await ev("document.querySelector('#cw-content button[data-tab=overview]').click()");
 await ready("document.querySelector('[data-partner]')");
}
checks.push('unselected tabs have a working return action');
await ev("document.querySelector('[data-partner]').click()");await ready("document.querySelector('[data-code-review]')");
await ev("document.querySelector('#cw-nav [data-tab=settlement]').focus();document.querySelector('#cw-nav [data-tab=settlement]').click()");
assert.equal(await ev('document.activeElement.dataset.tab'),'settlement');
assert.deepEqual(await ev("[...document.querySelectorAll('#cw-content h3')].map(x=>x.textContent)"),['客户付款订单','付款与使用明细','提现申请与付款结果']);
await ev("document.querySelector('#cw-content').scrollTop=300;document.querySelector('#cw-nav [data-tab=manage]').click()");
assert.equal(await ev("document.querySelector('#cw-content').scrollTop"),0);
checks.push('keyboard focus and content scroll remain correct across tabs');
assert.ok(await ev("document.querySelector('[data-action=contract] input[type=checkbox]').required"));
await ev("document.querySelector('[data-code-review]').click()");
assert.ok(await ev("document.querySelector('[data-action=code-review] input[name=ends_at]').required"));
checks.push('contract and code approval retain required confirmation fields');
// Simulate a failed detail refresh; never mutate the real provider or database.
await ev("window.auditFetch=window.fetch;window.fetch=async(p,o)=>String(p).includes('/api/staff/cw/')&&!o?.method?new Response(JSON.stringify({error:'AUDIT detail unavailable'}),{status:500,headers:{'Content-Type':'application/json'}}):auditFetch(p,o);document.querySelector('#refresh').click()");
await ready("document.querySelector('#cw-content h2')?.textContent==='加载未完成'");
assert.equal(await ev("document.querySelectorAll('[data-action]').length"),0);
assert.equal(await ev("document.querySelectorAll('#cw-nav button').length"),0);
await ev("window.fetch=auditFetch;document.querySelector('#refresh').click()");await ready("document.querySelector('#cw-nav [data-tab=overview]')");
await ev("document.querySelector('#cw-content button[data-tab=overview]').click()");await ready("document.querySelector('[data-partner]')");
checks.push('detail failure removes stale forms and refresh recovers');
await ev("document.querySelector('[data-partner]').click()");await ready("document.querySelector('[data-code-review]')");
await ev("window.fetch=async()=>new Response(JSON.stringify({error:'AUDIT session expired'}),{status:401,headers:{'Content-Type':'application/json'}});document.querySelector('#refresh').click()");
await ready("document.querySelector('#cw-content h2')?.textContent==='登录已过期'");
assert.equal(await ev("document.querySelectorAll('#cw-nav button,[data-action],[data-code-review]').length"),0);
assert.equal(await ev("document.querySelector('#cw-content').inert"),false);
checks.push('expired session removes cached partner data and all forms');
await ev("window.fetch=auditFetch;document.querySelector('#refresh').click()");await ready("document.querySelector('#cw-nav [data-tab=overview]')");
// Simulate a company with zero partners for all three empty-state tabs.
await ev("window.fetch=async(p,o)=>String(p)==='/api/staff/cw'?new Response(JSON.stringify({enabled:true,partners:[]}),{status:200,headers:{'Content-Type':'application/json'}}):auditFetch(p,o);document.querySelector('#refresh').click()");await pause();
for(const section of ['overview','manage','settlement']){await ev(`document.querySelector('#cw-nav [data-tab="${section}"]').click()`);assert.ok(await ev("document.querySelector('#cw-content h2')"));}
checks.push('all three tabs render meaningful empty states');
assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors}));ws.close();
