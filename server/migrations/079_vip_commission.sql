-- VIP referral program: invite codes, dynamic commission = sell_percent - 40, VIP self-code at 50%.
-- Owner decision 2026-11-24:
--   * VIP joins only with an invite code (semifly staff issue them; reusable with a usage cap).
--   * VIP's own cost = 50% (via a dedicated self-code, no commission on self-purchase).
--   * VIP sells codes at >= 50%; commission = (sell_percent - 40) of the customer's PAID amount.
--   * Base 40% stays with semifly; anything above 40% goes to the VIP. More sold = more earned.

-- Invite codes issued by staff. Reusable up to max_uses.
CREATE TABLE IF NOT EXISTS vip_invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK(code ~ '^[A-Z0-9_-]{2,32}$'),
  max_uses int NOT NULL DEFAULT 1 CHECK(max_uses >= 1),
  used_count int NOT NULL DEFAULT 0 CHECK(used_count >= 0),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  note text,
  created_by text NOT NULL REFERENCES staff_members(subject),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(used_count <= max_uses)
);

-- cw_codes: mark a code as the VIP's self-code (50%, no commission); sell codes floor at 50.
ALTER TABLE cw_codes ADD COLUMN IF NOT EXISTS is_self_code boolean NOT NULL DEFAULT false;
ALTER TABLE cw_codes DROP CONSTRAINT IF EXISTS cw_codes_customer_price_percent_check;
ALTER TABLE cw_codes ADD CONSTRAINT cw_codes_customer_price_percent_check
  CHECK(customer_price_percent BETWEEN 50 AND 100);

-- Commission becomes dynamic: commission_bps = (customer_price_percent - 40) * 100.
-- rate_bps on cw_codes and cw_commissions must no longer be pinned to 1000.
ALTER TABLE cw_codes DROP CONSTRAINT IF EXISTS cw_codes_commission_bps_check;
ALTER TABLE cw_codes ADD CONSTRAINT cw_codes_commission_bps_check
  CHECK(commission_bps BETWEEN 0 AND 6000);
ALTER TABLE cw_commissions DROP CONSTRAINT IF EXISTS cw_commissions_rate_bps_check;
ALTER TABLE cw_commissions ADD CONSTRAINT cw_commissions_rate_bps_check
  CHECK(rate_bps BETWEEN 0 AND 6000);

-- Recompute existing codes' commission to the new formula (percent - 40).
UPDATE cw_codes SET commission_bps = GREATEST(0, (customer_price_percent - 40) * 100) WHERE to_jsonb(cw_codes)->>'model_id' IS NULL;
