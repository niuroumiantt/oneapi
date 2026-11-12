import test from 'node:test';
import assert from 'node:assert/strict';
import { PROBES, checkAnswer, extractAnswer, similarity, summarize, vendorOf, periodOf } from '../src/model-identity.mjs';

test('answers are read from the last 答案 line and checked by rule', () => {
 assert.equal(extractAnswer('先算一下……\n答案：100\n不对，重算\n答案： **14,361,053**'), '14,361,053');
 assert.equal(checkAnswer('q_mul', '答案：14,361,053').correct, true, 'thousands separators are fine for numbers');
 assert.equal(checkAnswer('q_jssort', '答案：[1, 10, 100, 25, 3]').correct, true, 'array commas kept');
 assert.equal(checkAnswer('q_jssort', '答案：[1, 3, 10, 25, 100]').correct, false, 'numeric sort is the trap');
 assert.equal(checkAnswer('q_weekday', '答案：星期五。').correct, true);
 assert.equal(checkAnswer('q_logic', '答案：ＣＥＡＤＢ').correct, true, 'full-width letters');
 assert.equal(checkAnswer('q_pool', '\\boxed{36/7}').correct, true, 'no 答案 line: last line, boxed unwrapped');
 for (const p of PROBES.filter(x => x.kind === 'bench')) assert.equal(checkAnswer(p.id, '答案：' + p.answer).correct, true, p.id + ' accepts its own key');
});

test('vendor, similarity and peak hours', () => {
 assert.equal(vendorOf('我是 DeepSeek，由深度求索公司开发。'), 'deepseek'); assert.equal(vendorOf('我是智谱 AI 训练的 GLM 模型'), 'glm'); assert.equal(vendorOf('我是通义千问'), 'qwen'); assert.equal(vendorOf('我是一个 AI 助手'), null);
 assert.equal(similarity('今天天气很好', '今天天气很好'), 1); assert.ok(similarity('今天天气很好', '明天可能下雨') < 0.2);
 assert.equal(periodOf('2026-11-12T02:00:00Z'), 'peak', 'Thursday 10:00 Beijing'); assert.equal(periodOf('2026-11-12T15:00:00Z'), 'off', '23:00 Beijing'); assert.equal(periodOf('2026-11-14T02:00:00Z'), 'off', 'Saturday');
});

const side = (o = {}) => ({ http: 200, content: '好', prompt_tokens: 10, completion_tokens: 5, finish: 'stop', ...o });
const items = (tokOffset, benchWrong, selfText = '我是 GLM，由智谱开发') => [
 ...['tok_zh', 'tok_en', 'tok_code', 'tok_num', 'tok_rare'].map((p, i) => ({ probe: p, official: side({ prompt_tokens: 40 + i * 9 }), ours: side({ prompt_tokens: 40 + i * 9 + (typeof tokOffset === 'function' ? tokOffset(i) : tokOffset) }) })),
 { probe: 'self', official: side({ content: '我是智谱 GLM' }), ours: side({ content: selfText }) },
 { probe: 'sim_tcp', official: side({ content: 'TCP 三次握手是建立连接的过程' }), official2: side({ content: 'TCP 三次握手是建立连接的过程' }), ours: side({ content: 'TCP 三次握手是建立连接的过程' }) },
 ...PROBES.filter(p => p.kind === 'bench').map((p, i) => ({ probe: p.id, official: side({ correct: true, answer: p.answer, completion_tokens: 900 }), ours: side({ correct: i >= benchWrong, answer: i >= benchWrong ? p.answer : '?', completion_tokens: 880 }) }))
];

test('same model: tokenizer matches, scores level, verdict ok', () => {
 const s = summarize(items(0, 0), 'glm');
 assert.equal(s.verdict, 'ok', JSON.stringify(s.reasons)); assert.equal(s.tokenizer.status, 'match'); assert.equal(s.self.status, 'same'); assert.equal(s.similar.status, 'close'); assert.equal(s.bench.n, 20); assert.equal(s.bench.gap, 0);
});
test('a constant extra on every request means hidden text, not another model', () => {
 const s = summarize(items(23, 0), 'glm'); assert.equal(s.tokenizer.status, 'offset'); assert.equal(s.tokenizer.offset, 23); assert.equal(s.verdict, 'watch');
});
test('another tokenizer, another vendor or a lower score is a suspect', () => {
 assert.equal(summarize(items(i => i * 4, 0), 'glm').tokenizer.status, 'differ');
 assert.equal(summarize(items(i => i * 4, 0), 'glm').verdict, 'suspect');
 assert.equal(summarize(items(0, 0, '我是通义千问，由阿里云开发'), 'glm').self.status, 'other');
 const low = summarize(items(0, 4), 'glm'); assert.equal(low.bench.status, 'suspect'); assert.equal(low.bench.ours, 16); assert.equal(low.verdict, 'suspect');
 assert.equal(summarize(items(0, 2), 'glm').bench.status, 'watch');
});
test('cut or failed answers are left out of the score on both sides', () => {
 const xs = items(0, 0); xs.find(x => x.probe === 'q_mul').ours.finish = 'length'; xs.find(x => x.probe === 'q_mod').official = { error: 'HTTP 429' };
 const s = summarize(xs, 'glm'); assert.equal(s.bench.n, 18); assert.equal(s.bench.skipped, 2); assert.equal(s.bench.rows.find(r => r.id === 'q_mul').ours.state, 'cut');
});
