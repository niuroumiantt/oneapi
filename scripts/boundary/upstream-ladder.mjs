// [服务器 aliyun，在生产网关镜像里运行] 上游并发阶梯：直接打 KerAPI 主用 Key，找出它在多少路同时请求时开始排队、变慢或返回 429。
// 用法见 docs/handoff/link-boundaries.md。只在生产容器环境里运行；读加密的采购 Key，结果写标准输出，不写库、不打印密钥。
// 先等员工流量安静（连续 5 分钟没有在途调用）再开始，最晚等到当天 23:30（北京时间）。
// 每档同时发 C 个流式请求，回答约 300 个 Token。某档失败率超过 20% 或累计花费超过 3 元就停止。结果写标准输出（JSON Lines），不写数据库。
import pg from 'pg';
import { vault, config } from '/app/server/src/core.mjs';

const cfg = config(), pool = new pg.Pool({ connectionString: cfg.databaseURL, max: 2 }), box = vault(process.env.SUPPLIER_LAB_SECRET);
const out = r => process.stdout.write(JSON.stringify(r) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const beijingHour = () => (new Date().getUTCHours() + 8) % 24 + new Date().getUTCMinutes() / 60;

let quiet = 0;
for (;;) {
  const n = (await pool.query("SELECT count(*)::int AS n FROM employee_calls WHERE status='pending' AND created_at>now()-interval '10 minutes'")).rows[0].n;
  quiet = n === 0 ? quiet + 1 : 0;
  if (quiet >= 5) break;
  if (beijingHour() >= 23.5) { out({ skipped: '员工流量一直没有安静下来', at: new Date().toISOString() }); await pool.end(); process.exit(0); }
  await sleep(60000);
}
out({ started: new Date().toISOString(), note: '员工流量已连续 5 分钟为 0' });

const cred = (await pool.query("SELECT base_url, credential_ciphertext FROM supplier_lab_credentials WHERE id='6bf69d6a-9631-4d7f-849b-a0ce0c576adf'")).rows[0];
const base = cred.base_url.replace(/\/$/, ''), key = box.open(cred.credential_ciphertext).key;
const PROMPT = '用大约 300 字介绍一下城市地铁系统的发展历史，分三段写。';
const RATES = { 'deepseek-v4.1-flash': { in: 2, out: 8 }, 'GLM-5.3': { in: 8, out: 28 } }; // 按高峰价估算，宁高勿低
const MODELS = [['deepseek-v4.1-flash', { thinking: { type: 'disabled' } }], ['GLM-5.3', { reasoning_effort: 'low' }]];
const STEPS = [1, 2, 4, 8, 16, 24, 32, 48];
let spent = 0;

async function one(model, extra) {
  const r = { http: null, ttft: null, total: null, out: null, error: null }, t0 = performance.now();
  try {
    const res = await fetch(`${base}/chat/completions`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }], max_tokens: 600, stream: true, stream_options: { include_usage: true }, ...extra }) });
    r.http = res.status;
    if (!res.ok) { r.error = (await res.text()).replaceAll(key, '***').slice(0, 200); return r; }
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl; while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
        let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
        const d = j.choices?.[0]?.delta || {};
        if ((d.content || d.reasoning_content) && r.ttft === null) r.ttft = Math.round(performance.now() - t0);
        if (j.usage) r.out = j.usage.completion_tokens;
      }
    }
  } catch (e) { r.error = e?.name === 'TimeoutError' ? '180 秒无结果' : String(e?.cause?.code || e?.message).slice(0, 120); }
  finally { r.total = Math.round(performance.now() - t0); }
  return r;
}

const pct = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
for (const [model, extra] of MODELS) {
  for (const c of STEPS) {
    const t0 = performance.now(), rows = await Promise.all(Array.from({ length: c }, () => one(model, extra)));
    const ok = rows.filter(r => r.http === 200 && r.out), rate = RATES[model];
    spent += rows.reduce((a, r) => a + ((r.out || 0) * rate.out + 60 * rate.in) / 1e6, 0);
    const tps = ok.map(r => r.out / Math.max(0.1, (r.total - r.ttft) / 1000));
    const summary = { model, concurrency: c, ok: ok.length, requests: c, http: rows.reduce((m, r) => (m[r.http ?? 'err'] = (m[r.http ?? 'err'] || 0) + 1, m), {}),
      ttft_p50: pct(ok.map(r => r.ttft), 0.5), ttft_p95: pct(ok.map(r => r.ttft), 0.95), tps_p50: Math.round(pct(tps, 0.5) || 0), tps_p10: Math.round(pct(tps, 0.1) || 0),
      aggregate_tps: Math.round(ok.reduce((a, r) => a + r.out, 0) / ((performance.now() - t0) / 1000)), wall_s: Math.round((performance.now() - t0) / 1000),
      errors: [...new Set(rows.filter(r => r.error).map(r => r.error))].slice(0, 3), spent_yuan: +spent.toFixed(3) };
    out(summary);
    if (ok.length / c < 0.8) { out({ stopped: `${model} 在 ${c} 路时失败率超过 20%` }); break; }
    if (spent > 3) { out({ stopped: '累计花费超过 3 元' }); break; }
    await sleep(5000);
  }
  if (spent > 3) break;
}
await pool.end();
out({ done: true, at: new Date().toISOString(), spent_yuan: +spent.toFixed(3) });
