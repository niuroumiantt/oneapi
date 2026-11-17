import express from 'express';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {HttpError,hash} from './core.mjs';
import {employeeRequest} from './employee-credit.mjs';
import {findOfficialModel} from './official-models.mjs';
import {routeFetch} from './output-guard.mjs';
import {REFERENCE_PROVIDERS,referenceTarget,publicFetch} from './compare-network.mjs';
import {consumeCompletion,readLimited,scrub} from './compare-stream.mjs';
import {extractAttachment,sharedMessages,FILE_LIMIT,TEXT_LIMIT} from './compare-files.mjs';

const keyValue=v=>{if(typeof v!=='string'||v.trim().length<8||v.length>4096||/[^\x21-\x7e]/.test(v.trim()))throw new HttpError(400,'请填写有效的 API Key，不要包含空格或换行');return v.trim();};
const modelValue=v=>{if(typeof v!=='string'||!v.trim()||v.length>200||/[\x00-\x1f\x7f]/.test(v))throw new HttpError(400,'请选择或填写有效的模型 ID');return v.trim();};
export async function ownPlatformKey(pool,userId,secret){
 const match=/^sf_(paid|emp)_[A-Za-z0-9_-]{43}$/.exec(secret);if(!match)throw new HttpError(400,'左侧请使用本站生成的 sf_paid_ 或 sf_emp_ 平台 Key');
 const table=match[1]==='paid'?'customer_api_keys':'employee_api_keys';
 const row=(await pool.query(`SELECT id FROM ${table} WHERE secret_hash=$1 AND owner_id=$2 AND revoked_at IS NULL`,[hash(secret),userId])).rows[0];
 if(!row)throw new HttpError(403,'平台 Key 不属于当前登录用户，或已停用');
 return {id:row.id,kind:match[1]};
}
function parameters(body){
 const p=body.parameters||{},max=p.max_tokens??4096;
 if(!Number.isInteger(max)||max<64||max>8192)throw new HttpError(400,'最大输出 Token 必须为 64 至 8192 的整数');
 const out={max_tokens:max,stream:true,stream_options:{include_usage:true}};
 if(p.temperature!==undefined&&p.temperature!==null){if(typeof p.temperature!=='number'||!Number.isFinite(p.temperature)||p.temperature<0||p.temperature>2)throw new HttpError(400,'Temperature 必须为 0 至 2');out.temperature=p.temperature;}
 if(p.thinking&&p.thinking!=='default'){if(!['enabled','disabled'].includes(p.thinking))throw new HttpError(400,'推理模式无效');out.thinking={type:p.thinking};}
 if(p.reasoning_effort&&p.reasoning_effort!=='default'){if(!['low','high','max'].includes(p.reasoning_effort))throw new HttpError(400,'推理强度无效');out.reasoning_effort=p.reasoning_effort;}
 return out;
}

export function customerCompareRoutes(app,pool,cfg,requireCustomer){
 const router=express.Router(),active=new Set();
 // Injection exists only in server configuration for controlled tests, never in request data.
 const remote=cfg.compareReferenceFetch||publicFetch,local=cfg.comparePlatformFetch||fetch;
 router.use(requireCustomer,express.json({limit:'8mb'}));
 router.use(async(req,_res,next)=>{
  const count=(await pool.query("INSERT INTO request_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.expires_at<now() THEN 1 ELSE request_limits.count+1 END,expires_at=CASE WHEN request_limits.expires_at<now() THEN now()+interval '1 minute' ELSE request_limits.expires_at END RETURNING count",[hash('customer-compare|'+req.customer.id)])).rows[0].count;
  if(count>30)throw new HttpError(429,'对比台操作频繁，请一分钟后重试');next();
 });
 const platformURL=req=>`http://127.0.0.1:${req.socket.localPort}/v1`;
 const headers=key=>({'Authorization':'Bearer '+key,'Content-Type':'application/json','X-Semifly-Client':'API-Compare'});
 async function platformModels(req,key,signal){
  const response=await local(platformURL(req)+'/models',{headers:headers(key),redirect:'error',signal});
  const raw=await readLimited(response);let data;try{data=JSON.parse(raw);}catch{throw new HttpError(502,'平台模型列表暂时不可读');}
  if(!response.ok)throw new HttpError(response.status>=400&&response.status<500?response.status:503,scrub(data.error?.message||data.error||'平台 Key 验证失败',[key]));
  return Array.isArray(data.data)?data.data:[];
 }
 router.get('/config',(_req,res)=>res.json({providers:REFERENCE_PROVIDERS,protocol:'OpenAI Chat Completions',max_file_bytes:FILE_LIMIT,max_text_characters:TEXT_LIMIT,max_files:5,max_output_tokens:8192,timeout_seconds:180,retention:'会话内使用，服务器不保存对比任务、附件或自带密钥；平台调用按现有用量账本记录。'}));
 router.post('/models',async(req,res)=>{
  const b=req.body||{},key=keyValue(b.key),signal=AbortSignal.timeout(20000);
  if(b.side==='ours'){
   await ownPlatformKey(pool,req.customer.id,key);const models=await platformModels(req,key,signal);
   return res.json({models:models.map(m=>({id:m.id,name:m.name||m.id,capabilities:m.capabilities||null,upstream_model:findOfficialModel(m.id)?.upstreamModel||null})),source:'platform',manual:false});
  }
  const ref=referenceTarget(b.reference);
  let response;try{response=await remote(ref.base_url+'/models',{headers:headers(key),redirect:'error',signal});}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(502,'无法连接该接口，请检查地址、网络和密钥');}
  if([404,405,501].includes(response.status)){await response.body?.cancel();return res.json({models:[],manual:true,reference:ref,message:'该接口没有模型列表接口，请按供应商文档手动填写模型 ID；尚未验证调用权限。'});}
  const raw=await readLimited(response);let data;try{data=JSON.parse(raw);}catch{throw new HttpError(502,'模型列表不是有效 JSON；请检查 Base URL');}
  if(!response.ok)throw new HttpError([401,403,429].includes(response.status)?response.status:502,'参照接口返回 '+response.status+'：'+scrub(data.error?.message||data.message||'请检查密钥、额度或地址',[key]));
  if(!Array.isArray(data.data))return res.json({models:[],manual:true,reference:ref,message:'接口未返回标准模型列表，请手动填写模型 ID。'});
  res.json({models:data.data.filter(m=>typeof m.id==='string'&&m.id.length<=200).slice(0,500).map(m=>({id:m.id})),reference:ref,manual:true});
 });
 router.post('/attachment',async(req,res)=>res.json(await extractAttachment(req.body)));
 router.post('/run',async(req,res)=>{
  if(active.has(req.customer.id)||active.size>=4)throw new HttpError(429,'当前有对比正在进行，请完成或停止后重试');
  const b=req.body||{},ourKey=keyValue(b.ours?.key),refKey=keyValue(b.reference?.key),ours=modelValue(b.ours?.model),reference=referenceTarget(b.reference),refModel=modelValue(b.reference?.model);
  const owner=await ownPlatformKey(pool,req.customer.id,ourKey),shared=sharedMessages(b.prompt,b.system,b.attachments),params=parameters(b);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(new Error('TIMEOUT')),cfg.compareTimeoutMs||180000);
  const disconnect=()=>{if(!res.writableEnded)controller.abort(new Error('CLIENT_CLOSED'));};res.on('close',disconnect);
  if(active.has(req.customer.id)||active.size>=4){clearTimeout(timeout);res.off('close',disconnect);throw new HttpError(429,'当前有对比正在进行，请完成或停止后重试');}
  active.add(req.customer.id);
  try{
   const catalog=await platformModels(req,ourKey,controller.signal),chosen=catalog.find(m=>m.id===ours);
   if(!chosen)throw new HttpError(403,'所选平台模型不在这把 Key 当前可调用的目录中，请重新读取模型');
   if(shared.images&&!chosen.capabilities?.input?.includes('image'))throw new HttpError(400,'所选平台模型不支持图片，请移除图片或切换模型');
   if(shared.images&&b.reference_supports_images!==true)throw new HttpError(400,'请先确认右侧接口和模型支持图片输入');
   // Freeze one payload AFTER platform normalization, then change only the model identifier for B.
   // This exposes existing gateway parameter adjustments instead of silently running unlike requests.
   const shaped=employeeRequest({model:ours,messages:shared.messages,...params});
   const {model:_model,messages:_messages,...effective}=shaped.payload;
   const requestHash=createHash('sha256').update(JSON.stringify({messages:shaped.payload.messages,parameters:effective})).digest('hex');
   const runId=randomUUID(),secrets=[ourKey,refKey];
   res.status(200).set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders();
   const send=async(type,data)=>{if(res.destroyed||res.writableEnded)return;if(!res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))await Promise.race([once(res,'drain'),once(res,'close')]);};
   await send('meta',{run_id:runId,created_at:new Date().toISOString(),reference,models:{a:ours,a_upstream:shaped.model.upstreamModel,b:refModel},parameters:effective,parameters_adjusted:JSON.stringify(params)!==JSON.stringify(effective),input_sha256:requestHash,attachments:shared.manifest,measurement:'同一服务端分别从请求发出计时；平台侧包含网关鉴权、路由与计费处理。',retention:'不保存对比内容或密钥'});
   const ping=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},15000);
   try{await Promise.all(['a','b'].map(async side=>{
    const started=performance.now();let result;
    try{
     const isA=side==='a',payload={...shaped.payload,model:isA?ours:refModel};
     const response=await (isA?local(platformURL(req)+'/chat/completions',{method:'POST',headers:headers(ourKey),body:JSON.stringify(payload),redirect:'error',signal:controller.signal}):routeFetch(pool,remote,refModel,reference.base_url+'/chat/completions',{method:'POST',headers:headers(refKey),body:JSON.stringify(payload),redirect:'error',signal:controller.signal}));
     result=await consumeCompletion(response,{started,secrets,onDelta:delta=>send('delta',{side,...delta})});
     if(isA&&result.platform_call_id&&/^[0-9a-f-]{36}$/i.test(result.platform_call_id)){
      const table=owner.kind==='paid'?'customer_calls':'employee_calls';
      const bill=(await pool.query(`SELECT status,charged_yuan,settlement_source FROM ${table} WHERE id=$1 AND key_id=$2`,[result.platform_call_id,owner.id]).catch(()=>({rows:[]}))).rows[0];
      if(bill)result.billing={...bill,currency:'CNY',source:'platform_ledger'};
     }
    }catch(e){result={status:'failed',error:e instanceof HttpError?scrub(e.message,secrets):'连接失败或响应中断，请检查接口、额度及网络',usage:null,timing:{first_text_ms:null,total_ms:Math.round(performance.now()-started)}};}
    if(controller.signal.aborted){result.status=controller.signal.reason?.message==='TIMEOUT'?'timeout':'cancelled';result.error=result.status==='timeout'?'本次对比超过 180 秒，已停止；上游已发生用量仍可能计费':'请求已取消；已发生用量仍可能计费';}
    await send('result',{side,...result});
   }));await send('end',{run_id:runId});}finally{clearInterval(ping);res.end();}
  }finally{clearTimeout(timeout);active.delete(req.customer.id);res.off('close',disconnect);}
 });
 app.use('/api/compare',router);
}
