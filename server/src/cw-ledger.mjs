import { quoteModelPack } from './model-packs.mjs';
import { HttpError } from './core.mjs';
// VIP base cost is 40% of list price; a VIP's commission is whatever they sell above that.
// commission_bps = (customer_price_percent - 40) * 100. Sell at 50% -> 10%, at 80% -> 40%.
export const VIP_BASE_PERCENT = 40;
export const VIP_SELF_PERCENT = 50;
export const promotionEligible = (selfCode) => `((NOT ${selfCode} AND p.promotion_trial_until > statement_timestamp())
  OR EXISTS(SELECT 1 FROM cw_contracts k WHERE k.partner_id=p.id AND k.expires_at>statement_timestamp())) IS TRUE`;
// Normal activation requires verified cumulative net personal cash of at least ¥100.
export const VIP_ACTIVATE_MIN_CASH_FEN = 10000;
export const commissionBps = (percent) => Math.max(0, (percent - VIP_BASE_PERCENT) * 100);
export const commissionFen = (cash, percent) => (BigInt(cash) * BigInt(commissionBps(percent))) / 10000n;
export const normalizedCode = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .toUpperCase();
// Called inside the same payment transaction. The order snapshot, never current code settings, determines attribution.
// Self-code purchases earn no commission (VIP buys their own credit at cost).
export async function creditCW(db, order, pack) {
  const s = order.discount_snapshot?.cw;
  if (!s || s.is_self_code) return;
  const model = order.discount_snapshot.model_pack;
  // Model orders reserve a ceiling internally, but the paid event earns nothing.
  const fixedCash = s.basis === 'consumed_cash_v1';
  const expected = fixedCash
    ? BigInt(order.amount_fen) * BigInt(s.rate_bps) / 10000n
    : model
    ? BigInt(order.face_fen) * BigInt(model.price_bps - model.settlement_bps) / 10000n
    : commissionFen(order.amount_fen, s.percent);
  await db.query(
    `INSERT INTO cw_commissions(order_id,pack_id,partner_id,code_id,cash_fen,rate_bps,expected_fen,basis)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(order_id) DO NOTHING`,
    [
      order.id,
      pack.id,
      s.partner_id,
      s.code_id,
      order.amount_fen,
      s.rate_bps,
      expected.toString(),
      fixedCash ? s.basis : 'legacy',
    ],
  );
  await db.query(
    `INSERT INTO cw_commission_events(order_id,event_key,kind,cash_fen,commission_fen,model_id,face_fen) VALUES($1,$2,'paid',$3,$4,$5,$6) ON CONFLICT(event_key) DO NOTHING`,
    [order.id, 'paid:' + order.id, order.amount_fen, (model||fixedCash)?'0':expected.toString(), model?.id??null, model?order.face_fen:null],
  );
}
// Cumulate before rounding, so many sub-cent API calls earn the same commission as one call.
export async function consumeCW(db, packId, callId) {
  const c = (
    await db.query(
      `SELECT c.*,p.consumed_cash_fen,p.model_id,
       x.face_fen AS call_face,
       least(p.consumed_cash_fen,floor((p.face_fen-p.removed_face_fen-p.remaining_fen)*
        ((o.discount_snapshot->'model_pack'->>'price_bps')::integer-p.model_settlement_bps)/10000))::bigint AS model_earned
       FROM cw_commissions c JOIN credit_packs p ON p.id=c.pack_id
       JOIN payment_orders o ON o.id=c.order_id
       JOIN credit_consumptions x ON x.pack_id=p.id AND x.call_id=$2
       WHERE c.pack_id=$1 FOR UPDATE OF c`,
      [packId,callId],
    )
  ).rows[0];
  if (!c) return;
  // Cumulative spread is monotone. Subtracting two independently rounded
  // amounts could claw back a cent already reported or paid in a previous month.
  const earned = c.model_id && c.basis === 'legacy' ? BigInt(c.model_earned) : BigInt(c.consumed_cash_fen) * BigInt(c.rate_bps) / 10000n;
  const delta = earned - BigInt(c.unlocked_fen);
  const cash = BigInt(c.consumed_cash_fen) - BigInt(c.used_cash_fen);
  if (!c.model_id && cash <= 0n) return;
  await db.query(
    `INSERT INTO cw_commission_events(order_id,event_key,kind,cash_fen,commission_fen,occurred_at,model_id,face_fen) VALUES($1,$2,'used',$3,$4,(SELECT created_at FROM customer_calls WHERE id=$5),$6,$7)`,
    [c.order_id, 'used:' + callId + ':' + packId, cash.toString(), delta.toString(), callId,c.model_id,c.model_id?c.call_face:null],
  );
  await db.query('UPDATE cw_commissions SET used_cash_fen=$2,unlocked_fen=$3 WHERE order_id=$1', [
    c.order_id,
    c.consumed_cash_fen,
    earned.toString(),
  ]);
}
// Each successful partial refund cancels only its unused-cash commission, once.
export async function refundCW(db, refund) {
  const c = (await db.query('SELECT * FROM cw_commissions WHERE order_id=$1 FOR UPDATE', [refund.order_id]))
    .rows[0];
  if (!c) return;
  if ((await db.query('SELECT 1 FROM cw_commission_events WHERE event_key=$1',['refund:' + refund.id])).rowCount) return;
  const pack = (await db.query('SELECT model_id FROM credit_packs WHERE id=$1',[c.pack_id])).rows[0];
  if (pack?.model_id) {
    await db.query(
      `INSERT INTO cw_commission_events(order_id,event_key,kind,cash_fen,commission_fen,model_id,face_fen)
       VALUES($1,$2,'refund',$3,0,$4,$5::numeric-$6::numeric) ON CONFLICT(event_key) DO NOTHING`,
      [c.order_id,'refund:'+refund.id,refund.amount_fen,pack.model_id,refund.face_fen,refund.retained_fen],
    );
    if (Number(refund.retained_fen) === 0)
      await db.query('UPDATE cw_commissions SET expected_fen=unlocked_fen WHERE order_id=$1',[c.order_id]);
    return;
  }
  const previous=(await db.query("SELECT coalesce(sum(cash_fen),0)::text cash FROM cw_commission_events WHERE order_id=$1 AND kind='refund'",[refund.order_id])).rows[0];
  const net=BigInt(c.cash_fen)-BigInt(previous.cash)-BigInt(refund.gross_fen || refund.amount_fen);
  const expected=(net*BigInt(c.rate_bps))/10000n;
  const next=expected<BigInt(c.unlocked_fen)?BigInt(c.unlocked_fen):expected;
  const cancelled=BigInt(c.expected_fen)-next;
  const inserted = await db.query(
    `INSERT INTO cw_commission_events(order_id,event_key,kind,cash_fen,commission_fen) VALUES($1,$2,'refund',$3,$4) ON CONFLICT(event_key) DO NOTHING RETURNING id`,
    [c.order_id, 'refund:' + refund.id, refund.gross_fen || refund.amount_fen, (-cancelled).toString()],
  );
  if (inserted.rowCount)
    await db.query('UPDATE cw_commissions SET expected_fen=$2 WHERE order_id=$1', [c.order_id,next.toString()]);
}
export async function quoteCW(
  db,
  account,
  faceFen,
  promo,
  { cashFen = null, buyerId = null, cwEnabled = false, models = [] } = {},
) {
  const code = normalizedCode(promo);
  if (!code) return null;
  // Discount (task) code: issued after interview confirmation. Usable while partner is
  // confirmed or active; paying with it activates formal VIP. Self-purchase only, no commission.
  const task = (
    await db.query(
      `SELECT t.*,p.status AS partner_status,p.user_id
       FROM vip_task_codes t JOIN cw_partners p ON p.id=t.partner_id
       WHERE t.code=$1 AND t.status='active' AND t.starts_at<=now() AND (t.ends_at IS NULL OR t.ends_at>now())
       FOR SHARE OF t,p`,
      [code],
    )
  ).rows[0];
  if (task) {
    if (!cwEnabled) throw new HttpError(400, '推广合作活动尚未开放');
    const isSelf = task.user_id === account.owner_id || task.user_id === buyerId;
    if (!isSelf) throw new HttpError(400, '打折码仅限本人自购使用');
    if (task.partner_status !== 'confirmed' && task.partner_status !== 'active')
      throw new HttpError(400, '打折码未生效或已停用');
    const percent = task.customer_price_percent;
    const face = cashFen === null ? faceFen : Number((BigInt(cashFen) * 100n) / BigInt(percent));
    const cash = cashFen === null ? Number((BigInt(face) * BigInt(percent) + 99n) / 100n) : cashFen;
    if (!Number.isSafeInteger(face) || face < 500 || face > 5000000 || cash < 500 || cash > 5000000)
      throw new HttpError(400, '本次实付或到账额度超出范围');
    return {
      face_fen: face,
      amount_fen: cash,
      discount_snapshot: {
        percent,
        promo_code: task.code,
        task_code: task.id,
        cw: {
          partner_id: task.partner_id,
          is_self_code: true,
          rate_bps: 0,
          percent,
        },
        ...(cashFen !== null ? { requested_cash_fen: cashFen } : {}),
      },
    };
  }
  const c = (
    await db.query(
      `SELECT c.*,p.status AS partner_status,p.user_id,
 ${promotionEligible('c.is_self_code')} AS promotion_eligible
 FROM cw_codes c JOIN cw_partners p ON p.id=c.partner_id WHERE c.code=$1 FOR SHARE OF c,p`,
      [code],
    )
  ).rows[0];
  if (!c) return null;
  if (!cwEnabled) throw new HttpError(400, '推广合作活动尚未开放');
  if (
    c.status !== 'active' ||
    c.partner_status !== 'active' ||
    !c.promotion_eligible ||
    new Date(c.starts_at) > new Date() ||
    new Date(c.ends_at) <= new Date()
  )
    throw new HttpError(400, '推广码未生效或已停用');
  // Direct and company-member self-purchases do not qualify for partner offers,
  // except a partner's own self-code (cost price, no commission).
  const isSelf = c.user_id === account.owner_id || c.user_id === buyerId;
  if (isSelf && !c.is_self_code)
    throw new HttpError(400, '不能使用自己的推广码购买额度');
  if (
    !isSelf &&
    account.organization_id &&
    (
      await db.query(
        "SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",
        [account.organization_id, c.user_id],
      )
    ).rowCount
  )
    throw new HttpError(400, '不能使用自己的推广码购买额度');
  if (c.model_id) return quoteModelPack(db,c,account,cashFen,models);
  const percent = c.customer_price_percent;
  const face =
    cashFen === null ? faceFen : Number((BigInt(cashFen) * 100n) / BigInt(percent));
  const cash =
    cashFen === null ? Number((BigInt(face) * BigInt(percent) + 99n) / 100n) : cashFen;
  if (!Number.isSafeInteger(face) || face < 500 || face > 5000000 || cash < 500 || cash > 5000000)
    throw new HttpError(400, '本次实付或到账额度超出范围');
  return {
    face_fen: face,
    amount_fen: cash,
    discount_snapshot: {
      percent,
      promo_code: c.code,
      cw: {
        partner_id: c.partner_id,
        code_id: c.id,
        rate_bps: commissionBps(percent),
        percent,
        is_self_code: !!c.is_self_code,
      },
      ...(cashFen !== null ? { requested_cash_fen: cashFen } : {}),
    },
  };
}
