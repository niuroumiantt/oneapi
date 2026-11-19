-- Direct sales commission only. Invitations never grant financial entitlement.
CREATE TABLE IF NOT EXISTS cw_partners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL UNIQUE REFERENCES "user"(id),
 public_code text NOT NULL UNIQUE CHECK(public_code ~ '^[A-HJ-NP-Z]{8}$'),
 invited_by uuid REFERENCES cw_partners(id), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended','rejected')),
 legal_name text NOT NULL, contact_cipher text NOT NULL, consent_version text NOT NULL,
 bank_cipher text, bank_last4 text, bank_version int NOT NULL DEFAULT 0, bank_verified_version int,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(invited_by IS DISTINCT FROM id)
);
CREATE TABLE IF NOT EXISTS cw_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES cw_partners(id),
 template_version text NOT NULL, document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[a-f0-9]{64}$'),
 signature_reference text NOT NULL, identity_reference text NOT NULL, expires_at timestamptz NOT NULL,
 verified_by text NOT NULL REFERENCES staff_members(subject), verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cw_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES cw_partners(id),
 code text NOT NULL UNIQUE CHECK(code ~ '^[A-HJ-NP-Z]{8}$'), name text NOT NULL,
 customer_price_percent int NOT NULL DEFAULT 50 CHECK(customer_price_percent BETWEEN 1 AND 100),
 commission_bps int NOT NULL DEFAULT 1000 CHECK(commission_bps=1000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','paused','rejected')),
 starts_at timestamptz, ends_at timestamptz, approved_by text REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at IS NULL OR ends_at>starts_at)
);
CREATE TABLE IF NOT EXISTS cw_commissions (
 order_id uuid PRIMARY KEY REFERENCES payment_orders(id), pack_id uuid NOT NULL UNIQUE REFERENCES credit_packs(id),
 partner_id uuid NOT NULL REFERENCES cw_partners(id), code_id uuid NOT NULL REFERENCES cw_codes(id),
 public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), cash_fen bigint NOT NULL CHECK(cash_fen>0),
 rate_bps int NOT NULL CHECK(rate_bps=1000), expected_fen bigint NOT NULL CHECK(expected_fen>=0),
 used_cash_fen bigint NOT NULL DEFAULT 0, unlocked_fen bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(unlocked_fen>=0 AND unlocked_fen<=expected_fen)
);
CREATE TABLE IF NOT EXISTS cw_commission_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES cw_commissions(order_id),
 event_key text NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN ('paid','used','refund')),
 cash_fen bigint NOT NULL DEFAULT 0, commission_fen bigint NOT NULL DEFAULT 0, occurred_at timestamptz NOT NULL DEFAULT now()
);
-- Customer-month close is explicit; reaching month end alone releases no money.
CREATE TABLE IF NOT EXISTS cw_customer_closes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES billing_accounts(id),
 month text NOT NULL CHECK(month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'), evidence text NOT NULL,
 closed_by text NOT NULL REFERENCES staff_members(subject), closed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id,month)
);
CREATE TABLE IF NOT EXISTS cw_payouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES cw_partners(id),
 request_key uuid NOT NULL, gross_fen bigint NOT NULL CHECK(gross_fen>0), withholding_fen bigint NOT NULL DEFAULT 0,
 bank_version int NOT NULL, bank_cipher text NOT NULL, bank_last4 text NOT NULL,
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','paid','rejected','failed')),
 reviewed_by text REFERENCES staff_members(subject), payment_reference text UNIQUE, evidence text,
 created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz,
 UNIQUE(partner_id,request_key), CHECK(withholding_fen>=0 AND withholding_fen<gross_fen)
);
CREATE TABLE IF NOT EXISTS cw_payout_items (
 event_id uuid NOT NULL REFERENCES cw_commission_events(id), payout_id uuid NOT NULL REFERENCES cw_payouts(id),
 released_at timestamptz, PRIMARY KEY(event_id,payout_id)
);
CREATE INDEX IF NOT EXISTS cw_commissions_partner ON cw_commissions(partner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS cw_events_order ON cw_commission_events(order_id,occurred_at);
CREATE INDEX IF NOT EXISTS cw_codes_partner ON cw_codes(partner_id);

CREATE UNIQUE INDEX IF NOT EXISTS cw_payout_event_reserved ON cw_payout_items(event_id) WHERE released_at IS NULL;
