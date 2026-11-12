-- 身份检测: is the model behind our API the official model, at full strength? One run checks several models;
-- each item is one probe on one model, with the official reply (twice for the similarity probes) and ours.
CREATE TABLE IF NOT EXISTS identity_check_runs(
 id uuid PRIMARY KEY,
 status text NOT NULL CHECK (status IN ('running','completed','failed')),
 models text[] NOT NULL,
 sections text[] NOT NULL,
 total integer NOT NULL,
 done integer NOT NULL DEFAULT 0,
 summary jsonb,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS identity_check_runs_created_idx ON identity_check_runs(created_at DESC);
CREATE TABLE IF NOT EXISTS identity_check_items(
 run_id uuid NOT NULL REFERENCES identity_check_runs(id) ON DELETE CASCADE,
 our_model text NOT NULL,
 reference_model text NOT NULL,
 probe text NOT NULL,
 official jsonb,
 official2 jsonb,
 ours jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,our_model,probe)
);
-- A run left 'running' by a restart can never finish.
UPDATE identity_check_runs SET status='failed',finished_at=now() WHERE status='running';
