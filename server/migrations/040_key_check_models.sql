-- Per-model result of the last key check: [{model, ok, status, ms, error}].
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS last_check_models jsonb;
