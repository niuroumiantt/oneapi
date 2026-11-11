// Online recharge through Alipay 当面付. A customer gets a fixed-amount order and its QR code;
// the balance changes only after a signed Alipay result confirms that exact order and amount.
import express from 'express';
import { randomBytes } from 'node:crypto';
import qrcode from 'qrcode-generator';
import { HttpError,id,transaction,audit } from './core.mjs';
import { isManager } from './organizations.mjs';
import { yuanToFen } from './alipay.mjs';

export const RECHARGE_MIN_FEN=500,RECHARGE_MAX_FEN=5000000,ORDER_TTL_MINUTES=15;
const PAID=new Set(['TRADE_SUCCESS','TRADE_FINISHED']);

export function parseRechargeFen(value){
 const fen=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;
 if(!Number.isSafeInteger(fen)||fen<RECHARGE_MIN_FEN||fen>RECHARGE_MAX_FEN)throw new HttpError(400,'充值金额须在 ¥5.00 至 ¥50,000.00 之间');
 return fen;
}
const outTradeNo=()=>'OA'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+randomBytes(6).toString('hex');
function qrSvg(text){const q=qrcode(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:2,scalable:true});}
function orderView(o){
 return {id:o.id,provider:o.provider,status:o.status,amount_fen:String(o.amount_fen),expires_at:o.expires_at,paid_at:o.paid_at,expired:o.status==='pending'&&new Date(o.expires_at)<new Date(),qr_svg:o.status==='pending'&&o.qr_code&&new Date(o.expires_at)>new Date()?qrSvg(o.qr_code):null};
}

// Single place where a confirmed payment becomes money. Row lock + ledger unique key make
// repeated notifies, queries and TRADE_FINISHED-after-TRADE_SUCCESS credit exactly once.
export async function creditPaidOrder(pool,outTradeNoValue,{tradeNo,totalAmount},source){
 return transaction(pool,async db=>{
  const o=(await db.query('SELECT * FROM payment_orders WHERE out_trade_no=$1 FOR UPDATE',[outTradeNoValue])).rows[0];
  if(!o)throw Error('PAYMENT_ORDER_UNKNOWN');
  if(o.status==='paid'){if(o.provider_trade_no!==tradeNo)throw Error('PAYMENT_TRADE_MISMATCH');return {order:o,credited:false};}
  if(!tradeNo||yuanToFen(totalAmount)!==BigInt(o.amount_fen))throw Error('PAYMENT_AMOUNT_MISMATCH');
  const account=(await db.query('UPDATE billing_accounts SET cash_balance_fen=cash_balance_fen+$2 WHERE id=$1 RETURNING cash_balance_fen,organization_id',[o.account_id,o.amount_fen])).rows[0];
  await db.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'recharge',$2,$3,'payment',$4)",[o.account_id,o.amount_fen,account.cash_balance_fen,o.id]);
  const order=(await db.query("UPDATE payment_orders SET status='paid',provider_trade_no=$2,paid_at=now(),updated_at=now() WHERE id=$1 RETURNING *",[o.id,tradeNo])).rows[0];
  await audit(db,{kind:'system',id:source},'billing.recharge.alipay_paid',account.organization_id,o.id,{amount_fen:String(o.amount_fen),provider_trade_no:tradeNo});
  return {order,credited:true};
 });
}

export function paymentRoutes(app,pool,requireCustomer,cfg,alipay){
 const allowed=customer=>Boolean(alipay)&&(!cfg.alipay?.allowedEmails?.size||cfg.alipay.allowedEmails.has(customer.email.toLowerCase()));
 const notifyUrl=cfg.origin+'/api/payments/alipay/notify';
 const closeOrder=outTradeNoValue=>pool.query("UPDATE payment_orders SET status='closed',updated_at=now() WHERE out_trade_no=$1 AND status='pending'",[outTradeNoValue]);

 async function precreate(order){
  let r;try{r=await alipay.precreate({outTradeNo:order.out_trade_no,amountFen:order.amount_fen,subject:'OneAPI 账户充值',notifyUrl,timeoutMinutes:ORDER_TTL_MINUTES});}
  catch(e){console.error(JSON.stringify({event:'alipay_precreate_failed',code:e.message}));throw new HttpError(502,'支付宝暂时无法生成付款码，请稍后重试。');}
  if(r?.code!=='10000'||!r.qr_code){console.error(JSON.stringify({event:'alipay_precreate_rejected',code:r?.code,sub_code:r?.sub_code}));throw new HttpError(502,'支付宝暂时无法生成付款码，请稍后重试。');}
  return (await pool.query('UPDATE payment_orders SET qr_code=$2,updated_at=now() WHERE id=$1 RETURNING *',[order.id,r.qr_code])).rows[0];
 }

 async function createOrder(req,res,ownerColumn,ownerValue){
  if(!allowed(req.customer))throw new HttpError(403,'支付宝充值尚未对当前账户开放');
  const amount=parseRechargeFen(req.body?.amount_fen),key=req.body?.idempotency_key;
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(key))throw new HttpError(400,'请刷新页面后重试');
  await pool.query(`INSERT INTO billing_accounts(${ownerColumn}) VALUES($1) ON CONFLICT (${ownerColumn}) WHERE ${ownerColumn} IS NOT NULL DO NOTHING`,[ownerValue]);
  const account=(await pool.query(`SELECT id FROM billing_accounts WHERE ${ownerColumn}=$1`,[ownerValue])).rows[0];
  let order=(await pool.query(`INSERT INTO payment_orders(out_trade_no,account_id,created_by,provider,amount_fen,idempotency_key,expires_at) VALUES($1,$2,$3,'alipay_f2f',$4,$5,now()+make_interval(mins=>$6)) ON CONFLICT(created_by,idempotency_key) DO NOTHING RETURNING *`,[outTradeNo(),account.id,req.customer.id,amount,key,ORDER_TTL_MINUTES])).rows[0];
  const created=Boolean(order);
  if(!order){
   order=(await pool.query('SELECT * FROM payment_orders WHERE created_by=$1 AND idempotency_key=$2',[req.customer.id,key])).rows[0];
   if(order.account_id!==account.id||Number(order.amount_fen)!==amount)throw new HttpError(409,'该笔订单信息已变化，请刷新页面后重新充值');
  }
  if(order.status==='pending'&&!order.qr_code&&new Date(order.expires_at)>new Date())order=await precreate(order);
  res.status(created?201:200).json({order:orderView(order)});
 }
 app.post('/api/billing/personal/alipay-orders',requireCustomer,(req,res)=>createOrder(req,res,'owner_id',req.customer.id));
 app.post('/api/billing/organizations/:org/alipay-orders',requireCustomer,async(req,res)=>{
  const org=id(req.params.org),membership=(await pool.query("SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[org,req.customer.id])).rows[0];
  if(!membership||!isManager(membership.role))throw new HttpError(403,'仅企业管理者可以为企业充值');
  await createOrder(req,res,'organization_id',org);
 });

 // Polling endpoint. While pending it actively queries Alipay so a lost notify never strands a paid order.
 app.get('/api/billing/alipay-orders/:id',requireCustomer,async(req,res)=>{
  const row=(await pool.query('SELECT o.*,a.owner_id,a.organization_id FROM payment_orders o JOIN billing_accounts a ON a.id=o.account_id WHERE o.id=$1',[id(req.params.id)])).rows[0];
  let visible=row&&(row.created_by===req.customer.id||row.owner_id===req.customer.id);
  if(row&&!visible&&row.organization_id){const m=(await pool.query("SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[row.organization_id,req.customer.id])).rows[0];visible=Boolean(m&&isManager(m.role));}
  if(!visible)throw new HttpError(404,'记录不存在');
  let order=row;
  if(order.status==='pending'&&alipay){
   try{
    const r=await alipay.query(order.out_trade_no);
    if(r?.code==='10000'&&r.out_trade_no===order.out_trade_no&&PAID.has(r.trade_status))order=(await creditPaidOrder(pool,order.out_trade_no,{tradeNo:r.trade_no,totalAmount:r.total_amount},'alipay-query')).order;
    else if(r?.code==='10000'&&r.trade_status==='TRADE_CLOSED')await closeOrder(order.out_trade_no);
    else if(r?.sub_code==='ACQ.TRADE_NOT_EXIST'&&new Date(order.expires_at).getTime()+120e3<Date.now())await closeOrder(order.out_trade_no);
   }catch(e){console.error(JSON.stringify({event:'alipay_query_failed',code:e.message}));}
   order=(await pool.query('SELECT * FROM payment_orders WHERE id=$1',[order.id])).rows[0];
  }
  res.json({order:orderView(order)});
 });

 // Alipay posts form-encoded results without an Origin header; app.mjs exempts this path from the
 // same-origin guard, so the RSA2 signature and app/seller checks are the only gate here.
 app.post('/api/payments/alipay/notify',express.urlencoded({extended:false,limit:'16kb'}),async(req,res)=>{
  const p=req.body||{},reply=ok=>res.status(ok?200:400).type('text/plain').send(ok?'success':'failure');
  if(!alipay||!alipay.verifyNotify(p)){console.error(JSON.stringify({event:'alipay_notify_rejected',reason:'signature'}));return reply(false);}
  if(p.app_id!==alipay.appId||(alipay.sellerId&&p.seller_id!==alipay.sellerId)){console.error(JSON.stringify({event:'alipay_notify_rejected',reason:'merchant'}));return reply(false);}
  try{
   if(PAID.has(p.trade_status))await creditPaidOrder(pool,p.out_trade_no,{tradeNo:p.trade_no,totalAmount:p.total_amount},'alipay-notify');
   else if(p.trade_status==='TRADE_CLOSED')await closeOrder(p.out_trade_no);
  }catch(e){console.error(JSON.stringify({event:'alipay_notify_failed',code:e.message}));return reply(false);}
  reply(true);
 });

 return {channelsFor:customer=>allowed(customer)?['alipay_f2f']:[]};
}
