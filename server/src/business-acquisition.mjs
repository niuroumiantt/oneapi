import qrcode from 'qrcode-generator';
import { HttpError, hasBusiness, id } from './core.mjs';

// All acquisition reads are scoped at SQL level. A finance switch alone does not
// grant access to another employee's leads or direct-sale codes.
export function acquisitionRoutes(app,pool,requireStaff,cfg) {
 const check=req=>{if(!hasBusiness(req.staff))throw new HttpError(403,'需要商务权限');};
 const admin=req=>req.staff.role==='platform_admin';
 app.get('/api/staff/business/acquisition',requireStaff,async(req,res)=>{
  check(req);
  const query=typeof req.query.q==='string'?req.query.q.trim():'';
  if(query.length>120)throw new HttpError(400,'搜索内容最多 120 字');
  const args=[admin(req),req.staff.subject,query];
  const [grants,orders,partners,codes,vipOrders,owners]=await Promise.all([
   pool.query(`SELECT d.*,s.name AS created_by_name,
    CASE WHEN now()>=d.ends_at THEN 'expired' WHEN d.status<>'active' THEN d.status WHEN now()<d.starts_at THEN 'scheduled' ELSE 'active' END AS state,
    coalesce(x.paid_fen,0)::text AS paid_fen,coalesce(x.refunded_fen,0)::text AS refunded_fen,coalesce(x.customers,0)::int AS customers
    FROM discount_grants d JOIN staff_members s ON s.subject=d.created_by
    LEFT JOIN LATERAL (SELECT sum(o.amount_fen) FILTER(WHERE o.status='paid') AS paid_fen,
     sum(o.refunded_fen) FILTER(WHERE o.status='paid') AS refunded_fen,count(DISTINCT o.account_id) FILTER(WHERE o.status='paid') AS customers
     FROM payment_orders o WHERE o.discount_snapshot->>'grant_id'=d.id::text) x ON true
    WHERE d.business_line='direct' AND ($1 OR d.created_by=$2) AND ($3='' OR d.promo_code ILIKE '%'||$3||'%' OR d.name ILIKE '%'||$3||'%' OR s.name ILIKE '%'||$3||'%') ORDER BY d.created_at DESC LIMIT 501`,args),
   pool.query(`SELECT o.id,o.out_trade_no,o.amount_fen::text,o.face_fen::text,o.refunded_fen::text,o.status,o.created_at,o.paid_at,
    o.account_id,coalesce(org.name,u.name) AS customer_name,d.promo_code,d.customer_price_percent,d.created_by,s.name AS owner_name
    FROM payment_orders o JOIN discount_grants d ON d.id::text=o.discount_snapshot->>'grant_id'
    JOIN staff_members s ON s.subject=d.created_by JOIN billing_accounts a ON a.id=o.account_id
    LEFT JOIN "user" u ON u.id=a.owner_id LEFT JOIN organizations org ON org.id=a.organization_id
    WHERE d.business_line='direct' AND ($1 OR d.created_by=$2) AND ($3='' OR o.out_trade_no=$3 OR d.promo_code ILIKE '%'||$3||'%' OR coalesce(org.name,u.name) ILIKE '%'||$3||'%' OR s.name ILIKE '%'||$3||'%') ORDER BY o.created_at DESC LIMIT 501`,args),
   pool.query(`SELECT p.id,p.legal_name,p.public_code,p.status,p.owner_subject,s.name AS owner_name,p.next_contact_on,p.promotion_trial_until,
    EXISTS(SELECT 1 FROM cw_contracts k WHERE k.partner_id=p.id AND k.expires_at>now()) AS verified,
    (SELECT count(*)::int FROM vip_payment_discount_requests r WHERE r.partner_id=p.id AND r.status='pending') AS discount_pending,
    (SELECT count(*)::int FROM vip_activation_exceptions e WHERE e.partner_id=p.id AND e.status='pending') AS exception_pending,
    coalesce(x.paid_fen,0)::text AS paid_fen,coalesce(x.refunded_fen,0)::text AS refunded_fen
    FROM cw_partners p LEFT JOIN staff_members s ON s.subject=p.owner_subject
    LEFT JOIN LATERAL(SELECT sum(o.amount_fen) AS paid_fen,sum(o.refunded_fen) AS refunded_fen FROM billing_accounts a
      JOIN payment_orders o ON o.account_id=a.id WHERE a.owner_id=p.user_id AND o.status='paid'
      AND EXISTS(SELECT 1 FROM billing_ledger l WHERE l.reference_id=o.id::text AND l.kind='recharge')) x ON true
    WHERE ($1 OR p.owner_subject=$2) AND ($3='' OR p.legal_name ILIKE '%'||$3||'%' OR p.public_code ILIKE '%'||$3||'%' OR s.name ILIKE '%'||$3||'%') ORDER BY p.created_at DESC LIMIT 501`,args),
   pool.query(`SELECT k.id,k.code,k.name,k.status,k.customer_price_percent,k.commission_bps,k.starts_at,k.ends_at,p.id AS partner_id,
    p.legal_name,p.public_code,p.owner_subject,s.name AS owner_name,
    CASE WHEN k.ends_at<=now() THEN 'expired' WHEN k.status<>'active' THEN k.status WHEN p.status<>'active' THEN 'ineligible'
      WHEN (p.promotion_trial_until>now() OR EXISTS(SELECT 1 FROM cw_contracts z WHERE z.partner_id=p.id AND z.expires_at>now())) IS NOT TRUE THEN 'ineligible'
      WHEN k.starts_at>now() THEN 'scheduled' ELSE 'active' END AS state,
    coalesce(x.paid_fen,0)::text AS paid_fen,coalesce(x.expected_fen,0)::text AS expected_fen,coalesce(x.unlocked_fen,0)::text AS unlocked_fen
    FROM cw_codes k JOIN cw_partners p ON p.id=k.partner_id LEFT JOIN staff_members s ON s.subject=p.owner_subject
    LEFT JOIN LATERAL(SELECT sum(c.cash_fen) AS paid_fen,sum(c.expected_fen) AS expected_fen,sum(c.unlocked_fen) AS unlocked_fen
      FROM cw_commissions c WHERE c.code_id=k.id) x ON true
    WHERE NOT k.is_self_code AND ($1 OR p.owner_subject=$2) AND ($3='' OR k.code ILIKE '%'||$3||'%' OR p.legal_name ILIKE '%'||$3||'%' OR s.name ILIKE '%'||$3||'%') ORDER BY k.created_at DESC LIMIT 501`,args),
   pool.query(`SELECT o.out_trade_no,o.amount_fen::text,o.refunded_fen::text,o.paid_at,k.code,p.id AS partner_id,p.legal_name,p.owner_subject,
    u.name AS customer_name,c.expected_fen::text,c.unlocked_fen::text
    FROM cw_commissions c JOIN payment_orders o ON o.id=c.order_id JOIN cw_codes k ON k.id=c.code_id JOIN cw_partners p ON p.id=c.partner_id
    JOIN "user" u ON u.id=o.created_by WHERE ($1 OR p.owner_subject=$2) AND ($3='' OR o.out_trade_no=$3 OR k.code ILIKE '%'||$3||'%' OR u.name ILIKE '%'||$3||'%' OR p.legal_name ILIKE '%'||$3||'%') ORDER BY o.paid_at DESC LIMIT 501`,args),
   admin(req)?pool.query("SELECT subject,name FROM staff_members WHERE status='active' AND role<>'pending' ORDER BY name"):{rows:[]},
  ]);
  res.set('Cache-Control','no-store').json({administrator:admin(req),me:req.staff.subject,owners:owners.rows,
   grants:grants.rows.slice(0,500),orders:orders.rows.slice(0,500),partners:partners.rows.slice(0,500),codes:codes.rows.slice(0,500),vip_orders:vipOrders.rows.slice(0,500),
   truncated:[grants,orders,partners,codes,vipOrders].some(x=>x.rows.length>500)});
 });
 app.get('/api/staff/business/direct-codes/:grant/qr',requireStaff,async(req,res)=>{
  check(req);
  const g=(await pool.query("SELECT promo_code FROM discount_grants WHERE id=$1 AND business_line='direct' AND ($2 OR created_by=$3)",[id(req.params.grant),admin(req),req.staff.subject])).rows[0];
  if(!g)throw new HttpError(404,'折扣码不存在或不属于你');
  const q=qrcode(0,'M');q.addData(cfg.origin+'/?cw='+encodeURIComponent(g.promo_code)+'#billing/personal');q.make();
  res.set('Cache-Control','no-store').type('image/svg+xml').send(q.createSvgTag({cellSize:4,margin:4,scalable:true}));
 });
}
