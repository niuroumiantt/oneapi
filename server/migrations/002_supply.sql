CREATE TABLE IF NOT EXISTS suppliers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 legal_name text NOT NULL CHECK(length(legal_name) BETWEEN 1 AND 160),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100),
 source_type text NOT NULL CHECK(source_type IN ('official','authorized_reseller','cloud_provider')),
 region text NOT NULL CHECK(length(region) BETWEEN 2 AND 80),
 contact_email text NOT NULL DEFAULT '',
 reference_url text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','reviewing','blocked')),
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppliers_status_idx ON suppliers(status,created_at DESC);
CREATE TABLE IF NOT EXISTS supplier_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 supplier_id uuid NOT NULL REFERENCES suppliers(id),
 model_name text NOT NULL CHECK(length(model_name) BETWEEN 1 AND 100),
 upstream_model_id text NOT NULL CHECK(length(upstream_model_id) BETWEEN 1 AND 120),
 protocol text NOT NULL CHECK(protocol IN ('openai_compatible','native','other')),
 region text NOT NULL CHECK(length(region) BETWEEN 2 AND 80),
 notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewing','blocked')),
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_offers_supplier_idx ON supplier_offers(supplier_id,created_at DESC);
CREATE TABLE IF NOT EXISTS supplier_offer_checks (
 offer_id uuid NOT NULL REFERENCES supplier_offers(id),
 check_key text NOT NULL CHECK(check_key IN ('source','sales_rights','model_version','protocol','data_region','usage_billing','capacity')),
 result text NOT NULL DEFAULT 'pending' CHECK(result IN ('pending','documented','issue')),
 evidence_url text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 checked_by text REFERENCES staff_members(subject),
 checked_at timestamptz,
 PRIMARY KEY(offer_id,check_key)
);
