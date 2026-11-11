-- Departments are a list each company's managers maintain; members and join requests pick from it.
CREATE TABLE IF NOT EXISTS organization_departments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40 AND name=btrim(name)),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_departments_name_idx ON organization_departments(organization_id,lower(name));
-- Free-text departments already in use become list entries, so nothing typed earlier is lost.
INSERT INTO organization_departments(organization_id,name)
SELECT DISTINCT ON (organization_id,lower(btrim(department))) organization_id,btrim(department)
FROM memberships WHERE btrim(department)<>'' AND length(btrim(department))<=40
ORDER BY organization_id,lower(btrim(department)),created_at
ON CONFLICT DO NOTHING;
