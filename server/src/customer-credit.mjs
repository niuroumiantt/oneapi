import {performance} from 'node:perf_hooks';
import {HttpError,hash,id,text,token,transaction,audit} from './core.mjs';
import {employeeRoutes,holdYuan,officialFromLog,usageFrom} from './employee-credit.mjs';
import {accountFor,settlePaidCall,refundQuote} from './pack-ledger.mjs';
import {GATEWAY_INSTANCE} from './gateway-instance.mjs';
const pattern=/^Bearer (sf_paid_[A-Za-z0-9_-]{43})$/;
export const paidEnabled=cfg=>Boolean(cfg.customerPaid?.enabled&&cfg.customerPaid?.models?.length&&process.env.SUPPLIER_LAB_SECRET);
export const paidRoutes=async(pool,cfg)=>(await employeeRoutes(pool,cfg)).filter(r=>cfg.customerPaid?.models?.includes(r.model.id));
export function paidBackend(pool,cfg){return {
 matches:req=>pattern.test(req.get('authorization')||''),table:'customer_calls',routes:()=>paidRoutes(pool,cfg),
 async authenticate(req){
  if(!paidEnabled(cfg))throw new HttpError(503,'客户付费调用尚未开放');
  const k=(await pool.query(`SELECT k.id AS key_id,k.*,a.organization_id,a.owner_id AS account_owner FROM customer_api_keys k JOIN billing_accounts a ON a.id=k.account_id JOIN "user" u ON u.id=k.owner_id
   WHERE k.secret_hash=$1 AND k.revoked_at IS NULL AND u."emailVerified" AND NOT coalesce(u.disabled,false)`,[hash(pattern.exec(req.get('authorization'))[1])])).rows[0];
  if(!k)throw new HttpError(401,'平台 Key 无效或已停用');
  // Revalidate membership on every request; a key never carries permanent company authority.
  if(!(await accountFor(pool,k.owner_id,k.organization_id))?.id||(!k.organization_id&&k.account_owner!==k.owner_id))throw new HttpError(401,'账户权限已失效');
  return k;
 },
 async reserve({key,model,route,hold,origin}){
  return transaction(pool,async db=>{
   const a=(await db.query('SELECT * FROM billing_accounts WHERE id=$1 FOR UPDATE',[key.account_id])).rows[0];
   const n=(await db.query(`SELECT coalesce(sum(hold_yuan)*100,0) AS held,count(*) FILTER(WHERE status='pending')::int AS active FROM customer_calls WHERE account_id=$1 AND status IN ('pending','awaiting_bill')`,[a.id])).rows[0];
   if(n.active>=10)throw new HttpError(429,'当前付费账户同时最多 10 个请求','concurrency_limit_exceeded');
   const enough=(await db.query('SELECT $1::numeric-$2::numeric >= $3::numeric*100 AS ok',[a.list_credit_fen,n.held,hold])).rows[0].ok;
   if(!enough)throw new HttpError(402,'可用官价额度不足，请购买额度包或调小 max_tokens');
   const spent=(await db.query("SELECT coalesce(sum(coalesce(charged_yuan,CASE WHEN status IN ('pending','awaiting_bill') THEN hold_yuan END)),0) AS n FROM customer_calls WHERE key_id=$1",[key.key_id])).rows[0].n;
   if(!(await db.query('SELECT $1::numeric+$2::numeric <= $3::numeric AS ok',[spent,hold,key.limit_yuan])).rows[0].ok)throw new HttpError(402,'这把 Key 的消费上限不足','key_limit_reached');
   return (await db.query(`INSERT INTO customer_calls(account_id,key_id,owner_id,model_id,credential_id,price_snapshot,status,hold_yuan,client,gateway_instance) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9) RETURNING id`,[a.id,key.key_id,key.owner_id,model.id,route.credentialId,{...model.rates,multiplier:model.multiplier},hold,origin.client,GATEWAY_INSTANCE])).rows[0].id;
  });
 },
 async answered(call,requestId,usage,started){
  const latency=Math.round(performance.now()-started);
  if(!usage){await pool.query("UPDATE customer_calls SET status='awaiting_bill',upstream_request_id=$2,latency_ms=$3,finished_at=now() WHERE id=$1 AND status='pending'",[call.id,requestId,latency]);return;}
  await settlePaidCall(pool,call.id,holdYuan(call.rates,usage,call.multiplier),usage,'official_price',requestId,latency);
 }
};}
export async function settleCustomerCalls(pool){
 // No estimated charges for customer calls without usable usage evidence. Release after 24h.
 await pool.query(`UPDATE customer_calls c SET status=CASE WHEN upstream_request_id IS NULL THEN 'failed' ELSE 'awaiting_bill' END,error_code='GATEWAY_INTERRUPTED',finished_at=now() WHERE status='pending' AND
 (created_at<now()-interval '20 minutes' OR gateway_instance<>$1 AND NOT EXISTS(SELECT 1 FROM gateway_instances g WHERE g.id=c.gateway_instance AND stopped_at IS NULL AND seen_at>now()-interval '30 seconds'))`,[GATEWAY_INSTANCE]);
 const rows=(await pool.query(`SELECT c.id,c.price_snapshot,r.evidence FROM customer_calls c JOIN supplier_usage_records r ON r.credential_id=c.credential_id AND r.request_id=c.upstream_request_id WHERE c.status='awaiting_bill' ORDER BY c.created_at LIMIT 500`)).rows;
 for(const r of rows){const amount=officialFromLog(r.price_snapshot,r.evidence);if(amount!==null)await settlePaidCall(pool,r.id,amount,{input:r.evidence.input_tokens,cached:r.evidence.cached_input_tokens||0,output:r.evidence.output_tokens},'supplier_tokens',null,null);}
 await pool.query("UPDATE customer_calls SET status='failed',error_code='USAGE_UNVERIFIED',finished_at=coalesce(finished_at,now()) WHERE status='awaiting_bill' AND created_at<now()-interval '24 hours'");
}
export function customerCreditRoutes(app,pool,cfg,requireCustomer){
 const account=async req=>accountFor(pool,req.customer.id,req.query.org? id(req.query.org):null,{create:true});
 app.get('/api/customer-credit/status',requireCustomer,async(req,res)=>{
  const a=await account(req),routes=paidEnabled(cfg)?await paidRoutes(pool,cfg):[];
  const keys=(await pool.query('SELECT id,label,key_hint,model_ids,limit_yuan,created_at,revoked_at FROM customer_api_keys WHERE account_id=$1 ORDER BY created_at DESC',[a.id])).rows;
  const calls=(await pool.query('SELECT id,model_id,status,charged_yuan,input_tokens,cached_input_tokens,output_tokens,latency_ms,error_code,created_at FROM customer_calls WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100',[a.id])).rows;
  const held=(await pool.query("SELECT coalesce(sum(hold_yuan)*100,0) AS n FROM customer_calls WHERE account_id=$1 AND status IN ('pending','awaiting_bill')",[a.id])).rows[0].n;
  res.json({enabled:paidEnabled(cfg),account_id:a.id,base_url:cfg.origin+'/v1',models:routes.map(r=>({id:r.model.id,name:r.model.name})),keys,calls,list_credit_fen:a.list_credit_fen,held_fen:held});
 });
 app.post('/api/customer-credit/keys',requireCustomer,async(req,res)=>{
  if(!paidEnabled(cfg))throw new HttpError(503,'客户付费调用尚未开放');
  const a=await account(req),b=req.body||{},routes=await paidRoutes(pool,cfg),models=[...new Set(Array.isArray(b.models)?b.models:[])];
  if(!models.length||models.some(m=>!routes.some(r=>r.model.id===m)))throw new HttpError(400,'请选择已开放模型');
  if(typeof b.limit_yuan!=='string'||!/^\d{1,6}(\.\d{1,2})?$/.test(b.limit_yuan)||Number(b.limit_yuan)<=0)throw new HttpError(400,'请设置这把 Key 的官价额度消费上限');
  const secret='sf_paid_'+token();
  const key=await transaction(pool,async db=>{
   const row=(await db.query('SELECT list_credit_fen FROM billing_accounts WHERE id=$1 FOR UPDATE',[a.id])).rows[0];
   if(Number(row.list_credit_fen)<=0)throw new HttpError(402,'请先购买额度包');
   if((await db.query('SELECT 1 FROM customer_api_keys WHERE account_id=$1 AND revoked_at IS NULL',[a.id])).rowCount>=5)throw new HttpError(409,'每个付费账户最多保留 5 把有效 Key');
   const k=(await db.query('INSERT INTO customer_api_keys(account_id,owner_id,label,secret_hash,key_hint,model_ids,limit_yuan) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,label,key_hint,model_ids,limit_yuan',[a.id,req.customer.id,text(b.label,'名称',50),hash(secret),secret.slice(-6),models,b.limit_yuan])).rows[0];
   await audit(db,req.actor,'customer.key_created',a.organization_id,k.id,{models});return k;
  });res.status(201).json({key,secret,base_url:cfg.origin+'/v1'});
 });
 app.post('/api/customer-credit/keys/:key/revoke',requireCustomer,async(req,res)=>{const a=await account(req);const r=await pool.query('UPDATE customer_api_keys SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND account_id=$2 RETURNING id',[id(req.params.key),a.id]);if(!r.rowCount)throw new HttpError(404,'Key 不存在');await audit(pool,req.actor,'customer.key_revoked',a.organization_id,req.params.key);res.json({ok:true});});
 app.post('/api/customer-credit/packs/:pack/refund-request',requireCustomer,async(req,res)=>{
  const a=await account(req),q=await refundQuote(pool,id(req.params.pack));if(q.account_id!==a.id)throw new HttpError(404,'额度包不存在');if(q.blocked)throw new HttpError(409,q.blocked);
  await pool.query(`INSERT INTO credit_refund_requests(pack_id,requested_by,reason) VALUES($1,$2,$3) ON CONFLICT(pack_id) WHERE status IN ('requested','processing') DO NOTHING`,[q.id,req.customer.id,text(req.body?.reason,'退款原因',200)]);
  res.json({status:'requested',net_fen:q.net_fen,fee_fen:q.fee_fen});
 });
}
