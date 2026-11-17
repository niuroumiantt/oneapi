import {HttpError,hash,token,transaction} from './core.mjs';
import {accountFor} from './pack-ledger.mjs';

// A purchased credit pack is the authoritative result of a confirmed payment or approved bank transfer.
// Pending orders, demo balances and employee grants never grant comparison access.
export async function comparisonAccounts(db,userId){
 return (await db.query(`SELECT a.id,a.organization_id,o.name AS organization_name,
  greatest(0,a.list_credit_fen-coalesce((SELECT sum(c.hold_yuan)*100 FROM customer_calls c WHERE c.account_id=a.id AND c.status IN ('pending','awaiting_bill')),0))/100 AS available_yuan
  FROM billing_accounts a LEFT JOIN organizations o ON o.id=a.organization_id
  WHERE a.list_credit_fen>0 AND EXISTS(SELECT 1 FROM credit_packs p WHERE p.account_id=a.id AND p.cash_fen>0 AND p.remaining_fen>0 AND p.refund_id IS NULL)
  AND ((a.owner_id=$1 AND NOT EXISTS(SELECT 1 FROM account_upgrade_requests u WHERE u.user_id=$1 AND u.status='approved'))
   OR EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=a.organization_id AND m.user_id=$1 AND m.status='active' AND m.role IN ('owner','admin','billing')))
  ORDER BY a.organization_id NULLS FIRST,a.id`,[userId])).rows.map(a=>({account_id:a.id,organization_id:a.organization_id,name:a.organization_id?`${a.organization_name} · 已购 API 额度`:'个人 · 已购 API 额度',available_yuan:String(a.available_yuan)}));
}

export async function comparisonCredential(pool,userId,accountId,model){
 return transaction(pool,async db=>{
  const selected=(await comparisonAccounts(db,userId)).find(a=>a.account_id===accountId);
  if(!selected)throw new HttpError(403,'该付费产品不属于当前账号，或已无可用购买额度');
  const account=await accountFor(db,userId,selected.organization_id);
  if(account?.id!==accountId)throw new HttpError(403,'付费账户权限已变化，请刷新页面');
  const money=(await db.query('SELECT list_credit_fen FROM billing_accounts WHERE id=$1 FOR UPDATE',[accountId])).rows[0];
  if(Number(selected.available_yuan)<=0||Number(money.list_credit_fen)<=0)throw new HttpError(402,'已购额度不足或正在结算，请充值或稍后重试');
  const secret='sf_paid_'+token();
  const row=(await db.query(`INSERT INTO customer_api_keys(account_id,owner_id,label,secret_hash,key_hint,model_ids,limit_yuan,purpose,expires_at)
   VALUES($1,$2,'API 对比（自动失效）',$3,$4,ARRAY[$5],greatest(1,$6::numeric/100),'compare',now()+interval '5 minutes') RETURNING id`,[accountId,userId,hash(secret),secret.slice(-6),model,money.list_credit_fen])).rows[0];
  return {id:row.id,secret};
 });
}
