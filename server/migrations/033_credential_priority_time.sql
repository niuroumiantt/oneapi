-- When a key last became primary, standby or automatic; shown on the key card.
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS priority_changed_at timestamptz;
