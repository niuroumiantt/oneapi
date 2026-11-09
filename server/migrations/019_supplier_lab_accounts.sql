CREATE TABLE IF NOT EXISTS supplier_lab_suppliers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 legal_name text NOT NULL DEFAULT '' CHECK(length(legal_name) <= 160),
 kind text NOT NULL CHECK(kind IN ('supplier','reference')),
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 disabled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_lab_suppliers_name_idx ON supplier_lab_suppliers(lower(name));

CREATE TABLE IF NOT EXISTS supplier_lab_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 supplier_id uuid NOT NULL REFERENCES supplier_lab_suppliers(id),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 100),
 base_url text NOT NULL CHECK(length(base_url) BETWEEN 12 AND 300),
 credential_ciphertext text NOT NULL,
 credential_fingerprint text NOT NULL,
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 disabled_at timestamptz,
 UNIQUE(supplier_id,label)
);
CREATE INDEX IF NOT EXISTS supplier_lab_credentials_supplier_idx ON supplier_lab_credentials(supplier_id,created_at DESC);

ALTER TABLE supplier_lab_endpoints ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES supplier_lab_suppliers(id);
ALTER TABLE supplier_lab_endpoints ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES supplier_lab_credentials(id);
ALTER TABLE supplier_lab_endpoints ALTER COLUMN credential_ciphertext DROP NOT NULL;
CREATE INDEX IF NOT EXISTS supplier_lab_endpoints_credential_idx ON supplier_lab_endpoints(credential_id,created_at DESC);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='supplier_lab_endpoint_credential_source') THEN ALTER TABLE supplier_lab_endpoints ADD CONSTRAINT supplier_lab_endpoint_credential_source CHECK (credential_id IS NOT NULL OR credential_ciphertext IS NOT NULL); END IF; END $$;

ALTER TABLE supplier_lab_discoveries ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES supplier_lab_credentials(id);
ALTER TABLE supplier_lab_discoveries ALTER COLUMN endpoint_id DROP NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='supplier_lab_discovery_source') THEN ALTER TABLE supplier_lab_discoveries ADD CONSTRAINT supplier_lab_discovery_source CHECK (credential_id IS NOT NULL OR endpoint_id IS NOT NULL); END IF; END $$;
