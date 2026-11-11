// Agent 对比: the same agent does the same tasks down two paths and the outputs are compared.
// Path A is always our route (gateway → KerAPI). Path B is either the official API (gateway test key routed to an
// official reference model, so the transcript is captured just like A) or the agent's built-in model (nothing passes
// through us, so the staff member pastes the final answer). Grading: blind judge model asked twice with sides swapped,
// plus staff blind votes. Test keys are staff-owned, bill nothing to employees, store full transcripts, and die with the run.
import express from 'express';
import { once } from 'node:events';
import { randomInt } from 'node:crypto';
import { HttpError, audit, hash, id, text, token, transaction, vault } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { employeeRequest, employeeRoutes, upstreamSecret } from './employee-credit.mjs';
import { validateLabBaseUrl } from './supplier-lab.mjs';
import { judgeItem } from './compare.mjs';

export const AGENT_TASKS = Object.freeze([
 { id: 'bugfix', name: '修一个边界 bug', prompt: '下面这个函数本应返回数组中最大的 k 个数（降序），但有个边界错误。请找出并修正，只给出修正后的完整函数和一句话说明。\n\nfunction topK(nums, k) {\n  const sorted = [...nums].sort((a, b) => b - a);\n  const out = [];\n  for (let i = 0; i <= k; i++) out.push(sorted[i]);\n  return out;\n}', rubric: '指出 i <= k 多取一个（应为 i < k）并给出正确函数；k 超过数组长度时不出现 undefined 可加分。' },
 { id: 'feature', name: '写函数并配测试', prompt: '用 Python 写 parse_duration(s)：把 "1h30m"、"45s"、"2h"、"10m5s" 这类字符串解析为总秒数（整数），非法输入抛 ValueError。再写 5 个 pytest 用例覆盖正常和非法情况。', rubric: 'h/m/s 组合解析正确，非法输入抛 ValueError，5 个可运行的测试且覆盖非法输入。' },
 { id: 'explain', name: '解释一段代码', prompt: '用不超过 150 字解释下面代码的作用和一个潜在问题：\n\nconst cache = new Map();\nexport async function getUser(id) {\n  if (cache.has(id)) return cache.get(id);\n  const p = fetch(\'/api/users/\' + id).then(r => r.json());\n  cache.set(id, p);\n  return p;\n}', rubric: '说明这是按 id 缓存 Promise 的请求去重；指出失败的 Promise 会被永久缓存（或缓存不过期）；不超过 150 字。' },
 { id: 'refactor', name: '去重重构', prompt: '重构下面代码消除重复，保持行为不变，只输出重构后的代码：\n\nfunction fmtUser(u){ return u.firstName.trim() + \' \' + u.lastName.trim() + \' <\' + u.email.trim().toLowerCase() + \'>\'; }\nfunction fmtAdmin(a){ return a.firstName.trim() + \' \' + a.lastName.trim() + \' <\' + a.email.trim().toLowerCase() + \'> [admin]\'; }\nfunction fmtGuest(g){ return g.firstName.trim() + \' \' + g.lastName.trim() + \' <\' + g.email.trim().toLowerCase() + \'> [guest]\'; }', rubric: '提取公共格式化函数，三个函数行为不变（含后缀），代码更短且无重复。' },
 { id: 'sql', name: '写一条 SQL', prompt: '表 orders(id, user_id, amount, status, created_at)。写 PostgreSQL 查询：最近 30 天内每个用户 status=\'paid\' 的订单数和总金额，只保留总金额超过 1000 的用户，按总金额降序。只输出 SQL。', rubric: '过滤最近 30 天和 paid，按 user_id 分组，count 与 sum，HAVING sum>1000，按总金额降序。' },
 { id: 'doc', name: '写一段使用说明', prompt: '为命令行工具 imgshrink 写 README 的“快速开始”小节（Markdown，不超过 200 字）：它把目录里的图片压缩到指定最大宽度，用法 imgshrink <目录> --width 1200 --out <输出目录>，默认宽度 1600，支持 jpg/png/webp。', rubric: '有用法示例、参数说明（含默认值 1600）和支持格式；Markdown；不超过 200 字。' }
]);
const TASK_BY_ID = new Map(AGENT_TASKS.map(t => [t.id, t]));
const keyPattern = /^Bearer (sf_eval_[A-Za-z0-9_-]{43})$/;
const UPSTREAM_TIMEOUT_MS = 300000, MAX_STORED = 20000;
const clip = (s, n = 4000) => typeof s === 'string' ? (s.length > n ? s.slice(0, n) + `…（共 ${s.length} 字）` : s) : s;
const storedRequest = body => ({ messages: (body.messages || []).slice(-40).map(m => ({ role: m.role, content: typeof m.content === 'string' ? clip(m.content) : Array.isArray(m.content) ? m.content.map(p => p?.type === 'text' ? clip(p.text, 2000) : { type: p?.type }) : null, tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls.length : undefined })), tools: Array.isArray(body.tools) ? body.tools.length : 0, stream: body.stream === true, max_tokens: body.max_tokens ?? body.max_completion_tokens ?? null });

function pickWinner(j) { return j?.winner === 'supplier' ? 'a' : j?.winner === 'reference' ? 'b' : j?.winner ? 'tie' : null; }
export function summarizeAgentRun(taskIds, items, reviews) {
 const side = k => { const rows = items.map(i => i[k]).filter(Boolean); const avg = f => rows.length ? Math.round(rows.reduce((n, r) => n + (f(r) || 0), 0) / rows.length) : null;
  return { done: rows.length, turns: avg(r => r.turns), output_tokens: avg(r => r.output_tokens), latency_ms: avg(r => r.latency_ms), tool_calls: avg(r => r.tool_calls), judge_avg: (() => { const s = items.map(i => i.judge?.[k === 'a' ? 'supplier_score' : 'reference_score']).filter(Number.isFinite); return s.length ? Math.round(s.reduce((x, y) => x + y, 0) / s.length * 10) / 10 : null; })() }; };
 const a = side('a'), b = side('b'), judged = items.filter(i => pickWinner(i.judge));
 const judge = { judged: judged.length, a_wins: judged.filter(i => pickWinner(i.judge) === 'a').length, b_wins: judged.filter(i => pickWinner(i.judge) === 'b').length, ties: judged.filter(i => pickWinner(i.judge) === 'tie').length, flips: judged.filter(i => i.judge.positions_agree === false).length, errors: items.filter(i => i.judge?.error).length };
 const byItem = new Map(items.map(i => [String(i.id), i]));
 const human = { reviews: reviews.length, items: new Set(reviews.map(r => String(r.item_id))).size, a: reviews.filter(r => r.verdict === 'a').length, b: reviews.filter(r => r.verdict === 'b').length, tie: reviews.filter(r => r.verdict === 'tie').length };
 const comparable = reviews.filter(r => pickWinner(byItem.get(String(r.item_id))?.judge)); human.comparable = comparable.length; human.agree_with_judge = comparable.length ? comparable.filter(r => pickWinner(byItem.get(String(r.item_id)).judge) === r.verdict).length : null;
 const gap = a.judge_avg != null && b.judge_avg != null ? Math.round((a.judge_avg - b.judge_avg) * 10) / 10 : null;
 const both = items.filter(i => i.a && i.b).length;
 const verdict = !both ? 'pending' : gap == null ? (judge.judged ? 'pending' : 'unjudged') : gap >= -0.5 ? 'match' : gap >= -1.5 ? 'slightly' : 'worse';
 const notes = [];
 if (both < taskIds.length) notes.push(`还有 ${taskIds.length - both} 道任务没两边都完成`);
 if (a.turns != null && b.turns != null && a.turns > b.turns * 1.5) notes.push(`我们这一路平均多用了 ${a.turns - b.turns} 轮调用才完成`);
 if (judge.flips > Math.max(1, judged.length / 3)) notes.push(`评审换位后结论不一致 ${judge.flips} 次，多看人工投票`);
 return { a, b, judge, human, gap, verdict, both, notes };
}

const labBox = () => { const s = process.env.SUPPLIER_LAB_SECRET; return s?.length >= 32 ? vault(s) : null; };
const refSql = `SELECT e.id,e.model_id,e.base_url,e.input_yuan_per_m,e.cached_input_yuan_per_m,e.output_yuan_per_m,c.credential_ciphertext AS active_ciphertext,c.label AS credential_label,s.kind,coalesce(p.display_name,s.name) AS vendor
  FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id JOIN supplier_lab_suppliers s ON s.id=e.supplier_id LEFT JOIN suppliers p ON p.id=s.canonical_supplier_id
  WHERE e.disabled_at IS NULL AND c.disabled_at IS NULL AND s.disabled_at IS NULL AND (p.id IS NULL OR p.status<>'blocked')`;

// The gateway side: sf_eval_ keys. Registered before the employee handler so it answers first for these keys.
export function agentCompareGateway(app, pool, cfg, upstreamFetch = fetch) {
 const box = labBox(), parser = express.json({ limit: '8mb' });
 app.post('/v1/chat/completions', (req, res, next) => keyPattern.test(req.get('authorization') || '') ? parser(req, res, next) : next('route'), async (req, res) => {
  const key = (await pool.query(`SELECT k.*,r.armed_path,r.armed_task,r.status AS run_status FROM eval_gateway_keys k JOIN agent_compare_runs r ON r.id=k.run_id WHERE k.secret_hash=$1 AND k.revoked_at IS NULL`, [hash(keyPattern.exec(req.get('authorization'))[1])])).rows[0];
  if (!key) throw new HttpError(401, '评测 Key 无效或已作废', 'invalid_api_key');
  if (key.run_status !== 'open') throw new HttpError(403, '这次对比已经结束，Key 已停用', 'run_closed');
  const taskId = key.armed_path === key.path ? key.armed_task : null;
  const body = req.body || {}, started = performance.now();
  let url, upstreamKey, payload, stream, upstreamModel;
  if (key.kind === 'official') {
   const ref = (await pool.query(refSql + ' AND e.id=$1', [key.reference_endpoint_id])).rows[0];
   if (!ref) throw new HttpError(503, '官方对照型号已停用', 'model_unavailable');
   validateLabBaseUrl(ref.base_url); upstreamKey = box.open(ref.active_ciphertext).key; url = ref.base_url; upstreamModel = ref.model_id;
   stream = body.stream === true; payload = { ...body, model: ref.model_id }; if (stream) payload.stream_options = { ...(body.stream_options || {}), include_usage: true };
  } else {
   const shaped = employeeRequest(body), route = (await employeeRoutes(pool, cfg)).find(r => r.model.id === shaped.model.id);
   if (!route) throw new HttpError(503, '这个模型暂时不可用', 'model_unavailable');
   const pick = !key.credential_id || key.credential_id === route.credentialId ? route : (route.fallbacks || []).find(f => f.credentialId === key.credential_id);
   if (!pick) throw new HttpError(503, '指定的采购 Key 不能调用这个模型', 'model_unavailable');
   const r = { ...route, credentialId: pick.credentialId, ciphertext: pick.ciphertext, baseUrl: pick.baseUrl };
   upstreamKey = await upstreamSecret(r, cfg); url = r.baseUrl; upstreamModel = route.model.upstreamModel; payload = shaped.payload; stream = shaped.stream;
  }
  const record = async (fields) => pool.query('INSERT INTO agent_compare_calls(run_id,path,task_id,key_id,model_id,upstream_model,request,content,reasoning_chars,tool_calls,usage,latency_ms,http_status,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
   [key.run_id, key.path, taskId, key.id, String(body.model || '').slice(0, 120), upstreamModel, storedRequest(body), fields.content?.slice(0, MAX_STORED) || '', fields.reasoning_chars || 0, fields.tool_calls || 0, fields.usage || null, Math.round(performance.now() - started), fields.http_status ?? null, fields.error?.slice(0, 300) || null]).catch(() => {});
  let response;
  try { response = await upstreamFetch(`${url}/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer ' + upstreamKey, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }); }
  catch (e) { await record({ error: '连接上游失败：' + String(e.message || e) }); throw new HttpError(502, '上游调用失败'); }
  if (!response.ok) {
   const raw = (await response.text().catch(() => '')).replaceAll(upstreamKey, '[REDACTED]').slice(0, 4000); let message = raw; try { message = JSON.parse(raw)?.error?.message || raw; } catch {}
   await record({ http_status: response.status, error: `HTTP ${response.status}：${message}` });
   throw new HttpError(response.status >= 400 && response.status < 500 ? response.status : 502, `上游返回 HTTP ${response.status}${message ? '：' + String(message).slice(0, 300) : ''}`);
  }
  if (!stream) {
   let result; try { result = await response.json(); } catch { await record({ http_status: 200, error: '上游响应格式异常' }); throw new HttpError(502, '上游响应格式异常'); }
   const m = result.choices?.[0]?.message || {};
   await record({ http_status: 200, content: typeof m.content === 'string' ? m.content : '', reasoning_chars: typeof m.reasoning_content === 'string' ? m.reasoning_content.length : 0, tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls.length : 0, usage: result.usage || null });
   return res.json(result);
  }
  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
  const decoder = new TextDecoder(), reader = response.body.getReader(); let tail = '', content = '', reasoning = 0, usage = null; const toolIdx = new Set();
  const inspect = line => { if (!line.startsWith('data:')) return; try { const j = JSON.parse(line.slice(5)); const d = j.choices?.[0]?.delta || {}; if (typeof d.content === 'string') content += d.content; if (typeof d.reasoning_content === 'string') reasoning += d.reasoning_content.length; for (const t of d.tool_calls || []) toolIdx.add(t.index ?? toolIdx.size); if (j.usage) usage = j.usage; } catch {} };
  try {
   for (;;) { const { done, value } = await reader.read(); if (done) break; const lines = (tail + decoder.decode(value, { stream: true })).split('\n'); tail = lines.pop(); if (tail.length > 1048576) tail = ''; lines.forEach(inspect); if (!res.write(value)) await Promise.race([once(res, 'drain'), once(res, 'close')]); if (res.destroyed) break; }
   inspect(tail);
  } catch { /* client went away */ } finally { reader.cancel().catch(() => {}); res.end(); }
  await record({ http_status: 200, content, reasoning_chars: reasoning, tool_calls: toolIdx.size, usage });
 });
}

export function agentCompareRoutes(app, pool, cfg, requireStaff, upstreamFetch = fetch) {
 const box = labBox();
 const sideFromCalls = calls => { if (!calls.length) return null; const withText = [...calls].reverse().find(c => c.content) || calls.at(-1);
  return { source: 'gateway', output: withText.content || '', turns: calls.length, tool_calls: calls.reduce((n, c) => n + c.tool_calls, 0), input_tokens: calls.reduce((n, c) => n + (c.usage?.prompt_tokens || 0), 0), output_tokens: calls.reduce((n, c) => n + (c.usage?.completion_tokens || 0), 0), latency_ms: calls.reduce((n, c) => n + c.latency_ms, 0), errors: calls.filter(c => c.error).length, models: [...new Set(calls.map(c => c.upstream_model))], finished_at: new Date().toISOString() }; };
 const taskOf = (run, taskId) => TASK_BY_ID.get(taskId) || (run.custom_tasks || []).find(t => t.id === taskId) || null;
 async function judgeTask(run, item) {
  if (!run.judge_endpoint_id || !item.a?.output || !item.b?.output) return;
  const judge = (await pool.query(refSql + ' AND e.id=$1', [run.judge_endpoint_id])).rows[0]; if (!judge) return;
  const t = taskOf(run, item.task_id); if (!t) return;
  const verdict = await judgeItem(upstreamFetch, box, judge, { id: t.id, prompt: t.prompt, rubric: t.rubric }, { output: item.a.output }, { output: item.b.output }).catch(e => ({ error: String(e?.message || e).slice(0, 160) }));
  await pool.query('UPDATE agent_compare_items SET judge=$2,updated_at=now() WHERE id=$1', [item.id, verdict]);
 }
 async function loadRun(runId) {
  const run = (await pool.query('SELECT * FROM agent_compare_runs WHERE id=$1', [runId])).rows[0]; if (!run) throw new HttpError(404, '没有这次对比');
  const [keys, items, reviews, calls] = await Promise.all([
   pool.query('SELECT id,path,label,key_hint,kind,credential_id,reference_endpoint_id,created_at,revoked_at FROM eval_gateway_keys WHERE run_id=$1 ORDER BY path,created_at DESC', [runId]),
   pool.query('SELECT * FROM agent_compare_items WHERE run_id=$1 ORDER BY id', [runId]),
   pool.query('SELECT r.item_id,r.reviewer,r.verdict,r.created_at FROM agent_compare_reviews r JOIN agent_compare_items i ON i.id=r.item_id WHERE i.run_id=$1', [runId]),
   pool.query('SELECT path,task_id,count(*)::int AS calls,max(created_at) AS last_at,count(*) FILTER(WHERE error IS NOT NULL)::int AS errors FROM agent_compare_calls WHERE run_id=$1 GROUP BY 1,2', [runId])]);
  return { run, keys: keys.rows, items: items.rows, reviews: reviews.rows, calls: calls.rows };
 }
 const newKey = async (db, run, path, spec, by) => { const s = 'sf_eval_' + token(); await db.query('UPDATE eval_gateway_keys SET revoked_at=now() WHERE run_id=$1 AND path=$2 AND revoked_at IS NULL', [run.id, path]);
  const row = (await db.query('INSERT INTO eval_gateway_keys(run_id,path,label,secret_hash,key_hint,kind,credential_id,reference_endpoint_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,path,label,key_hint,kind', [run.id, path, spec.label, hash(s), s.slice(0, 14), spec.kind, spec.credential_id || null, spec.endpoint_id || null, by])).rows[0]; return { ...row, secret: s }; };

 app.get('/api/staff/lab/agent-compare', requireStaff, async (req, res) => {
  requireTechnical(req);
  const [agents, endpoints, runs, routes] = await Promise.all([pool.query('SELECT id,name,version FROM agents ORDER BY name,created_at DESC'), pool.query(refSql + ' ORDER BY s.kind DESC,p.display_name,e.model_id'),
   pool.query('SELECT r.id,r.name,r.status,r.created_at,r.closed_at,r.path_b,a.name AS agent_name,a.version AS agent_version FROM agent_compare_runs r JOIN agents a ON a.id=r.agent_id ORDER BY r.created_at DESC LIMIT 30'), employeeRoutes(pool, cfg)]);
  const ids = [...new Set(routes.flatMap(r => [r.credentialId, ...(r.fallbacks || []).map(f => f.credentialId)].filter(Boolean)))];
  const creds = ids.length ? (await pool.query('SELECT id,label,priority FROM supplier_lab_credentials WHERE id=ANY($1::uuid[]) ORDER BY priority,created_at DESC', [ids])).rows : [];
  const out = { ready: Boolean(box), tasks: AGENT_TASKS, agents: agents.rows, official: endpoints.rows.filter(e => e.kind === 'reference').map(({ active_ciphertext, ...e }) => e), judges: endpoints.rows.map(({ active_ciphertext, ...e }) => e), our_keys: creds, runs: runs.rows };
  if (req.query.run) { const d = await loadRun(id(String(req.query.run))); const me = req.staff.subject; out.detail = { ...d, items: d.items.map(i => ({ ...i, reviews: d.reviews.filter(r => r.item_id === i.id).map(r => ({ verdict: r.verdict, mine: r.reviewer === me })) })), summary: summarizeAgentRun(d.run.task_ids, d.items, d.reviews) }; }
  res.json(out);
 });

 app.post('/api/staff/lab/agent-compare/runs', requireStaff, async (req, res) => {
  requireTechnical(req); if (!box) throw new HttpError(503, '验收加密服务未配置');
  const b = req.body || {}, agentId = id(b.agent_id), name = b.name ? text(b.name, '对比名称', 80) : '';
  const kindB = ['official', 'manual'].includes(b.path_b?.kind) ? b.path_b.kind : null; if (!kindB) throw new HttpError(400, 'B 路请选官方 API 或内置模型');
  const endpointB = kindB === 'official' ? id(b.path_b.endpoint_id) : null, judgeId = b.judge_endpoint_id ? id(b.judge_endpoint_id) : null, credA = b.path_a?.credential_id ? id(b.path_a.credential_id) : null;
  const custom = Array.isArray(b.custom_tasks) ? b.custom_tasks.slice(0, 10).map((t, i) => ({ id: 'custom' + (i + 1), name: text(t?.name, '任务名称', 60), prompt: text(t?.prompt, '任务内容', 4000), rubric: t?.rubric ? text(t.rubric, '评分要点', 600) : '按题目要求判断正确性与完整性。' })) : [];
  const taskIds = [...new Set([...(Array.isArray(b.task_ids) ? b.task_ids.map(String).filter(t => TASK_BY_ID.has(t)) : AGENT_TASKS.map(t => t.id)), ...custom.map(t => t.id)])];
  if (!taskIds.length) throw new HttpError(400, '至少选一道任务');
  const endpoints = (await pool.query(refSql + ' AND e.id=ANY($1::uuid[])', [[endpointB, judgeId].filter(Boolean)])).rows;
  const refB = endpointB ? endpoints.find(e => e.id === endpointB) : null; if (endpointB && (!refB || refB.kind !== 'reference')) throw new HttpError(400, 'B 路必须是官方评测 Key 下的型号');
  if (judgeId && !endpoints.find(e => e.id === judgeId)) throw new HttpError(400, '评审型号不存在或 Key 已停用');
  const agent = (await pool.query('SELECT * FROM agents WHERE id=$1', [agentId])).rows[0]; if (!agent) throw new HttpError(404, '没有这个 Agent');
  const result = await transaction(pool, async db => {
   const run = (await db.query('INSERT INTO agent_compare_runs(agent_id,name,judge_endpoint_id,path_a,path_b,task_ids,custom_tasks,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [agentId, name || `${agent.name} ${agent.version} · ${kindB === 'official' ? '我们 vs 官方 ' + refB.model_id : '我们 vs 内置模型'}`, judgeId, { kind: 'ours', label: '我们的线路', credential_id: credA }, kindB === 'official' ? { kind: 'official', label: '官方 ' + refB.model_id, endpoint_id: endpointB } : { kind: 'manual', label: 'Agent 内置模型' }, taskIds, JSON.stringify(custom), req.staff.subject])).rows[0];
   const a = await newKey(db, run, 'a', { label: '我们的线路', kind: 'ours', credential_id: credA }, req.staff.subject);
   const kb = kindB === 'official' ? await newKey(db, run, 'b', { label: '官方 ' + refB.model_id, kind: 'official', endpoint_id: endpointB }, req.staff.subject) : null;
   await audit(db, req.actor, 'agent_compare.run_created', null, run.id, { agent_id: agentId, path_b: kindB, tasks: taskIds.length, judge_endpoint_id: judgeId });
   return { run, keys: { a, b: kb } };
  });
  res.status(201).json(result);
 });

 app.post('/api/staff/lab/agent-compare/runs/:id/keys/:path/rotate', requireStaff, async (req, res) => {
  requireTechnical(req); const runId = id(req.params.id), path = req.params.path; if (!['a', 'b'].includes(path)) throw new HttpError(400, '路径不正确');
  const run = (await pool.query("SELECT * FROM agent_compare_runs WHERE id=$1 AND status='open'", [runId])).rows[0]; if (!run) throw new HttpError(404, '对比不存在或已结束');
  const spec = path === 'a' ? { label: run.path_a.label, kind: 'ours', credential_id: run.path_a.credential_id } : run.path_b.kind === 'official' ? { label: run.path_b.label, kind: 'official', endpoint_id: run.path_b.endpoint_id } : null;
  if (!spec) throw new HttpError(400, 'B 路是内置模型，没有 Key');
  const key = await transaction(pool, db => newKey(db, run, path, spec, req.staff.subject)); await audit(pool, req.actor, 'agent_compare.key_rotated', null, runId, { path });
  res.status(201).json(key);
 });

 app.post('/api/staff/lab/agent-compare/runs/:id/arm', requireStaff, async (req, res) => {
  requireTechnical(req); const runId = id(req.params.id), path = req.body?.path ?? null, taskId = req.body?.task_id ?? null;
  if (path !== null && !['a', 'b'].includes(path)) throw new HttpError(400, '路径不正确');
  const run = (await pool.query("SELECT * FROM agent_compare_runs WHERE id=$1 AND status='open'", [runId])).rows[0]; if (!run) throw new HttpError(404, '对比不存在或已结束');
  if (path && !run.task_ids.includes(taskId)) throw new HttpError(400, '任务不在这次对比里');
  await pool.query('UPDATE agent_compare_runs SET armed_path=$2,armed_task=$3 WHERE id=$1', [runId, path, path ? taskId : null]);
  res.json({ ok: true, armed_path: path, armed_task: path ? taskId : null });
 });

 // Mark a path of a task done: the final answer is the last call with text; stats are summed over the task's calls.
 app.post('/api/staff/lab/agent-compare/runs/:id/tasks/:task/finish', requireStaff, async (req, res) => {
  requireTechnical(req); const runId = id(req.params.id), taskId = String(req.params.task), path = req.body?.path;
  if (!['a', 'b'].includes(path)) throw new HttpError(400, '路径不正确');
  const run = (await pool.query('SELECT * FROM agent_compare_runs WHERE id=$1', [runId])).rows[0]; if (!run || !run.task_ids.includes(taskId)) throw new HttpError(404, '没有这道任务');
  const calls = (await pool.query('SELECT content,tool_calls,usage,latency_ms,error,upstream_model FROM agent_compare_calls WHERE run_id=$1 AND path=$2 AND task_id=$3 ORDER BY created_at', [runId, path, taskId])).rows;
  const side = sideFromCalls(calls); if (!side) throw new HttpError(409, '这一路还没有收到这道任务的调用：先点“开始”，再在 Agent 里做这道题');
  if (!side.output) throw new HttpError(409, `收到了 ${calls.length} 次调用，但没有一次带正文回答；Agent 可能还没答完`);
  const item = (await pool.query(`INSERT INTO agent_compare_items(run_id,task_id,${path},blind_flip) VALUES($1,$2,$3,$4) ON CONFLICT(run_id,task_id) DO UPDATE SET ${path}=EXCLUDED.${path},judge=NULL,updated_at=now() RETURNING *`, [runId, taskId, side, randomInt(2) === 1])).rows[0];
  if (run.armed_path === path && run.armed_task === taskId) await pool.query('UPDATE agent_compare_runs SET armed_path=NULL,armed_task=NULL WHERE id=$1', [runId]);
  void judgeTask(run, item);
  res.json({ ok: true, side, judging: Boolean(run.judge_endpoint_id && item.a && item.b) });
 });

 app.post('/api/staff/lab/agent-compare/runs/:id/tasks/:task/manual', requireStaff, async (req, res) => {
  requireTechnical(req); const runId = id(req.params.id), taskId = String(req.params.task), output = text(req.body?.output, '粘贴的回答', 20000);
  const run = (await pool.query('SELECT * FROM agent_compare_runs WHERE id=$1', [runId])).rows[0]; if (!run || !run.task_ids.includes(taskId)) throw new HttpError(404, '没有这道任务');
  if (run.path_b.kind !== 'manual') throw new HttpError(400, 'B 路走网关，不需要粘贴');
  const side = { source: 'manual', output, turns: null, tool_calls: null, input_tokens: null, output_tokens: null, latency_ms: null, finished_at: new Date().toISOString() };
  const item = (await pool.query('INSERT INTO agent_compare_items(run_id,task_id,b,blind_flip) VALUES($1,$2,$3,$4) ON CONFLICT(run_id,task_id) DO UPDATE SET b=EXCLUDED.b,judge=NULL,updated_at=now() RETURNING *', [runId, taskId, side, randomInt(2) === 1])).rows[0];
  void judgeTask(run, item); res.json({ ok: true, judging: Boolean(run.judge_endpoint_id && item.a && item.b) });
 });

 app.post('/api/staff/lab/agent-compare/runs/:id/tasks/:task/judge', requireStaff, async (req, res) => {
  requireTechnical(req); const runId = id(req.params.id), taskId = String(req.params.task);
  const run = (await pool.query('SELECT * FROM agent_compare_runs WHERE id=$1', [runId])).rows[0]; if (!run) throw new HttpError(404, '没有这次对比');
  if (!run.judge_endpoint_id) throw new HttpError(400, '这次对比没有选评审型号');
  const item = (await pool.query('SELECT * FROM agent_compare_items WHERE run_id=$1 AND task_id=$2', [runId, taskId])).rows[0];
  if (!item?.a?.output || !item?.b?.output) throw new HttpError(409, '两边都完成后才能评审');
  await judgeTask(run, item); res.json({ ok: true });
 });

 app.post('/api/staff/lab/agent-compare/items/:id/review', requireStaff, async (req, res) => {
  requireTechnical(req); const itemId = Number(req.params.id); if (!Number.isSafeInteger(itemId) || itemId < 1) throw new HttpError(400, '编号不正确');
  const choice = req.body?.choice; if (!['A', 'B', 'tie'].includes(choice)) throw new HttpError(400, '请选择 A、B 或差不多');
  const item = (await pool.query('SELECT id,blind_flip,judge,a,b FROM agent_compare_items WHERE id=$1', [itemId])).rows[0]; if (!item?.a || !item?.b) throw new HttpError(404, '这道任务还没两边都完成');
  // Not flipped: shown A is path a. Flipped: shown A is path b.
  const verdict = choice === 'tie' ? 'tie' : (choice === 'A') !== item.blind_flip ? 'a' : 'b';
  await pool.query('INSERT INTO agent_compare_reviews(item_id,reviewer,verdict) VALUES($1,$2,$3) ON CONFLICT(item_id,reviewer) DO UPDATE SET verdict=EXCLUDED.verdict,created_at=now()', [itemId, req.staff.subject, verdict]);
  res.json({ verdict, judge: pickWinner(item.judge) });
 });

 app.post('/api/staff/lab/agent-compare/runs/:id/close', requireStaff, async (req, res) => {
  requireTechnical(req); const runId = id(req.params.id);
  await transaction(pool, async db => { await db.query("UPDATE agent_compare_runs SET status='closed',armed_path=NULL,armed_task=NULL,closed_at=now() WHERE id=$1 AND status='open'", [runId]); await db.query('UPDATE eval_gateway_keys SET revoked_at=now() WHERE run_id=$1 AND revoked_at IS NULL', [runId]); await audit(db, req.actor, 'agent_compare.run_closed', null, runId); });
  res.json({ ok: true });
 });
}
