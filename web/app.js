// The catalog comes from model-catalog.js, generated from server/src/official-models.mjs.
const models=window.SemiflyModels;
// Models the gateway cannot route right now (from /api/public/models); they show as 暂未开放.
const unavailableModels=new Set(models.map(m=>m.id));
const modelOpen=m=>!unavailableModels.has(m.id);
const PRICE_DISCOUNT=1;
const formatRate=value=>'¥'+Number(value).toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
const discountedRate=value=>formatRate(Math.round(value*PRICE_DISCOUNT*10000)/10000);
const modelRateGroups=m=>m.price.kind==='timed'?[['空闲时段',m.price.offpeak],['高峰时段',m.price.peak]]:[['标准 API',m.price.standard]];
window.SemiflyPrice={formatRate,discountedRate,modelRateGroups};
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
let family='all';
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderModels(){window.ModelExplorer.render(models,modelOpen,family);}
// Live availability: a catalog model without a working route is marked 暂未开放 instead of looking callable.
fetch('/api/public/models').then(r=>r.ok?r.json():null).then(d=>{if(!d?.models)return;unavailableModels.clear();models.filter(m=>!d.models.some(x=>x.id===m.id&&x.available)).forEach(m=>unavailableModels.add(m.id));if($('#model-grid')&&$('#model-search'))renderModels();}).catch(()=>{});
function openModelDetail(id){if(models.some(m=>m.id===id))location.hash='market/'+id;}
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
 const marketModel=view?.startsWith('market/')?view.slice(7):null;if(marketModel!==null)view='market';
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
 if(view==='market')window.ModelExplorer.route(marketModel,modelOpen);
 window.IdentityUI?.refreshPublic();
}
function showToast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
function showDialog(content){$('#dialog-content').innerHTML=content;if(!$('#config-dialog').open)$('#config-dialog').showModal();}
const actions={
 'reset-catalog':()=>{family='all';$('#model-search').value='';$('#model-use').value='all';renderModels();},
 tools:()=>{location.hash='docs/tools';},
 pricing:()=>{$('#config-dialog').close();$('#how-pricing-works').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});},
 'model-personal':async button=>{if(!window.IdentityUI?.chooseModelIntent(button.dataset.modelId,'personal'))return;$('#config-dialog').close();location.hash=await window.IdentityUI.customerSignedIn()?'personal/connect/'+button.dataset.modelId:'register';},
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
// 支付宝电脑网站支付 return_url 回跳：支付宝会把带 # 锚点的地址丢弃或转义，导致回到首页。
// 服务端 return_url 改为带 ?alipay_return 查询参数；这里检测后清理参数并跳回账单页。
(function alipayReturn(){
 const q=new URLSearchParams(location.search);
 if(!q.has('alipay_return'))return;
 const target=q.get('alipay_return')==='org'&&q.get('org')?'billing/organization/'+q.get('org'):'billing/personal';
 q.delete('alipay_return');q.delete('org');
 const clean=q.toString();
 const base=location.pathname+(clean?'?'+clean:'');
 history.replaceState(null,'',base+'#'+target);
 switchView(target);
})();
renderModels();


async function refreshPublishedCatalog(){const host=document.getElementById('published-catalog');if(!host)return;try{const r=await fetch('/api/catalog/published',{cache:'no-store'});if(!r.ok)return;const data=await r.json();host.hidden=!data.products?.length;host.innerHTML='<h3>已发布产品与批准售价</h3>'+data.products.map(p=>`<article style="padding:16px;border:1px solid #ded9eb;border-radius:10px;margin:10px 0"><b>${escapeHtml(p.name)}</b> · <code>${escapeHtml(p.model_id)}</code><p>${escapeHtml(p.summary)}</p><span>输入 ¥${escapeHtml(p.input_yuan_per_m)} / 输出 ¥${escapeHtml(p.output_yuan_per_m)} · 每百万 Token</span><small style="display:block">目录已发布 · 正式购买和调用待开放；缓存及其他价格条件以正式报价为准。</small></article>`).join('')}catch{host.hidden=true}}
addEventListener('hashchange',()=>{if(['#market','#catalog'].includes(location.hash))void refreshPublishedCatalog()});void refreshPublishedCatalog();
