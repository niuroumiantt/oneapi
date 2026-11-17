import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {Readable} from 'node:stream';
import ipaddr from 'ipaddr.js';
import {HttpError} from './core.mjs';

export const REFERENCE_PROVIDERS=Object.freeze({
 deepseek:{name:'DeepSeek 官方',base_url:'https://api.deepseek.com'},
 glm:{name:'GLM 官方',base_url:'https://open.bigmodel.cn/api/paas/v4'},
 kimi:{name:'Kimi 官方',base_url:'https://api.moonshot.cn/v1'},
 minimax:{name:'MiniMax 官方',base_url:'https://api.minimax.cn/v1'}
});
export function publicAddress(address){
 try{const a=ipaddr.parse(address);if(a.kind()==='ipv6'&&a.isIPv4MappedAddress())return false;return a.range()==='unicast';}catch{return false;}
}
export function referenceTarget(reference){
 const provider=REFERENCE_PROVIDERS[reference?.provider];
 if(!provider&&reference?.provider!=='custom')throw new HttpError(400,'请选择官方厂商或第三方兼容接口');
 let url;try{url=new URL(provider?.base_url||reference.base_url);}catch{throw new HttpError(400,'请填写有效的 HTTPS Base URL');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||(url.port&&url.port!=='443')||url.href.length>500)throw new HttpError(400,'Base URL 需为 HTTPS 标准端口，不能包含账户、密码、查询参数或片段');
 if(/\/(?:chat\/completions|models)\/?$/.test(url.pathname))throw new HttpError(400,'请填写 Base URL，不要包含 /chat/completions 或 /models');
 return {provider:reference.provider,kind:provider?'official':'third_party',name:provider?.name||'第三方兼容接口',base_url:url.href.replace(/\/$/,'')};
}

// Resolve once and pin the checked addresses to the actual TLS connection. Redirects are never followed.
// No user-selected headers, proxy settings, certificates, cookies or request paths are accepted.
export async function publicFetch(url,init={},resolver=lookup){
 const target=new URL(url),hostname=target.hostname.replace(/^\[|\]$/g,'');
 if(target.protocol!=='https:'||target.username||target.password||(target.port&&target.port!=='443'))throw new HttpError(400,'仅允许 HTTPS 公网接口');
 init.signal?.throwIfAborted();
 let aborted;
 const addresses=await Promise.race([resolver(hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{aborted=()=>reject(init.signal.reason);init.signal?.addEventListener('abort',aborted,{once:true});})]).finally(()=>init.signal?.removeEventListener('abort',aborted));
 init.signal?.throwIfAborted();
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new HttpError(400,'接口域名必须仅解析到公网地址，不能访问本机、内网或保留地址');
 return new Promise((resolve,reject)=>{
  const req=https.request(target,{method:init.method||'GET',headers:init.headers,signal:init.signal,agent:false,
   lookup:(_name,options,cb)=>options?.all?cb(null,addresses):cb(null,addresses[0].address,addresses[0].family)},res=>{
    const headers=new Headers();for(const [k,v]of Object.entries(res.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(', '):v);
    resolve(new Response([204,205,304].includes(res.statusCode)?null:Readable.toWeb(res),{status:res.statusCode,headers}));
   });
  req.on('error',reject);req.end(init.body);
 });
}
