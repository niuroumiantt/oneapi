import {refundQuote} from './pack-ledger.mjs';
import { HttpError,id } from './core.mjs';
import { isManager } from './organizations.mjs';
import { REFUND_POLICY_ZH } from './list-credit.mjs';

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
  refund:{enabled:true,fee_percent:15,policy:REFUND_POLICY_ZH},
  payments_enabled:channels.length>0
 };
}

export function billingRoutes(app,pool,requireCustomer,cfg,payments){
 async function view(account,scope,res,bankTransfer,channels=[]){
  const [entries,totalRecharged]=account?await Promise.all([
   pool.query('SELECT id,kind,amount_fen,balance_after_fen,reference_id,created_at FROM billing_ledger WHERE account_id=$1 ORDER BY id DESC LIMIT 50',[account.id]),
   pool.query("SELECT COALESCE(SUM(amount_fen),0) AS total_recharged_fen FROM billing_ledger WHERE account_id=$1 AND kind='recharge'",[account.id])
  ]):[{rows:[]},{rows:[{total_recharged_fen:0}]}];
  const packs=account?(await pool.query(`SELECT p.*,r.status AS refund_request_status FROM credit_packs p LEFT JOIN credit_refund_requests r ON r.pack_id=p.id AND r.status IN ('requested','processing') WHERE account_id=$1 ORDER BY p.created_at DESC LIMIT 100`,[account.id])).rows:[];
  const packViews=[];for(const p of packs){const q=await refundQuote(pool,p.id);packViews.push({...p,net_fen:q.net_fen,fee_fen:q.fee_fen,refund_blocked:q.blocked});}
  const usage=account?(await pool.query(`SELECT model_id,count(*)::int AS calls,coalesce(sum(input_tokens),0) AS input_tokens,coalesce(sum(output_tokens),0) AS output_tokens,coalesce(sum(charged_yuan),0) AS charged_yuan FROM customer_calls WHERE account_id=$1 GROUP BY model_id`,[account.id])).rows:[];
  res.json({...disabled(account,entries.rows,scope,totalRecharged.rows[0].total_recharged_fen,channels),packs:packViews,usage_by_model:usage,...(bankTransfer?{bank_transfer:bankTransfer}:{})});
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
  await view(account,'organization',res,bankTransfer,payments?.channelsFor(req.customer)||[]);
 });
}
