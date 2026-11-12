// 功能对比: the same feature probes sent to the official API (reference key, no gateway) and to our API
// (gateway → supplier, exactly what employees get). The official result is the baseline; a cell is a gap
// only when the official API does something ours does not.
import { randomUUID } from 'node:crypto';
import { HttpError, audit, id, vault } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { FEATURES, syntheticBody, featuresOf, judge } from './acceptance.mjs';
import { employeeRequest, employeeRoutes, upstreamSecret } from './employee-credit.mjs';
import { validateLabBaseUrl } from './supplier-lab.mjs';
import { routeFetch } from './output-guard.mjs';
import { findOfficialModel } from './official-models.mjs';

const TIMEOUT_MS = 120000, CONCURRENCY = 3, LONG = ['ctx_32k', 'ctx_128k'];
const RANK = { pass: 2, partial: 1, fail: 0 };
const GROUP = { basic: '基础', stream: '基础', image: '输入与格式', json: '输入与格式', tools: '工具调用', tool_choice: '工具调用', effort_low: '思考', effort_medium: '思考', effort_high: '思考', effort_max: '思考', thinking_on: '思考', thinking_off: '思考', out_8k: '输出长度', out_32k: '输出长度', ctx_32k: '长上下文', ctx_128k: '长上下文' };
const HINT = { basic: '一句话问答能不能正常回', stream: 'stream=true 能不能逐字返回并正常结束', image: '消息里带一张图片', json: 'response_format=json_object 能不能回合法 JSON', tools: '给工具定义，模型会不会发起工具调用', tool_choice: '指定必须调用某个工具，模型会不会照做', effort_low: '思考强度 low', effort_medium: '思考强度 medium', effort_high: '思考强度 high', effort_max: '思考强度 max', thinking_on: '打开思考，是否返回思考内容', thinking_off: '关闭思考，是否不再返回思考内容', out_8k: 'max_tokens=8192 是否被接受', out_32k: 'max_tokens=32768 是否被接受', ctx_32k: '约 3 万字上下文能否处理', ctx_128k: '约 12 万字上下文能否处理' };
const timeTool = { type: 'function', function: { name: 'get_time', description: '返回当前时间', parameters: { type: 'object', properties: {}, required: [] } } };
const weatherTool = { type: 'function', function: { name: 'get_weather', description: '查询城市天气', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } };
const PREFIX = Array.from({ length: 120 }, (_, i) => `第${i + 1}条：网关把员工请求转发给上游，按官方价结算，失败不扣费。`).join('\n');
const cachedOf = u => u ? (u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? null) : null;
// Tests agents rely on that the shared 16 probes do not cover. check(reply) → [status, note].
const EXTRA = [
 { id: 'system_prompt', name: '系统提示词', group: '对话', hint: '系统提示词要求只回 ACK，看是否遵守', body: () => ({ messages: [{ role: 'system', content: '无论用户说什么，你只回复 ACK 三个字母，不要别的。' }, { role: 'user', content: '你好，今天天气怎么样？' }], max_tokens: 1024 }), check: r => /^\s*ACK\s*[.。!！]?\s*$/i.test(r.content) ? ['pass', '只回了 ACK'] : r.content ? ['partial', '回答了，但没有严格遵守系统提示词'] : ['partial', '没有正文回答'] },
 { id: 'multi_turn', name: '多轮对话记忆', group: '对话', hint: '前一轮说过的内容，后一轮能不能答出来', body: () => ({ messages: [{ role: 'user', content: '记住：我的工号是 7342。' }, { role: 'assistant', content: '好的，记住了。' }, { role: 'user', content: '我的工号是多少？只回数字。' }], max_tokens: 1024 }), check: r => r.content.includes('7342') ? ['pass', '记住了上文'] : ['partial', '没答出上文里的工号'] },
 { id: 'tool_result', name: '工具结果回传', group: '工具调用', hint: 'Agent 把工具执行结果发回去，模型能不能接着用结果作答', body: () => ({ tools: [timeTool], messages: [{ role: 'user', content: '现在几点？' }, { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'call_1', content: '2026-11-11 15:30' }], max_tokens: 1024 }), check: r => /15[:：点]\s*30|三点半|15点半/.test(r.content) ? ['pass', '用上了工具返回的时间'] : r.toolCalls ? ['partial', '又发起了一次工具调用，没有直接用结果作答'] : ['partial', '回答里没有用到工具结果'] },
 { id: 'parallel_tools', name: '一次调用多个工具', group: '工具调用', hint: '需要两个工具时，能不能一次发出两个调用', body: () => ({ tools: [timeTool, weatherTool], messages: [{ role: 'user', content: '请同时调用两个工具：查现在的时间，并查北京的天气。' }], max_tokens: 1024 }), check: r => r.toolCalls >= 2 ? ['pass', `一次发出 ${r.toolCalls} 个工具调用`] : r.toolCalls === 1 ? ['partial', '只发出 1 个工具调用'] : ['partial', '没有调用工具'] },
 { id: 'json_schema', name: 'JSON Schema 约束', group: '输入与格式', hint: 'response_format=json_schema，严格按给定结构输出', body: () => ({ response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: { type: 'object', properties: { ok: { type: 'boolean' }, n: { type: 'integer' } }, required: ['ok', 'n'], additionalProperties: false } } }, messages: [{ role: 'user', content: '请按要求的 JSON 结构回复：字段 ok 填 true，字段 n 填 3。' }], max_tokens: 1024 }), check: r => { try { const j = JSON.parse(r.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); return j.ok === true && j.n === 3 ? ['pass', '结构和取值都对'] : ['partial', '是 JSON，但字段或取值不对']; } catch { return ['partial', '不是合法 JSON']; } } },
 { id: 'stop_seq', name: '停止词', group: '输入与格式', hint: 'stop 参数遇到指定字符就停', body: () => ({ stop: ['3'], messages: [{ role: 'user', content: '从 1 数到 5，用逗号分隔，只输出数字。' }], max_tokens: 1024 }), check: r => r.content.includes('2') && !r.content.includes('3') ? ['pass', '在 3 之前停下了'] : r.content.includes('3') ? ['partial', '没有在停止词处停下'] : ['partial', '回答不完整'] },
 { id: 'finish_length', name: '输出截断标记', group: '输出长度', hint: '超过 max_tokens 时 finish_reason 要是 length，Agent 靠它判断要不要续写', body: () => ({ max_tokens: 16, messages: [{ role: 'user', content: '写一段 300 字的自我介绍。' }] }), check: r => r.finish === 'length' ? ['pass', 'finish_reason=length'] : ['partial', `finish_reason=${r.finish || '未返回'}`] },
 { id: 'stream_usage', name: '流式返回用量', group: '计费', hint: '流式结束时带 usage，计费靠它', body: () => ({ stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: '请只回复：收到' }], max_tokens: 1024 }), check: r => r.usage?.completion_tokens != null ? ['pass', `用量 ${r.usage.prompt_tokens}+${r.usage.completion_tokens}`] : ['partial', '流结束时没有返回用量'] },
 { id: 'cache_hit', name: '缓存命中', group: '计费', hint: '同样的长前缀发两次，第二次是否报告缓存命中（命中部分更便宜）', repeat: 2, calls: 2, body: () => ({ messages: [{ role: 'system', content: PREFIX }, { role: 'user', content: '请只回复：收到' }], max_tokens: 64 }), check: r => cachedOf(r.usage) > 0 ? ['pass', `第二次命中缓存 ${cachedOf(r.usage)} Token`] : r.usage ? ['partial', '没有报告缓存命中'] : ['partial', '没有返回用量'] }
];
const EXTRA_BY_ID = new Map(EXTRA.map(x => [x.id, x]));
export const TESTS = [...FEATURES.map(([id, name]) => ({ id, name, group: GROUP[id] || '其他', hint: HINT[id] || '', long: LONG.includes(id), calls: 1 })), ...EXTRA.map(x => ({ id: x.id, name: x.name, group: x.group, hint: x.hint, long: false, calls: x.calls || 1 }))];
const TEST_IDS = new Set(TESTS.map(t => t.id));
// Reads a non-streaming JSON reply or an SSE stream into the same shape.
export function parseReply(http, raw, stream) {
 if (http < 200 || http >= 300) { let m = raw.slice(0, 300); try { const j = JSON.parse(raw); m = j.error?.message || j.message || m; } catch {} return { error: `HTTP ${http}：${m}` }; }
 const out = { content: '', reasoning: '', toolCalls: 0, toolNames: [], finish: null, usage: null };
 if (!stream) { try { const j = JSON.parse(raw), c = j.choices?.[0] || {}, m = c.message || {}; out.content = m.content || ''; out.reasoning = m.reasoning_content || ''; out.toolCalls = (m.tool_calls || []).length; out.toolNames = (m.tool_calls || []).map(t => t.function?.name); out.finish = c.finish_reason || null; out.usage = j.usage || null; } catch { return { error: '返回内容不是 JSON' }; } return out; }
 const tools = new Map();
 for (const line of raw.split('\n')) { if (!line.startsWith('data:')) continue; const d = line.slice(5).trim(); if (d === '[DONE]') continue; try { const j = JSON.parse(d), c = j.choices?.[0]; if (j.usage) out.usage = j.usage; if (!c) continue; out.content += c.delta?.content || ''; out.reasoning += c.delta?.reasoning_content || ''; for (const t of c.delta?.tool_calls || []) { const k = t.index ?? tools.size; if (!tools.has(k)) tools.set(k, t.function?.name); } if (c.finish_reason) out.finish = c.finish_reason; } catch {} }
 out.toolCalls = tools.size; out.toolNames = [...tools.values()];
 return out;
}
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

// A published snapshot is what the public #realtesting page shows: verdicts and short notes only, no replies, no request ids.
const cleanNote = v => String(v || '').replace(/\s*\((?:request_id|Request id)[^)]*\)/gi, '').replace(/Request id: \S+/gi, '').replace(/\*\*\*/g, '…').slice(0, 160);
export function buildSnapshot(run, items) {
 const ids = [...new Set(items.map(i => i.our_model))], tests = TESTS.filter(t => items.some(i => i.feature === t.id));
 const models = ids.map(id => { const mine = items.filter(i => i.our_model === id), first = mine[0];
  return { id, name: findOfficialModel(id)?.name || id, reference: first.reference_model, vendor: first.vendor || '', cells: Object.fromEntries(mine.map(i => [i.feature, { outcome: i.outcome, official: i.official.status, ours: i.ours.status, official_note: cleanNote(i.official.note), ours_note: cleanNote(i.ours.note) }])) }; });
 const names = Object.fromEntries(TESTS.map(t => [t.id, t.name])), all = models.flatMap(m => Object.entries(m.cells).map(([t, c]) => ({ m, t, c })));
 const list = k => [...new Set(all.filter(x => x.c.outcome === k).map(x => names[x.t]))];
 const findings = [
  { kind: 'fixed', title: '输出上限放开到 32K', detail: '第一轮对比发现：两家官方都能一次输出 32K Token，而我们的网关当时只放 8K。网关上限已提高到 32768，这一项现在全部与官方一致。' },
  { kind: 'fixed', title: 'GLM 的思考强度与 JSON Schema 自动换算', detail: 'GLM-5.3 系列始终思考，官方只接受 low、high、max 三档；供应商的 GLM 模型也不支持 json_schema 结构化输出。一些 Agent 会发 none、medium、“关闭思考”或 json_schema，直接转发会报错。网关现在把它们换成 GLM 能接受的写法（最接近的思考档位；json_object 加上结构说明），Agent 不再报错。' },
  { kind: 'watching', title: '上游不遵守输出上限时，网关代为截断', detail: '实测发现供应商的 GLM-5.3-FlashX 会忽略 max_tokens：要 16 个 Token 返回了 200 到 1500 多个，并标记为正常结束。网关现在对这类模型改为流式读取，到用户设定的上限就停止并返回 finish_reason=length，与官方行为一致。每 30 分钟的自动检查持续确认，上游修好后自动解除。' }];
 if (list('extra').length) findings.push({ kind: 'ours_better', title: '有些能力我们比官方更多', detail: '以下测试官方返回错误或不支持，而我们这一路能正常使用：' + list('extra').join('、') + '。例如 DeepSeek 官方在思考模式下不支持指定工具和 JSON Schema，并要求工具结果回传时附带思考内容，我们的线路都能正常处理。' });
 if (list('neither').length) findings.push({ kind: 'model_limit', title: '模型本身的能力边界', detail: '以下测试官方自己也不支持或只部分支持，两边结果一致，属于模型本身的限制：' + list('neither').join('、') + '。例如 GLM-5.3 只接受文字输入。' });
 const gaps = all.filter(x => x.c.outcome === 'gap');
 if (gaps.length) findings.push({ kind: 'watching', title: `仍在跟进的差异（${gaps.length} 项）`, detail: gaps.map(x => `${x.m.name} · ${names[x.t]}：官方 ${x.c.official_note}；我们 ${x.c.ours_note}`).join('；').slice(0, 700) });
 const perModel = tests.reduce((n, t) => n + (t.calls || 1), 0);
 return { run: { id: run.id, started_at: run.created_at, finished_at: run.finished_at, requests: perModel * 2 * models.length }, tests: tests.map(({ id, name, group, hint }) => ({ id, name, group, hint })), models, findings };
}

// Shared by 功能对比 and 身份检测: our routed models paired with official models, and one request down either path.
export function compareLinks(pool, cfg, upstreamFetch = fetch) {
 const secret = process.env.SUPPLIER_LAB_SECRET, box = secret?.length >= 32 ? vault(secret) : null;
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

 // One request down one path. Ours goes through the same validation and translation employees get; official goes straight to the vendor.
 async function send(side, target, body, timeoutMs = TIMEOUT_MS) {
  const started = performance.now();
  try {
   if (side === 'ours') {
    const { payload, stream } = employeeRequest({ ...body, model: target.model.id });
    const key = await upstreamSecret(target, cfg);
    const response = await routeFetch(pool, upstreamFetch, target.model.upstreamModel, `${target.baseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    return { http: response.status, raw: await response.text(), stream, started };
   }
   const req = { ...body, model: target.model_id }, stream = req.stream === true; if (stream) req.stream_options = { include_usage: true };
   validateLabBaseUrl(target.base_url); const key = box.open(target.credential_ciphertext).key;
   const response = await upstreamFetch(`${target.base_url}/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(req), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
   return { http: response.status, raw: (await response.text()).replaceAll(key, '***'), stream, started };
  } catch (e) {
   const note = e instanceof HttpError ? `网关拒绝（${e.status}）：${e.message}` : e.name === 'TimeoutError' ? `超过 ${timeoutMs / 1000} 秒无响应` : (side === 'ours' ? '连接上游失败：' : '连接官方失败：') + String(e.message || e).slice(0, 200);
   return { error: { status: 'fail', note, http_status: e instanceof HttpError ? e.status : null, latency_ms: Math.round(performance.now() - started), excerpt: '', usage: null } };
  }
 }
 return { box, pairs, send };
}

export function featureCompareRoutes(app, pool, cfg, requireStaff, upstreamFetch = fetch) {
 const { box, pairs, send } = compareLinks(pool, cfg, upstreamFetch);
 let active = null;
 async function probe(side, target, testId) {
  const extra = EXTRA_BY_ID.get(testId);
  if (!extra) { const body = syntheticBody(testId), r = await send(side, target, body); if (r.error) return r.error; return sideRecord(judge(featuresOf(body), r.http, r.raw, r.stream), r.http, r.started, r.raw); }
  let r;
  for (let i = 0; i < (extra.repeat || 1); i++) { r = await send(side, target, extra.body()); if (r.error) return r.error; }
  const reply = parseReply(r.http, r.raw, r.stream);
  const [status, note] = reply.error ? ['fail', reply.error] : extra.check(reply);
  return { status, note, http_status: r.http, latency_ms: Math.round(performance.now() - r.started), excerpt: [reply.reasoning ? '【思考】' + reply.reasoning.slice(0, 160) : '', reply.content ? reply.content.slice(0, 240) : '', reply.toolCalls ? `【工具调用 ${reply.toolCalls} 个：${reply.toolNames.join('、')}】` : '', reply.finish ? `finish_reason=${reply.finish}` : ''].filter(Boolean).join('\n') || r.raw.slice(0, 240), usage: reply.usage ? { prompt_tokens: reply.usage.prompt_tokens ?? null, completion_tokens: reply.usage.completion_tokens ?? null, cached_tokens: cachedOf(reply.usage) } : null };
 }

 async function execute(run, work) {
  const queue = [...work];
  const worker = async () => {
   for (let t = queue.shift(); t; t = queue.shift()) {
    const [official, ours] = await Promise.all([probe('official', t.reference, t.feature), probe('ours', t.route, t.feature)]);
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
   ready: Boolean(box), features: TESTS,
   models: list.map(p => ({ ...p.model, reference: p.reference ? { endpoint_id: p.reference.id, model_id: p.reference.model_id, vendor: p.reference.vendor } : null, candidates: p.candidates })),
   cells, run: active ? { ...active } : last.rows[0] || null,
   published: (await pool.query("SELECT id,run_id,published_at FROM published_reports WHERE kind='realtesting' ORDER BY published_at DESC LIMIT 1")).rows[0] || null,
   estimate: { pairs: paired, calls: paired * TESTS.reduce((n, t) => n + (t.calls || 1), 0) * 2, long_calls: paired * LONG.length * 2 }
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

 app.post('/api/staff/lab/feature-compare/publish', requireStaff, async (req, res) => {
  requireTechnical(req);
  const run = (await pool.query("SELECT * FROM feature_compare_runs WHERE status='completed' AND ($1::uuid IS NULL OR id=$1) ORDER BY created_at DESC LIMIT 1", [req.body?.run_id ? id(req.body.run_id) : null])).rows[0];
  if (!run) throw new HttpError(404, '没有已完成的对比可以发布');
  const items = (await pool.query(`SELECT i.*,p.display_name AS vendor FROM feature_compare_items i LEFT JOIN supplier_lab_endpoints e ON e.id=i.reference_endpoint_id LEFT JOIN supplier_lab_suppliers s ON s.id=e.supplier_id LEFT JOIN suppliers p ON p.id=s.canonical_supplier_id WHERE i.run_id=$1`, [run.id])).rows;
  if (items.length < 10) throw new HttpError(409, `这次对比只有 ${items.length} 项结果，太少，请跑完整对比再发布`);
  const snapshot = buildSnapshot(run, items);
  const row = (await pool.query("INSERT INTO published_reports(kind,run_id,data,published_by) VALUES('realtesting',$1,$2,$3) RETURNING id,published_at", [run.id, snapshot, req.staff.subject])).rows[0];
  await audit(pool, req.actor, 'realtesting.published', null, run.id, { report_id: row.id, models: snapshot.models.length, tests: snapshot.tests.length });
  res.status(201).json({ id: row.id, published_at: row.published_at, url: '/#realtesting', models: snapshot.models.length, tests: snapshot.tests.length });
 });
 // Public, read-only: the latest published report.
 app.get('/api/public/realtesting', async (req, res) => {
  const row = (await pool.query("SELECT data,published_at FROM published_reports WHERE kind='realtesting' ORDER BY published_at DESC LIMIT 1")).rows[0];
  res.set('Cache-Control', 'public, max-age=60');
  if (!row) return res.status(404).json({ error: '还没有发布的实测报告' });
  res.json({ ...row.data, published_at: row.published_at });
 });

 app.post('/api/staff/lab/feature-compare/runs', requireStaff, async (req, res) => {
  requireTechnical(req);
  if (!box) throw new HttpError(503, '验收加密服务未配置');
  if (active) throw new HttpError(409, '上一轮功能对比还在进行，请稍候');
  const wanted = Array.isArray(req.body?.models) ? req.body.models.map(String) : null, skipLong = req.body?.skip_long === true;
  const picked = Array.isArray(req.body?.tests) && req.body.tests.length ? req.body.tests.map(String) : null;
  if (picked && picked.some(t => !TEST_IDS.has(t))) throw new HttpError(400, '没有这个测试项');
  const list = (await pairs()).filter(p => p.reference && (!wanted || wanted.includes(p.model.id)));
  if (!list.length) throw new HttpError(400, '没有可对比的型号：先在“评测 Key”登记官方 Key，并确认型号已接通');
  const features = (picked || TESTS.map(t => t.id)).filter(f => !skipLong || !LONG.includes(f));
  if (!features.length) throw new HttpError(400, '至少选一项测试');
  const work = list.flatMap(p => features.map(feature => ({ route: p.route, reference: p.reference, feature })));
  const run = { id: randomUUID(), status: 'running', models: list.map(p => p.model.id), skip_long: skipLong, total: work.length, done: 0, created_by: req.staff.subject, created_at: new Date().toISOString(), finished_at: null };
  await pool.query('INSERT INTO feature_compare_runs(id,status,models,skip_long,total,done,created_by) VALUES($1,$2,$3,$4,$5,0,$6)', [run.id, 'running', run.models, skipLong, work.length, req.staff.subject]);
  await audit(pool, req.actor, 'feature_compare.started', null, run.id, { models: run.models, probes: work.length, skip_long: skipLong });
  active = run;
  void execute(run, work).finally(() => { active = null; });
  res.status(202).json({ run_id: run.id, probes: work.length });
 });
}
