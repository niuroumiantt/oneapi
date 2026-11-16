-- Preserve the finance expression exactly; PostgreSQL recomputes this value in
-- the same write whenever evidence changes. This is not an asynchronous cache.
ALTER TABLE supplier_usage_records ADD COLUMN IF NOT EXISTS finance_amount_yuan numeric
 GENERATED ALWAYS AS (
  CASE WHEN evidence->>'amount' ~ '^[0-9]+(\.[0-9]+)?$'
   THEN (evidence->>'amount')::numeric ELSE 0 END
 ) STORED;
