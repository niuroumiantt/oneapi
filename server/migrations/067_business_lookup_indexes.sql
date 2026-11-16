-- Finance anti-joins match supplier bills to calls by upstream request ID.
-- Without these indexes each unmatched bill can scan all call history.
CREATE INDEX IF NOT EXISTS customer_calls_upstream_request_lookup ON customer_calls(upstream_request_id);
CREATE INDEX IF NOT EXISTS employee_calls_upstream_request_lookup ON employee_calls(upstream_request_id);
CREATE INDEX IF NOT EXISTS pilot_calls_upstream_request_lookup ON pilot_calls(upstream_request_id);
