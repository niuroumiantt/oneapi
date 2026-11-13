// [服务器 aliyun，在生产网关镜像里运行] 单路速度与最长输出实测。
// 用法见 docs/handoff/link-boundaries.md。只在生产容器环境里运行；读加密的采购 Key，结果写标准输出，不写库、不打印密钥。
// 两条线并行：KerAPI 一条、官方一条，各自按顺序一次只发一个请求，不增加并发压力。
// 每个请求是流式的，记录：首个 token、首个正文、推理与正文字数、usage、总耗时、结束原因、收到的字节数与数据块数、最长停顿。
// 结果逐行写到标准输出（JSON Lines），不写数据库，不打印密钥。
import pg from 'pg';
import { vault, config } from '/app/server/src/core.mjs';

const cfg = config(), pool = new pg.Pool({ connectionString: cfg.databaseURL, max: 2 });
const box = vault(process.env.SUPPLIER_LAB_SECRET);
const keyOf = async id => {
  const r = (await pool.query('SELECT base_url, credential_ciphertext FROM supplier_lab_credentials WHERE id=$1 AND disabled_at IS NULL', [id])).rows[0];
  return { base: r.base_url.replace(/\/$/, ''), key: box.open(r.credential_ciphertext).key };
};
const KERAPI = '6bf69d6a-9631-4d7f-849b-a0ce0c576adf', DEEPSEEK = 'dfa0f4ca-e91a-4b0c-b5a3-a28d0aa68a28', BIGMODEL = '7899a26d-4923-485e-b26e-02520bc332b9';
const PROMPT = '这是一次输出长度测试，请务必完整执行，不要省略、不要询问、不要提示篇幅过长。请写一部现代都市题材的中篇小说，共 40 章，每章约 1200 字，从第 1 章一直写到第 40 章，章节之间不要停顿，也不要写任何说明。';
const TIMEOUT_MS = 720000;

async function probe(lane, cred, model, maxTokens, extra = {}) {
  const { base, key } = await keyOf(cred);
  const r = { lane, model, max_tokens: maxTokens, started_at: new Date().toISOString(), http: null, error: null, ttft_any_ms: null, ttft_content_ms: null,
    reasoning_chars: 0, content_chars: 0, chunks: 0, bytes: 0, max_gap_ms: 0, finish: null, usage: null, total_ms: null, request_id: null };
  const t0 = performance.now(); let last = t0;
  try {
    const res = await fetch(`${base}/chat/completions`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }], max_tokens: maxTokens, stream: true, stream_options: { include_usage: true }, ...extra }) });
    r.http = res.status; r.request_id = res.headers.get('x-request-id') || res.headers.get('x-oneapi-request-id');
    if (!res.ok) { r.error = (await res.text()).replaceAll(key, '***').slice(0, 300); return r; }
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      const now = performance.now(); r.max_gap_ms = Math.max(r.max_gap_ms, Math.round(now - last)); last = now;
      r.bytes += value.byteLength; buf += dec.decode(value, { stream: true });
      let nl; while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue; const data = line.slice(5).trim(); if (data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        r.chunks++;
        const c = j.choices?.[0], d = c?.delta || {};
        if (d.reasoning_content) { r.reasoning_chars += d.reasoning_content.length; r.ttft_any_ms ??= Math.round(performance.now() - t0); }
        if (d.content) { r.content_chars += d.content.length; r.ttft_any_ms ??= Math.round(performance.now() - t0); r.ttft_content_ms ??= Math.round(performance.now() - t0); }
        if (c?.finish_reason) r.finish = c.finish_reason;
        if (j.usage) r.usage = j.usage;
      }
    }
  } catch (e) { r.error = e?.name === 'TimeoutError' ? `我们自己的 ${TIMEOUT_MS / 1000} 秒上限到了` : `${e?.name}: ${String(e?.cause?.code || e?.message).slice(0, 160)}`; }
  finally { r.total_ms = Math.round(performance.now() - t0); }
  return r;
}

const out = r => process.stdout.write(JSON.stringify(r) + '\n');
const glm = { reasoning_effort: 'low' };
const lanes = {
  kerapi: [['deepseek-v4.1-flash', 32768], ['GLM-5.3', 32768, glm], ['GLM-5.3-FlashX', 32768, glm], ['GLM-5.3-Flash', 32768, glm]].map(([m, n, x]) => () => probe('kerapi', KERAPI, m, n, x)),
  official: [[DEEPSEEK, 'deepseek-flash', 32768], [BIGMODEL, 'glm-5.3', 32768, glm], [BIGMODEL, 'glm-5.3-flashx', 32768, glm], [BIGMODEL, 'glm-5.3-flash', 32768, glm]].map(([c, m, n, x]) => () => probe('official', c, m, n, x)),
};
await Promise.all(Object.values(lanes).map(async jobs => { for (const job of jobs) out(await job()); }));
await pool.end();
process.stdout.write(JSON.stringify({ done: true, at: new Date().toISOString() }) + '\n');
