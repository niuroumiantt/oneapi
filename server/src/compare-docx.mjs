import {inflateRawSync} from 'node:zlib';
// Read only the main document XML; do not extract paths or follow external relationships.
// The output cap is enforced by zlib, not just attacker-controlled ZIP directory sizes.
export function docxText(buffer){
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('DOCX ZIP 目录缺失');
 const entries=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16);if(entries>2048||entries===65535||offset===0xffffffff)throw Error('DOCX 过于复杂，请转换为 TXT');
 let p=offset;
 for(let i=0;i<entries;i++){
  if(p+46>buffer.length||buffer.readUInt32LE(p)!==0x02014b50)throw Error('DOCX ZIP 目录损坏');
  const flags=buffer.readUInt16LE(p+8),method=buffer.readUInt16LE(p+10),size=buffer.readUInt32LE(p+20),expanded=buffer.readUInt32LE(p+24),n=buffer.readUInt16LE(p+28),extra=buffer.readUInt16LE(p+30),comment=buffer.readUInt16LE(p+32),local=buffer.readUInt32LE(p+42),name=buffer.subarray(p+46,p+46+n).toString('utf8');
  if(name==='word/document.xml'){
   if(flags&1||![0,8].includes(method)||expanded>2*1024*1024||local+30>buffer.length||buffer.readUInt32LE(local)!==0x04034b50)throw Error('DOCX 主文档加密、过大或不受支持');
   const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);if(start+size>buffer.length)throw Error('DOCX 压缩数据损坏');
   const raw=method===8?inflateRawSync(buffer.subarray(start,start+size),{maxOutputLength:2*1024*1024}):buffer.subarray(start,start+size);
   if(raw.length>2*1024*1024)throw Error('DOCX 文本过大');
   const xml=new TextDecoder('utf-8',{fatal:true}).decode(raw);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('DOCX 包含不支持的 XML 实体');
   const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,n)=>n[0]==='#'?String.fromCodePoint(n[1].toLowerCase()==='x'?parseInt(n.slice(2),16):Number(n.slice(1))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[n]);
   let text='';for(const match of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/w:p>|<w:tab\b[^>]*\/>/g))text+=match[1]!==undefined?decode(match[1]):match[0].includes('tab')?'\t':'\n';
   return text;
  }
  p+=46+n+extra+comment;
 }
 throw Error('DOCX 没有主文档内容');
}
