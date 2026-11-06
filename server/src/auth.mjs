import { accountEmail } from './email-template.mjs';
import { betterAuth, APIError } from 'better-auth';
export function customerAuth(pool,cfg,mail){
 return betterAuth({
  appName:'semifly.ai',baseURL:cfg.origin,basePath:'/api/auth',secret:cfg.secret,database:pool,trustedOrigins:[cfg.origin],
  emailAndPassword:{enabled:true,requireEmailVerification:true,minPasswordLength:12,maxPasswordLength:128,revokeSessionsOnPasswordReset:true,
   sendResetPassword:async({user,token})=>mail.queue({to:user.email,...accountEmail({kind:'reset',name:user.name,url:`${cfg.origin}/?reset_token=${encodeURIComponent(token)}#reset-password`})})},
  emailVerification:{sendOnSignUp:true,sendOnSignIn:true,autoSignInAfterVerification:true,expiresIn:3600,
   sendVerificationEmail:async({user,url})=>mail.queue({to:user.email,...accountEmail({kind:'verify',name:user.name,url})})},
  session:{expiresIn:60*60*24*7,updateAge:60*60,freshAge:15*60,cookieCache:{enabled:false}},
  user:{additionalFields:{disabled:{type:'boolean',defaultValue:false,input:false}}},
  advanced:{cookiePrefix:'oneapi_customer',useSecureCookies:cfg.production,defaultCookieAttributes:{httpOnly:true,sameSite:'lax',path:'/'},ipAddress:{ipAddressHeaders:['x-real-ip']}},
  rateLimit:{enabled:true,storage:'database',window:60,max:40,customRules:{'/sign-in/email':{window:60,max:8},'/sign-up/email':{window:600,max:5},'/request-password-reset':{window:600,max:4},'/send-verification-email':{window:600,max:4}}},
  databaseHooks:{session:{create:{before:async session=>{const u=(await pool.query('SELECT disabled FROM "user" WHERE id=$1',[session.userId])).rows[0];if(u?.disabled)throw new APIError('FORBIDDEN',{message:'账户已停用，请联系支持。'});return {data:session};}}}},
  logger:{level:'error'}
 });
}
