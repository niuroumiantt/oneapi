// 身份检测: is the model behind our API really the official model, at full strength?
// Four checks, each sent to the official API (baseline) and to our API (gateway → supplier, exactly what employees get):
//  分词指纹  the same texts must cost the same prompt tokens; a different tokenizer means a different model family,
//            a constant extra means the supplier adds hidden text to every request.
//  自报身份  who the model says it is, and the model name the response reports.
//  输出相似  temperature-0 replies compared with the official reply, against how alike two official replies are.
//  能力小测  20 short questions with one right answer; a lower score than the official model suggests a smaller or quantized model.
import { randomUUID } from 'node:crypto';
import { HttpError, audit, id } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { compareLinks, parseReply } from './feature-compare.mjs';

const CONCURRENCY = 4, BENCH_TIMEOUT_MS = 300000;
const reply = '\n\n（以上是一段测试文本，不用理解，请只回复：好）';
const TOKEN_TEXTS = [
 ['tok_zh', '中文', '网关把员工请求转发给上游供应商，按官方价格结算，失败的请求不扣费。今天下午三点开会，讨论第四季度的采购计划。'],
 ['tok_en', '英文', 'The quick brown fox jumps over the lazy dog while the gateway forwards every request upstream and settles at list price.'],
 ['tok_code', '代码', 'def fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n\nprint([fib(i) for i in range(10)])  # 0 1 1 2 3 5 8'],
 ['tok_num', '数字与符号', '3.14159 2718281828 0x7FFF_FFFF 1,234,567.89 2026-11-12T09:30:00+08:00 ¥1,980.00 ±0.5% ≥ ≤ → ⇒'],
 ['tok_rare', '生僻字与表情', '🙂🚀🧪 龘靐齉麤 鱻犇骉 Ωμ≈ç√∑ ñandú café naïve Zürich Ångström にほんご 한국어']
];
const SIMILAR = [
 ['sim_tcp', 'TCP 三次握手', '用三句话解释什么是 TCP 三次握手。'],
 ['sim_poem', '城市清晨短诗', '写一首四行的短诗，主题是城市的清晨。'],
 ['sim_sky', 'Why the sky is blue', 'Explain in two sentences why the sky is blue.']
];
// One right answer each, checked by rule. `num`: commas inside the answer are thousands separators and are dropped.
const BENCH = [
 ['q_mul', '多位数乘法', '计算 4837 × 2969。', /^14361053$/, '14361053', true],
 ['q_mod', '大数取余', '2 的 100 次方除以 7，余数是多少？', /^2$/, '2', true],
 ['q_letters', '数字母', '字符串 "strawberry raspberry" 中一共有几个小写字母 r？', /^6个?$/, '6', true],
 ['q_date', '日期推算', '从 2026 年 3 月 1 日往前数 45 天，是哪一天？请写成“几月几日”。', /^(2026年)?0?1月15日$|^(2026-)?0?1-15$/, '1月15日'],
 ['q_weekday', '星期推算', '2031 年 7 月 4 日是星期几？', /^(星期|周)五$|^friday$/, '星期五'],
 ['q_prime', '第 n 个质数', '第 50 个质数是多少？（2 是第 1 个质数）', /^229$/, '229', true],
 ['q_digits', '数位之和', '2 的 50 次方的各位数字之和是多少？', /^76$/, '76', true],
 ['q_base', '进制转换', '把十进制数 2026 写成七进制。', /^5623(\(7\)|_?7|₇)?$/, '5623'],
 ['q_frac', '分数运算', '计算 1/3 + 1/7 + 1/21，写成最简分数。', /^11\/21$/, '11/21'],
 ['q_jssort', '代码输出（JS）', 'JavaScript 里 [10, 1, 3, 25, 100].sort() 的结果是什么？用方括号和英文逗号写出数组。', /^\[1,10,100,25,3\]$/, '[1,10,100,25,3]'],
 ['q_pyset', '代码输出（Python）', 'Python 里 print(len(set("mississippi"))) 输出什么？', /^4$/, '4', true],
 ['q_clock', '钟表夹角', '3 点 40 分时，时针和分针之间较小的夹角是多少度？', /^130(度|°)?$/, '130', true],
 ['q_zeros', '阶乘末尾零', '100 的阶乘（100!）末尾有几个连续的 0？', /^24个?$/, '24', true],
 ['q_comb', '组合计数', '从 1 到 10 这 10 个整数中选 3 个，要求任意两个都不相邻（差至少为 2），有多少种选法？', /^56种?$/, '56', true],
 ['q_gcd', '最大公约数', '1071 和 462 的最大公约数是多少？', /^21$/, '21', true],
 ['q_dice', '概率', '同时掷两颗普通六面骰子，点数之和为 8 的概率是多少？写成最简分数。', /^5\/36$/, '5/36'],
 ['q_logic', '逻辑排序', 'A、B、C、D、E 五人从左到右排成一排。已知：B 紧挨在 D 的右边；D 不在最左边；A 不在两端；C 在 E 的左边；E 在 A 的左边；E 不在最右边。从左到右依次是谁？只写五个字母，例如 ABCDE。', /^ceadb$/, 'CEADB'],
 ['q_pool', '工程问题', '水池有甲、乙两个进水管和丙一个出水管。甲单独开 6 小时注满，乙单独开 9 小时注满，丙单独开 12 小时把满池放空。空池时三管同时打开，多少小时注满？写成最简分数。', /^36\/7(小时)?$|^5又1\/7(小时)?$|^5\.14\d*(小时)?$/, '36/7'],
 ['q_fib', '数列', '数列 1, 1, 2, 3, 5, 8, … 每一项等于前两项之和。第 30 项是多少？', /^832040$/, '832040', true],
 ['q_reverse', '字符串反转', '把字符串 semifly2026gateway 倒过来写（逐个字符反转）。', /^yawetag6202ylfimes$/, 'yawetag6202ylfimes']
];
const BENCH_SUFFIX = '\n\n可以先推理。最后单独一行只写“答案：”加最终结果，不要别的。';

export const PROBES = [
 ...TOKEN_TEXTS.map(([pid, name, text]) => ({ id: pid, section: 'fingerprint', kind: 'tok', name, prompt: text, body: () => ({ messages: [{ role: 'user', content: text + reply }], max_tokens: 1024 }) })),
 { id: 'self', section: 'fingerprint', kind: 'self', name: '自报身份', prompt: '请用一句话回答：你是什么模型？由哪家公司开发？', body: () => ({ messages: [{ role: 'user', content: '请用一句话回答：你是什么模型？由哪家公司开发？' }], max_tokens: 1024 }) },
 ...SIMILAR.map(([pid, name, text]) => ({ id: pid, section: 'fingerprint', kind: 'sim', name, prompt: text, twice: true, body: () => ({ messages: [{ role: 'user', content: text }], temperature: 0, max_tokens: 2048 }) })),
 ...BENCH.map(([pid, name, text, , answer]) => ({ id: pid, section: 'bench', kind: 'bench', name, prompt: text, answer, body: () => ({ messages: [{ role: 'user', content: text + BENCH_SUFFIX }], max_tokens: 8192 }) }))
];
const BY_ID = new Map(PROBES.map(p => [p.id, p])), BENCH_BY_ID = new Map(BENCH.map(b => [b[0], b]));
const callsOf = p => p.twice ? 3 : 2;
export const SECTIONS = { fingerprint: PROBES.filter(p => p.section === 'fingerprint').reduce((n, p) => n + callsOf(p), 0), bench: PROBES.filter(p => p.section === 'bench').reduce((n, p) => n + callsOf(p), 0) };

// ---- judging ----
const VENDORS = [['deepseek', /deepseek|深度求索/i], ['glm', /glm|智谱|zhipu|z\.ai|清华/i], ['openai', /gpt|openai/i], ['anthropic', /claude|anthropic/i], ['qwen', /qwen|通义|千问|阿里/i], ['gemini', /gemini|google|谷歌/i], ['llama', /llama|meta/i], ['moonshot', /kimi|moonshot|月之暗面/i], ['doubao', /豆包|doubao|字节|bytedance/i], ['ernie', /文心|ernie|百度/i]];
export const vendorOf = text => VENDORS.find(([, re]) => re.test(String(text || '')))?.[0] || null;
export function extractAnswer(content) {
 const text = String(content || '').replace(/\\boxed\{([^}]*)\}/g, '$1');
 const all = [...text.matchAll(/答案\s*[:：]\s*([^\n]+)/g)];
 const raw = all.length ? all.at(-1)[1] : text.trim().split('\n').filter(Boolean).at(-1) || '';
 return raw.replace(/[*`$]/g, '').trim().slice(0, 120);
}
const half = s => s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
export function checkAnswer(probeId, content) {
 const [, , , re, , num] = BENCH_BY_ID.get(probeId);
 const answer = extractAnswer(content);
 let n = half(answer).toLowerCase().replace(/\s+/g, '').replace(/^["'“”‘’「」]+|["'“”‘’「」。.,，;；!！]+$/g, '').replace(/^["'“”「]+/, '');
 if (num) n = n.replace(/(\d),(?=\d{3}\b)/g, '$1');
 return { answer, correct: re.test(n) };
}
// Character-bigram Dice similarity, 0..1. Whitespace and punctuation ignored.
export function similarity(a, b) {
 const grams = s => { const t = String(s || '').toLowerCase().replace(/[\s\p{P}]/gu, ''), m = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
 const x = grams(a), y = grams(b); let both = 0, nx = 0, ny = 0;
 for (const v of x.values()) nx += v; for (const v of y.values()) ny += v;
 for (const [g, v] of x) both += Math.min(v, y.get(g) || 0);
 return nx + ny ? Math.round(2 * both / (nx + ny) * 100) / 100 : 0;
}
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const ok = s => s && !s.error;

/** Everything the page shows for one model, from its items in one run. */
export function summarize(items, family) {
 const by = k => items.filter(i => BY_ID.get(i.probe)?.kind === k), reasons = [];
 // 分词指纹
 let tokenizer = null; const tok = by('tok');
 if (tok.length) {
  const rows = tok.map(i => { const o = i.official?.prompt_tokens ?? null, u = i.ours?.prompt_tokens ?? null; return { id: i.probe, name: BY_ID.get(i.probe).name, official: o, ours: u, diff: o != null && u != null ? u - o : null }; });
  const diffs = rows.map(r => r.diff);
  let status, offset = 0;
  if (diffs.some(d => d == null)) status = 'unknown';
  else { const spread = Math.max(...diffs) - Math.min(...diffs); offset = Math.round(avg(diffs)); status = spread <= 1 && Math.abs(offset) <= 1 ? 'match' : spread <= 1 ? 'offset' : 'differ'; }
  tokenizer = { status, offset, rows };
  if (status === 'differ') reasons.push(['bad', '同一段文字两边计的输入 Token 数不同，而且差值随文字变化：分词器不一样，很可能不是同一个模型']);
  if (status === 'offset') reasons.push(['warn', `每个请求我们这一路都${offset > 0 ? '多' : '少'} ${Math.abs(offset)} 个输入 Token：分词一致，但上游可能在每个请求里加了看不见的内容（会多计费）`]);
  if (status === 'unknown') reasons.push(['warn', '有一边没有返回输入 Token 数，分词指纹无法比较']);
 }
 // 自报身份
 let self = null; const s = by('self')[0];
 if (s) {
  const o = vendorOf(s.official?.content), u = vendorOf(s.ours?.content);
  const status = !ok(s.ours) ? 'unknown' : u === family ? 'same' : u ? 'other' : 'unclear';
  self = { status, official: { vendor: o, text: s.official?.content?.slice(0, 300) || s.official?.error || '', model: s.official?.model || null }, ours: { vendor: u, text: s.ours?.content?.slice(0, 300) || s.ours?.error || '', model: s.ours?.model || null } };
  if (status === 'other') reasons.push(['bad', `我们这一路的模型自称来自 ${u}，不是 ${family}`]);
 }
 // 输出相似
 let similar = null; const sims = by('sim').filter(i => ok(i.official) && ok(i.official2) && ok(i.ours));
 if (by('sim').length) {
  const rows = by('sim').map(i => ({ id: i.probe, name: BY_ID.get(i.probe).name, self: ok(i.official) && ok(i.official2) ? similarity(i.official.content, i.official2.content) : null, cross: ok(i.ours) && ok(i.official) ? Math.max(similarity(i.ours.content, i.official.content), ok(i.official2) ? similarity(i.ours.content, i.official2.content) : 0) : null, official: i.official?.content?.slice(0, 400) || i.official?.error || '', official2: i.official2?.content?.slice(0, 400) || i.official2?.error || '', ours: i.ours?.content?.slice(0, 400) || i.ours?.error || '' }));
  const selfAvg = avg(sims.map(i => similarity(i.official.content, i.official2.content))), crossAvg = avg(sims.map(i => Math.max(similarity(i.ours.content, i.official.content), similarity(i.ours.content, i.official2.content))));
  const status = !sims.length ? 'unknown' : selfAvg < 0.35 ? 'noisy' : crossAvg >= selfAvg - 0.2 ? 'close' : 'far';
  similar = { status, self: selfAvg == null ? null : Math.round(selfAvg * 100) / 100, cross: crossAvg == null ? null : Math.round(crossAvg * 100) / 100, rows };
  if (status === 'far') reasons.push(['warn', `回答风格和官方差得多：和官方的相似度 ${similar.cross}，官方两次之间是 ${similar.self}`]);
 }
 // 能力小测
 let bench = null; const qs = by('bench');
 if (qs.length) {
  const side = r => !r ? { state: 'missing' } : r.error ? { state: 'error', note: r.error } : r.finish === 'length' ? { state: 'cut', answer: r.answer, tokens: r.completion_tokens } : { state: r.correct ? 'right' : 'wrong', answer: r.answer, tokens: r.completion_tokens, latency_ms: r.latency_ms };
  const rows = qs.map(i => ({ id: i.probe, name: BY_ID.get(i.probe).name, expected: BY_ID.get(i.probe).answer, official: side(i.official), ours: side(i.ours) }));
  const done = x => x.state === 'right' || x.state === 'wrong', common = rows.filter(r => done(r.official) && done(r.ours));
  const o = common.filter(r => r.official.state === 'right').length, u = common.filter(r => r.ours.state === 'right').length, n = common.length, gap = o - u;
  const to = avg(common.map(r => r.official.tokens).filter(Number.isFinite)), tu = avg(common.map(r => r.ours.tokens).filter(Number.isFinite));
  const ratio = to && tu ? Math.round(tu / to * 100) / 100 : null;
  const status = n < 10 ? 'insufficient' : gap >= Math.max(3, Math.ceil(n * 0.15)) ? 'suspect' : gap >= 2 ? 'watch' : 'ok';
  bench = { status, n, official: o, ours: u, gap, tokens_official: to && Math.round(to), tokens_ours: tu && Math.round(tu), token_ratio: ratio, skipped: rows.length - n, rows };
  if (status === 'suspect') reasons.push(['bad', `能力小测我们答对 ${u}/${n}，官方 ${o}/${n}：明显偏低，可能是更小或量化的模型`]);
  if (status === 'watch') reasons.push(['warn', `能力小测我们比官方少对 ${gap} 题，再测一次确认`]);
  if (status === 'insufficient') reasons.push(['warn', `两边都答完的只有 ${n} 题，太少，不下结论`]);
  if (ratio && (ratio < 0.5 || ratio > 2)) reasons.push(['warn', `答同样的题，我们平均用 ${bench.tokens_ours} 个输出 Token，官方 ${bench.tokens_official}：思考长度差很多`]);
 }
 const verdict = reasons.some(r => r[0] === 'bad') ? 'suspect' : reasons.length ? 'watch' : tokenizer || bench ? 'ok' : 'pending';
 return { verdict, reasons, tokenizer, self, similar, bench };
}
const brief = s => ({ verdict: s.verdict, tokenizer: s.tokenizer?.status || null, offset: s.tokenizer?.offset || 0, self: s.self?.status || null, similar: s.similar?.status || null, bench: s.bench ? { n: s.bench.n, official: s.bench.official, ours: s.bench.ours, status: s.bench.status } : null });
// Beijing working hours on weekdays count as 高峰.
export function periodOf(at) { const d = new Date(new Date(at).getTime() + 8 * 3600e3), h = d.getUTCHours(), w = d.getUTCDay(); return w >= 1 && w <= 5 && h >= 9 && h < 18 ? 'peak' : 'off'; }

export function modelIdentityRoutes(app, pool, cfg, requireStaff, upstreamFetch = fetch) {
 const { box, pairs, send } = compareLinks(pool, cfg, upstreamFetch);
 let active = null;

 async function call(side, target, body, probe) {
  const r = await send(side, target, body, probe.kind === 'bench' ? BENCH_TIMEOUT_MS : undefined);
  if (r.error) return { error: r.error.note, http: r.error.http_status, latency_ms: r.error.latency_ms };
  const p = parseReply(r.http, r.raw, r.stream), latency_ms = Math.round(performance.now() - r.started);
  if (p.error) return { error: p.error, http: r.http, latency_ms };
  let meta = {}; try { const j = JSON.parse(r.raw); meta = { model: j.model || null, fingerprint: j.system_fingerprint || null }; } catch {}
  const out = { http: r.http, latency_ms, content: p.content.slice(0, 1500), reasoning_chars: p.reasoning.length, prompt_tokens: p.usage?.prompt_tokens ?? null, completion_tokens: p.usage?.completion_tokens ?? null, finish: p.finish, ...meta };
  if (probe.kind === 'bench') Object.assign(out, checkAnswer(probe.id, p.content));
  return out;
 }
 async function execute(run, work) {
  const queue = [...work];
  const worker = async () => {
   for (let t = queue.shift(); t; t = queue.shift()) {
    const p = BY_ID.get(t.probe), body = p.body();
    const [official, ours, official2] = await Promise.all([call('official', t.reference, body, p), call('ours', t.route, body, p), p.twice ? call('official', t.reference, body, p) : null]);
    await pool.query('INSERT INTO identity_check_items(run_id,our_model,reference_model,probe,official,official2,ours) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(run_id,our_model,probe) DO NOTHING', [run.id, t.route.model.id, t.reference.model_id, t.probe, official, official2, ours]).catch(() => {});
    run.done++;
   }
  };
  let status = 'completed';
  try { await Promise.all(Array.from({ length: CONCURRENCY }, worker)); } catch { status = 'failed'; }
  const summary = await summaries(run.id, work).catch(() => ({}));
  await pool.query('UPDATE identity_check_runs SET status=$2,done=$3,summary=$4,finished_at=now() WHERE id=$1', [run.id, status, run.done, Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, brief(v)]))]).catch(() => {});
 }
 async function summaries(runId, families) {
  const rows = (await pool.query('SELECT * FROM identity_check_items WHERE run_id=$1', [runId])).rows, out = {};
  const fam = new Map((families || []).map(w => [w.route?.model?.id ?? w.id, w.route?.model?.family ?? w.family]));
  for (const m of [...new Set(rows.map(r => r.our_model))]) { const mine = rows.filter(r => r.our_model === m); out[m] = { reference_model: mine[0].reference_model, ...summarize(mine, fam.get(m)) }; }
  return out;
 }

 app.get('/api/staff/lab/identity', requireStaff, async (req, res) => {
  requireTechnical(req);
  const list = await pairs(), runs = (await pool.query('SELECT id,status,models,sections,total,done,summary,created_by,created_at,finished_at FROM identity_check_runs ORDER BY created_at DESC LIMIT 30')).rows;
  const wanted = req.query.run ? id(req.query.run) : null, run = wanted ? runs.find(r => r.id === wanted) : active ? runs.find(r => r.id === active.id) || null : runs[0] || null;
  if (run && active?.id === run.id) run.done = active.done;
  const families = list.map(p => ({ id: p.model.id, family: p.model.family }));
  res.json({
   ready: Boolean(box), sections: SECTIONS,
   probes: PROBES.map(({ id: pid, section, kind, name, prompt, answer }) => ({ id: pid, section, kind, name, prompt, answer: answer || null })),
   models: list.map(p => ({ ...p.model, reference: p.reference ? { model_id: p.reference.model_id, vendor: p.reference.vendor } : null })),
   runs: runs.map(r => ({ ...r, period: periodOf(r.created_at) })),
   run: run ? { ...run, period: periodOf(run.created_at) } : null,
   detail: run ? await summaries(run.id, families) : {}
  });
 });

 app.post('/api/staff/lab/identity/runs', requireStaff, async (req, res) => {
  requireTechnical(req);
  if (!box) throw new HttpError(503, '验收加密服务未配置');
  if (active) throw new HttpError(409, '上一轮身份检测还在进行，请稍候');
  const sections = Array.isArray(req.body?.sections) && req.body.sections.length ? [...new Set(req.body.sections.map(String))] : ['fingerprint', 'bench'];
  if (sections.some(s => !SECTIONS[s])) throw new HttpError(400, '没有这一类检测');
  const wanted = Array.isArray(req.body?.models) ? req.body.models.map(String) : null;
  const list = (await pairs()).filter(p => p.reference && (!wanted || wanted.includes(p.model.id)));
  if (!list.length) throw new HttpError(400, '没有可检测的型号：先在“评测 Key”登记官方 Key，并确认型号已接通');
  const work = list.flatMap(p => PROBES.filter(x => sections.includes(x.section)).map(x => ({ route: p.route, reference: p.reference, probe: x.id })));
  const run = { id: randomUUID(), done: 0 }, models = list.map(p => p.model.id);
  await pool.query("INSERT INTO identity_check_runs(id,status,models,sections,total,done,created_by) VALUES($1,'running',$2,$3,$4,0,$5)", [run.id, models, sections, work.length, req.staff.subject]);
  await audit(pool, req.actor, 'identity_check.started', null, run.id, { models, sections, probes: work.length });
  active = run;
  void execute(run, work).finally(() => { active = null; });
  res.status(202).json({ run_id: run.id, probes: work.length, calls: list.length * sections.reduce((n, s) => n + SECTIONS[s], 0) });
 });
}
