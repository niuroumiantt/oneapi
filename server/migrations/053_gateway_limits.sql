-- Gateway decision 2026-11-12 (docs/14-gateway-settings.md C6/C10): a company-wide gate in front of KerAPI and a default
-- limit for every organization, unless staff set that organization's own values.
-- Company: 50 requests at once (gateway CPU tops out near 60) and 15 million tokens a minute (75% of KerAPI's 20 million,
-- cache hits included). Each organization by default: 10 at once and 2 million tokens a minute (10% of KerAPI's total).
CREATE TABLE IF NOT EXISTS gateway_limits (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 max_concurrent integer NOT NULL CHECK (max_concurrent BETWEEN 1 AND 1000),
 tpm bigint NOT NULL CHECK (tpm BETWEEN 1000 AND 1000000000),
 org_max_concurrent integer NOT NULL CHECK (org_max_concurrent BETWEEN 1 AND 1000),
 org_tpm bigint NOT NULL CHECK (org_tpm BETWEEN 1000 AND 1000000000),
 updated_by text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO gateway_limits(id,max_concurrent,tpm,org_max_concurrent,org_tpm) VALUES(true,50,15000000,10,2000000) ON CONFLICT (id) DO NOTHING;
-- NULL keeps the default; limits_updated_at marks an organization whose limits someone has decided.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_concurrent integer CHECK (max_concurrent IS NULL OR max_concurrent BETWEEN 1 AND 1000);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tpm bigint CHECK (tpm IS NULL OR tpm BETWEEN 1000 AND 1000000000);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS limits_updated_at timestamptz;
-- Our own company (the organization the employee credit accounts belong to) is set to 30 at once and 4 million tokens a
-- minute: measured peaks were 29 at once and 2.62 million tokens in a minute. Applied once; later changes are staff's.
UPDATE organizations SET max_concurrent=30,tpm=4000000,limits_updated_at=now()
 WHERE limits_updated_at IS NULL AND id IN (SELECT DISTINCT organization_id FROM employee_credit_accounts);
