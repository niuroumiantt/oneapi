-- Comparison uses the ordinary employee gateway and its existing allocated-credit ledger.
ALTER TABLE employee_api_keys ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'api' CHECK(purpose IN ('api','compare'));
ALTER TABLE employee_api_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS employee_compare_key_expiry ON employee_api_keys(expires_at) WHERE purpose='compare' AND revoked_at IS NULL;
