-- Company-funded internal allowance. Deliberately separate from billing_accounts:
-- it is not customer cash, cannot be refunded, and needs sub-fen precision because
-- KerAPI reports per-call charges such as 0.000126 yuan.
CREATE TABLE IF NOT EXISTS employee_credit_accounts (
 user_id text PRIMARY KEY REFERENCES "user"(id),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 granted_yuan numeric(24,12) NOT NULL CHECK(granted_yuan>0),
 spent_yuan numeric(24,12) NOT NULL DEFAULT 0 CHECK(spent_yuan>=0 AND spent_yuan<=granted_yuan),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employee_api_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text NOT NULL REFERENCES employee_credit_accounts(user_id),
 label text NOT NULL,
 secret_hash text NOT NULL UNIQUE,
 key_hint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS employee_api_keys_owner_idx ON employee_api_keys(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS employee_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 key_id uuid NOT NULL REFERENCES employee_api_keys(id),
 owner_id text NOT NULL REFERENCES employee_credit_accounts(user_id),
 model_id text NOT NULL,
 credential_id uuid NOT NULL REFERENCES supplier_lab_credentials(id),
 -- pending: forwarding; awaiting_bill: answered, waiting for KerAPI's real amount.
 status text NOT NULL CHECK(status IN ('pending','awaiting_bill','settled','failed')),
 hold_yuan numeric(24,12) NOT NULL CHECK(hold_yuan>=0),
 actual_yuan numeric(24,12) CHECK(actual_yuan>=0),
 charged_yuan numeric(24,12) CHECK(charged_yuan>=0),
 settlement_source text CHECK(settlement_source IN ('supplier_log','hold_fallback')),
 upstream_request_id text,
 input_tokens integer,
 cached_input_tokens integer,
 output_tokens integer,
 latency_ms integer,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS employee_calls_owner_idx ON employee_calls(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS employee_calls_open_idx ON employee_calls(status,created_at) WHERE status IN ('pending','awaiting_bill');
CREATE INDEX IF NOT EXISTS employee_calls_bill_idx ON employee_calls(credential_id,upstream_request_id) WHERE status='awaiting_bill';
