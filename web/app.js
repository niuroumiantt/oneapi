// The catalog comes from model-catalog.js, generated from server/src/official-models.mjs.
const models=window.SemiflyModels;
// Models the gateway cannot route right now (from /api/public/models); they show as 暂未开放.
const unavailableModels=new Set(models.filter(m=>!m.verified).map(m=>m.id));
const modelOpen=m=>!unavailableModels.has(m.id);
const modelArtLabel={'deepseek-flash':'EVERYDAY IDEAS','deepseek-flash-0910':'FLASH · 0910','deepseek-v4-pro':'DEEPER THINKING','glm-5.3':'TEXT & REASONING','glm-5.3-flash':'MULTIMODAL FLASH','glm-5.3-flashx':'FASTER FLASH'};
const modelTags=m=>m.tags.filter(t=>!t.startsWith('上下文')).map((t,i)=>`<span class="tag${i===0?' tag-thinking':''}">${t}</span>`).join('');
const PRICE_DISCOUNT=0.8;
const formatRate=value=>'¥'+Number(value).toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
const discountedRate=value=>formatRate(Math.round(value*PRICE_DISCOUNT*10000)/10000);
const modelRateGroups=m=>m.price.kind==='timed'?[['空闲时段',m.price.offpeak],['高峰时段',m.price.peak]]:[['标准 API',m.price.standard]];
function modelRateTable(m){return `<div class="m-rate-table-wrap"><table class="m-rate-table"><thead><tr><th>时段 / 计费项</th><th>官网公开价</th><th>semifly 8 折参考价</th></tr></thead><tbody>${modelRateGroups(m).map(([period,rates])=>[['输入·缓存命中',rates.hit],['输入·缓存未命中',rates.miss],['输出',rates.output]].map(([label,rate])=>`<tr><td>${period} · ${label}</td><td>${formatRate(rate)}</td><td><strong>${discountedRate(rate)}</strong></td></tr>`).join('')).join('')}</tbody></table></div>`;}
function modelRatePreview(m){const [,rates]=modelRateGroups(m)[0];return `<div class="m-rate-preview"><div class="m-rate-preview-head"><span>官网价 × 80% · 元 / 1M Token</span><b>${m.price.kind==='timed'?'空闲时段':'标准 API'}</b></div><div class="m-rate-preview-grid"><span>输入未命中<small>${formatRate(rates.miss)} → <b>${discountedRate(rates.miss)}</b></small></span><span>输入缓存命中<small>${formatRate(rates.hit)} → <b>${discountedRate(rates.hit)}</b></small></span><span>输出<small>${formatRate(rates.output)} → <b>${discountedRate(rates.output)}</b></small></span></div>${m.price.kind==='timed'?'<small>高峰时段另有价格，查看型号详情。</small>':'<small>缓存存储目前由官方限时免费；后续变更以官方为准。</small>'}</div>`;}
window.SemiflyPrice={formatRate,discountedRate,modelRateGroups};
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
let family='all',selectedModel=models[0],selectedTool='Cursor';
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderModels(){
 const query=$('#model-search').value.toLowerCase().trim(),use=$('#model-use').value;
 const list=models.filter(m=>(family==='all'||m.family===family)&&(use==='all'||m.uses.includes(use))&&`${m.name} ${m.description} ${m.tags.join(' ')}`.toLowerCase().includes(query));
 const artTypes=['mint','violet','peach','ice'];
 $('#model-grid').innerHTML=list.length?list.map(m=>{const index=models.indexOf(m),art=artTypes[index%artTypes.length];return `<article class="model-card m-model ${m.family} m-model-${art}"><div class="m-model-art" aria-hidden="true"><span class="m-model-number">0${index+1}</span><div class="m-model-orbit"></div><div class="m-model-orb"></div><span class="m-model-spark"></span><span class="m-model-art-label">${modelArtLabel[m.id]||''}</span></div><div class="model-card-body"><div class="m-model-meta"><span>${m.family==='deepseek'?'DeepSeek':'智谱 GLM'}</span><span class="model-badge${modelOpen(m)?'':' model-badge-closed'}">${modelOpen(m)?m.badge:'暂未开放'}</span></div><h3>${m.name}</h3><p class="model-desc">${m.description}</p><div class="tags">${modelTags(m)}</div><div class="m-model-facts"><span>上下文 ${m.context}</span><span>官方最大输出 ${m.maxOutput}</span></div>${modelRatePreview(m)}<button class="card-action" data-model="${m.id}" aria-label="了解 ${m.name} 的性能与全部价格">性能与全部价格 <span data-icon="arrow-up-right"></span></button></article>`;}).join(''):'<div class="m-empty"><span data-icon="search"></span><h3>没有匹配的模型。</h3><p>换个关键词，或清除筛选再看看。</p><button class="button secondary" data-action="reset-catalog">清除筛选</button></div>';
 $('.count-badge').textContent=list.length;
 $$('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scenario===use)));
 $$('[data-family]').forEach(b=>{b.classList.toggle('active',b.dataset.family===family);b.setAttribute('aria-pressed',String(b.dataset.family===family));});
}
// Live availability: a catalog model without a working route is marked 暂未开放 instead of looking callable.
fetch('/api/public/models').then(r=>r.ok?r.json():null).then(d=>{if(!d?.models)return;unavailableModels.clear();d.models.filter(x=>!x.available).forEach(x=>unavailableModels.add(x.id));if($('#model-grid')&&$('#model-search'))renderModels();}).catch(()=>{});
function openModelDetail(id){
 const m=models.find(x=>x.id===id);if(!m)return;
 showDialog(`<div class="dialog-kicker">OFFICIAL MODEL / ${escapeHtml(m.family==='deepseek'?'DeepSeek':'智谱 GLM')}</div><h2 class="dialog-title">${escapeHtml(m.name)}</h2><p class="dialog-description">${escapeHtml(m.description)}</p><div class="price-example"><span>官网模型 ID / 版本</span><b>${escapeHtml(m.upstreamId)} · ${escapeHtml(m.version)}</b></div><div class="price-example"><span>上下文 / 官方最大输出</span><b>${escapeHtml(m.context)} · ${escapeHtml(m.maxOutput)}（经 semifly 单次最多 32K）</b></div><div class="price-example m-cap-row"><span>能力</span><b>${escapeHtml(m.tags.filter(t=>!t.startsWith('上下文')).join(' · '))}</b></div><div class="price-example"><span>供应验收</span><b>${escapeHtml(modelOpen(m)?m.verification:'线路尚未接通，暂时不能调用')}</b></div>${m.thinking==='none'?'':`<p class="m-detail-rule">这个型号先思考再回答，思考内容也占用 max_tokens。max_tokens 设得太小时，回答会是空的。${m.thinking==='always'?'思考不能关闭，最低可把 reasoning_effort 设为 low。':'不需要思考时可传 thinking: {type: "disabled"}。'}</p>`}<div class="dialog-kicker m-detail-pricing-title">官网公开价与 semifly 八折参考价 · 元 / 1M Token</div>${modelRateTable(m)}${m.price.kind==='timed'?'<p class="m-detail-rule">DeepSeek 高峰：北京时间工作日（不含中国法定节假日）9:00–12:00、14:00–18:00；其余为空闲时段。</p>':'<p class="m-detail-rule">智谱缓存存储当前限时免费；如调整，需同步更新价格版本。</p>'}<p class="m-detail-rule">实际费用须按请求用量、缓存命中情况和调用时的价格版本逐笔计算。测速待同任务、同参数、同时间窗口验收；不承诺未经验证的官方同等速度。</p><a class="m-official-source" href="${escapeHtml(m.price.source)}" target="_blank" rel="noopener noreferrer">查看官方价格来源 ↗</a><div class="info-box">模型名称与官方型号一致，不代表供应链、版本和服务表现已经验收。八折参考价尚未开放购买；正式下单价以发布时的价格版本为准。</div><div class="dialog-bottom model-next"><button class="button secondary" data-close-dialog>继续浏览</button><button class="button primary" data-action="model-personal" data-model-id="${escapeHtml(m.id)}">个人继续 <span data-icon="arrow-right"></span></button><button class="button secondary" data-action="model-enterprise" data-model-id="${escapeHtml(m.id)}">企业继续</button></div>`);
}
function updatePricingExample(){
 const input=Math.max(0,Math.min(10000000,Number($('#pricing-input-tokens')?.value)||0));
 const output=Math.max(0,Math.min(10000000,Number($('#pricing-output-tokens')?.value)||0));
 const rates=models.find(m=>m.id==='deepseek-flash').price.offpeak;
 const inputRate=rates.miss*PRICE_DISCOUNT,outputRate=rates.output*PRICE_DISCOUNT;
 const cost=(input*inputRate+output*outputRate)/1000000;
 $('#pricing-example-result').textContent='¥'+cost.toFixed(4);
 $('#pricing-example-breakdown').textContent=`输入未命中 ${input.toLocaleString('zh-CN')} × ${formatRate(inputRate)} / 1M + 输出 ${output.toLocaleString('zh-CN')} × ${formatRate(outputRate)} / 1M`;
}
function switchView(view){
 if(!view||view==='login')view='universe';
 if(window.ConsoleUI?.handles(view)){window.DocsUI?.hide();window.ConsoleUI.render(view);return;}
 window.ConsoleUI?.hide();
 if(window.RealTestingUI?.handles(view)){window.DocsUI?.hide();window.LandingUI?.hide();window.RealTestingUI.render(view);return;}
 window.RealTestingUI?.hide();
 if(window.DocsUI?.handles(view)){window.LandingUI?.hide();window.DocsUI.render(view);return;}
 window.DocsUI?.hide();
 if(window.LandingUI?.handles(view)){window.LandingUI.render(view);return;}
 if(view==='catalog')view='market';
 if(window.IdentityUI?.handles(view)){window.IdentityUI.route(view);return;}
 document.body.classList.toggle('catalog-active',view==='market');
 window.LandingUI?.hide();
 window.IdentityUI?.cancel();document.body.classList.remove('identity-active');const identityView=document.getElementById('identity-view');if(identityView)identityView.hidden=true;
 const views=['market','login','universe'];
 if(!views.includes(view))view='universe';
 document.body.classList.toggle('market-active',view==='market');
 document.body.classList.toggle('welcome-active',view==='login'||view==='universe');
 document.body.classList.toggle('universe-active',view==='universe');
 const displayView=view==='universe'?'login':view;
 window.UniverseScene?.setActive(view==='universe');
 views.forEach(id=>{const el=document.getElementById(id+'-view');if(el)el.hidden=id!==displayView;});
 $$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
 document.title='semifly.ai · '+({market:'模型广场',login:'欢迎来到 semifly',universe:'宇宙欢迎页'}[view]);
 window.scrollTo(0,0);
 window.IdentityUI?.refreshPublic();
}
function showToast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
function showDialog(content){$('#dialog-content').innerHTML=content;if(!$('#config-dialog').open)$('#config-dialog').showModal();}
function showInfo(title,description,content=''){showDialog(`<div class="dialog-kicker">semifly.ai · DESIGN PREVIEW</div><h2 class="dialog-title">${title}</h2><p class="dialog-description">${description}</p>${content}<div class="dialog-bottom"><span>界面预览 · 不涉及真实交易</span><button class="primary button" data-close-dialog>知道了</button></div>`);}
function openConfig(id,tool){selectedModel=models.find(m=>m.id===id)||selectedModel;selectedTool=tool||selectedTool;renderConfig(1);}
function renderConfig(step){
 const heading=`<div class="dialog-kicker">CONNECT YOUR WORKFLOW</div><h2 class="dialog-title">把模型接入你的工具</h2><p class="dialog-description">选好工具，获取为你整理的配置。</p><div class="dialog-steps"><span class="${step===1?'active':''}">01 选择工具</span><span class="${step===2?'active':''}">02 确认配置</span><span class="${step===3?'active':''}">03 复制使用</span></div>`;
 if(step===1)showDialog(heading+`<label class="choice-label">你正在使用哪个工具？</label><div class="client-options">${['Cursor','TRAE','Qoder','WorkBuddy'].map(t=>`<button class="${selectedTool===t?'active':''}" data-select-tool="${t}">${t}<span style="float:right">${selectedTool===t?'<span data-icon=check></span>':'<span data-icon=arrow-up-right></span>'}</span></button>`).join('')}</div><label class="choice-label" for="config-model">选择模型</label><select class="dialog-field" id="config-model">${models.map(m=>`<option value="${m.id}" ${m.id===selectedModel.id?'selected':''}>${m.name}</option>`).join('')}</select><div class="info-box">这是配置向导的体验预览。具体工具版本、模型能力和协议需在正式接入时验证。</div><div class="dialog-bottom"><span>中国区 · 接入体验预览</span><button class="primary button" data-config-step="2">下一步 <span data-icon=arrow-right></span></button></div>`);
 if(step===2)showDialog(heading+`<div class="price-example"><span>当前工作区</span><b>Larry 的个人工作区</b></div><div class="price-example"><span>工具 / 模型</span><b>${selectedTool} / ${selectedModel.name}</b></div><div class="price-example"><span>输入 / 输出单价</span><b>待正式发布</b></div><div class="price-example"><span>配置状态</span><b>示例 · 待真实客户端验证</b></div><div class="info-box">接下来生成一份不可调用的示例配置，让你查看复制与接入的页面体验。不会创建真实 Key 或扣费。</div><div class="dialog-bottom"><button class="text-button" data-config-step="1"><span data-icon=arrow-left></span> 上一步</button><button class="primary button" data-config-step="3">生成示例配置 <span data-icon=arrow-right></span></button></div>`);
 if(step===3)showDialog(heading+`<div class="info-box"><span data-icon=check></span> 已生成 ${selectedTool} 示例配置。请勿把演示凭据用于真实服务。</div><pre class="config-code" id="config-code">Base URL: https://api.example.invalid/v1\nAPI Key: sk-demo-not-a-real-key\nModel: ${selectedModel.id}</pre><p class="demo-notice">正式产品将在这里展示对应工具版本的设置步骤，并等待首次真实调用。此预览不会修改本机客户端。</p><div class="dialog-bottom"><button class="text-button" data-config-step="1">重新选择</button><button class="primary button" id="copy-config">复制示例配置 <span data-icon=copy></span></button></div>`);
}
const actions={
 'reset-catalog':()=>{family='all';$('#model-search').value='';$('#model-use').value='all';renderModels();},
 readiness:()=>showInfo('五个模块，逐步落地','当前进度以已上线的真实功能为准。',`<div class="price-example"><span>员工与客户登录、权限</span><b>已上线 · 个人、企业及员工真实身份与权限</b></div><div class="price-example"><span>供应商与产品验证</span><b>内部可用 · 档案、证据与验收报告；待真实供应接入</b></div><div class="price-example"><span>模型广场与接入</span><b>内部商品、价格及复核流程；客户目录仍是预览</b></div><div class="price-example"><span>付费</span><b>企业预算界面与付费准备台；真实收款未开放</b></div><div class="price-example"><span>促销</span><b>内部活动草稿已保存；兑换与佣金未开放</b></div><div class="info-box">真实订单、模型调用、用量账本和优惠结算尚未启用。旧平台 api.glocalstorage.cn 独立运行。</div>`),
 tools:()=>openConfig(),
 pricing:()=>{$('#config-dialog').close();$('#how-pricing-works').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});},
 'model-personal':async button=>{if(!window.IdentityUI?.chooseModelIntent(button.dataset.modelId,'personal'))return;$('#config-dialog').close();location.hash=await window.IdentityUI.customerSignedIn()?'personal':'register';},
 'model-enterprise':async button=>{if(!window.IdentityUI?.chooseModelIntent(button.dataset.modelId,'enterprise'))return;$('#config-dialog').close();location.hash=await window.IdentityUI.customerSignedIn()?'enterprise':'enterprise-register';},
 docs:()=>showInfo('从充值到第一笔用量','这里预览正式产品的接入路径。',`<div class="price-example"><span>01</span><b>充值到个人或企业空间</b></div><div class="price-example"><span>02</span><b>选择型号并确认公开价格</b></div><div class="price-example"><span>03</span><b>创建平台 API Key</b></div><div class="price-example"><span>04</span><b>部署应用并完成一次调用</b></div><div class="price-example"><span>05</span><b>查看用量、费用与剩余余额</b></div><div class="info-box">目前真实充值、客户 API Key 和调用尚未开放。</div>`),
 account:()=>{location.hash='personal';},
};
document.addEventListener('click',event=>{
 const b=event.target.closest('button,a,tr');if(!b)return;
 if(b.dataset.view){if(location.hash==='#'+b.dataset.view)switchView(b.dataset.view);else location.hash=b.dataset.view;}
 if(b.dataset.scenario){$('#model-use').value=b.dataset.scenario;renderModels();$('#catalog').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
 if(b.hasAttribute('data-market-motion')){const stopped=$('.m-hero').classList.toggle('m-motion-paused');b.setAttribute('aria-pressed',String(stopped));b.setAttribute('aria-label',stopped?'播放模型广场装饰动效':'暂停模型广场装饰动效');b.textContent=stopped?'播放动效':'暂停动效';}
 if(b.dataset.family){family=b.dataset.family;$$('[data-family]').forEach(x=>x.classList.toggle('active',x===b));renderModels();}
 if(b.dataset.model)openModelDetail(b.dataset.model);
 if(b.dataset.tool)openConfig(null,b.dataset.tool);
 if(b.dataset.selectTool){selectedTool=b.dataset.selectTool;selectedModel=models.find(m=>m.id===$('#config-model').value)||selectedModel;renderConfig(1);}
 if(b.dataset.configStep){if($('#config-model'))selectedModel=models.find(m=>m.id===$('#config-model').value)||selectedModel;renderConfig(Number(b.dataset.configStep));}
 if(b.hasAttribute('data-close-dialog'))$('#config-dialog').close();
 if(b.dataset.action)actions[b.dataset.action]?.(b);
});
$('#model-search').addEventListener('input',renderModels);$('#model-use').addEventListener('change',renderModels);$('#pricing-input-tokens').addEventListener('input',updatePricingExample);$('#pricing-output-tokens').addEventListener('input',updatePricingExample);updatePricingExample();
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();if(!$('#market-view').hidden)$('#model-search').focus();}});
document.addEventListener('click',async e=>{if(e.target.closest('#copy-config')){try{await navigator.clipboard.writeText($('#config-code').textContent);showToast('示例配置已复制');}catch{showToast('当前浏览器未允许复制，请选中配置文字手动复制。');}}});
window.addEventListener('hashchange',()=>{switchView(location.hash.slice(1));});
renderModels();

fetch('release.json', {cache:'no-store'}).then(r=>r.ok?r.json():null).then(r=>{if(r?.source_sha)document.querySelector('#release-version').textContent='PREVIEW · '+r.source_sha.slice(0,7);}).catch(()=>{});

async function refreshPublishedCatalog(){const host=document.getElementById('published-catalog');if(!host)return;try{const r=await fetch('/api/catalog/published',{cache:'no-store'});if(!r.ok)return;const data=await r.json();host.hidden=!data.products?.length;host.innerHTML='<h3>已发布产品与批准售价</h3>'+data.products.map(p=>`<article style="padding:16px;border:1px solid #ded9eb;border-radius:10px;margin:10px 0"><b>${escapeHtml(p.name)}</b> · <code>${escapeHtml(p.model_id)}</code><p>${escapeHtml(p.summary)}</p><span>输入 ¥${escapeHtml(p.input_yuan_per_m)} / 输出 ¥${escapeHtml(p.output_yuan_per_m)} · 每百万 Token</span><small style="display:block">目录已发布 · 正式购买和调用待开放；缓存及其他价格条件以正式报价为准。</small></article>`).join('')}catch{host.hidden=true}}
addEventListener('hashchange',()=>{if(['#market','#catalog'].includes(location.hash))void refreshPublishedCatalog()});void refreshPublishedCatalog();
