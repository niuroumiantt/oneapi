// Official list-price credit packs: metering uses face value; cash is paid at purchase.
// See docs/handoff/list-credit-billing.md.

/** Customer-facing policy copy: refunds and invoices are two sides of the same paid cash. */
export const REFUND_POLICY_ZH =
 '实付与赠送额度均可用于消费，通用额度先扣实付。模型专属额度仅限对应模型，实付与赠送按购买比例扣减。实付长期有效，赠送额度自充值起半年有效。可自助退金额为未消费实付款，扣除首次 VIP 激活款、已申请或已开具发票金额、购买时约定不可退款的优惠款项；重复限制不重复扣除。首次 VIP 激活按累计有效实付满 ¥100 核验，历史特批不足 ¥100 的只限制实际金额，不额外扣减可用额度。退款无手续费，退款订单的剩余赠送额度整条收回，保留的不可退实付仍可消费。限制款项仅能提交工单，由管理员核验处理；已开票款项须先依法处理发票。对公退款走人工。';
export const INVOICE_POLICY_ZH =
 '充值即可按实际付款金额申请开票；付款后 30 天内均可申请。扣除退款和已申请/已开具发票金额计算可开票金额，赠送额度不能开票。发票关联到原付款金额，该部分不可自助退款；其他未开票款项按各自退款约定处理。已消耗的那部分实付仍可开票；退款不退已消费部分。';

/**
 * Red/green split for one credit pack (owner decision 2026-11-21).
 * Red (paid cash) is consumed first at official list price; green is the gift.
 * Refund returns the entire red remainder with no fee; green is forfeited in full.
 */
export function refundCashFen({ faceFen, cashPaidFen, remainingFen, consumedCashFen = 0, hasIssuedInvoice }) {
  if (hasIssuedInvoice) return { ok: false, code: 'invoice_blocks_refund' };
  if (!(faceFen > 0) || cashPaidFen <= 0) return { ok: false, code: 'nothing_to_refund' };
  const redLeft = Math.max(0, cashPaidFen - consumedCashFen);
  if (redLeft <= 0) return { ok: false, code: 'red_exhausted' };
  const green = Math.max(0, remainingFen - redLeft);
  return { ok: true, faceFen, redLeftFen: redLeft, greenFen: green, netFen: redLeft, feeFen: 0 };
}
