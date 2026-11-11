-- Upstream key order per model: 1 primary, 2 standby, 100 automatic (newest first).
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 100);
