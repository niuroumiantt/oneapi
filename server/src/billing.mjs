import {transferNotices} from './bank-transfers.mjs';
import {refundQuote} from './pack-ledger.mjs';
import { HttpError,id } from './core.mjs';
import { isManager } from './organizations.mjs';
import { REFUND_POLICY_ZH, INVOICE_POLICY_ZH } from './list-credit.mjs';

function disabled(account,entries,scope,totalRecharged,channels=[]){
 return {
  scope,currency:'CNY',
  // Panel default: list-price credit. Cash paid is for bills/invoices only.
  list_credit_fen:String(Math.round(Number(account?.list_credit_fen||0))),
  cash_balance_fen:String(account?.cash_balance_fen||0),
  total_spent_fen:String(account?.total_spent_fen||0),
  total_recharged_fen:String(totalRecharged||0),
  list_credit_exact_fen:String(account?.list_credit_fen||0),
  entries,usage_by_model:[],
  recharge:{enabled:channels.length>0,minimum_fen:500,maximum_fen:5000000,channels},
  refund:{enabled:true,fee_percent:0,policy:REFUND_POLICY_ZH},
  invoice:{policy:INVOICE_POLICY_ZH},
  payments_enabled:channels.length>0
 };
}

export function billingRoutes(app,pool,requireCustomer,cfg,payments){
 async function view(account,scope,res,bankTransfer,channels=[]){
  const [entries,totalRecharged]=account?await Promise.all([
   pool.query('SELECT id,kind,amount_fen,balance_after_fen,reference_id,created_at FROM billing_ledger WHERE account_id=$1 ORDER BY id DESC LIMIT 50',[account.id]),
   pool.query("SELECT COALESCE(SUM(amount_fen),0) AS total_recharged_fen FROM billing_ledger WHERE account_id=$1 AND kind='recharge'",[account.id])
  ]):[{rows:[]},{rows:[{total_recharged_fen:0}]}];
  const packs=account?(await pool.query(`SELECT p.*,o.provider AS payment_provider,o.paid_at,
   r.status AS refund_request_status,r.created_at AS refund_request_at,
   coalesce(f.status,failed.status) AS refund_status,
   coalesce(f.amount_fen,failed.amount_fen)::text AS refund_amount_fen,
   coalesce(f.created_at,failed.created_at) AS refund_submitted_at,
   coalesce(f.processing_at,failed.processing_at) AS refund_processing_at,
   coalesce(f.completed_at,failed.completed_at) AS refund_completed_at
   FROM credit_packs p
   LEFT JOIN payment_orders o ON p.source_kind='payment' AND o.id=p.source_id
   LEFT JOIN credit_refund_requests r ON r.pack_id=p.id AND r.status IN ('requested','processing')
   LEFT JOIN payment_refunds f ON f.id=p.refund_id
   LEFT JOIN LATERAL (
    SELECT status,amount_fen,created_at,processing_at,completed_at FROM payment_refunds
    WHERE p.refund_id IS NULL AND order_id=o.id AND pack_id=p.id AND status='failed'
    ORDER BY created_at DESC,id DESC LIMIT 1
   ) failed ON true
   WHERE p.account_id=$1 ORDER BY p.created_at DESC LIMIT 100`,[account.id])).rows:[];
  const packViews=[];
  // Aggregate red/green for one dashboard progress bar. Red = remaining paid cash (refundable),
  // green = remaining gift. Spent = paid cash already consumed. Only active packs count.
  // Gift expires 180 days after recharge (per-pack); expired gift vanishes, paid cash stays.
  let redFen=0n,greenFen=0n,spentRedFen=0n,paidFen=0n,faceFen=0n,expiredGiftFen=0n;
  const now=Date.now();
  for(const p of packs){
   const q=await refundQuote(pool,p.id);
   const giftExpiresAt=p.gift_expires_at?new Date(p.gift_expires_at).getTime():null;
   const giftExpired=giftExpiresAt!==null&&giftExpiresAt<now;
   packViews.push({...p,net_fen:q.refundable_fen,red_fen:q.refundable_fen,refundable_fen:q.refundable_fen,bonus_fen:giftExpired?'0':q.bonus_fen,fee_fen:'0',refund_blocked:q.blocked,gift_expires_at:p.gift_expires_at,gift_expired:giftExpired});
   if(!p.refund_id){
    const red=BigInt(q.refundable_fen),green=giftExpired?0n:BigInt(q.bonus_fen);
    redFen+=red;greenFen+=green;paidFen+=BigInt(p.cash_fen);faceFen+=BigInt(p.face_fen);
    spentRedFen+=BigInt(p.cash_fen)-BigInt(p.consumed_cash_fen)-red;
    if(giftExpired)expiredGiftFen+=BigInt(q.bonus_fen);
   }
  }
  const creditSplit={
   face_fen:String(faceFen),paid_fen:String(paidFen),
   red_fen:String(redFen),green_fen:String(greenFen),spent_red_fen:String(spentRedFen),
   remaining_fen:String(redFen+greenFen),refundable_fen:String(redFen),
   gift_fen:String(faceFen-paidFen),expired_gift_fen:String(expiredGiftFen),
   // Historical maximum list total: the dashed outline the bar draws around.
   // It never shrinks while any pack is active; a new recharge grows it.
   max_face_fen:String(faceFen)
  };
  const usage=account?(await pool.query(`SELECT model_id,count(*)::int AS calls,coalesce(sum(input_tokens),0) AS input_tokens,coalesce(sum(output_tokens),0) AS output_tokens,coalesce(sum(charged_yuan),0) AS charged_yuan FROM customer_calls WHERE account_id=$1 GROUP BY model_id`,[account.id])).rows:[];
  const summary=disabled(account,entries.rows,scope,totalRecharged.rows[0].total_recharged_fen,channels);
  summary.recharge.channel_status=Object.fromEntries([['alipay_f2f',cfg.alipay],['wechat_native',cfg.wechat]].map(([key,config])=>[key,channels.includes(key)?'available':config?.enabled?'restricted':'unavailable']));
  res.json({...summary,packs:packViews,credit_split:creditSplit,usage_by_model:usage,...(bankTransfer?{bank_transfer:bankTransfer}:{})});
 }
 app.get('/api/billing/personal',requireCustomer,async(req,res)=>{
  const account=(await pool.query('SELECT id,cash_balance_fen,list_credit_fen,total_spent_fen FROM billing_accounts WHERE owner_id=$1',[req.customer.id])).rows[0];
  await view(account,'personal',res,undefined,payments?.channelsFor(req.customer)||[]);
 });
 app.get('/api/billing/organizations/:org',requireCustomer,async(req,res)=>{
  const org=id(req.params.org),membership=(await pool.query("SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[org,req.customer.id])).rows[0];
  if(!membership||!isManager(membership.role))throw new HttpError(403,'仅企业管理者可以查看企业资金');
  const account=(await pool.query('SELECT id,cash_balance_fen,list_credit_fen,total_spent_fen FROM billing_accounts WHERE organization_id=$1',[org])).rows[0];
  const bank=cfg.bankTransfer||{enabled:false};
  const bankTransfer=bank.enabled?{enabled:true,account_name:bank.accountName,bank_name:bank.bankName,account_number:bank.accountNumber}:{enabled:false};
  bankTransfer.notices=await transferNotices(pool,org);
  await view(account,'organization',res,bankTransfer,payments?.channelsFor(req.customer)||[]);
 });
}
