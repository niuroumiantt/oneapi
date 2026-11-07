-- Real-money account foundation. No route can credit these accounts before a verified merchant integration.
CREATE TABLE IF NOT EXISTS billing_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text REFERENCES "user"(id),
 organization_id uuid REFERENCES organizations(id),
 currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
 cash_balance_fen bigint NOT NULL DEFAULT 0 CHECK(cash_balance_fen>=0),
 total_spent_fen bigint NOT NULL DEFAULT 0 CHECK(total_spent_fen>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((owner_id IS NOT NULL) <> (organization_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_accounts_owner_idx ON billing_accounts(owner_id) WHERE owner_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_accounts_org_idx ON billing_accounts(organization_id) WHERE organization_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS billing_ledger (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES billing_accounts(id),
 kind text NOT NULL CHECK(kind IN ('recharge','usage','refund','reversal')),
 amount_fen bigint NOT NULL CHECK(amount_fen<>0),
 balance_after_fen bigint NOT NULL CHECK(balance_after_fen>=0),
 reference_kind text NOT NULL CHECK(reference_kind IN ('payment','usage','refund','correction')),
 reference_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,reference_kind,reference_id),
 CHECK ((kind='recharge' AND amount_fen>0 AND reference_kind='payment') OR
        (kind='usage' AND amount_fen<0 AND reference_kind='usage') OR
        (kind='refund' AND amount_fen<0 AND reference_kind='refund') OR
        (kind='reversal' AND reference_kind='correction'))
);
CREATE INDEX IF NOT EXISTS billing_ledger_account_idx ON billing_ledger(account_id,id DESC);
CREATE OR REPLACE FUNCTION reject_billing_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'billing ledger entries are append-only';
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='billing_ledger_append_only') THEN
  CREATE TRIGGER billing_ledger_append_only BEFORE UPDATE OR DELETE ON billing_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_billing_ledger_change();
 END IF;
END $$;
