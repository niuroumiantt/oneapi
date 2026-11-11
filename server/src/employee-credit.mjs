import { recordProfile } from './acceptance.mjs';
import express from 'express';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { HttpError,hash,id,text,token,transaction,audit,vault } from './core.mjs';
import { isManager } from './organizations.mjs';
import { OFFICIAL_MODELS,findOfficialModel,priceMultiplier } from './official-models.mjs';

// One 10-yuan grant per employee, never topped up automatically. Usage is charged at official list prices.
export const GRANT_YUAN='10.000000000000';
export const MAX_BODY='8mb';
const MAX_KEYS=5,MAX_CONCURRENT=3,PER_MINUTE=60,DEFAULT_OUTPUT=4096,MAX_OUTPUT=8192,MAX_MESSAGES=500;
const UPSTREAM_TIMEOUT_MS=300000,STALE_PENDING='15 minutes',BILL_GRACE='24 hours';
const KERAPI_ORIGIN='https://kerapi.cn',DEEPSEEK_BASE='https://api.deepseek.com';
const SCALE=1000000000000n;
const keyPattern=/^Bearer (sf_emp_[A-Za-z0-9_-]{43})$/;
const decimalPattern=/^\d{1,12}(\.\d{1,12})?$/;
const OPEN="status IN ('pending','awaiting_bill')";
// Settled amount, plus the hold for calls still open: what a key has used against its cap.
const USED_ON_KEY=`coalesce(sum(coalesce(charged_yuan,CASE WHEN ${OPEN} THEN hold_yuan END)),0)`;
const moneyPattern=/^\d{1,6}(\.\d{1,2})?$/;

const units=v=>{const [whole,fraction='']=String(v).split('.');return BigInt(whole)*SCALE+BigInt(fraction.padEnd(12,'0').slice(0,12));};
const format=v=>`${v/SCALE}.${String(v%SCALE).padStart(12,'0')}`;
const tokens=v=>Number.isSafeInteger(v)&&v>=0?v:null;

/** Price of a usage amount at the given time-of-day multiplier, rounded up to the ledger's precision. */
export function holdYuan(rate,{input,cached=0,output},multiplier=1){
 const base=BigInt(input-cached)*units(rate.input)+BigInt(cached)*units(rate.cached??rate.input)+BigInt(output)*units(rate.output);
 return format((base*BigInt(multiplier)+999999n)/1000000n);
}

/** Validates the caller's body and returns the upstream payload plus its billing bound. */
// GLM only accepts reasoning_effort low, high or max; tools like WorkBuddy also send none, minimal and medium.
// none means "no reasoning", so it turns reasoning off; the rest map to the nearest accepted level.
const GLM_EFFORT={none:null,minimal:'low',low:'low',medium:'high',high:'high',xhigh:'max',max:'max'};
export function glmEffort(payload){
 if(payload.reasoning_effort===undefined)return payload;
 const mapped=GLM_EFFORT[String(payload.reasoning_effort).toLowerCase()];
 if(mapped===null){delete payload.reasoning_effort;payload.thinking={type:'disabled'};}
 else if(mapped)payload.reasoning_effort=mapped;
 else delete payload.reasoning_effort;
 return payload;
}
// Agent 检测 recording: notified of every employee call (and every gateway rejection) with the key that made it.
let captureHook=null;
export function setCaptureHook(fn){captureHook=fn;}
export function employeeRequest(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'请求必须是 JSON 对象');
 const model=findOfficialModel(body.model);if(!model)throw new HttpError(403,'这个模型未开放给公司额度');
 if(!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>MAX_MESSAGES)throw new HttpError(400,`messages 需包含 1 至 ${MAX_MESSAGES} 条消息`);
 if(body.n!==undefined&&body.n!==1)throw new HttpError(400,'公司额度仅支持 n=1');
 if(body.max_tokens!==undefined&&body.max_completion_tokens!==undefined)throw new HttpError(400,'max_tokens 与 max_completion_tokens 只能传一个');
 const output=body.max_tokens??body.max_completion_tokens??DEFAULT_OUTPUT;
 if(!Number.isInteger(output)||output<1||output>MAX_OUTPUT)throw new HttpError(400,`max_tokens 必须在 1 至 ${MAX_OUTPUT} 之间`);
 const {max_completion_tokens:_ignored,...rest}=body,stream=body.stream===true;
 const payload={...rest,model:model.upstreamModel,max_tokens:output,stream};
 if(stream)payload.stream_options={...(body.stream_options||{}),include_usage:true};
 if(model.family==='glm')glmEffort(payload);
 // One token never encodes fewer than one UTF-8 byte of the serialized prompt.
 const input=Buffer.byteLength(JSON.stringify({messages:body.messages,tools:body.tools,functions:body.functions}));
 return {model,payload,stream,input,output};
}

// Header patterns for tools that name themselves; generic SDKs only reveal the language.
const CLIENTS=[[/workbuddy|codebuddy/i,'WorkBuddy'],[/qoder/i,'Qoder'],[/trae/i,'Trae'],[/cursor/i,'Cursor'],[/roo-?code|roocode|roo-cline/i,'Roo Code'],[/kilo-?code/i,'Kilo Code'],[/cline/i,'Cline'],[/opencode/i,'OpenCode'],[/continue/i,'Continue'],[/cherry/i,'Cherry Studio'],[/chatbox/i,'Chatbox'],[/langchain/i,'LangChain'],[/llama_?index/i,'LlamaIndex'],[/dify/i,'Dify'],[/n8n/i,'n8n'],[/postman/i,'Postman'],[/^curl\//i,'curl'],[/openai\/python|openai-python/i,'Python（OpenAI SDK）'],[/openai\/js|openai-node/i,'Node（OpenAI SDK）'],[/python-requests|python-httpx|aiohttp|python\//i,'Python 脚本'],[/node-fetch|undici|axios|^node\b/i,'Node 脚本'],[/go-http-client/i,'Go 程序'],[/okhttp|java\//i,'Java 程序'],[/mozilla|chrome|safari/i,'浏览器']];
/** Names the calling tool from X-Semifly-Client, X-Title, Referer or User-Agent. */
export function callClient(get){
 const clip=(value,n)=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
 // Header values are ASCII, so Chinese names arrive percent-encoded.
 const decode=value=>{try{return decodeURIComponent(String(value||''));}catch{return String(value||'');}};
 const declared=clip(decode(get('x-semifly-client')),40),title=clip(get('x-title'),60),ref=clip(get('http-referer')||get('referer'),120),ua=clip(get('user-agent'),200);
 const detail=[title&&'X-Title: '+title,ref&&'Referer: '+ref,ua&&'UA: '+ua].filter(Boolean).join(' · ').slice(0,300)||null;
 if(declared)return {client:declared,detail};
 const hit=[title,ref,ua].map(v=>CLIENTS.find(([pattern])=>pattern.test(v))).find(Boolean);
 return {client:hit?hit[1]:ua?'未识别':'未提供',detail};
}
const REDACT=[[/\b(?:sk|sf_emp|sf_test|pk|rk|ak|ghp|gho|glpat|xox[abp])[-_][A-Za-z0-9_-]{8,}/gi,'[密钥]'],[/(password|passwd|pwd|token|secret|密码|口令)\s*[:=：]\s*\S+/gi,'$1: [已隐去]'],[/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,'[邮箱]'],[/(?<!\d)\d{17}[\dXx](?!\d)/g,'[证件号]'],[/(?<!\d)1[3-9]\d{9}(?!\d)/g,'[手机号]'],[/(?<!\d)\d{12,19}(?!\d)/g,'[长数字]'],[/[A-Za-z0-9+/_-]{32,}={0,2}/g,'[长串]']];
export const SUMMARY_CHARS=60;
/** First characters of the latest typed question, with tags, secrets and contact details removed. Never the full text. */
export function callSummary(messages){
 if(!Array.isArray(messages))return null;
 for(let i=messages.length-1;i>=0;i--){
  const m=messages[i];if(m?.role!=='user')continue;
  const raw=typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.filter(p=>p?.type==='text'&&typeof p.text==='string').map(p=>p.text).join(' '):'';
  let text=raw.slice(0,20000).replace(/<([A-Za-z_][\w-]*)[^>]*>[\s\S]*?<\/\1>/g,' ').replace(/\s+/g,' ').trim();
  if(!text)continue;
  for(const [pattern,replacement] of REDACT)text=text.replace(pattern,replacement);
  const chars=Array.from(text);return chars.slice(0,SUMMARY_CHARS).join('')+(chars.length>SUMMARY_CHARS?'…':'');
 }
 return null;
}
const summaryFlag={at:0,on:false};
async function summariesOn(db,cfg){
 if(Date.now()-summaryFlag.at<30000)return summaryFlag.on;
 const on=Boolean((await db.query('SELECT record_call_summaries FROM organizations WHERE id=$1',[cfg.employeeCredit.organizationId])).rows[0]?.record_call_summaries);
 summaryFlag.at=Date.now();summaryFlag.on=on;return on;
}

export function usageFrom(usage){
 const input=tokens(usage?.prompt_tokens),output=tokens(usage?.completion_tokens);
 if(input===null||output===null)return null;
 const cached=tokens(usage?.prompt_tokens_details?.cached_tokens??usage?.prompt_cache_hit_tokens??0);
 return {input,output,cached:cached===null||cached>input?0:cached};
}

function enabled(cfg){return Boolean(cfg.employeeCredit?.organizationId&&process.env.SUPPLIER_LAB_SECRET);}

async function deepseekKey(cfg){
 if(!cfg.pilot?.keyFile)return '';
 try{return (await readFile(cfg.pilot.keyFile,'utf8')).trim();}catch{return '';}
}

/** Official models that currently have a working upstream route. */
export async function employeeRoutes(db,cfg,{includePaused=false}={}){
 const wanted=OFFICIAL_MODELS.filter(m=>m.upstream==='kerapi').map(m=>m.upstreamModel);
 const rows=(await db.query(`SELECT e.model_id,e.base_url,e.credential_id,c.credential_ciphertext,c.priority
  FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id JOIN supplier_lab_suppliers s ON s.id=e.supplier_id
  WHERE e.model_id=ANY($1::text[]) AND e.kind='supplier' AND e.disabled_at IS NULL AND c.disabled_at IS NULL AND s.disabled_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM suppliers p WHERE p.id=s.canonical_supplier_id AND p.status='blocked')
  ORDER BY e.model_id,c.priority,c.created_at DESC,e.created_at DESC`,[wanted])).rows.filter(r=>{try{return new URL(r.base_url).origin===KERAPI_ORIGIN;}catch{return false;}});
 const byModel=new Map(),hasDeepseek=Boolean(await deepseekKey(cfg));
 for(const r of rows){const list=byModel.get(r.model_id)||[];if(!list.some(x=>x.credential_id===r.credential_id))list.push(r);byModel.set(r.model_id,list);}
 const paused=includePaused?new Set():new Set((await db.query('SELECT model_id FROM channel_states WHERE paused')).rows.map(r=>r.model_id));
 return OFFICIAL_MODELS.filter(m=>!paused.has(m.id)).flatMap(model=>{
  if(model.upstream==='deepseek')return hasDeepseek?[{model,baseUrl:DEEPSEEK_BASE,credentialId:null}]:[];
  const [row,...rest]=byModel.get(model.upstreamModel)||[];
  const toRoute=r=>({model,baseUrl:r.base_url,credentialId:r.credential_id,ciphertext:r.credential_ciphertext});
  return row?[{...toRoute(row),fallbacks:rest.map(toRoute)}]:[];
 });
}

export async function upstreamSecret(route,cfg){
 const secret=route.credentialId?vault(process.env.SUPPLIER_LAB_SECRET).open(route.ciphertext).key:await deepseekKey(cfg);
 if(!secret)throw Error('UPSTREAM_KEY_MISSING');
 return secret;
}

const publicModel=({id,name,family,tags,uses,rates,peakPricing})=>({id,name,family,tags,uses,input_yuan:rates.input,cached_yuan:rates.cached,output_yuan:rates.output,peak_multiplier:peakPricing?2:1});

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

const HEALTH_TTL_MS=10*60*1000,HEALTH_TIMEOUT_MS=20000,HEALTH_MIN_GAP_MS=60*1000;

export function employeeCreditRoutes(app,pool,cfg,requireCustomer,upstreamFetch=fetch){
 const member=async req=>{
  if(!enabled(cfg))return null;
  return activeMember(pool,cfg,req.customer.id);
 };
 const requireMember=async req=>{if(!await member(req))throw new HttpError(403,'当前账号不是公司员工，未开放公司额度');return ensureAccount(pool,cfg,req);};
 const requireManager=async req=>{
  if(!enabled(cfg))throw new HttpError(404,'公司额度尚未开通');
  const org=cfg.employeeCredit.organizationId,m=(await pool.query("SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[org,req.customer.id])).rows[0];
  if(!m||!isManager(m.role))throw new HttpError(403,'仅企业管理者可以操作');
  return org;
 };
 const companyCalls="employee_calls c JOIN employee_credit_accounts a ON a.user_id=c.owner_id AND a.organization_id=$1";
 // Usage metadata only: prompts and answers are never stored or returned.
 app.get('/api/employee-credit/team',requireCustomer,async(req,res)=>{
  const org=await requireManager(req);
  const [members,models,daily,recent,keys,month]=await Promise.all([
   pool.query(`SELECT m.user_id,u.name,u.email,m.department,m.role,m.status,coalesce(a.granted_yuan,$2::numeric) AS granted_yuan,coalesce(a.spent_yuan,0) AS spent_yuan,coalesce(h.held,0) AS held_yuan,coalesce(c.calls,0)::int AS calls_30d,coalesce(c.tokens,0)::bigint AS tokens_30d,c.last_call_at,coalesce(k.keys,0)::int AS active_keys
    FROM memberships m JOIN "user" u ON u.id=m.user_id LEFT JOIN employee_credit_accounts a ON a.user_id=m.user_id
    LEFT JOIN LATERAL (SELECT sum(hold_yuan) AS held FROM employee_calls WHERE owner_id=m.user_id AND ${OPEN}) h ON true
    LEFT JOIN LATERAL (SELECT count(*) AS calls,sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)) AS tokens,max(created_at) AS last_call_at FROM employee_calls WHERE owner_id=m.user_id AND created_at>=now()-interval '30 days') c ON true
    LEFT JOIN LATERAL (SELECT count(*) AS keys FROM employee_api_keys WHERE owner_id=m.user_id AND revoked_at IS NULL) k ON true
    WHERE m.organization_id=$1 ORDER BY coalesce(a.spent_yuan,0) DESC,m.created_at`,[org,GRANT_YUAN]),
   pool.query(`SELECT c.model_id,count(*)::int AS calls,count(*) FILTER(WHERE c.status='failed')::int AS failed,coalesce(sum(c.input_tokens),0)::bigint AS input_tokens,coalesce(sum(c.output_tokens),0)::bigint AS output_tokens,coalesce(sum(c.charged_yuan),0) AS yuan,count(*) FILTER(WHERE c.created_at>now()-interval '24 hours')::int AS calls_24h,coalesce(sum(coalesce(c.input_tokens,0)+coalesce(c.output_tokens,0)) FILTER(WHERE c.created_at>now()-interval '24 hours'),0)::bigint AS tokens_24h,coalesce((SELECT max(n) FROM (SELECT count(*) AS n FROM employee_calls x JOIN employee_credit_accounts xa ON xa.user_id=x.owner_id AND xa.organization_id=$1 WHERE x.model_id=c.model_id AND x.created_at>now()-interval '24 hours' GROUP BY date_trunc('minute',x.created_at)) q),0)::int AS peak_rpm FROM ${companyCalls} WHERE c.created_at>=now()-interval '30 days' GROUP BY 1 ORDER BY 6 DESC`,[org]),
   pool.query(`SELECT to_char(c.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS day,c.model_id,count(*)::int AS calls,coalesce(sum(c.charged_yuan),0) AS yuan FROM ${companyCalls} WHERE c.created_at>=now()-interval '14 days' GROUP BY 1,2 ORDER BY 1,2`,[org]),
   pool.query(`SELECT c.id,c.owner_id,c.created_at,c.model_id,c.status,c.input_tokens,c.cached_input_tokens,c.output_tokens,c.charged_yuan,c.hold_yuan,c.latency_ms,c.client,c.summary,u.name,k.label AS key_label FROM ${companyCalls} JOIN "user" u ON u.id=c.owner_id JOIN employee_api_keys k ON k.id=c.key_id ORDER BY c.created_at DESC LIMIT 50`,[org]),
   pool.query(`SELECT k.id,k.owner_id,k.label,k.key_hint,k.created_at,k.revoked_at,k.model_ids,k.limit_yuan,(SELECT ${USED_ON_KEY} FROM employee_calls WHERE key_id=k.id) AS used_yuan,u.name,coalesce(s.calls,0)::int AS calls,coalesce(s.tokens,0)::bigint AS tokens,coalesce(s.yuan,0) AS yuan,s.last_call_at,coalesce(s.active,0)::int AS active_calls,s.last_client,coalesce(s.calls_24h,0)::int AS calls_24h,coalesce(s.tokens_24h,0)::bigint AS tokens_24h,coalesce(p.peak,0)::int AS peak_rpm
    FROM employee_api_keys k JOIN employee_credit_accounts a ON a.user_id=k.owner_id AND a.organization_id=$1 JOIN "user" u ON u.id=k.owner_id
    LEFT JOIN (SELECT c.key_id,count(*) AS calls,sum(coalesce(c.input_tokens,0)+coalesce(c.output_tokens,0)) AS tokens,sum(coalesce(c.charged_yuan,0)) AS yuan,max(c.created_at) AS last_call_at,count(*) FILTER(WHERE c.status='pending' AND c.created_at>now()-interval '10 minutes') AS active,(array_agg(c.client ORDER BY c.created_at DESC))[1] AS last_client,count(*) FILTER(WHERE c.created_at>now()-interval '24 hours') AS calls_24h,coalesce(sum(coalesce(c.input_tokens,0)+coalesce(c.output_tokens,0)) FILTER(WHERE c.created_at>now()-interval '24 hours'),0) AS tokens_24h FROM ${companyCalls} GROUP BY c.key_id) s ON s.key_id=k.id
    LEFT JOIN (SELECT key_id,max(n) AS peak FROM (SELECT c.key_id,count(*) AS n FROM ${companyCalls} WHERE c.created_at>now()-interval '24 hours' GROUP BY c.key_id,date_trunc('minute',c.created_at)) x GROUP BY key_id) p ON p.key_id=k.id
    ORDER BY k.revoked_at IS NULL DESC,k.created_at DESC LIMIT 100`,[org]),
   pool.query(`SELECT coalesce(sum(c.charged_yuan),0) AS yuan FROM ${companyCalls} WHERE c.settled_at>=(date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')`,[org])
  ]);
  const active=members.rows.filter(m=>m.status==='active'),sum=f=>active.reduce((t,m)=>t+units(m[f]),0n),granted=sum('granted_yuan'),spent=sum('spent_yuan'),held=sum('held_yuan');
  const summariesEnabled=Boolean((await pool.query('SELECT record_call_summaries FROM organizations WHERE id=$1',[org])).rows[0]?.record_call_summaries);
  res.json({summaries_enabled:summariesEnabled,totals:{granted_yuan:format(granted),spent_yuan:format(spent),held_yuan:format(held),available_yuan:format(granted-spent-held>0n?granted-spent-held:0n),month_yuan:month.rows[0].yuan,calls_30d:active.reduce((t,m)=>t+m.calls_30d,0),active_members:active.filter(m=>m.calls_30d>0).length,members:active.length},members:members.rows,models:models.rows,daily:daily.rows,recent_calls:recent.rows,keys:keys.rows});
 });
 app.get('/api/employee-credit/team/members/:user',requireCustomer,async(req,res)=>{
  const org=await requireManager(req),userId=text(req.params.user,'员工',64);
  if(!(await pool.query('SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2',[org,userId])).rowCount)throw new HttpError(404,'员工不存在');
  const [calls,models,clients,flag]=await Promise.all([
   pool.query(`SELECT c.id,c.key_id,c.created_at,c.model_id,c.status,c.input_tokens,c.output_tokens,c.charged_yuan,c.hold_yuan,c.latency_ms,c.client,c.client_detail,c.summary,k.label AS key_label FROM employee_calls c JOIN employee_api_keys k ON k.id=c.key_id WHERE c.owner_id=$1 ORDER BY c.created_at DESC LIMIT 30`,[userId]),
   pool.query(`SELECT model_id,count(*)::int AS calls,coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0)::bigint AS tokens,coalesce(sum(charged_yuan),0) AS yuan,max(created_at) AS last_call_at,count(*) FILTER(WHERE status='pending' AND created_at>now()-interval '10 minutes')::int AS active_calls,count(*) FILTER(WHERE created_at>now()-interval '24 hours')::int AS calls_24h,coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)) FILTER(WHERE created_at>now()-interval '24 hours'),0)::bigint AS tokens_24h,coalesce((SELECT max(n) FROM (SELECT count(*) AS n FROM employee_calls x WHERE x.owner_id=$1 AND x.model_id=employee_calls.model_id AND x.created_at>now()-interval '24 hours' GROUP BY date_trunc('minute',x.created_at)) q),0)::int AS peak_rpm FROM employee_calls WHERE owner_id=$1 AND created_at>=now()-interval '30 days' GROUP BY 1 ORDER BY max(created_at) DESC`,[userId]),
   pool.query(`SELECT coalesce(client,'未记录') AS client,count(*)::int AS calls,max(created_at) AS last_call_at,array_agg(DISTINCT model_id) AS models FROM employee_calls WHERE owner_id=$1 AND created_at>=now()-interval '30 days' GROUP BY 1 ORDER BY max(created_at) DESC`,[userId]),
   pool.query('SELECT record_call_summaries FROM organizations WHERE id=$1',[org])
  ]);
  res.json({summaries_enabled:Boolean(flag.rows[0]?.record_call_summaries),calls:calls.rows,models:models.rows,clients:clients.rows});
 });
 // Range, bucket and minutes come from this table only, so they are safe to interpolate.
 const ANALYTICS={'24h':['24 hours','hour',1440],'7d':['7 days','day',10080],'30d':['30 days','day',43200]};
 app.get('/api/employee-credit/team/analytics',requireCustomer,async(req,res)=>{
  const org=await requireManager(req),range=Object.hasOwn(ANALYTICS,req.query.range)?req.query.range:'24h',[span,unit,minutes]=ANALYTICS[range];
  const tok='coalesce(c.input_tokens,0)+coalesce(c.output_tokens,0)';
  const [buckets,models,peak]=await Promise.all([
   pool.query(`SELECT to_char(date_trunc('${unit}',c.created_at AT TIME ZONE 'Asia/Shanghai'),'YYYY-MM-DD HH24:00') AS bucket,c.model_id,count(*)::int AS calls,coalesce(sum(${tok}),0)::bigint AS tokens,coalesce(sum(c.charged_yuan),0) AS yuan FROM ${companyCalls} WHERE c.created_at>now()-$2::interval GROUP BY 1,2 ORDER BY 1,2`,[org,span]),
   pool.query(`SELECT c.model_id,count(*)::int AS calls,count(*) FILTER(WHERE c.status='failed')::int AS failed,coalesce(sum(${tok}),0)::bigint AS tokens,coalesce(sum(c.charged_yuan),0) AS yuan FROM ${companyCalls} WHERE c.created_at>now()-$2::interval GROUP BY 1 ORDER BY 2 DESC`,[org,span]),
   pool.query(`SELECT coalesce(max(n),0)::int AS peak_rpm,coalesce(max(t),0)::bigint AS peak_tpm FROM (SELECT count(*) AS n,sum(${tok}) AS t FROM ${companyCalls} WHERE c.created_at>now()-$2::interval GROUP BY date_trunc('minute',c.created_at)) x`,[org,span])
  ]);
  res.json({range,unit,minutes,generated_at:new Date().toISOString(),buckets:buckets.rows,models:models.rows,peak:peak.rows[0]});
 });
 app.put('/api/employee-credit/team/summaries',requireCustomer,async(req,res)=>{
  const org=await requireManager(req);if(typeof req.body?.enabled!=='boolean')throw new HttpError(400,'请选择开启或关闭');
  const enabled=req.body.enabled;
  await transaction(pool,async db=>{
   await db.query('UPDATE organizations SET record_call_summaries=$2 WHERE id=$1',[org,enabled]);
   // Turning it off removes what was kept.
   const cleared=enabled?0:(await db.query('UPDATE employee_calls c SET summary=NULL FROM employee_credit_accounts a WHERE a.user_id=c.owner_id AND a.organization_id=$1 AND c.summary IS NOT NULL',[org])).rowCount;
   await audit(db,req.actor,enabled?'employee_credit.summaries_enabled':'employee_credit.summaries_disabled',org,org,{cleared});
  });
  summaryFlag.at=0;res.json({enabled});
 });
 app.post('/api/employee-credit/team/keys/:key/revoke',requireCustomer,async(req,res)=>{
  const org=await requireManager(req),keyId=id(req.params.key);
  const result=await transaction(pool,async db=>{
   const key=(await db.query('UPDATE employee_api_keys k SET revoked_at=now() FROM employee_credit_accounts a WHERE k.id=$1 AND k.revoked_at IS NULL AND a.user_id=k.owner_id AND a.organization_id=$2 RETURNING k.id',[keyId,org])).rows[0];
   if(!key)throw new HttpError(404,'有效 Key 不存在');
   await audit(db,req.actor,'employee_credit.key_revoked_by_manager',org,keyId);return key;
  });
  res.json(result);
 });
 app.post('/api/employee-credit/team/members/:user/grant',requireCustomer,async(req,res)=>{
  const org=await requireManager(req),userId=text(req.params.user,'员工',64),raw=String(req.body?.yuan??'');
  if(!/^\d{1,4}(\.\d{1,2})?$/.test(raw)||units(raw)<=0n||units(raw)>1000n*SCALE)throw new HttpError(400,'追加金额需在 0.01 至 1000 元之间');
  const account=await transaction(pool,async db=>{
   if(!(await db.query("SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[org,userId])).rowCount)throw new HttpError(404,'有效员工不存在');
   const row=(await db.query('INSERT INTO employee_credit_accounts(user_id,organization_id,granted_yuan) VALUES($1,$2,$3::numeric+$4::numeric) ON CONFLICT(user_id) DO UPDATE SET granted_yuan=employee_credit_accounts.granted_yuan+$4::numeric RETURNING granted_yuan,spent_yuan',[userId,org,GRANT_YUAN,raw])).rows[0];
   await audit(db,req.actor,'employee_credit.topped_up',org,userId,{yuan:raw});return row;
  });
  res.json(account);
 });
 // Sets the total allowance: raising tops up, lowering takes back what has not been used or reserved.
 app.post('/api/employee-credit/team/members/:user/quota',requireCustomer,async(req,res)=>{
  const org=await requireManager(req),userId=text(req.params.user,'员工',64),raw=String(req.body?.yuan??'');
  if(!/^\d{1,5}(\.\d{1,2})?$/.test(raw)||units(raw)>10000n*SCALE)throw new HttpError(400,'额度需在 0 至 10000 元之间');
  const account=await transaction(pool,async db=>{
   if(!(await db.query("SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[org,userId])).rowCount)throw new HttpError(404,'有效员工不存在');
   await db.query('INSERT INTO employee_credit_accounts(user_id,organization_id,granted_yuan) VALUES($1,$2,$3) ON CONFLICT(user_id) DO NOTHING',[userId,org,GRANT_YUAN]);
   await db.query('SELECT user_id FROM employee_credit_accounts WHERE user_id=$1 FOR UPDATE',[userId]);
   const money=await balance(db,userId);
   if(units(raw)<units(money.spent_yuan)+units(money.held_yuan))throw new HttpError(409,'额度不能低于已用和结算中的金额');
   const row=(await db.query('UPDATE employee_credit_accounts SET granted_yuan=$2 WHERE user_id=$1 RETURNING granted_yuan,spent_yuan',[userId,raw])).rows[0];
   await audit(db,req.actor,'employee_credit.quota_set',org,userId,{before:money.granted_yuan,after:raw});return row;
  });
  res.json(account);
 });
 const health={at:0,models:[],running:null};
 async function probeModels(){
  const [routes,paused]=await Promise.all([employeeRoutes(pool,cfg,{includePaused:true}),pool.query('SELECT model_id FROM channel_states WHERE paused')]);
  const live=new Map(routes.map(r=>[r.model.id,r])),stopped=new Set(paused.rows.map(r=>r.model_id));
  return Promise.all(OFFICIAL_MODELS.map(async model=>{
   const route=live.get(model.id),checked_at=new Date().toISOString(),base={model_id:model.id,name:model.name};
   if(!route)return {...base,status:'unavailable',latency_ms:null,checked_at};
   if(stopped.has(model.id))return {...base,status:'paused',latency_ms:null,checked_at};
   const started=performance.now();
   try{
    const secret=await upstreamSecret(route,cfg);
    const response=await upstreamFetch(`${route.baseUrl}/chat/completions`,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({model:model.upstreamModel,messages:[{role:'user',content:'ping'}],max_tokens:1,stream:false}),redirect:'error',signal:AbortSignal.timeout(HEALTH_TIMEOUT_MS)});
    const latency_ms=Math.round(performance.now()-started);await response.body?.cancel().catch(()=>{});
    return {...base,status:response.ok?'ok':'failed',latency_ms,checked_at};
   }catch(error){return {...base,status:'failed',latency_ms:null,error:error.name==='TimeoutError'?'timeout':'network',checked_at};}
  }));
 }
 // Platform-paid probes with max_tokens 1; never charged to an employee and never stored.
 app.get('/api/employee-credit/model-health',requireCustomer,async(req,res)=>{
  if(!await member(req))throw new HttpError(403,'当前账号不是公司员工，未开放公司额度');
  if(Date.now()-health.at>HEALTH_TTL_MS){health.running??=probeModels().then(models=>{health.models=models;health.at=Date.now();}).finally(()=>{health.running=null;});await health.running;}
  res.json({checked_at:new Date(health.at).toISOString(),refresh_seconds:HEALTH_TTL_MS/1000,models:health.models});
 });
 app.post('/api/employee-credit/model-health/refresh',requireCustomer,async(req,res)=>{
  if(!await member(req))throw new HttpError(403,'当前账号不是公司员工，未开放公司额度');
  const throttled=Date.now()-health.at<HEALTH_MIN_GAP_MS;
  if(!throttled){health.running??=probeModels().then(models=>{health.models=models;health.at=Date.now();}).finally(()=>{health.running=null;});await health.running;}
  res.json({throttled,retry_after_seconds:throttled?Math.ceil((HEALTH_MIN_GAP_MS-(Date.now()-health.at))/1000):0,checked_at:new Date(health.at).toISOString(),refresh_seconds:HEALTH_TTL_MS/1000,models:health.models});
 });
 app.get('/api/employee-credit/status',requireCustomer,async(req,res)=>{
  const organization=await member(req);
  if(!organization)return res.json({enabled:false});
  await ensureAccount(pool,cfg,req);
  const [money,keys,calls,available,daily,period]=await Promise.all([
   balance(pool,req.customer.id),
   pool.query(`SELECT k.id,k.label,k.key_hint,k.created_at,k.revoked_at,k.model_ids,k.limit_yuan,(SELECT ${USED_ON_KEY} FROM employee_calls WHERE key_id=k.id) AS used_yuan,coalesce(u.calls,0)::int AS calls,coalesce(u.tokens,0)::bigint AS tokens,coalesce(u.yuan,0) AS yuan,u.last_call_at
    ,coalesce(u.active,0)::int AS active_calls,u.last_client,coalesce(u.calls_24h,0)::int AS calls_24h,coalesce(u.tokens_24h,0)::bigint AS tokens_24h,coalesce(p.peak,0)::int AS peak_rpm
    FROM employee_api_keys k LEFT JOIN (SELECT key_id,count(*) AS calls,sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)) AS tokens,sum(coalesce(charged_yuan,0)) AS yuan,max(created_at) AS last_call_at,count(*) FILTER(WHERE status='pending' AND created_at>now()-interval '10 minutes') AS active,(array_agg(client ORDER BY created_at DESC))[1] AS last_client,count(*) FILTER(WHERE created_at>now()-interval '24 hours') AS calls_24h,coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)) FILTER(WHERE created_at>now()-interval '24 hours'),0) AS tokens_24h FROM employee_calls WHERE owner_id=$1 GROUP BY key_id) u ON u.key_id=k.id
    LEFT JOIN (SELECT key_id,max(n) AS peak FROM (SELECT key_id,count(*) AS n FROM employee_calls WHERE owner_id=$1 AND created_at>now()-interval '24 hours' GROUP BY key_id,date_trunc('minute',created_at)) x GROUP BY key_id) p ON p.key_id=k.id
    WHERE k.owner_id=$1 ORDER BY k.created_at DESC LIMIT 20`,[req.customer.id]),
   pool.query('SELECT c.id,k.label AS key_label,c.model_id,c.status,c.hold_yuan,c.charged_yuan,c.settlement_source,c.input_tokens,c.cached_input_tokens,c.output_tokens,c.latency_ms,c.error_code,c.client,c.created_at FROM employee_calls c JOIN employee_api_keys k ON k.id=c.key_id WHERE c.owner_id=$1 ORDER BY c.created_at DESC LIMIT 30',[req.customer.id]),
   employeeRoutes(pool,cfg),
   pool.query("SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS day,model_id,count(*)::int AS calls,coalesce(sum(charged_yuan),0) AS yuan FROM employee_calls WHERE owner_id=$1 AND created_at>=now()-interval '14 days' GROUP BY 1,2 ORDER BY 1,2",[req.customer.id]),
   pool.query("SELECT count(*)::int AS calls_30d,count(*) FILTER(WHERE status='failed')::int AS failed_30d,coalesce(sum(charged_yuan) FILTER(WHERE settled_at>=(date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')),0) AS month_yuan FROM employee_calls WHERE owner_id=$1 AND created_at>=now()-interval '30 days'",[req.customer.id])
  ]);
  res.json({enabled:true,summaries_enabled:await summariesOn(pool,cfg),summary_chars:SUMMARY_CHARS,organization_id:organization.id,organization_name:organization.name,...money,base_url:cfg.origin+'/v1',model_ids:available.map(r=>r.model.id),models:available.map(r=>publicModel(r.model)),daily:daily.rows,...period.rows[0],key_limit:MAX_KEYS,max_output_tokens:MAX_OUTPUT,keys:keys.rows,recent_calls:calls.rows});
 });
 app.post('/api/employee-credit/keys',requireCustomer,async(req,res)=>{
  await requireMember(req);
  const label=text(req.body?.label,'Key 名称',50),secret='sf_emp_'+token(),b=req.body||{};
  let models=null,limit=null;
  if(b.models!==undefined&&b.models!==null){
   if(!Array.isArray(b.models)||!b.models.length||b.models.length>OFFICIAL_MODELS.length||b.models.some(m=>!OFFICIAL_MODELS.some(x=>x.id===m)))throw new HttpError(400,'请至少勾选一个可用模型');
   models=[...new Set(b.models)];
  }
  if(b.limit_yuan!==undefined&&b.limit_yuan!==null&&b.limit_yuan!==''){const raw=String(b.limit_yuan);if(!moneyPattern.test(raw)||Number(raw)<=0)throw new HttpError(400,'消费上限需为大于 0 的金额，最多两位小数');limit=raw;}
  const key=await transaction(pool,async db=>{
   await db.query('SELECT user_id FROM employee_credit_accounts WHERE user_id=$1 FOR UPDATE',[req.customer.id]);
   const count=(await db.query('SELECT count(*)::int AS count FROM employee_api_keys WHERE owner_id=$1 AND revoked_at IS NULL',[req.customer.id])).rows[0].count;
   if(count>=MAX_KEYS)throw new HttpError(409,`最多保留 ${MAX_KEYS} 枚有效 Key，请先停用旧 Key`);
   const created=(await db.query('INSERT INTO employee_api_keys(owner_id,label,secret_hash,key_hint,model_ids,limit_yuan) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,label,key_hint,created_at,model_ids,limit_yuan',[req.customer.id,label,hash(secret),secret.slice(-6),models,limit])).rows[0];
   await audit(db,req.actor,'employee_credit.key_created',cfg.employeeCredit.organizationId,created.id,{models,limit_yuan:limit});return created;
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

/** Must be mounted before the app-wide 16 KB JSON parser; agent requests carry whole conversations and tool schemas. */
export function employeeInferenceRoutes(app,pool,cfg,upstreamFetch=fetch){
 const isEmployee=req=>keyPattern.test(req.get('authorization')||'');
 app.use('/v1',(req,res,next)=>{req.requestId='req_'+token().slice(0,24);res.set('X-Semifly-Request-Id',req.requestId);next();});
 const json=express.json({limit:MAX_BODY});
 const parser=(req,res,next)=>json(req,res,err=>next(err?.type==='entity.too.large'?new HttpError(413,`请求内容超过 ${MAX_BODY.toUpperCase()}，请在智能体中新开对话或压缩上下文后重试`):err));
 async function authenticate(req){
  if(!enabled(cfg))throw new HttpError(503,'公司额度尚未开放');
  const secret=keyPattern.exec(req.get('authorization'))[1];
  const key=(await pool.query(`SELECT k.id AS key_id,k.owner_id,k.model_ids,k.limit_yuan FROM employee_api_keys k JOIN "user" u ON u.id=k.owner_id
   JOIN memberships m ON m.user_id=k.owner_id AND m.organization_id=$2 AND m.status='active'
   WHERE k.secret_hash=$1 AND k.revoked_at IS NULL AND u."emailVerified" AND NOT coalesce(u.disabled,false)`,[hash(secret),cfg.employeeCredit.organizationId])).rows[0];
  if(!key)throw new HttpError(401,'平台 Key 无效或已停用');
  return key;
 }
 async function limit(keyId,res){
  // Per key, not per IP: a whole office usually shares one egress address.
  const count=(await pool.query("INSERT INTO request_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.expires_at<now() THEN 1 ELSE request_limits.count+1 END,expires_at=CASE WHEN request_limits.expires_at<now() THEN now()+interval '1 minute' ELSE request_limits.expires_at END RETURNING count",[hash('employee-v1|'+keyId)])).rows[0].count;
  if(count>PER_MINUTE){res.set('Retry-After','60');throw new HttpError(429,`请求过于频繁：每把 Key 每分钟最多 ${PER_MINUTE} 次`,'rate_limit_exceeded');}
 }
 const fail=(callId,code,started,detail=null)=>pool.query("UPDATE employee_calls SET status='failed',error_code=$2,latency_ms=$3,error_detail=$4,finished_at=now() WHERE id=$1 AND status='pending'",[callId,code,Math.round(performance.now()-started),detail?String(detail).slice(0,300):null]);
 /** Charges the official price as soon as usage is known; without usage the hold stays until a bill arrives. */
 async function answered(call,requestId,usage,started){
  const latency=Math.round(performance.now()-started);
  if(!usage){await pool.query("UPDATE employee_calls SET status='awaiting_bill',upstream_request_id=$2,latency_ms=$3,finished_at=now() WHERE id=$1 AND status='pending'",[call.id,requestId,latency]);return;}
  const amount=holdYuan(call.rates,usage,call.multiplier);
  await transaction(pool,async db=>{
   const account=(await db.query('SELECT granted_yuan-spent_yuan AS remaining FROM employee_credit_accounts WHERE user_id=$1 FOR UPDATE',[call.ownerId])).rows[0];
   // Never overdrawn, even when real usage exceeds the pre-call bound; actual_yuan keeps the true price.
   const charged=(await db.query(`UPDATE employee_calls SET status='settled',upstream_request_id=$2,input_tokens=$3,cached_input_tokens=$4,output_tokens=$5,actual_yuan=$6::numeric,charged_yuan=LEAST($6::numeric,$7::numeric),settlement_source='official_price',latency_ms=$8,finished_at=now(),settled_at=now() WHERE id=$1 AND status='pending' RETURNING charged_yuan`,
    [call.id,requestId,usage.input,usage.cached,usage.output,amount,account.remaining,latency])).rows[0];
   if(charged)await db.query('UPDATE employee_credit_accounts SET spent_yuan=spent_yuan+$2 WHERE user_id=$1',[call.ownerId,charged.charged_yuan]);
  });
 }
 app.get('/v1/models',(req,res,next)=>isEmployee(req)?next():next('route'),async(req,res)=>{
  const key=await authenticate(req);
  res.json({object:'list',data:(await employeeRoutes(pool,cfg)).filter(r=>!key.model_ids||key.model_ids.includes(r.model.id)).map(r=>({id:r.model.id,object:'model',owned_by:'semifly'}))});
 });
 app.post('/v1/chat/completions',(req,res,next)=>isEmployee(req)?parser(req,res,next):next('route'),async(req,res)=>{
  const key=await authenticate(req);
  await limit(key.key_id,res);
  const origin=callClient(name=>req.get(name));
  let shaped;try{shaped=employeeRequest(req.body);}catch(e){if(e instanceof HttpError&&e.status===400){const rejected=recordProfile(pool,origin,req.body,e.message);captureHook?.(key.key_id,rejected,origin,e.message);}throw e;}
  const {model,payload,stream,input,output}=shaped,signature=recordProfile(pool,origin,req.body);
  captureHook?.(key.key_id,signature,origin,null);
  if(key.model_ids&&!key.model_ids.includes(model.id))throw new HttpError(403,`这把 Key 只能调用：${key.model_ids.join('、')}`,'model_not_allowed');
  const route=(await employeeRoutes(pool,cfg)).find(r=>r.model.id===model.id);
  if(!route)throw new HttpError(503,'这个模型暂时不可用','model_unavailable');
  const multiplier=priceMultiplier(model,new Date(),cfg.employeeCredit.holidays),hold=holdYuan(model.rates,{input,output},multiplier);
  const summary=await summariesOn(pool,cfg)?callSummary(req.body.messages):null;
  const callId=await transaction(pool,async db=>{
   // The row lock serialises reservations so concurrent calls cannot overspend.
   await db.query('SELECT user_id FROM employee_credit_accounts WHERE user_id=$1 FOR UPDATE',[key.owner_id]);
   const money=await balance(db,key.owner_id);
   const active=(await db.query(`SELECT count(*)::int AS count FROM employee_calls WHERE owner_id=$1 AND status='pending' AND created_at>now()-interval '${STALE_PENDING}'`,[key.owner_id])).rows[0].count;
   if(active>=MAX_CONCURRENT){res.set('Retry-After','5');throw new HttpError(429,`同时最多 ${MAX_CONCURRENT} 个请求`,'concurrency_limit_exceeded');}
   if(units(money.available_yuan<0?0:money.available_yuan)<units(hold))throw new HttpError(402,'公司额度不足以覆盖这次调用的上限，可调小 max_tokens');
   if(key.limit_yuan!==null){const used=(await db.query(`SELECT ${USED_ON_KEY} AS used FROM employee_calls WHERE key_id=$1`,[key.key_id])).rows[0].used;if(units(used)+units(hold)>units(key.limit_yuan))throw new HttpError(402,`这把 Key 已接近消费上限 ¥${Number(key.limit_yuan)}（已用 ¥${Number(used).toFixed(4)}），可调小 max_tokens 或换一把 Key`,'key_limit_reached');}
   return (await db.query("INSERT INTO employee_calls(key_id,owner_id,model_id,credential_id,upstream,price_snapshot,status,hold_yuan,client,client_detail,summary,profile_signature) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11) RETURNING id",[key.key_id,key.owner_id,model.id,route.credentialId,model.upstream,{...model.rates,multiplier},hold,origin.client,origin.detail,summary,signature])).rows[0].id;
  });
  const call={id:callId,ownerId:key.owner_id,rates:model.rates,multiplier};
  const started=performance.now(),abort=new AbortController();
  // 'finish' also fires 'close'; only a close before the response ended is a disconnect.
  res.on('close',()=>{if(!res.writableEnded)abort.abort();});
  let response,upstreamKey,used=route;
  const candidates=[route,...(route.fallbacks||[])];
  for(let i=0;i<candidates.length;i++){
  const candidate=candidates[i],last=i===candidates.length-1;
  try{
   upstreamKey=await upstreamSecret(candidate,cfg);
   response=await upstreamFetch(`${candidate.baseUrl}/chat/completions`,{method:'POST',headers:{Authorization:'Bearer '+upstreamKey,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)])});
  }catch(error){
   if(!last&&error.name!=='TimeoutError'&&!abort.signal.aborted){console.warn(JSON.stringify({event:'upstream_failover',call:callId,from:candidate.credentialId,reason:error.name}));continue;}
   await fail(callId,error.name==='TimeoutError'?'UPSTREAM_TIMEOUT':'UPSTREAM_FAILED',started,String(error.cause?.code||error.cause?.message||error.message||error.name).replaceAll(upstreamKey||'\u0000','[REDACTED]'));
   throw new HttpError(502,'上游调用失败；本次未扣额度');
  }
  if(!last&&(response.status===401||response.status===403)){await response.body?.cancel().catch(()=>{});console.warn(JSON.stringify({event:'upstream_failover',call:callId,from:candidate.credentialId,reason:'http_'+response.status}));continue;}
  used=candidate;break;
  }
  if(used!==route)await pool.query('UPDATE employee_calls SET credential_id=$2 WHERE id=$1',[callId,used.credentialId]);
  const requestId=String(response.headers.get('x-request-id')||response.headers.get('x-oneapi-request-id')||'').slice(0,120)||null;
  if(!response.ok){
   const raw=(await response.text().catch(()=>'')).slice(0,4000);
   let message='';try{const m=JSON.parse(raw)?.error?.message;if(typeof m==='string')message=m.replaceAll(upstreamKey,'[REDACTED]').slice(0,500);}catch{}
   await fail(callId,'UPSTREAM_HTTP_'+response.status,started,message||raw.replaceAll(upstreamKey,'[REDACTED]').slice(0,300)||null);
   throw new HttpError(response.status>=400&&response.status<500?response.status:502,`上游返回 HTTP ${response.status}${message?'：'+message:''}；本次未扣额度`);
  }
  res.set('X-Semifly-Call-Id',callId);
  if(!stream){
   let result;
   try{result=await response.json();}
   catch{await answered(call,requestId,null,started);throw new HttpError(502,'上游响应格式异常','upstream_bad_response');}
   await answered(call,requestId,usageFrom(result.usage),started);
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
   await answered(call,requestId,usage,started);
   res.end();
  }
 });
}

/** Settles calls whose response carried no usage, from KerAPI's log or the hold. Safe to repeat. */
export async function settleEmployeeCalls(pool){
 await pool.query("UPDATE employee_calls SET summary=NULL WHERE summary IS NOT NULL AND created_at<now()-interval '30 days'");
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
