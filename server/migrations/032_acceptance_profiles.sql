-- Request formats seen per tool (structure only, never conversation text) and replay results per model.
CREATE TABLE IF NOT EXISTS acceptance_profiles(
 signature text PRIMARY KEY,
 client text NOT NULL,
 client_detail text,
 features text[] NOT NULL,
 shape jsonb NOT NULL,
 synthetic boolean NOT NULL DEFAULT false,
 seen_count integer NOT NULL DEFAULT 0,
 rejected_count integer NOT NULL DEFAULT 0,
 last_error text,
 first_seen timestamptz NOT NULL DEFAULT now(),
 last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS acceptance_results(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id uuid NOT NULL,
 signature text NOT NULL REFERENCES acceptance_profiles(signature) ON DELETE CASCADE,
 model_id text NOT NULL,
 status text NOT NULL CHECK (status IN ('pass','partial','fail')),
 http_status integer,
 latency_ms integer,
 note text,
 excerpt text,
 usage jsonb,
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acceptance_results_latest_idx ON acceptance_results(signature,model_id,created_at DESC);
ALTER TABLE employee_calls ADD COLUMN IF NOT EXISTS profile_signature text;
CREATE INDEX IF NOT EXISTS employee_calls_profile_idx ON employee_calls(profile_signature,created_at DESC) WHERE profile_signature IS NOT NULL;
