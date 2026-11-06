/* Enterprise workspace interaction preview; all changes live in this tab only. */
(() => {
  'use strict';
  let state=new EnterpriseDemo.Workspace(), panel='members', selected=new Set();
  let query='',department='all',status='all';
  const money=n=>'¥'+(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const esc=escapeHtml;
  const labels={active:'正常',paused:'已暂停',removed:'已移除',pending:'待加入'};
  const roleLabels={owner:'企业所有者',admin:'企业管理员',member:'普通成员',billing:'财务',viewer:'只读审计'};
  const menus=[['overview','<span data-icon=layout-dashboard></span>','企业概览'],['members','<span data-icon=users-round></span>','成员与部门'],['budget','<span data-icon=arrow-left-right></span>','额度与预算'],['projects','<span data-icon=layers></span>','项目与 API Key'],['usage','<span data-icon=chart-no-axes-combined></span>','用量与分析'],['billing','<span data-icon=receipt-text></span>','账单与充值'],['approvals','<span data-icon=check></span>','审批与记录'],['settings','<span data-icon=settings></span>','企业设置']];
  const isMember=()=>state.actor==='member';
  const visibleMembers=()=>state.members.filter(m=>state.visible(m));
  const filtered=()=>visibleMembers().filter(m=>(department==='all'||m.department===department)&&(status==='all'||m.status===status)&&`${m.name} ${m.id} ${m.department}`.toLowerCase().includes(query.toLowerCase()));
  const badge=m=>`<span class="status ${m.status==='active'?'healthy':m.status==='paused'?'degraded':'paused'}">${labels[m.status]}</span>`;
  function stats(){
    if(isMember()){const m=state.get('M1');return [['我的预算',money(m.budget),'企业 A 分配'],['已消费',money(m.spent),'当前演示预算内'],['可用额度',money(state.remaining(m)),'已扣除在途占用'],['在途占用',money(m.held),'请求结算后释放差额']];}
    if(state.policy.scope!=='all'){const members=visibleMembers();const sum=k=>members.reduce((a,m)=>a+m[k],0);return [['部门预算',money(sum('budget')),'仅研发部'],['已消费',money(sum('spent')),'本部门累计'],['未使用额度',money(sum('budget')-sum('spent')-sum('held')),'本部门内可调拨'],['部门成员',members.filter(m=>m.status!=='removed').length+' 人','仅展示获授权范围']];}
    const t=state.totals();return [['企业账面余额',money(t.balance),`含在途占用 ${money(t.held)}`],['已分配未使用',money(t.remaining),'已扣除消费和在途'],['未分配额度',money(t.unassigned),'可分配给成员'],['累计消费',money(t.spent),'累计充值 ¥1,000.00']];
  }
  function statCards(){return `<div class="e-stats">${stats().map(([l,v,h],i)=>`<article><span>${l}</span><strong>${v}</strong><small><i class="e-dot dot-${i}"></i>${h}</small></article>`).join('')}</div>`;}
  function table(){return `<section class="e-panel"><div class="e-panel-title"><div><h2>${isMember()?'我的额度':'成员与使用额度'}</h2><p>预算属于企业 · 金额与用量均为演示数据</p></div>${state.policy.manage?'<button class="button secondary" data-eaction="invite"><span data-icon=plus></span> 邀请成员</button>':'<span class="e-readonly">'+(isMember()?'仅本人数据':'财务只读视图')+'</span>'}</div><div class="e-filters"><input id="e-search" aria-label="搜索企业成员" placeholder="搜索成员、编号或部门" value="${esc(query)}"><select id="e-department" aria-label="筛选企业部门"><option value="all">全部可见部门</option>${['研发部','业务部'].filter(d=>state.policy.scope==='all'||state.policy.scope==='self'||d===state.policy.scope).map(d=>`<option ${department===d?'selected':''}>${d}</option>`).join('')}</select><select id="e-status" aria-label="筛选成员状态"><option value="all">全部状态</option>${Object.entries(labels).map(([v,l])=>`<option value="${v}" ${status===v?'selected':''}>${l}</option>`).join('')}</select><span class="e-filter-count" id="e-count"></span></div>${state.policy.manage?'<div class="e-batch"><span id="e-selected">已选 0 人</span><button data-eaction="batch">批量设置预算</button><span>新成员接受邀请后可分配额度</span></div>':''}<div class="e-table-scroll"><table class="e-table"><thead><tr>${state.policy.manage?'<th><input type="checkbox" id="e-select-all" aria-label="选择当前结果中可管理的成员"></th>':''}<th>成员 / 部门</th><th>角色与状态</th><th class="numeric">预算</th><th class="numeric">已消费</th><th class="numeric">在途</th><th class="numeric">可用额度</th><th>操作</th></tr></thead><tbody id="e-rows"></tbody></table></div><div class="e-table-foot">每个成员独立追踪；调拨不改变企业余额。${state.policy.scope==='all'?'':'当前仅展示授权范围。'}</div></section>`;}
  function rows(){
    const body=document.getElementById('e-rows');if(!body)return;
    const list=filtered();body.innerHTML=list.length?list.map(m=>{const editable=state.policy.manage&&!['removed','pending'].includes(m.status)&&(m.role!=='admin'||state.policy.appoint);return `<tr>${state.policy.manage?`<td><input type="checkbox" data-emember="${m.id}" aria-label="选择${esc(m.name)}" ${selected.has(m.id)?'checked':''} ${editable?'':'disabled'}></td>`:''}<td><div class="e-member"><span class="e-avatar">${esc(m.name.slice(-1))}</span><div><b>${esc(m.name)}</b><small>${m.id} · ${m.department}</small></div></div></td><td><span class="e-role">${roleLabels[m.role]}</span>${badge(m)}</td><td class="numeric">${money(m.budget)}</td><td class="numeric">${money(m.spent)}</td><td class="numeric e-muted">${money(m.held)}</td><td class="numeric"><b>${money(state.remaining(m))}</b><div class="e-meter"><i style="width:${m.budget?Math.min(100,Math.round((m.spent+m.held)/m.budget*100)):0}%"></i></div></td><td><div class="e-row-actions"><button data-eaction="detail" data-id="${m.id}">详情</button>${editable?`<button data-eaction="adjust" data-id="${m.id}">调额</button><button data-eaction="status" data-id="${m.id}">${m.status==='paused'?'恢复':'暂停'}</button>`:''}</div></td></tr>`;}).join(''):'<tr><td colspan="8" class="empty-state">没有匹配的成员，请调整筛选。</td></tr>';
    document.getElementById('e-count').textContent=`${list.length} 位成员`;
    const selection=document.getElementById('e-selected');if(selection)selection.textContent=`已选 ${selected.size} 人`;
    const boxes=[...body.querySelectorAll('[data-emember]:not(:disabled)')],all=document.getElementById('e-select-all');
    if(all){all.checked=boxes.length>0&&boxes.every(b=>b.checked);all.indeterminate=boxes.some(b=>b.checked)&&!all.checked;}
  }
  function events(){
    if(state.policy.scope!=='all')return '<div class="info-box">完整企业操作记录仅对获授权的企业管理员与财务展示。当前可通过成员详情查看自己的使用状态。</div>';
    return `<section class="e-panel"><div class="e-panel-title"><h2>操作记录</h2><span class="e-muted">本次预览会话</span></div><div class="e-events">${state.events.map(e=>`<article><span class="e-event-mark"><span data-icon=arrow-up-right></span></span><div><b>${e.action}</b><p>${esc(e.detail)}</p><small>${e.actor} · ${e.time}</small></div></article>`).join('')}</div></section>`;
  }
  function approvals(){const list=state.requests.filter(r=>{try{return !!state.get(r.member);}catch{return false;}});return `<section class="e-panel"><div class="e-panel-title"><h2>额度申请</h2>${isMember()?'<button class="button primary" data-eaction="request">申请更多额度</button>':''}</div>${list.length?list.map(r=>`<article class="e-request"><div><b>陈晨 · 申请增加 ${money(r.amount)}</b><p>${esc(r.reason)}</p><small>${{pending:'等待处理',approved:'已通过',rejected:'已拒绝'}[r.status]}</small></div>${r.status==='pending'&&state.policy.manage?`<div class="e-row-actions"><button data-eaction="approve" data-request="${r.id}">通过</button><button data-eaction="reject" data-request="${r.id}">拒绝</button></div>`:''}</article>`).join(''):'<div class="e-empty">暂时没有额度申请。切换到普通成员预览，可体验申请流程。</div>'}</section>${events()}`;}
  function projects(){return `<section class="e-panel"><div class="e-panel-title"><div><h2>企业项目与接入</h2><p>成员 Key 绑定企业、项目和使用者</p></div></div><div class="e-projects"><article><span class="family-icon deepseek"><span data-icon=layers></span></span><h3>研发助手</h3><p>研发部 · DeepSeek / GLM</p><div class="e-key">sk-demo-••••-not-valid</div><small>不可调用的演示标识 · 不展示或生成真实密钥</small></article>${state.policy.scope==='all'?'<article><span class="family-icon glm"><span data-icon=layers></span></span><h3>业务知识库</h3><p>业务部 · DeepSeek</p><div class="e-key">未启用服务账户</div><small>服务账户单独归属项目，不冒用成员身份</small></article>':''}</div><div class="e-inset-note">正式接入将验证客户端版本、模型协议、Key 权限和费用限制。当前演示不会修改 WorkBuddy、Codex 或 Claude Code 的配置。</div></section>`;}
  function usage(){const members=visibleMembers();return `<section class="e-panel"><div class="e-panel-title"><div><h2>按成员查看使用情况</h2><p>固定演示快照 · 请求数和金额均为样例</p></div></div><div class="e-usage">${members.filter(m=>m.spent>0).map(m=>`<div><span>${esc(m.name)}<small>${m.department}</small></span><div class="e-usage-track"><i style="width:${Math.max(2,m.spent/100)}%"></i></div><strong>${money(m.spent)}</strong><small>${m.requests} 次</small></div>`).join('')}</div><div class="e-inset-note">正式产品按输入、输出、缓存 tokens 和有效价格计算费用。token 使用量不作为员工绩效评分；基础用量分析不展示提示词或输出正文。</div></section>`;}
  function billing(){return state.policy.scope!=='all'?'<div class="info-box">企业账单仅向有账单权限的人员开放。你可以在“用量与分析”查看获授权的费用。</div>':`<section class="e-panel"><div class="e-panel-title"><h2>企业资金</h2><span class="status paused">真实支付未接通</span></div><div class="e-funding"><div><span>累计充值 · 演示</span><strong>¥1,000.00</strong><p>账单归属：企业 A · 中国区 · CNY</p></div><button class="button secondary" data-eaction="payment-info">查看充值建设进度</button></div><div class="e-inset-note">成员预算分配不产生付款订单。企业退款需处理已消费、在途和不可退权益；赠送额度与现金分开记录。</div></section>${events()}`;}
  function settings(){return `<section class="e-panel"><div class="e-panel-title"><h2>身份与权限边界</h2></div><div class="e-settings">${[['当前工作区','企业 A · 中国区'],['客户身份','customer'],['当前演示角色',state.policy.label],['管理范围',state.policy.scope==='all'?'全企业':state.policy.scope==='self'?'仅本人':state.policy.scope],['权限说明','角色决定能做什么，范围决定能管理谁'],['平台员工','独立员工身份域；企业管理员不能进入真实运营后台'],['企业数据','个人和其他企业的余额、Key、项目不会自动共享']].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div></section>`;}
  function render(){
    const target=document.getElementById('enterprise-view');if(!target)return;
    const current=menus.find(m=>m[0]===panel)||menus[0];
    const descriptions={overview:'企业资金与团队使用，一处掌握。',members:'把合适的额度交给合适的人，每一笔使用都清楚。',budget:'在授权范围内调整预算，已消费和在途金额保留。',projects:'按项目接入模型，让每个 Key 都有明确归属。',usage:'看清谁在使用、用了多少，以及费用花在哪里。',billing:'统一充值与账单，成员预算由企业自主安排。',approvals:'让额度申请、批准与调整都有记录。',settings:'明确每个人的角色、范围和有效权限。'};
    target.innerHTML=`<div class="enterprise-layout"><aside class="e-sidebar"><a class="brand" href="#market"><img class="brand-wordmark" src="semifly-wordmark.svg" alt="semifly"><span class="brand-product">OneAPI</span></a><button class="e-workspace" data-eaction="workspace"><span class="e-workspace-icon">A</span><span><b>企业 A</b><small>客户工作台 · 中国区</small></span><span><span data-icon=chevron-down></span></span></button><span class="e-nav-label">企业工作空间</span><nav>${menus.filter(m=>!isMember()||!['billing','settings'].includes(m[0])).map(([id,icon,label])=>`<button class="${panel===id?'active':''}" data-epanel="${id}"><span>${icon}</span>${isMember()&&id==='members'?'我的额度':label}${id==='approvals'&&state.requests.some(r=>r.status==='pending')?'<i>待办</i>':''}</button>`).join('')}</nav><div class="e-sidebar-foot"><span class="e-avatar">${isMember()?'晨':'A'}</span><div><b>${state.policy.label}</b><small>客户身份 · 演示</small></div></div></aside><div class="e-main-wrap"><header class="e-top"><span>企业工作台 <i>/</i> ${isMember()&&panel==='members'?'我的额度':current[2]}</span><a href="#login">切换入口 <span data-icon=arrow-up-right></span></a></header><main class="e-main"><div class="e-preview-note"><span><i class="spectrum-dot"></i> 企业管理交互预览 · 刷新恢复初始数据</span><label>预览身份 <select id="e-actor" aria-label="切换企业演示身份">${Object.entries(EnterpriseDemo.roles).map(([id,p])=>`<option value="${id}" ${state.actor===id?'selected':''}>${p.label}</option>`).join('')}</select></label></div><div class="e-heading"><div><div class="eyebrow">ENTERPRISE WORKSPACE</div><h1>${isMember()&&panel==='members'?'我的使用额度':current[2]}</h1><p>${descriptions[panel]}</p></div><div class="e-heading-actions">${state.policy.manage?'<button class="button secondary" data-eaction="transfer"><span data-icon=arrow-left-right></span> 调拨额度</button>':''}${isMember()?'<button class="button primary" data-eaction="request">申请更多额度</button>':'<button class="button primary" data-eaction="'+(state.policy.manage?'invite':'payment-info')+'">'+(state.policy.manage?'<span data-icon=plus></span> 邀请成员':'账单说明')+'</button>'}</div></div>${statCards()}<div class="e-content">${['overview','members','budget'].includes(panel)?table():panel==='usage'?usage():panel==='projects'?projects():panel==='approvals'?approvals():panel==='billing'?billing():settings()}${panel==='overview'?usage():''}${panel==='budget'?events():''}</div><footer class="e-footer"><span>仅演示企业管理流程 · 未启用真实身份、收款或模型调用</span><button data-eaction="reset">重置演示</button></footer></main></div></div>`;
    rows();
  }
  function modal(title,body,submit,form=''){showDialog(`<div class="dialog-kicker">ENTERPRISE A · 交互预览</div><h2 class="dialog-title">${esc(title)}</h2>${form?`<form id="${form}">`:''}${body}<p class="e-form-error" id="e-error" role="alert"></p><div class="dialog-bottom"><span>只修改当前页面的演示数据</span>${form?`<button type="submit" class="button primary">${submit}</button>`:'<button class="button secondary" data-close-dialog>关闭</button>'}</div>${form?'</form>':''}`);}
  function options(members,chosen){return members.map(m=>`<option value="${m.id}" ${m.id===chosen?'selected':''}>${esc(m.name)} · ${m.department} · 可用 ${money(state.remaining(m))}</option>`).join('');}
  function transferDialog(){const list=visibleMembers().filter(m=>['active','paused'].includes(m.status)&&(m.role!=='admin'||state.policy.appoint));modal('调拨成员额度',`<p class="dialog-description">企业总资金不变，仅调拨尚未消费且未被请求占用的额度。</p><label class="choice-label" for="e-from">转出成员</label><select class="dialog-field" id="e-from">${options(list,'M1')}</select><label class="choice-label" for="e-to">接收成员</label><select class="dialog-field" id="e-to">${options(list.filter(m=>m.status==='active'),'M2')}</select><label class="choice-label" for="e-amount">调拨金额（元）</label><input class="simple-input" id="e-amount" inputmode="decimal" value="40" required><div class="info-box" id="e-transfer-summary"></div>`,'确认调拨','e-transfer-form');transferSummary();}
  function transferSummary(){try{const a=state.get($('#e-from').value),b=state.get($('#e-to').value),amount=EnterpriseDemo.cents($('#e-amount').value);$('#e-transfer-summary').textContent=`${a.name} 可调出 ${money(state.remaining(a))}，已消费 ${money(a.spent)}、在途 ${money(a.held)} 不可转出。调拨后预算：${a.name} ${money(a.budget-amount)}；${b.name} ${money(b.budget+amount)}。`;}catch{$('#e-transfer-summary').textContent='选择双方成员并输入有效金额，即可查看变更预览。';}}
  let adjusting=[];
  const actions={
    transfer:transferDialog,
    invite:()=>modal('邀请企业成员',`<p class="dialog-description">预览企业自主管理成员的流程。本页不发送邀请，请使用演示称呼。</p><label class="choice-label" for="e-invite-name">演示成员称呼</label><input class="simple-input" id="e-invite-name" maxlength="30" placeholder="例如：新同事" required><label class="choice-label" for="e-invite-department">所属部门</label><select class="dialog-field" id="e-invite-department">${['研发部','业务部'].filter(d=>state.policy.scope==='all'||state.policy.scope===d).map(d=>`<option>${d}</option>`).join('')}</select><label class="choice-label" for="e-invite-role">成员角色</label><select class="dialog-field" id="e-invite-role">${Object.entries(roleLabels).filter(([r])=>['member','viewer'].includes(r)||(state.policy.appoint&&['billing','admin'].includes(r))).map(([r,l])=>`<option value="${r}">${l}</option>`).join('')}</select><div class="info-box">新成员状态为“待加入”，初始额度为零。正式版本在接受邀请并验证身份后开通。</div>`,'创建邀请预览','e-invite-form'),
    adjust:b=>adjustDialog([b.dataset.id]),batch:()=>{if(!selected.size)return showToast('请先勾选需要调整的成员。');adjustDialog([...selected]);},
    detail:b=>{const m=state.get(b.dataset.id);modal(m.name+' · 成员详情',`<div class="e-detail-grid">${[['所属部门',m.department],['角色',roleLabels[m.role]],['状态',labels[m.status]],['使用范围','企业 A 的获授权项目'],['已消费',money(m.spent)],['在途占用',money(m.held)],['可用额度',money(state.remaining(m))],['示例请求数',m.requests+' 次']].map(([k,v])=>`<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div><div class="info-box">企业成员不拥有平台员工权限。此处只展示费用和权限，不展示提示词、输出正文或真实 Key。</div>${state.policy.manage&&['active','paused'].includes(m.status)?`<button class="e-danger" data-eaction="remove" data-id="${m.id}">移除成员…</button>`:''}`);},
    status:b=>statusDialog(b.dataset.id,false),remove:b=>statusDialog(b.dataset.id,true),
    request:()=>modal('申请更多使用额度','<p class="dialog-description">向企业管理员申请增加本人预算。批准后才会生效。</p><label class="choice-label" for="e-request-amount">申请增加金额（元）</label><input class="simple-input" id="e-request-amount" value="20" inputmode="decimal" required><label class="choice-label" for="e-request-reason">申请原因</label><input class="simple-input" id="e-request-reason" maxlength="100" placeholder="例如：本周增加了研发测试任务" required>','提交申请预览','e-request-form'),
    approve:b=>{try{state.review(Number(b.dataset.request),true);render();showToast('申请已通过，成员预算已增加。');}catch(e){showInfo('暂时无法通过申请',esc(e.message),'<div class="info-box">可先回收其他成员未使用预算到企业池，再处理申请。</div>');}},
    reject:b=>{state.review(Number(b.dataset.request),false);render();showToast('已拒绝该演示申请。');},
    'payment-info':()=>showInfo('真实充值尚未启用','当前仅演示企业账单归属与预算管理。','<div class="info-box">正式付款将由企业计费账户创建订单，服务端确认到账后增加可用资金；之后才能分配新预算。当前页面不会收款。</div>'),
    workspace:()=>showInfo('选择工作区','工作区之间的资金、项目和权限独立。','<div class="e-workspace-choices"><a class="button secondary" href="#personal" data-close-dialog>个人工作区 <span data-icon=arrow-up-right></span></a><button class="button primary" data-close-dialog>企业 A · 当前工作区</button></div><div class="info-box">正式版本只列出当前账户有权进入的企业；入口选择不能授予权限。</div>'),
    reset:()=>{modal('重置演示数据','<p class="dialog-description">清除本标签页刚才的预算调整、成员邀请和申请记录，恢复企业 ¥1,000、10 人各 ¥100 的初始快照。</p>','重置演示','e-reset-form');}
  };
  function adjustDialog(ids){adjusting=ids;const m=state.get(ids[0]);modal(ids.length>1?'批量设置成员预算':'调整 '+m.name+' 的预算',`<p class="dialog-description">选中 ${ids.length} 位成员。设置的是调整后的总预算，包含已消费和在途占用。</p><label class="choice-label" for="e-budget">调整后每人总预算（元）</label><input class="simple-input" id="e-budget" inputmode="decimal" value="${(m.budget/100).toFixed(2)}" required><div class="info-box">${state.policy.scope==='all'?'企业未分配额度 '+money(state.totals().unassigned)+'。':'部门新增预算需企业管理员分配；本部门可使用“调拨额度”。'}全部成员校验成功后一起变更。</div>`,'确认调整','e-adjust-form');}
  let changing=null;
  function statusDialog(id,remove){const m=state.get(id);changing={id,next:remove?'removed':m.status==='paused'?'active':'paused'};modal(remove?'移除 '+m.name:changing.next==='active'?'恢复 '+m.name:'暂停 '+m.name,`<p class="dialog-description">${remove?'撤销该企业成员访问，回收未使用额度；保留历史费用和在途结算。':changing.next==='active'?'恢复该成员的演示使用状态；可用额度仍按当前预算计算。':'阻止该成员发起新调用，默认保留使用预算。'}</p><div class="info-box">可回收 ${money(state.remaining(m))}；已消费 ${money(m.spent)}、在途 ${money(m.held)} 保留。</div>${!remove&&changing.next==='paused'?'<label class="e-check"><input type="checkbox" id="e-reclaim"> 同时回收未使用额度到企业池</label>':''}`,'确认'+(remove?'移除':changing.next==='active'?'恢复':'暂停'),'e-status-form');}
  function entryViews(){
    $('#login-view').innerHTML=`<div class="welcome-page">
  <header class="welcome-header">
    <a class="welcome-brand" href="#market" aria-label="semifly OneAPI 模型广场"><img src="semifly-wordmark.svg" alt="semifly"><span>OneAPI</span></a>
    <nav aria-label="欢迎页导航"><a href="#market">发现好模型 <span data-icon="arrow-up-right"></span></a><a class="welcome-staff" href="#staff" aria-label="管理台：本公司员工入口">管理台</a></nav>
  </header>
  <main class="welcome-main">
    <div class="universe-scene" aria-hidden="true"><canvas id="universe-canvas"></canvas><div class="universe-nebula"></div><div id="solar-bodies"></div><div class="universe-near-world"></div></div>
    <div class="universe-caption" aria-hidden="true"><span>太阳系 · 动态示意</span><span>ANDROMEDA / 仙女星系</span></div>
    <section class="welcome-story" aria-labelledby="welcome-title">
      <div class="welcome-story-top"><span class="welcome-kicker"><i></i> A LITTLE SPARK. A BIG IDEA.</span><span class="welcome-edition">semifly / 01</span><a class="universe-compare" href="#login">返回轻快版 <span data-icon="arrow-up-right"></span></a></div>
      <div class="welcome-copy"><h1 id="welcome-title">让灵感，<br><span>起飞一下。</span><svg class="welcome-underline" viewBox="0 0 440 24" aria-hidden="true"><path d="M5 15Q195 -3 429 12M125 21Q270 10 432 17"/></svg></h1><p><span class="welcome-original-description">写点代码，做个作品，试试新想法。<br>好模型在这里，下一步由你。</span><span class="universe-description">从一束灵感，去往更大的世界。<br>下一次发现，从这里开始。</span></p></div>
      <div class="welcome-art" aria-hidden="true">
        <svg class="welcome-orbit" viewBox="0 0 760 340" fill="none">
          <defs><linearGradient id="welcome-orb" x1="538" y1="58" x2="599" y2="124" gradientUnits="userSpaceOnUse"><stop stop-color="#d9ffe0"/><stop offset="1" stop-color="#79bf94"/></linearGradient></defs>
          <ellipse cx="364" cy="171" rx="271" ry="92" transform="rotate(-18 364 171)" stroke="#c5c0e1" stroke-width="1.4"/>
          <path d="M108 242C40 200 195 88 385 74C517 64 675 105 620 168" stroke="#6052c7" stroke-width="2.5" stroke-linecap="round"/>
          <g class="welcome-flower" transform="translate(361 161)"><g class="welcome-flower-spin" fill="#ff7a30"><rect x="-27" y="-105" width="54" height="210" rx="27"/><rect x="-27" y="-105" width="54" height="210" rx="27" transform="rotate(45)"/><rect x="-27" y="-105" width="54" height="210" rx="27" transform="rotate(90)"/><rect x="-27" y="-105" width="54" height="210" rx="27" transform="rotate(135)"/><circle r="42" fill="#ffb28a"/><circle r="21" fill="#f6f2ff"/></g></g>
          <path d="M105 205C59 250 193 289 379 247C524 215 650 144 629 104" stroke="#6052c7" stroke-width="2.5" stroke-linecap="round"/>
          <g class="welcome-orb"><circle cx="572" cy="103" r="38" fill="url(#welcome-orb)"/><ellipse cx="572" cy="103" rx="19" ry="38" stroke="#65a980" stroke-width="1"/><path d="M538 87C555 99 589 99 606 87M537 119C555 108 589 108 606 119" stroke="#65a980" stroke-width="1"/></g>
          <circle cx="153" cy="246" r="10" fill="#6052c7"/><circle cx="646" cy="223" r="5" fill="#ff7a30"/><circle cx="168" cy="92" r="4" fill="#aca2ce"/>
          <path d="M223 49v22m-11-11h22M669 139v16m-8-8h16" stroke="#878198" stroke-width="1.5" stroke-linecap="round"/>
          <path d="m644 40 9-17 4 15 16 4-17 8" stroke="#6052c7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="welcome-art-note">a little more possibility.</span>
      </div>
      <div class="welcome-story-foot"><span>为每一个想动手的你。</span><span class="welcome-play-label"><i></i> IDEAS IN MOTION</span><span class="solar-state" id="solar-state" role="status">公转中</span><label class="solar-speed">速度 <select id="solar-speed" aria-label="公转演示速度"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label><button class="welcome-motion" type="button" data-welcome-motion aria-pressed="false" aria-label="暂停装饰动效"><span data-motion-label>暂停动效</span></button></div>
    </section>
    <section class="welcome-entry" aria-labelledby="welcome-entry-title">
      <div class="welcome-entry-inner">
        <span class="welcome-hello">HELLO, YOU <span class="welcome-hello-dot"></span></span>
        <h2 id="welcome-entry-title">很高兴见到你。</h2>
        <p class="welcome-entry-lead">一个人的灵感，一群人的可能。</p>
        <div class="welcome-choices" role="group" aria-label="选择工作空间">
          <button type="button" data-welcome-space="personal" aria-pressed="true"><span data-icon="user-round"></span>个人</button>
          <button type="button" data-welcome-space="enterprise" aria-pressed="false"><span data-icon="building-2"></span>企业团队</button>
        </div>
        <div class="welcome-space-copy" aria-live="polite" aria-atomic="true"><span class="welcome-space-index" id="welcome-space-index">01 / MY SPACE</span><h3 id="welcome-space-title">给自己的灵感，留个位置。</h3><p id="welcome-space-description">发现适合你的模型，开始下一个小作品。<br>项目与用量，都在自己的空间里。</p></div>
        <a class="welcome-continue" id="welcome-continue" href="#personal"><span id="welcome-continue-label">进入个人空间</span><span class="welcome-continue-arrow" data-icon="arrow-right"></span></a>
        <p class="welcome-preview-note"><span></span>体验预览 · 暂未开放真实登录</p>
        <div class="welcome-explore"><span>还想先看看？</span><a href="#market">逛逛模型广场 <span data-icon="arrow-up-right"></span></a></div>
      </div>
      <div class="welcome-entry-foot"><span class="welcome-mini-line"></span><span>GOOD TO HAVE YOU HERE.</span></div>
    </section>
  </main>
  <footer class="welcome-footer"><span>semifly · 为好想法多走一步</span><span>深圳市格洛可半导体有限公司</span></footer>
</div>
`;
    $('#staff-view').innerHTML=`<main class="staff-entry"><a class="brand" href="#market"><img class="brand-wordmark" src="semifly-wordmark.svg" alt="semifly"><span class="brand-product">OneAPI</span></a><section class="staff-card"><span class="staff-emblem" data-icon="shield-check"></span><div class="eyebrow">STAFF CONSOLE</div><h1>员工管理台</h1><p>供深圳市格洛可半导体有限公司内部员工使用。</p><div class="info-box">当前为运营界面预览，员工身份验证尚未接通。正式上线后，仅已授权员工可按岗位进入管理台。</div><a class="button secondary" href="#admin">预览运营后台 <span data-icon="arrow-right"></span></a></section><a class="text-button" href="#login">客户登录 <span data-icon="arrow-right"></span></a></main>`;
    $('#personal-view').innerHTML=`<main class="e-personal"><header><a class="brand" href="#market"><img class="brand-wordmark" src="semifly-wordmark.svg" alt="semifly"><span class="brand-product">OneAPI</span></a><a href="#login">切换入口 <span data-icon=arrow-up-right></span></a></header><div class="eyebrow">PERSONAL WORKSPACE</div><h1>我的工作台</h1><p>个人项目、余额与用量。与企业 A 的资金和权限分别管理。</p><div class="e-stats"><article><span>个人余额 · 演示</span><strong>¥58.40</strong><small>不计入企业 A 的 ¥1,000</small></article><article><span>个人项目</span><strong>1</strong><small>个人实验室 · 演示</small></article><article><span>真实 API Key</span><strong>未创建</strong><small>等待身份与调用服务接入</small></article><article><span>身份</span><strong>个人客户</strong><small>customer · 个人工作区</small></article></div><section class="e-panel"><div class="e-panel-title"><h2>从模型开始</h2></div><div class="e-personal-actions"><a class="button primary" href="#market">浏览模型广场 <span data-icon=arrow-right></span></a><a class="button secondary" href="#enterprise">进入企业 A 工作台 <span data-icon=arrow-right></span></a></div><div class="e-inset-note">此处是独立的个人演示快照。企业额度不足时不会自动扣个人余额，切换工作区也不会转移资金。</div></section></main>`;
  }
  document.addEventListener('click',event=>{
    const b=event.target.closest('button,a');if(!b)return;
    if(b.dataset.welcomeSpace){
      const enterprise=b.dataset.welcomeSpace==='enterprise';
      document.querySelectorAll('[data-welcome-space]').forEach(button=>button.setAttribute('aria-pressed',String(button===b)));
      $('#welcome-space-index').textContent=enterprise?'02 / TOGETHER':'01 / MY SPACE';
      $('#welcome-space-title').textContent=enterprise?'好点子，一起做成真。':'给自己的灵感，留个位置。';
      $('#welcome-space-description').innerHTML=enterprise?'和同事一起探索，把想法变成共同的作品。<br>成员、预算与使用情况，在一处安排。':'发现适合你的模型，开始下一个小作品。<br>项目与用量，都在自己的空间里。';
      $('#welcome-continue').href=enterprise?'#enterprise':'#personal';
      $('#welcome-continue-label').textContent=enterprise?'进入企业空间':'进入个人空间';
      $('.welcome-page').classList.toggle('welcome-team',enterprise);
    }
    if(b.hasAttribute('data-welcome-motion')){
      const paused=$('.welcome-page').classList.toggle('welcome-motion-paused');
      b.setAttribute('aria-pressed',String(paused));b.setAttribute('aria-label',paused?'播放装饰动效':'暂停装饰动效');
      b.querySelector('[data-motion-label]').textContent=paused?'播放动效':'暂停动效';
      window.UniverseScene?.setPaused(paused);
    }
    if(b.dataset.epanel){panel=b.dataset.epanel;selected.clear();render();}
    if(b.dataset.eaction){try{actions[b.dataset.eaction]?.(b);}catch(e){showToast(e.message);}}
    if(b.matches('a[data-close-dialog]'))$('#config-dialog').close();
  });
  document.addEventListener('change',e=>{
    const t=e.target;
    if(t.id==='e-actor'){state.setActor(t.value);selected.clear();query='';department='all';status='all';panel='members';render();}
    if(t.id==='e-department'){department=t.value;selected.clear();rows();}
    if(t.id==='e-status'){status=t.value;selected.clear();rows();}
    if(t.dataset.emember){if(t.checked)selected.add(t.dataset.emember);else selected.delete(t.dataset.emember);rows();}
    if(t.id==='e-select-all'){const boxes=[...document.querySelectorAll('[data-emember]:not(:disabled)')];boxes.forEach(b=>t.checked?selected.add(b.dataset.emember):selected.delete(b.dataset.emember));rows();}
    if(['e-from','e-to'].includes(t.id))transferSummary();
  });
  document.addEventListener('input',e=>{if(e.target.id==='e-search'){query=e.target.value;selected.clear();rows();}if(e.target.id==='e-amount')transferSummary();});
  document.addEventListener('submit',e=>{
    if(!e.target.id.startsWith('e-'))return;e.preventDefault();
    try{
      switch(e.target.id){
        case 'e-transfer-form':state.transfer($('#e-from').value,$('#e-to').value,EnterpriseDemo.cents($('#e-amount').value));break;
        case 'e-adjust-form':state.allocate(adjusting,EnterpriseDemo.cents($('#e-budget').value));selected.clear();break;
        case 'e-invite-form':state.invite($('#e-invite-name').value,$('#e-invite-department').value,$('#e-invite-role').value);break;
        case 'e-status-form':state.status(changing.id,changing.next,!!$('#e-reclaim')?.checked);break;
        case 'e-request-form':state.request(EnterpriseDemo.cents($('#e-request-amount').value),$('#e-request-reason').value);panel='approvals';break;
        case 'e-reset-form':state=new EnterpriseDemo.Workspace();selected.clear();panel='members';query='';department='all';status='all';break;
        default:return;
      }
      $('#config-dialog').close();render();showToast('演示操作已完成；刷新页面恢复，不影响真实账户。');
    }catch(error){$('#e-error').textContent=error.message;}
  });
  window.EnterpriseUI={render};entryViews();render();
  switchView(['login','enterprise','personal','admin','staff','universe'].includes(location.hash.slice(1))?location.hash.slice(1):'market');
})();
