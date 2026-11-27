/* Sales review fixtures. This script is served only by the loopback staff preview. */
(() => {
 'use strict';

 const number = new Intl.NumberFormat('zh-CN');
 const currency = new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',minimumFractionDigits:2,maximumFractionDigits:6});
 const count = value => number.format(value);
 const money = value => currency.format(value);
 const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
 }[char]));
 const blank = { customerRevenue:0,vipRevenue:0,customerSpend:0,vipSpend:0,customers:0,vips:0,customerCodes:0,vipCodes:0 };
 const summarize = rows => rows.reduce((sum,row)=>{
  for(const key of Object.keys(sum))sum[key]+=row[key];
  return sum;
 },{...blank});
 const kinds = { complaint:'投诉', feedback:'意见反馈', request:'客户请求', vip:'VIP 转正申请', discount:'折扣申请' };
 const statuses = { action:'待我处理', review:'待老板审批', technical:'等技术反馈', closed:'已处理' };
 const handlers = {action:'我 · 销售',review:'老板',technical:'技术支持',closed:'已结案'};
 const view = { period:'month', chartIndex:null, status:'action', kind:'all', query:'', taskId:null };
 let data;
 const dateLabel = day => day ? day.slice(0,10) : '';
 const overdue = task => task.status==='action' && task.due && task.due<data.snapshotDay;
 const periodLabels = {month:'本月',today:'今日',all:'累计'};
 const arrow = '<span aria-hidden="true">→</span>';
 const statusBadge = (status,label=statuses[status]) => `<span class="sales-status is-${status}">${label}</span>`;
 const pageLink = (page,label) => `<button type="button" class="sales-link" data-go="${page}">${label} ${arrow}</button>`;

 const breakdownLabels = ['推广成功','发出邀请码','消费金额','销售收入'];
 function channelRow(label, values, page) {
  return `<tr><th scope="row">${pageLink(page,label)}</th>${values.map((value,index)=>`<td data-label="${breakdownLabels[index]}">${value}</td>`).join('')}</tr>`;
 }

 function chart(period, rows, total) {
  const selected = rows[view.chartIndex];
  const extreme = (row,pick) => pick(0,row.customerRevenue)+pick(0,row.vipRevenue);
  const high = Math.max(0,...rows.map(row=>extreme(row,Math.max)));
  const low = Math.min(0,...rows.map(row=>extreme(row,Math.min)));
  const span = high-low;
  const raw = span/4 || 1;
  const magnitude = 10**Math.floor(Math.log10(raw));
  const step = [1,2,5,10].find(value=>value*magnitude>=raw)*magnitude;
  const upper = Math.ceil(high/step)*step, lower = Math.floor(low/step)*step;
  const axis = Array.from({length:Math.round((upper-lower)/step)+1},(_,index)=>upper-step*index);
  const height = value => (upper===lower?0:value/(upper-lower)*100);
  const segment = (key,value,preceding=0) => {
   const start = value*preceding>0 ? preceding : 0;
   return `<span class="sales-bar-${key}" style="bottom:${height(Math.min(start,start+value)-lower)}%;height:${height(Math.abs(value))}%"></span>`;
  };
  return `<section class="sales-chart sales-panel" aria-labelledby="sales-chart-title">
   <div class="sales-section-head"><div><h2 id="sales-chart-title">销售收入趋势</h2><p>${period} · 按净实收</p></div>
   <div class="sales-legend"><span><i></i>客户</span><span><i></i>VIP</span></div></div>
   ${span ? `<div class="sales-chart-body"><div class="sales-axis" aria-hidden="true">${axis.map(value=>`<span>${count(Number(value.toFixed(6)))}</span>`).join('')}</div>
    <div class="sales-plot" aria-label="分时段销售收入，单位为元">
     ${rows.map((row,index)=>`<div class="sales-bar-group"><div class="sales-bar-track" style="--sales-chart-step:${100/(axis.length-1)}%;--sales-zero:${height(-lower)}%">
      <button type="button" class="sales-bar" data-sales-bar="${index}" aria-pressed="${view.chartIndex===index}" aria-label="${escape(row.label)}，客户 ${money(row.customerRevenue)}，VIP ${money(row.vipRevenue)}">
       ${segment('customer',row.customerRevenue)}${segment('vip',row.vipRevenue,row.customerRevenue)}
      </button></div><span class="sales-tick">${escape(row.label)}</span></div>`).join('')}
    </div></div>` : '<div class="sales-task-empty">该期间暂无实收或退款变动。</div>'}
   <div class="sales-chart-note" aria-live="polite"><span>${escape(selected?.label || '期间合计')}</span><span>客户收入 <strong>${money((selected||total).customerRevenue)}</strong></span><span>VIP 收入 <strong>${money((selected||total).vipRevenue)}</strong></span></div>
  </section>`;
 }

 function goal(label, actual) {
  return `<div class="sales-goal"><div><span>${label}</span><strong>${count(actual)} 位</strong></div></div>`;
 }

 function dashboard() {
  const period = periodLabels[view.period], rows = data.periods[view.period] || [], total = summarize(rows);
  const monthly = summarize(data.periods.month);
  const selectedRevenue = total.customerRevenue + total.vipRevenue;
  return `<div class="sales-demo">
   <div class="sales-toolbar"><div class="sales-demo-meta"><span>${escape(data.staffName)} · ${escape(data.snapshotDay)} · 我负责的业务</span></div>
    <div class="sales-periods" role="group" aria-label="统计时间">
     ${Object.entries(periodLabels).map(([id,label])=>`<button type="button" data-sales-period="${id}" aria-pressed="${view.period===id}">${label}</button>`).join('')}
    </div>
   </div>
   <section class="sales-score sales-panel" aria-label="销售收入和本月目标">
    <div class="sales-score-main"><span>${period}销售收入</span><strong>${money(selectedRevenue)}</strong><p>客户与 VIP 的净实收</p></div>
    <div class="sales-score-goal"><div class="sales-score-caption"><div><h2>本月销售目标</h2><span>未设置</span></div></div><p>本月已完成 ${money(monthly.customerRevenue+monthly.vipRevenue)}</p></div>
    <div class="sales-score-queue"><div><strong>${data.actionCount} 项</strong><span>待我处理</span></div>${pageLink('pending','查看待办')}</div>
   </section>
   <section class="sales-panel sales-breakdown" aria-labelledby="sales-breakdown-title">
    <div class="sales-section-head"><div><h2 id="sales-breakdown-title">客户与 VIP 推广成果</h2><p>${period} · 净实收为到账减已完成的退款。消费为已结算的 API 扣费。</p></div>
     <form id="employeeSearch" class="sales-client-search"><label class="sales-sr-only" for="employeeQuery">查找客户</label><input id="employeeQuery" type="search" placeholder="客户名称、编码或邮箱" required><button type="submit">查找客户</button></form></div>
    <div class="sales-table-wrap"><table>
     <thead><tr><th scope="col">业务方向</th><th scope="col">推广成功</th><th scope="col">发出邀请码</th><th scope="col">消费金额</th><th scope="col">销售收入</th></tr></thead>
     <tbody>
      ${channelRow('普通客户',[count(total.customers)+' 位',count(total.customerCodes)+' 个',money(total.customerSpend),money(total.customerRevenue)],'direct')}
      ${channelRow('VIP',[count(total.vips)+' 位',count(total.vipCodes)+' 个',money(total.vipSpend),money(total.vipRevenue)],'vipcodes')}
     </tbody>
    </table></div>
    <p class="sales-metric-help">推广成功按普通客户首笔有效推广付款、VIP 正式开通计算。发码按创建日期统计。</p>
   </section>
   <div class="sales-two-columns">
    ${chart(period,rows,total)}
    <section class="sales-panel sales-targets" aria-labelledby="sales-target-title">
     <div class="sales-section-head"><div><h2 id="sales-target-title">本月拓展</h2><p>推广人数目标未设置</p></div></div>
     ${goal('推广付款的普通客户',monthly.customers)}
     ${goal('正式开通的 VIP',monthly.vips)}
     <div class="sales-target-links">${pageLink('customeroverview','客户推广')}${pageLink('vipoverview','VIP 推广')}</div>
    </section>
   </div>
  </div>`;
 }

 function taskList() {
  const query = view.query.toLocaleLowerCase();
  return data.tasks.filter(task=> (view.status==='all'||task.status===view.status) &&
   (view.kind==='all'||task.kind===view.kind) &&
   (!query||[task.subject,task.customer,task.id].some(text=>text.toLocaleLowerCase().includes(query))));
 }

 function taskAction(task) {
  if(task.destination==='discount')return pageLink('customerapplications','查看客户推广申请');
  const action = task.destination==='vip'?'vip-open':'sales-ticket';
  const label = task.destination==='vip'?'打开 VIP 档案':'打开工单';
  return `<button type="button" class="primary" data-act="${action}" data-id="${escape(task.record_id)}">${label}</button>`;
 }

 function taskDetails(task) {
  if(!task)return '<div class="sales-task-detail sales-task-empty"><p>选择一条事项，查看当前进度和下一步。</p></div>';
  return `<section class="sales-task-detail" aria-labelledby="sales-detail-title">
   <div class="sales-section-head"><span>${kinds[task.kind]}</span>${statusBadge(task.status)}</div>
   <h2 id="sales-detail-title">${escape(task.subject)}</h2>
   <p>${escape(task.customer)} · ${dateLabel(task.due || task.submitted)} ${task.due?'跟进':'提交'}</p>
   ${task.context?`<p class="sales-task-context">${escape(task.context)}</p>`:''}
   <dl class="sales-task-facts"><div><dt>当前处理人</dt><dd>${handlers[task.status]}</dd></div>
    <div><dt>下一步</dt><dd>${escape(task.next)}</dd></div></dl>
   <div class="sales-detail-actions">${taskAction(task)}</div>
  </section>`;
 }

 function queue() {
  const list = taskList();
  const current = list.find(task=>task.id===view.taskId);
  const statusesAndCounts = [...Object.keys(statuses).map(key=>[key,data.tasks.filter(task=>task.status===key).length]),['all',data.tasks.length]];
  return `<div class="sales-demo sales-queue">
   <div class="sales-toolbar"><div class="sales-demo-meta"><span>${escape(data.staffName)} · ${escape(data.snapshotDay)} · 我负责的事项</span></div>${pageLink('home','返回今日工作')}</div>
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
      <div class="sales-list-count"><span>${list.length} 条事项</span>${data.truncated?'<span>最多显示 300 条，未结事项优先</span>':''}</div>
      ${list.map(task=>`<button type="button" class="sales-task-row" data-sales-task="${escape(task.id)}" aria-pressed="${task.id===view.taskId}">
       <span class="sales-task-title"><strong>${escape(task.subject)}</strong><small>${kinds[task.kind]} · ${escape(task.customer)}</small></span>
       <span class="sales-task-deadline">${overdue(task)?statusBadge('late','已逾期'):''}<small>${dateLabel(task.due || task.submitted)} ${task.due?'跟进':'提交'}</small></span>
      </button>`).join('') || '<div class="sales-task-empty"><p>没有符合筛选条件的事项。</p><button type="button" data-sales-reset>清空筛选</button></div>'}
     </div>
     ${taskDetails(current)}
    </div>
   </section>
  </div>`;
 }

 function render(page, content, payload) {
  data=payload;
  if(page==='pending'){
   const list = taskList();
   if(!list.some(task=>task.id===view.taskId))view.taskId=list[0]?.id??null;
  }
  const root = document.createElement('div');
  content.replaceChildren(root);
  const update = focus => {
   root.innerHTML = page==='home' ? dashboard() : queue();
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
    update(`[data-sales-task="${CSS.escape(salesTask)}"]`);
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
   }
  });
 }

 window.EmployeeSales = { render };
})();
