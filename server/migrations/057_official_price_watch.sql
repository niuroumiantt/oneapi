-- Official vendor pricing observation (docs/14-gateway-settings.md H3 / item 9).
-- Snapshots only: never writes back to official-models.mjs.
CREATE TABLE IF NOT EXISTS official_price_watch_runs (
  id bigserial PRIMARY KEY,
  trigger text NOT NULL CHECK (trigger IN ('schedule','manual')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS official_price_watch_runs_started ON official_price_watch_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS official_price_watch_sources (
  source_id text PRIMARY KEY,
  url text NOT NULL,
  http_status integer,
  fingerprint text,
  fetched_at timestamptz,
  peak_note text,
  parsed jsonb NOT NULL DEFAULT '{}'::jsonb,
  comparisons jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'unknown',
  error text,
  last_run_id bigint REFERENCES official_price_watch_runs(id)
);
