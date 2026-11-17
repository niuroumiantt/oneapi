import express from 'express';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {HttpError,hash} from './core.mjs';
import {employeeRequest} from './employee-credit.mjs';
import {publicCapabilities} from './official-models.mjs';
import {paidEnabled,paidRoutes} from './customer-credit.mjs';
import {comparisonAccounts,comparisonCredential} from './compare-access.mjs';
import {REFERENCE_PRICES,referencePriceSnapshot,estimateReference,platformBilling} from './compare-pricing.mjs';
import {routeFetch} from './output-guard.mjs';
import {REFERENCE_PROVIDERS,referenceTarget,publicFetch} from './compare-network.mjs';
import {consumeCompletion,readLimited,scrub} from './compare-stream.mjs';
import {extractAttachment,sharedMessages,FILE_LIMIT,TEXT_LIMIT} from './compare-files.mjs';

const keyValue=v=>{if(typeof v!=='string'||v.trim().length<8||v.length>4096||/[^\x21-\x7e]/.test(v.trim()))throw new HttpError(400,'请填写有效的 API Key，不要包含空格或换行');return v.trim();};
const modelValue=v=>{if(typeof v!=='string'||!v.trim()||v.length>200||/[\x00-\x1f\x7f]/.test(v))throw new HttpError(400,'请选择或填写有效的模型 ID');return v.trim();};
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
 router.use(requireCustomer,async(req,_res,next)=>{req.compareAccounts=await comparisonAccounts(pool,req.customer.id);if(!req.compareAccounts.length)throw new HttpError(402,'API 对比仅向已付费且有可用购买额度的用户开放，请先购买 API 额度');next();},express.json({limit:'8mb'}));
 router.use(async(req,_res,next)=>{
  const count=(await pool.query("INSERT INTO request_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.expires_at<now() THEN 1 ELSE request_limits.count+1 END,expires_at=CASE WHEN request_limits.expires_at<now() THEN now()+interval '1 minute' ELSE request_limits.expires_at END RETURNING count",[hash('customer-compare|'+req.customer.id)])).rows[0].count;
  if(count>30)throw new HttpError(429,'对比台操作频繁，请一分钟后重试');next();
 });
 const platformURL=req=>`http://127.0.0.1:${req.socket.localPort}/v1`;
 const headers=key=>({'Authorization':'Bearer '+key,'Content-Type':'application/json','X-Semifly-Client':'API-Compare'});
 async function platformCatalog(){
  if(!paidEnabled(cfg))throw new HttpError(503,'付费 API 暂未开放，请稍后重试');
  const routes=await (cfg.comparePaidRoutes?cfg.comparePaidRoutes():paidRoutes(pool,cfg));
  return routes.map(({model:m})=>({id:m.id,name:m.name||m.id,family:m.family,official_reference_model:m.family==='deepseek'?'deepseek-flash':m.upstreamModel,capabilities:publicCapabilities(m,8192),upstream_model:m.upstreamModel||null}));
 }
 router.get('/config',async(req,res)=>res.json({products:req.compareAccounts,models:await platformCatalog(),providers:REFERENCE_PROVIDERS,reference_prices:REFERENCE_PRICES,protocol:'OpenAI Chat Completions',max_file_bytes:FILE_LIMIT,max_text_characters:TEXT_LIMIT,max_files:5,max_output_tokens:8192,timeout_seconds:180,retention:'自带密钥仅用于本次会话，不写入数据库或报告；平台调用按已购账户计费。测试后请到供应商平台撤销测试 Key。'}));
 router.post('/models',async(req,res)=>{
  const b=req.body||{},signal=AbortSignal.timeout(20000);
  if(b.side==='ours')return res.json({products:req.compareAccounts,models:await platformCatalog(),source:'paid_account',manual:false});
  const key=keyValue(b.key);
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
  const b=req.body||{},refKey=keyValue(b.reference?.key),ours=modelValue(b.ours?.model),reference=referenceTarget(b.reference),refModel=modelValue(b.reference?.model);
  const account=req.compareAccounts.find(a=>a.account_id===b.ours?.account_id);
  if(!account)throw new HttpError(403,'请选择当前登录账号的已购产品；旧页面请刷新后重试');
  const referencePrice=referencePriceSnapshot(reference,refModel,b.reference_pricing,new Date(),cfg.employeeCredit?.holidays);
  const shared=sharedMessages(b.prompt,b.system,b.attachments),params=parameters(b);let credential=null;
  const retire=async()=>{if(!credential)return;const key=credential;credential=null;await pool.query("UPDATE customer_api_keys SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND purpose='compare'",[key.id]).catch(()=>{console.warn('comparison credential cleanup deferred to expiry');});};
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(new Error('TIMEOUT')),cfg.compareTimeoutMs||180000);
  const disconnect=()=>{if(!res.writableEnded)controller.abort(new Error('CLIENT_CLOSED'));};res.on('close',disconnect);
  if(active.has(req.customer.id)||active.size>=4){clearTimeout(timeout);res.off('close',disconnect);throw new HttpError(429,'当前有对比正在进行，请完成或停止后重试');}
  active.add(req.customer.id);
  try{
   const catalog=await platformCatalog(),chosen=catalog.find(m=>m.id===ours);
   if(!chosen)throw new HttpError(403,'所选模型不在已购产品当前可用的目录中，请刷新后重试');
   if(shared.images&&!chosen.capabilities?.input?.includes('image'))throw new HttpError(400,'所选平台模型不支持图片，请移除图片或切换模型');
   if(shared.images&&b.reference_supports_images!==true)throw new HttpError(400,'请先确认右侧接口和模型支持图片输入');
   // Freeze one payload AFTER platform normalization, then change only the model identifier for B.
   // This exposes existing gateway parameter adjustments instead of silently running unlike requests.
   const shaped=employeeRequest({model:ours,messages:shared.messages,...params});
   const {model:_model,messages:_messages,...effective}=shaped.payload;
   const requestHash=createHash('sha256').update(JSON.stringify({messages:shaped.payload.messages,parameters:effective})).digest('hex');
   credential=await comparisonCredential(pool,req.customer.id,account.account_id,ours);
   controller.signal.throwIfAborted();
   const ourKey=credential.secret,runId=randomUUID(),secrets=[ourKey,refKey];
   res.status(200).set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders();
   const send=async(type,data)=>{if(res.destroyed||res.writableEnded)return;if(!res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))await Promise.race([once(res,'drain'),once(res,'close')]);};
   await send('meta',{run_id:runId,created_at:new Date().toISOString(),reference,reference_price:referencePrice,product:{name:account.name,account_id:account.account_id},models:{a:ours,a_upstream:shaped.model.upstreamModel,b:refModel},parameters:effective,parameters_adjusted:JSON.stringify(params)!==JSON.stringify(effective),input_sha256:requestHash,attachments:shared.manifest,measurement:'同一服务端分别从请求发出计时；平台侧包含网关鉴权、路由与计费处理。',retention:'不保存对比内容或密钥'});
   const ping=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},15000);
   try{await Promise.all(['a','b'].map(async side=>{
    const started=performance.now();let result;
    try{
     const isA=side==='a',payload={...shaped.payload,model:isA?ours:refModel};
     const response=await (isA?local(platformURL(req)+'/chat/completions',{method:'POST',headers:headers(ourKey),body:JSON.stringify(payload),redirect:'error',signal:controller.signal}):routeFetch(pool,remote,refModel,reference.base_url+'/chat/completions',{method:'POST',headers:headers(refKey),body:JSON.stringify(payload),redirect:'error',signal:controller.signal}));
     result=await consumeCompletion(response,{started,secrets,onDelta:delta=>send('delta',{side,...delta})});
     if(isA&&result.platform_call_id&&/^[0-9a-f-]{36}$/i.test(result.platform_call_id)){
      result.billing=await platformBilling(pool,result.platform_call_id,credential.id).catch(()=>null);
     }
    }catch(e){result={status:'failed',error:e instanceof HttpError?scrub(e.message,secrets):'连接失败或响应中断，请检查接口、额度及网络',usage:null,timing:{first_text_ms:null,total_ms:Math.round(performance.now()-started)}};}
    if(controller.signal.aborted){result.status=controller.signal.reason?.message==='TIMEOUT'?'timeout':'cancelled';result.error=result.status==='timeout'?'本次对比超过 180 秒，已停止；上游已发生用量仍可能计费':'请求已取消；已发生用量仍可能计费';}
    if(side==='b')result.estimate=estimateReference(result,referencePrice);
    await send('result',{side,...result});
   }));await send('end',{run_id:runId});}finally{clearInterval(ping);await retire();res.end();}
  }finally{clearTimeout(timeout);active.delete(req.customer.id);res.off('close',disconnect);await retire();}
 });
 app.use('/api/compare',router);
}
