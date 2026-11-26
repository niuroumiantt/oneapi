import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../web/personal-usage-charts.js',import.meta.url),'utf8');
const boot=source.slice(0,source.indexOf('const fmt'))+'window.PersonalUsageCharts={mount,clear};})();';
const fixture=()=>({models:[{id:'deepseek-flash',name:'DeepSeek Flash'}],days:Array.from({length:92},()=>({date:'2026-11-26',values:['9007199254740993'],total:'9007199254740993'}))});
function harness(){
 const requests=[],renders=[],window={};
 const root=()=>({isConnected:false,setAttribute(){},remove(){this.isConnected=false;}});
 const home=()=>({append(node){node.isConnected=true;}});
 vm.runInNewContext(boot,{window,document:{createElement:root},AbortController,setTimeout,clearTimeout,render:view=>renders.push({owner:view.owner,data:view.data,error:view.error}),fetch:(_url,options)=>new Promise(resolve=>requests.push({resolve,options}))});
 return {ui:window.PersonalUsageCharts,home,requests,renders};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('chart cancels previous account and ignores its late response',async()=>{
 const h=harness(),a=h.home(),b=h.home();h.ui.mount(a,'a');h.ui.mount(a,'a');assert.equal(h.requests.length,1);
 h.ui.mount(b,'b');assert.equal(h.requests[0].options.signal.aborted,true);
 h.requests[0].resolve({ok:true,json:async()=>fixture()});await tick();assert.equal(h.renders.at(-1).owner,'b');assert.equal(h.renders.at(-1).data,null);
 h.requests[1].resolve({ok:true,json:async()=>fixture()});await tick();assert.equal(h.renders.at(-1).data.days[0].total,9007199254740993n);h.ui.clear();
});
test('chart failure stays separate from empty data, and unmount aborts pending work',async()=>{
 const h=harness();h.ui.mount(h.home(),'a');h.requests[0].resolve({ok:false});await tick();assert.equal(h.renders.at(-1).error,true);assert.equal(h.renders.at(-1).data,null);
 h.ui.mount(h.home(),'a');h.ui.clear();assert.equal(h.requests[1].options.signal.aborted,true);const before=h.renders.length;
 h.requests[1].resolve({ok:true,json:async()=>fixture()});await tick();assert.equal(h.renders.length,before);
});
