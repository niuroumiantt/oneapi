import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createServer } from 'node:http';
import { randomBytes,createHash } from 'node:crypto';
import { generateKeyPair,exportJWK,SignJWT } from 'jose';
import { createApp } from '../src/app.mjs';
import { migrate } from '../src/migrate.mjs';
import { config } from '../src/core.mjs';
let pool,appServer,idpServer,service,origin,idpOrigin,identity={sub:'staff-owner',email:'owner@example.test',name:'Test Owner',staff_approved:true},revoked=false;
const sent=[],codes=new Map(),access=new Map();let serial=1;
const password='Local-only!Testing-1842';
function jar(ip='192.0.2.'+(serial++)){const cookies=new Map();return {cookies,async call(path,{method='GET',body,headers={}}={}){
 const response=await fetch(path.startsWith('http')?path:origin+path,{method,redirect:'manual',headers:{Origin:origin,'x-real-ip':ip,...(body?{'Content-Type':'application/json'}:{}),Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...headers},body:body?JSON.stringify(body):undefined});
 for(const c of response.headers.getSetCookie()){const part=c.split(';')[0],at=part.indexOf('=');cookies.set(part.slice(0,at),part.slice(at+1));}
 const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {status:response.status,data,location:response.headers.get('location'),headers:response.headers};}};}
async function user(label){const j=jar(),email=`${label}-${serial}@example.test`;const r=await j.call('/api/auth/sign-up/email',{method:'POST',body:{email,password,name:label,callbackURL:origin+'/#account'}});assert.equal(r.status,200,JSON.stringify(r.data));await service.mail.drain();const message=sent.findLast(m=>m.to===email&&m.subject.includes('验证'));assert.ok(message);const url=message.text.match(/https?:\/\/\S+/)[0];const verified=await j.call(url);assert.equal(verified.status,302);assert.equal((await j.call('/api/platform/me')).status,200);return {j,email,user:(await j.call('/api/platform/me')).data.user};}
async function organization(u,name){const r=await u.j.call('/api/platform/organizations',{method:'POST',body:{name}});assert.equal(r.status,201);return r.data;}
async function invite(owner,org,recipient,role='member',department=''){const r=await owner.j.call(`/api/platform/organizations/${org.id}/invitations`,{method:'POST',body:{name:'Test Employee',email:recipient.email,role,department}});assert.equal(r.status,201,JSON.stringify(r.data));await service.mail.drain();const link=sent.findLast(m=>m.to===recipient.email&&m.subject.includes('开通')).text.match(/#accept-invite\/(\S+)/)[1];return {token:link,id:r.data.id};}
before(async()=>{
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
 const cfg=config({APP_ORIGIN:origin,DATABASE_URL:databaseURL,BETTER_AUTH_SECRET:'test-only-strong-secret-932847239847293847',STAFF_OIDC_ISSUER:idpOrigin,STAFF_OIDC_CLIENT_ID:'oneapi-test-staff',STAFF_OIDC_CLIENT_SECRET:'test-client-secret',STAFF_BOOTSTRAP_SUB:'staff-owner'});
 service=createApp(pool,cfg,{sendMail:async m=>{sent.push(m);return {};},verify:async()=>true});await migrate(pool,service.auth);await pool.query('TRUNCATE "user",staff_members,staff_oidc_states,mail_outbox,request_limits,"rateLimit" CASCADE');appServer.on('request',service.app);
});
after(async()=>{appServer?.close();idpServer?.close();await pool?.end();});
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
 const fresh=jar();for(const [k,v]of owner.j.cookies)fresh.cookies.set(k,v);assert.equal((await fresh.call(`/api/platform/organizations/${orgA.id}`)).data.organization.name,'Company A');
});
test('invitations bind verified email, are one-use, and cannot be replayed or self-promote',async()=>{
 const inv=await invite(owner,orgA,member,'member','研发');const preview=await jar().call('/api/platform/invitations/preview?token='+encodeURIComponent(inv.token));assert.equal(preview.status,200);assert.equal(preview.data.email,member.email);assert.equal(preview.data.name,'Test Employee');assert.equal(preview.data.organizationName,'Company A');assert.equal((await other.j.call('/api/platform/invitations/accept',{method:'POST',body:{token:inv.token}})).status,403);
 assert.equal((await member.j.call('/api/platform/invitations/accept',{method:'POST',body:{token:inv.token}})).status,200);assert.equal((await member.j.call('/api/platform/invitations/accept',{method:'POST',body:{token:inv.token}})).status,400);
 assert.equal((await jar().call('/api/platform/invitations/preview?token='+encodeURIComponent(inv.token))).status,400);
 const view=(await member.j.call(`/api/platform/organizations/${orgA.id}`)).data;assert.equal(view.members.length,1);
 assert.equal((await member.j.call(`/api/platform/organizations/${orgA.id}/members/${view.members[0].id}`,{method:'PATCH',body:{role:'owner'}})).status,403);
});
test('new enterprise invitations grant only staff access',async()=>{
 assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/invitations`,{method:'POST',body:{email:'unnamed@example.test',role:'member'}})).status,400);
 for(const role of ['admin','department_admin','billing','owner'])assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/invitations`,{method:'POST',body:{name:'Test Employee',email:'x@example.test',role,department:'研发'}})).status,400);
 const inv=await invite(owner,orgA,dept,'member','研发');assert.equal((await dept.j.call('/api/platform/invitations/accept',{method:'POST',body:{token:inv.token}})).status,200);
 assert.equal((await dept.j.call(`/api/platform/organizations/${orgA.id}/invitations`,{method:'POST',body:{name:'Test Employee',email:'x@example.test'}})).status,403);
 const view=(await owner.j.call(`/api/platform/organizations/${orgA.id}`)).data;const target=view.members.find(m=>m.user_id===dept.user.id);
 assert.equal(view.invitations.find(i=>i.email===dept.email).employee_name,'Test Employee');
 assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/members/${target.id}`,{method:'PATCH',body:{role:'admin'}})).status,400);
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
test('suspension immediately invalidates old organization access and pending invitations',async()=>{
 const m=(await owner.j.call(`/api/platform/organizations/${orgA.id}`)).data.members.find(m=>m.user_id===member.user.id);
 assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/members/${m.id}`,{method:'PATCH',body:{status:'suspended'}})).status,200);
 assert.equal((await member.j.call(`/api/platform/organizations/${orgA.id}`)).status,403);assert.equal((await member.j.call('/api/platform/me')).status,200);
 assert.equal((await owner.j.call(`/api/platform/organizations/${orgA.id}/members/${m.id}`,{method:'PATCH',body:{status:'active'}})).status,200);
 const revoked=await invite(owner,orgA,other);await owner.j.call(`/api/platform/organizations/${orgA.id}/invitations/${revoked.id}/revoke`,{method:'POST',body:{}});assert.equal((await other.j.call('/api/platform/invitations/accept',{method:'POST',body:{token:revoked.token}})).status,400);
});
test('last owner cannot be removed and audit persists role mutations',async()=>{
 const own=(await owner.j.call(`/api/platform/organizations/${orgA.id}`)).data.members.find(m=>m.user_id===owner.user.id);
 const attempts=await Promise.all([owner.j.call(`/api/platform/organizations/${orgA.id}/members/${own.id}`,{method:'PATCH',body:{role:'member'}}),owner.j.call(`/api/platform/organizations/${orgA.id}/members/${own.id}`,{method:'DELETE'})]);assert.deepEqual(attempts.map(r=>r.status),[409,409]);
 const audit=await owner.j.call(`/api/platform/organizations/${orgA.id}/audit`);assert.ok(audit.data.some(e=>e.action==='member.updated'));assert.equal((await other.j.call(`/api/platform/organizations/${orgA.id}/audit`)).status,403);
});
test('isolated demo journey covers personal and enterprise orders, allocation, access and usage',async()=>{
 const personalOrder=await owner.j.call('/api/demo/orders',{method:'POST',body:{model_code:'demo-chat',amount_yuan:100}});assert.equal(personalOrder.status,201);
 assert.equal((await owner.j.call('/api/demo/keys',{method:'POST',body:{model_code:'demo-chat',label:'Before payment'}})).status,409);
 const personalPay=await owner.j.call(`/api/demo/orders/${personalOrder.data.order.id}/pay`,{method:'POST',body:{}});assert.equal(personalPay.status,200);
 const repeated=await owner.j.call(`/api/demo/orders/${personalOrder.data.order.id}/pay`,{method:'POST',body:{}});assert.equal(repeated.data.balance_fen,10000);
 const personalKey=await owner.j.call('/api/demo/keys',{method:'POST',body:{model_code:'demo-chat',label:'Personal demo'}});assert.equal(personalKey.status,201);
 const personalUsage=await owner.j.call(`/api/demo/keys/${personalKey.data.key.id}/usage`,{method:'POST',body:{input_tokens:1200,output_tokens:600}});assert.equal(personalUsage.status,201);assert.ok(personalUsage.data.usage.cost_fen>0);
 const personalState=(await owner.j.call('/api/demo/personal')).data;assert.equal(personalState.orders.length,1);assert.equal(personalState.usage.length,1);assert.equal(personalState.simulated,true);
 assert.equal((await other.j.call(`/api/demo/orders/${personalOrder.data.order.id}/pay`,{method:'POST',body:{}})).status,404);
 const enterpriseOrder=await owner.j.call('/api/demo/orders',{method:'POST',body:{organization_id:orgA.id,model_code:'demo-code',amount_yuan:1000}});assert.equal(enterpriseOrder.status,201);
 assert.equal((await member.j.call('/api/demo/orders',{method:'POST',body:{organization_id:orgA.id,model_code:'demo-code',amount_yuan:100}})).status,403);
 assert.equal((await other.j.call(`/api/demo/organizations/${orgA.id}`)).status,403);
 assert.equal((await owner.j.call(`/api/demo/orders/${enterpriseOrder.data.order.id}/pay`,{method:'POST',body:{organization_id:orgA.id}})).status,200);
 assert.equal((await owner.j.call('/api/demo/allocations',{method:'POST',body:{organization_id:orgA.id,user_id:member.user.id,limit_yuan:100}})).status,200);
 assert.equal((await owner.j.call('/api/demo/allocations',{method:'POST',body:{organization_id:orgA.id,user_id:owner.user.id,limit_yuan:1000}})).status,409);
 const enterpriseKey=await member.j.call('/api/demo/keys',{method:'POST',body:{organization_id:orgA.id,model_code:'demo-code',label:'Team test'}});assert.equal(enterpriseKey.status,201,JSON.stringify(enterpriseKey.data));
 assert.equal((await member.j.call(`/api/demo/keys/${enterpriseKey.data.key.id}/usage`,{method:'POST',body:{organization_id:orgA.id,input_tokens:2000,output_tokens:1000}})).status,201);
 const ownerState=(await owner.j.call(`/api/demo/organizations/${orgA.id}`)).data,memberState=(await member.j.call(`/api/demo/organizations/${orgA.id}`)).data;
 assert.equal(ownerState.usage.length,1);assert.equal(memberState.usage.length,1);assert.equal(memberState.members.length,0);assert.equal(memberState.allocations.length,1);
 assert.equal((await other.j.call(`/api/demo/keys/${enterpriseKey.data.key.id}/usage`,{method:'POST',body:{organization_id:orgB.id,input_tokens:100,output_tokens:100}})).status,404);
 assert.equal((await member.j.call('/api/demo/allocations',{method:'POST',body:{organization_id:orgA.id,user_id:member.user.id,limit_yuan:500}})).status,403);
});
async function staffLogin(j){const first=await j.call('/api/staff/login');assert.equal(first.status,302);const code=await j.call(first.location);assert.equal(code.status,302);const done=await j.call(code.location);assert.equal(done.status,302);assert.equal(done.location,'/#staff-account');return code.location;}
let staff;
test('real OIDC code/PKCE/nonce flow creates separate staff session; replay and cross-browser callback fail',async()=>{
 staff=jar();const callback=await staffLogin(staff);assert.equal((await staff.call('/api/staff/me')).data.staff.role,'platform_admin');assert.equal((await staff.call('/api/platform/me')).status,401);
 assert.equal((await jar().call(callback)).location,'/#staff?error=authentication_failed');assert.equal((await staff.call(callback)).location,'/#staff?error=authentication_failed');
 const same=await staff.call('/api/staff/me');assert.equal(same.status,200);
 const last=await staff.call('/api/staff/members/staff-owner',{method:'PATCH',body:{role:'support',status:'active'}});assert.equal(last.status,409);
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
 assert.equal((await staff.call('/api/staff/model-products',{method:'POST',body:{offer_id:offerId,display_name:'Duplicate',product_code:'fixture-chat-cn'}})).status,409);
 const priceBody={model_product_id:product.data.id,input_yuan_per_million:'12.34',output_yuan_per_million:'56.78',evidence_url:'https://example.test/approved-rate',notes:'Internal price design'};
 assert.equal((await outsider.call('/api/staff/price-proposals')).status,401);
 assert.equal((await owner.j.call('/api/staff/price-proposals')).status,401);
 const price=await staff.call('/api/staff/price-proposals',{method:'POST',body:priceBody});assert.equal(price.status,201,JSON.stringify(price.data));assert.equal(price.data.input_fen_per_million,'1234');assert.equal(price.data.output_fen_per_million,'5678');assert.equal(price.data.public_pricing_enabled,false);assert.equal(price.data.checkout_enabled,false);
 const priceList=await staff.call('/api/staff/price-proposals');assert.equal(priceList.status,200);assert.equal(priceList.data.checkout_enabled,false);assert.ok(priceList.data.proposals.some(q=>q.id===price.data.id&&q.model_product_name==='Fixture Chat CN'));
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
 const audit=(await staff.call('/api/staff/audit')).data;assert.ok(audit.some(e=>e.action==='supplier_offer.check_updated'&&e.subject_id===offerId));assert.ok(audit.some(e=>e.action==='supplier_offer.validation_recorded'&&e.subject_id===offerId));assert.ok(audit.some(e=>e.action==='model_product.created'&&e.subject_id===product.data.id));assert.ok(audit.some(e=>e.action==='model_product.review_requested'&&e.subject_id===product.data.id));assert.ok(audit.some(e=>e.action==='model_product.review_decided'&&e.subject_id===product.data.id));assert.ok(audit.some(e=>e.action==='promotion_campaign.created'&&e.subject_id===campaign.data.id));
});
test('new employee requires local approval; disabled customer sessions and revoked IdP tokens stop working',async()=>{
 identity={sub:'staff-second',email:'second@example.test',name:'Second',staff_approved:true};const second=jar();await staffLogin(second);assert.equal((await second.call('/api/staff/me')).data.staff.status,'pending');assert.equal((await second.call('/api/staff/customers')).status,403);
 assert.equal((await staff.call('/api/staff/members/staff-second',{method:'PATCH',body:{role:'finance',status:'active'}})).status,200);assert.equal((await second.call('/api/staff/me')).status,401);await staffLogin(second);assert.equal((await second.call('/api/staff/customers')).status,403);assert.equal((await second.call('/api/staff/suppliers')).status,200);assert.equal((await second.call('/api/staff/model-products')).status,200);assert.equal((await second.call('/api/staff/promotion-campaigns')).status,200);assert.equal((await second.call('/api/staff/promotion-campaigns',{method:'POST',body:{}})).status,403);assert.equal((await second.call('/api/staff/model-products',{method:'POST',body:{offer_id:'00000000-0000-0000-0000-000000000000',display_name:'No',product_code:'finance-denied'}})).status,403);assert.equal((await second.call('/api/staff/suppliers',{method:'POST',body:{legal_name:'No',display_name:'No',source_type:'official',region:'CN'}})).status,403);
 assert.equal((await second.call('/api/staff/supplier-offers/00000000-0000-0000-0000-000000000000/tests',{method:'POST',body:{}})).status,403);
 assert.equal((await staff.call(`/api/staff/customers/${member.user.id}/status`,{method:'POST',body:{disabled:true}})).status,200);assert.equal((await member.j.call('/api/platform/me')).status,401);
 revoked=true;assert.equal((await staff.call('/api/staff/me')).status,401);revoked=false;
});
test('password recovery consumes the token and revokes all previous sessions',async()=>{
 const recovery=await user('recovery');const request=await recovery.j.call('/api/auth/request-password-reset',{method:'POST',body:{email:recovery.email,redirectTo:origin+'/#reset-password'}});assert.equal(request.status,200);while(await service.mail.drain());
 const message=sent.findLast(m=>m.to===recovery.email&&m.subject.includes('重设'));const link=new URL(message.text.match(/http[^\s]+/)[0]),resetToken=link.searchParams.get('reset_token');assert.ok(resetToken);
 const payload={token:resetToken,newPassword:password+'-new'};assert.equal((await jar().call('/api/auth/reset-password',{method:'POST',body:payload})).status,200);assert.equal((await recovery.j.call('/api/platform/me')).status,401);assert.equal((await jar().call('/api/auth/reset-password',{method:'POST',body:payload})).status,400);
 assert.equal((await jar().call('/api/auth/sign-in/email',{method:'POST',body:{email:recovery.email,password}})).status,401);assert.equal((await jar().call('/api/auth/sign-in/email',{method:'POST',body:{email:recovery.email,password:payload.newPassword}})).status,200);
});
test('expired invitations fail and concurrent acceptance grants membership only once',async()=>{
 const inv=await invite(owner,orgA,other);await pool.query("UPDATE invitations SET expires_at=now()-interval '1 minute' WHERE id=$1",[inv.id]);assert.equal((await other.j.call('/api/platform/invitations/accept',{method:'POST',body:{token:inv.token}})).status,400);
 const fresh=await invite(owner,orgA,other);const results=await Promise.all([1,2].map(()=>other.j.call('/api/platform/invitations/accept',{method:'POST',body:{token:fresh.token}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
});
test('sign out revokes persistent customer session',async()=>{assert.equal((await owner.j.call('/api/auth/sign-out',{method:'POST',body:{}})).status,200);assert.equal((await owner.j.call('/api/platform/me')).status,401);});
