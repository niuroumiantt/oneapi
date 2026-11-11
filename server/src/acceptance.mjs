// Acceptance matrix: which tool + option combinations work through our gateway.
// Real employee traffic teaches us each tool's request format (structure only, never the conversation);
// staff then replay those formats against any routed model, through the same validation employees hit.
import { createHash, randomUUID } from 'node:crypto';
import { HttpError, audit } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { employeeRequest, employeeRoutes, upstreamSecret } from './employee-credit.mjs';

export const FEATURES = [
 ['basic', '基础对话'], ['stream', '流式输出'], ['tools', '工具调用'], ['tool_choice', '指定工具'], ['image', '图片输入'], ['json', 'JSON 输出'],
 ['effort_low', '思考·低'], ['effort_medium', '思考·中'], ['effort_high', '思考·高'], ['effort_max', '思考·超高'],
 ['thinking_on', '开启思考'], ['thinking_off', '关闭思考'], ['out_8k', '输出 ≥8K'], ['out_32k', '输出 ≥32K'], ['ctx_32k', '上下文 ≥32K'], ['ctx_128k', '上下文 ≥128K']
];
const SYNTHETIC_CLIENT = '标准接口（合成）';
const MAX_TOOLS_JSON = 256 * 1024, MAX_REPLAY_CHARS = 400000, RUN_LIMIT = 40, CONCURRENCY = 3, TIMEOUT_MS = 120000;
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FILLER = '这是一段用于测试上下文长度的占位文字，请忽略。';

const textChars = content => typeof content === 'string' ? content.length : Array.isArray(content) ? content.reduce((n, p) => n + (typeof p?.text === 'string' ? p.text.length : 0), 0) : 0;
const partTypes = content => Array.isArray(content) ? [...new Set(content.map(p => String(p?.type || 'unknown')))] : ['text'];
const hasImage = messages => messages.some(m => Array.isArray(m?.content) && m.content.some(p => ['image_url', 'input_image', 'image'].includes(p?.type)));

/** Which matrix columns a request exercises. */
export function featuresOf(body) {
 const f = new Set(['basic']), messages = Array.isArray(body?.messages) ? body.messages : [];
 const tools = Array.isArray(body?.tools) ? body.tools : Array.isArray(body?.functions) ? body.functions : [];
 if (body?.stream === true) f.add('stream');
 if (tools.length) f.add('tools');
 const choice = body?.tool_choice ?? body?.function_call;
 if (choice && typeof choice === 'object' || choice === 'required') f.add('tool_choice');
 if (hasImage(messages)) f.add('image');
 if (['json_object', 'json_schema'].includes(body?.response_format?.type)) f.add('json');
 const effort = String(body?.reasoning_effort ?? body?.reasoning?.effort ?? '').toLowerCase();
 if (['minimal', 'low'].includes(effort)) f.add('effort_low');
 else if (effort === 'medium') f.add('effort_medium');
 else if (effort === 'high') f.add('effort_high');
 else if (['xhigh', 'max', 'maximum'].includes(effort)) f.add('effort_max');
 const kw = body?.chat_template_kwargs || {};
 const thinking = body?.thinking?.type ?? (typeof body?.thinking === 'boolean' ? (body.thinking ? 'enabled' : 'disabled') : null)
  ?? (typeof body?.enable_thinking === 'boolean' ? (body.enable_thinking ? 'enabled' : 'disabled') : null)
  ?? (typeof kw.enable_thinking === 'boolean' ? (kw.enable_thinking ? 'enabled' : 'disabled') : typeof kw.thinking === 'boolean' ? (kw.thinking ? 'enabled' : 'disabled') : null);
 if (thinking === 'enabled') f.add('thinking_on');
 if (thinking === 'disabled') f.add('thinking_off');
 const out = Number(body?.max_tokens ?? body?.max_completion_tokens ?? 0);
 if (out >= 8192) f.add('out_8k');
 if (out >= 32768) f.add('out_32k');
 // About 3.5 bytes of serialized prompt per token across Chinese, English and JSON.
 const tokens = Buffer.byteLength(JSON.stringify({ messages, tools })) / 3.5;
 if (tokens >= 32000) f.add('ctx_32k');
 if (tokens >= 128000) f.add('ctx_128k');
 return FEATURES.map(([k]) => k).filter(k => f.has(k));
}

/** The request's structure without any conversation text; tool schemas are the agent's, not the employee's. */
export function shapeOf(body) {
 const messages = Array.isArray(body?.messages) ? body.messages : [];
 const params = {};
 for (const [k, v] of Object.entries(body || {})) {
  if (['messages', 'tools', 'functions', 'model', 'user', 'metadata', 'prompt_cache_key', 'safety_identifier'].includes(k)) continue;
  if (v === null || ['number', 'boolean'].includes(typeof v)) params[k] = v;
  else if (typeof v === 'string') params[k] = v.slice(0, 80);
  else { const json = JSON.stringify(v); params[k] = json.length <= 2000 ? v : '[太大，未保存]'; }
 }
 const tools = Array.isArray(body?.tools) ? body.tools : Array.isArray(body?.functions) ? body.functions : [];
 const toolsJson = JSON.stringify(tools);
 return {
  params,
  tool_key: Array.isArray(body?.functions) && !Array.isArray(body?.tools) ? 'functions' : 'tools',
  tool_count: tools.length,
  tool_names: tools.slice(0, 60).map(t => String(t?.function?.name ?? t?.name ?? '').slice(0, 60)),
  tools: tools.length && toolsJson.length <= MAX_TOOLS_JSON ? tools : null,
  system_chars: messages.filter(m => ['system', 'developer'].includes(m?.role)).reduce((n, m) => n + textChars(m.content), 0),
  total_chars: messages.reduce((n, m) => n + textChars(m?.content), 0) + (tools.length ? toolsJson.length : 0),
  messages: messages.slice(-40).map(m => ({ role: String(m?.role || '').slice(0, 20), chars: textChars(m?.content), parts: partTypes(m?.content), tool_calls: Array.isArray(m?.tool_calls) ? m.tool_calls.length : 0 })),
  message_count: messages.length
 };
}

export function profileSignature(client, body) {
 const keys = Object.keys(body || {}).filter(k => !['messages', 'model', 'user', 'metadata'].includes(k)).sort();
 return createHash('sha256').update(JSON.stringify([client || '', featuresOf(body), keys])).digest('hex').slice(0, 32);
}

/** Learns a format from a real call. Returns the signature at once; the write happens in the background. */
export function recordProfile(pool, origin, body, rejection = null) {
 let signature;
 try { signature = profileSignature(origin.client, body); } catch { return null; }
 const client = origin.client || '未识别的工具';
 pool.query(`INSERT INTO acceptance_profiles(signature,client,client_detail,features,shape,seen_count,rejected_count,last_error) VALUES($1,$2,$3,$4,$5,1,$6,$7)
  ON CONFLICT(signature) DO UPDATE SET seen_count=acceptance_profiles.seen_count+1,rejected_count=acceptance_profiles.rejected_count+EXCLUDED.rejected_count,
   last_error=COALESCE(EXCLUDED.last_error,acceptance_profiles.last_error),client_detail=EXCLUDED.client_detail,last_seen=now(),
   shape=CASE WHEN acceptance_profiles.last_seen<now()-interval '1 hour' THEN EXCLUDED.shape ELSE acceptance_profiles.shape END`,
 [signature, client, origin.detail || null, featuresOf(body), shapeOf(body), rejection ? 1 : 0, rejection ? String(rejection).slice(0, 300) : null]).catch(() => {});
 return signature;
}

const getTimeTool = { type: 'function', function: { name: 'get_time', description: '返回当前时间', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: [] } } };
/** One synthetic request per column, so the matrix has a baseline before any tool is recorded. */
const SYNTHETIC = {
 basic: {}, stream: { stream: true }, tools: { tools: [getTimeTool] }, tool_choice: { tools: [getTimeTool], tool_choice: { type: 'function', function: { name: 'get_time' } } },
 image: { image: true }, json: { response_format: { type: 'json_object' } },
 effort_low: { reasoning_effort: 'low' }, effort_medium: { reasoning_effort: 'medium' }, effort_high: { reasoning_effort: 'high' }, effort_max: { reasoning_effort: 'max' },
 thinking_on: { thinking: { type: 'enabled' } }, thinking_off: { thinking: { type: 'disabled' } },
 out_8k: { max_tokens: 8192 }, out_32k: { max_tokens: 32768 }, ctx_32k: { context: 60000 }, ctx_128k: { context: 200000 }
};
function syntheticBody(feature) {
 const { image, context, ...params } = SYNTHETIC[feature];
 const user = image ? [{ type: 'text', text: '这张图是什么颜色？' }, { type: 'image_url', image_url: { url: PIXEL } }] : feature === 'json' ? '以 JSON 回复 {"ok":true}' : '请只回复：收到';
 const messages = [...(context ? [{ role: 'system', content: FILLER.repeat(Math.ceil(context / FILLER.length)) }] : []), { role: 'user', content: user }];
 return { model: 'x', messages, max_tokens: 256, ...params };
}
let seeded = false;
async function seedSynthetic(pool) {
 if (seeded) return;
 for (const [feature] of FEATURES) {
  const body = syntheticBody(feature);
  await pool.query(`INSERT INTO acceptance_profiles(signature,client,features,shape,synthetic) VALUES($1,$2,$3,$4,true) ON CONFLICT(signature) DO UPDATE SET features=EXCLUDED.features,shape=EXCLUDED.shape`,
   ['synthetic:' + feature, SYNTHETIC_CLIENT, featuresOf(body), { ...shapeOf(body), synthetic_feature: feature }]);
 }
 seeded = true;
}

/** Rebuilds a request of the same structure and size, with our own test question instead of the original text. */
export function replayBody(profile, modelId) {
 if (profile.synthetic) return { ...syntheticBody(profile.shape.synthetic_feature), model: modelId };
 const shape = profile.shape, features = new Set(profile.features);
 const ask = features.has('json') ? '以 JSON 回复 {"ok":true}' : '请只回复：收到';
 const user = features.has('image') ? [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: PIXEL } }] : ask;
 let tools = shape.tools;
 if (!tools && shape.tool_count) {
  const named = shape.params?.tool_choice?.function?.name;
  tools = (shape.tool_names.length ? shape.tool_names : ['get_time']).map(name => ({ ...getTimeTool, function: { ...getTimeTool.function, name: name || named || 'get_time' } }));
 }
 const toolChars = tools ? JSON.stringify(tools).length : 0;
 const filler = Math.min(MAX_REPLAY_CHARS, Math.max(shape.system_chars || 0, (shape.total_chars || 0) - toolChars));
 const messages = [...(filler > 0 ? [{ role: 'system', content: FILLER.repeat(Math.ceil(filler / FILLER.length)).slice(0, filler) }] : []), { role: 'user', content: user }];
 const body = { ...shape.params, model: modelId, messages };
 if (tools) body[shape.tool_key === 'functions' ? 'functions' : 'tools'] = tools;
 return body;
}

function parseStream(text) {
 let content = '', reasoning = '', toolCalls = 0, done = false, usage = null, chunks = 0, error = null;
 for (const line of text.split('\n')) {
  const data = line.startsWith('data:') ? line.slice(5).trim() : null;
  if (!data) continue;
  if (data === '[DONE]') { done = true; continue; }
  try {
   const j = JSON.parse(data); chunks++;
   if (j.error) error = j.error.message || JSON.stringify(j.error);
   const d = j.choices?.[0]?.delta || {};
   content += d.content || ''; reasoning += d.reasoning_content || d.reasoning || '';
   if (Array.isArray(d.tool_calls)) toolCalls += d.tool_calls.filter(t => t.id || t.function?.name).length;
   if (j.usage) usage = j.usage;
  } catch { /* keep-alive comments and partial lines */ }
 }
 return { content, reasoning, toolCalls, done, usage, chunks, error };
}

/** pass, partial (answered but an asked-for option had no effect) or fail. */
export function judge(features, httpStatus, raw, stream) {
 const f = new Set(features);
 if (httpStatus < 200 || httpStatus >= 300) {
  let message = raw.slice(0, 300);
  try { const j = JSON.parse(raw); message = j.error?.message || j.message || message; } catch { /* not JSON */ }
  return { status: 'fail', note: `HTTP ${httpStatus}：${message}` };
 }
 let r;
 if (stream) { r = parseStream(raw); if (r.error) return { status: 'fail', note: '流中返回错误：' + r.error, ...r }; if (!r.done) return { status: 'partial', note: `流式输出没有正常结束（收到 ${r.chunks} 段，缺少 [DONE]）`, ...r }; }
 else {
  try { const j = JSON.parse(raw), m = j.choices?.[0]?.message || {}; r = { content: m.content || '', reasoning: m.reasoning_content || m.reasoning || '', toolCalls: Array.isArray(m.tool_calls) ? m.tool_calls.length : 0, usage: j.usage || null }; }
  catch { return { status: 'fail', note: '返回内容不是 JSON' }; }
 }
 if (!r.content && !r.reasoning && !r.toolCalls) return { status: 'partial', note: '请求成功，但回复为空', ...r };
 if (f.has('tool_choice') && !r.toolCalls) return { status: 'partial', note: '指定了工具，但模型没有调用', ...r };
 if (f.has('json')) { try { JSON.parse(r.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return { status: 'partial', note: '要求 JSON 输出，但回复不是合法 JSON', ...r }; } }
 const wantsThinking = ['effort_low', 'effort_medium', 'effort_high', 'effort_max', 'thinking_on'].some(k => f.has(k));
 if (wantsThinking && !r.reasoning) return { status: 'partial', note: '要求思考，但没有返回思考内容（可能被上游忽略）', ...r };
 if (f.has('thinking_off') && r.reasoning) return { status: 'partial', note: '要求关闭思考，但仍返回了思考内容', ...r };
 return { status: 'pass', note: r.toolCalls ? `调用了 ${r.toolCalls} 个工具` : r.reasoning ? '有思考内容与回复' : '正常回复', ...r };
}

export function acceptanceRoutes(app, pool, cfg, requireStaff, upstreamFetch = fetch) {
 let run = null;

 async function replayOne(profile, route, runId, actor) {
  const started = performance.now();
  let status = 'fail', note = '', httpStatus = null, excerpt = null, usage = null;
  try {
   const { payload, stream } = employeeRequest(replayBody(profile, route.model.id));
   const secret = await upstreamSecret(route, cfg);
   const response = await upstreamFetch(`${route.baseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
   httpStatus = response.status;
   const raw = await response.text();
   const verdict = judge(profile.features, response.status, raw, stream);
   ({ status, note } = verdict); usage = verdict.usage || null;
   excerpt = [verdict.reasoning ? '【思考】' + verdict.reasoning.slice(0, 200) : '', verdict.content ? verdict.content.slice(0, 300) : '', verdict.toolCalls ? `【工具调用 ${verdict.toolCalls} 个】` : ''].filter(Boolean).join('\n') || raw.slice(0, 300);
  } catch (e) {
   note = e instanceof HttpError ? `网关拒绝（${e.status}）：${e.message}` : e.name === 'TimeoutError' ? `超过 ${TIMEOUT_MS / 1000} 秒无响应` : '连接上游失败：' + String(e.message || e).slice(0, 200);
   if (e instanceof HttpError) httpStatus = e.status;
  }
  await pool.query('INSERT INTO acceptance_results(run_id,signature,model_id,status,http_status,latency_ms,note,excerpt,usage,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   [runId, profile.signature, route.model.id, status, httpStatus, Math.round(performance.now() - started), note, excerpt, usage, actor]);
 }

 app.get('/api/staff/lab/acceptance', requireStaff, async (req, res) => {
  requireTechnical(req); await seedSynthetic(pool);
  const [routes, profiles, latest, real] = await Promise.all([
   employeeRoutes(pool, cfg),
   pool.query('SELECT signature,client,client_detail,features,synthetic,seen_count,rejected_count,last_error,first_seen,last_seen,shape->\'tool_count\' AS tool_count,shape->\'params\' AS params FROM acceptance_profiles ORDER BY synthetic DESC,client,last_seen DESC'),
   pool.query('SELECT DISTINCT ON (signature,model_id) signature,model_id,status,http_status,latency_ms,note,excerpt,created_at FROM acceptance_results ORDER BY signature,model_id,created_at DESC'),
   pool.query("SELECT profile_signature AS signature,model_id,count(*)::int AS calls,count(*) FILTER (WHERE status='failed')::int AS failed,max(created_at) AS last_at FROM employee_calls WHERE profile_signature IS NOT NULL AND created_at>now()-interval '30 days' GROUP BY 1,2")
  ]);
  const results = {}, calls = {};
  for (const r of latest.rows) (results[r.signature] ||= {})[r.model_id] = r;
  for (const r of real.rows) (calls[r.signature] ||= {})[r.model_id] = r;
  res.json({
   features: FEATURES.map(([id, name]) => ({ id, name })),
   models: routes.map(r => ({ id: r.model.id, name: r.model.name })),
   profiles: profiles.rows.map(p => ({ ...p, results: results[p.signature] || {}, calls: calls[p.signature] || {} })),
   run: run && { ...run, profiles: undefined }
  });
 });

 app.get('/api/staff/lab/acceptance/profiles/:signature', requireStaff, async (req, res) => {
  requireTechnical(req);
  const signature = String(req.params.signature).slice(0, 64);
  const profile = (await pool.query('SELECT * FROM acceptance_profiles WHERE signature=$1', [signature])).rows[0];
  if (!profile) throw new HttpError(404, '没有这条请求格式');
  const { tools, ...shape } = profile.shape;
  const history = (await pool.query('SELECT model_id,status,http_status,latency_ms,note,excerpt,created_at FROM acceptance_results WHERE signature=$1 ORDER BY created_at DESC LIMIT 12', [signature])).rows;
  res.json({ ...profile, shape: { ...shape, tools_saved: Boolean(tools) }, history });
 });

 app.post('/api/staff/lab/acceptance/replay', requireStaff, async (req, res) => {
  requireTechnical(req);
  if (run && !run.finished_at) throw new HttpError(409, '上一轮回放还在进行，请稍候');
  await seedSynthetic(pool);
  const route = (await employeeRoutes(pool, cfg)).find(r => r.model.id === req.body?.model_id);
  if (!route) throw new HttpError(400, '这个模型目前没有接通，无法回放');
  const wanted = Array.isArray(req.body?.signatures) ? req.body.signatures.map(String).slice(0, RUN_LIMIT) : null;
  const profiles = (await pool.query(`SELECT signature,features,shape,synthetic FROM acceptance_profiles WHERE ($1::text[] IS NULL OR signature=ANY($1)) ORDER BY synthetic DESC,last_seen DESC LIMIT ${RUN_LIMIT}`, [wanted])).rows;
  if (!profiles.length) throw new HttpError(400, '没有可回放的请求格式');
  const runId = randomUUID();
  run = { id: runId, model_id: route.model.id, total: profiles.length, done: 0, started_at: new Date().toISOString(), finished_at: null, by: req.staff.email || req.staff.subject };
  await audit(pool, req.actor, 'acceptance.replay_started', null, runId, { model_id: route.model.id, profiles: profiles.length });
  const current = run, queue = [...profiles];
  const worker = async () => { for (let p = queue.shift(); p; p = queue.shift()) { await replayOne(p, route, runId, current.by).catch(() => {}); current.done++; } };
  Promise.all(Array.from({ length: CONCURRENCY }, worker)).finally(() => { current.finished_at = new Date().toISOString(); });
  res.status(202).json({ run: current });
 });
}
