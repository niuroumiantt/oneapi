// Model catalog management for the technical console.
// Two tabs:
//   Tab 1 接入并检测 — register a vendor endpoint, probe its /models list (latency), register discovered models as candidates.
//   Tab 2 管理模型广场 — list candidates, flip the independent `listed` online/offline switch.
// The catalog is now an operational table (model_catalog), seeded from the old hardcoded OFFICIAL_MODELS.
import { costSafeFetch } from './output-guard.mjs';
import { HttpError, audit, id, text, vault } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { validateLabBaseUrl } from './supplier-lab.mjs';

async function readLimited(response) {
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 262144) throw Error('RESPONSE_TOO_LARGE'); chunks.push(value); }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } finally { reader.cancel().catch(() => {}); }
}

// ---- shared read for the gateway / model market ----
// Which catalog models are currently listed (online). Cached for 60s.
// Safety: if the catalog table is empty (not yet seeded), return null to signal
// "no listing data — do NOT filter", so nothing flips offline on an empty table.
const listingCache = { at: 0, ids: null };
export async function listedIds(pool) {
  if (Date.now() - listingCache.at < 60000) return listingCache.ids;
  const { rows } = await pool.query('SELECT id FROM model_catalog WHERE listed');
  // Empty table = not seeded = treat as "everything stays as-is".
  const total = (await pool.query('SELECT count(*)::int AS n FROM model_catalog')).rows[0].n;
  listingCache.at = Date.now();
  listingCache.ids = total === 0 ? null : new Set(rows.map(r => r.id));
  return listingCache.ids;
}

// A vendor endpoint with a live key we can probe.
async function probeEndpoints(pool) {
  return (await pool.query(`SELECT e.id,e.label,e.base_url,e.model_id,e.kind,s.canonical_supplier_id AS supplier_id,
      s.name AS supplier_name, c.id AS credential_id, c.credential_ciphertext, c.credential_fingerprint
    FROM supplier_lab_endpoints e
    JOIN supplier_lab_credentials c ON c.id=e.credential_id
    JOIN supplier_lab_suppliers s ON s.id=e.supplier_id
    WHERE e.disabled_at IS NULL AND c.disabled_at IS NULL AND s.disabled_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM suppliers p WHERE p.id=s.canonical_supplier_id AND p.status='blocked')
    ORDER BY e.created_at DESC LIMIT 200`)).rows;
}

export function modelCatalogRoutes(app, pool, cfg, requireStaff, fetchImpl = fetch) {
  fetchImpl = costSafeFetch(pool, fetchImpl);
  const secret = process.env.SUPPLIER_LAB_SECRET, box = secret?.length >= 32 ? vault(secret) : null;
  const access = req => { requireTechnical(req); };

  // ---- Tab 2: list catalog models with their listed state + detection verdict ----
  app.get('/api/staff/catalog/models', requireStaff, async (req, res) => {
    access(req);
    const rows = (await pool.query(`SELECT id,name,family,subtitle,description,version,upstream,upstream_model,aliases,rates,peak_pricing,tags,uses,caps,price_source,verified,listed,detection_verdict,detected_at,listed_at,listed_by,created_at,updated_at
      FROM model_catalog ORDER BY family, id`)).rows;
    res.json({ models: rows.map(r => ({ ...r, rates: r.rates || {}, caps: r.caps || {} })) });
  });

  // ---- Tab 2: flip the online/offline switch ----
  async function setListed(req, listed) {
    access(req);
    const modelId = id(req.params.id);
    const row = (await pool.query('SELECT id,name FROM model_catalog WHERE id=$1', [modelId])).rows[0];
    if (!row) throw new HttpError(404, '模型不存在');
    await pool.query('UPDATE model_catalog SET listed=$2, listed_at=CASE WHEN $2 THEN now() ELSE listed_at END, listed_by=$3, updated_at=now() WHERE id=$1', [modelId, listed, req.staff.subject]);
    await audit(pool, req.actor, listed ? 'catalog.model_listed' : 'catalog.model_unlisted', null, modelId, { name: row.name });
    res.json({ ok: true, id: modelId, listed });
  }
  app.post('/api/staff/catalog/models/:id/list', requireStaff, (req, res) => setListed(req, true));
  app.post('/api/staff/catalog/models/:id/unlist', requireStaff, (req, res) => setListed(req, false));

  // ---- Tab 1: list probeable endpoints + probe history ----
  app.get('/api/staff/catalog/endpoints', requireStaff, async (req, res) => {
    access(req);
    const endpoints = await probeEndpoints(pool);
    const probes = (await pool.query(`SELECT id,endpoint_id,discovered_model_ids,latency_ms,status,note,created_by,created_at FROM model_catalog_probes ORDER BY created_at DESC LIMIT 50`)).rows;
    res.json({ ready: Boolean(box), endpoints: endpoints.map(e => ({ id: e.id, label: e.label, base_url: e.base_url, model_id: e.model_id, kind: e.kind, supplier_id: e.supplier_id, supplier_name: e.supplier_name })), probes });
  });

  // ---- Tab 1: probe a vendor endpoint's /models list ----
  app.post('/api/staff/catalog/endpoints/:id/probe', requireStaff, async (req, res) => {
    access(req);
    if (!box) throw new HttpError(503, '凭据加密密钥尚未配置');
    const endpointId = id(req.params.id);
    const e = (await probeEndpoints(pool)).find(x => x.id === endpointId);
    if (!e) throw new HttpError(404, '端点不存在或已停用');
    const key = box.open(e.credential_ciphertext).key;
    const base = validateLabBaseUrl(e.base_url);
    const started = performance.now();
    let models = [], status = 'ok', note = '';
    try {
      const resp = await fetchImpl(base + '/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
      const data = await readLimited(resp);
      models = (Array.isArray(data?.data) ? data.data : []).map(m => String(m?.id || '')).filter(Boolean).slice(0, 200);
      if (!models.length) { status = 'failed'; note = '原厂 /models 未返回任何模型'; }
    } catch (err) {
      status = 'failed'; note = String(err?.message || err).slice(0, 200);
    }
    const latency = Math.round(performance.now() - started);
    const probe = (await pool.query(`INSERT INTO model_catalog_probes(endpoint_id,discovered_model_ids,latency_ms,status,note,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at`, [endpointId, models, status === 'ok' ? latency : null, status, note, req.staff.subject])).rows[0];
    await audit(pool, req.actor, 'catalog.probe', null, probe.id, { endpoint_id: endpointId, models, latency_ms: latency, status });
    res.json({ ok: status === 'ok', probe_id: probe.id, models, latency_ms: latency, status, note });
  });

  // ---- Tab 1: register probed models into the catalog as candidates (listed=false) ----
  app.post('/api/staff/catalog/register', requireStaff, async (req, res) => {
    access(req);
    const b = req.body || {};
    const modelIds = Array.isArray(b.model_ids) ? [...new Set(b.model_ids.map(String))].filter(Boolean) : [];
    if (!modelIds.length) throw new HttpError(400, '请选择要登记的模型');
    const endpointId = b.endpoint_id ? id(b.endpoint_id) : null;
    const endpoint = endpointId ? (await probeEndpoints(pool)).find(x => x.id === endpointId) : null;
    const created = [];
    for (const mid of modelIds) {
      // A catalog id must be url/slug-safe; derive a slug from the upstream id when it is not already.
      const slug = /^[a-z0-9][a-z0-9-]{0,79}$/.test(mid) ? mid : 'probe-' + id('x').slice(0, 60);
      const exists = (await pool.query('SELECT 1 FROM model_catalog WHERE id=$1', [slug])).rowCount;
      if (exists) continue;
      const row = (await pool.query(`INSERT INTO model_catalog(id,name,family,upstream,upstream_model,aliases,listed,verified,detection_verdict,detected_at)
        VALUES($1,$2,'',CASE WHEN $3::text IS NULL THEN '' ELSE 'kerapi' END,$4,$5,false,false,'pending',now()) RETURNING id,name`, [slug, mid.slice(0, 120), endpoint?.base_url || null, mid, [mid]])).rows[0];
      created.push(row);
    }
    await audit(pool, req.actor, 'catalog.register', null, null, { model_ids: modelIds, registered: created.length });
    res.json({ ok: true, created: created.length, models: created });
  });
}
