-- Step load tests against one upstream model: settings per test, one row per request.
CREATE TABLE IF NOT EXISTS load_tests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 endpoint_id uuid NOT NULL REFERENCES supplier_lab_endpoints(id),
 profile text NOT NULL CHECK (profile IN ('short','chat','long')),
 steps integer[] NOT NULL,
 rounds integer NOT NULL CHECK (rounds BETWEEN 1 AND 3),
 budget_yuan numeric(10,4) NOT NULL,
 max_cost_yuan numeric(12,6) NOT NULL,
 status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','stopped','failed')),
 stop_reason text,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS load_tests_created_idx ON load_tests(created_at DESC);
CREATE TABLE IF NOT EXISTS load_samples(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 test_id uuid NOT NULL REFERENCES load_tests(id) ON DELETE CASCADE,
 step integer NOT NULL,
 ok boolean NOT NULL,
 http_status integer,
 error text,
 ttft_ms integer,
 total_ms integer,
 input_tokens integer,
 output_tokens integer,
 cost_yuan numeric(24,12),
 started_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS load_samples_test_idx ON load_samples(test_id,step);
