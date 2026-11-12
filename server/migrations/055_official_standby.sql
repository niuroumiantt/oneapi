-- Gateway decision 2026-11-12 (docs/14-gateway-settings.md F5): an official DeepSeek / Zhipu key may back up KerAPI for
-- employee traffic. It is a key of its own, never the evaluation key: purpose separates the two on the same official
-- supplier, and standby_models maps each of our models to the official model id staff confirmed for it.
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'default' CHECK (purpose IN ('default','gateway_standby'));
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS standby_models jsonb;
-- A call served by an official standby line that ended without usage (the caller hung up mid-stream) cannot be checked
-- against KerAPI's log, so it is settled free (owner decision 2026-11-12, as for KerAPI calls it did not charge).
ALTER TABLE employee_calls DROP CONSTRAINT IF EXISTS employee_calls_settlement_source_check;
ALTER TABLE employee_calls ADD CONSTRAINT employee_calls_settlement_source_check CHECK(settlement_source IN ('supplier_log','hold_fallback','official_price','supplier_tokens','supplier_free','official_unmetered'));
