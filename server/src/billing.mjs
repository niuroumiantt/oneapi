import { HttpError,id } from './core.mjs';
import { isManager } from './organizations.mjs';

function disabled(account,entries,scope,totalRecharged,channels=[]){
 return {scope,currency:'CNY',cash_balance_fen:String(account?.cash_balance_fen||0),total_spent_fen:String(account?.total_spent_fen||0),total_recharged_fen:String(totalRecharged||0),entries,usage_by_model:[],recharge:{enabled:channels.length>0,minimum_fen:500,maximum_fen:5000000,channels},refund:{enabled:false,fee_policy:'pending_review'},payments_enabled:channels.length>0};
}

export function billingRoutes(app,pool,requireCustomer,cfg,payments){
 async function view(account,scope,res,bankTransfer,channels=[]){
  const [entries,totalRecharged]=account?await Promise.all([
   pool.query('SELECT id,kind,amount_fen,balance_after_fen,created_at FROM billing_ledger WHERE account_id=$1 ORDER BY id DESC LIMIT 50',[account.id]),
   pool.query("SELECT COALESCE(SUM(amount_fen),0) AS total_recharged_fen FROM billing_ledger WHERE account_id=$1 AND kind='recharge'",[account.id])
  ]):[{rows:[]},{rows:[{total_recharged_fen:0}]}];
  res.json({...disabled(account,entries.rows,scope,totalRecharged.rows[0].total_recharged_fen,channels),...(bankTransfer?{bank_transfer:bankTransfer}:{})});
 }
 app.get('/api/billing/personal',requireCustomer,async(req,res)=>{
  const account=(await pool.query('SELECT id,cash_balance_fen,total_spent_fen FROM billing_accounts WHERE owner_id=$1',[req.customer.id])).rows[0];
  await view(account,'personal',res,undefined,payments?.channelsFor(req.customer)||[]);
 });
 app.get('/api/billing/organizations/:org',requireCustomer,async(req,res)=>{
  const org=id(req.params.org),membership=(await pool.query("SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[org,req.customer.id])).rows[0];
  if(!membership||!isManager(membership.role))throw new HttpError(403,'仅企业管理者可以查看企业资金');
  const account=(await pool.query('SELECT id,cash_balance_fen,total_spent_fen FROM billing_accounts WHERE organization_id=$1',[org])).rows[0];
  const bank=cfg.bankTransfer||{enabled:false};
  const bankTransfer=bank.enabled?{enabled:true,account_name:bank.accountName,bank_name:bank.bankName,account_number:bank.accountNumber}:{enabled:false};
  await view(account,'organization',res,bankTransfer,payments?.channelsFor(req.customer)||[]);
 });
}
