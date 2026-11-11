-- A purchase key covers every model of its supplier; record the last real check of each key.
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS last_check_at timestamptz;
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS last_check_ok boolean;
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS last_check_status integer;
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS last_check_ms integer;
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS last_check_error text;
ALTER TABLE supplier_lab_credentials ADD COLUMN IF NOT EXISTS last_check_model text;
-- Give every live supplier key every live model of its supplier (idempotent).
INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,input_yuan_per_m,cached_input_yuan_per_m,output_yuan_per_m,created_by,supplier_id,credential_id,offer_id)
SELECT DISTINCT ON (c.id,e.model_id) e.label,e.kind,c.base_url,e.model_id,c.credential_fingerprint,e.input_yuan_per_m,e.cached_input_yuan_per_m,e.output_yuan_per_m,e.created_by,c.supplier_id,c.id,e.offer_id
FROM supplier_lab_credentials c JOIN supplier_lab_suppliers s ON s.id=c.supplier_id AND s.kind='supplier'
JOIN supplier_lab_endpoints e ON e.supplier_id=c.supplier_id AND e.disabled_at IS NULL AND e.credential_id IS NOT NULL
WHERE c.disabled_at IS NULL AND NOT EXISTS(SELECT 1 FROM supplier_lab_endpoints x WHERE x.credential_id=c.id AND x.model_id=e.model_id AND x.disabled_at IS NULL)
ORDER BY c.id,e.model_id,e.created_at DESC;
