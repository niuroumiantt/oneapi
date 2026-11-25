-- Timestamp the first submission to the payment channel. Older refunds keep their recorded times.
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS processing_at timestamptz;
