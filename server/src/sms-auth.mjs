import {createHmac,randomUUID} from 'node:crypto';
import {APIError,createAuthEndpoint,getAuthoritativeSessionFromCtx} from 'better-auth/api';
import {setSessionCookie} from 'better-auth/cookies';
import {z} from 'zod';
import {transaction} from './core.mjs';
import {rpcBody} from './aliyun-readonly.mjs';

export function pnvsSms(config,fetcher=fetch){
 async function request(action,phone,challenge,fields){
  const params={Action:action,Version:'2017-05-25',AccessKeyId:config.accessKeyId,Format:'JSON',
   SignatureMethod:'HMAC-SHA1',SignatureNonce:randomUUID(),SignatureVersion:'1.0',
   Timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),CountryCode:'86',PhoneNumber:phone,OutId:challenge,...fields};
  if(config.schemeName)params.SchemeName=config.schemeName;
  const response=await fetcher('https://dypnsapi.aliyuncs.com/',{method:'POST',redirect:'error',
   headers:{'Content-Type':'application/x-www-form-urlencoded'},body:rpcBody(params,config.accessKeySecret),signal:AbortSignal.timeout(8000)});
  const body=await response.json();
  return response.ok&&body.Code==='OK'&&body.Success===true?body.Model:null;
 }
 return {
  async send(phone,challenge){
   const model=await request('SendSmsVerifyCode',phone,challenge,{SignName:config.signName,TemplateCode:config.templateCode,
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
const purposeInput=z.enum(['login','bind']);
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
 if(!row)throw new APIError('TOO_MANY_REQUESTS',{code:'SMS_THROTTLED',message:'短信请求太频繁，请稍后重试。'});
}
async function enabledCustomer(ctx){
 const current=await getAuthoritativeSessionFromCtx(ctx);
 if(!current?.user?.emailVerified||current.user.disabled)throw new APIError('UNAUTHORIZED',{message:'请先登录已验证的邮箱账号。'});
 return current.user;
}

export function customerSmsAuth(pool,config,provider=pnvsSms(config)){
 const key=value=>createHmac('sha256',config.phoneHashSecret).update(value).digest('hex');
 const phoneKey=phone=>key('sms-phone:'+phone);
 const deliver=async(phone,challenge)=>{
  try{return await provider.send(phone,challenge);}
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
   return ctx.json({lastFour:binding?.last_four||null});
  }),
  smsSend:createAuthEndpoint('/sms/send',{method:'POST',body:z.object({phone:phoneInput,purpose:purposeInput,password:z.string().max(128).optional()})},async ctx=>{
   const {purpose,password}=ctx.body,phone=recipient(ctx.body.phone),digest=phoneKey(phone),challenge=randomUUID();
   const ip=ctx.request?.headers.get('x-real-ip')||'unknown';
   await transaction(pool,async db=>{
    await limit(db,key('sms-ip:'+ip),10,3600);
    await limit(db,key('sms-interval:'+digest),1,60);
    await limit(db,key('sms-number:'+digest),5,3600);
    await limit(db,key('sms-total'),100,3600);
   });
   let userId;
   if(purpose==='bind'){
    const user=await enabledCustomer(ctx);
    const account=(await ctx.context.internalAdapter.findAccounts(user.id)).find(a=>a.providerId==='credential');
    if(!account?.password||!password||!await ctx.context.password.verify({hash:account.password,password})){
     throw new APIError('FORBIDDEN',{code:'INVALID_PASSWORD',message:'当前密码不正确。'});
    }
    userId=user.id;
   }else{
    const {rows:[bound]}=await pool.query(`SELECT b.user_id FROM customer_sms_phones b JOIN "user" u ON u.id=b.user_id
     WHERE b.phone_hash=$1 AND u."emailVerified" AND NOT u.disabled`,[digest]);
    userId=bound?.user_id;
   }
   await pool.query('DELETE FROM customer_sms_challenges WHERE expires_at<=now()');
   if(userId&&await deliver(phone,challenge)){
    await pool.query(`INSERT INTO customer_sms_challenges(id,phone_hash,purpose,user_id) VALUES($1,$2,$3,$4)`,
     [challenge,digest,purpose,userId]);
   }else if(purpose==='bind'){
    throw new APIError('SERVICE_UNAVAILABLE',{message:'短信暂时无法发送，请稍后重试。'});
   }
   return ctx.json({challenge,retryAfter:60});
  }),
  smsVerify:createAuthEndpoint('/sms/verify',{method:'POST',body:z.object({phone:phoneInput,purpose:purposeInput,
   challenge:z.uuid(),code:z.string().regex(/^\d{6}$/)})},async ctx=>{
   const {purpose,challenge,code}=ctx.body,phone=recipient(ctx.body.phone),digest=phoneKey(phone);
   const actor=purpose==='bind'?await enabledCustomer(ctx):null;
   const {rows:[attempt]}=await pool.query(`UPDATE customer_sms_challenges SET attempts=attempts+1
    WHERE id=$1 AND phone_hash=$2 AND purpose=$3 AND expires_at>now() AND attempts<5
     AND ($4::text IS NULL OR user_id=$4)
    RETURNING user_id`,[challenge,digest,purpose,actor?.id||null]);
   if(!attempt||!await check(phone,challenge,code))throw invalidCode();
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
   const user=binding&&await ctx.context.internalAdapter.findUserById(binding.user_id);
   if(!user?.emailVerified||user.disabled)throw invalidCode();
   const session=await ctx.context.internalAdapter.createSession(user.id);
   if(!session)throw new APIError('INTERNAL_SERVER_ERROR',{message:'暂时无法登录，请稍后重试。'});
   await setSessionCookie(ctx,{session,user});
   return ctx.json({ok:true});
  }),
 }};
}
