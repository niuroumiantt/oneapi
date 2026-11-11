// Step load test against one upstream model: concurrency climbs step by step (1, 2, 4, 8 …) with streaming requests,
// recording time to first token, total time, output speed and errors. It stops early when a step fails too often,
// when spending reaches the budget, or when staff press stop. The result is a stable concurrency figure,
// shown next to the employees' real peak concurrency on the same model.
import { HttpError, audit, id, vault } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { validateLabBaseUrl, calculateProbeCostYuan } from './supplier-lab.mjs';
import { findOfficialModel } from './official-models.mjs';

const memo = n => Array.from({ length: n }, (_, i) => `第${i + 1}段：项目组本周完成了接口联调、文档更新和两次回归测试，客户反馈主要集中在响应速度、错误提示和账单明细三个方面，下周计划优化缓存策略并补充监控告警。`).join('\n');
export const LOAD_PROFILES = Object.freeze({
 short: { name: '短问答', note: '一句话提问，回答约 60 字。看首字延迟和排队。', prompt: '用一句话解释什么是 API 网关。', maxTokens: 96 },
 chat: { name: '常规对话', note: '约 2 千字上下文，回答约 300 字。接近员工日常使用。', prompt: `以下是项目周报：\n${memo(24)}\n\n请总结这份周报的三个主要问题，并各给一条改进建议。`, maxTokens: 512 },
 long: { name: '长上下文', note: '约 2 万字上下文，回答约 100 字。看长输入下的排队和首字延迟。', prompt: `以下是项目周报汇编：\n${memo(260)}\n\n请用两句话概括这些周报反复出现的问题。`, maxTokens: 200 },
});
export const LOAD_LIMITS = Object.freeze({ maxConcurrency: 32, maxRequests: 240, maxBudget: 20, failStop: 0.2, timeoutMs: 120000 });
const STEP_CHOICES = [1, 2, 4, 8, 12, 16, 24, 32];
// Conservative input estimate: one token per character covers Chinese text with room to spare.
const estimateInput = p => [...p.prompt].length + 20;

export function planCost(endpoint, profile, steps, rounds) {
 if (endpoint.input_yuan_per_m == null || endpoint.output_yuan_per_m == null) return null;
 const requests = steps.reduce((n, c) => n + c * rounds, 0);
 return requests * (estimateInput(profile) * Number(endpoint.input_yuan_per_m) + profile.maxTokens * Number(endpoint.output_yuan_per_m)) / 1e6;
}

// One streaming request. Never throws.
export async function streamOnce(fetchImpl, key, endpoint, profile, signal) {
 const out = { ok: false, http_status: null, error: null, ttft_ms: null, total_ms: null, input_tokens: null, output_tokens: null, cost_yuan: null, started_at: new Date() };
 const started = performance.now();
 try {
  const response = await fetchImpl(`${endpoint.base_url}/chat/completions`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
   body: JSON.stringify({ model: endpoint.model_id, messages: [{ role: 'user', content: profile.prompt }], max_tokens: profile.maxTokens, temperature: 0.7, stream: true, stream_options: { include_usage: true } }),
   signal: AbortSignal.any([AbortSignal.timeout(LOAD_LIMITS.timeoutMs), signal]) });
  out.http_status = response.status;
  if (!response.ok) { const raw = (await response.text()).slice(0, 400); let msg = raw; try { msg = JSON.parse(raw)?.error?.message || raw; } catch {} out.error = `HTTP ${response.status}：${String(msg).replaceAll(key, '***').slice(0, 160)}`; return out; }
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', chars = 0, usage = null;
  for (;;) {
   const { done, value } = await reader.read(); if (done) break;
   buffer += decoder.decode(value, { stream: true });
   let nl; while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
    if (!line.startsWith('data:')) continue; const data = line.slice(5).trim(); if (data === '[DONE]') continue;
    let chunk; try { chunk = JSON.parse(data); } catch { continue; }
    const delta = chunk.choices?.[0]?.delta || {}, text = (delta.content || '') + (delta.reasoning_content || '');
    if (text) { if (out.ttft_ms === null) out.ttft_ms = Math.round(performance.now() - started); chars += text.length; }
    if (chunk.usage) usage = chunk.usage;
   }
  }
  const int = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
  out.input_tokens = int(usage?.prompt_tokens); out.output_tokens = int(usage?.completion_tokens);
  out.cost_yuan = calculateProbeCostYuan(endpoint, out.input_tokens, int(usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens) ?? 0, out.output_tokens);
  out.ok = chars > 0; if (!out.ok) out.error = '流式响应没有内容';
 } catch (e) {
  out.error = e?.name === 'TimeoutError' ? `超过 ${LOAD_LIMITS.timeoutMs / 1000} 秒` : e?.name === 'AbortError' ? '已手动停止' : '连接失败：' + String(e?.message || e).slice(0, 120);
 } finally { out.total_ms = Math.round(performance.now() - started); }
 return out;
}

const pct = (xs, p) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
export function summarizeSteps(test, samples) {
 const steps = test.steps.filter(c => samples.some(s => s.step === c)).map(c => {
  const rows = samples.filter(s => s.step === c), ok = rows.filter(s => s.ok);
  const begin = Math.min(...rows.map(s => +new Date(s.started_at))), end = Math.max(...rows.map(s => +new Date(s.started_at) + (s.total_ms || 0)));
  const speeds = ok.filter(s => s.output_tokens && s.total_ms > (s.ttft_ms || 0)).map(s => s.output_tokens / ((s.total_ms - (s.ttft_ms || 0)) / 1000));
  return { concurrency: c, requests: rows.length, ok: ok.length, rate_limited: rows.filter(s => s.http_status === 429).length, errors: rows.length - ok.length,
   success_rate: rows.length ? ok.length / rows.length : null, ttft_p50: pct(ok.map(s => s.ttft_ms), 0.5), ttft_p95: pct(ok.map(s => s.ttft_ms), 0.95),
   total_p50: pct(ok.map(s => s.total_ms), 0.5), total_p95: pct(ok.map(s => s.total_ms), 0.95), speed_p50: pct(speeds, 0.5) == null ? null : Math.round(pct(speeds, 0.5)),
   throughput: end > begin ? Math.round(ok.reduce((n, s) => n + (s.output_tokens || 0), 0) / ((end - begin) / 1000)) : null,
   cost_yuan: rows.reduce((n, s) => n + Number(s.cost_yuan || 0), 0), top_error: Object.entries(rows.filter(s => !s.ok).reduce((m, s) => (m[s.error] = (m[s.error] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1])[0]?.[0] || null };
 });
 const base = steps.find(s => s.ok);
 // Stable: nearly everything succeeds and first-token latency has not blown up versus the lightest step.
 const stable = steps.filter(s => s.success_rate >= 0.98 && base && s.ttft_p95 != null && s.ttft_p95 <= Math.max(base.ttft_p95 * 3, base.ttft_p95 + 2000));
 let stableConcurrency = 0; for (const s of steps) { if (stable.includes(s)) stableConcurrency = s.concurrency; else break; }
 return { steps, stable_concurrency: stableConcurrency, cost_yuan: steps.reduce((n, s) => n + s.cost_yuan, 0), requests: samples.length };
}

export function stressRoutes(app, pool, cfg, requireStaff, fetchImpl = fetch) {
 const secret = process.env.SUPPLIER_LAB_SECRET, box = secret?.length >= 32 ? vault(secret) : null;
 let active = null;
 const endpointSql = `SELECT e.id,e.label,e.model_id,e.base_url,e.input_yuan_per_m,e.cached_input_yuan_per_m,e.output_yuan_per_m,c.label AS credential_label,c.credential_ciphertext,s.name AS supplier_name
  FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id JOIN supplier_lab_suppliers s ON s.id=e.supplier_id
  WHERE e.kind='supplier' AND e.disabled_at IS NULL AND c.disabled_at IS NULL AND s.disabled_at IS NULL`;

 // Highest number of employee calls in flight at once on this model over the last 7 days.
 async function realPeak(upstreamModel) {
  const model = findOfficialModel(upstreamModel); if (!model) return null;
  const r = (await pool.query(`WITH ev AS (SELECT created_at AS t,1 AS d FROM employee_calls WHERE model_id=$1 AND created_at>now()-interval '7 days'
   UNION ALL SELECT coalesce(finished_at,created_at+make_interval(secs=>coalesce(latency_ms,0)/1000.0)),-1 FROM employee_calls WHERE model_id=$1 AND created_at>now()-interval '7 days')
   SELECT coalesce(max(running),0)::int AS peak,(SELECT count(*)::int FROM employee_calls WHERE model_id=$1 AND created_at>now()-interval '7 days') AS calls
   FROM (SELECT sum(d) OVER (ORDER BY t,d) AS running FROM ev) x`, [model.id])).rows[0];
  return { model_id: model.id, peak: r.peak, calls: r.calls };
 }

 async function execute(test, endpoint, profile, controller) {
  const key = box.open(endpoint.credential_ciphertext).key; let spent = 0, reason = null;
  try {
   for (const c of test.steps) {
    if (controller.signal.aborted) { reason = '已手动停止'; break; }
    active.step = c; let remaining = c * test.rounds;
    const worker = async () => { while (remaining > 0 && !controller.signal.aborted) { remaining--; const r = await streamOnce(fetchImpl, key, endpoint, profile, controller.signal); spent += Number(r.cost_yuan || 0); active.done++; if (controller.signal.aborted && !r.ok) return;
     await pool.query('INSERT INTO load_samples(test_id,step,ok,http_status,error,ttft_ms,total_ms,input_tokens,output_tokens,cost_yuan,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [test.id, c, r.ok, r.http_status, r.error, r.ttft_ms, r.total_ms, r.input_tokens, r.output_tokens, r.cost_yuan, r.started_at]); } };
    await Promise.all(Array.from({ length: c }, worker));
    if (controller.signal.aborted) { reason = '已手动停止'; break; }
    const rows = (await pool.query('SELECT ok FROM load_samples WHERE test_id=$1 AND step=$2', [test.id, c])).rows, failed = rows.filter(r => !r.ok).length;
    if (rows.length && failed / rows.length > LOAD_LIMITS.failStop) { reason = `并发 ${c} 时失败 ${failed}/${rows.length}，超过 ${LOAD_LIMITS.failStop * 100}%，停止加压`; break; }
    if (spent >= Number(test.budget_yuan)) { reason = `已花费 ¥${spent.toFixed(4)}，达到预算`; break; }
   }
   await pool.query("UPDATE load_tests SET status=$2,stop_reason=$3,finished_at=now() WHERE id=$1", [test.id, reason ? 'stopped' : 'completed', reason]);
  } catch (e) {
   await pool.query("UPDATE load_tests SET status='failed',stop_reason=$2,finished_at=now() WHERE id=$1", [test.id, String(e?.message || e).slice(0, 200)]).catch(() => {});
  }
 }

 app.get('/api/staff/lab/load-tests', requireStaff, async (req, res) => {
  requireTechnical(req);
  await pool.query("UPDATE load_tests SET status='failed',stop_reason='服务重启，测试中断',finished_at=now() WHERE status='running' AND created_at<now()-interval '1 minute' AND ($1::uuid IS NULL OR id<>$1)", [active?.id || null]);
  const [endpoints, tests] = await Promise.all([pool.query(endpointSql + ' ORDER BY s.name,e.model_id,c.priority,c.created_at DESC'), pool.query(`SELECT t.*,e.model_id,c.label AS credential_label FROM load_tests t JOIN supplier_lab_endpoints e ON e.id=t.endpoint_id LEFT JOIN supplier_lab_credentials c ON c.id=e.credential_id ORDER BY t.created_at DESC LIMIT 20`)]);
  const peaks = {}; for (const m of new Set(endpoints.rows.map(e => e.model_id))) peaks[m] = await realPeak(m);
  const ids = tests.rows.map(t => t.id), samples = ids.length ? (await pool.query('SELECT test_id,step,ok,http_status,error,ttft_ms,total_ms,output_tokens,cost_yuan,started_at FROM load_samples WHERE test_id=ANY($1::uuid[])', [ids])).rows : [];
  res.json({ ready: Boolean(box), limits: LOAD_LIMITS, step_choices: STEP_CHOICES,
   profiles: Object.entries(LOAD_PROFILES).map(([k, p]) => ({ id: k, name: p.name, note: p.note, input_estimate: estimateInput(p), max_tokens: p.maxTokens })),
   endpoints: endpoints.rows.map(({ credential_ciphertext, ...e }) => ({ ...e, real: peaks[e.model_id] })),
   active: active && { id: active.id, step: active.step, done: active.done, total: active.total },
   tests: tests.rows.map(t => ({ ...t, real: peaks[t.model_id] ?? null, summary: summarizeSteps(t, samples.filter(s => s.test_id === t.id)) })) });
 });

 app.post('/api/staff/lab/load-tests', requireStaff, async (req, res) => {
  requireTechnical(req);
  if (!box) throw new HttpError(503, '验收加密服务未配置');
  if (active) throw new HttpError(409, '已有压测在运行，请等它结束或先停止');
  const b = req.body || {}, endpointId = id(b.endpoint_id), profile = LOAD_PROFILES[b.profile];
  if (!profile) throw new HttpError(400, '请选择负载类型');
  const steps = Array.isArray(b.steps) ? [...new Set(b.steps.map(Number))].sort((x, y) => x - y) : [];
  if (!steps.length || steps.some(c => !STEP_CHOICES.includes(c))) throw new HttpError(400, `并发档位只能从 ${STEP_CHOICES.join('、')} 里选`);
  const rounds = Number(b.rounds ?? 2); if (![1, 2, 3].includes(rounds)) throw new HttpError(400, '每档轮数需为 1 至 3');
  const requests = steps.reduce((n, c) => n + c * rounds, 0); if (requests > LOAD_LIMITS.maxRequests) throw new HttpError(400, `总请求 ${requests} 次，超过上限 ${LOAD_LIMITS.maxRequests}`);
  const budget = Number(b.budget_yuan); if (!Number.isFinite(budget) || budget <= 0 || budget > LOAD_LIMITS.maxBudget) throw new HttpError(400, `预算需大于 0 且不超过 ${LOAD_LIMITS.maxBudget} 元`);
  const endpoint = (await pool.query(endpointSql + ' AND e.id=$1', [endpointId])).rows[0];
  if (!endpoint) throw new HttpError(404, '型号不存在或 Key 已停用');
  validateLabBaseUrl(endpoint.base_url);
  const need = planCost(endpoint, profile, steps, rounds);
  if (need === null) throw new HttpError(400, '请先给这个型号登记费率，才能估算压测费用');
  if (need > budget) throw new HttpError(400, `按最长回答估算最多约 ¥${need.toFixed(2)}，超过预算 ¥${budget}`);
  active = { id: null, step: null, done: 0, total: requests };
  try {
   const test = (await pool.query('INSERT INTO load_tests(endpoint_id,profile,steps,rounds,budget_yuan,max_cost_yuan,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [endpointId, b.profile, steps, rounds, budget, need, req.staff.subject])).rows[0];
   await audit(pool, req.actor, 'load_test.started', null, test.id, { endpoint_id: endpointId, profile: b.profile, steps, rounds, budget, max_cost_yuan: need });
   const controller = new AbortController(); Object.assign(active, { id: test.id, controller });
   void execute(test, endpoint, profile, controller).finally(() => { active = null; });
   res.status(202).json({ test_id: test.id, requests, max_cost_yuan: need });
  } catch (e) { active = null; throw e; }
 });

 app.post('/api/staff/lab/load-tests/:id/stop', requireStaff, async (req, res) => {
  requireTechnical(req); const testId = id(req.params.id);
  if (!active || active.id !== testId) throw new HttpError(409, '这次压测已经结束');
  active.controller.abort(); await audit(pool, req.actor, 'load_test.stopped', null, testId);
  res.json({ ok: true });
 });
}
