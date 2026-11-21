-- Red/green credit model (2026-11-21 owner decision).
-- A pack is bought at list face F and cash C. The progress bar is F wide:
--   green (gift) = F - C on the left, red (paid cash) = C on the right.
-- Consumption follows official list price and spends RED FIRST, then green.
-- Refund (online payment, self-service, no fee) returns only the remaining red:
--   refundable = C - consumed_cash_fen; the remaining green is forfeited in full and the pack closes.
-- Bank transfers stay manual through finance.

-- Record how much gift credit was clawed back on each refund (for audit / receipts).
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS bonus_fen numeric(30,10);

COMMENT ON COLUMN credit_packs.consumed_cash_fen IS 'Red already spent: cumulative official-price consumption capped at cash paid (red-first). Green = remaining_fen - (cash_fen - consumed_cash_fen).';
COMMENT ON COLUMN payment_refunds.bonus_fen IS 'Gift (green) credit forfeited when the pack was refunded; face_fen is the frozen remaining list credit, gross_fen the red cash refunded.';

-- Recompute active packs under the new red-first rule using their current remaining list credit.
-- Refunded packs are left untouched: their cash split is historical fact.
UPDATE credit_packs
SET consumed_cash_fen = LEAST(cash_fen, floor(face_fen - remaining_fen))::bigint
WHERE refund_id IS NULL;
