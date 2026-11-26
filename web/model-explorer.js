/* Public discovery and model cards. Account permissions are checked in the workspace. */
(() => {
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon=name=>`<span data-icon="${name}"></span>`;
 const catalog=()=>window.SemiflyModels||[],rate=m=>m.price.kind==='timed'?m.price.offpeak:m.price.standard,money=n=>window.SemiflyPrice.formatRate(n);
 const thinking=m=>({switchable:'默认开启，可关闭',always:'始终开启',none:'不支持'}[m.thinking]||'未确认');
 const input=m=>(m.capabilities?.input||['text']).map(x=>({text:'文本',image:'图片',video:'视频',audio:'音频',file:'文件'}[x]||x)).join('、');
 const profiles={
  'deepseek-flash':{fit:'日常写作、代码辅助，以及需要在思考和直接回答之间切换的任务。',limits:'图片理解与生成图片是不同能力；此型号输出文本。复杂任务请给思考和最终回答预留足够的输出预算。',prompt:'检查这段代码的边界条件，给出最小修改和验证方法。'},
  'deepseek-flash-0910':{fit:'已有任务使用 0910 版本时，可保留它作为回归比较对象。',limits:'0910 是供应商标注的版本；不要仅凭名称推断它与当前官方 Flash 的所有行为一致。用同一批任务核对结果。',prompt:'使用与当前 Flash 相同的提示词，比较格式遵循、工具参数和最终结果。'},
  'deepseek-v4-pro':{fit:'可作为复杂分析、多步推理和代码任务的候选型号。',limits:'当前目录按官方资料列出；平台尚无本型号的实测结论。只接受文本，使用前先检查工作台是否开放。',prompt:'分析这个多约束问题，列出假设、推导过程与可能失败的边界。'},
  'glm-5.3':{fit:'长文本分析、多步推理，以及需要持续调用工具的代码任务。',limits:'只接受文本，思考不可关闭。短回答也需要给思考留出预算；官方上下文长度并不代表任务效果已验证。',prompt:'阅读需求与现有实现，给出可分阶段执行的修改方案和验收条件。'},
  'glm-5.3-flash':{fit:'可优先纳入日常任务和图像理解的成本比较。',limits:'始终思考，可调整思考强度。平台目前确认的输入为文本和图片，官方其他输入能力不等于此线路已支持。',prompt:'读出这张截图中的关键信息，用指定的 JSON 字段返回，不确定的项留空。'},
  'glm-5.3-flashx':{fit:'可与 Flash 使用同一组任务，比较成本、响应时间和结果质量。',limits:'不要从型号名称直接推断实际速度。始终思考；平台目前确认文本和图片输入，延迟取决于实际线路和任务。',prompt:'用与 Flash 相同的输入测试，记录耗时、Token 数、输出正确性和格式遵循。'}
 };
 let selected=new Set(),isOpen=()=>false;
 function status(m){return isOpen(m)?'线路已接通':'可用性以工作台为准';}
 function render(models,open,family){
  isOpen=open;
  const query=document.getElementById('model-search').value.trim().toLowerCase(),use=document.getElementById('model-use').value;
  const list=models.filter(m=>(family==='all'||family===m.family)&&(use==='all'||m.uses.includes(use))&&`${m.name} ${m.upstreamId} ${m.description} ${m.tags.join(' ')}`.toLowerCase().includes(query));
  document.getElementById('model-grid').innerHTML=list.length?list.map(m=>`<article class="mx-model"><div class="mx-model-copy"><div class="mx-model-meta"><span>${m.family==='deepseek'?'DeepSeek':'智谱 GLM'}</span><span>${status(m)}</span></div><h2><a href="#market/${esc(m.id)}">${esc(m.name)}</a></h2><p>${esc(m.description)}</p><div class="mx-facts"><span>${input(m)}输入</span><span>${esc(m.context)} 上下文</span><span>${m.thinking==='always'?'始终思考':'思考可选'}</span></div></div><div class="mx-model-side"><dl><div><dt>输入未命中</dt><dd>${money(rate(m).miss)}</dd></div><div><dt>输出</dt><dd>${money(rate(m).output)}</dd></div></dl><small>${m.price.kind==='timed'?'空闲时段 · 高峰另计':'标准 API 价格'}</small><div class="mx-model-actions"><label><input type="checkbox" data-compare-model="${esc(m.id)}" aria-label="对比 ${esc(m.name)}" ${selected.has(m.id)?'checked':''}>对比</label><a href="#market/${esc(m.id)}">了解模型 ${icon('arrow-right')}</a></div></div></article>`).join(''):'<div class="mx-empty"><h2>没有匹配的模型</h2><p>换个关键词，或清除筛选。</p><button data-action="reset-catalog">清除筛选</button></div>';
  document.querySelector('.count-badge').textContent=list.length;
  document.querySelectorAll('#market-browse [data-family]').forEach(b=>{b.classList.toggle('active',b.dataset.family===family);b.setAttribute('aria-pressed',String(b.dataset.family===family));});
  renderCompare();
  if(location.hash.startsWith('#market/'))route(location.hash.slice(8),open);
 }
 function renderCompare(){
  const models=catalog().filter(m=>selected.has(m.id)),bar=document.getElementById('model-compare-bar'),target=document.getElementById('model-comparison');
  bar.innerHTML=models.length?`<div class="mx-compare-bar"><span>已选 ${models.length} / 3：${models.map(m=>esc(m.name)).join('、')}</span><button type="button" data-mx-compare ${models.length<2?'disabled':''}>对比模型</button><button type="button" data-mx-clear>清空</button></div>`:'';
  if(models.length<2){target.hidden=true;target.innerHTML='';return;}
  const rows=[['输入形式',input],['输出形式',()=> '文本'],['思考模式',thinking],['官方上下文',m=>m.context],['官方最大输出',m=>m.maxOutput],['平台单次输出上限',m=>Number(m.capabilities.max_output_tokens).toLocaleString('zh-CN')+' Token'],['工具调用',m=>m.capabilities.tool_calling?'支持':'未确认'],['并行工具调用',m=>m.capabilities.parallel_tool_calls?'支持':'未确认'],['JSON Schema',m=>m.capabilities.json_schema?'支持':'未确认'],['输入未命中 / 百万 Token',m=>money(rate(m).miss)],['缓存命中 / 百万 Token',m=>money(rate(m).hit)],['输出 / 百万 Token',m=>money(rate(m).output)],['价格时段',m=>m.price.kind==='timed'?'表中为空闲价；高峰 2 倍':'标准价'],['平台能力证据',m=>m.verified?'已有功能测试记录':'仅官方资料，待实测']];
  target.innerHTML=`<div class="mx-section-head"><h2>模型对比</h2><button data-mx-close>收起</button></div><div class="mx-table-scroll" tabindex="0" role="region" aria-label="模型参数比较"><table data-nosort><thead><tr><th>比较项</th>${models.map(m=>`<th><a href="#market/${esc(m.id)}">${esc(m.name)}</a></th>`).join('')}</tr></thead><tbody>${rows.map(([label,fn])=>`<tr><th scope="row">${label}</th>${models.map(m=>`<td>${esc(fn(m))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="mx-note">这里比较规格和成本；效果、速度请用同一任务实测。当前账户的可用模型以工作台为准。</p>`;
 }
 function route(id,open){
  isOpen=open;
  const browse=document.getElementById('market-browse'),detail=document.getElementById('market-detail');browse.hidden=Boolean(id);detail.hidden=!id;if(!id)return;
  const m=catalog().find(m=>m.id===id);if(!m){detail.innerHTML='<a href="#market">返回模型广场</a><h1>没有找到这个模型</h1>';return;}
  const p=profiles[m.id],c=m.capabilities;
  const specs=[['输入 / 输出',input(m)+' / 文本'],['思考模式',thinking(m)],['官方上下文',m.context],['官方最大输出',m.maxOutput],['平台单次输出上限',c.max_output_tokens.toLocaleString('zh-CN')+' Token'],['未指定输出时的默认值',c.default_max_tokens.toLocaleString('zh-CN')+' Token'],['工具调用',c.tool_calling?'支持':'未确认'],['并行工具调用',c.parallel_tool_calls?'支持':'未确认'],['结构化输出',c.json_schema?'JSON / JSON Schema':c.json_output?'JSON':'未确认']];
  detail.innerHTML=`<a class="mx-back" href="#market">${icon('arrow-left')}模型广场</a><header class="mx-detail-head"><div><p class="mx-provider">${m.family==='deepseek'?'DeepSeek':'智谱 GLM'} · ${status(m)}</p><h1>${esc(m.name)}</h1><code>${esc(m.upstreamId)}</code></div><button class="mx-primary" data-action="model-personal" data-model-id="${esc(m.id)}">在工作台使用 ${icon('arrow-right')}</button></header><p class="mx-lead">${esc(m.description)}</p>
  <nav class="mx-detail-nav" aria-label="模型详情目录"><a href="#mx-use" data-mx-section="mx-use">用途与限制</a><a href="#mx-specs" data-mx-section="mx-specs">能力与规格</a><a href="#mx-prices" data-mx-section="mx-prices">价格</a><a href="#mx-evidence" data-mx-section="mx-evidence">来源与验证</a></nav>
  <section id="mx-use" class="mx-detail-section"><h2>用途与限制</h2><div class="mx-use-grid"><div><h3>选型建议</h3><p>${esc(p.fit)}</p></div><div><h3>使用边界</h3><p>${esc(p.limits)}</p></div></div><details class="mx-example"><summary>用自己的任务试一试</summary><p>${esc(p.prompt)}</p><p class="mx-note">保持提示词、输入和参数一致，再比较正确性、用量与耗时。</p></details></section>
  <section id="mx-specs" class="mx-detail-section"><h2>能力与规格</h2><dl class="mx-specs">${specs.map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><p class="mx-note">${m.verified?'输入与工具能力按平台已有测试记录列出。':'此型号尚无平台测试，能力按目录中的官方资料列出。'}官方能力与平台接入协议、上限分别看待。</p></section>
  <section id="mx-prices" class="mx-detail-section"><div class="mx-section-head"><h2>价格</h2><span>元 / 百万 Token</span></div><div class="mx-table-scroll"><table data-nosort><thead><tr><th>时段</th><th>输入未命中</th><th>缓存命中</th><th>输出</th></tr></thead><tbody>${window.SemiflyPrice.modelRateGroups(m).map(([period,r])=>`<tr><th scope="row">${period}</th><td>${money(r.miss)}</td><td>${money(r.hit)}</td><td>${money(r.output)}</td></tr>`).join('')}</tbody></table></div><p class="mx-note">${m.price.kind==='timed'?'高峰为北京时间工作日 9:00–12:00、14:00–18:00，中国法定节假日除外。':'表中为标准 API 价格。'}账户按调用时价格计量，充值优惠在付款前确认。</p></section>
  <section id="mx-evidence" class="mx-detail-section"><h2>来源与验证</h2><p>版本：${esc(m.version)}</p><p>${m.verified?'平台目录记录：已做功能对比测试。结果只说明测试时的线路表现，不代表持续性能保证。':'平台目录记录：待接通及实测，不展示未经验证的速度或质量分数。'}</p><div class="mx-source-links"><a href="${esc(m.price.source)}" target="_blank" rel="noopener noreferrer">官方规格与价格 ${icon('arrow-up-right')}</a><a href="#realtesting">平台实测记录 ${icon('arrow-up-right')}</a><a href="#docs">接入协议与示例 ${icon('arrow-up-right')}</a></div><p class="mx-note">价格来源核对：2026-11-26。平台能力沿用现有目录记录；实际可用性以工作台为准。</p></section>`;
  document.title=`${m.name} · semifly.ai 模型广场`;
 }
 document.addEventListener('change',e=>{const id=e.target.dataset.compareModel;if(!id)return;if(e.target.checked){if(selected.size>=3){e.target.checked=false;window.showToast?.('最多同时比较 3 个模型。');return;}selected.add(id);}else selected.delete(id);renderCompare();});
 document.addEventListener('click',e=>{const b=e.target.closest('[data-mx-compare],[data-mx-clear],[data-mx-close],[data-mx-section]');if(!b)return;e.preventDefault();if(b.hasAttribute('data-mx-compare')){const section=document.getElementById('model-comparison');section.hidden=false;section.scrollIntoView({block:'start'});}else if(b.hasAttribute('data-mx-clear')){selected.clear();document.querySelectorAll('[data-compare-model]').forEach(x=>x.checked=false);renderCompare();}else if(b.hasAttribute('data-mx-close'))document.getElementById('model-comparison').hidden=true;else document.getElementById(b.dataset.mxSection)?.scrollIntoView({block:'start'});});
 window.ModelExplorer={render,route};
})();
