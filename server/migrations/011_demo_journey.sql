-- An isolated, explicitly simulated customer journey. No real money or inference.
CREATE TABLE IF NOT EXISTS demo_wallets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text REFERENCES "user"(id),
 organization_id uuid REFERENCES organizations(id),
 balance_fen bigint NOT NULL DEFAULT 0 CHECK(balance_fen>=0),
 spent_fen bigint NOT NULL DEFAULT 0 CHECK(spent_fen>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((owner_id IS NOT NULL) <> (organization_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS demo_wallet_personal_idx ON demo_wallets(owner_id) WHERE owner_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS demo_wallet_org_idx ON demo_wallets(organization_id) WHERE organization_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS demo_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid NOT NULL REFERENCES demo_wallets(id),
 model_code text NOT NULL, amount_fen bigint NOT NULL CHECK(amount_fen BETWEEN 100 AND 100000000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid')),
 created_by text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS demo_orders_wallet_idx ON demo_orders(wallet_id,created_at DESC);
CREATE TABLE IF NOT EXISTS demo_allocations (
 wallet_id uuid NOT NULL REFERENCES demo_wallets(id), user_id text NOT NULL REFERENCES "user"(id),
 limit_fen bigint NOT NULL DEFAULT 0 CHECK(limit_fen>=0), spent_fen bigint NOT NULL DEFAULT 0 CHECK(spent_fen>=0),
 PRIMARY KEY(wallet_id,user_id), CHECK(spent_fen<=limit_fen)
);
CREATE TABLE IF NOT EXISTS demo_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid NOT NULL REFERENCES demo_wallets(id),
 user_id text NOT NULL REFERENCES "user"(id), model_code text NOT NULL,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demo_keys_wallet_idx ON demo_keys(wallet_id,created_at DESC);
CREATE TABLE IF NOT EXISTS demo_usage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid NOT NULL REFERENCES demo_wallets(id),
 key_id uuid NOT NULL REFERENCES demo_keys(id), user_id text NOT NULL REFERENCES "user"(id),
 model_code text NOT NULL, input_tokens integer NOT NULL CHECK(input_tokens>0),
 output_tokens integer NOT NULL CHECK(output_tokens>0), cost_fen bigint NOT NULL CHECK(cost_fen>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demo_usage_wallet_idx ON demo_usage(wallet_id,created_at DESC);
