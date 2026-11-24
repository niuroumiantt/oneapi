// Seed model_catalog from the hardcoded OFFICIAL_MODELS array (one-time, idempotent).
// `listed` is initialized to the current `verified` flag so nothing changes on the first deploy.
// Run: node scripts/seed_model_catalog.mjs
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { OFFICIAL_MODELS } from '../server/src/official-models.mjs';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
const pool = new pg.Pool({ connectionString: url });

async function main() {
  for (const m of OFFICIAL_MODELS) {
    await pool.query(
      `INSERT INTO model_catalog
        (id,name,family,subtitle,description,version,upstream,upstream_model,aliases,rates,peak_pricing,tags,uses,caps,price_source,verified,listed,detection_verdict)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET
        name=EXCLUDED.name,family=EXCLUDED.family,subtitle=EXCLUDED.subtitle,description=EXCLUDED.description,
        version=EXCLUDED.version,upstream=EXCLUDED.upstream,upstream_model=EXCLUDED.upstream_model,aliases=EXCLUDED.aliases,
        rates=EXCLUDED.rates,peak_pricing=EXCLUDED.peak_pricing,tags=EXCLUDED.tags,uses=EXCLUDED.uses,caps=EXCLUDED.caps,
        price_source=EXCLUDED.price_source,verified=EXCLUDED.verified,updated_at=now()`,
      [
        m.id, m.name, m.family, m.subtitle || '', m.description || '', m.version || '',
        m.upstream || '', m.upstreamModel || '', m.aliases || [],
        JSON.stringify(m.rates), m.peakPricing || false, m.tags || [], m.uses || [],
        JSON.stringify(m.caps), m.priceSource || '', m.verified || false, m.verified || false,
        m.verified ? 'ok' : 'pending'
      ]
    );
    console.log('seeded', m.id, 'listed=', m.verified || false);
  }
  await pool.end();
  console.log('done');
}
main().catch(e => { console.error(e); process.exit(1); });
