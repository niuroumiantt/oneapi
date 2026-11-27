import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../web/cw.js',import.meta.url),'utf8');
const header=readFileSync(new URL('../../web/site-header.js',import.meta.url),'utf8');
const rowSource=header.slice(header.indexOf(' function profileRow('),header.indexOf(' window.SiteHeader='));
const profileRow=vm.runInNewContext(rowSource+';profileRow',{esc:String});
const drawSource=source.slice(source.indexOf('  let personalPage='),source.indexOf('\n  async function draw()'));
function harness(status='active',options={}){
 const nodes=new Map();const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',dataset:{}});return nodes.get(key);};
 const data={partner:status?{status,legal_name:'测试伙伴',public_code:'VIP12345',bank_verified:true,bank_last4:'1234'}:null,totals:{available_fen:3200},codes:[],contracts:[],payouts:[],...options.data};
 const ctx=vm.createContext({data,base:"/api/cw",staff:false,params:new URLSearchParams('personal=1'),tab:'overview',innerWidth:1280,innerHeight:515,offset:0,viewVersion:1,location:{origin:'https://example.test'},window:{parent:null,SiteHeader:{profileRow}},parent:{postMessage(){}},document:{documentElement:{classList:{add(){}}},querySelector(){return null;}},$:node,esc:v=>String(v??''),money:v=>'¥'+(Number(v||0)/100).toFixed(2),when:v=>v||'—',labels:{requested:'待审核',paid:'已支付'},hasCurrentContract:cs=>cs.some(c=>Date.parse(c.expires_at)>Date.now()),hasPromotionTrial:()=>false,table:(h,r)=>`<table>${h.join('|')}${r}</table>`,form:(a,h,l)=>`<form>${h}${l}</form>`,field:()=>'',discount:()=>'',promotionStatus:()=> '已生效',payLink:code=>'/?cw='+code,employeeInviteCode:'',referrer:'',api:options.api||(async()=>({events:[],has_more:false}))});
 vm.runInContext(drawSource,ctx);
 return {ctx,nodes,data,async draw(tab){ctx.tab=tab;await vm.runInContext("drawPersonalVIP($('#cw-content'),viewVersion)",ctx);return node('#cw-content').innerHTML;}};
}
test('active partner has one five-section navigation, applicants have their progress and profile',async()=>{
 const active=harness();assert.match(await active.draw('profile'),/class="profile-row"[\s\S]*测试伙伴/);assert.match(active.nodes.get('#cw-nav').innerHTML,/概览.*推广码.*收件箱.*佣金与提现.*个人信息与合同/);
 for(const status of ['pending','confirmed','suspended','rejected']){const applicant=harness(status);await applicant.draw('profile');assert.match(applicant.nodes.get('#cw-nav').innerHTML,/申请进度.*申请资料/);assert.doesNotMatch(applicant.nodes.get('#cw-nav').innerHTML,/佣金与提现/);}
});
test('promotion generation still requires eligibility; creation does not bypass verification',async()=>{
 const blocked=harness();assert.match(await blocked.draw('codes'),/完成合同与实名核验/);assert.doesNotMatch(await blocked.draw('new-code'),/生成并启用/);
 const verified=harness('active',{data:{contracts:[{expires_at:'2099-01-01'}]}});assert.match(await verified.draw('codes'),/生成促销码/);assert.match(await verified.draw('new-code'),/生成并启用/);
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

test('overview separates personal usage and states new model cash commission clearly',()=>{
 const h=harness('active',{data:{activity:{promotion:{paid_fen:380000,used_fen:160000,commission_fen:16000},personal:{paid_fen:10000,used_fen:2500}}}});
 h.ctx.monthly={unread:1,latest_statement:{month:'2026-10',totals:{commission_fen:16000}}};
 const html=vm.runInContext('monthlyOverview(monthly)',h.ctx);assert.match(html,/¥3800.00/);assert.match(html,/¥1600.00/);assert.match(html,/已记提成/);assert.match(html,/2026-10 月账单/);assert.match(html,/每月 1 日/);assert.doesNotMatch(html,/待解锁|预计佣金/);assert.match(html,/消费实付 × 10%/);
 vm.runInContext("vipMetricView='personal'",h.ctx);const own=vm.runInContext('monthlyOverview(monthly)',h.ctx);assert.match(own,/本人充值实付.*¥100.00/);assert.match(own,/本人实际消费.*¥25.00/);assert.doesNotMatch(own,/¥3800.00|已记提成/);
 vm.runInContext("vipMetricView='promotion'",h.ctx);assert.match(vm.runInContext('monthlyOverview({})',h.ctx),/首份账单将在下月 1 日生成/);
});
test('inbox shows private PDF versions and does not allow a stale response to overwrite another page',async()=>{
 const item={id:'statement',month:'2026-10',revision:2,read_revision:1,totals:{paid_fen:10000,used_fen:4000,commission_fen:400},versions:[{revision:2},{revision:1}]};
 const h=harness('active',{api:async()=>({items:[item],has_more:false})});const html=await h.draw('inbox');assert.match(html,/未读 · 第 2 版/);assert.match(html,/\/statements\/statement\/pdf\?revision=2/);assert.match(html,/历史版本/);
 let resolve;const late=harness('active',{api:()=>new Promise(r=>resolve=r)});const pending=late.draw('inbox');late.ctx.viewVersion=2;await late.draw('profile');resolve({items:[item]});await pending;assert.match(late.nodes.get('#cw-content').innerHTML,/VIP 编号/);
 const empty=harness('active',{api:async()=>({items:[],has_more:false})});assert.match(await empty.draw('inbox'),/还没有月账单/);
});
test('contracts distinguish unavailable signing, real pending tasks and archived files',async()=>{
 const off=harness();assert.match(await off.draw('contracts'),/暂未开放/);assert.doesNotMatch(await off.draw('contracts'),/去法大大实名并签署|下载已签 PDF/);
 const waiting=harness('active',{data:{signing:{id:'task',status:'pending_person',mode:'sandbox'}}});assert.match(await waiting.draw('contracts'),/内部试签.*待本人实名签署/);assert.match(await waiting.draw('contracts'),/去法大大实名并签署/);
 const archived=harness('suspended',{data:{contracts:[{template_version:'v1',fadada_signing_id:'12345678-1234-1234-1234-123456789abc',verified_at:'2026-11-01',expires_at:'2099-01-01'}]}});assert.match(await archived.draw('contracts'),/下载已签 PDF/);
});

test('promotion list uses scoped totals, hides self codes and keeps three independent metrics',async()=>{
 const h=harness('active',{data:{activity:{promotion:{paid_fen:10000,used_fen:3000,commission_fen:750},codes:[{code_id:'promo',paid_fen:10000,used_fen:3000,commission_fen:750}]},codes:[{id:'promo',code:'PROMO',name:'活动',paid_fen:99999},{id:'self',code:'SELF',is_self_code:true,paid_fen:90000}]}});
 const html=await h.draw('codes');assert.match(html,/客户实付.*¥100.00/);assert.match(html,/消费额度.*¥30.00/);assert.match(html,/已记提成.*¥7.50/);assert.doesNotMatch(html,/¥999.99|SELF|width:|未消费/);
 const empty=vm.runInContext('promotionMoneyStrip({})',h.ctx);assert.doesNotMatch(empty,/NaN|Infinity/);
});
test('creation receipt separates the management name from the customer payment code',async()=>{
 const h=harness();vm.runInContext("createdCode={id:'new',name:'我家大哥',code:'ABCDEFGH',customer_price_percent:65}",h.ctx);
 const html=await h.draw('code-created');assert.match(html,/我家大哥/);assert.match(html,/ABCDEFGH/);assert.match(html,/data-created-confirm/);assert.match(html,/付款前/);assert.match(html,/每月 1 日/);
});

test('common customer entry uses the verified VIP flag and keeps company identities outside the public workspace',()=>{
 const organizationStart=identity.indexOf(' const customerOrganizations='), organizationEnd=identity.indexOf(' function customerHeader(',organizationStart);
 const targetStart=identity.indexOf(' function workspaceTarget('), targetEnd=identity.indexOf(' async function route(',targetStart);
 const orgs=[{id:'staff',company_workspace:'owner'}];
 const context={me:{user:{vip:false},organizations:orgs},localStorage:{getItem:()=>'organization/staff'},spaceKey:'space',readModelIntent:()=>null};
 const target=vm.runInNewContext(identity.slice(organizationStart,organizationEnd)+identity.slice(targetStart,targetEnd)+'workspaceTarget',context);
 assert.equal(target('workspace',true),'personal');
 context.me.user.vip=true;
 assert.equal(target('workspace',true),'personal/vip');
 context.readModelIntent=()=>({scope:'personal',id:'test-model'});
 assert.equal(target('workspace',true),'personal/connect/test-model');
 context.readModelIntent=()=>null;
 context.me.user.vip=false;
 orgs.push({id:'customer-org',role:'owner'});
 assert.equal(target('workspace',true),'organization/customer-org');
});
