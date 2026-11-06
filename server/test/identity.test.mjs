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
async function invite(owner,org,recipient,role='member',department=''){const r=await owner.j.call(`/api/platform/organizations/${org.id}/invitations`,{method:'POST',body:{email:recipient.email,role,department}});assert.equal(r.status,201,JSON.stringify(r.data));await service.mail.drain();const link=sent.findLast(m=>m.to===recipient.email&&m.subject.includes('邀请')).text.match(/#accept-invite\/(\S+)/)[1];return {token:link,id:r.data.id};}
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
 const inv=await invite(owner,orgA,member,'member','研发');assert.equal((await other.j.call('/api/platform/invitations/accept',{method:'POST',body:{token:inv.token}})).status,403);
 assert.equal((await member.j.call('/api/platform/invitations/accept',{method:'POST',body:{token:inv.token}})).status,200);assert.equal((await member.j.call('/api/platform/invitations/accept',{method:'POST',body:{token:inv.token}})).status,400);
 const view=(await member.j.call(`/api/platform/organizations/${orgA.id}`)).data;assert.equal(view.members.length,1);
 assert.equal((await member.j.call(`/api/platform/organizations/${orgA.id}/members/${view.members[0].id}`,{method:'PATCH',body:{role:'owner'}})).status,403);
});
test('department scopes and billing are enforced by server, not client role selections',async()=>{
 for(const [u,role,department]of [[dept,'department_admin','研发'],[billing,'billing','财务']]){const inv=await invite(owner,orgA,u,role,department);assert.equal((await u.j.call('/api/platform/invitations/accept',{method:'POST',body:{token:inv.token}})).status,200);}
 const view=(await dept.j.call(`/api/platform/organizations/${orgA.id}`)).data;assert.ok(view.members.every(m=>m.department==='研发'));assert.equal(view.members.length,2);
 const all=(await owner.j.call(`/api/platform/organizations/${orgA.id}`)).data;
 const bill=all.members.find(m=>m.user_id===billing.user.id);
 assert.equal((await dept.j.call(`/api/platform/organizations/${orgA.id}/members/${bill.id}`,{method:'PATCH',body:{status:'suspended'}})).status,403);
 assert.equal((await billing.j.call(`/api/platform/organizations/${orgA.id}/invitations`,{method:'POST',body:{email:'x@example.test'}})).status,403);
 assert.equal((await dept.j.call(`/api/platform/organizations/${orgA.id}/invitations`,{method:'POST',body:{email:'x@example.test',role:'admin',department:'研发'}})).status,403);
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
async function staffLogin(j){const first=await j.call('/api/staff/login');assert.equal(first.status,302);const code=await j.call(first.location);assert.equal(code.status,302);const done=await j.call(code.location);assert.equal(done.status,302);assert.equal(done.location,'/#staff-account');return code.location;}
let staff;
test('real OIDC code/PKCE/nonce flow creates separate staff session; replay and cross-browser callback fail',async()=>{
 staff=jar();const callback=await staffLogin(staff);assert.equal((await staff.call('/api/staff/me')).data.staff.role,'platform_admin');assert.equal((await staff.call('/api/platform/me')).status,401);
 assert.equal((await jar().call(callback)).location,'/#staff?error=authentication_failed');assert.equal((await staff.call(callback)).location,'/#staff?error=authentication_failed');
 const same=await staff.call('/api/staff/me');assert.equal(same.status,200);
 const last=await staff.call('/api/staff/members/staff-owner',{method:'PATCH',body:{role:'support',status:'active'}});assert.equal(last.status,409);
});
test('new employee requires local approval; disabled customer sessions and revoked IdP tokens stop working',async()=>{
 identity={sub:'staff-second',email:'second@example.test',name:'Second',staff_approved:true};const second=jar();await staffLogin(second);assert.equal((await second.call('/api/staff/me')).data.staff.status,'pending');assert.equal((await second.call('/api/staff/customers')).status,403);
 assert.equal((await staff.call('/api/staff/members/staff-second',{method:'PATCH',body:{role:'finance',status:'active'}})).status,200);assert.equal((await second.call('/api/staff/me')).status,401);await staffLogin(second);assert.equal((await second.call('/api/staff/customers')).status,403);
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
