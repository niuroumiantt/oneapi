CREATE TABLE IF NOT EXISTS vip_activation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES cw_partners(id),
  order_id uuid NOT NULL UNIQUE REFERENCES payment_orders(id),
  request_reason text NOT NULL CHECK(length(btrim(request_reason)) BETWEEN 1 AND 500),
  requested_by text REFERENCES staff_members(subject),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  decided_by text REFERENCES staff_members(subject),
  decided_at timestamptz,
  decision_reason text CHECK(length(btrim(decision_reason)) BETWEEN 1 AND 500),
  source_audit_id bigint UNIQUE REFERENCES audit_events(id),
  CHECK (
    (source_audit_id IS NULL AND requested_by IS NOT NULL) OR
    (source_audit_id IS NOT NULL AND requested_by IS NULL AND decided_by IS NULL AND status='approved')
  ),
  CHECK (
    (status='pending' AND decided_at IS NULL AND decided_by IS NULL AND decision_reason IS NULL) OR
    (status<>'pending' AND decided_at IS NOT NULL AND decision_reason IS NOT NULL AND (decided_by IS NOT NULL OR source_audit_id IS NOT NULL))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS vip_activation_exception_one_pending
  ON vip_activation_exceptions(partner_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS vip_activation_exception_history
  ON vip_activation_exceptions(partner_id,created_at DESC,id DESC);

-- Preserve verified one-off approvals with their original audit attribution.
INSERT INTO vip_activation_exceptions
  (partner_id,order_id,request_reason,created_at,status,decided_at,decision_reason,source_audit_id)
SELECT DISTINCT ON (o.id) p.id,o.id,
  '历史运维特批',e.created_at,'approved',e.created_at,left(e.detail->>'reason',500),e.id
FROM audit_events e
JOIN cw_partners p ON p.id::text=e.subject_id
JOIN billing_accounts a ON a.owner_id=p.user_id
JOIN payment_orders o ON o.account_id=a.id AND o.id::text=e.detail->>'order_id'
WHERE e.action='cw.activation_exception_approved' AND e.actor_kind='system'
  AND e.actor_id='operator-vip-order-exception' AND nullif(btrim(e.detail->>'reason'),'') IS NOT NULL
ORDER BY o.id,e.id
ON CONFLICT (order_id) DO NOTHING;
