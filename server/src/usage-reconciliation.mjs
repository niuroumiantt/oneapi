import {HttpError,id,hash,transaction,audit} from './core.mjs';
import {requireTechnical} from './workspaces.mjs';
const integer=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const decimal=v=>/^(?:0|[1-9]\d{0,11})(?:\.\d{1,12})?$/.test(String(v))?String(v):null;
const units=v=>{const [a,b='']=String(v).split('.');return BigInt(a)*1000000000000n+BigInt(b.padEnd(12,'0'))};
const format=v=>(v<0n?'-':'')+String((v<0n?-v:v)/1000000000000n)+'.'+String((v<0n?-v:v)%1000000000000n).padStart(12,'0');
export const difference=(a,b)=>a==null||b==null?null:format(units(a)-units(b));
const clean=(v,max=120)=>typeof v==='string'&&v.length<=max?v:null;
// Supplier expressions are evidence, never executable code. This exact grammar is the observed KerAPI base tier.
const suffix=' * (weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") < 6 && hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12 ? 2 : 1) * (weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") < 6 && hour("Asia/Shanghai") >= 14 && hour("Asia/Shanghai") < 18 ? 2 : 1)';
export function redactEvidence(value,key=''){
 if(typeof value==='string')return key?value.replaceAll(key,'[REDACTED]'):value;
 if(Array.isArray(value))return value.map(v=>redactEvidence(v,key));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/^(authorization|api_key|access_token|secret|password|secret_key)$/i.test(k)?'[REDACTED]':redactEvidence(v,key)]));return value;
}
export function normalizeKerapi(row){
 let o={};try{o=typeof row.other==='string'?JSON.parse(row.other):row.other||{}}catch{throw new HttpError(502,'上游计费证据格式异常')}
 const request=clean(row.request_id),model=clean(row.model_name);
 if(!request||!model||!integer(row.created_at))throw new HttpError(502,'上游记录缺少请求号、型号或时间');
 const expr=typeof o.expr_b64==='string'&&o.expr_b64.length<8192?Buffer.from(o.expr_b64,'base64').toString('utf8'):null;
 return {request_id:request,model_id:model,created_at:new Date(row.created_at*1000).toISOString(),type:integer(row.type),
 input_tokens:integer(row.prompt_tokens),output_tokens:integer(row.completion_tokens),cached_input_tokens:integer(o.cache_tokens),
 amount:decimal(o.billing_amount),currency:clean(o.billing_currency?.code,8),quota:integer(row.quota),
 exchange_rate:decimal(o.billing_currency?.exchange_rate),quota_per_unit:integer(o.billing_currency?.quota_per_unit),
 latency_ms:integer(o.duration_ms),ttft_ms:integer(o.frt),billing_mode:clean(o.billing_mode,40),billing_source:clean(o.billing_source,40),
 pricing_ratio:decimal(o.pricing_ratio),expression:expr,
 rules:Array.isArray(o.request_rules)?o.request_rules.slice(0,10).map(r=>({condition:clean(r.cond,1000),multiplier:decimal(r.multiplier),matched:typeof r.matched==='boolean'?r.matched:null})):[],
 raw_log:{...redactEvidence(row),other:JSON.stringify(redactEvidence(o))},raw_other:redactEvidence(o),source_sha256:hash(JSON.stringify(row))};
}
export function recomputeKerapi(local,bill){
 if(bill.currency!=='CNY'||bill.billing_mode!=='tiered_expr'||!bill.expression?.endsWith(suffix))return null;
 const prefix=bill.expression.slice(0,-suffix.length),m=/^\(tier\("base", p \* (\d+\.\d+) \+ c \* (\d+\.\d+) \+ cr \* (\d+\.\d+)\)\)$/.exec(prefix);
 if(!m||m.slice(1).some(v=>!decimal(v))||!bill.quota_per_unit||!bill.exchange_rate||!bill.pricing_ratio||[local.input_tokens,local.output_tokens,local.cached_input_tokens].some(v=>integer(v)===null)||local.cached_input_tokens>local.input_tokens)return null;
 // Timestamp is supplier log time, which can straddle a pricing boundary. Such cases remain unverified.
 const at=new Date(bill.created_at);at.setUTCHours(at.getUTCHours()+8);const hour=at.getUTCHours(),day=at.getUTCDay();
 const started=local.checks?.started_at;if(started){const st=new Date(started);st.setUTCHours(st.getUTCHours()+8);if(st.getUTCHours()!==hour||st.getUTCDate()!==at.getUTCDate())return null}
 const peak=day>=1&&day<6&&((hour>=9&&hour<12)||(hour>=14&&hour<18));
 const base=BigInt(local.input_tokens-local.cached_input_tokens)*units(m[1])+BigInt(local.output_tokens)*units(m[2])+BigInt(local.cached_input_tokens)*units(m[3]);
 const numerator=base*BigInt(peak?2:1)*units(bill.pricing_ratio)*BigInt(bill.quota_per_unit),denominator=1000000n*1000000000000n*1000000000000n;
 const quota=(numerator+denominator/2n)/denominator;
 const amount=quota*units(bill.exchange_rate)/BigInt(bill.quota_per_unit);
 return {amount:format(amount),quota:String(quota),peak,multiplier:peak?2:1,source:'supplier_expression',rounding:'nearest_quota_unit',contract_verified:false};
}
export function reconcile(local,candidates){
 if(!local.upstream_request_id)return {status:'missing_request_id',differences:[]};
 if(!candidates.length)return {status:'pending',differences:[]};
 if(candidates.length!==1)return {status:'ambiguous',differences:[]};
 const b=candidates[0],diffs=[],missing=[];
 if(b.model_id!==local.model_id)diffs.push('model');
 for(const field of ['input_tokens','cached_input_tokens','output_tokens']){if(local[field]==null||b[field]==null)missing.push(field);else if(local[field]!==b[field])diffs.push(field)}
 const rule=recomputeKerapi(local,b),expected=local.estimated_cost_yuan??rule?.amount??null;
 const costDelta=b.currency==='CNY'?difference(b.amount,expected):null;
 if(costDelta!==null&&units(costDelta)!==0n)diffs.push('amount');
 if(costDelta===null)missing.push('amount');
 return {status:diffs.length?'different':missing.length?'incomplete':'matched',differences:diffs,missing,bill:b,expected_amount:expected,
 expected_source:local.estimated_cost_yuan!=null?'recorded_procurement_rate':rule?'supplier_rule_recalculation':'unknown',cost_difference:costDelta,
 latency_difference_ms:b.latency_ms==null?null:local.latency_ms-b.latency_ms,rule,contract_verified:false};
}
async function jsonLimited(response){if(!response.ok){await response.body?.cancel();throw new HttpError(502,'上游只读接口返回 HTTP '+response.status)}const reader=response.body.getReader();let size=0,chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2097152)throw new HttpError(502,'上游日志超过单次读取上限');chunks.push(value)}return JSON.parse(Buffer.concat(chunks).toString())}finally{await reader.cancel().catch(()=>{})}}
export async function syncKerapi(pool,box,credentialId,actor){
 if(!box)throw new HttpError(503,'凭据服务未配置');
 const credential=(await pool.query(`SELECT c.* FROM supplier_lab_credentials c JOIN supplier_lab_suppliers s ON s.id=c.supplier_id JOIN suppliers p ON p.id=s.canonical_supplier_id WHERE c.id=$1 AND c.disabled_at IS NULL AND s.disabled_at IS NULL AND p.status<>'blocked'`,[credentialId])).rows[0];
 if(!credential)throw new HttpError(404,'有效 Key 不存在');
 if(new URL(credential.base_url).origin!=='https://kerapi.cn')throw new HttpError(400,'此连接目前仅支持 KerAPI');
 const db=await pool.connect();let locked=false;
 try{
  locked=(await db.query('SELECT pg_try_advisory_lock(148921,10) AS ok')).rows[0].ok;if(!locked)throw new HttpError(409,'已有上游同步正在进行');
  const recent=(await db.query("SELECT id FROM supplier_usage_syncs WHERE credential_id=$1 AND created_at>now()-interval '30 seconds' ORDER BY created_at DESC LIMIT 1",[credentialId])).rows[0];if(recent)return {cached:true,sync_id:recent.id};
  const key=box.open(credential.credential_ciphertext).key;
  const payload=await jsonLimited(await fetch('https://kerapi.cn/api/log/token',{headers:{Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(15000)}));
  if(payload.success!==true||!Array.isArray(payload.data)||payload.data.length>2000)throw new HttpError(502,'上游用量返回格式异常');
  const rows=payload.data.map(r=>normalizeKerapi(redactEvidence(r,key)));
  if(new Set(rows.map(x=>x.request_id)).size!==rows.length)throw new HttpError(502,'上游返回重复请求号，无法自动核对');
  return await transaction(pool,async q=>{
   const sync=(await q.query(`INSERT INTO supplier_usage_syncs(credential_id,record_count,response_sha256,created_by) VALUES($1,$2,$3,$4) RETURNING id,created_at`,[credentialId,rows.length,hash(JSON.stringify(payload)),actor.id])).rows[0];
   for(const row of rows){await q.query(`INSERT INTO supplier_usage_versions(credential_id,request_id,source_sha256,evidence,sync_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[credentialId,row.request_id,row.source_sha256,row,sync.id]);await q.query(`INSERT INTO supplier_usage_records(credential_id,request_id,model_id,occurred_at,evidence,sync_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(credential_id,request_id) DO UPDATE SET model_id=EXCLUDED.model_id,occurred_at=EXCLUDED.occurred_at,evidence=EXCLUDED.evidence,sync_id=EXCLUDED.sync_id,updated_at=now()`,[credentialId,row.request_id,row.model_id,row.created_at,row,sync.id]);}
   await audit(q,actor,'supplier_usage.synced',null,credentialId,{sync_id:sync.id,records:rows.length,scope:'key_recent_records'});return {...sync,record_count:rows.length,scope:'key_recent_records'};
  });
 }finally{if(locked)await db.query('SELECT pg_advisory_unlock(148921,10)');db.release()}
}
export async function usageView(pool,supplierId){
 const creds=(await pool.query(`SELECT c.id,c.label,c.base_url,c.disabled_at FROM supplier_lab_credentials c JOIN supplier_lab_suppliers s ON s.id=c.supplier_id WHERE s.canonical_supplier_id=$1`,[supplierId])).rows;
 const ids=creds.map(c=>c.id);
 const records=(await pool.query(`SELECT credential_id,evidence,updated_at FROM supplier_usage_records WHERE credential_id=ANY($1::uuid[]) ORDER BY occurred_at DESC LIMIT 2000`,[ids])).rows;
 const local=(await pool.query(`SELECT t.*,e.model_id,e.credential_id FROM supplier_lab_transactions t JOIN supplier_lab_endpoints e ON e.id=t.endpoint_id WHERE e.credential_id=ANY($1::uuid[]) ORDER BY t.created_at DESC LIMIT 200`,[ids])).rows;
 const syncs=(await pool.query(`SELECT DISTINCT ON(credential_id) credential_id,record_count,created_at FROM supplier_usage_syncs WHERE credential_id=ANY($1::uuid[]) ORDER BY credential_id,created_at DESC`,[ids])).rows;
 const models=new Map();for(const r of records){const b=r.evidence,key=r.credential_id+'|'+b.model_id;let m=models.get(key);if(!m){m={credential_id:r.credential_id,model_id:b.model_id,calls:0,month_calls:0,input:0,output:0,cache:0,cache_unknown:0,amount:null,unpriced:0,latest:b,first_at:b.created_at};models.set(key,m)}m.calls++;if(new Date(Date.parse(b.created_at)+28800000).toISOString().slice(0,7)===new Date(Date.now()+28800000).toISOString().slice(0,7))m.month_calls++;m.input+=b.input_tokens??0;m.output+=b.output_tokens??0;m.cache+=b.cached_input_tokens??0;if(b.cached_input_tokens===null)m.cache_unknown++;if(b.currency==='CNY'&&b.amount!==null)m.amount=format(units(m.amount||'0')+units(b.amount));else m.unpriced++;m.first_at=b.created_at}
 return {credentials:creds,syncs,upstream_records:records,scope:'synced_key_records_not_complete_account_bill',models:[...models.values()],rows:local.map(t=>({id:t.id,run_id:t.run_id,case_id:t.case_id,created_at:t.created_at,model_id:t.model_id,credential_id:t.credential_id,upstream_request_id:t.upstream_request_id,input_tokens:t.input_tokens,cached_input_tokens:t.cached_input_tokens,output_tokens:t.output_tokens,latency_ms:t.latency_ms,estimated_cost_yuan:t.estimated_cost_yuan,...reconcile(t,records.filter(r=>r.credential_id===t.credential_id&&r.evidence.request_id===t.upstream_request_id).map(r=>r.evidence))}))};
}
export function usageRoutes(app,pool,requireStaff,box){
 app.post('/api/staff/lab/credentials/:id/sync-usage',requireStaff,async(req,res)=>{requireTechnical(req);res.json(await syncKerapi(pool,box,id(req.params.id),req.actor))});
 app.get('/api/staff/lab/usage-reconciliation',requireStaff,async(req,res)=>{requireTechnical(req);res.json(await usageView(pool,id(req.query.supplier_id)))});
}
