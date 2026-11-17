import {HttpError} from './core.mjs';
import {OFFICIAL_MODELS,priceMultiplier} from './official-models.mjs';

// CNY / million tokens; verified against these public pages on this date.
// Exact provider + model matching only: custom endpoints never inherit official prices by name.
export const PRICE_CHECKED_AT='2026-11-17';
export const ESTIMATE_NOTICE='仅为预计费用，不是官方账单。本站无法读取你在官方或第三方平台的实际扣费；实际金额可能受缓存写入或存储、计费时段、套餐折扣、服务档位、额外工具和价格调整等因素影响，请以对应平台账单为准。';
export const REFERENCE_PRICES=[
 ...OFFICIAL_MODELS.filter(m=>m.id!=='deepseek-flash-0910').map(m=>({provider:m.family,model:m.family==='glm'?m.upstreamModel:m.id,rates:m.rates,peak_pricing:m.peakPricing,source_url:m.priceSource,checked_at:PRICE_CHECKED_AT})),
 {provider:'minimax',model:'MiniMax-M3.1-Flash',rates:{input:'1',cached:'0.1',output:'4'},source_url:'https://platform.minimax.cn/docs/pricing/overview',checked_at:PRICE_CHECKED_AT},
];
const validTokens=n=>Number.isSafeInteger(n)&&n>=0;
const SCALE=1000000000000n;
const units=v=>{const [a,b='']=String(v).split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(12,'0').slice(0,12));};
const decimal=v=>`${v/SCALE}.${String(v%SCALE).padStart(12,'0')}`;
const rate=v=>{if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(String(v)))throw new HttpError(400,'预估单价须为 0 至 999999 的非负数，最多 6 位小数，单位为元/百万 Token');return String(v);};

export function referencePriceSnapshot(reference,model,manual,date=new Date(),holidays=new Set()){
 if(manual?.mode==='manual')return {kind:'user_entered',provider:reference.provider,model,currency:'CNY',unit:'CNY_per_million_tokens',rates:{input:rate(manual.input),cached:rate(manual.cached),output:rate(manual.output)},multiplier:1,at:date.toISOString(),label:'用户填写的单价（未核验）'};
 if(manual&&manual.mode!=='auto')throw new HttpError(400,'请选择自动或手动预估单价');
 const price=reference.provider==='custom'?null:REFERENCE_PRICES.find(p=>p.provider===reference.provider&&p.model.toLowerCase()===model.toLowerCase());
 if(!price)return {kind:'unavailable',provider:reference.provider,model,currency:'CNY',at:date.toISOString(),reason:reference.provider==='custom'?'第三方价格由供应商决定，请在运行前填写其单价。':'尚无该模型已核验的官方单价，请在运行前填写单价。'};
 return {...price,kind:'official_list',currency:'CNY',unit:'CNY_per_million_tokens',multiplier:priceMultiplier({peakPricing:price.peak_pricing},date,holidays),at:date.toISOString(),label:'官方公开单价（标准服务）'};
}

export function tokenCharges(usage,rates,multiplier=1){
 if(!validTokens(usage?.input_tokens)||!validTokens(usage?.output_tokens))return null;
 const cached=usage.cached_input_tokens;
 if(cached!=null&&(!validTokens(cached)||cached>usage.input_tokens))return null;
 const counts=[usage.input_tokens-(cached??0),cached??0,usage.output_tokens];
 let total=0n;
 const items=['input','cached','output'].map((key,i)=>{const effective=units(rates[key])*BigInt(multiplier),amount=effective*BigInt(counts[i]);total+=amount;return {kind:key,tokens:counts[i],rate_yuan_per_million:decimal(effective),amount_yuan:decimal((amount+999999n)/1000000n)};});
 return {items,total_yuan:decimal((total+999999n)/1000000n),cache_assumed_uncached:cached==null};
}

export function estimateReference(result,snapshot){
 const base={currency:'CNY',source:snapshot,notice:ESTIMATE_NOTICE};
 if(snapshot.kind==='unavailable')return {...base,status:'unavailable',reason:snapshot.reason};
 if(!['complete','truncated'].includes(result.status))return {...base,status:'unavailable',reason:'请求未完整结束，不能据已收到的片段确定最终费用。'};
 const rates=snapshot.rates;
 const parts=tokenCharges(result.usage,rates,snapshot.multiplier);
 if(!parts)return {...base,status:'unavailable',reason:'接口未返回完整有效的输入/输出 Token 用量，无法估价。'};
 const notes=[];
 if(parts.cache_assumed_uncached)notes.push('接口未提供缓存命中量，暂按所有输入均未命中缓存估算；实际可能更低。');
 if(result.usage.cache_write_tokens>0)notes.push('接口报告了缓存写入，本预估不包含缓存写入或存储费用。');
 if(result.response_model&&result.response_model.toLowerCase()!==snapshot.model.toLowerCase())notes.push('返回模型名与请求不同，仍按请求模型单价估算；请核对供应商账单。');
 return {...base,status:'estimated',...parts,rates,multiplier:snapshot.multiplier,notes};
}

export async function platformBilling(pool,callId,keyId){
 const b=(await pool.query(`SELECT c.status,c.charged_yuan,c.actual_yuan,c.settlement_source,c.price_snapshot,c.input_tokens,c.cached_input_tokens,c.output_tokens,
  x.parts,x.paid_equivalent_yuan,x.cash_booked_yuan
  FROM customer_calls c LEFT JOIN LATERAL (
   SELECT count(*)::int AS parts,sum(u.face_fen*p.cash_fen/p.face_fen)/100 AS paid_equivalent_yuan,sum(u.cash_fen)::numeric/100 AS cash_booked_yuan
   FROM credit_consumptions u JOIN credit_packs p ON p.id=u.pack_id WHERE u.call_id=c.id
  ) x ON true WHERE c.id=$1 AND c.key_id=$2`,[callId,keyId])).rows[0];
 if(!b)return null;
 const settled=b.status==='settled',zero=settled&&Number(b.charged_yuan)===0;
 const usage={input_tokens:b.input_tokens==null?null:Number(b.input_tokens),cached_input_tokens:b.cached_input_tokens==null?null:Number(b.cached_input_tokens),output_tokens:b.output_tokens==null?null:Number(b.output_tokens)};
 const rates=b.price_snapshot,parts=settled&&rates?.input!=null&&rates?.cached!=null&&rates?.output!=null?tokenCharges(usage,rates,Number(rates.multiplier)||1):null;
 return {status:b.status,charged_yuan:b.charged_yuan,settlement_source:b.settlement_source,currency:'CNY',source:'platform_ledger',
  paid_equivalent_yuan:settled?(b.parts>0?b.paid_equivalent_yuan:zero?'0':null):null,
  cash_booked_yuan:settled?(b.parts>0?b.cash_booked_yuan:zero?'0':null):null,
  calculation:parts,price_snapshot:rates,usage,
  notice:'实际扣额来自平台已结算账本；实付消费按本次扣额所用额度包的购买比例折算。现金余额按分累计记账，小额用量可能合并记账。'};
}
