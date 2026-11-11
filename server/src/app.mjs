import {aliyunRoutes} from './aliyun-readonly.mjs';
import {serverObservationRoutes} from './server-observation.mjs';
import express from 'express';
import { workspaceRoutes,requireBusiness } from './workspaces.mjs';
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
import { paymentRoutes,staffPaymentRoutes } from './payments.mjs';
import { alipayClient } from './alipay.mjs';
import { supplierLabRoutes } from './supplier-lab.mjs';
import { pilotInferenceRoutes } from './pilot-inference.mjs';
import { customerBackofficeRoutes,staffBackofficeRoutes } from './backoffice.mjs';
import { employeeCreditRoutes,employeeInferenceRoutes } from './employee-credit.mjs';
import { acceptanceRoutes } from './acceptance.mjs';
import { compareRoutes } from './compare.mjs';
import { stressRoutes } from './stress.mjs';
import { upstreamRoutes } from './upstream.mjs';
import { evalKeyRoutes } from './eval-keys.mjs';
import { featureCompareRoutes } from './feature-compare.mjs';
export function createApp(pool,cfg,transport){
 const app=express(),mail=mailService(pool,cfg,transport),auth=customerAuth(pool,cfg,mail),alipay=cfg.alipay?.enabled?alipayClient(cfg.alipay,cfg.alipayFetch||fetch):null;
 app.disable('x-powered-by');app.set('trust proxy',1);
 app.use('/api',(req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==cfg.origin&&req.path!=='/payments/alipay/notify')return res.status(403).json({error:'请求来源不匹配，请从本站重新操作。'});if(Number(req.headers['content-length']||0)>16384)return res.status(413).json({error:'请求内容过大'});next();});
 app.use('/api',async(req,res,next)=>{
  const key=hash((req.headers['x-real-ip']||req.ip)+'|'+req.path.split('/').slice(0,3).join('/'));
  const r=(await pool.query("INSERT INTO request_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.expires_at<now() THEN 1 ELSE request_limits.count+1 END,expires_at=CASE WHEN request_limits.expires_at<now() THEN now()+interval '1 minute' ELSE request_limits.expires_at END RETURNING count",[key])).rows[0];
  if(r.count>120){res.set('Retry-After','60');return res.status(429).json({error:'操作频繁，请稍后再试。'});}next();
 });
 const allowed=new Set(['sign-up/email','sign-in/email','sign-out','get-session','verify-email','send-verification-email','request-password-reset','reset-password','change-password','list-sessions','revoke-session','revoke-other-sessions']);
 app.all('/api/auth/*path',(req,res,next)=>{const path=req.path.slice('/api/auth/'.length);if(!allowed.has(path))return res.status(404).json({error:'接口不存在'});if(!mail.ready&&['sign-up/email','request-password-reset','send-verification-email'].includes(path))return res.status(503).json({error:'邮件服务暂时不可用，请稍后再试。'});next();},toNodeHandler(auth));
 employeeInferenceRoutes(app,pool,cfg,cfg.pilotFetch||fetch);
 app.use(express.json({limit:'16kb'}));
 const requireCustomer=async(req,res,next)=>{const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});if(!session?.user)throw new HttpError(401,'请先登录');if(!session.user.emailVerified)throw new HttpError(403,'请先验证邮箱');if(session.user.disabled)throw new HttpError(403,'账户已停用');req.customer={id:session.user.id,name:session.user.name,email:session.user.email,emailVerified:true};req.actor={kind:'customer',id:session.user.id};next();};
 employeeCreditRoutes(app,pool,cfg,requireCustomer,cfg.pilotFetch||fetch);pilotInferenceRoutes(app,pool,cfg,requireCustomer,cfg.pilotFetch||fetch);organizationRoutes(app,pool,cfg,requireCustomer);demoJourneyRoutes(app,pool,requireCustomer);billingRoutes(app,pool,requireCustomer,cfg,paymentRoutes(app,pool,requireCustomer,cfg,alipay));const staff=staffRoutes(app,pool,cfg);workspaceRoutes(app,pool,staff.requireStaff,cfg);serverObservationRoutes(app,pool,staff.requireStaff,cfg);aliyunRoutes(app,pool,staff.requireStaff);supplierRoutes(app,pool,staff.requireStaff);validationRoutes(app,pool,staff.requireStaff);supplierLabRoutes(app,pool,staff.requireStaff);pricingRoutes(app,pool,staff.requireStaff);productReviewRoutes(app,pool,staff.requireStaff);promotionRoutes(app,pool,staff.requireStaff);
 customerBackofficeRoutes(app,pool,requireCustomer);staffPaymentRoutes(app,pool,staff.requireStaff,requireBusiness,alipay);staffBackofficeRoutes(app,pool,cfg,staff.requireStaff);acceptanceRoutes(app,pool,cfg,staff.requireStaff,cfg.pilotFetch||fetch);compareRoutes(app,pool,cfg,staff.requireStaff,cfg.pilotFetch||fetch);stressRoutes(app,pool,cfg,staff.requireStaff,cfg.pilotFetch||fetch);upstreamRoutes(app,pool,cfg,staff.requireStaff,cfg.pilotFetch||fetch);evalKeyRoutes(app,pool,cfg,staff.requireStaff,cfg.pilotFetch||fetch);featureCompareRoutes(app,pool,cfg,staff.requireStaff,cfg.pilotFetch||fetch);
 app.get('/api/status',async(req,res)=>{await pool.query('SELECT 1');res.json({app:'oneapi',status:'ok',source_sha:cfg.source,stage:'identity-live',customer_registration_enabled:mail.ready,staff_login_enabled:staff.configured,payments_enabled:Boolean(alipay),inference_enabled:false,pilot_inference_enabled:Boolean(cfg.pilot?.keyFile&&cfg.pilot?.emails?.size),business_ready:false});});
 app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在'}));
 app.use(express.static(new URL('../../web',import.meta.url).pathname,{index:'index.html',setHeaders(res){res.set('Cache-Control','no-store');}}));
 app.use((err,req,res,_next)=>{if(res.headersSent)return;const status=err instanceof HttpError?err.status:Number.isInteger(err.status)&&err.status>=400&&err.status<500?err.status:500;if(status===401&&req.method==='GET'&&['/api/staff/workspace/console','/api/staff/console'].includes(req.path))return res.redirect(302,'/api/staff/login?next=business');if(status===401&&req.method==='GET'&&req.path==='/api/staff/lab/console')return res.redirect(302,'/api/staff/login?next=lab');if(status===500)console.error(JSON.stringify({event:'request_failed',code:err.code||err.name||'ERROR',path:req.path.split('/').slice(0,4).join('/')}));const message=status===500?'服务暂时不可用，请稍后再试。':err.message;
 // OpenAI-compatible clients only show error.message from an object.
 if(req.path.startsWith('/v1/')){
  const codes={400:'invalid_request',401:'invalid_api_key',402:'insufficient_quota',403:'model_not_allowed',404:'not_found',413:'request_too_large',429:'rate_limit_exceeded',502:'upstream_error',503:'service_unavailable'};
  const code=(err instanceof HttpError&&err.code)||codes[status]||'server_error';
  return res.status(status).json({error:{message,type:status===429?'rate_limit_error':status>=500?'server_error':'invalid_request_error',code,status,request_id:req.requestId||null,doc_url:`${cfg.origin}/#docs/errors/${code}`}});
 }
 res.status(status).json({error:message});});
 return {app,auth,mail};
}
