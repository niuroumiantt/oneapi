CREATE TABLE IF NOT EXISTS supplier_usage_syncs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),credential_id uuid NOT NULL REFERENCES supplier_lab_credentials(id),
 record_count integer NOT NULL,response_sha256 text NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier_usage_records (
 credential_id uuid NOT NULL REFERENCES supplier_lab_credentials(id),request_id text NOT NULL,model_id text NOT NULL,
 occurred_at timestamptz NOT NULL,evidence jsonb NOT NULL,sync_id uuid NOT NULL REFERENCES supplier_usage_syncs(id),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(credential_id,request_id)
);
CREATE INDEX IF NOT EXISTS supplier_usage_recent ON supplier_usage_records(credential_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS supplier_usage_versions (
 credential_id uuid NOT NULL REFERENCES supplier_lab_credentials(id),request_id text NOT NULL,source_sha256 text NOT NULL,
 evidence jsonb NOT NULL,sync_id uuid NOT NULL REFERENCES supplier_usage_syncs(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(credential_id,request_id,source_sha256)
);
CREATE TABLE IF NOT EXISTS cloud_readonly_connections (
 provider text PRIMARY KEY CHECK(provider='aliyun'),region text NOT NULL,product text NOT NULL CHECK(product IN ('ecs','swas')),
 credential_ciphertext text NOT NULL,snapshot jsonb,updated_at timestamptz NOT NULL DEFAULT now()
);
