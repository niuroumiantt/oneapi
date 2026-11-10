import { randomUUID } from 'node:crypto';
import { HttpError,id,text,token,hash,vault,transaction,audit } from './core.mjs';
export const roles=['owner','admin','department_admin','billing','member'];
// Customer permissions are deliberately two-level: managers see and run the whole space, members see themselves.
export const managerRoles=['owner','admin','billing'];
export const isManager=role=>managerRoles.includes(role);
export function canManage(actor){return actor.status==='active'&&isManager(actor.role);}
function desired(body){const role=body.role||'member';if(!roles.includes(role))throw new HttpError(400,'角色不正确');const department=typeof body.department==='string'?body.department.trim():'';if(department.length>80||role==='department_admin'&&!department)throw new HttpError(400,'部门管理员必须指定部门');return {role,department};}
export function organizationRoutes(app,pool,cfg,requireCustomer){
 const prefix='/api/platform',linkVault=vault(cfg.secret);
 async function member(db,org,user,lock=false){id(org);if(lock){const r=await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);if(!r.rowCount)throw new HttpError(404,'企业不存在');}
  const m=(await db.query('SELECT * FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status=\'active\'',[org,user])).rows[0];if(!m)throw new HttpError(403,'没有这个企业的访问权限');return m;
 }
 app.get(prefix+'/me',requireCustomer,async(req,res)=>{const orgs=(await pool.query('SELECT o.id,o.name,m.role,m.department FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND m.status=\'active\' ORDER BY o.created_at',[req.customer.id])).rows;const staff=(await pool.query("SELECT s.role,EXISTS(SELECT 1 FROM staff_technical_access t WHERE t.subject=s.subject) AS technical FROM staff_members s WHERE lower(s.email)=lower($1) AND s.status='active' LIMIT 1",[req.customer.email])).rows[0];const upgrade=(await pool.query('SELECT status,reject_reason,organization_id,legal_name FROM account_upgrade_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[req.customer.id])).rows[0]||null;res.json({user:req.customer,upgrade,organizations:orgs.map(o=>({...o,is_manager:isManager(o.role)})),backoffice:{business:Boolean(staff&&staff.role!=='pending'),technical:Boolean(staff&&(staff.role==='platform_admin'||staff.technical))},capabilities:{identity:true,payments:false,inference:false}});});
 app.get(prefix+'/join-links/preview',async(req,res)=>{const secret=text(req.query.token,'企业邀请链接',100);const row=(await pool.query("SELECT o.name AS organization_name,l.status,l.expires_at FROM organization_join_links l JOIN organizations o ON o.id=l.organization_id WHERE l.token_hash=$1",[hash(secret)])).rows[0];if(!row||row.status!=='active'||new Date(row.expires_at)<=new Date())throw new HttpError(400,'企业邀请链接已失效');res.set('Cache-Control','no-store');res.json({organizationName:row.organization_name,expiresAt:row.expires_at});});
 // Enterprises are created only by an approved personal-account upgrade.
 app.post(prefix+'/organizations',requireCustomer,()=>{throw new HttpError(403,'请提交企业升级申请，审核通过后开通企业空间');});
 app.get(prefix+'/organizations/:org',requireCustomer,async(req,res)=>{
  const m=await member(pool,req.params.org,req.customer.id),org=(await pool.query('SELECT id,name,region,created_at FROM organizations WHERE id=$1',[m.organization_id])).rows[0];
  const conditions=isManager(m.role)?'':' AND m.user_id=$2';
  const args=[m.organization_id];if(conditions)args.push(req.customer.id);
  const members=(await pool.query('SELECT m.id,m.user_id,m.role,m.department,m.status,m.created_at,u.name,u.email FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.organization_id=$1'+conditions+' ORDER BY m.created_at',args)).rows;
  let joinLinks=[],joinRequests=[];if(isManager(m.role)){
   joinLinks=(await pool.query("SELECT id,token_secret,status,expires_at,created_at FROM organization_join_links WHERE organization_id=$1 AND status='active' AND expires_at>now() ORDER BY created_at DESC",[m.organization_id])).rows.map(({token_secret,...row})=>({...row,url:cfg.origin+'/#join/'+linkVault.open(token_secret)}));
   joinRequests=(await pool.query("SELECT r.id,r.user_id,r.display_name,r.department,r.status,r.created_at,u.email FROM organization_join_requests r JOIN \"user\" u ON u.id=r.user_id WHERE r.organization_id=$1 AND r.status='pending' ORDER BY r.created_at LIMIT 100",[m.organization_id])).rows;
  }
  res.json({organization:org,membership:m,members,joinLinks,joinRequests,permissions:{manager:isManager(m.role),manageMembers:isManager(m.role),manageOwners:isManager(m.role),viewBilling:isManager(m.role)}});
 });
 app.post(prefix+'/organizations/:org/join-links',requireCustomer,async(req,res)=>{const result=await transaction(pool,async db=>{
  const actor=await member(db,req.params.org,req.customer.id,true);if(!isManager(actor.role))throw new HttpError(403,'仅企业代表人可生成邀请链接');
  const existing=(await db.query("SELECT id,token_secret,expires_at FROM organization_join_links WHERE organization_id=$1 AND status='active' AND expires_at>now() ORDER BY created_at DESC LIMIT 1",[req.params.org])).rows[0];if(existing)return {id:existing.id,expires_at:existing.expires_at,url:cfg.origin+'/#join/'+linkVault.open(existing.token_secret)};
  const secret=token(),row=(await db.query("INSERT INTO organization_join_links(organization_id,created_by,token_hash,token_secret,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days') RETURNING id,expires_at",[req.params.org,req.customer.id,hash(secret),linkVault.seal(secret)])).rows[0];
  await audit(db,req.actor,'join_link.created',req.params.org,row.id);return {...row,url:cfg.origin+'/#join/'+secret};
 });res.status(201).json(result);});
 app.post(prefix+'/organizations/:org/join-links/:link/revoke',requireCustomer,async(req,res)=>{await transaction(pool,async db=>{
  const actor=await member(db,req.params.org,req.customer.id,true);if(!isManager(actor.role))throw new HttpError(403,'仅企业代表人可撤销邀请链接');
  const result=await db.query("UPDATE organization_join_links SET status='revoked' WHERE id=$1 AND organization_id=$2 AND status='active' RETURNING id",[id(req.params.link),req.params.org]);if(!result.rowCount)throw new HttpError(404,'有效邀请链接不存在');
  await audit(db,req.actor,'join_link.revoked',req.params.org,req.params.link);
 });res.json({ok:true});});
 app.post(prefix+'/join-requests',requireCustomer,async(req,res)=>{const secret=text(req.body.token,'企业邀请链接',100);const result=await transaction(pool,async db=>{
  const found=(await db.query('SELECT id,organization_id FROM organization_join_links WHERE token_hash=$1',[hash(secret)])).rows[0];if(!found)throw new HttpError(400,'企业邀请链接已失效');
  await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[found.organization_id]);
  const link=(await db.query('SELECT * FROM organization_join_links WHERE id=$1',[found.id])).rows[0];if(link.status!=='active'||new Date(link.expires_at)<=new Date())throw new HttpError(400,'企业邀请链接已失效');
  const existing=await db.query('SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2',[link.organization_id,req.customer.id]);if(existing.rowCount)throw new HttpError(409,'你已是这家企业的成员');
  const prior=(await db.query('SELECT id,status FROM organization_join_requests WHERE organization_id=$1 AND user_id=$2',[link.organization_id,req.customer.id])).rows[0];if(prior){if(prior.status==='pending')return {organizationId:link.organization_id,status:'pending'};throw new HttpError(409,'已有处理结果，请联系企业代表人');}
  const name=text(req.body.name||req.customer.name,'姓名',80),department=typeof req.body.department==='string'?req.body.department.trim():'';if(department.length>80)throw new HttpError(400,'部门名称过长');
  const row=(await db.query("INSERT INTO organization_join_requests(organization_id,link_id,user_id,display_name,department) VALUES($1,$2,$3,$4,$5) RETURNING id",[link.organization_id,link.id,req.customer.id,name,department])).rows[0];
  await audit(db,req.actor,'join_request.created',link.organization_id,row.id);return {organizationId:link.organization_id,status:'pending'};
 });res.status(202).json(result);});
 app.post(prefix+'/organizations/:org/join-requests/:request/:decision',requireCustomer,async(req,res)=>{const decision=req.params.decision;if(!['approve','reject'].includes(decision))throw new HttpError(404,'操作不存在');await transaction(pool,async db=>{
  const actor=await member(db,req.params.org,req.customer.id,true);if(!isManager(actor.role))throw new HttpError(403,'仅企业代表人可审核加入申请');
  const request=(await db.query('SELECT * FROM organization_join_requests WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id(req.params.request),req.params.org])).rows[0];if(!request)throw new HttpError(404,'加入申请不存在');if(request.status!=='pending')throw new HttpError(409,'申请已处理');
  if(decision==='approve'){const exists=await db.query('SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2',[req.params.org,request.user_id]);if(exists.rowCount)throw new HttpError(409,'申请人已是企业成员');await db.query("INSERT INTO memberships(organization_id,user_id,role,department) VALUES($1,$2,'member',$3)",[req.params.org,request.user_id,request.department]);}
  await db.query('UPDATE organization_join_requests SET status=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1',[request.id,decision==='approve'?'approved':'rejected',req.customer.id]);
  await audit(db,req.actor,'join_request.'+(decision==='approve'?'approved':'rejected'),req.params.org,request.id,{userId:request.user_id});
 });res.json({ok:true});});
 app.patch(prefix+'/organizations/:org/members/:member',requireCustomer,async(req,res)=>{await transaction(pool,async db=>{
  const actor=await member(db,req.params.org,req.customer.id,true),target=(await db.query('SELECT * FROM memberships WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id(req.params.member),req.params.org])).rows[0];if(!target)throw new HttpError(404,'成员不存在');
  const next=desired({role:req.body.role??target.role,department:req.body.department??target.department}),status=req.body.status??target.status;
  if(next.role!==target.role&&!['owner','member'].includes(next.role))throw new HttpError(400,'当前只支持企业管理者与企业成员两种身份');
  if(!['active','suspended'].includes(status))throw new HttpError(400,'成员状态不正确');
  if(!canManage(actor,target)||!canManage(actor,next))throw new HttpError(403,'不能修改这个成员或授予该权限');
  if(isManager(target.role)&&target.status==='active'&&(!isManager(next.role)||status!=='active')){const count=Number((await db.query("SELECT count(*) FROM memberships WHERE organization_id=$1 AND role IN ('owner','admin','billing') AND status='active'",[req.params.org])).rows[0].count);if(count<=1)throw new HttpError(409,'企业必须保留至少一位管理者');}
  await db.query('UPDATE memberships SET role=$2,department=$3,status=$4 WHERE id=$1',[target.id,next.role,next.department,status]);
  if(status==='suspended')await db.query("UPDATE organization_join_links SET status='revoked' WHERE organization_id=$1 AND created_by=$2 AND status='active'",[req.params.org,target.user_id]);
  await audit(db,req.actor,'member.updated',req.params.org,target.id,{before:{role:target.role,department:target.department,status:target.status},after:{...next,status}});
 });res.json({ok:true});});
 app.delete(prefix+'/organizations/:org/members/:member',requireCustomer,async(req,res)=>{await transaction(pool,async db=>{
  const actor=await member(db,req.params.org,req.customer.id,true),target=(await db.query('SELECT * FROM memberships WHERE id=$1 AND organization_id=$2',[id(req.params.member),req.params.org])).rows[0];if(!target)throw new HttpError(404,'成员不存在');
  if(target.user_id!==req.customer.id&&!canManage(actor,target))throw new HttpError(403,'不能移除这个成员');
  if(isManager(target.role)&&target.status==='active'){const count=Number((await db.query("SELECT count(*) FROM memberships WHERE organization_id=$1 AND role IN ('owner','admin','billing') AND status='active'",[req.params.org])).rows[0].count);if(count<=1)throw new HttpError(409,'请先把管理权限交给另一位成员');}
  await db.query("UPDATE organization_join_links SET status='revoked' WHERE organization_id=$1 AND created_by=$2 AND status='active'",[req.params.org,target.user_id]);
  await db.query('DELETE FROM memberships WHERE id=$1',[target.id]);await audit(db,req.actor,'member.removed',req.params.org,target.user_id,{role:target.role});
 });res.json({ok:true});});
 app.get(prefix+'/organizations/:org/audit',requireCustomer,async(req,res)=>{const m=await member(pool,req.params.org,req.customer.id);if(!isManager(m.role))throw new HttpError(403,'仅企业管理员可以查看完整审计');res.json((await pool.query('SELECT action,actor_id,subject_id,detail,created_at FROM audit_events WHERE organization_id=$1 ORDER BY id DESC LIMIT 100',[req.params.org])).rows);});
}
