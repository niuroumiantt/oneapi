CREATE TABLE IF NOT EXISTS supplier_lab_endpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 100),
 kind text NOT NULL CHECK(kind IN ('supplier','reference')),
 base_url text NOT NULL CHECK(length(base_url) BETWEEN 12 AND 300),
 model_id text NOT NULL CHECK(length(model_id) BETWEEN 1 AND 120),
 credential_ciphertext text NOT NULL,
 credential_fingerprint text NOT NULL,
 input_yuan_per_m numeric(18,6) CHECK(input_yuan_per_m >= 0),
 cached_input_yuan_per_m numeric(18,6) CHECK(cached_input_yuan_per_m >= 0),
 output_yuan_per_m numeric(18,6) CHECK(output_yuan_per_m >= 0),
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 disabled_at timestamptz
);
CREATE TABLE IF NOT EXISTS supplier_lab_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 supplier_endpoint_id uuid NOT NULL REFERENCES supplier_lab_endpoints(id),
 reference_endpoint_id uuid REFERENCES supplier_lab_endpoints(id),
 case_ids text[] NOT NULL,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')),
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS supplier_lab_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES supplier_lab_runs(id),
 endpoint_id uuid NOT NULL REFERENCES supplier_lab_endpoints(id),
 case_id text NOT NULL,
 prompt_sha256 text NOT NULL,
 response_sha256 text,
 output_sample text,
 http_status integer,
 error_code text,
 upstream_request_id text,
 latency_ms integer,
 input_tokens integer,
 cached_input_tokens integer,
 output_tokens integer,
 total_tokens integer,
 estimated_cost_yuan numeric(24,12),
 quality_score integer NOT NULL CHECK(quality_score BETWEEN 0 AND 100),
 checks jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_lab_transactions_recent_idx ON supplier_lab_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_lab_transactions_run_idx ON supplier_lab_transactions(run_id,case_id);
CREATE TABLE IF NOT EXISTS supplier_lab_reconciliations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 endpoint_id uuid NOT NULL REFERENCES supplier_lab_endpoints(id),
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL CHECK(period_end > period_start),
 supplier_billed_yuan numeric(18,8) NOT NULL CHECK(supplier_billed_yuan >= 0),
 observed_cost_yuan numeric(24,12) NOT NULL,
 difference_yuan numeric(24,12) NOT NULL,
 note text NOT NULL DEFAULT '' CHECK(length(note) <= 500),
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_lab_discoveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 endpoint_id uuid NOT NULL REFERENCES supplier_lab_endpoints(id),
 http_status integer,
 error_code text,
 latency_ms integer NOT NULL,
 model_ids text[] NOT NULL DEFAULT '{}',
 response_sha256 text,
 upstream_request_id text,
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_lab_discoveries_recent_idx ON supplier_lab_discoveries(created_at DESC);
