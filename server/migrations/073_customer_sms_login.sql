CREATE TABLE IF NOT EXISTS customer_sms_phones (
 user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 phone_hash text NOT NULL UNIQUE,
 last_four text NOT NULL CHECK (last_four ~ '^[0-9]{4}$'),
 bound_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_sms_challenges (
 id uuid PRIMARY KEY,
 phone_hash text NOT NULL,
 purpose text NOT NULL CHECK (purpose IN ('login','bind')),
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5)
);
CREATE INDEX IF NOT EXISTS customer_sms_challenges_expiry_idx ON customer_sms_challenges(expires_at);
