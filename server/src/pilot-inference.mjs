import express from 'express';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { HttpError, hash, id, text, token, transaction, audit } from './core.mjs';

const MODEL_RATES=new Map([
 ['deepseek-flash',{miss:2,hit:0.04,output:8}],
 ['deepseek-v4-pro',{miss:9,hit:0.3,output:27}]
]);
const DAILY_LIMIT=10;
const MAX_OUTPUT_TOKENS=256;
const MAX_INPUT_CHARS=4000;
const UPSTREAM='https://api.deepseek.com/chat/completions';
const dayStart="(date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')";
const keyPattern=/^Bearer (sf_test_[A-Za-z0-9_-]{43})$/;
const permittedRoles=new Set(['system','user','assistant']);

export function validatePilotRequest(body){
 if(!body||!MODEL_RATES.has(body.model)||body.stream===true)throw new HttpError(400,'测试通道仅支持 DeepSeek Flash、V4 Pro 的非流式调用');
 if(!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>10)throw new HttpError(400,'messages 需包含 1 至 10 条消息');
 let chars=0;
 for(const message of body.messages){
  if(!message||!permittedRoles.has(message.role)||typeof message.content!=='string'||!message.content.trim())throw new HttpError(400,'测试通道仅支持纯文本 system、user、assistant 消息');
  chars+=message.content.length;
 }
 if(chars>MAX_INPUT_CHARS)throw new HttpError(400,'测试输入过长，最多 4000 字符');
 const maxTokens=body.max_tokens===undefined?MAX_OUTPUT_TOKENS:Number(body.max_tokens);
 if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>MAX_OUTPUT_TOKENS)throw new HttpError(400,'max_tokens 必须在 1 至 256 之间');
 const temperature=body.temperature===undefined?undefined:Number(body.temperature);
 if(temperature!==undefined&&(!Number.isFinite(temperature)||temperature<0||temperature>2))throw new HttpError(400,'temperature 需在 0 至 2 之间');
 if(['tools','tool_choice','functions','function_call','response_format','n','max_completion_tokens'].some(k=>body[k]!==undefined))throw new HttpError(400,'测试通道暂不支持工具、JSON 模式或多候选输出');
 return {model:body.model,messages:body.messages.map(m=>({role:m.role,content:m.content})),max_tokens:maxTokens,stream:false,thinking:{type:'disabled'},...(temperature===undefined?{}:{temperature})};
}

export function pilotUsage(usage,modelId){
 const input=Number(usage?.prompt_tokens),output=Number(usage?.completion_tokens),hit=Number(usage?.prompt_cache_hit_tokens||0);
 const miss=Number(usage?.prompt_cache_miss_tokens??input-hit);
 if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0||!Number.isSafeInteger(hit)||hit<0||!Number.isSafeInteger(miss)||miss<0||hit+miss!==input||(usage?.total_tokens!=null&&Number(usage.total_tokens)!==input+output))throw new Error('UPSTREAM_USAGE_MISSING');
 // Conservative peak estimate, kept outside the customer cash ledger.
 const rate=MODEL_RATES.get(modelId);
 if(!rate)throw new Error('UPSTREAM_MODEL_MISMATCH');
 const estimate=Math.ceil((((input-hit)*rate.miss+hit*rate.hit+output*rate.output)/1_000_000)*100_000_000)/100_000_000;
 return {input,output,hit,estimate};
}

export function pilotInferenceRoutes(app,pool,cfg,requireCustomer,upstreamFetch=fetch){
 const enabled=()=>Boolean(cfg.pilot?.keyFile&&cfg.pilot?.emails?.size);
 const permitted=email=>enabled()&&cfg.pilot.emails.has(String(email||'').toLowerCase());
 const access=req=>{if(!permitted(req.customer.email))throw new HttpError(403,'当前账号未开放真实测试调用');};
 const current=async ownerId=>{
  const [keys,calls,recent,models,keyUsage]=await Promise.all([
   pool.query('SELECT id,label,model_id,key_hint,created_at,revoked_at FROM pilot_api_keys WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 20',[ownerId]),
   pool.query(`SELECT count(*)::int AS count FROM pilot_calls WHERE owner_id=$1 AND created_at>=${dayStart}`,[ownerId]),
   pool.query('SELECT c.id,c.key_id,k.label AS key_label,c.model_id,c.status,c.input_tokens,c.cache_hit_tokens,c.output_tokens,c.estimated_upstream_yuan,c.latency_ms,c.error_code,c.created_at FROM pilot_calls c JOIN pilot_api_keys k ON k.id=c.key_id WHERE c.owner_id=$1 ORDER BY c.created_at DESC LIMIT 50',[ownerId]),
   pool.query("SELECT model_id,count(*) FILTER(WHERE status='succeeded')::int AS successful_calls,count(*) FILTER(WHERE status='failed')::int AS failed_calls,coalesce(sum(input_tokens) FILTER(WHERE status='succeeded'),0)::bigint AS input_tokens,coalesce(sum(cache_hit_tokens) FILTER(WHERE status='succeeded'),0)::bigint AS cache_hit_tokens,coalesce(sum(output_tokens) FILTER(WHERE status='succeeded'),0)::bigint AS output_tokens,coalesce(sum(estimated_upstream_yuan) FILTER(WHERE status='succeeded'),0) AS estimated_upstream_yuan FROM pilot_calls WHERE owner_id=$1 AND created_at>=now()-interval '30 days' GROUP BY model_id ORDER BY model_id",[ownerId]),
   pool.query("SELECT key_id,count(*) FILTER(WHERE status='succeeded')::int AS successful_calls,count(*) FILTER(WHERE status='failed')::int AS failed_calls,max(created_at) AS last_call_at FROM pilot_calls WHERE owner_id=$1 AND created_at>=now()-interval '30 days' GROUP BY key_id",[ownerId])
  ]);
  return {enabled:true,model_ids:[...MODEL_RATES.keys()],base_url:cfg.origin+'/v1',daily_limit:DAILY_LIMIT,calls_today:calls.rows[0].count,keys:keys.rows,recent_calls:recent.rows,usage_by_model:models.rows,usage_by_key:keyUsage.rows,usage_window_days:30};
 };
 app.get('/api/pilot/status',requireCustomer,async(req,res)=>{
  if(!permitted(req.customer.email))return res.json({enabled:false});
  try{const upstreamKey=(await readFile(cfg.pilot.keyFile,'utf8')).trim();if(!upstreamKey)throw Error('missing');}
  catch{return res.json({enabled:false,reason:'测试通道尚未配置'});}
  res.json(await current(req.customer.id));
 });
 app.post('/api/pilot/keys',requireCustomer,async(req,res)=>{
  access(req);const label=text(req.body?.label,'Key 名称',50),modelId=req.body?.model_id;
  if(!MODEL_RATES.has(modelId))throw new HttpError(400,'请选择可用的测试模型');
  if(req.body?.confirm_model!==true)throw new HttpError(400,'请明确确认这枚 Key 的模型范围');
  const secret='sf_test_'+token();
  try{if(!(await readFile(cfg.pilot.keyFile,'utf8')).trim())throw Error('missing');}
  catch{throw new HttpError(503,'测试通道尚未配置');}
  const key=await transaction(pool,async db=>{
   await db.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[req.customer.id]);
   const count=(await db.query('SELECT count(*)::int AS count FROM pilot_api_keys WHERE owner_id=$1 AND revoked_at IS NULL',[req.customer.id])).rows[0].count;
   if(count>=3)throw new HttpError(409,'最多保留 3 枚有效测试 Key，请先停用旧 Key');
   const created=(await db.query('INSERT INTO pilot_api_keys(owner_id,label,model_id,secret_hash,key_hint) VALUES($1,$2,$3,$4,$5) RETURNING id,label,model_id,key_hint,created_at',[req.customer.id,label,modelId,hash(secret),secret.slice(-6)])).rows[0];
   await audit(db,req.actor,'pilot.key_created',null,created.id,{model_id:modelId});return created;
  });
  res.status(201).json({key,secret,show_once:true});
 });
 app.post('/api/pilot/keys/:key/revoke',requireCustomer,async(req,res)=>{
  access(req);const keyId=id(req.params.key);
  const result=await transaction(pool,async db=>{
   const key=(await db.query('UPDATE pilot_api_keys SET revoked_at=now() WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL RETURNING id',[keyId,req.customer.id])).rows[0];
   if(!key)throw new HttpError(404,'有效测试 Key 不存在');
   await audit(db,req.actor,'pilot.key_revoked',null,keyId);return key;
  });res.json(result);
 });
 app.use('/v1',async(req,res,next)=>{
  const bucket=hash(req.ip+'|pilot-v1');
  const count=(await pool.query("INSERT INTO request_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.expires_at<now() THEN 1 ELSE request_limits.count+1 END,expires_at=CASE WHEN request_limits.expires_at<now() THEN now()+interval '1 minute' ELSE request_limits.expires_at END RETURNING count",[bucket])).rows[0].count;
  if(count>30){res.set('Retry-After','60');throw new HttpError(429,'请求过于频繁');}
  next();
 });
 app.post('/v1/chat/completions',express.json({limit:'8kb'}),async(req,res)=>{
  if(!enabled())throw new HttpError(503,'测试通道尚未开放');
  const match=keyPattern.exec(req.get('authorization')||'');
  if(!match)throw new HttpError(401,'平台测试 Key 无效');
  if(JSON.stringify(req.body||{}).length>8192)throw new HttpError(413,'请求内容过大');
  const payload=validatePilotRequest(req.body);
  const owner=(await pool.query('SELECT k.id AS key_id,k.owner_id,k.model_id,u.email,u."emailVerified" AS verified,u.disabled FROM pilot_api_keys k JOIN "user" u ON u.id=k.owner_id WHERE k.secret_hash=$1 AND k.revoked_at IS NULL',[hash(match[1])])).rows[0];
  if(!owner||!owner.verified||owner.disabled||!permitted(owner.email))throw new HttpError(401,'平台测试 Key 无效');
  if(owner.model_id!==payload.model)throw new HttpError(403,'这枚测试 Key 未获准调用所选模型');
  const callId=await transaction(pool,async db=>{
   await db.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[owner.owner_id]);
   const key=(await db.query('SELECT id FROM pilot_api_keys WHERE id=$1 AND revoked_at IS NULL FOR UPDATE',[owner.key_id])).rows[0];
   if(!key)throw new HttpError(401,'平台测试 Key 已停用');
   const count=(await db.query(`SELECT count(*)::int AS count, count(*) FILTER (WHERE status='pending' AND created_at>now()-interval '90 seconds')::int AS pending FROM pilot_calls WHERE owner_id=$1 AND created_at>=${dayStart}`,[owner.owner_id])).rows[0];
   if(count.count>=DAILY_LIMIT){res.set('Retry-After','86400');throw new HttpError(429,'今日测试调用额度已用完');}
   if(count.pending){res.set('Retry-After','90');throw new HttpError(429,'已有测试调用正在进行，请稍后再试');}
   return (await db.query("INSERT INTO pilot_calls(key_id,owner_id,model_id,status) VALUES($1,$2,$3,'pending') RETURNING id",[owner.key_id,owner.owner_id,payload.model])).rows[0].id;
  });
  const started=performance.now();
  let result;
  try{
   const upstreamKey=(await readFile(cfg.pilot.keyFile,'utf8')).trim();
   if(!upstreamKey)throw Error('UPSTREAM_KEY_MISSING');
   const response=await upstreamFetch(UPSTREAM,{method:'POST',headers:{Authorization:'Bearer '+upstreamKey,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000),redirect:'error'});
   if(!response.ok)throw Error('UPSTREAM_HTTP_'+response.status);
   result=await response.json();
   if(result.model!==payload.model)throw Error('UPSTREAM_MODEL_MISMATCH');
   const usage=pilotUsage(result.usage,payload.model);
   await pool.query("UPDATE pilot_calls SET status='succeeded',input_tokens=$2,cache_hit_tokens=$3,output_tokens=$4,estimated_upstream_yuan=$5,upstream_request_id=$6,latency_ms=$7,finished_at=now() WHERE id=$1",[callId,usage.input,usage.hit,usage.output,usage.estimate,String(result.id||'').slice(0,120),Math.round(performance.now()-started)]);
  }catch(error){
   const code=/^UPSTREAM_HTTP_[0-9]{3}$/.test(error.message)?error.message:error.name==='TimeoutError'?'UPSTREAM_TIMEOUT':['UPSTREAM_USAGE_MISSING','UPSTREAM_MODEL_MISMATCH'].includes(error.message)?error.message:'UPSTREAM_FAILED';
   await pool.query("UPDATE pilot_calls SET status='failed',error_code=$2,latency_ms=$3,finished_at=now() WHERE id=$1",[callId,code,Math.round(performance.now()-started)]);
   throw new HttpError(502,'上游测试调用失败；本次未计入成功用量');
  }
  res.json(result);
 });
}
