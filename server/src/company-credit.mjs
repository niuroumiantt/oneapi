import {HttpError,transaction} from './core.mjs';

// Caller holds the organization lock, then the account lock. Decimal arithmetic
// stays in PostgreSQL; repeated removal/settlement can only return the remainder.
export async function returnUnusedCredit(db,org,userId,{remove=false}={}){
 const account=(await db.query('SELECT * FROM employee_credit_accounts WHERE organization_id=$1 AND user_id=$2 FOR UPDATE',[org,userId])).rows[0];
 if(!account)return '0';
 if(remove){
  await db.query('UPDATE employee_api_keys SET revoked_at=coalesce(revoked_at,now()) WHERE owner_id=$1',[userId]);
  await db.query('UPDATE employee_credit_accounts SET reclaim_pending=true WHERE user_id=$1',[userId]);
 }else if(!account.reclaim_pending)return '0';
 const money=(await db.query(`SELECT greatest(0,$2::numeric-$3::numeric-coalesce(sum(hold_yuan),0)) AS returned,count(*)::int AS open
  FROM employee_calls WHERE owner_id=$1 AND status IN ('pending','awaiting_bill')`,[userId,account.granted_yuan,account.spent_yuan])).rows[0];
 await db.query('UPDATE employee_credit_accounts SET granted_yuan=granted_yuan-$2::numeric,reclaim_pending=$3 WHERE user_id=$1',[userId,money.returned,money.open>0]);
 await movePool(db,org,userId,money.returned,remove?'member_removed':'settlement_released');
 return money.returned;
}
export async function movePool(db,org,userId,delta,reason){
 await db.query('INSERT INTO company_credit_pools(organization_id) VALUES($1) ON CONFLICT DO NOTHING',[org]);
 const changed=await db.query('UPDATE company_credit_pools SET available_yuan=available_yuan+$2::numeric WHERE organization_id=$1 AND available_yuan+$2::numeric>=0 RETURNING available_yuan',[org,delta]);
 if(!changed.rowCount)throw new HttpError(409,'公司池可分配额度不足，请先增加公司预算');
 await db.query('INSERT INTO company_credit_ledger(organization_id,user_id,delta_yuan,reason) SELECT $1,$2,$3::numeric,$4 WHERE $3::numeric<>0',[org,userId,delta,reason]);
 return changed.rows[0].available_yuan;
}
export async function reclaimSettledCredit(pool){
 const rows=(await pool.query('SELECT user_id,organization_id FROM employee_credit_accounts WHERE reclaim_pending')).rows;
 for(const row of rows)await transaction(pool,async db=>{
  await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[row.organization_id]);
  await returnUnusedCredit(db,row.organization_id,row.user_id);
 });
}
