-- The 50% default remains available to sales. Any other price requires approval.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='vip_task_codes'::regclass AND conname='vip_task_codes_price_range'
  ) THEN
    ALTER TABLE vip_task_codes DROP CONSTRAINT IF EXISTS vip_task_codes_customer_price_percent_check;
    ALTER TABLE vip_task_codes ADD CONSTRAINT vip_task_codes_price_range CHECK(customer_price_percent BETWEEN 1 AND 100);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vip_payment_discount_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES cw_partners(id),
  customer_price_percent int NOT NULL CHECK(customer_price_percent BETWEEN 1 AND 100 AND customer_price_percent<>50),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
  requested_by text NOT NULL REFERENCES staff_members(subject),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  decided_by text REFERENCES staff_members(subject),
  decided_at timestamptz,
  decision_note text,
  issued_code_id uuid REFERENCES vip_task_codes(id),
  CHECK((status='pending') = (decided_at IS NULL)),
  CHECK((status='approved') = (issued_code_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS vip_payment_discount_one_pending
  ON vip_payment_discount_requests(partner_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS vip_payment_discount_history
  ON vip_payment_discount_requests(partner_id,created_at DESC,id DESC);
