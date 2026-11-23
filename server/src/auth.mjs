import { accountEmail } from './email-template.mjs';
import { betterAuth, APIError } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { customerSmsAuth, phoneAccountEmailDomain } from './sms-auth.mjs';
import { validPassword,passwordMessage,dummyPasswordHash } from './password-policy.mjs';
export function customerAuth(pool,cfg,mail){
 return betterAuth({
  appName:'semifly.ai',baseURL:cfg.origin,basePath:'/api/auth',secret:cfg.secret,database:pool,trustedOrigins:[cfg.origin],
  plugins:cfg.sms?[customerSmsAuth(pool,cfg.sms,cfg.smsProvider)]:[],
  emailAndPassword:{enabled:true,requireEmailVerification:true,minPasswordLength:8,maxPasswordLength:128,revokeSessionsOnPasswordReset:true,
   sendResetPassword:async({user,token})=>mail.queue({to:user.email,...accountEmail({kind:'reset',name:user.name,url:`${cfg.origin}/?reset_token=${encodeURIComponent(token)}#reset-password`})})},
  emailVerification:{sendOnSignUp:true,sendOnSignIn:true,autoSignInAfterVerification:true,expiresIn:3600,
   sendVerificationEmail:async({user,url})=>mail.queue({to:user.email,...accountEmail({kind:'verify',name:user.name,url})})},
  session:{expiresIn:60*60*24*7,updateAge:60*60,freshAge:15*60,cookieCache:{enabled:false}},
  user:{additionalFields:{disabled:{type:'boolean',defaultValue:false,input:false},phoneOnly:{type:'boolean',defaultValue:false,input:false}}},
  advanced:{cookiePrefix:'oneapi_customer',useSecureCookies:cfg.production,defaultCookieAttributes:{httpOnly:true,sameSite:'lax',path:'/'},ipAddress:{ipAddressHeaders:['x-real-ip']}},
  rateLimit:{enabled:true,storage:'database',window:60,max:40,customRules:{'/sign-in/email':{window:60,max:8},'/sign-up/email':{window:600,max:5},'/request-password-reset':{window:600,max:4},'/send-verification-email':{window:600,max:4}}},
  databaseHooks:{session:{create:{before:async session=>{const u=(await pool.query('SELECT disabled FROM "user" WHERE id=$1',[session.userId])).rows[0];if(u?.disabled)throw new APIError('FORBIDDEN',{message:'账户已停用，请联系支持。'});return {data:session};}}}},
  hooks:{before:createAuthMiddleware(async ctx=>{
   if(typeof ctx.body?.email==='string'&&ctx.body.email.trim().toLowerCase().endsWith('@'+phoneAccountEmailDomain)){
    throw new APIError('BAD_REQUEST',{message:'请输入有效的邮箱地址。'});
   }
   const field=ctx.path==='/sign-up/email'?'password':['/change-password','/reset-password','/set-password'].includes(ctx.path)?'newPassword':null;
   if(field&&!validPassword(ctx.body?.[field]))throw new APIError('BAD_REQUEST',{code:'PASSWORD_POLICY',message:passwordMessage});
   if(ctx.path==='/sign-up/email'&&typeof ctx.body.email==='string'){
    const email=ctx.body.email.toLowerCase();
    const {rows:[account]}=await pool.query(`SELECT a.password FROM "user" u
     JOIN "account" a ON a."userId"=u.id AND a."providerId"='credential'
     WHERE u.email=$1 AND u."emailVerified" AND NOT u.disabled LIMIT 1`,[email]);
    const matches=await ctx.context.password.verify({hash:account?.password||dummyPasswordHash,password:ctx.body.password});
    if(account?.password&&matches)throw new APIError('CONFLICT',{code:'ACCOUNT_ALREADY_REGISTERED',message:'该邮箱已经注册。'});
   }
  })},
  logger:{level:'error'}
 });
}
