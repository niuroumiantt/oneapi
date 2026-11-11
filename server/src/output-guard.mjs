// Output guard for upstream models that ignore max_tokens (found by the key watch: a max_tokens=1 check that comes
// back with more than 1 output token). For such a model the gateway always asks the upstream for a stream, counts
// what arrives, and once the caller's max_tokens is reached it closes the upstream request and ends with
// finish_reason=length, exactly as an upstream that honours the limit would. Callers that asked for a non-streamed
// reply get the stream folded back into one JSON response. A reply cut this way carries the header
// x-semifly-guard-cut: 1; its usage is unknown, so billing waits for the supplier's own usage log.
export const IGNORES_MAX_TOKENS = 'ignores_max_tokens';
let cache = { at: 0, models: new Set() };
export async function guardedModels(pool) {
 if (Date.now() - cache.at < 60000) return cache.models;
 try { cache = { at: Date.now(), models: new Set((await pool.query("SELECT model_id FROM upstream_model_flags WHERE flag=$1 AND cleared_at IS NULL", [IGNORES_MAX_TOKENS])).rows.map(r => r.model_id)) }; }
 catch { cache = { at: Date.now(), models: new Set() }; }
 return cache.models;
}
export function forgetGuardCache() { cache.at = 0; }

// fetch() drop-in. maxTokens: the caller's limit. Pieces of text in the stream are counted as tokens (one streamed delta ≈ one token).
export async function guardedFetch(fetchImpl, url, init, maxTokens) {
 const body = JSON.parse(init.body), wantsStream = body.stream === true;
 const upstreamBody = { ...body, stream: true, stream_options: { ...(body.stream_options || {}), include_usage: true } };
 const stop = new AbortController(), signal = init.signal ? AbortSignal.any([init.signal, stop.signal]) : stop.signal;
 const response = await fetchImpl(url, { ...init, body: JSON.stringify(upstreamBody), signal });
 if (!response.ok || !response.body) return response;
 const headers = new Headers({ 'content-type': wantsStream ? 'text/event-stream; charset=utf-8' : 'application/json' });
 for (const h of ['x-request-id', 'x-oneapi-request-id']) if (response.headers.get(h)) headers.set(h, response.headers.get(h));
 const reader = response.body.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
 const state = { buffer: '', count: 0, cut: false, done: false, id: null, model: null, created: null, content: '', reasoning: '', finish: null, usage: null, tools: new Map() };
 const lastChunk = () => `data: ${JSON.stringify({ id: state.id, object: 'chat.completion.chunk', created: state.created, model: state.model, choices: [{ index: 0, delta: {}, finish_reason: 'length' }] })}\n\ndata: [DONE]\n\n`;
 // Reads one network chunk; returns the complete lines it carried (and a cut marker when the limit is reached).
 async function pump() {
  const { done, value } = await reader.read();
  if (done) { state.done = true; const rest = state.buffer; state.buffer = ''; return rest ? [rest] : []; }
  state.buffer += decoder.decode(value, { stream: true });
  const lines = state.buffer.split('\n'); state.buffer = lines.pop(); const out = [];
  for (const line of lines) {
   if (line.startsWith('data:') && !line.includes('[DONE]')) {
    try {
     const j = JSON.parse(line.slice(5)); state.id ??= j.id; state.model ??= j.model; state.created ??= j.created; if (j.usage) state.usage = j.usage;
     const c = j.choices?.[0], d = c?.delta || {};
     if (typeof d.content === 'string' && d.content) { state.content += d.content; state.count++; }
     if (typeof d.reasoning_content === 'string' && d.reasoning_content) { state.reasoning += d.reasoning_content; state.count++; }
     for (const t of d.tool_calls || []) { const k = t.index ?? state.tools.size, cur = state.tools.get(k) || { id: t.id, type: 'function', function: { name: '', arguments: '' } }; if (t.id) cur.id = t.id; if (t.function?.name) cur.function.name += t.function.name; if (t.function?.arguments) { cur.function.arguments += t.function.arguments; state.count++; } state.tools.set(k, cur); }
     if (c?.finish_reason) state.finish = c.finish_reason;
    } catch { /* pass through as is */ }
   }
   out.push(line);
   if (!state.cut && state.count >= maxTokens && !state.finish) { state.cut = true; break; }
  }
  return out;
 }
 const finishCut = () => { state.done = true; stop.abort(); reader.cancel().catch(() => {}); };
 if (state.cut) headers.set('x-semifly-guard-cut', '1');
 if (wantsStream) {
  const stream = new ReadableStream({
   async pull(controller) {
    try {
     if (state.done) { controller.close(); return; }
     const lines = await pump();
     if (lines.length) controller.enqueue(encoder.encode(lines.map(l => l + '\n').join('')));
     if (state.cut) { controller.enqueue(encoder.encode('\n' + lastChunk())); finishCut(); controller.close(); return; }
     if (state.done) controller.close();
    } catch (e) { controller.error(e); }
   },
   cancel() { finishCut(); }
  });
  return new Response(stream, { status: 200, headers });
 }
 while (!state.done && !state.cut) await pump();
 if (state.cut) { finishCut(); headers.set('x-semifly-guard-cut', '1'); }
 const message = { role: 'assistant', content: state.content };
 if (state.reasoning) message.reasoning_content = state.reasoning;
 if (state.tools.size) message.tool_calls = [...state.tools.values()];
 const result = { id: state.id, object: 'chat.completion', created: state.created, model: state.model, choices: [{ index: 0, message, finish_reason: state.cut ? 'length' : state.finish || 'stop' }] };
 if (state.usage && !state.cut) result.usage = state.usage;
 return new Response(JSON.stringify(result), { status: 200, headers });
}

// fetch the way the gateway does for a route: guarded when the upstream model is flagged.
export async function routeFetch(pool, fetchImpl, upstreamModel, url, init) {
 const body = JSON.parse(init.body);
 if (!(await guardedModels(pool)).has(upstreamModel)) return fetchImpl(url, init);
 return guardedFetch(fetchImpl, url, init, body.max_tokens ?? body.max_completion_tokens ?? 4096);
}
