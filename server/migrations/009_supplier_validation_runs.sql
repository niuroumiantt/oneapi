CREATE TABLE IF NOT EXISTS supplier_validation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 offer_id uuid NOT NULL REFERENCES supplier_offers(id),
 objective text NOT NULL CHECK(length(objective) BETWEEN 1 AND 200),
 window_start timestamptz NOT NULL,
 window_end timestamptz NOT NULL CHECK(window_end > window_start),
 sample_count integer NOT NULL CHECK(sample_count BETWEEN 1 AND 1000000),
 success_count integer NOT NULL CHECK(success_count BETWEEN 0 AND sample_count),
 p95_ttft_ms integer CHECK(p95_ttft_ms IS NULL OR p95_ttft_ms BETWEEN 0 AND 600000),
 p95_total_ms integer CHECK(p95_total_ms IS NULL OR p95_total_ms BETWEEN 0 AND 600000),
 usage_check text NOT NULL CHECK(usage_check IN ('not_checked','matched','mismatched')),
 conclusion text NOT NULL CHECK(conclusion IN ('passed','failed','inconclusive')),
 evidence_url text NOT NULL CHECK(length(evidence_url) BETWEEN 9 AND 500),
 notes text NOT NULL DEFAULT '' CHECK(length(notes) <= 1000),
 recorded_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_validation_runs_offer_time_idx ON supplier_validation_runs(offer_id,window_end DESC,created_at DESC);
