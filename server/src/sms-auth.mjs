import {createHmac,randomUUID} from 'node:crypto';
import {APIError,createAuthEndpoint,getAuthoritativeSessionFromCtx} from 'better-auth/api';
import {setSessionCookie} from 'better-auth/cookies';
import {z} from 'zod';
import {transaction} from './core.mjs';
import {rpcBody} from './aliyun-readonly.mjs';
import {dummyPasswordHash,passwordMessage,validPassword} from './password-policy.mjs';

function ecsCredentials(roleName,fetcher){
 const metadata='http://100.100.100.200/latest';
 let credentials, refresh;
 async function load(){
  const metaFetch=(path,options)=>fetcher(metadata+path,{...options,redirect:'error',signal:AbortSignal.timeout(2500)});
  const token=await metaFetch('/api/token',{method:'PUT',headers:{'X-aliyun-ecs-metadata-token-ttl-seconds':'60'}});
  if(!token.ok)throw Error('ECS metadata token unavailable');
  const response=await metaFetch('/meta-data/ram/security-credentials/'+encodeURIComponent(roleName),{
   headers:{'X-aliyun-ecs-metadata-token':await token.text()},
  });
  if(!response.ok)throw Error('ECS role credentials unavailable');
  const data=await response.json(),expiresAt=Date.parse(data.Expiration);
  if(data.Code!=='Success'||!data.AccessKeyId||!data.AccessKeySecret||!data.SecurityToken||!(expiresAt>Date.now()+60000)){
   throw Error('ECS role credentials invalid');
  }
  return {accessKeyId:data.AccessKeyId,accessKeySecret:data.AccessKeySecret,securityToken:data.SecurityToken,expiresAt};
 }
 return async()=>{
  if(credentials?.expiresAt>Date.now()+60000)return credentials;
  refresh??=load().then(next=>credentials=next).finally(()=>{refresh=null;});
  return refresh;
 };
}

export function pnvsSms(config,fetcher=fetch){
 const credentials=config.roleName?ecsCredentials(config.roleName,fetcher):async()=>config;
 async function request(action,phone,challenge,fields){
  const {accessKeyId,accessKeySecret,securityToken}=await credentials();
  const params={Action:action,Version:'2017-05-25',AccessKeyId:accessKeyId,Format:'JSON',
   SignatureMethod:'HMAC-SHA1',SignatureNonce:randomUUID(),SignatureVersion:'1.0',
   Timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),CountryCode:'86',PhoneNumber:phone,OutId:challenge,...fields};
  if(config.schemeName)params.SchemeName=config.schemeName;
  if(securityToken)params.SecurityToken=securityToken;
  const response=await fetcher('https://dypnsapi.aliyuncs.com/',{method:'POST',redirect:'error',
   headers:{'Content-Type':'application/x-www-form-urlencoded'},body:rpcBody(params,accessKeySecret),signal:AbortSignal.timeout(8000)});
  const body=await response.json();
  return response.ok&&body.Code==='OK'&&body.Success===true?body.Model:null;
 }
 return {
  async send(phone,challenge,purpose){
   const template=purpose==='password'?'100003':purpose==='bind'&&config.bindTemplateCode?config.bindTemplateCode:config.templateCode;
   const model=await request('SendSmsVerifyCode',phone,challenge,{SignName:config.signName,TemplateCode:template,
    TemplateParam:JSON.stringify({code:'##code##',min:'5'}),CodeLength:6,CodeType:1,ValidTime:300,DuplicatePolicy:1,Interval:60,ReturnVerifyCode:false,AutoRetry:0});
   return !!model;
  },
  async verify(phone,challenge,code){
   const model=await request('CheckSmsVerifyCode',phone,challenge,{VerifyCode:code});
   return model?.OutId===challenge&&model.VerifyResult==='PASS';
  },
 };
}

const phoneInput=z.string().trim().max(32);
const purposeInput=z.enum(['login','bind','register','password']);
export const phoneAccountEmailDomain='phone-account.invalid';
const invalidCode=()=>new APIError('BAD_REQUEST',{code:'SMS_CODE_INVALID',message:'验证码无效或已过期，请重试。'});
function recipient(value){
 const number=value.replace(/[ -]/g,'').replace(/^(?:\+86|0086)/,'');
 if(!/^1[3-9]\d{9}$/.test(number))throw new APIError('BAD_REQUEST',{code:'SMS_PHONE_INVALID',message:'请输入有效的中国大陆手机号。'});
 return number;
}
async function limit(db,key,max,seconds){
 const {rows:[row]}=await db.query(`INSERT INTO request_limits(key,count,expires_at) VALUES($1,1,now()+make_interval(secs=>$3))
  ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.expires_at<=now() THEN 1 ELSE request_limits.count+1 END,
   expires_at=CASE WHEN request_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE request_limits.expires_at END
  WHERE request_limits.expires_at<=now() OR request_limits.count<$2 RETURNING count`,[key,max,seconds]);
 if(!row)throw new APIError('TOO_MANY_REQUESTS',{code:'SMS_THROTTLED',message:'尝试次数过多，请稍后重试。'});
}
async function enabledCustomer(ctx,requireEmail=false){
 const current=await getAuthoritativeSessionFromCtx(ctx);
 const user=current?.user;
 if(!user||user.disabled||(!user.emailVerified&&(requireEmail||!user.phoneOnly))){
  throw new APIError('UNAUTHORIZED',{message:requireEmail?'请先登录已验证的邮箱账号。':'请先登录。'});
 }
 return user;
}

async function phonePasswordOwner(pool,ctx,digest){
 const user=await enabledCustomer(ctx);
 if(!user.phoneOnly)throw new APIError('FORBIDDEN',{message:'请在设置中使用当前密码修改密码。'});
 const {rowCount}=await pool.query('SELECT 1 FROM customer_sms_phones WHERE user_id=$1 AND phone_hash=$2',[user.id,digest]);
 if(!rowCount)throw new APIError('FORBIDDEN',{message:'请输入当前账号绑定的手机号。'});
 return user;
}

async function savePhonePassword(pool,ctx,userId,challenge,digest,newPassword){
 const password=await ctx.context.password.hash(newPassword);
 const session=await getAuthoritativeSessionFromCtx(ctx);
 if(!session||session.user?.id!==userId)throw invalidCode();
 await transaction(pool,async db=>{
  const {rowCount}=await db.query(`SELECT 1 FROM "user" u JOIN customer_sms_phones p ON p.user_id=u.id
   WHERE u.id=$1 AND p.phone_hash=$2 AND u."phoneOnly" AND NOT u.disabled FOR UPDATE OF u,p`,[userId,digest]);
  if(!rowCount)throw invalidCode();
  const consumed=await db.query(`DELETE FROM customer_sms_challenges
   WHERE id=$1 AND purpose='password' AND user_id=$2 AND expires_at>now() RETURNING id`,[challenge,userId]);
  if(!consumed.rowCount)throw invalidCode();
  const existing=await db.query(`UPDATE "account" SET password=$2,"updatedAt"=now()
   WHERE "userId"=$1 AND "providerId"='credential' RETURNING id`,[userId,password]);
  if(!existing.rowCount)await db.query(`INSERT INTO "account" (id,"userId","providerId","accountId",password,"createdAt","updatedAt")
   VALUES($1,$2,'credential',$2,$3,now(),now())`,[randomUUID(),userId,password]);
  await db.query('DELETE FROM "session" WHERE "userId"=$1 AND id<>$2',[userId,session.session.id]);
  await db.query("DELETE FROM customer_sms_challenges WHERE user_id=$1 AND purpose='password'",[userId]);
 });
 return ctx.json({ok:true});
}

async function finishPhoneRegistration(pool,challenge,digest,phone){
 const duplicate=()=>new APIError('CONFLICT',{code:'SMS_PHONE_ALREADY_REGISTERED',message:'该手机号已注册，请直接短信登录。'});
 try{
  const userId=await transaction(pool,async db=>{
   const consumed=await db.query('DELETE FROM customer_sms_challenges WHERE id=$1 AND expires_at>now() RETURNING id',[challenge]);
   if(!consumed.rowCount)throw invalidCode();
   const existing=await db.query('SELECT user_id FROM customer_sms_phones WHERE phone_hash=$1',[digest]);
   if(existing.rowCount)return null;
   const id=randomUUID();
   // Better Auth requires a unique email field. This address is internal and cannot receive mail.
   await db.query(`INSERT INTO "user" (id,name,email,"emailVerified","phoneOnly",disabled,"createdAt","updatedAt")
    VALUES($1,'OneAPI 用户',$2,false,true,false,now(),now())`,[id,`phone-${id}@${phoneAccountEmailDomain}`]);
   await db.query('INSERT INTO customer_sms_phones(user_id,phone_hash,last_four) VALUES($1,$2,$3)',[id,digest,phone.slice(-4)]);
   return id;
  });
  if(!userId)throw duplicate();
  return userId;
 }catch(error){
  if(error.code==='23505'&&error.constraint==='customer_sms_phones_phone_hash_key')throw duplicate();
  throw error;
 }
}

export function customerSmsAuth(pool,config,provider=pnvsSms(config)){
 const key=value=>createHmac('sha256',config.phoneHashSecret).update(value).digest('hex');
 const phoneKey=phone=>key('sms-phone:'+phone);
 const deliver=async(phone,challenge,purpose)=>{
  try{return await provider.send(phone,challenge,purpose);}
  catch{return false;}
 };
 const check=async(phone,challenge,code)=>{
  try{return await provider.verify(phone,challenge,code);}
  catch{return false;}
 };
 return {id:'oneapi-sms',endpoints:{
  smsBindingStatus:createAuthEndpoint('/sms/binding',{method:'GET'},async ctx=>{
   const user=await enabledCustomer(ctx);
   const {rows:[binding]}=await pool.query('SELECT last_four FROM customer_sms_phones WHERE user_id=$1',[user.id]);
   const result={lastFour:binding?.last_four||null};
   if(user.phoneOnly)result.hasPassword=Boolean((await ctx.context.internalAdapter.findCredentialAccount(user.id))?.password);
   return ctx.json(result);
  }),
  phonePasswordLogin:createAuthEndpoint('/sms/sign-in-password',{method:'POST',
   body:z.object({phone:phoneInput,password:z.string().min(1).max(128)})},async ctx=>{
   const digest=phoneKey(recipient(ctx.body.phone));
   const ip=ctx.request?.headers.get('x-real-ip')||'unknown';
   await transaction(pool,async db=>{
    await limit(db,key('phone-password-ip:'+ip),20,900);
    await limit(db,key('phone-password-number:'+digest),8,900);
   });
   const {rows:[account]}=await pool.query(`SELECT u.id,a.password FROM customer_sms_phones p
    JOIN "user" u ON u.id=p.user_id JOIN "account" a ON a."userId"=u.id AND a."providerId"='credential'
    WHERE p.phone_hash=$1 AND u."phoneOnly" AND NOT u.disabled`,[digest]);
   const matches=await ctx.context.password.verify({hash:account?.password||dummyPasswordHash,password:ctx.body.password});
   if(!account?.password||!matches)throw new APIError('UNAUTHORIZED',{message:'手机号或密码不正确。也可以用短信验证码登录。'});
   return signIn(ctx,account.id,account.password);
  }),
  smsSend:createAuthEndpoint('/sms/send',{method:'POST',body:z.object({phone:phoneInput,purpose:purposeInput,password:z.string().max(128).optional()})},async ctx=>{
   const {purpose,password}=ctx.body,phone=recipient(ctx.body.phone),digest=phoneKey(phone),challenge=randomUUID();
   const passwordOwner=purpose==='password'?await phonePasswordOwner(pool,ctx,digest):null;
   const ip=ctx.request?.headers.get('x-real-ip')||'unknown';
   await transaction(pool,async db=>{
    await limit(db,key('sms-ip:'+ip),10,3600);
    await limit(db,key('sms-interval:'+digest),1,60);
    await limit(db,key('sms-number:'+digest),5,3600);
    await limit(db,key('sms-total'),100,3600);
    if(purpose==='register'){
     await limit(db,key('sms-register-ip:'+ip),5,3600);
     await limit(db,key('sms-register-number:'+digest),3,86400);
    }
   });
   let userId;
   if(purpose==='bind'){
    const user=await enabledCustomer(ctx,true);
    const account=(await ctx.context.internalAdapter.findAccounts(user.id)).find(a=>a.providerId==='credential');
    if(!account?.password||!password||!await ctx.context.password.verify({hash:account.password,password})){
     throw new APIError('FORBIDDEN',{code:'INVALID_PASSWORD',message:'当前密码不正确。'});
    }
    userId=user.id;
   }else if(passwordOwner){
    userId=passwordOwner.id;
   }else if(purpose==='login'){
    const {rows:[bound]}=await pool.query(`SELECT b.user_id FROM customer_sms_phones b JOIN "user" u ON u.id=b.user_id
     WHERE b.phone_hash=$1 AND (u."emailVerified" OR u."phoneOnly") AND NOT u.disabled`,[digest]);
    userId=bound?.user_id;
   }
   await pool.query('DELETE FROM customer_sms_challenges WHERE expires_at<=now()');
   const canSend=Boolean(userId)||purpose==='register';
   if(canSend){
    await limit(pool,key('sms-paid-day'),config.dailySendLimit??50,86400);
   }
   if(canSend&&await deliver(phone,challenge,purpose)){
    await pool.query(`INSERT INTO customer_sms_challenges(id,phone_hash,purpose,user_id) VALUES($1,$2,$3,$4)`,
     [challenge,digest,purpose,userId??null]);
   }else if(purpose!=='login'){
    throw new APIError('SERVICE_UNAVAILABLE',{message:'短信暂时无法发送，请稍后重试。'});
   }
   return ctx.json({challenge,retryAfter:60});
  }),
  smsVerify:createAuthEndpoint('/sms/verify',{method:'POST',body:z.object({phone:phoneInput,purpose:purposeInput,
   challenge:z.uuid(),code:z.string().regex(/^\d{6}$/),newPassword:z.string().max(128).optional()})},async ctx=>{
   const {purpose,challenge,code,newPassword}=ctx.body,phone=recipient(ctx.body.phone),digest=phoneKey(phone);
   if(purpose==='password'&&!validPassword(newPassword))throw new APIError('BAD_REQUEST',{code:'PASSWORD_POLICY',message:passwordMessage});
   const actor=purpose==='password'?await phonePasswordOwner(pool,ctx,digest):purpose==='bind'?await enabledCustomer(ctx,true):null;
   const {rows:[attempt]}=await pool.query(`UPDATE customer_sms_challenges SET attempts=attempts+1
    WHERE id=$1 AND phone_hash=$2 AND purpose=$3 AND expires_at>now() AND attempts<5
     AND ($4::text IS NULL OR user_id=$4)
    RETURNING user_id`,[challenge,digest,purpose,actor?.id||null]);
   if(!attempt||!await check(phone,challenge,code))throw invalidCode();
   if(purpose==='password')return savePhonePassword(pool,ctx,actor.id,challenge,digest,newPassword);
   if(purpose==='register'){
    const userId=await finishPhoneRegistration(pool,challenge,digest,phone);
    return signIn(ctx,userId);
   }
   const {rows:[consumed]}=await pool.query(`DELETE FROM customer_sms_challenges WHERE id=$1 AND expires_at>now() RETURNING user_id`,[challenge]);
   if(!consumed)throw invalidCode();
   if(actor){
    try{
     await pool.query(`INSERT INTO customer_sms_phones(user_id,phone_hash,last_four) VALUES($1,$2,$3)
      ON CONFLICT (user_id) DO UPDATE SET phone_hash=EXCLUDED.phone_hash,last_four=EXCLUDED.last_four,bound_at=now()`,
      [actor.id,digest,phone.slice(-4)]);
    }catch(error){
     if(error.code==='23505')throw new APIError('CONFLICT',{message:'这个手机号已绑定其他账号。'});
     throw error;
    }
    return ctx.json({ok:true,lastFour:phone.slice(-4)});
   }
   const {rows:[binding]}=await pool.query('SELECT user_id FROM customer_sms_phones WHERE phone_hash=$1 AND user_id=$2',[digest,attempt.user_id]);
   if(!binding)throw invalidCode();
   return signIn(ctx,binding.user_id);
  }),
 }};
}

async function signIn(ctx,userId,verifiedPasswordHash){
 const user=await ctx.context.internalAdapter.findUserById(userId);
 if(!(user?.emailVerified||user?.phoneOnly)||user.disabled)throw invalidCode();
 const session=await ctx.context.internalAdapter.createSession(user.id);
 if(!session)throw new APIError('INTERNAL_SERVER_ERROR',{message:'暂时无法登录，请稍后重试。'});
 if(verifiedPasswordHash&&(await ctx.context.internalAdapter.findCredentialAccount(userId))?.password!==verifiedPasswordHash){
  await ctx.context.internalAdapter.deleteSession(session.token);
  throw new APIError('UNAUTHORIZED',{message:'密码已变更，请重新登录。'});
 }
 await setSessionCookie(ctx,{session,user});
 return ctx.json({ok:true});
}
