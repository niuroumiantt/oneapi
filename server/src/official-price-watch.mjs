// Observe DeepSeek / 智谱 public pricing pages vs OFFICIAL_MODELS. Never writes the catalog.
// Manual + ~6h schedule. Staff see diffs and decide whether to ship a catalog change.
import { createHash } from 'node:crypto';
import { HttpError, audit } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';
import { OFFICIAL_MODELS } from './official-models.mjs';
import { holidayYearsMeta, CHINA_HOLIDAYS } from './china-holidays.mjs';

export const PRICE_WATCH_INTERVAL_MS = 6 * 60 * 60 * 1000;

const DEEPSEEK_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';
const GLM_URL = 'https://docs.bigmodel.cn/cn/guide/start/pricing';

const SOURCES = [
  { id: 'deepseek', url: DEEPSEEK_URL, family: 'deepseek' },
  { id: 'glm', url: GLM_URL, family: 'glm' }
];

const norm = v => {
  const n = Number(String(v).replace(/元|,/g, '').trim());
  return Number.isFinite(n) ? String(n) : null;
};
const sameRate = (a, b) => Number(a) === Number(b);

/** Strip tags for regex parsing; keep table cell separators roughly. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(td|th|tr|p|li|h\d|br|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim();
}

export function fingerprintBody(text) {
  return createHash('sha256').update(String(text || '')).digest('hex').slice(0, 32);
}

/** DeepSeek pricing table: off-peak cache / input / output for deepseek-flash and deepseek-v4-pro. */
export function parseDeepSeekPricing(text) {
  const t = text.replace(/\s+/g, ' ');
  const peakNote = (() => {
    const m = t.match(/北京时间[^。]{10,120}法定节假日[^。]{0,80}/);
    return m ? m[0].slice(0, 240) : (t.includes('法定节假日') ? '含「法定节假日」峰谷说明' : null);
  })();
  const models = {};
  // Prefer: "deepseek-flash ... 缓存命中 … 空闲时段 0.02元 … 未命中 … 空闲时段 1元 … 输出 … 空闲时段 4元"
  // Page is columnar: flash then pro on each price row. Capture with two-number rows.
  // Official page (and our fixtures) interleave flash/pro on each price row: 空闲时段 0.02元 0.15元
  const pair = /空闲时段\s*[|｜]?\s*([\d.]+)\s*元\s*[|｜]?\s*([\d.]+)\s*元/;
  const hit = t.match(new RegExp('百万tokens输入\\s*[（(]缓存命中[）)][\\s\\S]*?' + pair.source));
  const miss = t.match(new RegExp('百万tokens输入\\s*[（(]缓存未命中[）)][\\s\\S]*?' + pair.source));
  const out = t.match(new RegExp('百万tokens输出[\\s\\S]*?' + pair.source));
  if (hit && miss && out) {
    models['deepseek-flash'] = { input: norm(miss[1]), cached: norm(hit[1]), output: norm(out[1]) };
    models['deepseek-v4-pro'] = { input: norm(miss[2]), cached: norm(hit[2]), output: norm(out[2]) };
  } else {
    // Fallback: consecutive 空闲时段 N元 pairs in document order (hit → miss → output)
    const pairs = [...t.matchAll(new RegExp(pair.source, 'g'))];
    if (pairs.length >= 3) {
      models['deepseek-flash'] = { cached: norm(pairs[0][1]), input: norm(pairs[1][1]), output: norm(pairs[2][1]) };
      models['deepseek-v4-pro'] = { cached: norm(pairs[0][2]), input: norm(pairs[1][2]), output: norm(pairs[2][2]) };
    }
  }
  return { models, peakNote, hasHolidayRule: Boolean(peakNote && /法定节假日/.test(peakNote)) };
}

/** 智谱 table rows: GLM-5.3 | 1M | input | output | 限时免费 | cached | … */
export function parseGlmPricing(text) {
  const models = {};
  // Longest names first so GLM-5.3-FlashX does not match GLM-5.3-Flash / GLM-5.3.
  const want = ['GLM-5.3-FlashX', 'GLM-5.3-Flash', 'GLM-5.3'];
  for (const name of want) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Markdown: | GLM-5.3 | 1M | 8 | 28 | 限时免费 | 2 |
    const md = text.match(new RegExp(`\\|\\s*${esc}\\s*\\|\\s*[^|\\n]*\\|\\s*([\\d.]+)\\s*\\|\\s*([\\d.]+)\\s*\\|\\s*[^|\\n]*\\|\\s*([\\d.]+)`));
    if (md) { models[name] = { input: norm(md[1]), output: norm(md[2]), cached: norm(md[3]) }; continue; }
    // HTML→text line: GLM-5.3 1M 8 28 限时免费 2 …
    const line = text.split('\n').map(l => l.trim()).find(l => new RegExp(`^\\|?\\s*${esc}(\\s|\\|)`).test(l));
    if (!line) continue;
    const nums = [...line.replace(new RegExp(`^\\|?\\s*${esc}`), '').matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map(m => m[1]);
    // Drop leading context like 1 (from 1M) when followed by more prices — keep first three price-like numbers after name.
    // Typical after stripping name: 1M → may leave 1, then 8,28,2. Prefer pattern input/output/cached near end of numeric run.
    if (nums.length >= 4 && Number(nums[0]) <= 2 && !nums[0].includes('.')) {
      models[name] = { input: norm(nums[1]), output: norm(nums[2]), cached: norm(nums[3]) };
    } else if (nums.length >= 3) {
      models[name] = { input: norm(nums[0]), output: norm(nums[1]), cached: norm(nums[2]) };
    }
  }
  return { models, peakNote: null, hasHolidayRule: false };
}

function catalogForFamily(family) {
  return OFFICIAL_MODELS.filter(m => m.family === family);
}

/** Map scraped vendor model keys onto our catalog ids. */
function scrapedRatesFor(catalogModel, scrapedModels) {
  if (catalogModel.family === 'deepseek') {
    if (catalogModel.id === 'deepseek-v4-pro') return scrapedModels['deepseek-v4-pro'];
    // flash and flash-0910 share Flash list price
    return scrapedModels['deepseek-flash'];
  }
  const key = catalogModel.name; // GLM-5.3 / GLM-5.3-Flash / GLM-5.3-FlashX
  return scrapedModels[key] || scrapedModels[catalogModel.upstreamModel];
}

export function compareCatalog(family, scraped) {
  const rows = [];
  for (const m of catalogForFamily(family)) {
    const got = scrapedRatesFor(m, scraped.models || {});
    const ours = { input: m.rates.input, cached: m.rates.cached, output: m.rates.output };
    if (!got || got.input == null || got.output == null || got.cached == null) {
      rows.push({ catalog_id: m.id, name: m.name, status: 'fetch_failed', ours, scraped: got || null, detail: '未能从官网解析出完整单价' });
      continue;
    }
    const match = sameRate(ours.input, got.input) && sameRate(ours.cached, got.cached) && sameRate(ours.output, got.output);
    rows.push({
      catalog_id: m.id, name: m.name,
      status: match ? 'match' : 'price_diff',
      ours, scraped: got,
      detail: match ? null : `官网 ${got.input}/${got.cached}/${got.output} ≠ 目录 ${ours.input}/${ours.cached}/${ours.output}`
    });
  }
  return rows;
}

export async function fetchSource(source, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(source.url, {
      redirect: 'follow',
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'User-Agent': 'semifly-official-price-watch/1.0' },
      signal: AbortSignal.timeout(30000)
    });
    const raw = await r.text();
    const text = htmlToText(raw);
    const fp = fingerprintBody(text);
    if (!r.ok) return { ...source, http_status: r.status, fingerprint: fp, text, error: `HTTP ${r.status}`, scraped: { models: {} } };
    const scraped = source.id === 'deepseek' ? parseDeepSeekPricing(text) : parseGlmPricing(text);
    return { ...source, http_status: r.status, fingerprint: fp, text, scraped, error: null };
  } catch (e) {
    return { ...source, http_status: null, fingerprint: null, text: '', error: e?.name === 'TimeoutError' ? '30 秒无响应' : String(e?.message || e).slice(0, 200), scraped: { models: {} } };
  }
}

export async function runOfficialPriceWatch(pool, { fetchImpl = fetch, trigger = 'schedule', previousFingerprints = null } = {}) {
  const started = new Date();
  const run = (await pool.query(
    `INSERT INTO official_price_watch_runs(trigger,started_at,summary) VALUES($1,$2,$3) RETURNING id`,
    [trigger, started, {}]
  )).rows[0];

  let prev = previousFingerprints;
  if (!prev) {
    const rows = (await pool.query('SELECT source_id,fingerprint FROM official_price_watch_sources')).rows;
    prev = Object.fromEntries(rows.map(r => [r.source_id, r.fingerprint]));
  }

  const sourcesOut = [];
  const comparisonsAll = [];
  let match = 0, price_diff = 0, fetch_failed = 0, page_changed = 0;

  for (const src of SOURCES) {
    const fetched = await fetchSource(src, { fetchImpl });
    let comparisons = [];
    let status = 'fetch_failed';
    if (fetched.error && !fetched.http_status) {
      fetch_failed++;
      comparisons = catalogForFamily(src.family).map(m => ({
        catalog_id: m.id, name: m.name, status: 'fetch_failed',
        ours: m.rates, scraped: null, detail: fetched.error
      }));
    } else {
      comparisons = compareCatalog(src.family, fetched.scraped);
      for (const c of comparisons) {
        if (c.status === 'match') match++;
        else if (c.status === 'price_diff') price_diff++;
        else fetch_failed++;
      }
      const changed = prev[src.id] && fetched.fingerprint && prev[src.id] !== fetched.fingerprint;
      if (changed) {
        page_changed++;
        status = 'page_changed';
        if (comparisons.every(c => c.status === 'match')) {
          // Page text changed but catalog prices still match — still flag page_changed on source.
        }
      } else if (comparisons.some(c => c.status === 'price_diff')) status = 'price_diff';
      else if (comparisons.some(c => c.status === 'fetch_failed')) status = 'fetch_failed';
      else status = 'match';

      if (src.id === 'deepseek' && fetched.scraped && fetched.scraped.hasHolidayRule === false && !fetched.error) {
        // Peak note missing 法定节假日 — surface as page/rule drift without inventing a price_diff.
        if (status === 'match') status = 'page_changed';
        page_changed++;
        comparisons.push({
          catalog_id: '_peak_rule', name: 'DeepSeek 峰谷规则',
          status: 'page_changed', ours: { note: '含中国法定节假日' }, scraped: { note: fetched.scraped.peakNote },
          detail: '官网峰谷说明未检出「法定节假日」'
        });
      }
    }

    await pool.query(
      `INSERT INTO official_price_watch_sources(source_id,url,http_status,fingerprint,fetched_at,peak_note,parsed,comparisons,status,error,last_run_id)
       VALUES($1,$2,$3,$4,now(),$5,$6,$7,$8,$9,$10)
       ON CONFLICT(source_id) DO UPDATE SET url=EXCLUDED.url,http_status=EXCLUDED.http_status,fingerprint=EXCLUDED.fingerprint,
         fetched_at=EXCLUDED.fetched_at,peak_note=EXCLUDED.peak_note,parsed=EXCLUDED.parsed,comparisons=EXCLUDED.comparisons,
         status=EXCLUDED.status,error=EXCLUDED.error,last_run_id=EXCLUDED.last_run_id`,
      [
        src.id, src.url, fetched.http_status, fetched.fingerprint,
        fetched.scraped?.peakNote || null,
        JSON.stringify(fetched.scraped?.models || {}),
        JSON.stringify(comparisons),
        status, fetched.error, run.id
      ]
    );
    sourcesOut.push({ source_id: src.id, url: src.url, status, http_status: fetched.http_status, error: fetched.error, comparisons });
    comparisonsAll.push(...comparisons);
  }

  const summary = {
    match, price_diff, fetch_failed, page_changed,
    holiday_days: CHINA_HOLIDAYS.size,
    holiday_years: holidayYearsMeta(),
    sources: sourcesOut.map(s => ({ id: s.source_id, status: s.status, http_status: s.http_status }))
  };
  await pool.query('UPDATE official_price_watch_runs SET finished_at=now(),summary=$2 WHERE id=$1', [run.id, summary]);
  return { run_id: run.id, trigger, ...summary, comparisons: comparisonsAll, sources: sourcesOut };
}

export async function officialPriceWatchView(pool) {
  const [run, sources] = await Promise.all([
    pool.query('SELECT id,trigger,started_at,finished_at,summary FROM official_price_watch_runs ORDER BY started_at DESC LIMIT 1'),
    pool.query('SELECT source_id,url,http_status,fingerprint,fetched_at,peak_note,parsed,comparisons,status,error,last_run_id FROM official_price_watch_sources ORDER BY source_id')
  ]);
  const catalog = OFFICIAL_MODELS.map(m => ({
    id: m.id, name: m.name, family: m.family, peakPricing: m.peakPricing,
    rates: m.rates, priceSource: m.priceSource
  }));
  return {
    interval_hours: PRICE_WATCH_INTERVAL_MS / 3600000,
    note: '本页只观察官网与目录差异，不自动改价；改目录需发版。',
    holidays: { days: CHINA_HOLIDAYS.size, years: holidayYearsMeta() },
    catalog,
    last_run: run.rows[0] || null,
    sources: sources.rows
  };
}

export function officialPriceWatchRoutes(app, pool, requireStaff, { fetchImpl = fetch } = {}) {
  let running = null;
  app.get('/api/staff/lab/official-prices', requireStaff, async (req, res) => {
    requireTechnical(req);
    res.json({ ...(await officialPriceWatchView(pool)), running: Boolean(running) });
  });
  app.post('/api/staff/lab/official-prices', requireStaff, async (req, res) => {
    requireTechnical(req);
    if (running) throw new HttpError(409, '检查正在进行，请稍候');
    running = runOfficialPriceWatch(pool, { fetchImpl, trigger: 'manual' }).finally(() => { running = null; });
    await audit(pool, req.actor, 'official_price_watch.run', null, null, {});
    res.json(await running);
  });
}
