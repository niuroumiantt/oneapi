// Official list-price credit packs: metering uses face value; cash is paid at purchase.
// See docs/handoff/list-credit-billing.md.

/** Customer-facing policy copy: refunds and invoices are two sides of the same paid cash. */
export const REFUND_POLICY_ZH =
  '客户按官网价额度使用；进度条左侧绿色为赠送、右侧红色为实付，用量先扣红色再扣绿色。退款随时可申请、无手续费，只退红色实付剩余；绿色赠送额度是因付款而赠，退款时整条收回，该额度包关闭。已申请或已开具发票的账户不可退款，需先作废或红冲发票。对公转账退款由财务人工处理。';

/** Invoice policy. Recharge is invoiceable at the price actually paid; refund and invoice never overlap. */
export const INVOICE_POLICY_ZH =
  '充值即可按实际付款金额申请开票，与折扣、官价面额无关；开票后该账户不可再退款。未开票时可随时申请退红条实付剩余，退款后已消耗的那部分实付仍可开票。可开票金额 = 累计实付 − 已退款 − 已申请/已开具发票；付款后 30 天内均可申请开票。';

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
