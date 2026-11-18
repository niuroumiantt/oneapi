// The catalog comes from model-catalog.js, generated from server/src/official-models.mjs.
const models=window.SemiflyModels;
// Models the gateway cannot route right now (from /api/public/models); they show as 暂未开放.
const unavailableModels=new Set(models.filter(m=>!m.verified).map(m=>m.id));
const modelOpen=m=>!unavailableModels.has(m.id);
const modelArtLabel={'deepseek-flash':'EVERYDAY IDEAS','deepseek-flash-0910':'FLASH · 0910','deepseek-v4-pro':'DEEPER THINKING','glm-5.3':'TEXT & REASONING','glm-5.3-flash':'MULTIMODAL FLASH','glm-5.3-flashx':'FASTER FLASH'};
const modelTags=m=>m.tags.filter(t=>!t.startsWith('上下文')).map((t,i)=>`<span class="tag${i===0?' tag-thinking':''}">${t}</span>`).join('');
const PRICE_DISCOUNT=1;
const formatRate=value=>'¥'+Number(value).toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
const discountedRate=value=>formatRate(Math.round(value*PRICE_DISCOUNT*10000)/10000);
const modelRateGroups=m=>m.price.kind==='timed'?[['空闲时段',m.price.offpeak],['高峰时段',m.price.peak]]:[['标准 API',m.price.standard]];
function modelRateTable(m){return `<div class="m-rate-table-wrap"><table class="m-rate-table"><thead><tr><th>时段 / 计费项</th><th>官网公开价</th><th>官价额度扣减标准</th></tr></thead><tbody>${modelRateGroups(m).map(([period,rates])=>[['输入·缓存命中',rates.hit],['输入·缓存未命中',rates.miss],['输出',rates.output]].map(([label,rate])=>`<tr><td>${period} · ${label}</td><td>${formatRate(rate)}</td><td><strong>${discountedRate(rate)}</strong></td></tr>`).join('')).join('')}</tbody></table></div>`;}
function modelRatePreview(m){const [,rates]=modelRateGroups(m)[0];return `<div class="m-rate-preview"><div class="m-rate-preview-head"><span>按官网价计量 · 元 / 1M Token</span><b>${m.price.kind==='timed'?'空闲时段':'标准 API'}</b></div><div class="m-rate-preview-grid"><span>输入未命中<small>${formatRate(rates.miss)} → <b>${discountedRate(rates.miss)}</b></small></span><span>输入缓存命中<small>${formatRate(rates.hit)} → <b>${discountedRate(rates.hit)}</b></small></span><span>输出<small>${formatRate(rates.output)} → <b>${discountedRate(rates.output)}</b></small></span></div>${m.price.kind==='timed'?'<small>高峰时段另有价格，查看型号详情。</small>':'<small>缓存存储目前由官方限时免费；后续变更以官方为准。</small>'}</div>`;}
window.SemiflyPrice={formatRate,discountedRate,modelRateGroups};
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
let family='all';
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
 showDialog(`<div class="dialog-kicker">OFFICIAL MODEL / ${escapeHtml(m.family==='deepseek'?'DeepSeek':'智谱 GLM')}</div><h2 class="dialog-title">${escapeHtml(m.name)}</h2><p class="dialog-description">${escapeHtml(m.description)}</p><div class="price-example"><span>官网模型 ID / 版本</span><b>${escapeHtml(m.upstreamId)} · ${escapeHtml(m.version)}</b></div><div class="price-example"><span>上下文 / 官方最大输出</span><b>${escapeHtml(m.context)} · ${escapeHtml(m.maxOutput)}（经 semifly 单次最多 32K）</b></div><div class="price-example m-cap-row"><span>能力</span><b>${escapeHtml(m.tags.filter(t=>!t.startsWith('上下文')).join(' · '))}</b></div><div class="price-example"><span>供应验收</span><b>${escapeHtml(modelOpen(m)?m.verification:'线路尚未接通，暂时不能调用')}</b></div>${m.thinking==='none'?'':`<p class="m-detail-rule">这个型号先思考再回答，思考内容也占用 max_tokens。max_tokens 设得太小时，回答会是空的。${m.thinking==='always'?'思考不能关闭，最低可把 reasoning_effort 设为 low。':'不需要思考时可传 thinking: {type: "disabled"}。'}</p>`}<div class="dialog-kicker m-detail-pricing-title">官网公开价与官价额度扣减标准 · 元 / 1M Token</div>${modelRateTable(m)}${m.price.kind==='timed'?'<p class="m-detail-rule">DeepSeek 高峰：北京时间工作日（不含中国法定节假日）9:00–12:00、14:00–18:00；其余为空闲时段。</p>':'<p class="m-detail-rule">智谱缓存存储当前限时免费；如调整，需同步更新价格版本。</p>'}<p class="m-detail-rule">实际费用须按请求用量、缓存命中情况和调用时的价格版本逐笔计算。测速待同任务、同参数、同时间窗口验收；不承诺未经验证的官方同等速度。</p><a class="m-official-source" href="${escapeHtml(m.price.source)}" target="_blank" rel="noopener noreferrer">查看官方价格来源 ↗</a><div class="info-box">模型名称与官方型号一致，不代表供应链、版本和服务表现已经验收。购买额度包时使用合同优惠或促销码，取最优一条、不叠加；付款前显示并锁定实付金额和官价面额。</div><div class="dialog-bottom model-next"><button class="button secondary" data-close-dialog>继续浏览</button><button class="button primary" data-action="model-personal" data-model-id="${escapeHtml(m.id)}">个人继续 <span data-icon="arrow-right"></span></button><button class="button secondary" data-action="model-enterprise" data-model-id="${escapeHtml(m.id)}">企业继续</button></div>`);
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
 document.getElementById("site-boot")?.remove();
 if(!view||view==='login')view='universe';
 if(window.ConsoleUI?.handles(view)){window.RealTestingUI?.hide();window.DocsUI?.hide();window.ConsoleUI.render(view);return;}
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
const actions={
 'reset-catalog':()=>{family='all';$('#model-search').value='';$('#model-use').value='all';renderModels();},
 tools:()=>{location.hash='docs/tools';},
 pricing:()=>{$('#config-dialog').close();$('#how-pricing-works').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});},
 'model-personal':async button=>{if(!window.IdentityUI?.chooseModelIntent(button.dataset.modelId,'personal'))return;$('#config-dialog').close();location.hash=await window.IdentityUI.customerSignedIn()?'personal':'register';},
 'model-enterprise':async button=>{if(!window.IdentityUI?.chooseModelIntent(button.dataset.modelId,'enterprise'))return;$('#config-dialog').close();location.hash=await window.IdentityUI.customerSignedIn()?'enterprise':'enterprise-register';},
 account:()=>{location.hash='personal';},
};
document.addEventListener('click',event=>{
 const b=event.target.closest('button,a,tr');if(!b)return;
 if(b.dataset.view){if(location.hash==='#'+b.dataset.view)switchView(b.dataset.view);else location.hash=b.dataset.view;}
 if(b.dataset.family){family=b.dataset.family;$$('[data-family]').forEach(x=>x.classList.toggle('active',x===b));renderModels();}
 if(b.dataset.model)openModelDetail(b.dataset.model);
 if(b.hasAttribute('data-close-dialog'))$('#config-dialog').close();
 if(b.dataset.action)actions[b.dataset.action]?.(b);
});
$('#model-search').addEventListener('input',renderModels);$('#model-use').addEventListener('change',renderModels);$('#pricing-input-tokens').addEventListener('input',updatePricingExample);$('#pricing-output-tokens').addEventListener('input',updatePricingExample);updatePricingExample();
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();if(!$('#market-view').hidden)$('#model-search').focus();}});
window.addEventListener('hashchange',()=>{switchView(location.hash.slice(1));});
renderModels();


async function refreshPublishedCatalog(){const host=document.getElementById('published-catalog');if(!host)return;try{const r=await fetch('/api/catalog/published',{cache:'no-store'});if(!r.ok)return;const data=await r.json();host.hidden=!data.products?.length;host.innerHTML='<h3>已发布产品与批准售价</h3>'+data.products.map(p=>`<article style="padding:16px;border:1px solid #ded9eb;border-radius:10px;margin:10px 0"><b>${escapeHtml(p.name)}</b> · <code>${escapeHtml(p.model_id)}</code><p>${escapeHtml(p.summary)}</p><span>输入 ¥${escapeHtml(p.input_yuan_per_m)} / 输出 ¥${escapeHtml(p.output_yuan_per_m)} · 每百万 Token</span><small style="display:block">目录已发布 · 正式购买和调用待开放；缓存及其他价格条件以正式报价为准。</small></article>`).join('')}catch{host.hidden=true}}
addEventListener('hashchange',()=>{if(['#market','#catalog'].includes(location.hash))void refreshPublishedCatalog()});void refreshPublishedCatalog();
