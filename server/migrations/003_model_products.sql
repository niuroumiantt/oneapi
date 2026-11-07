CREATE TABLE IF NOT EXISTS model_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_code text NOT NULL UNIQUE CHECK(product_code ~ '^[a-z0-9][a-z0-9-]{2,49}$'),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100),
 summary text NOT NULL DEFAULT '' CHECK(length(summary) <= 500),
 region text NOT NULL CHECK(length(region) BETWEEN 2 AND 80),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewing','blocked')),
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS model_product_sources (
 product_id uuid NOT NULL REFERENCES model_products(id) ON DELETE CASCADE,
 offer_id uuid NOT NULL REFERENCES supplier_offers(id),
 PRIMARY KEY(product_id,offer_id)
);
CREATE INDEX IF NOT EXISTS model_product_sources_offer_idx ON model_product_sources(offer_id);
