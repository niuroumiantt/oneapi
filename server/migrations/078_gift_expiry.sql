-- Gift credit (green) expires after 180 days; paid cash (red) never expires.
-- Owner decision 2026-11-24: consumption is always red-first, then green.
-- Gift expiry is per-pack, counting from the recharge (gift) day. Expired gift
-- vanishes entirely (does not occupy the progress bar); paid cash stays forever.
-- Refund window (30 days) is separate: cash stays after 30 days but can no longer
-- be refunded. These two rules are independent and do not overlap.

ALTER TABLE credit_packs ADD COLUMN IF NOT EXISTS gift_expires_at timestamptz;

COMMENT ON COLUMN credit_packs.gift_expires_at IS
 'When this pack''s gift (green = face_fen - cash_fen) credit expires, counted from the recharge day. Paid cash (red) never expires.';

-- Backfill historical packs: gift expires 180 days after the recharge.
UPDATE credit_packs
SET gift_expires_at = created_at + interval '180 days'
WHERE gift_expires_at IS NULL AND refund_id IS NULL;
