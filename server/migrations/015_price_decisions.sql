-- Internal commercial approval only. This table does not publish prices or enable checkout.
CREATE TABLE IF NOT EXISTS model_price_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 price_proposal_id uuid NOT NULL UNIQUE REFERENCES model_price_proposals(id),
 product_review_id uuid NOT NULL REFERENCES model_product_reviews(id),
 status text NOT NULL CHECK(status IN ('approved','rejected')),
 notes text NOT NULL CHECK(length(trim(notes)) BETWEEN 10 AND 1000),
 decided_by text NOT NULL REFERENCES staff_members(subject),
 decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_price_decisions_review_idx ON model_price_decisions(product_review_id);
