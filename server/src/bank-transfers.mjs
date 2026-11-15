import {HttpError,id,text,transaction,audit} from './core.mjs';
import {isManager} from './organizations.mjs';
import {fen} from './business-console.mjs';
export const bankDay=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
export function transferDay(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value>bankDay()||value<'2020-01-01')throw new HttpError(400,'请填写有效的转账日期，不能晚于今天');
 return value;
}
export const bankSnapshot=cfg=>({account_name:cfg.bankTransfer.accountName,bank_name:cfg.bankTransfer.bankName,account_number:cfg.bankTransfer.accountNumber});
export async function transferNotices(db,org){return (await db.query(`SELECT n.id,n.payer_name,n.cash_fen::text,to_char(n.paid_on,'YYYY-MM-DD') AS paid_day,n.payer_reference,n.note,n.receiving_account,n.created_at,
 CASE WHEN e.status='approved' THEN 'approved' WHEN e.status='rejected' THEN 'rejected' ELSE n.status END AS status,
 coalesce(nullif(e.decision_note,''),nullif(n.review_note,''),'') AS review_note,e.cash_fen::text AS credited_cash_fen,e.face_fen::text AS credited_face_fen,e.decided_at
 FROM bank_transfer_notices n LEFT JOIN bank_transfer_entries e ON e.id=n.entry_id WHERE n.organization_id=$1 ORDER BY n.created_at DESC LIMIT 100`,[org])).rows;}
export function bankTransferCustomerRoutes(app,pool,requireCustomer,cfg){
 app.post('/api/billing/organizations/:org/bank-transfers',requireCustomer,async(req,res)=>{
  const org=id(req.params.org),b=req.body||{},cash=fen(b.cash_yuan,'转账金额'),paid=transferDay(b.paid_on),payer=text(b.payer_name,'付款户名',160),reference=text(b.payer_reference,'付款流水号',120),note=b.note?text(b.note,'备注',500):'',key=text(b.idempotency_key,'提交标识',100);
  if(!cfg.bankTransfer?.enabled)throw new HttpError(409,'对公收款账户尚未配置，请稍后再试');
  const result=await transaction(pool,async db=>{
   const m=(await db.query("SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active' FOR SHARE",[org,req.customer.id])).rows[0];
   if(!m||!isManager(m.role))throw new HttpError(403,'仅企业管理者可以提交转账信息');
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,65))',[org]);
   const old=(await db.query("SELECT *,to_char(paid_on,'YYYY-MM-DD') AS paid_day FROM bank_transfer_notices WHERE organization_id=$1 AND idempotency_key=$2",[org,key])).rows[0];
   if(old){if(Number(old.cash_fen)!==cash||old.payer_name!==payer||old.payer_reference!==reference||old.note!==note||old.paid_day!==paid)throw new HttpError(409,'同一次提交的内容已变化，请刷新后重试');return {id:old.id,status:old.status};}
   const duplicate=(await db.query("SELECT n.id FROM bank_transfer_notices n LEFT JOIN bank_transfer_entries e ON e.id=n.entry_id WHERE n.organization_id=$1 AND upper(regexp_replace(n.payer_reference,'\\s','','g'))=upper(regexp_replace($2::text,'\\s','','g')) AND n.status<>'rejected' AND (e.status IS NULL OR e.status<>'rejected')",[org,reference])).rows[0];
   if(duplicate)throw new HttpError(409,'这笔流水已经提交，请查看下方处理进度');
   const row=(await db.query('INSERT INTO bank_transfer_notices(organization_id,submitted_by,idempotency_key,payer_name,cash_fen,paid_on,payer_reference,note,receiving_account) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,status',[org,req.customer.id,key,payer,cash,paid,reference,note,bankSnapshot(cfg)])).rows[0];
   await audit(db,{kind:'customer',id:req.customer.id},'bank_transfer.submitted',org,row.id,{cash_fen:cash});return row;
  });res.status(201).json(result);
 });
}
