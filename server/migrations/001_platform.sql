CREATE TABLE IF NOT EXISTS organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100), region text NOT NULL DEFAULT 'CN' CHECK(region='CN'), created_by text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), user_id text NOT NULL REFERENCES "user"(id), role text NOT NULL CHECK(role IN ('owner','admin','department_admin','billing','member')), department text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,user_id), CHECK(role <> 'department_admin' OR length(department)>0)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
CREATE TABLE IF NOT EXISTS invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), invited_by text NOT NULL REFERENCES "user"(id), email text NOT NULL, role text NOT NULL CHECK(role IN ('owner','admin','department_admin','billing','member')), department text NOT NULL DEFAULT '', token_hash text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), accepted_by text REFERENCES "user"(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS invitation_pending_idx ON invitations(organization_id,lower(email)) WHERE status='pending';
CREATE TABLE IF NOT EXISTS audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_kind text NOT NULL CHECK(actor_kind IN ('customer','staff','system')), actor_id text NOT NULL, organization_id uuid REFERENCES organizations(id), action text NOT NULL, subject_id text, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_org_idx ON audit_events(organization_id,created_at DESC);
CREATE TABLE IF NOT EXISTS mail_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload text, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')), attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour', locked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), error_code text
);
CREATE TABLE IF NOT EXISTS staff_members (
 subject text PRIMARY KEY, email text NOT NULL, name text NOT NULL, role text NOT NULL DEFAULT 'pending' CHECK(role IN ('pending','platform_admin','operations','supply','finance','support')), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_sessions (
 token_hash text PRIMARY KEY, subject text NOT NULL REFERENCES staff_members(subject), access_payload text NOT NULL, expires_at timestamptz NOT NULL, last_seen timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_oidc_states (
 state_hash text PRIMARY KEY, binding_hash text NOT NULL, payload text NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE TABLE IF NOT EXISTS request_limits (
 key text PRIMARY KEY, count integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL
);
