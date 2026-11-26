import {HttpError} from './core.mjs';
import {isBusinessOwner} from './staff-policy.mjs';
import {organizationRoutes} from './organizations.mjs';
import {employeeCreditRoutes} from './employee-credit.mjs';

// SSO owner session plus an existing verified company-owner membership. Neither
// an email alone nor a customer admin session confers platform-owner rights.
export function staffCompanyRoutes(app,pool,cfg,requireStaff){
 const identity=async(req,res,next)=>{
  if(!isBusinessOwner(req.staff))throw new HttpError(403,'仅老板可以管理公司员工');
  const org=cfg.employeeCredit?.organizationId;
  if(!org)throw new HttpError(404,'公司尚未配置');
  if(req.params.org&&req.params.org!==org)throw new HttpError(403,'不能管理其他企业');
  const users=(await pool.query(`SELECT u.id,u.name,u.email,u."emailVerified" FROM staff_members s
   JOIN "user" u ON lower(u.email)=lower(s.email)
   JOIN memberships m ON m.user_id=u.id AND m.organization_id=$2
   WHERE s.subject=$1 AND s.role='platform_admin' AND s.status='active'
    AND u."emailVerified" AND NOT coalesce(u.disabled,false) AND m.role='owner' AND m.status='active' LIMIT 2`,[req.staff.subject,org])).rows;
  if(users.length!==1)throw new HttpError(403,'老板身份尚未绑定公司所有者，请核对公司账号');
  req.customer=users[0];next();
 };
 const orgAdapter=Object.fromEntries(['get','post','patch','delete'].map(method=>[method,(path,_auth,...handlers)=>{
  if(path.startsWith('/api/platform/organizations/:org'))
   app[method](path.replace('/api/platform','/api/staff/company'),requireStaff,identity,...handlers);
 }]));
 app.get('/api/staff/company/me',requireStaff,identity,async(req,res)=>{
  const org=(await pool.query('SELECT id,name FROM organizations WHERE id=$1',[cfg.employeeCredit.organizationId])).rows[0];
  res.json({user:req.customer,organizations:[{...org,role:'owner',is_manager:true}],backoffice:{},personal_assets:false});
 });
 organizationRoutes(orgAdapter,pool,cfg,identity);
 const creditAdapter=Object.fromEntries(['get','post','put'].map(method=>[method,(path,_auth,...handlers)=>{
  if(path.startsWith('/api/employee-credit/team'))app[method](path.replace('/api/employee-credit','/api/staff/company/credit'),requireStaff,identity,...handlers);
 }]));
 employeeCreditRoutes(creditAdapter,pool,cfg,identity,undefined,{assignedOnly:true});
 app.get('/api/staff/company/credit/status',requireStaff,identity,async(req,res)=>{
  res.json({enabled:true,organization_id:cfg.employeeCredit.organizationId,keys:[],recent_calls:[]});
 });
}
