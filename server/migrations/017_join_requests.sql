CREATE TABLE IF NOT EXISTS organization_join_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), created_by text NOT NULL REFERENCES "user"(id), token_hash text NOT NULL UNIQUE, token_secret text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS join_links_org_idx ON organization_join_links(organization_id,status,expires_at);
CREATE TABLE IF NOT EXISTS organization_join_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), link_id uuid NOT NULL REFERENCES organization_join_links(id), user_id text NOT NULL REFERENCES "user"(id), display_name text NOT NULL, department text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), created_at timestamptz NOT NULL DEFAULT now(), reviewed_by text REFERENCES "user"(id), reviewed_at timestamptz, UNIQUE(organization_id,user_id)
);
CREATE INDEX IF NOT EXISTS join_requests_org_idx ON organization_join_requests(organization_id,status,created_at);
