import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {HttpError} from './core.mjs';
export const FILE_LIMIT=4*1024*1024,TEXT_LIMIT=120000;
const hash=b=>createHash('sha256').update(b).digest('hex');
let workers=0;
export async function extractAttachment(file){
 if(!file||typeof file.name!=='string'||!file.name.trim()||file.name.length>180||typeof file.data!=='string'||file.data.length>Math.ceil(FILE_LIMIT/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.data))throw new HttpError(400,'附件格式不正确，单个文件最多 4 MB');
 const bytes=Buffer.from(file.data,'base64');if(!bytes.length||bytes.length>FILE_LIMIT)throw new HttpError(400,'附件为空或超过 4 MB');
 const name=file.name.replace(/[\x00-\x1f\x7f/\\]/g,'_'),extension=name.split('.').pop().toLowerCase();
 const out={name,bytes:bytes.length,sha256:hash(bytes),kind:'text',text:null,warning:null};
 if(['png','jpg','jpeg','webp'].includes(extension)){
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!(png||jpg||webp))throw new HttpError(400,'图片内容与支持的 PNG、JPEG、WebP 格式不符');
  return {...out,kind:'image',mime:png?'image/png':jpg?'image/jpeg':'image/webp',data:file.data,text:undefined};
 }
 if(['txt','md','csv','json'].includes(extension)){
  try{out.text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new HttpError(400,'文本文件需为 UTF-8 编码，请转换后上传');}
  if(out.text.includes('\0'))throw new HttpError(400,'该文件不是可读取的文本');
 }else if(['pdf','docx'].includes(extension)){
  if(extension==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw new HttpError(400,'不是有效 PDF 文件');
  if(extension==='docx'&&bytes.subarray(0,2).toString()!=='PK')throw new HttpError(400,'不是有效 DOCX 文件');
  if(workers>=2)throw new HttpError(429,'文件解析繁忙，请稍后重试');
  workers++;
  try{Object.assign(out,await new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./compare-file-worker.mjs',import.meta.url),{workerData:{extension,data:file.data},resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16},stdout:true,stderr:true});
   worker.stdout.resume();worker.stderr.resume();
   let settled=false;
   const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate().catch(()=>{});error?reject(new HttpError(400,error)):resolve(value);};
   const timer=setTimeout(()=>done('文件解析超过 15 秒，请缩小或转换文件'),15000);
   worker.once('message',m=>done(m.error,m));worker.once('error',()=>done('文件解析失败或内存超限，请缩小或转换文件'));worker.once('exit',code=>{if(code!==0)done('文件解析已中断，请缩小或转换文件');});
  }));}finally{workers--;}
  out.warning='仅提取文档正文文字，不包含图片、版式、页眉页脚或扫描页内容；运行前请检查提取预览。';
 }else throw new HttpError(400,'支持 TXT、MD、CSV、JSON、PDF、DOCX、PNG、JPEG、WebP；请先转换其他格式');
 if(!out.text.trim()||out.text.length>TEXT_LIMIT)throw new HttpError(400,'附件文字为空或超过 12 万字符，请检查或拆分文件');
 return out;
}

export function sharedMessages(prompt,system,files=[]){
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>TEXT_LIMIT)throw new HttpError(400,'请输入共同任务，最多 12 万字符');
 if(system!==undefined&&(typeof system!=='string'||system.length>10000))throw new HttpError(400,'系统提示最多 1 万字符');
 if(!Array.isArray(files)||files.length>5)throw new HttpError(400,'最多添加 5 个附件');
 const content=[{type:'text',text:prompt.trim()}],manifest=[];let total=prompt.length+(system?.length||0),images=0;
 for(const f of files){
  if(typeof f?.name!=='string'||f.name.length>180)throw new HttpError(400,'附件名称不正确');
  if(f.kind==='text'){
   if(typeof f.text!=='string'||!f.text.trim())throw new HttpError(400,'附件没有可发送的文字');total+=f.text.length;
   content.push({type:'text',text:`\n附件：${f.name}\n${f.text}`});manifest.push({name:f.name,kind:'text',characters:f.text.length,sha256:hash(f.text)});
  }else if(f.kind==='image'){
   if(!['image/png','image/jpeg','image/webp'].includes(f.mime)||typeof f.data!=='string'||f.data.length>Math.ceil(FILE_LIMIT/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.data))throw new HttpError(400,'图片数据无效或超过 4 MB');
   images++;content.push({type:'image_url',image_url:{url:`data:${f.mime};base64,${f.data}`}});manifest.push({name:f.name,kind:'image',sha256:hash(Buffer.from(f.data,'base64'))});
  }else throw new HttpError(400,'附件尚未解析，请移除后重新上传');
 }
 if(total>TEXT_LIMIT)throw new HttpError(400,'任务与附件合计超过 12 万字符，请缩小输入');
 return {messages:[...(system?.trim()?[{role:'system',content:system.trim()}]:[]),{role:'user',content:images?content:content.map(p=>p.text).join('\n\n')}],manifest,images};
}
