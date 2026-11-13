// One long call that needs more than 300 seconds (GLM-5.3 speed, 32768 tokens). Reports what the client actually receives at the end.
import { readFileSync } from 'node:fs';
const { keys } = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url)));
const stream = process.argv[2] === 'stream', t0 = performance.now();
const res = await fetch('http://127.0.0.1:47100/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + keys[stream ? 30 : 31], 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'glm-5.3', stream, max_tokens: 32768, messages: [{ role: 'user', content: '长输出' }] }) });
let text = '';
try { text = await res.text(); } catch (e) { text += `\n[客户端读取出错：${e?.cause?.code || e?.message}]`; }
const tokens = (text.match(/"content":"字"/g) || []).length;
console.log(JSON.stringify({ mode: stream ? 'stream' : 'non-stream', http: res.status, seconds: Math.round((performance.now() - t0) / 1000), tokens_received: tokens,
  has_finish_reason: /"finish_reason":"(length|stop)"/.test(text), has_done: text.includes('[DONE]'), has_usage: text.includes('"usage"'), tail: text.slice(-220) }));
