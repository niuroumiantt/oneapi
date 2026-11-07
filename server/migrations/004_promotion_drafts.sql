CREATE TABLE IF NOT EXISTS promotion_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 model_product_id uuid NOT NULL REFERENCES model_products(id),
 region text NOT NULL DEFAULT 'CN' CHECK(region='CN'),
 currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
 customer_price_percent integer NOT NULL CHECK(customer_price_percent BETWEEN 1 AND 100),
 commission_percent integer NOT NULL CHECK(commission_percent BETWEEN 0 AND 30),
 total_discount_budget_fen bigint NOT NULL CHECK(total_discount_budget_fen BETWEEN 100 AND 100000000),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS promotion_campaigns_created_idx ON promotion_campaigns(created_at DESC);
