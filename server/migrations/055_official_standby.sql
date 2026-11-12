-- Gateway decision 2026-11-12 (docs/14-gateway-settings.md F5): an official DeepSeek / Zhipu key may back up KerAPI for
-- employee traffic. It is a key of its own, never the evaluation key: purpose separates the two on the same official
-- supplier, and standby_models maps each of our models to the official model id staff confirmed for it.
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'default' CHECK (purpose IN ('default','gateway_standby'));
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS standby_models jsonb;
-- A call served by an official standby line that ended without usage (the caller hung up mid-stream) cannot be checked
-- against KerAPI's log, so it is settled free (owner decision 2026-11-12, as for KerAPI calls it did not charge).
-- Every file re-runs on each start: only widen an older CHECK. A later migration that adds a value must guard the same way.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='employee_calls'::regclass AND conname='employee_calls_settlement_source_check' AND pg_get_constraintdef(oid) LIKE '%official_unmetered%') THEN
 ALTER TABLE employee_calls DROP CONSTRAINT IF EXISTS employee_calls_settlement_source_check;
 ALTER TABLE employee_calls ADD CONSTRAINT employee_calls_settlement_source_check CHECK(settlement_source IN ('supplier_log','hold_fallback','official_price','supplier_tokens','supplier_free','official_unmetered'));
END IF; END $$;
