// Official list prices in yuan per million tokens, from the vendors' public CNY pricing pages
// (queried 2026-11-09). These are what employees are charged, whatever the upstream route costs.
// This file is the one model catalog: the gateway, /v1/models, the consoles and the public 模型广场 all read it.
// The 模型广场 copy (web/model-catalog.js) is generated from here by scripts/build_model_catalog.mjs; a test fails when it is stale.
const flash={input:'1',cached:'0.02',output:'4'};
// caps: what the model can do. `thinking`: 'switchable' = thinks by default and can be turned off, 'always' = cannot be turned off.
// `input` lists only what the 功能对比 probes confirmed on our route (2026-11-11 run); `context` and `officialMaxOutput` are the
// vendor's documented limits. deepseek-v4-pro has no route yet, so its caps are the vendor's documentation only.
const DEEPSEEK_PRICE='https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',GLM_PRICE='https://docs.bigmodel.cn/cn/guide/start/pricing';
const deepseekFlashCaps={thinking:'switchable',efforts:['low','high','max'],input:['text','image'],output:['text'],tools:true,parallelTools:true,json:true,jsonSchema:true,cache:true,context:'1M',officialMaxOutput:'384K'};
const glmCaps={thinking:'always',efforts:['low','high','max'],input:['text','image'],output:['text'],tools:true,parallelTools:true,json:true,jsonSchema:true,cache:false,context:'1M',officialMaxOutput:'128K'};
export const OFFICIAL_MODELS=[
 {id:'deepseek-flash',name:'DeepSeek Flash',family:'deepseek',upstream:'kerapi',upstreamModel:'deepseek-v4.1-flash',aliases:['deepseek-v4.1-flash'],rates:flash,peakPricing:true,tags:['对话创作','代码任务'],uses:['writing','coding','vision'],
  caps:deepseekFlashCaps,verified:true,version:'DeepSeek-V4.1-Flash-1017',priceSource:DEEPSEEK_PRICE,subtitle:'DeepSeek · 对话、代码、看图',description:'DeepSeek 的通用主力型号。默认先思考再回答，可以关闭思考；能看图，支持工具调用和 JSON 输出。'},
 {id:'deepseek-flash-0910',name:'DeepSeek Flash 0910',family:'deepseek',upstream:'kerapi',upstreamModel:'deepseek-v4.1-flash-0910',aliases:['deepseek-v4.1-flash-0910'],rates:flash,peakPricing:true,tags:['对话创作','代码任务'],uses:['writing','coding','vision'],
  caps:deepseekFlashCaps,verified:true,version:'供应商标注 deepseek-v4.1-flash-0910',priceSource:DEEPSEEK_PRICE,subtitle:'DeepSeek · 0910 版本',description:'供应商提供的 0910 版本 DeepSeek Flash。实测能力与 DeepSeek Flash 相同。'},
 {id:'deepseek-v4-pro',name:'DeepSeek V4 Pro',family:'deepseek',upstream:'deepseek',upstreamModel:'deepseek-v4-pro',aliases:[],rates:{input:'4.5',cached:'0.15',output:'13.5'},peakPricing:true,tags:['复杂分析','深度推理'],uses:['reasoning','coding'],
  caps:{thinking:'switchable',efforts:['low','high','max'],input:['text'],output:['text'],tools:true,parallelTools:false,json:true,jsonSchema:false,cache:true,context:'1M',officialMaxOutput:'384K'},verified:false,version:'DeepSeek-V4-Pro-0813',priceSource:DEEPSEEK_PRICE,subtitle:'DeepSeek · 复杂分析与推理',description:'DeepSeek 面向复杂分析的文本型号，只接受文字输入。线路尚未接通，能力按官方文档列出，未经我们实测。'},
 {id:'glm-5.3',name:'GLM-5.3',family:'glm',upstream:'kerapi',upstreamModel:'GLM-5.3',aliases:['GLM-5.3'],rates:{input:'8',cached:'2',output:'28'},peakPricing:false,tags:['文本任务','复杂推理'],uses:['writing','reasoning','coding'],
  caps:{...glmCaps,input:['text'],cache:true},verified:true,version:'以官方实际返回为准',priceSource:GLM_PRICE,subtitle:'智谱 GLM · 文本与复杂任务',description:'智谱的旗舰文本型号，只接受文字输入。始终先思考再回答，不能关闭，max_tokens 需要留足。'},
 {id:'glm-5.3-flash',name:'GLM-5.3-Flash',family:'glm',upstream:'kerapi',upstreamModel:'GLM-5.3-Flash',aliases:['GLM-5.3-Flash'],rates:{input:'0.8',cached:'0.23',output:'2.8'},peakPricing:false,tags:['轻量任务'],uses:['writing','vision','coding'],
  caps:glmCaps,verified:true,version:'以官方实际返回为准',priceSource:GLM_PRICE,subtitle:'智谱 GLM · 轻量、能看图',description:'智谱的轻量型号，价格最低，能看图。始终思考，思考强度最低可调到 low。'},
 {id:'glm-5.3-flashx',name:'GLM-5.3-FlashX',family:'glm',upstream:'kerapi',upstreamModel:'GLM-5.3-FlashX',aliases:['GLM-5.3-FlashX'],rates:{input:'2',cached:'0.57',output:'7'},peakPricing:false,tags:['轻量任务','代码任务'],uses:['writing','coding','vision'],
  caps:glmCaps,verified:true,version:'以官方实际返回为准',priceSource:GLM_PRICE,subtitle:'智谱 GLM · 更快的轻量型号',description:'智谱主打速度的轻量型号，能看图。始终思考，思考强度最低可调到 low。'}
];
const lookup=new Map(OFFICIAL_MODELS.flatMap(m=>[[m.id,m],...m.aliases.map(a=>[a,m])]));
export const findOfficialModel=name=>typeof name==='string'?lookup.get(name):undefined;
/** DeepSeek's published peak: Beijing weekdays 09:00-12:00 and 14:00-18:00, excluding statutory holidays. */
export function officialPeak(date=new Date(),holidays=new Set()){
 const local=new Date(date.getTime()+8*3600000),day=local.getUTCDay(),hour=local.getUTCHours();
 if(day===0||day===6||holidays.has(local.toISOString().slice(0,10)))return false;
 return (hour>=9&&hour<12)||(hour>=14&&hour<18);
}
export const priceMultiplier=(model,date,holidays)=>model.peakPricing&&officialPeak(date,holidays)?2:1;

const THINKING_TAG={switchable:'默认思考 · 可关',always:'始终思考',none:'直接回答'};
const INPUT_TAG={image:'看图',video:'看视频',file:'读文件',audio:'听语音'};
const OUTPUT_TAG={image:'画图',audio:'语音',video:'视频'};
/** Customer-facing capability tags, in display order. Every tag states one checkable fact from `caps`. */
export function capabilityTags(model){
 const c=model.caps;
 return [THINKING_TAG[c.thinking],...c.input.map(k=>INPUT_TAG[k]),...c.output.map(k=>OUTPUT_TAG[k]),c.tools&&'工具调用',c.parallelTools&&'并行工具',c.json&&'JSON 输出',c.jsonSchema&&'JSON Schema',c.cache&&'缓存计价',`上下文 ${c.context}`,model.peakPricing&&'高峰 2 倍价'].filter(Boolean);
}
/** Machine-readable capabilities for /v1/models and the consoles. max_output_tokens is the gateway's own per-request limit. */
export function publicCapabilities(model,maxOutput){
 const c=model.caps;
 return {thinking:c.thinking,reasoning_efforts:c.efforts,input:c.input,output:c.output,tool_calling:c.tools,parallel_tool_calls:c.parallelTools,json_output:c.json,json_schema:c.jsonSchema,prompt_cache:c.cache,context_window:c.context,max_output_tokens:maxOutput,verified:model.verified};
}
/** The 模型广场 view of the catalog: display text, tags and official prices, no routing details. */
export function marketCatalog(){
 return OFFICIAL_MODELS.map(m=>{
  const r={hit:Number(m.rates.cached),miss:Number(m.rates.input),output:Number(m.rates.output)},twice={hit:r.hit*2,miss:r.miss*2,output:r.output*2};
  return {id:m.id,family:m.family,name:m.name,subtitle:m.subtitle,badge:m.verified?'功能对比已测':'暂未开放',description:m.description,tags:capabilityTags(m),uses:m.uses,thinking:m.caps.thinking,upstreamId:m.id,version:m.version,context:m.caps.context,maxOutput:m.caps.officialMaxOutput,
   verification:m.verified?'25 项功能与官方逐项对照，结果见「真实测试」页':'线路尚未接通，未经实测',verified:m.verified,
   price:m.peakPricing?{kind:'timed',offpeak:r,peak:twice,source:m.priceSource}:{kind:'standard',standard:r,source:m.priceSource}};
 });
}
