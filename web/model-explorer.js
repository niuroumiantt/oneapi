/* Curated public discovery; billing and account availability remain separate. */
(() => {
 'use strict';
 const ids=['deepseek-flash','glm-5.3','glm-5.3-flash'];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon=n=>`<span data-icon="${n}" aria-hidden="true"></span>`;
 const brand=m=>m.id==='deepseek-flash'?'deepseek':'zhipu';
 const brandLogo=m=>`<img src="assets/model-brands/${brand(m)}.svg" alt="${brand(m)==='deepseek'?'DeepSeek':'智谱 BigModel'}" width="143" height="29">`;
 const profiles={
  'deepseek-flash':{label:'通用与代码',word:'Flash',lead:'日常写作、代码辅助与图像理解。',intro:'一个兼顾日常工作与开发任务的通用模型。按任务切换思考模式，从快速整理到多步分析。',scenes:[['写作与整理','整理会议记录、改写内容，提取长文中的重点。','把这份会议记录整理为决策、待办和负责人。'],['代码辅助','解释实现、检查边界条件，协助编写和修复代码。','检查这段代码的边界条件，给出最小修改与验证方法。'],['图像理解','读取截图和图表，结合文字问题提取信息。','提取截图中的关键字段，不确定的内容标记为待确认。']],limit:'支持理解图片，输出为文本；不生成图片。复杂任务请为思考和最终回答留足输出预算。'},
  'glm-5.3':{label:'复杂文本任务',word:'5.3',lead:'长文本分析、多步推理与工具协作。',intro:'面向复杂文本工作的旗舰型号。始终先思考再回答，适合把长文档、需求和多步任务放在一起处理。',scenes:[['长文分析','梳理多份文本的观点、假设和冲突，保留原文依据。','对比这两份方案，列出分歧、证据和还需要确认的问题。'],['开发规划','结合需求与现有实现，拆分修改步骤和验收条件。','阅读需求和代码，给出分阶段实施方案与验收清单。'],['工具协作','在应用提供的工具之间组织多步调用。','先检索相关记录，再汇总异常；缺失信息时不要猜测。']],limit:'仅接受文本。思考不可关闭，短回答也需要预留思考预算；长上下文上限不代表实际任务效果。'},
  'glm-5.3-flash':{label:'轻量与看图',word:'Flash',lead:'用更低的 Token 成本，处理日常任务。',intro:'面向高频文本与图像理解任务的轻量选择。支持调整思考强度，适合信息提取、内容整理和结构化输出。',scenes:[['信息提取','从截图与文字里提取字段，交给后续业务流程。','按指定 JSON 字段提取截图信息，缺失项保留为空。'],['内容整理','完成分类、摘要和改写等重复性文本任务。','将这些反馈按问题类型分类，每类用一句话概括。'],['应用助手','结合工具调用与结构化输出，接入业务应用。','根据用户需求选择可用工具，执行前确认必要参数。']],limit:'始终思考，可调整强度。平台已确认文本与图片输入；官方列出的其他输入形式需另行确认接入支持。'}
 };
 const sections=[
  ['background','模型档案','cpu'], ['scenes','应用场景','layers'],
  ['specs','能力规格','settings'], ['history','版本历史','clock'],
  ['billing','计费说明','receipt-text'], ['compare','模型对比','arrow-left-right'],
  ['price','官方价格','receipt-text']
 ];
 let compareGroup='price';let scene=0;let current=ids[0],angle='background',period='auto',open=()=>false,feed=null,loading=false;
 const catalog=()=>ids.map(id=>(window.SemiflyModels||[]).find(m=>m.id===id)).filter(Boolean);
 const money=n=>'¥'+Number(n).toLocaleString('zh-CN',{maximumFractionDigits:4});
 const observation=m=>feed?.models?.find(x=>x.id===m.id);
 function pricing(m){
  const obs=observation(m),base=obs?.rates|| (m.price.kind==='timed'?m.price.offpeak:m.price.standard);
  const live=feed && Date.now()-feed.receivedAt<120000;
  const selected=period==='auto'?(live?feed.current_period:null):period;
  const multiplier=m.price.kind==='timed'&&selected==='peak'?2:1;
  return {rates:Object.fromEntries(Object.entries(base).map(([k,v])=>[k,v*multiplier])),selected};
 }
 function pricePanel(m){
  const {rates:r,selected}=pricing(m),obs=observation(m);
  const checked=obs?.rates&&obs?.checked_at?new Date(obs.checked_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'2026-11-27';
  const freshness=obs?.rates?(obs.status==='fresh'?'官网已核对':'快照已过期，请核对官网'):'参考价 · 自动核对暂不可用';
  return `<aside class="mx-price" aria-label="官方计费"><header><div class="mx-price-heading">${icon('receipt-text')}<div><h3>官方 API 价格</h3><span>元 / 百万 Token</span></div></div><span class="mx-price-brand">${brandLogo(m)}</span></header><dl>${[['输入未命中','miss'],['缓存命中','hit'],['输出','output']].map(([label,key])=>`<div><dt><span class="mx-rate-icon">${icon({miss:'arrow-down',hit:'layers',output:'arrow-up'}[key])}</span>${label}</dt><dd>${money(r[key])}</dd></div>`).join('')}</dl>${m.price.kind==='timed'?`<div class="mx-period" aria-label="计价时段">${[['auto','当前时段'],['offpeak','空闲时段'],['peak','高峰时段']].map(([id,label])=>`<button data-mx-period="${id}" aria-pressed="${period===id}">${label}</button>`).join('')}</div><p class="mx-period-note">${period==='auto'?(selected?`北京时间 · 当前${selected==='peak'?'高峰':'空闲'}时段`:'当前时段未确认，暂列空闲参考价'):'正在查看'+(period==='peak'?'高峰':'空闲')+'时段价格'}</p>`:'<p class="mx-period-note">标准 API 价格 · 不分高峰 / 空闲</p>'}<div class="mx-price-source"><a href="${esc(m.price.source)}" target="_blank" rel="noopener noreferrer">官方计费文档 ↗</a><button data-mx-refresh ${loading?'disabled':''}>${loading?'刷新中…':'刷新价格'}</button></div><p class="mx-freshness">${freshness}<br>最近核对 ${esc(checked)} · 北京时间</p></aside>`;
 }
 function comparison(){
  const models=catalog(),background=m=>window.SemiflyModelBackground[m.id];
  const groups=[['price','官方价格'],['capabilities','能力规格'],['parameters','参数规模'],['scenarios','适用场景']];
  const rows={
   price:[['输入未命中',m=>money(pricing(m).rates.miss)],['缓存命中',m=>money(pricing(m).rates.hit)],['输出',m=>money(pricing(m).rates.output)]],
   capabilities:[['上下文 / 最大输出',m=>m.context+' / '+m.maxOutput],['平台输入',m=>m.capabilities.input.includes('image')?'文本、图片':'文本'],['思考模式',m=>m.thinking==='switchable'?'可开启 / 关闭':'始终思考'],['工具调用',m=>m.capabilities.tool_calling?'支持':'未确认'],['结构化输出',m=>m.capabilities.json_schema?'JSON Schema':'JSON']],
   parameters:[['参数口径',m=>background(m).parameters],['激活参数',m=>background(m).active],['公开权重体积',m=>background(m).weights]],
   scenarios:[['主要定位',m=>profiles[m.id].label],['场景一',m=>profiles[m.id].scenes[0][0]],['场景二',m=>profiles[m.id].scenes[1][0]],['场景三',m=>profiles[m.id].scenes[2][0]]]
  }[compareGroup];
  const timed=models.find(m=>m.price.kind==='timed'),selected=timed&&pricing(timed).selected;
  const note=compareGroup==='price'?`元 / 百万 Token · DeepSeek ${selected==='peak'?'高峰':selected==='offpeak'?'空闲':'时段未确认，空闲参考价'}；GLM 为标准价。${models.some(m=>!observation(m)?.rates)?'含参考价，请核对官网。':models.some(m=>observation(m)?.status!=='fresh')?'含过期快照，请核对官网。':'官网快照已核对。'}`:compareGroup==='parameters'?'参数统计口径不同，不直接代表性能；权重体积不等于运行显存。详见各模型档案。':compareGroup==='capabilities'?'上下文和最大输出为官方规格，其余为平台已确认能力；实际调用限制以工作台为准。':'按任务特点整理，非实测排名；选择后可在工作台验证实际效果。';
  return `<div class="mx-compare-panel"><nav class="mx-compare-groups" aria-label="对比维度">${groups.map(([id,label])=>`<button type="button" data-mx-compare="${id}" aria-pressed="${compareGroup===id}">${label}</button>`).join('')}</nav><table data-nosort aria-label="三款模型对比"><thead><tr><th scope="col">对比项目</th>${models.map(m=>`<th scope="col" class="${m.id===current?'mx-comp-selected':''}"><span class="mx-comp-logo">${brandLogo(m)}</span><span>${esc(m.name)}</span></th>`).join('')}</tr></thead><tbody>${rows.map(([label,value])=>`<tr><th scope="row">${label}</th>${models.map(m=>`<td class="${m.id===current?'mx-comp-selected':''}">${esc(value(m))}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="mx-compare-note">${note}</p></div>`;
 }
 function pane(m){
  const p=profiles[m.id],c=m.capabilities,b=window.SemiflyModelBackground[m.id];
  if(angle==='compare')return comparison();
  if(angle==='price')return pricePanel(m);
  if(angle==='background')return `<dl class="mx-specs mx-background">${[['参数规模',b.parameters,'cpu'],['激活参数',b.active,'chart-no-axes-combined'],['模型架构',b.architecture,'brain-circuit'],['公开权重体积',b.weights,'server'],['权重精度',b.precision,'settings'],['预训练数据量',b.training,'layers']].map(([k,v,i])=>`<div><dt>${icon(i)}${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><p class="mx-boundary">${b.note}</p><p class="mx-boundary">体积为官方仓库 Safetensors 文件合计（十进制 GB），不等于运行显存。B = 十亿参数；T = 万亿。<a href="${b.source}/tree/${b.revision}" target="_blank" rel="noopener">官方模型仓库 ↗</a></p>`;
  if(angle==='history')return `<div class="mx-history">${b.history.map(([date,title,body])=>`<section><small>${icon('clock')}${date}</small><h3>${title}</h3><p>${body}</p></section>`).join('')}</div><p class="mx-boundary">许可：${b.license} · 资料核对 2026-11-27。<a href="${b.historySource}" target="_blank" rel="noopener">官方版本资料 ↗</a></p>`;
  if(angle==='scenes')return `<nav class="mx-scene-tabs" aria-label="应用场景分页">${p.scenes.map(([title],i)=>`<button data-mx-scene="${i}" aria-pressed="${i===scene}">${title}</button>`).join('')}</nav><div class="mx-scenes">${p.scenes.map(([title,body,prompt],i)=>`<section class="${i===scene?'mx-scene-current':''}"><div class="mx-scene-art">${icon(['pencil-line','code-xml','layers'][i])}<span></span><span></span><span></span></div><h3>${title}</h3><p>${body}</p><small>试试这样提问</small><blockquote>${prompt}</blockquote></section>`).join('')}</div><p class="mx-boundary">${p.limit}</p>`;
  if(angle==='specs')return `<dl class="mx-specs">${[['官方上下文',m.context],['官方最大输出',m.maxOutput],['平台单次输出上限',c.max_output_tokens.toLocaleString()+' Token'],['思考模式',m.thinking==='switchable'?'默认开启，可关闭':'始终开启，可调整强度'],['平台输入 / 输出',c.input.includes('image')?'文本、图片 / 文本':'文本 / 文本'],['工具调用',c.tool_calling?'支持并行工具调用':'待确认'],['结构化输出',c.json_schema?'JSON / JSON Schema':'JSON'],['平台缓存能力',c.prompt_cache?'已支持':'未确认，勿按缓存价估算收益']].map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><p class="mx-boundary">官方规格与平台调用上限分别列出。<a href="#realtesting">查看平台功能实测 ↗</a></p>`;
  const r=pricing(m).rates;
  return `<div class="mx-billing"><section><h3>按实际 Token 用量计费</h3><p>费用 = 未命中输入 × 输入单价 + 缓存命中 × 缓存单价 + 输出 × 输出单价；各项均除以 1,000,000。</p><p>${m.price.kind==='timed'?'北京时间周一至周五 9:00–12:00、14:00–18:00 为高峰，中国法定节假日除外。其余时段为空闲，高峰单价为空闲的两倍。':'官方缓存存储目前限时免费，免费期结束后的价格以官网为准。中断请求已产生的用量仍可能计费。'}</p><p>这里展示官方公开价格；平台实际扣费以调用时适用费率与账单为准。官网自动核对约每 6 小时一次，页面每分钟更新当前时段。工具等附加服务需按官方规则另行核对。</p></section><section class="mx-calculator"><h3>估算一次任务</h3><div class="mx-inputs">${[['miss','未命中输入',100000],['hit','缓存命中',0],['output','输出',5000]].map(([key,label,value])=>`<label>${label} Token<input type="number" min="0" max="10000000" step="1" data-mx-tokens="${key}" value="${value}"></label>`).join('')}</div><output id="mx-cost">${money((100000*r.miss+5000*r.output)/1e6)}</output><small>按右侧当前展示单价估算，含思考的输出用量请计入。</small></section></div>`;
 }
 function draw(){
  const m=catalog().find(m=>m.id===current);if(!m)return; const p=profiles[m.id],b=window.SemiflyModelBackground[m.id];
  document.getElementById('model-grid').innerHTML=catalog().map(x=>`<a href="#market/${x.id}" class="mx-choice" ${x.id===current?'aria-current="true"':''}><span class="mx-choice-brand">${brandLogo(x)}</span><span class="mx-choice-copy"><strong>${x.name}</strong><span>${profiles[x.id].label}</span></span><span class="mx-choice-arrow">↗</span></a>`).join('');
  readerObserver.disconnect();
  document.getElementById('market-detail').innerHTML=`<div class="mx-showcase" data-brand="${brand(m)}" data-model="${m.id}"><div class="mx-workspace"><section class="mx-story"><div class="mx-story-copy"><div class="mx-vendor">${brandLogo(m)}<span>模型档案 / ${m.id==='deepseek-flash'?'DEEPSEEK':'GLM'}</span></div><h2>${m.name}</h2><p class="mx-lead">${p.lead}</p><p class="mx-scale">${b.scale} <span>· ${m.context} 上下文 · ${m.maxOutput} 最大输出</span></p><button class="mx-use" data-action="model-personal" data-model-id="${m.id}">在工作台使用 <span aria-hidden="true">→</span></button><span class="mx-availability">${open(m)?'线路已接通':'可用性以工作台为准'}</span></div><div class="mx-brand-art" aria-hidden="true"><div class="mx-orbit mx-orbit-one"></div><div class="mx-orbit mx-orbit-two"></div><div class="mx-art-core">${brandLogo(m)}</div><span class="mx-art-node node-code">${icon('code-xml')}</span><span class="mx-art-node node-think">${icon('brain-circuit')}</span><span class="mx-art-node node-file">${icon(m.capabilities.input.includes('image')?'scan-eye':'pencil-line')}</span><span class="mx-art-spark">✦</span></div></section><nav class="mx-angles" aria-label="模型介绍角度">${sections.map(([id,label,glyph])=>`<button type="button" class="${id==='price'?'mx-price-tab':''}" data-mx-angle="${id}" aria-pressed="${angle===id}">${icon(glyph)}${label}</button>`).join('')}</nav>
  <div class="mx-compact-nav"><select aria-label="选择模型栏目" data-mx-section>${sections.map(([id,label])=>`<option value="${id}" ${angle===id?'selected':''}>${label}</option>`).join('')}</select>
  <button type="button" data-mx-angle="compare" aria-pressed="${angle==='compare'}">${icon('arrow-left-right')}模型对比</button></div>
  <div class="mx-reader" data-screen-local><div id="mx-pane" data-screen-local>${pane(m)}</div>
  <nav class="mx-reader-pager" aria-label="模型内容分页" hidden><button type="button" data-mx-page="-1">上一页</button><output aria-live="polite"></output><button type="button" data-mx-page="1">下一页</button></nav></div></div><div id="mx-price-host">${pricePanel(m)}</div></div>`;
  readerObserver.observe(document.querySelector('.mx-reader'));
  fitReader();
 }
 function render(models,isOpen){open=isOpen;draw();}
 function route(id,isOpen){open=isOpen;current=ids.includes(id)?id:ids[0];if(id&&!ids.includes(id))history.replaceState(null,'','#market');draw();document.title=`${id&&ids.includes(id)?profiles[current].label+' · ':''}模型广场 · semifly.ai`;}
 function estimate(){const m=catalog().find(m=>m.id===current),r=pricing(m).rates;let sum=0;document.querySelectorAll('[data-mx-tokens]').forEach(el=>{sum+=Math.max(0,Math.min(1e7,Number(el.value)||0))*r[el.dataset.mxTokens];});const out=document.getElementById('mx-cost');if(out)out.textContent=money(sum/1e6);}
 async function refresh(){
  if(loading)return;loading=true;
  const update=()=>{const m=catalog().find(m=>m.id===current);if(m&&document.getElementById('mx-price-host')){document.getElementById('mx-price-host').innerHTML=pricePanel(m);if(angle==='price'||(angle==='compare'&&compareGroup==='price'))updatePane(m);estimate();}};
  update();
  try{const r=await fetch('/api/public/official-prices',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('unavailable');const data=await r.json();if(!Array.isArray(data.models))throw Error('invalid');feed={...data,receivedAt:Date.now()};}catch{feed=null;}finally{loading=false;update();}
 }
 // Keep the controls in their own row, outside the clipped reading area.
 const readerObserver=new ResizeObserver(fitReader);
 function fitReader(){
  const content=document.getElementById('mx-pane');
  if(!content?.clientHeight)return;
  const pager=content.nextElementSibling;
  const fullHeight=content.parentElement.clientHeight;
  const naturalHeight=content.scrollHeight;
  const paged=naturalHeight>(pager.hidden?content.clientHeight:fullHeight)+1;
  pager.hidden=!paged;
  if(!paged){content.scrollTop=0;return;}
  const step=Math.max(1,content.clientHeight-24);
  const end=content.scrollHeight-content.clientHeight;
  const pages=Math.ceil(end/step)+1;
  const currentPage=content.scrollTop>=end-1?pages:Math.floor(content.scrollTop/step)+1;
  pager.querySelector('output').textContent=`${currentPage} / ${pages}`;
  pager.firstElementChild.disabled=content.scrollTop<1;
  pager.lastElementChild.disabled=content.scrollTop>=end-1;
 }
 function updatePane(model,reset=false){
  const content=document.getElementById('mx-pane');
  content.innerHTML=pane(model);
  if(reset)content.scrollTop=0;
  fitReader();
 }
 function selectSection(section){
  angle=section;
  for(const button of document.querySelectorAll('[data-mx-angle]')){
   button.setAttribute('aria-pressed',String(button.dataset.mxAngle===angle));
  }
  document.querySelector('[data-mx-section]').value=angle;
  updatePane(catalog().find(m=>m.id===current),true);
 }
 document.addEventListener('change',event=>{
  if(event.target.matches('[data-mx-section]'))selectSection(event.target.value);
 });
 document.addEventListener('scroll',event=>{
  if(event.target.id==='mx-pane')fitReader();
 },true);
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-mx-page],[data-mx-compare],[data-mx-scene],[data-mx-angle],[data-mx-period],[data-mx-refresh]');
  if(!button)return;
  const {mxPage,mxCompare,mxScene,mxAngle,mxPeriod}=button.dataset;
  const model=catalog().find(m=>m.id===current);
  if(mxPage){
   const content=document.getElementById('mx-pane');
   const step=Math.max(1,content.clientHeight-24);
   const page=Math.ceil(content.scrollTop/step);
   content.scrollTop=mxPage==='1'?(Math.floor(content.scrollTop/step)+1)*step
     :Math.max(0,page-1)*step;
   fitReader();
  }else if(mxCompare || mxScene!==undefined){
   if(mxCompare)compareGroup=mxCompare;
   else scene=Number(mxScene);
   updatePane(model,true);
   const attr=mxCompare?'compare':'scene';
   document.querySelector(`[data-mx-${attr}="${mxCompare??mxScene}"]`)?.focus({preventScroll:true});
  }else if(mxAngle){
   selectSection(mxAngle);
  }else if(mxPeriod){
   period=mxPeriod;
   document.getElementById('mx-price-host').innerHTML=pricePanel(model);
   if(angle==='price'||angle==='compare')updatePane(model);
   const host=angle==='price'?'mx-pane':'mx-price-host';
   document.querySelector(`#${host} [data-mx-period="${period}"]`)?.focus({preventScroll:true});
   estimate();
  }else{
   void refresh();
  }
 });
 document.addEventListener('input',e=>{if(e.target.matches('[data-mx-tokens]'))estimate();});
 window.ModelExplorer={render,route};
 void refresh();setInterval(()=>{if(!document.hidden&&!document.getElementById('market-view')?.hidden)void refresh();},60000);
})();
