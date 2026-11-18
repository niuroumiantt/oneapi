import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');
const helper=src.slice(src.indexOf(' function purchaseEntry('),src.indexOf(' function overviewContent('));
function render(state={},place='keys',compact=false){const ctx=vm.createContext({panelOrg:null,lastOrgBilling:null,personalBilling:null,paidCredit:null,esc:s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;'),...state});vm.runInContext(helper,ctx);return ctx.purchaseEntry(place,compact);}
test('personal credit entry points to personal billing and explains zero available credit',()=>{
 const html=render({personalBilling:{payments_enabled:true},paidCredit:{list_credit_fen:'100',held_fen:'100'}});assert.match(html,/#billing\/personal/);assert.match(html,/可用额度已用完/);assert.match(html,/充值额度/);assert.match(html,/创建 Key 或设置上限不会增加余额/);
});
test('enterprise members never receive a personal or enterprise purchase link',()=>{
 const state={panelOrg:{organization:{id:'org-a'},permissions:{manager:false}},personalBilling:{payments_enabled:true},paidCredit:{list_credit_fen:'99999',held_fen:'0'}};
 const html=render(state);assert.doesNotMatch(html,/#billing|充值额度|999/);assert.match(html,/#organization\/org-a\/support/);assert.match(html,/无需向个人账户充值/);assert.equal(render(state,'header',true),'');
});
test('enterprise managers see the current organization billing destination',()=>{
 const html=render({panelOrg:{organization:{id:'org-b'},permissions:{manager:true}},lastOrgBilling:{id:'org-other',data:{list_credit_fen:'99999'}},paidCredit:{list_credit_fen:'0',held_fen:'0'}});assert.match(html,/#billing\/organization\/org-b/);assert.doesNotMatch(html,/999|#billing\/personal/);assert.match(html,/当前企业账户/);assert.doesNotMatch(html,/可用额度已用完/);
});
test('unavailable personal payments remain a billing navigation entry without claiming payment is enabled',()=>{
 const html=render({personalBilling:{payments_enabled:false}},'header',true);assert.match(html,/额度与账单/);assert.doesNotMatch(html,/充值额度/);
});
