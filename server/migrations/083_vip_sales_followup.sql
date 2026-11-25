ALTER TABLE cw_partners
  ADD COLUMN IF NOT EXISTS invite_code_id uuid REFERENCES vip_invite_codes(id),
  ADD COLUMN IF NOT EXISTS owner_subject text REFERENCES staff_members(subject),
  ADD COLUMN IF NOT EXISTS next_contact_on date;

-- The original application audit records the exact employee-issued code.
WITH source AS (
  SELECT DISTINCT ON (subject_id) subject_id, detail->>'invite_code' AS invite_code
  FROM audit_events
  WHERE action='cw.applied' AND detail->>'invite_code' IS NOT NULL
  ORDER BY subject_id, id
)
UPDATE cw_partners p
SET invite_code_id = i.id, owner_subject = s.subject
FROM source a
JOIN vip_invite_codes i ON i.code = a.invite_code
LEFT JOIN staff_members s ON s.subject = i.created_by AND s.status='active' AND s.role<>'pending'
WHERE p.id::text = a.subject_id AND p.invite_code_id IS NULL;

CREATE INDEX IF NOT EXISTS cw_partners_owner_idx ON cw_partners(owner_subject, created_at DESC);
CREATE INDEX IF NOT EXISTS cw_partners_invite_idx ON cw_partners(invite_code_id);

CREATE TABLE IF NOT EXISTS cw_sales_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES cw_partners(id),
  created_by text NOT NULL REFERENCES staff_members(subject),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  next_contact_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cw_sales_followups_history_idx ON cw_sales_followups(partner_id, created_at DESC, id DESC);
