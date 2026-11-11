-- A key may be limited to some models (NULL means every model) and capped in yuan (NULL means no cap).
ALTER TABLE employee_api_keys ADD COLUMN IF NOT EXISTS model_ids text[] CHECK (model_ids IS NULL OR cardinality(model_ids) > 0);
ALTER TABLE employee_api_keys ADD COLUMN IF NOT EXISTS limit_yuan numeric(24,12) CHECK (limit_yuan IS NULL OR limit_yuan > 0);
