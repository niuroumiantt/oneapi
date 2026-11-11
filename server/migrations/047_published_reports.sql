-- Snapshots published to the public site, e.g. the #realtesting report (verdicts and short notes only).
CREATE TABLE IF NOT EXISTS published_reports(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind text NOT NULL,
 run_id uuid,
 data jsonb NOT NULL,
 published_by text NOT NULL,
 published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS published_reports_latest_idx ON published_reports(kind,published_at DESC);
