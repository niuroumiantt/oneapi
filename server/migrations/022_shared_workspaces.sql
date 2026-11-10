-- Additive bridge: retain historical laboratory identities and all credentials.
CREATE TABLE IF NOT EXISTS staff_technical_access (
 subject text PRIMARY KEY REFERENCES staff_members(subject),
 granted_by text NOT NULL REFERENCES staff_members(subject),
 granted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE supplier_lab_suppliers ADD COLUMN IF NOT EXISTS canonical_supplier_id uuid REFERENCES suppliers(id);
INSERT INTO suppliers(id,legal_name,display_name,source_type,region,created_by,notes)
 SELECT id,coalesce(nullif(legal_name,''),'主体待确认'),name,'unconfirmed','待确认',created_by,'从历史验收档案迁入；来源、主体与服务地区待业务核实'
 FROM supplier_lab_suppliers WHERE canonical_supplier_id IS NULL
 ON CONFLICT(id) DO NOTHING;
UPDATE supplier_lab_suppliers SET canonical_supplier_id=id WHERE canonical_supplier_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lab_canonical_supplier_idx ON supplier_lab_suppliers(canonical_supplier_id);
ALTER TABLE supplier_lab_endpoints ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES supplier_offers(id);
ALTER TABLE supplier_validation_runs ADD COLUMN IF NOT EXISTS lab_run_id uuid REFERENCES supplier_lab_runs(id);
ALTER TABLE supplier_validation_runs ADD COLUMN IF NOT EXISTS lab_endpoint_id uuid REFERENCES supplier_lab_endpoints(id);
ALTER TABLE supplier_validation_runs ADD COLUMN IF NOT EXISTS reconciliation_id uuid REFERENCES supplier_lab_reconciliations(id);
CREATE UNIQUE INDEX IF NOT EXISTS validation_lab_source_idx ON supplier_validation_runs(lab_run_id,lab_endpoint_id) WHERE lab_run_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS model_listing_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES model_products(id),
 snapshot text NOT NULL, status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','published','withdrawn')),
 requested_by text NOT NULL REFERENCES staff_members(subject), created_at timestamptz NOT NULL DEFAULT now(),
 published_by text REFERENCES staff_members(subject), published_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS listing_active_product_idx ON model_listing_requests(product_id) WHERE status IN ('requested','published');
