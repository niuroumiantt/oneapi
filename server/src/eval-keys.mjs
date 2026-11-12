// Official API keys kept for evaluation only. Each vendor has at most one live key; it is stored as a
// 'reference' supplier credential, which employee routing never picks (routing only uses 'supplier' keys on KerAPI).
import { HttpError, audit, hash, id, text, transaction, vault } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { OFFICIAL_MODELS } from './official-models.mjs';

// Hosts here are always allowed for reference keys, so ops never has to edit the allowed-host list to add an official vendor.
export const OFFICIAL_VENDORS = Object.freeze({
 deepseek: { name: 'DeepSeek 官方', base_url: 'https://api.deepseek.com', family: 'deepseek', region: '中国大陆', suggested: ['deepseek-chat', 'deepseek-reasoner'], console: 'https://platform.deepseek.com' },
 zhipu: { name: '智谱 GLM（国内）', base_url: 'https://open.bigmodel.cn/api/paas/v4', family: 'glm', region: '中国大陆', suggested: OFFICIAL_MODELS.filter(m => m.family === 'glm').map(m => m.upstreamModel), console: 'https://open.bigmodel.cn' },
 zai: { name: 'Z.ai GLM（国际）', base_url: 'https://api.z.ai/api/paas/v4', family: 'glm', region: '海外', suggested: OFFICIAL_MODELS.filter(m => m.family === 'glm').map(m => m.upstreamModel), console: 'https://z.ai' }
});
export const OFFICIAL_HOSTS = Object.values(OFFICIAL_VENDORS).map(v => new URL(v.base_url).hostname);
// Vendors whose official API may back up KerAPI for employee traffic (mainland only), and which of our models each can serve.
export const STANDBY_VENDORS = Object.freeze(['deepseek', 'zhipu']);
const standbyCandidates = v => OFFICIAL_MODELS.filter(m => m.upstream === 'kerapi' && m.family === v.family).map(m => ({ id: m.id, name: m.name, kerapi_model: m.upstreamModel }));
const vendorOf = name => Object.entries(OFFICIAL_VENDORS).find(([, v]) => v.name === name)?.[0] || null;

async function readBody(response, limit = 262144) {
 const reader = response.body?.getReader(); if (!reader) return '';
 const chunks = []; let size = 0;
 try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) throw Error('RESPONSE_TOO_LARGE'); chunks.push(value); } }
 finally { reader.cancel().catch(() => {}); }
 return new TextDecoder().decode(Buffer.concat(chunks));
}

// Ask the vendor which models the key can see. A 401/403 is a bad key; anything else just means "no list", and the caller falls back to the suggested ids.
async function discoverModels(fetchImpl, baseUrl, key) {
 try {
  const response = await fetchImpl(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  const raw = await readBody(response);
  if (response.status === 401 || response.status === 403) throw new HttpError(400, `官方拒绝了这把 Key（HTTP ${response.status}），请检查后重试`);
  if (!response.ok) return { models: [], error: `列出型号失败：HTTP ${response.status}` };
  const list = (JSON.parse(raw).data || []).map(m => m?.id).filter(x => typeof x === 'string' && x.length <= 120).slice(0, 30);
  return { models: list, error: null };
 } catch (e) { if (e instanceof HttpError) throw e; return { models: [], error: '列出型号失败：' + String(e?.message || e).slice(0, 120) }; }
}

// The official supplier record (one per vendor) and its lab supplier; created on first use.
async function officialLab(db, vendorName, region, staffSubject) {
 let supplier = (await db.query("SELECT id,display_name,legal_name FROM suppliers WHERE source_type='official' AND display_name=$1 AND status<>'blocked' ORDER BY created_at LIMIT 1", [vendorName])).rows[0];
 if (!supplier) supplier = (await db.query(`INSERT INTO suppliers(legal_name,display_name,source_type,service_type,region,contact_email,reference_url,notes,next_action,created_by,owner_subject) VALUES($1,$1,'official','model_api',$2,'','',$3,'',$4,$4) RETURNING id,display_name,legal_name`, [vendorName, region, '评测专用：只作对比评测的官方参照，不给员工路由。', staffSubject])).rows[0];
 await db.query(`INSERT INTO supplier_lab_suppliers(id,name,legal_name,kind,created_by,canonical_supplier_id) VALUES($1,$2,$3,'reference',$4,$1) ON CONFLICT(canonical_supplier_id) DO NOTHING`, [supplier.id, supplier.display_name, supplier.legal_name, staffSubject]);
 const lab = (await db.query('SELECT id FROM supplier_lab_suppliers WHERE canonical_supplier_id=$1', [supplier.id])).rows[0];
 return { id: lab.id, supplier_id: supplier.id };
}

// Store an official key: official supplier record (one per vendor), reference credential, one reference endpoint per model.
// A previous live key of the same vendor is switched off, so each vendor has exactly one evaluation key.
export async function storeReferenceKey(pool, box, fetchImpl, actor, staffSubject, { vendorName, baseUrl, key, modelIds = [], region = '中国大陆' }) {
 const wanted = modelIds.map(x => text(x, '型号 ID', 120)).slice(0, 30);
 const found = await discoverModels(fetchImpl, baseUrl, key);
 const models = [...new Set([...found.models, ...wanted])];
 if (!models.length) throw new HttpError(400, (found.error || '官方没有返回型号') + '。请手动填写型号 ID');
 const result = await transaction(pool, async db => {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['compare-reference:' + vendorName]);
  const lab = await officialLab(db, vendorName, region, staffSubject);
  const fingerprint = hash(key).slice(0, 12);
  const same = (await db.query('SELECT label,disabled_at FROM supplier_lab_credentials WHERE credential_fingerprint=$1 ORDER BY created_at LIMIT 1', [fingerprint])).rows[0];
  if (same) throw new HttpError(409, `这把 Key 已经登记过（「${same.label}」${same.disabled_at ? '，已停用' : ''}）`);
  const replaced = (await db.query("UPDATE supplier_lab_credentials SET disabled_at=now() WHERE supplier_id=$1 AND disabled_at IS NULL AND purpose='default' RETURNING id,label", [lab.id])).rows;
  const label = '评测专用 ' + new Date().toISOString().slice(0, 10) + ' · ' + fingerprint.slice(0, 4);
  const credential = (await db.query('INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,label', [lab.id, label, baseUrl, box.seal({ key }), fingerprint, staffSubject])).rows[0];
  for (const model of models) await db.query(`INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_ciphertext,credential_fingerprint,created_by,supplier_id,credential_id) VALUES($1,'reference',$2,$3,NULL,$4,$5,$6,$7)`, [model.slice(0, 100), baseUrl, model, fingerprint, staffSubject, lab.id, credential.id]);
  await audit(db, actor, 'compare.reference_key_created', null, credential.id, { supplier_id: lab.supplier_id, host: new URL(baseUrl).hostname, models: models.length, replaced: replaced.map(r => r.id), purpose: 'evaluation_only' });
  return { credential_id: credential.id, label: credential.label, supplier_id: lab.supplier_id, replaced: replaced.map(r => r.label) };
 });
 return { ...result, models, discovery_error: found.error };
}

export function evalKeyRoutes(app, pool, cfg, requireStaff, fetchImpl = fetch) {
 const secret = process.env.SUPPLIER_LAB_SECRET, box = secret?.length >= 32 ? vault(secret) : null;

 app.get('/api/staff/lab/eval-keys', requireStaff, async (req, res) => {
  requireTechnical(req);
  const keys = (await pool.query(`SELECT c.id,c.label,c.base_url,c.credential_fingerprint,c.created_at,c.disabled_at,c.created_by,c.last_check_at,c.last_check_ok,c.last_check_model,c.last_check_ms,c.last_check_error,c.last_check_models,
    p.display_name AS vendor_name,coalesce(array_agg(e.model_id ORDER BY e.model_id) FILTER(WHERE e.disabled_at IS NULL),'{}') AS models
   FROM supplier_lab_credentials c JOIN supplier_lab_suppliers s ON s.id=c.supplier_id JOIN suppliers p ON p.id=s.canonical_supplier_id LEFT JOIN supplier_lab_endpoints e ON e.credential_id=c.id
   WHERE s.kind='reference' AND c.purpose='default' GROUP BY c.id,p.id ORDER BY c.created_at DESC`)).rows;
  const standby = (await pool.query(`SELECT c.id,c.label,c.base_url,c.credential_fingerprint,c.created_at,c.standby_models,p.display_name AS vendor_name FROM supplier_lab_credentials c JOIN supplier_lab_suppliers s ON s.id=c.supplier_id JOIN suppliers p ON p.id=s.canonical_supplier_id
   WHERE c.purpose='gateway_standby' AND c.disabled_at IS NULL ORDER BY c.created_at DESC`)).rows;
  const vendors = Object.entries(OFFICIAL_VENDORS).map(([vendorId, v]) => {
   const mine = keys.filter(k => k.vendor_name === v.name);
   return { id: vendorId, ...v, key: mine.find(k => !k.disabled_at) || null, retired: mine.filter(k => k.disabled_at).length,
    standby: STANDBY_VENDORS.includes(vendorId) ? { key: standby.find(k => k.vendor_name === v.name) || null, models: standbyCandidates(v) } : null };
  });
  const other = keys.filter(k => !vendorOf(k.vendor_name) && !k.disabled_at);
  res.json({ ready: Boolean(box), vendors, other });
 });

 app.post('/api/staff/lab/eval-keys', requireStaff, async (req, res) => {
  requireTechnical(req);
  if (!box) throw new HttpError(503, '验收加密服务未配置');
  const b = req.body || {}, vendor = OFFICIAL_VENDORS[b.vendor];
  if (!vendor) throw new HttpError(400, '请选择官方厂商');
  const key = text(b.api_key, 'API Key', 1000); if (/\s/.test(key)) throw new HttpError(400, 'API Key 不可包含空白字符');
  const modelIds = Array.isArray(b.model_ids) && b.model_ids.length ? b.model_ids : vendor.suggested;
  const result = await storeReferenceKey(pool, box, fetchImpl, req.actor, req.staff.subject, { vendorName: vendor.name, baseUrl: vendor.base_url, key, modelIds, region: vendor.region });
  res.status(201).json({ vendor: b.vendor, ...result });
 });

 // Gateway standby key (docs/14-gateway-settings.md F5): a separate official key, never the evaluation key. Staff map each of
 // our models to the official model id confirmed for it (模型身份 comparison); unmapped models get no standby line.
 app.post('/api/staff/lab/standby-keys', requireStaff, async (req, res) => {
  requireTechnical(req);
  if (!box) throw new HttpError(503, '验收加密服务未配置');
  const b = req.body || {}, vendorId = STANDBY_VENDORS.includes(b.vendor) ? b.vendor : null, vendor = vendorId && OFFICIAL_VENDORS[vendorId];
  if (!vendor) throw new HttpError(400, '网关备用只支持 DeepSeek 官方和智谱 GLM（国内）');
  const key = text(b.api_key, 'API Key', 1000); if (/\s/.test(key)) throw new HttpError(400, 'API Key 不可包含空白字符');
  const ours = new Map(standbyCandidates(vendor).map(m => [m.id, m])), wanted = Object.entries(b.models && typeof b.models === 'object' ? b.models : {})
   .map(([ourId, official]) => [ourId, typeof official === 'string' ? official.trim() : '']).filter(([, official]) => official);
  for (const [ourId] of wanted) if (!ours.has(ourId)) throw new HttpError(400, `${ourId} 不是这家厂商能备用的型号`);
  if (!wanted.length) throw new HttpError(400, '至少填一个型号的官方型号 ID');
  const found = await discoverModels(fetchImpl, vendor.base_url, key);
  // When the vendor lists its models, every mapped id must be one of them (matched without regard to case).
  const listed = new Map(found.models.map(m => [m.toLowerCase(), m]));
  const models = Object.fromEntries(wanted.map(([ourId, official]) => {
   const id_ = text(official, '官方型号 ID', 120);
   if (listed.size && !listed.has(id_.toLowerCase())) throw new HttpError(400, `官方型号列表里没有 ${id_}（${ours.get(ourId).name}）。官方返回：${[...listed.values()].slice(0, 12).join('、')}`);
   return [ourId, listed.get(id_.toLowerCase()) || id_];
  }));
  const result = await transaction(pool, async db => {
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['gateway-standby:' + vendor.name]);
   const lab = await officialLab(db, vendor.name, vendor.region, req.staff.subject);
   const fingerprint = hash(key).slice(0, 12);
   const same = (await db.query('SELECT label,purpose FROM supplier_lab_credentials WHERE credential_fingerprint=$1 ORDER BY created_at LIMIT 1', [fingerprint])).rows[0];
   if (same) throw new HttpError(409, same.purpose === 'default' && same.label.startsWith('评测专用') ? '这是评测 Key。网关备用要用另一把：请在官方控制台新建一把 Key 再贴进来' : `这把 Key 已经登记过（「${same.label}」）`);
   const replaced = (await db.query("UPDATE supplier_lab_credentials SET disabled_at=now() WHERE supplier_id=$1 AND purpose='gateway_standby' AND disabled_at IS NULL RETURNING id,label", [lab.id])).rows;
   const label = '网关备用 ' + new Date().toISOString().slice(0, 10) + ' · ' + fingerprint.slice(0, 4);
   const credential = (await db.query("INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by,purpose,standby_models) VALUES($1,$2,$3,$4,$5,$6,'gateway_standby',$7) RETURNING id,label", [lab.id, label, vendor.base_url, box.seal({ key }), fingerprint, req.staff.subject, models])).rows[0];
   await audit(db, req.actor, 'gateway.standby_key_added', null, credential.id, { vendor: vendorId, host: new URL(vendor.base_url).hostname, models, replaced: replaced.map(r => r.id) });
   return { credential_id: credential.id, label: credential.label, replaced: replaced.map(r => r.label) };
  });
  res.status(201).json({ vendor: vendorId, models, discovery_error: found.error, ...result });
 });

 app.post('/api/staff/lab/standby-keys/:id/disable', requireStaff, async (req, res) => {
  requireTechnical(req); const credentialId = id(req.params.id);
  await transaction(pool, async db => {
   const r = await db.query("UPDATE supplier_lab_credentials SET disabled_at=now() WHERE id=$1 AND purpose='gateway_standby' AND disabled_at IS NULL RETURNING id", [credentialId]);
   if (!r.rowCount) throw new HttpError(404, '网关备用 Key 不存在或已停用');
   await audit(db, req.actor, 'gateway.standby_key_disabled', null, credentialId);
  });
  res.json({ ok: true });
 });

 app.post('/api/staff/lab/eval-keys/:id/disable', requireStaff, async (req, res) => {
  requireTechnical(req); const credentialId = id(req.params.id);
  await transaction(pool, async db => {
   const r = await db.query("UPDATE supplier_lab_credentials c SET disabled_at=now() FROM supplier_lab_suppliers s WHERE s.id=c.supplier_id AND s.kind='reference' AND c.purpose='default' AND c.id=$1 AND c.disabled_at IS NULL RETURNING c.id", [credentialId]);
   if (!r.rowCount) throw new HttpError(404, '评测 Key 不存在或已停用');
   await audit(db, req.actor, 'compare.reference_key_disabled', null, credentialId);
  });
  res.json({ ok: true });
 });
}
