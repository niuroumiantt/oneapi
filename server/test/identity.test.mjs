import {applyStatement,syncAlipayBill} from '../src/alipay-bills.mjs';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createServer } from 'node:http';
import { randomBytes,createHash,generateKeyPairSync,createSign,createVerify,createCipheriv } from 'node:crypto';
import { signContent,responseNode } from '../src/alipay.mjs';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair,exportJWK,SignJWT } from 'jose';
import { createApp } from '../src/app.mjs';
import { GRANT_YUAN,holdYuan,channelFeeYuan,employeeRequest,usageFrom,settleEmployeeCalls,callClient,callSummary } from '../src/employee-credit.mjs';
import { vault,hasBusiness,hash } from '../src/core.mjs';
import { findOfficialModel,officialPeak } from '../src/official-models.mjs';
import { migrate } from '../src/migrate.mjs';
import { config } from '../src/core.mjs';
// Fake Alipay gateway: verifies our RSA2 request signature and signs responses with its own key.
const appKeys=generateKeyPairSync('rsa',{modulusLength:2048}),alipayKeys=generateKeyPairSync('rsa',{modulusLength:2048}),alipayTrades=new Map(),alipayCalls=[];
let alipayRefundMode='ok';
const pem=k=>k.export({type:k.type==='private'?'pkcs8':'spki',format:'pem'}),alipaySign=content=>createSign('RSA-SHA256').update(content).sign(alipayKeys.privateKey,'base64');
async function fakeAlipay(_url,init){const p=Object.fromEntries(new URLSearchParams(init.body));const ok=(await import('node:crypto')).createVerify('RSA-SHA256').update(signContent(p)).verify(appKeys.publicKey,p.sign,'base64');alipayCalls.push({method:p.method,ok});const biz=JSON.parse(p.biz_content),node=p.method.replaceAll('.','_')+'_response';let data;
 if(!ok)data={code:'40002',msg:'Invalid Arguments',sub_code:'isv.invalid-signature'};
 else if(p.method==='alipay.trade.page.pay'){alipayTrades.set(biz.out_trade_no,{status:'WAIT_BUYER_PAY',amount:biz.total_amount,trade_no:'2026'+randomBytes(8).toString('hex'),notify:p.notify_url});data={code:'10000',msg:'Success'};}
 else if(p.method==='alipay.trade.refund'){if(alipayRefundMode==='timeout')throw Error('simulated network timeout');const t=alipayTrades.get(biz.out_trade_no);
  if(alipayRefundMode==='reject'||!t)data={code:'40004',msg:'Business Failed',sub_code:t?'ACQ.SELLER_BALANCE_NOT_ENOUGH':'ACQ.TRADE_NOT_EXIST'};
  else{t.requests??=new Map();const fen=Math.round(Number(biz.refund_amount)*100),fresh=!t.requests.has(biz.out_request_no);if(fresh){t.requests.set(biz.out_request_no,fen);t.refundedFen=(t.refundedFen||0)+fen;}data={code:'10000',msg:'Success',out_trade_no:biz.out_trade_no,trade_no:t.trade_no,refund_fee:(t.refundedFen/100).toFixed(2),fund_change:fresh?'Y':'N'};}}
 else{const t=alipayTrades.get(biz.out_trade_no);data=t&&t.status!=='NOT_PAID_YET'?{code:'10000',msg:'Success',out_trade_no:biz.out_trade_no,trade_no:t.trade_no,trade_status:t.status,total_amount:t.amount}:{code:'40004',msg:'Business Failed',sub_code:'ACQ.TRADE_NOT_EXIST'};}
 const content=JSON.stringify(data);return new Response(`{"${node}":${content},"sign":"${alipaySign(content)}"}`,{headers:{'Content-Type':'application/json'}});}

// Fake WeChat Pay v3 gateway: checks our merchant signature, signs every reply with the "WeChat Pay public key".
const wxMerchant=generateKeyPairSync('rsa',{modulusLength:2048}),wxPlatform=generateKeyPairSync('rsa',{modulusLength:2048}),wxApiV3Key='0123456789abcdefABCDEF0123456789';
const WX={mchId:'1900000001',appId:'wx00000000000000a1',certSerial:'5157F09EFDC096DE15EBE81A47057A7232F1B8E1',publicKeyId:'PUB_KEY_ID_0000000000000000000000000001'},wxTrades=new Map(),wxRefunds=new Map(),wxCalls=[];
let wxRefundMode='ok';
const wxSign=(body,{serial=WX.publicKeyId,key=wxPlatform.privateKey,ts=String(Math.floor(Date.now()/1000))}={})=>{const nonce=randomBytes(8).toString('hex');return {'Wechatpay-Timestamp':ts,'Wechatpay-Nonce':nonce,'Wechatpay-Serial':serial,'Wechatpay-Signature':createSign('RSA-SHA256').update(`${ts}\n${nonce}\n${body}\n`).sign(key,'base64')};};
async function fakeWechat(url,init){
 const u=new URL(url),path=u.pathname+u.search,body=init.body||'',auth=init.headers.Authorization||'',m=Object.fromEntries([...auth.matchAll(/(\w+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));
 const ok=auth.startsWith('WECHATPAY2-SHA256-RSA2048 ')&&m.mchid===WX.mchId&&m.serial_no===WX.certSerial&&createVerify('RSA-SHA256').update(`${init.method}\n${path}\n${m.timestamp}\n${m.nonce_str}\n${body}\n`).verify(wxMerchant.publicKey,m.signature,'base64');
 wxCalls.push({method:init.method,path,ok,body:body?JSON.parse(body):null});
 const reply=(status,obj)=>{const text=JSON.stringify(obj);return new Response(text,{status,headers:{'Content-Type':'application/json',...wxSign(text)}});};
 if(!ok)return reply(401,{code:'SIGN_ERROR',message:'签名错误'});
 if(init.method==='POST'&&u.pathname==='/v3/pay/transactions/native'){const b=JSON.parse(body);wxTrades.set(b.out_trade_no,{state:'NOTPAY',total:b.amount.total,appid:b.appid,transaction_id:'4200'+randomBytes(8).toString('hex'),notify:b.notify_url,expire:b.time_expire});return reply(200,{code_url:'weixin://wxpay/bizpayurl?pr='+randomBytes(4).toString('hex')});}
 const q=u.pathname.match(/^\/v3\/pay\/transactions\/out-trade-no\/([^/]+)$/);
 if(init.method==='GET'&&q){const no=decodeURIComponent(q[1]),t=wxTrades.get(no);if(!t)return reply(404,{code:'ORDER_NOT_EXIST',message:'订单不存在'});return reply(200,{appid:t.appid,mchid:WX.mchId,out_trade_no:no,trade_state:t.state,...(t.state==='NOTPAY'?{}:{transaction_id:t.transaction_id}),amount:{total:t.total,payer_total:t.total,currency:'CNY'}});}
 if(init.method==='POST'&&u.pathname==='/v3/refund/domestic/refunds'){
  if(wxRefundMode==='timeout')throw Error('simulated network timeout');
  if(wxRefundMode==='reject')return reply(403,{code:'NOT_ENOUGH',message:'基本账户余额不足'});
  const b=JSON.parse(body),t=wxTrades.get(b.out_trade_no);if(!t)return reply(404,{code:'RESOURCE_NOT_EXISTS',message:'订单不存在'});
  if(b.amount.total!==t.total)return reply(400,{code:'PARAM_ERROR',message:'订单金额不符'});
  let r=wxRefunds.get(b.out_refund_no);
  if(!r){r={out_refund_no:b.out_refund_no,out_trade_no:b.out_trade_no,refund_id:'50'+randomBytes(8).toString('hex'),status:wxRefundMode==='processing'?'PROCESSING':'SUCCESS',notify:b.notify_url,amount:{refund:b.amount.refund,total:t.total,currency:'CNY'}};wxRefunds.set(b.out_refund_no,r);}
  return reply(200,r);
 }
 const rq=u.pathname.match(/^\/v3\/refund\/domestic\/refunds\/([^/]+)$/);
 if(init.method==='GET'&&rq){const r=wxRefunds.get(decodeURIComponent(rq[1]));return r?reply(200,r):reply(404,{code:'RESOURCE_NOT_EXISTS',message:'退款单不存在'});}
 return reply(404,{code:'NOT_FOUND',message:'no such route'});
}
// Builds a notify exactly as WeChat does: AES-256-GCM resource under the APIv3 key, header-signed body.
function wxNotify(event_type,resource,signOpts){
 const nonce=randomBytes(6).toString('hex'),ad=event_type.startsWith('REFUND')?'refund':'transaction',c=createCipheriv('aes-256-gcm',Buffer.from(wxApiV3Key),Buffer.from(nonce));c.setAAD(Buffer.from(ad));
 const ciphertext=Buffer.concat([c.update(JSON.stringify(resource)),c.final(),c.getAuthTag()]).toString('base64');
 const body=JSON.stringify({id:randomBytes(8).toString('hex'),create_time:'2026-11-12T10:00:00+08:00',resource_type:'encrypt-resource',event_type,summary:'通知',resource:{original_type:ad,algorithm:'AEAD_AES_256_GCM',ciphertext,associated_data:ad,nonce}});
 return fetch(origin+'/api/payments/wechat/notify',{method:'POST',headers:{'Content-Type':'application/json',...wxSign(body,signOpts)},body});
}
let pool,appServer,idpServer,service,origin,idpOrigin,appCfg,pilotDir,pilotFetch=fetch,identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true},revoked=false;
const sent=[],codes=new Map(),access=new Map();let serial=1;
const password='Local-only!Testing-1842';
function jar(ip='192.0.2.'+(serial++)){const cookies=new Map();return {cookies,async call(path,{method='GET',body,headers={}}={}){
 const response=await fetch(path.startsWith('http')?path:origin+path,{method,redirect:'manual',headers:{Origin:origin,'x-real-ip':ip,...(body?{'Content-Type':'application/json'}:{}),Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...headers},body:body?JSON.stringify(body):undefined});
 for(const c of response.headers.getSetCookie()){const part=c.split(';')[0],at=part.indexOf('=');cookies.set(part.slice(0,at),part.slice(at+1));}
 const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {status:response.status,data,location:response.headers.get('location'),headers:response.headers};}};}
async function user(label){const j=jar(),email=`${label}-${serial}@example.test`;const r=await j.call('/api/auth/sign-up/email',{method:'POST',body:{email,password,name:label,callbackURL:origin+'/#account'}});assert.equal(r.status,200,JSON.stringify(r.data));await service.mail.drain();const message=sent.findLast(m=>m.to===email&&m.subject.includes('验证'));assert.ok(message);const url=message.text.match(/https?:\/\/\S+/)[0];const verified=await j.call(url);assert.equal(verified.status,302);assert.equal((await j.call('/api/platform/me')).status,200);return {j,email,user:(await j.call('/api/platform/me')).data.user};}
async function organization(u,name){const r=await pool.query('INSERT INTO organizations(name,created_by) VALUES($1,$2) RETURNING id,name,region,created_at',[name,u.user.id]);await pool.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[r.rows[0].id,u.user.id]);return r.rows[0];}
async function joinLink(owner,org){const r=await owner.j.call(`/api/platform/organizations/${org.id}/join-links`,{method:'POST',body:{}});assert.equal(r.status,201,JSON.stringify(r.data));return {token:r.data.url.split('#join/')[1],id:r.data.id};}
// Page-pay orders never hit the fake gateway on create; seed query/notify state from the signed pay URL.
function seedAlipayTrade(outTradeNo,amountYuan,notify=origin+'/api/payments/alipay/notify'){
 const trade={status:'WAIT_BUYER_PAY',amount:amountYuan,trade_no:'2026'+randomBytes(8).toString('hex'),notify};
 alipayTrades.set(outTradeNo,trade);return trade;
}
async function applyAndApprove(owner,org,recipient,link,department=''){const r=await recipient.j.call('/api/platform/join-requests',{method:'POST',body:{token:link.token,name:recipient.user.name,department}});assert.equal(r.status,202,JSON.stringify(r.data));const view=(await owner.j.call(`/api/platform/organizations/${org.id}`)).data;const request=view.joinRequests.find(x=>x.user_id===recipient.user.id);assert.ok(request);const approval=await owner.j.call(`/api/platform/organizations/${org.id}/join-requests/${request.id}/approve`,{method:'POST',body:{}});assert.equal(approval.status,200,JSON.stringify(approval.data));return request;}
before(async()=>{
 process.env.SUPPLIER_LAB_SECRET="test-only-laboratory-secret-1234567890123456";
 const databaseURL=process.env.TEST_DATABASE_URL||'postgresql://oneapi_test:local_test_only_62178@127.0.0.1:55438/oneapi_test';assert.ok(new URL(databaseURL).pathname.endsWith('_test'),'Tests require a dedicated *_test database');
 pool=new pg.Pool({connectionString:databaseURL});
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'fixture',alg:'RS256',use:'sig'};
 idpServer=createServer(async(req,res)=>{const url=new URL(req.url,idpOrigin);const json=obj=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(obj));};
  if(url.pathname==='/.well-known/openid-configuration')return json({issuer:idpOrigin,authorization_endpoint:idpOrigin+'/authorize',token_endpoint:idpOrigin+'/token',jwks_uri:idpOrigin+'/jwks',userinfo_endpoint:idpOrigin+'/userinfo',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_post','client_secret_basic'],code_challenge_methods_supported:['S256']});
  if(url.pathname==='/jwks')return json({keys:[jwk]});
  if(url.pathname==='/authorize'){const code=randomBytes(24).toString('hex');codes.set(code,{...Object.fromEntries(url.searchParams),identity:{...identity}});res.statusCode=302;res.setHeader('Location',url.searchParams.get('redirect_uri')+'?code='+code+'&state='+url.searchParams.get('state'));return res.end();}
  if(url.pathname==='/token'){let body='';for await(const chunk of req)body+=chunk;const data=new URLSearchParams(body),entry=codes.get(data.get('code'));codes.delete(data.get('code'));if(!entry||createHash('sha256').update(data.get('code_verifier')||'').digest('base64url')!==entry.code_challenge){res.statusCode=400;return json({error:'invalid_grant'});}const t=randomBytes(24).toString('hex');access.set(t,entry.identity);return json({access_token:t,token_type:'Bearer',expires_in:3600,id_token:await new SignJWT({nonce:entry.nonce}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setSubject(entry.identity.sub).setAudience('oneapi-test-staff').setIssuer(idpOrigin).setIssuedAt().setExpirationTime('1h').sign(privateKey)});}
  if(url.pathname==='/userinfo'){const claims=access.get((req.headers.authorization||'').slice(7));if(!claims||revoked){res.statusCode=401;return json({error:'invalid_token'});}return json(claims);}res.statusCode=404;res.end();
 });await new Promise(r=>idpServer.listen(0,'127.0.0.1',r));idpOrigin='http://127.0.0.1:'+idpServer.address().port;
 // Reserve a server port before constructing the fixed-origin authentication configuration.
 appServer=createServer();await new Promise(r=>appServer.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+appServer.address().port;
 const cfg=config({APP_ORIGIN:origin,DATABASE_URL:databaseURL,BETTER_AUTH_SECRET:'test-only-strong-secret-932847239847293847',STAFF_OIDC_ISSUER:idpOrigin,STAFF_OIDC_CLIENT_ID:'oneapi-test-staff',STAFF_OIDC_CLIENT_SECRET:'test-client-secret',STAFF_BOOTSTRAP_SUB:'staff-owner',BANK_TRANSFER_VERIFIED:'true',BANK_TRANSFER_ACCOUNT_NAME:'Company Test',BANK_TRANSFER_BANK_NAME:'Test Bank Branch',BANK_TRANSFER_ACCOUNT_NUMBER:'0000000000000000'});
 cfg.alipay={...cfg.alipay,enabled:true,appId:'2021000000000001',sellerId:'2088000000000001',privateKey:pem(appKeys.privateKey),publicKey:pem(alipayKeys.publicKey),allowedEmails:new Set(['nobody@example.test'])};cfg.alipayFetch=fakeAlipay;
 cfg.wechat={...cfg.wechat,enabled:true,mchId:WX.mchId,appId:WX.appId,certSerial:WX.certSerial,privateKey:pem(wxMerchant.privateKey),publicKeyId:WX.publicKeyId,publicKey:pem(wxPlatform.publicKey),apiV3Key:wxApiV3Key,allowedEmails:new Set(['nobody@example.test'])};cfg.wechatFetch=fakeWechat;
 appCfg=cfg;cfg.pilotFetch=(...args)=>pilotFetch(...args);
 service=createApp(pool,cfg,{sendMail:async m=>{sent.push(m);return {};},verify:async()=>true});await migrate(pool,service.auth);await pool.query('TRUNCATE "user",staff_members,staff_oidc_states,mail_outbox,request_limits,"rateLimit",channel_states,acceptance_profiles,agents,published_reports,identity_check_runs,identity_check_items CASCADE');appServer.on('request',service.app);
});
after(async()=>{appServer?.close();idpServer?.close();await pool?.end();if(pilotDir)await rm(pilotDir,{recursive:true,force:true});});
test('email must be verified; unknown identity cannot read workspace; CSRF is rejected',async()=>{
 const j=jar();assert.equal((await j.call('/api/platform/me')).status,401);
 const r=await j.call('/api/auth/sign-up/email',{method:'POST',body:{email:'unverified@example.test',password,name:'Unverified'}});assert.equal(r.status,200);assert.equal((await j.call('/api/platform/me')).status,401);
 assert.equal((await j.call('/api/auth/sign-in/email',{method:'POST',body:{email:'unverified@example.test',password}})).status,403);
 assert.equal((await j.call('/api/platform/organizations',{method:'POST',body:{name:'Attack'},headers:{Origin:'https://attacker.example'}})).status,403);
 while(await service.mail.drain());
});
let owner,other,member,dept,billing,orgA,orgB;
test('verified registration creates durable personal identity and isolated organization ownership',async()=>{
 owner=await user('owner');other=await user('other');member=await user('member');dept=await user('department');billing=await user('billing');orgA=await organization(owner,'Company A');orgB=await organization(other,'Company B');
 assert.equal((await owner.j.call('/api/platform/me')).data.organizations[0].role,'owner');assert.equal((await other.j.call(`/api/platform/organizations/${orgA.id}`)).status,403);assert.equal((await owner.j.call('/api/staff/members')).status,401);
 {const before=(await owner.j.call('/api/platform/me')).data;assert.equal(before.personal_assets,false);
  await pool.query('DELETE FROM billing_accounts WHERE owner_id=$1',[before.user.id]);
  await pool.query('INSERT INTO billing_accounts(owner_id,cash_balance_fen) VALUES($1,100)',[before.user.id]);
  assert.equal((await owner.j.call('/api/platform/me')).data.personal_assets,true);
  await pool.query('DELETE FROM billing_accounts WHERE owner_id=$1',[before.user.id]);}
 const fresh=jar();for(const [k,v]of owner.j.cookies)fresh.cookies.set(k,v);assert.equal((await fresh.call(`/api/platform/organizations/${orgA.id}`)).data.organization.name,'Company A');
});
test('staff pages load the same table sorter as the customer site',async()=>{
 assert.equal(await readFile(new URL('../private/table-sort.js',import.meta.url),'utf8'),await readFile(new URL('../../web/table-sort.js',import.meta.url),'utf8'));
});
test('staff pages load the same dropdown menu as the customer site',async()=>{
 assert.equal(await readFile(new URL('../private/select-menu.js',import.meta.url),'utf8'),await readFile(new URL('../../web/select-menu.js',import.meta.url),'utf8'));
 for(const page of ['workspace.html','supplier-lab.html','admin-shell.html'])assert.match(await readFile(new URL('../private/'+page,import.meta.url),'utf8'),/\/api\/staff\/select-menu\.js/,page);
});
test('managers keep one department list that members and join requests must use',async()=>{
 const boss=await user('deptboss'),joiner=await user('deptjoiner'),org=await organization(boss,'Department Co');
 await pool.query("UPDATE memberships SET department='Legacy Team' WHERE organization_id=$1",[org.id]);
 await pool.query(await readFile(new URL('../migrations/028_organization_departments.sql',import.meta.url),'utf8'));
 const base=`/api/platform/organizations/${org.id}`,list=async()=>(await boss.j.call(base)).data.departments;
 assert.deepEqual((await list()).map(d=>d.name),['Legacy Team'],'free text already in use is kept');
 const sales=await boss.j.call(base+'/departments',{method:'POST',body:{name:' Sales '}});assert.equal(sales.status,201,JSON.stringify(sales.data));assert.equal(sales.data.name,'Sales');
 assert.equal((await boss.j.call(base+'/departments',{method:'POST',body:{name:'sales'}})).status,409,'names are unique ignoring case');
 const link=await joinLink(boss,org);
 assert.deepEqual((await joiner.j.call('/api/platform/join-links/preview?token='+encodeURIComponent(link.token))).data.departments,['Legacy Team','Sales']);
 assert.equal((await joiner.j.call('/api/platform/join-requests',{method:'POST',body:{token:link.token,department:'Marketing'}})).status,400,'unlisted department is refused');
 await applyAndApprove(boss,org,joiner,link,'sales');
 const joined=()=>boss.j.call(base).then(r=>r.data.members.find(m=>m.user_id===joiner.user.id));
 assert.equal((await joined()).department,'Sales','stored with the listed spelling');
 assert.equal((await joiner.j.call(base+'/departments',{method:'POST',body:{name:'Ops'}})).status,403,'members cannot edit the list');
 assert.equal((await boss.j.call(`${base}/members/${(await joined()).id}`,{method:'PATCH',body:{department:'Nowhere'}})).status,400);
 const renamed=await boss.j.call(`${base}/departments/${sales.data.id}`,{method:'PATCH',body:{name:'Sales East'}});assert.equal(renamed.status,200);assert.equal((await joined()).department,'Sales East');
 const legacy=(await list()).find(d=>d.name==='Legacy Team');
 const merged=await boss.j.call(`${base}/departments/${legacy.id}`,{method:'PATCH',body:{name:'sales east'}});assert.equal(merged.data.merged,true);
 assert.deepEqual((await list()).map(d=>[d.name,d.members]),[['Sales East',2]],'merging moves every member');
 assert.equal((await boss.j.call(`${base}/departments/${merged.data.id}`,{method:'DELETE'})).status,200);
 assert.equal((await joined()).department,'','deleting returns members to 未分组');assert.equal((await list()).length,0);
});
test('real billing reads are isolated and cannot credit funds without a merchant',async()=>{
 assert.equal((await jar().call('/api/billing/personal')).status,401);
 const personal=await owner.j.call('/api/billing/personal');assert.equal(personal.status,200);assert.equal(personal.data.scope,'personal');assert.equal(personal.data.cash_balance_fen,'0');assert.equal(personal.data.list_credit_fen,'0');assert.equal(personal.data.total_recharged_fen,'0');assert.deepEqual(personal.data.entries,[]);assert.deepEqual(personal.data.usage_by_model,[]);assert.equal(personal.data.recharge.enabled,false);assert.equal(personal.data.recharge.minimum_fen,500);assert.match(personal.data.refund.policy,/15%/);assert.equal(personal.data.bank_transfer,undefined);
 const org=await owner.j.call(`/api/billing/organizations/${orgA.id}`);assert.equal(org.status,200);assert.equal(org.data.scope,'organization');assert.equal(org.data.cash_balance_fen,'0');assert.equal(org.data.list_credit_fen,'0');assert.equal(org.data.refund.enabled,true);assert.equal(org.data.bank_transfer.enabled,true);assert.equal(org.data.bank_transfer.account_number,'0000000000000000');
 assert.equal((await other.j.call(`/api/billing/organizations/${orgA.id}`)).status,403);
 assert.equal((await owner.j.call(`/api/billing/organizations/${orgB.id}`)).status,403);
 assert.equal((await owner.j.call('/api/billing/personal',{method:'POST',body:{amount_fen:500}})).status,404);
 assert.equal((await owner.j.call('/api/billing/recharge',{method:'POST',body:{amount_fen:500}})).status,404);
 const accountId=(await pool.query('INSERT INTO billing_accounts(owner_id,cash_balance_fen,list_credit_fen,total_spent_fen) VALUES($1,1200,1200,300) RETURNING id',[owner.user.id])).rows[0].id;
 await pool.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'recharge',500,500,'payment','test-payment-1'),($1,'recharge',1000,1500,'payment','test-payment-2'),($1,'usage',-300,1200,'usage','test-usage-1')",[accountId]);
 const funded=await owner.j.call('/api/billing/personal');assert.equal(funded.data.total_recharged_fen,'1500');assert.equal(funded.data.total_spent_fen,'300');assert.equal(funded.data.cash_balance_fen,'1200');assert.equal(funded.data.list_credit_fen,'1200');assert.equal(funded.data.entries.length,3);
 assert.equal((await other.j.call('/api/billing/personal')).data.total_recharged_fen,'0');
 const orgAccountId=(await pool.query('INSERT INTO billing_accounts(organization_id,cash_balance_fen,list_credit_fen,total_spent_fen) VALUES($1,2200,2200,300) RETURNING id',[orgA.id])).rows[0].id;
 await pool.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'recharge',2500,2500,'payment','test-org-payment-1'),($1,'usage',-300,2200,'usage','test-org-usage-1')",[orgAccountId]);
 const fundedOrg=await owner.j.call(`/api/billing/organizations/${orgA.id}`);assert.equal(fundedOrg.data.total_recharged_fen,'2500');assert.equal(fundedOrg.data.total_spent_fen,'300');assert.equal(fundedOrg.data.cash_balance_fen,'2200');assert.equal(fundedOrg.data.list_credit_fen,'2200');
 assert.equal((await other.j.call(`/api/billing/organizations/${orgA.id}`)).status,403);
});
test('one reusable link accepts distinct verified applicants; each needs separate approval',async()=>{
 const link=await joinLink(owner,orgA);const again=await joinLink(owner,orgA);assert.equal(again.id,link.id);assert.equal(again.token,link.token);const preview=await jar().call('/api/platform/join-links/preview?token='+encodeURIComponent(link.token));assert.equal(preview.status,200);assert.equal(preview.data.organizationName,'Company A');
 assert.equal((await member.j.call('/api/platform/join-requests',{method:'POST',body:{token:link.token,name:'Member',role:'owner'}})).status,202);
 assert.equal((await dept.j.call('/api/platform/join-requests',{method:'POST',body:{token:link.token,name:'Dept'}})).status,202);
 assert.equal((await member.j.call(`/api/platform/organizations/${orgA.id}`)).status,403);
 const pending=(await owner.j.call(`/api/platform/organizations/${orgA.id}`)).data.joinRequests;assert.equal(pending.length,2);
 assert.equal((await member.j.call(`/api/platform/organizations/${orgA.id}/join-requests/${pending[0].id}/approve`,{method:'POST',body:{}})).status,403);
 assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/join-requests/${pending.find(x=>x.user_id===member.user.id).id}/approve`,{method:'POST',body:{}})).status,200);
 assert.equal((await dept.j.call(`/api/platform/organizations/${orgA.id}`)).status,403);
 const view=(await member.j.call(`/api/platform/organizations/${orgA.id}`)).data;assert.equal(view.members.length,1);assert.equal(view.members[0].role,'member');
 assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/join-requests/${pending.find(x=>x.user_id===dept.user.id).id}/approve`,{method:'POST',body:{}})).status,200);
 assert.equal((await dept.j.call(`/api/platform/organizations/${orgA.id}/join-links`,{method:'POST',body:{}})).status,403);
 assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/members/${view.members[0].id}`,{method:'PATCH',body:{role:'admin'}})).status,400);
});
test('owner can promote staff to representative and return them to staff',async()=>{
 const target=(await owner.j.call(`/api/platform/organizations/${orgA.id}`)).data.members.find(m=>m.user_id===member.user.id);
 assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/members/${target.id}`,{method:'PATCH',body:{role:'owner'}})).status,200);
 const promoted=(await owner.j.call(`/api/platform/organizations/${orgA.id}`)).data.members.find(m=>m.id===target.id);
 assert.equal(promoted.role,'owner');
 assert.ok((await member.j.call(`/api/platform/organizations/${orgA.id}`)).data.members.length>1);
 assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/members/${target.id}`,{method:'PATCH',body:{role:'member'}})).status,200);
 assert.equal((await member.j.call(`/api/platform/organizations/${orgA.id}`)).data.members.length,1);
 const audit=(await owner.j.call(`/api/platform/organizations/${orgA.id}/audit`)).data.filter(e=>e.action==='member.updated'&&e.subject_id===target.id);
 assert.ok(audit.length>=2);
});
test('suspension removes access; revoked shared links reject new applications',async()=>{
 const m=(await owner.j.call(`/api/platform/organizations/${orgA.id}`)).data.members.find(m=>m.user_id===member.user.id);
 assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/members/${m.id}`,{method:'PATCH',body:{status:'suspended'}})).status,200);
 assert.equal((await member.j.call(`/api/platform/organizations/${orgA.id}`)).status,403);assert.equal((await member.j.call('/api/platform/me')).status,200);
 assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/members/${m.id}`,{method:'PATCH',body:{status:'active'}})).status,200);
 const revoked=await joinLink(owner,orgA);await owner.j.call(`/api/platform/organizations/${orgA.id}/join-links/${revoked.id}/revoke`,{method:'POST',body:{}});assert.equal((await other.j.call('/api/platform/join-requests',{method:'POST',body:{token:revoked.token}})).status,400);
});
test('last owner cannot be removed and audit persists role mutations',async()=>{
 const own=(await owner.j.call(`/api/platform/organizations/${orgA.id}`)).data.members.find(m=>m.user_id===owner.user.id);
 const attempts=await Promise.all([owner.j.call(`/api/platform/organizations/${orgA.id}/members/${own.id}`,{method:'PATCH',body:{role:'member'}}),owner.j.call(`/api/platform/organizations/${orgA.id}/members/${own.id}`,{method:'DELETE'})]);assert.deepEqual(attempts.map(r=>r.status),[409,409]);
 const audit=await owner.j.call(`/api/platform/organizations/${orgA.id}/audit`);assert.ok(audit.data.some(e=>e.action==='member.updated'));assert.equal((await other.j.call(`/api/platform/organizations/${orgA.id}/audit`)).status,403);
});
test('isolated demo journey covers personal and enterprise orders, allocation, access and usage',async()=>{
 assert.equal((await owner.j.call('/api/demo/selections',{method:'POST',body:{model_codes:['demo-chat','demo-code']}})).status,200);
 const personalOrder=await owner.j.call('/api/demo/orders',{method:'POST',body:{amount_yuan:100}});assert.equal(personalOrder.status,201);
 assert.equal((await owner.j.call('/api/demo/keys',{method:'POST',body:{model_codes:['demo-chat'],label:'Before payment'}})).status,409);
 const personalPay=await owner.j.call(`/api/demo/orders/${personalOrder.data.order.id}/pay`,{method:'POST',body:{}});assert.equal(personalPay.status,200);
 const repeated=await owner.j.call(`/api/demo/orders/${personalOrder.data.order.id}/pay`,{method:'POST',body:{}});assert.equal(repeated.data.balance_fen,10000);
 const personalKey=await owner.j.call('/api/demo/keys',{method:'POST',body:{model_codes:['demo-chat','demo-code'],label:'Personal demo'}});assert.equal(personalKey.status,201);
 const personalUsage=await owner.j.call(`/api/demo/keys/${personalKey.data.key.id}/usage`,{method:'POST',body:{model_code:'demo-code',input_tokens:1200,output_tokens:600}});assert.equal(personalUsage.status,201);assert.ok(personalUsage.data.usage.cost_fen>0);
 assert.equal((await owner.j.call(`/api/demo/keys/${personalKey.data.key.id}/usage`,{method:'POST',body:{model_code:'demo-reason',input_tokens:100,output_tokens:100}})).status,403);
 assert.equal((await owner.j.call('/api/demo/selections',{method:'POST',body:{model_codes:['demo-chat']}})).status,409);
 const refund=await owner.j.call('/api/demo/refunds',{method:'POST',body:{amount_fen:500}});assert.equal(refund.status,201);assert.equal(Number(refund.data.refund.fee_fen),0);
 const personalState=(await owner.j.call('/api/demo/personal')).data;assert.equal(personalState.orders.length,1);assert.equal(personalState.usage.length,1);assert.equal(personalState.refunds.length,1);assert.equal(personalState.ledger.length,3);assert.deepEqual(personalState.selected_models,['demo-chat','demo-code']);assert.equal(personalState.simulated,true);
 assert.equal((await other.j.call(`/api/demo/orders/${personalOrder.data.order.id}/pay`,{method:'POST',body:{}})).status,404);
 assert.equal((await owner.j.call('/api/demo/selections',{method:'POST',body:{organization_id:orgA.id,model_codes:['demo-code','demo-reason']}})).status,200);
 const enterpriseOrder=await owner.j.call('/api/demo/orders',{method:'POST',body:{organization_id:orgA.id,amount_yuan:1000}});assert.equal(enterpriseOrder.status,201);
 assert.equal((await member.j.call('/api/demo/orders',{method:'POST',body:{organization_id:orgA.id,amount_yuan:100}})).status,403);
 assert.equal((await other.j.call(`/api/demo/organizations/${orgA.id}`)).status,403);
 assert.equal((await owner.j.call(`/api/demo/orders/${enterpriseOrder.data.order.id}/pay`,{method:'POST',body:{organization_id:orgA.id}})).status,200);
 assert.equal((await owner.j.call('/api/demo/allocations',{method:'POST',body:{organization_id:orgA.id,user_id:member.user.id,limit_yuan:100,model_codes:['demo-code','demo-reason']}})).status,200);
 assert.equal((await owner.j.call('/api/demo/allocations',{method:'POST',body:{organization_id:orgA.id,user_id:owner.user.id,limit_yuan:1000,model_codes:[]}})).status,409);
 assert.equal((await member.j.call('/api/demo/keys',{method:'POST',body:{organization_id:orgA.id,model_codes:['demo-chat'],label:'Denied model'}})).status,409);
 const enterpriseKey=await member.j.call('/api/demo/keys',{method:'POST',body:{organization_id:orgA.id,model_codes:['demo-code','demo-reason'],label:'Team test'}});assert.equal(enterpriseKey.status,201,JSON.stringify(enterpriseKey.data));
 assert.equal((await owner.j.call('/api/demo/allocations',{method:'POST',body:{organization_id:orgA.id,user_id:member.user.id,limit_yuan:100,model_codes:['demo-code']}})).status,409);
 assert.equal((await member.j.call(`/api/demo/keys/${enterpriseKey.data.key.id}/usage`,{method:'POST',body:{organization_id:orgA.id,model_code:'demo-reason',input_tokens:2000,output_tokens:1000}})).status,201);
 const ownerState=(await owner.j.call(`/api/demo/organizations/${orgA.id}`)).data,memberState=(await member.j.call(`/api/demo/organizations/${orgA.id}`)).data;
 assert.equal(ownerState.usage.length,1);assert.equal(memberState.usage.length,1);assert.equal(memberState.members.length,0);assert.equal(memberState.allocations.length,1);assert.deepEqual(memberState.purchased_models,['demo-code','demo-reason']);assert.equal(memberState.orders.length,0);
 assert.equal((await other.j.call(`/api/demo/keys/${enterpriseKey.data.key.id}/usage`,{method:'POST',body:{organization_id:orgB.id,model_code:'demo-code',input_tokens:100,output_tokens:100}})).status,404);
 assert.equal((await member.j.call('/api/demo/allocations',{method:'POST',body:{organization_id:orgA.id,user_id:member.user.id,limit_yuan:500,model_codes:[]}})).status,403);
});
async function staffLogin(j){const first=await j.call('/api/staff/login');assert.equal(first.status,302);const code=await j.call(first.location);assert.equal(code.status,302);const done=await j.call(code.location);assert.equal(done.status,302);assert.equal(done.location,'/#staff-account');return code.location;}
let staff;
test('real OIDC code/PKCE/nonce flow creates separate staff session; replay and cross-browser callback fail',async()=>{
 staff=jar();const callback=await staffLogin(staff);assert.equal((await staff.call('/api/staff/me')).data.staff.role,'platform_admin');assert.equal((await staff.call('/api/platform/me')).status,401);
 assert.equal((await jar().call(callback)).location,'/#staff?error=authentication_failed');assert.equal((await staff.call(callback)).location,'/#staff?error=authentication_failed');
 const same=await staff.call('/api/staff/me');assert.equal(same.status,200);
 const last=await staff.call('/api/staff/members/staff-owner',{method:'PATCH',body:{role:'support',status:'active'}});assert.equal(last.status,409);
});
test('supplier lab link resumes after staff sign-in and rejects arbitrary return targets',async()=>{
 const visitor=jar();const entry=await visitor.call('/api/staff/lab/console');assert.equal(entry.status,302);assert.equal(entry.location,'/api/staff/login?next=lab');
 const first=await visitor.call(entry.location);assert.equal(first.status,302);const code=await visitor.call(first.location);assert.equal(code.status,302);const done=await visitor.call(code.location);assert.equal(done.status,302);assert.equal(done.location,'/api/staff/lab/console');
 assert.equal((await visitor.call('/api/staff/lab/config')).status,200);
 const unsafe=jar();const login=await unsafe.call('/api/staff/login?next=https://example.test/');const redirect=await unsafe.call(login.location);const callback=await unsafe.call(redirect.location);assert.equal(callback.location,'/#staff-account');
});
test('supplier drafts and validation records persist with staff permissions and never become sale-ready',async()=>{
 const outsider=jar();assert.equal((await outsider.call('/api/staff/suppliers')).status,401);
 const created=await staff.call('/api/staff/suppliers',{method:'POST',body:{legal_name:'Fixture Model Ltd',display_name:'Fixture Model',source_type:'official',service_type:'managed_inference',next_action:'取得 SLA 与接口文档',region:'CN',reference_url:'https://example.test/provider'}});
 assert.equal(created.status,201,JSON.stringify(created.data));const supplierId=created.data.id;
 assert.equal(created.data.service_type,'managed_inference');assert.equal(created.data.owner_subject,'staff-owner');
 assert.equal((await owner.j.call('/api/staff/suppliers')).status,401);
 assert.equal((await staff.call('/api/staff/suppliers',{method:'POST',body:{legal_name:'Unsafe',display_name:'Unsafe',source_type:'official',region:'CN',reference_url:'http://example.test'}})).status,400);
 const offer=await staff.call('/api/staff/supplier-offers',{method:'POST',body:{supplier_id:supplierId,model_name:'Fixture Chat',upstream_model_id:'fixture-chat-v1',protocol:'openai_compatible',region:'CN'}});
 assert.equal(offer.status,201,JSON.stringify(offer.data));const offerId=offer.data.id;
 const detail=await staff.call('/api/staff/supplier-offers/'+offerId);assert.equal(detail.status,200);assert.equal(detail.data.checks.length,7);assert.equal(detail.data.sale_ready,false);
 assert.equal(detail.data.readiness.documented,0);assert.equal(detail.data.readiness.sale_ready,false);
 assert.equal((await staff.call('/api/staff/supplier-offers/'+offerId+'/checks/source',{method:'PATCH',body:{result:'documented'}})).status,400);
 assert.equal((await staff.call('/api/staff/supplier-offers/'+offerId+'/checks/source',{method:'PATCH',body:{result:'documented',evidence_url:'https://example.test/evidence'}})).status,200);
 const testBody={test_type:'connectivity',result:'failed',observed_at:new Date(Date.now()-60000).toISOString(),latency_ms:890,evidence_url:'https://example.test/test-evidence',notes:'upstream timeout'};
 assert.equal((await staff.call('/api/staff/supplier-offers/'+offerId+'/tests',{method:'POST',body:{...testBody,evidence_url:''}})).status,400);
 const recorded=await staff.call('/api/staff/supplier-offers/'+offerId+'/tests',{method:'POST',body:testBody});assert.equal(recorded.status,201,JSON.stringify(recorded.data));
 const testedDetail=await staff.call('/api/staff/supplier-offers/'+offerId);assert.equal(testedDetail.data.tests[0].result,'failed');assert.equal(testedDetail.data.sale_ready,false);
 const validationBody={objective:'Peak-hour model validation',window_start:new Date(Date.now()-3600000).toISOString(),window_end:new Date(Date.now()-60000).toISOString(),sample_count:50,success_count:47,p95_ttft_ms:1200,p95_total_ms:4100,usage_check:'mismatched',conclusion:'inconclusive',evidence_url:'https://example.test/validation-report',notes:'Three failed requests need investigation'};
 assert.equal((await outsider.call('/api/staff/supplier-offers/'+offerId+'/validations')).status,401);
 assert.equal((await owner.j.call('/api/staff/supplier-offers/'+offerId+'/validations')).status,401);
 assert.equal((await staff.call('/api/staff/supplier-offers/'+offerId+'/validations',{method:'POST',body:{...validationBody,success_count:51}})).status,400);
 assert.equal((await staff.call('/api/staff/supplier-offers/'+offerId+'/validations',{method:'POST',body:{...validationBody,evidence_url:'http://example.test/report'}})).status,400);
 const validation=await staff.call('/api/staff/supplier-offers/'+offerId+'/validations',{method:'POST',body:validationBody});assert.equal(validation.status,201,JSON.stringify(validation.data));assert.equal(validation.data.technical_verified,false);assert.equal(validation.data.sale_ready,false);
 const validationList=await staff.call('/api/staff/supplier-offers/'+offerId+'/validations');assert.equal(validationList.status,200);assert.equal(validationList.data.source,'staff_recorded');assert.equal(validationList.data.runs[0].id,validation.data.id);assert.equal(validationList.data.runs[0].sample_count,50);assert.equal(validationList.data.runs[0].usage_check,'mismatched');
 const validationSummary=await staff.call('/api/staff/validation-summary');assert.equal(validationSummary.status,200);assert.ok(validationSummary.data.latest.some(r=>r.offer_id===offerId&&r.conclusion==='inconclusive'));assert.equal(validationSummary.data.technical_verified,false);
 const listing=await staff.call('/api/staff/suppliers');assert.equal(listing.status,200);assert.equal(listing.data.sale_ready,false);assert.ok(listing.data.offers.some(o=>o.id===offerId));
 const intake=listing.data.suppliers.find(s=>s.id===supplierId);assert.equal(intake.service_type,'managed_inference');assert.equal(intake.next_action,'取得 SLA 与接口文档');assert.ok(intake.owner_name);assert.ok(intake.owner_email);assert.equal(intake.latest_test.result,'failed');
 assert.equal(listing.data.offers.find(o=>o.id===offerId).readiness.documented,1);
 const updated=await staff.call('/api/staff/suppliers/'+supplierId,{method:'PATCH',body:{status:'reviewing',service_type:'gpu_rental',source_type:'unconfirmed',next_action:'核对机器归属'}});assert.equal(updated.status,200,JSON.stringify(updated.data));assert.equal(updated.data.service_type,'gpu_rental');assert.equal(updated.data.owner_subject,'staff-owner');
 assert.equal((await staff.call('/api/staff/suppliers/'+supplierId,{method:'PATCH',body:{status:'reviewing',service_type:'invalid'}})).status,400);
 assert.equal((await outsider.call('/api/staff/model-products')).status,401);
 assert.equal((await owner.j.call('/api/staff/model-products')).status,401);
 const product=await staff.call('/api/staff/model-products',{method:'POST',body:{offer_id:offerId,display_name:'Fixture Chat CN',product_code:'fixture-chat-cn',summary:'Internal product draft'}});
 assert.equal(product.status,201,JSON.stringify(product.data));assert.equal(product.data.public_catalog_enabled,false);
 const products=await staff.call('/api/staff/model-products');assert.equal(products.status,200);assert.equal(products.data.public_catalog_enabled,false);
 assert.ok(products.data.products.some(p=>p.id===product.data.id&&p.source_model==='Fixture Chat'&&p.supplier_name==='Fixture Model'&&p.supplier_id===supplierId));
 const profile=await staff.call('/api/staff/model-products/'+product.data.id+'/profile',{method:'PATCH',body:{brand:'Fixture',family:'Chat',version_label:'v1',use_cases:'Test use',service_limits:'No SLA yet',capability_tags:['text','streaming'],context_window_tokens:4096,max_output_tokens:1024}});assert.equal(profile.status,200);assert.deepEqual(profile.data.capability_tags,['text','streaming']);
 assert.equal((await staff.call('/api/staff/model-products/'+product.data.id+'/profile',{method:'PATCH',body:{brand:'Fixture',family:'Chat',use_cases:'Test',capability_tags:['unknown']}})).status,400);
 const owned=await staff.call('/api/staff/owned-products',{method:'POST',body:{display_name:'Semifly Summary',product_code:'semifly-summary',region:'CN',summary:'Structured summary',source_description:'Internal formatting layer; underlying inference dependency still unverified'}});assert.equal(owned.status,201,JSON.stringify(owned.data));assert.equal(owned.data.source_kind,'owned_service');assert.equal(owned.data.sale_ready,false);
 assert.ok((await staff.call('/api/staff/model-products')).data.products.some(p=>p.id===owned.data.id&&p.offer_id===null));
 assert.equal((await staff.call('/api/staff/model-products/'+owned.data.id+'/reviews',{method:'POST',body:{}})).status,409);
 assert.equal((await staff.call('/api/staff/model-products',{method:'POST',body:{offer_id:offerId,display_name:'Duplicate',product_code:'fixture-chat-cn'}})).status,409);
 const priceBody={model_product_id:product.data.id,input_yuan_per_million:'12.34',output_yuan_per_million:'56.78',evidence_url:'https://example.test/approved-rate',notes:'Internal price design'};
 assert.equal((await outsider.call('/api/staff/price-proposals')).status,401);
 assert.equal((await owner.j.call('/api/staff/price-proposals')).status,401);
 const price=await staff.call('/api/staff/price-proposals',{method:'POST',body:priceBody});assert.equal(price.status,201,JSON.stringify(price.data));assert.equal(price.data.input_fen_per_million,'1234');assert.equal(price.data.output_fen_per_million,'5678');assert.equal(price.data.public_pricing_enabled,false);assert.equal(price.data.checkout_enabled,false);
 const ownedPrice=await staff.call('/api/staff/price-proposals',{method:'POST',body:{...priceBody,model_product_id:owned.data.id}});assert.equal(ownedPrice.status,201);assert.equal(ownedPrice.data.checkout_enabled,false);
 const priceList=await staff.call('/api/staff/price-proposals');assert.equal(priceList.status,200);assert.equal(priceList.data.checkout_enabled,false);assert.ok(priceList.data.proposals.some(q=>q.id===price.data.id&&q.model_product_name==='Fixture Chat CN'));
 assert.equal((await outsider.call('/api/staff/price-decisions')).status,401);
 assert.equal((await owner.j.call('/api/staff/price-decisions')).status,401);
 assert.equal((await staff.call('/api/staff/price-proposals/'+price.data.id+'/decision',{method:'POST',body:{status:'approved',notes:'Self approval is forbidden'}})).status,409);
 assert.equal((await staff.call('/api/staff/price-proposals',{method:'POST',body:{...priceBody,input_yuan_per_million:'12.345'}})).status,400);
 assert.equal((await staff.call('/api/staff/price-proposals',{method:'POST',body:{...priceBody,evidence_url:'http://example.test/rate'}})).status,400);
 assert.equal((await outsider.call('/api/staff/model-product-reviews')).status,401);
 assert.equal((await owner.j.call('/api/staff/model-products/'+product.data.id+'/reviews',{method:'POST',body:{}})).status,401);
 assert.equal((await staff.call('/api/staff/model-products/'+product.data.id+'/reviews',{method:'POST',body:{}})).status,409);
 for(const key of ['sales_rights','model_version','protocol','data_region','usage_billing','capacity'])assert.equal((await staff.call('/api/staff/supplier-offers/'+offerId+'/checks/'+key,{method:'PATCH',body:{result:'documented',evidence_url:'https://example.test/'+key}})).status,200);
 assert.equal((await staff.call('/api/staff/model-products/'+product.data.id+'/reviews',{method:'POST',body:{}})).status,409);
 const passingRun=await staff.call('/api/staff/supplier-offers/'+offerId+'/validations',{method:'POST',body:{...validationBody,success_count:50,usage_check:'matched',conclusion:'passed'}});assert.equal(passingRun.status,201);
 const requested=await staff.call('/api/staff/model-products/'+product.data.id+'/reviews',{method:'POST',body:{notes:'Request independent review of the recorded evidence'}});assert.equal(requested.status,201,JSON.stringify(requested.data));assert.equal(requested.data.sale_ready,false);
 assert.equal(requested.data.validation_run_id,passingRun.data.id);assert.equal(requested.data.price_proposal_id,price.data.id);
 assert.equal((await staff.call('/api/staff/model-products/'+product.data.id+'/reviews',{method:'POST',body:{}})).status,409);
 assert.equal((await staff.call('/api/staff/model-product-reviews/'+requested.data.id+'/decision',{method:'POST',body:{status:'internally_reviewed',notes:'Self review'}})).status,409);
 identity={sub:'staff-reviewer',email:'reviewer@example.test',name:'Reviewer',staff_approved:true};const reviewer=jar();await staffLogin(reviewer);
 assert.equal((await reviewer.call('/api/staff/model-product-reviews')).status,403);
 assert.equal((await staff.call('/api/staff/members/staff-reviewer',{method:'PATCH',body:{role:'platform_admin',status:'active'}})).status,200);
 await staffLogin(reviewer);
 await pool.query("UPDATE model_price_proposals SET created_at=now()-interval '2 seconds' WHERE id=$1",[price.data.id]);
 const revisedPrice=await staff.call('/api/staff/price-proposals',{method:'POST',body:{...priceBody,input_yuan_per_million:'13.00'}});assert.equal(revisedPrice.status,201);
 assert.equal((await reviewer.call('/api/staff/model-product-reviews/'+requested.data.id+'/decision',{method:'POST',body:{status:'internally_reviewed',notes:'Outdated price'}})).status,409);
 assert.equal((await reviewer.call('/api/staff/model-product-reviews/'+requested.data.id+'/decision',{method:'POST',body:{status:'changes_requested',notes:'Price version changed; resubmit'}})).status,200);
 const resubmitted=await staff.call('/api/staff/model-products/'+product.data.id+'/reviews',{method:'POST',body:{notes:'Updated price version'}});assert.equal(resubmitted.status,201);assert.equal(resubmitted.data.price_proposal_id,revisedPrice.data.id);
 const decided=await reviewer.call('/api/staff/model-product-reviews/'+resubmitted.data.id+'/decision',{method:'POST',body:{status:'internally_reviewed',notes:'Internal evidence reviewed; not approved for sale'}});assert.equal(decided.status,200,JSON.stringify(decided.data));assert.equal(decided.data.status,'internally_reviewed');assert.equal(decided.data.sale_ready,false);
 assert.equal((await reviewer.call('/api/staff/price-proposals/'+price.data.id+'/decision',{method:'POST',body:{status:'approved',notes:'Old price version cannot be approved'}})).status,409);
 assert.equal((await reviewer.call('/api/staff/price-proposals/'+revisedPrice.data.id+'/decision',{method:'POST',body:{status:'approved',notes:'short'}})).status,400);
 const priceDecision=await reviewer.call('/api/staff/price-proposals/'+revisedPrice.data.id+'/decision',{method:'POST',body:{status:'approved',notes:'Reviewed current model evidence and pricing basis; internal approval only'}});
 assert.equal(priceDecision.status,201,JSON.stringify(priceDecision.data));assert.equal(priceDecision.data.public_pricing_enabled,false);assert.equal(priceDecision.data.checkout_enabled,false);
 assert.equal((await reviewer.call('/api/staff/price-proposals/'+revisedPrice.data.id+'/decision',{method:'POST',body:{status:'approved',notes:'Duplicate approval should fail'}})).status,409);
 const priceDecisions=await staff.call('/api/staff/price-decisions');assert.equal(priceDecisions.status,200);assert.ok(priceDecisions.data.decisions.some(d=>d.id===priceDecision.data.id&&d.price_proposal_id===revisedPrice.data.id));
 assert.equal((await reviewer.call('/api/staff/model-product-reviews/'+resubmitted.data.id+'/decision',{method:'POST',body:{status:'changes_requested',notes:'Replay'}})).status,409);
 const reviewList=await staff.call('/api/staff/model-product-reviews');assert.equal(reviewList.status,200);assert.ok(reviewList.data.reviews.some(r=>r.id===resubmitted.data.id&&r.price_proposal_id===revisedPrice.data.id));assert.equal(reviewList.data.public_catalog_enabled,false);
 const campaignBody={name:'Fixture launch draft',price_proposal_id:price.data.id,customer_price_percent:90,commission_percent:5,total_discount_budget_yuan:1000,starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+86400000*8).toISOString()};
 assert.equal((await outsider.call('/api/staff/promotion-campaigns')).status,401);
 assert.equal((await owner.j.call('/api/staff/promotion-campaigns')).status,401);
 const campaign=await staff.call('/api/staff/promotion-campaigns',{method:'POST',body:campaignBody});assert.equal(campaign.status,201,JSON.stringify(campaign.data));assert.equal(campaign.data.status,'draft');assert.equal(campaign.data.redemption_enabled,false);assert.equal(campaign.data.commission_enabled,false);
 const campaignList=await staff.call('/api/staff/promotion-campaigns');assert.equal(campaignList.status,200);assert.ok(campaignList.data.campaigns.some(c=>c.id===campaign.data.id&&c.model_product_name==='Fixture Chat CN'&&c.price_proposal_id===price.data.id&&c.total_discount_budget_fen==='100000'));
 assert.equal((await staff.call('/api/staff/promotion-campaigns',{method:'POST',body:{...campaignBody,price_proposal_id:undefined}})).status,400);
 assert.equal((await staff.call('/api/staff/promotion-campaigns',{method:'POST',body:{...campaignBody,commission_percent:31}})).status,400);
 assert.equal((await staff.call('/api/staff/promotion-campaigns',{method:'POST',body:{...campaignBody,ends_at:campaignBody.starts_at}})).status,400);
 assert.equal((await staff.call('/api/staff/suppliers/'+supplierId,{method:'PATCH',body:{status:'blocked'}})).status,200);
 assert.equal((await staff.call('/api/staff/model-products',{method:'POST',body:{offer_id:offerId,display_name:'Blocked',product_code:'fixture-blocked-cn'}})).status,409);
 assert.equal((await staff.call('/api/staff/promotion-campaigns',{method:'POST',body:campaignBody})).status,409);
 assert.equal((await staff.call('/api/staff/price-proposals',{method:'POST',body:priceBody})).status,409);
 assert.equal((await staff.call('/api/staff/supplier-offers',{method:'POST',body:{supplier_id:supplierId,model_name:'Other',upstream_model_id:'other',protocol:'native',region:'CN'}})).status,409);
 const audit=(await staff.call('/api/staff/audit')).data;assert.ok(audit.some(e=>e.action==='supplier_offer.check_updated'&&e.subject_id===offerId));assert.ok(audit.some(e=>e.action==='supplier_offer.validation_recorded'&&e.subject_id===offerId));assert.ok(audit.some(e=>e.action==='model_product.created'&&e.subject_id===product.data.id));assert.ok(audit.some(e=>e.action==='model_product.review_requested'&&e.subject_id===product.data.id));assert.ok(audit.some(e=>e.action==='model_product.review_decided'&&e.subject_id===product.data.id));assert.ok(audit.some(e=>e.action==='model_price.decided'&&e.subject_id===product.data.id));assert.ok(audit.some(e=>e.action==='promotion_campaign.created'&&e.subject_id===campaign.data.id));
});
test('new employee requires local approval; disabled customer sessions and revoked IdP tokens stop working',async()=>{
 identity={sub:'staff-second',email:'second@example.test',name:'Second',staff_approved:true};const second=jar();await staffLogin(second);assert.equal((await second.call('/api/staff/me')).data.staff.status,'pending');assert.equal((await second.call('/api/staff/customers')).status,403);
 assert.equal((await staff.call('/api/staff/members/staff-second',{method:'PATCH',body:{role:'finance',status:'active'}})).status,200);assert.equal((await second.call('/api/staff/me')).status,401);await staffLogin(second);assert.equal((await second.call('/api/staff/customers')).status,200,'any business access can see customers');assert.equal((await second.call('/api/staff/suppliers')).status,200);assert.equal((await second.call('/api/staff/model-products')).status,200);assert.equal((await second.call('/api/staff/promotion-campaigns')).status,200);
 assert.equal((await staff.call(`/api/staff/customers/${member.user.id}/status`,{method:'POST',body:{disabled:true}})).status,200);assert.equal((await member.j.call('/api/platform/me')).status,401);
 revoked=true;assert.equal((await staff.call('/api/staff/me')).status,401);revoked=false;
});
test('password recovery consumes the token and revokes all previous sessions',async()=>{
 const recovery=await user('recovery');const request=await recovery.j.call('/api/auth/request-password-reset',{method:'POST',body:{email:recovery.email,redirectTo:origin+'/#reset-password'}});assert.equal(request.status,200);while(await service.mail.drain());
 const message=sent.findLast(m=>m.to===recovery.email&&m.subject.includes('重设'));const link=new URL(message.text.match(/http[^\s]+/)[0]),resetToken=link.searchParams.get('reset_token');assert.ok(resetToken);
 const payload={token:resetToken,newPassword:password+'-new'};assert.equal((await jar().call('/api/auth/reset-password',{method:'POST',body:payload})).status,200);assert.equal((await recovery.j.call('/api/platform/me')).status,401);assert.equal((await jar().call('/api/auth/reset-password',{method:'POST',body:payload})).status,400);
 assert.equal((await jar().call('/api/auth/sign-in/email',{method:'POST',body:{email:recovery.email,password}})).status,401);assert.equal((await jar().call('/api/auth/sign-in/email',{method:'POST',body:{email:recovery.email,password:payload.newPassword}})).status,200);
});
test('expired shared links fail; repeated applications remain one pending request',async()=>{
 const link=await joinLink(owner,orgA);await pool.query("UPDATE organization_join_links SET expires_at=now()-interval '1 minute' WHERE id=$1",[link.id]);assert.equal((await other.j.call('/api/platform/join-requests',{method:'POST',body:{token:link.token}})).status,400);
 const fresh=await joinLink(owner,orgA);const results=await Promise.all([1,2].map(()=>other.j.call('/api/platform/join-requests',{method:'POST',body:{token:fresh.token}})));assert.deepEqual(results.map(r=>r.status).sort(),[202,202]);
 const pending=(await owner.j.call(`/api/platform/organizations/${orgA.id}`)).data.joinRequests.filter(x=>x.user_id===other.user.id);assert.equal(pending.length,1);
});
test('early personal pilot (sf_test_) is retired',async()=>{
 assert.equal((await jar().call('/api/pilot/status')).status,401);
 const st=await owner.j.call('/api/pilot/status');assert.equal(st.status,200);assert.equal(st.data.enabled,false);assert.equal(st.data.retired,true);
 assert.equal((await owner.j.call('/api/pilot/keys',{method:'POST',body:{label:'Nope',model_id:'deepseek-flash',confirm_model:true}})).status,410);
 const call=await jar().call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer sf_test_'+'x'.repeat(43)},body:{model:'deepseek-flash',messages:[{role:'user',content:'hi'}]}});
 assert.equal(call.status,410);assert.match(String(call.data.error?.message||call.data.error||''),/下线|sf_test_/);
});
test('employee credit is one-time, company-only, reserved before calling and charged at official prices',async()=>{
 const rate={input:'2',cached:'0.5',output:'8'};
 assert.equal(holdYuan(rate,{input:1000,cached:400,output:100},1),'0.002200000000');assert.equal(holdYuan(rate,{input:1000,cached:400,output:100},2),'0.004400000000');
 assert.equal(channelFeeYuan(0),'0.000000000000');assert.equal(channelFeeYuan(2000),'0.000010000000');assert.equal(channelFeeYuan(1),'0.000000005000');
 assert.equal(officialPeak(new Date('2026-11-10T02:00:00Z')),true,'Tuesday 10:00 Beijing');assert.equal(officialPeak(new Date('2026-11-10T04:30:00Z')),false,'Tuesday 12:30 Beijing');assert.equal(officialPeak(new Date('2026-11-14T02:00:00Z')),false,'Saturday');assert.equal(officialPeak(new Date('2026-11-10T02:00:00Z'),new Set(['2026-11-10'])),false,'holiday');
 // Built-in State Council holidays (H3): weekday holiday mornings are off-peak; ordinary Tue peak still peak.
 {const {CHINA_HOLIDAYS}=await import('../src/china-holidays.mjs');
  assert.ok(CHINA_HOLIDAYS.has('2026-10-01')&&CHINA_HOLIDAYS.has('2027-06-09'));
  assert.equal(officialPeak(new Date('2026-10-01T02:00:00Z'),CHINA_HOLIDAYS),false,'National Day Thu 10:00 BJ');
  assert.equal(officialPeak(new Date('2027-06-09T02:00:00Z'),CHINA_HOLIDAYS),false,'Dragon Boat Wed 10:00 BJ');
  assert.equal(officialPeak(new Date('2026-02-28T02:00:00Z'),CHINA_HOLIDAYS),false,'makeup Saturday stays off-peak');
  assert.equal(officialPeak(new Date('2026-11-10T02:00:00Z'),CHINA_HOLIDAYS),true,'ordinary Tue morning still peak');}
 assert.equal(findOfficialModel('deepseek-v4.1-flash').id,'deepseek-flash');assert.equal(findOfficialModel('GLM-5.3').id,'glm-5.3');assert.equal(findOfficialModel('nope'),undefined);
 assert.throws(()=>employeeRequest({model:'x',messages:[{}]}),/未开放/);assert.equal(employeeRequest({model:'glm-5.3',messages:[{role:'user',content:'a'}]}).payload.model,'GLM-5.3');
 assert.equal(employeeRequest({model:'glm-5.3',messages:[{role:'user',content:'a'}]}).output,8192,'always-thinking GLM defaults to 8K when max_tokens omitted');
 assert.equal(employeeRequest({model:'deepseek-flash',messages:[{role:'user',content:'a'}]}).output,4096,'other models keep 4K default');
 assert.equal(employeeRequest({model:'glm-5.3',messages:[{role:'user',content:'a'}],max_tokens:2048}).output,2048,'explicit max_tokens wins');
 assert.deepEqual(usageFrom({prompt_tokens:10,completion_tokens:2,prompt_tokens_details:{cached_tokens:4}}),{input:10,output:2,cached:4});
 {const h=o=>name=>o[name];assert.equal(callClient(h({'user-agent':'RooCode/3.1.0'})).client,'Roo Code');assert.equal(callClient(h({'user-agent':'OpenAI/Python 1.40.0'})).client,'Python（OpenAI SDK）');assert.equal(callClient(h({'user-agent':'curl/8.4.0'})).client,'curl');
  assert.equal(callClient(h({'x-semifly-client':'客服机器人','user-agent':'curl/8'})).client,'客服机器人');assert.equal(callClient(h({'user-agent':'Mozilla/5.0 WorkBuddy/1.2 Electron'})).client,'WorkBuddy');assert.equal(callClient(h({})).client,'未提供');assert.equal(callClient(h({'user-agent':'zzz'})).client,'未识别');
  const s=callSummary([{role:'system',content:'sys'},{role:'user',content:'old question'},{role:'assistant',content:'a'},{role:'user',content:[{type:'text',text:'<environment_details>private path</environment_details> 用 sk-abcdefghijklmnopqrstu 和 sf_emp_'+'x'.repeat(43)+' 调接口，联系 13812345678 或 me@corp.cn，password: hunter2，身份证 11010119900307123X，然后写周报'}]}]);
  for(const leak of ['abcdefghij','xxxxxxxx','13812345678','me@corp.cn','hunter2','private path','11010119900307123X'])assert.equal(s.includes(leak),false,leak);
  assert.ok(s.startsWith('用 [密钥] 和 [密钥] 调接口'),s);assert.ok(Array.from(callSummary([{role:'user',content:'字'.repeat(500)}])).length<=61);assert.equal(callSummary([{role:'user',content:'<x>only tags</x>'}]),null);}
 const boss=await user('company-boss'),staffer=await user('company-staff'),outsider=await user('company-outsider');
 const company=await organization(boss,'Company'),link=await joinLink(boss,company);await applyAndApprove(boss,company,staffer,link);
 await organization(outsider,'Self Serve Inc');
 assert.equal((await staffer.j.call('/api/employee-credit/status')).data.enabled,false,'disabled until configured');
 await pool.query("INSERT INTO staff_members(subject,email,name) VALUES('credit-fixture','credit@example.test','Credit') ON CONFLICT DO NOTHING");
 const supplier=(await pool.query("INSERT INTO supplier_lab_suppliers(name,kind,created_by) VALUES('KerAPI credit fixture','supplier','credit-fixture') RETURNING id")).rows[0].id;
 const credential=(await pool.query("INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by) VALUES($1,'credit','https://kerapi.cn/v1',$2,'fp','credit-fixture') RETURNING id",[supplier,vault(process.env.SUPPLIER_LAB_SECRET).seal({key:'fixture-kerapi-secret'})])).rows[0].id;
 for(const model of ['GLM-5.3','deepseek-v4.1-flash'])await pool.query("INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,created_by,supplier_id,credential_id) VALUES($1,'supplier','https://kerapi.cn/v1',$1,'fp','credit-fixture',$2,$3)",[model,supplier,credential]);
 // Official DeepSeek models (deepseek-v4-pro) read the standby key file used by the employee gateway.
 if(!pilotDir){pilotDir=await mkdtemp(join(tmpdir(),'oneapi-pilot-'));await writeFile(join(pilotDir,'deepseek.key'),'fixture-upstream-secret');}
 appCfg.pilot.keyFile=join(pilotDir,'deepseek.key');
 appCfg.employeeCredit.organizationId=company.id;
 // These billing checks fake calls of up to 5 million tokens; the gate is tested on its own further down.
 // Raised the way staff would (limits_updated_at set), so re-running migration 053 later in this test keeps it.
 await pool.query('UPDATE organizations SET tpm=1000000000,limits_updated_at=now() WHERE id=$1',[company.id]);
 assert.equal((await outsider.j.call('/api/employee-credit/status')).data.enabled,false);
 assert.equal((await outsider.j.call('/api/employee-credit/keys',{method:'POST',body:{label:'No'}})).status,403);
 for(let i=0;i<2;i++){const s=(await staffer.j.call('/api/employee-credit/status')).data;assert.equal(s.enabled,true);assert.equal(s.max_output_tokens,32768);assert.ok(s.base_url.endsWith('/v1'));assert.equal(Number(s.available_yuan),10);assert.deepEqual(s.model_ids,['deepseek-flash','deepseek-v4-pro','glm-5.3']);assert.equal(s.models[2].input_yuan,'8');}
 assert.equal(GRANT_YUAN,'10.000000000000');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='employee_credit.granted' AND subject_id=$1",[staffer.user.id])).rows[0].n,1);
 const created=await staffer.j.call('/api/employee-credit/keys',{method:'POST',body:{label:'Agent'}});assert.equal(created.status,201);assert.match(created.data.secret,/^sf_emp_/);
 assert.notEqual((await pool.query('SELECT secret_hash FROM employee_api_keys WHERE id=$1',[created.data.key.id])).rows[0].secret_hash,created.data.secret);
 assert.equal(JSON.stringify((await staffer.j.call('/api/employee-credit/status')).data).includes(created.data.secret),false);
 let upstreamCalls=[],serial2=0,usage={prompt_tokens:100,completion_tokens:10,total_tokens:110};
 const reply=()=>{const n=++serial2;return new Response(JSON.stringify({id:'c'+n,choices:[{message:{role:'assistant',content:'ok'}}],usage}),{status:200,headers:{'content-type':'application/json','x-request-id':'req-'+n}});};
 pilotFetch=async(url,options)=>{upstreamCalls.push({url,options});return reply();};
 const glmBody={model:'glm-5.3',messages:[{role:'user',content:'hi'}],max_tokens:100};
 const call=(body={},key=created.data.secret)=>jar().call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key},body:{...glmBody,...body}});
 const status=async()=>(await staffer.j.call('/api/employee-credit/status')).data;
 assert.deepEqual((await jar().call('/v1/models',{headers:{Authorization:'Bearer '+created.data.secret}})).data.data.map(m=>m.id),['deepseek-flash','deepseek-v4-pro','glm-5.3']);
 {const listed=(await jar().call('/v1/models',{headers:{Authorization:'Bearer '+created.data.secret}})).data.data,glm=listed.find(m=>m.id==='glm-5.3');assert.equal(glm.capabilities.thinking,'always');assert.equal(glm.capabilities.max_output_tokens,32768);assert.ok(glm.tags.includes('始终思考')&&!glm.tags.includes('看图'));
  const open=await jar().call('/api/public/models');assert.equal(open.status,200);assert.deepEqual(open.data.models.filter(m=>m.available).map(m=>m.id),['deepseek-flash','deepseek-v4-pro','glm-5.3'],'public list shows only what can be called now');assert.equal(JSON.stringify(open.data).includes('kerapi'),false);
  assert.ok((await staffer.j.call('/api/employee-credit/status')).data.models.every(m=>m.capability_tags.length&&m.capabilities.thinking));}
 const first=await call({model:'GLM-5.3'});assert.equal(first.status,200,JSON.stringify(first.data));
 {const big=await call({model:'not-offered',messages:[{role:'user',content:'x'.repeat(700*1024)}]});assert.equal(big.status,403,'a 700 KB agent request passes the body limit and reaches model checks');assert.equal(typeof big.data.error.message,'string','v1 errors use the OpenAI shape');assert.equal(big.data.error.code,'model_not_allowed');assert.match(big.data.error.request_id,/^req_/);assert.equal(big.headers.get('x-semifly-request-id'),big.data.error.request_id);assert.match(big.data.error.doc_url,/#docs\/errors\/model_not_allowed$/);
  const huge=await call({messages:[{role:'user',content:'x'.repeat(9*1024*1024)}]});assert.equal(huge.status,413);assert.match(huge.data.error.message,/8MB/);assert.equal(huge.data.error.code,'request_too_large');}
 assert.equal(upstreamCalls[0].url,'https://kerapi.cn/v1/chat/completions');assert.equal(upstreamCalls[0].options.headers.Authorization,'Bearer fixture-kerapi-secret');assert.equal(JSON.parse(upstreamCalls[0].options.body).model,'GLM-5.3');
 let s=await status();assert.equal(Number(s.spent_yuan),0.00108,'official price charged at completion');assert.equal(s.calls_30d,1);assert.equal(s.failed_30d,0);assert.equal(Number(s.month_yuan),0.00108);assert.equal(s.daily[0].model_id,'glm-5.3');assert.equal(Number(s.held_yuan),0);assert.equal(s.recent_calls[0].model_id,'glm-5.3');assert.equal(s.recent_calls[0].settlement_source,'official_price');
 const before=Number(s.spent_yuan);
 assert.equal((await call({model:'deepseek-v4-pro'})).status,200);const pro=upstreamCalls.at(-1);assert.equal(pro.url,'https://api.deepseek.com/chat/completions');assert.equal(pro.options.headers.Authorization,'Bearer fixture-upstream-secret');
 s=await status();assert.ok([0.000585,0.00117].includes(Number((Number(s.spent_yuan)-before).toFixed(9))),'V4 Pro official price with time-of-day multiplier');
 assert.equal((await call({messages:[{role:'user',content:'x'.repeat(20000)}]})).status,200,'accepts prompts above the 16 KB app-wide limit');
 pilotFetch=async()=>new Response('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":5}}\n\ndata: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream','x-request-id':'req-stream'}});
 const streamed=await call({stream:true});assert.equal(streamed.status,200);assert.match(streamed.data,/\[DONE\]/);
 const row=(await pool.query("SELECT status,output_tokens,charged_yuan FROM employee_calls WHERE upstream_request_id='req-stream'")).rows[0];assert.equal(row.status,'settled');assert.equal(row.output_tokens,5);assert.equal(Number(row.charged_yuan),0.00054);
 // A stream without usage keeps its hold and settles from KerAPI's log.
 pilotFetch=async()=>new Response('data: {"choices":[]}\n\n',{status:200,headers:{'content-type':'text/event-stream','x-request-id':'req-dropped'}});
 assert.equal((await call({stream:true})).status,200);s=await status();assert.ok(Number(s.held_yuan)>0);
 const sync=(await pool.query("INSERT INTO supplier_usage_syncs(credential_id,record_count,response_sha256,created_by) VALUES($1,1,'h','t') RETURNING id",[credential])).rows[0].id;
 await pool.query('INSERT INTO supplier_usage_records(credential_id,request_id,model_id,occurred_at,evidence,sync_id) VALUES($1,$2,$3,now(),$4,$5)',[credential,'req-dropped','GLM-5.3',{amount:'0.000126000000',currency:'CNY'},sync]);
 const spentBefore=Number(s.spent_yuan);await settleEmployeeCalls(pool);await settleEmployeeCalls(pool);s=await status();assert.equal(Number((Number(s.spent_yuan)-spentBefore).toFixed(9)),0.000126,'charged once');assert.equal(Number(s.held_yuan),0);
 pilotFetch=async()=>new Response(JSON.stringify({error:{message:'bad fixture-kerapi-secret'}}),{status:500});
 const spent=s.spent_yuan,broken=await call();assert.equal(broken.status,502);assert.equal(JSON.stringify(broken.data).includes('fixture-kerapi-secret'),false);{const d=(await pool.query("SELECT error_detail FROM employee_calls WHERE status='failed' ORDER BY created_at DESC LIMIT 1")).rows[0].error_detail;assert.equal(d,'bad [REDACTED]','supplier message kept, key redacted');}s=await status();assert.equal(s.spent_yuan,spent);assert.equal(Number(s.held_yuan),0,'failed call releases its hold');
 {// Time limits (docs/14-gateway-settings.md D1/D3): a stream is cut when the upstream goes silent, any request when it runs past the total.
  const savedFetch=pilotFetch,lastCall=async()=>(await pool.query('SELECT status,error_code,charged_yuan FROM employee_calls ORDER BY created_at DESC LIMIT 1')).rows[0];
  const hang=(_url,options)=>new Promise((_,no)=>options.signal.addEventListener('abort',()=>no(options.signal.reason)));
  try{
   appCfg.employeeCredit.timeouts={total:5000,idle:80};
   // 1. A stream that never starts: 504 before any output, nothing charged.
   pilotFetch=hang;const silent=await call({stream:true});assert.equal(silent.status,504,JSON.stringify(silent.data));assert.equal(silent.data.error.code,'upstream_timeout');assert.match(silent.data.error.message,/没有输出/);
   let c=await lastCall();assert.equal(c.status,'failed');assert.equal(c.error_code,'UPSTREAM_IDLE_TIMEOUT');
   // 2. A stream that starts and then stalls: the client gets what arrived, then an error event instead of [DONE]; billing waits for the supplier's log.
   pilotFetch=async(_url,options)=>{const enc=new TextEncoder();return new Response(new ReadableStream({start(ctl){ctl.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"半句"}}]}\n\n'));options.signal.addEventListener('abort',()=>ctl.error(options.signal.reason));}}),{status:200,headers:{'content-type':'text/event-stream','x-request-id':'req-stalled'}});};
   const stalled=await call({stream:true});assert.equal(stalled.status,200);assert.match(stalled.data,/半句/);assert.match(stalled.data,/"code":"upstream_timeout"/);assert.doesNotMatch(stalled.data,/\[DONE\]/);
   c=await lastCall();assert.equal(c.status,'awaiting_bill','output was produced, so the supplier may bill it');assert.equal(c.error_code,'UPSTREAM_IDLE_TIMEOUT');
   // 3. A non-streamed reply is silent until complete, so the idle limit does not apply to it.
   pilotFetch=async()=>{await new Promise(r=>setTimeout(r,200));return reply();};assert.equal((await call()).status,200,'slower than the idle limit, still fine without stream');
   // 4. The total limit applies to everything.
   appCfg.employeeCredit.timeouts={total:80,idle:5000};pilotFetch=hang;const long=await call();assert.equal(long.status,504);assert.match(long.data.error.message,/时长上限/);
   c=await lastCall();assert.equal(c.status,'failed');assert.equal(c.error_code,'UPSTREAM_TIMEOUT');
   await pool.query("UPDATE employee_calls SET status='failed' WHERE upstream_request_id='req-stalled'");
  }finally{delete appCfg.employeeCredit.timeouts;pilotFetch=savedFetch;}
  const m=await import('../src/employee-credit.mjs');assert.equal(m.UPSTREAM_TIMEOUT_MS,900000,'15 minutes in total');assert.equal(m.UPSTREAM_IDLE_MS,60000,'60 seconds of silence');}
 // Only one of two concurrent calls fits, and the upstream is never asked for the other.
 usage={prompt_tokens:1,completion_tokens:1};pilotFetch=async()=>{await new Promise(r=>setTimeout(r,120));return reply();};
 const room=holdYuan({input:'8',cached:'2',output:'28'},{input:Buffer.byteLength(JSON.stringify({messages:glmBody.messages})),output:100},1);
 await pool.query('UPDATE employee_credit_accounts SET spent_yuan=granted_yuan-$2::numeric WHERE user_id=$1',[staffer.user.id,room]);
 const racing=await Promise.all([call(),call()]);assert.deepEqual(racing.map(r=>r.status).sort(),[200,402]);
 // Usage above the bound never overdraws, and the true price is kept.
 // Keep settled tokens under the person seat TPM (3M) so later cases in this test are not blocked.
 await pool.query('UPDATE employee_credit_accounts SET spent_yuan=granted_yuan-$2::numeric WHERE user_id=$1',[staffer.user.id,room]);
 usage={prompt_tokens:100000,completion_tokens:1};pilotFetch=async()=>reply();assert.equal((await call()).status,200);
 s=await status();assert.equal(Number(s.available_yuan),0);assert.equal(s.spent_yuan,s.granted_yuan);
 {// Owner decision 2026-11-12 (docs/14-gateway-settings.md D4): a hang-up is CLIENT_CLOSED; KerAPI's log prices a call at official rates; a gateway restart charges nothing.
  const saved=pilotFetch,newest=async()=>(await pool.query('SELECT id,status,error_code,charged_yuan,settlement_source FROM employee_calls ORDER BY created_at DESC LIMIT 1')).rows[0];
  const logLine=(id,evidence)=>pool.query('INSERT INTO supplier_usage_records(credential_id,request_id,model_id,occurred_at,evidence,sync_id) VALUES($1,$2,$3,now(),$4,$5)',[credential,id,'GLM-5.3',evidence,sync]);
  try{
   await pool.query('UPDATE employee_credit_accounts SET spent_yuan=0,granted_yuan=10 WHERE user_id=$1',[staffer.user.id]);
   // 1. The caller hangs up while the upstream is still working: failed as CLIENT_CLOSED, nothing charged.
   pilotFetch=(_u,o)=>new Promise((_,no)=>o.signal.addEventListener('abort',()=>no(o.signal.reason)));
   const hangup=new AbortController();const pending=fetch(origin+'/v1/chat/completions',{method:'POST',signal:hangup.signal,headers:{Authorization:'Bearer '+created.data.secret,'Content-Type':'application/json'},body:JSON.stringify(glmBody)}).catch(()=>null);
   await new Promise(r=>setTimeout(r,150));hangup.abort();await pending;
   let c;for(let i=0;i<50&&(c=await newest()).status==='pending';i++)await new Promise(r=>setTimeout(r,20));
   assert.equal(c.status,'failed');assert.equal(c.error_code,'CLIENT_CLOSED');assert.equal(c.charged_yuan,null);
   // 2. A stream that ends without usage settles from KerAPI's token counts at the official price, not KerAPI's own amount.
   pilotFetch=async()=>new Response('data: {"choices":[{"delta":{"content":"半"}}]}\n\n',{status:200,headers:{'content-type':'text/event-stream','x-request-id':'req-tokens'}});
   await call({stream:true});await logLine('req-tokens',{amount:'0.000001000000',currency:'CNY',type:2,quota:5,input_tokens:1000,cached_input_tokens:200,output_tokens:300});
   await settleEmployeeCalls(pool);c=(await pool.query("SELECT charged_yuan,settlement_source FROM employee_calls WHERE upstream_request_id='req-tokens'")).rows[0];
   assert.equal(c.settlement_source,'supplier_tokens');assert.equal(Number(c.charged_yuan),Number(holdYuan({input:'8',cached:'2',output:'28'},{input:1000,cached:200,output:300},1)),'GLM-5.3 official price: 800×8 + 200×2 + 300×28 per million');
   // 3. KerAPI charged nothing: platform channel fee on submitted tokens (owner 2026-11-13, #15). Prefer log input; else estimated_input_tokens.
   pilotFetch=async()=>new Response('data: {"choices":[{"delta":{"content":"半"}}]}\n\n',{status:200,headers:{'content-type':'text/event-stream','x-request-id':'req-free'}});
   await call({stream:true});
   const freeEst=(await pool.query("SELECT estimated_input_tokens FROM employee_calls WHERE upstream_request_id='req-free'")).rows[0].estimated_input_tokens;
   assert.ok(freeEst>0,'admit stores estimated_input_tokens');
   await logLine('req-free',{amount:null,currency:'CNY',type:5,quota:0});
   await settleEmployeeCalls(pool);c=(await pool.query("SELECT status,charged_yuan,settlement_source,input_tokens FROM employee_calls WHERE upstream_request_id='req-free'")).rows[0];
   assert.equal(c.status,'settled');assert.equal(c.settlement_source,'supplier_free');
   assert.equal(Number(c.charged_yuan),Number(channelFeeYuan(freeEst)));assert.equal(c.input_tokens,freeEst);
   pilotFetch=async()=>new Response('data: {"choices":[{"delta":{"content":"半"}}]}\n\n',{status:200,headers:{'content-type':'text/event-stream','x-request-id':'req-free-log'}});
   await call({stream:true});await logLine('req-free-log',{amount:null,currency:'CNY',type:5,quota:0,input_tokens:2000});
   await settleEmployeeCalls(pool);c=(await pool.query("SELECT charged_yuan,settlement_source,input_tokens FROM employee_calls WHERE upstream_request_id='req-free-log'")).rows[0];
   assert.equal(c.settlement_source,'supplier_free');assert.equal(Number(c.charged_yuan),Number(channelFeeYuan(2000)));assert.equal(c.input_tokens,2000);
   const bare=(await pool.query(`INSERT INTO employee_calls(key_id,owner_id,model_id,credential_id,upstream,price_snapshot,status,hold_yuan,upstream_request_id) SELECT key_id,owner_id,model_id,credential_id,upstream,price_snapshot,'awaiting_bill','0.5','req-free-bare' FROM employee_calls WHERE upstream_request_id='req-free' RETURNING id`)).rows[0].id;
   await logLine('req-free-bare',{amount:null,currency:'CNY',type:5,quota:0});
   await settleEmployeeCalls(pool);c=(await pool.query('SELECT charged_yuan,settlement_source FROM employee_calls WHERE id=$1',[bare])).rows[0];
   assert.equal(c.settlement_source,'supplier_free');assert.equal(Number(c.charged_yuan),0,'no estimate and no log tokens → ¥0');
   // Every deploy re-runs all migrations: older files must not re-impose a CHECK these newer rows would break.
   await migrate(pool,service.auth);assert.match((await pool.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='employee_calls_settlement_source_check'")).rows[0].d,/supplier_free/);
   // 4. A call left open by a gateway restart, before the upstream answered: released, not charged; also when already marked STALE_PENDING.
   const stuck=async extra=>(await pool.query(`INSERT INTO employee_calls(key_id,owner_id,model_id,credential_id,upstream,price_snapshot,status,hold_yuan,created_at${extra?',error_code':''}) SELECT key_id,owner_id,model_id,credential_id,upstream,price_snapshot,$1,'0.5',now()-interval '1 hour'${extra?",'STALE_PENDING'":''} FROM employee_calls WHERE upstream_request_id='req-free' RETURNING id`,[extra?'awaiting_bill':'pending'])).rows[0].id;
   const a=await stuck(false),b=await stuck(true);const before=await status();
   await settleEmployeeCalls(pool);const rows=(await pool.query('SELECT status,error_code,charged_yuan FROM employee_calls WHERE id=ANY($1::uuid[])',[[a,b]])).rows;
   assert.deepEqual(rows.map(r=>[r.status,r.error_code,r.charged_yuan]),[['failed','GATEWAY_INTERRUPTED',null],['failed','GATEWAY_INTERRUPTED',null]]);
   const after=await status();assert.equal(after.spent_yuan,before.spent_yuan,'nothing charged');assert.equal(Number(before.held_yuan)-Number(after.held_yuan),1,'both holds released');
   // 5. Calls a stopped gateway process left open are released at once, not after 20 minutes (C4, D6; gateway-instance.mjs).
   const {GATEWAY_INSTANCE,releaseInterruptedCalls,heartbeat,markStopped}=await import('../src/gateway-instance.mjs');
   {// A call records the process serving it, and KerAPI's request ID as soon as the answer starts, not only when it ends.
    pilotFetch=async(_u,o)=>{const enc=new TextEncoder();return new Response(new ReadableStream({start(ctl){ctl.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"半"}}]}\n\n'));o.signal.addEventListener('abort',()=>ctl.error(o.signal.reason));}}),{status:200,headers:{'content-type':'text/event-stream','x-request-id':'req-midway'}});};
    const hangup=new AbortController();await fetch(origin+'/v1/chat/completions',{method:'POST',signal:hangup.signal,headers:{Authorization:'Bearer '+created.data.secret,'Content-Type':'application/json'},body:JSON.stringify({...glmBody,stream:true})});
    let m;for(let i=0;i<50;i++){m=(await pool.query('SELECT id,status,upstream_request_id,gateway_instance FROM employee_calls ORDER BY created_at DESC LIMIT 1')).rows[0];if(m.upstream_request_id)break;await new Promise(r=>setTimeout(r,20));}
    assert.deepEqual([m.status,m.upstream_request_id,m.gateway_instance],['pending','req-midway',GATEWAY_INSTANCE]);
    hangup.abort();for(let i=0;i<50&&(await newest()).status==='pending';i++)await new Promise(r=>setTimeout(r,20));
    await pool.query("UPDATE employee_calls SET status='failed' WHERE id=$1",[m.id]);}
   const {randomUUID}=await import('node:crypto'),crashed=randomUUID(),running=randomUUID(),stopped=randomUUID();
   await heartbeat(pool,crashed);await pool.query("UPDATE gateway_instances SET seen_at=now()-interval '1 minute' WHERE id=$1",[crashed]);
   await heartbeat(pool,running);await heartbeat(pool,stopped);await markStopped(pool,stopped);
   const open=async(instance,rid=null)=>(await pool.query("INSERT INTO employee_calls(key_id,owner_id,model_id,credential_id,upstream,price_snapshot,status,hold_yuan,gateway_instance,upstream_request_id) SELECT key_id,owner_id,model_id,credential_id,upstream,price_snapshot,'pending','0.5',$1,$2 FROM employee_calls WHERE upstream_request_id='req-free' RETURNING id",[instance,rid])).rows[0].id;
   const ids={unanswered:await open(crashed),streaming:await open(crashed,'req-cut'),neverLogged:await open(stopped,'req-never'),running:await open(running),self:await open(GATEWAY_INSTANCE),legacy:await open(null)};
   const state=async()=>{const rows=(await pool.query('SELECT id,status,error_code FROM employee_calls WHERE id=ANY($1::uuid[])',[Object.values(ids)])).rows;return Object.fromEntries(Object.entries(ids).map(([k,v])=>{const x=rows.find(r=>r.id===v);return [k,x.status+(x.error_code?'/'+x.error_code:'')];}));};
   const held=Number((await status()).held_yuan),r=await releaseInterruptedCalls(pool);
   assert.deepEqual(r,{released:3,awaiting_bill:2,people:1,freed_yuan:'0.500000000000'});
   assert.deepEqual(await state(),{unanswered:'failed/GATEWAY_INTERRUPTED',streaming:'awaiting_bill/GATEWAY_INTERRUPTED',neverLogged:'awaiting_bill/GATEWAY_INTERRUPTED',running:'pending',self:'pending',legacy:'pending'},'a running process, this one, and calls from before the change are left alone');
   assert.equal(Number((held-Number((await status()).held_yuan)).toFixed(9)),0.5,'the unanswered call frees its hold and its concurrency slot at once');
   assert.equal((await releaseInterruptedCalls(pool)).released,0,'safe to repeat');
   // The answer was streaming: KerAPI's log prices it like a hang-up (D4). Never logged within the grace period: not charged (H7).
   await logLine('req-cut',{amount:'0.000001000000',currency:'CNY',type:2,quota:5,input_tokens:100,cached_input_tokens:0,output_tokens:10});
   await pool.query("UPDATE employee_calls SET created_at=now()-interval '2 days' WHERE id=$1",[ids.neverLogged]);
   const spent=Number((await status()).spent_yuan);await settleEmployeeCalls(pool);
   const billed=(await pool.query('SELECT status,settlement_source,charged_yuan FROM employee_calls WHERE id=$1',[ids.streaming])).rows[0];
   assert.deepEqual([billed.status,billed.settlement_source,Number(billed.charged_yuan)],['settled','supplier_tokens',Number(holdYuan({input:'8',cached:'2',output:'28'},{input:100,cached:0,output:10},1))]);
   assert.equal((await state()).neverLogged,'failed/GATEWAY_INTERRUPTED');
   assert.equal(Number((Number((await status()).spent_yuan)-spent).toFixed(9)),Number(billed.charged_yuan),'only the logged call is charged');
   await pool.query("UPDATE employee_calls SET status='failed' WHERE id=ANY($1::uuid[]) AND status='pending'",[[ids.running,ids.self,ids.legacy]]);
  }finally{pilotFetch=saved;}}
 // No usage and no bill: the hold is charged after the grace period.
 await pool.query('UPDATE employee_credit_accounts SET spent_yuan=5 WHERE user_id=$1',[staffer.user.id]);
 pilotFetch=async()=>new Response('data: {"choices":[]}\n\n',{status:200,headers:{'content-type':'text/event-stream'}});await call({stream:true});
 await pool.query("UPDATE employee_calls SET created_at=now()-interval '2 days' WHERE owner_id=$1 AND status='awaiting_bill'",[staffer.user.id]);await settleEmployeeCalls(pool);
 assert.ok((await pool.query("SELECT 1 FROM employee_calls WHERE owner_id=$1 AND settlement_source='hold_fallback'",[staffer.user.id])).rowCount===1);
 // Managers see the whole company; members only themselves; the customer panel only links to the back office.
 assert.equal((await staffer.j.call('/api/employee-credit/team')).status,403);assert.equal((await outsider.j.call('/api/employee-credit/team')).status,403);
 const team=await boss.j.call('/api/employee-credit/team');assert.equal(team.status,200,JSON.stringify(team.data));assert.equal(team.data.totals.members,2);
 {const key=team.data.keys.find(k=>k.calls>0);assert.ok(key,'team keys carry per-key usage');assert.ok(Number(key.tokens)>0);assert.ok(Number(key.yuan)>0);
  const own=(await staffer.j.call('/api/employee-credit/status')).data.keys.find(k=>k.id===key.id);if(own)assert.equal(own.calls,key.calls);
  assert.equal((await outsider.j.call('/api/employee-credit/model-health')).status,403);assert.equal((await outsider.j.call('/api/employee-credit/model-health/refresh',{method:'POST',body:{}})).status,403);
  const probes=[];const saved=pilotFetch;pilotFetch=async(url,options)=>{probes.push(JSON.parse(options.body));return new Response('{}',{status:200});};
  const health=await staffer.j.call('/api/employee-credit/model-health');assert.equal(health.status,200);assert.ok(health.data.models.some(m=>m.status==='ok'&&Number.isInteger(m.latency_ms)));
  assert.ok(probes.length>0&&probes.every(p=>p.max_tokens===1));const count=probes.length;
  assert.equal((await boss.j.call('/api/employee-credit/model-health')).status,200);assert.equal(probes.length,count,'probes are cached');
  {const again=await boss.j.call('/api/employee-credit/model-health/refresh',{method:'POST',body:{}});assert.equal(again.status,200);assert.equal(again.data.throttled,true,'manual refresh waits a minute');assert.ok(again.data.retry_after_seconds>0);assert.equal(probes.length,count);}pilotFetch=saved;}assert.equal(team.data.members.find(m=>m.user_id===boss.user.id).granted_yuan,GRANT_YUAN,'unclaimed members still counted');
 assert.ok(team.data.recent_calls.length>0);assert.equal(JSON.stringify(team.data).includes(created.data.secret),false);assert.equal(team.data.recent_calls[0].messages,undefined);
 assert.equal((await staffer.j.call(`/api/employee-credit/team/members/${boss.user.id}/grant`,{method:'POST',body:{yuan:'5'}})).status,403);
 for(const yuan of ['0','1001','abc'])assert.equal((await boss.j.call(`/api/employee-credit/team/members/${staffer.user.id}/grant`,{method:'POST',body:{yuan}})).status,400);
 const grantedBefore=Number((await status()).granted_yuan);assert.equal((await boss.j.call(`/api/employee-credit/team/members/${staffer.user.id}/grant`,{method:'POST',body:{yuan:'2.50'}})).status,200);assert.equal(Number((await status()).granted_yuan),grantedBefore+2.5);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='employee_credit.topped_up' AND subject_id=$1",[staffer.user.id])).rows[0].n,1);
 assert.equal((await boss.j.call(`/api/employee-credit/team/members/${outsider.user.id}/grant`,{method:'POST',body:{yuan:'1'}})).status,404);
 assert.equal((await staffer.j.call(`/api/employee-credit/team/members/${staffer.user.id}/quota`,{method:'POST',body:{yuan:'50'}})).status,403);
 for(const yuan of ['-1','10000.01','abc'])assert.equal((await boss.j.call(`/api/employee-credit/team/members/${staffer.user.id}/quota`,{method:'POST',body:{yuan}})).status,400);
 assert.equal((await boss.j.call(`/api/employee-credit/team/members/${outsider.user.id}/quota`,{method:'POST',body:{yuan:'1'}})).status,404);
 const quota=await status(),quotaFloor=Number(quota.spent_yuan)+Number(quota.held_yuan);
 assert.equal((await boss.j.call(`/api/employee-credit/team/members/${staffer.user.id}/quota`,{method:'POST',body:{yuan:'20.00'}})).status,200);assert.equal(Number((await status()).granted_yuan),20);
 assert.equal((await boss.j.call(`/api/employee-credit/team/members/${staffer.user.id}/quota`,{method:'POST',body:{yuan:(Math.ceil(quotaFloor*100)/100).toFixed(2)}})).status,200);
 if(quotaFloor>=0.01)assert.equal((await boss.j.call(`/api/employee-credit/team/members/${staffer.user.id}/quota`,{method:'POST',body:{yuan:'0'}})).status,409);
 assert.equal((await boss.j.call(`/api/employee-credit/team/members/${staffer.user.id}/quota`,{method:'POST',body:{yuan:quota.granted_yuan.replace(/(\.\d{2})\d*$/,'$1')}})).status,200);
 assert.equal((await staffer.j.call('/api/billing/organizations/'+company.id)).status,403);
 await pool.query("UPDATE memberships SET role='admin' WHERE organization_id=$1 AND user_id=$2",[company.id,staffer.user.id]);
 assert.equal((await staffer.j.call('/api/employee-credit/team')).status,200,'admin is a manager');assert.equal((await staffer.j.call('/api/billing/organizations/'+company.id)).status,200,'admin can read company funds');assert.equal((await staffer.j.call(`/api/platform/organizations/${company.id}`)).data.permissions.manager,true);
 await pool.query("UPDATE memberships SET role='member' WHERE organization_id=$1 AND user_id=$2",[company.id,staffer.user.id]);
 const memberView=(await staffer.j.call(`/api/platform/organizations/${company.id}`)).data;assert.equal(memberView.permissions.manager,false);assert.equal(memberView.members.length,1);
 assert.deepEqual((await outsider.j.call('/api/platform/me')).data.backoffice,{business:false,technical:false});
 await pool.query("INSERT INTO staff_members(subject,email,name,role,status) VALUES('panel-admin',$1,'Panel','platform_admin','active')",[boss.user.email]);assert.deepEqual((await boss.j.call('/api/platform/me')).data.backoffice,{business:true,technical:true});await pool.query("DELETE FROM staff_members WHERE subject='panel-admin'");
 const managedKey=await staffer.j.call('/api/employee-credit/keys',{method:'POST',body:{label:'Managed'}});assert.equal((await staffer.j.call('/api/employee-credit/team/keys/'+managedKey.data.key.id+'/revoke',{method:'POST',body:{}})).status,403);assert.equal((await boss.j.call('/api/employee-credit/team/keys/'+managedKey.data.key.id+'/revoke',{method:'POST',body:{}})).status,200);assert.equal((await call({},managedKey.data.secret)).status,401);
 await pool.query("INSERT INTO channel_states(model_id,paused,updated_by) VALUES('glm-5.3',true,'t')");assert.equal((await call()).status,503,'paused channel');await pool.query("DELETE FROM channel_states WHERE model_id='glm-5.3'");
 // Leaving the company ends access at once, and re-joining never grants a second allowance.
 const membership=(await boss.j.call(`/api/platform/organizations/${company.id}`)).data.members.find(m=>m.user_id===staffer.user.id);
 assert.equal((await boss.j.call(`/api/platform/organizations/${company.id}/members/${membership.id}`,{method:'PATCH',body:{status:'suspended'}})).status,200);
 assert.equal((await call()).status,401);assert.equal((await status()).enabled,false);
 assert.equal((await boss.j.call(`/api/platform/organizations/${company.id}/members/${membership.id}`,{method:'PATCH',body:{status:'active'}})).status,200);
 s=await status();assert.equal(Number(s.granted_yuan),grantedBefore+2.5,'re-activation grants nothing new');
 {const saved=pilotFetch;pilotFetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:5,completion_tokens:1}}),{status:200,headers:{'content-type':'application/json'}});
    const ask=(headers,content)=>jar().call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+created.data.secret,...headers},body:{model:'deepseek-flash',max_tokens:16,messages:[{role:'system',content:'sys'},{role:'user',content}]}});
    const last=async()=>(await pool.query('SELECT client,summary FROM employee_calls WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1',[staffer.user.id])).rows[0];
    let r=await ask({'User-Agent':'RooCode/3.1'},'请帮我写周报');assert.equal(r.status,200,JSON.stringify(r.data));assert.deepEqual(await last(),{client:'Roo Code',summary:null},'summaries stay off by default');
    assert.equal((await staffer.j.call('/api/employee-credit/team/summaries',{method:'PUT',body:{enabled:true}})).status,403,'only managers switch summaries');
    assert.equal((await boss.j.call('/api/employee-credit/team/summaries',{method:'PUT',body:{enabled:true}})).status,200);assert.equal((await staffer.j.call('/api/employee-credit/status')).data.summaries_enabled,true,'employees are told');
    r=await ask({'User-Agent':'OpenAI/Python 1.40','X-Semifly-Client':encodeURIComponent('周报助手')},'用 sk-abcdefghijklmnopqrstu 写周报，电话 13812345678');assert.equal(r.status,200);
    const row=await last();assert.equal(row.client,'周报助手');assert.equal(row.summary,'用 [密钥] 写周报，电话 [手机号]');
    const detail=await boss.j.call('/api/employee-credit/team/members/'+staffer.user.id);assert.equal(detail.status,200);assert.equal(detail.data.calls[0].summary,row.summary);assert.ok(detail.data.clients.some(c=>c.client==='Roo Code'));assert.ok(detail.data.models.some(m=>m.model_id==='deepseek-flash'));
    assert.equal((await staffer.j.call('/api/employee-credit/team/members/'+boss.user.id)).status,403,'members cannot read colleagues');
    assert.ok((await boss.j.call('/api/employee-credit/team')).data.keys.some(k=>k.last_client==='周报助手'));
   {const team=(await boss.j.call('/api/employee-credit/team')).data,key=team.keys.find(k=>k.last_client==='周报助手');assert.ok(key.calls_24h>=2&&key.peak_rpm>=1&&Number(key.tokens_24h)>0,'keys carry 24h load');assert.ok(team.models.some(m=>m.calls_24h>0&&m.peak_rpm>=1),'models carry 24h load');
    const a=await boss.j.call('/api/employee-credit/team/analytics?range=24h');assert.equal(a.status,200);assert.equal(a.data.minutes,1440);assert.ok(a.data.buckets.length>0&&a.data.models.length>0&&a.data.peak.peak_rpm>=1);
    assert.equal((await boss.j.call('/api/employee-credit/team/analytics?range=evil')).data.range,'24h','unknown ranges fall back');assert.equal((await staffer.j.call('/api/employee-credit/team/analytics')).status,403);
    assert.ok((await staffer.j.call('/api/employee-credit/status')).data.keys.some(k=>k.calls_24h>=2));}
    assert.equal((await boss.j.call('/api/employee-credit/team/summaries',{method:'PUT',body:{enabled:false}})).status,200);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM employee_calls WHERE summary IS NOT NULL')).rows[0].n,0,'turning off deletes summaries');
   {const scoped=await staffer.j.call('/api/employee-credit/keys',{method:'POST',body:{label:'CLI',models:['deepseek-flash']}});assert.equal(scoped.status,201,JSON.stringify(scoped.data));assert.deepEqual(scoped.data.key.model_ids,['deepseek-flash']);
    const as=(secret,model,max=16)=>jar().call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+secret},body:{model,max_tokens:max,messages:[{role:'user',content:'hi'}]}});
    assert.equal((await as(scoped.data.secret,'deepseek-flash')).status,200);const other=await as(scoped.data.secret,'glm-5.3');assert.equal(other.status,403);assert.equal(other.data.error.code,'model_not_allowed');
    assert.deepEqual((await jar().call('/v1/models',{headers:{Authorization:'Bearer '+scoped.data.secret}})).data.data.map(m=>m.id),['deepseek-flash'],'scoped keys list only their models');
    assert.equal((await staffer.j.call('/api/employee-credit/keys',{method:'POST',body:{label:'Bad',models:['nope']}})).status,400);assert.equal((await staffer.j.call('/api/employee-credit/keys',{method:'POST',body:{label:'Bad',limit_yuan:'-1'}})).status,400);
    const capped=await staffer.j.call('/api/employee-credit/keys',{method:'POST',body:{label:'Capped',limit_yuan:'0.01'}});assert.equal(capped.status,201);const over=await as(capped.data.secret,'deepseek-flash',8192);assert.equal(over.status,402);assert.equal(over.data.error.code,'key_limit_reached');
    const listed=(await staffer.j.call('/api/employee-credit/status')).data.keys.find(k=>k.id===capped.data.key.id);assert.equal(Number(listed.limit_yuan),0.01);assert.ok(listed.used_yuan!==undefined);
    for(const k of [scoped,capped])await staffer.j.call('/api/employee-credit/keys/'+k.data.key.id+'/revoke',{method:'POST',body:{}});}
    {const standby=(await pool.query("INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by,priority) VALUES($1,'standby','https://kerapi.cn/v1',$2,'fp-standby','credit-fixture',2) RETURNING id",[supplier,vault(process.env.SUPPLIER_LAB_SECRET).seal({key:'fixture-standby-secret'})])).rows[0].id;
     await pool.query("INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,created_by,supplier_id,credential_id) VALUES('standby flash','supplier','https://kerapi.cn/v1','deepseek-v4.1-flash','fp-standby','credit-fixture',$1,$2)",[supplier,standby]);
     await pool.query('UPDATE supplier_lab_credentials SET priority=1 WHERE id=$1',[credential]);
     const seen=[];pilotFetch=async(url,options)=>{seen.push(options.headers.Authorization);return options.headers.Authorization==='Bearer fixture-kerapi-secret'?new Response('{"error":{"message":"bad key"}}',{status:401}):new Response(JSON.stringify({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:5,completion_tokens:1}}),{status:200,headers:{'content-type':'application/json'}});};
     const r=await jar().call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+created.data.secret},body:{model:'deepseek-flash',max_tokens:16,messages:[{role:'user',content:'hi'}]}});assert.equal(r.status,200,JSON.stringify(r.data));
     assert.deepEqual(seen,['Bearer fixture-kerapi-secret','Bearer fixture-standby-secret'],'a primary 401 falls over to the standby key');
     assert.equal((await pool.query('SELECT credential_id FROM employee_calls WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1',[staffer.user.id])).rows[0].credential_id,standby,'the call is recorded against the key that answered');
     // Owner decision 2026-11-12 (docs/14-gateway-settings.md F4): KerAPI rate-limited (429) or failing (5xx) before any
     // output also moves to the next line; a request error (400) does not; when every line is rate-limited the caller
     // gets upstream_rate_limited, which is not its own quota.
     {const before=pilotFetch;await pool.query('DELETE FROM request_limits');await pool.query('UPDATE employee_credit_accounts SET granted_yuan=granted_yuan+5 WHERE user_id=$1',[staffer.user.id]);
      const primary='Bearer fixture-kerapi-secret',backup='Bearer fixture-standby-secret',ok=()=>new Response(JSON.stringify({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:5,completion_tokens:1}}),{status:200,headers:{'content-type':'application/json'}});
      const flash=()=>jar().call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+created.data.secret},body:{model:'deepseek-flash',max_tokens:16,messages:[{role:'user',content:'hi'}]}});
      for(const code of [429,500,503]){seen.length=0;pilotFetch=async(_u,o)=>{seen.push(o.headers.Authorization);return o.headers.Authorization===primary?new Response('{"error":{"message":"busy"}}',{status:code}):ok();};
       const r=await flash();assert.equal(r.status,200,code+' '+JSON.stringify(r.data));assert.deepEqual(seen,[primary,backup],code+' moves to the standby');}
      seen.length=0;pilotFetch=async(_u,o)=>{seen.push(o.headers.Authorization);return new Response('{"error":{"message":"bad request"}}',{status:400});};
      {const r=await flash();assert.equal(r.status,400);assert.deepEqual(seen,[primary],'a request error is not retried elsewhere');}
      seen.length=0;pilotFetch=async(_u,o)=>{seen.push(o.headers.Authorization);return new Response('{"error":{"message":"TPM exceeded"}}',{status:429,headers:{'retry-after':'7'}});};
      {const r=await flash();assert.equal(r.status,429);assert.equal(r.data.error.code,'upstream_rate_limited');assert.match(r.data.error.message,/不是你的额度问题.*TPM exceeded/);assert.equal(r.headers.get('retry-after'),'7');assert.deepEqual(seen,[primary,backup]);
       assert.equal((await pool.query('SELECT status,error_code,charged_yuan FROM employee_calls WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1',[staffer.user.id])).rows[0].error_code,'UPSTREAM_HTTP_429');}
      pilotFetch=async()=>new Response('{}',{status:503});
      {const r=await flash();assert.equal(r.status,502,'every line failing is still an upstream error');}
      // A key registered a second time (same fingerprint) is not a standby and is never tried.
      const dup=(await pool.query("INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by,priority) VALUES($1,'same key','https://kerapi.cn',$2,'fp','credit-fixture',2) RETURNING id",[supplier,vault(process.env.SUPPLIER_LAB_SECRET).seal({key:'fixture-kerapi-secret-again'})])).rows[0].id;
      await pool.query("INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,created_by,supplier_id,credential_id) VALUES('dup flash','supplier','https://kerapi.cn','deepseek-v4.1-flash','fp','credit-fixture',$1,$2)",[supplier,dup]);
      seen.length=0;pilotFetch=async(_u,o)=>{seen.push(o.headers.Authorization);return new Response('{}',{status:429});};
      {const r=await flash();assert.equal(r.status,429);assert.deepEqual(seen,[primary,backup],'the duplicate is skipped');}
      await pool.query('DELETE FROM supplier_lab_endpoints WHERE credential_id=$1',[dup]);await pool.query('DELETE FROM supplier_lab_credentials WHERE id=$1',[dup]);
      // An official standby key (docs/14-gateway-settings.md F5): its own key, mapped model by model, tried after KerAPI.
      {const savedIdentity=identity;identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};const ops=jar();await staffLogin(ops);identity=savedIdentity;
       const add=body=>ops.call('/api/staff/lab/standby-keys',{method:'POST',body}),official=[];
       pilotFetch=async(url,o)=>{const u=String(url);
        if(u==='https://api.deepseek.com/models')return new Response(JSON.stringify({data:[{id:'deepseek-chat'},{id:'deepseek-reasoner'}]}),{status:200});
        if(u.startsWith('https://api.deepseek.com/')){official.push(JSON.parse(o.body));return officialReply();}
        seen.push(o.headers.Authorization);return new Response('{}',{status:503});};
       let officialReply=ok;
       assert.equal((await add({vendor:'zai',api_key:'sk-x',models:{'glm-5.3':'glm-5.3'}})).status,400,'mainland vendors only');
       assert.equal((await add({vendor:'deepseek',api_key:'sk-ds-standby',models:{}})).status,400,'at least one model');
       assert.equal((await add({vendor:'deepseek',api_key:'sk-ds-standby',models:{'glm-5.3':'deepseek-chat'}})).status,400,'only models of that vendor');
       {const r=await add({vendor:'deepseek',api_key:'sk-ds-standby',models:{'deepseek-flash':'deepseek-v9'}});assert.equal(r.status,400);assert.match(r.data.error,/官方型号列表里没有 deepseek-v9.*deepseek-chat/);}
       await pool.query("INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by) VALUES($1,'评测专用 fixture','https://api.deepseek.com',$2,$3,'credit-fixture')",[supplier,vault(process.env.SUPPLIER_LAB_SECRET).seal({key:'sk-ds-eval'}),hash('sk-ds-eval').slice(0,12)]);
       {const r=await add({vendor:'deepseek',api_key:'sk-ds-eval',models:{'deepseek-flash':'deepseek-chat'}});assert.equal(r.status,409);assert.match(r.data.error,/这是评测 Key/);}
       await pool.query("DELETE FROM supplier_lab_credentials WHERE label='评测专用 fixture'");
       const sb=await add({vendor:'deepseek',api_key:'sk-ds-standby',models:{'deepseek-flash':'DeepSeek-Chat'}});assert.equal(sb.status,201,JSON.stringify(sb.data));assert.deepEqual(sb.data.models,{'deepseek-flash':'deepseek-chat'},'matched to the vendor list without regard to case');
       {const v=(await ops.call('/api/staff/lab/eval-keys')).data,ds=v.vendors.find(x=>x.id==='deepseek');assert.equal(ds.standby.key.id,sb.data.credential_id);assert.deepEqual(ds.standby.key.standby_models,{'deepseek-flash':'deepseek-chat'});assert.notEqual(ds.key?.id,sb.data.credential_id,'not listed as an evaluation key');assert.equal(v.vendors.find(x=>x.id==='zai').standby,null);}
       // Every KerAPI line fails: the call goes to the official line with the official model name, at the official price.
       seen.length=0;
       {const r=await flash();assert.equal(r.status,200,JSON.stringify(r.data));assert.deepEqual(seen,[primary,backup],'KerAPI lines first');assert.equal(official.at(-1).model,'deepseek-chat');
        const c=(await pool.query('SELECT credential_id,status,settlement_source FROM employee_calls WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1',[staffer.user.id])).rows[0];assert.deepEqual(c,{credential_id:sb.data.credential_id,status:'settled',settlement_source:'official_price'});}
       // No usage from the official line: nothing to check it against later, so it is free.
       officialReply=()=>new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{status:200,headers:{'content-type':'application/json'}});
       {const r=await flash();assert.equal(r.status,200);const c=(await pool.query('SELECT status,charged_yuan,settlement_source FROM employee_calls WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1',[staffer.user.id])).rows[0];assert.deepEqual([c.status,Number(c.charged_yuan),c.settlement_source],['settled',0,'official_unmetered']);
        // Re-running every migration with this row present must not narrow the CHECK back to an older list.
        await migrate(pool,service.auth);assert.match((await pool.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='employee_calls_settlement_source_check'")).rows[0].d,/official_unmetered/);}
       // GLM has no mapping, so it gets no official line.
       {const before=official.length;const r=await call();assert.equal(r.status,502);assert.equal(official.length,before);}
       const replaced=await add({vendor:'deepseek',api_key:'sk-ds-standby-2',models:{'deepseek-flash':'deepseek-chat'}});assert.equal(replaced.status,201);assert.deepEqual(replaced.data.replaced,[sb.data.label],'one standby per vendor');
       assert.equal((await ops.call(`/api/staff/lab/standby-keys/${replaced.data.credential_id}/disable`,{method:'POST',body:{}})).status,200);
       assert.equal((await ops.call(`/api/staff/lab/standby-keys/${replaced.data.credential_id}/disable`,{method:'POST',body:{}})).status,404);
       {const before=official.length;assert.equal((await flash()).status,502,'disabled: KerAPI failures reach the caller again');assert.equal(official.length,before);}
       assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='gateway.standby_key_added'")).rows[0].n,2);}
      pilotFetch=before;await pool.query('DELETE FROM request_limits');}
     const savedIdentity=identity;identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};const ops=jar();await staffLogin(ops);identity=savedIdentity;
     const ov=await ops.call('/api/staff/lab/overview');assert.equal(ov.status,200,JSON.stringify(ov.data));assert.ok(ov.data.credentials.some(c=>c.id===credential&&c.failed_24h>=1));assert.ok(ov.data.models.some(m=>m.id==='deepseek-flash'&&m.routed&&m.fallbacks.length>=1));assert.ok(Array.isArray(ov.data.risks));
     assert.equal((await ops.call('/api/staff/lab/credentials/'+standby+'/priority',{method:'POST',body:{role:'primary'}})).status,200);assert.equal((await pool.query('SELECT priority FROM supplier_lab_credentials WHERE id=$1',[credential])).rows[0].priority,2,'the old primary becomes standby');
     assert.equal((await ops.call('/api/staff/lab/credentials/'+standby+'/priority',{method:'POST',body:{role:'boss'}})).status,400);assert.equal((await staffer.j.call('/api/staff/lab/overview')).status,401);
     {const wb=(body)=>jar().call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+created.data.secret,'User-Agent':'WorkBuddy/1.2'},body:{model:'deepseek-flash',messages:[{role:'system',content:'secret project notes'},{role:'user',content:'private question'}],...body}});
      assert.equal((await wb({max_tokens:16,tools:[{type:'function',function:{name:'read_file',parameters:{type:'object'}}}]})).status,200);
      assert.equal((await wb({max_tokens:65536})).status,400,'over the output cap is rejected by the gateway');
      await new Promise(r=>setTimeout(r,100));
      const profiles=(await pool.query("SELECT * FROM acceptance_profiles WHERE client='WorkBuddy'")).rows;
      assert.ok(profiles.some(p=>p.features.includes('tools')&&p.shape.tool_names.includes('read_file')),'tool formats are learned from real calls');
      assert.ok(profiles.some(p=>p.features.includes('out_32k')&&p.rejected_count===1&&p.last_error.includes('max_tokens')),'gateway rejections are recorded against the format');
      assert.ok(!JSON.stringify(profiles).includes('private question')&&!JSON.stringify(profiles).includes('secret project notes'),'no conversation text is stored');
      assert.ok(profiles.map(p=>p.signature).includes((await pool.query('SELECT profile_signature FROM employee_calls WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1',[staffer.user.id])).rows[0].profile_signature));
      const matrix=await ops.call('/api/staff/lab/acceptance');assert.equal(matrix.status,200,JSON.stringify(matrix.data));assert.equal(matrix.data.features.length,16);assert.ok(matrix.data.profiles.some(p=>p.synthetic)&&matrix.data.profiles.some(p=>p.client==='WorkBuddy'));
      assert.equal((await staffer.j.call('/api/staff/lab/acceptance')).status,401);
      const started=await ops.call('/api/staff/lab/acceptance/replay',{method:'POST',body:{model_id:'deepseek-flash'}});assert.equal(started.status,202,JSON.stringify(started.data));
      let run;for(let i=0;i<50;i++){run=(await ops.call('/api/staff/lab/acceptance')).data;if(run.run.finished_at)break;await new Promise(r=>setTimeout(r,40));}
      assert.ok(run.run.finished_at,'replay finishes');const cell=f=>run.profiles.find(p=>p.signature==='synthetic:'+f).results['deepseek-flash'];
      assert.equal(cell('basic').status,'pass');assert.equal(cell('out_32k').status,'pass','32K output now passes through');assert.equal(cell('thinking_on').status,'partial');
      const detail=await ops.call('/api/staff/lab/acceptance/profiles/synthetic:basic');assert.equal(detail.status,200);assert.ok(detail.data.history.length>=1);}
     await pool.query('UPDATE supplier_lab_credentials SET disabled_at=now() WHERE id=$1',[standby]);}

 {// Agent 检测：在员工 Key 上开录制会话、按功能打标，再把录到的请求回放到指定 Key；网关拒绝的也记下来
  const savedIdentity=identity;identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};const ops=jar();await staffLogin(ops);identity=savedIdentity;
  const saved=pilotFetch;const reply=()=>new Response(JSON.stringify({choices:[{message:{content:'收到'}}],usage:{prompt_tokens:5,completion_tokens:1}}),{status:200,headers:{'content-type':'application/json'}});
  pilotFetch=async()=>reply();
  const wb=(body,key=created.data.secret)=>jar().call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'user-agent':'WorkBuddy/5.9.3 WorkBuddy/5.9.3 CLI/2.165.0'},body:{...glmBody,...body}});
  const settle=()=>new Promise(r=>setTimeout(r,700));
  try{
   const agent=await ops.call('/api/staff/lab/agents',{method:'POST',body:{name:'WorkBuddy',version:'5.9.0'}});assert.equal(agent.status,201,JSON.stringify(agent.data));const aid=agent.data.id;
   assert.equal((await ops.call('/api/staff/lab/agents/keys?q=ag')).status,400,'query too short');
   const found=(await ops.call('/api/staff/lab/agents/keys?q=agent')).data.keys;assert.ok(found.some(k=>k.id===created.data.key.id),'employee key found by label');
   const session=await ops.call(`/api/staff/lab/agents/${aid}/sessions`,{method:'POST',body:{key_id:created.data.key.id}});assert.equal(session.status,201,JSON.stringify(session.data));const sid=session.data.id;
   assert.equal((await ops.call(`/api/staff/lab/agents/sessions/${sid}/arm`,{method:'POST',body:{feature:'nope'}})).status,400);
   assert.equal((await wb({tools:[{type:'function',function:{name:'read_file',parameters:{type:'object'}}}]})).status,200,'call before arming is not recorded');
   assert.equal((await ops.call(`/api/staff/lab/agents/sessions/${sid}/arm`,{method:'POST',body:{feature:'tools'}})).status,200);
   assert.equal((await wb({tools:[{type:'function',function:{name:'read_file',parameters:{type:'object'}}}]})).status,200);await settle();
   assert.equal((await ops.call(`/api/staff/lab/agents/sessions/${sid}/arm`,{method:'POST',body:{feature:'out_32k'}})).status,200);
   assert.equal((await wb({max_tokens:65536})).status,400,'gateway rejects 64K output');await settle();
   assert.equal((await ops.call(`/api/staff/lab/agents/sessions/${sid}/arm`,{method:'POST',body:{feature:null}})).status,200);
   assert.equal((await wb({})).status,200);await settle();
   let v=(await ops.call('/api/staff/lab/agents?agent='+aid)).data;const a=v.agents.find(x=>x.id===aid);
   assert.equal(a.recorded_features,2,'only armed calls are recorded');assert.equal(a.detected_version,'5.9.3','version read from the agent user agent');
   const tools=v.recordings.find(r=>r.feature==='tools'),big=v.recordings.find(r=>r.feature==='out_32k');
   assert.equal(tools.count,1);assert.equal(tools.tool_count,1);assert.equal(tools.missing_feature,false);assert.ok(tools.seen_features.includes('tools'));
   assert.equal(big.rejected,true);assert.match(big.last_error,/max_tokens/);assert.equal(v.session.id,sid);
   assert.equal((await ops.call(`/api/staff/lab/agents/sessions/${sid}/close`,{method:'POST',body:{}})).status,200);
   assert.equal((await ops.call(`/api/staff/lab/agents/${aid}/replay`,{method:'POST',body:{targets:[{kind:'ours',model_id:'glm-5.3',credential_id:'00000000-0000-4000-8000-000000000000'}]}})).status,400,'unknown key refused');
   assert.equal((await ops.call(`/api/staff/lab/agents/${aid}/replay`,{method:'POST',body:{targets:[{kind:'official',endpoint_id:'00000000-0000-4000-8000-000000000000'}]}})).status,400,'unknown official endpoint refused');
   const started=await ops.call(`/api/staff/lab/agents/${aid}/replay`,{method:'POST',body:{targets:[{kind:'ours',model_id:'glm-5.3'},{kind:'ours',model_id:'deepseek-flash'}]}});assert.equal(started.status,202,JSON.stringify(started.data));assert.equal(started.data.run.total,4);
   for(let i=0;i<100;i++){v=(await ops.call('/api/staff/lab/agents?agent='+aid)).data;if(v.run?.finished_at)break;await new Promise(r=>setTimeout(r,40));}
   assert.ok(v.run.finished_at);assert.equal(v.replays.length,4);
   const t=v.replays.find(r=>r.feature==='tools'&&r.target.startsWith('ours:glm-5.3:')),o=v.replays.find(r=>r.feature==='out_32k'&&r.target.startsWith('ours:glm-5.3:'));
   assert.equal(t.status,'pass');assert.equal(o.status,'fail');assert.match(o.note,/网关拒绝/);assert.equal(v.targets.models.find(m=>m.id==='glm-5.3').keys[0].role,'primary');
   assert.equal((await staffer.j.call('/api/staff/lab/agents')).status,401);
   // formats learned from real WorkBuddy 5.9.3 traffic: offered for one-click add, imported as recordings
   v=(await ops.call('/api/staff/lab/agents')).data;const seen=v.seen.find(x=>x.name==='WorkBuddy'&&x.version==='5.9.3');assert.ok(seen&&seen.formats>=1,'WorkBuddy 5.9.3 seen in real calls');
   const wb593=(await ops.call('/api/staff/lab/agents',{method:'POST',body:{name:'WorkBuddy',version:'5.9.3'}})).data;
   const im=await ops.call(`/api/staff/lab/agents/${wb593.id}/import-learned`,{method:'POST',body:{}});assert.equal(im.status,200);assert.ok(im.data.added>=1&&im.data.formats>=1);
   const again=await ops.call(`/api/staff/lab/agents/${wb593.id}/import-learned`,{method:'POST',body:{}});assert.equal(again.data.added,0,'import is idempotent');
   v=(await ops.call('/api/staff/lab/agents?agent='+wb593.id)).data;assert.ok(v.recordings.length>=1&&v.recordings.every(r=>r.source==='learned'));assert.ok(v.recordings.some(r=>r.feature==='tools'));assert.equal(v.agents.find(x=>x.id===wb593.id).learned_new,0);
   assert.ok(!v.seen.some(x=>x.name==='WorkBuddy'&&x.version==='5.9.3'),'no longer offered once registered');
  }finally{pilotFetch=saved;}}

 {// Agent 对比：评测 Key 走网关但不计员工额度，记完整对话；按任务打标；B 路手贴；盲评两次换位；人工盲投
  const savedIdentity=identity;identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};const ops=jar();await staffLogin(ops);identity=savedIdentity;
  const savedHosts=process.env.SUPPLIER_LAB_ALLOWED_HOSTS;process.env.SUPPLIER_LAB_ALLOWED_HOSTS='api.deepseek.com,kerapi.cn';
  const saved=pilotFetch;const reply=c=>new Response(JSON.stringify({choices:[{message:{content:c}}],usage:{prompt_tokens:7,completion_tokens:3}}),{status:200,headers:{'content-type':'application/json'}});
  pilotFetch=async(url,options)=>{const b=JSON.parse(options.body);
   if(String(b.messages?.[0]?.content||'').includes('评审')){const aPart=b.messages[1].content.split('【回答 A】')[1].split('【回答 B】')[0];return reply(aPart.includes('SELECT user_id')?'{"a":8,"b":5,"winner":"A","reason":"A 正确"}':'{"a":5,"b":8,"winner":"B","reason":"B 正确"}');}
   if(b.stream)return new Response('data: {"choices":[{"delta":{"content":"SELECT user_id, count(*) FROM orders GROUP BY 1"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":12}}\n\ndata: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
   return reply('先看表结构');};
  try{
   const agent=await ops.call('/api/staff/lab/agents',{method:'POST',body:{name:'WorkBuddy',version:'5.9.1'}});const aid=agent.data.id;
   const judge=(await pool.query("SELECT e.id FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id WHERE e.model_id='GLM-5.3' AND e.disabled_at IS NULL AND c.disabled_at IS NULL LIMIT 1")).rows[0].id;
   assert.equal((await ops.call('/api/staff/lab/agent-compare/runs',{method:'POST',body:{agent_id:aid,path_b:{kind:'official',endpoint_id:judge}}})).status,400,'B must be an official reference model');
   const created=await ops.call('/api/staff/lab/agent-compare/runs',{method:'POST',body:{agent_id:aid,path_b:{kind:'manual'},judge_endpoint_id:judge,task_ids:['sql','doc']}});assert.equal(created.status,201,JSON.stringify(created.data));
   const rid=created.data.run.id,keyA=created.data.keys.a.secret;assert.match(keyA,/^sf_eval_/);assert.equal(created.data.keys.b,null);
   const gw=(body,key=keyA)=>jar().call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key},body:{model:'glm-5.3',messages:[{role:'user',content:'写 SQL'}],max_tokens:100,...body}});
   const employeeCallsBefore=(await pool.query('SELECT count(*)::int AS n FROM employee_calls')).rows[0].n;
   assert.equal((await gw({},'sf_eval_'+'x'.repeat(43))).status,401);
   assert.equal((await gw({})).status,200,'test key works before arming');
   assert.equal((await ops.call(`/api/staff/lab/agent-compare/runs/${rid}/arm`,{method:'POST',body:{path:'c',task_id:'sql'}})).status,400);
   assert.equal((await ops.call(`/api/staff/lab/agent-compare/runs/${rid}/arm`,{method:'POST',body:{path:'a',task_id:'sql'}})).status,200);
   assert.equal((await gw({})).status,200);const streamed=await gw({stream:true});assert.equal(streamed.status,200);await new Promise(r=>setTimeout(r,200));
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM employee_calls')).rows[0].n,employeeCallsBefore,'test keys bill no employee');
   let v=(await ops.call('/api/staff/lab/agent-compare?run='+rid)).data;assert.equal(v.detail.calls.find(c=>c.path==='a'&&c.task_id==='sql').calls,2);assert.equal(v.detail.calls.find(c=>c.path==='a'&&c.task_id===null).calls,1);
   assert.equal((await ops.call(`/api/staff/lab/agent-compare/runs/${rid}/tasks/doc/finish`,{method:'POST',body:{path:'a'}})).status,409,'no calls for that task yet');
   const fin=await ops.call(`/api/staff/lab/agent-compare/runs/${rid}/tasks/sql/finish`,{method:'POST',body:{path:'a'}});assert.equal(fin.status,200,JSON.stringify(fin.data));
   assert.equal(fin.data.side.turns,2);assert.match(fin.data.side.output,/^SELECT user_id/,'final answer is the last call with text');assert.equal(fin.data.side.output_tokens,15);
   assert.equal((await ops.call(`/api/staff/lab/agent-compare/runs/${rid}/tasks/sql/manual`,{method:'POST',body:{output:'select * from orders'}})).status,200);
   let item;for(let i=0;i<100;i++){v=(await ops.call('/api/staff/lab/agent-compare?run='+rid)).data;item=v.detail.items.find(x=>x.task_id==='sql');if(item?.judge)break;await new Promise(r=>setTimeout(r,30));}
   assert.equal(item.judge.error,undefined,JSON.stringify(item.judge));assert.equal(item.judge.winner,'supplier','ours wins in both orders');assert.equal(item.judge.positions_agree,true);assert.equal(v.detail.summary.judge.a_wins,1);assert.equal(v.detail.summary.verdict,'match');assert.equal(v.detail.run.armed_path,null,'finishing disarms');
   const pick=item.blind_flip?'B':'A';const vote=await ops.call('/api/staff/lab/agent-compare/items/'+item.id+'/review',{method:'POST',body:{choice:pick}});assert.equal(vote.data.verdict,'a');assert.equal(vote.data.judge,'a');
   v=(await ops.call('/api/staff/lab/agent-compare?run='+rid)).data;assert.equal(v.detail.summary.human.agree_with_judge,1);
   const rotated=await ops.call(`/api/staff/lab/agent-compare/runs/${rid}/keys/a/rotate`,{method:'POST',body:{}});assert.equal(rotated.status,201);assert.equal((await gw({})).status,401,'old key revoked');assert.equal((await gw({},rotated.data.secret)).status,200);
   assert.equal((await ops.call(`/api/staff/lab/agent-compare/runs/${rid}/close`,{method:'POST',body:{}})).status,200);assert.equal((await gw({},rotated.data.secret)).status,401,'keys die with the run');
   assert.equal((await staffer.j.call('/api/staff/lab/agent-compare')).status,401);
  }finally{pilotFetch=saved;if(savedHosts===undefined)delete process.env.SUPPLIER_LAB_ALLOWED_HOSTS;else process.env.SUPPLIER_LAB_ALLOWED_HOSTS=savedHosts;}}
    pilotFetch=saved;}
 // A manager can raise one key's concurrency and per-minute limits; everything else keeps the defaults.
 {const kid=created.data.key.id,limits=(who,body)=>who.j.call(`/api/employee-credit/team/keys/${kid}/limits`,{method:'POST',body});
  assert.equal((await limits(outsider,{max_concurrent:8})).status,403);
  for(const body of [{max_concurrent:0},{max_concurrent:65},{max_concurrent:'2.5'},{per_minute:1201},{per_minute:'abc'}])assert.equal((await limits(boss,body)).status,400,JSON.stringify(body));
  assert.equal((await boss.j.call('/api/employee-credit/team/keys/00000000-0000-4000-8000-000000000000/limits',{method:'POST',body:{max_concurrent:8}})).status,404);
  await pool.query('DELETE FROM request_limits');
  // Ten calls in flight for this owner: the seat default (items 5–6) stops the eleventh.
  const inFlight=(await pool.query(`INSERT INTO employee_calls(key_id,owner_id,model_id,credential_id,upstream,price_snapshot,status,hold_yuan,client,client_detail,profile_signature)
   SELECT key_id,owner_id,model_id,credential_id,upstream,price_snapshot,'pending',0,client,client_detail,profile_signature FROM employee_calls c,generate_series(1,10) WHERE c.id=(SELECT id FROM employee_calls WHERE key_id=$1 LIMIT 1) RETURNING id`,[kid])).rows.map(r=>r.id);
  assert.equal(inFlight.length,10);
  {const blocked=await call();assert.equal(blocked.status,429);assert.equal(blocked.data.error.code,'concurrency_limit_exceeded');assert.match(blocked.data.error.message,/同时最多 10 个请求/);}
  const beforeLimits=pilotFetch;usage={prompt_tokens:1,completion_tokens:1};pilotFetch=async()=>reply();
  await pool.query('UPDATE employee_credit_accounts SET granted_yuan=granted_yuan+5 WHERE user_id=$1',[staffer.user.id]); // the checks above left the account nearly spent
  const raised=await limits(boss,{max_concurrent:12,per_minute:3});assert.equal(raised.status,200,JSON.stringify(raised.data));
  assert.deepEqual(raised.data,{key:{id:kid,max_concurrent:12,per_minute:3},defaults:{max_concurrent:10,per_minute:60}});
  for(let n=0;n<2;n++){const ok=await call();assert.equal(ok.status,200,JSON.stringify(ok.data));}
  {const fast=await call();assert.equal(fast.status,429);assert.equal(fast.data.error.code,'rate_limit_exceeded');assert.match(fast.data.error.message,/每分钟最多 3 次/);}
  {const row=(await boss.j.call('/api/employee-credit/team')).data.keys.find(k=>k.id===kid);assert.deepEqual([row.max_concurrent,row.per_minute],[12,3]);
   const own=(await staffer.j.call('/api/employee-credit/status')).data.keys.find(k=>k.id===kid);assert.deepEqual([own.max_concurrent,own.per_minute],[12,3]);}
  // Empty values put the key back on the defaults, and the change is on the audit trail.
  assert.deepEqual((await limits(boss,{max_concurrent:'',per_minute:null})).data.key,{id:kid,max_concurrent:null,per_minute:null});
  await pool.query('DELETE FROM request_limits');
  assert.equal((await call()).status,429,'back to ten at once');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='employee_credit.key_limits_set' AND subject_id=$1",[kid])).rows[0].n,2);
  pilotFetch=beforeLimits;
  await pool.query('DELETE FROM employee_calls WHERE id=ANY($1)',[inFlight]);await pool.query('DELETE FROM request_limits');}
 // Company-wide gate and per-organization limits (docs/14-gateway-settings.md C6/C10).
 {const savedIdentity=identity;identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};const ops=jar();await staffLogin(ops);identity=savedIdentity;
  const limits=(body)=>ops.call('/api/staff/lab/gateway-limits',{method:'POST',body}),orgLimits=(org,body)=>ops.call('/api/staff/lab/gateway-limits/organizations/'+org,{method:'POST',body});
  await pool.query('DELETE FROM request_limits');await pool.query('UPDATE employee_credit_accounts SET granted_yuan=granted_yuan+5 WHERE user_id=$1',[staffer.user.id]);
  await pool.query('UPDATE organizations SET tpm=NULL WHERE id=$1',[company.id]);
  let v=(await ops.call('/api/staff/lab/gateway-limits')).data;
  assert.deepEqual([v.settings.max_concurrent,v.settings.tpm,v.settings.org_max_concurrent,v.settings.org_tpm],[50,15000000,10,2000000],'decided defaults');
  assert.deepEqual(v.seat,{max_concurrent:10,tpm:3000000},'person seat defaults (items 5–6)');
  const mine=v.organizations.find(o=>o.id===company.id);assert.deepEqual(mine.effective,{max_concurrent:10,tpm:2000000},'an organization nobody set uses the defaults');
  assert.equal((await staffer.j.call('/api/staff/lab/gateway-limits')).status,401,'staff only');
  for(const body of [{max_concurrent:0,tpm:15000000,org_max_concurrent:10,org_tpm:2000000},{max_concurrent:50,tpm:999,org_max_concurrent:10,org_tpm:2000000},{max_concurrent:50,tpm:15000000,org_max_concurrent:'2.5',org_tpm:2000000}])assert.equal((await limits(body)).status,400,JSON.stringify(body));
  assert.equal((await orgLimits('00000000-0000-4000-8000-000000000000',{max_concurrent:5})).status,404);
  assert.equal((await orgLimits(company.id,{max_concurrent:1001})).status,400);
  // A per-organization token limit refuses a request larger than what is left, before anything reaches KerAPI.
  const set=await orgLimits(company.id,{max_concurrent:'',tpm:1000});assert.equal(set.status,200,JSON.stringify(set.data));
  assert.deepEqual(set.data.organizations.find(o=>o.id===company.id).effective,{max_concurrent:10,tpm:1000});
  const sent=upstreamCalls.length;
  {const big=await call({messages:[{role:'user',content:'x'.repeat(5000)}]});assert.equal(big.status,429);assert.equal(big.data.error.code,'organization_limit_exceeded');assert.match(big.data.error.message,/上限 1000（输入加输出，含缓存命中）/);assert.ok(Number(big.headers.get('retry-after'))>=1);}
  assert.equal(upstreamCalls.length,sent,'refused before the upstream');
  // Back to a high token limit: the faked 5-million-token calls above are still inside the last minute.
  assert.equal((await orgLimits(company.id,{max_concurrent:null,tpm:1000000000})).status,200);
  // The company-wide gate: with room for one request, a second waits for the first to finish.
  assert.equal((await limits({max_concurrent:1,tpm:15000000,org_max_concurrent:10,org_tpm:2000000})).status,200);
  const saved=pilotFetch;let open;const held=new Promise(r=>{open=r;});pilotFetch=async(url,options)=>{upstreamCalls.push({url,options});await held;return reply();};
  try{
   const first=call();
   for(let i=0;i<100&&upstreamCalls.length===sent;i++)await new Promise(r=>setTimeout(r,10));
   v=(await ops.call('/api/staff/lab/gateway-limits')).data;assert.equal(v.live.active,1);assert.equal(v.organizations.find(o=>o.id===company.id).active,1);
   const busy=await call();assert.equal(busy.status,429);assert.equal(busy.data.error.code,'gateway_busy');assert.match(busy.data.error.message,/全平台同时进行的请求已达 1 个上限/);assert.equal(busy.headers.get('retry-after'),'5');
   open();assert.equal((await first).status,200);
   const after=await call();assert.equal(after.status,200,'the slot is free again once the response closes');
  }finally{pilotFetch=saved;}
  v=(await ops.call('/api/staff/lab/gateway-limits')).data;assert.equal(v.live.active,0);assert.ok(v.live.tpm>0,'completed calls count their real tokens');
  // Gateway-own 429s are counted daily so defaults can be checked against reality (items 5–6).
  const rej=(await ops.call('/api/staff/lab/gateway-rejections?days=1')).data;
  assert.deepEqual(rej.seat,{max_concurrent:10,tpm:3000000});
  assert.ok(rej.totals.some(r=>r.code==='organization_limit_exceeded'&&r.layer==='organization'&&r.count>=1));
  assert.ok(rej.totals.some(r=>r.code==='gateway_busy'&&r.layer==='company'&&r.count>=1));
  assert.equal((await staffer.j.call('/api/staff/lab/gateway-rejections')).status,401);
  assert.equal((await limits({max_concurrent:50,tpm:15000000,org_max_concurrent:10,org_tpm:2000000})).status,200);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='gateway.limits_set'")).rows[0].n,2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='gateway.organization_limits_set' AND organization_id=$1",[company.id])).rows[0].n,2);
  // The migration sets our own company to 30 at once and 4 million tokens once; a later staff change is never overwritten.
  const migration=await readFile(new URL('../migrations/053_gateway_limits.sql',import.meta.url),'utf8');
  await pool.query('UPDATE organizations SET max_concurrent=NULL,tpm=NULL,limits_updated_at=NULL WHERE id=$1',[company.id]);await pool.query(migration);
  assert.deepEqual((await pool.query('SELECT max_concurrent,tpm::int FROM organizations WHERE id=$1',[company.id])).rows[0],{max_concurrent:30,tpm:4000000});
  await orgLimits(company.id,{max_concurrent:null,tpm:null});await pool.query(migration);
  assert.deepEqual((await pool.query('SELECT max_concurrent,tpm FROM organizations WHERE id=$1',[company.id])).rows[0],{max_concurrent:null,tpm:null});
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM organizations WHERE max_concurrent IS NOT NULL AND id<>$1',[company.id])).rows[0].n,0,'other organizations keep the defaults');
  await pool.query('DELETE FROM request_limits');}
 assert.equal((await staffer.j.call('/api/employee-credit/keys/'+created.data.key.id+'/revoke',{method:'POST',body:{}})).status,200);assert.equal((await call()).status,401);
 appCfg.employeeCredit.organizationId='';
});
test('official price watch is technical-staff only, compares fixtures, never writes the catalog',async()=>{
 assert.equal((await jar().call('/api/staff/lab/official-prices')).status,401);
 const savedIdentity=identity;identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};const ops=jar();await staffLogin(ops);identity=savedIdentity;
 const empty=await ops.call('/api/staff/lab/official-prices');assert.equal(empty.status,200,JSON.stringify(empty.data));
 assert.ok(String(empty.data.note).includes('不自动改价'));assert.ok(empty.data.holidays.years.some(y=>y.year===2026));
 assert.ok(empty.data.catalog.some(m=>m.id==='deepseek-flash'&&m.rates.input==='1'));
 const deepseekHtml=`<html><body>百万tokens输入 （缓存命中） 空闲时段 0.02元 0.15元 百万tokens输入 （缓存未命中） 空闲时段 1元 4.5元 百万tokens输出 空闲时段 4元 13.5元 北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。</body></html>`;
 const glmHtml=`<html><body>| GLM-5.3 | 1M | 8 | 28 | 限时免费 | 2 |\n| GLM-5.3-Flash | 1M | 0.8 | 2.8 | 限时免费 | 0.23 |\n| GLM-5.3-FlashX | 1M | 2 | 7 | 限时免费 | 0.57 |</body></html>`;
 const savedFetch=pilotFetch;
 pilotFetch=async(url)=>{const body=String(url).includes('deepseek')?deepseekHtml:glmHtml;return {ok:true,status:200,text:async()=>body};};
 try{
  const run=await ops.call('/api/staff/lab/official-prices',{method:'POST',body:{}});
  assert.equal(run.status,200,JSON.stringify(run.data));assert.ok(run.data.match>=5,JSON.stringify(run.data));assert.equal(run.data.price_diff,0);assert.equal(run.data.fetch_failed,0);
  const view=await ops.call('/api/staff/lab/official-prices');assert.equal(view.status,200);assert.ok(view.data.last_run);assert.equal(view.data.sources.length,2);
  assert.ok(view.data.sources.every(s=>['match','page_changed'].includes(s.status)));
  assert.equal(findOfficialModel('deepseek-flash').rates.input,'1');
 }finally{pilotFetch=savedFetch;}
});

test('cloud cost and capacity page reads real gateway calls, is technical-staff only and never echoes secrets',async()=>{
 assert.equal((await jar().call('/api/staff/capacity')).status,401);
 const savedIdentity=identity;identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};const ops=jar();await staffLogin(ops);identity=savedIdentity;
 const r=await ops.call('/api/staff/capacity?days=7');assert.equal(r.status,200,JSON.stringify(r.data));
 const calls=(await pool.query("SELECT count(*)::int AS n FROM employee_calls WHERE created_at>=now()-interval '7 days'")).rows[0].n;
 assert.ok(calls>0);assert.equal(r.data.usage.calls,calls);assert.ok(r.data.usage.peak_concurrency>=1);
 assert.ok(r.data.model.people.length>=1&&r.data.model.people.every(p=>p.name&&!('owner_id' in p)));assert.ok(r.data.model.clients.length>=1);
 assert.equal(r.data.model.scales[0].multiplier,1);assert.ok(r.data.usage.hours.length>=1);
 assert.equal(JSON.stringify(r.data).includes('fixture-kerapi-secret'),false);assert.equal(JSON.stringify(r.data).includes('secret_hash'),false);
 const cheaper=await ops.call('/api/staff/capacity?days=7&egress_yuan_per_gb=0.36');assert.equal(cheaper.data.assumptions.egress_yuan_per_gb.overridden,true);
 assert.ok(Math.abs(cheaper.data.model.window.bandwidth*2-r.data.model.window.bandwidth)<0.0001);
 assert.equal((await ops.call('/api/staff/capacity?days=2')).status,400);assert.equal((await ops.call('/api/staff/capacity?gateway_share=5')).status,400);
});
test('back office: two switches, one-way enterprise upgrade, tickets, channel pause and budgeted stress runs',async()=>{
 assert.equal(hasBusiness({status:'active',role:'support'}),true);assert.equal(hasBusiness({status:'active',role:'pending'}),false);assert.equal(hasBusiness({status:'suspended',role:'operations'}),false);
 const u=await user('upgrade-person'),other=await user('upgrade-other');
 assert.equal((await u.j.call('/api/platform/organizations',{method:'POST',body:{name:'Direct'}})).status,403);
 const form={legal_name:'升级测试有限公司',credit_code:'91440300ABCDEFGH1X',contact_name:'联系人',contact_phone:'13800000000'};
 assert.equal((await u.j.call('/api/platform/upgrade',{method:'POST',body:form})).status,400,'must confirm');
 assert.equal((await u.j.call('/api/platform/upgrade',{method:'POST',body:{...form,credit_code:'bad',confirm_irreversible:true}})).status,400);
 assert.equal((await u.j.call('/api/platform/upgrade',{method:'POST',body:{...form,confirm_irreversible:true}})).status,201);
 assert.equal((await u.j.call('/api/platform/upgrade',{method:'POST',body:{...form,confirm_irreversible:true}})).status,409);
 assert.equal((await u.j.call('/api/platform/me')).data.upgrade.status,'pending');
 assert.equal((await jar().call('/api/staff/workspace/business')).status,401);
 identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};revoked=false;const admin=jar();await staffLogin(admin);
 let biz=(await admin.call('/api/staff/workspace/business')).data;let request=biz.upgrades.find(x=>x.email===u.user.email);assert.equal(request.status,'pending');assert.ok(biz.models.length>=1&&biz.models.every(m=>m.routed),'only models some upstream serves are listed');
 assert.equal((await admin.call(`/api/staff/upgrades/${request.id}/reject`,{method:'POST',body:{}})).status,400,'needs reason');
 assert.equal((await admin.call(`/api/staff/upgrades/${request.id}/reject`,{method:'POST',body:{reason:'资料不全'}})).status,200);
 assert.equal((await u.j.call('/api/platform/me')).data.upgrade.reject_reason,'资料不全');
 assert.equal((await u.j.call('/api/platform/upgrade',{method:'POST',body:{...form,confirm_irreversible:true}})).status,201,'can reapply');
 const cash=(await pool.query('INSERT INTO billing_accounts(owner_id,cash_balance_fen) VALUES($1,500) RETURNING id',[u.user.id])).rows[0].id;
 biz=(await admin.call('/api/staff/workspace/business')).data;request=biz.upgrades.find(x=>x.email===u.user.email&&x.status==='pending');
 const approved=await admin.call(`/api/staff/upgrades/${request.id}/approve`,{method:'POST',body:{}});assert.equal(approved.status,200);
 assert.equal((await admin.call(`/api/staff/upgrades/${request.id}/approve`,{method:'POST',body:{}})).status,409);
 const me=(await u.j.call('/api/platform/me')).data;assert.equal(me.upgrade.status,'approved');assert.equal(me.organizations[0].name,form.legal_name);assert.equal(me.organizations[0].is_manager,true);
 const moved=(await pool.query('SELECT owner_id,organization_id,cash_balance_fen FROM billing_accounts WHERE id=$1',[cash])).rows[0];assert.equal(moved.owner_id,null);assert.equal(moved.organization_id,approved.data.organization_id);assert.equal(Number(moved.cash_balance_fen),500);
 assert.equal((await u.j.call('/api/platform/upgrade',{method:'POST',body:{...form,confirm_irreversible:true}})).status,409,'no second upgrade or downgrade path');
 const ticket=await other.j.call('/api/support/tickets',{method:'POST',body:{subject:'调用失败',body:'GLM 返回 500'}});assert.equal(ticket.status,201);assert.equal((await u.j.call('/api/support/tickets')).data.length,0,'tickets are private');
 assert.equal((await admin.call('/api/staff/business/tickets/'+ticket.data.id+'/reply',{method:'POST',body:{body:''}})).status,400);assert.equal((await admin.call('/api/staff/business/tickets/'+ticket.data.id+'/reply',{method:'POST',body:{body:'已恢复',close:true}})).status,200);assert.equal((await other.j.call('/api/support/tickets')).data[0].staff_note,'已恢复');assert.equal((await other.j.call('/api/support/tickets')).data[0].status,'closed');
 assert.equal((await admin.call('/api/staff/lab/channels/nope',{method:'POST',body:{paused:true,reason:'x'}})).status,404);assert.equal((await admin.call('/api/staff/lab/channels/glm-5.3',{method:'POST',body:{paused:true}})).status,400);
 assert.equal((await admin.call('/api/staff/lab/channels/glm-5.3',{method:'POST',body:{paused:true,reason:'上游故障'}})).status,200);let channels=(await admin.call('/api/staff/lab/channels')).data;assert.equal(channels.find(c=>c.id==='glm-5.3').paused,true);
 assert.equal((await admin.call('/api/staff/lab/channels/glm-5.3',{method:'POST',body:{paused:false}})).status,200);
 const supplier=(await pool.query("INSERT INTO supplier_lab_suppliers(name,kind,created_by) VALUES('Stress fixture','supplier','staff-owner') RETURNING id")).rows[0].id;
 const credential=(await pool.query("INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by) VALUES($1,'stress','https://kerapi.cn/v1',$2,'fp','staff-owner') RETURNING id",[supplier,vault(process.env.SUPPLIER_LAB_SECRET).seal({key:'fixture-stress'})])).rows[0].id;
 const endpoint=(await pool.query("INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,created_by,supplier_id,credential_id) VALUES('stress','supplier','https://kerapi.cn/v1','stress-model','fp','staff-owner',$1,$2) RETURNING id",[supplier,credential])).rows[0].id;
 process.env.SUPPLIER_LAB_ALLOWED_HOSTS='api.deepseek.com,kerapi.cn';
 {// 阶梯压测：逐档加压、流式计时、失败过多自动停
  const saved=pilotFetch;let hits=0;
  pilotFetch=async(url,options)=>{hits++;const body=JSON.parse(options.body);assert.equal(body.stream,true);
   if(hits>3)return new Response('{"error":{"message":"rate limited"}}',{status:429});
   await new Promise(r=>setTimeout(r,20));
   return new Response('data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":40,"completion_tokens":20}}\n\ndata: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});};
  try{
   const start=body=>admin.call('/api/staff/lab/load-tests',{method:'POST',body:{endpoint_id:endpoint,profile:'short',steps:[1,2,4],rounds:1,budget_yuan:1,...body}});
   assert.equal((await jar().call('/api/staff/lab/load-tests')).status,401);
   assert.equal((await start({})).status,400,'needs rates');await pool.query('UPDATE supplier_lab_endpoints SET input_yuan_per_m=1,cached_input_yuan_per_m=0.1,output_yuan_per_m=4 WHERE id=$1',[endpoint]);
   assert.equal((await start({steps:[3]})).status,400,'fixed step choices');assert.equal((await start({budget_yuan:0.000001})).status,400,'over budget');assert.equal((await start({profile:'huge'})).status,400);
   const started=await start({});assert.equal(started.status,202,JSON.stringify(started.data));assert.equal(started.data.requests,7);
   assert.equal((await start({})).status,409,'one load test at a time');
   let t;for(let i=0;i<100;i++){t=(await admin.call('/api/staff/lab/load-tests')).data.tests.find(x=>x.id===started.data.test_id);if(t.status!=='running')break;await new Promise(r=>setTimeout(r,30));}
   assert.equal(t.status,'stopped');assert.match(t.stop_reason,/并发 4 时失败 4\/4/);assert.equal(hits,7);
   assert.equal(t.summary.stable_concurrency,2);assert.deepEqual(t.summary.steps.map(x=>x.ok),[1,2,0]);assert.equal(t.summary.steps[2].rate_limited,4);
   assert.ok(t.summary.steps[0].ttft_p50>0&&t.summary.steps[0].throughput>0);assert.ok(Math.abs(t.summary.cost_yuan-3*(40+80)/1e6)<1e-9,'cost from real usage');
   assert.equal((await admin.call('/api/staff/lab/load-tests/'+t.id+'/stop',{method:'POST',body:{}})).status,409);
  }finally{pilotFetch=saved;}}

 {// 对比评测：官方 Key 只做评测参照；规则、换位盲评、人工盲评
  const saved=pilotFetch,chats=[];
  pilotFetch=async(url,options)=>{const auth=options?.headers?.Authorization;
   if(String(url).endsWith('/models'))return auth==='Bearer sk-bad'?new Response('{"error":{"message":"bad"}}',{status:401}):new Response(JSON.stringify({data:[{id:'deepseek-official'}]}),{status:200});
   const body=JSON.parse(options.body);chats.push(body);
   const content=body.model==='judge-model'?(body.messages[1].content.split('【回答 A】')[1].split('【回答 B】')[0].includes('549')?'{"a":9,"b":3,"winner":"A","reason":"A 正确"}':'{"a":3,"b":9,"winner":"B","reason":"B 正确"}'):body.model==='deepseek-official'?'549':'supplier answer';
   return new Response(JSON.stringify({model:body.model,choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:3}}),{status:200});};
  try{
   assert.equal((await jar().call('/api/staff/lab/compare')).status,401);
   assert.equal((await admin.call('/api/staff/lab/compare/reference',{method:'POST',body:{api_key:'sk-bad'}})).status,400,'rejected key is not stored');
   const ref=await admin.call('/api/staff/lab/compare/reference',{method:'POST',body:{api_key:'sk-official-test'}});assert.equal(ref.status,201,JSON.stringify(ref.data));assert.deepEqual(ref.data.models,['deepseek-official']);
   assert.equal((await admin.call('/api/staff/lab/compare/reference',{method:'POST',body:{api_key:'sk-official-test'}})).status,409);
   const judgeEndpoint=(await pool.query("INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,created_by,supplier_id,credential_id) VALUES('judge','supplier','https://kerapi.cn/v1','judge-model','fp','staff-owner',$1,$2) RETURNING id",[supplier,credential])).rows[0].id;
   const view=(await admin.call('/api/staff/lab/compare')).data;const official=view.endpoints.find(e=>e.model_id==='deepseek-official');
   assert.equal(official.kind,'reference');assert.equal(official.active_ciphertext,undefined);assert.equal(view.cases.length,12);
   assert.equal((await pool.query("SELECT p.source_type FROM suppliers p JOIN supplier_lab_suppliers s ON s.canonical_supplier_id=p.id JOIN supplier_lab_endpoints e ON e.supplier_id=s.id WHERE e.id=$1",[official.id])).rows[0].source_type,'official');
   const go=body=>admin.call('/api/staff/lab/compare/runs',{method:'POST',body:{supplier_endpoint_id:endpoint,reference_endpoint_id:official.id,judge_endpoint_id:judgeEndpoint,case_ids:['calc','logic'],...body}});
   assert.equal((await go({reference_endpoint_id:judgeEndpoint,judge_endpoint_id:null})).status,400,'reference must be an official key');
   assert.equal((await go({judge_endpoint_id:endpoint})).status,400,'judge must be a third endpoint');
   const started=await go({});assert.equal(started.status,202,JSON.stringify(started.data));assert.equal(started.data.upstream_calls,8);
   let detail;for(let i=0;i<100;i++){detail=(await admin.call('/api/staff/lab/compare/runs/'+started.data.run_id)).data;if(detail.run.status!=='running')break;await new Promise(r=>setTimeout(r,30));}
   assert.equal(detail.run.status,'completed');assert.equal(detail.items.length,2);assert.equal(chats.length,8);
   assert.ok(chats.filter(c=>c.model!=='judge-model').every(c=>c.temperature===0&&c.thinking?.type==='disabled'),'both sides get identical parameters');
   assert.equal(detail.summary.reference.rule_pass,1);assert.equal(detail.summary.supplier.rule_pass,0);
   assert.equal(detail.summary.judge.reference_wins,2,'both A/B orders agree');assert.equal(detail.summary.judge.position_flips,0);assert.equal(detail.summary.verdict,'worse');
   const item=detail.items[0],pick=item.blind_flip?'B':'A';
   const vote=await admin.call('/api/staff/lab/compare/items/'+item.id+'/review',{method:'POST',body:{choice:pick}});assert.equal(vote.status,200);assert.equal(vote.data.verdict,'supplier','blind A/B maps back to the right side');assert.equal(vote.data.judge,'reference');
   detail=(await admin.call('/api/staff/lab/compare/runs/'+started.data.run_id)).data;assert.equal(detail.summary.human.items,1);assert.equal(detail.summary.human.agree_with_judge,0);assert.ok(detail.items[0].reviews[0].mine);
   assert.equal((await admin.call('/api/staff/lab/compare')).data.runs[0].summary.verdict,'worse');
  }finally{pilotFetch=saved;}}

 {// 上游接入：Key 属于供应商并覆盖它的全部型号；第一把是主用，后面的是备用；检测发一次 1 Token 请求
  const saved=pilotFetch,checks=[];
  pilotFetch=async(url,options)=>{const auth=options.headers.Authorization;checks.push({url:String(url),auth,body:JSON.parse(options.body||'{}')});return auth==='Bearer sk-up-bad'?new Response('{"error":{"message":"invalid key sk-up-bad"}}',{status:401}):new Response(JSON.stringify({choices:[{message:{content:'p'}}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200});};
  try{
   const sup=await admin.call('/api/staff/suppliers',{method:'POST',body:{display_name:'Upstream fixture',legal_name:'Upstream fixture legal',source_type:'authorized_reseller',region:'CN'}});assert.equal(sup.status,201);const sid=sup.data.id;
   assert.equal((await admin.call(`/api/staff/lab/suppliers/${sid}/models`,{method:'POST',body:{model_id:'up-model-a'}})).status,404,'models need a key first');
   const first=await admin.call(`/api/staff/lab/suppliers/${sid}/keys`,{method:'POST',body:{label:'主 Key',api_key:'sk-up-good',base_url:'https://kerapi.cn/v1'}});assert.equal(first.status,201,JSON.stringify(first.data));assert.equal(first.data.priority,1);assert.equal(first.data.models,0);
   const m=await admin.call(`/api/staff/lab/suppliers/${sid}/models`,{method:'POST',body:{model_id:'up-model-a',input_yuan_per_m:'1',output_yuan_per_m:'4'}});assert.equal(m.status,201);assert.equal(m.data.keys,1);
   assert.equal((await admin.call(`/api/staff/lab/suppliers/${sid}/models`,{method:'POST',body:{model_id:'up-model-a'}})).status,409);
   const second=await admin.call(`/api/staff/lab/suppliers/${sid}/keys`,{method:'POST',body:{label:'备 Key',api_key:'sk-up-bad'}});assert.equal(second.status,201);assert.equal(second.data.priority,2,'second key is standby');assert.equal(second.data.models,1,'new key covers existing models');
   assert.equal((await admin.call(`/api/staff/lab/suppliers/${sid}/keys`,{method:'POST',body:{label:'again',api_key:'sk-up-bad'}})).status,409);
   const dup=await admin.call(`/api/staff/lab/suppliers/${sid}/keys`,{method:'POST',body:{label:'same secret other address',api_key:'sk-up-good',base_url:'https://kerapi.cn'}});assert.equal(dup.status,409,'same secret under another address is still the same key');assert.match(dup.data.error,/主 Key/);
   assert.equal((await admin.call(`/api/staff/lab/suppliers/${sid}/models`,{method:'POST',body:{model_id:'up-model-b'}})).data.keys,2,'new model reaches every key');
   const before=checks.length,good=await admin.call(`/api/staff/lab/credentials/${first.data.id}/check`,{method:'POST',body:{}});assert.equal(good.data.ok,true);assert.equal(good.data.passed,'2/2');assert.deepEqual(checks.slice(before).map(c=>c.body.model).sort(),['up-model-a','up-model-b'],'every model checked');assert.ok(checks.slice(before).every(c=>c.body.max_tokens===1&&c.url.endsWith('/chat/completions')));
   const bad=await admin.call(`/api/staff/lab/credentials/${second.data.id}/check`,{method:'POST',body:{}});assert.equal(bad.data.ok,false);assert.equal(bad.data.passed,'0/2');assert.equal(bad.data.models[0].status,401);assert.ok(!JSON.stringify(bad.data).includes('sk-up-bad'),'key never echoed');
   let view=(await admin.call('/api/staff/lab/upstream')).data.suppliers.find(s=>s.id===sid);
   assert.deepEqual(view.models.map(x=>[x.model_id,x.key_count]),[['up-model-a',2],['up-model-b',2]]);assert.equal(view.primary_label,'主 Key');assert.equal(view.standby_count,1);
   assert.equal(view.keys.find(k=>k.id===second.data.id).last_check_ok,false);assert.deepEqual(view.keys.find(k=>k.id===first.data.id).models,['up-model-a','up-model-b']);assert.equal(view.keys.find(k=>k.id===first.data.id).last_check_models.length,2);assert.equal(view.keys.find(k=>k.id===second.data.id).duplicate_of,null);assert.equal(view.keys.find(k=>k.id===first.data.id).model_count,2);
   assert.equal((await admin.call(`/api/staff/lab/suppliers/${sid}/models/up-model-b/disable`,{method:'POST',body:{}})).status,200);
   view=(await admin.call('/api/staff/lab/upstream')).data.suppliers.find(s=>s.id===sid);assert.deepEqual(view.models.map(x=>x.model_id),['up-model-a']);
   assert.equal((await jar().call('/api/staff/lab/upstream')).status,401);
  }finally{pilotFetch=saved;}}

 {// 自动检查：按 Key 拉上游型号、每个型号 1 Token；目录里有的新型号自动上线，没有的要人工；下架、Key 失效、重复 Key 都开事件
  const sid=(await pool.query("SELECT id FROM suppliers WHERE display_name='Upstream fixture'")).rows[0].id;
  const lab=(await pool.query('SELECT id FROM supplier_lab_suppliers WHERE canonical_supplier_id=$1',[sid])).rows[0].id;
  const good=(await pool.query("SELECT * FROM supplier_lab_credentials WHERE supplier_id=$1 AND label='主 Key'",[lab])).rows[0];
  await pool.query("INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by,priority) VALUES($1,'同一把',$2,$3,$4,'staff-owner',2)",[lab,'https://kerapi.cn',good.credential_ciphertext,good.credential_fingerprint]);
  const saved=pilotFetch,calls=[];
  pilotFetch=async(url,options)=>{const auth=options?.headers?.Authorization;calls.push(String(url));
   if(String(url).endsWith('/models'))return auth==='Bearer sk-up-good'?new Response(JSON.stringify({data:[{id:'up-model-a'},{id:'up-model-new'},{id:'GLM-5.3-Flash'}]}),{status:200}):auth==='Bearer sk-up-bad'?new Response('{"error":{"message":"bad key"}}',{status:401}):new Response('{"data":[]}',{status:200});
   const asked=JSON.parse(options.body||'{}');return auth==='Bearer sk-up-bad'?new Response('{"error":{"message":"invalid key sk-up-bad"}}',{status:401}):new Response(JSON.stringify({choices:[{message:{content:'p'}}],usage:{prompt_tokens:1,completion_tokens:asked.model==='up-model-a'?5:1}}),{status:200});};
  try{
   const run=await admin.call('/api/staff/lab/key-watch/run',{method:'POST',body:{}});assert.equal(run.status,200,JSON.stringify(run.data));
   const sum=run.data.suppliers.find(x=>x.supplier_id===sid);assert.equal(sum.keys,3);assert.equal(sum.distinct_keys,2,'the duplicate is checked once');assert.equal(sum.upstream,3);
   let w=(await admin.call('/api/staff/lab/key-watch')).data;const mine=w.events.filter(e=>e.supplier_id===sid),kinds=mine.map(e=>e.kind+':'+e.subject);
   assert.ok(kinds.includes('auto_launched:GLM-5.3-Flash'),'catalog model the upstream now offers goes live');assert.ok(kinds.includes('needs_manual_launch:up-model-new'),'unknown model needs a manual launch');
   assert.ok(mine.some(e=>e.kind==='duplicate_key'&&e.detail.same_as==='主 Key'));assert.ok(mine.some(e=>e.kind==='key_check_failed'&&e.detail.key==='备 Key'));assert.ok(mine.some(e=>e.kind==='key_list_failed'&&e.detail.key==='备 Key'));
   assert.ok(!JSON.stringify(w).includes('sk-up-bad'),'key never echoed');
   assert.ok(mine.some(e=>e.kind==='ignores_max_tokens'&&e.subject==='up-model-a'&&e.detail.got===5),'a 1-token check answered with 5 tokens is flagged');assert.equal((await pool.query("SELECT count(*)::int AS n FROM upstream_model_flags WHERE model_id='up-model-a' AND flag='ignores_max_tokens' AND cleared_at IS NULL")).rows[0].n,1);
   assert.equal((await pool.query("SELECT count(DISTINCT credential_id)::int AS n FROM supplier_lab_endpoints WHERE supplier_id=$1 AND model_id='GLM-5.3-Flash' AND disabled_at IS NULL",[lab])).rows[0].n,3,'auto-launched model reaches every key');
   const good2=(await pool.query("SELECT last_check_ok,last_check_model FROM supplier_lab_credentials WHERE supplier_id=$1 AND credential_fingerprint=$2",[lab,good.credential_fingerprint])).rows;assert.equal(good2.length,2);assert.ok(good2.every(r=>r.last_check_ok===true),'result written to both rows of the same secret');
   // upstream drops a model: critical event; the earlier one resolves when the run no longer sees it
   pilotFetch=async(url,options)=>{const auth=options?.headers?.Authorization;if(String(url).endsWith('/models'))return auth==='Bearer sk-up-good'?new Response(JSON.stringify({data:[{id:'GLM-5.3-Flash'}]}),{status:200}):new Response('{"data":[]}',{status:auth==='Bearer sk-up-bad'?401:200});return new Response(JSON.stringify({choices:[{message:{content:'p'}}]}),{status:auth==='Bearer sk-up-bad'?401:200});};
   assert.equal((await admin.call('/api/staff/lab/key-watch/run',{method:'POST',body:{}})).status,200);
   w=(await admin.call('/api/staff/lab/key-watch')).data;const after=w.events.filter(e=>e.supplier_id===sid).map(e=>e.kind+':'+e.subject);
   assert.ok(after.includes('upstream_removed:up-model-a'),'model the upstream dropped is critical');assert.ok(!after.includes('needs_manual_launch:up-model-new'),'resolved when no longer seen');
   const ov=(await admin.call('/api/staff/lab/overview')).data;assert.ok(ov.risks.some(r=>r.area==='watch'&&r.title.includes('上游不再提供 up-model-a')));
   const card=ov.suppliers.find(x=>x.id===sid);assert.equal(card.duplicate_keys,1);assert.equal(card.distinct_keys,2);
   assert.ok(ov.costs&&typeof ov.costs.tests.yuan==='number');assert.ok(ov.models.every(m=>m.routed||m.paused)&&!ov.models.some(m=>ov.catalog_without_upstream.some(c=>c.id===m.id)),'catalog models without an upstream are not counted');
   const up=(await admin.call('/api/staff/lab/upstream')).data.suppliers.find(x=>x.id===sid);assert.equal(up.standby_count,1,'备 Key counts, the twin does not');assert.equal(up.duplicate_count,1);
   while(await service.mail.drain());const alert=sent.filter(m=>String(m.subject).startsWith('semifly 上游告警'));assert.ok(alert.length>=1,'admins are mailed');assert.ok(alert.some(m=>m.text.includes('需要人工上线')&&m.text.includes('up-model-new')));assert.ok(alert.some(m=>m.subject.includes('含严重')));
  }finally{pilotFetch=saved;await pool.query('UPDATE supplier_lab_credentials SET disabled_at=now() WHERE supplier_id=$1 AND disabled_at IS NULL',[lab]);}}

 {// 评测 Key：每家官方厂商一把，只登记为参照型号；官方主机无需运维配置；换 Key 时旧的停用
  const saved=pilotFetch,seen=[];
  pilotFetch=async(url,options)=>{seen.push(String(url));const auth=options.headers.Authorization;
   if(String(url).endsWith('/models'))return auth==='Bearer sk-glm-bad'?new Response('{"error":{"message":"bad"}}',{status:401}):new Response('{"error":"no list"}',{status:404});
   return new Response(JSON.stringify({choices:[{message:{content:'p'}}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200});};
  try{
   let v=(await admin.call('/api/staff/lab/eval-keys')).data;assert.deepEqual(v.vendors.map(x=>x.id),['deepseek','zhipu','zai']);assert.equal(v.vendors.find(x=>x.id==='deepseek').key?.models?.[0],'deepseek-official','the key stored on the compare page shows up here');assert.ok(['zhipu','zai'].every(id=>v.vendors.find(x=>x.id===id).key===null));
   assert.equal((await admin.call('/api/staff/lab/eval-keys',{method:'POST',body:{vendor:'nope',api_key:'x'}})).status,400);
   assert.equal((await admin.call('/api/staff/lab/eval-keys',{method:'POST',body:{vendor:'zhipu',api_key:'sk-glm-bad'}})).status,400,'rejected key is not stored');
   const glm=await admin.call('/api/staff/lab/eval-keys',{method:'POST',body:{vendor:'zhipu',api_key:'sk-glm-one'}});assert.equal(glm.status,201,JSON.stringify(glm.data));
   assert.ok(glm.data.models.includes('GLM-5.3'),'falls back to suggested models when the vendor lists none');assert.ok(seen.at(-1).startsWith('https://open.bigmodel.cn/api/paas/v4/'),'official host allowed without ops config');
   const chk=await admin.call(`/api/staff/lab/credentials/${glm.data.credential_id}/check`,{method:'POST',body:{}});assert.equal(chk.status,200);assert.equal(chk.data.ok,true,'check works on reference keys');
   const again=await admin.call('/api/staff/lab/eval-keys',{method:'POST',body:{vendor:'zhipu',api_key:'sk-glm-two',model_ids:['GLM-5.3']}});assert.equal(again.status,201);assert.deepEqual(again.data.replaced,[glm.data.label]);
   v=(await admin.call('/api/staff/lab/eval-keys')).data;const z=v.vendors.find(x=>x.id==='zhipu');assert.equal(z.key.id,again.data.credential_id);assert.equal(z.retired,1);assert.deepEqual(z.key.models,['GLM-5.3']);
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id WHERE e.kind='reference' AND c.disabled_at IS NULL AND e.base_url LIKE 'https://open.bigmodel.cn%'")).rows[0].n,1);
   assert.equal((await admin.call(`/api/staff/lab/eval-keys/${again.data.credential_id}/disable`,{method:'POST',body:{}})).status,200);assert.equal((await admin.call('/api/staff/lab/eval-keys')).data.vendors.find(x=>x.id==='zhipu').key,null);
   assert.equal((await jar().call('/api/staff/lab/eval-keys')).status,401);
  }finally{pilotFetch=saved;}}

 {// 功能对比：官方直连 vs 我们的网关；官方能我们不能才是差异，我们多出来的是蓝色，官方也不行的是灰色
  const saved=pilotFetch;
  pilotFetch=async(url,options)=>{const body=JSON.parse(options.body),official=String(url).startsWith('https://open.bigmodel.cn');
   const reply=(content,extra={})=>new Response(JSON.stringify({choices:[{message:{content,...extra}}],usage:{prompt_tokens:10,completion_tokens:2}}),{status:200});
   if(body.stream)return new Response('data: {"choices":[{"delta":{"content":"收到"}}]}\n\ndata: [DONE]\n\n',{status:200});
   if(body.response_format)return official?reply('{"ok":true}'):reply('不是 JSON');// 官方能、我们不能 → gap
   if(body.thinking?.type==='disabled')return official?new Response('{"error":{"message":"GLM does not support thinking off"}}',{status:400}):reply('收到');// 我们多出来 → extra
   if(body.max_tokens>=32768)return new Response('{"error":{"message":"too many tokens"}}',{status:400});// 官方也不行 → neither
   if(body.thinking||body.reasoning_effort)return reply('收到',{reasoning_content:'想了一下'});
   return reply('收到');};
  try{
   const glm=await admin.call('/api/staff/lab/eval-keys',{method:'POST',body:{vendor:'zhipu',api_key:'sk-glm-three',model_ids:['GLM-5.3','GLM-5.3-Flash']}});assert.equal(glm.status,201);
   let v=(await admin.call('/api/staff/lab/feature-compare')).data;assert.equal(v.features.length,25,'16 shared probes + 9 agent tests');assert.ok(v.features.every(f=>f.group&&f.hint));
   const ours=v.models.find(m=>m.id==='glm-5.3');assert.equal(ours.reference.model_id,'GLM-5.3','paired by id');assert.equal(v.models.find(m=>m.id==='deepseek-flash').reference.model_id,'deepseek-official','paired by family when ids differ');
   assert.equal((await admin.call('/api/staff/lab/feature-compare/pairs',{method:'PUT',body:{our_model:'glm-5.3',reference_endpoint_id:ours.candidates.find(c=>c.model_id==='GLM-5.3-Flash').id}})).status,200);
   assert.equal((await admin.call('/api/staff/lab/feature-compare')).data.models.find(m=>m.id==='glm-5.3').reference.model_id,'GLM-5.3-Flash','override saved');
   assert.equal((await admin.call('/api/staff/lab/feature-compare/pairs',{method:'PUT',body:{our_model:'glm-5.3',reference_endpoint_id:null}})).status,200);assert.equal((await admin.call('/api/staff/lab/feature-compare/pairs',{method:'PUT',body:{our_model:'glm-5.3',reference_endpoint_id:v.models.find(m=>m.id==='deepseek-flash').reference.endpoint_id}})).status,400,'cross-family pairing refused');
   const started=await admin.call('/api/staff/lab/feature-compare/runs',{method:'POST',body:{models:['glm-5.3'],skip_long:true}});assert.equal(started.status,202,JSON.stringify(started.data));assert.equal(started.data.probes,23,'everything except the two long-context tests');
   for(let i=0;i<100;i++){v=(await admin.call('/api/staff/lab/feature-compare')).data;if(v.run.status!=='running')break;await new Promise(r=>setTimeout(r,30));}
   assert.equal(v.run.status,'completed');assert.equal(v.run.done,23);const cells=v.cells['glm-5.3'];
   assert.equal(cells.basic.outcome,'same');assert.equal(cells.json.outcome,'gap');assert.equal(cells.thinking_off.outcome,'extra');assert.equal(cells.out_32k.outcome,'neither');assert.equal(cells.ctx_128k,undefined,'long context skipped');
   assert.equal(cells.json.official.status,'pass');assert.equal(cells.json.ours.status,'partial');assert.ok(!JSON.stringify(cells).includes('sk-glm-three'),'official key never stored');
   assert.equal(cells.multi_turn.outcome,'neither','both sides answer 收到, neither recalls the number');
   assert.equal((await jar().call('/api/public/realtesting')).status,404,'nothing published yet');
   const pub=await admin.call('/api/staff/lab/feature-compare/publish',{method:'POST',body:{}});assert.equal(pub.status,201,JSON.stringify(pub.data));assert.equal(pub.data.tests,23);
   const pubView=await jar().call('/api/public/realtesting');assert.equal(pubView.status,200,'public, no login');assert.equal(pubView.data.models[0].name,'GLM-5.3');assert.equal(pubView.data.models[0].cells.json.outcome,'gap');
   assert.ok(pubView.data.findings.length>=3);assert.ok(pubView.data.run.requests>0);assert.ok(!JSON.stringify(pubView.data).match(/excerpt|request_id|sk-/),'only verdicts and short notes are public');assert.ok(cells.tool_result&&cells.parallel_tools&&cells.cache_hit,'agent tests ran');
   assert.equal((await admin.call('/api/staff/lab/feature-compare/runs',{method:'POST',body:{models:['glm-5.3'],tests:['nope']}})).status,400,'unknown test refused');
   const only=await admin.call('/api/staff/lab/feature-compare/runs',{method:'POST',body:{models:['glm-5.3'],tests:['system_prompt','stream_usage']}});assert.equal(only.status,202);assert.equal(only.data.probes,2,'only the chosen tests run');
   for(let i=0;i<100;i++){v=(await admin.call('/api/staff/lab/feature-compare')).data;if(v.run.status!=='running')break;await new Promise(r=>setTimeout(r,30));}assert.equal(v.run.done,2);
   assert.equal((await jar().call('/api/staff/lab/feature-compare')).status,401);
  }finally{pilotFetch=saved;}}

 {// 身份检测：分词指纹（固定多出 7 个 Token = 隐藏内容）、自报身份、输出相似、能力小测（少对 4 题 = 疑似降级）
  const saved=pilotFetch;const {PROBES}=await import('../src/model-identity.mjs');const bench=PROBES.filter(p=>p.kind==='bench');
  pilotFetch=async(url,options)=>{const body=JSON.parse(options.body),official=String(url).startsWith('https://open.bigmodel.cn'),text=String(body.messages.at(-1).content);
   const reply=(content,prompt)=>new Response(JSON.stringify({model:official?'glm-5.3':'GLM-5.3',choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:prompt,completion_tokens:30}}),{status:200});
   const q=bench.find(p=>text.startsWith(p.prompt));if(q)return reply('想一想\n答案：'+(!official&&bench.indexOf(q)<4?'不知道':q.answer),50);
   if(text.includes('你是什么模型'))return reply('我是智谱开发的 GLM 模型。',20);
   if(text.includes('TCP')||text.includes('短诗')||text.includes('sky'))return reply('三次握手：客户端发 SYN，服务端回 SYN-ACK，客户端再回 ACK。',20);
   return reply('好',text.length+(official?0:7));};
  try{
   let v=(await admin.call('/api/staff/lab/identity')).data;assert.equal(v.ready,true);assert.equal(v.sections.fingerprint,21);assert.equal(v.sections.bench,40);assert.equal(v.run,null);
   assert.equal(v.models.find(m=>m.id==='glm-5.3').reference.model_id,'GLM-5.3','same pairing as 功能对比');
   assert.equal((await admin.call('/api/staff/lab/identity/runs',{method:'POST',body:{sections:['nope']}})).status,400);
   const started=await admin.call('/api/staff/lab/identity/runs',{method:'POST',body:{models:['glm-5.3']}});assert.equal(started.status,202,JSON.stringify(started.data));assert.equal(started.data.probes,29);assert.equal(started.data.calls,61);
   assert.equal((await admin.call('/api/staff/lab/identity/runs',{method:'POST',body:{models:['glm-5.3']}})).status,409,'one run at a time');
   for(let i=0;i<200;i++){v=(await admin.call('/api/staff/lab/identity')).data;if(v.run.status!=='running')break;await new Promise(r=>setTimeout(r,30));}
   assert.equal(v.run.status,'completed');assert.equal(v.run.done,29);const d=v.detail['glm-5.3'];
   assert.equal(d.tokenizer.status,'offset');assert.equal(d.tokenizer.offset,7);assert.equal(d.self.status,'same');assert.equal(d.self.ours.model,'GLM-5.3');assert.equal(d.similar.status,'close');
   assert.equal(d.bench.n,20);assert.equal(d.bench.official,20);assert.equal(d.bench.ours,16);assert.equal(d.bench.status,'suspect');assert.equal(d.verdict,'suspect');
   assert.equal(v.runs[0].summary['glm-5.3'].verdict,'suspect','history keeps the verdict');assert.ok(['peak','off'].includes(v.runs[0].period));
   const only=await admin.call('/api/staff/lab/identity/runs',{method:'POST',body:{models:['glm-5.3'],sections:['fingerprint']}});assert.equal(only.data.probes,9);
   for(let i=0;i<200;i++){v=(await admin.call('/api/staff/lab/identity')).data;if(v.run.status!=='running')break;await new Promise(r=>setTimeout(r,30));}
   assert.equal(v.detail['glm-5.3'].bench,null);assert.equal(v.detail['glm-5.3'].verdict,'watch','hidden tokens alone are worth a look');
   assert.ok(!JSON.stringify(v).includes('sk-glm-three'),'official key never shown');
   assert.equal((await jar().call('/api/staff/lab/identity')).status,401);
  }finally{pilotFetch=saved;}}
});
test('pack refunds return the unused proportion less 15%, survive rejection and replay',async()=>{
 identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};revoked=false;const admin=jar();await staffLogin(admin);
 const buyer=await user('refund-buyer');appCfg.alipay.allowedEmails.add(buyer.email);
 const order=(await buyer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:3000,idempotency_key:'refund-order-key-0001'}})).data.order;
 const out=(await pool.query('SELECT out_trade_no,account_id FROM payment_orders WHERE id=$1',[order.id])).rows[0],trade=seedAlipayTrade(out.out_trade_no,'30.00');trade.status='TRADE_SUCCESS';
 assert.equal((await buyer.j.call('/api/billing/alipay-orders/'+order.id)).data.order.status,'paid');
 const balance=async()=>(await buyer.j.call('/api/billing/personal')).data,path=`/api/staff/payments/orders/${order.id}/refunds`;
 const ask=(amount,key)=>admin.call(path,{method:'POST',body:{amount_fen:amount,reason:'退回剩余额度',idempotency_key:key}});
 assert.equal((await buyer.j.call(path,{method:'POST',body:{amount_fen:2550}})).status,401);
 assert.equal((await ask(3000,'pack-over-refund-0001')).status,409);
 const quote=(await admin.call(`/api/staff/payments/orders/${order.id}/refund-quote`)).data;assert.equal(quote.net_fen,'2550');assert.equal(quote.fee_fen,'450');
 alipayRefundMode='reject';const rejected=await ask(2550,'pack-reject-00000001');alipayRefundMode='ok';assert.equal(rejected.data.status,'failed');assert.equal((await balance()).list_credit_fen,'3000');assert.equal((await balance()).cash_balance_fen,'3000');
 alipayRefundMode='timeout';const pending=await ask(2550,'pack-pending-0000001');assert.equal(pending.data.status,'pending');assert.equal((await balance()).list_credit_fen,'0');assert.equal((await balance()).cash_balance_fen,'450');
 assert.equal((await ask(2550,'pack-blocked-0000001')).status,409);
 assert.equal((await buyer.j.call('/api/billing/personal/invoices',{method:'POST',body:{invoice_type:'general',title:'测试个人',email:buyer.email,amount_yuan:'1'}})).status,409,'invoice must wait for pending refund');
 alipayRefundMode='ok';assert.equal((await admin.call(`/api/staff/payments/refunds/${pending.data.refund_id}/retry`,{method:'POST',body:{}})).data.status,'succeeded');
 assert.equal((await balance()).cash_balance_fen,'0');assert.equal(trade.refundedFen,2550);
 const replay=await ask(2550,'pack-pending-0000001');assert.equal(replay.data.refund_id,pending.data.refund_id);assert.equal(trade.refundedFen,2550);
 const ledger=(await balance()).entries;assert.equal(ledger.filter(e=>e.reference_id?.startsWith('refund-fee:')).length,1);
});

test('sign out revokes persistent customer session',async()=>{assert.equal((await owner.j.call('/api/auth/sign-out',{method:'POST',body:{}})).status,200);assert.equal((await owner.j.call('/api/platform/me')).status,401);});
test('two workspaces share credentials, actual acceptance and fail-closed catalog releases',async()=>{
 identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};revoked=false;
 const admin=jar();await staffLogin(admin);
 for(const path of ['/api/staff/console','/api/staff/console.js','/api/staff/workspace/view','/api/staff/lab/view','/api/staff/workspace/bridge.js'])assert.equal((await admin.call(path)).status,200,path);
 assert.equal((await jar().call('/api/staff/console')).location,'/api/staff/login?next=business');
 identity={sub:'technical-fixture',email:'technical@example.test',name:'Technician',staff_approved:true};const tech=jar();await staffLogin(tech);
 assert.equal((await admin.call('/api/staff/members/technical-fixture',{method:'PATCH',body:{role:'support',status:'active'}})).status,200);await staffLogin(tech);
 assert.equal((await tech.call('/api/staff/lab/config')).status,403);assert.equal((await tech.call('/api/staff/lab/view')).status,403);assert.equal((await tech.call('/api/staff/observability')).status,403);assert.equal((await jar().call('/api/staff/observability')).status,401);
 assert.equal((await admin.call('/api/staff/members/technical-fixture/technical-access',{method:'PUT',body:{enabled:true}})).status,200);
 assert.equal((await tech.call('/api/staff/lab/config')).status,200);assert.equal((await tech.call('/api/staff/observability')).status,200);
 appCfg.metricsFile=join(pilotDir,'metrics.json');await writeFile(appCfg.metricsFile,JSON.stringify({schema:1,collected_at:new Date().toISOString(),cpu_percent:12,network:{interface:'eth0',rx_bps:0},services:[],secret:'never-forward-this'}));const observed=await tech.call('/api/staff/observability');assert.equal(observed.data.status,'ok');assert.equal(observed.data.cpu_percent,12);assert.ok(!JSON.stringify(observed.data).includes('never-forward-this'));
 assert.equal((await tech.call('/api/staff/suppliers',{method:'POST',body:{}})).status,400,'business access reaches validation');
 assert.equal((await admin.call('/api/staff/lab/suppliers',{method:'POST',body:{name:'Duplicate'}})).status,410);
 const supplier=await admin.call('/api/staff/suppliers',{method:'POST',body:{display_name:'Shared supplier',legal_name:'Shared legal',source_type:'unconfirmed',region:'CN'}});assert.equal(supplier.status,201);
 assert.ok((await tech.call('/api/staff/lab/suppliers')).data.some(s=>s.id===supplier.data.id));
 const key=await tech.call('/api/staff/lab/credentials',{method:'POST',body:{supplier_id:supplier.data.id,label:'Unified key',base_url:'https://api.deepseek.com',api_key:'fake-key-only-for-tests'}});assert.equal(key.status,201,JSON.stringify(key.data));
 assert.equal(key.data.credential_ciphertext,undefined);
 const endpoint=await tech.call('/api/staff/lab/endpoints',{method:'POST',body:{credential_id:key.data.id,label:'Shared model',model_id:'test-model',input_yuan_per_m:'1',cached_input_yuan_per_m:'0.1',output_yuan_per_m:'4'}});assert.equal(endpoint.status,201,JSON.stringify(endpoint.data));assert.ok(endpoint.data.offer_id);
 const overview=await admin.call('/api/staff/workspace/overview');assert.equal(overview.status,200);assert.ok(!JSON.stringify(overview.data).includes('fake-key-only-for-tests'));
 const ids=['arithmetic','json','chinese','context'];
 const run=(await pool.query("INSERT INTO supplier_lab_runs(supplier_endpoint_id,case_ids,status,created_by,created_at,finished_at) VALUES($1,$2,'completed','technical-fixture',now()-interval '10 minutes',now()-interval '9 minutes') RETURNING *",[endpoint.data.id,ids])).rows[0];
 for(const caseId of ids)await pool.query(`INSERT INTO supplier_lab_transactions(run_id,endpoint_id,case_id,prompt_sha256,http_status,latency_ms,input_tokens,cached_input_tokens,output_tokens,total_tokens,estimated_cost_yuan,quality_score,checks,created_at) VALUES($1,$2,$3,'fixture',200,120,10,0,1,11,0.000014,100,$4,now()-interval '9 minutes 30 seconds')`,[run.id,endpoint.data.id,caseId,JSON.stringify({usage_present_and_consistent:true,model_matches_request:true,task_passed:true})]);
 const dashboard=await tech.call('/api/staff/lab/supplier-dashboard?supplier_id='+supplier.data.id);assert.equal(dashboard.status,200,JSON.stringify(dashboard.data));assert.equal(dashboard.data.models.length,1);assert.equal(dashboard.data.models[0].lifetime_calls,4);assert.equal(dashboard.data.models[0].lifetime_input,'40');assert.equal(dashboard.data.records.length,4);assert.equal(dashboard.data.scope,'platform_lab_only');
 assert.equal((await tech.call('/api/staff/lab/supplier-dashboard?supplier_id='+supplier.data.id+'&endpoint_id=11111111-1111-4111-8111-111111111111')).status,404);
 const savedFetch=global.fetch;
 await pool.query("UPDATE supplier_lab_credentials SET base_url='https://kerapi.cn/v1' WHERE id=$1",[key.data.id]);
 await pool.query("UPDATE supplier_lab_transactions SET upstream_request_id='fixture-'||case_id WHERE run_id=$1",[run.id]);
 global.fetch=async(url,options)=>{if(String(url)==='https://kerapi.cn/api/log/token')return new Response(JSON.stringify({success:true,data:ids.map(c=>({request_id:'fixture-'+c,model_name:'test-model',created_at:Math.floor(Date.now()/1000),type:2,prompt_tokens:10,completion_tokens:1,quota:1,other:JSON.stringify({cache_tokens:0,billing_amount:'0.000014',billing_currency:{code:'CNY'},authorization:'redact-me'})}))}),{status:200});return savedFetch(url,options)};
 try{
  assert.equal((await jar().call('/api/staff/lab/usage-reconciliation?supplier_id='+supplier.data.id)).status,401);
  const synced=await tech.call('/api/staff/lab/credentials/'+key.data.id+'/sync-usage',{method:'POST',body:{}});assert.equal(synced.status,200,JSON.stringify(synced.data));assert.equal(synced.data.record_count,4);
  const checked=await tech.call('/api/staff/lab/usage-reconciliation?supplier_id='+supplier.data.id);assert.equal(checked.status,200);assert.equal(checked.data.rows.length,4);assert.ok(checked.data.rows.every(r=>r.status==='matched'));assert.ok(!JSON.stringify(checked.data).includes('redact-me'));assert.ok(!JSON.stringify(checked.data).includes('fake-key-only-for-tests'));
  assert.equal((await tech.call('/api/staff/lab/credentials/'+key.data.id+'/sync-usage',{method:'POST',body:{}})).data.cached,true);
  assert.equal((await tech.call('/api/staff/observability/aliyun')).data.configured,false);
  assert.equal((await tech.call('/api/staff/observability/aliyun/configure',{method:'POST',body:{}})).status,403);
  assert.equal((await admin.call('/api/staff/observability/aliyun/configure',{method:'POST',body:{}})).status,400);
 }finally{global.fetch=savedFetch;await pool.query("UPDATE supplier_lab_credentials SET base_url='https://api.deepseek.com' WHERE id=$1",[key.data.id])}
 const bill=await tech.call('/api/staff/lab/reconciliations',{method:'POST',body:{endpoint_id:endpoint.data.id,period_start:new Date(Date.now()-11*60000).toISOString(),period_end:new Date(Date.now()-8*60000).toISOString(),supplier_billed_yuan:'0.000056',note:'upstream-statement-fixture'}});assert.equal(bill.status,201,JSON.stringify(bill.data));
 assert.equal((await tech.call('/api/staff/lab/endpoints/'+endpoint.data.id+'/rates',{method:'POST',body:{input_yuan_per_m:'2'}})).status,409);
 const report=await tech.call('/api/staff/lab/runs/'+run.id+'/handoff',{method:'POST',body:{endpoint_id:endpoint.data.id,reconciliation_id:bill.data.id}});assert.equal(report.status,201,JSON.stringify(report.data));assert.equal(report.data.conclusion,'passed');
 assert.ok((await admin.call('/api/staff/workspace/overview')).data.reports.some(r=>r.id===report.data.id&&r.lab_run_id===run.id));
 const product=await admin.call('/api/staff/model-products',{method:'POST',body:{offer_id:endpoint.data.offer_id,display_name:'Shared product',product_code:'shared-product'}});assert.equal(product.status,201);
 assert.equal((await admin.call('/api/staff/workspace/listings',{method:'POST',body:{product_id:product.data.id}})).status,409);
 // Fixtures emulate already-approved business documents; publisher still rechecks live references.
 await pool.query("UPDATE supplier_offer_checks SET result='documented',evidence_url='https://example.test/evidence',checked_at=now() WHERE offer_id=$1",[endpoint.data.offer_id]);
 const price=(await pool.query("INSERT INTO model_price_proposals(model_product_id,input_fen_per_million,output_fen_per_million,evidence_url,created_by) VALUES($1,100,400,'https://example.test/price','staff-owner') RETURNING id",[product.data.id])).rows[0];
 const review=(await pool.query("INSERT INTO model_product_reviews(model_product_id,offer_id,validation_run_id,price_proposal_id,status,requested_by,reviewed_by,decided_at) VALUES($1,$2,$3,$4,'internally_reviewed','staff-owner','staff-reviewer',now()) RETURNING id",[product.data.id,endpoint.data.offer_id,report.data.id,price.id])).rows[0];
 await pool.query("INSERT INTO model_price_decisions(price_proposal_id,product_review_id,status,notes,decided_by) VALUES($1,$2,'approved','Fixture price approved','staff-reviewer')",[price.id,review.id]);
 const listing=await admin.call('/api/staff/workspace/listings',{method:'POST',body:{product_id:product.data.id}});assert.equal(listing.status,201,JSON.stringify(listing.data));
 assert.equal((await tech.call('/api/staff/lab/releases/'+listing.data.id+'/publish',{method:'POST',body:{}})).status,200);
 assert.ok((await jar().call('/api/catalog/published')).data.products.some(p=>p.id===product.data.id));
 const rotateBody={label:'Replacement generation 2',api_key:'new-fake-key-tests-only',endpoint_ids:[endpoint.data.id]};
 assert.equal((await tech.call('/api/staff/lab/credentials/'+key.data.id+'/replacement',{method:'POST',body:{...rotateBody,endpoint_ids:['11111111-1111-4111-8111-111111111111']}})).status,400);
 const rotated=await tech.call('/api/staff/lab/credentials/'+key.data.id+'/replacement',{method:'POST',body:rotateBody});assert.equal(rotated.status,201,JSON.stringify(rotated.data));
 assert.ok(!JSON.stringify(rotated.data).includes('new-fake-key'));assert.equal(rotated.data.endpoints.length,1);
 const newEndpoint=rotated.data.endpoints[0].id;assert.notEqual(newEndpoint,endpoint.data.id);
 assert.equal((await pool.query('SELECT disabled_at FROM supplier_lab_credentials WHERE id=$1',[key.data.id])).rows[0].disabled_at,null);
 assert.equal((await tech.call('/api/staff/lab/credentials/'+key.data.id+'/replacement',{method:'POST',body:{...rotateBody,label:'Another'}})).status,409);
 assert.equal((await tech.call('/api/staff/lab/credentials/'+rotated.data.id+'/complete-replacement',{method:'POST',body:{}})).status,409);
 const validation=(await pool.query("INSERT INTO supplier_lab_runs(supplier_endpoint_id,case_ids,status,created_by,finished_at) VALUES($1,ARRAY['arithmetic'],'completed','technical-fixture',now()) RETURNING id",[newEndpoint])).rows[0];
 await pool.query(`INSERT INTO supplier_lab_transactions(run_id,endpoint_id,case_id,prompt_sha256,http_status,latency_ms,quality_score,checks) VALUES($1,$2,'arithmetic','fixture',200,150,100,'{"model_matches_request":true,"usage_present_and_consistent":true}')`,[validation.id,newEndpoint]);
 assert.equal((await tech.call('/api/staff/lab/credentials/'+rotated.data.id+'/complete-replacement',{method:'POST',body:{}})).status,200);
 assert.equal((await tech.call('/api/staff/lab/credentials/'+rotated.data.id+'/complete-replacement',{method:'POST',body:{}})).status,200);
 assert.ok((await pool.query('SELECT disabled_at FROM supplier_lab_credentials WHERE id=$1',[key.data.id])).rows[0].disabled_at);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM supplier_lab_transactions WHERE endpoint_id=$1',[endpoint.data.id])).rows[0].n,4);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM supplier_lab_transactions WHERE endpoint_id=$1',[newEndpoint])).rows[0].n,1);

 assert.ok(!(await jar().call('/api/catalog/published')).data.products.some(p=>p.id===product.data.id));
 assert.equal((await admin.call('/api/staff/members/technical-fixture/technical-access',{method:'PUT',body:{enabled:false}})).status,200);
 assert.equal((await tech.call('/api/staff/lab/config')).status,403);
 assert.equal((await jar().call('/api/staff/workspace/console')).location,'/api/staff/login?next=business');
});
test('alipay website pay credits the exact amount once, only after a signed confirmation',async()=>{
 const payer=await user('payer'),outsider=await user('outsider'),org=await organization(payer,'Payer Co');
 const balance=async()=>(await payer.j.call('/api/billing/personal')).data;
 const notify=async(params,signer=alipaySign)=>{const p={notify_time:'2026-11-11 10:00:00',notify_type:'trade_status_sync',notify_id:randomBytes(8).toString('hex'),app_id:appCfg.alipay.appId,seller_id:appCfg.alipay.sellerId,charset:'utf-8',version:'1.0',sign_type:'RSA2',...params};p.sign=signer(signContent(p,{skipSignType:true}));const r=await fetch(origin+'/api/payments/alipay/notify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','x-real-ip':'198.51.100.7'},body:new URLSearchParams(p).toString()});return {status:r.status,text:await r.text()};};
 // Page pay only builds a signed URL (no gateway round-trip); seed query/notify state from the order.
 const remember=async(orderId,amountYuan)=>{
  const o=(await pool.query('SELECT out_trade_no,qr_code FROM payment_orders WHERE id=$1',[orderId])).rows[0];
  const q=new URL(o.qr_code),biz=JSON.parse(q.searchParams.get('biz_content'));
  assert.equal(q.searchParams.get('method'),'alipay.trade.page.pay');assert.equal(biz.product_code,'FAST_INSTANT_TRADE_PAY');
  assert.equal(biz.total_amount,amountYuan);assert.equal(q.searchParams.get('notify_url'),origin+'/api/payments/alipay/notify');
  assert.ok(createVerify('RSA-SHA256').update(signContent(Object.fromEntries(q.searchParams))).verify(appKeys.publicKey,q.searchParams.get('sign'),'base64'));
  const trade={status:'WAIT_BUYER_PAY',amount:amountYuan,trade_no:'2026'+randomBytes(8).toString('hex'),notify:q.searchParams.get('notify_url')};
  alipayTrades.set(o.out_trade_no,trade);return {out:o.out_trade_no,trade};
 };
 // Allowlist gates the channel before merchant go-live.
 assert.deepEqual((await balance()).recharge.channels,[]);
 assert.equal((await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:1000,idempotency_key:'k'.repeat(20)}})).status,403);
 appCfg.alipay.allowedEmails.add(payer.email);
 assert.deepEqual((await balance()).recharge.channels,['alipay_f2f']);assert.equal((await balance()).payments_enabled,true);
 assert.equal((await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:499,idempotency_key:'a'.repeat(20)}})).status,400);
 assert.equal((await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:10.5,idempotency_key:'a'.repeat(20)}})).status,400);
 const created=await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:1000,idempotency_key:'first-order-key-0001'}});
 assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.order.status,'pending');
 assert.equal(created.data.order.qr_svg,null);assert.match(created.data.order.pay_url,/alipay\.trade\.page\.pay/);
 const again=await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:1000,idempotency_key:'first-order-key-0001'}});
 assert.equal(again.status,200);assert.equal(again.data.order.id,created.data.order.id);
 assert.equal((await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:2000,idempotency_key:'first-order-key-0001'}})).status,409);
 const orderId=created.data.order.id,{out,trade}=await remember(orderId,'10.00');
 assert.equal((await outsider.j.call('/api/billing/alipay-orders/'+orderId)).status,404);
 assert.equal((await payer.j.call('/api/billing/alipay-orders/'+orderId)).data.order.status,'pending');
 // Forged signature, wrong merchant and wrong amount never move money.
 const forger=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
 assert.equal((await notify({out_trade_no:out,trade_no:trade.trade_no,trade_status:'TRADE_SUCCESS',total_amount:'10.00'},c=>createSign('RSA-SHA256').update(c).sign(forger,'base64'))).text,'failure');
 assert.equal((await notify({out_trade_no:out,trade_no:trade.trade_no,trade_status:'TRADE_SUCCESS',total_amount:'10.00',seller_id:'2088999999999999'})).text,'failure');
 assert.equal((await notify({out_trade_no:out,trade_no:trade.trade_no,trade_status:'TRADE_SUCCESS',total_amount:'1000.00'})).text,'failure');
 assert.equal((await balance()).cash_balance_fen,'0');
 // Genuine notify credits once; replays and TRADE_FINISHED are idempotent.
 assert.deepEqual(await notify({out_trade_no:out,trade_no:trade.trade_no,trade_status:'TRADE_SUCCESS',total_amount:'10.00'}),{status:200,text:'success'});
 assert.equal((await notify({out_trade_no:out,trade_no:trade.trade_no,trade_status:'TRADE_SUCCESS',total_amount:'10.00'})).text,'success');
 assert.equal((await notify({out_trade_no:out,trade_no:trade.trade_no,trade_status:'TRADE_FINISHED',total_amount:'10.00'})).text,'success');
 let view=await balance();assert.equal(view.cash_balance_fen,'1000');assert.equal(view.total_recharged_fen,'1000');assert.equal(view.entries.length,1);assert.equal(view.entries[0].kind,'recharge');
 const paid=(await payer.j.call('/api/billing/alipay-orders/'+orderId)).data.order;assert.equal(paid.status,'paid');assert.equal(paid.pay_url,null);assert.equal(paid.qr_svg,null);
 // A lost notify is recovered by the polling query.
 const second=(await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:2550,idempotency_key:'second-order-key-002'}})).data.order,t2=await remember(second.id,'25.50');
 t2.trade.status='TRADE_SUCCESS';
 assert.equal((await payer.j.call('/api/billing/alipay-orders/'+second.id)).data.order.status,'paid');
 assert.equal((await payer.j.call('/api/billing/alipay-orders/'+second.id)).data.order.status,'paid');
 view=await balance();assert.equal(view.cash_balance_fen,'3550');assert.equal(view.entries.length,2);
 // Closed trades close the order without money.
 const third=(await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:800,idempotency_key:'third-order-key-0003'}})).data.order,t3=await remember(third.id,'8.00');
 assert.equal((await notify({out_trade_no:t3.out,trade_no:t3.trade.trade_no,trade_status:'TRADE_CLOSED',total_amount:'8.00'})).text,'success');
 assert.equal((await payer.j.call('/api/billing/alipay-orders/'+third.id)).data.order.status,'closed');assert.equal((await balance()).cash_balance_fen,'3550');
 // Enterprise recharge is for managers only and lands in the enterprise account.
 assert.equal((await outsider.j.call(`/api/billing/organizations/${org.id}/alipay-orders`,{method:'POST',body:{amount_fen:1000,idempotency_key:'org-order-key-00001'}})).status,403);
 const orgOrder=await payer.j.call(`/api/billing/organizations/${org.id}/alipay-orders`,{method:'POST',body:{amount_fen:1000,idempotency_key:'org-order-key-00001'}});assert.equal(orgOrder.status,201);
 assert.match(decodeURIComponent(orgOrder.data.order.pay_url),/#billing\/organization\//);
 const t4=await remember(orgOrder.data.order.id,'10.00');assert.equal((await notify({out_trade_no:t4.out,trade_no:t4.trade.trade_no,trade_status:'TRADE_SUCCESS',total_amount:'10.00'})).text,'success');
 assert.equal((await payer.j.call(`/api/billing/organizations/${org.id}`)).data.cash_balance_fen,'1000');assert.equal((await balance()).cash_balance_fen,'3550');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='billing.recharge.alipay_paid' AND subject_id=ANY($1)",[[orderId,second.id,orgOrder.data.order.id]])).rows[0].n,3);
});
test('wechat native recharge credits the exact amount once, only after a signed and decrypted confirmation',async()=>{
 const payer=await user('wx-payer'),outsider=await user('wx-outsider'),balance=async()=>(await payer.j.call('/api/billing/personal')).data;
 const create=(amount,key,j=payer.j)=>j.call('/api/billing/personal/wechat-orders',{method:'POST',body:{amount_fen:amount,idempotency_key:key}});
 const outOf=async orderId=>(await pool.query('SELECT out_trade_no FROM payment_orders WHERE id=$1',[orderId])).rows[0].out_trade_no;
 const paidResource=(out,t,over={})=>({appid:WX.appId,mchid:WX.mchId,out_trade_no:out,transaction_id:t.transaction_id,trade_type:'NATIVE',trade_state:'SUCCESS',amount:{total:t.total,payer_total:t.total,currency:'CNY'},...over});
 assert.equal((await create(1000,'wx-first-order-0001')).status,403,'channel stays closed outside the allow list');
 appCfg.wechat.allowedEmails.add(payer.email);
 assert.ok((await balance()).recharge.channels.includes('wechat_native'));
 const created=await create(1000,'wx-first-order-0001');assert.equal(created.status,201);assert.equal(created.data.order.provider,'wechat_native');assert.match(created.data.order.qr_svg,/^<svg/);
 assert.ok(wxCalls.every(c=>c.ok),'every gateway request carries a valid merchant signature');
 const out=await outOf(created.data.order.id),t=wxTrades.get(out);
 assert.equal(t.total,1000);assert.equal(t.notify,origin+'/api/payments/wechat/notify');assert.match(t.expire,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+08:00$/);
 assert.equal((await create(1000,'wx-first-order-0001')).status,200,'same key returns the same order');
 assert.equal((await outsider.j.call('/api/billing/payment-orders/'+created.data.order.id)).status,404);
 assert.equal((await payer.j.call('/api/billing/payment-orders/'+created.data.order.id)).data.order.status,'pending');
 // Forged signature, unknown key id, foreign merchant and wrong amount are all refused without crediting.
 assert.equal((await wxNotify('TRANSACTION.SUCCESS',paidResource(out,t),{key:wxMerchant.privateKey})).status,400);
 assert.equal((await wxNotify('TRANSACTION.SUCCESS',paidResource(out,t),{serial:'PUB_KEY_ID_OTHER'})).status,400);
 assert.equal((await wxNotify('TRANSACTION.SUCCESS',paidResource(out,t),{ts:String(Math.floor(Date.now()/1000)-3600)})).status,400,'stale notifies are refused');
 assert.equal((await wxNotify('TRANSACTION.SUCCESS',paidResource(out,t,{mchid:'1900000099'}))).status,400);
 assert.equal((await wxNotify('TRANSACTION.SUCCESS',paidResource(out,t,{amount:{total:1,payer_total:1,currency:'CNY'}}))).status,500);
 assert.equal((await balance()).cash_balance_fen,'0');
 // The real notify credits once; a replay is acknowledged but changes nothing.
 assert.equal((await wxNotify('TRANSACTION.SUCCESS',paidResource(out,t))).status,204);
 assert.equal((await wxNotify('TRANSACTION.SUCCESS',paidResource(out,t))).status,204);
 assert.equal((await balance()).cash_balance_fen,'1000');
 const paid=(await payer.j.call('/api/billing/payment-orders/'+created.data.order.id)).data.order;assert.equal(paid.status,'paid');assert.equal(paid.qr_svg,null);
 // Lost notify: the poll's active query credits it.
 const second=(await create(2550,'wx-second-order-002')).data.order,t2=wxTrades.get(await outOf(second.id));t2.state='SUCCESS';
 assert.equal((await payer.j.call('/api/billing/payment-orders/'+second.id)).data.order.status,'paid');
 assert.equal((await payer.j.call('/api/billing/payment-orders/'+second.id)).data.order.status,'paid');
 assert.equal((await balance()).cash_balance_fen,'3550');
 // Closed by WeChat: closed locally, nothing credited.
 const third=(await create(800,'wx-third-order-0003')).data.order;wxTrades.get(await outOf(third.id)).state='CLOSED';
 assert.equal((await payer.j.call('/api/billing/payment-orders/'+third.id)).data.order.status,'closed');
 // A WeChat result can never pay an Alipay order with the same number.
 appCfg.alipay.allowedEmails.add(payer.email);
 const ali=(await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:900,idempotency_key:'wx-cross-alipay-001'}})).data.order,aliOut=await outOf(ali.id);
 assert.equal((await wxNotify('TRANSACTION.SUCCESS',{appid:WX.appId,mchid:WX.mchId,out_trade_no:aliOut,transaction_id:'4200cross',trade_state:'SUCCESS',amount:{total:900,payer_total:900,currency:'CNY'}})).status,500);
 assert.equal((await balance()).cash_balance_fen,'3550');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='billing.recharge.wechat_paid' AND subject_id=ANY($1)",[[created.data.order.id,second.id]])).rows[0].n,2);
});
test('wechat pack refunds settle by signed notification and restore rejected reservations',async()=>{
 identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};revoked=false;const admin=jar();await staffLogin(admin);
 const buyer=await user('wx-refund-buyer');appCfg.wechat.allowedEmails.add(buyer.email);
 const order=(await buyer.j.call('/api/billing/personal/wechat-orders',{method:'POST',body:{amount_fen:3000,idempotency_key:'wx-refund-order-0001'}})).data.order;
 const o=(await pool.query('SELECT out_trade_no FROM payment_orders WHERE id=$1',[order.id])).rows[0];wxTrades.get(o.out_trade_no).state='SUCCESS';
 assert.equal((await buyer.j.call('/api/billing/payment-orders/'+order.id)).data.order.status,'paid');
 const ask=key=>admin.call(`/api/staff/payments/orders/${order.id}/refunds`,{method:'POST',body:{amount_fen:2550,reason:'退回剩余额度',idempotency_key:key}});
 wxRefundMode='reject';const rejected=await ask('wx-refund-reject-0001');wxRefundMode='ok';assert.equal(rejected.data.status,'failed');
 assert.equal((await buyer.j.call('/api/billing/personal')).data.list_credit_fen,'3000');
 wxRefundMode='processing';const pending=await ask('wx-refund-notify-0001');wxRefundMode='ok';assert.equal(pending.data.status,'pending');
 const n=(await pool.query('SELECT out_request_no FROM payment_refunds WHERE id=$1',[pending.data.refund_id])).rows[0].out_request_no;
 const notify=()=>wxNotify('REFUND.SUCCESS',{mchid:WX.mchId,out_trade_no:o.out_trade_no,out_refund_no:n,refund_status:'SUCCESS',amount:{total:3000,refund:2550}});
 assert.equal((await notify()).status,204);assert.equal((await notify()).status,204);
 assert.equal((await buyer.j.call('/api/billing/personal')).data.cash_balance_fen,'0');
 assert.equal((await admin.call(`/api/staff/payments/refunds/${pending.data.refund_id}/retry`,{method:'POST',body:{}})).data.status,'succeeded');assert.ok(wxCalls.every(c=>c.ok));
});

test('wechat pay client refuses unsigned or foreign-signed replies and decrypts resources',async()=>{
 const {wechatpayClient,decryptResource,beijingRfc3339}=await import('../src/wechatpay.mjs');
 const base={mchId:WX.mchId,appId:WX.appId,certSerial:WX.certSerial,privateKey:pem(wxMerchant.privateKey),publicKeyId:WX.publicKeyId,publicKey:pem(wxPlatform.publicKey),apiV3Key:wxApiV3Key};
 await assert.rejects(wechatpayClient(base,async()=>new Response('{"code":"SIGN_ERROR","message":"x"}',{status:401})).query('A1'),/WECHATPAY_UNSIGNED_401_SIGN_ERROR/);
 await assert.rejects(wechatpayClient(base,async()=>{const t='{"trade_state":"SUCCESS"}';return new Response(t,{headers:wxSign(t,{key:wxMerchant.privateKey})});}).query('A1'),/WECHATPAY_UNSIGNED_200/);
 await assert.rejects(wechatpayClient(base,async()=>new Response('busy',{status:503})).query('A1'),/WECHATPAY_HTTP_503/);
 assert.throws(()=>wechatpayClient({...base,apiV3Key:'short'}),/WECHATPAY_API_V3_KEY_LENGTH/);
 const nonce='abcdefabcdef',c=createCipheriv('aes-256-gcm',Buffer.from(wxApiV3Key),Buffer.from(nonce));c.setAAD(Buffer.from('ad'));
 const ciphertext=Buffer.concat([c.update('{"ok":1}'),c.final(),c.getAuthTag()]).toString('base64');
 assert.equal(decryptResource(Buffer.from(wxApiV3Key),{ciphertext,nonce,associated_data:'ad'}),'{"ok":1}');
 assert.throws(()=>decryptResource(Buffer.from(wxApiV3Key),{ciphertext,nonce,associated_data:'other'}));
 assert.equal(beijingRfc3339(new Date('2026-11-12T02:30:05Z')),'2026-11-12T10:30:05+08:00');
});
test('alipay helpers cut the signed response node verbatim and parse money strictly',async()=>{
 const {alipayClient}=await import('../src/alipay.mjs'),unsigned=alipayClient({appId:'x',privateKey:pem(appKeys.privateKey),publicKey:pem(alipayKeys.publicKey)},async()=>new Response('{"alipay_trade_query_response":{"code":"40003","msg":"Insufficient Conditions","sub_code":"isv.missing-signature-config"}}'));
 await assert.rejects(unsigned.query('A1'),/ALIPAY_UNSIGNED_40003_isv.missing-signature-config/);
 const raw='{"alipay_trade_query_response":{"code":"10000","msg":"Success","x":"a}\\"b"},"sign":"abc"}';
 assert.equal(responseNode(raw,'alipay.trade.query').content,'{"code":"10000","msg":"Success","x":"a}\\"b"}');
 assert.equal(responseNode('{"error_response":{"code":"40002"},"sign":""}','alipay.trade.query').node,'error_response');
 const {yuanToFen,fenToYuan,beijingTimestamp}=await import('../src/alipay.mjs');
 assert.equal(yuanToFen('10.00'),1000n);assert.equal(yuanToFen('10.5'),1050n);assert.equal(yuanToFen('10.001'),null);assert.equal(yuanToFen('-1'),null);assert.equal(fenToYuan(2550),'25.50');
 assert.equal(beijingTimestamp(new Date('2026-11-10T20:30:00Z')),'2026-11-11 04:30:00');
});
test('GLM reasoning effort is translated to values GLM accepts',()=>{
 const send=(model,effort,extra={})=>employeeRequest({model,messages:[{role:'user',content:'hi'}],reasoning_effort:effort,...extra}).payload;
 let p=send('glm-5.3','none',{thinking:{type:'enabled',clear_thinking:false}});assert.equal(p.reasoning_effort,'low','none becomes the lowest level, GLM cannot stop thinking');assert.deepEqual(p.thinking,{type:'enabled',clear_thinking:false});
 p=send('glm-5.3',undefined,{thinking:{type:'disabled'}});assert.equal(p.thinking,undefined,'thinking off is dropped for GLM');assert.equal(p.reasoning_effort,'low');
 assert.equal(send('glm-5.3','medium').reasoning_effort,'high');assert.equal(send('glm-5.3-flash','minimal').reasoning_effort,'low');assert.equal(send('glm-5.3','xhigh').reasoning_effort,'max');
 assert.equal(send('glm-5.3','low').reasoning_effort,'low');assert.equal(send('glm-5.3','weird').reasoning_effort,undefined);
 assert.equal(send('glm-5.3',undefined).thinking,undefined,'untouched when not sent');
 assert.equal(send('deepseek-flash','none').reasoning_effort,'none','other families pass through');
 const schema={type:'object',properties:{ok:{type:'boolean'}},required:['ok']};
 p=send('glm-5.3',undefined,{response_format:{type:'json_schema',json_schema:{name:'r',strict:true,schema}},messages:[{role:'system',content:'你是助手'},{role:'user',content:'hi'}]});
 assert.deepEqual(p.response_format,{type:'json_object'},'GLM gets json_object');assert.equal(p.messages.length,2);assert.match(p.messages[0].content,/^你是助手\n\n只输出一个 JSON 对象/);assert.ok(p.messages[0].content.includes(JSON.stringify(schema)),'schema carried in the instructions');
 p=send('glm-5.3-flash',undefined,{response_format:{type:'json_schema',json_schema:{name:'r',schema}}});assert.equal(p.messages[0].role,'system','system message added when there is none');assert.equal(p.messages.length,2);
 assert.equal(send('deepseek-flash',undefined,{response_format:{type:'json_schema',json_schema:{name:'r',schema}}}).response_format.type,'json_schema','DeepSeek keeps json_schema');
});
test('business console: finance switch, codes, CRM, invoices against paid money, discount approval, first-line replies',async()=>{
 identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};revoked=false;const admin=jar();await staffLogin(admin);
 identity={sub:'biz-fixture',email:'biz@example.test',name:'Biz',staff_approved:true};const biz=jar();await staffLogin(biz);
 assert.equal((await admin.call('/api/staff/members/biz-fixture',{method:'PATCH',body:{role:'operations',status:'active'}})).status,200);await staffLogin(biz);
 const post=(j,path,body={})=>j.call(path,{method:'POST',body});

 // Finance is a third switch: a business employee sees no revenue, cost, invoice or refund data.
 assert.deepEqual((await biz.call('/api/staff/workspace/access')).data,{business:true,technical:false,finance:false});
 for(const path of ['/api/staff/business/finance','/api/staff/business/invoices','/api/staff/business/supplier-payments','/api/staff/business/bank-transfers','/api/staff/payments/orders'])assert.equal((await biz.call(path)).status,403,path);
 const plain=(await biz.call('/api/staff/business/dashboard')).data;assert.equal(plain.finance,null);assert.equal(plain.counts.invoices_requested,undefined);assert.equal(plain.counts.bank_transfers_pending,undefined);assert.equal(plain.staff.finance,false);
 assert.equal((await biz.call('/api/staff/members/biz-fixture/finance-access',{method:'PUT',body:{enabled:true}})).status,403);
 const full=(await admin.call('/api/staff/business/dashboard')).data;assert.equal(full.finance.series.length,12);assert.equal(typeof full.counts.invoices_requested,'number');

 // Supplier codes: assigned on insert, one serial per year, never reused.
 const supplier=async name=>{const r=await post(admin,'/api/staff/suppliers',{display_name:name,legal_name:name+' Ltd',region:'CN',source_type:'official',service_type:'model_api'});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
 const s1=await supplier('Code One'),s2=await supplier('Code Two');
 assert.match(s1.code,/^S\d{2}-\d{3}$/);assert.equal(Number(s2.code.slice(4)),Number(s1.code.slice(4))+1);
 assert.equal((await post(biz,`/api/staff/business/suppliers/${s1.id}/contact`,{contact_name:'王经理',contact_phone:'010-1234',contact_email:'not-an-email'})).status,400);
 assert.equal((await post(biz,`/api/staff/business/suppliers/${s1.id}/contact`,{contact_name:'王经理',contact_phone:'010-1234',contact_email:'wang@example.test'})).status,200);
 assert.equal((await biz.call('/api/staff/business/suppliers')).data.suppliers.find(s=>s.id===s1.id).contact_name,'王经理');

 // Customer codes: every organization is an enterprise customer, every login a personal one; listing twice changes nothing.
 const buyer=await user('invoice-buyer'),outsider=await user('invoice-outsider'),org=await organization(buyer,'Invoice Co');
 const customers=async()=>(await biz.call('/api/staff/business/customers')).data.customers;
 const personal=(await customers()).find(c=>c.user_id===buyer.user.id),enterprise=(await customers()).find(c=>c.organization_id===org.id);
 assert.match(personal.code,/^P\d{2}-\d{5}$/);assert.match(enterprise.code,/^E\d{2}-\d{4}$/);assert.equal(enterprise.members,1);
 assert.equal((await customers()).find(c=>c.user_id===buyer.user.id).code,personal.code);

 // Light CRM: stage, de-duplicated tags, an owner who must be staff, and follow-up notes.
 assert.equal((await post(biz,'/api/staff/business/customers/'+enterprise.id,{stage:'vip',tags:[]})).status,400);
 assert.equal((await post(biz,'/api/staff/business/customers/'+enterprise.id,{stage:'key',tags:['高校'],owner_subject:'nobody'})).status,400);
 const profile=await post(biz,'/api/staff/business/customers/'+enterprise.id,{stage:'key',tags:['高校','高校','重点'],owner_subject:'biz-fixture'});
 assert.equal(profile.status,200);assert.deepEqual(profile.data.tags,['高校','重点']);
 assert.equal((await post(biz,`/api/staff/business/customers/${enterprise.id}/notes`,{body:'电话沟通了年度用量'})).status,201);
 const seen=(await biz.call('/api/staff/business/customers/'+enterprise.id)).data;
 assert.equal(seen.notes.length,1);assert.equal(seen.notes[0].created_by_name,'Biz');assert.equal(seen.customer.owner_name,'Biz');assert.equal(seen.members.length,1);assert.equal(seen.finance,null);
 assert.equal((await admin.call('/api/staff/business/customers/'+enterprise.id)).data.finance.invoice_limit.available_fen,0);

 // Invoices: a customer can only request against money actually paid.
 const invoices=()=>buyer.j.call('/api/billing/personal/invoices'),request=body=>post(buyer.j,'/api/billing/personal/invoices',{invoice_type:'general',title:'张三',email:buyer.email,...body});
 assert.equal((await invoices()).data.available_fen,'0');assert.equal((await request({amount_yuan:'10'})).status,409);
 appCfg.alipay.allowedEmails.add(buyer.email);
 const order=(await post(buyer.j,'/api/billing/personal/alipay-orders',{amount_fen:3000,idempotency_key:'invoice-order-key-0001'})).data.order;
 seedAlipayTrade((await pool.query('SELECT out_trade_no FROM payment_orders WHERE id=$1',[order.id])).rows[0].out_trade_no,'30.00').status='TRADE_SUCCESS';
 assert.equal((await buyer.j.call('/api/billing/alipay-orders/'+order.id)).data.order.status,'paid');
 assert.equal((await invoices()).data.available_fen,'3000');
 assert.equal((await request({amount_yuan:'10',invoice_type:'special',tax_number:'91110000MA01ABCD2X'})).status,400,'no special invoice for a personal account');
 assert.equal((await request({amount_yuan:'10.555'})).status,400);assert.equal((await request({amount_yuan:'10',tax_number:'bad'})).status,400);
 const first=await request({amount_yuan:'20'});assert.equal(first.status,201);assert.equal(first.data.status,'requested');
 assert.equal((await invoices()).data.available_fen,'1000');assert.equal((await request({amount_yuan:'20'})).status,409,'a pending request already holds the amount');
 // Enterprise invoices need a tax number and a manager; other customers see nothing.
 assert.equal((await outsider.j.call(`/api/billing/organizations/${org.id}/invoices`)).status,403);
 assert.equal((await post(buyer.j,`/api/billing/organizations/${org.id}/invoices`,{invoice_type:'general',title:'Invoice Co',email:buyer.email,amount_yuan:'1'})).status,400);
 // Finance records the result; business staff cannot.
 const issue=`/api/staff/business/invoices/${first.data.id}/issue`,number='26112000000012345678',day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
 assert.equal((await post(biz,issue,{invoice_number:number,issued_on:day})).status,403);
 assert.equal((await post(admin,issue,{invoice_number:'123',issued_on:day})).status,400);
 assert.equal((await post(admin,issue,{invoice_number:number,issued_on:day})).status,200);assert.equal((await post(admin,issue,{invoice_number:number,issued_on:day})).status,409);
 const mine=(await invoices()).data.items[0];assert.equal(mine.status,'issued');assert.equal(mine.invoice_number,number);assert.equal(mine.issued_day,day);
 const staffInvoice=body=>post(admin,'/api/staff/business/invoices',{direction:'output',customer_id:personal.id,invoice_type:'general',title:'张三',...body});
 assert.equal((await staffInvoice({amount_yuan:'50'})).status,409,'beyond what was paid');
 assert.equal((await staffInvoice({amount_yuan:'5',invoice_number:number,issued_on:day})).status,409,'duplicate invoice number');
 const ahead=await staffInvoice({amount_yuan:'50',allow_over_limit:true});assert.equal(ahead.status,201);assert.equal(ahead.data.status,'requested');
 assert.equal((await post(admin,`/api/staff/business/invoices/${ahead.data.id}/reject`,{note:'客户改为下月开'})).status,200);
 assert.equal((await post(admin,`/api/staff/business/invoices/${first.data.id}/reverse`,{note:'抬头有误，已红冲'})).status,200);
 assert.equal((await invoices()).data.available_fen,'3000','reversed and rejected invoices free the amount');
 assert.equal((await post(admin,'/api/staff/business/invoices',{direction:'input',supplier_id:s1.id,invoice_type:'special',title:'Code One Ltd',tax_number:'91110000MA01ABCD2X',amount_yuan:'100'})).status,400,'an input invoice needs its number');
 assert.equal((await post(admin,'/api/staff/business/invoices',{direction:'input',supplier_id:s1.id,invoice_type:'special',title:'Code One Ltd',tax_number:'91110000MA01ABCD2X',amount_yuan:'100',invoice_number:'26112000000087654321',issued_on:day})).status,201);

 // Supplier payments feed the cash view and can be voided, never deleted.
 const paid=await post(admin,'/api/staff/business/supplier-payments',{supplier_id:s1.id,amount_yuan:'12.34',paid_on:day,method:'bank',reference:'BANK-1'});assert.equal(paid.status,201);
 assert.equal((await post(admin,'/api/staff/business/supplier-payments',{supplier_id:s1.id,amount_yuan:'1',paid_on:'2999-01-01',method:'bank'})).status,400);
 const month=(await admin.call('/api/staff/business/finance')).data.current;
 assert.equal(month.cash.received>=30,true);assert.equal(Number(month.by_supplier.find(s=>s.id===s1.id).paid),12.34);assert.equal(month.balances.customer_cash>=30,true);
 const payables=(await admin.call('/api/staff/business/supplier-payments')).data.suppliers.find(s=>s.id===s1.id);assert.equal(payables.paid_fen,'1234');assert.equal(payables.invoiced_fen,'10000');
 assert.equal((await post(admin,`/api/staff/business/supplier-payments/${paid.data.id}/void`)).status,200);assert.equal((await post(admin,`/api/staff/business/supplier-payments/${paid.data.id}/void`)).status,409);
 assert.equal(Number((await admin.call('/api/staff/business/finance')).data.current.by_supplier.find(s=>s.id===s1.id).paid),0);
 assert.equal((await admin.call('/api/staff/business/finance?month=2026-13')).status,400);

 // Discount grants: staff propose, finance or the administrator decides, never the proposer.
 const grant=(j,body)=>post(j,'/api/staff/business/discounts',{name:'高校合作价',audience:'tag',tag:'高校',customer_price_percent:85,starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+30*86400000).toISOString(),reason:'年度合作',...body});
 assert.equal((await grant(biz,{customer_price_percent:100})).status,400);assert.equal((await grant(biz,{audience:'customer'})).status,404);
 const proposed=await grant(biz,{});assert.equal(proposed.status,201);assert.equal(proposed.data.status,'pending');
 assert.equal((await post(biz,`/api/staff/business/discounts/${proposed.data.id}/approve`)).status,403);
 assert.equal((await admin.call('/api/staff/members/biz-fixture/finance-access',{method:'PUT',body:{enabled:true}})).status,200);
 assert.equal((await biz.call('/api/staff/workspace/access')).data.finance,true);assert.equal((await biz.call('/api/staff/business/finance')).status,200);
 assert.equal((await post(biz,`/api/staff/business/discounts/${proposed.data.id}/approve`)).status,409,'the proposer cannot approve their own grant');
 assert.equal((await post(admin,`/api/staff/business/discounts/${proposed.data.id}/reject`)).status,400,'a rejection needs a reason');
 assert.equal((await post(admin,`/api/staff/business/discounts/${proposed.data.id}/approve`)).status,200);
 const direct=await grant(admin,{audience:'customer',customer_id:enterprise.id,model_id:'glm-5.3',cap_yuan:'500'});assert.equal(direct.data.status,'active');
 assert.equal((await grant(admin,{audience:'all',model_id:'no-such-model'})).status,400);
 const applicable=(await biz.call('/api/staff/business/customers/'+enterprise.id)).data.discounts;assert.equal(applicable.length,2,'by tag and by name');assert.equal(applicable.every(d=>d.state==='active'),true);
 assert.equal((await post(admin,`/api/staff/business/discounts/${direct.data.id}/revoke`)).status,200);assert.equal((await post(admin,`/api/staff/business/discounts/${direct.data.id}/revoke`)).status,409);
 const register=(await biz.call('/api/staff/business/discounts')).data;assert.equal(register.billing_connected,true);assert.equal(register.tags.find(t=>t.tag==='高校').customers,1);

 // First-line support: categories, reusable answers, replies the customer can read, hand-off to technical.
 assert.equal((await post(buyer.j,'/api/support/tickets',{subject:'怎么开发票',body:'充值后在哪里申请？',category:'tax'})).status,400);
 const ticket=(await post(buyer.j,'/api/support/tickets',{subject:'怎么开发票',body:'充值后在哪里申请？',category:'invoice'})).data;assert.equal(ticket.category,'invoice');
 const answer=await post(biz,'/api/staff/business/answers',{category:'invoice',question:'怎么申请发票？',answer:'在“账单 → 发票”里提交申请。',published:true});assert.equal(answer.status,201);
 assert.equal((await post(biz,'/api/staff/business/answers',{category:'invoice',question:'内部口径',answer:'仅内部',published:false})).status,201);
 assert.deepEqual((await buyer.j.call('/api/support/answers')).data.map(a=>a.question),['怎么申请发票？']);
 const reply=await post(biz,`/api/staff/business/tickets/${ticket.id}/reply`,{body:'在“账单 → 发票”里提交申请。',answer_id:answer.data.id});assert.equal(reply.data.status,'in_progress');
 assert.equal((await buyer.j.call('/api/support/tickets')).data[0].staff_note,'在“账单 → 发票”里提交申请。');
 assert.equal((await post(biz,`/api/staff/business/tickets/${ticket.id}/triage`,{category:'invoice',tier:'technical'})).status,200);
 const desk=(await biz.call('/api/staff/business/support')).data,row=desk.tickets.find(t=>t.id===ticket.id);
 assert.equal(row.replies.length,1);assert.equal(row.tier,'technical');assert.equal(row.customer_code,personal.code);assert.equal(desk.answers.find(a=>a.id===answer.data.id).use_count,1);
 assert.equal((await biz.call('/api/staff/business/dashboard')).data.counts.tickets_technical>=1,true);
 assert.equal((await post(biz,`/api/staff/business/tickets/${ticket.id}/reply`,{body:'已处理',close:true})).data.status,'closed');
 assert.equal((await post(biz,`/api/staff/business/tickets/${ticket.id}/reply`,{body:'再补一句'})).status,409);
 assert.equal((await post(biz,`/api/staff/business/answers/${answer.data.id}/archive`)).status,200);assert.deepEqual((await buyer.j.call('/api/support/answers')).data,[]);
});
test('business console helpers parse money, months and tags strictly',async()=>{
 const {fen,accountingMonth,tagList,invoiceable}=await import('../src/business-console.mjs');
 assert.equal(fen('12.5','金额'),1250);assert.equal(fen('0.01','金额'),1);
 for(const bad of ['0','-1','1.234','1e3','','abc',' 1,000'])assert.throws(()=>fen(bad,'金额'),/金额/,bad);
 assert.equal(accountingMonth(undefined,new Date('2026-12-31T16:30:00Z')),'2027-01','Beijing time decides the month');assert.equal(accountingMonth('2026-11'),'2026-11');
 for(const bad of ['2026-13','26-11','2026-1',202611])assert.throws(()=>accountingMonth(bad),/月份/);
 assert.deepEqual(tagList([' 高校 ','高校','重点']),['高校','重点']);assert.throws(()=>tagList(['a b']));assert.throws(()=>tagList('高校'));assert.throws(()=>tagList(Array(11).fill('x').map((x,i)=>x+i)));
 assert.equal(invoiceable({recharged_fen:'3000',refunded_fen:'500',invoiced_fen:'2000'}),500);
});
test('list-credit refund formula and dual-approval bank transfer',async()=>{
 const {refundCashFen,REFUND_POLICY_ZH}=await import('../src/list-credit.mjs');
 assert.match(REFUND_POLICY_ZH,/15%/);assert.match(REFUND_POLICY_ZH,/已开具销项发票/);
 assert.deepEqual(refundCashFen({faceFen:10000,cashPaidFen:3000,remainingFen:5000,hasIssuedInvoice:false}),{ok:true,grossFen:1500,feeFen:225,netFen:1275});
 assert.equal(refundCashFen({faceFen:10000,cashPaidFen:3000,remainingFen:5000,hasIssuedInvoice:true}).code,'invoice_blocks_refund');
 assert.equal(refundCashFen({faceFen:10000,cashPaidFen:3000,remainingFen:0,hasIssuedInvoice:false}).code,'nothing_to_refund');
 assert.equal(refundCashFen({faceFen:100,cashPaidFen:30,remainingFen:4,hasIssuedInvoice:false}).netFen,1);
 assert.equal(refundCashFen({faceFen:100,cashPaidFen:100,remainingFen:1,hasIssuedInvoice:false}).netFen,1);

 identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};revoked=false;const admin=jar();await staffLogin(admin);
 identity={sub:'finance-a',email:'finance-a@example.test',name:'Finance A',staff_approved:true};const fa=jar();await staffLogin(fa);
 identity={sub:'finance-b',email:'finance-b@example.test',name:'Finance B',staff_approved:true};const fb=jar();await staffLogin(fb);
 assert.equal((await admin.call('/api/staff/members/finance-a',{method:'PATCH',body:{role:'operations',status:'active'}})).status,200);
 assert.equal((await admin.call('/api/staff/members/finance-b',{method:'PATCH',body:{role:'operations',status:'active'}})).status,200);
 identity={sub:'finance-a',email:'finance-a@example.test',name:'Finance A',staff_approved:true};await staffLogin(fa);
 identity={sub:'finance-b',email:'finance-b@example.test',name:'Finance B',staff_approved:true};await staffLogin(fb);
 assert.equal((await admin.call('/api/staff/members/finance-a/finance-access',{method:'PUT',body:{enabled:true}})).status,200);
 assert.equal((await admin.call('/api/staff/members/finance-b/finance-access',{method:'PUT',body:{enabled:true}})).status,200);

 const buyer=await user('bank-xfer'),org=await organization(buyer,'Bank Xfer Co');
 await pool.query('SELECT ensure_customers()');
 const enterprise=(await fa.call('/api/staff/business/customers')).data.customers.find(c=>c.organization_id===org.id);
 assert.ok(enterprise);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
 const post=(j,path,body={})=>j.call(path,{method:'POST',body});
 assert.equal((await post(fa,'/api/staff/business/bank-transfers',{customer_id:enterprise.id,cash_yuan:'100',face_yuan:'50',received_on:day})).status,400,'face below cash');
 const reg=await post(fa,'/api/staff/business/bank-transfers',{customer_id:enterprise.id,cash_yuan:'40',face_yuan:'100',received_on:day,reference:'BT-1',note:'合同价'});
 assert.equal(reg.status,201,JSON.stringify(reg.data));assert.equal(reg.data.status,'pending');
 const pending=await fa.call('/api/staff/business/bank-transfers');assert.equal(pending.data.entries[0].id,reg.data.id);assert.match(pending.data.refund_policy,/15%/);
 assert.equal((await admin.call('/api/staff/business/dashboard')).data.counts.bank_transfers_pending>=1,true);
 assert.equal((await post(fa,`/api/staff/business/bank-transfers/${reg.data.id}/approve`)).status,403,'registrar cannot approve');
 const bal=async()=>{const a=(await pool.query('SELECT cash_balance_fen::int,list_credit_fen::int FROM billing_accounts WHERE organization_id=$1',[org.id])).rows[0];return a||{cash_balance_fen:0,list_credit_fen:0};};
 assert.deepEqual(await bal(),{cash_balance_fen:0,list_credit_fen:0},'pending does not credit');
 const ok=await post(fb,`/api/staff/business/bank-transfers/${reg.data.id}/approve`,{note:'流水已核对'});
 assert.equal(ok.status,200);assert.equal(ok.data.status,'approved');
 assert.deepEqual(await bal(),{cash_balance_fen:4000,list_credit_fen:10000});
 const view=await buyer.j.call(`/api/billing/organizations/${org.id}`);
 assert.equal(view.data.cash_balance_fen,'4000');assert.equal(view.data.list_credit_fen,'10000');assert.equal(view.data.total_recharged_fen,'4000');
 assert.equal((await post(fb,`/api/staff/business/bank-transfers/${reg.data.id}/approve`)).status,409);
 const other=await post(fa,'/api/staff/business/bank-transfers',{customer_id:enterprise.id,cash_yuan:'10',received_on:day,reference:'BT-2'});
 assert.equal(other.status,201);assert.equal(Number(other.data.face_fen),1000,'face defaults to cash');
 assert.equal((await post(fb,`/api/staff/business/bank-transfers/${other.data.id}/reject`,{note:'付款户名不符'})).status,200);
 assert.deepEqual(await bal(),{cash_balance_fen:4000,list_credit_fen:10000},'reject leaves balances');
});

test('ordinary customer: discounted purchase, signed payment, scoped key, shared gateway, precise usage and refund',async()=>{
 const {creditPaidOrder}=await import('../src/payments.mjs');
 const {settlePaidCall,refundQuote}=await import('../src/pack-ledger.mjs');
 identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};revoked=false;const admin=jar();await staffLogin(admin);
 const buyer=await user('paid-flow'),other=await user('paid-other');appCfg.alipay.allowedEmails.add(buyer.email);
 appCfg.customerPaid={enabled:true,models:['deepseek-flash']};
 await pool.query("UPDATE channel_states SET paused=false WHERE model_id='deepseek-flash'");
 const supplier=(await pool.query("INSERT INTO supplier_lab_suppliers(name,kind,created_by) VALUES('Paid fixture','supplier','staff-owner') RETURNING id")).rows[0].id;
 const cred=(await pool.query("INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by,priority) VALUES($1,'Paid key','https://kerapi.cn/v1',$2,'paid-unique','staff-owner',1) RETURNING id",[supplier,vault(process.env.SUPPLIER_LAB_SECRET).seal({key:'fake-paid-upstream'})])).rows[0].id;
 await pool.query("INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,created_by,supplier_id,credential_id) VALUES('Paid Flash','supplier','https://kerapi.cn/v1','deepseek-v4.1-flash','paid-unique','staff-owner',$1,$2)",[supplier,cred]);
 await pool.query('SELECT ensure_customers()');const customer=(await pool.query('SELECT id FROM customers WHERE user_id=$1',[buyer.user.id])).rows[0].id;
 const grant=async(percent,code=null)=>pool.query("INSERT INTO discount_grants(name,audience,customer_id,customer_price_percent,starts_at,ends_at,reason,status,created_by,promo_code) VALUES('pack-test','customer',$1,$2,now()-interval '1 hour',now()+interval '1 day','test','active','staff-owner',$3) RETURNING id",[customer,percent,code]);
 await grant(40);const best=(await grant(30,'PACK30')).rows[0].id;
 const post=(j,path,body={})=>j.call(path,{method:'POST',body});
 assert.equal((await post(buyer.j,'/api/billing/quote',{face_fen:10000})).data.amount_fen,4000);
 assert.equal((await post(buyer.j,'/api/billing/quote',{face_fen:10000,promo_code:'PACK30'})).data.amount_fen,3000);
 assert.equal((await post(other.j,'/api/billing/quote',{face_fen:10000,promo_code:'PACK30'})).status,400,'code cannot bypass audience');
 const before=await post(buyer.j,'/api/customer-credit/keys',{label:'before payment',models:['deepseek-flash'],limit_yuan:'10'});assert.equal(before.status,402);
 const buy=await post(buyer.j,'/api/billing/personal/alipay-orders',{face_fen:10000,promo_code:'PACK30',expected_cash_fen:3000,idempotency_key:'paid-flow-order-001'});assert.equal(buy.status,201,JSON.stringify(buy.data));assert.equal(buy.data.order.amount_fen,'3000');assert.equal(buy.data.order.face_fen,'10000');
 await pool.query("UPDATE discount_grants SET customer_price_percent=20 WHERE id=$1",[best]);
 const replay=await post(buyer.j,'/api/billing/personal/alipay-orders',{face_fen:10000,promo_code:'PACK30',idempotency_key:'paid-flow-order-001'});assert.equal(replay.data.order.id,buy.data.order.id);assert.equal(replay.data.order.amount_fen,'3000','price is frozen');
 const order=(await pool.query('SELECT * FROM payment_orders WHERE id=$1',[buy.data.order.id])).rows[0];
 const confirm={provider:'alipay_f2f',tradeNo:'fixture-paid-flow',totalFen:3000};
 await Promise.all([creditPaidOrder(pool,order.out_trade_no,confirm,'test'),creditPaidOrder(pool,order.out_trade_no,confirm,'test')]);
 const wallet=async()=>(await buyer.j.call('/api/billing/personal')).data;
 assert.equal((await wallet()).list_credit_fen,'10000');assert.equal((await wallet()).cash_balance_fen,'3000');assert.equal((await wallet()).packs.length,1);
 const made=await post(buyer.j,'/api/customer-credit/keys',{label:'my agent',models:['deepseek-flash'],limit_yuan:'100'});assert.equal(made.status,201,JSON.stringify(made.data));assert.match(made.data.secret,/^sf_paid_/);
 assert.equal((await post(other.j,'/api/customer-credit/keys/'+made.data.key.id+'/revoke')).status,404);
 const secret=made.data.secret,call=body=>buyer.j.call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+secret},body});
 pilotFetch=async()=>Response.json({id:'fixture-upstream-id',choices:[{message:{content:'ok'}}],usage:{prompt_tokens:1000,completion_tokens:10,prompt_tokens_details:{cached_tokens:100}}},{headers:{'x-request-id':'paid-request-1'}});
 const result=await call({model:'deepseek-flash',messages:[{role:'user',content:'hello'}],max_tokens:100});assert.equal(result.status,200,JSON.stringify(result.data));
 const calls=(await buyer.j.call('/api/customer-credit/status')).data.calls;assert.equal(calls.length,1);assert.equal(calls[0].status,'settled');assert.equal(calls[0].input_tokens,'1000');
 const paid=Number(calls[0].charged_yuan);assert.ok(paid>0);const previous=(await wallet()).list_credit_fen;
 await settlePaidCall(pool,calls[0].id,'99',null,'test',null,null);assert.equal((await wallet()).list_credit_fen,previous,'settlement is idempotent');
 assert.equal((await call({model:'glm-5.3',messages:[{role:'user',content:'no'}],max_tokens:10})).status,403);
 // Stream uses exactly the same forwarding handler and price snapshot.
 pilotFetch=async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'hi'}}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:10,completion_tokens:1}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream','x-request-id':'paid-request-2'}});
 assert.equal((await call({model:'deepseek-flash',stream:true,messages:[{role:'user',content:'hi'}],max_tokens:10})).status,200);
 // Unexpected supplier usage cannot exceed even a small key's remaining lifetime cap.
 const capped=await post(buyer.j,'/api/customer-credit/keys',{label:'small cap',models:['deepseek-flash'],limit_yuan:'1'});
 const excess=(await pool.query("INSERT INTO customer_calls(account_id,key_id,owner_id,model_id,price_snapshot,status,hold_yuan) VALUES($1,$2,$3,'deepseek-flash','{}','pending',0.01) RETURNING id",[order.account_id,capped.data.key.id,buyer.user.id])).rows[0].id;
 await settlePaidCall(pool,excess,'9',{input:1,output:1},'test',null,null);
 const cappedCall=(await pool.query('SELECT actual_yuan,charged_yuan FROM customer_calls WHERE id=$1',[excess])).rows[0];assert.equal(Number(cappedCall.actual_yuan),9);assert.equal(Number(cappedCall.charged_yuan),1);
 // Pending work blocks refunds. Reservations are also counted against the per-key cap.
 const account=(await pool.query('SELECT * FROM billing_accounts WHERE id=$1',[order.account_id])).rows[0];
 const reserved=(await pool.query("INSERT INTO customer_calls(account_id,key_id,owner_id,model_id,credential_id,price_snapshot,status,hold_yuan) VALUES($1,$2,$3,'deepseek-flash',$4,'{}','pending',99.999) RETURNING id",[account.id,made.data.key.id,buyer.user.id,cred])).rows[0].id;
 const pack=(await wallet()).packs[0];assert.match((await refundQuote(pool,pack.id)).blocked,/调用/);
 assert.equal((await call({model:'deepseek-flash',messages:[{role:'user',content:'hi'}],max_tokens:32768})).status,402);
 await pool.query("UPDATE customer_calls SET status='failed' WHERE id=$1",[reserved]);
 const q=await refundQuote(pool,pack.id);assert.equal(q.blocked,null);assert.ok(Number(q.net_fen)<2550&&Number(q.net_fen)>2500);
 const asked=await post(buyer.j,'/api/customer-credit/packs/'+pack.id+'/refund-request',{reason:'测试退款'});assert.equal(asked.status,200);
 assert.equal((await post(other.j,'/api/customer-credit/packs/'+pack.id+'/refund-request',{reason:'foreign'})).status,404);
 seedAlipayTrade(order.out_trade_no,'30.00').status='TRADE_SUCCESS';
 const refunded=await post(admin,`/api/staff/payments/orders/${order.id}/refunds`,{amount_fen:Number(q.net_fen),reason:'客户申请',idempotency_key:'paid-pack-refund-001'});assert.equal(refunded.data.status,'succeeded',JSON.stringify(refunded.data));
 assert.equal((await wallet()).list_credit_fen,'0');assert.equal((await wallet()).cash_balance_fen,'0');
 assert.equal((await call({model:'deepseek-flash',messages:[{role:'user',content:'hi'}],max_tokens:10})).status,402);
 await post(buyer.j,'/api/customer-credit/keys/'+made.data.key.id+'/revoke');assert.equal((await call({model:'deepseek-flash',messages:[{role:'user',content:'hi'}],max_tokens:10})).status,401);
 // Re-running migrations must not recreate refunded credit or restore spent amounts.
 await migrate(pool,service.auth);assert.equal((await wallet()).list_credit_fen,'0');assert.equal((await wallet()).packs.length,1);
 appCfg.customerPaid.enabled=false;pilotFetch=fetch;
});


test('payment rounding, actual channel cost isolation and audited admin waiver',async()=>{
 identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};revoked=false;const admin=jar();await staffLogin(admin);
 const buyer=await user('rounding-buyer');appCfg.alipay.allowedEmails.add(buyer.email);
 const order=(await buyer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{face_fen:500,idempotency_key:'rounding-order-key-001'}})).data.order;
 const o=(await pool.query('SELECT out_trade_no,account_id FROM payment_orders WHERE id=$1',[order.id])).rows[0];seedAlipayTrade(o.out_trade_no,'5.00').status='TRADE_SUCCESS';
 await buyer.j.call('/api/billing/alipay-orders/'+order.id);
 const pack=(await pool.query('SELECT id FROM credit_packs WHERE source_id=$1',[order.id])).rows[0];
 // Reproduce the real tiny-call remainder; no per-call penny rounding.
 await pool.query('UPDATE credit_packs SET remaining_fen=499.9959 WHERE id=$1',[pack.id]);await pool.query('UPDATE billing_accounts SET list_credit_fen=499.9959 WHERE id=$1',[o.account_id]);
 const wallet=async()=>(await buyer.j.call('/api/billing/personal')).data;
 assert.equal((await wallet()).list_credit_fen,'500');assert.equal((await wallet()).list_credit_exact_fen,'499.9959000000');
 const path='/api/staff/payments/orders/'+order.id;
 const quote=(await admin.call(path+'/refund-quote')).data;assert.equal(quote.net_fen,'425');
 const fee=body=>admin.call(path+'/channel-fee',{method:'POST',body});
 assert.equal((await buyer.j.call(path+'/channel-fee',{method:'POST',body:{amount_fen:3,version:0,evidence:'test statement'}})).status,401);
 assert.equal((await fee({amount_fen:3,version:0,evidence:'test statement row 1'})).status,200);
 assert.equal((await fee({amount_fen:3,version:0,evidence:'duplicate'})).status,409);
 assert.equal((await wallet()).cash_balance_fen,'500','channel fee never reduces customer money');
 const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());
 const finance=(await admin.call('/api/staff/business/finance?month='+month)).data;
 assert.ok(finance.current.accrual.channel_cost>=0.03);
 const listing=(await admin.call('/api/staff/payments/orders')).data;
 assert.equal(listing.customers.find(c=>c.email===buyer.email).transactions,1);
 assert.equal(listing.customers.find(c=>c.email===buyer.email).received_fen,'500');
 assert.equal((await admin.call(path+'/refund-quote?fee_percent=0')).data.net_fen,'500');
 assert.equal((await admin.call(path+'/refund-quote?fee_percent=-1')).status,400);
 assert.equal((await admin.call(path+'/refund-quote?fee_percent=5')).data.net_fen,'475');
 identity={sub:'fee-finance-fixture',email:'fee-finance@example.test',name:'Finance',staff_approved:true};const financeStaff=jar();await staffLogin(financeStaff);
 await admin.call('/api/staff/members/fee-finance-fixture',{method:'PATCH',body:{role:'operations',status:'active'}});
 await admin.call('/api/staff/members/fee-finance-fixture/finance-access',{method:'PUT',body:{enabled:true}});await staffLogin(financeStaff);
 assert.equal((await financeStaff.call(path+'/refund-quote')).status,200);
 assert.equal((await financeStaff.call(path+'/refund-quote?fee_percent=0')).status,403);
 assert.equal((await financeStaff.call(path+'/refunds',{method:'POST',body:{amount_fen:500,service_fee_percent:0,waiver_reason:'not authorised',reason:'test',idempotency_key:'not-authorised-waive'}})).status,403);

 assert.equal((await admin.call(path+'/refunds',{method:'POST',body:{amount_fen:500,service_fee_percent:0,reason:'test',idempotency_key:'waiver-missing-reason'}})).status,400);
 const body={amount_fen:500,service_fee_percent:0,waiver_reason:'acceptance goodwill',reason:'unused funds',idempotency_key:'waiver-rounding-000001'};
 const result=await admin.call(path+'/refunds',{method:'POST',body});assert.equal(result.data.status,'succeeded',JSON.stringify(result.data));
 assert.equal((await admin.call(path+'/refunds',{method:'POST',body})).data.refund_id,result.data.refund_id);
 const record=(await pool.query('SELECT * FROM payment_refunds WHERE id=$1',[result.data.refund_id])).rows[0];assert.equal(record.service_fee_percent,0);assert.equal(record.standard_net_fen,'425');assert.equal(record.waiver_reason,'acceptance goodwill');assert.equal(record.waiver_approved_by,'staff-owner');assert.ok(record.waiver_approved_at);
 assert.equal((await wallet()).cash_balance_fen,'0');assert.equal((await wallet()).list_credit_fen,'0');
 assert.equal((await admin.call(path+'/refunds',{method:'POST',body:{...body,service_fee_percent:15,amount_fen:425}})).status,409,'idempotency key cannot change approved terms');
 assert.equal((await fee({amount_fen:0,version:1,evidence:'statement correction: fee waived by channel'})).status,200);
 assert.equal((await fee({amount_fen:3,version:1,evidence:'stale correction'})).status,409);
 assert.equal((await fee({amount_fen:3,version:2,evidence:'corrected actual channel fee'})).status,200);

 assert.equal((await pool.query('SELECT channel_fee_fen FROM payment_orders WHERE id=$1',[order.id])).rows[0].channel_fee_fen,'3','refund does not erase actual channel cost');
});

test('Alipay statement reconciliation is idempotent, preserves manual corrections and customer credit',async()=>{
 identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};revoked=false;const admin=jar();await staffLogin(admin);
 const buyer=await user('bill-buyer');appCfg.alipay.allowedEmails.add(buyer.email);
 const order=(await buyer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{face_fen:500,idempotency_key:'bill-order-key-001'}})).data.order;
 let o=(await pool.query('SELECT * FROM payment_orders WHERE id=$1',[order.id])).rows[0];seedAlipayTrade(o.out_trade_no,'5.00').status='TRADE_SUCCESS';await buyer.j.call('/api/billing/alipay-orders/'+order.id);
 await pool.query("UPDATE payment_orders SET paid_at='2026-01-02 12:00:00+08' WHERE id=$1",[order.id]);
 o=(await pool.query('SELECT * FROM payment_orders WHERE id=$1',[order.id])).rows[0];
 const actor={kind:'system',id:'bill-test'},entry={trade:o.provider_trade_no,order:o.out_trade_no,kind:'交易',amount:500,fee:3,refund:''};
 const read=async()=>(await pool.query('SELECT * FROM payment_orders WHERE id=$1',[order.id])).rows[0];
 const balance=async()=>(await pool.query('SELECT cash_balance_fen,list_credit_fen FROM billing_accounts WHERE id=$1',[o.account_id])).rows[0];const before=await balance();
 const apply=async rows=>{const db=await pool.connect();try{await db.query('BEGIN');const r=await applyStatement(db,'2026-01-02',rows,'a'.repeat(64),actor);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}};
 assert.equal((await apply([entry])).matched,1);assert.equal((await read()).channel_fee_fen,'3');const version=(await read()).channel_fee_version;
 await apply([entry]);assert.equal((await read()).channel_fee_version,version);assert.deepEqual(await balance(),before);
 assert.equal((await apply([{...entry,trade:'wrong'}])).exceptions,1);assert.equal((await read()).channel_fee_fen,'3');
 assert.equal((await apply([{...entry,amount:501}])).exceptions,1);
 assert.equal((await apply([entry,entry])).exceptions,1);
 await apply([entry]);assert.equal((await read()).channel_fee_issue,null);

 await pool.query("INSERT INTO payment_refunds(order_id,out_request_no,amount_fen,reason,status,requested_by,idempotency_key,completed_at) VALUES($1,'bill-refund-example',425,'fixture','succeeded','test','bill-refund-example',now())",[o.id]);
 const refund={...entry,kind:'退款',amount:-425,fee:0,refund:'bill-refund-example'};
 assert.equal((await apply([entry,refund])).exceptions,0);assert.equal((await read()).channel_fee_fen,'3');
 assert.equal((await apply([entry,{...refund,fee:-1}])).exceptions,1);assert.match((await read()).channel_fee_issue,/退费/);assert.equal((await read()).channel_fee_fen,'3');
 assert.equal((await apply([entry,refund])).exceptions,0);
 const path='/api/staff/payments/orders/'+order.id+'/channel-fee';
 assert.equal((await admin.call(path,{method:'POST',body:{amount_fen:2,version,evidence:'manual statement adjustment'}})).status,200);
 assert.equal((await apply([entry])).exceptions,1);assert.equal((await read()).channel_fee_fen,'2');assert.equal((await read()).channel_fee_source,'manual');
 assert.equal((await apply([])).exceptions,1);assert.match((await read()).channel_fee_issue,/缺少/);
 assert.deepEqual(await balance(),before);
 assert.equal((await buyer.j.call('/api/staff/payments/alipay-bills/sync',{method:'POST',body:{day:'2026-01-02'}})).status,401);
 assert.equal((await admin.call('/api/staff/payments/alipay-bills/sync',{method:'POST',body:{day:'2999-01-01'}})).status,400);
 const missing=await syncAlipayBill(pool,{billDownloadUrl:async()=>({code:'40004',sub_code:'BILL_NOT_EXIST'})},'2026-01-02');assert.equal(missing.status,'pending');assert.equal((await read()).channel_fee_fen,'2');
 const unsafe=await syncAlipayBill(pool,{billDownloadUrl:async()=>({code:'10000',bill_download_url:'https://localhost/private'})},'2026-01-02');assert.equal(unsafe.error_code,'BILL_DOWNLOAD_HOST_REJECTED');assert.deepEqual(await balance(),before);
 const view=(await admin.call('/api/staff/payments/orders')).data;assert.ok(view.bill_sync.enabled);assert.equal(view.bill_sync.days.find(d=>d.day==='2026-01-02').status,'pending');
});
