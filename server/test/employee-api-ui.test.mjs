import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');
const adapter=readFileSync(new URL('../../web/employee-api-context.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const data={enabled:true,available_yuan:'37.25',spent_yuan:'12.35',models:[{id:'model',name:'Model'}],model_ids:['model'],base_url:'https://test.invalid/v1',keys:[{id:'own',label:'Own Key',model_ids:null,limit_yuan:null,used_yuan:'12.35'}]};
function context(){const requests=[],window={};vm.runInNewContext(adapter,{window,fetch:async(path,options)=>{requests.push({path,options});return {ok:true,json:async()=>path.endsWith('/status')?data:{key:{id:'own'}}};}});return {context:window.EmployeeApiContext,requests};}
test('company adapter maps only own endpoints and keeps shared quota separate from key caps',async()=>{
 const {context:c,requests}=context();const status=await c.request('/api/customer-credit/status');
 assert.equal(status.list_credit_fen,'3725');assert.equal(status.unallocated_fen,'3725');assert.equal(status.keys[0].limit_yuan,null);assert.deepEqual(Array.from(status.keys[0].model_ids),['model']);
 await c.request('/api/customer-credit/keys/own/limit',{limit_yuan:'20'});assert.equal(requests[1].path,'/api/staff/self-api/keys/own/manage');assert.deepEqual(JSON.parse(requests[1].options.body),{limit_yuan:'20',label:'Own Key'});
 for(const path of ['/api/billing/personal','/api/customer-credit/packs','/api/customer-credit/status?org=other','/api/employee-credit/team'])await assert.rejects(c.request(path));
 assert.equal(requests.length,2);
});
test('same personal key template renders company mode without payment flows',()=>{
 const {context:c}=context(),paidCredit=c.normalize(data);
 const html=vm.runInNewContext(section(' function personalApiContent(){',' function paidKeyPanel(){')+'personalApiContent()',{employeeApi:c,paidCredit,ico:()=>'',esc:x=>String(x??''),personalMoney:n=>String(n)});
 assert.match(html,/class="personal-api api-key-manager"/);assert.match(html,/所有 Key 共用公司额度/);assert.match(html,/共用公司额度/);assert.match(html,/data-live="paid-limit"/);assert.doesNotMatch(html,/充值|购买|支付|退款|billing\/personal/);
});
test('shared overview uses company balance and preserves personal purchase affordance outside employee mode',()=>{
 const {context:c}=context();const ctx={employeeApi:c,paidCredit:c.normalize(data),personalBilling:c.billing(data),personalPilot:null,ico:()=>'',esc:x=>x,personalMoney:n=>String(n),personalBalanceBar:()=>'<div>personal balance</div>',personalScopedBalance:()=>'<div>scope balance</div>',personalCompactViews:{home:'balance'},compactSections:()=>''};
 const render=()=>vm.runInNewContext(section('function personalHomeContent(){','function overviewContent(){')+'personalHomeContent()',ctx);
 assert.match(render(),/公司可用额度/);assert.doesNotMatch(render(),/billing\/personal|充值|查看账单/);
 ctx.employeeApi=null;assert.match(render(),/billing\/personal/);
});

test('old company links land in the unified employee or owner workspaces without reclassifying outside organizations',()=>{
 const target=vm.runInNewContext(section(' function companyWorkspaceTarget(',' function personalRedirect(')+'companyWorkspaceTarget',{});
 const orgs=[{id:'current-company',company_workspace:'employee'},{id:'other-company'}];
 for(const [from,to] of Object.entries({
  'organization/current-company':'console/business/apioverview',
  'organization/current-company/models':'console/business/apimodels',
  'organization/current-company/keys':'console/business/apikeys',
  'organization/current-company/usage':'console/business/apiusage',
  'organization/current-company/compare':'console/business/apicompare',
  'organization/current-company/support':'console/business/tickets',
  'billing/organization/current-company':'console/business/apioverview',
  'organization/other-company/models':'',
  'personal/vip':'',
 }))assert.equal(target(from,orgs),to,from);
 assert.equal(target('organization/current-company/people',[{id:'current-company',company_workspace:'owner'}]),'staff-team');
 assert.doesNotMatch(source,/personal-console-grid|live-employee-create|live-direct-create/);
});
