CREATE TABLE IF NOT EXISTS cw_fadada_signings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES cw_partners(id),
  app_id text NOT NULL,
  mode text NOT NULL CHECK(mode IN ('live','sandbox')),
  open_corp_id text NOT NULL,
  company_member_id text NOT NULL,
  template_id text NOT NULL,
  template_version text NOT NULL,
  company_actor text NOT NULL,
  person_actor text NOT NULL,
  signer_cipher text NOT NULL,
  consent_at timestamptz NOT NULL DEFAULT now(),
  provider_id text,
  report_id text,
  ends_on date,
  status text NOT NULL CHECK(status IN (
    'requested','creating','draft','starting','pending_person','pending_company',
    'pending_both','archiving','verified','rejected','expired','canceled','voided','review'
  )),
  requested_by text REFERENCES staff_members(subject),
  next_check_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(mode, app_id, provider_id),
  UNIQUE(mode, app_id, report_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS cw_fadada_one_open
  ON cw_fadada_signings(partner_id, mode)
  WHERE status NOT IN ('verified','rejected','expired','canceled','voided');
CREATE INDEX IF NOT EXISTS cw_fadada_due
  ON cw_fadada_signings(mode, app_id, next_check_at) WHERE next_check_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS cw_fadada_notifications (
  signing_id uuid NOT NULL,
  event_key text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(signing_id,event_key)
);

CREATE TABLE IF NOT EXISTS cw_fadada_archives (
  signing_id uuid PRIMARY KEY REFERENCES cw_fadada_signings(id),
  pdf_cipher text NOT NULL,
  pdf_sha256 text NOT NULL CHECK(pdf_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_cipher text NOT NULL,
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_summary jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cw_contracts ADD COLUMN IF NOT EXISTS fadada_signing_id uuid UNIQUE REFERENCES cw_fadada_signings(id);
ALTER TABLE cw_contracts ALTER COLUMN verified_by DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE cw_contracts ADD CONSTRAINT cw_contracts_verification_source
    CHECK ((verified_by IS NULL) <> (fadada_signing_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
