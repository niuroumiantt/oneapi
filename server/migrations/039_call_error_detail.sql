-- The supplier's own error message on a failed employee call (redacted, 300 characters at most).
ALTER TABLE employee_calls ADD COLUMN IF NOT EXISTS error_detail text;
