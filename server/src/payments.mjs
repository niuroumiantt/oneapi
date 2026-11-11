// Online recharge through Alipay 当面付. A customer gets a fixed-amount order and its QR code;
// the balance changes only after a signed Alipay result confirms that exact order and amount.
import express from 'express';
import { randomBytes } from 'node:crypto';
import qrcode from 'qrcode-generator';
import { HttpError,id,text,transaction,audit } from './core.mjs';
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

// Alipay business codes that mean "this refund will not happen" (safe to release the hold).
// Anything else — timeouts, ACQ.SYSTEM_ERROR, unsigned replies — stays pending for a retry.
const REFUND_REJECTED=new Set(['ACQ.TRADE_NOT_EXIST','ACQ.TRADE_STATUS_ERROR','ACQ.TRADE_NOT_ALLOW_REFUND','ACQ.REFUND_AMT_NOT_EQUAL_TOTAL','ACQ.REFUND_AMOUNT_NOT_ENOUGH','ACQ.SELLER_BALANCE_NOT_ENOUGH','ACQ.REASON_TRADE_REFUND_FEE_ERR','ACQ.DISCORDANT_REPEAT_REQUEST','ACQ.TRADE_HAS_FINISHED','ACQ.REFUND_FEE_ERROR','ACQ.CUSTOMER_VALIDATE_ERROR','ACQ.ONLINE_TRADE_VOUCHER_NOT_ALLOW_REFUND','ACQ.BUYER_ERROR','ACQ.INVALID_PARAMETER']);

// Staff refunds (商务后台). The refund amount is held from the balance up front so the customer
// cannot spend money that is on its way back to them; a definitive Alipay rejection releases it.
export function staffPaymentRoutes(app,pool,requireStaff,requireBusiness,alipay){
 const view=async(where,params=[])=>(await pool.query(`SELECT o.id,o.out_trade_no,o.provider_trade_no,o.amount_fen::text,o.refunded_fen::text,o.status,o.created_at,o.paid_at,a.cash_balance_fen::text AS account_balance_fen,
   coalesce(g.name,u.name) AS account_name,CASE WHEN a.organization_id IS NULL THEN 'personal' ELSE 'organization' END AS account_kind,u.email AS owner_email,p.email AS payer_email,
   coalesce((SELECT json_agg(json_build_object('id',r.id,'amount_fen',r.amount_fen::text,'reason',r.reason,'status',r.status,'error_code',r.error_code,'requested_by',r.requested_by,'created_at',r.created_at,'completed_at',r.completed_at) ORDER BY r.created_at) FROM payment_refunds r WHERE r.order_id=o.id),'[]') AS refunds
  FROM payment_orders o JOIN billing_accounts a ON a.id=o.account_id LEFT JOIN organizations g ON g.id=a.organization_id LEFT JOIN "user" u ON u.id=a.owner_id JOIN "user" p ON p.id=o.created_by
  ${where} ORDER BY o.created_at DESC LIMIT 200`,params)).rows;
 app.get('/api/staff/payments/orders',requireStaff,async(req,res)=>{requireBusiness(req);res.json({enabled:Boolean(alipay),orders:await view("WHERE o.status='paid' OR o.created_at>now()-interval '7 days'")});});

 // Sends (or resends — same out_request_no) the refund and settles the local record.
 async function settle(refundId){
  const r=(await pool.query('SELECT r.*,o.out_trade_no FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id WHERE r.id=$1',[refundId])).rows[0];
  if(r.status!=='pending')return r.status;
  let result;
  try{result=await alipay.refund({outTradeNo:r.out_trade_no,outRequestNo:r.out_request_no,amountFen:r.amount_fen,reason:r.reason});}
  catch(e){console.error(JSON.stringify({event:'alipay_refund_unconfirmed',code:e.message}));await pool.query('UPDATE payment_refunds SET error_code=$2 WHERE id=$1 AND status=$3',[r.id,e.message.slice(0,120),'pending']);return 'pending';}
  const succeeded=result?.code==='10000'&&result.out_trade_no===r.out_trade_no;
  const rejected=!succeeded&&REFUND_REJECTED.has(result?.sub_code);
  if(!succeeded&&!rejected){await pool.query('UPDATE payment_refunds SET error_code=$2 WHERE id=$1 AND status=$3',[r.id,String(result?.sub_code||result?.code||'UNKNOWN').slice(0,120),'pending']);return 'pending';}
  return transaction(pool,async db=>{
   const cur=(await db.query('SELECT * FROM payment_refunds WHERE id=$1 FOR UPDATE',[r.id])).rows[0];if(cur.status!=='pending')return cur.status;
   const o=(await db.query('SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE',[cur.order_id])).rows[0];
   if(succeeded){
    await db.query("UPDATE payment_refunds SET status='succeeded',error_code=NULL,completed_at=now() WHERE id=$1",[cur.id]);
    await audit(db,{kind:'system',id:'alipay-refund'},'billing.refund.alipay_succeeded',null,cur.id,{order_id:o.id,amount_fen:String(cur.amount_fen)});
    return 'succeeded';
   }
   // Rejected: give the held amount back to the balance and free it for another attempt.
   const acct=(await db.query('UPDATE billing_accounts SET cash_balance_fen=cash_balance_fen+$2 WHERE id=$1 RETURNING cash_balance_fen,organization_id',[o.account_id,cur.amount_fen])).rows[0];
   await db.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'reversal',$2,$3,'correction',$4)",[o.account_id,cur.amount_fen,acct.cash_balance_fen,cur.id]);
   await db.query('UPDATE payment_orders SET refunded_fen=refunded_fen-$2,updated_at=now() WHERE id=$1',[o.id,cur.amount_fen]);
   await db.query("UPDATE payment_refunds SET status='failed',error_code=$2,completed_at=now() WHERE id=$1",[cur.id,String(result.sub_code).slice(0,120)]);
   await audit(db,{kind:'system',id:'alipay-refund'},'billing.refund.alipay_rejected',acct.organization_id,cur.id,{order_id:o.id,sub_code:result.sub_code});
   return 'failed';
  });
 }

 app.post('/api/staff/payments/orders/:order/refunds',requireStaff,async(req,res)=>{
  requireBusiness(req);if(!alipay)throw new HttpError(503,'支付宝未启用，无法发起原路退款');
  const orderId=id(req.params.order),amount=req.body?.amount_fen,reason=text(req.body?.reason,'退款原因',200),key=req.body?.idempotency_key;
  if(!Number.isSafeInteger(amount)||amount<=0)throw new HttpError(400,'退款金额不正确');
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(key))throw new HttpError(400,'请刷新页面后重试');
  const existing=(await pool.query('SELECT id,order_id FROM payment_refunds WHERE idempotency_key=$1',[key])).rows[0];
  let refundId=existing?.id;
  if(existing&&existing.order_id!==orderId)throw new HttpError(409,'该退款请求已用于其他订单，请刷新页面');
  if(!existing)refundId=await transaction(pool,async db=>{
   const o=(await db.query('SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
   if(!o)throw new HttpError(404,'订单不存在');if(o.status!=='paid')throw new HttpError(409,'只有已付款的订单可以退款');
   if((await db.query("SELECT 1 FROM payment_refunds WHERE order_id=$1 AND status='pending'",[o.id])).rowCount)throw new HttpError(409,'该订单有一笔退款正在处理，请先确认其结果');
   if(amount>Number(o.amount_fen)-Number(o.refunded_fen))throw new HttpError(409,`最多可退 ¥${((Number(o.amount_fen)-Number(o.refunded_fen))/100).toFixed(2)}`);
   const acct=(await db.query('SELECT * FROM billing_accounts WHERE id=$1 FOR UPDATE',[o.account_id])).rows[0];
   if(amount>Number(acct.cash_balance_fen))throw new HttpError(409,`账户现金余额只有 ¥${(Number(acct.cash_balance_fen)/100).toFixed(2)}，已使用的部分不能退款`);
   const refund=(await db.query('INSERT INTO payment_refunds(order_id,out_request_no,amount_fen,reason,requested_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[o.id,'RF'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+randomBytes(6).toString('hex'),amount,reason,req.staff.subject,key])).rows[0];
   const after=(await db.query('UPDATE billing_accounts SET cash_balance_fen=cash_balance_fen-$2 WHERE id=$1 RETURNING cash_balance_fen',[acct.id,amount])).rows[0];
   await db.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'refund',$2,$3,'refund',$4)",[acct.id,-amount,after.cash_balance_fen,refund.id]);
   await db.query('UPDATE payment_orders SET refunded_fen=refunded_fen+$2,updated_at=now() WHERE id=$1',[o.id,amount]);
   await audit(db,req.actor,'billing.refund.requested',acct.organization_id,refund.id,{order_id:o.id,amount_fen:String(amount),reason});
   return refund.id;
  });
  const status=await settle(refundId);
  res.status(existing?200:201).json({refund_id:refundId,status,orders:await view('WHERE o.id=$1',[orderId])});
 });
 app.post('/api/staff/payments/refunds/:refund/retry',requireStaff,async(req,res)=>{
  requireBusiness(req);if(!alipay)throw new HttpError(503,'支付宝未启用');
  const refundId=id(req.params.refund);if(!(await pool.query('SELECT 1 FROM payment_refunds WHERE id=$1',[refundId])).rowCount)throw new HttpError(404,'退款记录不存在');
  res.json({refund_id:refundId,status:await settle(refundId)});
 });
}
