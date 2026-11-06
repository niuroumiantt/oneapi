import { randomUUID } from 'node:crypto';
import { HttpError,id,text,email,token,hash,transaction,audit } from './core.mjs';
export const roles=['owner','admin','department_admin','billing','member'];
export function canManage(actor,target){
 if(actor.status!=='active')return false;
 if(actor.role==='owner')return true;
 if(actor.role==='admin')return target.role!=='owner';
 return actor.role==='department_admin'&&target.role==='member'&&target.department===actor.department;
}
function desired(body){const role=body.role||'member';if(!roles.includes(role))throw new HttpError(400,'角色不正确');const department=typeof body.department==='string'?body.department.trim():'';if(department.length>80||role==='department_admin'&&!department)throw new HttpError(400,'部门管理员必须指定部门');return {role,department};}
export function organizationRoutes(app,pool,cfg,mail,requireCustomer){
 const prefix='/api/platform';
 async function member(db,org,user,lock=false){id(org);if(lock){const r=await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);if(!r.rowCount)throw new HttpError(404,'企业不存在');}
  const m=(await db.query('SELECT * FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status=\'active\'',[org,user])).rows[0];if(!m)throw new HttpError(403,'没有这个企业的访问权限');return m;
 }
 app.get(prefix+'/me',requireCustomer,async(req,res)=>{const orgs=(await pool.query('SELECT o.id,o.name,m.role,m.department FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND m.status=\'active\' ORDER BY o.created_at',[req.customer.id])).rows;res.json({user:req.customer,organizations:orgs,capabilities:{identity:true,payments:false,inference:false}});});
 app.get(prefix+'/invitations/preview',async(req,res)=>{const secret=text(req.query.token,'邀请链接',100);const row=(await pool.query("SELECT i.email,i.role,i.department,i.status,i.expires_at,o.name AS organization_name FROM invitations i JOIN organizations o ON o.id=i.organization_id WHERE i.token_hash=$1",[hash(secret)])).rows[0];if(!row||row.status!=='pending'||new Date(row.expires_at)<=new Date())throw new HttpError(400,'邀请已使用、撤销或过期');res.set('Cache-Control','no-store');res.json({email:row.email,organizationName:row.organization_name,role:row.role,department:row.department,expiresAt:row.expires_at});});
 app.post(prefix+'/organizations',requireCustomer,async(req,res)=>{const name=text(req.body.name,'企业名称');const result=await transaction(pool,async db=>{
  await db.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[req.customer.id]);
  const count=Number((await db.query('SELECT count(*) FROM organizations WHERE created_by=$1',[req.customer.id])).rows[0].count);if(count>=10)throw new HttpError(409,'最多创建 10 个企业空间');
  const o=(await db.query('INSERT INTO organizations(name,created_by) VALUES($1,$2) RETURNING id,name,region,created_at',[name,req.customer.id])).rows[0];
  await db.query('INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,\'owner\')',[o.id,req.customer.id]);await audit(db,req.actor,'organization.created',o.id,o.id);return o;
 });res.status(201).json(result);});
 app.get(prefix+'/organizations/:org',requireCustomer,async(req,res)=>{
  const m=await member(pool,req.params.org,req.customer.id),org=(await pool.query('SELECT id,name,region,created_at FROM organizations WHERE id=$1',[m.organization_id])).rows[0];
  const conditions=m.role==='member'?' AND m.user_id=$2':m.role==='department_admin'?' AND m.department=$2':'';
  const args=[m.organization_id];if(conditions)args.push(m.role==='member'?req.customer.id:m.department);
  const members=(await pool.query('SELECT m.id,m.user_id,m.role,m.department,m.status,m.created_at,u.name,u.email FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.organization_id=$1'+conditions+' ORDER BY m.created_at',args)).rows;
  let invites=[];if(['owner','admin','department_admin'].includes(m.role))invites=(await pool.query('SELECT id,email,role,department,status,expires_at FROM invitations WHERE organization_id=$1'+(m.role==='department_admin'?' AND department=$2':'')+' ORDER BY created_at DESC LIMIT 100',m.role==='department_admin'?[m.organization_id,m.department]:[m.organization_id])).rows;
  res.json({organization:org,membership:m,members,invitations:invites,permissions:{manageMembers:['owner','admin','department_admin'].includes(m.role),manageOwners:m.role==='owner',viewBilling:['owner','admin','billing'].includes(m.role)}});
 });
 app.post(prefix+'/organizations/:org/invitations',requireCustomer,async(req,res)=>{const to=email(req.body.email),grant=desired(req.body);if(grant.role!=='member')throw new HttpError(400,'新成员统一为企业员工');const result=await transaction(pool,async db=>{
  const actor=await member(db,req.params.org,req.customer.id,true);if(!canManage(actor,grant))throw new HttpError(403,'不能授予这个角色或部门范围');
  const exists=await db.query('SELECT 1 FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.organization_id=$1 AND lower(u.email)=$2',[req.params.org,to]);if(exists.rowCount)throw new HttpError(409,'该用户已是企业成员，请在成员列表管理');
  await db.query("UPDATE invitations SET status='revoked' WHERE organization_id=$1 AND lower(email)=$2 AND status='pending'",[req.params.org,to]);
  const secret=token(),invite=(await db.query("INSERT INTO invitations(organization_id,invited_by,email,role,department,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '3 days') RETURNING id,email,role,department,status,expires_at",[req.params.org,req.customer.id,to,grant.role,grant.department,hash(secret)])).rows[0];
  const org=(await db.query('SELECT name FROM organizations WHERE id=$1',[req.params.org])).rows[0];
  await mail.queue({to,subject:`邀请加入 ${org.name} · semifly.ai`,text:`${org.name} 邀请你加入 semifly.ai 企业工作空间。\n请在三天内打开下方一次性链接。已有账号请用本邮箱登录；首次加入请先注册并验证邮箱，再确认加入。\n${cfg.origin}/#accept-invite/${secret}\n链接只能使用一次。如不认识邀请方，请忽略。\n\nsemifly.ai, It's your API.`},db);
  await audit(db,req.actor,'member.invited',req.params.org,invite.id,{role:grant.role,department:grant.department});return invite;
 });res.status(201).json(result);});
 app.post(prefix+'/organizations/:org/invitations/:invite/revoke',requireCustomer,async(req,res)=>{await transaction(pool,async db=>{
  const actor=await member(db,req.params.org,req.customer.id,true),invite=(await db.query('SELECT * FROM invitations WHERE id=$1 AND organization_id=$2',[id(req.params.invite),req.params.org])).rows[0];if(!invite)throw new HttpError(404,'邀请不存在');if(!canManage(actor,invite))throw new HttpError(403,'不能撤销这个邀请');
  await db.query("UPDATE invitations SET status='revoked' WHERE id=$1 AND status='pending'",[invite.id]);await audit(db,req.actor,'invitation.revoked',req.params.org,invite.id);
 });res.json({ok:true});});
 app.post(prefix+'/invitations/accept',requireCustomer,async(req,res)=>{const secret=text(req.body.token,'邀请链接',100);const result=await transaction(pool,async db=>{
  const first=(await db.query('SELECT organization_id,id FROM invitations WHERE token_hash=$1',[hash(secret)])).rows[0];if(!first)throw new HttpError(400,'邀请无效或已失效');
  await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[first.organization_id]);
  const invite=(await db.query('SELECT * FROM invitations WHERE id=$1 FOR UPDATE',[first.id])).rows[0];
  if(invite.status!=='pending'||new Date(invite.expires_at)<=new Date())throw new HttpError(400,'邀请已使用、撤销或过期');
  if(invite.email.toLowerCase()!==req.customer.email.toLowerCase())throw new HttpError(403,'请使用收到邀请的已验证邮箱登录');
  const inviter=await member(db,invite.organization_id,invite.invited_by);if(!canManage(inviter,invite))throw new HttpError(403,'邀请方的授权已变化，请重新索取邀请');
  const existing=await db.query('SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2',[invite.organization_id,req.customer.id]);if(existing.rowCount)throw new HttpError(409,'你已是该企业成员');
  await db.query('INSERT INTO memberships(organization_id,user_id,role,department) VALUES($1,$2,$3,$4)',[invite.organization_id,req.customer.id,invite.role,invite.department]);
  await db.query("UPDATE invitations SET status='accepted',accepted_by=$2 WHERE id=$1",[invite.id,req.customer.id]);await audit(db,req.actor,'invitation.accepted',invite.organization_id,invite.id);return {organizationId:invite.organization_id};
 });res.json(result);});
 app.patch(prefix+'/organizations/:org/members/:member',requireCustomer,async(req,res)=>{await transaction(pool,async db=>{
  const actor=await member(db,req.params.org,req.customer.id,true),target=(await db.query('SELECT * FROM memberships WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id(req.params.member),req.params.org])).rows[0];if(!target)throw new HttpError(404,'成员不存在');
  const next=desired({role:req.body.role??target.role,department:req.body.department??target.department}),status=req.body.status??target.status;
  if(next.role!==target.role&&next.role!=='member')throw new HttpError(400,'当前只支持企业代表人与企业员工两种身份');
  if(!['active','suspended'].includes(status))throw new HttpError(400,'成员状态不正确');
  if(!canManage(actor,target)||!canManage(actor,next))throw new HttpError(403,'不能修改这个成员或授予该权限');
  if(target.role==='owner'&&target.status==='active'&&(next.role!=='owner'||status!=='active')){const count=Number((await db.query("SELECT count(*) FROM memberships WHERE organization_id=$1 AND role='owner' AND status='active'",[req.params.org])).rows[0].count);if(count<=1)throw new HttpError(409,'企业必须保留至少一位有效所有者');}
  await db.query('UPDATE memberships SET role=$2,department=$3,status=$4 WHERE id=$1',[target.id,next.role,next.department,status]);
  if(status==='suspended')await db.query("UPDATE invitations SET status='revoked' WHERE organization_id=$1 AND invited_by=$2 AND status='pending'",[req.params.org,target.user_id]);
  await audit(db,req.actor,'member.updated',req.params.org,target.id,{before:{role:target.role,department:target.department,status:target.status},after:{...next,status}});
 });res.json({ok:true});});
 app.delete(prefix+'/organizations/:org/members/:member',requireCustomer,async(req,res)=>{await transaction(pool,async db=>{
  const actor=await member(db,req.params.org,req.customer.id,true),target=(await db.query('SELECT * FROM memberships WHERE id=$1 AND organization_id=$2',[id(req.params.member),req.params.org])).rows[0];if(!target)throw new HttpError(404,'成员不存在');
  if(target.user_id!==req.customer.id&&!canManage(actor,target))throw new HttpError(403,'不能移除这个成员');
  if(target.role==='owner'&&target.status==='active'){const count=Number((await db.query("SELECT count(*) FROM memberships WHERE organization_id=$1 AND role='owner' AND status='active'",[req.params.org])).rows[0].count);if(count<=1)throw new HttpError(409,'请先将所有者权限交接给另一位成员');}
  await db.query("UPDATE invitations SET status='revoked' WHERE organization_id=$1 AND invited_by=$2 AND status='pending'",[req.params.org,target.user_id]);
  await db.query('DELETE FROM memberships WHERE id=$1',[target.id]);await audit(db,req.actor,'member.removed',req.params.org,target.user_id,{role:target.role});
 });res.json({ok:true});});
 app.get(prefix+'/organizations/:org/audit',requireCustomer,async(req,res)=>{const m=await member(pool,req.params.org,req.customer.id);if(!['owner','admin'].includes(m.role))throw new HttpError(403,'仅企业管理员可以查看完整审计');res.json((await pool.query('SELECT action,actor_id,subject_id,detail,created_at FROM audit_events WHERE organization_id=$1 ORDER BY id DESC LIMIT 100',[req.params.org])).rows);});
}
