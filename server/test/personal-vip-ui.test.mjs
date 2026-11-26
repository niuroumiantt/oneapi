import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../web/cw.js',import.meta.url),'utf8');
const drawSource=source.slice(source.indexOf('  let personalPage='),source.indexOf('\n  async function draw()'));
function harness(status='active',options={}){
 const nodes=new Map();const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',dataset:{}});return nodes.get(key);};
 const data={partner:status?{status,legal_name:'测试伙伴',public_code:'VIP12345',bank_verified:true,bank_last4:'1234'}:null,totals:{available_fen:3200},codes:[],contracts:[],payouts:[],...options.data};
 const ctx=vm.createContext({data,base:"/api/cw",staff:false,params:new URLSearchParams('personal=1'),tab:'overview',innerWidth:1280,innerHeight:515,offset:0,viewVersion:1,location:{origin:'https://example.test'},window:{parent:null},parent:{postMessage(){}},document:{documentElement:{classList:{add(){}}},querySelector(){return null;}},$:node,esc:v=>String(v??''),money:v=>'¥'+(Number(v||0)/100).toFixed(2),when:v=>v||'—',labels:{requested:'待审核',paid:'已支付'},hasCurrentContract:cs=>cs.some(c=>Date.parse(c.expires_at)>Date.now()),hasPromotionTrial:()=>false,table:(h,r)=>`<table>${h.join('|')}${r}</table>`,form:(a,h,l)=>`<form>${h}${l}</form>`,field:()=>'',discount:()=>'',employeeInviteCode:'',referrer:'',api:options.api||(async()=>({events:[],has_more:false}))});
 vm.runInContext(drawSource,ctx);
 return {ctx,nodes,data,async draw(tab){ctx.tab=tab;await vm.runInContext("drawPersonalVIP($('#cw-content'),viewVersion)",ctx);return node('#cw-content').innerHTML;}};
}
test('active partner has one five-section navigation, applicants have their progress and profile',async()=>{
 const active=harness();await active.draw('profile');assert.match(active.nodes.get('#cw-nav').innerHTML,/概览.*推广码.*推广明细.*佣金与提现.*合作资料/);
 for(const status of ['pending','confirmed','suspended','rejected']){const applicant=harness(status);await applicant.draw('profile');assert.match(applicant.nodes.get('#cw-nav').innerHTML,/申请进度.*申请资料/);assert.doesNotMatch(applicant.nodes.get('#cw-nav').innerHTML,/佣金与提现/);}
});
test('promotion generation still requires eligibility; creation does not bypass verification',async()=>{
 const blocked=harness();assert.match(await blocked.draw('codes'),/完成合同与实名核验/);assert.doesNotMatch(await blocked.draw('new-code'),/生成并启用/);
 const verified=harness('active',{data:{contracts:[{expires_at:'2099-01-01'}]}});assert.match(await verified.draw('codes'),/生成推广码/);assert.match(await verified.draw('new-code'),/生成并启用/);
});
test('withdrawal explains missing bank and does not show unknown tax as zero',async()=>{
 const h=harness('active',{data:{partner:{status:'active',bank_verified:false},payouts:[{status:'requested',gross_fen:3200,withholding_fen:0}]}});
 const html=await h.draw('payouts');assert.match(html,/data-tab="withdraw" disabled/);assert.match(html,/待核定/);assert.match(html,/审核后确定/);assert.match(html,/填写本人收款账户/);
});
test('withdraw review shows amount and masked bank without submitting a request',async()=>{
 let requests=0;const h=harness('active',{api:async()=>{requests++;}});const html=await h.draw('withdraw');assert.match(html,/¥32.00/);assert.match(html,/尾号 1234/);assert.match(html,/确认提交提现申请/);assert.equal(requests,0);
});
test('late event results cannot overwrite another view and failures have a retry',async()=>{
 let resolve;const late=harness('active',{api:()=>new Promise(r=>resolve=r)});const pending=late.draw('events');assert.match(late.nodes.get('#cw-content').innerHTML,/正在读取/);late.ctx.viewVersion=2;await late.draw('profile');resolve({events:[],has_more:false});await pending;assert.match(late.nodes.get('#cw-content').innerHTML,/VIP 编号/);
 const failed=harness('active',{api:async()=>{throw Error('连接失败');}});assert.match(await failed.draw('events'),/连接失败.*重新读取/);
});
const identity=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');
const labelSource=identity.slice(identity.indexOf(' let personalVipState='),identity.indexOf(' const panelPage='));
test('VIP status messages must come from the current same-origin VIP frame',()=>{
 let listener;const frame={contentWindow:{}};const label={textContent:''};const ctx=vm.createContext({me:{user:{id:'u1'}},host:{querySelector:s=>s.startsWith('iframe')?frame:label},location:{origin:'https://example.test'},window:{addEventListener:(_,fn)=>listener=fn}});vm.runInContext(labelSource,ctx);
 const event={origin:'https://other.test',source:frame.contentWindow,data:{type:'personal-vip-status',status:'active'}};listener(event);assert.equal(label.textContent,'');listener({...event,origin:'https://example.test',source:{}});assert.equal(label.textContent,'');listener({...event,origin:'https://example.test'});assert.equal(label.textContent,'VIP 工作台');
 listener({...event,origin:'https://example.test',data:{type:'personal-vip-status',status:'confirmed'}});assert.equal(label.textContent,'VIP 申请进度');ctx.me={user:{id:'u2'}};assert.equal(vm.runInContext('personalVipLabel()',ctx),'去申请 VIP');
});
