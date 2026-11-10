ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS replaces_credential_id uuid REFERENCES supplier_lab_credentials(id);
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS rotation_completed_at timestamptz;
CREATE INDEX IF NOT EXISTS supplier_lab_credentials_replacement_idx ON supplier_lab_credentials(replaces_credential_id);
