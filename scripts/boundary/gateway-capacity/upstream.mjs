// Fake KerAPI: streams SSE at RATE tokens/s per request after TTFT ms, with chunks the size real DeepSeek chunks are (~300 bytes).
import { createServer } from 'node:http';
const RATE = Number(process.env.RATE || 120), TTFT = Number(process.env.TTFT || 500), TOKENS = Number(process.env.TOKENS || 2000), TICK = Number(process.env.TICK || 50);
const pad = 'x'.repeat(150);
const chunk = (id, text) => `data: {"id":"${id}","object":"chat.completion.chunk","created":1762900000,"model":"deepseek-v4.1-flash","system_fingerprint":"fp_${pad.slice(0, 20)}","choices":[{"index":0,"delta":{"content":"${text}","reasoning_content":null},"logprobs":null,"finish_reason":null}]}\n\n`;
let active = 0, served = 0;
createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const j = JSON.parse(body || '{}'), n = Math.min(TOKENS, j.max_tokens || TOKENS), id = 'mock-' + (++served);
    if (!j.stream) { setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': id }); res.end(JSON.stringify({ id, object: 'chat.completion', model: j.model, choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 1, total_tokens: 21 } })); }, Number(process.env.NONSTREAM_MS || 20)); return; }
    active++; res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': id });
    let sent = 0, t;
    const stop = () => { clearInterval(t); active--; };
    setTimeout(() => {
      t = setInterval(() => {
        const k = Math.min(Math.max(1, Math.round(RATE * TICK / 1000)), n - sent); let out = '';
        for (let i = 0; i < k; i++) out += chunk(id, '字');
        sent += k; res.write(out);
        if (sent >= n) { res.end(`data: {"id":"${id}","choices":[{"index":0,"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":20,"completion_tokens":${n},"total_tokens":${n + 20}}}\n\ndata: [DONE]\n\n`); stop(); }
      }, TICK);
    }, TTFT);
    res.on('close', () => { if (sent < n) stop(); });
  });
}).listen(Number(process.env.PORT || 47101), '127.0.0.1', () => console.log(JSON.stringify({ upstream: 'ready', RATE, TTFT, TOKENS })));
setInterval(() => console.log(JSON.stringify({ upstream_active: active, served })), 5000).unref();
