import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OFFICIAL_MODELS, capabilityTags, publicCapabilities, marketCatalog } from '../src/official-models.mjs';
import { catalogPath, catalogSource } from '../../scripts/build_model_catalog.mjs';

test('the 模型广场 catalog file is generated from the gateway catalog and is up to date', async () => {
 assert.equal(await readFile(catalogPath, 'utf8'), catalogSource(), 'run: node scripts/build_model_catalog.mjs');
 assert.deepEqual(marketCatalog().map(m => m.id), OFFICIAL_MODELS.map(m => m.id), 'every gateway model has a card, in the same order');
});

test('capability tags state what each model can do', () => {
 const tags = id => capabilityTags(OFFICIAL_MODELS.find(m => m.id === id));
 assert.equal(tags('deepseek-flash')[0], '默认思考 · 可关');
 assert.equal(tags('glm-5.3')[0], '始终思考');
 assert.ok(tags('glm-5.3-flash').includes('看图'));
 assert.ok(!tags('glm-5.3').includes('看图'), 'GLM-5.3 only accepts text');
 assert.ok(tags('deepseek-flash').includes('高峰 2 倍价') && !tags('glm-5.3').includes('高峰 2 倍价'));
 for (const m of OFFICIAL_MODELS) {
  assert.ok(!capabilityTags(m).includes('画图'), 'no catalog model produces images');
  const c = publicCapabilities(m, 32768);
  assert.ok(['switchable', 'always', 'none'].includes(c.thinking));
  assert.equal(c.max_output_tokens, 32768);
  assert.ok(c.input.includes('text') && c.output.includes('text'));
 }
});

test('market prices are the official rates; peak-priced models double at peak', () => {
 const flash = marketCatalog().find(m => m.id === 'deepseek-flash'), glm = marketCatalog().find(m => m.id === 'glm-5.3');
 assert.deepEqual(flash.price.offpeak, { hit: 0.02, miss: 1, output: 4 });
 assert.deepEqual(flash.price.peak, { hit: 0.04, miss: 2, output: 8 });
 assert.deepEqual(glm.price.standard, { hit: 2, miss: 8, output: 28 });
});
