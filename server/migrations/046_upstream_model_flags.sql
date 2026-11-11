-- Behaviour flags on upstream models found by the key watch, e.g. ignores_max_tokens (the gateway's output guard then enforces the limit).
CREATE TABLE IF NOT EXISTS upstream_model_flags(
 model_id text NOT NULL,
 flag text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}',
 since timestamptz NOT NULL DEFAULT now(),
 last_seen timestamptz NOT NULL DEFAULT now(),
 cleared_at timestamptz,
 PRIMARY KEY(model_id,flag)
);
