/* Public test report (#realtesting): our API vs the official APIs, feature by feature, from real production runs.
   The data block below is written by scripts/realtesting_report.py from a production run; nothing is fetched at runtime. */
(() => {
 'use strict';
 const REPORT = /*REPORT-DATA*/null/*END-REPORT-DATA*/;
 let host = null;
 const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
 const handles = view => view === 'realtesting';
 const KIND = { same: ['✓', '一致', '官方能用，我们也能用'], extra: ['＋', '更多', '官方不支持，我们支持'], neither: ['—', '模型限制', '官方自己也不支持，两边一样'], gap: ['✕', '差异', '官方能用，我们不能'] };
 const date = v => { const d = new Date(v); return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`; };
 const time = v => new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

 function body(r) {
  const cells = r.models.flatMap(m => r.tests.map(t => m.cells[t.id]).filter(Boolean));
  const count = k => cells.filter(c => c.outcome === k).length, ok = count('same') + count('extra') + count('neither');
  const groups = [...new Set(r.tests.map(t => t.group))];
  const stat = (n, label, sub) => `<div class="rt-stat"><b>${n}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const hero = `<section class="rt-hero"><p class="rt-eyebrow">semifly.ai 实测报告 · ${date(r.run.finished_at)}</p><h1>我们的 API 和官方 API，<br>逐项实测对比。</h1>
   <p class="rt-lead">同一个请求，一份直接发给模型官方，一份走 semifly.ai 的 API（和用户拿到的完全一样）。以官方的实测结果为基准，看我们是否做到了官方能做到的每一件事。</p>
   <div class="rt-stats">${stat(r.models.length, '个模型', r.models.map(m => esc(m.name)).join(' · '))}${stat(r.tests.length, '项测试', groups.length + ' 类能力')}${stat(r.run.requests.toLocaleString('zh-CN'), '次真实请求', '生产环境，官方与我们各一半')}${stat(`${ok}/${cells.length}`, '与官方一致或更好', count('gap') ? `${count('gap')} 项差异，见下文` : '没有差异')}</div></section>`;

  const logic = `<section class="rt-sec" id="logic"><h2><span>01</span>测试逻辑</h2>
   <p>用户用的是 semifly.ai 的 API，请求经过我们的网关、再到上游供应商，最后到模型。这条链路上任何一环都可能改变结果：网关有没有限制，供应商有没有改写参数，模型本身支持什么。</p>
   <div class="rt-flow"><div class="rt-lane"><b>我们这一路</b><span>用户的工具</span><i>→</i><span class="em">semifly.ai 网关</span><i>→</i><span>上游供应商</span><i>→</i><span>模型</span></div><div class="rt-lane official"><b>官方这一路</b><span>同一个请求</span><i>→</i><span class="em">模型官方 API</span></div></div>
   <p>所以我们拿<b>官方 API 当尺子</b>：同一个请求、同样的参数，两边各发一次，比较结果属于哪一类：</p>
   <div class="rt-kinds">${Object.entries(KIND).map(([k, [s, n, d]]) => `<div class="rt-kind ${k}"><b>${s}</b><div><strong>${n}</strong><span>${d}</span></div></div>`).join('')}</div>
   <p class="rt-note">只有“官方能、我们不能”算问题；“官方也不支持”是模型本身的能力边界，不是链路的问题。</p></section>`;

  const method = `<section class="rt-sec" id="method"><h2><span>02</span>测试方法</h2>
   <ol class="rt-steps"><li><b>真实环境，真实计费。</b>测试在生产环境进行：我们这一路用的是给用户提供服务的同一套网关和供应商 Key；官方那一路用各厂商的官方 API Key（DeepSeek 官方、智谱 GLM 官方）。</li>
   <li><b>同一请求，两边各发一次。</b>参数完全相同，问的都是极短的测试问题，不含任何用户数据。</li>
   <li><b>${r.tests.length} 项测试，覆盖 Agent 实际依赖的能力。</b>${groups.map(g => `<span class="rt-tag">${esc(g)}</span>`).join('')}</li>
   <li><b>按结果判定，不靠人工打分。</b>每项有明确的判定条件：是否返回、流是否正常结束、有没有发起工具调用、JSON 能否解析、是否返回思考内容、截断标记是否正确、用量与缓存是否报告等。</li>
   <li><b>不稳定的项多次重跑。</b>结果在两次运行之间会变化的项，我们重复测试，确认差异真实存在后才算数。</li>
   <li><b>持续监测。</b>每 30 分钟自动检查一次每个模型：上游提供哪些模型、每个模型是否可用、是否遵守输出上限。发现变化立即告警。</li></ol>
   <details class="rt-details"><summary>全部 ${r.tests.length} 项测试分别测什么</summary><table class="rt-tests"><thead><tr><th>类别</th><th>测试</th><th>测什么</th></tr></thead><tbody>${r.tests.map(t => `<tr><td>${esc(t.group)}</td><td>${esc(t.name)}</td><td>${esc(t.hint)}</td></tr>`).join('')}</tbody></table></details></section>`;

  const modelCards = r.models.map(m => { const cs = r.tests.map(t => m.cells[t.id]).filter(Boolean), c = k => cs.filter(x => x.outcome === k).length;
   return `<div class="rt-model"><h3>${esc(m.name)}</h3><p>对照官方 <b>${esc(m.reference)}</b> · ${esc(m.vendor)}</p><div class="rt-bars"><span class="same" style="flex:${c('same')}">${c('same')}</span>${c('extra') ? `<span class="extra" style="flex:${c('extra')}">${c('extra')}</span>` : ''}${c('neither') ? `<span class="neither" style="flex:${c('neither')}">${c('neither')}</span>` : ''}${c('gap') ? `<span class="gap" style="flex:${c('gap')}">${c('gap')}</span>` : ''}</div><small>一致 ${c('same')} · 更多 ${c('extra')} · 模型限制 ${c('neither')} · 差异 ${c('gap')}</small></div>`; }).join('');
  const matrix = `<div class="rt-table-wrap"><table class="rt-matrix"><thead><tr><th>测试</th>${r.models.map(m => `<th>${esc(m.name)}<small>对照 ${esc(m.reference)}</small></th>`).join('')}</tr></thead><tbody>${groups.map(g => `<tr class="rt-group"><td colspan="${r.models.length + 1}">${esc(g)}</td></tr>` + r.tests.filter(t => t.group === g).map(t => `<tr><td>${esc(t.name)}</td>${r.models.map(m => { const c = m.cells[t.id]; if (!c) return '<td class="rt-na">·</td>'; const [s, n] = KIND[c.outcome] || ['·', '']; return `<td class="rt-c ${c.outcome}" title="${esc(`${t.name} · ${m.name}：${n}。官方：${c.official_note}；我们：${c.ours_note}`)}">${s}</td>`; }).join('')}</tr>`).join('')).join('')}</tbody></table></div>`;
  const results = `<section class="rt-sec" id="results"><h2><span>03</span>测试结果</h2><p>测试于 ${time(r.run.started_at)} 至 ${time(r.run.finished_at)} 在生产环境完成，共 ${r.run.requests.toLocaleString('zh-CN')} 次真实请求。</p><div class="rt-models">${modelCards}</div>${matrix}
   <div class="rt-legend">${Object.entries(KIND).map(([k, [s, n, d]]) => `<span><b class="rt-c ${k}">${s}</b>${n}：${d}</span>`).join('')}</div></section>`;

  const findings = `<section class="rt-sec" id="findings"><h2><span>04</span>发现与处理</h2><div class="rt-findings">${(r.findings || []).map(f => `<article class="rt-finding ${f.kind}"><span class="rt-badge">${{ fixed: '已修复', ours_better: '我们更多', model_limit: '模型限制', watching: '持续监测' }[f.kind] || ''}</span><h3>${esc(f.title)}</h3><p>${esc(f.detail)}</p></article>`).join('')}</div></section>`;
  const monitor = `<section class="rt-sec" id="monitor"><h2><span>05</span>不是一次性的测试</h2><p>上线前测一次不够：上游会更新模型、调整参数。所以这些检查一直在跑：</p><ul class="rt-list"><li><b>每 30 分钟</b>自动检查每把供应商 Key：上游实际提供哪些模型、每个模型能否调用、是否遵守输出上限。</li><li>上游<b>新增</b>了我们已定价的模型，自动上线；新增了未定价的，提醒人工上线；<b>下架</b>或不可用，立即告警。</li><li>发现上游不遵守输出上限的模型，网关自动代为截断，直到上游修复。</li><li>功能对比可以随时重跑，每次结果都带时间记录。</li></ul></section>`;
  return hero + `<nav class="rt-toc"><a href="#realtesting" data-rt-jump="logic">测试逻辑</a><a href="#realtesting" data-rt-jump="method">测试方法</a><a href="#realtesting" data-rt-jump="results">测试结果</a><a href="#realtesting" data-rt-jump="findings">发现与处理</a><a href="#realtesting" data-rt-jump="monitor">持续监测</a></nav>` + logic + method + results + findings + monitor + `<footer class="rt-foot">数据来自 ${date(r.run.finished_at)} 生产环境实测 · 测试编号 ${esc(r.run.id.slice(0, 8))} · semifly.ai</footer>`;
 }

 function render() {
  if (!host) { host = document.createElement('div'); host.id = 'realtesting-view'; document.body.append(host); }
  document.querySelectorAll('#market-view,#admin-view,#login-view,#identity-view,#landing-view,#docs-view').forEach(el => { el.hidden = true; });
  document.body.classList.remove('market-active', 'identity-active', 'welcome-active', 'universe-active', 'ops-active', 'catalog-active', 'landing-active', 'docs-active');
  document.body.classList.add('realtesting-active'); host.hidden = false;
  window.IdentityUI?.cancel?.(); window.UniverseScene?.setActive?.(false);
  host.innerHTML = `<header class="rt-top"><a class="rt-brand" href="#universe"><img src="pinapi-wordmark.svg" alt="semifly.ai"></a><span class="rt-top-title">实测报告</span><nav><a href="#docs">文档</a><a href="#market">模型广场</a>${REPORT?.pdf ? `<a class="rt-pdf" href="${esc(REPORT.pdf)}" download>下载 PDF</a>` : ''}</nav></header><main class="rt-main">${REPORT ? body(REPORT) : '<section class="rt-sec"><h1>实测报告整理中</h1></section>'}</main>`;
  document.title = 'semifly.ai · 实测报告：我们的 API vs 官方 API';
  window.scrollTo(0, 0);
 }
 function hide() { if (host) host.hidden = true; document.body.classList.remove('realtesting-active'); }
 document.addEventListener('click', e => { const j = e.target.closest('[data-rt-jump]'); if (!j) return; e.preventDefault(); document.getElementById(j.dataset.rtJump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
 window.RealTestingUI = { handles, render, hide };
})();
