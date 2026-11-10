import { createHash, randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const token=()=>randomBytes(32).toString('base64url');
export function text(value,label,max=100){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new HttpError(400,`${label}格式不正确`);return value.trim();}
export function email(value){const v=text(value,'邮箱',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))throw new HttpError(400,'邮箱格式不正确');return v;}
export function id(value){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||''))throw new HttpError(404,'记录不存在');return value;}
export async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
export function vault(secret){const key=Buffer.from(hkdfSync('sha256',secret,'oneapi','private-payload-v1',32));return {seal(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64url');},open(value){const b=Buffer.from(value,'base64url'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString());}};}
export async function audit(db,actor,action,org=null,subject=null,detail={}){await db.query('INSERT INTO audit_events(actor_kind,actor_id,organization_id,action,subject_id,detail) VALUES($1,$2,$3,$4,$5,$6)',[actor.kind,actor.id,org,action,subject,JSON.stringify(detail)]);}
export function config(env=process.env){
 const origin=env.APP_ORIGIN||'http://127.0.0.1:4180';const production=env.NODE_ENV==='production';
 if(!env.DATABASE_URL||!env.BETTER_AUTH_SECRET||env.BETTER_AUTH_SECRET.length<32)throw Error('DATABASE_URL and strong BETTER_AUTH_SECRET are required');
 if(production&&!origin.startsWith('https://'))throw Error('Production origin must use HTTPS');
 const bankTransfer={enabled:env.BANK_TRANSFER_VERIFIED==='true'&&!!(env.BANK_TRANSFER_ACCOUNT_NAME&&env.BANK_TRANSFER_BANK_NAME&&env.BANK_TRANSFER_ACCOUNT_NUMBER),accountName:env.BANK_TRANSFER_ACCOUNT_NAME||'',bankName:env.BANK_TRANSFER_BANK_NAME||'',accountNumber:env.BANK_TRANSFER_ACCOUNT_NUMBER||''};
 return {origin,production,employeeCredit:{organizationId:env.EMPLOYEE_CREDIT_ORG_ID||'',models:new Set((env.EMPLOYEE_CREDIT_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean))},pilot:{emails:new Set((env.PILOT_USER_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)),keyFile:env.PILOT_DEEPSEEK_KEY_FILE||''},secret:env.BETTER_AUTH_SECRET,databaseURL:env.DATABASE_URL,port:Number(env.PORT||4180),staffIssuer:env.STAFF_OIDC_ISSUER,staffClientId:env.STAFF_OIDC_CLIENT_ID,staffClientSecret:env.STAFF_OIDC_CLIENT_SECRET,bootstrapSub:env.STAFF_BOOTSTRAP_SUB||'',bankTransfer,smtp:{host:env.SMTP_HOST,port:Number(env.SMTP_PORT||465),secure:env.SMTP_PORT!=='587',auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD}},mailFrom:env.SMTP_FROM||env.SMTP_USER,source:env.SOURCE_SHA||'local'};
}
