-- Business console redesign: finance switch, supplier and customer codes, light CRM, tax invoices,
-- supplier payments, discount grants and first-line support answers.

-- Finance figures (revenue, cost, margin, invoices) are a third staff switch beside business and technical.
CREATE TABLE IF NOT EXISTS staff_finance_access (
 subject text PRIMARY KEY REFERENCES staff_members(subject),
 granted_by text NOT NULL REFERENCES staff_members(subject),
 granted_at timestamptz NOT NULL DEFAULT now()
);

-- Codes look like S26-001: prefix, two-digit year of the record (Beijing time), then a per-year serial.
-- A code that has been printed on a contract or an invoice must never change, so nothing updates it.
CREATE TABLE IF NOT EXISTS business_code_counters (
 prefix text NOT NULL,
 year integer NOT NULL,
 last_value integer NOT NULL,
 PRIMARY KEY(prefix,year)
);
CREATE OR REPLACE FUNCTION next_business_code(p text,at timestamptz,width integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE y integer := extract(year FROM at AT TIME ZONE 'Asia/Shanghai')::integer; n integer;
BEGIN
 INSERT INTO business_code_counters(prefix,year,last_value) VALUES(p,y,1)
  ON CONFLICT(prefix,year) DO UPDATE SET last_value=business_code_counters.last_value+1 RETURNING last_value INTO n;
 RETURN p||lpad((y%100)::text,2,'0')||'-'||lpad(n::text,width,'0');
END $$;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS code text UNIQUE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name text NOT NULL DEFAULT '' CHECK(length(contact_name)<=80);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_phone text NOT NULL DEFAULT '' CHECK(length(contact_phone)<=40);
CREATE OR REPLACE FUNCTION suppliers_assign_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.code IS NULL THEN NEW.code := next_business_code('S',coalesce(NEW.created_at,now()),3); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS suppliers_code ON suppliers;
CREATE TRIGGER suppliers_code BEFORE INSERT ON suppliers FOR EACH ROW EXECUTE FUNCTION suppliers_assign_code();
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT id,created_at FROM suppliers WHERE code IS NULL ORDER BY created_at,id LOOP
  UPDATE suppliers SET code=next_business_code('S',r.created_at,3) WHERE id=r.id;
 END LOOP;
END $$;

-- One row per downstream customer: every organization is an enterprise customer, every login a personal one.
-- Rows are created by ensure_customers() from the back office, never from the sign-up path.
CREATE TABLE IF NOT EXISTS customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN ('enterprise','personal')),
 user_id text UNIQUE REFERENCES "user"(id),
 organization_id uuid UNIQUE REFERENCES organizations(id),
 stage text NOT NULL DEFAULT 'new' CHECK(stage IN ('new','following','key','risk','lost')),
 tags text[] NOT NULL DEFAULT '{}',
 owner_subject text REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='enterprise' AND organization_id IS NOT NULL AND user_id IS NULL) OR (kind='personal' AND user_id IS NOT NULL AND organization_id IS NULL))
);
CREATE INDEX IF NOT EXISTS customers_tags_idx ON customers USING gin(tags);
CREATE OR REPLACE FUNCTION ensure_customers() RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; BEGIN
 PERFORM pg_advisory_xact_lock(148921,48);
 FOR r IN SELECT o.id,o.created_at FROM organizations o WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.organization_id=o.id) ORDER BY o.created_at,o.id LOOP
  INSERT INTO customers(code,kind,organization_id,created_at) VALUES(next_business_code('E',r.created_at,4),'enterprise',r.id,r.created_at);
 END LOOP;
 FOR r IN SELECT u.id,u."createdAt" AS created_at FROM "user" u WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.user_id=u.id) ORDER BY u."createdAt",u.id LOOP
  INSERT INTO customers(code,kind,user_id,created_at) VALUES(next_business_code('P',r.created_at,5),'personal',r.id,r.created_at);
 END LOOP;
END $$;
SELECT ensure_customers();

CREATE TABLE IF NOT EXISTS customer_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id uuid NOT NULL REFERENCES customers(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_notes_customer_idx ON customer_notes(customer_id,created_at DESC);

-- Tax invoices are issued in the tax bureau's system; this table records the request and the result.
-- output: we invoice a customer. input: a supplier invoices us.
CREATE TABLE IF NOT EXISTS tax_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 direction text NOT NULL CHECK(direction IN ('output','input')),
 customer_id uuid REFERENCES customers(id),
 supplier_id uuid REFERENCES suppliers(id),
 invoice_type text NOT NULL CHECK(invoice_type IN ('general','special')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 tax_number text NOT NULL DEFAULT '' CHECK(length(tax_number)<=30),
 email text NOT NULL DEFAULT '' CHECK(length(email)<=254),
 amount_fen bigint NOT NULL CHECK(amount_fen>0),
 status text NOT NULL CHECK(status IN ('requested','issued','rejected','voided','reversed')),
 invoice_number text CHECK(length(invoice_number) BETWEEN 8 AND 30),
 issued_on date,
 note text NOT NULL DEFAULT '' CHECK(length(note)<=500),
 requested_by_user text REFERENCES "user"(id),
 created_by_staff text REFERENCES staff_members(subject),
 handled_by text REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((direction='output' AND customer_id IS NOT NULL AND supplier_id IS NULL) OR (direction='input' AND supplier_id IS NOT NULL AND customer_id IS NULL)),
 CHECK ((status IN ('issued','voided','reversed'))=(invoice_number IS NOT NULL AND issued_on IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_invoices_number_idx ON tax_invoices(direction,invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS tax_invoices_customer_idx ON tax_invoices(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS tax_invoices_status_idx ON tax_invoices(direction,status,created_at DESC);

-- Money we paid an upstream supplier (account top-ups, settlements). Cash-basis cost.
CREATE TABLE IF NOT EXISTS supplier_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 supplier_id uuid NOT NULL REFERENCES suppliers(id),
 amount_fen bigint NOT NULL CHECK(amount_fen>0),
 paid_on date NOT NULL,
 method text NOT NULL CHECK(method IN ('bank','alipay','wechat','card','other')),
 reference text NOT NULL DEFAULT '' CHECK(length(reference)<=120),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=500),
 voided_at timestamptz,
 voided_by text REFERENCES staff_members(subject),
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_payments_supplier_idx ON supplier_payments(supplier_id,paid_on DESC);

-- Who may pay less than list price, for what, until when. A register only: pricing does not read it yet.
CREATE TABLE IF NOT EXISTS discount_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 audience text NOT NULL CHECK(audience IN ('customer','tag','all')),
 customer_id uuid REFERENCES customers(id),
 tag text CHECK(length(tag) BETWEEN 1 AND 30),
 model_id text CHECK(length(model_id) BETWEEN 1 AND 120),
 customer_price_percent integer NOT NULL CHECK(customer_price_percent BETWEEN 1 AND 99),
 cap_fen bigint CHECK(cap_fen>0),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 status text NOT NULL CHECK(status IN ('pending','active','rejected','revoked')),
 created_by text NOT NULL REFERENCES staff_members(subject),
 decided_by text REFERENCES staff_members(subject),
 decided_at timestamptz,
 decision_note text NOT NULL DEFAULT '' CHECK(length(decision_note)<=500),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ends_at>starts_at),
 CHECK ((audience='customer' AND customer_id IS NOT NULL AND tag IS NULL) OR (audience='tag' AND tag IS NOT NULL AND customer_id IS NULL) OR (audience='all' AND customer_id IS NULL AND tag IS NULL))
);
CREATE INDEX IF NOT EXISTS discount_grants_status_idx ON discount_grants(status,ends_at);

-- First-line support: tickets get a category, a tier and a reply thread; answers are reusable replies.
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'question';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_tickets_category_check') THEN
 ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_category_check CHECK(category IN ('question','billing','invoice','bug','feedback'));
END IF; END $$;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'first_line';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_tickets_tier_check') THEN
 ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_tier_check CHECK(tier IN ('first_line','technical'));
END IF; END $$;
CREATE TABLE IF NOT EXISTS support_ticket_replies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_id uuid NOT NULL REFERENCES support_tickets(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 answer_id uuid,
 created_by text NOT NULL REFERENCES staff_members(subject),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_replies_ticket_idx ON support_ticket_replies(ticket_id,created_at);
CREATE TABLE IF NOT EXISTS support_answers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 category text NOT NULL CHECK(category IN ('question','billing','invoice','bug','feedback')),
 question text NOT NULL CHECK(length(question) BETWEEN 1 AND 200),
 answer text NOT NULL CHECK(length(answer) BETWEEN 1 AND 2000),
 published boolean NOT NULL DEFAULT false,
 use_count integer NOT NULL DEFAULT 0,
 archived_at timestamptz,
 created_by text NOT NULL REFERENCES staff_members(subject),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
