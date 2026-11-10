import {usageRoutes} from './usage-reconciliation.mjs';
import { requireTechnical } from './workspaces.mjs';
import { HttpError, audit, hash, id, text, transaction, vault } from './core.mjs';

const CASES = Object.freeze([
  { id: 'arithmetic', name: '事实与计算', prompt: '请只输出 17 乘以 23 的整数结果。', expected: '严格等于 391', maxTokens: 32, grade: output => output.trim() === '391' },
  { id: 'json', name: '结构化 JSON', prompt: '只输出一个 JSON 对象，字段 result 为整数 42，字段 ok 为布尔值 true。不要 Markdown。', expected: '可解析 JSON，result=42 且 ok=true', maxTokens: 64, grade: output => { try { const value = JSON.parse(output); return value?.result === 42 && value?.ok === true; } catch { return false; } } },
  { id: 'chinese', name: '中文表达', prompt: '把 Hello, world! 翻译为简体中文。只输出译文。', expected: '包含“你好”和“世界”', maxTokens: 48, grade: output => output.includes('你好') && output.includes('世界') },
  { id: 'context', name: '上下文理解', prompt: '资料：甲城的代号是蓝星；乙城的代号是红星。问题：乙城的代号是什么？只输出代号。', expected: '严格等于“红星”', maxTokens: 48, grade: output => output.trim() === '红星' },
]);
const CASE_BY_ID = new Map(CASES.map(item => [item.id, item]));
const bounded = (value, max = 120) => typeof value === 'string' ? value.slice(0, max) : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function csvCell(value) {
  const raw = String(value ?? '');
  const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('\"', '\"\"')}"`;
}
const validRate = value => value === null || value === '' || value === undefined ? null : /^\d{1,6}(\.\d{1,6})?$/.test(String(value)) ? String(value) : (() => { throw new HttpError(400, '费率必须是非负金额，最多六位小数'); })();
export function calculateProbeCostYuan(endpoint, input, cached, output) {
  if (input === null || output === null || endpoint.input_yuan_per_m === null || endpoint.output_yuan_per_m === null) return null;
  if (endpoint.cached_input_yuan_per_m !== null && cached === null) return null;
  if (cached !== null && cached > input) return null;
  const units = rate => BigInt(String(rate).replace('.', '').padEnd(String(rate).split('.')[0].length + 6, '0'));
  const hit = cached ?? 0;
  const total = BigInt(input - hit) * units(endpoint.input_yuan_per_m) + BigInt(hit) * units(endpoint.cached_input_yuan_per_m ?? endpoint.input_yuan_per_m) + BigInt(output) * units(endpoint.output_yuan_per_m);
  return `${total / 1000000000000n}.${String(total % 1000000000000n).padStart(12, '0')}`;
}
export function validateLabBaseUrl(raw) {
  let url; try { url = new URL(raw); } catch { throw new HttpError(400, 'API 地址不正确'); }
  const hosts = new Set((process.env.SUPPLIER_LAB_ALLOWED_HOSTS || 'api.deepseek.com').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port || !hosts.has(url.hostname.toLowerCase())) throw new HttpError(400, 'API 地址必须是已授权的 HTTPS 主机；由运维配置允许的主机名单');
  if (!/^\/(?:[a-zA-Z0-9._~/-]*)$/.test(url.pathname) || url.pathname.includes('..')) throw new HttpError(400, 'API 路径不正确');
  return url.toString().replace(/\/$/, '');
}
async function readLimited(response) {
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 262144) throw Error('RESPONSE_TOO_LARGE'); chunks.push(value); }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } finally { reader.cancel().catch(() => {}); }
}
export async function runSupplierProbe(endpoint, caseDef, box, runId, pool) {
  validateLabBaseUrl(endpoint.base_url);
  const startedAt = new Date().toISOString(), started = performance.now(); let responseId = null, responseCreated = null, reasoningTokens = null; let httpStatus = null, errorCode = null, upstreamRequestId = null, output = '', usage = null, responseModel = null, finishReason = null;
  try {
    const key = box.open(endpoint.active_ciphertext ?? endpoint.credential_ciphertext).key;
    const request = { model: endpoint.model_id, messages: [{ role: 'user', content: caseDef.prompt }], temperature: 0, max_tokens: caseDef.maxTokens, stream: false };
    if (new URL(endpoint.base_url).hostname === 'api.deepseek.com') request.thinking = { type: 'disabled' };
    const response = await fetch(`${endpoint.base_url}/chat/completions`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(25000) });
    httpStatus = response.status; upstreamRequestId = bounded(response.headers.get('x-request-id') || response.headers.get('x-oneapi-request-id'), 120);
    if (response.ok) {
      const data = await readLimited(response);
      responseId=bounded(data.id,120); responseCreated=integer(data.created); reasoningTokens=integer(data.usage?.completion_tokens_details?.reasoning_tokens);
      output = typeof data.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : '';
      usage = data.usage ?? null; responseModel = bounded(data.model, 120); finishReason = bounded(data.choices?.[0]?.finish_reason, 40);
      if (!output) errorCode = finishReason === 'length' ? 'OUTPUT_TRUNCATED' : 'EMPTY_OUTPUT';
    } else { errorCode = `HTTP_${response.status}`; await response.body?.cancel(); }
  } catch (error) { errorCode = error?.name === 'TimeoutError' ? 'TIMEOUT' : error?.message === 'RESPONSE_TOO_LARGE' ? 'RESPONSE_TOO_LARGE' : 'NETWORK_OR_PROTOCOL_ERROR'; }
  const input = integer(usage?.prompt_tokens), out = integer(usage?.completion_tokens), total = integer(usage?.total_tokens);
  const cacheHitRaw = usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens;
  const cacheMissRaw = usage?.prompt_cache_miss_tokens;
  const cached = integer(cacheHitRaw), cacheMiss = integer(cacheMissRaw);
  const evidenceValue = value => value == null ? null : typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' ? bounded(value, 64) : typeof value;
  // Preserve only recognized accounting fields. Never persist arbitrary upstream payloads.
  const usageEvidence = usage ? { prompt_tokens: evidenceValue(usage.prompt_tokens), completion_tokens: evidenceValue(usage.completion_tokens),
    total_tokens: evidenceValue(usage.total_tokens), prompt_cache_hit_tokens: evidenceValue(usage.prompt_cache_hit_tokens),
    prompt_cache_miss_tokens: evidenceValue(usage.prompt_cache_miss_tokens),
    prompt_tokens_details_cached_tokens: evidenceValue(usage.prompt_tokens_details?.cached_tokens) } : null;
  const schemaOk = httpStatus === 200 && Boolean(output);
  const usageOk = input !== null && out !== null && total === input + out &&
    (cacheHitRaw == null || cached !== null) && (cacheMissRaw == null || cacheMiss !== null) &&
    (usage?.prompt_cache_hit_tokens == null || usage?.prompt_tokens_details?.cached_tokens == null || usage.prompt_cache_hit_tokens === usage.prompt_tokens_details.cached_tokens) &&
    (cached === null || cached <= input) && (cacheMiss === null || cacheMiss <= input) &&
    (cached === null || cacheMiss === null || cached + cacheMiss === input);
  const modelMatchesRequest = responseModel === null ? null : responseModel === endpoint.model_id;
  const caseOk = schemaOk && caseDef.grade(output);
  const costYuan = usageOk && modelMatchesRequest === true ? calculateProbeCostYuan(endpoint, input, cached, out) : null;
  const checks = { response_schema: schemaOk, usage_present_and_consistent: usageOk, task_passed: caseOk,
    requested_model: endpoint.model_id, response_model: responseModel, model_matches_request: modelMatchesRequest,
    finish_reason: finishReason, usage_evidence: usageEvidence,
    started_at:startedAt,finished_at:new Date().toISOString(),response_id:responseId,response_created:responseCreated,reasoning_tokens:reasoningTokens,
    request_parameters:{temperature:0,max_tokens:caseDef.maxTokens,stream:false},
    cache_count_status: cached === null ? 'not_reported' : 'reported',
    cost_status: costYuan !== null ? 'estimated' : 'unavailable',
    grading: 'deterministic_v1' };
  const score = caseOk ? 100 : 0;
  const record = { runId, endpointId: endpoint.id, caseId: caseDef.id, promptHash: hash(caseDef.prompt), responseHash: output ? hash(output) : null, outputSample: output.slice(0, 1500), httpStatus, errorCode: errorCode ?? (!usageOk ? 'USAGE_INVALID' : modelMatchesRequest === false ? 'MODEL_MISMATCH' : modelMatchesRequest === null ? 'MODEL_UNREPORTED' : null), upstreamRequestId, latencyMs: Math.round(performance.now() - started), inputTokens: input, cachedInputTokens: cached, outputTokens: out, totalTokens: total, costYuan, score, checks };
  await pool.query('INSERT INTO supplier_lab_transactions(run_id,endpoint_id,case_id,prompt_sha256,response_sha256,output_sample,http_status,error_code,upstream_request_id,latency_ms,input_tokens,cached_input_tokens,output_tokens,total_tokens,estimated_cost_yuan,quality_score,checks) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)', [record.runId, record.endpointId, record.caseId, record.promptHash, record.responseHash, record.outputSample, record.httpStatus, record.errorCode, record.upstreamRequestId, record.latencyMs, record.inputTokens, record.cachedInputTokens, record.outputTokens, record.totalTokens, record.costYuan, record.score, JSON.stringify(record.checks)]);
}
async function executeRun(pool, box, runId, supplier, reference, cases) {
  try {
    for (const caseDef of cases) { await runSupplierProbe(supplier, caseDef, box, runId, pool); if (reference) await runSupplierProbe(reference, caseDef, box, runId, pool); }
    await pool.query("UPDATE supplier_lab_runs SET status='completed',finished_at=now() WHERE id=$1", [runId]);
  } catch {
    await pool.query("UPDATE supplier_lab_runs SET status='failed',finished_at=now() WHERE id=$1", [runId]).catch(() => {});
  }
}
export async function startSupplierRun(pool,box,b,staffSubject,actor,{firstRunOnly=false}={}) {
    if (!box) throw new HttpError(503, '验收加密服务未配置'); const supplierId = id(b.supplier_endpoint_id), referenceId = b.reference_endpoint_id ? id(b.reference_endpoint_id) : null;
    if (referenceId === supplierId) throw new HttpError(400, '对比端点不能与供应端点相同');
    const requested = Array.isArray(b.case_ids) ? b.case_ids : []; if (!requested.length || requested.length > 4 || new Set(requested).size !== requested.length || requested.some(x => !CASE_BY_ID.has(x))) throw new HttpError(400, '请选择 1 至 4 个固定任务');
    const endpoints = (await pool.query(`SELECT e.*,coalesce(c.credential_ciphertext,e.credential_ciphertext) AS active_ciphertext FROM supplier_lab_endpoints e LEFT JOIN supplier_lab_credentials c ON c.id=e.credential_id LEFT JOIN supplier_lab_suppliers s ON s.id=e.supplier_id WHERE e.id=ANY($1::uuid[]) AND e.disabled_at IS NULL AND (c.id IS NULL OR c.disabled_at IS NULL) AND (s.id IS NULL OR (s.disabled_at IS NULL AND NOT EXISTS(SELECT 1 FROM suppliers p WHERE p.id=s.canonical_supplier_id AND p.status='blocked')))`, [[supplierId, referenceId].filter(Boolean)])).rows;
    const supplier = endpoints.find(x => x.id === supplierId && x.kind === 'supplier'), reference = referenceId ? endpoints.find(x => x.id === referenceId) : null;
    if (!supplier || (referenceId && !reference)) throw new HttpError(400, '型号不存在、Key 已停用或类型不匹配');
    validateLabBaseUrl(supplier.base_url);
    if (reference) validateLabBaseUrl(reference.base_url);
    const runId = await transaction(pool, async db => { await db.query('SELECT pg_advisory_xact_lock(148921,9)');
      const usable=await db.query(`SELECT e.id FROM supplier_lab_endpoints e LEFT JOIN supplier_lab_credentials c ON c.id=e.credential_id WHERE e.id=ANY($1::uuid[]) AND e.disabled_at IS NULL AND (c.id IS NULL OR c.disabled_at IS NULL) FOR SHARE OF e`,[[supplierId,...(referenceId?[referenceId]:[])]]);
      if(usable.rowCount!==(referenceId?2:1))throw new HttpError(409,'Key 或型号状态已变化，请重新选择'); if(firstRunOnly && (await db.query('SELECT 1 FROM supplier_lab_runs WHERE supplier_endpoint_id=$1 OR reference_endpoint_id=$1',[supplierId])).rowCount) throw new HttpError(409,'该型号已有测试，拒绝重复首批执行'); await db.query("UPDATE supplier_lab_runs SET status='failed',finished_at=now() WHERE status='running' AND created_at<now()-interval '5 minutes'"); const active = Number((await db.query("SELECT count(*) AS n FROM supplier_lab_runs WHERE status='running'")).rows[0].n); if (active >= 2) throw new HttpError(429, '已有验收任务运行中，请稍后再试'); const row = (await db.query('INSERT INTO supplier_lab_runs(supplier_endpoint_id,reference_endpoint_id,case_ids,created_by) VALUES($1,$2,$3,$4) RETURNING id', [supplierId, referenceId, requested, staffSubject])).rows[0]; await audit(db, actor, 'supplier_lab.run_started', null, row.id, { supplier_endpoint_id: supplierId, reference_endpoint_id: referenceId, case_ids: requested, invocation: firstRunOnly ? 'operator_first_run' : 'console' }); return row.id; });
    return {run_id:runId,status:'running',max_upstream_calls:requested.length*(reference?2:1),completion:executeRun(pool,box,runId,supplier,reference,requested.map(x=>CASE_BY_ID.get(x)))};
}
export function supplierLabRoutes(app, pool, requireStaff) {
  const secret = process.env.SUPPLIER_LAB_SECRET;
  const box = secret?.length >= 32 ? vault(secret) : null;
  usageRoutes(app,pool,requireStaff,box);
  const access = (req, write = false) => { requireTechnical(req); if (write && !box) throw new HttpError(503, '验收台凭据加密密钥尚未配置'); };
  app.get('/api/staff/lab/console', requireStaff, (req, res) => { access(req); res.set('Cache-Control', 'no-store'); res.sendFile(new URL('../private/admin-shell.html', import.meta.url).pathname,{dotfiles:'allow'}); });
  app.get('/api/staff/lab/view', requireStaff, (req, res) => { access(req); res.sendFile(new URL('../private/supplier-lab.html', import.meta.url).pathname,{dotfiles:'allow'}); });
  app.get('/api/staff/lab/console.js', requireStaff, (req, res) => { access(req); res.set('Cache-Control', 'no-store'); res.type('js').sendFile(new URL('../private/supplier-lab.js', import.meta.url).pathname,{dotfiles:'allow'}); });
  app.get('/api/staff/lab/logo.svg', requireStaff, (req, res) => { access(req); res.set('Cache-Control', 'no-store'); res.type('svg').sendFile(new URL('../private/supplier-lab-logo.svg', import.meta.url).pathname,{dotfiles:'allow'}); });
  app.get('/api/staff/lab/config', requireStaff, (req, res) => { access(req); res.json({ ready: Boolean(box), allowed_hosts: (process.env.SUPPLIER_LAB_ALLOWED_HOSTS || 'api.deepseek.com').split(',').map(x => x.trim()).filter(Boolean), cases: CASES.map(({ id, name, prompt, expected, maxTokens }) => ({ id, name, prompt, expected, max_tokens: maxTokens })), customer_traffic_connected: false }); });
  app.get('/api/staff/lab/suppliers', requireStaff, async (req,res)=>{
    access(req);
    res.json((await pool.query(`SELECT p.id,p.display_name AS name,p.legal_name,CASE WHEN p.source_type='official' THEN 'reference' ELSE 'supplier' END AS kind,
      p.created_at,CASE WHEN p.status='blocked' THEN p.updated_at ELSE NULL END AS disabled_at,
      count(DISTINCT c.id) FILTER(WHERE c.disabled_at IS NULL)::int AS key_count,
      count(DISTINCT e.id) FILTER(WHERE e.disabled_at IS NULL)::int AS model_count,max(t.created_at) AS last_test_at
      FROM suppliers p LEFT JOIN supplier_lab_suppliers s ON s.canonical_supplier_id=p.id
      LEFT JOIN supplier_lab_credentials c ON c.supplier_id=s.id LEFT JOIN supplier_lab_endpoints e ON e.credential_id=c.id
      LEFT JOIN supplier_lab_transactions t ON t.endpoint_id=e.id GROUP BY p.id ORDER BY p.created_at DESC LIMIT 200`)).rows);
  });
  app.post('/api/staff/lab/suppliers', requireStaff, (req,res)=>{access(req);throw new HttpError(410,'供应商统一在业务工作台建立，请使用供应采购入口');});
  app.get('/api/staff/lab/credentials', requireStaff, async (req,res)=>{
    access(req);
    res.json((await pool.query(`SELECT c.id,s.canonical_supplier_id AS supplier_id,c.label,c.base_url,c.credential_fingerprint,c.created_at,c.disabled_at,c.replaces_credential_id,c.rotation_completed_at,
      s.name AS supplier_name,s.kind,count(DISTINCT e.id) FILTER (WHERE e.disabled_at IS NULL)::int AS model_count,
      max(t.created_at) AS last_test_at FROM supplier_lab_credentials c JOIN supplier_lab_suppliers s ON s.id=c.supplier_id
      LEFT JOIN supplier_lab_endpoints e ON e.credential_id=c.id LEFT JOIN supplier_lab_transactions t ON t.endpoint_id=e.id
      GROUP BY c.id,s.id ORDER BY c.created_at DESC LIMIT 200`)).rows);
  });
  app.post('/api/staff/lab/credentials', requireStaff, async (req,res)=>{
    access(req,true);
    const b=req.body||{}, supplierId=id(b.supplier_id), label=text(b.label,'Key 别名',100), baseUrl=validateLabBaseUrl(b.base_url), key=text(b.api_key,'API Key',1000);
    if (/\s/.test(key)) throw new HttpError(400,'API Key 不可包含空白字符');
    const row=await transaction(pool,async db=>{
      const supplier=(await db.query("SELECT * FROM suppliers WHERE id=$1 AND status<>'blocked' FOR SHARE",[supplierId])).rows[0];
      if(!supplier) throw new HttpError(404,'供应商不存在或已停用');
      await db.query(`INSERT INTO supplier_lab_suppliers(id,name,legal_name,kind,created_by,canonical_supplier_id)
        VALUES($1,$2,$3,$4,$5,$1) ON CONFLICT(canonical_supplier_id) DO NOTHING`,[supplierId,supplier.display_name,supplier.legal_name,supplier.source_type==='official'?'reference':'supplier',req.staff.subject]);
      const labSupplier=(await db.query('SELECT id FROM supplier_lab_suppliers WHERE canonical_supplier_id=$1',[supplierId])).rows[0];
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[baseUrl+':'+hash(key)]);
      if((await db.query('SELECT id FROM supplier_lab_credentials WHERE base_url=$1 AND credential_fingerprint=$2',[baseUrl,hash(key).slice(0,12)])).rowCount)throw new HttpError(409,'这枚 Key 已登记，请复用已有凭据；如已停用请使用上游新生成的 Key');
      const result=(await db.query('INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,supplier_id,label,base_url,credential_fingerprint,created_at,disabled_at',[labSupplier.id,label,baseUrl,box.seal({key}),hash(key).slice(0,12),req.staff.subject])).rows[0];
      await audit(db,req.actor,'supplier_lab.credential_created',null,result.id,{supplier_id:supplierId,host:new URL(baseUrl).hostname}); return result;
    });
    res.status(201).json(row);
  });
// Create a separate credential generation. Historical endpoints and reports stay immutable.
  app.post('/api/staff/lab/credentials/:id/replacement',requireStaff,async(req,res)=>{
    access(req,true);const oldId=id(req.params.id),b=req.body||{},label=text(b.label,'新 Key 别名',100),key=text(b.api_key,'API Key',1000);
    if(/\s/.test(key))throw new HttpError(400,'API Key 不可包含空白字符');
    if(!Array.isArray(b.endpoint_ids)||!b.endpoint_ids.length||b.endpoint_ids.length>100)throw new HttpError(400,'请选择新 Key 允许测试的型号');
    const endpointIds=[...new Set(b.endpoint_ids.map(id))];
    const row=await transaction(pool,async db=>{
      const old=(await db.query(`SELECT c.*,s.canonical_supplier_id FROM supplier_lab_credentials c JOIN supplier_lab_suppliers s ON s.id=c.supplier_id JOIN suppliers p ON p.id=s.canonical_supplier_id WHERE c.id=$1 AND s.disabled_at IS NULL AND p.status<>'blocked' FOR UPDATE OF c`,[oldId])).rows[0];
      if(!old)throw new HttpError(404,'Key 不存在或供应商已停用');
      validateLabBaseUrl(old.base_url);
      if((await db.query('SELECT 1 FROM supplier_lab_credentials WHERE replaces_credential_id=$1 AND disabled_at IS NULL',[oldId])).rowCount)throw new HttpError(409,'已有替换版本，请先完成验证或停用该替换版本');
      const endpoints=(await db.query('SELECT * FROM supplier_lab_endpoints WHERE credential_id=$1 AND id=ANY($2::uuid[]) AND disabled_at IS NULL ORDER BY created_at FOR SHARE',[oldId,endpointIds])).rows;
      if(endpoints.length!==endpointIds.length)throw new HttpError(400,'所选型号不属于此 Key 或已停用');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[old.base_url+':'+hash(key)]);
      if((await db.query('SELECT 1 FROM supplier_lab_credentials WHERE base_url=$1 AND credential_fingerprint=$2',[old.base_url,hash(key).slice(0,12)])).rowCount)throw new HttpError(409,'这枚 Key 已登记，请使用上游新生成的 Key');
      if((await db.query('SELECT 1 FROM supplier_lab_credentials WHERE supplier_id=$1 AND label=$2',[old.supplier_id,label])).rowCount)throw new HttpError(409,'别名已使用，请为新版本起一个不同名称');
      const replacement=(await db.query(`INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by,replaces_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,label,credential_fingerprint,replaces_credential_id`,[old.supplier_id,label,old.base_url,box.seal({key}),hash(key).slice(0,12),req.staff.subject,oldId])).rows[0];
      const newEndpoints=[];
      for(const e of endpoints){const next=(await db.query(`INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,input_yuan_per_m,cached_input_yuan_per_m,output_yuan_per_m,created_by,supplier_id,credential_id,offer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,model_id`,[e.label,e.kind,old.base_url,e.model_id,replacement.credential_fingerprint,e.input_yuan_per_m,e.cached_input_yuan_per_m,e.output_yuan_per_m,req.staff.subject,old.supplier_id,replacement.id,e.offer_id])).rows[0];newEndpoints.push(next);}
      await audit(db,req.actor,'supplier_lab.key_replacement_prepared',null,replacement.id,{previous_credential_id:oldId,endpoint_ids:newEndpoints.map(e=>e.id)});
      return {...replacement,endpoints:newEndpoints,stage:'awaiting_validation'};
    });res.status(201).json(row);
  });
  app.post('/api/staff/lab/credentials/:id/complete-replacement',requireStaff,async(req,res)=>{
    access(req,true);const newId=id(req.params.id);
    await transaction(pool,async db=>{
      // Serialize with test starts so no old-key task can race the retirement check.
      await db.query('SELECT pg_advisory_xact_lock(148921,9)');
      const replacement=(await db.query('SELECT * FROM supplier_lab_credentials WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',[newId])).rows[0];
      if(!replacement?.replaces_credential_id)throw new HttpError(404,'未找到有效替换版本');
      const oldId=replacement.replaces_credential_id;
      await db.query('SELECT id FROM supplier_lab_credentials WHERE id=$1 FOR UPDATE',[oldId]);
      if(replacement.rotation_completed_at)return;
      const endpoints=(await db.query('SELECT id FROM supplier_lab_endpoints WHERE credential_id=$1 AND disabled_at IS NULL FOR SHARE',[newId])).rows;
      if(!endpoints.length)throw new HttpError(409,'替换 Key 尚无可用型号');
      for(const e of endpoints){const latest=(await db.query(`SELECT t.* FROM supplier_lab_transactions t JOIN supplier_lab_runs r ON r.id=t.run_id WHERE t.endpoint_id=$1 AND r.status='completed' ORDER BY t.created_at DESC LIMIT 1`,[e.id])).rows[0];
        if(!latest||latest.http_status!==200||latest.error_code||latest.checks?.model_matches_request!==true||latest.checks?.usage_present_and_consistent!==true)throw new HttpError(409,'请先对新 Key 每个所选型号完成真实测试，取得有效响应和用量；本操作不自动发起付费调用');}
      if((await db.query(`SELECT 1 FROM supplier_lab_runs r JOIN supplier_lab_endpoints e ON e.id=r.supplier_endpoint_id OR e.id=r.reference_endpoint_id WHERE r.status='running' AND e.credential_id=ANY($1::uuid[])`,[[oldId,newId]])).rowCount)throw new HttpError(409,'相关 Key 仍有测试在运行，请等待完成');
      await db.query('UPDATE supplier_lab_credentials SET disabled_at=coalesce(disabled_at,now()) WHERE id=$1',[oldId]);
      await db.query('UPDATE supplier_lab_credentials SET rotation_completed_at=now() WHERE id=$1',[newId]);
      await audit(db,req.actor,'supplier_lab.key_replacement_completed',null,newId,{previous_credential_id:oldId,scope:'lab_only'});
    });res.json({ok:true,scope:'lab_only'});
  });

  app.post('/api/staff/lab/credentials/:id/disable',requireStaff,async(req,res)=>{
    access(req,true);const credentialId=id(req.params.id);
    await transaction(pool,async db=>{
      const result=await db.query('UPDATE supplier_lab_credentials SET disabled_at=now() WHERE id=$1 AND disabled_at IS NULL RETURNING id',[credentialId]);
      if(!result.rowCount)throw new HttpError(404,'Key 不存在或已停用');
      await audit(db,req.actor,'supplier_lab.credential_disabled',null,credentialId);
    });res.json({ok:true});
  });
  app.get('/api/staff/lab/endpoints',requireStaff,async(req,res)=>{
    access(req);
    res.json((await pool.query(`SELECT e.id,e.offer_id,e.label,e.kind,e.base_url,e.model_id,e.supplier_id,e.credential_id,
      e.credential_fingerprint,e.input_yuan_per_m,e.cached_input_yuan_per_m,e.output_yuan_per_m,e.created_at,e.disabled_at,
      s.name AS supplier_name,c.label AS credential_label,c.disabled_at AS credential_disabled_at
      FROM supplier_lab_endpoints e LEFT JOIN supplier_lab_suppliers s ON s.id=e.supplier_id
      LEFT JOIN supplier_lab_credentials c ON c.id=e.credential_id ORDER BY e.created_at DESC LIMIT 300`)).rows);
  });
  app.post('/api/staff/lab/endpoints',requireStaff,async(req,res)=>{
    access(req,true);const b=req.body||{},credentialId=id(b.credential_id),label=text(b.label,'型号名称',100),model=text(b.model_id,'上游型号 ID',120);
    const rates=[validRate(b.input_yuan_per_m),validRate(b.cached_input_yuan_per_m),validRate(b.output_yuan_per_m)];
    const row=await transaction(pool,async db=>{
      const source=(await db.query(`SELECT c.id,c.supplier_id,c.base_url,c.credential_fingerprint,s.kind,s.canonical_supplier_id FROM supplier_lab_credentials c
        JOIN supplier_lab_suppliers s ON s.id=c.supplier_id WHERE c.id=$1 AND c.disabled_at IS NULL AND s.disabled_at IS NULL AND NOT EXISTS(SELECT 1 FROM suppliers p WHERE p.id=s.canonical_supplier_id AND p.status='blocked') FOR SHARE OF c,s`,[credentialId])).rows[0];
      if(!source)throw new HttpError(404,'Key 不存在或已停用');
      const duplicate=(await db.query('SELECT id FROM supplier_lab_endpoints WHERE credential_id=$1 AND model_id=$2 AND disabled_at IS NULL',[credentialId,model])).rows[0];
      if(duplicate)throw new HttpError(409,'这枚 Key 已登记该型号');
      const result=(await db.query(`INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_ciphertext,credential_fingerprint,
        input_yuan_per_m,cached_input_yuan_per_m,output_yuan_per_m,created_by,supplier_id,credential_id)
        VALUES($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id,label,kind,base_url,model_id,credential_fingerprint,input_yuan_per_m,cached_input_yuan_per_m,output_yuan_per_m,created_at,supplier_id,credential_id`,
        [label,source.kind,source.base_url,model,source.credential_fingerprint,...rates,req.staff.subject,source.supplier_id,credentialId])).rows[0];
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[source.canonical_supplier_id+':'+model]);
      let offer=(await db.query("SELECT id FROM supplier_offers WHERE supplier_id=$1 AND upstream_model_id=$2 AND status<>'blocked' ORDER BY created_at LIMIT 1",[source.canonical_supplier_id,model])).rows[0];
      if(!offer){offer=(await db.query(`INSERT INTO supplier_offers(supplier_id,model_name,upstream_model_id,protocol,region,created_by)
        SELECT id,$2,$3,'openai_compatible',region,$4 FROM suppliers WHERE id=$1 RETURNING id`,[source.canonical_supplier_id,label,model,req.staff.subject])).rows[0];
        await db.query("INSERT INTO supplier_offer_checks(offer_id,check_key) SELECT $1,unnest(ARRAY['source','sales_rights','model_version','protocol','data_region','usage_billing','capacity'])",[offer.id]);}
      await db.query('UPDATE supplier_lab_endpoints SET offer_id=$2 WHERE id=$1',[result.id,offer.id]);result.offer_id=offer.id;
      await audit(db,req.actor,'supplier_lab.endpoint_created',null,result.id,{supplier_id:source.supplier_id,credential_id:credentialId,model_id:model});return result;
    });res.status(201).json(row);
  });
  app.post('/api/staff/lab/endpoints/:id/rates',requireStaff,async(req,res)=>{
    access(req,true);const endpointId=id(req.params.id),b=req.body||{};
    const rates=[validRate(b.input_yuan_per_m),validRate(b.cached_input_yuan_per_m),validRate(b.output_yuan_per_m)];
    await transaction(pool,async db=>{
      const e=(await db.query('SELECT id FROM supplier_lab_endpoints WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',[endpointId])).rows[0];
      if(!e)throw new HttpError(404,'型号不存在或已停用');
      if((await db.query('SELECT 1 FROM supplier_lab_runs WHERE supplier_endpoint_id=$1 OR reference_endpoint_id=$1 LIMIT 1',[endpointId])).rowCount)throw new HttpError(409,'已有测试的费率不能改写；请停用旧型号并为同一 Key 登记新费率版本');
      await db.query('UPDATE supplier_lab_endpoints SET input_yuan_per_m=$2,cached_input_yuan_per_m=$3,output_yuan_per_m=$4 WHERE id=$1',[endpointId,...rates]);
      await audit(db,req.actor,'supplier_lab.rates_set',null,endpointId);
    });res.json({ok:true});
  });
  app.post('/api/staff/lab/endpoints/:id/disable', requireStaff, async (req, res) => {
    access(req,true);const endpointId=id(req.params.id);
    await transaction(pool,async db=>{const result=await db.query('UPDATE supplier_lab_endpoints SET disabled_at=now() WHERE id=$1 AND disabled_at IS NULL RETURNING id',[endpointId]);if(!result.rowCount)throw new HttpError(404,'型号不存在或已停用');await audit(db,req.actor,'supplier_lab.endpoint_disabled',null,endpointId);});res.json({ok:true});
  });
  app.get('/api/staff/lab/discoveries',requireStaff,async(req,res)=>{
    access(req);
    res.json((await pool.query(`SELECT d.id,d.endpoint_id,d.credential_id,d.http_status,d.error_code,d.latency_ms,d.model_ids,
      d.response_sha256,d.upstream_request_id,d.created_at,coalesce(c.label,e.label) AS endpoint_label,
      s.name AS supplier_name FROM supplier_lab_discoveries d LEFT JOIN supplier_lab_credentials c ON c.id=d.credential_id
      LEFT JOIN supplier_lab_suppliers s ON s.id=c.supplier_id LEFT JOIN supplier_lab_endpoints e ON e.id=d.endpoint_id
      ORDER BY d.created_at DESC LIMIT 50`)).rows);
  });
  app.post('/api/staff/lab/credentials/:id/discover',requireStaff,async(req,res)=>{
    access(req,true);const credentialId=id(req.params.id);
    const credential=(await pool.query(`SELECT c.* FROM supplier_lab_credentials c JOIN supplier_lab_suppliers s ON s.id=c.supplier_id
      WHERE c.id=$1 AND c.disabled_at IS NULL AND s.disabled_at IS NULL AND NOT EXISTS(SELECT 1 FROM suppliers p WHERE p.id=s.canonical_supplier_id AND p.status='blocked')`,[credentialId])).rows[0];
    if(!credential)throw new HttpError(404,'Key 不存在或已停用');
    validateLabBaseUrl(credential.base_url);
    const started=performance.now();let httpStatus=null,errorCode=null,modelIds=[],responseHash=null,upstreamRequestId=null;
    try{
      const key=box.open(credential.credential_ciphertext).key;
      const response=await fetch(`${credential.base_url}/models`,{headers:{Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(12000)});
      httpStatus=response.status;upstreamRequestId=bounded(response.headers.get('x-request-id'),120);
      if(!response.ok){errorCode=`HTTP_${response.status}`;await response.body?.cancel();}
      else{const payload=await readLimited(response);responseHash=hash(JSON.stringify(payload));if(!Array.isArray(payload.data))errorCode='MODELS_SCHEMA_INVALID';else modelIds=payload.data.map(item=>item?.id).filter(x=>typeof x==='string'&&x.length<=120).slice(0,200);}
    }catch(error){errorCode=error?.name==='TimeoutError'?'TIMEOUT':error?.message==='RESPONSE_TOO_LARGE'?'RESPONSE_TOO_LARGE':'NETWORK_OR_PROTOCOL_ERROR';}
    const row=await transaction(pool,async db=>{const result=(await db.query(`INSERT INTO supplier_lab_discoveries(credential_id,http_status,error_code,latency_ms,model_ids,response_sha256,upstream_request_id,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,credential_id,http_status,error_code,latency_ms,model_ids,response_sha256,upstream_request_id,created_at`,
      [credentialId,httpStatus,errorCode,Math.round(performance.now()-started),modelIds,responseHash,upstreamRequestId,req.staff.subject])).rows[0];
      await audit(db,req.actor,'supplier_lab.models_discovered',null,credentialId,{discovery_id:result.id,model_count:modelIds.length,error_code:errorCode});return result;});
    res.status(201).json(row);
  });
  app.post('/api/staff/lab/runs', requireStaff, async (req, res) => {
    access(req,true); const {completion,...result}=await startSupplierRun(pool,box,req.body||{},req.staff.subject,req.actor);
    void completion; res.status(202).json(result);
  });
  app.get('/api/staff/lab/supplier-dashboard',requireStaff,async(req,res)=>{
    access(req);const supplierId=id(req.query.supplier_id),endpointId=req.query.endpoint_id?id(req.query.endpoint_id):null;
    const page=Number(req.query.page||0);if(!Number.isSafeInteger(page)||page<0||page>10000)throw new HttpError(400,'页码不正确');
    const supplier=(await pool.query('SELECT id,display_name,legal_name,status FROM suppliers WHERE id=$1',[supplierId])).rows[0];
    if(!supplier)throw new HttpError(404,'供应商不存在');
    const models=(await pool.query(`SELECT e.id,e.model_id,e.label,e.credential_id,e.disabled_at,c.label AS credential_label,c.disabled_at AS credential_disabled_at,
      e.input_yuan_per_m,e.cached_input_yuan_per_m,e.output_yuan_per_m,
      count(t.id)::int AS lifetime_calls,coalesce(sum(t.input_tokens),0)::text AS lifetime_input,coalesce(sum(t.output_tokens),0)::text AS lifetime_output,
      count(t.id) FILTER(WHERE t.created_at >= date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')::int AS month_calls,
      coalesce(sum(t.input_tokens+t.output_tokens) FILTER(WHERE t.created_at >= date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'),0)::text AS month_tokens,
      count(t.id) FILTER(WHERE t.error_code IS NOT NULL)::int AS issues,
      count(t.id) FILTER(WHERE t.estimated_cost_yuan IS NULL)::int AS unpriced_calls,
      sum(t.estimated_cost_yuan)::text AS known_cost_yuan,
      last.created_at AS last_test_at,last.latency_ms AS last_latency_ms,last.http_status AS last_http_status,last.error_code AS last_error_code
      FROM supplier_lab_endpoints e JOIN supplier_lab_suppliers s ON s.id=e.supplier_id
      LEFT JOIN supplier_lab_credentials c ON c.id=e.credential_id LEFT JOIN supplier_lab_transactions t ON t.endpoint_id=e.id
      LEFT JOIN LATERAL(SELECT created_at,latency_ms,http_status,error_code FROM supplier_lab_transactions WHERE endpoint_id=e.id ORDER BY created_at DESC,id DESC LIMIT 1) last ON true
      WHERE s.canonical_supplier_id=$1 GROUP BY e.id,c.id,last.created_at,last.latency_ms,last.http_status,last.error_code ORDER BY e.model_id,c.label,e.id`,[supplierId])).rows;
    if(endpointId&&!models.some(m=>m.id===endpointId))throw new HttpError(404,'该型号不属于此供应商');
    const records=(await pool.query(`SELECT t.id,t.endpoint_id,t.case_id,t.created_at,t.http_status,t.error_code,t.latency_ms,t.input_tokens,t.cached_input_tokens,t.output_tokens,t.estimated_cost_yuan,t.upstream_request_id,t.output_sample,t.quality_score,t.checks,e.model_id,c.label AS credential_label
      FROM supplier_lab_transactions t JOIN supplier_lab_endpoints e ON e.id=t.endpoint_id JOIN supplier_lab_suppliers s ON s.id=e.supplier_id
      LEFT JOIN supplier_lab_credentials c ON c.id=e.credential_id WHERE s.canonical_supplier_id=$1 AND ($2::uuid IS NULL OR e.id=$2) ORDER BY t.created_at DESC,t.id DESC LIMIT 5 OFFSET $3`,[supplierId,endpointId,page*5])).rows;
    res.json({supplier,models,records,page,page_size:5,total_records:models.filter(m=>!endpointId||m.id===endpointId).reduce((n,m)=>n+m.lifetime_calls,0),scope:'platform_lab_only',month_timezone:'Asia/Shanghai',collected_at:new Date().toISOString()});
  });
  app.get('/api/staff/lab/runs', requireStaff, async (req, res) => { access(req); res.json((await pool.query("SELECT r.id,r.supplier_endpoint_id,r.reference_endpoint_id,r.case_ids,r.status,r.created_at,r.finished_at,s.label AS supplier_label,s.model_id AS supplier_model,f.label AS reference_label,f.model_id AS reference_model,ss.name AS supplier_name,sc.label AS supplier_key_label,fs.name AS reference_supplier_name,fc.label AS reference_key_label,count(t.id)::int AS transaction_count,round(avg(t.quality_score),1) AS average_score FROM supplier_lab_runs r JOIN supplier_lab_endpoints s ON s.id=r.supplier_endpoint_id LEFT JOIN supplier_lab_endpoints f ON f.id=r.reference_endpoint_id LEFT JOIN supplier_lab_suppliers ss ON ss.id=s.supplier_id LEFT JOIN supplier_lab_credentials sc ON sc.id=s.credential_id LEFT JOIN supplier_lab_suppliers fs ON fs.id=f.supplier_id LEFT JOIN supplier_lab_credentials fc ON fc.id=f.credential_id LEFT JOIN supplier_lab_transactions t ON t.run_id=r.id GROUP BY r.id,s.id,f.id,ss.id,sc.id,fs.id,fc.id ORDER BY r.created_at DESC LIMIT 50")).rows); });
  app.get('/api/staff/lab/transactions.csv', requireStaff, async (req, res) => {
    access(req);
    const runId = req.query.run_id ? id(req.query.run_id) : null;
    const rows = (await pool.query(`SELECT t.id,t.run_id,t.case_id,t.created_at,t.output_sample,t.http_status,t.error_code,t.upstream_request_id,t.latency_ms,t.input_tokens,t.cached_input_tokens,t.output_tokens,t.total_tokens,t.estimated_cost_yuan,t.quality_score,t.checks,e.model_id,s.name AS supplier_name,c.label AS credential_label
      FROM supplier_lab_transactions t JOIN supplier_lab_endpoints e ON e.id=t.endpoint_id LEFT JOIN supplier_lab_suppliers s ON s.id=e.supplier_id LEFT JOIN supplier_lab_credentials c ON c.id=e.credential_id
      WHERE ($1::uuid IS NULL OR t.run_id=$1) ORDER BY t.created_at DESC LIMIT 1000`, [runId])).rows;
    const headers = ['本台流水','测试批次','时间 UTC','供应商','Key 别名','请求型号','返回型号','题目','HTTP','异常代码','上游请求 ID','输入 Token','缓存命中 Token','缓存未命中 Token','输出 Token','总 Token','估算采购成本 ¥','延迟 ms','题目得分','响应 ID（不等同请求 ID）','请求开始 UTC','请求结束 UTC','输出结果','结束原因','输出中推理 Token（不可重复相加）'];
    const values = rows.map(x => [x.id,x.run_id,new Date(x.created_at).toISOString(),x.supplier_name,x.credential_label,x.model_id,x.checks?.response_model,x.case_id,x.http_status,x.error_code,x.upstream_request_id,x.input_tokens,x.cached_input_tokens,x.checks?.usage_evidence?.prompt_cache_miss_tokens,x.output_tokens,x.total_tokens,x.estimated_cost_yuan,x.latency_ms,x.quality_score,x.checks?.response_id,x.checks?.started_at,x.checks?.finished_at,x.output_sample,x.checks?.finish_reason,x.checks?.reasoning_tokens]);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Disposition', 'attachment; filename="supplier-lab-transactions.csv"');
    res.type('text/csv; charset=utf-8').send('\uFEFF' + [headers, ...values].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
  });
  app.get('/api/staff/lab/transactions', requireStaff, async (req, res) => { access(req); const runId = req.query.run_id ? id(req.query.run_id) : null; res.json((await pool.query('SELECT t.id,t.run_id,t.endpoint_id,t.case_id,t.prompt_sha256,t.response_sha256,t.output_sample,t.http_status,t.error_code,t.upstream_request_id,t.latency_ms,t.input_tokens,t.cached_input_tokens,t.output_tokens,t.total_tokens,t.estimated_cost_yuan,t.quality_score,t.checks,t.created_at,e.label AS endpoint_label,e.kind,e.model_id,s.name AS supplier_name,c.label AS credential_label FROM supplier_lab_transactions t JOIN supplier_lab_endpoints e ON e.id=t.endpoint_id LEFT JOIN supplier_lab_suppliers s ON s.id=e.supplier_id LEFT JOIN supplier_lab_credentials c ON c.id=e.credential_id WHERE ($1::uuid IS NULL OR t.run_id=$1) ORDER BY t.created_at DESC LIMIT 200', [runId])).rows); });
  app.get('/api/staff/lab/summary', requireStaff, async (req, res) => { access(req); res.json((await pool.query("SELECT count(*)::int AS attempts,count(*) FILTER(WHERE error_code IS NULL AND checks->>'response_schema'='true' AND checks->>'usage_present_and_consistent'='true' AND checks->>'model_matches_request'='true')::int AS valid_responses,count(*) FILTER(WHERE checks->>'task_passed'='true')::int AS task_passes,count(*) FILTER(WHERE estimated_cost_yuan IS NULL)::int AS unpriced_attempts,count(*) FILTER(WHERE error_code IS NOT NULL)::int AS issues,round(avg(latency_ms),0) AS average_latency_ms,round((percentile_cont(0.95) WITHIN GROUP(ORDER BY latency_ms))::numeric,0) AS p95_latency_ms,round(avg(quality_score),1) AS average_task_score,coalesce(sum(input_tokens),0)::bigint AS input_tokens,coalesce(sum(output_tokens),0)::bigint AS output_tokens,coalesce(sum(estimated_cost_yuan),0) AS estimated_probe_cost_yuan FROM supplier_lab_transactions WHERE created_at>now()-interval '7 days'")).rows[0]); });
  app.post('/api/staff/lab/reconciliations', requireStaff, async (req, res) => {
    access(req, true);
    const b = req.body || {};
    const endpointId = id(b.endpoint_id), start = new Date(b.period_start), end = new Date(b.period_end);
    const billed = validRate(b.supplier_billed_yuan);
    const note = typeof b.note === 'string' ? b.note.trim() : '';
    if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || start >= end || end > new Date() || billed === null) throw new HttpError(400, '核对时间或供应商金额不正确');
    if (note.length < 3 || note.length > 500) throw new HttpError(400, '请填写上游账单编号或导出文件编号');
    const row = await transaction(pool, async db => {
      const endpoint = (await db.query('SELECT id FROM supplier_lab_endpoints WHERE id=$1 FOR UPDATE', [endpointId])).rows[0];
      if (!endpoint) throw new HttpError(404, '端点不存在');
      const totals = (await db.query('SELECT coalesce(sum(estimated_cost_yuan),0) AS cost,count(*)::int AS calls,count(*) FILTER(WHERE estimated_cost_yuan IS NULL)::int AS unpriced FROM supplier_lab_transactions WHERE endpoint_id=$1 AND created_at >= $2 AND created_at < $3', [endpointId, start, end])).rows[0];
      if (totals.calls === 0) throw new HttpError(409, '该时段没有本台测试交易，无法核对');
      if (totals.unpriced) throw new HttpError(409, `该时段有 ${totals.unpriced} 笔无法估价的测试交易，请先逐笔核实`);
      const overlap = (await db.query('SELECT 1 FROM supplier_lab_reconciliations WHERE endpoint_id=$1 AND period_start < $3 AND period_end > $2 LIMIT 1', [endpointId, start, end])).rowCount > 0;
      if (overlap) throw new HttpError(409, '该型号已有重叠的账单核对时段，请避免重复记账');
      const result = (await db.query('INSERT INTO supplier_lab_reconciliations(endpoint_id,period_start,period_end,supplier_billed_yuan,observed_cost_yuan,difference_yuan,note,created_by) VALUES($1,$2,$3,$4,$5,$4::numeric-$5::numeric,$6,$7) RETURNING *', [endpointId, start, end, billed, totals.cost, note, req.staff.subject])).rows[0];
      await audit(db, req.actor, 'supplier_lab.reconciliation_created', null, result.id, { endpoint_id: endpointId, calls: totals.calls, bill_reference: note });
      return { ...result, probe_calls: totals.calls };
    });
    res.status(201).json(row);
  });
  app.get('/api/staff/lab/reconciliations', requireStaff, async (req, res) => { access(req); res.json((await pool.query('SELECT c.*,e.label AS endpoint_label FROM supplier_lab_reconciliations c JOIN supplier_lab_endpoints e ON e.id=c.endpoint_id ORDER BY c.created_at DESC LIMIT 50')).rows); });
}
