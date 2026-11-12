-- Retire early personal pilot keys (docs/14-gateway-settings.md L1 / item 12, 2026-11-12).
-- Keep tables for historical cost joins; stop any still-active sf_test_ keys.
UPDATE pilot_api_keys SET revoked_at = coalesce(revoked_at, now()) WHERE revoked_at IS NULL;
UPDATE pilot_calls SET status = 'failed', error_code = coalesce(error_code, 'PILOT_RETIRED'), finished_at = coalesce(finished_at, now())
 WHERE status = 'pending';
