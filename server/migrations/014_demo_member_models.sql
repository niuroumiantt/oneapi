-- Model scope per enterprise member in the isolated demo environment.
CREATE TABLE IF NOT EXISTS demo_member_models (
 wallet_id uuid NOT NULL REFERENCES demo_wallets(id),
 user_id text NOT NULL REFERENCES "user"(id),
 model_code text NOT NULL,
 granted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(wallet_id,user_id,model_code)
);
INSERT INTO demo_member_models(wallet_id,user_id,model_code)
 SELECT DISTINCT a.wallet_id,a.user_id,g.model_code
 FROM demo_allocations a JOIN demo_model_grants g ON g.wallet_id=a.wallet_id
 ON CONFLICT DO NOTHING;
