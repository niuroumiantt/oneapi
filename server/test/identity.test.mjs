import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createServer } from 'node:http';
import { randomBytes,createHash,generateKeyPairSync,createSign } from 'node:crypto';
import { signContent,responseNode } from '../src/alipay.mjs';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair,exportJWK,SignJWT } from 'jose';
import { createApp } from '../src/app.mjs';
import { GRANT_YUAN,holdYuan,employeeRequest,usageFrom,settleEmployeeCalls,callClient,callSummary } from '../src/employee-credit.mjs';
import { vault,hasBusiness } from '../src/core.mjs';
import { findOfficialModel,officialPeak } from '../src/official-models.mjs';
import { migrate } from '../src/migrate.mjs';
import { config } from '../src/core.mjs';
// Fake Alipay gateway: verifies our RSA2 request signature and signs responses with its own key.
const appKeys=generateKeyPairSync('rsa',{modulusLength:2048}),alipayKeys=generateKeyPairSync('rsa',{modulusLength:2048}),alipayTrades=new Map(),alipayCalls=[];
let alipayRefundMode='ok';
const pem=k=>k.export({type:k.type==='private'?'pkcs8':'spki',format:'pem'}),alipaySign=content=>createSign('RSA-SHA256').update(content).sign(alipayKeys.privateKey,'base64');
async function fakeAlipay(_url,init){const p=Object.fromEntries(new URLSearchParams(init.body));const ok=(await import('node:crypto')).createVerify('RSA-SHA256').update(signContent(p)).verify(appKeys.publicKey,p.sign,'base64');alipayCalls.push({method:p.method,ok});const biz=JSON.parse(p.biz_content),node=p.method.replaceAll('.','_')+'_response';let data;
 if(!ok)data={code:'40002',msg:'Invalid Arguments',sub_code:'isv.invalid-signature'};
 else if(p.method==='alipay.trade.precreate'){alipayTrades.set(biz.out_trade_no,{status:'WAIT_BUYER_PAY',amount:biz.total_amount,trade_no:'2026'+randomBytes(8).toString('hex'),notify:p.notify_url});data={code:'10000',msg:'Success',out_trade_no:biz.out_trade_no,qr_code:'https://qr.alipay.com/bax'+randomBytes(6).toString('hex')};}
 else if(p.method==='alipay.trade.refund'){if(alipayRefundMode==='timeout')throw Error('simulated network timeout');const t=alipayTrades.get(biz.out_trade_no);
  if(alipayRefundMode==='reject'||!t)data={code:'40004',msg:'Business Failed',sub_code:t?'ACQ.SELLER_BALANCE_NOT_ENOUGH':'ACQ.TRADE_NOT_EXIST'};
  else{t.requests??=new Map();const fen=Math.round(Number(biz.refund_amount)*100),fresh=!t.requests.has(biz.out_request_no);if(fresh){t.requests.set(biz.out_request_no,fen);t.refundedFen=(t.refundedFen||0)+fen;}data={code:'10000',msg:'Success',out_trade_no:biz.out_trade_no,trade_no:t.trade_no,refund_fee:(t.refundedFen/100).toFixed(2),fund_change:fresh?'Y':'N'};}}
 else{const t=alipayTrades.get(biz.out_trade_no);data=t&&t.status!=='NOT_PAID_YET'?{code:'10000',msg:'Success',out_trade_no:biz.out_trade_no,trade_no:t.trade_no,trade_status:t.status,total_amount:t.amount}:{code:'40004',msg:'Business Failed',sub_code:'ACQ.TRADE_NOT_EXIST'};}
 const content=JSON.stringify(data);return new Response(`{"${node}":${content},"sign":"${alipaySign(content)}"}`,{headers:{'Content-Type':'application/json'}});}
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
 appCfg=cfg;cfg.pilotFetch=(...args)=>pilotFetch(...args);
 service=createApp(pool,cfg,{sendMail:async m=>{sent.push(m);return {};},verify:async()=>true});await migrate(pool,service.auth);await pool.query('TRUNCATE "user",staff_members,staff_oidc_states,mail_outbox,request_limits,"rateLimit" CASCADE');appServer.on('request',service.app);
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
 {const before=(await owner.j.call('/api/platform/me')).data;assert.equal(before.personal_assets,false);const key=(await pool.query("INSERT INTO pilot_api_keys(owner_id,label,secret_hash,key_hint,model_id) VALUES($1,'personal-assets-check','personal-assets-check-hash','hint','deepseek-flash') RETURNING id",[before.user.id])).rows[0].id;assert.equal((await owner.j.call('/api/platform/me')).data.personal_assets,true);await pool.query('DELETE FROM pilot_api_keys WHERE id=$1',[key]);}
 const fresh=jar();for(const [k,v]of owner.j.cookies)fresh.cookies.set(k,v);assert.equal((await fresh.call(`/api/platform/organizations/${orgA.id}`)).data.organization.name,'Company A');
});
test('staff pages load the same table sorter as the customer site',async()=>{
 assert.equal(await readFile(new URL('../private/table-sort.js',import.meta.url),'utf8'),await readFile(new URL('../../web/table-sort.js',import.meta.url),'utf8'));
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
 const personal=await owner.j.call('/api/billing/personal');assert.equal(personal.status,200);assert.equal(personal.data.scope,'personal');assert.equal(personal.data.cash_balance_fen,'0');assert.equal(personal.data.total_recharged_fen,'0');assert.deepEqual(personal.data.entries,[]);assert.deepEqual(personal.data.usage_by_model,[]);assert.equal(personal.data.recharge.enabled,false);assert.equal(personal.data.recharge.minimum_fen,500);assert.equal(personal.data.bank_transfer,undefined);
 const org=await owner.j.call(`/api/billing/organizations/${orgA.id}`);assert.equal(org.status,200);assert.equal(org.data.scope,'organization');assert.equal(org.data.cash_balance_fen,'0');assert.equal(org.data.refund.enabled,false);assert.equal(org.data.bank_transfer.enabled,true);assert.equal(org.data.bank_transfer.account_number,'0000000000000000');
 assert.equal((await other.j.call(`/api/billing/organizations/${orgA.id}`)).status,403);
 assert.equal((await owner.j.call(`/api/billing/organizations/${orgB.id}`)).status,403);
 assert.equal((await owner.j.call('/api/billing/personal',{method:'POST',body:{amount_fen:500}})).status,404);
 assert.equal((await owner.j.call('/api/billing/recharge',{method:'POST',body:{amount_fen:500}})).status,404);
 const accountId=(await pool.query('INSERT INTO billing_accounts(owner_id,cash_balance_fen,total_spent_fen) VALUES($1,1200,300) RETURNING id',[owner.user.id])).rows[0].id;
 await pool.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'recharge',500,500,'payment','test-payment-1'),($1,'recharge',1000,1500,'payment','test-payment-2'),($1,'usage',-300,1200,'usage','test-usage-1')",[accountId]);
 const funded=await owner.j.call('/api/billing/personal');assert.equal(funded.data.total_recharged_fen,'1500');assert.equal(funded.data.total_spent_fen,'300');assert.equal(funded.data.cash_balance_fen,'1200');assert.equal(funded.data.entries.length,3);
 assert.equal((await other.j.call('/api/billing/personal')).data.total_recharged_fen,'0');
 const orgAccountId=(await pool.query('INSERT INTO billing_accounts(organization_id,cash_balance_fen,total_spent_fen) VALUES($1,2200,300) RETURNING id',[orgA.id])).rows[0].id;
 await pool.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'recharge',2500,2500,'payment','test-org-payment-1'),($1,'usage',-300,2200,'usage','test-org-usage-1')",[orgAccountId]);
 const fundedOrg=await owner.j.call(`/api/billing/organizations/${orgA.id}`);assert.equal(fundedOrg.data.total_recharged_fen,'2500');assert.equal(fundedOrg.data.total_spent_fen,'300');assert.equal(fundedOrg.data.cash_balance_fen,'2200');
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
test('personal pilot keys are scoped, hashed, capped and record real upstream usage',async()=>{
 pilotDir=await mkdtemp(join(tmpdir(),'oneapi-pilot-'));
 const keyFile=join(pilotDir,'upstream-key');await writeFile(keyFile,'fixture-upstream-secret\n',{mode:0o600});
 appCfg.pilot.keyFile=keyFile;appCfg.pilot.emails.add(owner.email);
 pilotFetch=async(url,options)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions');
  assert.equal(options.headers.Authorization,'Bearer fixture-upstream-secret');
  const payload=JSON.parse(options.body);
  assert.ok(['deepseek-flash','deepseek-v4-pro'].includes(payload.model));
  assert.equal(payload.thinking.type,'disabled');
  return new Response(JSON.stringify({id:'fixture-call',model:payload.model,choices:[{message:{role:'assistant',content:'OK'},finish_reason:'stop'}],usage:{prompt_tokens:7,prompt_cache_hit_tokens:2,completion_tokens:1}}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 assert.equal((await jar().call('/api/pilot/status')).status,401);
 assert.equal((await other.j.call('/api/pilot/status')).data.enabled,false);
 assert.equal((await other.j.call('/api/pilot/keys',{method:'POST',body:{label:'Unauthorized'}})).status,403);
 assert.equal((await owner.j.call('/api/pilot/keys',{method:'POST',body:{label:'No model',confirm_model:true}})).status,400);
 assert.equal((await owner.j.call('/api/pilot/keys',{method:'POST',body:{label:'No confirmation',model_id:'deepseek-v4-pro'}})).status,400);
 const created=await owner.j.call('/api/pilot/keys',{method:'POST',body:{label:'My Agent',model_id:'deepseek-flash',confirm_model:true}});
 assert.equal(created.status,201,JSON.stringify(created.data));
 assert.equal(created.data.key.model_id,'deepseek-flash');
 const secret=created.data.secret;assert.match(secret,/^sf_test_[A-Za-z0-9_-]{43}$/);
 const stored=(await pool.query('SELECT secret_hash FROM pilot_api_keys WHERE id=$1',[created.data.key.id])).rows[0];
 assert.notEqual(stored.secret_hash,secret);assert.equal(stored.secret_hash,createHash('sha256').update(secret).digest('hex'));
 assert.equal((await owner.j.call('/api/pilot/status')).data.keys[0].secret,undefined);
 const spentBefore=(await owner.j.call('/api/billing/personal')).data.total_spent_fen;
 const call=()=>owner.j.call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+secret},body:{model:'deepseek-flash',messages:[{role:'user',content:'Reply OK'}],max_tokens:16}});
 assert.equal((await call()).status,200);
 const proCreated=await owner.j.call('/api/pilot/keys',{method:'POST',body:{label:'Reasoning Agent',model_id:'deepseek-v4-pro',confirm_model:true}});
 assert.equal(proCreated.status,201,JSON.stringify(proCreated.data));
 assert.equal(proCreated.data.key.model_id,'deepseek-v4-pro');
 const proSecret=proCreated.data.secret;
 const proCall=()=>owner.j.call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+proSecret},body:{model:'deepseek-v4-pro',messages:[{role:'user',content:'Reply OK'}],max_tokens:16}});
 assert.equal((await owner.j.call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+secret},body:{model:'deepseek-v4-pro',messages:[{role:'user',content:'No'}]}})).status,403);
 assert.equal((await proCall()).status,200);
 const status=(await owner.j.call('/api/pilot/status')).data;
 assert.deepEqual(status.model_ids,['deepseek-flash','deepseek-v4-pro']);
 assert.equal(status.calls_today,2);assert.equal(status.recent_calls[0].model_id,'deepseek-v4-pro');assert.equal(status.recent_calls[0].input_tokens,7);assert.equal(status.recent_calls[0].cache_hit_tokens,2);assert.equal(Number(status.recent_calls[0].estimated_upstream_yuan),0.0000726);
 assert.equal(status.usage_window_days,30);
 assert.deepEqual(status.usage_by_model.map(row=>[row.model_id,row.successful_calls,Number(row.input_tokens),Number(row.cache_hit_tokens)]),[['deepseek-flash',1,7,2],['deepseek-v4-pro',1,7,2]]);
 assert.equal(status.usage_by_key.length,2);
 assert.equal(status.usage_by_key.find(row=>row.key_id===created.data.key.id).successful_calls,1);
 assert.equal(status.usage_chart.billing_state,'pilot_not_billed');
 assert.equal(status.usage_chart.rows.reduce((n,r)=>n+Number(r.input_tokens),0),14);
 assert.equal(status.usage_chart.rows.reduce((n,r)=>n+Number(r.output_tokens),0),2);
 assert.equal(status.recent_calls[0].key_label,'Reasoning Agent');
 assert.equal(status.recent_calls[0].secret,undefined);
 assert.equal((await owner.j.call('/api/billing/personal')).data.total_spent_fen,spentBefore);
 assert.equal((await owner.j.call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+secret},body:{model:'deepseek-flash',stream:true,messages:[{role:'user',content:'No'}]}})).status,400);
 for(let n=2;n<10;n++)assert.equal((await call()).status,200);
 assert.equal((await call()).status,429);
 assert.equal((await owner.j.call('/api/pilot/keys/'+created.data.key.id+'/revoke',{method:'POST',body:{}})).status,200);
 assert.equal((await call()).status,401);
 assert.equal((await owner.j.call('/api/pilot/keys/'+proCreated.data.key.id+'/revoke',{method:'POST',body:{}})).status,200);
 assert.equal((await proCall()).status,401);
});
test('employee credit is one-time, company-only, reserved before calling and charged at official prices',async()=>{
 const rate={input:'2',cached:'0.5',output:'8'};
 assert.equal(holdYuan(rate,{input:1000,cached:400,output:100},1),'0.002200000000');assert.equal(holdYuan(rate,{input:1000,cached:400,output:100},2),'0.004400000000');
 assert.equal(officialPeak(new Date('2026-11-10T02:00:00Z')),true,'Tuesday 10:00 Beijing');assert.equal(officialPeak(new Date('2026-11-10T04:30:00Z')),false,'Tuesday 12:30 Beijing');assert.equal(officialPeak(new Date('2026-11-14T02:00:00Z')),false,'Saturday');assert.equal(officialPeak(new Date('2026-11-10T02:00:00Z'),new Set(['2026-11-10'])),false,'holiday');
 assert.equal(findOfficialModel('deepseek-v4.1-flash').id,'deepseek-flash');assert.equal(findOfficialModel('GLM-5.3').id,'glm-5.3');assert.equal(findOfficialModel('nope'),undefined);
 assert.throws(()=>employeeRequest({model:'x',messages:[{}]}),/未开放/);assert.equal(employeeRequest({model:'glm-5.3',messages:[{role:'user',content:'a'}]}).payload.model,'GLM-5.3');
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
 appCfg.employeeCredit.organizationId=company.id;
 assert.equal((await outsider.j.call('/api/employee-credit/status')).data.enabled,false);
 assert.equal((await outsider.j.call('/api/employee-credit/keys',{method:'POST',body:{label:'No'}})).status,403);
 for(let i=0;i<2;i++){const s=(await staffer.j.call('/api/employee-credit/status')).data;assert.equal(s.enabled,true);assert.equal(s.max_output_tokens,8192);assert.ok(s.base_url.endsWith('/v1'));assert.equal(Number(s.available_yuan),10);assert.deepEqual(s.model_ids,['deepseek-flash','deepseek-v4-pro','glm-5.3']);assert.equal(s.models[2].input_yuan,'8');}
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
 // Only one of two concurrent calls fits, and the upstream is never asked for the other.
 usage={prompt_tokens:1,completion_tokens:1};pilotFetch=async()=>{await new Promise(r=>setTimeout(r,120));return reply();};
 const room=holdYuan({input:'8',cached:'2',output:'28'},{input:Buffer.byteLength(JSON.stringify({messages:glmBody.messages})),output:100},1);
 await pool.query('UPDATE employee_credit_accounts SET spent_yuan=granted_yuan-$2::numeric WHERE user_id=$1',[staffer.user.id,room]);
 const racing=await Promise.all([call(),call()]);assert.deepEqual(racing.map(r=>r.status).sort(),[200,402]);
 // Usage above the bound never overdraws, and the true price is kept.
 await pool.query('UPDATE employee_credit_accounts SET spent_yuan=granted_yuan-$2::numeric WHERE user_id=$1',[staffer.user.id,room]);
 usage={prompt_tokens:5000000,completion_tokens:1};pilotFetch=async()=>reply();assert.equal((await call()).status,200);
 s=await status();assert.equal(Number(s.available_yuan),0);assert.equal(s.spent_yuan,s.granted_yuan);
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
     const savedIdentity=identity;identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};const ops=jar();await staffLogin(ops);identity=savedIdentity;
     const ov=await ops.call('/api/staff/lab/overview');assert.equal(ov.status,200,JSON.stringify(ov.data));assert.ok(ov.data.credentials.some(c=>c.id===credential&&c.failed_24h>=1));assert.ok(ov.data.models.some(m=>m.id==='deepseek-flash'&&m.routed&&m.fallbacks.length>=1));assert.ok(Array.isArray(ov.data.risks));
     assert.equal((await ops.call('/api/staff/lab/credentials/'+standby+'/priority',{method:'POST',body:{role:'primary'}})).status,200);assert.equal((await pool.query('SELECT priority FROM supplier_lab_credentials WHERE id=$1',[credential])).rows[0].priority,2,'the old primary becomes standby');
     assert.equal((await ops.call('/api/staff/lab/credentials/'+standby+'/priority',{method:'POST',body:{role:'boss'}})).status,400);assert.equal((await staffer.j.call('/api/staff/lab/overview')).status,401);
     {const wb=(body)=>jar().call('/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+created.data.secret,'User-Agent':'WorkBuddy/1.2'},body:{model:'deepseek-flash',messages:[{role:'system',content:'secret project notes'},{role:'user',content:'private question'}],...body}});
      assert.equal((await wb({max_tokens:16,tools:[{type:'function',function:{name:'read_file',parameters:{type:'object'}}}]})).status,200);
      assert.equal((await wb({max_tokens:32768})).status,400,'over the output cap is rejected by the gateway');
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
      assert.equal(cell('basic').status,'pass');assert.equal(cell('out_32k').status,'fail');assert.match(cell('out_32k').note,/网关拒绝/);assert.equal(cell('thinking_on').status,'partial');
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
   assert.equal((await wb({max_tokens:32768})).status,400,'gateway rejects 32K output');await settle();
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
 assert.equal((await staffer.j.call('/api/employee-credit/keys/'+created.data.key.id+'/revoke',{method:'POST',body:{}})).status,200);assert.equal((await call()).status,401);
 appCfg.employeeCredit.organizationId='';
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
 let biz=(await admin.call('/api/staff/workspace/business')).data;let request=biz.upgrades.find(x=>x.email===u.user.email);assert.equal(request.status,'pending');assert.equal(biz.models.length,6);
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
 assert.equal((await admin.call('/api/staff/tickets/'+ticket.data.id,{method:'POST',body:{status:'bad'}})).status,400);assert.equal((await admin.call('/api/staff/tickets/'+ticket.data.id,{method:'POST',body:{status:'closed',staff_note:'已恢复'}})).status,200);assert.equal((await other.j.call('/api/support/tickets')).data[0].staff_note,'已恢复');
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
   let v=(await admin.call('/api/staff/lab/feature-compare')).data;assert.equal(v.features.length,16);
   const ours=v.models.find(m=>m.id==='glm-5.3');assert.equal(ours.reference.model_id,'GLM-5.3','paired by id');assert.equal(v.models.find(m=>m.id==='deepseek-flash').reference.model_id,'deepseek-official','paired by family when ids differ');
   assert.equal((await admin.call('/api/staff/lab/feature-compare/pairs',{method:'PUT',body:{our_model:'glm-5.3',reference_endpoint_id:ours.candidates.find(c=>c.model_id==='GLM-5.3-Flash').id}})).status,200);
   assert.equal((await admin.call('/api/staff/lab/feature-compare')).data.models.find(m=>m.id==='glm-5.3').reference.model_id,'GLM-5.3-Flash','override saved');
   assert.equal((await admin.call('/api/staff/lab/feature-compare/pairs',{method:'PUT',body:{our_model:'glm-5.3',reference_endpoint_id:null}})).status,200);assert.equal((await admin.call('/api/staff/lab/feature-compare/pairs',{method:'PUT',body:{our_model:'glm-5.3',reference_endpoint_id:v.models.find(m=>m.id==='deepseek-flash').reference.endpoint_id}})).status,400,'cross-family pairing refused');
   const started=await admin.call('/api/staff/lab/feature-compare/runs',{method:'POST',body:{models:['glm-5.3'],skip_long:true}});assert.equal(started.status,202,JSON.stringify(started.data));assert.equal(started.data.probes,14);
   for(let i=0;i<100;i++){v=(await admin.call('/api/staff/lab/feature-compare')).data;if(v.run.status!=='running')break;await new Promise(r=>setTimeout(r,30));}
   assert.equal(v.run.status,'completed');assert.equal(v.run.done,14);const cells=v.cells['glm-5.3'];
   assert.equal(cells.basic.outcome,'same');assert.equal(cells.json.outcome,'gap');assert.equal(cells.thinking_off.outcome,'extra');assert.equal(cells.out_32k.outcome,'neither');assert.equal(cells.ctx_128k,undefined,'long context skipped');
   assert.equal(cells.json.official.status,'pass');assert.equal(cells.json.ours.status,'partial');assert.ok(!JSON.stringify(cells).includes('sk-glm-three'),'official key never stored');
   assert.equal((await jar().call('/api/staff/lab/feature-compare')).status,401);
  }finally{pilotFetch=saved;}}
});
test('staff refunds go back to the payer once, hold the balance first and reverse rejections',async()=>{
 identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true};revoked=false;const admin=jar();await staffLogin(admin);
 const buyer=await user('refund-buyer');appCfg.alipay.allowedEmails.add(buyer.email);
 const order=(await buyer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:3000,idempotency_key:'refund-order-key-0001'}})).data.order;
 const out=(await pool.query('SELECT out_trade_no,account_id FROM payment_orders WHERE id=$1',[order.id])).rows[0],trade=alipayTrades.get(out.out_trade_no);trade.status='TRADE_SUCCESS';
 assert.equal((await buyer.j.call('/api/billing/alipay-orders/'+order.id)).data.order.status,'paid');
 const bal=async()=>(await buyer.j.call('/api/billing/personal')).data.cash_balance_fen,path=`/api/staff/payments/orders/${order.id}/refunds`;
 const ask=(amount,key,reason='客户申请退款')=>admin.call(path,{method:'POST',body:{amount_fen:amount,reason,idempotency_key:key}});
 assert.equal(await bal(),'3000');
 assert.ok((await buyer.j.call(path,{method:'POST',body:{amount_fen:100,reason:'x',idempotency_key:'customer-try-000001'}})).status>=400,'customers cannot refund');
 assert.ok((await admin.call('/api/staff/payments/orders')).data.orders.some(o=>o.id===order.id&&o.payer_email===buyer.email));
 assert.equal((await ask(3001,'refund-key-over-00001')).status,409);
 assert.equal((await ask(100,'refund-key-noreason01','')).status,400);
 // Partial refund, then a replay of the same request changes nothing.
 const first=await ask(1000,'refund-key-partial-001');assert.equal(first.status,201);assert.equal(first.data.status,'succeeded');
 assert.equal(await bal(),'2000');assert.equal(trade.refundedFen,1000);
 const replay=await ask(1000,'refund-key-partial-001');assert.equal(replay.status,200);assert.equal(replay.data.refund_id,first.data.refund_id);assert.equal(await bal(),'2000');assert.equal(trade.refundedFen,1000);
 // Unclear result: balance stays held, a second refund waits, a retry with the same request number settles it.
 alipayRefundMode='timeout';const pending=await ask(500,'refund-key-pending-001');assert.equal(pending.data.status,'pending');assert.equal(await bal(),'1500');
 assert.equal((await ask(100,'refund-key-blocked-001')).status,409);
 alipayRefundMode='ok';assert.equal((await admin.call(`/api/staff/payments/refunds/${pending.data.refund_id}/retry`,{method:'POST',body:{}})).data.status,'succeeded');
 assert.equal(await bal(),'1500');assert.equal(trade.refundedFen,1500);
 // A definitive rejection gives the held amount back.
 alipayRefundMode='reject';const rejected=await ask(500,'refund-key-reject-0001');alipayRefundMode='ok';
 assert.equal(rejected.data.status,'failed');assert.equal(await bal(),'1500');assert.equal(trade.refundedFen,1500);
 const view=(await admin.call('/api/staff/payments/orders')).data.orders.find(o=>o.id===order.id);
 assert.equal(view.refunded_fen,'1500');assert.deepEqual(view.refunds.map(r=>r.status),['succeeded','succeeded','failed']);
 // Spent money cannot be refunded.
 await pool.query('UPDATE billing_accounts SET cash_balance_fen=200 WHERE id=$1',[out.account_id]);
 assert.match((await ask(1000,'refund-key-spent-00001')).data.error,/已使用的部分不能退款/);
 const ledger=(await pool.query('SELECT kind,amount_fen::int FROM billing_ledger WHERE account_id=$1 ORDER BY id',[out.account_id])).rows.map(r=>r.kind+':'+r.amount_fen);
 assert.deepEqual(ledger,['recharge:3000','refund:-1000','refund:-500','refund:-500','reversal:500']);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'billing.refund.%'")).rows[0].n>=6,true);
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
test('alipay face-to-face recharge credits the exact amount once, only after a signed confirmation',async()=>{
 const payer=await user('payer'),outsider=await user('outsider'),org=await organization(payer,'Payer Co');
 const balance=async()=>(await payer.j.call('/api/billing/personal')).data;
 const notify=async(params,signer=alipaySign)=>{const p={notify_time:'2026-11-11 10:00:00',notify_type:'trade_status_sync',notify_id:randomBytes(8).toString('hex'),app_id:appCfg.alipay.appId,seller_id:appCfg.alipay.sellerId,charset:'utf-8',version:'1.0',sign_type:'RSA2',...params};p.sign=signer(signContent(p,{skipSignType:true}));const r=await fetch(origin+'/api/payments/alipay/notify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','x-real-ip':'198.51.100.7'},body:new URLSearchParams(p).toString()});return {status:r.status,text:await r.text()};};
 const tradeOf=async orderId=>{const o=(await pool.query('SELECT out_trade_no FROM payment_orders WHERE id=$1',[orderId])).rows[0];return {out:o.out_trade_no,trade:alipayTrades.get(o.out_trade_no)};};
 // Allowlist gates the channel before merchant go-live.
 assert.deepEqual((await balance()).recharge.channels,[]);
 assert.equal((await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:1000,idempotency_key:'k'.repeat(20)}})).status,403);
 appCfg.alipay.allowedEmails.add(payer.email);
 assert.deepEqual((await balance()).recharge.channels,['alipay_f2f']);assert.equal((await balance()).payments_enabled,true);
 assert.equal((await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:499,idempotency_key:'a'.repeat(20)}})).status,400);
 assert.equal((await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:10.5,idempotency_key:'a'.repeat(20)}})).status,400);
 const created=await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:1000,idempotency_key:'first-order-key-0001'}});
 assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.order.status,'pending');assert.match(created.data.order.qr_svg,/^<svg/);
 assert.ok(alipayCalls.every(c=>c.ok),'every gateway request is RSA2-signed with the app key');
 const again=await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:1000,idempotency_key:'first-order-key-0001'}});
 assert.equal(again.status,200);assert.equal(again.data.order.id,created.data.order.id);
 assert.equal((await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:2000,idempotency_key:'first-order-key-0001'}})).status,409);
 const orderId=created.data.order.id,{out,trade}=await tradeOf(orderId);
 assert.equal(trade.amount,'10.00');assert.equal(trade.notify,origin+'/api/payments/alipay/notify');
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
 const paid=(await payer.j.call('/api/billing/alipay-orders/'+orderId)).data.order;assert.equal(paid.status,'paid');assert.equal(paid.qr_svg,null);
 // A lost notify is recovered by the polling query.
 const second=(await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:2550,idempotency_key:'second-order-key-002'}})).data.order,t2=await tradeOf(second.id);
 t2.trade.status='TRADE_SUCCESS';
 assert.equal((await payer.j.call('/api/billing/alipay-orders/'+second.id)).data.order.status,'paid');
 assert.equal((await payer.j.call('/api/billing/alipay-orders/'+second.id)).data.order.status,'paid');
 view=await balance();assert.equal(view.cash_balance_fen,'3550');assert.equal(view.entries.length,2);
 // Closed trades close the order without money.
 const third=(await payer.j.call('/api/billing/personal/alipay-orders',{method:'POST',body:{amount_fen:800,idempotency_key:'third-order-key-0003'}})).data.order,t3=await tradeOf(third.id);
 assert.equal((await notify({out_trade_no:t3.out,trade_no:t3.trade.trade_no,trade_status:'TRADE_CLOSED',total_amount:'8.00'})).text,'success');
 assert.equal((await payer.j.call('/api/billing/alipay-orders/'+third.id)).data.order.status,'closed');assert.equal((await balance()).cash_balance_fen,'3550');
 // Enterprise recharge is for managers only and lands in the enterprise account.
 assert.equal((await outsider.j.call(`/api/billing/organizations/${org.id}/alipay-orders`,{method:'POST',body:{amount_fen:1000,idempotency_key:'org-order-key-00001'}})).status,403);
 const orgOrder=await payer.j.call(`/api/billing/organizations/${org.id}/alipay-orders`,{method:'POST',body:{amount_fen:1000,idempotency_key:'org-order-key-00001'}});assert.equal(orgOrder.status,201);
 const t4=await tradeOf(orgOrder.data.order.id);assert.equal((await notify({out_trade_no:t4.out,trade_no:t4.trade.trade_no,trade_status:'TRADE_SUCCESS',total_amount:'10.00'})).text,'success');
 assert.equal((await payer.j.call(`/api/billing/organizations/${org.id}`)).data.cash_balance_fen,'1000');assert.equal((await balance()).cash_balance_fen,'3550');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='billing.recharge.alipay_paid' AND subject_id=ANY($1)",[[orderId,second.id,orgOrder.data.order.id]])).rows[0].n,3);
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
 let p=send('glm-5.3','none',{thinking:{type:'enabled',clear_thinking:false}});assert.equal(p.reasoning_effort,undefined);assert.deepEqual(p.thinking,{type:'disabled'},'none turns reasoning off');
 assert.equal(send('glm-5.3','medium').reasoning_effort,'high');assert.equal(send('glm-5.3-flash','minimal').reasoning_effort,'low');assert.equal(send('glm-5.3','xhigh').reasoning_effort,'max');
 assert.equal(send('glm-5.3','low').reasoning_effort,'low');assert.equal(send('glm-5.3','weird').reasoning_effort,undefined);
 assert.equal(send('glm-5.3',undefined).thinking,undefined,'untouched when not sent');
 assert.equal(send('deepseek-flash','none').reasoning_effort,'none','other families pass through');
});
