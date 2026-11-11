-- Where each call came from, and an optional short, redacted summary of the last question.
ALTER TABLE employee_calls ADD COLUMN IF NOT EXISTS client text;
ALTER TABLE employee_calls ADD COLUMN IF NOT EXISTS client_detail text;
ALTER TABLE employee_calls ADD COLUMN IF NOT EXISTS summary text;
-- Off until a manager turns it on; turning it off deletes stored summaries.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS record_call_summaries boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS employee_calls_key_idx ON employee_calls(key_id,created_at DESC);
