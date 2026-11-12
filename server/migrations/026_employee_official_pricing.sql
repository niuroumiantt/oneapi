-- Employees are charged official list prices at completion; DeepSeek V4 Pro has no supplier-lab credential.
ALTER TABLE employee_calls ALTER COLUMN credential_id DROP NOT NULL;
ALTER TABLE employee_calls ADD COLUMN IF NOT EXISTS upstream text;
ALTER TABLE employee_calls ADD COLUMN IF NOT EXISTS price_snapshot jsonb;
-- Every file re-runs on each start: only widen an older CHECK, never replace a newer one (052, 055 add later values).
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='employee_calls'::regclass AND conname='employee_calls_settlement_source_check' AND pg_get_constraintdef(oid) LIKE '%official_price%') THEN
 ALTER TABLE employee_calls DROP CONSTRAINT IF EXISTS employee_calls_settlement_source_check;
 ALTER TABLE employee_calls ADD CONSTRAINT employee_calls_settlement_source_check CHECK(settlement_source IN ('supplier_log','hold_fallback','official_price'));
END IF; END $$;
