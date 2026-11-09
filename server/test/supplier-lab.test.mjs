import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProbeCostYuan, csvCell, runSupplierProbe, supplierLabRoutes, validateLabBaseUrl } from '../src/supplier-lab.mjs';
import { vault } from '../src/core.mjs';

test('procurement cost splits cached and uncached input at exact token precision', () => {
  const rates = { input_yuan_per_m: '2.000000', cached_input_yuan_per_m: '0.500000', output_yuan_per_m: '8.000000' };
  assert.equal(calculateProbeCostYuan(rates, 1_000_000, 250_000, 100_000), '2.425000000000');
  assert.equal(calculateProbeCostYuan(rates, 1, 0, 1), '0.000010000000');
  assert.equal(calculateProbeCostYuan(rates, 5, null, 2), null);
  assert.equal(calculateProbeCostYuan(rates, 5, 6, 2), null);
});

test('supplier key can only be sent to explicitly allowed HTTPS hosts', () => {
  const previous = process.env.SUPPLIER_LAB_ALLOWED_HOSTS;
  process.env.SUPPLIER_LAB_ALLOWED_HOSTS = 'api.deepseek.com,supplier.example.test';
  try {
    assert.equal(validateLabBaseUrl('https://supplier.example.test/v1/'), 'https://supplier.example.test/v1');
    for (const url of ['http://supplier.example.test', 'https://supplier.example.test.evil.test', 'https://supplier.example.test:8443', 'https://user:pass@supplier.example.test', 'https://supplier.example.test/v1?key=secret']) {
      assert.throws(() => validateLabBaseUrl(url));
    }
  } finally {
    if (previous === undefined) delete process.env.SUPPLIER_LAB_ALLOWED_HOSTS;
    else process.env.SUPPLIER_LAB_ALLOWED_HOSTS = previous;
  }
});

test('a live protocol probe records one upstream attempt with usage, cost and evidence', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer local-test-key');
    assert.equal(JSON.parse(options.body).model, 'deepseek-chat');
    assert.deepEqual(JSON.parse(options.body).thinking, { type: 'disabled' });
    return new Response(JSON.stringify({ model: 'deepseek-chat', choices: [{ message: { content: '391' } }], usage: { prompt_tokens: 20, prompt_cache_hit_tokens: 5, completion_tokens: 2, total_tokens: 22 } }), { status: 200, headers: { 'x-request-id': 'req-test-1' } });
  };
  try {
    const box = vault('local-test-secret-that-is-over-32-characters');
    const endpoint = { id: 'endpoint-1', base_url: 'https://api.deepseek.com', model_id: 'deepseek-chat', credential_ciphertext: null, active_ciphertext: box.seal({ key: 'local-test-key' }), input_yuan_per_m: '2.000000', cached_input_yuan_per_m: '0.500000', output_yuan_per_m: '8.000000' };
    await runSupplierProbe(endpoint, { id: 'arithmetic', prompt: '17 x 23', maxTokens: 32, grade: output => output === '391' }, box, 'run-1', { query: async (sql, params) => calls.push({ sql, params }) });
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /INSERT INTO supplier_lab_transactions/);
    assert.equal(calls[0].params[6], 200);
    assert.equal(calls[0].params[8], 'req-test-1');
    assert.deepEqual(calls[0].params.slice(10, 14), [20, 5, 2, 22]);
    assert.equal(calls[0].params[15], 100);
    const checks = JSON.parse(calls[0].params[16]);
    assert.equal(checks.usage_present_and_consistent, true);
    assert.equal(checks.model_matches_request, true);
    assert.equal(checks.usage_evidence.prompt_cache_hit_tokens, 5);
    assert.equal(checks.cost_status, 'estimated');
  } finally {
    global.fetch = originalFetch;
  }
});

test('missing model, mismatched model or inconsistent cache counts cannot be accepted or priced', async () => {
  const originalFetch = global.fetch;
  const box = vault('local-test-secret-that-is-over-32-characters');
  const endpoint = { id: 'endpoint-1', base_url: 'https://api.deepseek.com', model_id: 'deepseek-chat', active_ciphertext: box.seal({ key: 'local-test-key' }), input_yuan_per_m: '2', cached_input_yuan_per_m: '0.5', output_yuan_per_m: '8' };
  const candidate = { id: 'arithmetic', prompt: '17 x 23', maxTokens: 32, grade: output => output === '391' };
  try {
    for (const [responseModel, cacheHit, cacheMiss, expectedCode] of [
      [undefined, 5, 15, 'MODEL_UNREPORTED'],
      ['different-model', 5, 15, 'MODEL_MISMATCH'],
      ['deepseek-chat', 5, 14, 'USAGE_INVALID'],
    ]) {
      global.fetch = async () => new Response(JSON.stringify({ model: responseModel, choices: [{ message: { content: '391' } }], usage: { prompt_tokens: 20, prompt_cache_hit_tokens: cacheHit, prompt_cache_miss_tokens: cacheMiss, completion_tokens: 2, total_tokens: 22 } }), { status: 200 });
      let params;
      await runSupplierProbe(endpoint, candidate, box, 'run-1', { query: async (_sql, values) => { params = values; } });
      assert.equal(params[7], expectedCode);
      assert.equal(params[14], null);
      assert.equal(JSON.parse(params[16]).cost_status, 'unavailable');
    }
  } finally {
    global.fetch = originalFetch;
  }
});


test('CSV export keeps spreadsheet formulas inert', () => {
  assert.equal(csvCell('=IMPORTXML("https://example.test")'), `"'=IMPORTXML(""https://example.test"")"`);
  assert.equal(csvCell('  +1'), `"'  +1"`);
  assert.equal(csvCell('ordinary, text'), '"ordinary, text"');
});

test('manual bill comparison rejects empty and overlapping probe periods', async () => {
  const previous = process.env.SUPPLIER_LAB_SECRET;
  process.env.SUPPLIER_LAB_SECRET = 'local-test-secret-that-is-over-32-characters';
  const routes = new Map();
  const app = { get() {}, post(path, _auth, handler) { routes.set(path, handler); } };
  const endpointId = '11111111-1111-4111-8111-111111111111';
  let calls = 0, overlap = false, inserts = 0;
  const db = { release() {}, async query(sql) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
    if (sql.startsWith('SELECT id FROM supplier_lab_endpoints')) return { rows: [{ id: endpointId }] };
    if (sql.startsWith('SELECT coalesce(sum(estimated_cost_yuan)')) return { rows: [{ cost: '0.005', calls, unpriced: 0 }] };
    if (sql.startsWith('SELECT 1 FROM supplier_lab_reconciliations')) return { rowCount: overlap ? 1 : 0 };
    if (sql.startsWith('INSERT INTO supplier_lab_reconciliations')) { inserts++; return { rows: [{ id: endpointId, difference_yuan: '0.001' }] }; }
    if (sql.startsWith('INSERT INTO audit_events')) return {};
    throw Error(`Unexpected SQL: ${sql}`);
  } };
  try {
    supplierLabRoutes(app, { connect: async () => db }, () => {});
    const handler = routes.get('/api/staff/lab/reconciliations');
    const req = { body: { endpoint_id: endpointId, period_start: '2026-11-01T00:00:00Z', period_end: '2026-11-01T01:00:00Z', supplier_billed_yuan: '0.006', note: 'statement-123' }, staff: { status: 'active', role: 'supply', subject: 'staff-1' }, actor: { kind: 'staff', id: 'staff-1' } };
    const res = { status(code) { assert.equal(code, 201); return this; }, json(value) { assert.equal(value.probe_calls, 1); } };
    await assert.rejects(handler({ ...req, body: { ...req.body, note: '' } }, res), /账单编号/);
    await assert.rejects(handler(req, res), /没有本台测试交易/);
    calls = 1; overlap = true;
    await assert.rejects(handler(req, res), /重叠/);
    assert.equal(inserts, 0);
    overlap = false;
    await handler(req, res);
    assert.equal(inserts, 1);
  } finally {
    if (previous === undefined) delete process.env.SUPPLIER_LAB_SECRET;
    else process.env.SUPPLIER_LAB_SECRET = previous;
  }
});
