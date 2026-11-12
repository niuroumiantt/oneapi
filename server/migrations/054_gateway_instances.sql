-- Which gateway process opened each call (docs/14-gateway-settings.md C4, D6).
-- A process writes seen_at every 10 seconds while it runs. Calls opened by a process that stopped writing it
-- (deploy restart, crash) are released by the next process within about 40 seconds instead of holding
-- the caller's concurrency slot and hold for 20 minutes.
CREATE TABLE IF NOT EXISTS gateway_instances(
 id uuid PRIMARY KEY,
 host text,
 started_at timestamptz NOT NULL DEFAULT now(),
 seen_at timestamptz NOT NULL DEFAULT now(),
 stopped_at timestamptz
);
ALTER TABLE employee_calls ADD COLUMN IF NOT EXISTS gateway_instance uuid;
CREATE INDEX IF NOT EXISTS employee_calls_open_by_instance ON employee_calls(gateway_instance) WHERE status='pending';
