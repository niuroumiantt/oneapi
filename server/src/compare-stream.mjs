import {performance} from 'node:perf_hooks';
const integer=n=>Number.isSafeInteger(n)&&n>=0?n:null;
export function normalizeUsage(u){
 if(!u||typeof u!=='object')return null;
 const input=integer(u.prompt_tokens),output=integer(u.completion_tokens);
 const cache=integer(u.prompt_tokens_details?.cached_tokens??u.prompt_cache_hit_tokens);
 const reasoning=integer(u.completion_tokens_details?.reasoning_tokens);
 return {input_tokens:input,output_tokens:output,cached_input_tokens:cache!==null&&(input===null||cache<=input)?cache:null,
  cache_write_tokens:integer(u.prompt_tokens_details?.cache_write_tokens??u.cache_creation_input_tokens),
  reasoning_tokens:reasoning!==null&&(output===null||reasoning<=output)?reasoning:null,
  total_tokens:input!==null&&output!==null?input+output:integer(u.total_tokens),
  source:'upstream_usage',reported_total_tokens:integer(u.total_tokens)};
}
export function scrub(value,secrets=[]){let s=String(value??'').slice(0,4000);for(const secret of secrets)if(secret)s=s.split(secret).join('[REDACTED]');return s.replace(/\bBearer\s+[^\s"']+/gi,'Bearer [REDACTED]').replace(/\b(?:sk-|sf_paid_|sf_emp_)[A-Za-z0-9_.-]{8,}/g,'[REDACTED]').slice(0,500);}
export async function readLimited(response,max=262144){
 const reader=response.body?.getReader();if(!reader)return '';const parts=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('响应内容超过读取上限');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(parts).toString('utf8');
}
export async function consumeCompletion(response,{started=performance.now(),onDelta=()=>{},secrets=[],maxBytes=2*1024*1024}={}){
 const result={status:'complete',http_status:response.status,response_model:null,request_id:scrub(response.headers.get('x-request-id')||response.headers.get('x-oneapi-request-id')||'',secrets)||null,
  platform_call_id:response.headers.get('x-semifly-call-id')||null,finish_reason:null,usage:null,timing:{first_text_ms:null,first_reasoning_ms:null,total_ms:null},end_to_end_tokens_per_second:null,warnings:[]};
 let finish=false,doneMarker=false,visibleChars=0,bytes=0;
 const receive=async event=>{
  if(event.error)throw Error(scrub(event.error.message||event.error,secrets));
  if(typeof event.model==='string')result.response_model=scrub(event.model,secrets);
  if(typeof event.id==='string'&&!result.request_id)result.request_id=scrub(event.id,secrets);
  if(event.usage)result.usage=normalizeUsage(event.usage);
  const c=event.choices?.[0];if(!c)return;
  if(c.finish_reason){result.finish_reason=String(c.finish_reason).slice(0,60);finish=true;}
  const d=c.delta||c.message||{};
  const text=typeof d.content==='string'?d.content:Array.isArray(d.content)?d.content.filter(p=>p?.type==='text').map(p=>p.text||'').join(''):'';
  const reasoning=typeof d.reasoning_content==='string'?d.reasoning_content:typeof d.reasoning==='string'?d.reasoning:'';
  if(text&&result.timing.first_text_ms===null)result.timing.first_text_ms=Math.round(performance.now()-started);
  if(reasoning&&result.timing.first_reasoning_ms===null)result.timing.first_reasoning_ms=Math.round(performance.now()-started);
  visibleChars+=text.length;
  if(d.tool_calls?.length)result.warnings.push('接口返回工具调用；对比台不执行外部工具。');
  if(text||reasoning)await onDelta({text,reasoning});
 };
 try{
  if(!response.ok){const raw=await readLimited(response,65536);let message;try{const e=JSON.parse(raw);message=e.error?.message||e.message;}catch{}throw Error(`HTTP ${response.status}${message?'：'+scrub(message,secrets):''}`);}
  if(/text\/event-stream/i.test(response.headers.get('content-type')||'')){
   const reader=response.body?.getReader();if(!reader)throw Error('接口没有返回响应流');
   let buffer='',data=[];const decoder=new TextDecoder();
   const dispatch=async()=>{if(!data.length)return;const value=data.join('\n').trim();data=[];if(!value)return;if(value==='[DONE]'){doneMarker=true;return;}let event;try{event=JSON.parse(value);}catch{throw Error('接口流式数据不是有效 JSON');}await receive(event);};
   const line=async l=>{l=l.replace(/\r$/,'');if(!l)return dispatch();if(l.startsWith('data:'))data.push(l.slice(5).replace(/^ /,''));};
   try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw Error('响应过大，已停止读取；上游仍可能计费');buffer+=decoder.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n'))!==-1){await line(buffer.slice(0,i));buffer=buffer.slice(i+1);}}buffer+=decoder.decode();if(buffer)await line(buffer);await dispatch();}finally{await reader.cancel().catch(()=>{});}
   if(!finish&&!doneMarker)throw Error('响应流提前结束，未收到完成标记');
  }else{const raw=await readLimited(response,maxBytes);let parsed;try{parsed=JSON.parse(raw);}catch{throw Error('接口未返回有效 JSON 或 SSE');}await receive(parsed);if(!parsed.choices?.length)throw Error('接口没有返回 choices；请使用 Chat Completions 兼容接口');result.warnings.push('该接口返回非流式结果，首字时间包含整段响应等待，不能与流式首字直接比较。');}
  if(result.finish_reason==='length')result.status='truncated';
  if(result.finish_reason==='content_filter')result.status='filtered';
  if(!visibleChars)result.warnings.push('没有可见回答，可能仅返回推理、工具调用或受输出上限影响。');
 }catch(error){result.status='failed';result.error=scrub(error.message,secrets);}
 result.timing.total_ms=Math.round(performance.now()-started);
 if(result.usage?.output_tokens!==null&&result.usage?.output_tokens!==undefined&&result.timing.total_ms>0)result.end_to_end_tokens_per_second=result.usage.output_tokens/(result.timing.total_ms/1000);
 result.warnings=[...new Set(result.warnings)];return result;
}
