import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');
const moneyCode=source.slice(source.indexOf(' const billingQuotaMoney='),source.indexOf(' const billingPager='));
const money=vm.runInNewContext(moneyCode+';billingQuotaMoney');
test('billing keeps sub-cent consumption visible without rounding it into cash or losing large integer precision',()=>{
 assert.equal(money('0.1250000000'),'¥0.00125');assert.equal(money('250.0000000000'),'¥2.50');assert.equal(money('0'),'¥0.00');
 assert.equal(money('0.0000000001'),'< ¥0.000001');assert.equal(money('9007199254740993123'),'¥90071992547409931.23');
});
test('personal billing detail navigation never reuses global data-view routing',()=>{
 const section=source.slice(source.indexOf(' async function personalBillingPage('),source.indexOf(' async function billingPage('));
 assert.doesNotMatch(section,/data-view=/);assert.match(section,/data-billing-view="invoice-history"/);assert.match(section,/const billingRecordCache=\{\}/);
});
test('paid recharge resumes the selected model or universal Key instead of losing the model journey',()=>{
 const code=source.slice(source.indexOf(' function personalRechargeCompact('),source.indexOf(' async function personalBillingPage('));
 for(const [intent,target] of [[{scope:'personal',id:'deepseek-flash'},'#personal/connect/deepseek-flash'],[{scope:'personal',id:'all'},'#personal/connect/all'],[null,'#personal/keys']]){
  const context=vm.createContext({PAY_CHANNELS:{alipay_f2f:{}},payChannel:'alipay_f2f',alipayPay:{scope:'personal',order:{status:'paid'}},readModelIntent:()=>intent,esc:x=>x,ico:()=>'',btn:()=>'',rechargeBreakdown:()=>''});
  const html=vm.runInContext(code+";personalRechargeCompact({recharge:{channels:['alipay_f2f']}})",context);
  assert.ok(html.includes(`href="${target}"`));assert.match(html,/充值成功/);
 }
});
