-- Model catalog as an operational table (was a hardcoded array in official-models.mjs).
-- `listed` is the independent online/offline switch: it controls whether a model shows in
-- the public 模型广场 and is routable via /v1, and is decoupled from `verified` (detection passed).
CREATE TABLE IF NOT EXISTS model_catalog (
  id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  family text NOT NULL DEFAULT '' CHECK(length(family) <= 40),
  subtitle text NOT NULL DEFAULT '' CHECK(length(subtitle) <= 160),
  description text NOT NULL DEFAULT '' CHECK(length(description) <= 500),
  version text NOT NULL DEFAULT '' CHECK(length(version) <= 120),
  upstream text NOT NULL DEFAULT '' CHECK(length(upstream) <= 40),
  upstream_model text NOT NULL DEFAULT '' CHECK(length(upstream_model) <= 120),
  aliases text[] NOT NULL DEFAULT '{}',
  rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  peak_pricing boolean NOT NULL DEFAULT false,
  tags text[] NOT NULL DEFAULT '{}',
  uses text[] NOT NULL DEFAULT '{}',
  caps jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_source text NOT NULL DEFAULT '',
  verified boolean NOT NULL DEFAULT false,
  listed boolean NOT NULL DEFAULT false,
  detection_verdict text NOT NULL DEFAULT 'pending' CHECK(detection_verdict IN ('pending','ok','watch','suspect')),
  detected_at timestamptz,
  listed_at timestamptz,
  listed_by text REFERENCES staff_members(subject),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_catalog_listed_idx ON model_catalog(listed, family);
CREATE INDEX IF NOT EXISTS model_catalog_family_idx ON model_catalog(family);

-- Lightweight probe records: what a vendor /models endpoint returned on discovery.
CREATE TABLE IF NOT EXISTS model_catalog_probes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid REFERENCES supplier_lab_endpoints(id),
  discovered_model_ids text[] NOT NULL DEFAULT '{}',
  latency_ms integer,
  status text NOT NULL DEFAULT 'ok' CHECK(status IN ('ok','failed')),
  note text NOT NULL DEFAULT '' CHECK(length(note) <= 500),
  created_by text NOT NULL REFERENCES staff_members(subject),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_catalog_probes_recent_idx ON model_catalog_probes(created_at DESC);
