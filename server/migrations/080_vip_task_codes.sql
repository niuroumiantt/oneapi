-- VIP referral program (owner decision 2026-11-24, revised):
--   VIP identity is NOT granted by recharge. It is granted by invitation:
--     1. A staff invites a customer; the customer applies with a REGISTRATION invite code (e.g. vip888).
--     2. The invite creates a cw_partners row in status 'pending' and emails all platform admins.
--     3. A sales person contacts the applicant and CONFIRMS them -> status 'active'. Only now is the customer a VIP.
--     4. Only after confirmation does the VIP receive a TASK code (their self-purchase discount code).
--   The task code's discount is decided by the approver (platform admin) at approval time (planned 50%).
--   The VIP enters this task code to top up at that discount.

-- Track the sales confirmation that turns a pending application into an active VIP.
ALTER TABLE cw_partners ADD COLUMN IF NOT EXISTS confirmed_by text REFERENCES staff_members(subject);
ALTER TABLE cw_partners ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Task codes: issued by an approver (platform admin) for a confirmed VIP's own top-ups.
-- A task code carries a customer_price_percent fixed at approval time (e.g. 50 = 5 折).
-- Task codes are self-purchase discount codes, NOT referral codes; no commission is earned on them.
CREATE TABLE IF NOT EXISTS vip_task_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES cw_partners(id),
  code text NOT NULL UNIQUE CHECK(code ~ '^[A-Z0-9_-]{2,32}$'),
  customer_price_percent int NOT NULL CHECK(customer_price_percent BETWEEN 50 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','revoked')),
  created_by text NOT NULL REFERENCES staff_members(subject),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS vip_task_codes_partner ON vip_task_codes(partner_id, created_at DESC);
