-- Returned internal API allowance; never customer cash or refundable money.
ALTER TABLE employee_credit_accounts DROP CONSTRAINT IF EXISTS employee_credit_accounts_granted_yuan_check;
ALTER TABLE employee_credit_accounts ADD CONSTRAINT employee_credit_accounts_granted_yuan_check CHECK(granted_yuan>=0);
ALTER TABLE employee_credit_accounts ADD COLUMN IF NOT EXISTS reclaim_pending boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS company_credit_pools (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),
 available_yuan numeric(24,12) NOT NULL DEFAULT 0 CHECK(available_yuan>=0)
);
CREATE TABLE IF NOT EXISTS company_credit_ledger (
 id bigserial PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 user_id text REFERENCES "user"(id), delta_yuan numeric(24,12) NOT NULL,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_credit_ledger_org_idx ON company_credit_ledger(organization_id,id DESC);
