-- Employees are charged official list prices at completion; DeepSeek V4 Pro has no supplier-lab credential.
ALTER TABLE employee_calls ALTER COLUMN credential_id DROP NOT NULL;
ALTER TABLE employee_calls ADD COLUMN IF NOT EXISTS upstream text;
ALTER TABLE employee_calls ADD COLUMN IF NOT EXISTS price_snapshot jsonb;
ALTER TABLE employee_calls DROP CONSTRAINT IF EXISTS employee_calls_settlement_source_check;
ALTER TABLE employee_calls ADD CONSTRAINT employee_calls_settlement_source_check CHECK(settlement_source IN ('supplier_log','hold_fallback','official_price'));
