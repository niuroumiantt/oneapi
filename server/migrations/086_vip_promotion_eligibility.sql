ALTER TABLE cw_partners ADD COLUMN IF NOT EXISTS promotion_trial_until timestamptz;

CREATE OR REPLACE FUNCTION enable_eligible_cw_promotions(target_partner uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
AS $$
  WITH eligible AS (
    SELECT p.id, greatest(p.promotion_trial_until, max(k.expires_at)) AS expires_at
      FROM cw_partners p LEFT JOIN cw_contracts k ON k.partner_id=p.id
     WHERE p.status='active' AND (target_partner IS NULL OR p.id=target_partner)
     GROUP BY p.id
    HAVING greatest(p.promotion_trial_until, max(k.expires_at)) > statement_timestamp()
  ), enabled AS (
    UPDATE cw_codes c SET status='active', starts_at=statement_timestamp(), ends_at=e.expires_at
      FROM eligible e
     WHERE c.partner_id=e.id AND c.status='pending' AND NOT c.is_self_code
       AND NOT EXISTS(SELECT 1 FROM discount_grants d WHERE upper(d.promo_code)=c.code)
       AND NOT EXISTS(SELECT 1 FROM vip_task_codes t WHERE t.code=c.code)
    RETURNING c.id
  )
  SELECT count(*)::int FROM enabled;
$$;

SELECT enable_eligible_cw_promotions();
