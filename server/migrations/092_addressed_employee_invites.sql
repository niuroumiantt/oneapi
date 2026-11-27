-- NULL preserves existing invitations used by ordinary enterprise workspaces.
ALTER TABLE organization_join_links ADD COLUMN IF NOT EXISTS recipient_email text;
