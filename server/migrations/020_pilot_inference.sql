-- A limited, owner-only real-call pilot. It is separate from the cash ledger.
CREATE TABLE IF NOT EXISTS pilot_api_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text NOT NULL REFERENCES "user"(id),
 label text NOT NULL,
 secret_hash text NOT NULL UNIQUE,
 key_hint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS pilot_api_keys_owner_idx ON pilot_api_keys(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS pilot_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 key_id uuid NOT NULL REFERENCES pilot_api_keys(id),
 owner_id text NOT NULL REFERENCES "user"(id),
 model_id text NOT NULL CHECK(model_id='deepseek-flash'),
 status text NOT NULL CHECK(status IN ('pending','succeeded','failed')),
 input_tokens integer,
 cache_hit_tokens integer,
 output_tokens integer,
 estimated_upstream_yuan numeric(14,8),
 upstream_request_id text,
 latency_ms integer,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS pilot_calls_owner_time_idx ON pilot_calls(owner_id,created_at DESC);
