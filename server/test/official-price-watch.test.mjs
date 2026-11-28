import test from 'node:test';
import assert from 'node:assert/strict';
import { CHINA_HOLIDAYS, mergeHolidays, holidayYearsMeta } from '../src/china-holidays.mjs';
import { officialPeak } from '../src/official-models.mjs';
import { parseDeepSeekPricing, parseGlmPricing, compareCatalog, htmlToText } from '../src/official-price-watch.mjs';

const DEEPSEEK_FIXTURE = `
模型 & 价格
| 模型 | deepseek-flash (1) | deepseek-v4-pro |
| 价格 (2) | 百万tokens输入 （缓存命中） | 空闲时段 | 0.02元 | 0.15元 |
| | | 高峰时段 | 0.04元 | 0.30元 |
| | 百万tokens输入 （缓存未命中） | 空闲时段 | 1元 | 4.5元 |
| | | 高峰时段 | 2元 | 9.0元 |
| | 百万tokens输出 | 空闲时段 | 4元 | 13.5元 |
| | | 高峰时段 | 8元 | 27.0元 |
(2) 空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。
`;

const GLM_FIXTURE = `
| 模型名称 | 上下文 | 输入单价（元/百万 Tokens） | 输出单价（元/百万 Tokens） | 缓存存储（元/百万 Tokens/小时） | 缓存命中（元/百万 Tokens） |
| GLM-5.3 | 1M | 8 | 28 | 限时免费 | 2 |
| GLM-5.3-Flash | 1M | 0.8 | 2.8 | 限时免费 | 0.23 |
| GLM-5.3-FlashX | 1M | 2 | 7 | 限时免费 | 0.57 |
`;

test('china holidays cover 2026–2027 weekday holidays and leave makeup weekends off-peak', () => {
  assert.ok(CHINA_HOLIDAYS.has('2026-01-01') && CHINA_HOLIDAYS.has('2026-10-05'));
  assert.ok(CHINA_HOLIDAYS.has('2027-02-05') && CHINA_HOLIDAYS.has('2027-09-15'));
  assert.equal(officialPeak(new Date('2026-05-01T02:00:00Z'), CHINA_HOLIDAYS), false);
  assert.equal(officialPeak(new Date('2027-06-09T06:00:00Z'), CHINA_HOLIDAYS), false);
  assert.equal(officialPeak(new Date('2026-05-09T02:00:00Z'), CHINA_HOLIDAYS), false, 'makeup Saturday');
  assert.equal(officialPeak(new Date('2026-11-11T02:00:00Z'), CHINA_HOLIDAYS), true);
  const merged = mergeHolidays(['2099-01-01']);
  assert.ok(merged.has('2026-10-01') && merged.has('2099-01-01'));
  assert.deepEqual(holidayYearsMeta().map(y => y.year), [2026, 2027]);
});

test('DeepSeek fixture parses off-peak rates and holiday peak note', () => {
  const p = parseDeepSeekPricing(DEEPSEEK_FIXTURE);
  assert.equal(p.hasHolidayRule, true);
  assert.match(p.peakNote, /法定节假日/);
  assert.deepEqual(p.models['deepseek-flash'], { input: '1', cached: '0.02', output: '4' });
  assert.deepEqual(p.models['deepseek-v4-pro'], { input: '4.5', cached: '0.15', output: '13.5' });
  const rows = compareCatalog('deepseek', p);
  assert.ok(rows.every(r => r.status === 'match'), JSON.stringify(rows));
});

test('GLM fixture parses catalog rates; price_diff when input changes', () => {
  const p = parseGlmPricing(GLM_FIXTURE);
  assert.deepEqual(p.models['GLM-5.3'], { input: '8', output: '28', cached: '2' });
  assert.deepEqual(p.models['GLM-5.3-Flash'], { input: '0.8', output: '2.8', cached: '0.23' });
  assert.deepEqual(p.models['GLM-5.3-FlashX'], { input: '2', output: '7', cached: '0.57' });
  assert.ok(compareCatalog('glm', p).every(r => r.status === 'match'));
  const bumped = { models: { ...p.models, 'GLM-5.3': { input: '9', output: '28', cached: '2' } } };
  const diff = compareCatalog('glm', bumped).find(r => r.catalog_id === 'glm-5.3');
  assert.equal(diff.status, 'price_diff');
});

test('htmlToText keeps table numbers for DeepSeek-like markup', () => {
  const html = '<table><tr><td>百万tokens输入 （缓存命中）</td><td>空闲时段</td><td>0.02元</td><td>0.15元</td></tr></table>';
  assert.match(htmlToText(html), /0\.02元/);
});

test('GLM HTML table cells parse without merging adjacent model names', () => {
 const text=htmlToText('<table><tr><td>GLM-5.3-Flash</td><td>1M</td><td>0.8</td><td>2.8</td><td>限时免费</td><td>0.23</td></tr></table>');
 assert.deepEqual(parseGlmPricing(text).models['GLM-5.3-Flash'],{input:'0.8',output:'2.8',cached:'0.23'});
 assert.equal(parseGlmPricing(text).models['GLM-5.3'],undefined);
});

test('public feed exposes only featured models, observed prices, freshness and holiday-aware period', async () => {
 const {publicOfficialPrices}=await import('../src/official-price-watch.mjs');
 const now=new Date('2026-11-27T02:00:00Z');
 const sources=[{source_id:'glm',http_status:200,fetched_at:now,parsed:{'GLM-5.3':{input:'9',cached:'2',output:'28'}},error:null,secret:'must not leak'}];
 const feed=publicOfficialPrices(sources,now);
 assert.deepEqual(feed.models.map(m=>m.id),['deepseek-flash','glm-5.3','glm-5.3-flash']);
 assert.equal(feed.models[1].rates.miss,9);
 assert.equal(feed.models[1].status,'fresh');
 assert.equal(feed.models[0].rates,null);
 assert.equal(feed.current_period,'peak');
 assert.ok(!JSON.stringify(feed).includes('secret'));
 assert.equal(publicOfficialPrices(sources,new Date('2026-11-28T02:00:00Z')).models[1].status,'stale');
 assert.equal(publicOfficialPrices([],new Date('2026-10-01T02:00:00Z')).current_period,'offpeak');
 assert.equal(publicOfficialPrices([],new Date('2030-10-01T02:00:00Z')).current_period,null);
 sources[0].http_status=503;
 assert.equal(publicOfficialPrices(sources,now).models[1].rates,null);
});

test('public personal promotion uses the configured wallet discount and gateway rate basis', async () => {
 const {publicOfficialPrices}=await import('../src/official-price-watch.mjs');
 const models=['deepseek-flash','glm-5.3','glm-5.3-flash'];
 const customerPaid={models,personalCatalogModels:models,usagePrices:{'deepseek-flash':5000,'glm-5.3':10000,'glm-5.3-flash':5000}};
 const [deepseek,glm,flash]=publicOfficialPrices([],new Date(),customerPaid).models;
 assert.deepEqual(deepseek.personal_promotion,{price_bps:5000,basis:{miss:1,hit:0.02,output:4}});
 assert.equal(glm.personal_promotion,null);
 assert.deepEqual(flash.personal_promotion,{price_bps:5000,basis:{miss:0.8,hit:0.23,output:2.8}});
 assert.equal(publicOfficialPrices([]).models[0].personal_promotion,null);
});
