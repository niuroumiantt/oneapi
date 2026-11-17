-- Server-only comparison credentials retain the normal paid gateway/ledger path.
-- They are never returned to the browser, expire after five minutes, and are revoked after each run.
ALTER TABLE customer_api_keys ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'api' CHECK(purpose IN ('api','compare'));
ALTER TABLE customer_api_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS customer_compare_key_expiry ON customer_api_keys(expires_at) WHERE purpose='compare' AND revoked_at IS NULL;
