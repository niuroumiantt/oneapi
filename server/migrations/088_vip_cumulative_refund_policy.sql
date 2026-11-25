-- Original purchases stay immutable. Refunds and forfeitures are separate facts.
ALTER TABLE credit_packs ADD COLUMN IF NOT EXISTS refunded_cash_fen bigint NOT NULL DEFAULT 0 CHECK(refunded_cash_fen>=0);
ALTER TABLE credit_packs ADD COLUMN IF NOT EXISTS removed_face_fen numeric(30,10) NOT NULL DEFAULT 0 CHECK(removed_face_fen>=0);
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS retained_fen numeric(30,10) NOT NULL DEFAULT 0 CHECK(retained_fen>=0);
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS policy_ticket_id uuid REFERENCES support_tickets(id);
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS policy_override boolean NOT NULL DEFAULT false;
UPDATE credit_packs p SET refunded_cash_fen=x.cash,removed_face_fen=x.face
FROM (SELECT pack_id,sum(amount_fen)::bigint cash,sum(face_fen-retained_fen) face FROM payment_refunds WHERE status IN ('pending','succeeded') AND pack_id IS NOT NULL GROUP BY pack_id) x
WHERE p.id=x.pack_id AND p.refund_id IS NOT NULL AND p.refunded_cash_fen=0;
ALTER TABLE discount_grants ADD COLUMN IF NOT EXISTS non_refundable boolean NOT NULL DEFAULT false;
ALTER TABLE discount_grants ADD COLUMN IF NOT EXISTS min_cash_fen bigint NOT NULL DEFAULT 0 CHECK(min_cash_fen BETWEEN 0 AND 5000000);
CREATE TABLE IF NOT EXISTS vip_activation_policy (
 partner_id uuid PRIMARY KEY REFERENCES cw_partners(id),target_fen bigint NOT NULL CHECK(target_fen BETWEEN 0 AND 10000),
 origin text NOT NULL CHECK(origin IN ('activation','exception','backfill')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vip_activation_payments (
 partner_id uuid NOT NULL REFERENCES vip_activation_policy(partner_id),pack_id uuid NOT NULL REFERENCES credit_packs(id),
 amount_fen bigint NOT NULL CHECK(amount_fen>0),PRIMARY KEY(partner_id,pack_id),UNIQUE(pack_id)
);
CREATE TABLE IF NOT EXISTS invoice_pack_allocations (
 invoice_id uuid NOT NULL REFERENCES tax_invoices(id),pack_id uuid NOT NULL REFERENCES credit_packs(id),
 amount_fen bigint NOT NULL CHECK(amount_fen>0),PRIMARY KEY(invoice_id,pack_id)
);
CREATE OR REPLACE FUNCTION allocate_invoice_refund_hold(iid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE inv record; acct uuid; row record; need bigint; take bigint;
BEGIN
 SELECT * INTO inv FROM tax_invoices WHERE id=iid;
 IF inv.direction<>'output' OR inv.status NOT IN ('requested','issued') THEN RETURN; END IF;
 SELECT a.id INTO acct FROM billing_accounts a JOIN customers c ON a.owner_id=c.user_id OR a.organization_id=c.organization_id WHERE c.id=inv.customer_id FOR UPDATE OF a;
 IF acct IS NULL THEN RETURN; END IF;
 SELECT inv.amount_fen-coalesce(sum(amount_fen),0) INTO need FROM invoice_pack_allocations WHERE invoice_id=iid;
 IF need<=0 THEN RETURN; END IF;
 -- Consumed cash first: its invoice must not freeze unrelated unused cash.
 FOR row IN SELECT p.id,greatest(0,p.consumed_cash_fen-coalesce(x.used,0)) AS capacity FROM credit_packs p
 LEFT JOIN LATERAL(SELECT sum(z.amount_fen) used FROM invoice_pack_allocations z JOIN tax_invoices i ON i.id=z.invoice_id WHERE z.pack_id=p.id AND i.status IN ('requested','issued')) x ON true
 WHERE p.account_id=acct ORDER BY p.created_at,p.id LOOP
  take:=least(need,row.capacity); IF take>0 THEN
   INSERT INTO invoice_pack_allocations VALUES(iid,row.id,take) ON CONFLICT(invoice_id,pack_id) DO UPDATE SET amount_fen=invoice_pack_allocations.amount_fen+excluded.amount_fen;
   need:=need-take; END IF; EXIT WHEN need<=0;
 END LOOP;
 FOR row IN SELECT p.id,greatest(0,p.cash_fen-p.refunded_cash_fen-coalesce(x.used,0)) AS capacity FROM credit_packs p
 LEFT JOIN LATERAL(SELECT sum(z.amount_fen) used FROM invoice_pack_allocations z JOIN tax_invoices i ON i.id=z.invoice_id WHERE z.pack_id=p.id AND i.status IN ('requested','issued')) x ON true
 WHERE p.account_id=acct ORDER BY p.created_at,p.id LOOP
  take:=least(need,row.capacity); IF take>0 THEN
   INSERT INTO invoice_pack_allocations VALUES(iid,row.id,take) ON CONFLICT(invoice_id,pack_id) DO UPDATE SET amount_fen=invoice_pack_allocations.amount_fen+excluded.amount_fen;
   need:=need-take; END IF; EXIT WHEN need<=0;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION reserve_vip_activation(pid uuid, source text, requested bigint DEFAULT 10000) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE acct uuid; row record; need bigint; total bigint; take bigint;
BEGIN
 SELECT a.id INTO acct FROM billing_accounts a JOIN cw_partners p ON p.user_id=a.owner_id WHERE p.id=pid FOR UPDATE OF a;
 IF EXISTS(SELECT 1 FROM vip_activation_policy WHERE partner_id=pid) THEN RETURN (SELECT coalesce(sum(amount_fen),0) FROM vip_activation_payments WHERE partner_id=pid); END IF;
 INSERT INTO vip_activation_policy(partner_id,target_fen,origin) VALUES(pid,least(10000,requested),source);
 need:=least(10000,requested); total:=0;
 FOR row IN SELECT cp.id, o.amount_fen-o.refunded_fen AS cash FROM payment_orders o
 JOIN credit_packs cp ON cp.source_kind='payment' AND cp.source_id=o.id
 WHERE o.account_id=acct AND o.status='paid' AND o.provider_trade_no IS NOT NULL
 AND EXISTS(SELECT 1 FROM billing_ledger l WHERE l.account_id=acct AND l.kind='recharge' AND l.reference_kind='payment' AND l.reference_id=o.id::text AND l.amount_fen=o.amount_fen)
 AND NOT EXISTS(SELECT 1 FROM payment_refunds r WHERE r.order_id=o.id AND r.status='pending')
 AND NOT EXISTS(SELECT 1 FROM vip_activation_payments v WHERE v.pack_id=cp.id)
 ORDER BY o.paid_at,o.id LOOP
  take:=least(need,row.cash); IF take>0 THEN INSERT INTO vip_activation_payments VALUES(pid,row.id,take);need:=need-take;total:=total+take;END IF;
  EXIT WHEN need<=0;
 END LOOP;
 RETURN total;
END $$;
-- Owner explicitly authorized historical VIP backfill, capped at verified actual payments.
DO $$ DECLARE r record; n bigint; BEGIN
 FOR r IN SELECT id FROM cw_partners WHERE status='active' AND NOT EXISTS(SELECT 1 FROM vip_activation_policy v WHERE v.partner_id=cw_partners.id) ORDER BY id LOOP
  n:=reserve_vip_activation(r.id,'backfill',10000);
  INSERT INTO audit_events(actor_kind,actor_id,action,subject_id,detail) VALUES('system','migration-088','cw.activation_policy_backfilled',r.id,jsonb_build_object('reserved_fen',n,'target_fen',10000));
 END LOOP;
 FOR r IN SELECT id FROM tax_invoices WHERE direction='output' AND status IN ('requested','issued') ORDER BY created_at,id LOOP PERFORM allocate_invoice_refund_hold(r.id); END LOOP;
END $$;
