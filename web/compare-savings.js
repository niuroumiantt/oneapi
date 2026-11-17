/* Shared by the browser and arithmetic regression tests. Amounts stay decimal-exact. */
(function(root,factory){
 'use strict';
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else root.SemiflyCostComparison=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const notice='按本次参照预估价格计算，不是官方实际账单；本站无法读取参照平台的真实扣费。实际费用可能受套餐、缓存、时段及其他因素影响，以对应平台账单为准。不同模型、回答长度和用量的费用差异不代表同等效果下的折扣。';
 function decimal(value){
  if(typeof value!=='string'&&typeof value!=='number')return null;
  const s=String(value);if(!/^\d{1,40}(?:\.\d{1,40})?$/.test(s))return null;
  const [whole,fraction='']=s.split('.');return {units:BigInt(whole+fraction),scale:fraction.length};
 }
 function format(units,scale){
  const negative=units<0n;if(negative)units=-units;
  const s=units.toString().padStart(scale+1,'0');
  const value=scale?(s.slice(0,-scale)+'.'+s.slice(-scale)).replace(/\.?0+$/,''):s;
  return (negative?'-':'')+value;
 }
 function compare(a,b){
  const source=b?.estimate?.source;
  const basis=source?.kind==='official_list'&&source.provider!=='custom'?'official':source?.kind==='user_entered'?'manual':'reference';
  const label=basis==='official'?'按官方预估价计算':basis==='manual'?'按自填单价预估计算':'按参照预估价计算';
  const base={basis,label,notice,currency:'CNY'};
  const unavailable=reason=>({...base,status:'unavailable',reason});
  if(!a||!b)return {...base,status:'waiting',reason:'等待双方完成及平台费用结算后计算。'};
  if(a.status!=='complete'||b.status!=='complete')return unavailable('本次包含失败、停止或不完整结果，不计算节省结论。');
  const bill=a.billing,estimate=b.estimate;
  if(bill?.status!=='settled')return unavailable('平台费用尚未结算，暂不计算差额。');
  if(estimate?.status!=='estimated')return unavailable('参照费用无法估算，暂不计算差额。');
  if(bill.currency!=='CNY'||estimate.currency!=='CNY')return unavailable('双方费用币种不一致或未提供，暂不计算差额。');
  const actual=decimal(actualCost(bill)),expected=decimal(estimate.total_yuan);
  if(!actual||!expected)return unavailable('缺少有效的实付消费或预估金额，暂不计算差额。');
  const scale=Math.max(actual.scale,expected.scale),aUnits=actual.units*10n**BigInt(scale-actual.scale),bUnits=expected.units*10n**BigInt(scale-expected.scale),difference=bUnits-aUnits,absolute=difference<0n?-difference:difference;
  // Round percentage to two decimal places only after exact subtraction and division.
  const hundredths=bUnits===0n?null:(absolute*10000n+bUnits/2n)/bUnits;
  const percent=hundredths===null?null:hundredths===0n&&absolute>0n?'< 0.01':(Number(hundredths)/100).toLocaleString('zh-CN',{maximumFractionDigits:2});
  return {...base,status:'compared',direction:difference>0n?'less':difference<0n?'more':'equal',actual_yuan:format(aUnits,scale),reference_estimate_yuan:format(bUnits,scale),difference_yuan:format(difference,scale),absolute_difference_yuan:format(absolute,scale),percentage:percent,percentage_unavailable_reason:bUnits===0n?'预估费用为 0，无法计算百分比。':null,funding_cost_basis:bill.funding_kind==='allocated'?'企业分配额度购入价为面额的 50%（企业确认）':'实际额度包成交比例',formula:'差额 = 参照预估费用 − 平台真实消费（按购包成交折扣折算）；节省比例 = 差额 ÷ 参照预估费用 × 100%。'};
 }
 function discount(bill){
  if(bill?.status!=='settled')return null;
  const paid=decimal(bill.paid_equivalent_yuan),face=decimal(bill.charged_yuan);if(!paid||!face||face.units===0n)return null;
  const scale=Math.max(paid.scale,face.scale),paidUnits=paid.units*10n**BigInt(scale-paid.scale),faceUnits=face.units*10n**BigInt(scale-face.scale);
  const rounded=(paidUnits*100000n+faceUnits/2n)/faceUnits;
  return (paidUnits*100000n%faceUnits===0n?'':'约 ')+format(rounded,4);
 }
 function actualCost(bill){
  if(bill?.status!=='settled')return null;
  if(bill.funding_kind!=='allocated')return bill.paid_equivalent_yuan;
  const amount=decimal(bill.charged_yuan);return amount?format(amount.units*5n,amount.scale+1):null;
 }
 return {compare,discount,actualCost};
});
