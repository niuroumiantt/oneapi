import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,createVerify} from 'node:crypto';
import {parseWechatStatement} from '../src/wechat-bills.mjs';
import {wechatpayClient,wechatBillsConfigured} from '../src/wechatpay.mjs';
const header='交易时间,商户号,微信订单号,商户订单号,交易类型,交易状态,货币种类,微信退款单号,商户退款单号,退款状态,手续费,订单金额,申请退款金额';
const csv=header+'\n`2026-01-02 12:00:00,`1234567890,`t1,`o1,`NATIVE,`SUCCESS,`CNY,`0,`0,`,雷PLACE,`5.00,`0.00\n'.replace('雷PLACE','`0.03000')+'总交易单数,手续费总金额,订单总金额,申请退款总金额\n`1,`0.03,`5.00,`0.00\n';
test('WeChat backtick fields, totals, exact fee precision and merchant identity',()=>{
 const parse=s=>parseWechatStatement(Buffer.from(s),'2026-01-02','1234567890');
 assert.equal(parse(csv)[0].fee,3);
 for(const s of [csv.replace('0.03000','0.031'),csv.replace('1234567890','9999999999'),csv.replace('CNY','USD'),csv.replace('`1,`0.03','`2,`0.03'),csv.split('总交易单数')[0],csv.replace('订单金额','未知字段')])assert.throws(()=>parse(s));
});
test('signed bill download is bounded, host restricted, hash verified and independent from pay enablement',async()=>{
 const merchant=generateKeyPairSync('rsa',{modulusLength:2048}),platform=generateKeyPairSync('rsa',{modulusLength:2048}),pem=k=>k.export({type:k.type==='private'?'pkcs8':'spki',format:'pem'});
 const cfg={enabled:false,mchId:'1234567890',certSerial:'cert',publicKeyId:'pub',privateKey:pem(merchant.privateKey),publicKey:pem(platform.publicKey),apiV3Key:'a'.repeat(32)};
 assert.equal(wechatBillsConfigured(cfg),true);assert.equal(wechatBillsConfigured({enabled:false}),false);
 const bytes=Buffer.from(csv),info={download_url:'https://api.mch.weixin.qq.com/v3/billdownload/file?token=test',hash_type:'SHA1',hash_value:createHash('sha1').update(bytes).digest('hex')};
 let calls=0;const c=wechatpayClient(cfg,async(url,init)=>{calls++;assert.equal(init.redirect,'error');const a=Object.fromEntries([...init.headers.Authorization.matchAll(/(\w+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));const u=new URL(url);assert.ok(createVerify('RSA-SHA256').update(`GET\n${u.pathname+u.search}\n${a.timestamp}\n${a.nonce_str}\n\n`).verify(merchant.publicKey,a.signature,'base64'));return new Response(bytes);});
 assert.deepEqual(await c.downloadBill(info),bytes);
 await assert.rejects(c.downloadBill({...info,hash_value:'a'.repeat(40)}),/HASH_MISMATCH/);
 for(const download_url of ['https://evil.test/v3/billdownload/file','http://api.mch.weixin.qq.com/v3/billdownload/file','https://api.mch.weixin.qq.com/v3/refund/domestic/refunds','https://u:p@api.mch.weixin.qq.com/v3/billdownload/file'])await assert.rejects(c.downloadBill({...info,download_url}),/HOST/);
 assert.equal(calls,2);
});
