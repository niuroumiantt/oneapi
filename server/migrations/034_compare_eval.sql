-- Official-vs-supplier comparison: same questions to both sides, graded by rules, a blind third-model judge and staff spot checks.
CREATE TABLE IF NOT EXISTS compare_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 supplier_endpoint_id uuid NOT NULL REFERENCES supplier_lab_endpoints(id),
 reference_endpoint_id uuid NOT NULL REFERENCES supplier_lab_endpoints(id),
 judge_endpoint_id uuid REFERENCES supplier_lab_endpoints(id),
 case_ids text[] NOT NULL,
 thinking text NOT NULL DEFAULT 'off' CHECK (thinking IN ('off','on','default')),
 status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 CHECK (supplier_endpoint_id<>reference_endpoint_id)
);
CREATE INDEX IF NOT EXISTS compare_runs_created_idx ON compare_runs(created_at DESC);
CREATE TABLE IF NOT EXISTS compare_items(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES compare_runs(id) ON DELETE CASCADE,
 case_id text NOT NULL,
 supplier jsonb NOT NULL,
 reference jsonb NOT NULL,
 judge jsonb,
 blind_flip boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,case_id)
);
CREATE TABLE IF NOT EXISTS compare_reviews(
 item_id bigint NOT NULL REFERENCES compare_items(id) ON DELETE CASCADE,
 reviewer text NOT NULL,
 verdict text NOT NULL CHECK (verdict IN ('supplier','reference','tie')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(item_id,reviewer)
);
