// WeChat Pay API v3 adapter for Native (scan-to-pay) orders and refunds. Only signs, calls,
// verifies and decrypts; order state and ledger postings live in payments.mjs.
// Uses the "微信支付公钥" verification mode (public key id PUB_KEY_ID_…), which is what new
// merchants get by default; every response and notify must be signed by that key.
import { createDecipheriv, createPrivateKey, createPublicKey, createSign, createVerify, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const WECHATPAY_GATEWAY='https://api.mch.weixin.qq.com';
const MAX_CLOCK_SKEW_SECONDS=300;

export function loadWechatKey(raw,kind){
 const text=raw.trim();
 if(text.startsWith('-----'))return kind==='private'?createPrivateKey(text):createPublicKey(text);
 const der=Buffer.from(text.replace(/\s+/g,''),'base64');
 return kind==='private'?createPrivateKey({key:der,format:'der',type:'pkcs8'}):createPublicKey({key:der,format:'der',type:'spki'});
}

// Beijing-time RFC 3339, the only format time_expire accepts.
export function beijingRfc3339(date){return new Date(date.getTime()+8*3600e3).toISOString().slice(0,19)+'+08:00';}

export function wechatpayClient(cfg,fetchImpl=fetch){
 const privateKey=loadWechatKey(cfg.privateKey??readFileSync(cfg.privateKeyFile,'utf8'),'private');
 const publicKey=loadWechatKey(cfg.publicKey??readFileSync(cfg.publicKeyFile,'utf8'),'public');
 const apiV3Key=Buffer.from((cfg.apiV3Key??readFileSync(cfg.apiV3KeyFile,'utf8')).trim(),'utf8');
 if(apiV3Key.length!==32)throw Error('WECHATPAY_API_V3_KEY_LENGTH');
 const gateway=(cfg.gateway||WECHATPAY_GATEWAY).replace(/\/$/,'');

 // Header signature: timestamp\nnonce\nbody\n, by the WeChat Pay public key named in Wechatpay-Serial.
 function verifySigned(headers,body){
  const ts=headers.get('wechatpay-timestamp'),nonce=headers.get('wechatpay-nonce'),sig=headers.get('wechatpay-signature'),serial=headers.get('wechatpay-serial');
  if(!ts||!nonce||!sig||serial!==cfg.publicKeyId)return false;
  if(!/^\d+$/.test(ts)||Math.abs(Date.now()/1000-Number(ts))>MAX_CLOCK_SKEW_SECONDS)return false;
  try{return createVerify('RSA-SHA256').update(`${ts}\n${nonce}\n${body}\n`,'utf8').verify(publicKey,sig,'base64');}catch{return false;}
 }

 // Returns {status, data} only for signed responses; anything unsigned is an error, never a result.
 async function call(method,path,payload){
  const body=payload===undefined?'':JSON.stringify(payload),ts=String(Math.floor(Date.now()/1000)),nonce=randomBytes(16).toString('hex');
  const signature=createSign('RSA-SHA256').update(`${method}\n${path}\n${ts}\n${nonce}\n${body}\n`,'utf8').sign(privateKey,'base64');
  const headers={Accept:'application/json','User-Agent':'oneapi-wechatpay/1','Wechatpay-Serial':cfg.publicKeyId,Authorization:`WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${ts}",serial_no="${cfg.certSerial}"`};
  if(body)headers['Content-Type']='application/json';
  const response=await fetchImpl(gateway+path,{method,headers,body:body||undefined,signal:AbortSignal.timeout(10000)});
  const raw=await response.text();
  if(!verifySigned(response.headers,raw)){
   if(response.status>=500)throw Error('WECHATPAY_HTTP_'+response.status);
   let code='NONE';try{code=JSON.parse(raw).code||'NONE';}catch{}
   throw Error(`WECHATPAY_UNSIGNED_${response.status}_${safeCode(code)}`);
  }
  return {status:response.status,data:raw?JSON.parse(raw):{}};
 }
 const mch=encodeURIComponent(cfg.mchId);

 return {
  appId:cfg.appId,mchId:cfg.mchId,
  native:({outTradeNo,amountFen,description,notifyUrl,expiresAt})=>call('POST','/v3/pay/transactions/native',{appid:cfg.appId,mchid:cfg.mchId,description,out_trade_no:outTradeNo,time_expire:beijingRfc3339(expiresAt),notify_url:notifyUrl,amount:{total:Number(amountFen),currency:'CNY'}}),
  query:outTradeNo=>call('GET',`/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${mch}`),
  // Idempotent per out_refund_no: resending the same request never refunds twice.
  refund:({outTradeNo,outRefundNo,amountFen,totalFen,reason,notifyUrl})=>call('POST','/v3/refund/domestic/refunds',{out_trade_no:outTradeNo,out_refund_no:outRefundNo,reason,notify_url:notifyUrl,amount:{refund:Number(amountFen),total:Number(totalFen),currency:'CNY'}}),
  queryRefund:outRefundNo=>call('GET',`/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`),
  // Notify: verify the header signature over the raw body, then AES-256-GCM decrypt the resource.
  openNotify(headers,rawBody){
   if(!verifySigned(headers,rawBody))throw Error('WECHATPAY_NOTIFY_SIGNATURE_INVALID');
   const event=JSON.parse(rawBody),r=event.resource;
   if(r?.algorithm!=='AEAD_AES_256_GCM')throw Error('WECHATPAY_NOTIFY_ALGORITHM');
   return {event_type:event.event_type,resource:JSON.parse(decryptResource(apiV3Key,r))};
  }
 };
}

export function decryptResource(key,{ciphertext,nonce,associated_data}){
 const data=Buffer.from(ciphertext,'base64'),tag=data.subarray(data.length-16);
 const d=createDecipheriv('aes-256-gcm',key,Buffer.from(nonce,'utf8'));d.setAuthTag(tag);d.setAAD(Buffer.from(associated_data||'','utf8'));
 return Buffer.concat([d.update(data.subarray(0,data.length-16)),d.final()]).toString('utf8');
}

const safeCode=v=>String(v??'NONE').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,64)||'NONE';
