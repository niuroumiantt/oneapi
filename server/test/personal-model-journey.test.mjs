import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {marketCatalog} from '../src/official-models.mjs';

const source=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const catalog=marketCatalog();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function apiPage({intent=null,balance='0',unallocated=balance,keys=[],models=catalog.slice(0,1)}={}){
 const context=vm.createContext({paidCredit:{models,keys,list_credit_fen:balance,unallocated_fen:unallocated},readModelIntent:()=>intent,personalCatalog:()=>catalog,personalSelected:intent?.id,personalPilot:null,ico:()=>'',esc,personalMoney:n=>`¥${(Number(n)/100).toFixed(2)}`,personalApiConnection:m=>`configuration:${m.id}`});
 return vm.runInContext(section(' function personalApiContent(){',' function paidKeyPanel(){')+'personalApiContent()',context);
}
const intent={id:'deepseek-flash',scope:'personal'};
const key={id:'test',label:'<script>',model_ids:['deepseek-flash'],limit_yuan:'10',used_yuan:'2'};

test('key manager keeps creation in model setup and excludes revoked keys',()=>{
 const html=apiPage({balance:'10000',keys:[key,{...key,id:'revoked',label:'hidden-key',revoked_at:'today'}]});
 assert.match(html,/创建通用 Key/);assert.match(html,/href="#personal\/connect\/all"/);assert.match(html,/href="#personal\/models"/);
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/hidden-key|data-live="paid-create"|api-connection/);
 assert.match(html,/1 \/ 5 把有效 Key/);
 assert.match(html,/>对应模型<\/th>/);assert.match(html,/data-label="消费上限"><b>¥10.00/);assert.match(html,/data-label="已用额度"><b>¥2.00/);
});
test('dedicated creation posts exactly one model even when other models are available',async()=>{
 const calls=[],context=vm.createContext({personalCatalog:()=>catalog,api:async(path,body)=>{calls.push({path,body});return body?{secret:'fake'}:{enabled:true,models:catalog,keys:[key],list_credit_fen:'10000',unallocated_fen:'9000'};}});
 vm.runInContext(section(' async function createPersonalModelKey(', ' function personalRechargeNext('),context);
 await vm.runInContext("createPersonalModelKey('glm-5.3','My tool','10.00')",context);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[1].body)),{label:'My tool',models:['glm-5.3'],limit_yuan:'10.00'});
});
test('dedicated creation rechecks availability, credit, key count and cap before issuing',async()=>{
 const base={enabled:true,models:catalog,keys:[],list_credit_fen:'10000',unallocated_fen:'10000'};
 for(const [patch,limit] of [[{models:[]},'10'],[{list_credit_fen:'0'},'10'],[{keys:Array(5).fill(key)},'10'],[{unallocated_fen:'100'},'10'],[{},'0'],[{},'bad']]){
  let posts=0;const context=vm.createContext({personalCatalog:()=>catalog,api:async(_,body)=>{if(body)posts++;return {...base,...patch};}});
  vm.runInContext(section(' async function createPersonalModelKey(', ' function personalRechargeNext('),context);
  await assert.rejects(vm.runInContext(`createPersonalModelKey('deepseek-flash','label',${JSON.stringify(limit)})`,context));assert.equal(posts,0);
 }
});
test('model intent supports all six catalog entries and rejects stale or invalid persisted data',()=>{
 let stored=null;
 const context=vm.createContext({window:{SemiflyModels:catalog},localStorage:{getItem:()=>stored,setItem:(_,v)=>stored=v}});
 vm.runInContext("const modelIntentKey='test';"+section(' function readModelIntent(){',' function modelIntentNote('),context);
 for(const m of catalog){assert.equal(vm.runInContext(`chooseModelIntent(${JSON.stringify(m.id)},'personal')`,context),true);assert.equal(vm.runInContext('readModelIntent().id',context),m.id);}
 for(const value of ['invalid',JSON.stringify({...intent,at:Date.now()-8*86400000}),JSON.stringify({...intent,scope:'unknown',at:Date.now()}),JSON.stringify({...intent,at:Date.now()+86400000})]){stored=value;assert.equal(vm.runInContext('readModelIntent()',context),null);}
 assert.equal(vm.runInContext("chooseModelIntent('invented','personal')",context),false);
});
test('creation preselects the chosen model, or the saved selection for direct personal entry',()=>{
 for(const [saved,panelOrg,expected] of [[intent,null,1],[null,null,2],[null,{},1]]){
  let html='';
  const context=vm.createContext({panelOrg,personalChosenModels:()=>['deepseek-flash','deepseek-v4-pro'],readModelIntent:()=>saved,personalSelected:'deepseek-flash',esc,form:(_,markup)=>html=markup,document:{querySelector:()=>({dataset:{}})},updatePaidKeyPreview:()=>{}});
  vm.runInContext(section(' function paidKeyCreateForm(credit){'," document.addEventListener('change',e=>{")+`;paidKeyCreateForm(${JSON.stringify({models:catalog.slice(0,3),unallocated_fen:'10000'})});`,context);
  assert.equal((html.match(/name="models"[^>]* checked/g)||[]).length,expected);
 }
});
test('recharge preserves chosen model context and offers a return route before and after funding',()=>{
 const context=vm.createContext({readModelIntent:()=>intent,window:{SemiflyModels:catalog},esc,ico:()=>''});
 vm.runInContext(section(' function personalRechargeNext(data){',' function personalApiConnection('),context);
 for(const balance of ['0','10000']){const html=vm.runInContext(`personalRechargeNext({list_credit_fen:'${balance}'})`,context);assert.match(html,/已记住 DeepSeek Flash/);assert.match(html,/#personal\/connect\/deepseek-flash/);assert.match(html,balance==='0'?/返回 API 配置/:/继续配置 API Key/);}
});
test('my models remembers additions and removals per account without modifying key permissions',()=>{
 const storage=new Map(),me={user:{id:'a'}},paidCredit={keys:[key]},context=vm.createContext({modelIntentKey:'intent',me,paidCredit,personalPilot:null,personalCatalog:()=>catalog,readModelIntent:()=>null,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}});
 vm.runInContext(section(' const personalModelChoices=new Map();',' function personalModelCollection('),context);
 const ids=()=>Array.from(vm.runInContext('personalChosenModels()',context));
 assert.deepEqual(ids(),[]);
 vm.runInContext("setPersonalModelChoice('glm-5.3',true);setPersonalModelChoice('deepseek-flash',false)",context);
 assert.deepEqual(ids(),['glm-5.3']);
 assert.deepEqual(paidCredit.keys[0].model_ids,['deepseek-flash']);
 vm.runInContext('personalModelChoices.clear()',context);
 assert.deepEqual(ids(),['glm-5.3']);
 me.user.id='b';assert.deepEqual(ids(),[]);
 vm.runInContext("setPersonalModelChoice('deepseek-flash',false)",context);assert.deepEqual(ids(),[]);
 assert.equal(vm.runInContext("setPersonalModelChoice('unknown',true)",context),false);
 vm.runInContext('setAllPersonalModels(true)',context);assert.equal(ids().length,6);
 vm.runInContext('setAllPersonalModels(false)',context);assert.deepEqual(ids(),[]);
 assert.deepEqual(paidCredit.keys[0].model_ids,['deepseek-flash']);
});


test('universal key uses all currently open models with one shared spending cap',async()=>{
 const open=[catalog[0],catalog[3],catalog[4]],calls=[];
 const context=vm.createContext({personalCatalog:()=>catalog,api:async(path,body)=>{calls.push({path,body});return body?{secret:'fake'}:{enabled:true,models:open,keys:[],list_credit_fen:'10000',unallocated_fen:'10000'};}});
 vm.runInContext(section(' async function createPersonalModelKey(', ' function personalRechargeNext('),context);
 await vm.runInContext(`createPersonalModelKey('all','通用 Key','10.00',${JSON.stringify(open.map(m=>m.id))})`,context);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[1].body)),{label:'通用 Key',models:open.map(m=>m.id),limit_yuan:'10.00'});
});
test('universal key refuses issuance when no models are open',async()=>{
 let posts=0;
 const context=vm.createContext({personalCatalog:()=>catalog,api:async(_,body)=>{if(body)posts++;return {enabled:true,models:[],keys:[],list_credit_fen:'10000',unallocated_fen:'10000'};}});
 vm.runInContext(section(' async function createPersonalModelKey(', ' function personalRechargeNext('),context);
 await assert.rejects(vm.runInContext("createPersonalModelKey('all','通用 Key','10',['deepseek-flash'])",context));assert.equal(posts,0);
});
test('universal selection survives recharge without changing enterprise model intent',()=>{
 let stored=null;
 const context=vm.createContext({window:{SemiflyModels:catalog},localStorage:{getItem:()=>stored,setItem:(_,v)=>stored=v},esc,ico:()=>''});
 vm.runInContext("const modelIntentKey='test';"+section(' function readModelIntent(){',' function modelIntentNote(')+section(' function personalRechargeNext(data){',' function personalApiConnection('),context);
 assert.equal(vm.runInContext("chooseModelIntent('all','personal')",context),true);
 assert.match(vm.runInContext("personalRechargeNext({list_credit_fen:'0'})",context),/#personal\/connect\/all/);
 assert.equal(vm.runInContext("chooseModelIntent('all','enterprise')",context),false);
});

test('universal key posts only the reviewed subset and never re-adds removed models',async()=>{
 const calls=[],context=vm.createContext({personalCatalog:()=>catalog,api:async(path,body)=>{calls.push({path,body});return body?{secret:'fake'}:{enabled:true,models:catalog,keys:[],list_credit_fen:'10000',unallocated_fen:'10000'};}});
 vm.runInContext(section(' async function createPersonalModelKey(', ' function personalRechargeNext('),context);
 await vm.runInContext("createPersonalModelKey('all','subset','10',['glm-5.3','glm-5.3'])",context);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[1].body)),{label:'subset',models:['glm-5.3'],limit_yuan:'10'});
});
test('universal key rejects empty, unknown and newly unavailable selections before posting',async()=>{
 for(const ids of [[],['unknown'],['glm-5.3']]){
  let posts=0;const context=vm.createContext({personalCatalog:()=>catalog,api:async(_,body)=>{if(body)posts++;return {enabled:true,models:[catalog[0]],keys:[],list_credit_fen:'10000',unallocated_fen:'10000'};}});
  vm.runInContext(section(' async function createPersonalModelKey(', ' function personalRechargeNext('),context);
  await assert.rejects(vm.runInContext(`createPersonalModelKey('all','test','10',${JSON.stringify(ids)})`,context));assert.equal(posts,0);
 }
});
test('universal selection starts with open models and remains scoped to each account',()=>{
 const me={user:{id:'a'}},context=vm.createContext({me,paidCredit:{models:catalog.slice(0,3)},personalConnectDraftKey:id=>me.user.id+':'+id});
 vm.runInContext(section(' const personalUnifiedSelections=new Map();',' function personalConnectModelId()'),context);
 assert.equal(vm.runInContext('personalUnifiedSelectedModels().length',context),3);
 vm.runInContext("personalUnifiedSelections.set('a:all',[])",context);
 assert.equal(vm.runInContext('personalUnifiedSelectedModels().length',context),0);
 me.user.id='b';assert.equal(vm.runInContext('personalUnifiedSelectedModels().length',context),3);
 me.user.id='a';assert.equal(vm.runInContext('personalUnifiedSelectedModels().length',context),0);
});
