CREATE TABLE IF NOT EXISTS bank_transfer_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 submitted_by text NOT NULL, idempotency_key text NOT NULL,
 payer_name text NOT NULL, cash_fen bigint NOT NULL CHECK(cash_fen>0), paid_on date NOT NULL,
 payer_reference text NOT NULL, note text NOT NULL DEFAULT '', receiving_account jsonb NOT NULL,
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','registered','rejected')),
 entry_id uuid UNIQUE REFERENCES bank_transfer_entries(id), created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by text, reviewed_at timestamptz, review_note text NOT NULL DEFAULT '',
 UNIQUE(organization_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS bank_transfer_notices_org ON bank_transfer_notices(organization_id,created_at DESC);
ALTER TABLE bank_transfer_entries ADD COLUMN IF NOT EXISTS payer_name text NOT NULL DEFAULT '';
ALTER TABLE bank_transfer_entries ADD COLUMN IF NOT EXISTS receiving_account jsonb;
-- Legacy rows remain intact; new registrations reserve a normalized receiving-bank reference.
ALTER TABLE bank_transfer_entries ADD COLUMN IF NOT EXISTS reference_key text;
CREATE UNIQUE INDEX IF NOT EXISTS bank_transfer_reference_active ON bank_transfer_entries(reference_key) WHERE status IN ('pending','approved');
