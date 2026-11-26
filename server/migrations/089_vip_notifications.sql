-- Durable events are committed with the business change, independent of SMTP.
CREATE TABLE IF NOT EXISTS vip_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 partner_id uuid NOT NULL REFERENCES cw_partners(id) ON DELETE CASCADE,
 kind text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 mail_available_at timestamptz NOT NULL DEFAULT now(),
 mail_attempts integer NOT NULL DEFAULT 0,
 mail_queued_at timestamptz
);
CREATE INDEX IF NOT EXISTS vip_notifications_pending_mail ON vip_notifications(created_at) WHERE mail_queued_at IS NULL;
CREATE INDEX IF NOT EXISTS vip_notifications_partner ON vip_notifications(partner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS vip_notification_reads (
 notification_id uuid NOT NULL REFERENCES vip_notifications(id) ON DELETE CASCADE,
 subject text NOT NULL REFERENCES staff_members(subject) ON DELETE CASCADE,
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(notification_id,subject)
);
CREATE OR REPLACE FUNCTION notify_vip_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid; event text;
BEGIN
 IF TG_TABLE_NAME='cw_partners' THEN
  pid:=NEW.id;
  IF TG_OP='INSERT' THEN event:='applied';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN event:=NEW.status;
  ELSIF NEW.owner_subject IS DISTINCT FROM OLD.owner_subject THEN event:='assigned';
  END IF;
 ELSIF TG_TABLE_NAME='vip_task_codes' THEN
  pid:=NEW.partner_id; event:='payment_code';
 ELSE
  pid:=NEW.partner_id;
  IF TG_OP='INSERT' THEN event:='approval_requested';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN event:='approval_decided';
  END IF;
 END IF;
 IF event IS NOT NULL THEN INSERT INTO vip_notifications(partner_id,kind) VALUES(pid,event); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vip_partner_notice ON cw_partners;
CREATE TRIGGER vip_partner_notice AFTER INSERT OR UPDATE OF status,owner_subject ON cw_partners FOR EACH ROW EXECUTE FUNCTION notify_vip_change();
DROP TRIGGER IF EXISTS vip_code_notice ON vip_task_codes;
CREATE TRIGGER vip_code_notice AFTER INSERT ON vip_task_codes FOR EACH ROW EXECUTE FUNCTION notify_vip_change();
DROP TRIGGER IF EXISTS vip_discount_notice ON vip_payment_discount_requests;
CREATE TRIGGER vip_discount_notice AFTER INSERT OR UPDATE OF status ON vip_payment_discount_requests FOR EACH ROW EXECUTE FUNCTION notify_vip_change();
DROP TRIGGER IF EXISTS vip_exception_notice ON vip_activation_exceptions;
CREATE TRIGGER vip_exception_notice AFTER INSERT OR UPDATE OF status ON vip_activation_exceptions FOR EACH ROW EXECUTE FUNCTION notify_vip_change();
-- Existing unfinished applications appear in the inbox without resending old emails.
INSERT INTO vip_notifications(partner_id,kind,created_at,mail_queued_at)
 SELECT p.id,'existing',p.created_at,now() FROM cw_partners p
 WHERE p.status IN ('pending','confirmed') AND NOT EXISTS(SELECT 1 FROM vip_notifications n WHERE n.partner_id=p.id);

-- Recharge emails keep the existing payment notice channel; the inbox shares the transaction.
CREATE OR REPLACE FUNCTION notify_vip_recharge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='paid' AND OLD.status IS DISTINCT FROM NEW.status THEN
  INSERT INTO vip_notifications(partner_id,kind,mail_queued_at)
   SELECT p.id,'recharge',now() FROM billing_accounts a JOIN cw_partners p ON p.user_id=a.owner_id
    WHERE a.id=NEW.account_id AND p.status IN ('pending','confirmed');
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vip_recharge_notice ON payment_orders;
CREATE TRIGGER vip_recharge_notice AFTER UPDATE OF status ON payment_orders FOR EACH ROW EXECUTE FUNCTION notify_vip_recharge();
