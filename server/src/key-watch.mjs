// Scheduled watch over every purchase key: which models the upstream really serves, and whether each one answers.
// Runs every 30 minutes (index.mjs) and on demand. Outcomes become events that stay open until the next run no longer
// sees them; new warning and critical events are mailed to the platform admins at once.
//   - upstream offers a model our catalog knows (with prices): it is added to the supplier automatically, so it goes live → info, mailed
//   - upstream offers a model our catalog does not know: needs a price before launch → warning, mailed for manual launch
//   - upstream no longer offers a model we serve, or a key does not answer → critical, mailed
//   - two keys are the same secret → warning (it is not a standby)
import { HttpError, audit } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { validateLabBaseUrl } from './supplier-lab.mjs';
import { syncSupplierModels } from './upstream.mjs';
import { OFFICIAL_MODELS } from './official-models.mjs';
import { IGNORES_MAX_TOKENS, forgetGuardCache } from './output-guard.mjs';

export const WATCH_INTERVAL_MS = 30 * 60 * 1000;
const LEVEL = { ignores_max_tokens: 'warning', auto_launched: 'info', needs_manual_launch: 'warning', upstream_removed: 'critical', key_missing_model: 'critical', key_check_failed: 'critical', key_list_failed: 'warning', duplicate_key: 'warning', catalog_not_upstream: 'info' };
const TITLE = {
 ignores_max_tokens: e => `上游 ${e.subject} 不遵守 max_tokens（要 1 个给了 ${e.detail.got} 个），网关已代为截断`,
 auto_launched: e => `上游新增 ${e.subject}，目录里有定价，已自动上线`,
 needs_manual_launch: e => `上游新增 ${e.subject}，目录里没有定价，需要人工上线`,
 upstream_removed: e => `上游不再提供 ${e.subject}，员工调用会失败`,
 key_missing_model: e => `Key「${e.detail.key}」看不到 ${e.subject}`,
 key_check_failed: e => `Key「${e.detail.key}」检测失败：${e.subject}`,
 key_list_failed: e => `Key「${e.detail.key}」拿不到型号列表`,
 duplicate_key: e => `「${e.detail.key}」和「${e.detail.same_as}」是同一把 Key，当不了备用`,
 catalog_not_upstream: e => `目录里的 ${e.subject} 没有上游，员工看不到它`
};
export const eventTitle = e => (TITLE[e.kind] || (() => e.kind))(e);

async function readJson(response) { const raw = (await response.text()).slice(0, 262144); try { return JSON.parse(raw); } catch { return null; } }

export async function runKeyWatch(pool, { box, fetchImpl = fetch, mail = null, trigger = 'schedule' }) {
 if (!box) return { skipped: 'no-secret' };
 const started = new Date(), found = [];
 const add = (supplierId, kind, subject, detail = {}) => found.push({ supplier_id: supplierId, kind, subject: String(subject).slice(0, 200), level: LEVEL[kind], detail });
 const suppliers = (await pool.query(`SELECT s.id AS lab_id,s.canonical_supplier_id AS supplier_id,coalesce(p.display_name,s.name) AS name FROM supplier_lab_suppliers s LEFT JOIN suppliers p ON p.id=s.canonical_supplier_id
  WHERE s.kind='supplier' AND s.disabled_at IS NULL AND (p.id IS NULL OR p.status<>'blocked') AND EXISTS(SELECT 1 FROM supplier_lab_credentials c WHERE c.supplier_id=s.id AND c.disabled_at IS NULL)`)).rows;
 const summary = { suppliers: [] };
 for (const s of suppliers) {
  const keys = (await pool.query('SELECT id,label,base_url,credential_fingerprint,credential_ciphertext,priority FROM supplier_lab_credentials WHERE supplier_id=$1 AND disabled_at IS NULL ORDER BY priority,created_at', [s.lab_id])).rows;
  const registered = (await pool.query('SELECT DISTINCT model_id FROM supplier_lab_endpoints WHERE supplier_id=$1 AND disabled_at IS NULL AND credential_id IS NOT NULL', [s.lab_id])).rows.map(r => r.model_id);
  const seen = new Map(); const distinct = [];
  for (const k of keys) { if (seen.has(k.credential_fingerprint)) add(s.supplier_id, 'duplicate_key', k.id, { key: k.label, same_as: seen.get(k.credential_fingerprint).label }); else { seen.set(k.credential_fingerprint, k); distinct.push(k); } }
  const lists = [];
  for (const k of distinct) {
   let secret; try { validateLabBaseUrl(k.base_url); secret = box.open(k.credential_ciphertext).key; } catch (e) { add(s.supplier_id, 'key_check_failed', '无法读取 Key 或地址不在允许名单', { key: k.label, credential_id: k.id }); continue; }
   const twins = keys.filter(x => x.credential_fingerprint === k.credential_fingerprint).map(x => x.id);
   // 1. model list (try /models on the key's base, then on the /v1 variant, since some keys were registered without /v1)
   let list = null;
   for (const base of [...new Set([k.base_url, k.base_url.endsWith('/v1') ? k.base_url : k.base_url + '/v1'])]) {
    try { const r = await fetchImpl(`${base}/models`, { headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(20000) }); const j = r.ok ? await readJson(r) : null; if (Array.isArray(j?.data)) { list = j.data.map(m => m?.id).filter(x => typeof x === 'string'); break; } } catch { /* try next */ }
   }
   if (list) { lists.push(list); for (const m of registered) if (!list.includes(m)) add(s.supplier_id, 'key_missing_model', m, { key: k.label, credential_id: k.id }); }
   else add(s.supplier_id, 'key_list_failed', k.id, { key: k.label, credential_id: k.id });
   // 2. one 1-token request per registered model
   const pending = [...registered], results = [];
   const checkOne = async model => {
    const t0 = performance.now();
    try {
     const r = await fetchImpl(`${k.base_url}/chat/completions`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }), signal: AbortSignal.timeout(30000) });
     const j = await readJson(r); const ok = r.ok;
     const out = j?.usage?.completion_tokens;
     return { model, ok, status: r.status, ms: Math.round(performance.now() - t0), output_tokens: Number.isFinite(out) ? out : null, error: ok ? null : String(j?.error?.message || `HTTP ${r.status}`).replaceAll(secret, '***').slice(0, 200) };
    } catch (e) { return { model, ok: false, status: null, ms: Math.round(performance.now() - t0), error: e?.name === 'TimeoutError' ? '30 秒无响应' : '连接失败' }; }
   };
   await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => { for (let m = pending.shift(); m; m = pending.shift()) results.push(await checkOne(m)); }));
   for (const r of results.filter(r => !r.ok)) add(s.supplier_id, 'key_check_failed', r.model, { key: k.label, credential_id: k.id, error: r.error, status: r.status });
   // max_tokens=1 answered with more than 1 output token: the upstream ignores the limit, so the gateway's output guard takes over.
   for (const r of results.filter(r => r.ok && r.output_tokens != null)) {
    if (r.output_tokens > 1) { await pool.query(`INSERT INTO upstream_model_flags(model_id,flag,detail) VALUES($1,$2,$3) ON CONFLICT(model_id,flag) DO UPDATE SET last_seen=now(),detail=EXCLUDED.detail,cleared_at=NULL,since=CASE WHEN upstream_model_flags.cleared_at IS NULL THEN upstream_model_flags.since ELSE now() END`, [r.model, IGNORES_MAX_TOKENS, { asked: 1, got: r.output_tokens, key: k.label }]); add(s.supplier_id, 'ignores_max_tokens', r.model, { key: k.label, got: r.output_tokens }); }
    else await pool.query('UPDATE upstream_model_flags SET cleared_at=now() WHERE model_id=$1 AND flag=$2 AND cleared_at IS NULL', [r.model, IGNORES_MAX_TOKENS]);
   }
   forgetGuardCache();
   if (results.length) {
    const ok = results.every(r => r.ok), failed = results.find(r => !r.ok);
    await pool.query('UPDATE supplier_lab_credentials SET last_check_at=now(),last_check_ok=$2,last_check_status=$3,last_check_ms=$4,last_check_error=$5,last_check_model=$6,last_check_models=$7 WHERE id=ANY($1::uuid[])',
     [twins, ok, failed ? failed.status : 200, Math.max(...results.map(r => r.ms)), failed ? `${failed.model}：${failed.error}` : null, `${results.filter(r => r.ok).length}/${results.length}`, JSON.stringify(results)]);
   }
  }
  // 3. compare the upstream list with what we serve
  const upstream = lists.length ? [...new Set(lists.flat())] : null;
  if (upstream) {
   for (const m of registered) if (!upstream.includes(m)) add(s.supplier_id, 'upstream_removed', m);
   for (const m of upstream.filter(x => !registered.includes(x))) {
    const known = OFFICIAL_MODELS.find(o => o.upstream === 'kerapi' && o.upstreamModel === m);
    if (!known) { add(s.supplier_id, 'needs_manual_launch', m); continue; }
    // A catalog model the upstream now offers: add it to the supplier so every key gets it; routing picks it up immediately.
    const base = (await pool.query('SELECT e.created_by,e.offer_id FROM supplier_lab_endpoints e WHERE e.supplier_id=$1 ORDER BY e.created_at LIMIT 1', [s.lab_id])).rows[0];
    await pool.query(`INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,input_yuan_per_m,cached_input_yuan_per_m,output_yuan_per_m,created_by,supplier_id,credential_id)
      SELECT $1,'supplier',c.base_url,$2,c.credential_fingerprint,$3,$4,$5,$6,c.supplier_id,c.id FROM supplier_lab_credentials c WHERE c.supplier_id=$7 AND c.disabled_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM supplier_lab_endpoints x WHERE x.credential_id=c.id AND x.model_id=$2 AND x.disabled_at IS NULL)`, [known.name, m, known.rates.input, known.rates.cached, known.rates.output, base?.created_by, s.lab_id]);
    await syncSupplierModels(pool, s.lab_id);
    await audit(pool, { kind: 'system', id: 'key-watch' }, 'upstream.model_auto_launched', null, s.supplier_id, { model_id: m, catalog_id: known.id });
    add(s.supplier_id, 'auto_launched', m, { catalog_id: known.id, name: known.name });
   }
   for (const o of OFFICIAL_MODELS.filter(o => o.upstream === 'kerapi' && !upstream.includes(o.upstreamModel))) add(s.supplier_id, 'catalog_not_upstream', o.name, { catalog_id: o.id });
  }
  summary.suppliers.push({ supplier_id: s.supplier_id, name: s.name, keys: keys.length, distinct_keys: distinct.length, registered: registered.length, upstream: upstream ? upstream.length : null, upstream_models: upstream });
 }
 // Catalog models whose upstream is not a purchase supplier at all (e.g. the DeepSeek official direct line with no key).
 const routedIds = new Set((await pool.query("SELECT DISTINCT e.model_id FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id JOIN supplier_lab_suppliers s ON s.id=e.supplier_id WHERE e.disabled_at IS NULL AND c.disabled_at IS NULL AND s.kind='supplier'")).rows.map(r => r.model_id));
 for (const o of OFFICIAL_MODELS.filter(o => o.upstream !== 'kerapi' && !routedIds.has(o.upstreamModel))) add(null, 'catalog_not_upstream', o.name, { catalog_id: o.id, upstream: o.upstream });

 // 4. events: open new ones, refresh seen ones, resolve the rest; mail new warning/critical/auto-launch events
 const fresh = [];
 for (const e of found) {
  const r = await pool.query(`INSERT INTO upstream_watch_events(supplier_id,kind,subject,level,detail) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT (coalesce(supplier_id,'00000000-0000-0000-0000-000000000000'::uuid),kind,subject) WHERE status='open' DO UPDATE SET last_seen=now(),detail=EXCLUDED.detail,level=EXCLUDED.level RETURNING id,(xmax=0) AS inserted`, [e.supplier_id, e.kind, e.subject, e.level, e.detail]);
  if (r.rows[0].inserted) fresh.push({ ...e, id: r.rows[0].id });
 }
 const keep = found.map(e => [e.supplier_id || '00000000-0000-0000-0000-000000000000', e.kind, e.subject].join('|'));
 await pool.query(`UPDATE upstream_watch_events SET status='resolved',resolved_at=now() WHERE status='open' AND NOT (concat_ws('|',coalesce(supplier_id,'00000000-0000-0000-0000-000000000000'::uuid)::text,kind,subject) = ANY($1::text[]))`, [keep]);
 const notify = fresh.filter(e => e.level !== 'info' || e.kind === 'auto_launched');
 let mailed = 0;
 if (notify.length && mail?.ready) {
  const admins = (await pool.query("SELECT email FROM staff_members WHERE role='platform_admin' AND status='active' AND email IS NOT NULL")).rows.map(r => r.email);
  const lines = notify.map(e => `【${e.level === 'critical' ? '严重' : e.level === 'warning' ? '注意' : '已处理'}】${eventTitle(e)}${e.detail?.error ? '（' + e.detail.error + '）' : ''}`);
  for (const to of admins) { try { await mail.queue({ to, subject: `semifly 上游告警：${notify.length} 项${notify.some(e => e.level === 'critical') ? '（含严重）' : ''}`, text: lines.join('\n') + '\n\n处理入口：技术后台 → 总览 → 风险提示' }); mailed++; } catch { /* stays on the dashboard */ } }
  if (mailed) await pool.query('UPDATE upstream_watch_events SET notified_at=now() WHERE id=ANY($1::bigint[])', [notify.map(e => e.id)]);
 }
 summary.events = found.length; summary.new_events = fresh.length; summary.mailed = mailed;
 await pool.query('INSERT INTO upstream_watch_runs(trigger,started_at,finished_at,summary) VALUES($1,$2,now(),$3)', [trigger, started, summary]);
 return summary;
}

export function keyWatchRoutes(app, pool, cfg, requireStaff, { box, fetchImpl = fetch, mail = null }) {
 let running = null;
 app.get('/api/staff/lab/key-watch', requireStaff, async (req, res) => {
  requireTechnical(req);
  const [run, events] = await Promise.all([pool.query('SELECT trigger,started_at,finished_at,summary FROM upstream_watch_runs ORDER BY started_at DESC LIMIT 1'), pool.query("SELECT * FROM upstream_watch_events WHERE status='open' ORDER BY CASE level WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,first_seen DESC")]);
  res.json({ interval_minutes: WATCH_INTERVAL_MS / 60000, last_run: run.rows[0] || null, running: Boolean(running), events: events.rows.map(e => ({ ...e, title: eventTitle(e) })) });
 });
 app.post('/api/staff/lab/key-watch/run', requireStaff, async (req, res) => {
  requireTechnical(req); if (!box) throw new HttpError(503, '验收加密服务未配置');
  if (running) throw new HttpError(409, '检查正在进行，请稍候');
  running = runKeyWatch(pool, { box, fetchImpl, mail, trigger: 'manual' }).finally(() => { running = null; });
  await audit(pool, req.actor, 'upstream.key_watch_run', null, null, {});
  res.json(await running);
 });
}
