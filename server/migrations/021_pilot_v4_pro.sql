-- Existing pilot keys remain Flash-only; each new key is bound to one model.
ALTER TABLE pilot_api_keys
 ADD COLUMN IF NOT EXISTS model_id text;
UPDATE pilot_api_keys SET model_id='deepseek-flash' WHERE model_id IS NULL;
ALTER TABLE pilot_api_keys ALTER COLUMN model_id SET NOT NULL;
ALTER TABLE pilot_api_keys ALTER COLUMN model_id DROP DEFAULT;
ALTER TABLE pilot_api_keys DROP CONSTRAINT IF EXISTS pilot_api_keys_model_id_check;
ALTER TABLE pilot_api_keys ADD CONSTRAINT pilot_api_keys_model_id_check
 CHECK(model_id IN ('deepseek-flash','deepseek-v4-pro'));
ALTER TABLE pilot_calls DROP CONSTRAINT IF EXISTS pilot_calls_model_id_check;
ALTER TABLE pilot_calls ADD CONSTRAINT pilot_calls_model_id_check
 CHECK(model_id IN ('deepseek-flash','deepseek-v4-pro'));
