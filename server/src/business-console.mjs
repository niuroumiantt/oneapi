import {addPack} from './pack-ledger.mjs';
// Business console: the owner's and finance's view of the company (revenue, cost, margin, invoices),
// supplier and customer codes with a light CRM, discount grants, and first-line support.
import { HttpError, id, text, transaction, audit, hasBusiness } from './core.mjs';
import { OFFICIAL_MODELS } from './official-models.mjs';
import { isManager } from './organizations.mjs';
import { REFUND_POLICY_ZH } from './list-credit.mjs';

export const hasFinance = staff => hasBusiness(staff) && (staff.role === 'platform_admin' || staff.finance_access === true);
const isAdmin = staff => staff?.status === 'active' && staff.role === 'platform_admin';
function requireBusiness(req) { if (!hasBusiness(req.staff)) throw new HttpError(403, '需要业务运营权限'); }
export function requireFinance(req) { if (!hasFinance(req.staff)) throw new HttpError(403, '需要财务权限'); }

export const STAGES = ['new', 'following', 'key', 'risk', 'lost'];
export const CATEGORIES = ['question', 'billing', 'invoice', 'bug', 'feedback'];
const METHODS = ['bank', 'alipay', 'wechat', 'card', 'other'];
const TAX_NUMBER = /^[0-9A-Z]{15,20}$/;

/** "12.5" yuan to fen. Money never passes through floating point. */
export function fen(value, label, maxYuan = 100000000) {
 const raw = String(value ?? '').trim();
 if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(raw)) throw new HttpError(400, `${label}需为最多两位小数的人民币金额`);
 const [whole, decimal = ''] = raw.split('.'), amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
 if (amount < 1 || amount > maxYuan * 100) throw new HttpError(400, `${label}超出允许范围`);
 return amount;
}
function day(value, label) {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) throw new HttpError(400, `${label}不正确`);
 return value;
}
function instant(value, label) {
 const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(value) : null;
 if (!d || !Number.isFinite(d.getTime())) throw new HttpError(400, `${label}不正确`);
 return d;
}
function optional(value, label, max) {
 if (value === undefined || value === null || value === '') return '';
 if (typeof value !== 'string' || value.trim().length > max) throw new HttpError(400, `${label}格式不正确`);
 return value.trim();
}
function choice(value, allowed, label) {
 if (!allowed.includes(value)) throw new HttpError(400, `${label}不正确`);
 return value;
}
/** Accounting month in Beijing time, "YYYY-MM". Defaults to the current month. */
export function accountingMonth(value, now = new Date()) {
 if (value === undefined || value === '') return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7);
 if (typeof value !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) throw new HttpError(400, '月份不正确');
 return value;
}
/** Tags double as customer segments, so they are normalised: trimmed, unique, at most 10 of 30 characters. */
export function tagList(value) {
 if (!Array.isArray(value) || value.length > 10) throw new HttpError(400, '标签最多 10 个');
 const tags = [...new Set(value.map(t => typeof t === 'string' ? t.trim() : ''))];
 if (tags.some(t => !t || t.length > 30 || /[,，\s]/.test(t))) throw new HttpError(400, '标签须为 1–30 个字，且不含空格和逗号');
 return tags;
}
/** What a customer may still be invoiced: money actually received, less refunds, less invoices already requested or issued. */
export const invoiceable = ({ recharged_fen, refunded_fen, invoiced_fen }) => Number(recharged_fen) - Number(refunded_fen) - Number(invoiced_fen);

const SH = "AT TIME ZONE 'Asia/Shanghai'";
const AMOUNT = "CASE WHEN x.evidence->>'amount' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (x.evidence->>'amount')::numeric ELSE 0 END";
// $1 is the accounting month. Upstream bills can land a little outside the call's own timestamp, so the join window is a day wider.
const RANGE = `r AS (SELECT ($1||'-01')::timestamp ${SH} AS a,(($1||'-01')::timestamp+interval '1 month') ${SH} AS z)`;
// The same upstream request can be stored under two credentials that hold one secret: count each request once.
const BILLS = `u AS (SELECT DISTINCT ON (x.request_id) x.request_id,x.occurred_at,s.canonical_supplier_id AS supplier_id,${AMOUNT} AS amt
 FROM supplier_usage_records x JOIN supplier_lab_credentials c ON c.id=x.credential_id JOIN supplier_lab_suppliers s ON s.id=c.supplier_id,r
 WHERE x.occurred_at>=r.a-interval '1 day' AND x.occurred_at<r.z+interval '1 day' ORDER BY x.request_id,x.updated_at DESC)`;
// Every customer-facing call in the month. list_yuan is what the call was charged at list price; fallback is used as cost when no upstream bill matches.
const CALLS = `calls AS (
 SELECT e.model_id,e.owner_id AS user_id,a.organization_id,e.status='failed' AS failed,e.settled_at IS NOT NULL AS settled,coalesce(e.charged_yuan,0) AS list_yuan,e.actual_yuan AS fallback,e.upstream_request_id AS rid,coalesce(e.input_tokens,0)+coalesce(e.output_tokens,0) AS tokens
  FROM employee_calls e JOIN employee_credit_accounts a ON a.user_id=e.owner_id,r WHERE e.created_at>=r.a AND e.created_at<r.z
 UNION ALL
 SELECT e.model_id,e.owner_id,a.organization_id,e.status='failed',e.settled_at IS NOT NULL,0,e.actual_yuan,e.upstream_request_id,coalesce(e.input_tokens,0)+coalesce(e.output_tokens,0)
  FROM customer_calls e JOIN billing_accounts a ON a.id=e.account_id,r WHERE e.created_at>=r.a AND e.created_at<r.z
 UNION ALL
 SELECT p.model_id,p.owner_id,NULL::uuid,p.status='failed',p.status='succeeded',0,p.estimated_upstream_yuan,p.upstream_request_id,coalesce(p.input_tokens,0)+coalesce(p.output_tokens,0)
  FROM pilot_calls p,r WHERE p.created_at>=r.a AND p.created_at<r.z)`;
const COST = 'CASE WHEN c.settled THEN coalesce(u.amt,c.fallback,0) ELSE 0 END';
// An upstream bill that no customer call accounts for: acceptance tests, load tests, key checks.
const UNCLAIMED = 'NOT EXISTS (SELECT 1 FROM customer_calls c WHERE c.upstream_request_id=u.request_id) AND NOT EXISTS (SELECT 1 FROM employee_calls e WHERE e.upstream_request_id=u.request_id) AND NOT EXISTS (SELECT 1 FROM pilot_calls p WHERE p.upstream_request_id=u.request_id)';

const CUSTOMER_ROWS = `SELECT c.id,c.code,c.kind,c.stage,c.tags,c.owner_subject,sm.name AS owner_name,c.created_at,c.user_id,c.organization_id,
 coalesce(o.name,u.name) AS name,coalesce(u.email,cu.email) AS email,coalesce(u.disabled,false) AS disabled,
 (SELECT count(*) FROM memberships m WHERE m.organization_id=c.organization_id AND m.status='active')::int AS members,
 (SELECT string_agg(g.name,'、') FROM memberships m JOIN organizations g ON g.id=m.organization_id WHERE m.user_id=c.user_id AND m.status='active') AS orgs,
 coalesce(b.cash_balance_fen,0)::bigint AS balance_fen,
 coalesce(b.list_credit_fen,0)::bigint AS list_credit_fen,
 coalesce((SELECT sum(l.amount_fen) FROM billing_ledger l WHERE l.account_id=b.id AND l.kind='recharge'),0)::bigint AS recharged_fen,
 credit.granted AS credit_granted,credit.spent AS credit_spent,used.calls_30d,used.last_call_at,
 (SELECT count(*) FROM support_tickets t WHERE t.status<>'closed' AND (t.user_id=c.user_id OR t.user_id IN (SELECT m.user_id FROM memberships m WHERE m.organization_id=c.organization_id AND m.status='active')))::int AS open_tickets
 FROM customers c LEFT JOIN organizations o ON o.id=c.organization_id LEFT JOIN "user" u ON u.id=c.user_id LEFT JOIN "user" cu ON cu.id=o.created_by
 LEFT JOIN staff_members sm ON sm.subject=c.owner_subject
 LEFT JOIN billing_accounts b ON (b.organization_id=c.organization_id OR b.owner_id=c.user_id)
 LEFT JOIN LATERAL (SELECT coalesce(sum(a.granted_yuan),0) AS granted,coalesce(sum(a.spent_yuan),0) AS spent FROM employee_credit_accounts a WHERE a.organization_id=c.organization_id OR a.user_id=c.user_id) credit ON true
 LEFT JOIN LATERAL (SELECT count(*)::int AS calls_30d,max(e.created_at) AS last_call_at FROM employee_calls e WHERE e.created_at>=now()-interval '30 days'
  AND (e.owner_id=c.user_id OR e.owner_id IN (SELECT a.user_id FROM employee_credit_accounts a WHERE a.organization_id=c.organization_id))) used ON true`;
// Dates are sent as plain YYYY-MM-DD text: a JS Date would shift by the server's time zone.
const INVOICE_ROWS = `SELECT i.*,to_char(i.issued_on,'YYYY-MM-DD') AS issued_day,c.code AS customer_code,coalesce(o.name,u.name) AS customer_name,s.code AS supplier_code,s.display_name AS supplier_name,h.name AS handled_by_name
 FROM tax_invoices i LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN organizations o ON o.id=c.organization_id LEFT JOIN "user" u ON u.id=c.user_id
 LEFT JOIN suppliers s ON s.id=i.supplier_id LEFT JOIN staff_members h ON h.subject=i.handled_by`;
const DISCOUNT_ROWS = `SELECT d.*,c.code AS customer_code,coalesce(o.name,u.name) AS customer_name,a.name AS created_by_name,k.name AS decided_by_name,
 CASE WHEN d.status<>'active' THEN d.status WHEN now()<d.starts_at THEN 'scheduled' WHEN now()>=d.ends_at THEN 'expired' ELSE 'active' END AS state
 FROM discount_grants d LEFT JOIN customers c ON c.id=d.customer_id LEFT JOIN organizations o ON o.id=c.organization_id LEFT JOIN "user" u ON u.id=c.user_id
 LEFT JOIN staff_members a ON a.subject=d.created_by LEFT JOIN staff_members k ON k.subject=d.decided_by`;

// Share the account lock with refunds: a pending refund cannot be overtaken by invoice issue.
async function lockInvoiceAccount(db,customerId){
 const a=(await db.query(`SELECT b.id FROM billing_accounts b JOIN customers c ON b.owner_id=c.user_id OR b.organization_id=c.organization_id WHERE c.id=$1 FOR UPDATE OF b`,[customerId])).rows[0];
 if(a&&(await db.query("SELECT 1 FROM payment_refunds f JOIN payment_orders o ON o.id=f.order_id WHERE o.account_id=$1 AND f.status='pending'",[a.id])).rowCount)throw new HttpError(409,'退款处理中，请完成退款后再申请或开具发票');
}

/** Money received and already invoiced for one customer. Pending refunds count as refunded, to stay on the safe side. */
async function invoiceLimit(db, customerId) {
 const row = (await db.query(`SELECT
  coalesce((SELECT sum(l.amount_fen) FROM billing_ledger l WHERE l.account_id=b.id AND l.kind='recharge'),0)::bigint AS recharged_fen,
  coalesce((SELECT sum(f.amount_fen) FROM payment_refunds f JOIN payment_orders p ON p.id=f.order_id WHERE p.account_id=b.id AND f.status IN ('succeeded','pending')),0)::bigint AS refunded_fen,
  coalesce((SELECT sum(i.amount_fen) FROM tax_invoices i WHERE i.customer_id=c.id AND i.direction='output' AND i.status IN ('requested','issued')),0)::bigint AS invoiced_fen
  FROM customers c LEFT JOIN billing_accounts b ON (b.organization_id=c.organization_id OR b.owner_id=c.user_id) WHERE c.id=$1`, [customerId])).rows[0];
 return { ...row, available_fen: Math.max(0, invoiceable(row)) };
}

async function monthFinance(pool, month) {
 const [totals, byProduct, byCustomer, bySupplier, balances] = await Promise.all([
  pool.query(`WITH ${RANGE},${BILLS},${CALLS}
   SELECT (SELECT coalesce(-sum(l.amount_fen),0)/100.0 FROM billing_ledger l,r WHERE l.kind='usage' AND l.created_at>=r.a AND l.created_at<r.z) AS cash_revenue,
    (SELECT coalesce(sum(l.amount_fen),0)/100.0 FROM billing_ledger l,r WHERE l.kind='recharge' AND l.created_at>=r.a AND l.created_at<r.z) AS received,
    (SELECT coalesce(sum(f.amount_fen),0)/100.0 FROM payment_refunds f,r WHERE f.status='succeeded' AND f.completed_at>=r.a AND f.completed_at<r.z) AS refunded,
    (SELECT coalesce(sum(o.channel_fee_fen),0)/100.0 FROM payment_orders o,r WHERE o.status='paid' AND o.paid_at>=r.a AND o.paid_at<r.z) AS channel_cost,
    (SELECT count(*) FROM payment_orders o,r WHERE o.status='paid' AND (o.channel_fee_fen IS NULL OR o.channel_fee_issue IS NOT NULL) AND o.paid_at>=r.a AND o.paid_at<r.z) AS channel_unreconciled,
    (SELECT coalesce(sum(p.amount_fen),0)/100.0 FROM supplier_payments p,r WHERE p.voided_at IS NULL AND p.paid_on>=(r.a ${SH})::date AND p.paid_on<(r.z ${SH})::date) AS supplier_paid,
    (SELECT coalesce(sum(i.amount_fen),0)/100.0 FROM tax_invoices i,r WHERE i.direction='output' AND i.status='issued' AND i.issued_on>=(r.a ${SH})::date AND i.issued_on<(r.z ${SH})::date) AS invoiced,
    (SELECT coalesce(sum(u.amt),0) FROM u,r WHERE u.occurred_at>=r.a AND u.occurred_at<r.z AND ${UNCLAIMED}) AS other_cost,
    (SELECT json_build_object('calls',count(*),'list_yuan',coalesce(sum(c.list_yuan),0),'cost',coalesce(sum(${COST}),0),'unmatched',count(*) FILTER(WHERE c.settled AND u.request_id IS NULL),'estimated',coalesce(sum(c.fallback) FILTER(WHERE c.settled AND u.request_id IS NULL),0)) FROM calls c LEFT JOIN u ON u.request_id=c.rid) AS sales`, [month]),
  pool.query(`WITH ${RANGE},${BILLS},${CALLS}
   SELECT c.model_id,count(*)::int AS calls,count(*) FILTER(WHERE c.failed)::int AS failed,coalesce(sum(c.tokens),0)::bigint AS tokens,coalesce(sum(c.list_yuan),0) AS list_yuan,coalesce(sum(${COST}),0) AS cost
   FROM calls c LEFT JOIN u ON u.request_id=c.rid GROUP BY 1 ORDER BY 5 DESC,2 DESC`, [month]),
  pool.query(`WITH ${RANGE},${BILLS},${CALLS}
   SELECT k.id,k.code,k.kind,coalesce(o.name,w.name) AS name,count(*)::int AS calls,coalesce(sum(c.list_yuan),0) AS list_yuan,coalesce(sum(${COST}),0) AS cost
   FROM calls c LEFT JOIN u ON u.request_id=c.rid JOIN customers k ON (k.organization_id=c.organization_id OR (c.organization_id IS NULL AND k.user_id=c.user_id))
   LEFT JOIN organizations o ON o.id=k.organization_id LEFT JOIN "user" w ON w.id=k.user_id GROUP BY k.id,o.name,w.name ORDER BY 6 DESC,7 DESC LIMIT 100`, [month]),
  pool.query(`WITH ${RANGE},${BILLS}
   SELECT p.id,p.code,p.display_name,coalesce(k.requests,0)::int AS requests,coalesce(k.yuan,0) AS cost,coalesce(pay.fen,0)/100.0 AS paid
   FROM suppliers p LEFT JOIN (SELECT u.supplier_id,count(*) AS requests,sum(u.amt) AS yuan FROM u,r WHERE u.occurred_at>=r.a AND u.occurred_at<r.z GROUP BY 1) k ON k.supplier_id=p.id
   LEFT JOIN (SELECT sp.supplier_id,sum(sp.amount_fen) AS fen FROM supplier_payments sp,r WHERE sp.voided_at IS NULL AND sp.paid_on>=(r.a ${SH})::date AND sp.paid_on<(r.z ${SH})::date GROUP BY 1) pay ON pay.supplier_id=p.id
   ORDER BY p.code`, [month]),
  pool.query(`SELECT (SELECT coalesce(sum(cash_balance_fen),0)/100.0 FROM billing_accounts) AS customer_cash,
   (SELECT coalesce(sum(granted_yuan-spent_yuan),0) FROM employee_credit_accounts) AS credit_unused,
   (SELECT coalesce(sum(amount_fen),0)/100.0 FROM tax_invoices WHERE direction='output' AND status='requested') AS invoices_requested`)]);
 const t = totals.rows[0], n = v => Number(v || 0), sales = t.sales, names = new Map(OFFICIAL_MODELS.map(m => [m.id, m.name]));
 // Upstream cost = what customer calls cost us (their bill, or list price when the upstream sends none) + bills nobody's call explains.
 const revenue = n(t.cash_revenue), salesCost = n(sales.cost), otherCost = n(t.other_cost), cost = salesCost + otherCost, list = n(sales.list_yuan);
 return {
  month,
  // Recognised revenue is cash actually charged for usage. Internal credit is shown at list price but is not revenue.
  accrual: { revenue, channel_cost:n(t.channel_cost),channel_unreconciled:n(t.channel_unreconciled),operating_profit:revenue-cost-n(t.channel_cost), credit_list: list, upstream_cost: cost, sales_cost: salesCost, other_cost: otherCost, estimated_cost: n(sales.estimated), gross_profit: revenue - cost, list_margin: list + revenue > 0 ? (list + revenue - salesCost) / (list + revenue) : null, calls: n(sales.calls), unmatched_calls: n(sales.unmatched) },
  cash: { received: n(t.received), refunded: n(t.refunded), supplier_paid: n(t.supplier_paid),channel_cost:n(t.channel_cost), net: n(t.received) - n(t.refunded) - n(t.supplier_paid) - n(t.channel_cost), invoiced: n(t.invoiced) },
  balances: { customer_cash: n(balances.rows[0].customer_cash), credit_unused: n(balances.rows[0].credit_unused), invoices_requested: n(balances.rows[0].invoices_requested) },
  by_product: byProduct.rows.map(p => ({ ...p, name: names.get(p.model_id) || p.model_id })),
  by_customer: byCustomer.rows,
  by_supplier: bySupplier.rows
 };
}

async function yearSeries(pool) {
 const first = `date_trunc('month',now() ${SH})-interval '11 months'`, key = column => `to_char(${column} ${SH},'YYYY-MM')`;
 return (await pool.query(`WITH b AS (SELECT (${first}) ${SH} AS t),
  months AS (SELECT to_char(generate_series(${first},date_trunc('month',now() ${SH}),interval '1 month'),'YYYY-MM') AS month),
  u AS (SELECT DISTINCT ON (x.request_id) x.request_id,x.occurred_at,${AMOUNT} AS amt FROM supplier_usage_records x,b WHERE x.occurred_at>=b.t-interval '1 day' ORDER BY x.request_id,x.updated_at DESC),
  calls AS (SELECT e.created_at,e.upstream_request_id AS rid,e.actual_yuan AS fallback FROM employee_calls e,b WHERE e.created_at>=b.t AND e.settled_at IS NOT NULL
   UNION ALL SELECT p.created_at,p.upstream_request_id,p.estimated_upstream_yuan FROM pilot_calls p,b WHERE p.created_at>=b.t AND p.status='succeeded'),
  cost AS (SELECT q.month,sum(q.yuan) AS yuan FROM (SELECT ${key('c.created_at')} AS month,coalesce(u.amt,c.fallback,0) AS yuan FROM calls c LEFT JOIN u ON u.request_id=c.rid
   UNION ALL SELECT ${key('u.occurred_at')},u.amt FROM u,b WHERE u.occurred_at>=b.t AND ${UNCLAIMED}) q GROUP BY 1),
  credit AS (SELECT ${key('e.created_at')} AS month,sum(e.charged_yuan) AS yuan,count(*) AS calls FROM employee_calls e,b WHERE e.created_at>=b.t AND e.settled_at IS NOT NULL GROUP BY 1),
  ledger AS (SELECT ${key('l.created_at')} AS month,sum(l.amount_fen) FILTER(WHERE l.kind='recharge') AS recharge_fen,-sum(l.amount_fen) FILTER(WHERE l.kind='usage') AS usage_fen FROM billing_ledger l,b WHERE l.created_at>=b.t GROUP BY 1),
  refunds AS (SELECT ${key('f.completed_at')} AS month,sum(f.amount_fen) AS fen FROM payment_refunds f,b WHERE f.status='succeeded' AND f.completed_at>=b.t GROUP BY 1),
  paid AS (SELECT to_char(p.paid_on,'YYYY-MM') AS month,sum(p.amount_fen) AS fen FROM supplier_payments p,b WHERE p.voided_at IS NULL AND p.paid_on>=(b.t ${SH})::date GROUP BY 1)
  SELECT m.month,coalesce(l.usage_fen,0)/100.0 AS revenue,coalesce(c.yuan,0) AS credit_list,coalesce(c.calls,0)::int AS calls,coalesce(k.yuan,0) AS upstream_cost,coalesce((SELECT sum(o.channel_fee_fen)/100.0 FROM payment_orders o WHERE o.status='paid' AND to_char(o.paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM')=m.month),0) AS channel_cost,
   coalesce(l.recharge_fen,0)/100.0 AS received,coalesce(f.fen,0)/100.0 AS refunded,coalesce(p.fen,0)/100.0 AS supplier_paid
  FROM months m LEFT JOIN cost k USING(month) LEFT JOIN credit c USING(month) LEFT JOIN ledger l USING(month) LEFT JOIN refunds f USING(month) LEFT JOIN paid p USING(month) ORDER BY m.month`)).rows
  .map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'month' ? v : Number(v)])));
}

export function businessConsoleRoutes(app, pool, requireStaff) {
 const staffName = async subject => (await pool.query('SELECT name FROM staff_members WHERE subject=$1', [subject])).rows[0]?.name || null;

 app.put('/api/staff/members/:subject/finance-access', requireStaff, async (req, res) => {
  if (!isAdmin(req.staff)) throw new HttpError(403, '仅平台管理员可分配财务权限');
  const subject = text(req.params.subject, '员工标识', 120), enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') throw new HttpError(400, '请选择授权或撤销');
  await transaction(pool, async db => {
   await db.query('SELECT pg_advisory_xact_lock(148921,2)');
   if (!(await db.query("SELECT 1 FROM staff_members WHERE subject=$1 AND role='platform_admin' AND status='active'", [req.staff.subject])).rowCount) throw new HttpError(403, '权限已变化');
   if (!(await db.query("SELECT 1 FROM staff_members WHERE subject=$1 AND status='active'", [subject])).rowCount) throw new HttpError(404, '员工须先获准登录');
   if (enabled) await db.query('INSERT INTO staff_finance_access(subject,granted_by) VALUES($1,$2) ON CONFLICT(subject) DO NOTHING', [subject, req.staff.subject]);
   else await db.query('DELETE FROM staff_finance_access WHERE subject=$1', [subject]);
   await audit(db, req.actor, 'staff.finance_access_changed', null, subject, { enabled });
  });
  res.json({ ok: true });
 });

 // ---- Dashboard -------------------------------------------------------------------------------
 app.get('/api/staff/business/dashboard', requireStaff, async (req, res) => {
  requireBusiness(req);
  const finance = hasFinance(req.staff);
  await pool.query('SELECT ensure_customers()');
  const [counts, top] = await Promise.all([
   pool.query(`SELECT (SELECT count(*) FROM account_upgrade_requests WHERE status='pending')::int AS upgrades,
    (SELECT count(*) FROM support_tickets WHERE status<>'closed' AND tier='first_line')::int AS tickets,
    (SELECT count(*) FROM support_tickets WHERE status<>'closed' AND tier='technical')::int AS tickets_technical,
    (SELECT count(*) FROM discount_grants WHERE status='pending')::int AS discounts_pending,
    (SELECT count(*) FROM discount_grants WHERE status='active' AND now()>=starts_at AND now()<ends_at)::int AS discounts_active,
    (SELECT count(*) FROM tax_invoices WHERE direction='output' AND status='requested')::int AS invoices_requested,
    (SELECT count(*) FROM payment_refunds WHERE status='pending')::int AS refunds_pending,
    (SELECT count(*) FROM bank_transfer_entries WHERE status='pending')::int AS bank_transfers_pending,
    (SELECT count(*) FROM channel_states WHERE paused)::int AS models_paused,
    (SELECT count(*) FROM customers WHERE kind='enterprise')::int AS enterprises,
    (SELECT count(*) FROM customers WHERE kind='personal')::int AS individuals,
    (SELECT count(*) FROM customers WHERE created_at>=now()-interval '30 days')::int AS customers_new_30d,
    (SELECT count(DISTINCT owner_id) FROM employee_calls WHERE created_at>=now()-interval '30 days')::int AS users_active_30d,
    (SELECT count(*) FROM suppliers)::int AS suppliers`),
   pool.query(`${CUSTOMER_ROWS} WHERE used.calls_30d>0 ORDER BY used.calls_30d DESC LIMIT 5`)]);
  const c = counts.rows[0];
  if (!finance) { delete c.invoices_requested; delete c.refunds_pending; delete c.bank_transfers_pending; }
  res.json({
   staff: { name: req.staff.name, finance, technical: req.staff.role === 'platform_admin' || req.staff.technical_access === true, admin: isAdmin(req.staff) },
   counts: c, top_customers: top.rows,
   finance: finance ? { current: await monthFinance(pool, accountingMonth()), series: await yearSeries(pool) } : null
  });
 });

 // ---- Finance ---------------------------------------------------------------------------------
 app.get('/api/staff/business/finance', requireStaff, async (req, res) => {
  requireFinance(req);
  res.json({ current: await monthFinance(pool, accountingMonth(req.query.month)), series: await yearSeries(pool) });
 });

 app.get('/api/staff/business/invoices', requireStaff, async (req, res) => {
  requireFinance(req);
  const [rows, suppliers] = await Promise.all([pool.query(`${INVOICE_ROWS} ORDER BY i.status='requested' DESC,i.created_at DESC LIMIT 500`), pool.query('SELECT id,code,display_name,legal_name FROM suppliers ORDER BY code')]);
  res.json({ output: rows.rows.filter(i => i.direction === 'output'), input: rows.rows.filter(i => i.direction === 'input'), suppliers: suppliers.rows });
 });
 app.post('/api/staff/business/invoices', requireStaff, async (req, res) => {
  requireFinance(req);
  const b = req.body || {}, direction = choice(b.direction, ['output', 'input'], '发票方向'), type = choice(b.invoice_type, ['general', 'special'], '发票类型');
  const title = text(b.title, '发票抬头', 160), taxNumber = optional(b.tax_number, '税号', 30).toUpperCase(), amount = fen(b.amount_yuan, '发票金额');
  if (taxNumber && !TAX_NUMBER.test(taxNumber)) throw new HttpError(400, '税号须为 15–20 位数字或大写字母');
  if (type === 'special' && !taxNumber) throw new HttpError(400, '专用发票必须填写税号');
  const number = optional(b.invoice_number, '发票号码', 30), issuedOn = number ? day(b.issued_on, '开票日期') : null;
  if (number && number.length < 8) throw new HttpError(400, '发票号码至少 8 位');
  if (direction === 'input' && !number) throw new HttpError(400, '进项发票须填写发票号码和开票日期');
  const row = await transaction(pool, async db => {
   const target = direction === 'output' ? id(b.customer_id) : id(b.supplier_id);
   if (direction === 'output') {
    if (!(await db.query('SELECT 1 FROM customers WHERE id=$1 FOR UPDATE', [target])).rowCount) throw new HttpError(404, '客户不存在');
    await lockInvoiceAccount(db,target);
    const limit = await invoiceLimit(db, target);
    if (amount > limit.available_fen && b.allow_over_limit !== true) throw new HttpError(409, `超出可开票金额 ¥${(limit.available_fen / 100).toFixed(2)}。先票后款请勾选“允许超出实收”。`);
   } else if (!(await db.query('SELECT 1 FROM suppliers WHERE id=$1', [target])).rowCount) throw new HttpError(404, '供应商不存在');
   const created = (await db.query(`INSERT INTO tax_invoices(direction,customer_id,supplier_id,invoice_type,title,tax_number,email,amount_fen,status,invoice_number,issued_on,note,created_by_staff,handled_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,status`,
    [direction, direction === 'output' ? target : null, direction === 'input' ? target : null, type, title, taxNumber, optional(b.email, '收票邮箱', 254), amount, number ? 'issued' : 'requested', number || null, issuedOn, optional(b.note, '备注', 500), req.staff.subject, number ? req.staff.subject : null])).rows[0];
   await audit(db, req.actor, 'tax_invoice.created', null, created.id, { direction, amount_fen: amount, status: created.status });
   return created;
  }).catch(duplicateNumber);
  res.status(201).json(row);
 });
 const duplicateNumber = e => { if (e.code === '23505' && String(e.constraint).includes('tax_invoices_number')) throw new HttpError(409, '这个发票号码已经登记过'); throw e; };
 app.post('/api/staff/business/invoices/:invoice/:action', requireStaff, async (req, res) => {
  requireFinance(req);
  const invoiceId = id(req.params.invoice), action = choice(req.params.action, ['issue', 'reject', 'void', 'reverse'], '操作'), b = req.body || {};
  const row = await transaction(pool, async db => {
   const current = (await db.query('SELECT * FROM tax_invoices WHERE id=$1 FOR UPDATE', [invoiceId])).rows[0];
   if (!current) throw new HttpError(404, '发票不存在');
   let next;
   if (action === 'issue') {
    if (current.status !== 'requested') throw new HttpError(409, '只有待开票的申请可以登记开具');
    if(current.direction==='output'){
     await lockInvoiceAccount(db,current.customer_id);
     const limit=await invoiceLimit(db,current.customer_id);
     if(invoiceable(limit)<0&&b.allow_over_limit!==true)throw new HttpError(409,'退款后实收不足，请重新核对开票金额');
    }
    const number = text(b.invoice_number, '发票号码', 30);
    if (number.length < 8) throw new HttpError(400, '发票号码至少 8 位');
    next = (await db.query("UPDATE tax_invoices SET status='issued',invoice_number=$2,issued_on=$3,handled_by=$4,updated_at=now() WHERE id=$1 RETURNING id,status", [invoiceId, number, day(b.issued_on, '开票日期'), req.staff.subject])).rows[0];
   } else if (action === 'reject') {
    if (current.status !== 'requested') throw new HttpError(409, '只有待开票的申请可以退回');
    next = (await db.query("UPDATE tax_invoices SET status='rejected',note=$2,handled_by=$3,updated_at=now() WHERE id=$1 RETURNING id,status", [invoiceId, text(b.note, '退回原因', 500), req.staff.subject])).rows[0];
   } else {
    // A voided or red-reversed invoice gives its amount back to the customer's invoiceable balance.
    if (current.status !== 'issued') throw new HttpError(409, '只有已开具的发票可以作废或红冲');
    next = (await db.query('UPDATE tax_invoices SET status=$2,note=$3,handled_by=$4,updated_at=now() WHERE id=$1 RETURNING id,status', [invoiceId, action === 'void' ? 'voided' : 'reversed', text(b.note, '原因', 500), req.staff.subject])).rows[0];
   }
   await audit(db, req.actor, 'tax_invoice.' + next.status, null, invoiceId);
   return next;
  }).catch(duplicateNumber);
  res.json(row);
 });

 app.get('/api/staff/business/supplier-payments', requireStaff, async (req, res) => {
  requireFinance(req);
  const [payments, suppliers] = await Promise.all([
   pool.query(`SELECT p.*,to_char(p.paid_on,'YYYY-MM-DD') AS paid_day,s.code AS supplier_code,s.display_name AS supplier_name,m.name AS created_by_name FROM supplier_payments p JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN staff_members m ON m.subject=p.created_by ORDER BY p.paid_on DESC,p.created_at DESC LIMIT 500`),
   pool.query(`SELECT s.id,s.code,s.display_name,coalesce((SELECT sum(p.amount_fen) FROM supplier_payments p WHERE p.supplier_id=s.id AND p.voided_at IS NULL),0)::bigint AS paid_fen,
    coalesce((SELECT sum(i.amount_fen) FROM tax_invoices i WHERE i.supplier_id=s.id AND i.status='issued'),0)::bigint AS invoiced_fen FROM suppliers s ORDER BY s.code`)]);
  res.json({ payments: payments.rows, suppliers: suppliers.rows });
 });
 app.post('/api/staff/business/supplier-payments', requireStaff, async (req, res) => {
  requireFinance(req);
  const b = req.body || {}, supplier = id(b.supplier_id), amount = fen(b.amount_yuan, '付款金额'), paidOn = day(b.paid_on, '付款日期'), method = choice(b.method, METHODS, '付款方式');
  if (paidOn > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw new HttpError(400, '付款日期不能晚于今天');
  const row = await transaction(pool, async db => {
   if (!(await db.query('SELECT 1 FROM suppliers WHERE id=$1', [supplier])).rowCount) throw new HttpError(404, '供应商不存在');
   const created = (await db.query('INSERT INTO supplier_payments(supplier_id,amount_fen,paid_on,method,reference,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [supplier, amount, paidOn, method, optional(b.reference, '流水号', 120), optional(b.note, '备注', 500), req.staff.subject])).rows[0];
   await audit(db, req.actor, 'supplier_payment.recorded', null, created.id, { supplier_id: supplier, amount_fen: amount });
   return created;
  });
  res.status(201).json(row);
 });
 app.post('/api/staff/business/supplier-payments/:payment/void', requireStaff, async (req, res) => {
  requireFinance(req);
  const row = await transaction(pool, async db => {
   const voided = (await db.query('UPDATE supplier_payments SET voided_at=now(),voided_by=$2 WHERE id=$1 AND voided_at IS NULL RETURNING id', [id(req.params.payment), req.staff.subject])).rows[0];
   if (!voided) throw new HttpError(409, '这笔付款不存在或已经作废');
   await audit(db, req.actor, 'supplier_payment.voided', null, voided.id);
   return voided;
  });
  res.json(row);
 });

 // ---- Bank transfer dual approval -------------------------------------------------------------
 const BANK_TRANSFER_ROWS = `SELECT e.id,e.customer_id,e.account_id,e.cash_fen,e.face_fen,to_char(e.received_on,'YYYY-MM-DD') AS received_day,
  e.reference,e.note,e.status,e.created_by,e.created_at,e.decided_by,e.decided_at,e.decision_note,
  c.code AS customer_code,coalesce(o.name,u.name) AS customer_name,c.kind AS customer_kind,
  a.name AS created_by_name,k.name AS decided_by_name
  FROM bank_transfer_entries e JOIN customers c ON c.id=e.customer_id
  LEFT JOIN organizations o ON o.id=c.organization_id LEFT JOIN "user" u ON u.id=c.user_id
  LEFT JOIN staff_members a ON a.subject=e.created_by LEFT JOIN staff_members k ON k.subject=e.decided_by`;

 async function ensureBillingAccount(db, customer) {
  if (customer.organization_id) {
   await db.query('INSERT INTO billing_accounts(organization_id) VALUES($1) ON CONFLICT (organization_id) WHERE organization_id IS NOT NULL DO NOTHING', [customer.organization_id]);
   return (await db.query('SELECT id FROM billing_accounts WHERE organization_id=$1', [customer.organization_id])).rows[0];
  }
  await db.query('INSERT INTO billing_accounts(owner_id) VALUES($1) ON CONFLICT (owner_id) WHERE owner_id IS NOT NULL DO NOTHING', [customer.user_id]);
  return (await db.query('SELECT id FROM billing_accounts WHERE owner_id=$1', [customer.user_id])).rows[0];
 }

 app.get('/api/staff/business/bank-transfers', requireStaff, async (req, res) => {
  requireFinance(req);
  const entries = (await pool.query(`${BANK_TRANSFER_ROWS} ORDER BY e.status='pending' DESC,e.created_at DESC LIMIT 300`)).rows;
  res.json({ entries, refund_policy: REFUND_POLICY_ZH });
 });
 app.post('/api/staff/business/bank-transfers', requireStaff, async (req, res) => {
  requireFinance(req);
  const b = req.body || {}, customerId = id(b.customer_id), cash = fen(b.cash_yuan, '实付金额'), receivedOn = day(b.received_on, '到账日期');
  const faceRaw = b.face_yuan === undefined || b.face_yuan === null || b.face_yuan === '' ? null : fen(b.face_yuan, '官价额度面额');
  const face = faceRaw ?? cash;
  if (face < cash) throw new HttpError(400, '官价额度面额不能低于实付金额');
  if (receivedOn > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw new HttpError(400, '到账日期不能晚于今天');
  const row = await transaction(pool, async db => {
   const customer = (await db.query('SELECT id,kind,user_id,organization_id FROM customers WHERE id=$1 FOR UPDATE', [customerId])).rows[0];
   if (!customer) throw new HttpError(404, '客户不存在');
   const account = await ensureBillingAccount(db, customer);
   const created = (await db.query(`INSERT INTO bank_transfer_entries(customer_id,account_id,cash_fen,face_fen,received_on,reference,note,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status,cash_fen,face_fen`,
    [customerId, account.id, cash, face, receivedOn, optional(b.reference, '回单号', 120), optional(b.note, '备注', 500), req.staff.subject])).rows[0];
   await audit(db, req.actor, 'bank_transfer.registered', customer.organization_id, created.id, { cash_fen: cash, face_fen: face });
   return created;
  });
  res.status(201).json(row);
 });
 app.post('/api/staff/business/bank-transfers/:entry/:action', requireStaff, async (req, res) => {
  requireFinance(req);
  const entryId = id(req.params.entry), action = choice(req.params.action, ['approve', 'reject'], '操作');
  const decisionNote = action === 'reject' ? text(req.body?.note, '驳回原因', 500) : optional(req.body?.note, '备注', 500);
  const row = await transaction(pool, async db => {
   const cur = (await db.query('SELECT * FROM bank_transfer_entries WHERE id=$1 FOR UPDATE', [entryId])).rows[0];
   if (!cur) throw new HttpError(404, '登记不存在');
   if (cur.status !== 'pending') throw new HttpError(409, '这笔转账已经处理过');
   if (cur.created_by === req.staff.subject) throw new HttpError(403, '登记人不能复核自己登记的转账');
   if (action === 'reject') {
    const rejected = (await db.query(`UPDATE bank_transfer_entries SET status='rejected',decided_by=$2,decided_at=now(),decision_note=$3 WHERE id=$1 RETURNING id,status`, [entryId, req.staff.subject, decisionNote])).rows[0];
    await audit(db, req.actor, 'bank_transfer.rejected', null, entryId, { note: decisionNote });
    return rejected;
   }
   const acct = (await db.query('UPDATE billing_accounts SET cash_balance_fen=cash_balance_fen+$2,list_credit_fen=list_credit_fen+$3 WHERE id=$1 RETURNING cash_balance_fen,list_credit_fen,organization_id', [cur.account_id, cur.cash_fen, cur.face_fen])).rows[0];
   await db.query("INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id) VALUES($1,'recharge',$2,$3,'payment',$4)", [cur.account_id, cur.cash_fen, acct.cash_balance_fen, cur.id]);
   await addPack(db,{accountId:cur.account_id,sourceKind:'bank',sourceId:cur.id,faceFen:cur.face_fen,cashFen:cur.cash_fen});
   const approved = (await db.query(`UPDATE bank_transfer_entries SET status='approved',decided_by=$2,decided_at=now(),decision_note=$3 WHERE id=$1 RETURNING id,status,cash_fen,face_fen`, [entryId, req.staff.subject, decisionNote])).rows[0];
   await audit(db, req.actor, 'bank_transfer.approved', acct.organization_id, entryId, { cash_fen: String(cur.cash_fen), face_fen: String(cur.face_fen) });
   return approved;
  });
  res.json(row);
 });

 // ---- Supply chain ----------------------------------------------------------------------------
 app.get('/api/staff/business/suppliers', requireStaff, async (req, res) => {
  requireBusiness(req);
  const rows = (await pool.query(`SELECT p.id,p.code,p.display_name,p.legal_name,p.source_type,p.region,p.status,p.contact_name,p.contact_phone,p.contact_email,p.notes,p.created_at,count(DISTINCT c.id)::int AS keys,count(DISTINCT e.id)::int AS models
   FROM suppliers p LEFT JOIN supplier_lab_suppliers s ON s.canonical_supplier_id=p.id LEFT JOIN supplier_lab_credentials c ON c.supplier_id=s.id AND c.disabled_at IS NULL
   LEFT JOIN supplier_lab_endpoints e ON e.credential_id=c.id AND e.disabled_at IS NULL GROUP BY p.id ORDER BY p.code`)).rows;
  res.json({ suppliers: rows });
 });
 app.post('/api/staff/business/suppliers/:supplier/contact', requireStaff, async (req, res) => {
  requireBusiness(req);
  const b = req.body || {}, email = optional(b.contact_email, '联系邮箱', 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, '联系邮箱格式不正确');
  const row = await transaction(pool, async db => {
   const updated = (await db.query('UPDATE suppliers SET contact_name=$2,contact_phone=$3,contact_email=$4,updated_at=now() WHERE id=$1 RETURNING id,code', [id(req.params.supplier), optional(b.contact_name, '联系人', 80), optional(b.contact_phone, '联系电话', 40), email])).rows[0];
   if (!updated) throw new HttpError(404, '供应商不存在');
   await audit(db, req.actor, 'supplier.contact_updated', null, updated.id);
   return updated;
  });
  res.json(row);
 });

 app.get('/api/staff/business/customers', requireStaff, async (req, res) => {
  requireBusiness(req);
  await pool.query('SELECT ensure_customers()');
  const [customers, staff, tags] = await Promise.all([pool.query(`${CUSTOMER_ROWS} ORDER BY c.kind,c.code LIMIT 1000`),
   pool.query("SELECT subject,name FROM staff_members WHERE status='active' AND role<>'pending' ORDER BY name"),
   pool.query('SELECT t AS tag,count(*)::int AS customers FROM customers,unnest(tags) t GROUP BY 1 ORDER BY 2 DESC,1')]);
  res.json({ customers: customers.rows, staff: staff.rows, tags: tags.rows, stages: STAGES });
 });
 app.get('/api/staff/business/customers/:customer', requireStaff, async (req, res) => {
  requireBusiness(req);
  const customerId = id(req.params.customer), customer = (await pool.query(`${CUSTOMER_ROWS} WHERE c.id=$1`, [customerId])).rows[0];
  if (!customer) throw new HttpError(404, '客户不存在');
  const finance = hasFinance(req.staff), people = customer.kind === 'enterprise' ? 't.user_id IN (SELECT m.user_id FROM memberships m WHERE m.organization_id=$1 AND m.status=\'active\')' : 't.user_id=$1';
  const [notes, members, tickets, discounts, invoices, orders] = await Promise.all([
   pool.query('SELECT n.id,n.body,n.created_at,m.name AS created_by_name FROM customer_notes n LEFT JOIN staff_members m ON m.subject=n.created_by WHERE n.customer_id=$1 ORDER BY n.created_at DESC LIMIT 100', [customerId]),
   customer.kind === 'enterprise' ? pool.query(`SELECT u.name,u.email,m.role FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.status='active' ORDER BY m.role,u.name LIMIT 200`, [customer.organization_id]) : { rows: [] },
   pool.query(`SELECT t.id,t.subject,t.status,t.category,t.created_at FROM support_tickets t WHERE ${people} ORDER BY t.created_at DESC LIMIT 20`, [customer.organization_id || customer.user_id]),
   pool.query(`${DISCOUNT_ROWS} WHERE d.status IN ('pending','active') AND d.ends_at>now() AND (d.customer_id=$1 OR d.audience='all' OR (d.audience='tag' AND d.tag=ANY($2::text[]))) ORDER BY d.ends_at`, [customerId, customer.tags]),
   finance ? pool.query(`${INVOICE_ROWS} WHERE i.customer_id=$1 ORDER BY i.created_at DESC LIMIT 50`, [customerId]) : { rows: [] },
   finance ? pool.query(`SELECT o.out_trade_no,o.amount_fen,o.refunded_fen,o.paid_at FROM payment_orders o JOIN billing_accounts b ON b.id=o.account_id WHERE o.status='paid' AND (b.organization_id=$1 OR b.owner_id=$2) ORDER BY o.paid_at DESC LIMIT 20`, [customer.organization_id, customer.user_id]) : { rows: [] }]);
  res.json({ customer, notes: notes.rows, members: members.rows, tickets: tickets.rows, discounts: discounts.rows, finance: finance ? { invoices: invoices.rows, orders: orders.rows, invoice_limit: await invoiceLimit(pool, customerId) } : null });
 });
 app.post('/api/staff/business/customers/:customer', requireStaff, async (req, res) => {
  requireBusiness(req);
  const b = req.body || {}, customerId = id(req.params.customer), stage = choice(b.stage, STAGES, '客户阶段'), tags = tagList(b.tags), owner = b.owner_subject ? text(b.owner_subject, '负责人', 120) : null;
  const row = await transaction(pool, async db => {
   if (owner && !(await db.query("SELECT 1 FROM staff_members WHERE subject=$1 AND status='active' AND role<>'pending'", [owner])).rowCount) throw new HttpError(400, '负责人须是在职的业务员工');
   const updated = (await db.query('UPDATE customers SET stage=$2,tags=$3,owner_subject=$4,updated_at=now() WHERE id=$1 RETURNING id,code,stage,tags,owner_subject', [customerId, stage, tags, owner])).rows[0];
   if (!updated) throw new HttpError(404, '客户不存在');
   await audit(db, req.actor, 'customer.profile_updated', null, customerId, { stage, tags, owner_subject: owner });
   return updated;
  });
  res.json(row);
 });
 app.post('/api/staff/business/customers/:customer/notes', requireStaff, async (req, res) => {
  requireBusiness(req);
  const customerId = id(req.params.customer), body = text(req.body?.body, '跟进记录', 2000);
  if (!(await pool.query('SELECT 1 FROM customers WHERE id=$1', [customerId])).rowCount) throw new HttpError(404, '客户不存在');
  const note = (await pool.query('INSERT INTO customer_notes(customer_id,body,created_by) VALUES($1,$2,$3) RETURNING id,body,created_at', [customerId, body, req.staff.subject])).rows[0];
  res.status(201).json({ ...note, created_by_name: await staffName(req.staff.subject) });
 });

 // ---- Discounts -------------------------------------------------------------------------------
 // A register of who may pay less than list price. Charging does not read it yet; the page says so.
 app.get('/api/staff/business/discounts', requireStaff, async (req, res) => {
  requireBusiness(req);
  const [grants, campaigns, tags] = await Promise.all([pool.query(`${DISCOUNT_ROWS} ORDER BY d.status='pending' DESC,d.created_at DESC LIMIT 500`),
   pool.query('SELECT c.id,c.name,c.customer_price_percent,c.starts_at,c.ends_at,c.total_discount_budget_fen,p.display_name AS product_name FROM promotion_campaigns c JOIN model_products p ON p.id=c.model_product_id ORDER BY c.created_at DESC LIMIT 100'),
   pool.query('SELECT t AS tag,count(*)::int AS customers FROM customers,unnest(tags) t GROUP BY 1 ORDER BY 2 DESC,1')]);
  res.json({ grants: grants.rows, campaigns: campaigns.rows, tags: tags.rows, models: OFFICIAL_MODELS.map(m => ({ id: m.id, name: m.name })), can_decide: hasFinance(req.staff), me: req.staff.subject, billing_connected: true });
 });
 app.post('/api/staff/business/discounts', requireStaff, async (req, res) => {
  requireBusiness(req);
  const b = req.body || {}, name = text(b.name, '授权名称', 100), audience = choice(b.audience, ['customer', 'tag', 'all'], '授权对象'), reason = text(b.reason, '授权理由', 500);
  const percent = Number(b.customer_price_percent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 99) throw new HttpError(400, '客户实付比例须为 1–99 的整数');
  const starts = instant(b.starts_at, '开始时间'), ends = instant(b.ends_at, '结束时间');
  if (ends <= starts || ends - starts > 366 * 86400000) throw new HttpError(400, '有效期须在一年以内且结束晚于开始');
  if (ends <= new Date()) throw new HttpError(400, '结束时间须晚于现在');
  const model = b.model_id ? choice(b.model_id, OFFICIAL_MODELS.map(m => m.id), '适用产品') : null, cap = b.cap_yuan === undefined || b.cap_yuan === '' ? null : fen(b.cap_yuan, '优惠上限');
  const promo=String(b.promo_code||'').trim().toUpperCase();if(!/^[A-Z0-9_-]{0,40}$/.test(promo))throw new HttpError(400,'促销码格式不正确');
  const tag = audience === 'tag' ? tagList([b.tag])[0] : null, customer = audience === 'customer' ? id(b.customer_id) : null;
  // The platform administrator's own grants take effect at once; everyone else's wait for a second person.
  const status = isAdmin(req.staff) ? 'active' : 'pending';
  const row = await transaction(pool, async db => {
   if (customer && !(await db.query('SELECT 1 FROM customers WHERE id=$1', [customer])).rowCount) throw new HttpError(404, '客户不存在');
   const created = (await db.query(`INSERT INTO discount_grants(name,audience,customer_id,tag,model_id,customer_price_percent,cap_fen,starts_at,ends_at,reason,status,created_by,decided_by,decided_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,status`, [name, audience, customer, tag, model, percent, cap, starts, ends, reason, status, req.staff.subject, status === 'active' ? req.staff.subject : null, status === 'active' ? new Date() : null])).rows[0];
   if(promo)await db.query('UPDATE discount_grants SET promo_code=$2 WHERE id=$1',[created.id,promo]);
   await audit(db, req.actor, 'discount_grant.created', null, created.id, { audience, customer_price_percent: percent, status });
   return created;
  });
  res.status(201).json(row);
 });
 app.post('/api/staff/business/discounts/:grant/:action', requireStaff, async (req, res) => {
  requireBusiness(req);
  const grantId = id(req.params.grant), action = choice(req.params.action, ['approve', 'reject', 'revoke'], '操作'), note = optional(req.body?.note, '说明', 500);
  const row = await transaction(pool, async db => {
   const grant = (await db.query('SELECT * FROM discount_grants WHERE id=$1 FOR UPDATE', [grantId])).rows[0];
   if (!grant) throw new HttpError(404, '折扣授权不存在');
   let status;
   if (action === 'revoke') {
    if (grant.status !== 'active') throw new HttpError(409, '只有生效中的授权可以收回');
    if (grant.created_by !== req.staff.subject && !hasFinance(req.staff)) throw new HttpError(403, '只有提出人、财务或平台管理员可以收回授权');
    status = 'revoked';
   } else {
    if (grant.status !== 'pending') throw new HttpError(409, '这条授权已经处理过');
    if (!hasFinance(req.staff)) throw new HttpError(403, '折扣授权须由财务或平台管理员审批');
    if (grant.created_by === req.staff.subject) throw new HttpError(409, '提出人不能审批自己的折扣授权');
    if (action === 'reject' && !note) throw new HttpError(400, '请填写驳回原因');
    status = action === 'approve' ? 'active' : 'rejected';
   }
   await db.query('UPDATE discount_grants SET status=$2,decided_by=$3,decided_at=now(),decision_note=$4 WHERE id=$1', [grantId, status, req.staff.subject, note]);
   await audit(db, req.actor, 'discount_grant.' + status, null, grantId);
   return { id: grantId, status };
  });
  res.json(row);
 });

 // ---- First-line support ----------------------------------------------------------------------
 app.get('/api/staff/business/support', requireStaff, async (req, res) => {
  requireBusiness(req);
  const [tickets, replies, answers] = await Promise.all([
   pool.query(`SELECT t.id,t.subject,t.body,t.status,t.category,t.tier,t.created_at,t.updated_at,u.name,u.email,c.id AS customer_id,c.code AS customer_code FROM support_tickets t JOIN "user" u ON u.id=t.user_id LEFT JOIN customers c ON c.user_id=t.user_id ORDER BY t.status='closed',t.created_at DESC LIMIT 300`),
   pool.query(`SELECT r.ticket_id,r.body,r.created_at,m.name AS created_by_name FROM support_ticket_replies r LEFT JOIN staff_members m ON m.subject=r.created_by WHERE r.ticket_id IN (SELECT id FROM support_tickets ORDER BY status='closed',created_at DESC LIMIT 300) ORDER BY r.created_at`),
   pool.query('SELECT id,category,question,answer,published,use_count,updated_at FROM support_answers WHERE archived_at IS NULL ORDER BY use_count DESC,updated_at DESC LIMIT 300')]);
  const thread = new Map();
  for (const r of replies.rows) { if (!thread.has(r.ticket_id)) thread.set(r.ticket_id, []); thread.get(r.ticket_id).push(r); }
  res.json({ tickets: tickets.rows.map(t => ({ ...t, replies: thread.get(t.id) || [] })), answers: answers.rows, categories: CATEGORIES });
 });
 app.post('/api/staff/business/tickets/:ticket/reply', requireStaff, async (req, res) => {
  requireBusiness(req);
  const ticketId = id(req.params.ticket), body = text(req.body?.body, '回复内容', 2000), close = req.body?.close === true, answer = req.body?.answer_id ? id(req.body.answer_id) : null;
  const row = await transaction(pool, async db => {
   const ticket = (await db.query('SELECT status FROM support_tickets WHERE id=$1 FOR UPDATE', [ticketId])).rows[0];
   if (!ticket) throw new HttpError(404, '工单不存在');
   if (ticket.status === 'closed') throw new HttpError(409, '工单已关闭');
   await db.query('INSERT INTO support_ticket_replies(ticket_id,body,answer_id,created_by) VALUES($1,$2,$3,$4)', [ticketId, body, answer, req.staff.subject]);
   if (answer) await db.query('UPDATE support_answers SET use_count=use_count+1 WHERE id=$1', [answer]);
   // staff_note is what the customer panel shows: always the latest reply.
   return (await db.query('UPDATE support_tickets SET status=$2,staff_note=$3,handled_by=$4,updated_at=now() WHERE id=$1 RETURNING id,status', [ticketId, close ? 'closed' : 'in_progress', body, req.staff.subject])).rows[0];
  });
  res.json(row);
 });
 app.post('/api/staff/business/tickets/:ticket/triage', requireStaff, async (req, res) => {
  requireBusiness(req);
  const b = req.body || {}, category = choice(b.category, CATEGORIES, '工单分类'), tier = choice(b.tier, ['first_line', 'technical'], '处理层级');
  const row = (await pool.query('UPDATE support_tickets SET category=$2,tier=$3,updated_at=now() WHERE id=$1 RETURNING id,category,tier', [id(req.params.ticket), category, tier])).rows[0];
  if (!row) throw new HttpError(404, '工单不存在');
  res.json(row);
 });
 app.post('/api/staff/business/answers', requireStaff, async (req, res) => {
  requireBusiness(req);
  const b = req.body || {}, values = [choice(b.category, CATEGORIES, '分类'), text(b.question, '问题', 200), text(b.answer, '答复', 2000), b.published === true];
  const row = b.id
   ? (await pool.query('UPDATE support_answers SET category=$2,question=$3,answer=$4,published=$5,updated_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING id', [id(b.id), ...values])).rows[0]
   : (await pool.query('INSERT INTO support_answers(category,question,answer,published,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id', [...values, req.staff.subject])).rows[0];
  if (!row) throw new HttpError(404, '问答不存在');
  res.status(b.id ? 200 : 201).json(row);
 });
 app.post('/api/staff/business/answers/:answer/archive', requireStaff, async (req, res) => {
  requireBusiness(req);
  const row = (await pool.query('UPDATE support_answers SET archived_at=now(),published=false WHERE id=$1 AND archived_at IS NULL RETURNING id', [id(req.params.answer)])).rows[0];
  if (!row) throw new HttpError(404, '问答不存在');
  res.json(row);
 });
}

/** Customer-facing side: published answers, and invoice requests against money actually paid. */
export function customerBusinessRoutes(app, pool, requireCustomer) {
 app.get('/api/support/answers', requireCustomer, async (_req, res) => res.json((await pool.query('SELECT id,category,question,answer FROM support_answers WHERE published AND archived_at IS NULL ORDER BY use_count DESC,updated_at DESC LIMIT 100')).rows));

 async function customerOf(db, column, value) {
  const find = () => db.query(`SELECT id,kind FROM customers WHERE ${column}=$1 FOR UPDATE`, [value]);
  let row = (await find()).rows[0];
  if (!row) { await db.query('SELECT ensure_customers()'); row = (await find()).rows[0]; }
  if (!row) throw new HttpError(404, '账户不存在');
  return row;
 }
 async function manager(req) {
  const org = id(req.params.org), membership = (await pool.query("SELECT m.role,o.name FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active'", [org, req.customer.id])).rows[0];
  if (!membership || !isManager(membership.role)) throw new HttpError(403, '仅企业管理者可以申请和查看发票');
  return org;
 }
 const list = (column, value) => transaction(pool, async db => {
  const customer = await customerOf(db, column, value), limit = await invoiceLimit(db, customer.id);
  const items = (await db.query("SELECT id,invoice_type,title,tax_number,email,amount_fen,status,invoice_number,to_char(issued_on,'YYYY-MM-DD') AS issued_day,note,created_at FROM tax_invoices WHERE customer_id=$1 AND direction='output' ORDER BY created_at DESC LIMIT 50", [customer.id])).rows;
  return { kind: customer.kind, available_fen: String(limit.available_fen), invoiced_fen: String(limit.invoiced_fen), items };
 });
 const request = (req, column, value) => transaction(pool, async db => {
  const b = req.body || {}, customer = await customerOf(db, column, value), type = choice(b.invoice_type, ['general', 'special'], '发票类型');
  const title = text(b.title, '发票抬头', 160), taxNumber = optional(b.tax_number, '税号', 30).toUpperCase(), amount = fen(b.amount_yuan, '开票金额', 5000000), email = text(b.email, '收票邮箱', 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, '收票邮箱格式不正确');
  if (customer.kind === 'personal' && type === 'special') throw new HttpError(400, '个人账户只能申请普通发票');
  if ((customer.kind === 'enterprise' || type === 'special') && !taxNumber) throw new HttpError(400, '企业抬头须填写纳税人识别号');
  if (taxNumber && !TAX_NUMBER.test(taxNumber)) throw new HttpError(400, '税号须为 15–20 位数字或大写字母');
  if ((await db.query("SELECT count(*)::int AS n FROM tax_invoices WHERE customer_id=$1 AND status='requested'", [customer.id])).rows[0].n >= 5) throw new HttpError(429, '待处理的开票申请过多，请等待财务处理');
  await lockInvoiceAccount(db,customer.id);
  const limit = await invoiceLimit(db, customer.id);
  if (amount > limit.available_fen) throw new HttpError(409, `可开票金额为 ¥${(limit.available_fen / 100).toFixed(2)}，按实际付款扣除退款和已申请的发票计算`);
  const created = (await db.query(`INSERT INTO tax_invoices(direction,customer_id,invoice_type,title,tax_number,email,amount_fen,status,note,requested_by_user) VALUES('output',$1,$2,$3,$4,$5,$6,'requested',$7,$8) RETURNING id,status,amount_fen,created_at`,
   [customer.id, type, title, taxNumber, email, amount, optional(b.note, '备注', 500), req.customer.id])).rows[0];
  await audit(db, req.actor, 'tax_invoice.requested', column === 'organization_id' ? value : null, created.id, { amount_fen: amount });
  return created;
 });
 app.get('/api/billing/personal/invoices', requireCustomer, async (req, res) => res.json(await list('user_id', req.customer.id)));
 app.post('/api/billing/personal/invoices', requireCustomer, async (req, res) => res.status(201).json(await request(req, 'user_id', req.customer.id)));
 app.get('/api/billing/organizations/:org/invoices', requireCustomer, async (req, res) => res.json(await list('organization_id', await manager(req))));
 app.post('/api/billing/organizations/:org/invoices', requireCustomer, async (req, res) => res.status(201).json(await request(req, 'organization_id', await manager(req))));
}
