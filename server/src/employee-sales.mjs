import { HttpError, hasBusiness } from './core.mjs';
import { ticketScope } from './staff-policy.mjs';

// A VIP's personal wallet belongs to the VIP channel. Enterprise wallets remain
// customer wallets. Attribution follows the current CRM/VIP owner, not the payer.
const vipAccount = alias => `(${alias}.status<>'rejected' OR ${alias}.activated_at IS NOT NULL)`;
const scopedMetrics = `
 WITH vips AS MATERIALIZED (
  SELECT p.id,p.user_id,p.activated_at FROM cw_partners p
  WHERE p.owner_subject=$1 AND ${vipAccount('p')}
 ), ordinary AS MATERIALIZED (
  SELECT c.id,c.user_id,c.organization_id FROM customers c WHERE c.owner_subject=$1
   AND NOT EXISTS (SELECT 1 FROM cw_partners p WHERE p.user_id=c.user_id AND ${vipAccount('p')})
 ), wallets AS MATERIALIZED (
  SELECT a.id,'customer' AS channel FROM ordinary c JOIN billing_accounts a ON a.owner_id=c.user_id
  UNION ALL SELECT a.id,'customer' FROM ordinary c JOIN billing_accounts a ON a.organization_id=c.organization_id
  UNION ALL SELECT a.id,'vip' FROM vips p JOIN billing_accounts a ON a.owner_id=p.user_id
 ), events AS (
  SELECT w.channel,l.created_at AS at,'revenue' AS metric,l.amount_fen::numeric/100 AS amount
  FROM wallets w JOIN billing_ledger l ON l.account_id=w.id AND l.kind='recharge'
  UNION ALL
  SELECT w.channel,r.completed_at,'revenue',-r.amount_fen::numeric/100
  FROM wallets w JOIN payment_orders o ON o.account_id=w.id
   JOIN payment_refunds r ON r.order_id=o.id AND r.status='succeeded'
  UNION ALL
  SELECT w.channel,coalesce(c.settled_at,c.finished_at,c.created_at),'spend',c.charged_yuan
  FROM wallets w JOIN customer_calls c ON c.account_id=w.id WHERE c.status='settled' AND c.charged_yuan>0
  UNION ALL
  SELECT 'customer',min(o.paid_at),'acquired',1
  FROM wallets w JOIN payment_orders o ON o.account_id=w.id AND o.status='paid'
   JOIN discount_grants d ON d.id::text=o.discount_snapshot->>'grant_id' AND d.business_line='direct' AND d.created_by=$1
  WHERE w.channel='customer' AND o.paid_at IS NOT NULL
   AND EXISTS (SELECT 1 FROM billing_ledger l WHERE l.account_id=w.id AND l.kind='recharge' AND l.reference_id=o.id::text)
   AND o.amount_fen > coalesce((SELECT sum(r.amount_fen) FROM payment_refunds r WHERE r.order_id=o.id AND r.status='succeeded'),0)
  GROUP BY w.id
  UNION ALL SELECT 'vip',p.activated_at,'acquired',1 FROM vips p WHERE p.activated_at IS NOT NULL
  UNION ALL SELECT 'customer',d.created_at,'codes',1 FROM discount_grants d
   WHERE d.created_by=$1 AND d.business_line='direct' AND d.promo_code IS NOT NULL AND d.status IN ('active','revoked')
  UNION ALL SELECT 'vip',i.created_at,'codes',1 FROM vip_invite_codes i WHERE i.created_by=$1
 ), localized AS (
  SELECT channel,metric,amount,at AT TIME ZONE 'Asia/Shanghai' AS ts
  FROM events WHERE at<=statement_timestamp()
 ), calendar AS (
  SELECT statement_timestamp() AT TIME ZONE 'Asia/Shanghai' AS now_local
 ), buckets AS (
  SELECT 'today' AS period,date_bin('4 hours',ts,date_trunc('day',now_local)) AS bucket,channel,metric,amount
  FROM localized,calendar WHERE ts>=date_trunc('day',now_local)
  UNION ALL
  SELECT 'month',date_bin('7 days',ts,date_trunc('month',now_local)),channel,metric,amount
  FROM localized,calendar WHERE ts>=date_trunc('month',now_local)
  UNION ALL
  SELECT 'all',greatest(date_trunc('month',ts),date_trunc('month',now_local)-interval '6 months'),channel,metric,amount
  FROM localized,calendar
 )
 SELECT period,to_char(bucket,'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
  period='all' AND bucket=date_trunc('month',now_local)-interval '6 months' AS earlier,
  channel,metric,sum(amount)::text AS amount,to_char(now_local,'YYYY-MM-DD') AS snapshot_day
 FROM buckets CROSS JOIN calendar
 GROUP BY period,bucket,earlier,channel,metric,snapshot_day ORDER BY period,bucket
`;

const scopedQueue = `
 WITH tasks AS (
  SELECT 'ticket:'||t.id AS id,t.id AS record_id,
   CASE t.category WHEN 'complaint' THEN 'complaint' WHEN 'feedback' THEN 'feedback' ELSE 'request' END AS kind,
   t.subject,u.name AS customer,left(t.body,500) AS context,
   CASE WHEN t.status='closed' THEN 'closed' WHEN t.tier='technical' THEN 'technical' ELSE 'action' END AS status,
   CASE WHEN t.status='closed' THEN '客户工单已关闭。' WHEN t.tier='technical' THEN '等待技术反馈，随后联系客户。' ELSE '查看工单并回复客户。' END AS next,
   NULL::date AS due,t.updated_at AS updated,t.created_at,'ticket' AS destination
  FROM support_tickets t JOIN "user" u ON u.id=t.user_id WHERE ${ticketScope('t','false','$1')}
  UNION ALL
  SELECT 'vip:'||p.id,p.id,'vip',
   CASE p.status WHEN 'pending' THEN 'VIP 申请待面试' WHEN 'confirmed' THEN 'VIP 转正待跟进'
    WHEN 'active' THEN 'VIP 已开通' ELSE 'VIP 申请未通过' END,
   p.legal_name,'',
   CASE WHEN p.status IN ('pending','confirmed') THEN 'action' ELSE 'closed' END,
   CASE p.status WHEN 'pending' THEN '核对申请信息并安排面试。' WHEN 'confirmed' THEN '核对转正条件与付款记录。'
    WHEN 'active' THEN '已开通正式 VIP。' ELSE '在 VIP 档案查看申请结果。' END,
   CASE WHEN p.status IN ('pending','confirmed') THEN p.next_contact_on END,
   coalesce(p.activated_at,p.created_at),p.created_at,'vip'
  FROM cw_partners p WHERE p.owner_subject=$1 AND p.status<>'suspended'
   AND (p.status<>'confirmed' OR NOT EXISTS (SELECT 1 FROM vip_activation_exceptions r WHERE r.partner_id=p.id AND r.status='pending'))
  UNION ALL
  SELECT 'vip-exception:'||r.id,p.id,'vip','VIP 转正特批',p.legal_name,r.request_reason,
   CASE WHEN r.status='pending' THEN 'review' ELSE 'closed' END,
   CASE WHEN r.status='pending' THEN '等待老板审批；有结果后联系客户。' ELSE coalesce(r.decision_reason,'查看 VIP 档案中的处理结果。') END,
   NULL,coalesce(r.decided_at,r.created_at),r.created_at,'vip'
  FROM vip_activation_exceptions r JOIN cw_partners p ON p.id=r.partner_id WHERE p.owner_subject=$1
  UNION ALL
  SELECT 'vip-discount:'||r.id,p.id,'discount','VIP 付款折扣申请',p.legal_name,r.reason,
   CASE WHEN r.status='pending' THEN 'review' ELSE 'closed' END,
   CASE WHEN r.status='pending' THEN '等待老板审批；有结果后联系客户。' ELSE coalesce(nullif(r.decision_note,''),'查看 VIP 档案中的处理结果。') END,
   NULL,coalesce(r.decided_at,r.created_at),r.created_at,'vip'
  FROM vip_payment_discount_requests r JOIN cw_partners p ON p.id=r.partner_id WHERE p.owner_subject=$1
  UNION ALL
  SELECT 'discount:'||d.id,d.id,'discount',d.name,coalesce(d.promo_code,''),d.reason,
   CASE WHEN d.status='pending' AND d.ends_at>now() THEN 'review' ELSE 'closed' END,
   CASE WHEN d.status='pending' AND d.ends_at>now() THEN '等待老板审批。'
    WHEN d.status='pending' THEN '申请已过有效期，可重新提交。'
    ELSE coalesce(nullif(d.decision_note,''),'查看客户推广申请中的处理结果。') END,
   NULL,coalesce(d.decided_at,d.created_at),d.created_at,'discount'
  FROM discount_grants d WHERE d.created_by=$1 AND d.business_line='direct'
   AND (d.status IN ('pending','rejected') OR d.customer_price_percent<>50 OR d.non_refundable OR d.min_cash_fen>0)
 ), ordered AS (
  SELECT *,count(*) OVER()::int AS total_count,count(*) FILTER (WHERE status='action') OVER()::int AS action_count
  FROM tasks
 )
 SELECT id,record_id,kind,subject,customer,context,status,next,
  to_char(due,'YYYY-MM-DD') AS due,to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS submitted,
  destination,total_count,action_count
 FROM ordered ORDER BY (status='closed'),due ASC NULLS LAST,updated DESC,id LIMIT 300
`;

const fields = {
 customer:{ revenue:'customerRevenue',spend:'customerSpend',acquired:'customers',codes:'customerCodes' },
 vip:{ revenue:'vipRevenue',spend:'vipSpend',acquired:'vips',codes:'vipCodes' }
};
const blank = () => ({ customerRevenue:0,vipRevenue:0,customerSpend:0,vipSpend:0,customers:0,vips:0,customerCodes:0,vipCodes:0 });
const shanghaiDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
function label({period,bucket,earlier},snapshotDay) {
 const day=bucket.slice(0,10);
 if(period==='today'){
  const hour=Number(bucket.slice(11,13));
  return `${bucket.slice(11,16)}–${String(hour+4).padStart(2,'0')}:00`;
 }
 if(period==='all')return earlier?`${day.slice(0,7)} 及以前`:day.slice(0,7);
 const start=Number(day.slice(8,10));
 return `${day.slice(5,7)}.${day.slice(8,10)}–${Math.min(start+6,Number(snapshotDay.slice(8,10)))}`;
}

export async function loadEmployeeSales(pool, subject) {
 const [metrics,queue]=await Promise.all([pool.query(scopedMetrics,[subject]),pool.query(scopedQueue,[subject])]);
 const snapshotDay=metrics.rows[0]?.snapshot_day||shanghaiDay.format(new Date());
 const buckets={ today:new Map(),month:new Map(),all:new Map() };
 for(const row of metrics.rows){
  const bucket=buckets[row.period];
  if(!bucket.has(row.bucket))bucket.set(row.bucket,{...blank(),label:label(row,snapshotDay)});
  bucket.get(row.bucket)[fields[row.channel][row.metric]]=Number(row.amount);
 }
 const periods=Object.fromEntries(Object.entries(buckets).map(([key,bucket])=>[key,[...bucket.values()]]));
 const tasks=queue.rows.map(({ total_count,action_count,...task })=>task);
 return {snapshotDay,periods,tasks,actionCount:queue.rows[0]?.action_count||0,truncated:(queue.rows[0]?.total_count||0)>tasks.length};
}

export function employeeSalesRoutes(app,pool,requireStaff) {
 app.get('/api/staff/business/sales',requireStaff,async(req,res)=>{
  if(!hasBusiness(req.staff))throw new HttpError(403,'需要业务运营权限');
  res.set('Cache-Control','no-store').json(await loadEmployeeSales(pool,req.staff.subject));
 });
}
