// Upstream pages: suppliers with their models, and each supplier's purchase keys.
// Rule: a key belongs to a supplier and covers every model that supplier offers, so models are managed per supplier
// (adding one adds it to every live key) and keys are managed per supplier (a new key gets every model at once).
import { HttpError, audit, hash, id, text, transaction, vault } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { validateLabBaseUrl } from './supplier-lab.mjs';
import { employeeRoutes } from './employee-credit.mjs';
import { OFFICIAL_MODELS } from './official-models.mjs';

const rate = v => v === null || v === undefined || v === '' ? null : /^\d{1,6}(\.\d{1,6})?$/.test(String(v)) ? String(v) : (() => { throw new HttpError(400, '费率必须是非负金额，最多六位小数'); })();

// Give every live key of a lab supplier an endpoint for every live model of that supplier.
export async function syncSupplierModels(db, labSupplierId) {
 await db.query(`INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,input_yuan_per_m,cached_input_yuan_per_m,output_yuan_per_m,created_by,supplier_id,credential_id,offer_id)
  SELECT DISTINCT ON (c.id,e.model_id) e.label,e.kind,c.base_url,e.model_id,c.credential_fingerprint,e.input_yuan_per_m,e.cached_input_yuan_per_m,e.output_yuan_per_m,e.created_by,c.supplier_id,c.id,e.offer_id
  FROM supplier_lab_credentials c JOIN supplier_lab_endpoints e ON e.supplier_id=c.supplier_id AND e.disabled_at IS NULL AND e.credential_id IS NOT NULL
  WHERE c.supplier_id=$1 AND c.disabled_at IS NULL AND NOT EXISTS(SELECT 1 FROM supplier_lab_endpoints x WHERE x.credential_id=c.id AND x.model_id=e.model_id AND x.disabled_at IS NULL)
  ORDER BY c.id,e.model_id,e.created_at DESC`, [labSupplierId]);
}

export function upstreamRoutes(app, pool, cfg, requireStaff, fetchImpl = fetch) {
 const secret = process.env.SUPPLIER_LAB_SECRET, box = secret?.length >= 32 ? vault(secret) : null;

 app.get('/api/staff/lab/upstream', requireStaff, async (req, res) => {
  requireTechnical(req);
  const [suppliers, keys, models, keyModel, routes, paused] = await Promise.all([
   pool.query(`SELECT p.id,p.display_name AS name,p.legal_name,p.source_type,p.status,p.region,s.id AS lab_id FROM suppliers p LEFT JOIN supplier_lab_suppliers s ON s.canonical_supplier_id=p.id
    WHERE p.source_type<>'official' ORDER BY p.status='blocked',p.created_at`),
   pool.query(`SELECT c.id,c.label,c.base_url,c.credential_fingerprint,c.priority,c.priority_changed_at,c.created_at,c.disabled_at,c.last_check_at,c.last_check_ok,c.last_check_status,c.last_check_ms,c.last_check_error,c.last_check_model,s.canonical_supplier_id AS supplier_id,
    count(e.id) FILTER(WHERE e.disabled_at IS NULL)::int AS model_count
    FROM supplier_lab_credentials c JOIN supplier_lab_suppliers s ON s.id=c.supplier_id LEFT JOIN supplier_lab_endpoints e ON e.credential_id=c.id
    WHERE s.kind='supplier' GROUP BY c.id,s.id ORDER BY c.disabled_at IS NOT NULL,c.priority,c.created_at DESC`),
   pool.query(`SELECT DISTINCT ON (s.canonical_supplier_id,e.model_id) s.canonical_supplier_id AS supplier_id,e.model_id,e.label,e.input_yuan_per_m,e.cached_input_yuan_per_m,e.output_yuan_per_m,e.created_at,
    (SELECT count(DISTINCT x.credential_id)::int FROM supplier_lab_endpoints x JOIN supplier_lab_credentials xc ON xc.id=x.credential_id WHERE x.supplier_id=e.supplier_id AND x.model_id=e.model_id AND x.disabled_at IS NULL AND xc.disabled_at IS NULL) AS key_count
    FROM supplier_lab_endpoints e JOIN supplier_lab_suppliers s ON s.id=e.supplier_id JOIN supplier_lab_credentials c ON c.id=e.credential_id
    WHERE e.disabled_at IS NULL AND c.disabled_at IS NULL AND s.kind='supplier' ORDER BY s.canonical_supplier_id,e.model_id,e.created_at`),
   pool.query(`SELECT credential_id,model_id,count(*)::int AS calls,count(*) FILTER(WHERE status='failed')::int AS failed,round(avg(latency_ms) FILTER(WHERE status<>'failed'))::int AS avg_latency,
    max(created_at) FILTER(WHERE status<>'failed') AS last_ok_at,max(created_at) FILTER(WHERE status='failed') AS last_fail_at,(array_agg(error_code ORDER BY created_at DESC) FILTER(WHERE status='failed'))[1] AS last_error
    FROM employee_calls WHERE created_at>now()-interval '24 hours' AND credential_id IS NOT NULL GROUP BY 1,2`),
   employeeRoutes(pool, cfg, { includePaused: true }),
   pool.query('SELECT model_id FROM channel_states WHERE paused')
  ]);
  const pausedIds = new Set(paused.rows.map(r => r.model_id));
  const keyOf = new Map(keys.rows.map(k => [k.id, k]));
  const out = suppliers.rows.map(s => {
   const mine = keys.rows.filter(k => k.supplier_id === s.id), live = mine.filter(k => !k.disabled_at), ids = new Set(live.map(k => k.id));
   const stats = (rows) => { const r = rows.reduce((a, x) => ({ calls: a.calls + x.calls, failed: a.failed + x.failed, lat: a.lat + (x.avg_latency || 0) * (x.calls - x.failed), ok: a.ok + x.calls - x.failed, last_ok_at: [a.last_ok_at, x.last_ok_at].filter(Boolean).sort().at(-1) || null, last_fail_at: [a.last_fail_at, x.last_fail_at].filter(Boolean).sort().at(-1) || null, last_error: x.last_fail_at && (!a.last_fail_at || x.last_fail_at > a.last_fail_at) ? x.last_error : a.last_error }), { calls: 0, failed: 0, lat: 0, ok: 0, last_ok_at: null, last_fail_at: null, last_error: null }); return { calls_24h: r.calls, failed_24h: r.failed, avg_latency: r.ok ? Math.round(r.lat / r.ok) : null, last_ok_at: r.last_ok_at, last_fail_at: r.last_fail_at, last_error: r.last_error }; };
   const keyRows = mine.map(k => ({ ...k, ...stats(keyModel.rows.filter(x => x.credential_id === k.id)) }));
   const modelRows = models.rows.filter(m => m.supplier_id === s.id).map(m => {
    const offers = OFFICIAL_MODELS.filter(o => o.upstreamModel === m.model_id);
    const routed = routes.filter(r => r.model.upstreamModel === m.model_id && [r.credentialId, ...(r.fallbacks || []).map(f => f.credentialId)].some(c => ids.has(c)));
    const used = keyModel.rows.filter(x => ids.has(x.credential_id) && offers.some(o => o.id === x.model_id));
    return { ...m, offered_as: offers.map(o => ({ id: o.id, name: o.name, routed: routed.some(r => r.model.id === o.id), paused: pausedIds.has(o.id) })), live_keys: live.length, ...stats(used) };
   });
   const primary = live.find(k => k.priority === 1) || null;
   return { ...s, keys: keyRows, models: modelRows, live_keys: live.length, primary_label: primary?.label || null, standby_count: live.filter(k => k.priority === 2).length, base_url: live[0]?.base_url || mine[0]?.base_url || null, ...stats(keyModel.rows.filter(x => ids.has(x.credential_id))) };
  });
  res.json({ ready: Boolean(box), suppliers: out, allowed_hosts: (process.env.SUPPLIER_LAB_ALLOWED_HOSTS || 'api.deepseek.com').split(',').map(x => x.trim()).filter(Boolean) });
 });

 // Add a model to a supplier: every live key of the supplier gets it.
 app.post('/api/staff/lab/suppliers/:id/models', requireStaff, async (req, res) => {
  requireTechnical(req);
  const supplierId = id(req.params.id), b = req.body || {}, model = text(b.model_id, '上游型号 ID', 120), label = b.label ? text(b.label, '型号名称', 100) : model.slice(0, 100);
  const rates = [rate(b.input_yuan_per_m), rate(b.cached_input_yuan_per_m), rate(b.output_yuan_per_m)];
  const added = await transaction(pool, async db => {
   const lab = (await db.query("SELECT s.id FROM supplier_lab_suppliers s JOIN suppliers p ON p.id=s.canonical_supplier_id WHERE s.canonical_supplier_id=$1 AND s.kind='supplier' AND s.disabled_at IS NULL AND p.status<>'blocked' FOR UPDATE OF s", [supplierId])).rows[0];
   if (!lab) throw new HttpError(404, '供应商不存在或还没有 Key');
   const keys = (await db.query('SELECT id,base_url,credential_fingerprint FROM supplier_lab_credentials WHERE supplier_id=$1 AND disabled_at IS NULL', [lab.id])).rows;
   if (!keys.length) throw new HttpError(409, '先给这家供应商登记一把 Key');
   if ((await db.query('SELECT 1 FROM supplier_lab_endpoints WHERE supplier_id=$1 AND model_id=$2 AND disabled_at IS NULL', [lab.id, model])).rowCount) throw new HttpError(409, '这家供应商已经有这个型号');
   let offer = (await db.query("SELECT id FROM supplier_offers WHERE supplier_id=$1 AND upstream_model_id=$2 AND status<>'blocked' ORDER BY created_at LIMIT 1", [supplierId, model])).rows[0];
   if (!offer) {
    offer = (await db.query(`INSERT INTO supplier_offers(supplier_id,model_name,upstream_model_id,protocol,region,created_by) SELECT id,$2,$3,'openai_compatible',region,$4 FROM suppliers WHERE id=$1 RETURNING id`, [supplierId, label, model, req.staff.subject])).rows[0];
    await db.query("INSERT INTO supplier_offer_checks(offer_id,check_key) SELECT $1,unnest(ARRAY['source','sales_rights','model_version','protocol','data_region','usage_billing','capacity'])", [offer.id]);
   }
   for (const k of keys) await db.query(`INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,input_yuan_per_m,cached_input_yuan_per_m,output_yuan_per_m,created_by,supplier_id,credential_id,offer_id) VALUES($1,'supplier',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [label, k.base_url, model, k.credential_fingerprint, ...rates, req.staff.subject, lab.id, k.id, offer.id]);
   await audit(db, req.actor, 'upstream.model_added', null, supplierId, { model_id: model, keys: keys.length });
   return keys.length;
  });
  res.status(201).json({ model_id: model, keys: added });
 });

 app.post('/api/staff/lab/suppliers/:id/models/:model/disable', requireStaff, async (req, res) => {
  requireTechnical(req);
  const supplierId = id(req.params.id), model = text(req.params.model, '上游型号 ID', 120);
  const n = await transaction(pool, async db => {
   const r = await db.query("UPDATE supplier_lab_endpoints e SET disabled_at=now() FROM supplier_lab_suppliers s WHERE s.id=e.supplier_id AND s.canonical_supplier_id=$1 AND e.model_id=$2 AND e.disabled_at IS NULL", [supplierId, model]);
   if (!r.rowCount) throw new HttpError(404, '这家供应商没有这个型号');
   await audit(db, req.actor, 'upstream.model_removed', null, supplierId, { model_id: model });
   return r.rowCount;
  });
  res.json({ ok: true, endpoints: n });
 });

 // Register a key for a supplier. It covers every model the supplier already has; it becomes primary if there is none, otherwise standby.
 app.post('/api/staff/lab/suppliers/:id/keys', requireStaff, async (req, res) => {
  requireTechnical(req);
  if (!box) throw new HttpError(503, '验收加密服务未配置');
  const supplierId = id(req.params.id), b = req.body || {}, label = text(b.label, 'Key 名称', 100), key = text(b.api_key, 'API Key', 1000);
  if (/\s/.test(key)) throw new HttpError(400, 'API Key 不可包含空白字符');
  const row = await transaction(pool, async db => {
   const supplier = (await db.query("SELECT * FROM suppliers WHERE id=$1 AND status<>'blocked' AND source_type<>'official' FOR SHARE", [supplierId])).rows[0];
   if (!supplier) throw new HttpError(404, '供应商不存在或已停用');
   await db.query(`INSERT INTO supplier_lab_suppliers(id,name,legal_name,kind,created_by,canonical_supplier_id) VALUES($1,$2,$3,'supplier',$4,$1) ON CONFLICT(canonical_supplier_id) DO NOTHING`, [supplierId, supplier.display_name, supplier.legal_name, req.staff.subject]);
   const lab = (await db.query('SELECT id FROM supplier_lab_suppliers WHERE canonical_supplier_id=$1', [supplierId])).rows[0];
   const existing = (await db.query('SELECT base_url,priority FROM supplier_lab_credentials WHERE supplier_id=$1 AND disabled_at IS NULL ORDER BY created_at DESC', [lab.id])).rows;
   const baseUrl = validateLabBaseUrl(b.base_url || existing[0]?.base_url || '');
   const fingerprint = hash(key).slice(0, 12);
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [baseUrl + ':' + fingerprint]);
   if ((await db.query('SELECT 1 FROM supplier_lab_credentials WHERE base_url=$1 AND credential_fingerprint=$2', [baseUrl, fingerprint])).rowCount) throw new HttpError(409, '这把 Key 已经登记过');
   if ((await db.query('SELECT 1 FROM supplier_lab_credentials WHERE supplier_id=$1 AND label=$2', [lab.id, label])).rowCount) throw new HttpError(409, '这个名称已经用过，请换一个');
   const priority = existing.some(k => k.priority === 1) ? 2 : 1;
   const created = (await db.query('INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by,priority,priority_changed_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) RETURNING id,label,priority', [lab.id, label, baseUrl, box.seal({ key }), fingerprint, req.staff.subject, priority])).rows[0];
   await syncSupplierModels(db, lab.id);
   const models = Number((await db.query('SELECT count(*) FROM supplier_lab_endpoints WHERE credential_id=$1 AND disabled_at IS NULL', [created.id])).rows[0].count);
   await audit(db, req.actor, 'upstream.key_added', null, created.id, { supplier_id: supplierId, host: new URL(baseUrl).hostname, priority, models });
   return { ...created, models };
  });
  res.status(201).json(row);
 });

 // Check that a key really works: one tiny chat request (max_tokens 1) on one of the supplier's models.
 app.post('/api/staff/lab/credentials/:id/check', requireStaff, async (req, res) => {
  requireTechnical(req);
  if (!box) throw new HttpError(503, '验收加密服务未配置');
  const credentialId = id(req.params.id);
  const key = (await pool.query("SELECT c.* FROM supplier_lab_credentials c JOIN supplier_lab_suppliers s ON s.id=c.supplier_id WHERE c.id=$1 AND c.disabled_at IS NULL AND s.kind='supplier'", [credentialId])).rows[0];
  if (!key) throw new HttpError(404, 'Key 不存在或已停用');
  const models = (await pool.query('SELECT model_id FROM supplier_lab_endpoints WHERE credential_id=$1 AND disabled_at IS NULL ORDER BY model_id', [credentialId])).rows.map(r => r.model_id);
  if (!models.length) throw new HttpError(409, '这家供应商还没有型号，先在“供应商”里添加型号');
  const preferred = OFFICIAL_MODELS.map(m => m.upstreamModel), model = models.sort((a, b) => (preferred.includes(a) ? 0 : 1) - (preferred.includes(b) ? 0 : 1) || a.localeCompare(b))[0];
  validateLabBaseUrl(key.base_url);
  const started = performance.now(); let status = null, ok = false, error = null;
  try {
   const secretKey = box.open(key.credential_ciphertext).key;
   const r = await fetchImpl(`${key.base_url}/chat/completions`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }), signal: AbortSignal.timeout(30000) });
   status = r.status; const raw = (await r.text()).slice(0, 2000);
   ok = r.ok; if (!ok) { let msg = raw; try { msg = JSON.parse(raw)?.error?.message || raw; } catch {} error = String(msg).replaceAll(secretKey, '***').slice(0, 200); }
  } catch (e) { error = e?.name === 'TimeoutError' ? '30 秒无响应' : '连接失败：' + String(e?.message || e).slice(0, 160); }
  const ms = Math.round(performance.now() - started);
  await pool.query('UPDATE supplier_lab_credentials SET last_check_at=now(),last_check_ok=$2,last_check_status=$3,last_check_ms=$4,last_check_error=$5,last_check_model=$6 WHERE id=$1', [credentialId, ok, status, ms, error, model]);
  await audit(pool, req.actor, 'upstream.key_checked', null, credentialId, { ok, status, model });
  res.json({ ok, http_status: status, latency_ms: ms, error, model });
 });
}
