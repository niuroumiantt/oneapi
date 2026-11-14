import {addPack,accountFor,quotePack,refundQuote} from './pack-ledger.mjs';
// Online recharge through Alipay 电脑网站支付 and WeChat Pay Native. Alipay opens the official
// cashier (scan-to-pay there); WeChat returns a Native QR on our page. Balance changes only after a
// signed channel result confirms that exact order and amount.
import express from 'express';
import { randomBytes } from 'node:crypto';
import qrcode from 'qrcode-generator';
import { HttpError,id,text,transaction,audit } from './core.mjs';
import { isManager } from './organizations.mjs';
import { yuanToFen } from './alipay.mjs';
import { REFUND_POLICY_ZH } from './list-credit.mjs';

export const RECHARGE_MIN_FEN=500,RECHARGE_MAX_FEN=5000000,ORDER_TTL_MINUTES=15;
const PAID=new Set(['TRADE_SUCCESS','TRADE_FINISHED']);
// REFUND means it was paid and later refunded: still a confirmed payment for crediting purposes.
const WECHAT_PAID=new Set(['SUCCESS','REFUND']);

export function parseRechargeFen(value){
 const fen=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;
 if(!Number.isSafeInteger(fen)||fen<RECHARGE_MIN_FEN||fen>RECHARGE_MAX_FEN)throw new HttpError(400,'充值金额须在 ¥5.00 至 ¥50,000.00 之间');
 return fen;
}
const outTradeNo=()=>'OA'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+randomBytes(6).toString('hex');
function qrSvg(text){const q=qrcode(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:2,scalable:true});}
function orderView(o){
 const live=o.status==='pending'&&o.qr_code&&new Date(o.expires_at)>new Date();
 // WeChat: render QR ourselves. Alipay page pay: browser opens the cashier URL (no local QR).
 const wechat=o.provider==='wechat_native';
 return {id:o.id,provider:o.provider,status:o.status,amount_fen:String(o.amount_fen),face_fen:String(o.face_fen),discount:o.discount_snapshot,expires_at:o.expires_at,paid_at:o.paid_at,expired:o.status==='pending'&&new Date(o.expires_at)<new Date(),
  qr_svg:live&&wechat?qrSvg(o.qr_code):null,pay_url:live&&!wechat?o.qr_code:null};
}

// Single place where a confirmed payment becomes money. Row lock + ledger unique key make
// repeated notifies, queries and TRADE_FINISHED-after-TRADE_SUCCESS credit exactly once.
// `provider` must match the order's own channel, so one channel's result never pays another's order.
export async function creditPaidOrder(pool,outTradeNoValue,{provider,tradeNo,totalFen},source){
 return transaction(pool,async db=>{
  const o=(await db.query('SELECT * FROM payment_orders WHERE out_trade_no=$1 FOR UPDATE',[outTradeNoValue])).rows[0];
  if(!o)throw Error('PAYMENT_ORDER_UNKNOWN');
  if(o.provider!==provider)throw Error('PAYMENT_PROVIDER_MISMATCH');
  if(!tradeNo||totalFen===null||totalFen===undefined||BigInt(totalFen)!==BigInt(o.amount_fen))throw Error('PAYMENT_AMOUNT_MISMATCH');
  if(o.status==='paid'){if(o.provider_trade_no!==tradeNo)throw Error('PAYMENT_TRADE_MISMATCH');return {order:o,credited:false};}

  // The signed payment must match locked cash; credit the independently locked face value.
  const account=(await db.query('UPDATE billing_accounts SET cash_balance_fen=cash_balance_fen+$2,list_credit_fen=list_credit_fen+$3 WHERE id=$1 RETURNING cash_balance_fen,list_credit_fen,organization_id',[o.account_id,o.amount_fen,o.face_fen])).rows[0];
  await db.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'recharge',$2,$3,'payment',$4)",[o.account_id,o.amount_fen,account.cash_balance_fen,o.id]);
  await addPack(db,{accountId:o.account_id,sourceKind:'payment',sourceId:o.id,faceFen:o.face_fen,cashFen:o.amount_fen});
  const order=(await db.query("UPDATE payment_orders SET status='paid',provider_trade_no=$2,paid_at=now(),updated_at=now() WHERE id=$1 RETURNING *",[o.id,tradeNo])).rows[0];
  await audit(db,{kind:'system',id:source},`billing.recharge.${CHANNELS[provider].audit}_paid`,account.organization_id,o.id,{amount_fen:String(o.amount_fen),face_fen:String(o.face_fen),provider_trade_no:tradeNo});
  return {order,credited:true};
 });
}

export const CHANNELS={
 alipay_f2f:{name:'支付宝',audit:'alipay',path:'alipay'},
 wechat_native:{name:'微信支付',audit:'wechat',path:'wechat'}
};
const closeOrder=(pool,outTradeNoValue,provider)=>pool.query("UPDATE payment_orders SET status='closed',updated_at=now() WHERE out_trade_no=$1 AND provider=$2 AND status='pending'",[outTradeNoValue,provider]);
const pastGrace=order=>new Date(order.expires_at).getTime()+120e3<Date.now();

// Per-channel gateway glue. Each returns plain outcomes; payments and refunds only change money
// on a verified (signed) gateway result.
function gateways(cfg,{alipay,wechat}){
 const out={};
 if(alipay)out.alipay_f2f={
  allowedEmails:cfg.alipay?.allowedEmails,
  // Internal id stays alipay_f2f; product is 电脑网站支付 (FAST_INSTANT_TRADE_PAY).
  async createCode(order,{returnUrl}={}){
   try{
    return alipay.pagePayUrl({outTradeNo:order.out_trade_no,amountFen:order.amount_fen,subject:'OneAPI 账户充值',
     notifyUrl:cfg.origin+'/api/payments/alipay/notify',returnUrl:returnUrl||cfg.origin+'/#billing/personal',timeoutMinutes:ORDER_TTL_MINUTES});
   }catch(e){console.error(JSON.stringify({event:'alipay_page_pay_failed',code:e.message}));return null;}
  },
  async check(order){
   const r=await alipay.query(order.out_trade_no);
   if(r?.code==='10000'&&r.out_trade_no===order.out_trade_no&&PAID.has(r.trade_status))return {paid:{tradeNo:r.trade_no,totalFen:yuanToFen(r.total_amount)}};
   if(r?.code==='10000'&&r.trade_status==='TRADE_CLOSED')return {closed:true};
   if(r?.sub_code==='ACQ.TRADE_NOT_EXIST'&&pastGrace(order))return {closed:true};
   return {};
  },
  async refund(r){
   const result=await alipay.refund({outTradeNo:r.out_trade_no,outRequestNo:r.out_request_no,amountFen:r.amount_fen,reason:r.reason});
   if(result?.code==='10000'&&result.out_trade_no===r.out_trade_no)return {outcome:'succeeded'};
   if(REFUND_REJECTED.has(result?.sub_code))return {outcome:'rejected',code:result.sub_code};
   return {outcome:'pending',code:result?.sub_code||result?.code||'UNKNOWN'};
  }
 };
 if(wechat){
  const refundOutcome=(data,r)=>{
   if(data?.out_refund_no!==r.out_request_no)return {outcome:'pending',code:'WECHAT_REFUND_MISMATCH'};
   if(data.status==='SUCCESS')return {outcome:'succeeded'};
   if(data.status==='CLOSED')return {outcome:'rejected',code:'CLOSED'};
   return {outcome:'pending',code:String(data.status||'UNKNOWN')};
  };
  out.wechat_native={
   allowedEmails:cfg.wechat?.allowedEmails,
   async createCode(order){
    let r;try{r=await wechat.native({outTradeNo:order.out_trade_no,amountFen:order.amount_fen,description:'OneAPI 账户充值',notifyUrl:cfg.origin+'/api/payments/wechat/notify',expiresAt:new Date(order.expires_at)});}
    catch(e){console.error(JSON.stringify({event:'wechat_native_failed',code:e.message}));return null;}
    if(r.status!==200||!r.data?.code_url){console.error(JSON.stringify({event:'wechat_native_rejected',status:r.status,code:r.data?.code}));return null;}
    return r.data.code_url;
   },
   async check(order){
    const {status,data}=await wechat.query(order.out_trade_no);
    if(status===200&&data.out_trade_no===order.out_trade_no&&data.mchid===wechat.mchId&&data.appid===wechat.appId){
     if(WECHAT_PAID.has(data.trade_state))return {paid:{tradeNo:data.transaction_id,totalFen:data.amount?.total}};
     if(['CLOSED','REVOKED','PAYERROR'].includes(data.trade_state))return {closed:true};
     if(data.trade_state==='NOTPAY'&&pastGrace(order))return {closed:true};
    }
    if(status===404&&pastGrace(order))return {closed:true};
    return {};
   },
   async refund(r){
    // A refund already sent once is looked up first; only a refund WeChat has never seen is (re)created.
    if(r.error_code){const q=await wechat.queryRefund(r.out_request_no);if(q.status===200)return refundOutcome(q.data,r);if(q.status!==404)return {outcome:'pending',code:String(q.data?.code||'HTTP_'+q.status)};}
    const {status,data}=await wechat.refund({outTradeNo:r.out_trade_no,outRefundNo:r.out_request_no,amountFen:r.amount_fen,totalFen:r.order_amount_fen,reason:r.reason,notifyUrl:cfg.origin+'/api/payments/wechat/notify'});
    if(status===200)return refundOutcome(data,r);
    if(status<500&&WECHAT_REFUND_REJECTED.has(data?.code))return {outcome:'rejected',code:data.code};
    return {outcome:'pending',code:String(data?.code||'HTTP_'+status)};
   }
  };
 }
 return out;
}

export function paymentRoutes(app,pool,requireCustomer,cfg,clients){
 const gw=gateways(cfg,clients);
 const allowed=(customer,provider)=>Boolean(gw[provider])&&(!gw[provider].allowedEmails?.size||gw[provider].allowedEmails.has(customer.email.toLowerCase()));

 async function createOrder(req,res,provider,ownerColumn,ownerValue){
  const name=CHANNELS[provider].name;
  if(!allowed(req.customer,provider))throw new HttpError(403,`${name}充值尚未对当前账户开放`);
  const face=parseRechargeFen(req.body?.face_fen??req.body?.amount_fen),key=req.body?.idempotency_key;
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(key))throw new HttpError(400,'请刷新页面后重试');
  const account=await accountFor(pool,req.customer.id,ownerColumn==='organization_id'?ownerValue:null,{create:true});
  const saved=await transaction(pool,async db=>{
   await db.query('SELECT id FROM billing_accounts WHERE id=$1 FOR UPDATE',[account.id]);
   const existing=(await db.query('SELECT * FROM payment_orders WHERE created_by=$1 AND idempotency_key=$2',[req.customer.id,key])).rows[0];
   if(existing){if(existing.account_id!==account.id||Number(existing.face_fen)!==face||existing.provider!==provider||String(existing.discount_snapshot.requested_code||'')!==String(req.body?.promo_code||'').trim().toUpperCase())throw new HttpError(409,'订单信息已变化，请重新下单');return {order:existing,created:false};}
   const quote=await quotePack(db,account,face,req.body?.promo_code);
   if(req.body?.expected_cash_fen!==undefined&&Number(req.body.expected_cash_fen)!==quote.amount_fen)throw new HttpError(409,'优惠已变化，请重新查看实付金额');
   quote.discount_snapshot.requested_code=String(req.body?.promo_code||'').trim().toUpperCase();
   const order=(await db.query(`INSERT INTO payment_orders(out_trade_no,account_id,created_by,provider,amount_fen,face_fen,discount_snapshot,idempotency_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+make_interval(mins=>$9)) RETURNING *`,[outTradeNo(),account.id,req.customer.id,provider,quote.amount_fen,quote.face_fen,quote.discount_snapshot,key,ORDER_TTL_MINUTES])).rows[0];
   return {order,created:true};
  });let {order,created}=saved;
  if(order.status==='pending'&&!order.qr_code&&new Date(order.expires_at)>new Date()){
   const returnUrl=ownerColumn==='organization_id'?`${cfg.origin}/#billing/organization/${ownerValue}`:`${cfg.origin}/#billing/personal`;
   const code=await gw[provider].createCode(order,{returnUrl});
   if(!code)throw new HttpError(502,provider==='wechat_native'?`${name}暂时无法生成付款码，请稍后重试。`:`${name}暂时无法打开付款页，请稍后重试。`);
   order=(await pool.query('UPDATE payment_orders SET qr_code=$2,updated_at=now() WHERE id=$1 RETURNING *',[order.id,code])).rows[0];
  }
  res.status(created?201:200).json({order:orderView(order)});
 }
 app.post('/api/billing/quote',requireCustomer,async(req,res)=>{
  const account=await accountFor(pool,req.customer.id,req.body?.organization_id?id(req.body.organization_id):null,{create:true});
  res.json(await transaction(pool,db=>quotePack(db,account,parseRechargeFen(req.body?.face_fen),req.body?.promo_code)));
 });
 for(const provider of Object.keys(CHANNELS)){
  const path=CHANNELS[provider].path;
  app.post(`/api/billing/personal/${path}-orders`,requireCustomer,(req,res)=>createOrder(req,res,provider,'owner_id',req.customer.id));
  app.post(`/api/billing/organizations/:org/${path}-orders`,requireCustomer,async(req,res)=>{
   const org=id(req.params.org),membership=(await pool.query("SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[org,req.customer.id])).rows[0];
   if(!membership||!isManager(membership.role))throw new HttpError(403,'仅企业管理者可以为企业充值');
   await createOrder(req,res,provider,'organization_id',org);
  });
 }

 // Polling endpoint. While pending it actively queries the channel so a lost notify never strands a paid order.
 async function pollOrder(req,res){
  const row=(await pool.query('SELECT o.*,a.owner_id,a.organization_id FROM payment_orders o JOIN billing_accounts a ON a.id=o.account_id WHERE o.id=$1',[id(req.params.id)])).rows[0];
  let visible=row&&(row.created_by===req.customer.id||row.owner_id===req.customer.id);
  if(row&&!visible&&row.organization_id){const m=(await pool.query("SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[row.organization_id,req.customer.id])).rows[0];visible=Boolean(m&&isManager(m.role));}
  if(!visible)throw new HttpError(404,'记录不存在');
  let order=row;
  if(order.status==='pending'&&gw[order.provider]){
   try{
    const r=await gw[order.provider].check(order);
    if(r.paid)order=(await creditPaidOrder(pool,order.out_trade_no,{provider:order.provider,...r.paid},CHANNELS[order.provider].audit+'-query')).order;
    else if(r.closed)await closeOrder(pool,order.out_trade_no,order.provider);
   }catch(e){console.error(JSON.stringify({event:'payment_query_failed',provider:order.provider,code:e.message}));}
   order=(await pool.query('SELECT * FROM payment_orders WHERE id=$1',[order.id])).rows[0];
  }
  res.json({order:orderView(order)});
 }
 app.get('/api/billing/payment-orders/:id',requireCustomer,pollOrder);
 app.get('/api/billing/alipay-orders/:id',requireCustomer,pollOrder);

 // Alipay posts form-encoded results without an Origin header; app.mjs exempts this path from the
 // same-origin guard, so the RSA2 signature and app/seller checks are the only gate here.
 const alipay=clients.alipay;
 app.post('/api/payments/alipay/notify',express.urlencoded({extended:false,limit:'16kb'}),async(req,res)=>{
  const p=req.body||{},reply=ok=>res.status(ok?200:400).type('text/plain').send(ok?'success':'failure');
  if(!alipay||!alipay.verifyNotify(p)){console.error(JSON.stringify({event:'alipay_notify_rejected',reason:'signature'}));return reply(false);}
  if(p.app_id!==alipay.appId||(alipay.sellerId&&p.seller_id!==alipay.sellerId)){console.error(JSON.stringify({event:'alipay_notify_rejected',reason:'merchant'}));return reply(false);}
  try{
   if(PAID.has(p.trade_status))await creditPaidOrder(pool,p.out_trade_no,{provider:'alipay_f2f',tradeNo:p.trade_no,totalFen:yuanToFen(p.total_amount)},'alipay-notify');
   else if(p.trade_status==='TRADE_CLOSED')await closeOrder(pool,p.out_trade_no,'alipay_f2f');
  }catch(e){console.error(JSON.stringify({event:'alipay_notify_failed',code:e.message}));return reply(false);}
  reply(true);
 });

 // WeChat posts signed JSON (raw body kept by app.mjs) with an encrypted resource. Payment and
 // refund results share this one URL. A non-2xx reply makes WeChat retry.
 const wechat=clients.wechat;
 app.post('/api/payments/wechat/notify',async(req,res)=>{
  const fail=reason=>{console.error(JSON.stringify({event:'wechat_notify_rejected',reason}));res.status(400).json({code:'FAIL',message:'失败'});};
  let n;try{if(!wechat)return fail('disabled');n=wechat.openNotify(new Headers(req.headers),req.rawBody?.toString('utf8')||'');}catch(e){return fail(e.message);}
  const r=n.resource;
  if(r.mchid!==wechat.mchId||(r.appid!==undefined&&r.appid!==wechat.appId))return fail('merchant');
  try{
   if(n.event_type==='TRANSACTION.SUCCESS'&&WECHAT_PAID.has(r.trade_state))await creditPaidOrder(pool,r.out_trade_no,{provider:'wechat_native',tradeNo:r.transaction_id,totalFen:r.amount?.total},'wechat-notify');
   else if(n.event_type?.startsWith('REFUND.')){
    const refund=(await pool.query("SELECT r.id FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id WHERE r.out_request_no=$1 AND o.out_trade_no=$2 AND o.provider='wechat_native'",[r.out_refund_no,r.out_trade_no])).rows[0];
    if(refund&&r.refund_status==='SUCCESS')await finishRefund(pool,refund.id,{outcome:'succeeded'},'wechat-refund-notify');
    else if(refund&&r.refund_status==='CLOSED')await finishRefund(pool,refund.id,{outcome:'rejected',code:'CLOSED'},'wechat-refund-notify');
    else if(refund)await pool.query("UPDATE payment_refunds SET error_code=$2 WHERE id=$1 AND status='pending'",[refund.id,String(r.refund_status||'UNKNOWN').slice(0,120)]);
   }
  }catch(e){console.error(JSON.stringify({event:'wechat_notify_failed',code:e.message}));return res.status(500).json({code:'FAIL',message:'失败'});}
  res.status(204).end();
 });

 return {channelsFor:customer=>Object.keys(gw).filter(p=>allowed(customer,p))};
}

// Alipay business codes that mean "this refund will not happen" (safe to release the hold).
// Anything else — timeouts, ACQ.SYSTEM_ERROR, unsigned replies — stays pending for a retry.
const REFUND_REJECTED=new Set(['ACQ.TRADE_NOT_EXIST','ACQ.TRADE_STATUS_ERROR','ACQ.TRADE_NOT_ALLOW_REFUND','ACQ.REFUND_AMT_NOT_EQUAL_TOTAL','ACQ.REFUND_AMOUNT_NOT_ENOUGH','ACQ.SELLER_BALANCE_NOT_ENOUGH','ACQ.REASON_TRADE_REFUND_FEE_ERR','ACQ.DISCORDANT_REPEAT_REQUEST','ACQ.TRADE_HAS_FINISHED','ACQ.REFUND_FEE_ERROR','ACQ.CUSTOMER_VALIDATE_ERROR','ACQ.ONLINE_TRADE_VOUCHER_NOT_ALLOW_REFUND','ACQ.BUYER_ERROR','ACQ.INVALID_PARAMETER']);
// WeChat Pay refund error codes (signed 4xx) that mean the refund was not accepted. SYSTEM_ERROR,
// FREQUENCY_LIMITED and unsigned replies stay pending; ABNORMAL (退款到银行卡失败) also stays
// pending, since the money has left the merchant and must be handled in the merchant platform.
const WECHAT_REFUND_REJECTED=new Set(['PARAM_ERROR','INVALID_REQUEST','NOT_ENOUGH','NO_AUTH','USER_ACCOUNT_ABNORMAL','MCH_NOT_EXISTS','RESOURCE_NOT_EXISTS','SIGN_ERROR']);

// Applies a definitive refund result once. Rejected refunds give the held amount back.
export async function finishRefund(pool,refundId,{outcome,code},source){
 return transaction(pool,async db=>{
  const cur=(await db.query('SELECT * FROM payment_refunds WHERE id=$1 FOR UPDATE',[refundId])).rows[0];if(cur.status!=='pending')return cur.status;
  const o=(await db.query('SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE',[cur.order_id])).rows[0],ch=CHANNELS[o.provider].audit;
  if(outcome==='succeeded'){
   if(cur.pack_id&&BigInt(cur.fee_fen||0)>0n){
    const a=(await db.query('UPDATE billing_accounts SET cash_balance_fen=cash_balance_fen-$2 WHERE id=$1 RETURNING cash_balance_fen',[o.account_id,cur.fee_fen])).rows[0];
    await db.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'usage',$2,$3,'usage',$4)",[o.account_id,String(-BigInt(cur.fee_fen)),a.cash_balance_fen,'refund-fee:'+cur.id]);
   }
   await db.query("UPDATE payment_refunds SET status='succeeded',error_code=NULL,completed_at=now() WHERE id=$1",[cur.id]);
   if(cur.pack_id)await db.query("UPDATE credit_refund_requests SET status='completed' WHERE pack_id=$1 AND status='processing'",[cur.pack_id]);
   await audit(db,{kind:'system',id:source},`billing.refund.${ch}_succeeded`,null,cur.id,{order_id:o.id,amount_fen:String(cur.amount_fen)});
   return 'succeeded';
  }
  const acct=(await db.query('UPDATE billing_accounts SET cash_balance_fen=cash_balance_fen+$2,list_credit_fen=list_credit_fen+$3 WHERE id=$1 RETURNING cash_balance_fen,organization_id',[o.account_id,cur.amount_fen,cur.face_fen??cur.amount_fen])).rows[0];
  await db.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'reversal',$2,$3,'correction',$4)",[o.account_id,cur.amount_fen,acct.cash_balance_fen,cur.id]);
  if(cur.pack_id){await db.query('UPDATE credit_packs SET remaining_fen=$2,refund_id=NULL WHERE id=$1',[cur.pack_id,cur.face_fen]);await db.query("UPDATE credit_refund_requests SET status='requested' WHERE pack_id=$1 AND status='processing'",[cur.pack_id]);}
  await db.query('UPDATE payment_orders SET refunded_fen=refunded_fen-$2,updated_at=now() WHERE id=$1',[o.id,cur.amount_fen]);
  await db.query("UPDATE payment_refunds SET status='failed',error_code=$2,completed_at=now() WHERE id=$1",[cur.id,String(code||'REJECTED').slice(0,120)]);
  await audit(db,{kind:'system',id:source},`billing.refund.${ch}_rejected`,acct.organization_id,cur.id,{order_id:o.id,sub_code:code});
  return 'failed';
 });
}

// Staff refunds (商务后台). The refund amount is held from the balance up front so the customer
// cannot spend money that is on its way back to them; a definitive channel rejection releases it.
export function staffPaymentRoutes(app,pool,requireStaff,requireFinance,cfg,clients){
 const gw=gateways(cfg,clients);
 const waiver=(req,value,reason)=>{const percent=value===undefined?15:value;if(!Number.isInteger(percent)||percent<0||percent>15)throw new HttpError(400,'服务费比例须为 0 至 15 的整数');if(percent<15){if(req.staff.role!=='platform_admin')throw new HttpError(403,'特批减免需要平台管理员');if(reason!==undefined)text(reason,'特批原因',200);}return percent;};
 app.post('/api/staff/payments/orders/:order/channel-fee',requireStaff,async(req,res)=>{
  requireFinance(req);const amount=req.body?.amount_fen,version=req.body?.version,evidence=text(req.body?.evidence,'支付宝账单凭据或核对说明',200);
  if(!Number.isSafeInteger(amount)||amount<0||!Number.isSafeInteger(version)||version<0)throw new HttpError(400,'费用或版本不正确');
  await transaction(pool,async db=>{const o=(await db.query('SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE',[id(req.params.order)])).rows[0];if(!o||o.status!=='paid')throw new HttpError(409,'只登记已支付订单的实际渠道费用');if(amount>Number(o.amount_fen))throw new HttpError(400,'费用不能超过收款');if(o.channel_fee_version!==version)throw new HttpError(409,'费用记录已变化，请刷新后核对');
   await db.query('UPDATE payment_orders SET channel_fee_fen=$2,channel_fee_evidence=$3,channel_fee_recorded_by=$4,channel_fee_recorded_at=now(),channel_fee_version=channel_fee_version+1 WHERE id=$1',[o.id,amount,evidence,req.staff.subject]);
   await audit(db,req.actor,'billing.channel_fee.recorded',null,o.id,{before_fen:o.channel_fee_fen,amount_fen:amount,evidence});});res.json({ok:true});
 });
 const view=async(where,params=[])=>(await pool.query(`SELECT o.id,o.provider,o.out_trade_no,o.provider_trade_no,o.amount_fen::text,o.refunded_fen::text,o.face_fen::text,o.status,o.created_at,o.paid_at,o.channel_fee_fen::text,o.channel_fee_evidence,o.channel_fee_version,EXISTS(SELECT 1 FROM credit_packs cp WHERE cp.source_kind='payment' AND cp.source_id=o.id AND cp.refund_id IS NULL AND cp.remaining_fen>0) AS refundable,a.cash_balance_fen::text AS account_balance_fen,a.list_credit_fen::text AS list_credit_fen,
   coalesce(g.name,u.name) AS account_name,CASE WHEN a.organization_id IS NULL THEN 'personal' ELSE 'organization' END AS account_kind,u.email AS owner_email,p.email AS payer_email,
   coalesce((SELECT json_agg(json_build_object('id',r.id,'amount_fen',r.amount_fen::text,'reason',r.reason,'status',r.status,'error_code',r.error_code,'requested_by',r.requested_by,'service_fee_percent',r.service_fee_percent,'waived_fen',CASE WHEN r.standard_net_fen IS NOT NULL THEN r.amount_fen-r.standard_net_fen END,'waiver_reason',r.waiver_reason,'waiver_approved_by',r.waiver_approved_by,'waiver_approved_at',r.waiver_approved_at,'created_at',r.created_at,'completed_at',r.completed_at) ORDER BY r.created_at) FROM payment_refunds r WHERE r.order_id=o.id),'[]') AS refunds
  FROM payment_orders o JOIN billing_accounts a ON a.id=o.account_id LEFT JOIN organizations g ON g.id=a.organization_id LEFT JOIN "user" u ON u.id=a.owner_id JOIN "user" p ON p.id=o.created_by
  ${where} ORDER BY o.created_at DESC LIMIT 200`,params)).rows;
 app.get('/api/staff/payments/orders/:order/refund-quote',requireStaff,async(req,res)=>{
  requireFinance(req);const p=(await pool.query("SELECT id FROM credit_packs WHERE source_kind='payment' AND source_id=$1",[id(req.params.order)])).rows[0];if(!p)throw new HttpError(409,'没有可退额度包');res.json({...await refundQuote(pool,p.id,waiver(req,req.query.fee_percent===undefined?undefined:Number(req.query.fee_percent))),can_waive:req.staff.role==='platform_admin'});
 });
 app.get('/api/staff/payments/orders',requireStaff,async(req,res)=>{requireFinance(req);res.json({summary:(await pool.query("SELECT provider,count(*)::int AS transactions,sum(amount_fen)::text AS received_fen,sum(refunded_fen)::text AS refunded_fen,coalesce(sum(channel_fee_fen),0)::text AS channel_fee_fen,count(*) FILTER(WHERE channel_fee_fen IS NULL)::int AS fees_unreconciled FROM payment_orders WHERE status='paid' GROUP BY provider")).rows,customers:(await pool.query("SELECT o.provider,u.email,count(*)::int AS transactions,sum(o.amount_fen)::text AS received_fen FROM payment_orders o JOIN \"user\" u ON u.id=o.created_by WHERE o.status='paid' GROUP BY o.provider,u.email ORDER BY sum(o.amount_fen) DESC")).rows,enabled:Object.keys(gw).length>0,channels:Object.keys(gw),refund_policy:REFUND_POLICY_ZH,requests:(await pool.query("SELECT r.id,r.reason,r.status,p.source_id AS order_id FROM credit_refund_requests r JOIN credit_packs p ON p.id=r.pack_id WHERE r.status IN ('requested','processing')")).rows,orders:await view("WHERE o.status='paid' OR o.created_at>now()-interval '7 days'")});});

 // Sends (or resends — same request number) the refund and settles the local record.
 async function settle(refundId){
  const r=(await pool.query('SELECT r.*,o.out_trade_no,o.provider,o.amount_fen AS order_amount_fen FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id WHERE r.id=$1',[refundId])).rows[0];
  if(r.status!=='pending')return r.status;
  let result;
  try{result=await gw[r.provider].refund(r);}
  catch(e){result={outcome:'pending',code:e.message};console.error(JSON.stringify({event:'refund_unconfirmed',provider:r.provider,code:e.message}));}
  if(result.outcome==='pending'){await pool.query("UPDATE payment_refunds SET error_code=$2 WHERE id=$1 AND status='pending'",[r.id,String(result.code||'UNKNOWN').slice(0,120)]);return 'pending';}
  return finishRefund(pool,r.id,result,CHANNELS[r.provider].audit+'-refund');
 }
 const channelOf=async orderId=>{const o=(await pool.query('SELECT provider FROM payment_orders WHERE id=$1',[orderId])).rows[0];if(!o)throw new HttpError(404,'订单不存在');if(!gw[o.provider])throw new HttpError(503,`${CHANNELS[o.provider].name}未启用，无法发起原路退款`);};

 app.post('/api/staff/payments/orders/:order/refunds',requireStaff,async(req,res)=>{
  requireFinance(req);
  const orderId=id(req.params.order),amount=req.body?.amount_fen,reason=text(req.body?.reason,'退款原因',200),key=req.body?.idempotency_key;
  await channelOf(orderId);
  const feePercent=waiver(req,req.body?.service_fee_percent,req.body?.waiver_reason);
  const waiverReason=feePercent<15?text(req.body?.waiver_reason,'特批原因',200):null;
  if(!Number.isSafeInteger(amount)||amount<=0)throw new HttpError(400,'退款金额不正确');
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(key))throw new HttpError(400,'请刷新页面后重试');
  const existing=(await pool.query('SELECT id,order_id,amount_fen,service_fee_percent,waiver_reason FROM payment_refunds WHERE idempotency_key=$1',[key])).rows[0];
  let refundId=existing?.id;
  if(existing&&(existing.order_id!==orderId||Number(existing.amount_fen)!==amount||existing.service_fee_percent!==feePercent||existing.waiver_reason!==waiverReason))throw new HttpError(409,'该退款请求已用于其他订单，请刷新页面');
  if(!existing)refundId=await transaction(pool,async db=>{
   const o=(await db.query('SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
   if(!o)throw new HttpError(404,'订单不存在');if(o.status!=='paid')throw new HttpError(409,'只有已付款的订单可以退款');
   if((await db.query("SELECT 1 FROM payment_refunds WHERE order_id=$1 AND status='pending'",[o.id])).rowCount)throw new HttpError(409,'该订单有一笔退款正在处理，请先确认其结果');
   const acct=(await db.query('SELECT * FROM billing_accounts WHERE id=$1 FOR UPDATE',[o.account_id])).rows[0];
   const pack=(await db.query("SELECT id FROM credit_packs WHERE source_kind='payment' AND source_id=$1 FOR UPDATE",[o.id])).rows[0];
   if(!pack)throw new HttpError(409,'旧订单尚未完成额度批次核对');
   const q=await refundQuote(db,pack.id,feePercent);if(q.blocked)throw new HttpError(409,q.blocked);
   if(amount!==Number(q.net_fen))throw new HttpError(409,'额度或退款金额已变化，请重新预览退款');
   const gross=BigInt(q.cash_fen)-BigInt(q.consumed_cash_fen),fee=gross-BigInt(q.net_fen);
   const refund=(await db.query('INSERT INTO payment_refunds(order_id,out_request_no,amount_fen,reason,requested_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[o.id,'RF'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+randomBytes(6).toString('hex'),amount,reason,req.staff.subject,key])).rows[0];
   await db.query('UPDATE payment_refunds SET service_fee_percent=$2,waiver_reason=$3,waiver_approved_by=$4,waiver_approved_at=CASE WHEN $3::text IS NOT NULL THEN now() END,standard_net_fen=$5 WHERE id=$1',[refund.id,feePercent,waiverReason,waiverReason?req.staff.subject:null,q.standard_net_fen]);
   await db.query('UPDATE payment_refunds SET pack_id=$2,face_fen=$3,gross_fen=$4,fee_fen=$5 WHERE id=$1',[refund.id,q.id,q.remaining_fen,gross.toString(),fee.toString()]);
   await db.query('UPDATE credit_packs SET remaining_fen=0,refund_id=$2 WHERE id=$1',[q.id,refund.id]);
   const after=(await db.query('UPDATE billing_accounts SET cash_balance_fen=cash_balance_fen-$2,list_credit_fen=list_credit_fen-$3 WHERE id=$1 RETURNING cash_balance_fen',[acct.id,amount,q.remaining_fen])).rows[0];
   await db.query("UPDATE credit_refund_requests SET status='processing' WHERE pack_id=$1 AND status='requested'",[q.id]);
   await db.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'refund',$2,$3,'refund',$4)",[acct.id,-amount,after.cash_balance_fen,refund.id]);
   await db.query('UPDATE payment_orders SET refunded_fen=refunded_fen+$2,updated_at=now() WHERE id=$1',[o.id,amount]);
   await audit(db,req.actor,'billing.refund.requested',acct.organization_id,refund.id,{order_id:o.id,amount_fen:String(amount),reason,service_fee_percent:feePercent,waiver_reason:waiverReason,standard_net_fen:q.standard_net_fen});
   return refund.id;
  });
  const status=await settle(refundId);
  res.status(existing?200:201).json({refund_id:refundId,status,orders:await view('WHERE o.id=$1',[orderId])});
 });
 app.post('/api/staff/payments/refunds/:refund/retry',requireStaff,async(req,res)=>{
  requireFinance(req);
  const refundId=id(req.params.refund),row=(await pool.query('SELECT order_id FROM payment_refunds WHERE id=$1',[refundId])).rows[0];if(!row)throw new HttpError(404,'退款记录不存在');
  await channelOf(row.order_id);
  res.json({refund_id:refundId,status:await settle(refundId)});
 });
}
