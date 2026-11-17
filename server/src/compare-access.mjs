import {HttpError,hash,token,transaction} from './core.mjs';
import {accountFor} from './pack-ledger.mjs';

// Comparison follows existing spend permissions and usable balances, not who purchased the funds.
export async function comparisonAccounts(db,userId,cfg={}){
 const purchased= (await db.query(`SELECT a.id,a.organization_id,o.name AS organization_name,
  greatest(0,a.list_credit_fen-coalesce((SELECT sum(c.hold_yuan)*100 FROM customer_calls c WHERE c.account_id=a.id AND c.status IN ('pending','awaiting_bill')),0))/100 AS available_yuan
  FROM billing_accounts a LEFT JOIN organizations o ON o.id=a.organization_id
  WHERE a.list_credit_fen>0 AND EXISTS(SELECT 1 FROM credit_packs p WHERE p.account_id=a.id AND p.remaining_fen>0 AND p.refund_id IS NULL)
  AND ((a.owner_id=$1 AND NOT EXISTS(SELECT 1 FROM account_upgrade_requests u WHERE u.user_id=$1 AND u.status='approved'))
   OR EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=a.organization_id AND m.user_id=$1 AND m.status='active' AND m.role IN ('owner','admin','billing')))
  ORDER BY a.organization_id NULLS FIRST,a.id`,[userId])).rows.map(a=>({account_id:a.id,organization_id:a.organization_id,kind:'purchased',name:a.organization_id?`${a.organization_name} · 账户额度`:'个人 · 账户额度',available_yuan:String(a.available_yuan)})).filter(a=>Number(a.available_yuan)>0);
 if(!cfg.employeeCredit?.organizationId||!process.env.SUPPLIER_LAB_SECRET)return purchased;
 const allocated=(await db.query(`SELECT a.organization_id,o.name AS organization_name,
  greatest(0,a.granted_yuan-a.spent_yuan-coalesce((SELECT sum(c.hold_yuan) FROM employee_calls c WHERE c.owner_id=a.user_id AND c.status IN ('pending','awaiting_bill')),0)) AS available_yuan
  FROM employee_credit_accounts a JOIN organizations o ON o.id=a.organization_id
  JOIN memberships m ON m.organization_id=a.organization_id AND m.user_id=a.user_id AND m.status='active'
  WHERE a.user_id=$1 AND a.organization_id=$2 AND a.granted_yuan>a.spent_yuan`,[userId,cfg.employeeCredit.organizationId])).rows
  .filter(a=>Number(a.available_yuan)>0).map(a=>({account_id:'employee:'+a.organization_id,organization_id:a.organization_id,kind:'allocated',name:`${a.organization_name} · 分配额度`,available_yuan:String(a.available_yuan)}));
 return [...purchased,...allocated];
}

export async function comparisonCredential(pool,userId,accountId,model,cfg={}){
 return transaction(pool,async db=>{
  const selected=(await comparisonAccounts(db,userId,cfg)).find(a=>a.account_id===accountId);
  if(!selected)throw new HttpError(403,'该额度不属于当前账号、权限已失效或可用额度不足');
  if(selected.kind==='allocated'){
   await db.query('SELECT user_id FROM employee_credit_accounts WHERE user_id=$1 FOR UPDATE',[userId]);
   const fresh=(await comparisonAccounts(db,userId,cfg)).find(a=>a.account_id===accountId);
   if(!fresh||Number(fresh.available_yuan)<=0)throw new HttpError(402,'分配额度不足或权限已变化，请刷新页面');
   const secret='sf_emp_'+token();
   const row=(await db.query(`INSERT INTO employee_api_keys(owner_id,label,secret_hash,key_hint,model_ids,limit_yuan,purpose,expires_at)
    VALUES($1,'API 对比（自动失效）',$2,$3,ARRAY[$4],$5,'compare',now()+interval '5 minutes') RETURNING id`,[userId,hash(secret),secret.slice(-6),model,fresh.available_yuan])).rows[0];
   return {id:row.id,secret,kind:'allocated'};
  }
  const account=await accountFor(db,userId,selected.organization_id);
  if(account?.id!==accountId)throw new HttpError(403,'账户权限已变化，请刷新页面');
  const money=(await db.query('SELECT list_credit_fen FROM billing_accounts WHERE id=$1 FOR UPDATE',[accountId])).rows[0];
  if(Number(selected.available_yuan)<=0||Number(money.list_credit_fen)<=0)throw new HttpError(402,'可用额度不足或正在结算，请稍后重试');
  const secret='sf_paid_'+token();
  const row=(await db.query(`INSERT INTO customer_api_keys(account_id,owner_id,label,secret_hash,key_hint,model_ids,limit_yuan,purpose,expires_at)
   VALUES($1,$2,'API 对比（自动失效）',$3,$4,ARRAY[$5],greatest(1,$6::numeric/100),'compare',now()+interval '5 minutes') RETURNING id`,[accountId,userId,hash(secret),secret.slice(-6),model,money.list_credit_fen])).rows[0];
  return {id:row.id,secret,kind:'purchased'};
 });
}

export async function retireComparisonCredential(pool,key){
 const table=key.kind==='allocated'?'employee_api_keys':'customer_api_keys';
 await pool.query(`UPDATE ${table} SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND purpose='compare'`,[key.id]);
}
