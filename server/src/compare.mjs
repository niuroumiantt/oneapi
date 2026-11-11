// Official-vs-supplier comparison. Both sides answer the same questions with the same parameters;
// answers are graded three ways: deterministic rules, a blind third-model judge (run twice with A/B swapped),
// and staff spot checks that see the two answers without knowing which side wrote which.
// The official key lives as a 'reference' endpoint: employee routing only uses 'supplier' endpoints on KerAPI, so it is never routed.
import { randomInt } from 'node:crypto';
import { HttpError, audit, hash, id, text, transaction, vault } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { validateLabBaseUrl, calculateProbeCostYuan } from './supplier-lab.mjs';

const filler = n => Array.from({ length: n }, (_, i) => `第${i + 1}条记录：本周仓库盘点正常，货架 ${(i * 37) % 97} 号无异常，温度 ${18 + (i % 5)} 度。`).join('\n');
const haystack = (() => { const rows = filler(160).split('\n'); rows.splice(97, 0, '特别说明：新启用的冷链仓库编号是 K-7342，仅限生鲜货物入库。'); return rows.join('\n'); })();
const lines = s => s.trim().split(/\n+/).map(x => x.trim()).filter(Boolean);
const digits = s => s.replace(/\D/g, '');
const parseJson = s => { try { return JSON.parse(s.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; } };

export const COMPARE_CASES = Object.freeze([
 { id: 'calc', category: '计算', name: '四则运算', prompt: '计算 (37 × 48 − 129) ÷ 3，只输出整数结果。', maxTokens: 64, rubric: '正确答案是 549；只输出整数。', rule: o => ({ ok: o.trim() === '549', note: '应严格等于 549' }) },
 { id: 'word_problem', category: '计算', name: '应用题', prompt: '小明有 3 个苹果，又买了 2 袋，每袋 5 个，吃掉 4 个，再送给朋友 3 个。他还剩几个苹果？只输出数字。', maxTokens: 64, rubric: '3+10−4−3=6，正确答案是 6。', rule: o => ({ ok: o.trim() === '6', note: '应严格等于 6' }) },
 { id: 'logic', category: '推理', name: '逻辑排序', prompt: '甲比乙高，丙比甲高，丁比乙矮，戊比丙矮但比甲高。五个人里谁最高？只输出名字。', maxTokens: 64, rubric: '丙最高。', rule: o => ({ ok: o.trim().replace(/[。.]$/, '') === '丙', note: '应只输出“丙”' }) },
 { id: 'extract', category: '结构化', name: '信息抽取 JSON', prompt: '从下面这句话里抽取联系人信息，输出 JSON 对象，字段 name、phone（只含数字）、city。不要 Markdown，不要解释。\n“联系人王小明，电话 138-0013-8000，常驻杭州，周末不接电话。”', maxTokens: 120, rubric: 'name=王小明，phone=13800138000，city=杭州；只输出 JSON。', rule: o => { const v = parseJson(o); return { ok: v?.name === '王小明' && digits(String(v?.phone ?? '')) === '13800138000' && String(v?.city ?? '').startsWith('杭州'), note: '应可解析为 JSON，字段值全部正确' }; } },
 { id: 'format', category: '指令遵循', name: '格式约束', prompt: '用恰好三条要点介绍 HTTP 缓存。每条单独一行，以“- ”开头，每条不超过 30 个字。不要标题，不要其他内容。', maxTokens: 200, rubric: '恰好三行，每行以“- ”开头、不超过 30 字；内容准确（如 Cache-Control、ETag/Last-Modified 协商、强缓存与协商缓存）。', rule: o => { const l = lines(o); return { ok: l.length === 3 && l.every(x => x.startsWith('- ') && [...x.slice(2)].length <= 30), note: '应恰好三行“- ”开头，每行不超过 30 字' }; } },
 { id: 'code', category: '代码', name: 'Python 函数', prompt: '写一个 Python 函数 is_palindrome(s: str) -> bool，判断字符串是否回文，忽略大小写和所有非字母数字字符。只输出代码。', maxTokens: 400, rubric: '函数名和签名正确；忽略大小写与非字母数字字符（如 "A man, a plan, a canal: Panama" 返回 True）；代码可直接运行。', rule: o => ({ ok: /def\s+is_palindrome\s*\(/.test(o) && /lower|casefold/.test(o) && /isalnum|re\.sub|\[\^a-z0-9\]|\\W/i.test(o), note: '应定义 is_palindrome，并做大小写和字符过滤' }) },
 { id: 'sql', category: '代码', name: 'SQL 查询', prompt: '表 orders(id, user_id, amount, created_at)。写一条 PostgreSQL 查询：列出 2026 年消费总额最高的 5 个 user_id 及其总额，按总额降序。只输出 SQL。', maxTokens: 300, rubric: '按 user_id 分组求 sum(amount)，过滤 2026 年（推荐用半开区间），降序取前 5。', rule: o => ({ ok: /group\s+by\s+user_id/i.test(o) && /sum\s*\(\s*amount\s*\)/i.test(o) && /limit\s+5/i.test(o) && /desc/i.test(o) && /2026/.test(o), note: '应有 GROUP BY user_id、SUM(amount)、2026 过滤、降序、LIMIT 5' }) },
 { id: 'needle', category: '长上下文', name: '长文检索', prompt: `下面是一份很长的仓库日志。\n\n${haystack}\n\n问题：新启用的冷链仓库编号是什么？只输出编号。`, maxTokens: 64, rubric: '正确答案是 K-7342。', rule: o => ({ ok: o.includes('K-7342'), note: '应找到编号 K-7342' }) },
 { id: 'translate', category: '语言', name: '英译中', prompt: '把下面这段话翻译成自然的简体中文，只输出译文：\n"Our gateway retries a request on a standby key when the primary key is rejected, so most outages go unnoticed by employees."', maxTokens: 200, rubric: '意思完整：主 Key 被拒时网关用备用 Key 重试，因此多数故障员工察觉不到；术语恰当，语句通顺。', rule: o => ({ ok: /备用/.test(o) && /(重试|重新)/.test(o) && /员工/.test(o), note: '应包含“备用”“重试”“员工”等关键意思' }) },
 { id: 'summary', category: '语言', name: '一句话摘要', prompt: '用一句话（不超过 50 个字）概括下面这段话：\n“本季度公司把 AI 网关从单一上游改为主备两条线路。上线后共发生 3 次上游故障，其中 2 次由备用线路自动接管，员工无感知；另 1 次因两条线路同时异常，中断 12 分钟。下季度计划接入第三家供应商并增加自动压测。”', maxTokens: 160, rubric: '一句话，≤50 字；要点：改为主备、3 次故障 2 次自动接管、1 次中断 12 分钟、计划接第三家。', rule: o => ({ ok: [...o.trim()].length <= 55 && lines(o).length === 1, note: '应为一句话，不超过 50 字' }) },
 { id: 'apology', category: '写作', name: '客户说明', prompt: '给企业客户写一段不超过 100 字的说明：今天 14:05 到 14:25 因上游故障服务中断 20 分钟，现已恢复，我们会给每个账户补偿 1 天额度。语气诚恳，不要套话。', maxTokens: 300, rubric: '准确包含时间、20 分钟、已恢复、补偿 1 天额度；≤100 字；语气诚恳、不空洞。', rule: o => ({ ok: [...o.trim()].length <= 110 && /20\s*分钟|14:05/.test(o) && /补偿/.test(o), note: '应不超过 100 字，包含中断时长和补偿' }) },
 { id: 'knowledge', category: '知识', name: '技术常识', prompt: '简要回答：TCP 三次握手依次发送哪三个报文？各用一句话说明作用。', maxTokens: 300, rubric: '依次为 SYN、SYN+ACK、ACK，并正确说明各自作用（发起连接/确认并回应/最终确认）。', rule: o => ({ ok: /SYN/.test(o) && /ACK/.test(o) && /SYN\s*[+＋,/、-]?\s*ACK|SYN-ACK/i.test(o), note: '应写出 SYN、SYN+ACK、ACK' }) },
]);
const CASE_BY_ID = new Map(COMPARE_CASES.map(c => [c.id, c]));
const CALL_TIMEOUT = 90000, JUDGE_TOKENS = 1024, OUTPUT_CHARS = 4000;

async function readBody(response, limit = 1 << 20) {
 const reader = response.body?.getReader(); if (!reader) return '';
 const chunks = []; let size = 0;
 try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) throw Error('RESPONSE_TOO_LARGE'); chunks.push(value); } }
 finally { reader.cancel().catch(() => {}); }
 return new TextDecoder().decode(Buffer.concat(chunks));
}

// One chat call to a lab endpoint. Never throws; failures come back as {ok:false,error}.
export async function chatOnce(fetchImpl, box, endpoint, messages, maxTokens, thinking = 'default') {
 const started = performance.now();
 const out = { ok: false, http_status: null, error: null, latency_ms: null, output: '', reasoning_chars: 0, input_tokens: null, cached_tokens: null, output_tokens: null, response_model: null, finish_reason: null, cost_yuan: null };
 try {
  validateLabBaseUrl(endpoint.base_url);
  const key = box.open(endpoint.active_ciphertext).key;
  const body = { model: endpoint.model_id, messages, temperature: 0, max_tokens: maxTokens, stream: false };
  if (thinking === 'off') body.thinking = { type: 'disabled' }; else if (thinking === 'on') body.thinking = { type: 'enabled' };
  const response = await fetchImpl(`${endpoint.base_url}/chat/completions`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT) });
  out.http_status = response.status;
  const raw = await readBody(response);
  let data = null; try { data = JSON.parse(raw); } catch {}
  if (!response.ok) { out.error = `HTTP ${response.status}：` + String(data?.error?.message || raw).replaceAll(key, '***').slice(0, 200); return out; }
  const message = data?.choices?.[0]?.message || {};
  out.output = typeof message.content === 'string' ? message.content.slice(0, OUTPUT_CHARS) : '';
  out.reasoning_chars = typeof message.reasoning_content === 'string' ? message.reasoning_content.length : 0;
  out.finish_reason = typeof data?.choices?.[0]?.finish_reason === 'string' ? data.choices[0].finish_reason.slice(0, 40) : null;
  out.response_model = typeof data?.model === 'string' ? data.model.slice(0, 120) : null;
  const u = data?.usage || {}, int = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
  out.input_tokens = int(u.prompt_tokens); out.output_tokens = int(u.completion_tokens); out.cached_tokens = int(u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens);
  out.cost_yuan = calculateProbeCostYuan(endpoint, out.input_tokens, out.cached_tokens, out.output_tokens);
  out.ok = Boolean(out.output);
  if (!out.ok) out.error = out.finish_reason === 'length' ? '输出被截断（思考占满了输出上限）' : '没有返回正文';
 } catch (e) {
  out.error = e?.name === 'TimeoutError' ? `超过 ${CALL_TIMEOUT / 1000} 秒无响应` : e instanceof HttpError ? e.message : e?.message === 'RESPONSE_TOO_LARGE' ? '响应过大' : '连接失败：' + String(e?.message || e).slice(0, 160);
 } finally { out.latency_ms = Math.round(performance.now() - started); }
 return out;
}

const JUDGE_SYSTEM = '你是严格、公正的评审。只根据题目要求和评分要点，评判两份回答的正确性、完整性和是否遵守格式要求。不因回答更长而加分，不因先后顺序偏向任何一方。只输出 JSON。';
function judgePrompt(c, a, b) {
 return `【题目】\n${c.id === 'needle' ? c.prompt.slice(0, 120) + '……（中间省略一份很长的仓库日志）……\n问题：新启用的冷链仓库编号是什么？只输出编号。' : c.prompt}\n\n【评分要点】\n${c.rubric}\n\n【回答 A】\n${a || '（没有回答）'}\n\n【回答 B】\n${b || '（没有回答）'}\n\n请输出 JSON：{"a":0到10的整数,"b":0到10的整数,"winner":"A"或"B"或"tie","reason":"不超过60字的中文理由"}`;
}
export function parseVerdict(output) {
 const match = String(output || '').match(/\{[\s\S]*\}/); const v = match && parseJson(match[0]);
 const score = x => Number.isFinite(Number(x)) ? Math.max(0, Math.min(10, Math.round(Number(x)))) : null;
 if (!v || score(v.a) === null || score(v.b) === null) return null;
 const winner = ['A', 'B', 'tie'].includes(String(v.winner)) ? String(v.winner) : score(v.a) > score(v.b) ? 'A' : score(v.a) < score(v.b) ? 'B' : 'tie';
 return { a: score(v.a), b: score(v.b), winner, reason: String(v.reason || '').slice(0, 200) };
}

// Ask the judge twice with the answers swapped; a winner counts only if both orders agree.
async function judgeItem(fetchImpl, box, judge, c, supplier, reference) {
 const ask = async (a, b) => { const r = await chatOnce(fetchImpl, box, judge, [{ role: 'system', content: JUDGE_SYSTEM }, { role: 'user', content: judgePrompt(c, a, b) }], JUDGE_TOKENS, 'off'); return { call: r, verdict: r.ok ? parseVerdict(r.output) : null }; };
 const [first, second] = await Promise.all([ask(supplier.output, reference.output), ask(reference.output, supplier.output)]);
 if (!first.verdict || !second.verdict) return { error: first.call.error || second.call.error || '评审没有给出可解析的 JSON', model: judge.model_id };
 const map = (w, supplierIs) => w === 'tie' ? 'tie' : w === supplierIs ? 'supplier' : 'reference';
 const w1 = map(first.verdict.winner, 'A'), w2 = map(second.verdict.winner, 'B');
 return { model: judge.model_id, supplier_score: (first.verdict.a + second.verdict.b) / 2, reference_score: (first.verdict.b + second.verdict.a) / 2, winner: w1 === w2 ? w1 : 'tie', positions_agree: w1 === w2, reasons: [first.verdict.reason, second.verdict.reason], cost_yuan: [first.call.cost_yuan, second.call.cost_yuan] };
}

const median = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const sumMoney = xs => xs.some(x => x == null) || !xs.length ? null : xs.reduce((n, x) => n + Number(x), 0);
export function summarize(caseIds, items, reviews) {
 const side = key => {
  const rows = items.map(i => i[key]);
  const ruled = items.filter(i => CASE_BY_ID.get(i.case_id)?.rule);
  return { answered: rows.filter(r => r.ok).length, rule_pass: ruled.filter(i => i[key].rule?.ok).length, rule_total: ruled.length,
   judge_avg: (() => { const s = items.map(i => i.judge?.[key + '_score']).filter(Number.isFinite); return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length * 10) / 10 : null; })(),
   latency_p50: median(rows.map(r => r.latency_ms)), output_tokens: rows.reduce((n, r) => n + (r.output_tokens || 0), 0), input_tokens: rows.reduce((n, r) => n + (r.input_tokens || 0), 0),
   cost_yuan: sumMoney(rows.map(r => r.cost_yuan)), models: [...new Set(rows.map(r => r.response_model).filter(Boolean))] };
 };
 const s = side('supplier'), r = side('reference'), judged = items.filter(i => i.judge?.winner);
 const judge = { judged: judged.length, supplier_wins: judged.filter(i => i.judge.winner === 'supplier').length, reference_wins: judged.filter(i => i.judge.winner === 'reference').length, ties: judged.filter(i => i.judge.winner === 'tie').length, position_flips: judged.filter(i => i.judge.positions_agree === false).length, errors: items.filter(i => i.judge?.error).length };
 const byItem = new Map(items.map(i => [i.id, i]));
 const human = { reviews: reviews.length, items: new Set(reviews.map(x => x.item_id)).size, supplier: reviews.filter(x => x.verdict === 'supplier').length, reference: reviews.filter(x => x.verdict === 'reference').length, tie: reviews.filter(x => x.verdict === 'tie').length };
 const comparable = reviews.filter(x => byItem.get(x.item_id)?.judge?.winner);
 human.agree_with_judge = comparable.length ? comparable.filter(x => byItem.get(x.item_id).judge.winner === x.verdict).length : null; human.comparable = comparable.length;
 const notes = [];
 if (items.length < caseIds.length) notes.push(`还有 ${caseIds.length - items.length} 题没跑完`);
 if (s.answered < items.length) notes.push(`供应商有 ${items.length - s.answered} 题没有答出`);
 if (r.answered < items.length) notes.push(`官方有 ${items.length - r.answered} 题没有答出，这些题的对比不可靠`);
 if (s.output_tokens && r.output_tokens) { const ratio = s.output_tokens / r.output_tokens; if (ratio < 0.6 || ratio > 1.6) notes.push(`输出长度是官方的 ${ratio.toFixed(1)} 倍，差异偏大，留意是否换了型号或截断`); }
 if (judge.position_flips > Math.max(1, judged.length / 3)) notes.push(`评审换位后结论不一致 ${judge.position_flips} 次，评审模型不太稳定，多看人工抽查`);
 const gap = s.judge_avg != null && r.judge_avg != null ? Math.round((s.judge_avg - r.judge_avg) * 10) / 10 : null, ruleGap = r.rule_pass - s.rule_pass;
 let verdict = 'pending';
 if (items.length) verdict = s.answered < items.length ? 'worse' : (gap == null ? ruleGap <= 0 : gap >= -0.5 && ruleGap <= 0) ? 'match' : (gap == null ? ruleGap <= 1 : gap >= -1.5 && ruleGap <= 1) ? 'slightly' : 'worse';
 return { supplier: s, reference: r, judge, human, gap, rule_gap: ruleGap, verdict, notes };
}

export function compareRoutes(app, pool, cfg, requireStaff, fetchImpl = fetch) {
 const secret = process.env.SUPPLIER_LAB_SECRET, box = secret?.length >= 32 ? vault(secret) : null;
 let active = null;
 const endpointSql = `SELECT e.id,e.kind,e.label,e.model_id,e.base_url,e.input_yuan_per_m,e.cached_input_yuan_per_m,e.output_yuan_per_m,c.credential_ciphertext AS active_ciphertext,c.label AS credential_label,s.name AS supplier_name
  FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id JOIN supplier_lab_suppliers s ON s.id=e.supplier_id
  WHERE e.disabled_at IS NULL AND c.disabled_at IS NULL AND s.disabled_at IS NULL AND NOT EXISTS(SELECT 1 FROM suppliers p WHERE p.id=s.canonical_supplier_id AND p.status='blocked')`;
 const publicEndpoint = ({ active_ciphertext, ...e }) => ({ ...e, host: (() => { try { return new URL(e.base_url).hostname; } catch { return ''; } })() });

 async function loadItems(runId) { return (await pool.query('SELECT id,case_id,supplier,reference,judge,blind_flip,created_at FROM compare_items WHERE run_id=$1 ORDER BY id', [runId])).rows; }
 async function loadReviews(runIds) { return (await pool.query('SELECT r.item_id,r.reviewer,r.verdict,r.created_at,i.run_id FROM compare_reviews r JOIN compare_items i ON i.id=r.item_id WHERE i.run_id=ANY($1::uuid[])', [runIds])).rows; }

 async function execute(run, endpoints, cases) {
  const queue = [...cases];
  const worker = async () => {
   for (let c = queue.shift(); c; c = queue.shift()) {
    const messages = [{ role: 'user', content: c.prompt }];
    const [supplier, reference] = await Promise.all([chatOnce(fetchImpl, box, endpoints.supplier, messages, c.maxTokens, run.thinking), chatOnce(fetchImpl, box, endpoints.reference, messages, c.maxTokens, run.thinking)]);
    for (const side of [supplier, reference]) if (c.rule && side.ok) side.rule = c.rule(side.output); else if (c.rule) side.rule = { ok: false, note: '没有回答' };
    const verdict = endpoints.judge && (supplier.ok || reference.ok) ? await judgeItem(fetchImpl, box, endpoints.judge, c, supplier, reference).catch(e => ({ error: String(e?.message || e).slice(0, 160) })) : null;
    await pool.query('INSERT INTO compare_items(run_id,case_id,supplier,reference,judge,blind_flip) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [run.id, c.id, supplier, reference, verdict, randomInt(2) === 1]);
   }
  };
  try { await Promise.all([worker(), worker()]); await pool.query("UPDATE compare_runs SET status='completed',finished_at=now() WHERE id=$1", [run.id]); }
  catch { await pool.query("UPDATE compare_runs SET status='failed',finished_at=now() WHERE id=$1", [run.id]).catch(() => {}); }
 }

 app.get('/api/staff/lab/compare', requireStaff, async (req, res) => {
  requireTechnical(req);
  await pool.query("UPDATE compare_runs SET status='failed',finished_at=now() WHERE status='running' AND created_at<now()-interval '20 minutes'");
  const [endpoints, runs] = await Promise.all([pool.query(endpointSql + ' ORDER BY e.kind DESC,s.name,e.model_id'), pool.query(`SELECT r.*,se.model_id AS supplier_model,ss.name AS supplier_name,re.model_id AS reference_model,rs.name AS reference_name,je.model_id AS judge_model
   FROM compare_runs r JOIN supplier_lab_endpoints se ON se.id=r.supplier_endpoint_id JOIN supplier_lab_suppliers ss ON ss.id=se.supplier_id JOIN supplier_lab_endpoints re ON re.id=r.reference_endpoint_id JOIN supplier_lab_suppliers rs ON rs.id=re.supplier_id LEFT JOIN supplier_lab_endpoints je ON je.id=r.judge_endpoint_id
   ORDER BY r.created_at DESC LIMIT 20`)]);
  const ids = runs.rows.map(r => r.id);
  const [items, reviews] = await Promise.all([ids.length ? pool.query('SELECT id,run_id,case_id,supplier,reference,judge FROM compare_items WHERE run_id=ANY($1::uuid[])', [ids]) : { rows: [] }, ids.length ? loadReviews(ids) : []]);
  res.json({
   ready: Boolean(box),
   cases: COMPARE_CASES.map(c => ({ id: c.id, name: c.name, category: c.category, prompt: c.id === 'needle' ? `（约 ${[...c.prompt].length} 字的仓库日志，里面藏着一个编号）问：新启用的冷链仓库编号是什么？` : c.prompt, rubric: c.rubric, max_tokens: c.maxTokens, rule: Boolean(c.rule) })),
   endpoints: endpoints.rows.map(publicEndpoint),
   runs: runs.rows.map(r => ({ ...r, done: items.rows.filter(i => i.run_id === r.id).length, summary: summarize(r.case_ids, items.rows.filter(i => i.run_id === r.id), reviews.filter(x => x.run_id === r.id)) }))
  });
 });

 app.get('/api/staff/lab/compare/runs/:id', requireStaff, async (req, res) => {
  requireTechnical(req); const runId = id(req.params.id);
  const run = (await pool.query('SELECT * FROM compare_runs WHERE id=$1', [runId])).rows[0];
  if (!run) throw new HttpError(404, '没有这次评测');
  const [items, reviews] = await Promise.all([loadItems(runId), loadReviews([runId])]);
  const me = req.staff.subject;
  res.json({ run, summary: summarize(run.case_ids, items, reviews), items: items.map(i => ({ ...i, reviews: reviews.filter(r => r.item_id === i.id).map(r => ({ verdict: r.verdict, mine: r.reviewer === me, created_at: r.created_at })) })) });
 });

 app.post('/api/staff/lab/compare/runs', requireStaff, async (req, res) => {
  requireTechnical(req);
  if (!box) throw new HttpError(503, '验收加密服务未配置');
  if (active) throw new HttpError(409, '上一轮评测还在进行，请稍候');
  active = 'starting';
  try { await startRun(req, res); } catch (e) { if (active === 'starting') active = null; throw e; }
 });
 async function startRun(req, res) {
  const b = req.body || {}, supplierId = id(b.supplier_endpoint_id), referenceId = id(b.reference_endpoint_id), judgeId = b.judge_endpoint_id ? id(b.judge_endpoint_id) : null;
  const thinking = ['off', 'on', 'default'].includes(b.thinking) ? b.thinking : 'off';
  const caseIds = Array.isArray(b.case_ids) && b.case_ids.length ? [...new Set(b.case_ids.map(String))] : COMPARE_CASES.map(c => c.id);
  if (caseIds.some(x => !CASE_BY_ID.has(x))) throw new HttpError(400, '题目不存在');
  if (new Set([supplierId, referenceId, judgeId].filter(Boolean)).size !== [supplierId, referenceId, judgeId].filter(Boolean).length) throw new HttpError(400, '供应商、官方和评审必须是三个不同的端点');
  const rows = (await pool.query(endpointSql + ' AND e.id=ANY($1::uuid[])', [[supplierId, referenceId, judgeId].filter(Boolean)])).rows;
  const endpoints = { supplier: rows.find(e => e.id === supplierId), reference: rows.find(e => e.id === referenceId), judge: judgeId ? rows.find(e => e.id === judgeId) : null };
  if (!endpoints.supplier || !endpoints.reference || (judgeId && !endpoints.judge)) throw new HttpError(400, '型号不存在或 Key 已停用');
  if (endpoints.reference.kind !== 'reference') throw new HttpError(400, '对照方必须是官方评测 Key 下的型号');
  if (endpoints.judge && [endpoints.supplier.model_id, endpoints.reference.model_id].includes(endpoints.judge.model_id)) throw new HttpError(400, '评审模型不能和被比较的型号相同');
  const run = (await pool.query('INSERT INTO compare_runs(supplier_endpoint_id,reference_endpoint_id,judge_endpoint_id,case_ids,thinking,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [supplierId, referenceId, judgeId, caseIds, thinking, req.staff.subject])).rows[0];
  await audit(pool, req.actor, 'compare.run_started', null, run.id, { supplier_endpoint_id: supplierId, reference_endpoint_id: referenceId, judge_endpoint_id: judgeId, cases: caseIds.length, thinking });
  active = run.id;
  void execute(run, endpoints, caseIds.map(x => CASE_BY_ID.get(x))).finally(() => { active = null; });
  res.status(202).json({ run_id: run.id, upstream_calls: caseIds.length * (judgeId ? 4 : 2) });
 }

 app.post('/api/staff/lab/compare/items/:id/review', requireStaff, async (req, res) => {
  requireTechnical(req);
  const itemId = Number(req.params.id); if (!Number.isSafeInteger(itemId) || itemId < 1) throw new HttpError(400, '题目编号不正确');
  const choice = req.body?.choice; if (!['A', 'B', 'tie'].includes(choice)) throw new HttpError(400, '请选择 A、B 或差不多');
  const item = (await pool.query('SELECT id,blind_flip,judge FROM compare_items WHERE id=$1', [itemId])).rows[0];
  if (!item) throw new HttpError(404, '没有这道题');
  // Not flipped: A is the supplier. Flipped: A is the official answer.
  const verdict = choice === 'tie' ? 'tie' : (choice === 'A') !== item.blind_flip ? 'supplier' : 'reference';
  await pool.query('INSERT INTO compare_reviews(item_id,reviewer,verdict) VALUES($1,$2,$3) ON CONFLICT(item_id,reviewer) DO UPDATE SET verdict=EXCLUDED.verdict,created_at=now()', [itemId, req.staff.subject, verdict]);
  res.json({ verdict, judge: item.judge?.winner || null });
 });

 // Store an official key for evaluation only: an official supplier record, a reference credential, and its discovered models.
 app.post('/api/staff/lab/compare/reference', requireStaff, async (req, res) => {
  requireTechnical(req);
  if (!box) throw new HttpError(503, '验收加密服务未配置');
  const b = req.body || {}, vendor = text(b.vendor_name || 'DeepSeek 官方', '官方名称', 60), baseUrl = validateLabBaseUrl(b.base_url || 'https://api.deepseek.com'), key = text(b.api_key, 'API Key', 1000);
  if (/\s/.test(key)) throw new HttpError(400, 'API Key 不可包含空白字符');
  const wanted = Array.isArray(b.model_ids) ? b.model_ids.map(x => text(x, '型号 ID', 120)).slice(0, 20) : [];
  let models = wanted, discoveryError = null;
  try {
   const response = await fetchImpl(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
   const raw = await readBody(response, 262144);
   if (response.status === 401 || response.status === 403) throw new HttpError(400, `官方拒绝了这把 Key（HTTP ${response.status}），请检查后重试`);
   if (!response.ok) discoveryError = `列出型号失败：HTTP ${response.status}`;
   else { const list = (JSON.parse(raw).data || []).map(m => m?.id).filter(x => typeof x === 'string' && x.length <= 120).slice(0, 20); models = [...new Set([...list, ...wanted])]; }
  } catch (e) { if (e instanceof HttpError) throw e; discoveryError = '列出型号失败：' + String(e?.message || e).slice(0, 120); }
  if (!models.length) throw new HttpError(400, (discoveryError || '官方没有返回型号') + '。请手动填写型号 ID');
  const result = await transaction(pool, async db => {
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['compare-reference:' + vendor]);
   let supplier = (await db.query("SELECT id,display_name,legal_name FROM suppliers WHERE source_type='official' AND display_name=$1 AND status<>'blocked' ORDER BY created_at LIMIT 1", [vendor])).rows[0];
   if (!supplier) supplier = (await db.query(`INSERT INTO suppliers(legal_name,display_name,source_type,service_type,region,contact_email,reference_url,notes,next_action,created_by,owner_subject) VALUES($1,$1,'official','model_api','中国大陆','','',$2,'',$3,$3) RETURNING id,display_name,legal_name`, [vendor, '评测专用：只作对比评测的官方参照，不给员工路由。', req.staff.subject])).rows[0];
   await db.query(`INSERT INTO supplier_lab_suppliers(id,name,legal_name,kind,created_by,canonical_supplier_id) VALUES($1,$2,$3,'reference',$4,$1) ON CONFLICT(canonical_supplier_id) DO NOTHING`, [supplier.id, supplier.display_name, supplier.legal_name, req.staff.subject]);
   const lab = (await db.query('SELECT id FROM supplier_lab_suppliers WHERE canonical_supplier_id=$1', [supplier.id])).rows[0];
   const fingerprint = hash(key).slice(0, 12);
   if ((await db.query('SELECT 1 FROM supplier_lab_credentials WHERE credential_fingerprint=$1', [fingerprint])).rowCount) throw new HttpError(409, '这把 Key 已经登记过');
   const label = '评测专用 ' + new Date().toISOString().slice(0, 10) + ' · ' + fingerprint.slice(0, 4);
   const credential = (await db.query('INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,label', [lab.id, label, baseUrl, box.seal({ key }), fingerprint, req.staff.subject])).rows[0];
   for (const model of models) await db.query(`INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_ciphertext,credential_fingerprint,created_by,supplier_id,credential_id) VALUES($1,'reference',$2,$7,NULL,$3,$4,$5,$6)`, [model.slice(0, 100), baseUrl, fingerprint, req.staff.subject, lab.id, credential.id, model]);
   await audit(db, req.actor, 'compare.reference_key_created', null, credential.id, { supplier_id: supplier.id, host: new URL(baseUrl).hostname, models: models.length, purpose: 'evaluation_only' });
   return { credential_id: credential.id, label: credential.label, supplier_id: supplier.id };
  });
  res.status(201).json({ ...result, models, discovery_error: discoveryError });
 });
}
