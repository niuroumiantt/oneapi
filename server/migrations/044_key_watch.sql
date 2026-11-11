-- Scheduled key watch: one row per run, and events that stay open while a run still sees them.
CREATE TABLE IF NOT EXISTS upstream_watch_runs(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 trigger text NOT NULL,
 started_at timestamptz NOT NULL,
 finished_at timestamptz,
 summary jsonb
);
CREATE INDEX IF NOT EXISTS upstream_watch_runs_started_idx ON upstream_watch_runs(started_at DESC);
CREATE TABLE IF NOT EXISTS upstream_watch_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 supplier_id uuid,
 kind text NOT NULL,
 subject text NOT NULL,
 level text NOT NULL CHECK (level IN ('info','warning','critical')),
 detail jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
 first_seen timestamptz NOT NULL DEFAULT now(),
 last_seen timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 notified_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS upstream_watch_events_open_idx ON upstream_watch_events(coalesce(supplier_id,'00000000-0000-0000-0000-000000000000'::uuid),kind,subject) WHERE status='open';
