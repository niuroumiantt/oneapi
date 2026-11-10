-- Personal-to-enterprise upgrades are one-way: an approved request closes the personal space for good.
CREATE TABLE IF NOT EXISTS account_upgrade_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL REFERENCES "user"(id),
 legal_name text NOT NULL,
 credit_code text NOT NULL,
 contact_name text NOT NULL,
 contact_phone text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reject_reason text,
 organization_id uuid REFERENCES organizations(id),
 reviewed_by text,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS account_upgrade_live_idx ON account_upgrade_requests(user_id) WHERE status IN ('pending','approved');
CREATE TABLE IF NOT EXISTS support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL REFERENCES "user"(id),
 subject text NOT NULL,
 body text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','closed')),
 staff_note text NOT NULL DEFAULT '',
 handled_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON support_tickets(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets(status,created_at DESC);
-- Technical staff can take a model out of customer routing immediately.
CREATE TABLE IF NOT EXISTS channel_states (
 model_id text PRIMARY KEY,
 paused boolean NOT NULL DEFAULT false,
 reason text NOT NULL DEFAULT '',
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier_lab_stress_runs (
 run_id uuid PRIMARY KEY REFERENCES supplier_lab_runs(id),
 endpoint_id uuid NOT NULL REFERENCES supplier_lab_endpoints(id),
 concurrency integer NOT NULL,
 requests integer NOT NULL,
 budget_yuan numeric(10,4) NOT NULL,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
