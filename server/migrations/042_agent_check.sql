-- Agent 检测: agents by version, recording sessions on an employee key, the request forms recorded per feature, and replay results.
CREATE TABLE IF NOT EXISTS agents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL,
 version text NOT NULL,
 notes text NOT NULL DEFAULT '',
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(name,version)
);
CREATE TABLE IF NOT EXISTS agent_sessions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
 key_id uuid NOT NULL REFERENCES employee_api_keys(id),
 armed_feature text,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS agent_sessions_open_idx ON agent_sessions(key_id) WHERE status='open';
-- signature points at acceptance_profiles, written asynchronously by the same request, so no FK.
CREATE TABLE IF NOT EXISTS agent_recordings(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
 session_id uuid REFERENCES agent_sessions(id) ON DELETE SET NULL,
 feature text NOT NULL,
 signature text NOT NULL,
 client text,
 client_detail text,
 count integer NOT NULL DEFAULT 1,
 rejected boolean NOT NULL DEFAULT false,
 last_error text,
 captured_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agent_id,feature,signature)
);
CREATE TABLE IF NOT EXISTS agent_replays(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
 feature text NOT NULL,
 signature text NOT NULL,
 target text NOT NULL,
 target_label text NOT NULL,
 model_id text NOT NULL,
 status text NOT NULL CHECK (status IN ('pass','partial','fail')),
 http_status integer,
 latency_ms integer,
 note text,
 excerpt text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_replays_latest_idx ON agent_replays(agent_id,feature,signature,target,created_at DESC);
