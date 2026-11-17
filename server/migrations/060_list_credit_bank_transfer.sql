-- List-price credit packs (docs/handoff/list-credit-billing.md): metering currency is
-- list_credit_fen; cash_balance_fen is what was paid (revenue / invoice / refund base).
-- Historical 1:1 recharges: remaining list credit matches remaining cash.
ALTER TABLE billing_accounts
  ADD COLUMN IF NOT EXISTS list_credit_fen bigint NOT NULL DEFAULT 0 CHECK (list_credit_fen >= 0);

UPDATE billing_accounts SET list_credit_fen = cash_balance_fen
 WHERE list_credit_fen = 0 AND cash_balance_fen > 0 AND to_regclass('public.credit_packs') IS NULL;

-- Dual-approval corporate bank transfer intake: register (pending) then a second person approves.
CREATE TABLE IF NOT EXISTS bank_transfer_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  account_id uuid NOT NULL REFERENCES billing_accounts(id),
  cash_fen bigint NOT NULL CHECK (cash_fen > 0),
  face_fen bigint NOT NULL CHECK (face_fen > 0),
  received_on date NOT NULL,
  reference text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '',
  CHECK (face_fen >= cash_fen),
  CHECK (status = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (decided_by IS NULL OR decided_by <> created_by)
);
CREATE INDEX IF NOT EXISTS bank_transfer_entries_status_idx ON bank_transfer_entries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS bank_transfer_entries_customer_idx ON bank_transfer_entries (customer_id, created_at DESC);
