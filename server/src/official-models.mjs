// Official list prices in yuan per million tokens, from the vendors' public CNY pricing pages
// (queried 2026-11-09). These are what employees are charged, whatever the upstream route costs.
const flash={input:'1',cached:'0.02',output:'4'};
export const OFFICIAL_MODELS=[
 {id:'deepseek-flash',name:'DeepSeek Flash',family:'deepseek',upstream:'kerapi',upstreamModel:'deepseek-v4.1-flash',aliases:['deepseek-v4.1-flash'],rates:flash,peakPricing:true,tags:['对话创作','代码任务'],uses:['writing','coding']},
 {id:'deepseek-flash-0910',name:'DeepSeek Flash 0910',family:'deepseek',upstream:'kerapi',upstreamModel:'deepseek-v4.1-flash-0910',aliases:['deepseek-v4.1-flash-0910'],rates:flash,peakPricing:true,tags:['对话创作','代码任务'],uses:['writing','coding']},
 {id:'deepseek-v4-pro',name:'DeepSeek V4 Pro',family:'deepseek',upstream:'deepseek',upstreamModel:'deepseek-v4-pro',aliases:[],rates:{input:'4.5',cached:'0.15',output:'13.5'},peakPricing:true,tags:['复杂分析','深度推理'],uses:['reasoning','coding']},
 {id:'glm-5.3',name:'GLM-5.3',family:'glm',upstream:'kerapi',upstreamModel:'GLM-5.3',aliases:['GLM-5.3'],rates:{input:'8',cached:'2',output:'28'},peakPricing:false,tags:['文本任务','复杂推理'],uses:['writing','reasoning']},
 {id:'glm-5.3-flash',name:'GLM-5.3-Flash',family:'glm',upstream:'kerapi',upstreamModel:'GLM-5.3-Flash',aliases:['GLM-5.3-Flash'],rates:{input:'0.8',cached:'0.23',output:'2.8'},peakPricing:false,tags:['轻量任务'],uses:['writing']},
 {id:'glm-5.3-flashx',name:'GLM-5.3-FlashX',family:'glm',upstream:'kerapi',upstreamModel:'GLM-5.3-FlashX',aliases:['GLM-5.3-FlashX'],rates:{input:'2',cached:'0.57',output:'7'},peakPricing:false,tags:['轻量任务','代码任务'],uses:['writing','coding']}
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
