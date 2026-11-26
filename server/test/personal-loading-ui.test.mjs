import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../../web/'+name,import.meta.url),'utf8');
const identity=read('identity.js'),account=identity.slice(identity.indexOf(' async function account('),identity.indexOf(' // 同一套页眉'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
test('comparison mounts without waiting on four unrelated dashboard endpoints',async()=>{
 let mounts=0;const ctx={me:{user:{}},current:'personal/compare',panelPage:(_o,tab,body)=>{assert.equal(tab,'compare');return body;},comparePanel:()=>'<iframe>',mount:()=>mounts++,api:()=>{throw Error('unnecessary account request');}};
 await vm.runInNewContext(account+';account(1)',ctx);assert.equal(mounts,1);
});
test('dashboard reads start together and stale responses never replace current account data',async()=>{
 const calls=[],waits=[];const ctx={me:{user:{}},current:'personal/overview',generation:1,personalBilling:'unchanged',paidCredit:'unchanged',readModelIntent:()=>null,api:path=>{calls.push(path);const d=deferred();waits.push(d);return d.promise;}};
 const work=vm.runInNewContext(account+';account(1)',ctx);
 assert.equal(calls.length,4);ctx.generation=2;for(const d of waits)d.resolve({enabled:true});await work;
 assert.equal(ctx.personalBilling,'unchanged');assert.equal(ctx.paidCredit,'unchanged');
});
const source=read('compare.js'),boot=source.slice(source.lastIndexOf("api('config').then"),source.lastIndexOf('})();'));
function harness(){
 const pending=deferred(),classes=new Set(['compare-booting']),elements=new Map();const node=()=>({hidden:false,textContent:'',append(){},replaceChildren(){}});
 const $=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};let result;
 const ctx={api:()=>pending.promise,$,models:[],config:null,Option:function(){},document:{body:{classList:{remove:c=>classes.delete(c)}},documentElement:{classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}},createElement:node,querySelectorAll:()=>[]},window:{PersonalCompare:{unavailable:(status)=>{result=status}}},location:{reload(){}},updateProvider(){},chooseProduct(){}};
 const done=vm.runInNewContext(boot,ctx);return {pending,classes,$,done,get result(){return result}};
}
test('eligibility remains loading until resolution, then chooses funded or recharge without exposing a premature form',async()=>{
 assert.match(read('compare.html'),/class="compare-page compare-booting"/);assert.match(read('compare.css'),/body\.compare-booting[\s\S]+display:none!important/);
 for(const status of [200,401,402,503,408]){
  const h=harness();assert.ok(h.classes.has('compare-booting'));
  if(status===200)h.pending.resolve({models:[{id:'a',name:'A'}],products:[{account_id:'p',name:'P'}]});else h.pending.reject(status===408?Object.assign(Error(),{name:'TimeoutError'}):Object.assign(Error('fixture'),{status}));
  await h.done;assert.equal(h.classes.has('compare-booting'),false);assert.equal(h.$('compare-loading').hidden,true);assert.equal(h.classes.has('compare-unavailable'),status!==200);if(status!==200)assert.equal(h.result,status);
 }
});
