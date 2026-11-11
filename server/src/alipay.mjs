// Alipay Open Platform adapter for 当面付 (face-to-face QR). Only signs, calls and verifies;
// order state and ledger postings live in payments.mjs.
import { createPrivateKey, createPublicKey, createSign, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const ALIPAY_GATEWAY='https://openapi.alipay.com/gateway.do';

// Accepts a PEM file or the bare base64 string produced by Alipay's key tool (PKCS#8 or PKCS#1).
export function loadAlipayKey(raw,kind){
 const text=raw.trim();
 if(text.startsWith('-----'))return kind==='private'?createPrivateKey(text):createPublicKey(text);
 const der=Buffer.from(text.replace(/\s+/g,''),'base64');
 if(kind==='public')return createPublicKey({key:der,format:'der',type:'spki'});
 try{return createPrivateKey({key:der,format:'der',type:'pkcs8'});}catch{return createPrivateKey({key:der,format:'der',type:'pkcs1'});}
}

// Alipay's canonical string: non-empty params except sign/sign_type, sorted by key, k=v joined by &.
export function signContent(params,{skipSignType=false}={}){
 return Object.keys(params).filter(k=>k!=='sign'&&!(skipSignType&&k==='sign_type')&&params[k]!==undefined&&params[k]!==null&&params[k]!=='').sort().map(k=>`${k}=${params[k]}`).join('&');
}
export function rsa2Sign(content,privateKey){return createSign('RSA-SHA256').update(content,'utf8').sign(privateKey,'base64');}
export function rsa2Verify(content,signature,publicKey){
 if(typeof signature!=='string'||!signature)return false;
 try{return createVerify('RSA-SHA256').update(content,'utf8').verify(publicKey,signature,'base64');}catch{return false;}
}

// Gateway timestamps are Beijing time regardless of server timezone.
export function beijingTimestamp(date=new Date()){return new Date(date.getTime()+8*3600e3).toISOString().slice(0,19).replace('T',' ');}

// The response signature covers the raw JSON text of the *_response node, so it must be cut
// from the body verbatim rather than re-serialised.
export function responseNode(raw,method){
 for(const node of [method.replaceAll('.','_')+'_response','error_response']){
  const key=`"${node}"`,at=raw.indexOf(key);if(at<0)continue;
  let i=raw.indexOf(':',at+key.length)+1;while(/\s/.test(raw[i]))i++;
  let depth=0,inString=false,end=-1;
  for(let j=i;j<raw.length;j++){const c=raw[j];if(inString){if(c==='\\')j++;else if(c==='"')inString=false;continue;}if(c==='"')inString=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=j+1;break;}}
  if(end<0)break;
  return {node,content:raw.slice(i,end)};
 }
 throw Error('ALIPAY_RESPONSE_MALFORMED');
}

export function alipayClient(cfg,fetchImpl=fetch){
 const privateKey=loadAlipayKey(cfg.privateKey??readFileSync(cfg.privateKeyFile,'utf8'),'private');
 const alipayPublicKey=loadAlipayKey(cfg.publicKey??readFileSync(cfg.publicKeyFile,'utf8'),'public');
 const gateway=cfg.gateway||ALIPAY_GATEWAY;
 async function call(method,biz,extra={}){
  const params={app_id:cfg.appId,method,format:'JSON',charset:'utf-8',sign_type:'RSA2',timestamp:beijingTimestamp(),version:'1.0',...extra,biz_content:JSON.stringify(biz)};
  params.sign=rsa2Sign(signContent(params),privateKey);
  const response=await fetchImpl(gateway+'?charset=utf-8',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=utf-8'},body:new URLSearchParams(params).toString(),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('ALIPAY_HTTP_'+response.status);
  const raw=await response.text(),{node,content}=responseNode(raw,method),body=JSON.parse(raw),data=body[node];
  // Business responses are always signed; an unsigned or mismatched body is never trusted.
  if(node!=='error_response'&&!rsa2Verify(content,body.sign,alipayPublicKey))throw Error('ALIPAY_RESPONSE_SIGNATURE_INVALID');
  return data;
 }
 return {
  appId:cfg.appId,sellerId:cfg.sellerId||'',
  precreate:({outTradeNo,amountFen,subject,notifyUrl,timeoutMinutes})=>call('alipay.trade.precreate',{out_trade_no:outTradeNo,total_amount:fenToYuan(amountFen),subject,timeout_express:`${timeoutMinutes}m`,product_code:'FACE_TO_FACE_PAYMENT'},{notify_url:notifyUrl}),
  query:outTradeNo=>call('alipay.trade.query',{out_trade_no:outTradeNo}),
  // Notify bodies are signed over every param except sign and sign_type.
  verifyNotify:params=>rsa2Verify(signContent(params,{skipSignType:true}),params.sign,alipayPublicKey)
 };
}

export const fenToYuan=fen=>{const v=BigInt(fen);return `${v/100n}.${String(v%100n).padStart(2,'0')}`;};
// Strict "12.34" → 1234n; anything else is rejected rather than rounded.
export function yuanToFen(value){
 const m=/^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(value??''));if(!m)return null;
 return BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0'));
}
