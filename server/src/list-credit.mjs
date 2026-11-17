// Official list-price credit packs: metering uses face value; cash is paid at purchase.
// See docs/handoff/list-credit-billing.md.

/** Customer-facing refund copy (bills / invoices). */
export const REFUND_POLICY_ZH =
  '退款按实际付款金额，扣除已使用官价额度对应比例后，再收取 15% 服务费，退款金额四舍五入到分（特批减免另记）；已开具销项发票的不退款。';

/**
 * Cash to refund for one credit pack entry.
 * remainingFen / faceFen × cashPaidFen, then −15% fee.
 */
export function refundCashFen({ faceFen, cashPaidFen, remainingFen, hasIssuedInvoice }) {
  if (hasIssuedInvoice) return { ok: false, code: 'invoice_blocks_refund' };
  if (!(faceFen > 0) || remainingFen <= 0 || cashPaidFen <= 0) return { ok: false, code: 'nothing_to_refund' };
  const gross = Math.round(remainingFen * cashPaidFen / faceFen);
  const net = Math.round(remainingFen * cashPaidFen * 85 / (faceFen * 100));
  if (net <= 0) return { ok: false, code: 'fee_consumes_refund' };
  return { ok: true, grossFen: gross, feeFen: gross - net, netFen: net };
}
