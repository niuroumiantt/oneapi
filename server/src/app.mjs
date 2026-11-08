import express from 'express';
import { fromNodeHeaders,toNodeHandler } from 'better-auth/node';
import { HttpError,hash } from './core.mjs';
import { customerAuth } from './auth.mjs';
import { mailService } from './mail.mjs';
import { organizationRoutes } from './organizations.mjs';
import { staffRoutes } from './staff.mjs';
import { supplierRoutes } from './suppliers.mjs';
import { promotionRoutes } from './promotions.mjs';
import { pricingRoutes } from './pricing.mjs';
import { validationRoutes } from './validations.mjs';
import { productReviewRoutes } from './product-reviews.mjs';
import { demoJourneyRoutes } from './demo-journey.mjs';
import { billingRoutes } from './billing.mjs';
import { supplierLabRoutes } from './supplier-lab.mjs';
export function createApp(pool,cfg,transport){
 const app=express(),mail=mailService(pool,cfg,transport),auth=customerAuth(pool,cfg,mail);
 app.disable('x-powered-by');app.set('trust proxy',1);
 app.use('/api',(req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==cfg.origin)return res.status(403).json({error:'请求来源不匹配，请从本站重新操作。'});if(Number(req.headers['content-length']||0)>16384)return res.status(413).json({error:'请求内容过大'});next();});
 app.use('/api',async(req,res,next)=>{
  const key=hash((req.headers['x-real-ip']||req.ip)+'|'+req.path.split('/').slice(0,3).join('/'));
  const r=(await pool.query("INSERT INTO request_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.expires_at<now() THEN 1 ELSE request_limits.count+1 END,expires_at=CASE WHEN request_limits.expires_at<now() THEN now()+interval '1 minute' ELSE request_limits.expires_at END RETURNING count",[key])).rows[0];
  if(r.count>120){res.set('Retry-After','60');return res.status(429).json({error:'操作频繁，请稍后再试。'});}next();
 });
 const allowed=new Set(['sign-up/email','sign-in/email','sign-out','get-session','verify-email','send-verification-email','request-password-reset','reset-password','change-password','list-sessions','revoke-session','revoke-other-sessions']);
 app.all('/api/auth/*path',(req,res,next)=>{const path=req.path.slice('/api/auth/'.length);if(!allowed.has(path))return res.status(404).json({error:'接口不存在'});if(!mail.ready&&['sign-up/email','request-password-reset','send-verification-email'].includes(path))return res.status(503).json({error:'邮件服务暂时不可用，请稍后再试。'});next();},toNodeHandler(auth));
 app.use(express.json({limit:'16kb'}));
 const requireCustomer=async(req,res,next)=>{const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});if(!session?.user)throw new HttpError(401,'请先登录');if(!session.user.emailVerified)throw new HttpError(403,'请先验证邮箱');if(session.user.disabled)throw new HttpError(403,'账户已停用');req.customer={id:session.user.id,name:session.user.name,email:session.user.email,emailVerified:true};req.actor={kind:'customer',id:session.user.id};next();};
 organizationRoutes(app,pool,cfg,requireCustomer);demoJourneyRoutes(app,pool,requireCustomer);billingRoutes(app,pool,requireCustomer);const staff=staffRoutes(app,pool,cfg);supplierRoutes(app,pool,staff.requireStaff);validationRoutes(app,pool,staff.requireStaff);supplierLabRoutes(app,pool,staff.requireStaff);pricingRoutes(app,pool,staff.requireStaff);productReviewRoutes(app,pool,staff.requireStaff);promotionRoutes(app,pool,staff.requireStaff);
 app.get('/api/status',async(req,res)=>{await pool.query('SELECT 1');res.json({app:'oneapi',status:'ok',source_sha:cfg.source,stage:'identity-live',customer_registration_enabled:mail.ready,staff_login_enabled:staff.configured,payments_enabled:false,inference_enabled:false,business_ready:false});});
 app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在'}));
 app.use(express.static(new URL('../../web',import.meta.url).pathname,{index:'index.html',setHeaders(res){res.set('Cache-Control','no-store');}}));
 app.use((err,req,res,_next)=>{if(res.headersSent)return;const status=err instanceof HttpError?err.status:err.status===400?400:500;if(status===500)console.error(JSON.stringify({event:'request_failed',code:err.code||err.name||'ERROR',path:req.path.split('/').slice(0,4).join('/')}));res.status(status).json({error:status===500?'服务暂时不可用，请稍后再试。':err.message});});
 return {app,auth,mail};
}
