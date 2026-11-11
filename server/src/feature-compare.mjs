// 功能对比: the same feature probes sent to the official API (reference key, no gateway) and to our API
// (gateway → supplier, exactly what employees get). The official result is the baseline; a cell is a gap
// only when the official API does something ours does not.
import { randomUUID } from 'node:crypto';
import { HttpError, audit, id, vault } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { FEATURES, syntheticBody, featuresOf, judge } from './acceptance.mjs';
import { employeeRequest, employeeRoutes, upstreamSecret } from './employee-credit.mjs';
import { validateLabBaseUrl } from './supplier-lab.mjs';

const TIMEOUT_MS = 120000, CONCURRENCY = 3, LONG = ['ctx_32k', 'ctx_128k'];
const RANK = { pass: 2, partial: 1, fail: 0 };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const familyOfHost = host => /deepseek/.test(host) ? 'deepseek' : /bigmodel|z\.ai/.test(host) ? 'glm' : 'other';

/** same: both work. gap: official works better than ours. extra: ours works, official does not. neither: both fail/partial alike. */
export function compareOutcome(official, ours) {
 if (!official || !ours) return 'pending';
 const o = RANK[official.status] ?? 0, u = RANK[ours.status] ?? 0;
 if (u < o) return 'gap';
 if (u > o) return 'extra';
 return o === 2 ? 'same' : 'neither';
}

const sideRecord = (verdict, httpStatus, started, raw) => ({
 status: verdict.status, note: verdict.note, http_status: httpStatus, latency_ms: Math.round(performance.now() - started),
 excerpt: [verdict.reasoning ? '【思考】' + verdict.reasoning.slice(0, 160) : '', verdict.content ? verdict.content.slice(0, 240) : '', verdict.toolCalls ? `【工具调用 ${verdict.toolCalls} 个】` : ''].filter(Boolean).join('\n') || (raw ? raw.slice(0, 240) : ''),
 usage: verdict.usage ? { prompt_tokens: verdict.usage.prompt_tokens ?? null, completion_tokens: verdict.usage.completion_tokens ?? null } : null
});

export function featureCompareRoutes(app, pool, cfg, requireStaff, upstreamFetch = fetch) {
 const secret = process.env.SUPPLIER_LAB_SECRET, box = secret?.length >= 32 ? vault(secret) : null;
 let active = null;

 async function references() {
  return (await pool.query(`SELECT e.id,e.model_id,e.base_url,c.credential_ciphertext,p.display_name AS vendor
   FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id JOIN supplier_lab_suppliers s ON s.id=e.supplier_id JOIN suppliers p ON p.id=s.canonical_supplier_id
   WHERE e.kind='reference' AND e.disabled_at IS NULL AND c.disabled_at IS NULL AND s.disabled_at IS NULL ORDER BY p.display_name,e.model_id`)).rows.map(r => ({ ...r, family: familyOfHost(new URL(r.base_url).hostname) }));
 }
 // Our routed models, each paired with an official model: the saved choice, else an id match, else the first of the same family.
 async function pairs() {
  const [routes, refs, saved] = await Promise.all([employeeRoutes(pool, cfg, { includePaused: true }), references(), pool.query('SELECT our_model,reference_endpoint_id FROM feature_compare_pairs')]);
  const chosen = new Map(saved.rows.map(r => [r.our_model, r.reference_endpoint_id]));
  return routes.map(r => {
   const m = r.model, candidates = refs.filter(x => x.family === m.family);
   const pick = refs.find(x => x.id === chosen.get(m.id)) || candidates.find(x => norm(x.model_id) === norm(m.upstreamModel)) || candidates.find(x => norm(x.model_id) === norm(m.id)) || candidates[0] || null;
   return { route: r, model: { id: m.id, name: m.name, family: m.family, upstream_model: m.upstreamModel }, reference: pick, candidates: candidates.map(({ credential_ciphertext, ...x }) => x) };
  });
 }

 async function probeOurs(route, feature) {
  const started = performance.now(); const body = { ...syntheticBody(feature), model: route.model.id };
  try {
   const { payload, stream } = employeeRequest(body);
   const key = await upstreamSecret(route, cfg);
   const response = await upstreamFetch(`${route.baseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
   const raw = await response.text();
   return sideRecord(judge(featuresOf(body), response.status, raw, stream), response.status, started, raw);
  } catch (e) {
   const note = e instanceof HttpError ? `网关拒绝（${e.status}）：${e.message}` : e.name === 'TimeoutError' ? `超过 ${TIMEOUT_MS / 1000} 秒无响应` : '连接上游失败：' + String(e.message || e).slice(0, 200);
   return { status: 'fail', note, http_status: e instanceof HttpError ? e.status : null, latency_ms: Math.round(performance.now() - started), excerpt: '', usage: null };
  }
 }
 async function probeOfficial(ref, feature) {
  const started = performance.now(); const body = { ...syntheticBody(feature), model: ref.model_id }, stream = body.stream === true;
  if (stream) body.stream_options = { include_usage: true };
  try {
   validateLabBaseUrl(ref.base_url);
   const key = box.open(ref.credential_ciphertext).key;
   const response = await upstreamFetch(`${ref.base_url}/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
   const raw = (await response.text()).replaceAll(key, '***');
   return sideRecord(judge(featuresOf(body), response.status, raw, stream), response.status, started, raw);
  } catch (e) {
   return { status: 'fail', note: e.name === 'TimeoutError' ? `超过 ${TIMEOUT_MS / 1000} 秒无响应` : '连接官方失败：' + String(e.message || e).slice(0, 200), http_status: null, latency_ms: Math.round(performance.now() - started), excerpt: '', usage: null };
  }
 }

 async function execute(run, work) {
  const queue = [...work];
  const worker = async () => {
   for (let t = queue.shift(); t; t = queue.shift()) {
    const [official, ours] = await Promise.all([probeOfficial(t.reference, t.feature), probeOurs(t.route, t.feature)]);
    await pool.query('INSERT INTO feature_compare_items(run_id,our_model,reference_endpoint_id,reference_model,feature,ours,official,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(run_id,our_model,feature) DO NOTHING',
     [run.id, t.route.model.id, t.reference.id, t.reference.model_id, t.feature, ours, official, compareOutcome(official, ours)]).catch(() => {});
    run.done++;
   }
  };
  try { await Promise.all(Array.from({ length: CONCURRENCY }, worker)); await pool.query("UPDATE feature_compare_runs SET status='completed',done=$2,finished_at=now() WHERE id=$1", [run.id, run.done]); }
  catch { await pool.query("UPDATE feature_compare_runs SET status='failed',done=$2,finished_at=now() WHERE id=$1", [run.id, run.done]).catch(() => {}); }
 }

 app.get('/api/staff/lab/feature-compare', requireStaff, async (req, res) => {
  requireTechnical(req);
  const [list, latest, last] = await Promise.all([pairs(),
   pool.query('SELECT DISTINCT ON (our_model,feature) our_model,reference_model,feature,ours,official,outcome,created_at,run_id FROM feature_compare_items ORDER BY our_model,feature,created_at DESC'),
   pool.query('SELECT * FROM feature_compare_runs ORDER BY created_at DESC LIMIT 1')]);
  const cells = {}; for (const r of latest.rows) (cells[r.our_model] ||= {})[r.feature] = r;
  const paired = list.filter(p => p.reference).length;
  res.json({
   ready: Boolean(box), features: FEATURES.map(([fid, name]) => ({ id: fid, name, long: LONG.includes(fid) })),
   models: list.map(p => ({ ...p.model, reference: p.reference ? { endpoint_id: p.reference.id, model_id: p.reference.model_id, vendor: p.reference.vendor } : null, candidates: p.candidates })),
   cells, run: active ? { ...active } : last.rows[0] || null,
   estimate: { pairs: paired, calls: paired * FEATURES.length * 2, long_calls: paired * LONG.length * 2 }
  });
 });

 app.put('/api/staff/lab/feature-compare/pairs', requireStaff, async (req, res) => {
  requireTechnical(req);
  const ourModel = String(req.body?.our_model || ''), endpointId = req.body?.reference_endpoint_id ? id(req.body.reference_endpoint_id) : null;
  const list = await pairs(), p = list.find(x => x.model.id === ourModel);
  if (!p) throw new HttpError(404, '这个模型没有接通');
  if (endpointId && !p.candidates.some(c => c.id === endpointId)) throw new HttpError(400, '对照型号必须是同一系列的官方型号');
  if (endpointId) await pool.query('INSERT INTO feature_compare_pairs(our_model,reference_endpoint_id,updated_by) VALUES($1,$2,$3) ON CONFLICT(our_model) DO UPDATE SET reference_endpoint_id=EXCLUDED.reference_endpoint_id,updated_by=EXCLUDED.updated_by,updated_at=now()', [ourModel, endpointId, req.staff.subject]);
  else await pool.query('DELETE FROM feature_compare_pairs WHERE our_model=$1', [ourModel]);
  res.json({ ok: true });
 });

 app.post('/api/staff/lab/feature-compare/runs', requireStaff, async (req, res) => {
  requireTechnical(req);
  if (!box) throw new HttpError(503, '验收加密服务未配置');
  if (active) throw new HttpError(409, '上一轮功能对比还在进行，请稍候');
  const wanted = Array.isArray(req.body?.models) ? req.body.models.map(String) : null, skipLong = req.body?.skip_long === true;
  const list = (await pairs()).filter(p => p.reference && (!wanted || wanted.includes(p.model.id)));
  if (!list.length) throw new HttpError(400, '没有可对比的型号：先在“评测 Key”登记官方 Key，并确认型号已接通');
  const features = FEATURES.map(([f]) => f).filter(f => !skipLong || !LONG.includes(f));
  const work = list.flatMap(p => features.map(feature => ({ route: p.route, reference: p.reference, feature })));
  const run = { id: randomUUID(), status: 'running', models: list.map(p => p.model.id), skip_long: skipLong, total: work.length, done: 0, created_by: req.staff.subject, created_at: new Date().toISOString(), finished_at: null };
  await pool.query('INSERT INTO feature_compare_runs(id,status,models,skip_long,total,done,created_by) VALUES($1,$2,$3,$4,$5,0,$6)', [run.id, 'running', run.models, skipLong, work.length, req.staff.subject]);
  await audit(pool, req.actor, 'feature_compare.started', null, run.id, { models: run.models, probes: work.length, skip_long: skipLong });
  active = run;
  void execute(run, work).finally(() => { active = null; });
  res.status(202).json({ run_id: run.id, probes: work.length });
 });
}
