import { HttpError, audit } from './core.mjs';
import { VIP_ACTIVATE_MIN_CASH_FEN } from './cw-ledger.mjs';

// Classify by the snapshot at purchase time. An expired or replaced code stays visible on the original order.
export const vipPayment = `coalesce(o.discount_snapshot->'cw'->>'is_self_code','false')='true'
  AND nullif(o.discount_snapshot->>'task_code','') IS NOT NULL
  AND o.discount_snapshot->'cw'->>'partner_id'=p.id::text`;

export const rechargeFields = `o.id,o.out_trade_no,o.provider,o.status,o.amount_fen::text,o.face_fen::text,
  o.refunded_fen::text,o.created_at,o.paid_at,l.created_at AS credited_at,
  o.discount_snapshot->>'promo_code' AS promo_code,coalesce((${vipPayment}),false) AS vip_payment`;
export const rechargeLedger = `LEFT JOIN billing_ledger l
  ON l.account_id=o.account_id AND l.kind='recharge' AND l.reference_kind='payment' AND l.reference_id=o.id::text`;

export async function qualifyingVipRecharge(db, partnerId) {
  return (await db.query(
    `SELECT o.id,o.out_trade_no,o.amount_fen::text,o.paid_at
       FROM cw_partners p JOIN billing_accounts a ON a.owner_id=p.user_id
       JOIN payment_orders o ON o.account_id=a.id
      WHERE p.id=$1 AND o.status='paid' AND (${vipPayment}) AND o.amount_fen>=$2
      ORDER BY o.paid_at DESC,o.id DESC LIMIT 1`,
    [partnerId, VIP_ACTIVATE_MIN_CASH_FEN],
  )).rows[0];
}

export async function verifiedExceptionOrder(db, userId, orderNumber) {
  const order = (await db.query(
    `SELECT o.id,o.out_trade_no,o.status,o.amount_fen::text,o.face_fen::text,o.refunded_fen::text,
            o.account_id,o.paid_at,o.provider_trade_no
       FROM payment_orders o JOIN billing_accounts a ON a.id=o.account_id
      WHERE a.owner_id=$1 AND o.out_trade_no=$2
      FOR UPDATE OF o`, [userId, orderNumber],
  )).rows[0];
  if (!order) throw new HttpError(404, '找不到该原单，或该订单未充值到此客户的个人账户');
  const proof = (await db.query(
    `SELECT (SELECT l.created_at FROM billing_ledger l
               WHERE l.account_id=$1 AND l.reference_kind='payment' AND l.reference_id=$2
                 AND l.kind='recharge' AND l.amount_fen=$3) AS credited_at,
            EXISTS(SELECT 1 FROM payment_refunds r WHERE r.order_id=$2::uuid AND r.status IN ('pending','succeeded')) AS refund`,
    [order.account_id, order.id, order.amount_fen],
  )).rows[0];
  if (order.status !== 'paid' || !order.paid_at || !order.provider_trade_no || !proof.credited_at)
    throw new HttpError(409, '原单尚未核实到账，请先核对支付和入账记录');
  if (order.refunded_fen !== '0' || proof.refund)
    throw new HttpError(409, '原单已退款或正在退款，不能用于特批');
  return { ...order, credited_at: proof.credited_at };
}

const money = (fen) => '¥' + (Number(fen) / 100).toFixed(2);

export async function queueVipRechargeNotice(db, { cfg, mail, order }) {
  const lead = (await db.query(
    `SELECT p.id,p.public_code,s.email AS owner_email,(${vipPayment}) AS vip_payment
       FROM payment_orders o JOIN billing_accounts a ON a.id=o.account_id
       JOIN cw_partners p ON p.user_id=a.owner_id
       LEFT JOIN staff_members s ON s.subject=p.owner_subject AND s.status='active' AND s.role<>'pending'
      WHERE o.id=$1`, [order.id],
  )).rows[0];
  if (!lead) return;
  const recipients = new Set([lead.owner_email, cfg.cw.paymentNoticeEmail]
    .map((value) => value?.trim().toLowerCase()).filter(Boolean));
  if (!recipients.size) return;
  const url = new URL('/promotion/vip.html', cfg.origin);
  url.search = new URLSearchParams({ staff: '1', partner: lead.id });
  const paidAt = new Date(order.paid_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const lines = [
    'VIP 客户个人账户已收到一笔充值。请按原单核验到账和 VIP 开通条件。',
    `VIP 编号：${lead.public_code}`,
    `商户订单号：${order.out_trade_no}`,
    `订单类型：${lead.vip_payment ? 'VIP 付款码' : '普通充值'}`,
    `支付渠道：${order.provider === 'wechat_native' ? '微信支付' : '支付宝'}`,
    `实付：${money(order.amount_fen)}，赠送额度：${money(Number(order.face_fen) - Number(order.amount_fen))}，到账额度：${money(order.face_fen)}`,
    `入账时间（北京时间）：${paidAt}`,
    `客户档案：${url.href}`,
  ];
  for (const to of recipients) await mail.queue({
    to, subject: `semifly VIP 客户充值到账 · ${lead.public_code}`, text: lines.join('\n'),
  }, db);
  await audit(db, { kind: 'system', id: 'vip-recharge-mail' }, 'cw.recharge_notice_queued', null, order.id, {
    partner_id: lead.id, recipient_count: recipients.size,
  });
}
