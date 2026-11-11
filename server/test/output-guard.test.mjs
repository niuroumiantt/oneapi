import test from 'node:test';
import assert from 'node:assert/strict';
import { guardedFetch } from '../src/output-guard.mjs';

// An upstream that ignores max_tokens: streams `pieces` deltas (some reasoning, then content), then usage and [DONE].
function upstream(pieces, seen = {}) {
 return async (url, init) => {
  seen.body = JSON.parse(init.body); seen.aborted = false; init.signal?.addEventListener('abort', () => { seen.aborted = true; });
  const enc = new TextEncoder(); let i = 0;
  const body = new ReadableStream({ pull(c) {
   if (seen.aborted) { c.close(); return; }
   if (i < pieces) { const d = i < 3 ? { reasoning_content: 'r' } : { content: 'w' }; c.enqueue(enc.encode(`data: ${JSON.stringify({ id: 'x1', model: 'GLM-5.3-FlashX', created: 1, choices: [{ index: 0, delta: d }] })}\n\n`)); i++; return; }
   c.enqueue(enc.encode(`data: ${JSON.stringify({ id: 'x1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: ${JSON.stringify({ id: 'x1', choices: [], usage: { prompt_tokens: 9, completion_tokens: pieces } })}\n\ndata: [DONE]\n\n`)); c.close();
  } });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-9' } });
 };
}
const init = body => ({ method: 'POST', headers: {}, body: JSON.stringify(body) });

test('non-streamed caller: upstream that ignores max_tokens is cut at the limit and marked length', async () => {
 const seen = {}, r = await guardedFetch(upstream(500, seen), 'u', init({ model: 'm', messages: [], max_tokens: 16 }), 16);
 assert.equal(seen.body.stream, true, 'upstream is always asked for a stream');
 const j = await r.json();
 assert.equal(j.choices[0].finish_reason, 'length'); assert.equal(j.choices[0].message.reasoning_content.length + j.choices[0].message.content.length, 16);
 assert.equal(j.usage, undefined, 'no made-up usage'); assert.equal(r.headers.get('x-semifly-guard-cut'), '1'); assert.equal(r.headers.get('x-request-id'), 'req-9'); assert.equal(seen.aborted, true, 'upstream request closed');
});

test('non-streamed caller: a reply within the limit passes through with its usage', async () => {
 const r = await guardedFetch(upstream(5), 'u', init({ model: 'm', messages: [], max_tokens: 16 }), 16), j = await r.json();
 assert.equal(j.choices[0].finish_reason, 'stop'); assert.equal(j.usage.completion_tokens, 5); assert.equal(r.headers.get('x-semifly-guard-cut'), null);
});

test('streamed caller: the stream ends after max_tokens pieces with finish_reason length and [DONE]', async () => {
 const seen = {}, r = await guardedFetch(upstream(500, seen), 'u', init({ model: 'm', messages: [], max_tokens: 10, stream: true }), 10);
 const text = await r.text(), events = text.split('\n').filter(l => l.startsWith('data:'));
 const deltas = events.filter(l => /reasoning_content|"content"/.test(l)).length;
 assert.equal(deltas, 10); assert.match(events.at(-2), /"finish_reason":"length"/); assert.equal(events.at(-1), 'data: [DONE]'); assert.equal(seen.aborted, true);
});
