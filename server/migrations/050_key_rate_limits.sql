-- A manager may raise one key's concurrency and per-minute limits (NULL keeps the platform default),
-- so a key that drives an automated pipeline does not need the limits lifted for every employee.
ALTER TABLE employee_api_keys ADD COLUMN IF NOT EXISTS max_concurrent integer CHECK (max_concurrent IS NULL OR max_concurrent BETWEEN 1 AND 64);
ALTER TABLE employee_api_keys ADD COLUMN IF NOT EXISTS per_minute integer CHECK (per_minute IS NULL OR per_minute BETWEEN 1 AND 1200);
