-- 功能对比: the same feature probes sent to the official API and to ours; one item per model x feature per run.
CREATE TABLE IF NOT EXISTS feature_compare_runs(
 id uuid PRIMARY KEY,
 status text NOT NULL CHECK (status IN ('running','completed','failed')),
 models text[] NOT NULL,
 skip_long boolean NOT NULL DEFAULT false,
 total integer NOT NULL,
 done integer NOT NULL DEFAULT 0,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS feature_compare_items(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES feature_compare_runs(id) ON DELETE CASCADE,
 our_model text NOT NULL,
 reference_endpoint_id uuid REFERENCES supplier_lab_endpoints(id),
 reference_model text NOT NULL,
 feature text NOT NULL,
 ours jsonb NOT NULL,
 official jsonb NOT NULL,
 outcome text NOT NULL CHECK (outcome IN ('same','gap','extra','neither','pending')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,our_model,feature)
);
CREATE INDEX IF NOT EXISTS feature_compare_items_latest_idx ON feature_compare_items(our_model,feature,created_at DESC);
-- Which official model each of our models is compared with, when staff override the default match.
CREATE TABLE IF NOT EXISTS feature_compare_pairs(
 our_model text PRIMARY KEY,
 reference_endpoint_id uuid NOT NULL REFERENCES supplier_lab_endpoints(id),
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
