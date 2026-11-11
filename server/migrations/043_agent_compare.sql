-- Agent 对比: one run = one agent, path a (our route) vs path b (official via a test key, or the built-in model pasted by hand).
CREATE TABLE IF NOT EXISTS agent_compare_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
 name text NOT NULL,
 judge_endpoint_id uuid REFERENCES supplier_lab_endpoints(id),
 path_a jsonb NOT NULL,
 path_b jsonb NOT NULL,
 task_ids text[] NOT NULL,
 custom_tasks jsonb NOT NULL DEFAULT '[]',
 armed_path text CHECK (armed_path IN ('a','b')),
 armed_task text,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz
);
-- Staff test keys on the gateway: no employee billing, full transcript capture, revoked when the run closes.
CREATE TABLE IF NOT EXISTS eval_gateway_keys(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES agent_compare_runs(id) ON DELETE CASCADE,
 path text NOT NULL CHECK (path IN ('a','b')),
 label text NOT NULL,
 secret_hash text NOT NULL UNIQUE,
 key_hint text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('ours','official')),
 credential_id uuid REFERENCES supplier_lab_credentials(id),
 reference_endpoint_id uuid REFERENCES supplier_lab_endpoints(id),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS agent_compare_calls(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES agent_compare_runs(id) ON DELETE CASCADE,
 path text NOT NULL,
 task_id text,
 key_id uuid REFERENCES eval_gateway_keys(id) ON DELETE SET NULL,
 model_id text NOT NULL,
 upstream_model text,
 request jsonb NOT NULL,
 content text NOT NULL DEFAULT '',
 reasoning_chars integer NOT NULL DEFAULT 0,
 tool_calls integer NOT NULL DEFAULT 0,
 usage jsonb,
 latency_ms integer,
 http_status integer,
 error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_compare_calls_task_idx ON agent_compare_calls(run_id,path,task_id,created_at);
CREATE TABLE IF NOT EXISTS agent_compare_items(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES agent_compare_runs(id) ON DELETE CASCADE,
 task_id text NOT NULL,
 a jsonb,
 b jsonb,
 judge jsonb,
 blind_flip boolean NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,task_id)
);
CREATE TABLE IF NOT EXISTS agent_compare_reviews(
 item_id bigint NOT NULL REFERENCES agent_compare_items(id) ON DELETE CASCADE,
 reviewer text NOT NULL,
 verdict text NOT NULL CHECK (verdict IN ('a','b','tie')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(item_id,reviewer)
);
