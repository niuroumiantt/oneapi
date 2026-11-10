import express from 'express';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { HttpError,hash,id,text,token,transaction,audit,vault } from './core.mjs';

// Fixed by the business decision: one 10-yuan grant per employee, never topped up automatically.
export const GRANT_YUAN='10.000000000000';
const MAX_KEYS=5,MAX_CONCURRENT=3,PER_MINUTE=60,DEFAULT_OUTPUT=4096,MAX_OUTPUT=8192,MAX_MESSAGES=500;
// KerAPI's observed time-of-day rule doubles the base price; holds must cover it.
const PEAK_MULTIPLIER=2n;
const UPSTREAM_TIMEOUT_MS=300000,STALE_PENDING='15 minutes',BILL_GRACE='24 hours';
const KERAPI_ORIGIN='https://kerapi.cn';
const SCALE=1000000000000n;
const keyPattern=/^Bearer (sf_emp_[A-Za-z0-9_-]{43})$/;
const decimalPattern=/^\d{1,12}(\.\d{1,12})?$/;
const OPEN="status IN ('pending','awaiting_bill')";

const units=v=>{const [whole,fraction='']=String(v).split('.');return BigInt(whole)*SCALE+BigInt(fraction.padEnd(12,'0').slice(0,12));};
const format=v=>`${v/SCALE}.${String(v%SCALE).padStart(12,'0')}`;
const tokens=v=>Number.isSafeInteger(v)&&v>=0?v:null;

/** Upper bound for a call at peak pricing, rounded up to the ledger's precision. */
export function holdYuan(rate,{input,cached=0,output}){
 const base=BigInt(input-cached)*units(rate.input)+BigInt(cached)*units(rate.cached??rate.input)+BigInt(output)*units(rate.output);
 return format((base*PEAK_MULTIPLIER+999999n)/1000000n);
}

/** Validates the caller's body and returns the upstream payload plus its billing bound. */
export function employeeRequest(body,allowed){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'请求必须是 JSON 对象');
 if(!allowed.has(body.model))throw new HttpError(403,'这个模型未开放给公司额度');
 if(!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>MAX_MESSAGES)throw new HttpError(400,`messages 需包含 1 至 ${MAX_MESSAGES} 条消息`);
 if(body.n!==undefined&&body.n!==1)throw new HttpError(400,'公司额度仅支持 n=1');
 if(body.max_tokens!==undefined&&body.max_completion_tokens!==undefined)throw new HttpError(400,'max_tokens 与 max_completion_tokens 只能传一个');
 const output=body.max_tokens??body.max_completion_tokens??DEFAULT_OUTPUT;
 if(!Number.isInteger(output)||output<1||output>MAX_OUTPUT)throw new HttpError(400,`max_tokens 必须在 1 至 ${MAX_OUTPUT} 之间`);
 const {max_completion_tokens:_ignored,...rest}=body,stream=body.stream===true;
 const payload={...rest,max_tokens:output,stream};
 if(stream)payload.stream_options={...(body.stream_options||{}),include_usage:true};
 // One token never encodes fewer than one UTF-8 byte of the serialized prompt.
 const input=Buffer.byteLength(JSON.stringify({messages:body.messages,tools:body.tools,functions:body.functions}));
 return {payload,stream,input,output};
}

export function usageFrom(usage){
 const input=tokens(usage?.prompt_tokens),output=tokens(usage?.completion_tokens);
 if(input===null||output===null)return null;
 const cached=tokens(usage?.prompt_tokens_details?.cached_tokens??usage?.prompt_cache_hit_tokens??0);
 return {input,output,cached:cached===null||cached>input?0:cached};
}

function enabled(cfg){return Boolean(cfg.employeeCredit?.organizationId&&cfg.employeeCredit?.models?.size&&process.env.SUPPLIER_LAB_SECRET);}

async function endpoints(db,cfg,modelIds=[...cfg.employeeCredit.models]){
 const rows=(await db.query(`SELECT DISTINCT ON (e.model_id) e.model_id,e.base_url,e.credential_id,c.credential_ciphertext,
  e.input_yuan_per_m AS input,coalesce(e.cached_input_yuan_per_m,e.input_yuan_per_m) AS cached,e.output_yuan_per_m AS output
  FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id JOIN supplier_lab_suppliers s ON s.id=e.supplier_id
  WHERE e.model_id=ANY($1::text[]) AND e.kind='supplier' AND e.disabled_at IS NULL AND c.disabled_at IS NULL AND s.disabled_at IS NULL
   AND e.input_yuan_per_m IS NOT NULL AND e.output_yuan_per_m IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM suppliers p WHERE p.id=s.canonical_supplier_id AND p.status='blocked')
  ORDER BY e.model_id,e.created_at DESC`,[modelIds])).rows;
 return rows.filter(r=>{try{return new URL(r.base_url).origin===KERAPI_ORIGIN;}catch{return false;}});
}

async function activeMember(db,cfg,userId){
 return (await db.query("SELECT o.id,o.name FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active'",[cfg.employeeCredit.organizationId,userId])).rows[0];
}

/** Grants the one-time allowance. The primary key on user_id makes repeat calls and re-joins no-ops. */
async function ensureAccount(pool,cfg,req){
 return transaction(pool,async db=>{
  const created=(await db.query('INSERT INTO employee_credit_accounts(user_id,organization_id,granted_yuan) VALUES($1,$2,$3) ON CONFLICT(user_id) DO NOTHING RETURNING granted_yuan',[req.customer.id,cfg.employeeCredit.organizationId,GRANT_YUAN])).rows[0];
  if(created)await audit(db,req.actor,'employee_credit.granted',cfg.employeeCredit.organizationId,req.customer.id,{yuan:GRANT_YUAN});
  return (await db.query('SELECT * FROM employee_credit_accounts WHERE user_id=$1',[req.customer.id])).rows[0];
 });
}

async function balance(db,userId){
 return (await db.query(`SELECT a.granted_yuan,a.spent_yuan,coalesce(h.held,0) AS held_yuan,a.granted_yuan-a.spent_yuan-coalesce(h.held,0) AS available_yuan
  FROM employee_credit_accounts a LEFT JOIN LATERAL (SELECT sum(hold_yuan) AS held FROM employee_calls WHERE owner_id=a.user_id AND ${OPEN}) h ON true WHERE a.user_id=$1`,[userId])).rows[0];
}

export function employeeCreditRoutes(app,pool,cfg,requireCustomer){
 const member=async req=>{
  if(!enabled(cfg))return null;
  return activeMember(pool,cfg,req.customer.id);
 };
 const requireMember=async req=>{if(!await member(req))throw new HttpError(403,'当前账号不是公司员工，未开放公司额度');return ensureAccount(pool,cfg,req);};
 app.get('/api/employee-credit/status',requireCustomer,async(req,res)=>{
  const organization=await member(req);
  if(!organization)return res.json({enabled:false});
  await ensureAccount(pool,cfg,req);
  const [money,keys,calls,available]=await Promise.all([
   balance(pool,req.customer.id),
   pool.query('SELECT id,label,key_hint,created_at,revoked_at FROM employee_api_keys WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 20',[req.customer.id]),
   pool.query('SELECT c.id,k.label AS key_label,c.model_id,c.status,c.hold_yuan,c.charged_yuan,c.settlement_source,c.input_tokens,c.cached_input_tokens,c.output_tokens,c.latency_ms,c.error_code,c.created_at FROM employee_calls c JOIN employee_api_keys k ON k.id=c.key_id WHERE c.owner_id=$1 ORDER BY c.created_at DESC LIMIT 30',[req.customer.id]),
   endpoints(pool,cfg)
  ]);
  res.json({enabled:true,organization_name:organization.name,...money,base_url:cfg.origin+'/v1',model_ids:available.map(r=>r.model_id),key_limit:MAX_KEYS,keys:keys.rows,recent_calls:calls.rows});
 });
 app.post('/api/employee-credit/keys',requireCustomer,async(req,res)=>{
  await requireMember(req);
  const label=text(req.body?.label,'Key 名称',50),secret='sf_emp_'+token();
  const key=await transaction(pool,async db=>{
   await db.query('SELECT user_id FROM employee_credit_accounts WHERE user_id=$1 FOR UPDATE',[req.customer.id]);
   const count=(await db.query('SELECT count(*)::int AS count FROM employee_api_keys WHERE owner_id=$1 AND revoked_at IS NULL',[req.customer.id])).rows[0].count;
   if(count>=MAX_KEYS)throw new HttpError(409,`最多保留 ${MAX_KEYS} 枚有效 Key，请先停用旧 Key`);
   const created=(await db.query('INSERT INTO employee_api_keys(owner_id,label,secret_hash,key_hint) VALUES($1,$2,$3,$4) RETURNING id,label,key_hint,created_at',[req.customer.id,label,hash(secret),secret.slice(-6)])).rows[0];
   await audit(db,req.actor,'employee_credit.key_created',cfg.employeeCredit.organizationId,created.id);return created;
  });
  res.status(201).json({key,secret,show_once:true});
 });
 app.post('/api/employee-credit/keys/:key/revoke',requireCustomer,async(req,res)=>{
  const keyId=id(req.params.key);
  const result=await transaction(pool,async db=>{
   const key=(await db.query('UPDATE employee_api_keys SET revoked_at=now() WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL RETURNING id',[keyId,req.customer.id])).rows[0];
   if(!key)throw new HttpError(404,'有效 Key 不存在');
   await audit(db,req.actor,'employee_credit.key_revoked',cfg.employeeCredit.organizationId,keyId);return key;
  });
  res.json(result);
 });
}

/** Must be mounted before the app-wide 16 KB JSON parser; employee prompts are far larger. */
export function employeeInferenceRoutes(app,pool,cfg,upstreamFetch=fetch){
 const isEmployee=req=>keyPattern.test(req.get('authorization')||'');
 const parser=express.json({limit:'512kb'});
 async function authenticate(req){
  if(!enabled(cfg))throw new HttpError(503,'公司额度尚未开放');
  const secret=keyPattern.exec(req.get('authorization'))[1];
  const key=(await pool.query(`SELECT k.id AS key_id,k.owner_id FROM employee_api_keys k JOIN "user" u ON u.id=k.owner_id
   JOIN memberships m ON m.user_id=k.owner_id AND m.organization_id=$2 AND m.status='active'
   WHERE k.secret_hash=$1 AND k.revoked_at IS NULL AND u."emailVerified" AND NOT coalesce(u.disabled,false)`,[hash(secret),cfg.employeeCredit.organizationId])).rows[0];
  if(!key)throw new HttpError(401,'平台 Key 无效或已停用');
  return key;
 }
 async function limit(keyId,res){
  // Per key, not per IP: a whole office usually shares one egress address.
  const count=(await pool.query("INSERT INTO request_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.expires_at<now() THEN 1 ELSE request_limits.count+1 END,expires_at=CASE WHEN request_limits.expires_at<now() THEN now()+interval '1 minute' ELSE request_limits.expires_at END RETURNING count",[hash('employee-v1|'+keyId)])).rows[0].count;
  if(count>PER_MINUTE){res.set('Retry-After','60');throw new HttpError(429,'请求过于频繁');}
 }
 const fail=(callId,code,started)=>pool.query("UPDATE employee_calls SET status='failed',error_code=$2,latency_ms=$3,finished_at=now() WHERE id=$1 AND status='pending'",[callId,code,Math.round(performance.now()-started)]);
 /** Keeps the funds held until KerAPI's real amount arrives, shrinking the hold once usage is known. */
 async function answered(callId,requestId,usage,rate,started){
  const hold=usage?holdYuan(rate,usage):null;
  await pool.query(`UPDATE employee_calls SET status='awaiting_bill',upstream_request_id=$2,input_tokens=$3,cached_input_tokens=$4,output_tokens=$5,hold_yuan=CASE WHEN $6::numeric IS NULL THEN hold_yuan ELSE LEAST(hold_yuan,$6::numeric) END,latency_ms=$7,finished_at=now() WHERE id=$1 AND status='pending'`,
   [callId,requestId,usage?.input??null,usage?.cached??null,usage?.output??null,hold,Math.round(performance.now()-started)]);
 }
 app.get('/v1/models',(req,res,next)=>isEmployee(req)?next():next('route'),async(req,res)=>{
  await authenticate(req);
  res.json({object:'list',data:(await endpoints(pool,cfg)).map(r=>({id:r.model_id,object:'model',owned_by:'semifly'}))});
 });
 app.post('/v1/chat/completions',(req,res,next)=>isEmployee(req)?parser(req,res,next):next('route'),async(req,res)=>{
  const key=await authenticate(req);
  await limit(key.key_id,res);
  const {payload,stream,input,output}=employeeRequest(req.body,cfg.employeeCredit.models);
  const route=(await endpoints(pool,cfg,[payload.model]))[0];
  if(!route)throw new HttpError(503,'这个模型暂时不可用');
  const rate={input:route.input,cached:route.cached,output:route.output},hold=holdYuan(rate,{input,output});
  const callId=await transaction(pool,async db=>{
   // The row lock serialises reservations so concurrent calls cannot overspend.
   await db.query('SELECT user_id FROM employee_credit_accounts WHERE user_id=$1 FOR UPDATE',[key.owner_id]);
   const money=await balance(db,key.owner_id);
   const active=(await db.query(`SELECT count(*)::int AS count FROM employee_calls WHERE owner_id=$1 AND status='pending' AND created_at>now()-interval '${STALE_PENDING}'`,[key.owner_id])).rows[0].count;
   if(active>=MAX_CONCURRENT){res.set('Retry-After','5');throw new HttpError(429,`同时最多 ${MAX_CONCURRENT} 个请求`);}
   if(units(money.available_yuan<0?0:money.available_yuan)<units(hold))throw new HttpError(402,'公司额度不足以覆盖这次调用的上限；可调小 max_tokens，或等待结算中的费用释放');
   return (await db.query("INSERT INTO employee_calls(key_id,owner_id,model_id,credential_id,status,hold_yuan) VALUES($1,$2,$3,$4,'pending',$5) RETURNING id",[key.key_id,key.owner_id,payload.model,route.credential_id,hold])).rows[0].id;
  });
  const started=performance.now(),abort=new AbortController();
  // 'finish' also fires 'close'; only a close before the response ended is a disconnect.
  res.on('close',()=>{if(!res.writableEnded)abort.abort();});
  let response,upstreamKey;
  try{
   upstreamKey=vault(process.env.SUPPLIER_LAB_SECRET).open(route.credential_ciphertext).key;
   response=await upstreamFetch(`${route.base_url}/chat/completions`,{method:'POST',headers:{Authorization:'Bearer '+upstreamKey,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)])});
  }catch(error){
   await fail(callId,error.name==='TimeoutError'?'UPSTREAM_TIMEOUT':'UPSTREAM_FAILED',started);
   throw new HttpError(502,'上游调用失败；本次未扣额度');
  }
  const requestId=String(response.headers.get('x-request-id')||response.headers.get('x-oneapi-request-id')||'').slice(0,120)||null;
  if(!response.ok){
   const raw=(await response.text().catch(()=>'')).slice(0,4000);
   await fail(callId,'UPSTREAM_HTTP_'+response.status,started);
   let message='';try{const m=JSON.parse(raw)?.error?.message;if(typeof m==='string')message=m.replaceAll(upstreamKey,'[REDACTED]').slice(0,500);}catch{}
   throw new HttpError(response.status>=400&&response.status<500?response.status:502,`上游返回 HTTP ${response.status}${message?'：'+message:''}；本次未扣额度`);
  }
  res.set('X-Semifly-Call-Id',callId);
  if(!stream){
   let result;
   try{result=await response.json();}
   catch{await answered(callId,requestId,null,rate,started);throw new HttpError(502,'上游响应格式异常');}
   await answered(callId,requestId,usageFrom(result.usage),rate,started);
   return res.json(result);
  }
  res.status(200).set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','X-Accel-Buffering':'no'});res.flushHeaders();
  const decoder=new TextDecoder(),reader=response.body.getReader();let tail='',usage=null;
  const inspect=line=>{if(!line.startsWith('data:')||!line.includes('"usage"'))return;try{const seen=usageFrom(JSON.parse(line.slice(5)).usage);if(seen)usage=seen;}catch{}};
  try{
   while(true){
    const {done,value}=await reader.read();
    if(done)break;
    const lines=(tail+decoder.decode(value,{stream:true})).split('\n');tail=lines.pop();if(tail.length>1048576)tail='';
    lines.forEach(inspect);
    if(!res.write(value))await Promise.race([once(res,'drain'),once(res,'close')]);
    if(res.destroyed)break;
   }
   inspect(tail);
  }catch{/* A dropped stream may still be billed, so it keeps the hold below. */}
  finally{
   await reader.cancel().catch(()=>{});
   await answered(callId,requestId,usage,rate,started);
   res.end();
  }
 });
}

/** Applies KerAPI's real amounts. Runs after each usage sync; safe to repeat. */
export async function settleEmployeeCalls(pool){
 await pool.query(`UPDATE employee_calls SET status='awaiting_bill',finished_at=now(),error_code='STALE_PENDING' WHERE status='pending' AND created_at<now()-interval '${STALE_PENDING}'`);
 const billed=(await pool.query(`SELECT c.id,c.owner_id,r.evidence->>'amount' AS amount FROM employee_calls c JOIN supplier_usage_records r ON r.credential_id=c.credential_id AND r.request_id=c.upstream_request_id
  WHERE c.status='awaiting_bill' AND r.evidence->>'currency'='CNY' ORDER BY c.created_at LIMIT 1000`)).rows.filter(r=>decimalPattern.test(r.amount||''));
 // No bill after the grace period (for example a missing request ID): charge the conservative hold.
 const unbilled=(await pool.query(`SELECT id,owner_id,hold_yuan AS amount FROM employee_calls WHERE status='awaiting_bill' AND created_at<now()-interval '${BILL_GRACE}' ORDER BY created_at LIMIT 1000`)).rows;
 const billedIds=new Set(billed.map(r=>r.id));
 const work=[...billed.map(r=>({...r,source:'supplier_log'})),...unbilled.filter(r=>!billedIds.has(r.id)).map(r=>({...r,source:'hold_fallback'}))];
 let settled=0;
 for(const row of work){
  await transaction(pool,async db=>{
   const account=(await db.query('SELECT granted_yuan-spent_yuan AS remaining FROM employee_credit_accounts WHERE user_id=$1 FOR UPDATE',[row.owner_id])).rows[0];
   // A registered rate below the real price can exceed the hold; the employee is never overdrawn.
   const charged=(await db.query("UPDATE employee_calls SET status='settled',actual_yuan=$2::numeric,charged_yuan=LEAST($2::numeric,$3::numeric),settlement_source=$4,settled_at=now() WHERE id=$1 AND status='awaiting_bill' RETURNING charged_yuan",[row.id,row.amount,account.remaining,row.source])).rows[0];
   if(charged){await db.query('UPDATE employee_credit_accounts SET spent_yuan=spent_yuan+$2 WHERE user_id=$1',[row.owner_id,charged.charged_yuan]);settled++;}
  });
 }
 return {settled};
}
