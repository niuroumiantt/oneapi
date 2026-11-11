// Agent 检测: record exactly what an agent (WorkBuddy 5.9.3, Cursor …) sends for each feature, then replay those
// recorded request forms against any of our keys and models, and against the official API, without the agent.
// Recording rides on normal gateway traffic: a staff member opens a session on an employee key, arms one feature
// at a time, triggers it in the agent, and every request that arrives on that key is tagged with the armed feature.
// Only request structure is kept (the acceptance profile), never the conversation.
import { randomUUID } from 'node:crypto';
import { HttpError, audit, id, text, transaction, vault } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { FEATURES, replayBody, featuresOf, judge } from './acceptance.mjs';
import { employeeRequest, employeeRoutes, upstreamSecret, setCaptureHook } from './employee-credit.mjs';
import { validateLabBaseUrl } from './supplier-lab.mjs';

export const KNOWN_AGENTS = [
 { name: 'WorkBuddy' }, { name: 'Cursor' }, { name: 'Trae' }, { name: 'Qoder' }, { name: 'Cherry Studio', repo: 'CherryHQ/cherry-studio' },
 { name: 'Cline', repo: 'cline/cline' }, { name: 'Roo Code', repo: 'RooCodeInc/Roo-Code' }, { name: 'Kilo Code', repo: 'Kilo-Org/kilocode' },
 { name: 'Continue', repo: 'continuedev/continue' }, { name: 'OpenCode', repo: 'sst/opencode' }
];
// How to trigger each feature inside an agent while recording.
export const FEATURE_HINTS = {
 basic: '随便问一句，不开任何选项。', stream: '多数 Agent 默认流式；有开关就打开。', tools: '让它读一个文件或列目录，使它发出工具调用。', tool_choice: '少数 Agent 会指定工具；没有这个选项就跳过。',
 image: '粘贴一张图片再提问。', json: '有 JSON / 结构化输出选项就打开，再问一句。',
 effort_low: '把思考强度调到“低”再问。', effort_medium: '把思考强度调到“中”再问。', effort_high: '把思考强度调到“高”再问。', effort_max: '把思考强度调到最高一档再问。',
 thinking_on: '打开思考开关再问。', thinking_off: '关闭思考开关再问。', out_8k: '把最大输出设为 8K 再问。', out_32k: '把最大输出设为 32K 再问。',
 ctx_32k: '打开一个 3 万字以上的文件让它总结。', ctx_128k: '打开一个 12 万字以上的文件让它总结。'
};
const FEATURE_IDS = new Set(FEATURES.map(([f]) => f));
const CONCURRENCY = 3, TIMEOUT_MS = 120000;
const versionIn = (name, detail) => { const m = String(detail || '').match(new RegExp(name.replace(/\s+/g, '[\\s-]?') + '[/ v]?(\\d+(?:\\.\\d+){1,3})', 'i')) || String(detail || '').match(/\/v?(\d+\.\d+(?:\.\d+){0,2})/); return m ? m[1] : null; };

export function agentRoutes(app, pool, cfg, requireStaff, upstreamFetch = fetch) {
 const secret = process.env.SUPPLIER_LAB_SECRET, box = secret?.length >= 32 ? vault(secret) : null;
 let sessions = null, run = null;

 async function reloadSessions() {
  const rows = (await pool.query("SELECT id,agent_id,key_id,armed_feature FROM agent_sessions WHERE status='open'")).rows;
  sessions = new Map(rows.map(r => [r.key_id, r]));
 }
 // Called by the gateway for every employee call (and every gateway rejection) with the key that made it.
 setCaptureHook(async (keyId, signature, origin, rejection) => {
  try {
   if (!sessions) await reloadSessions();
   const s = sessions.get(keyId); if (!s?.armed_feature || !signature) return;
   // The acceptance profile row is written asynchronously by the same request; wait a moment so the join below sees it.
   await new Promise(r => setTimeout(r, 300));
   await pool.query(`INSERT INTO agent_recordings(agent_id,session_id,feature,signature,client,client_detail,rejected,last_error) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(agent_id,feature,signature) DO UPDATE SET count=agent_recordings.count+1,captured_at=now(),client_detail=EXCLUDED.client_detail,rejected=agent_recordings.rejected OR EXCLUDED.rejected,last_error=coalesce(EXCLUDED.last_error,agent_recordings.last_error)`,
    [s.agent_id, s.id, s.armed_feature, signature, origin.client, origin.detail, Boolean(rejection), rejection ? String(rejection).slice(0, 300) : null]);
  } catch { /* recording must never affect the employee's call */ }
 });

 async function targets() {
  const routes = await employeeRoutes(pool, cfg);
  const ids = [...new Set(routes.flatMap(r => [r.credentialId, ...(r.fallbacks || []).map(f => f.credentialId)].filter(Boolean)))];
  const labels = ids.length ? new Map((await pool.query('SELECT id,label,priority FROM supplier_lab_credentials WHERE id=ANY($1::uuid[])', [ids])).rows.map(r => [r.id, r])) : new Map();
  const models = routes.map(r => ({ id: r.model.id, name: r.model.name, family: r.model.family, upstream_model: r.model.upstreamModel,
   keys: [r, ...(r.fallbacks || [])].filter(k => k.credentialId).map((k, i) => ({ credential_id: k.credentialId, label: labels.get(k.credentialId)?.label || '—', role: i === 0 ? 'primary' : labels.get(k.credentialId)?.priority === 2 ? 'standby' : 'auto' })) }));
  const official = (await pool.query(`SELECT e.id,e.model_id,e.base_url,c.credential_ciphertext,p.display_name AS vendor FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id JOIN supplier_lab_suppliers s ON s.id=e.supplier_id JOIN suppliers p ON p.id=s.canonical_supplier_id
   WHERE e.kind='reference' AND e.disabled_at IS NULL AND c.disabled_at IS NULL AND s.disabled_at IS NULL ORDER BY p.display_name,e.model_id`)).rows;
  return { routes, models, official };
 }
 const targetKey = t => t.kind === 'official' ? 'official:' + t.endpoint_id : 'ours:' + t.model_id + ':' + (t.credential_id || 'primary');

 async function replayOne(profile, target, agentId) {
  const started = performance.now(); let status = 'fail', note = '', httpStatus = null, excerpt = '', modelId = target.model_id;
  try {
   let response, stream, raw;
   if (target.kind === 'official') {
    const body = replayBody(profile, target.ref.model_id); stream = body.stream === true; if (stream) body.stream_options = { include_usage: true }; modelId = target.ref.model_id;
    validateLabBaseUrl(target.ref.base_url); const key = box.open(target.ref.credential_ciphertext).key;
    response = await upstreamFetch(`${target.ref.base_url}/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    raw = (await response.text()).replaceAll(key, '***');
   } else {
    const shaped = employeeRequest(replayBody(profile, target.route.model.id)); stream = shaped.stream;
    const key = await upstreamSecret(target.route, cfg);
    response = await upstreamFetch(`${target.route.baseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(shaped.payload), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    raw = await response.text();
   }
   httpStatus = response.status;
   const v = judge(profile.features, response.status, raw, stream); status = v.status; note = v.note;
   excerpt = [v.reasoning ? '【思考】' + v.reasoning.slice(0, 160) : '', v.content ? v.content.slice(0, 240) : '', v.toolCalls ? `【工具调用 ${v.toolCalls} 个】` : ''].filter(Boolean).join('\n') || raw.slice(0, 240);
  } catch (e) {
   note = e instanceof HttpError ? `网关拒绝（${e.status}）：${e.message}` : e.name === 'TimeoutError' ? `超过 ${TIMEOUT_MS / 1000} 秒无响应` : '连接失败：' + String(e.message || e).slice(0, 200);
   if (e instanceof HttpError) httpStatus = e.status;
  }
  await pool.query('INSERT INTO agent_replays(agent_id,feature,signature,target,target_label,model_id,status,http_status,latency_ms,note,excerpt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
   [agentId, profile.feature, profile.signature, targetKey(target), target.label, modelId, status, httpStatus, Math.round(performance.now() - started), note, excerpt]);
 }

 app.get('/api/staff/lab/agents', requireStaff, async (req, res) => {
  requireTechnical(req);
  const agentId = req.query.agent ? id(String(req.query.agent)) : null;
  const [agents, t] = await Promise.all([pool.query(`SELECT a.*,
    (SELECT count(DISTINCT r.feature)::int FROM agent_recordings r WHERE r.agent_id=a.id) AS recorded_features,
    (SELECT r.client_detail FROM agent_recordings r WHERE r.agent_id=a.id ORDER BY r.captured_at DESC LIMIT 1) AS last_detail,
    (SELECT max(r.captured_at) FROM agent_recordings r WHERE r.agent_id=a.id) AS last_recorded_at,
    (SELECT max(x.created_at) FROM agent_replays x WHERE x.agent_id=a.id) AS last_replayed_at
   FROM agents a ORDER BY a.name,a.created_at DESC`), targets()]);
  const list = agents.rows.map(a => ({ ...a, detected_version: versionIn(a.name, a.last_detail), repo: KNOWN_AGENTS.find(k => k.name === a.name)?.repo || null }));
  const out = { features: FEATURES.map(([fid, name]) => ({ id: fid, name, hint: FEATURE_HINTS[fid] })), known: KNOWN_AGENTS.map(k => k.name), agents: list,
   targets: { models: t.models, official: t.official.map(({ credential_ciphertext, base_url, ...o }) => o) }, run: run && { ...run } };
  if (agentId) {
   const [session, recordings, replays] = await Promise.all([
    pool.query("SELECT s.*,k.label AS key_label,k.key_hint,u.email AS owner_email FROM agent_sessions s JOIN employee_api_keys k ON k.id=s.key_id LEFT JOIN \"user\" u ON u.id=k.owner_id WHERE s.agent_id=$1 AND s.status='open' ORDER BY s.created_at DESC LIMIT 1", [agentId]),
    pool.query(`SELECT r.id,r.feature,r.signature,r.count,r.captured_at,r.client,r.client_detail,r.rejected,r.last_error,p.features AS seen_features,p.shape->'tool_count' AS tool_count,p.shape->'params' AS params,p.shape->'total_chars' AS total_chars
     FROM agent_recordings r LEFT JOIN acceptance_profiles p ON p.signature=r.signature WHERE r.agent_id=$1 ORDER BY r.feature,r.captured_at DESC`, [agentId]),
    pool.query('SELECT DISTINCT ON (feature,signature,target) feature,signature,target,target_label,model_id,status,http_status,latency_ms,note,excerpt,created_at FROM agent_replays WHERE agent_id=$1 ORDER BY feature,signature,target,created_at DESC', [agentId])
   ]);
   out.session = session.rows[0] || null;
   out.recordings = recordings.rows.map(r => ({ ...r, missing_feature: r.seen_features && !r.seen_features.includes(r.feature) && !['basic'].includes(r.feature) }));
   out.replays = replays.rows;
  }
  res.json(out);
 });

 app.post('/api/staff/lab/agents', requireStaff, async (req, res) => {
  requireTechnical(req);
  const name = text(req.body?.name, 'Agent 名称', 60), version = text(req.body?.version || '未知', '版本', 40), notes = req.body?.notes ? text(req.body.notes, '备注', 300) : '';
  const row = (await pool.query('INSERT INTO agents(name,version,notes,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(name,version) DO UPDATE SET notes=CASE WHEN EXCLUDED.notes<>\'\' THEN EXCLUDED.notes ELSE agents.notes END RETURNING *', [name, version, notes, req.staff.subject])).rows[0];
  await audit(pool, req.actor, 'agent.registered', null, row.id, { name, version });
  res.status(201).json(row);
 });

 // Latest release of an open-source agent, from GitHub. Best effort; closed-source agents have no source of truth.
 app.post('/api/staff/lab/agents/:id/latest-version', requireStaff, async (req, res) => {
  requireTechnical(req); const agentId = id(req.params.id);
  const a = (await pool.query('SELECT name FROM agents WHERE id=$1', [agentId])).rows[0]; if (!a) throw new HttpError(404, '没有这个 Agent');
  const repo = KNOWN_AGENTS.find(k => k.name === a.name)?.repo; if (!repo) throw new HttpError(400, `${a.name} 不是开源项目，最新版本需要手动填写`);
  try {
   const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'semifly-agent-check' }, signal: AbortSignal.timeout(15000) });
   if (!r.ok) throw new HttpError(502, `GitHub 返回 HTTP ${r.status}`);
   const j = await r.json(); res.json({ repo, latest: String(j.tag_name || j.name || '').replace(/^v/i, ''), published_at: j.published_at || null, url: j.html_url || null });
  } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, '查询 GitHub 失败：' + String(e.message || e).slice(0, 120)); }
 });

 app.get('/api/staff/lab/agents/keys', requireStaff, async (req, res) => {
  requireTechnical(req); const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 3) throw new HttpError(400, '请输入员工邮箱或 Key 前缀（至少 3 个字符）');
  const rows = (await pool.query(`SELECT k.id,k.label,k.key_hint,k.created_at,u.email FROM employee_api_keys k LEFT JOIN "user" u ON u.id=k.owner_id WHERE k.revoked_at IS NULL AND (lower(u.email) LIKE $1 OR lower(k.key_hint) LIKE $1 OR lower(k.label) LIKE $1) ORDER BY k.created_at DESC LIMIT 20`, ['%' + q + '%'])).rows;
  res.json({ keys: rows });
 });

 app.post('/api/staff/lab/agents/:id/sessions', requireStaff, async (req, res) => {
  requireTechnical(req); const agentId = id(req.params.id), keyId = id(req.body?.key_id);
  const row = await transaction(pool, async db => {
   if (!(await db.query('SELECT 1 FROM agents WHERE id=$1', [agentId])).rowCount) throw new HttpError(404, '没有这个 Agent');
   if (!(await db.query('SELECT 1 FROM employee_api_keys WHERE id=$1 AND revoked_at IS NULL', [keyId])).rowCount) throw new HttpError(404, '员工 Key 不存在或已停用');
   await db.query("UPDATE agent_sessions SET status='closed',closed_at=now() WHERE status='open' AND (agent_id=$1 OR key_id=$2)", [agentId, keyId]);
   const s = (await db.query('INSERT INTO agent_sessions(agent_id,key_id,created_by) VALUES($1,$2,$3) RETURNING *', [agentId, keyId, req.staff.subject])).rows[0];
   await audit(db, req.actor, 'agent.session_opened', null, s.id, { agent_id: agentId, key_id: keyId }); return s;
  });
  await reloadSessions(); res.status(201).json(row);
 });
 app.post('/api/staff/lab/agents/sessions/:id/arm', requireStaff, async (req, res) => {
  requireTechnical(req); const sessionId = id(req.params.id), feature = req.body?.feature ?? null;
  if (feature !== null && !FEATURE_IDS.has(feature)) throw new HttpError(400, '没有这个功能项');
  const r = await pool.query("UPDATE agent_sessions SET armed_feature=$2 WHERE id=$1 AND status='open' RETURNING id", [sessionId, feature]);
  if (!r.rowCount) throw new HttpError(404, '录制会话已关闭');
  await reloadSessions(); res.json({ ok: true, armed: feature });
 });
 app.post('/api/staff/lab/agents/sessions/:id/close', requireStaff, async (req, res) => {
  requireTechnical(req); const sessionId = id(req.params.id);
  await pool.query("UPDATE agent_sessions SET status='closed',armed_feature=NULL,closed_at=now() WHERE id=$1 AND status='open'", [sessionId]);
  await reloadSessions(); res.json({ ok: true });
 });
 app.delete('/api/staff/lab/agents/recordings/:id', requireStaff, async (req, res) => {
  requireTechnical(req); const recId = Number(req.params.id); if (!Number.isSafeInteger(recId)) throw new HttpError(400, '编号不正确');
  await pool.query('DELETE FROM agent_recordings WHERE id=$1', [recId]); res.json({ ok: true });
 });

 app.post('/api/staff/lab/agents/:id/replay', requireStaff, async (req, res) => {
  requireTechnical(req); const agentId = id(req.params.id);
  if (!box) throw new HttpError(503, '验收加密服务未配置');
  if (run && !run.finished_at) throw new HttpError(409, '上一轮回放还在进行，请稍候');
  const wanted = Array.isArray(req.body?.targets) ? req.body.targets : [];
  if (!wanted.length || wanted.length > 12) throw new HttpError(400, '请选择 1 至 12 个回放目标');
  const t = await targets(), list = [];
  for (const w of wanted) {
   if (w?.kind === 'official') { const ref = t.official.find(o => o.id === String(w.endpoint_id)); if (!ref) throw new HttpError(400, '官方型号不存在或 Key 已停用'); list.push({ kind: 'official', endpoint_id: ref.id, ref, model_id: ref.model_id, label: `官方 ${ref.model_id}` }); }
   else {
    const route = t.routes.find(r => r.model.id === String(w?.model_id)); if (!route) throw new HttpError(400, `模型 ${w?.model_id} 没有接通`);
    const credentialId = w.credential_id ? String(w.credential_id) : null;
    const pick = !credentialId || credentialId === route.credentialId ? route : (route.fallbacks || []).find(f => f.credentialId === credentialId);
    if (!pick) throw new HttpError(400, '这把 Key 不能调用这个模型');
    const keyLabel = t.models.find(m => m.id === route.model.id)?.keys.find(k => k.credential_id === pick.credentialId)?.label || '';
    list.push({ kind: 'ours', model_id: route.model.id, credential_id: pick.credentialId, route: { ...route, credentialId: pick.credentialId, ciphertext: pick.ciphertext, baseUrl: pick.baseUrl }, label: `${route.model.name} · ${keyLabel}` });
   }
  }
  const features = Array.isArray(req.body?.features) && req.body.features.length ? req.body.features.map(String) : null;
  const profiles = (await pool.query(`SELECT r.feature,r.signature,p.features,p.shape,p.synthetic FROM agent_recordings r JOIN acceptance_profiles p ON p.signature=r.signature WHERE r.agent_id=$1 AND ($2::text[] IS NULL OR r.feature=ANY($2)) ORDER BY r.feature,r.captured_at DESC`, [agentId, features])).rows;
  if (!profiles.length) throw new HttpError(400, '这个 Agent 还没有录到请求，先开一个录制会话');
  const work = profiles.flatMap(p => list.map(target => ({ profile: p, target })));
  run = { id: randomUUID(), agent_id: agentId, total: work.length, done: 0, started_at: new Date().toISOString(), finished_at: null, by: req.staff.subject };
  await audit(pool, req.actor, 'agent.replay_started', null, run.id, { agent_id: agentId, targets: list.map(x => targetKey(x)), probes: work.length });
  const current = run, queue = [...work];
  const worker = async () => { for (let w = queue.shift(); w; w = queue.shift()) { await replayOne(w.profile, w.target, agentId).catch(() => {}); current.done++; } };
  Promise.all(Array.from({ length: CONCURRENCY }, worker)).finally(() => { current.finished_at = new Date().toISOString(); });
  res.status(202).json({ run: current, targets: list.map(x => ({ key: targetKey(x), label: x.label })) });
 });
}
