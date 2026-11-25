import {quoteCW,consumeCW} from './cw-ledger.mjs';
import {HttpError,transaction} from './core.mjs';
// All decimal arithmetic stays in PostgreSQL. Cash is recognised cumulatively per pack,
// so repeated sub-cent calls neither disappear nor round up into overcharging.
// Gift (green) credit expires 180 days after the recharge day; paid cash (red) never expires.
// Owner decision 2026-11-24: consumption is always red-first, then green.
export const GIFT_TTL_DAYS = 180;
export async function addPack(db,{accountId,sourceKind,sourceId,faceFen,cashFen}){
 return (await db.query(`INSERT INTO credit_packs(account_id,source_kind,source_id,face_fen,cash_fen,remaining_fen,gift_expires_at) VALUES($1,$2,$3,$4::bigint,$5,$4::numeric,now()+make_interval(days=>$6)) ON CONFLICT(source_kind,source_id) DO NOTHING RETURNING id`,[accountId,sourceKind,sourceId,faceFen,cashFen,GIFT_TTL_DAYS])).rows[0];
}
export async function accountFor(db,userId,orgId,{create=false}={}){
 if(orgId){const m=(await db.query("SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[orgId,userId])).rows[0];if(!m||!['owner','admin','billing'].includes(m.role))throw new HttpError(403,'仅企业管理者可以操作企业付费额度');}
 else if((await db.query("SELECT 1 FROM account_upgrade_requests WHERE user_id=$1 AND status='approved'",[userId])).rowCount)throw new HttpError(403,'账户已升级，请使用企业工作台');
 const col=orgId?'organization_id':'owner_id',value=orgId||userId;
 if(create)await db.query(`INSERT INTO billing_accounts(${col}) VALUES($1) ON CONFLICT(${col}) WHERE ${col} IS NOT NULL DO NOTHING`,[value]);
 return (await db.query(`SELECT * FROM billing_accounts WHERE ${col}=$1`,[value])).rows[0];
}
export async function quotePack(db,account,faceFen,promo='',options={}){
 if(!Number.isSafeInteger(faceFen)||faceFen<500||faceFen>5000000)throw new HttpError(400,'额度包面额须为 ¥5 至 ¥50,000');
 promo=String(promo||'').normalize('NFKC').trim().toUpperCase();if(!/^(?:[A-Z0-9_-]{0,40}|\p{Script=Han}{8})$/u.test(promo))throw new HttpError(400,'促销码格式不正确');
 const cw=await quoteCW(db,account,faceFen,promo,options);if(cw)return cw;
 const cashInput=options.cashFen??null;
 const cashSnapshot=cashInput===null?{}:{requested_cash_fen:cashInput};
 const grants=(await db.query(`SELECT d.* FROM discount_grants d LEFT JOIN customers c ON c.id=d.customer_id
 WHERE d.status='active' AND now()>=d.starts_at AND now()<d.ends_at AND d.model_id IS NULL
 AND (($3='' AND d.promo_code IS NULL) OR ($3<>'' AND upper(d.promo_code)=$3)) AND
 (d.audience='all' OR d.audience='customer' AND (c.user_id=$1 OR c.organization_id=$2) OR d.audience='tag' AND EXISTS(SELECT 1 FROM customers t WHERE (t.user_id=$1 OR t.organization_id=$2) AND d.tag=ANY(t.tags)))
 ORDER BY d.customer_price_percent,d.id FOR UPDATE OF d`,[account.owner_id,account.organization_id,promo])).rows;
 if(promo&&!grants.some(g=>g.promo_code?.toUpperCase()===promo))throw new HttpError(400,'促销码无效、未生效或不适用于当前账户');
 let exceedsLimit=false;
 for(const g of grants){
  const face=cashInput===null?faceFen:Math.floor(cashInput*100/g.customer_price_percent);
  if(face>5000000){exceedsLimit=true;continue;}
  const cash=cashInput??Math.ceil(face*g.customer_price_percent/100),saving=face-cash;
  // Pending orders reserve discount budget too. Expiry alone cannot release it: a delayed paid notification may still arrive.
  const used=(await db.query(`SELECT coalesce(sum(face_fen-amount_fen),0) AS n FROM payment_orders WHERE discount_snapshot->>'grant_id'=$1 AND status IN ('pending','paid')`,[g.id])).rows[0].n;
  if(g.cap_fen!==null&&BigInt(used)+BigInt(saving)>BigInt(g.cap_fen))continue;
  return {face_fen:face,amount_fen:cash,discount_snapshot:{grant_id:g.id,name:g.name,percent:g.customer_price_percent,promo_code:g.promo_code||null,...(g.business_line==='direct'?{business_line:'direct',owner_subject:g.created_by}:{}),...cashSnapshot}};
 }
 if(cashInput!==null&&promo)throw new HttpError(400,exceedsLimit?'到账额度超过 ¥50,000，请减少实付金额':'此促销码没有剩余优惠额度，请调整实付金额或移除促销码');
 const amount=cashInput??faceFen;
 return {face_fen:amount,amount_fen:amount,discount_snapshot:{percent:100,...cashSnapshot}};
}
export async function settlePaidCall(pool,callId,amount,usage,source,requestId,latency){
 return transaction(pool,async db=>{
  const ref=(await db.query('SELECT account_id FROM customer_calls WHERE id=$1',[callId])).rows[0];
  if(!ref)return;
  await db.query('SELECT id FROM billing_accounts WHERE id=$1 FOR UPDATE',[ref.account_id]);
  const call=(await db.query('SELECT * FROM customer_calls WHERE id=$1 FOR UPDATE',[callId])).rows[0];
  if(!['pending','awaiting_bill'].includes(call.status))return;
  // Do not spend another in-flight call's reservation, even if the upstream exceeds its declared bound.
  const available=(await db.query(`SELECT greatest(0,list_credit_fen-coalesce((SELECT sum(hold_yuan)*100 FROM customer_calls WHERE account_id=$1 AND id<>$2 AND status IN ('pending','awaiting_bill')),0)) AS n FROM billing_accounts WHERE id=$1`,[call.account_id,callId])).rows[0].n;
  const keyRemaining=(await db.query(`SELECT greatest(0,k.limit_yuan-coalesce((SELECT sum(coalesce(c.charged_yuan,CASE WHEN c.status IN ('pending','awaiting_bill') THEN c.hold_yuan END)) FROM customer_calls c WHERE c.key_id=k.id AND c.id<>$2),0))*100 AS n FROM customer_api_keys k WHERE k.id=$1`,[call.key_id,callId])).rows[0].n;
  let need=(await db.query('SELECT least($1::numeric*100,$2::numeric,$3::numeric) AS n',[amount,available,keyRemaining])).rows[0].n;
  const charge=need;let cash=0n;
  const packs=(await db.query('SELECT * FROM credit_packs WHERE account_id=$1 AND remaining_fen>0 AND refund_id IS NULL ORDER BY created_at,id FOR UPDATE',[call.account_id])).rows;
  for(const pack of packs){
   if(Number(need)<=0)break;
   // Red-first: spend the customer's own cash (red) before the gifted credit (green).
   // consumed_cash_fen is cumulative official-price consumption capped at cash paid, so
   // repeated sub-cent calls neither vanish nor over-charge. Green = remaining - red left.
   const part=(await db.query(`UPDATE credit_packs SET remaining_fen=remaining_fen-least(remaining_fen,$2::numeric),consumed_cash_fen=least(cash_fen,floor(face_fen-(remaining_fen-least(remaining_fen,$2::numeric))))::bigint WHERE id=$1 RETURNING $3::numeric-remaining_fen AS face,consumed_cash_fen-$4::bigint AS cash`,[pack.id,need,pack.remaining_fen,pack.consumed_cash_fen])).rows[0];
   await db.query('INSERT INTO credit_consumptions(call_id,pack_id,face_fen,cash_fen) VALUES($1,$2,$3,$4)',[callId,pack.id,part.face,part.cash]);
   await consumeCW(db,pack.id,callId);
   cash+=BigInt(part.cash);need=(await db.query('SELECT $1::numeric-$2::numeric AS n',[need,part.face])).rows[0].n;
  }
  if(Number(need)>0)throw Error('CREDIT_PACK_BALANCE_MISMATCH');
  const account=(await db.query('UPDATE billing_accounts SET list_credit_fen=list_credit_fen-$2,cash_balance_fen=cash_balance_fen-$3,total_spent_fen=total_spent_fen+$3 WHERE id=$1 RETURNING cash_balance_fen',[call.account_id,charge,cash.toString()])).rows[0];
  if(cash>0n)await db.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'usage',$2,$3,'usage',$4)",[call.account_id,(-cash).toString(),account.cash_balance_fen,callId]);
  await db.query(`UPDATE customer_calls SET status='settled',actual_yuan=$2,charged_yuan=$3::numeric/100,settlement_source=$4,upstream_request_id=coalesce($5,upstream_request_id),input_tokens=$6,cached_input_tokens=$7,output_tokens=$8,latency_ms=coalesce($9,latency_ms),finished_at=coalesce(finished_at,now()),settled_at=now() WHERE id=$1`,[callId,amount,charge,source,requestId,usage?.input??null,usage?.cached??null,usage?.output??null,latency??null]);
 });
}
// Forfeit expired gift (green) credit. Paid cash (red) never expires.
// Red is consumed first, so the green portion of a pack only starts to be spent
// once cash_fen is fully consumed. Remaining red = cash_fen - consumed_cash_fen.
// When a pack's gift expires, the unconsumed green is zeroed out and the account's
// list credit drops by that amount; red stays untouched. All decimal math stays in SQL.
export async function expirePackGifts(db){
 const expired=(await db.query(`SELECT p.id,p.account_id,p.remaining_fen,p.cash_fen,p.consumed_cash_fen FROM credit_packs p
   WHERE p.gift_expires_at IS NOT NULL AND p.gift_expires_at<now() AND p.remaining_fen>0 AND p.refund_id IS NULL`)).rows;
 for(const p of expired){
  const redLeft=BigInt(p.cash_fen)-BigInt(p.consumed_cash_fen);
  // green left = remaining (numeric, may have decimals) - red left; round to whole fen.
  const remainingFen=Math.round(Number(p.remaining_fen));
  const greenLeft=remainingFen>Number(redLeft)?BigInt(remainingFen)-redLeft:0n;
  if(greenLeft<=0n)continue;
  await db.query(`UPDATE credit_packs SET remaining_fen=remaining_fen-$2 WHERE id=$1`,[p.id,greenLeft.toString()]);
  await db.query(`UPDATE billing_accounts SET list_credit_fen=list_credit_fen-$2 WHERE id=$1`,[p.account_id,greenLeft.toString()]);
 }
}
// Red/green refund quote (owner decision 2026-11-21):
//   red left  = cash_fen - consumed_cash_fen  -> refunded in full, no fee
//   green     = remaining_fen - red left      -> forfeited in full when refunding
// The gift exists only because the customer paid; refund the cash and the gift goes with it.
export async function refundQuote(db,packId){
 const p=(await db.query(`SELECT p.*,(cash_fen-consumed_cash_fen)::bigint AS refundable_fen,round(remaining_fen-(cash_fen-consumed_cash_fen))::bigint AS bonus_fen FROM credit_packs p WHERE id=$1`,[packId])).rows[0];
 if(!p)throw new HttpError(404,'额度包不存在');
 // Owner policy 2026-11-21: invoicing locks out refunds. Both a requested (not yet issued) and an
 // issued output invoice block self-service refund, so money cannot be refunded out from under an invoice.
 const block=(await db.query(`SELECT 1 FROM tax_invoices i JOIN customers c ON c.id=i.customer_id JOIN billing_accounts a ON a.owner_id=c.user_id OR a.organization_id=c.organization_id WHERE a.id=$1 AND i.direction='output' AND i.status IN ('requested','issued')`,[p.account_id])).rowCount;
 const busy=(await db.query("SELECT 1 FROM customer_calls WHERE account_id=$1 AND status IN ('pending','awaiting_bill')",[p.account_id])).rowCount;
 return {...p,refundable_fen:String(p.refundable_fen),bonus_fen:String(p.bonus_fen),net_fen:String(p.refundable_fen),fee_fen:'0',
  blocked:p.source_kind==='bank'?'对公退款请联系财务人工处理':block?'该账户已申请或已开具发票，开票后不可退款；请先作废或红冲发票':busy?'仍有调用或用量待结算，请结算后退款':p.refund_id?'该包已申请退款':BigInt(p.refundable_fen)<=0n?'红色实付已用完，无可退金额':null};
}
