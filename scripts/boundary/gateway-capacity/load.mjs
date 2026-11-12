// Fires C simultaneous streaming calls (or a burst of short non-stream calls) at our gateway and reports client-side timings.
import { readFileSync } from 'node:fs';
const { keys } = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url)));
const GW = `http://127.0.0.1:${process.env.PORT || 47100}/v1/chat/completions`;
const pct = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
async function one(i, stream, maxTokens) {
  const key = keys[i % keys.length], t0 = performance.now(), r = { ok: false, status: null, ttft: null, total: null, bytes: 0 };
  try {
    const res = await fetch(GW, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-flash', stream, max_tokens: maxTokens, messages: [{ role: 'user', content: '压测' }] }) });
    r.status = res.status;
    if (!stream) { await res.text(); r.ok = res.ok; return r; }
    const reader = res.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; r.ttft ??= performance.now() - t0; r.bytes += value.byteLength; }
    r.ok = res.ok;
  } catch (e) { r.error = String(e?.cause?.code || e?.message); } finally { r.total = performance.now() - t0; }
  return r;
}
const mode = process.argv[2], n = Number(process.argv[3]), conc = Number(process.argv[4] || n), maxTokens = Number(process.argv[5] || 2000);
const t0 = performance.now(), results = []; let next = 0;
await Promise.all(Array.from({ length: conc }, async () => { while (next < n) { const i = next++; results.push(await one(i, mode === 'stream', maxTokens)); } }));
const wall = (performance.now() - t0) / 1000, ok = results.filter(r => r.ok);
const statuses = results.reduce((m, r) => (m[r.status ?? r.error] = (m[r.status ?? r.error] || 0) + 1, m), {});
console.log(JSON.stringify({ mode, requests: n, concurrency: conc, wall_s: +wall.toFixed(1), ok: ok.length, statuses, rps: +(n / wall).toFixed(1),
  ttft_p50_ms: Math.round(pct(ok.map(r => r.ttft), 0.5)), ttft_p95_ms: Math.round(pct(ok.map(r => r.ttft), 0.95)),
  total_p50_s: +(pct(ok.map(r => r.total), 0.5) / 1000).toFixed(2), total_p95_s: +(pct(ok.map(r => r.total), 0.95) / 1000).toFixed(2), total_max_s: +(Math.max(...ok.map(r => r.total)) / 1000).toFixed(2),
  bytes_per_stream: ok.length ? Math.round(ok.reduce((a, r) => a + r.bytes, 0) / ok.length) : 0 }));
