const models = [
 {id:'deepseek-chat-demo',family:'deepseek',name:'DeepSeek Chat',subtitle:'DeepSeek · 通用对话',badge:'日常首选',description:'从一封邮件到一个新想法，让写作、问答与日常工作更轻松。',tags:['日常写作','知识问答','流式输出'],uses:['writing'],price:'1.00'},
 {id:'deepseek-reasoning-demo',family:'deepseek',name:'DeepSeek Reasoning',subtitle:'DeepSeek · 深度推理',badge:'深度思考',description:'拆解复杂问题，梳理推理过程，为分析和编程多想一步。',tags:['深度推理','代码生成','工具调用'],uses:['reasoning','coding'],price:'2.00'},
 {id:'glm-coding-demo',family:'glm',name:'GLM Coding',subtitle:'智谱 GLM · 编程协作',badge:'开发者之选',description:'从需求理解到代码实现，陪你完成每一次有挑战的开发。',tags:['编程开发','Agent 协作','工具调用'],uses:['coding','reasoning'],price:'2.50'},
 {id:'glm-vision-demo',family:'glm',name:'GLM Vision',subtitle:'智谱 GLM · 视觉理解',badge:'看见更多',description:'读懂图像中的信息，让截图、图表和文档成为对话的一部分。',tags:['视觉理解','图表分析','图文问答'],uses:['vision','writing'],price:'1.50'}
];
const products = [
 {id:'SUP-001',family:'DeepSeek',name:'DeepSeek · 通用主通道',supplier:'DeepSeek 官方',code:'DS-CN-01',version:'标准 API · 演示配置',status:'healthy',latency:386,success:'99.98',capacity:42,cost:'0.80',role:'主通道',balance:'8,420.00'},
 {id:'SUP-002',family:'DeepSeek',name:'DeepSeek · 推理主通道',supplier:'DeepSeek 官方',code:'DS-CN-02',version:'标准 API · 演示配置',status:'healthy',latency:612,success:'99.96',capacity:68,cost:'1.60',role:'主通道',balance:'8,420.00'},
 {id:'SUP-003',family:'GLM',name:'GLM · 编程主通道',supplier:'智谱开放平台',code:'GLM-CN-01',version:'标准 API · 演示配置',status:'healthy',latency:428,success:'99.95',capacity:56,cost:'2.00',role:'主通道',balance:'860.00'},
 {id:'SUP-004',family:'GLM',name:'GLM · 编程备用通道',supplier:'云服务商 A',code:'GLM-CN-02',version:'托管 API · 演示配置',status:'degraded',latency:1820,success:'98.72',capacity:87,cost:'2.20',role:'备用通道',balance:'3,260.00'},
 {id:'SUP-005',family:'GLM',name:'GLM · 视觉主通道',supplier:'智谱开放平台',code:'GLM-CN-03',version:'标准 API · 演示配置',status:'healthy',latency:536,success:'99.91',capacity:24,cost:'1.20',role:'主通道',balance:'860.00'},
 {id:'SUP-006',family:'DeepSeek',name:'DeepSeek · 通用备用通道',supplier:'云服务商 B',code:'DS-CN-03',version:'托管 API · 演示配置',status:'paused',latency:null,success:null,capacity:0,cost:'0.90',role:'备用通道',balance:'1,980.00'}
];
const statusNames={healthy:'健康',degraded:'降级',paused:'暂停'};
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
let family='all',tableTab='products',selectedModel=models[0],selectedTool='Cursor',lastFocused=null;
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusBadge=p=>`<span class="status ${p.status}">${statusNames[p.status]}</span>`;
function renderModels(){
 const query=$('#model-search').value.toLowerCase().trim(),use=$('#model-use').value;
 const list=models.filter(m=>(family==='all'||m.family===family)&&(use==='all'||m.uses.includes(use))&&`${m.name} ${m.description} ${m.tags.join(' ')}`.toLowerCase().includes(query));
 const artTypes=['mint','violet','peach','ice'];
 $('#model-grid').innerHTML=list.length?list.map(m=>{const index=models.indexOf(m),art=artTypes[index];return `<article class="model-card m-model ${m.family} m-model-${art}"><div class="m-model-art" aria-hidden="true"><span class="m-model-number">0${index+1}</span><div class="m-model-orbit"></div><div class="m-model-orb"></div><span class="m-model-spark"></span><span class="m-model-art-label">${['EVERYDAY IDEAS','DEEPER THINKING','BUILD SOMETHING','A FRESH PERSPECTIVE'][index]}</span></div><div class="model-card-body"><div class="m-model-meta"><span>${m.family==='deepseek'?'DeepSeek':'智谱 GLM'}</span><span class="model-badge">${m.badge}</span></div><h3>${m.name}</h3><p class="model-desc">${m.description}</p><div class="tags">${m.tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div><div class="model-price"><div><div class="price"><small>¥</small>${m.price}</div><div class="price-label">/ 百万输入 tokens · 演示价</div></div><span data-icon="${m.family==='deepseek'?'brain-circuit':'cpu'}"></span></div></div><button class="card-action" data-model="${m.id}" aria-label="预览 ${m.name} 接入">看看怎么接入 <span data-icon="arrow-up-right"></span></button></article>`;}).join(''):'<div class="m-empty"><span data-icon="search"></span><h3>这次还没有找到合拍的模型。</h3><p>换个关键词，或清除筛选再看看。</p><button class="button secondary" data-action="reset-catalog">清除筛选</button></div>';
 $('.count-badge').textContent=list.length;
 $$('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scenario===use)));
 $$('[data-family]').forEach(b=>{b.classList.toggle('active',b.dataset.family===family);b.setAttribute('aria-pressed',String(b.dataset.family===family));});
}
function switchView(view){
 if(window.IdentityUI?.handles(view)){window.IdentityUI.route(view);return;}
 window.IdentityUI?.cancel();document.body.classList.remove('identity-active');const identityView=document.getElementById('identity-view');if(identityView)identityView.hidden=true;
 const section=view.startsWith('ops/')?view.slice(4):'overview';
 if(view.startsWith('ops/'))view='admin';
 const views=['market','admin','login','enterprise','personal','staff','universe'];
 if(!views.includes(view))view='market';
 document.body.classList.toggle('market-active',view==='market');
 document.body.classList.toggle('welcome-active',view==='login'||view==='universe');
 document.body.classList.toggle('universe-active',view==='universe');
 const displayView=view==='universe'?'login':view;
 window.UniverseScene?.setActive(view==='universe');
 views.forEach(id=>{const el=document.getElementById(id+'-view');if(el)el.hidden=id!==displayView;});
 $$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
 if(view==='admin')window.OperationsUI?.render(section);
 document.title='semifly.ai · '+({market:'模型广场',admin:'运营工作台',login:'欢迎来到 semifly',enterprise:'企业工作台',personal:'个人工作台',staff:'员工管理台',universe:'宇宙欢迎页'}[view]);
 window.scrollTo(0,0);
}
function showToast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
function showDialog(content){$('#dialog-content').innerHTML=content;if(!$('#config-dialog').open)$('#config-dialog').showModal();}
function showInfo(title,description,content=''){showDialog(`<div class="dialog-kicker">semifly.ai · DESIGN PREVIEW</div><h2 class="dialog-title">${title}</h2><p class="dialog-description">${description}</p>${content}<div class="dialog-bottom"><span>界面预览 · 不涉及真实交易</span><button class="primary button" data-close-dialog>知道了</button></div>`);}
function openConfig(id,tool){selectedModel=models.find(m=>m.id===id)||selectedModel;selectedTool=tool||selectedTool;renderConfig(1);}
function renderConfig(step){
 const heading=`<div class="dialog-kicker">CONNECT YOUR WORKFLOW</div><h2 class="dialog-title">把模型接入你的工具</h2><p class="dialog-description">选好工具，获取为你整理的配置。</p><div class="dialog-steps"><span class="${step===1?'active':''}">01 选择工具</span><span class="${step===2?'active':''}">02 确认配置</span><span class="${step===3?'active':''}">03 复制使用</span></div>`;
 if(step===1)showDialog(heading+`<label class="choice-label">你正在使用哪个工具？</label><div class="client-options">${['Cursor','TRAE','Qoder','WorkBuddy'].map(t=>`<button class="${selectedTool===t?'active':''}" data-select-tool="${t}">${t}<span style="float:right">${selectedTool===t?'<span data-icon=check></span>':'<span data-icon=arrow-up-right></span>'}</span></button>`).join('')}</div><label class="choice-label" for="config-model">选择模型</label><select class="dialog-field" id="config-model">${models.map(m=>`<option value="${m.id}" ${m.id===selectedModel.id?'selected':''}>${m.name}</option>`).join('')}</select><div class="info-box">这是配置向导的体验预览。具体工具版本、模型能力和协议需在正式接入时验证。</div><div class="dialog-bottom"><span>中国区 · 接入体验预览</span><button class="primary button" data-config-step="2">下一步 <span data-icon=arrow-right></span></button></div>`);
 if(step===2)showDialog(heading+`<div class="price-example"><span>当前工作区</span><b>Larry 的个人工作区</b></div><div class="price-example"><span>工具 / 模型</span><b>${selectedTool} / ${selectedModel.name}</b></div><div class="price-example"><span>演示输入单价</span><b>¥${selectedModel.price} / 百万 tokens</b></div><div class="price-example"><span>配置状态</span><b>示例 · 待真实客户端验证</b></div><div class="info-box">接下来生成一份不可调用的示例配置，让你查看复制与接入的页面体验。不会创建真实 Key 或扣费。</div><div class="dialog-bottom"><button class="text-button" data-config-step="1"><span data-icon=arrow-left></span> 上一步</button><button class="primary button" data-config-step="3">生成示例配置 <span data-icon=arrow-right></span></button></div>`);
 if(step===3)showDialog(heading+`<div class="info-box"><span data-icon=check></span> 已生成 ${selectedTool} 示例配置。请勿把演示凭据用于真实服务。</div><pre class="config-code" id="config-code">Base URL: https://api.example.invalid/v1\nAPI Key: sk-demo-not-a-real-key\nModel: ${selectedModel.id}</pre><p class="demo-notice">正式产品将在这里展示对应工具版本的设置步骤，并等待首次真实调用。此预览不会修改本机客户端。</p><div class="dialog-bottom"><button class="text-button" data-config-step="1">重新选择</button><button class="primary button" id="copy-config">复制示例配置 <span data-icon=copy></span></button></div>`);
}
function filteredProducts(){const query=$('#supply-search').value.trim().toLowerCase(),status=$('#status-filter').value,supplier=$('#supplier-filter').value;return products.filter(p=>(status==='all'||p.status===status)&&(supplier==='all'||p.family===supplier)&&`${p.name} ${p.supplier} ${p.code}`.toLowerCase().includes(query));}
function renderTable(){
 $$('[data-table]').forEach(b=>b.classList.toggle('active',b.dataset.table===tableTab));
 const list=filteredProducts();let head='',rows='';
 if(tableTab==='products'){
  head='<tr><th>供应产品 / 通道</th><th>供应商</th><th>运行状态</th><th class="numeric">首内容 p95</th><th class="numeric">完成率</th><th class="numeric">容量占用</th><th class="numeric">输入采购价</th><th></th></tr>';
  rows=list.map(p=>`<tr data-product="${p.id}" tabindex="0" aria-label="查看${p.name}"><td><div class="table-name"><span class="family-icon ${p.family==='GLM'?'glm':'deepseek'}">${p.family==='GLM'?'<span data-icon=cpu></span>':'<span data-icon=brain-circuit></span>'}</span><div><b>${p.name}</b><small>${p.code} <span style="padding:0 4px">·</span> ${p.role}</small></div></div></td><td>${p.supplier}<div class="cell-sub">中国大陆 · 演示</div></td><td>${statusBadge(p)}</td><td class="numeric ${p.status==='degraded'?'amber-text':''}">${p.latency?`${p.latency.toLocaleString()} <small>ms</small>`:'—'}</td><td class="numeric">${p.success?`${p.success}%`:'—'}</td><td class="numeric"><div class="capacity"><div class="capacity-track ${p.capacity>80?'warning':''}"><i style="width:${p.capacity}%"></i></div>${p.status==='paused'?'—':`${p.capacity}%`}</div></td><td class="numeric">¥${p.cost}<div class="cell-sub">/ 百万 tokens</div></td><td><button class="detail-link" data-product="${p.id}">详情 <span data-icon=arrow-up-right></span></button></td></tr>`).join('');
 }else if(tableTab==='accounts'){
  head='<tr><th>采购账户</th><th>采购主体</th><th>状态</th><th class="numeric">现金余额</th><th class="numeric">赠送余额</th><th class="numeric">预计覆盖</th><th>更新时间</th><th></th></tr>';
  const accounts=list.filter((p,i,a)=>a.findIndex(x=>x.supplier===p.supplier)===i);
  rows=accounts.map(p=>`<tr data-product="${p.id}" tabindex="0"><td><div class="table-name"><span class="family-icon ${p.family==='GLM'?'glm':'deepseek'}">${p.family==='GLM'?'<span data-icon=cpu></span>':'<span data-icon=brain-circuit></span>'}</span><div><b>${p.supplier}</b><small>ACCOUNT-${p.code}</small></div></div></td><td>中国区主体</td><td><span class="status ${p.balance==='860.00'?'degraded':'healthy'}">${p.balance==='860.00'?'余额预警':'资金充足'}</span></td><td class="numeric">¥${p.balance}</td><td class="numeric">¥0.00</td><td class="numeric">${p.balance==='860.00'?'2.8':'14.2'} 天</td><td>14:32 · 演示</td><td><button class="detail-link" data-product="${p.id}">详情 <span data-icon=arrow-up-right></span></button></td></tr>`).join('');
 }else{
  head='<tr><th>事件</th><th>影响范围</th><th>优先级</th><th>状态</th><th>负责人</th><th>发生时间</th><th></th></tr>';
  const events=[{id:'balance',p:products[2],title:'采购余额低于预警阈值',level:'中',state:'待处理',time:'14:32'},{id:'latency',p:products[3],title:'首内容延迟高于基线',level:'高',state:'跟进中',time:'14:18'},{id:'contract',p:products[5],title:'供应协议即将到期',level:'中',state:'待续约',time:'10:00'}].filter(e=>list.includes(e.p));
  rows=events.map(e=>`<tr data-alert="${e.id}" tabindex="0"><td><b style="font-weight:500">${e.title}</b></td><td>${e.p.name}</td><td><span class="status degraded">${e.level}</span></td><td>${e.state}</td><td>${e.id==='latency'?'运维负责人':'供应负责人'}</td><td>11/06 ${e.time}</td><td><button class="detail-link" data-alert="${e.id}">处理 <span data-icon=arrow-up-right></span></button></td></tr>`).join('');
 }
 $('#supply-table').innerHTML=`<thead>${head}</thead><tbody>${rows||'<tr><td colspan="8" style="text-align:center;padding:40px">没有匹配记录，请调整筛选条件。</td></tr>'}</tbody>`;
 $('#row-count').textContent=`共 ${rows?(rows.match(/<tr /g)||[]).length:0} 项${tableTab==='products'?'供应产品':tableTab==='accounts'?'采购账户':'事件记录'}`;
}
function openDrawer(p){
 lastFocused=document.activeElement;
 $('#drawer-content').innerHTML=`<div class="dialog-kicker">SUPPLIER DETAIL · DEMO</div><span class="family-icon model-icon ${p.family==='GLM'?'glm':'deepseek'}">${p.family==='GLM'?'<span data-icon=cpu></span>':'<span data-icon=brain-circuit></span>'}</span><h2 class="drawer-title">${p.name}</h2><p class="drawer-subtitle">${p.code} · ${p.supplier}</p>${statusBadge(p)}<div class="drawer-block"><h3>供给与商业条件</h3>${[['销售区域','中国区'],['产品类型',p.version],['商业资格','预览占位 · 未核验'],['现金余额',`¥${p.balance}`],['输入采购价',`¥${p.cost} / 百万 tokens`],['费率版本','DEMO-2026-11']].map(([k,v])=>`<div class="detail-row"><span>${k}</span><b>${v}</b></div>`).join('')}</div><div class="drawer-block"><h3>近 24 小时运行质量</h3>${[['首内容时延 p95',p.latency?`${p.latency.toLocaleString()} ms`:'暂无样本'],['有效完成率',p.success?`${p.success}%`:'暂无样本'],['容量占用',p.status==='paused'?'已暂停':`${p.capacity}%`],['当前策略',p.status==='degraded'?'降低权重 · 持续观察':p.status==='paused'?'停止新增请求':'正常路由']].map(([k,v])=>`<div class="detail-row"><span>${k}</span><b>${v}</b></div>`).join('')}</div><div class="drawer-note">此详情用于评审信息密度和状态配色。所有供应商状态、容量、价格和运行指标均为演示，尚未连接实际供应商。</div><div class="drawer-actions"><button class="button primary" data-action="inspect-quality">查看质量说明</button><button class="button secondary" data-action="demo-pause">${p.status==='paused'?'恢复通道演示':'暂停通道演示'}</button></div>`;
 $('#detail-drawer').dataset.product=p.id;$('#detail-drawer').hidden=false;$('#drawer-backdrop').hidden=false;document.body.style.overflow='hidden';$('#drawer-close').focus();
}
function closeDrawer(){$('#detail-drawer').hidden=true;$('#drawer-backdrop').hidden=true;document.body.style.overflow='';lastFocused?.focus();}
function showAlert(type){
 const info={balance:['采购余额预警','GLM 采购账户 · 演示事件','可用现金 ¥860.00，按演示日成本估算，可覆盖约 2.8 天。','核对余额与资源包 <span data-icon=arrow-right></span> 检查活动需求 <span data-icon=arrow-right></span> 提交采购申请'],latency:['备用通道延迟升高','GLM 编程备用通道 · 演示事件','首内容时延 p95 达到 1,820 ms，容量占用 87%。当前按降级状态展示。','区分容量与上游过载 <span data-icon=arrow-right></span> 降低流量 <span data-icon=arrow-right></span> 受限探测 <span data-icon=arrow-right></span> 渐进恢复'],contract:['供应协议即将到期','云服务商 B · 演示事件','合同将在 7 天后到期，该演示通道当前已暂停。','联系采购负责人 <span data-icon=arrow-right></span> 核实续约与授权范围 <span data-icon=arrow-right></span> 更新证据和生效时间']}[type];
 showInfo(info[0],info[1],`<div class="info-box">${info[2]}</div><label class="choice-label">建议处理路径</label><p class="dialog-description">${info[3]}</p>`);
}
const actions={
 'reset-catalog':()=>{family='all';$('#model-search').value='';$('#model-use').value='all';renderModels();},
 readiness:()=>showInfo('五个模块，逐步落地','当前版本是已确认界面的阿里云独立部署。',`<div class="price-example"><span>员工与客户登录、权限</span><b>客户与员工独立入口 · 认证待实现</b></div><div class="price-example"><span>供应商与产品验证</span><b>界面演示 · 未接真实供应</b></div><div class="price-example"><span>模型广场与接入</span><b>交互可预览 · 配置不可调用</b></div><div class="price-example"><span>付费</span><b>订单与企业预算可预览 · 未开放收款</b></div><div class="price-example"><span>促销</span><b>活动草稿可预览 · 未发放优惠或佣金</b></div><div class="info-box">本预览不创建真实账户、不保存供应资料、不收款、不调用模型。旧平台 api.glocalstorage.cn 独立运行。</div>`),
 tools:()=>openConfig(),
 pricing:()=>showInfo('让每一笔费用都清楚','实际消费按模型、用量与当时生效的价格计算。',`<div class="price-example"><span>输入费用</span><b>输入用量 × 输入单价</b></div><div class="price-example"><span>输出费用</span><b>输出用量 × 输出单价</b></div><div class="price-example"><span>促销优惠</span><b>按活动适用条件生效</b></div><div class="info-box">页面中的价格全部是视觉演示值，不是供应商官方报价或实际销售承诺。</div>`),
 docs:()=>showInfo('三步开始接入','这里预览正式产品的文档入口。',`<div class="price-example"><span>01</span><b>选择模型与自己的开发工具</b></div><div class="price-example"><span>02</span><b>创建项目，获取平台 API Key</b></div><div class="price-example"><span>03</span><b>完成首次调用，查看用量与费用</b></div>`),
 account:()=>showInfo('Larry 的个人工作区','当前为演示账户，未登录真实身份系统。',`<div class="price-example"><span>服务区域</span><b>中国区</b></div><div class="price-example"><span>账户类型</span><b>个人工作区</b></div><div class="info-box">正式版本在这里切换个人与企业工作区，并查看账户安全、付款和项目权限。</div>`),
 notifications:()=>{location.hash='ops/supply';switchView('ops/supply');tableTab='events';renderTable();$('.supply-panel').scrollIntoView({behavior:'smooth',block:'center'});},
 balance:()=>{location.hash='ops/supply';switchView('ops/supply');tableTab='accounts';renderTable();$('.supply-panel').scrollIntoView({behavior:'smooth',block:'center'});},
 'add-supplier':()=>showDialog(`<div class="dialog-kicker">SUPPLIER ONBOARDING</div><h2 class="dialog-title">新增供应商</h2><p class="dialog-description">先建立档案，逐步补齐合同、产品与供应条件。</p><form id="supplier-form"><label class="choice-label" for="supplier-name">供应商名称</label><input id="supplier-name" class="simple-input" placeholder="输入公司或机构全称" required maxlength="80"><label class="choice-label" for="supplier-type">供应来源</label><select id="supplier-type" class="dialog-field"><option>模型官方服务</option><option>获授权代理 / 云服务商</option><option>自部署模型</option></select><div class="info-box">预览模式只展示表单体验，不保存或提交真实供应商资料。</div><div class="dialog-bottom"><span>初始状态：草稿</span><button class="button primary" type="submit">预览创建结果 <span data-icon=arrow-right></span></button></div></form>`),
 'inspect-quality':()=>{const p=products.find(p=>p.id===$('#detail-drawer').dataset.product);closeDrawer();showInfo('质量指标说明',p.name,`<div class="info-box">有效完成率：流式或非流式结果正常结束的比例。<br>首内容时延：从发出请求到收到有效内容的时间。<br>容量占用：当前正在使用的共享容量比例。</div><p class="demo-notice">正式版本将同时显示样本数、统计窗口、错误分类与真实探测记录。</p>`);},
 'demo-pause':()=>{const p=products.find(p=>p.id===$('#detail-drawer').dataset.product);p.status=p.status==='paused'?'healthy':'paused';renderTable();openDrawer(p);showToast('已切换本页演示状态；刷新后恢复，不影响真实服务。');}
};
document.addEventListener('click',event=>{
 const b=event.target.closest('button,a,tr');if(!b)return;
 if(b.dataset.view){location.hash=b.dataset.view;switchView(b.dataset.view);}
 if(b.dataset.scenario){$('#model-use').value=b.dataset.scenario;renderModels();$('#catalog').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
 if(b.hasAttribute('data-market-motion')){const stopped=$('.m-hero').classList.toggle('m-motion-paused');b.setAttribute('aria-pressed',String(stopped));b.setAttribute('aria-label',stopped?'播放模型广场装饰动效':'暂停模型广场装饰动效');b.textContent=stopped?'播放动效':'暂停动效';}
 if(b.dataset.family){family=b.dataset.family;$$('[data-family]').forEach(x=>x.classList.toggle('active',x===b));renderModels();}
 if(b.dataset.model)openConfig(b.dataset.model);
 if(b.dataset.tool)openConfig(null,b.dataset.tool);
 if(b.dataset.selectTool){selectedTool=b.dataset.selectTool;selectedModel=models.find(m=>m.id===$('#config-model').value)||selectedModel;renderConfig(1);}
 if(b.dataset.configStep){if($('#config-model'))selectedModel=models.find(m=>m.id===$('#config-model').value)||selectedModel;renderConfig(Number(b.dataset.configStep));}
 if(b.hasAttribute('data-close-dialog'))$('#config-dialog').close();
 if(b.dataset.action)actions[b.dataset.action]?.();
 if(b.dataset.table){tableTab=b.dataset.table;renderTable();}
 if(b.dataset.product)openDrawer(products.find(p=>p.id===b.dataset.product));
 if(b.dataset.alert)showAlert(b.dataset.alert);
 if(b.dataset.section)location.hash='ops/'+b.dataset.section;
});
$('#model-search').addEventListener('input',renderModels);$('#model-use').addEventListener('change',renderModels);
$('#supply-search').addEventListener('input',renderTable);$('#status-filter').addEventListener('change',renderTable);$('#supplier-filter').addEventListener('change',renderTable);
$('#density-button').addEventListener('click',()=>{const compact=$('#supply-table').classList.toggle('compact');$('#density-button').setAttribute('aria-pressed',String(compact));$('#density-button').innerHTML=compact?'<span data-icon=list-filter></span> 舒适视图':'<span data-icon=list-filter></span> 紧凑视图';});
$('#drawer-close').addEventListener('click',closeDrawer);$('#drawer-backdrop').addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#detail-drawer').hidden)closeDrawer();if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();const search=!$('#enterprise-view').hidden?$('#e-search'):!$('#admin-view').hidden?($('#ops-search')||$('#supply-search')):!$('#market-view').hidden?$('#model-search'):null;search?.focus();}if(e.key==='Enter'&&e.target.matches('tr[data-product],tr[data-alert]'))e.target.click();if(e.key==='Tab'&&!$('#detail-drawer').hidden){const focusable=$$('#detail-drawer button');const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
document.addEventListener('submit',e=>{if(e.target.id==='supplier-form'){e.preventDefault();const name=$('#supplier-name').value.trim();if(!name)return;showInfo('供应商草稿预览',escapeHtml(name),'<div class="info-box">表单体验已完成。正式产品将保存草稿，并进入合同与授权资料补充流程。本预览没有写入任何业务数据。</div>');}});
document.addEventListener('click',async e=>{if(e.target.closest('#copy-config')){try{await navigator.clipboard.writeText($('#config-code').textContent);showToast('示例配置已复制');}catch{showToast('当前浏览器未允许复制，请选中配置文字手动复制。');}}});
$('#export-button').addEventListener('click',()=>{const rows=[['演示报表：非真实业务数据'],['通道','供应商','状态','首内容时延 ms','完成率 %','容量占用 %','输入采购价/百万tokens'],...filteredProducts().map(p=>[p.name,p.supplier,statusNames[p.status],p.latency??'',p.success??'',p.capacity,p.cost])];const blob=new Blob(['\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='oneapi-supply-demo.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('演示供应报表已导出');});
window.addEventListener('hashchange',()=>{switchView(location.hash.slice(1));});
renderModels();renderTable();switchView(location.hash==='#admin'?'admin':'market');

fetch('release.json', {cache:'no-store'}).then(r=>r.ok?r.json():null).then(r=>{if(r?.source_sha)document.querySelector('#release-version').textContent='PREVIEW · '+r.source_sha.slice(0,7);}).catch(()=>{});
