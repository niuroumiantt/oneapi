ALTER TABLE suppliers
 ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'unconfirmed',
 ADD COLUMN IF NOT EXISTS owner_subject text REFERENCES staff_members(subject),
 ADD COLUMN IF NOT EXISTS next_action text NOT NULL DEFAULT '';

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_service_type_check;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_service_type_check
 CHECK(service_type IN ('unconfirmed','model_api','managed_inference','gpu_rental','software_optimization','other'));

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_source_type_check;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_source_type_check
 CHECK(source_type IN ('unconfirmed','official','authorized_reseller','cloud_provider'));

UPDATE suppliers SET owner_subject=created_by WHERE owner_subject IS NULL;
