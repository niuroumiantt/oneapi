/* Sales review fixtures. This script is served only by the loopback staff preview. */
(() => {
 'use strict';

 const snapshotDay = '2026-11-27';
 const number = new Intl.NumberFormat('zh-CN');
 const count = value => number.format(value);
 const money = value => '¥' + count(value);
 const escape = text => String(text).replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
 }[char]));
 const goals = { revenue:50000, customer:30, vip:10 };

 // Each channel records net receipts, consumption, acquired accounts and issued codes.
 const point = (label, customer, vip) => {
  const [customerRevenue, customerSpend, customers, customerCodes] = customer;
  const [vipRevenue, vipSpend, vips, vipCodes] = vip;
  return { label, customerRevenue, customerSpend, customers, customerCodes, vipRevenue, vipSpend, vips, vipCodes };
 };
 const month = [
  point('11.01–07', [5180,4040,4,6], [3450,2600,1,3]),
  point('11.08–14', [5980,5450,6,8], [4520,3520,2,3]),
  point('11.15–21', [7000,6200,7,8], [4560,4800,2,4]),
  point('11.22–27', [6490,5780,7,10], [5500,5430,3,5])
 ];
 const today = [
  point('09:00–12:00', [280,170,1,1], [0,260,0,0]),
  point('12:00–15:00', [610,240,1,1], [720,380,1,1]),
  point('15:00–18:00', [460,410,0,2], [810,540,0,1])
 ];
 const summarize = (rows, label='') => ({
  ...rows.reduce((sum, row) => {
   for(const key of Object.keys(sum))sum[key]+=row[key];
   return sum;
  }, Object.fromEntries(Object.keys(rows[0]).filter(key=>key!=='label').map(key=>[key,0]))), label
 });
 const periods = {
  month:{ label:'本月', dates:'11 月 1 日至 11 月 27 日', rows:month },
  today:{ label:'今日', dates:'11 月 27 日', rows:today },
  all:{ label:'累计', dates:'8 月 1 日至 11 月 27 日', rows:[
   point('08 月', [11700,8200,14,19], [4300,3900,2,5]),
   point('09 月', [16500,13200,21,27], [9720,7750,4,9]),
   point('10 月', [22100,19700,23,30], [13230,11100,6,12]),
   summarize(month,'11 月')
  ]}
 };

 const kinds = { complaint:'投诉', feedback:'意见反馈', request:'客户请求', vip:'VIP 转正申请', discount:'折扣申请' };
 const statuses = { action:'待我处理', review:'待老板审批', closed:'已处理' };
 const tasks = [
  { id:'CS-042', kind:'complaint', subject:'调用超时与扣费核对', customer:'云帆科技', due:'2026-11-26', status:'action', next:'核对失败请求与扣费记录，回复客户。', context:'客户报告批量调用出现超时，要求核对对应请求是否发生扣费。' },
  { id:'VIP-014', kind:'vip', subject:'试用结束，申请转为正式 VIP', customer:'山岚研究', due:'2026-11-27', status:'action', next:'核对试用记录和转正材料，再提交老板。', context:'客户已提交公司资料和使用计划，需要销售补充试用回访记录。' },
  { id:'RQ-021', kind:'request', subject:'提供团队 API 接入指引', customer:'橙光数据', due:'2026-11-27', status:'action', next:'整理接入步骤并回复客户。', context:'客户准备在团队工具里接入 API，需要了解支持的模型和用量查看方法。' },
  { id:'FB-016', kind:'feedback', subject:'建议用量明细支持按项目筛选', customer:'北辰设计', due:'2026-11-28', status:'action', next:'确认使用场景，记录意见并告知客户。', context:'客户希望区分三个项目的 API 消耗，以便按项目核对预算。' },
  { id:'DS-009', kind:'discount', subject:'申请续费折扣', customer:'北辰设计', due:'2026-11-29', status:'action', next:'补齐客户的预计用量和申请理由，再提交老板。', context:'客户希望为下月新增项目申请续费优惠，销售正在收集预算和用量。' },
  { id:'DS-008', kind:'discount', subject:'申请企业客户首单优惠', customer:'松石互动', due:'2026-11-28', status:'review', next:'等待老板审批，审批完成后反馈客户。', context:'销售已提交首单用量预估与折扣理由。' },
  { id:'VIP-011', kind:'vip', subject:'提交 VIP 转正材料', customer:'启明云图', due:'2026-11-30', status:'review', next:'等待老板审核资料。', context:'试用回访和申请资料已提交。' },
  { id:'CS-038', kind:'complaint', subject:'充值到账时间咨询', customer:'江屿工作室', due:'2026-11-26', status:'closed', next:'客户已确认到账。', context:'已核对充值订单并回复客户。' }
 ];
 const needsApproval = task => ['vip','discount'].includes(task.kind);
 const actionCount = () => tasks.filter(task=>task.status==='action').length;
 const overdue = task => task.status==='action' && task.due < snapshotDay;
 const view = { period:'month', chartIndex:null, status:'action', kind:'all', query:'', taskId:null };
 const arrow = '<span aria-hidden="true">→</span>';
 const statusBadge = (status,label=statuses[status]) => `<span class="sales-status is-${status}">${label}</span>`;
 const pageLink = (page,label) => `<button type="button" class="sales-link" data-go="${page}">${label} ${arrow}</button>`;

 const breakdownLabels = ['推广成功','发出邀请码','消费金额','销售收入'];
 function channelRow(label, values, page) {
  return `<tr><th scope="row">${pageLink(page,label)}</th>${values.map((value,index)=>`<td data-label="${breakdownLabels[index]}">${value}</td>`).join('')}</tr>`;
 }

 function chart(period, total) {
  const { rows } = period;
  const peak = Math.max(...rows.map(row=>row.customerRevenue+row.vipRevenue));
  const step = Math.ceil(peak / 4 / 1000) * 1000;
  const limit = step * 4;
  const selected = rows[view.chartIndex] || total;
  return `<section class="sales-chart sales-panel" aria-labelledby="sales-chart-title">
   <div class="sales-section-head"><div><h2 id="sales-chart-title">销售收入趋势</h2><p>${period.dates}</p></div>
   <div class="sales-legend"><span><i></i>客户</span><span><i></i>VIP</span></div></div>
   <div class="sales-chart-body">
    <div class="sales-axis" aria-hidden="true">${[4,3,2,1,0].map(mark=>`<span>${count(mark*step)}</span>`).join('')}</div>
    <div class="sales-plot" aria-label="分时段销售收入，单位为元">
     ${rows.map((row,index)=>`<div class="sales-bar-group"><div class="sales-bar-track">
      <button type="button" class="sales-bar" data-sales-bar="${index}" aria-pressed="${view.chartIndex===index}" aria-label="${row.label}，客户 ${money(row.customerRevenue)}，VIP ${money(row.vipRevenue)}"
       style="--customer-height:${row.customerRevenue/limit*100}%;--vip-height:${row.vipRevenue/limit*100}%">
       <span class="sales-bar-customer"></span><span class="sales-bar-vip"></span>
      </button></div><span class="sales-tick">${row.label}</span></div>`).join('')}
    </div>
   </div>
   <div class="sales-chart-note" aria-live="polite"><span>${selected.label || '期间合计'}</span><span>客户收入 <strong>${money(selected.customerRevenue)}</strong></span><span>VIP 收入 <strong>${money(selected.vipRevenue)}</strong></span></div>
  </section>`;
 }

 function goal(label, actual, target) {
  const progress = Math.round(actual/target*100);
  return `<div class="sales-goal">
   <div><span>${label}</span><strong>${count(actual)} <small>/ ${count(target)} 位</small></strong></div>
   <progress value="${actual}" max="${target}" aria-label="${label}目标完成率 ${progress}%"></progress>
  </div>`;
 }

 function dashboard() {
  const period = periods[view.period], total = summarize(period.rows), monthly = summarize(month);
  const monthlyRevenue = monthly.customerRevenue + monthly.vipRevenue;
  const selectedRevenue = total.customerRevenue + total.vipRevenue;
  const progress = Math.round(monthlyRevenue/goals.revenue*100);
  const labels = view.period==='month' ? '本月销售收入' : view.period==='today' ? '今日销售收入' : '累计销售收入';
  const pending = actionCount();
  return `<div class="sales-demo">
   <div class="sales-toolbar"><div class="sales-demo-meta"><strong>模拟数据</strong><span>2026 年 11 月 27 日 · 我负责的业务</span></div>
    <div class="sales-periods" role="group" aria-label="统计时间">
     ${Object.entries(periods).map(([id,{label}])=>`<button type="button" data-sales-period="${id}" aria-pressed="${view.period===id}">${label}</button>`).join('')}
    </div>
   </div>
   <section class="sales-score sales-panel" aria-label="销售收入和本月目标">
    <div class="sales-score-main"><span>${labels}</span><strong>${money(selectedRevenue)}</strong><p>客户与 VIP 的净实收</p></div>
    <div class="sales-score-goal"><div class="sales-score-caption"><div><h2>本月销售目标</h2><span>${money(monthlyRevenue)} / ${money(goals.revenue)}</span></div><strong>${progress}%</strong></div>
     <progress value="${monthlyRevenue}" max="${goals.revenue}" aria-label="本月销售收入目标完成率 ${progress}%"></progress><p>距目标还差 ${money(goals.revenue-monthlyRevenue)}</p>
    </div>
    <div class="sales-score-queue"><div><strong>${pending} 项</strong><span>待我处理</span></div>${pageLink('pending','查看待办')}</div>
   </section>
   <section class="sales-panel sales-breakdown" aria-labelledby="sales-breakdown-title">
    <div class="sales-section-head"><div><h2 id="sales-breakdown-title">客户与 VIP 推广成果</h2><p>${period.label} · 收入按净实收统计，消费按已扣费金额统计。</p></div>
     <form id="employeeSearch" class="sales-client-search"><label class="sales-sr-only" for="employeeQuery">查找客户</label><input id="employeeQuery" type="search" placeholder="客户名称、编码或邮箱" required><button type="submit">查找客户</button></form></div>
    <div class="sales-table-wrap"><table>
     <thead><tr><th scope="col">业务方向</th><th scope="col">推广成功</th><th scope="col">发出邀请码</th><th scope="col">消费金额</th><th scope="col">销售收入</th></tr></thead>
     <tbody>
      ${channelRow('普通客户',[count(total.customers)+' 位',count(total.customerCodes)+' 个',money(total.customerSpend),money(total.customerRevenue)],'direct')}
      ${channelRow('VIP',[count(total.vips)+' 位',count(total.vipCodes)+' 个',money(total.vipSpend),money(total.vipRevenue)],'vipcodes')}
     </tbody>
    </table></div>
   </section>
   <div class="sales-two-columns">
    ${chart(period,total)}
    <section class="sales-panel sales-targets" aria-labelledby="sales-target-title">
     <div class="sales-section-head"><div><h2 id="sales-target-title">本月拓展目标</h2><p>新增注册客户与正式 VIP</p></div></div>
     ${goal('普通客户',monthly.customers,goals.customer)}
     ${goal('正式 VIP',monthly.vips,goals.vip)}
     <div class="sales-target-links">${pageLink('customeroverview','客户推广')}${pageLink('vipoverview','VIP 推广')}</div>
    </section>
   </div>
  </div>`;
 }

 function taskList() {
  const query = view.query.toLocaleLowerCase();
  return tasks.filter(task=> (view.status==='all'||task.status===view.status) &&
   (view.kind==='all'||task.kind===view.kind) &&
   (!query||[task.subject,task.customer,task.id].some(text=>text.toLocaleLowerCase().includes(query))));
 }

 function taskDetails(task) {
  if(!task)return '<div class="sales-task-detail sales-task-empty"><p>选择一条事项，查看当前进度和下一步。</p></div>';
  const active = task.status==='action';
  return `<section class="sales-task-detail" aria-labelledby="sales-detail-title">
   <div class="sales-section-head"><span>${task.id} · ${kinds[task.kind]}</span>${statusBadge(task.status)}</div>
   <h2 id="sales-detail-title">${escape(task.subject)}</h2>
   <p>${escape(task.customer)} · ${task.due.slice(5)} 截止</p>
   <p>${escape(task.context)}</p>
   <dl class="sales-task-facts"><div><dt>当前处理人</dt><dd>${active?'我 · 销售':task.status==='review'?'老板':'已结案'}</dd></div>
    <div><dt>下一步</dt><dd>${escape(task.next)}</dd></div></dl>
   ${task.note?`<div class="sales-task-saved"><strong>上次跟进</strong><p>${escape(task.note)}</p></div>`:''}
   ${active?`<form data-sales-note>
    <label for="sales-note">跟进记录</label>
    <textarea id="sales-note" name="note" maxlength="500" rows="3" placeholder="记下已做的处理和客户反馈"></textarea>
    <div class="sales-detail-actions"><button type="submit" value="save">保存跟进</button><button type="submit" class="primary" value="advance">${needsApproval(task)?'提交模拟审批':'标记已处理'}</button></div>
   </form>`:''}
  </section>`;
 }

 function queue(message) {
  const list = taskList();
  const current = list.find(task=>task.id===view.taskId);
  const statusesAndCounts = [['action',actionCount()],['review',tasks.filter(task=>task.status==='review').length],
   ['closed',tasks.filter(task=>task.status==='closed').length],['all',tasks.length]];
  return `<div class="sales-demo sales-queue">
   <div class="sales-toolbar"><div class="sales-demo-meta"><strong>模拟数据</strong><span>2026 年 11 月 27 日 · 我负责的事项</span></div>${pageLink('home','返回今日工作')}</div>
   <section class="sales-panel sales-queue-panel" aria-label="待处理事项列表">
    <div class="sales-queue-toolbar">
     <div class="sales-queue-tabs" role="group" aria-label="事项状态">
      ${statusesAndCounts.map(([key,total])=>`<button type="button" data-sales-status="${key}" aria-pressed="${view.status===key}">${statuses[key]||'全部事项'} <span>${total}</span></button>`).join('')}
     </div>
     <form class="sales-queue-filters" data-sales-filters>
      <label class="sales-sr-only" for="sales-kind">事项类型</label>
      <select id="sales-kind" name="kind"><option value="all">全部类型</option>${Object.entries(kinds).map(([key,label])=>`<option value="${key}"${key===view.kind?' selected':''}>${label}</option>`).join('')}</select>
      <label class="sales-sr-only" for="sales-query">搜索事项</label>
      <input type="search" id="sales-query" name="query" placeholder="搜索事项、客户或编号" value="${escape(view.query)}">
      <button type="submit">搜索</button>
     </form>
    </div>
    <div class="sales-queue-grid">
     <div class="sales-queue-list">
      <div class="sales-list-count"><span>${list.length} 条事项</span>${view.status==='action'?'<span>按截止日期排序</span>':''}</div>
      ${list.map(task=>`<button type="button" class="sales-task-row" data-sales-task="${task.id}" aria-pressed="${task.id===view.taskId}">
       <span class="sales-task-title"><strong>${escape(task.subject)}</strong><small>${kinds[task.kind]} · ${escape(task.customer)}</small></span>
       <span class="sales-task-deadline">${overdue(task)?statusBadge('late','已逾期'):''}<small>${task.due.slice(5)} 截止</small></span>
      </button>`).join('') || '<div class="sales-task-empty"><p>没有符合筛选条件的事项。</p><button type="button" data-sales-reset>清空筛选</button></div>'}
     </div>
     ${taskDetails(current)}
    </div>
    <p class="sales-feedback" role="status">${escape(message||'')}</p>
   </section>
  </div>`;
 }

 function render(page, content, refreshNavigation) {
  if(page==='pending'){
   const list = taskList();
   if(!list.some(task=>task.id===view.taskId))view.taskId=list[0]?.id??null;
  }
  const root = document.createElement('div');
  content.replaceChildren(root);
  const update = (focus,message) => {
   root.innerHTML = page==='home' ? dashboard() : queue(message);
   if(focus)root.querySelector(focus)?.focus({preventScroll:true});
  };
  update();
  root.addEventListener('click',event=>{
   const button = event.target.closest('button');
   if(!button)return;
   const {salesPeriod,salesBar,salesStatus,salesTask} = button.dataset;
   if(salesPeriod){
    view.period=salesPeriod;
    view.chartIndex=null;
    update(`[data-sales-period="${salesPeriod}"]`);
   }else if(salesBar!==undefined){
    const index = Number(salesBar);
    view.chartIndex=view.chartIndex===index?null:index;
    update(`[data-sales-bar="${salesBar}"]`);
   }else if(salesStatus){
    view.status=salesStatus;
    view.taskId=taskList()[0]?.id??null;
    update(`[data-sales-status="${salesStatus}"]`);
   }else if(salesTask){
    view.taskId=salesTask;
    update(`[data-sales-task="${salesTask}"]`);
    if(matchMedia('(max-width: 720px)').matches)root.querySelector('.sales-task-detail')?.scrollIntoView({block:'nearest'});
   }else if(button.hasAttribute('data-sales-reset')){
    Object.assign(view,{status:'all',kind:'all',query:''});
    view.taskId=taskList()[0]?.id??null;
    update('#sales-query');
   }
  });
  const applyFilters = form => {
   const fields = new FormData(form);
   view.kind=String(fields.get('kind'));
   view.query=String(fields.get('query')).trim();
   view.taskId=taskList()[0]?.id??null;
  };
  root.addEventListener('change',event=>{
   if(event.target.id==='sales-kind'){
    applyFilters(event.target.form);
    update('#sales-kind');
   }
  });
  root.addEventListener('submit',event=>{
   const form = event.target;
   if(form.hasAttribute('data-sales-filters')){
    event.preventDefault();
    applyFilters(form);
    update('#sales-query');
   }else if(form.hasAttribute('data-sales-note')){
    event.preventDefault();
    const task = tasks.find(task=>task.id===view.taskId);
    const note = String(new FormData(form).get('note')).trim();
    const advance = event.submitter?.value==='advance';
    if(!note && !advance){
     form.elements.note.setCustomValidity('请填写一条跟进记录。');
     form.elements.note.reportValidity();
     form.elements.note.addEventListener('input',()=>form.elements.note.setCustomValidity(''),{once:true});
     return;
    }
    if(note)task.note=note;
    if(advance){
     task.status=needsApproval(task)?'review':'closed';
     task.next=task.status==='review'?'等待老板审批，审批后再联系客户。':'事项已标记处理完成。';
     view.taskId=taskList()[0]?.id??null;
     refreshNavigation();
    }
    update(advance?`[data-sales-status="${view.status}"]`:'#sales-note', advance ?
     (task.status==='review'?'已提交模拟审批。':'已标记为已处理。'):'已保存跟进记录。');
   }
  });
 }

 window.StaffSalesDemo = { render, actionCount };
})();
