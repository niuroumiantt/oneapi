import * as oidc from 'openid-client';
import { HttpError,token,hash,vault,transaction,audit,text } from './core.mjs';
export const staffRoles=['platform_admin','operations','supply','finance','support'];
export function staffRoutes(app,pool,cfg){
 const box=vault(cfg.secret),cookieName=cfg.production?'__Host-oneapi_staff':'oneapi_staff',bindingName=cfg.production?'__Host-oneapi_oidc':'oneapi_oidc';
 const cookieOptions={httpOnly:true,secure:cfg.production,sameSite:'lax',path:'/'};
 const cookie=(req,name)=>{try{return decodeURIComponent((req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'');}catch{return '';}};
 let discovery;
 const configured=!!(cfg.staffIssuer&&cfg.staffClientId&&cfg.staffClientSecret);
 async function client(){if(!configured)throw new HttpError(503,'员工身份服务尚未配置');if(!discovery)discovery=oidc.discovery(new URL(cfg.staffIssuer),cfg.staffClientId,cfg.staffClientSecret,undefined,cfg.production?undefined:{execute:[oidc.allowInsecureRequests]}).catch(e=>{discovery=null;throw e;});return discovery;}
 function approved(info){return typeof info.sub==='string'&&info.staff_approved===true;}
 async function requireStaff(req,res,next){
  const value=cookie(req,cookieName);if(!value)throw new HttpError(401,'请先使用公司身份登录');
  const row=(await pool.query("SELECT s.*,m.email,m.name,m.role,m.status,EXISTS(SELECT 1 FROM staff_technical_access ta WHERE ta.subject=m.subject) AS technical_access FROM staff_sessions s JOIN staff_members m ON m.subject=s.subject WHERE token_hash=$1 AND expires_at>now() AND last_seen>now()-interval '30 minutes'",[hash(value)])).rows[0];
  if(!row)throw new HttpError(401,'员工会话已过期，请重新登录');
  let info;try{info=await oidc.fetchUserInfo(await client(),box.open(row.access_payload).accessToken,row.subject);}catch{await pool.query('DELETE FROM staff_sessions WHERE token_hash=$1',[hash(value)]);throw new HttpError(401,'公司身份会话已失效，请重新登录');}
  if(!approved(info)){await pool.query('DELETE FROM staff_sessions WHERE token_hash=$1',[hash(value)]);throw new HttpError(403,'公司员工身份未获准访问');}
  if(row.status==='suspended')throw new HttpError(403,'员工权限已停用');
  req.staff={subject:row.subject,email:row.email,name:row.name,role:row.role,status:row.status,technical_access:row.role==='platform_admin'||row.technical_access===true};req.actor={kind:'staff',id:row.subject};
  await pool.query('UPDATE staff_sessions SET last_seen=now() WHERE token_hash=$1',[hash(value)]);next();
 }
 function administrator(req,res,next){if(req.staff.role!=='platform_admin'||req.staff.status!=='active')throw new HttpError(403,'仅平台管理员可执行此操作');next();}
 app.get('/api/staff/login',async(req,res)=>{
  const c=await client(),state=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier(),binding=token();
  const destination=req.query.next==='lab'?'/api/staff/lab/console':req.query.next==='business'?'/api/staff/workspace/console':'/#staff-account';
  await pool.query('INSERT INTO staff_oidc_states(state_hash,binding_hash,payload) VALUES($1,$2,$3)',[hash(state),hash(binding),box.seal({state,nonce,verifier,destination})]);
  res.cookie(bindingName,binding,{...cookieOptions,maxAge:600000});
  const url=oidc.buildAuthorizationUrl(c,{redirect_uri:cfg.origin+'/api/staff/callback',scope:'openid profile email',code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce});
  res.redirect(url.toString());
 });
 app.get('/api/staff/callback',async(req,res)=>{
  try{
   const state=typeof req.query.state==='string'?req.query.state:'',binding=cookie(req,bindingName);if(!state||!binding)throw Error('Missing state binding');
   const saved=(await pool.query('DELETE FROM staff_oidc_states WHERE state_hash=$1 AND binding_hash=$2 AND expires_at>now() RETURNING payload',[hash(state),hash(binding)])).rows[0];if(!saved)throw Error('Invalid or replayed state');
   const flow=box.open(saved.payload),c=await client(),tokens=await oidc.authorizationCodeGrant(c,new URL(req.originalUrl,cfg.origin),{pkceCodeVerifier:flow.verifier,expectedState:flow.state,expectedNonce:flow.nonce,idTokenExpected:true});
   const claims=tokens.claims();if(!claims?.sub||!tokens.access_token)throw Error('Missing identity');
   const info=await oidc.fetchUserInfo(c,tokens.access_token,claims.sub);if(!approved(info))throw Error('Employee not approved');
   const value=token();await transaction(pool,async db=>{
    const previous=(await db.query('SELECT subject FROM staff_members WHERE subject=$1',[claims.sub])).rows[0];
    const bootstrap=!previous&&cfg.bootstrapSub&&claims.sub===cfg.bootstrapSub;
    await db.query('INSERT INTO staff_members(subject,email,name,role,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(subject) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name',[claims.sub,info.email||'',info.name||'公司员工',bootstrap?'platform_admin':'pending',bootstrap?'active':'pending']);
    await db.query('INSERT INTO staff_sessions(token_hash,subject,access_payload,expires_at) VALUES($1,$2,$3,$4)',[hash(value),claims.sub,box.seal({accessToken:tokens.access_token}),new Date(Date.now()+Math.min(tokens.expires_in||300,8*3600)*1000)]);
    await audit(db,{kind:'staff',id:claims.sub},bootstrap?'staff.bootstrap':'staff.signed_in',null,claims.sub);
   });
   res.clearCookie(bindingName,cookieOptions);res.cookie(cookieName,value,{...cookieOptions,maxAge:8*3600*1000});res.redirect(['/api/staff/lab/console','/api/staff/workspace/console'].includes(flow.destination)?flow.destination:'/#staff-account');
  }catch{res.clearCookie(bindingName,cookieOptions);res.redirect('/#staff?error=authentication_failed');}
 });
 app.get('/api/staff/me',requireStaff,async(req,res)=>res.json({staff:req.staff}));
 app.post('/api/staff/logout',async(req,res)=>{await pool.query('DELETE FROM staff_sessions WHERE token_hash=$1',[hash(cookie(req,cookieName))]);res.clearCookie(cookieName,cookieOptions);res.json({ok:true});});
 app.get('/api/staff/members',requireStaff,administrator,async(req,res)=>res.json((await pool.query('SELECT subject,email,name,role,status,created_at,EXISTS(SELECT 1 FROM staff_technical_access t WHERE t.subject=staff_members.subject) AS technical_access FROM staff_members ORDER BY created_at')).rows));
 app.patch('/api/staff/members/:subject',requireStaff,administrator,async(req,res)=>{const subject=text(req.params.subject,'员工标识',120),role=req.body.role,status=req.body.status;if(!staffRoles.includes(role)||!['active','suspended'].includes(status))throw new HttpError(400,'岗位或状态不正确');
  await transaction(pool,async db=>{
   await db.query('SELECT pg_advisory_xact_lock(148921,2)');
   // Re-check the actor inside the same lock used by all privilege mutations.
   const actor=(await db.query("SELECT * FROM staff_members WHERE subject=$1 AND role='platform_admin' AND status='active'",[req.staff.subject])).rows[0];if(!actor)throw new HttpError(403,'管理员权限已变化');
   const target=(await db.query('SELECT * FROM staff_members WHERE subject=$1 FOR UPDATE',[subject])).rows[0];if(!target)throw new HttpError(404,'请该员工先通过公司身份中心登录申请');
   if(target.role==='platform_admin'&&target.status==='active'&&(role!=='platform_admin'||status!=='active')){const count=Number((await db.query("SELECT count(*) FROM staff_members WHERE role='platform_admin' AND status='active'")).rows[0].count);if(count<=1)throw new HttpError(409,'必须保留一位有效平台管理员');}
   await db.query('UPDATE staff_members SET role=$2,status=$3 WHERE subject=$1',[subject,role,status]);await db.query('DELETE FROM staff_sessions WHERE subject=$1',[subject]);await audit(db,req.actor,'staff.permission_updated',null,subject,{role,status});
  });res.json({ok:true});
 });
 app.get('/api/staff/audit',requireStaff,administrator,async(req,res)=>res.json((await pool.query('SELECT actor_kind,actor_id,action,subject_id,created_at FROM audit_events ORDER BY id DESC LIMIT 100')).rows));
 app.get('/api/staff/customers',requireStaff,async(req,res)=>{if(req.staff.status!=='active'||!['platform_admin','operations','support'].includes(req.staff.role))throw new HttpError(403,'当前岗位没有客户管理权限');res.json((await pool.query('SELECT id,name,email,"emailVerified",disabled,"createdAt" FROM "user" ORDER BY "createdAt" DESC LIMIT 100')).rows);});
 app.post('/api/staff/customers/:user/status',requireStaff,administrator,async(req,res)=>{if(typeof req.body.disabled!=='boolean')throw new HttpError(400,'状态不正确');await transaction(pool,async db=>{await db.query("SELECT pg_advisory_xact_lock(148921,2)");if(!(await db.query("SELECT subject FROM staff_members WHERE subject=$1 AND role=\'platform_admin\' AND status=\'active\'",[req.staff.subject])).rowCount)throw new HttpError(403,"管理员权限已变化");const r=await db.query('UPDATE "user" SET disabled=$2 WHERE id=$1 RETURNING id',[req.params.user,req.body.disabled]);if(!r.rowCount)throw new HttpError(404,'客户不存在');await db.query('DELETE FROM session WHERE "userId"=$1',[req.params.user]);await audit(db,req.actor,'customer.status_updated',null,req.params.user,{disabled:req.body.disabled});});res.json({ok:true});});
 return {configured,requireStaff};
}
