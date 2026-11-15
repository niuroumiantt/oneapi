-- Preserve the role at review time; only an administrator may review their own entry.
ALTER TABLE bank_transfer_entries ADD COLUMN IF NOT EXISTS decision_role text NOT NULL DEFAULT '';
ALTER TABLE bank_transfer_entries DROP CONSTRAINT IF EXISTS bank_transfer_entries_check2;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bank_transfer_entries'::regclass AND conname='bank_transfer_reviewer_separation') THEN
  ALTER TABLE bank_transfer_entries ADD CONSTRAINT bank_transfer_reviewer_separation
   CHECK (decided_by IS NULL OR decided_by <> created_by OR decision_role='platform_admin');
 END IF;
END $$;
