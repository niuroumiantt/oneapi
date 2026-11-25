-- Direct employee sales carry no VIP commission and retain their original issuer.
ALTER TABLE discount_grants ADD COLUMN IF NOT EXISTS business_line text NOT NULL DEFAULT 'general'
 CHECK(business_line IN ('general','direct'));
CREATE INDEX IF NOT EXISTS discount_direct_owner ON discount_grants(created_by,created_at DESC) WHERE business_line='direct';
CREATE INDEX IF NOT EXISTS payment_order_discount_grant ON payment_orders((discount_snapshot->>'grant_id'));
