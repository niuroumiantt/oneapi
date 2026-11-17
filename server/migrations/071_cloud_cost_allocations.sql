CREATE TABLE IF NOT EXISTS cloud_cost_allocations (
 provider text NOT NULL CHECK (provider='aliyun'),
 resource_id text NOT NULL, product_code text NOT NULL, billing_item_code text NOT NULL,
 owner_id text NOT NULL, period text NOT NULL, rule jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,resource_id,product_code,billing_item_code,owner_id,period)
);
