// Read-only metrics: personal account spend and referred customer spend are separate.
export async function vipMetrics(db, partnerId, userId) {
 const [own, codes] = await Promise.all([
  db.query(`WITH owned AS (SELECT id FROM billing_accounts WHERE owner_id=$1 AND organization_id IS NULL)
   SELECT
    (SELECT coalesce(sum(o.amount_fen),0)::text FROM payment_orders o JOIN owned a ON a.id=o.account_id WHERE o.status='paid') paid_fen,
    (SELECT coalesce(sum(c.cash_fen),0)::text FROM credit_consumptions c JOIN credit_packs p ON p.id=c.pack_id JOIN owned a ON a.id=p.account_id) used_fen,
    (SELECT coalesce(sum(c.face_fen),0)::text FROM credit_consumptions c JOIN credit_packs p ON p.id=c.pack_id JOIN owned a ON a.id=p.account_id) used_quota_fen,
    (SELECT coalesce(sum(coalesce(r.gross_fen,r.amount_fen)),0)::text FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id JOIN owned a ON a.id=o.account_id WHERE r.status='succeeded') refunded_fen`,[userId]),
  db.query(`WITH orders AS (
   SELECT o.id,o.amount_fen,k.id code_id FROM payment_orders o
   JOIN cw_codes k ON k.id::text=o.discount_snapshot->'cw'->>'code_id'
   JOIN billing_accounts a ON a.id=o.account_id
   WHERE k.partner_id=$1 AND NOT k.is_self_code AND a.owner_id IS DISTINCT FROM $2 AND o.status='paid'
  ), usage AS (
   SELECT o.id,coalesce(sum(c.cash_fen),0) used_fen FROM orders o
   JOIN credit_packs p ON p.source_kind='payment' AND p.source_id=o.id
   JOIN credit_consumptions c ON c.pack_id=p.id GROUP BY o.id
  ), refunds AS (
   SELECT o.id,sum(coalesce(r.gross_fen,r.amount_fen)) refunded_fen FROM orders o
   JOIN payment_refunds r ON r.order_id=o.id AND r.status='succeeded' GROUP BY o.id
  ) SELECT o.code_id, sum(o.amount_fen)::text paid_fen,
   coalesce(sum(u.used_fen),0)::text used_fen,coalesce(sum(r.refunded_fen),0)::text refunded_fen,
   coalesce(sum(c.unlocked_fen),0)::text commission_fen
   FROM orders o LEFT JOIN usage u ON u.id=o.id LEFT JOIN refunds r ON r.id=o.id
   LEFT JOIN cw_commissions c ON c.order_id=o.id GROUP BY o.code_id`,[partnerId,userId])
 ]);
 const keys=['paid_fen','used_fen','refunded_fen','commission_fen'];
 const promotion=Object.fromEntries(keys.map(key=>[key,codes.rows.reduce((n,c)=>n+BigInt(c[key]),0n).toString()]));
 return {personal:own.rows[0],promotion,codes:codes.rows};
}
