-- VIP identity is granted only after paying with a VIP discount (task) code.
-- Sales interview confirmation moves pending → confirmed (may receive a discount code).
-- Successful self-purchase with that discount code moves confirmed → active (formal VIP).
-- Existing active partners stay active (no demotion).

ALTER TABLE cw_partners DROP CONSTRAINT IF EXISTS cw_partners_status_check;
ALTER TABLE cw_partners ADD CONSTRAINT cw_partners_status_check
  CHECK (status IN ('pending', 'confirmed', 'active', 'suspended', 'rejected'));

ALTER TABLE cw_partners ADD COLUMN IF NOT EXISTS activated_at timestamptz;
