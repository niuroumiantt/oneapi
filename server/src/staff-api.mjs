import {readPersonalUsage,readPersonalCalls} from './personal-usage.mjs';
import {HttpError} from './core.mjs';
import {employeeCreditRoutes} from './employee-credit.mjs';
import {customerCompareRoutes} from './customer-compare.mjs';

// The company must already have admitted and funded the verified user. A staff
// login never creates a customer, company membership, or an allowance.
export function staffApiIdentity(pool,cfg){
 return async(req,res,next)=>{
  if(req.staff?.status!=='active'||req.staff.role==='pending')throw new HttpError(403,'员工权限尚未开通');
  const org=cfg.employeeCredit?.organizationId;
  const user=org?(await pool.query(`SELECT u.id,u.name,u.email,u."emailVerified"
   FROM staff_members s JOIN "user" u ON lower(u.email)=lower(s.email)
   JOIN memberships m ON m.user_id=u.id AND m.organization_id=$2 AND m.status='active'
   JOIN employee_credit_accounts a ON a.user_id=u.id AND a.organization_id=m.organization_id
   WHERE s.subject=$1 AND s.status='active' AND s.role<>'pending' AND u."emailVerified" AND NOT coalesce(u.disabled,false)
   LIMIT 2`,[req.staff.subject,org])).rows:[];
  if(user.length!==1){
   const message='公司尚未为你的已验证账号分配 API 额度，请联系老板开通。';
   if(req.method==='GET'&&req.path.endsWith('/status'))return res.json({enabled:false,message});
   throw new HttpError(403,message);
  }
  req.customer=user[0]; // Only the server resolves this id; request input is ignored.
  next();
 };
}

export function staffApiRoutes(app,pool,cfg,requireStaff){
 const identity=staffApiIdentity(pool,cfg);
 app.get('/api/staff/self-api/usage',requireStaff,identity,async(req,res)=>res.json(await readPersonalUsage(pool,req.customer.id,req.query.period||'month',{allocated:true})));
 app.get('/api/staff/self-api/usage/calls',requireStaff,identity,async(req,res)=>res.json(await readPersonalCalls(pool,req.customer.id,req.query,{allocated:true})));
 const routes={get:new Set(['/status']),post:new Set(['/keys','/keys/:key/manage','/keys/:key/revoke'])};
 const adapter=Object.fromEntries(['get','post','put'].map(method=>[method,(path,_auth,...handlers)=>{
  const suffix=path.replace('/api/employee-credit','');
  if(routes[method]?.has(suffix))app[method]('/api/staff/self-api'+suffix,requireStaff,identity,...handlers);
 }]));
 // Reuse the same key ownership checks, balance ledger and inference gateway.
 employeeCreditRoutes(adapter,pool,cfg,identity,undefined,{assignedOnly:true});
 customerCompareRoutes(app,pool,cfg,[requireStaff,identity],{prefix:'/api/staff/self-api/compare',allocatedOnly:true});
}
