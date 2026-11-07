-- Internal product profiles. Publication remains gated and is not enabled here.
ALTER TABLE model_products ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'supplier' CHECK(source_kind IN ('supplier','owned_service'));
ALTER TABLE model_products ADD COLUMN IF NOT EXISTS brand text NOT NULL DEFAULT '' CHECK(length(brand)<=80);
ALTER TABLE model_products ADD COLUMN IF NOT EXISTS family text NOT NULL DEFAULT '' CHECK(length(family)<=80);
ALTER TABLE model_products ADD COLUMN IF NOT EXISTS version_label text NOT NULL DEFAULT '' CHECK(length(version_label)<=80);
ALTER TABLE model_products ADD COLUMN IF NOT EXISTS use_cases text NOT NULL DEFAULT '' CHECK(length(use_cases)<=500);
ALTER TABLE model_products ADD COLUMN IF NOT EXISTS service_limits text NOT NULL DEFAULT '' CHECK(length(service_limits)<=500);
ALTER TABLE model_products ADD COLUMN IF NOT EXISTS capability_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE model_products ADD COLUMN IF NOT EXISTS context_window_tokens integer CHECK(context_window_tokens>0);
ALTER TABLE model_products ADD COLUMN IF NOT EXISTS max_output_tokens integer CHECK(max_output_tokens>0);
ALTER TABLE model_products ADD COLUMN IF NOT EXISTS source_description text NOT NULL DEFAULT '' CHECK(length(source_description)<=500);
ALTER TABLE model_products ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;
