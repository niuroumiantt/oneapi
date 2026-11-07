CREATE TABLE IF NOT EXISTS model_product_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 model_product_id uuid NOT NULL REFERENCES model_products(id),
 offer_id uuid NOT NULL REFERENCES supplier_offers(id),
 validation_run_id uuid NOT NULL REFERENCES supplier_validation_runs(id),
 price_proposal_id uuid NOT NULL REFERENCES model_price_proposals(id),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','changes_requested','internally_reviewed')),
 request_notes text NOT NULL DEFAULT '' CHECK(length(request_notes) <= 1000),
 reviewer_notes text NOT NULL DEFAULT '' CHECK(length(reviewer_notes) <= 1000),
 requested_by text NOT NULL REFERENCES staff_members(subject),
 reviewed_by text REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 CHECK ((status='requested' AND reviewed_by IS NULL AND decided_at IS NULL) OR
        (status<>'requested' AND reviewed_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS model_product_reviews_one_requested_idx ON model_product_reviews(model_product_id) WHERE status='requested';
CREATE INDEX IF NOT EXISTS model_product_reviews_product_created_idx ON model_product_reviews(model_product_id,created_at DESC);
