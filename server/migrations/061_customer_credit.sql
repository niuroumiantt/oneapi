-- Purchased credit is measured in fen with ten decimal places (yuan precision 1e-12).
ALTER TABLE billing_accounts ALTER COLUMN list_credit_fen TYPE numeric(30,10);
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS face_fen bigint;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS discount_snapshot jsonb NOT NULL DEFAULT '{}';
UPDATE payment_orders SET face_fen=amount_fen WHERE face_fen IS NULL;
CREATE OR REPLACE FUNCTION default_payment_face() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 NEW.face_fen := coalesce(NEW.face_fen,NEW.amount_fen); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS payment_face_default ON payment_orders;
CREATE TRIGGER payment_face_default BEFORE INSERT ON payment_orders FOR EACH ROW EXECUTE FUNCTION default_payment_face();
ALTER TABLE payment_orders ALTER COLUMN face_fen SET NOT NULL;
ALTER TABLE discount_grants ADD COLUMN IF NOT EXISTS promo_code text;
CREATE UNIQUE INDEX IF NOT EXISTS discount_promo_code ON discount_grants(upper(promo_code)) WHERE promo_code IS NOT NULL;
CREATE TABLE IF NOT EXISTS credit_packs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES billing_accounts(id),
 source_kind text NOT NULL CHECK(source_kind IN ('payment','bank')), source_id uuid NOT NULL,
 face_fen bigint NOT NULL CHECK(face_fen>0), cash_fen bigint NOT NULL CHECK(cash_fen>0 AND cash_fen<=face_fen),
 remaining_fen numeric(30,10) NOT NULL CHECK(remaining_fen>=0 AND remaining_fen<=face_fen),
 consumed_cash_fen bigint NOT NULL DEFAULT 0 CHECK(consumed_cash_fen>=0 AND consumed_cash_fen<=cash_fen),
 refund_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_kind,source_id)
);
-- Historical accounts with spent/refunded funds need explicit batch reconciliation, never recreate their full purchases.
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM (
   SELECT account_id,id,'payment' AS kind FROM payment_orders WHERE status='paid'
   UNION ALL SELECT account_id,id,'bank' FROM bank_transfer_entries WHERE status='approved'
  ) old WHERE NOT EXISTS(SELECT 1 FROM credit_packs p WHERE p.source_kind=old.kind AND p.source_id=old.id)
  AND EXISTS(SELECT 1 FROM billing_ledger l WHERE l.account_id=old.account_id AND l.kind IN ('usage','refund','reversal'))
 ) THEN RAISE EXCEPTION 'Historical paid balances require explicit credit-pack reconciliation before migration 061'; END IF;
END $$;
INSERT INTO credit_packs(account_id,source_kind,source_id,face_fen,cash_fen,remaining_fen)
 SELECT account_id,'payment',id,face_fen,amount_fen,face_fen FROM payment_orders WHERE status='paid' AND refunded_fen=0 ON CONFLICT DO NOTHING;
INSERT INTO credit_packs(account_id,source_kind,source_id,face_fen,cash_fen,remaining_fen)
 SELECT account_id,'bank',id,face_fen,cash_fen,face_fen FROM bank_transfer_entries WHERE status='approved' ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS customer_api_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES billing_accounts(id),
 owner_id text NOT NULL REFERENCES "user"(id),label text NOT NULL,secret_hash text NOT NULL UNIQUE,key_hint text NOT NULL,
 model_ids text[] NOT NULL,limit_yuan numeric(24,12) NOT NULL CHECK(limit_yuan>0),created_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS customer_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES billing_accounts(id),
 key_id uuid NOT NULL REFERENCES customer_api_keys(id),owner_id text NOT NULL REFERENCES "user"(id),
 model_id text NOT NULL,credential_id uuid REFERENCES supplier_lab_credentials(id),price_snapshot jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','awaiting_bill','settled','failed')),
 hold_yuan numeric(24,12) NOT NULL,actual_yuan numeric(24,12),charged_yuan numeric(24,12),
 upstream_request_id text,input_tokens bigint,cached_input_tokens bigint,output_tokens bigint,latency_ms integer,
 error_code text,error_detail text,settlement_source text,client text,gateway_instance uuid,
 created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS customer_calls_account ON customer_calls(account_id,created_at DESC);
CREATE INDEX IF NOT EXISTS customer_calls_open ON customer_calls(status) WHERE status IN ('pending','awaiting_bill');
CREATE TABLE IF NOT EXISTS credit_consumptions (
 call_id uuid NOT NULL REFERENCES customer_calls(id),pack_id uuid NOT NULL REFERENCES credit_packs(id),
 face_fen numeric(30,10) NOT NULL CHECK(face_fen>0),cash_fen bigint NOT NULL CHECK(cash_fen>=0),PRIMARY KEY(call_id,pack_id)
);
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS pack_id uuid REFERENCES credit_packs(id);
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS face_fen numeric(30,10);
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS gross_fen bigint;
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS fee_fen bigint;
CREATE TABLE IF NOT EXISTS credit_refund_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pack_id uuid NOT NULL REFERENCES credit_packs(id),
 requested_by text NOT NULL REFERENCES "user"(id),reason text NOT NULL,
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','processing','completed','rejected')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_refund_request_open ON credit_refund_requests(pack_id) WHERE status IN ('requested','processing');
