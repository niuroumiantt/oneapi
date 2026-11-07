CREATE TABLE IF NOT EXISTS supplier_test_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 offer_id uuid NOT NULL REFERENCES supplier_offers(id),
 test_type text NOT NULL CHECK(test_type IN ('connectivity','response','usage','capacity')),
 result text NOT NULL CHECK(result IN ('passed','failed','inconclusive')),
 observed_at timestamptz NOT NULL,
 latency_ms integer CHECK(latency_ms IS NULL OR latency_ms BETWEEN 0 AND 600000),
 evidence_url text NOT NULL CHECK(length(evidence_url) BETWEEN 8 AND 500),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),
 recorded_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_test_records_offer_time_idx ON supplier_test_records(offer_id,observed_at DESC,created_at DESC);
