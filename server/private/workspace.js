/* Employee customer/VIP promotion workflows and a separately authorized owner console. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const att = v => esc(v ?? '');
const OWNER_NAV = [
 ['工作台', [['home','今日工作']]],
 ['客户', [['customers','客户档案'], ['upgrades','企业认证审核']]],
 ['客户支持', [['tickets','工单与反馈'], ['answers','快捷问答库']]],
 ['推广与合作', [['acquisition','商务概览'], ['cw','VIP 招募与管理'], ['direct','直营客户与折扣码'], ['promotions','VIP 推广与返佣'], ['approvals','审批中心']]],
 ['产品与供应', [['products','模型与产品'], ['suppliers','上游供应商'], ['discounts','促销与折扣']]],
 ['订单与资金', [['payments','收款与退款'], ['transfers','对公入账'], ['invoices','发票'], ['payables','上游付款']], 'finance'],
 ['经营分析', [['overview','经营概况'], ['pnl','经营损益']], 'finance']
];
const EMPLOYEE_NAV = [
 ['员工工作台', [['home','今日工作']]],
 ['我的 API', [['apioverview','API 概览'],['apimodels','我的模型'],['apikeys','API 密钥'],['apiusage','用量与记录'],['apicompare','API 对比']]],
 ['客户推广', [['customeroverview','客户概览'],['direct','客户推广码'],['customerapplications','我的申请']]],
 ['VIP推广', [['vipoverview','VIP概览'],['vipcodes','VIP推广码'],['vipapplications','我的申请']]],
 ['客户服务', [['customers','我的客户'],['tickets','客户服务']]]
];
const ownerSurface = new URLSearchParams(location.search||'').get('surface')==='owner';
const NAV = ownerSurface ? OWNER_NAV : EMPLOYEE_NAV;
const employeePages = new Set([...EMPLOYEE_NAV.flatMap(([,items])=>items.map(([key])=>key)),'cw','answers','promotions']);
const PAGES = Object.fromEntries(OWNER_NAV.flatMap(([, items, gate]) => items.map(([key, label]) => [key, { label, gate }])));
if(!ownerSurface){for(const [,items] of EMPLOYEE_NAV)for(const [key,label] of items)PAGES[key]={label};PAGES.cw={label:'VIP客户跟进'};}
const promotionChannel = page => ['customeroverview','direct','customerapplications'].includes(page)?'customer':['vipoverview','cw','vipcodes','promotions','vipapplications'].includes(page)?'vip':null;
const SUBTITLES = {
 apioverview:'公司分配额度，查看自己的 API 使用情况。',apimodels:'选择模型，接入客户端或自己的程序。',apikeys:'创建、设置和停用自己的 API Key。',apiusage:'查看调用趋势、Token 消耗与公司额度使用。',apicompare:'使用公司额度，对比模型的回答、速度和用量。',
 home:'客户推广、VIP推广与客户服务。',
 vipcodes:'邀请客户申请 VIP，查看自己发出的推广码。',customeroverview:'查看客户推广带来的客户和订单。',vipoverview:'查看负责的 VIP、开通进度和推广情况。',customerapplications:'客户推广的特殊折扣申请与处理记录。',vipapplications:'VIP 的付款折扣与开通特批申请。',
 acquisition:'查看负责客户的进度、实付和待办。',cw:'招募邀请码、电话面试、付款核验与 VIP 客户档案。',direct:'员工直接招募最终用户，不产生 VIP 返佣。',promotions:'VIP 推荐客户的充值、使用与返佣。',approvals:'特殊折扣与原单开通特批，由管理员处理。',
 overview: '收入、成本、利润和今天要处理的事。', pnl: '按月看收入、成本和毛利，按产品、客户、上游拆开。', payments: '客户付款订单与原路退款。',
 transfers: '对公转账：财务登记实付与官价面额，复核后入账。',
 invoices: '开给客户的销项发票，和上游开给我们的进项发票。', payables: '付给上游的充值和结算款，对照收到的发票。',
 suppliers: '上游档案、编码、联系人和采购成本。', customers: '下游客户档案、编码、分群和跟进记录。', upgrades: '个人账号升级为企业账号的审核。',
 products: '在售产品的价格、用量和上架流程。', discounts: '促销活动，以及对客户、分群授予的折扣。', tickets: '一线支持：回复、分类、转技术。', answers: '标准问答，回复工单时一键引用。'
};
if(!ownerSurface)Object.assign(SUBTITLES,{direct:'生成与管理自己的客户推广码。',promotions:'查看负责 VIP 的推广码与使用情况。'});
const ALIASES = { ...(!ownerSurface?{acquisition:'customeroverview',approvals:'customerapplications'}:{}), accounts: 'customers', reports: 'products', upstream: 'products', finance: 'pnl' };
const SOURCES = { home:()=> 'business/support', acquisition:()=> 'business/acquisition'+(ui.acquisitionQuery?'?q='+encodeURIComponent(ui.acquisitionQuery):''),direct:()=> 'business/acquisition'+(ui.acquisitionQuery?'?q='+encodeURIComponent(ui.acquisitionQuery):''),promotions:()=> 'business/acquisition'+(ui.acquisitionQuery?'?q='+encodeURIComponent(ui.acquisitionQuery):''),approvals:()=> 'business/acquisition'+(ui.acquisitionQuery?'?q='+encodeURIComponent(ui.acquisitionQuery):''), pnl: () => 'business/finance?month=' + (ui.month || ''), payments: () => 'payments/orders', transfers: () => 'business/bank-transfers', invoices: () => 'business/invoices', payables: () => 'business/supplier-payments', suppliers: () => 'business/suppliers', customers: () => 'business/customers', discounts: () => 'business/discounts', tickets: () => 'business/support', answers: () => 'business/support' };
for(const page of ['customeroverview','vipoverview','customerapplications','vipapplications'])SOURCES[page]=SOURCES.acquisition;
SOURCES.vipcodes=()=> 'cw';
const API_VIEWS={apioverview:'personal',apimodels:'personal/models',apikeys:'personal/keys',apiusage:'personal/usage',apicompare:'personal/compare'};
let apiInnerNavigation=false;
addEventListener('message',event=>{const frame=document.querySelector('#employee-api-frame');if(event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.type!=='employee-api-position'||!API_VIEWS[event.data.page]||currentPage()===event.data.page)return;apiInnerNavigation=true;location.hash=event.data.page;});
const LABEL = {
 stage: { new: '新客户', following: '跟进中', key: '重点客户', risk: '流失风险', lost: '已流失' },
 kind: { enterprise: '企业', personal: '个人' },
 category: { question: '使用咨询', billing: '充值与扣费', invoice: '发票', bug: '故障', feedback: '意见反馈' },
 tier: { first_line: '一线处理', technical: '已转技术' },
 ticket: { open: '待处理', in_progress: '处理中', closed: '已关闭' },
 invoice: { requested: '待开票', issued: '已开具', rejected: '已退回', voided: '已作废', reversed: '已红冲' },
 invoiceType: { general: '普通发票', special: '专用发票' },
 discount: { pending: '待审批', scheduled: '未开始', active: '生效中', expired: '已过期', rejected: '已驳回', revoked: '已收回' },
 method: { bank: '对公转账', alipay: '支付宝', wechat: '微信', card: '信用卡', other: '其他' },
 supplier: { candidate: '待核验', reviewing: '核验中', blocked: '暂停' },
 source: { official: '官方', authorized_reseller: '授权经销商', cloud_provider: '云服务商', unconfirmed: '待核验' },
 conclusion: { passed: '基础验收通过', failed: '测试失败', inconclusive: '待核验' },
 usage: { matched: '金额已核对', mismatched: '金额存在差异', not_checked: '账单待核' },
 listing: { requested: '等待技术发布', published: '目录已发布', withdrawn: '已撤回' },
 refund: { pending: '处理中', succeeded: '已退回', failed: '渠道拒绝' },
 transfer: { pending: '待复核', approved: '已入账', rejected: '已驳回' },
 channel: { alipay_f2f: '支付宝（电脑网站）', wechat_native: '微信支付' },
 order: { pending: '待付款', paid: '已付款', closed: '已关闭' },
 upgrade: { pending: '待审核', approved: '已通过', rejected: '已驳回' }
};
const TONE = { issued: 'good', active: 'good', paid: 'good', approved: 'good', succeeded: 'good', requested: 'warn', pending: 'warn', open: 'warn', in_progress: 'warn', scheduled: 'warn', key: 'good', risk: 'bad', failed: 'bad', rejected: 'off', voided: 'off', reversed: 'off', expired: 'off', revoked: 'off', closed: 'off', lost: 'off' };
const pill = (group, key) => `<span class="pill ${TONE[key] || ''}">${esc(LABEL[group][key] || key)}</span>`;

function money(n, digits = 2) { n = Number(n || 0); const [whole, decimal] = Math.abs(n).toFixed(digits).split('.'); return (n < 0 ? '-¥' : '¥') + whole.replace(/\B(?=(\d{3})+$)/g, ',') + '.' + decimal; }
const yuan = v => { const n = Number(v || 0); return money(n, n !== 0 && Math.abs(n) < 0.01 ? 4 : 2); };
const fen = v => money(Number(v || 0) / 100);
const pct = v => v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%';
const when = v => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—';
const dayOf = v => v ? new Date(v).toLocaleDateString('zh-CN') : '—';
// A grant's end is stored as the instant after its last day; show the last day itself.
const lastDay = v => v ? dayOf(new Date(v).getTime() - 1) : '—';
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const discountText = p => `${p}%（${p / 10} 折）`;

let state = null, loadError = '', generation = 0, drawing = 0;
const cache = {}, ui = { month: '', customers: { q: '', kind: '', stage: '', tag: '' }, tickets: { status: 'open', tier: '', category: '' }, invoices: 'output' };

async function api(path, body) {
 const r = await fetch('/api/staff/' + path, { credentials: 'same-origin', ...(!body ? { signal: AbortSignal.timeout(45000) } : {}), ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
 const d = await r.json().catch(() => ({}));
 if (!r.ok) throw Error(d.error || `读取失败（${r.status}）`);
 return d;
}
const get = path => { const started = generation; return cache[path] ? Promise.resolve(cache[path]) : api(path).then(d => { if (started === generation) cache[path] = d; return d; }); };
function notify(text, ok = false) { const n = $('#notice'); n.textContent = text || ''; n.classList.toggle('ok', ok); }
const allowedPage = page => ownerSurface ? state?.dash.staff.admin===true : employeePages.has(page);
const currentPage = () => { let page = ALIASES[location.hash.slice(1)] || location.hash.slice(1) || 'home'; return PAGES[page] ? page : 'overview'; };
const options = (map, selected, blank) => (blank === undefined ? '' : `<option value="">${blank}</option>`) + Object.entries(map).map(([k, v]) => `<option value="${att(k)}" ${k === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
const table = (head, rows, empty = '暂无记录。') => `<div class="panel"><table><thead><tr>${head.map(h => Array.isArray(h) ? `<th class="num">${h[0]}</th>` : `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>`;
const paymentOrderWidths = new Map();
function paymentOrderTable(rows) {
 const labels = ['订单', '账户', '金额', '状态', '操作'];
 const headers = labels.map((label, index) => {
  const width = paymentOrderWidths.get(index);
  return `<th class="${index === 2 ? 'num' : ''}"${width ? ` style="width:${width}px;min-width:${width}px"` : ''}>${label}<button type="button" class="payment-column-grip" data-column="${index}" aria-label="调整${label}列宽" title="拖动调整列宽，也可用左右方向键"></button></th>`;
 }).join('');
 return `<div class="panel payment-order-scroll"><table class="payment-order-table"><thead><tr>${headers}</tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">还没有付款订单。</td></tr>'}</tbody></table></div>`;
}
function resizePaymentColumn(grip, requestedWidth) {
 const header = grip.closest('th');
 const index = Number(grip.dataset.column);
 const minWidth = [160, 140, 90, 180, 130][index];
 const width = Math.round(Math.max(minWidth, Math.min(720, requestedWidth)));
 paymentOrderWidths.set(index, width);
 header.style.width = header.style.minWidth = width + 'px';
}
document.addEventListener('pointerdown', event => {
 const grip = event.target.closest('.payment-column-grip');
 if (!grip || event.button !== 0) return;
 event.stopPropagation();
 const start = event.clientX;
 const width = grip.closest('th').getBoundingClientRect().width;
 grip.setPointerCapture(event.pointerId);
 const move = e => resizePaymentColumn(grip, width + e.clientX - start);
 grip.addEventListener('pointermove', move);
 grip.addEventListener('lostpointercapture', () => grip.removeEventListener('pointermove', move), {once:true});
});
document.addEventListener('click', event => {
 if (event.target.closest('.payment-column-grip')) event.stopPropagation();
}, true);
document.addEventListener('keydown', event => {
 const grip = event.target.closest('.payment-column-grip');
 if (!grip || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
 event.preventDefault();
 event.stopPropagation();
 resizePaymentColumn(grip, grip.closest('th').getBoundingClientRect().width + (event.key === 'ArrowRight' ? 20 : -20));
});

const num = (text, sort) => `<td class="num"${sort === undefined ? '' : ` data-sort="${att(sort)}"`}>${text}</td>`;
const metric = (label, value, hint = '', negative = false) => `<div class="metric"><span>${label}</span><strong class="${negative ? 'neg' : ''}">${value}</strong><small>${hint}</small></div>`;
const section = (title, body, tools = '', lead = '') => `<section><div class="heading"><h2>${title}</h2><div class="tools">${tools}</div></div>${lead ? `<p>${lead}</p>` : ''}${body}</section>`;

// ---- Dialog forms ---------------------------------------------------------------------------
function openForm({ title, body, submit = '保存', wide = false, onSubmit }) {
 const dialog = $('#dialog'), form = $('#dialogForm');
 dialog.classList.toggle('wide', wide);
 form.innerHTML = `<h2>${title}</h2>${body}<div class="form-error" role="alert"></div><div class="actions"><button type="button" data-close>${onSubmit ? '取消' : '关闭'}</button>${onSubmit ? `<button class="primary" type="submit">${submit}</button>` : ''}</div>`;
 form.oninput = () => { form.querySelector('.form-error').textContent = ''; };
 form.onsubmit = async e => {
  e.preventDefault();
  if (!onSubmit) return;
  const button = form.querySelector('[type=submit]');
  form.querySelector('.form-error').textContent = '';
  button.disabled = true;
  try { const done = await onSubmit(Object.fromEntries(new FormData(form))); if(done===false)return; dialog.close(); await reload(); if (done) notify(done, true); }
  catch (err) { form.querySelector('.form-error').textContent = err.message; }
  finally { button.disabled = false; }
 };
 if (!dialog.open) dialog.showModal();
}

// ---- Chart: twelve months of revenue, cost and internal credit use ----------------------------
const SERIES = [['revenue', '已确认收入', 'var(--series-1)'], ['upstream_cost', '上游成本', 'var(--series-2)'], ['credit_list', '内部额度消耗（按标价）', 'var(--series-3)']];
let chartRows = [];
function monthChart(rows) {
 chartRows = rows;
 const max = Math.max(0, ...rows.flatMap(m => SERIES.map(s => m[s[0]])));
 if (!max) return '<div class="empty">近 12 个月还没有收入和成本记录。</div>';
 const W = 760, H = 230, left = 56, right = 8, top = 10, bottom = 26, pw = W - left - right, ph = H - top - bottom, band = pw / rows.length, bar = Math.min(12, (band - 16) / 3);
 const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].find(m => m * mag >= raw) * mag, ceiling = Math.ceil(max / step) * step;
 const y = v => top + ph - v / ceiling * ph, axis = v => v >= 10000 ? v / 10000 + '万' : step < 1 ? v.toFixed(2) : String(v);
 let svg = '';
 for (let v = 0; v <= ceiling + step / 2; v += step) svg += `<line class="grid" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 8}" y="${y(v) + 4}" text-anchor="end">¥${axis(v)}</text>`;
 rows.forEach((m, i) => {
  const x0 = left + i * band + (band - bar * 3 - 4) / 2, [year, month] = m.month.split('-');
  SERIES.forEach(([key, , color], j) => {
   const value = m[key], h = value / ceiling * ph;
   if (h <= 0) return;
   const x = x0 + j * (bar + 2), yy = y(value), r = Math.min(4, h, bar / 2);
   svg += `<path fill="${color}" d="M${x},${top + ph}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bar - r}Q${x + bar},${yy} ${x + bar},${yy + r}V${top + ph}Z"/>`;
  });
  svg += `<text x="${left + i * band + band / 2}" y="${H - 8}" text-anchor="middle">${i === 0 || month === '01' ? year.slice(2) + '年' : ''}${Number(month)}月</text>`;
  svg += `<rect class="band" data-month="${i}" tabindex="0" role="img" aria-label="${att(m.month + '：' + SERIES.map(s => s[1] + ' ' + yuan(m[s[0]])).join('，'))}" x="${left + i * band}" y="${top}" width="${band}" height="${ph}"/>`;
 });
 return `<div class="legend">${SERIES.map(s => `<span><i style="background:${s[2]}"></i>${s[1]}</span>`).join('')}</div><div class="chart"><svg viewBox="0 0 ${W} ${H}" role="group" aria-label="近 12 个月收入与成本">${svg}</svg><div class="tip" hidden></div></div>`;
}
function tip(e) {
 const band = e.target.closest?.('.band'), box = document.querySelector('.chart .tip');
 if (!box) return;
 if (!band || e.type === 'mouseout' || e.type === 'focusout') { box.hidden = true; return; }
 const m = chartRows[Number(band.dataset.month)], host = box.parentElement.getBoundingClientRect(), at = band.getBoundingClientRect();
 box.innerHTML = `<b>${esc(m.month)}</b><br>` + SERIES.map(s => `<i style="background:${s[2]}"></i>${s[1]} ${yuan(m[s[0]])}`).join('<br>') + `<br>毛利 ${yuan(m.revenue - m.upstream_cost)}`;
 box.hidden = false;
 box.style.left = Math.max(0, Math.min(host.width - box.offsetWidth, at.left - host.left + at.width / 2 - box.offsetWidth / 2)) + 'px';
 box.style.top = '4px';
}

// ---- Pages ----------------------------------------------------------------------------------
const pages = {};
const fin = () => state.dash.finance;

const roleNames = {platform_admin:'老板',operations:'商务运营',support:'客户支持',supply:'供应运营',finance:'财务'};
// Priorities shape the work queue; API authorization remains the source of access rights.
const workItems = [
 ['tickets','tickets','待处理工单','回复客户、核实问题并跟进处理结果','support'],
 ['tickets','tickets_technical','等待技术反馈','查看已转交技术的工单','support'],
 ['cw','vip_pending','VIP 申请待跟进','查看申请资料，安排面试与跟进','operations'],
 ['cw','vip_confirmed','VIP 待核验开通','跟进付款进度，按已定条件完成开通','operations'],
 [ownerSurface?'approvals':'vipapplications','vip_discount_pending','VIP 折扣申请进度','查看老板的审批结果','operations'],
 [ownerSurface?'approvals':'vipapplications','vip_activation_exception_pending','原单特批申请进度','补充材料，跟进处理结果','operations'],
 ['upgrades','upgrades','企业认证待审核','核对企业资料与联系人','operations'],
 ['transfers','bank_transfers_pending','对公到账待复核','核对到账记录，再完成入账','finance'],
 ['invoices','invoices_requested','发票申请待处理','核对抬头与可开票金额','finance'],
 ['payments','refunds_pending','退款待确认','核对原订单和退款进度','finance'],
 ['discounts','discounts_pending','折扣待审批','核对适用客户、有效期与折扣','operations'],
 ['products','models_paused','产品已暂停','查看产品状态，跟进恢复进度','supply']
];
pages.home = d => {
 const {staff,counts:c}=state.dash,role=staff.role||(staff.admin?'platform_admin':'operations');
 const rows=workItems.filter(([page,key])=>allowedPage(page)&&c[key]!==undefined&&(!PAGES[page].gate||staff[PAGES[page].gate]))
  .filter(([,key])=>Number(c[key])>0).sort((a,b)=>Number(b[4]===role)-Number(a[4]===role));
 const pending=d.tickets.filter(t=>t.status!=='closed').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5);
 const queue=rows.map(([page,key,title,hint])=>`<button class="work-item" data-work-page="${page}" data-work-key="${key}"><span><strong>${title}</strong><small>${hint}</small></span><b>${esc(c[key])}<span class="work-arrow" aria-hidden="true"> →</span></b></button>`).join('');
 return `<div class="employee-intro"><p>${esc(staff.name||'同事')}，你好。<span>${esc(ownerSurface?'老板': '客户拓展与服务')}</span></p><form id="employeeSearch" class="employee-search"><label for="employeeQuery">查找客户</label><div><input id="employeeQuery" type="search" placeholder="客户名称、编码或邮箱" required><button type="submit">搜索</button></div></form></div>`
 + `<div class="work-columns"><section class="work-queue"><div class="heading"><h2>待处理事项</h2><small>${ownerSurface?'全公司':'我负责的客户'}</small></div>${queue||'<div class="empty">目前没有待处理事项。可从左侧进入业务记录。</div>'}</section><section class="work-shortcuts"><div class="heading"><h2>常用入口</h2></div>${(ownerSurface?['overview','customers','approvals']:['customeroverview','vipoverview','customers']).map(key=>`<button data-go="${key}">${!ownerSurface&&key==='customeroverview'?'客户推广':!ownerSurface&&key==='vipoverview'?'VIP推广':PAGES[key].label}<span aria-hidden="true">→</span></button>`).join('')}<p>${ownerSurface?'公司经营与审批由老板身份处理。':'只处理自己负责的客户。特殊事项提交申请，由老板审批。'}</p></section></div>`
 + section('最近未结工单',table(['问题 / 客户','处理状态','提交时间','操作'],pending.map(t=>`<tr><td><strong>${esc(t.subject)}</strong><small>${esc(t.name)}${t.customer_code?' · '+esc(t.customer_code):''}</small></td><td>${pill('ticket',t.status)}${t.tier==='technical'?'<small>等待技术反馈</small>':''}</td><td>${when(t.created_at)}</td><td><button data-act="ticket" data-id="${att(t.id)}">处理</button></td></tr>`).join(''),'目前没有未结工单。'),'<button class="link" data-work-page="tickets" data-work-key="all">查看全部工单 →</button>');
};

pages.overview = () => {
 const c = state.dash.counts, f = fin(), models = state.biz.models, running = models.filter(m => m.routed && !m.paused).length;
 const todo = (page, n, label) => n === undefined ? '' : `<button data-go="${page}" class="${n ? 'has' : ''}"><b>${n}</b><span>${label}</span></button>`;
 let html = '';
 if (f) {
  const a = f.current.accrual, k = f.current.cash;
  html += `<div class="metrics">${metric('本月已确认收入', yuan(a.revenue), '客户现金实际扣费')}${metric('本月上游成本', yuan(a.upstream_cost), `其中销售 ${yuan(a.sales_cost)}，测试与系统 ${yuan(a.other_cost)}`)}${metric('本月毛利', yuan(a.gross_profit), '已确认收入 − 上游成本', a.gross_profit < 0)}${metric('本月净现金流', yuan(k.net), `收款 ${yuan(k.received)} − 退款 ${yuan(k.refunded)} − 付上游 ${yuan(k.supplier_paid)} − 渠道费 ${yuan(k.channel_cost)}`, k.net < 0)}</div>`;
  if (!a.revenue && a.credit_list) html += `<div class="callout">本月还没有现金收入：客户调用目前只扣公司发放的内部额度（按标价 ${yuan(a.credit_list)}），不计入收入。按标价计算的毛利率为 ${pct(a.list_margin)}。</div>`;
 }
 html += section('今天要处理', `<div class="todo">${todo('cw', c.vip_pending, '待面试的 VIP 申请')}${todo('approvals', c.vip_discount_pending, '待特批的 VIP 付款折扣')}${todo('approvals', c.vip_activation_exception_pending, '待审批的 VIP 原单特批')}${todo('upgrades', c.upgrades, '待审企业认证')}${todo('tickets', c.tickets, '未关闭工单')}${todo('invoices', c.invoices_requested, '待开票申请')}${todo('transfers', c.bank_transfers_pending, '对公待复核')}${todo('payments', c.refunds_pending, '退款待确认')}${todo('discounts', c.discounts_pending, '待审批折扣')}${todo('products', c.models_paused, '已暂停的产品')}</div>`);
 html += section('经营概况', `<div class="metrics">${metric('企业客户', c.enterprises, `个人客户 ${c.individuals}，近 30 天新增 ${c.customers_new_30d}`)}${metric('近 30 天活跃用户', c.users_active_30d, '有过模型调用')}${metric('在售产品运行中', `${running} / ${models.length}`, '运行状态由技术后台维护')}${metric('上游供应商', c.suppliers, `生效中的折扣授权 ${c.discounts_active} 条`)}</div>`);
 if (f) html += section('近 12 个月', `<div class="panel pad">${monthChart(f.series)}</div>`, '<button class="link" data-go="pnl">查看经营损益 →</button>');
 html += section('近 30 天调用最多的客户', table(['编码', '客户', '类型', ['30 天调用'], '最近调用'], state.dash.top_customers.map(r => `<tr class="clickable" data-customer="${att(r.id)}"><td><code>${esc(r.code)}</code></td><td><b>${esc(r.name)}</b><small>${esc(r.kind === 'personal' ? r.orgs || r.email : r.email)}</small></td><td>${pill('kind', r.kind)}</td>${num(r.calls_30d)}<td>${when(r.last_call_at)}</td></tr>`).join(''), '近 30 天还没有客户调用。'));
 return html;
};

pages.pnl = d => {
 const c = d.current, a = c.accrual, k = c.cash, b = c.balances, months = Object.fromEntries(d.series.map(m => [m.month, m.month.replace('-', ' 年 ') + ' 月']).reverse());
 const line = (label, value, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${value}</td></tr>`;
 const margin = (list, cost) => Number(list) > 0 ? pct((Number(list) - Number(cost)) / Number(list)) : '—';
 let html = `<div class="filters"><label class="check">会计月份 <select id="pnlMonth">${options(months, c.month)}</select></label><small>按北京时间自然月统计。</small></div>`;
 html += `<div class="cols" style="margin-top:14px"><div class="panel"><table class="statement" data-nosort><thead><tr><th colspan="2">消耗口径：赚了多少</th></tr></thead><tbody>${line('已确认收入（客户现金扣费）', yuan(a.revenue))}${line('上游成本', yuan(a.upstream_cost))}${line('销售成本（客户调用花掉的上游费用）', yuan(a.sales_cost), 'sub')}${line('测试、验收与系统调用（没有对应客户调用的上游账单）', yuan(a.other_cost), 'sub')}${line('毛利', `<span class="${a.gross_profit < 0 ? 'bad' : ''}">${yuan(a.gross_profit)}</span>`, 'total')}${line('支付渠道费用（已核对）',yuan(a.channel_cost))}${line('扣除渠道费后经营收益',yuan(a.operating_profit),'total')}${line('内部额度消耗（按标价，不计收入）', yuan(a.credit_list), 'memo')}${line('按标价计算的毛利率', pct(a.list_margin), 'memo')}</tbody></table></div>`;
 html += `<div class="panel"><table class="statement" data-nosort><thead><tr><th colspan="2">现金口径：钱进钱出</th></tr></thead><tbody>${line('客户充值收款', yuan(k.received))}${line('退款', '-' + yuan(k.refunded))}${line('付给上游', '-' + yuan(k.supplier_paid))}${line('支付渠道费用', '-' + yuan(k.channel_cost))}${line('净现金流', `<span class="${k.net < 0 ? 'bad' : ''}">${yuan(k.net)}</span>`, 'total')}${line('本月已开销项发票', yuan(k.invoiced), 'memo')}${line('客户预存余额（尚未消费，属于负债）', yuan(b.customer_cash), 'memo')}${line('已发放未使用的内部额度', yuan(b.credit_unused), 'memo')}</tbody></table></div></div>`;
 if(a.channel_unreconciled)html+=`<div class="callout">本月 ${a.channel_unreconciled} 笔支付渠道费用待核对，尚未计入成本；请在收款与退款中登记，经营收益与净现金流暂未完整。</div>`;
 if (a.unmatched_calls) html += `<div class="callout">${a.unmatched_calls} 笔调用没有对应的上游逐笔账单（上游不回传，或账单还没同步），成本按标价估算，共 ${yuan(a.estimated_cost)}。这部分按标价算的毛利为 0。</div>`;
 html += section('近 12 个月', `<div class="panel pad">${monthChart(d.series)}</div>` + table(['月份', ['已确认收入'], ['上游成本'], ['毛利'], ['内部额度消耗'], ['收款'], ['退款'], ['付上游'],['渠道费'],['扣渠道费后收益']], [...d.series].reverse().map(m => `<tr><td>${esc(m.month)}</td>${num(yuan(m.revenue), m.revenue)}${num(yuan(m.upstream_cost), m.upstream_cost)}${num(yuan(m.revenue - m.upstream_cost), m.revenue - m.upstream_cost)}${num(yuan(m.credit_list), m.credit_list)}${num(yuan(m.received), m.received)}${num(yuan(m.refunded), m.refunded)}${num(yuan(m.supplier_paid), m.supplier_paid)}${num(yuan(m.channel_cost),m.channel_cost)}${num(yuan(m.revenue-m.upstream_cost-m.channel_cost))}</tr>`).join('')));
 html += section('按产品', table(['产品', ['调用'], ['失败'], ['Token'], ['消耗（标价）'], ['上游成本'], ['标价毛利率']], c.by_product.map(p => `<tr><td><b>${esc(p.name)}</b><small>${esc(p.model_id)}</small></td>${num(p.calls)}${num(p.failed)}${num(Number(p.tokens).toLocaleString('zh-CN'), p.tokens)}${num(yuan(p.list_yuan), p.list_yuan)}${num(yuan(p.cost), p.cost)}${num(margin(p.list_yuan, p.cost))}</tr>`).join(''), '这个月还没有调用。'));
 html += section('按客户', table(['编码', '客户', ['调用'], ['消耗（标价）'], ['上游成本'], ['标价毛利率']], c.by_customer.map(r => `<tr class="clickable" data-customer="${att(r.id)}"><td><code>${esc(r.code)}</code></td><td><b>${esc(r.name)}</b><small>${LABEL.kind[r.kind]}</small></td>${num(r.calls)}${num(yuan(r.list_yuan), r.list_yuan)}${num(yuan(r.cost), r.cost)}${num(margin(r.list_yuan, r.cost))}</tr>`).join(''), '这个月还没有客户调用。'));
 html += section('按上游', table(['编码', '供应商', ['上游账单请求数'], ['上游成本'], ['本月已付']], c.by_supplier.map(s => `<tr><td><code>${esc(s.code)}</code></td><td><b>${esc(s.display_name)}</b></td>${num(s.requests)}${num(yuan(s.cost), s.cost)}${num(yuan(s.paid), s.paid)}</tr>`).join(''), '还没有供应商档案。'), '', '成本来自上游账单的逐笔记录；已付来自“上游付款”登记。');
 return html;
};

function billSyncView(d,channel='alipay',name='支付宝'){
 if(!d?.enabled)return '';
 const label={matched:'已核对',review:'有差异待核对',pending:'待重试'};
 const last=d.days?.[0];
 return `<div class="callout"><button data-act="${channel}-bill-sync" data-day="${att(d.yesterday)}">同步${name}账单</button> 次日上午自动核对，渠道费只计入公司成本。${last?`<small>账单 ${esc(last.day)} · ${label[last.status]||esc(last.status)} · ${last.matched} 笔匹配 / ${last.exceptions} 笔待核对 · ${when(last.checked_at)}${last.error_code?' · '+esc(last.error_code):''}</small>`:'<small>等待首份交易账单；未取得账单不视为零费用。</small>'}${d.days?.length?`<details><summary>最近账单与差异</summary>${d.days.map(x=>`<small>${esc(x.day)} · ${label[x.status]||esc(x.status)} · ${x.matched} 笔匹配 / ${x.exceptions} 笔待核对${x.ignored?' · '+x.ignored+' 笔非本站交易未入账':''}${x.error_code?' · '+esc(x.error_code):''}</small>`).join('')}</details>`:''}</div>`;
}
pages.payments = p => {
 const rows = p.orders.map(o => {
  const request=p.requests?.find(r=>r.order_id===o.id);o.refund_request=request;
  const left = Number(o.amount_fen) - Number(o.refunded_fen), pending = o.refunds.find(r => r.status === 'pending'), find = [o.out_trade_no, o.provider_trade_no, o.account_name, o.owner_email, o.payer_email].join(' ').toLowerCase();
  return `<tr data-find="${att(find)}"><td><b>${esc(o.out_trade_no)}</b><small>${when(o.paid_at || o.created_at)}${' · ' + esc(LABEL.channel[o.provider] || o.provider)}${o.provider_trade_no ? ' ' + esc(o.provider_trade_no) : ''}</small></td><td>${esc(o.account_name)}${request?`<small>客户申请退款：${esc(request.reason)}</small>`:''}<small>${o.account_kind === 'organization' ? '企业' : '个人'} · 付款人 ${esc(o.payer_email)} · 实付余额 ${fen(o.account_balance_fen)} · 官价额度 ${fen(o.list_credit_fen)}</small></td>${num(fen(o.amount_fen) + (Number(o.refunded_fen) ? `<small>已退 ${fen(o.refunded_fen)}</small>` : ''), o.amount_fen)}<td>${pill('order', o.status)}${o.refunds.map(r => `<small>退款 ${fen(r.amount_fen)} · ${esc(LABEL.refund[r.status])} · ${esc(r.reason)}${r.waiver_reason?` · 特批服务费 ${r.service_fee_percent}%（减免 ${fen(r.waived_fen)}） · ${esc(r.waiver_reason)} · 审批人 ${esc(r.waiver_approved_by)} · ${when(r.waiver_approved_at)}`:''}${r.status !== 'succeeded' && r.error_code ? ' · ' + esc(r.error_code) : ''}</small>`).join('')}</td><td>${pending ? `<button data-act="refund-retry" data-id="${att(pending.id)}">确认退款结果</button>` : o.status === 'paid' && o.refundable && left > 0 && p.channels?.includes(o.provider) ? `<button data-act="refund" data-id="${att(o.id)}" data-channel="${att(LABEL.channel[o.provider] || '')}" data-left="${left}" data-balance="${att(o.account_balance_fen)}">原路退款</button>` : '—'}${p.can_policy_override&&o.status==='paid'&&o.refundable&&!pending?`<button data-act="refund-policy" data-id="${att(o.id)}">工单退款特批</button>`:''}${o.status==='paid'?`<button data-act="channel-fee" data-id="${att(o.id)}" data-version="${o.channel_fee_version}" data-fee="${o.channel_fee_fen??''}">${o.channel_fee_fen===null?'登记渠道费':`渠道费 ${fen(o.channel_fee_fen)}`}</button><small>${esc(o.channel_fee_issue||o.channel_fee_evidence||'待次日账单自动核对')}</small>`:''}</td></tr>`;
 }).join('');
 return billSyncView(p.bill_sync)+billSyncView(p.wechat_bill_sync,'wechat','微信')+`<div class="metrics">${(p.summary||[]).map(s=>metric(LABEL.channel[s.provider],`${s.transactions} 笔 / ${fen(s.received_fen)}`,`累计实退 ${fen(s.refunded_fen)} · 已核对渠道成本 ${fen(s.channel_fee_fen)} · ${s.fees_unreconciled} 笔待核对`)).join('')}</div>`+section('按付款客户汇总（全部已付款）',table(['客户','渠道',['交易次数'],['累计付款']],(p.customers||[]).map(c=>`<tr><td>${esc(c.email)}</td><td>${esc(LABEL.channel[c.provider])}</td>${num(c.transactions)}${num(fen(c.received_fen))}</tr>`).join('')))+section('在线支付订单与退款', paymentOrderTable(rows), '<input id="find" type="search" placeholder="订单号 / 客户 / 邮箱" aria-label="搜索订单">', (p.refund_policy || '退款只退红色实付剩余、不收手续费；绿色赠送额度整条收回并关闭额度包。已开具销项发票需先作废或红冲；对公转账走人工。') + ' 原路退回付款人的支付宝或微信。发起时先从账户扣出；渠道明确拒绝时自动冲回。')
  + '<div class="callout">对公转账请到「对公入账」：财务登记实付与官价面额，复核后入账。</div>';
};

pages.transfers = d => {
 const rows = d.entries.map(e => {
  const find = [e.customer_code, e.customer_name, e.reference,e.payer_name, e.note].join(' ').toLowerCase();
  return `<tr data-find="${att(find)}"><td><code>${esc(e.customer_code)}</code><small>${esc(e.customer_name)} · ${LABEL.kind[e.customer_kind]}</small></td>${num(fen(e.cash_fen) + `<small>面额 ${fen(e.face_fen)}</small>`, e.cash_fen)}<td>${esc(e.received_day)}<small>付款户名 ${esc(e.payer_name||'未登记')}</small><small>${esc(e.reference || '无回单号')}${e.note ? ' · ' + esc(e.note) : ''}</small></td><td>${pill('transfer', e.status)}<small>登记 ${esc(e.created_by_name)} · ${when(e.created_at)}${e.decided_by_name ? ' · 复核 ' + esc(e.decided_by_name) + ' · ' + when(e.decided_at) + (e.created_by===e.decided_by&&e.decision_role==='platform_admin'?' · 管理员本人复核':'') : ''}</small>${e.decision_note ? `<small>${esc(e.decision_note)}</small>` : ''}</td><td>${e.status === 'pending' && (e.created_by!==d.current_subject||d.can_self_review) ? `<button data-act="transfer-approve" data-id="${att(e.id)}">复核入账</button> <button data-act="transfer-reject" data-id="${att(e.id)}">驳回</button>` : e.status==='pending'?'等待另一人复核':'—'}</td></tr>`;
 }).join('');
 const notices=(d.notices||[]).map(n=>`<tr><td>${esc(n.organization_name)}<small>${esc(n.submitted_email)}</small></td><td>${esc(n.payer_name)}<small>${esc(n.payer_reference)}</small></td>${num(fen(n.cash_fen))}<td>${esc(n.paid_day)}<small>${esc(n.note)}</small></td><td><button data-act="transfer-new" data-notice="${att(n.id)}">核对并登记到账</button><button data-act="transfer-notice-reject" data-id="${att(n.id)}">退回</button></td></tr>`).join('');
 const bank=d.receiving_account;
 const bankInfo=bank?`<div class="callout">收款户名：${esc(bank.account_name)} · ${esc(bank.bank_name)} · ${esc(bank.account_number)}</div>`:'';
 const inbox=section('客户提交 · 待核对到账',table(['企业','付款户名 / 付款流水',['提交金额'],'转账日 / 备注','操作'],notices,'暂无待核对的客户转账信息。'),'','客户提交仅供查找流水，核实公司银行账户实际到账后再登记。');
 return bankInfo+inbox+section('对公转账入账', table(['客户', ['实付 / 官价面额'], '到账日 / 回单', '状态', '操作'], rows, '还没有对公转账登记。'), '<button class="primary" data-act="transfer-new">登记到账</button>', '登记实付金额与官价额度面额（无折扣时面额等于实付）。待复核时不改余额；对照银行流水复核通过后，增加实付账本与官价额度。平台管理员可复核自己的登记；普通财务须由另一人复核，所有操作均留记录。');
};

pages.invoices = d => {
 const output = ui.invoices !== 'input', list = output ? d.output : d.input, requested = d.output.filter(i => i.status === 'requested');
 const rows = list.map(i => `<tr><td><code>${esc(output ? i.customer_code : i.supplier_code)}</code><small>${esc(output ? i.customer_name : i.supplier_name)}</small></td><td><b>${esc(i.title)}</b><small>${esc(i.tax_number || '无税号')}${i.email ? ' · ' + esc(i.email) : ''}</small></td><td>${esc(LABEL.invoiceType[i.invoice_type])}</td>${num(fen(i.amount_fen), i.amount_fen)}<td>${pill('invoice', i.status)}<small>${i.invoice_number ? esc(i.invoice_number) + ' · ' + esc(i.issued_day) : (i.requested_by_user ? '客户申请 ' : '财务登记 ') + dayOf(i.created_at)}</small>${i.note ? `<small>${esc(i.note)}</small>` : ''}</td><td>${i.status === 'requested' ? `<button data-act="invoice-issue" data-id="${att(i.id)}">登记开具</button> <button data-act="invoice-reject" data-id="${att(i.id)}">退回</button>` : i.status === 'issued' ? `<button data-act="invoice-void" data-id="${att(i.id)}" data-kind="void">作废</button> <button data-act="invoice-void" data-id="${att(i.id)}" data-kind="reverse">红冲</button>` : '—'}</td></tr>`).join('');
 const total = key => fen(list.filter(i => i.status === key).reduce((n, i) => n + Number(i.amount_fen), 0));
 return `<div class="metrics">${metric('待开票申请', requested.length, '合计 ' + fen(requested.reduce((n, i) => n + Number(i.amount_fen), 0)))}${metric(output ? '已开销项发票' : '已收进项发票', total('issued'), output ? '开给客户' : '上游开给我们')}</div>`
  + section(output ? '销项发票（开给客户）' : '进项发票（上游开给我们）', table([output ? '客户' : '供应商', '抬头 / 税号', '类型', ['金额'], '状态', '操作'], rows, output ? '还没有开票记录。客户可以在自己的账单页提交申请。' : '还没有进项发票。'),
   `<select id="invoiceDirection" aria-label="发票方向">${options({ output: '销项发票', input: '进项发票' }, output ? 'output' : 'input')}</select><button class="primary" data-act="invoice-new">登记发票</button>`,
   output ? '发票在电子税务局开具，这里登记申请和结果。可开票金额 = 客户实际付款 − 退款 − 已申请和已开具的发票；作废或红冲后金额退回可开票额度。' : '登记上游开来的发票，用于和“上游付款”核对是否到票。');
};

pages.payables = d => section('各上游付款与到票', table(['编码', '供应商', ['累计已付'], ['已收进项发票'], ['未到票']], d.suppliers.map(s => { const gap = Number(s.paid_fen) - Number(s.invoiced_fen); return `<tr><td><code>${esc(s.code)}</code></td><td><b>${esc(s.display_name)}</b></td>${num(fen(s.paid_fen), s.paid_fen)}${num(fen(s.invoiced_fen), s.invoiced_fen)}${num(`<span class="${gap > 0 ? 'warn' : ''}">${fen(gap)}</span>`, gap)}</tr>`; }).join(''), '还没有供应商档案。'))
 + section('付款记录', table(['付款日期', '供应商', ['金额'], '方式 / 流水号', '登记人', '操作'], d.payments.map(p => `<tr><td>${esc(p.paid_day)}</td><td><code>${esc(p.supplier_code)}</code> ${esc(p.supplier_name)}</td>${num(p.voided_at ? `<s>${fen(p.amount_fen)}</s>` : fen(p.amount_fen), p.amount_fen)}<td>${esc(LABEL.method[p.method])}<small>${esc(p.reference || '无流水号')}${p.note ? ' · ' + esc(p.note) : ''}</small></td><td>${esc(p.created_by_name)}<small>${when(p.created_at)}</small></td><td>${p.voided_at ? '<span class="pill off">已作废</span>' : `<button data-act="payable-void" data-id="${att(p.id)}">作废</button>`}</td></tr>`).join(''), '还没有登记过给上游的付款。'), '<button class="primary" data-act="payable-new">登记付款</button>', '给上游账户充值、按账单结算都登记在这里，计入现金口径的支出。');

pages.suppliers = d => {
 const cost = new Map((fin()?.current.by_supplier || []).map(s => [s.id, s])), finance = Boolean(fin());
 return section('上游供应商', table(['编码', '供应商', '来源 / 地区', '状态', ['Key / 型号'], '联系人', ...(finance ? [['本月成本'], ['本月已付']] : []), '操作'], d.suppliers.map(s => `<tr><td><code>${esc(s.code)}</code></td><td><b>${esc(s.display_name)}</b><small>${esc(s.legal_name)}</small></td><td>${esc(LABEL.source[s.source_type] || s.source_type)}<small>${esc(s.region)}</small></td><td>${pill('supplier', s.status)}</td>${num(`${s.keys} / ${s.models}`, s.models)}<td>${s.contact_name ? esc(s.contact_name) : '<span class="warn">未填写</span>'}<small>${esc([s.contact_phone, s.contact_email].filter(Boolean).join(' · ') || '')}</small></td>${finance ? num(yuan(cost.get(s.id)?.cost), cost.get(s.id)?.cost || 0) + num(yuan(cost.get(s.id)?.paid), cost.get(s.id)?.paid || 0) : ''}<td><button data-act="supplier-contact" data-id="${att(s.id)}">联系人</button> <a href="/#ops/supply/${att(s.id)}">合同与采购资料 ↗</a></td></tr>`).join(''), '还没有供应商档案。'),
  state.overview.can_manage ? '<button class="primary" data-act="supplier-new">新增供应商</button>' : '', '编码在建档时自动生成（S + 年份 + 流水号），用于合同、发票和对账，不会改变。Key 和型号由技术后台在同一份档案下维护。');
};

function customerRows(d) {
 const f = ui.customers;
 return d.customers.filter(c => (!f.kind || c.kind === f.kind) && (!f.stage || c.stage === f.stage) && (!f.tag || c.tags.includes(f.tag)));
}
pages.customers = d => {
 const f = ui.customers, rows = customerRows(d), tags = Object.fromEntries(d.tags.map(t => [t.tag, `${t.tag}（${t.customers}）`]));
 const body = rows.map(c => `<tr class="clickable" data-customer="${att(c.id)}" data-find="${att([c.code, c.name, c.email, c.orgs, c.tags.join(' ')].join(' ').toLowerCase())}"><td><code>${esc(c.code)}</code></td><td><b>${esc(c.name)}</b><small>${esc(c.email)}${c.kind === 'enterprise' ? ` · ${c.members} 位成员` : c.orgs ? ' · 所属 ' + esc(c.orgs) : ''}${c.disabled ? ' · 已停用' : ''}</small></td><td>${pill('kind', c.kind)}</td><td>${pill('stage', c.stage)}${c.tags.map(t => ` <span class="pill">${esc(t)}</span>`).join('')}</td><td>${esc(c.owner_name || '未分配')}</td>${num(fen(c.list_credit_fen) + `<small>实付 ${fen(c.balance_fen)}</small>`, c.list_credit_fen)}${num(yuan(c.credit_spent) + `<small>/ ${yuan(c.credit_granted)}</small>`, c.credit_spent)}${num(c.calls_30d + `<small>${dayOf(c.last_call_at)}</small>`, c.calls_30d)}${num(c.open_tickets || '—', c.open_tickets)}</tr>`).join('');
 return `<div class="filters"><input id="find" type="search" value="${att(f.q)}" placeholder="编码 / 名称 / 邮箱 / 标签" aria-label="搜索客户"><select data-filter="kind" aria-label="客户类型">${options(LABEL.kind, f.kind, '全部类型')}</select><select data-filter="stage" aria-label="客户阶段">${options(LABEL.stage, f.stage, '全部阶段')}</select><select data-filter="tag" aria-label="分群标签">${options(tags, f.tag, '全部标签')}</select><small id="customerResultCount" data-total="${d.customers.length}">${rows.length} / ${d.customers.length} 个客户</small></div>`
  + `<div style="margin-top:12px">${table(['编码', '客户', '类型', '阶段 / 标签', '负责人', ['官价额度'], ['内部额度已用'], ['30 天调用'], ['未结工单']], body, ownerSurface?'没有符合条件的客户。':'没有符合条件的负责客户。客户归属由老板分配。')}</div>`
  + `<p style="margin-top:10px">${ownerSurface?'点一行查看详情、分配负责人、管理客户阶段和分群。':'点一行查看资料、更新跟进阶段、添加联系记录。客户归属和优惠分群由老板维护。'}</p>`;
};

pages.upgrades = () => section('企业升级申请', table(['企业', '信用代码', '联系人', '申请人', '状态', '操作'], state.biz.upgrades.map(u => `<tr><td><b>${esc(u.legal_name)}</b><small>${when(u.created_at)}</small></td><td>${esc(u.credit_code)}</td><td>${esc(u.contact_name)}<small>${esc(u.contact_phone)}</small></td><td>${esc(u.name)}<small>${esc(u.email)}</small></td><td>${pill('upgrade', u.status)}${u.reject_reason ? `<small>${esc(u.reject_reason)}</small>` : ''}</td><td>${u.status === 'pending' ? `<button data-act="upgrade" data-id="${att(u.id)}" data-decision="approve" data-name="${att(u.legal_name)}">通过</button> <button data-act="upgrade" data-id="${att(u.id)}" data-decision="reject" data-name="${att(u.legal_name)}">驳回</button>` : '—'}</td></tr>`).join(''), '没有升级申请。'), '', '通过后该账号转为企业账号并获得企业客户编码，不能降级。');

pages.products = () => {
 const o = state.overview, byProduct = new Map((fin()?.current.by_product || []).map(p => [p.model_id, p])), finance = Boolean(fin());
 const reports = o.reports.map(r => `<tr><td><b>${esc(r.model_name)}</b><small>${esc(r.supplier_name)}</small></td><td>${esc(LABEL.conclusion[r.conclusion])}<small>${r.success_count}/${r.sample_count} · ${r.lab_run_id ? '服务器测试批次 ' + esc(r.lab_run_id.slice(0, 8)) : '历史人工报告，不能据此发布'}</small></td><td>${esc(LABEL.usage[r.usage_check])}</td><td>${when(r.created_at)}</td></tr>`).join('');
 return section('在售产品', table(['产品', '上游', '状态', ['标价（元 / 百万 Token）'], ['30 天调用'], ['失败'], ['30 天消耗（标价）'], ...(finance ? [['本月成本'], ['标价毛利率']] : []), '最近调用'], state.biz.models.map(m => { const p = byProduct.get(m.id); return `<tr><td><b>${esc(m.name)}</b><small>${esc(m.upstream_model)}</small></td><td>${esc(m.upstream)}</td><td>${m.paused ? `<span class="pill warn">已暂停</span><small>${esc(m.reason)}</small>` : m.routed ? '<span class="pill good">运行中</span>' : '<span class="pill off">无可用上游</span>'}</td>${num(`输入 ${esc(m.input_yuan)} · 输出 ${esc(m.output_yuan)}`, m.output_yuan)}${num(m.calls)}${num(m.failed)}${num(yuan(m.yuan), m.yuan)}${finance ? num(yuan(p?.cost), p?.cost || 0) + num(p && Number(p.list_yuan) > 0 ? pct((p.list_yuan - p.cost) / p.list_yuan) : '—') : ''}<td>${when(m.last_call_at)}</td></tr>`; }).join(''), '还没有可用的产品。'), '', '标价是官网公开价。运行、暂停和路由由技术后台维护。')
  + section('上架准备', '<div class="workflow"><span>① 采购登记</span><span>② 技术验收</span><span>③ 商品与售价复核</span><span>④ 申请上架 → 技术发布</span></div>' + table(['商品', '上架条件', '操作'], o.products.map(p => `<tr><td><b>${esc(p.display_name)}</b><small>${esc(p.product_code)}</small></td><td>${p.ready ? '<strong class="good">验收与商业复核已齐备</strong>' : esc(p.reason)}</td><td>${o.can_manage ? `<button data-act="listing" data-id="${att(p.id)}" ${p.ready ? '' : 'disabled'}>申请上架</button>` : '只读'}</td></tr>`).join(''), '还没有商品草稿。'), '<a href="/#ops/products">商品与售价复核 ↗</a>')
  + section('发布记录', table(['商品', '状态', '操作'], o.listings.map(l => `<tr><td>${esc(l.display_name)}<small>版本 ${esc(l.id.slice(0, 8))}</small></td><td>${esc(LABEL.listing[l.status])}</td><td>${o.can_manage && l.status !== 'withdrawn' ? `<button data-act="withdraw" data-id="${att(l.id)}">撤回 / 下架</button>` : '—'}</td></tr>`).join(''), '还没有发布记录。'), '', '目录发布只展示已批准的产品与价格；不自动开启收款或客户调用。依据改变后，旧发布会自动隐藏。')
  + section('技术验收结果', table(['供应商 / 型号', '真实测试', '计量核对', '交付时间'], reports, '还没有验收报告。'), '', '基础题验收不等于型号真实性、容量或 SLA 全面验收。');
};

const audienceText = g => g.audience === 'customer' ? `<code>${esc(g.customer_code)}</code> ${esc(g.customer_name)}` : g.audience === 'tag' ? `分群 <span class="pill">${esc(g.tag)}</span>` : '全部客户';
pages.cw = () => section('VIP 客户跟进', '<p>查看邀请码带来的客户，记录电话面试和下次联系时间，跟进打折码充值与 VIP 开通。</p><a class="button" href="/promotion/vip.html?staff=1" target="_top">打开 VIP 客户跟进</a>');
pages.discounts = d => {
 const models = Object.fromEntries(d.models.map(m => [m.id, m.name]));
 const rows = d.grants.map(g => `<tr><td><b>${esc(g.name)}</b><small>${g.promo_code?'促销码：'+esc(g.promo_code)+' · ':''}${esc(g.reason)}</small></td><td>${audienceText(g)}</td><td>${g.model_id ? esc(models[g.model_id] || g.model_id) : '全部产品'}</td>${num(discountText(g.customer_price_percent) + (g.cap_fen ? `<small>优惠上限 ${fen(g.cap_fen)}</small>` : ''), g.customer_price_percent)}<td>${dayOf(g.starts_at)} – ${lastDay(g.ends_at)}</td><td>${pill('discount', g.state)}<small>提出 ${esc(g.created_by_name)}${g.decided_by_name && g.decided_by_name !== g.created_by_name ? ' · 处理 ' + esc(g.decided_by_name) : ''}</small>${g.decision_note ? `<small>${esc(g.decision_note)}</small>` : ''}</td><td>${g.status === 'pending' ? (d.can_decide && g.created_by !== d.me ? `<button data-act="discount" data-id="${att(g.id)}" data-action="approve">批准</button> <button data-act="discount" data-id="${att(g.id)}" data-action="reject">驳回</button>` : '<small>等待财务或管理员审批</small>') : g.status === 'active' && g.state !== 'expired' && (d.can_decide || g.created_by === d.me) ? `<button data-act="discount" data-id="${att(g.id)}" data-action="revoke">收回</button>` : '—'}</td></tr>`).join('');
 return '<div class="callout">折扣只在购买官价额度包付款时生效（取最优一条、不叠加）；调用一律按官网价扣官价额度。无型号限制的有效授权已接入购包；旧的型号专属授权保留为台账，不参与通用额度包。</div>'
  + section('折扣授权', table(['授权', '对象', '适用产品', ['客户实付'], '有效期', '状态', '操作'], rows, '还没有折扣授权。'), '<button class="primary" data-act="discount-new">新建折扣授权</button>', '业务员工提出，财务或平台管理员审批，提出人不能审批自己的申请。平台管理员提出的授权直接生效。')
  + section('促销活动草稿', table(['活动', '商品', ['客户价格'], '期限', ['优惠预算']], d.campaigns.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.product_name)}</td>${num(discountText(c.customer_price_percent), c.customer_price_percent)}<td>${dayOf(c.starts_at)} – ${dayOf(c.ends_at)}</td>${num(fen(c.total_discount_budget_fen), c.total_discount_budget_fen)}</tr>`).join(''), '还没有活动草稿。'), '<a href="/#ops/promotions">设计活动 ↗</a>', '活动草稿不会发放优惠码，也没有开启推广佣金。');
};

pages.tickets = d => {
 const f = ui.tickets, list = d.tickets.filter(t => (f.status === 'all' || (f.status === 'open' ? t.status !== 'closed' : t.status === 'closed')) && (!f.tier || t.tier === f.tier) && (!f.category || t.category === f.category));
 return `<div class="filters"><select data-ticket-filter="status" aria-label="工单状态">${options({ open: '未关闭', closed: '已关闭', all: '全部' }, f.status)}</select><select data-ticket-filter="tier" aria-label="处理层级">${options(LABEL.tier, f.tier, '全部层级')}</select><select data-ticket-filter="category" aria-label="工单分类">${options(LABEL.category, f.category, '全部分类')}</select><small>${list.length} 张工单</small></div><div style="margin-top:12px">`
  + table(['工单', '客户', '分类', '状态', '提交时间', '操作'], list.map(t => `<tr><td><b>${esc(t.subject)}</b><small>${esc(t.body.length > 90 ? t.body.slice(0, 90) + '…' : t.body)}</small></td><td>${t.customer_code ? `<code>${esc(t.customer_code)}</code> ` : ''}${esc(t.name)}<small>${esc(t.email)}</small></td><td>${esc(LABEL.category[t.category])}${t.tier === 'technical' ? '<small class="warn">已转技术</small>' : ''}</td><td>${pill('ticket', t.status)}<small>${t.replies.length} 条回复</small></td><td>${when(t.created_at)}</td><td><button data-act="ticket" data-id="${att(t.id)}">${t.status === 'closed' ? '查看' : '处理'}</button></td></tr>`).join(''), '没有符合条件的工单。') + '</div>';
};

pages.answers = d => section('快捷问答库', table(['分类', '问题', '标准答复', '对客户公开', ['引用次数'], '操作'], d.answers.map(a => `<tr><td>${esc(LABEL.category[a.category])}</td><td><b>${esc(a.question)}</b></td><td style="white-space:pre-wrap">${esc(a.answer.length > 160 ? a.answer.slice(0, 160) + '…' : a.answer)}</td><td>${a.published ? '<span class="pill good">公开</span>' : '<span class="pill off">仅内部</span>'}</td>${num(a.use_count)}<td>${ownerSurface?`<button data-act="answer-edit" data-id="${att(a.id)}">编辑</button> <button data-act="answer-archive" data-id="${att(a.id)}">归档</button>`:'可在工单回复中引用'}</td></tr>`).join(''), '还没有标准问答。先把最常被问到的三五个问题写进来。'), ownerSurface?'<button class="primary" data-act="answer-edit">新建问答</button>':'', '回复工单时可以一键引用；勾选“对客户公开”的问答会显示在客户面板的“支持 → 常见问题”里。');

// Business acquisition has one stable navigation surface across both sales channels.
const acquisitionPages = [['acquisition','客户进度'],['cw','VIP推广'],['direct','客户推广'],['promotions','VIP 客户推广情况'],['approvals',ownerSurface?'审批中心':'我的申请']];
const acquisitionTabs = page => `<div class="acquisition-tabs" role="navigation" aria-label="商务管理">${acquisitionPages.map(([key,label])=>`<button data-go="${key}" aria-current="${page===key?'page':'false'}">${label}</button>`).join('')}</div>`;
const scopeRows=(rows,ownerKey='owner_subject')=>rows.filter(x=>(!ui.acquisitionOwner||x[ownerKey]===ui.acquisitionOwner)&&(!ui.acquisitionQuery||Object.values(x).some(v=>String(v??'').toLowerCase().includes(ui.acquisitionQuery.toLowerCase()))));
const scopeControls=d=>`<div class="acquisition-filter">${d.administrator?`<label>负责员工<select id="acquisitionOwner"><option value="">全部员工</option>${d.owners.map(o=>`<option value="${att(o.subject)}" ${ui.acquisitionOwner===o.subject?'selected':''}>${esc(o.name)}</option>`).join('')}</select></label>`:`<p>${promotionChannel(currentPage())==='vip'?'仅显示你负责的 VIP 及其推广记录。':'仅显示你的客户推广记录与推广码。'}</p>`}<label>查找客户、码或商户订单号<input id="acquisitionQuery" type="search" value="${att(ui.acquisitionQuery||'')}" placeholder="输入关键词，按回车查找"></label><button data-act="acquisition-search">查找</button></div>${d.truncated?'<p class="notice">每类最多显示最近 500 条，当前结果不是全量统计。</p>':''}`;
const vipButton=p=>`<button data-act="vip-open" data-id="${att(p.id||p.partner_id)}">${esc(p.legal_name)}<small>${esc(p.public_code||'查看档案')}</small></button>`;
const total=(rows,key)=>rows.reduce((sum,x)=>sum+Number(x[key]||0),0);
pages.acquisition = d => {
 const ps=scopeRows(d.partners),gs=scopeRows(d.grants,'created_by'),cs=scopeRows(d.codes);
 const pending=ps.filter(p=>p.status==='pending'),confirmed=ps.filter(p=>p.status==='confirmed');
 return scopeControls(d)+section('今天要处理',`<div class="todo"><button data-go="cw"><b>${pending.length}</b>待面试 VIP</button><button data-go="cw"><b>${confirmed.length}</b>待核验开通</button><button data-go="approvals"><b>${ps.reduce((n,p)=>n+p.discount_pending+p.exception_pending,0)+gs.filter(g=>g.status==='pending'&&g.state!=='expired').length}</b>待审批事项</button><button data-go="tickets">客户诉求与工单</button></div>`)
 +section('当前范围的业务情况',table(['业务','客户／合作伙伴','累计实付','退款／佣金'],`<tr><td>VIP 招募</td><td>${ps.length} 位，其中正式 VIP ${ps.filter(p=>p.status==='active').length} 位</td><td>${fen(total(ps,'paid_fen'))}</td><td>退款 ${fen(total(ps,'refunded_fen'))}</td></tr><tr><td>员工直营</td><td>${gs.length} 个折扣码</td><td>${fen(total(gs,'paid_fen'))}</td><td>退款 ${fen(total(gs,'refunded_fen'))} · 无 VIP 返佣</td></tr><tr><td>VIP 推广</td><td>${cs.length} 个推广码</td><td>${fen(total(cs,'paid_fen'))}</td><td>预计 ${fen(total(cs,'expected_fen'))} · 已解锁 ${fen(total(cs,'unlocked_fen'))}</td></tr>`),'','VIP 招募实付属于申请人本人；VIP 推广实付属于其推荐客户，两项可能重叠，不合计为公司收入。')
 +section('等待开通的 VIP',table(['客户','负责销售','当前进度','已到账／退款','下一步'],confirmed.map(p=>`<tr><td>${vipButton(p)}</td><td>${esc(p.owner_name||'待分配')}</td><td>面试已通过，待核验开通</td><td>${fen(p.paid_fen)} / ${fen(p.refunded_fen)}</td><td>正常开通门槛实付 ¥100${Number(p.paid_fen)>0?'<small>已有付款先核验原单，可提交原单特批</small>':'<small>发放本人付款码并跟进</small>'}</td></tr>`).join(''),'没有待核验开通的客户。'));
};
pages.cw=()=>`<iframe class="acquisition-vip" title="VIP 招募与客户档案" src="/promotion/vip.html?staff=1&amp;embedded=1${ui.vipPartner?'&amp;partner='+encodeURIComponent(ui.vipPartner):''}"></iframe>`;
pages.direct=d=>{
 const gs=scopeRows(d.grants,'created_by'),os=scopeRows(d.orders,'created_by');
 if(ownerSurface&&ui.acquisitionQuery&&os.some(o=>o.out_trade_no===ui.acquisitionQuery))ui.directView='orders';
 const customers=Object.values(os.reduce((map,o)=>{const x=map[o.account_id]||={...o,paid:0,refunded:0,codes:new Set(),owners:new Set()};x.codes.add(o.promo_code);x.owners.add(o.owner_name);if(o.status==='paid'){x.paid+=Number(o.amount_fen);x.refunded+=Number(o.refunded_fen);}return map;},{}));
 const tabs=ownerSurface?`<div class="acquisition-tabs"><button data-act="direct-view" data-view="codes" aria-current="${!ui.directView||ui.directView==='codes'?'page':'false'}">直营折扣码</button><button data-act="direct-view" data-view="customers" aria-current="${ui.directView==='customers'?'page':'false'}">直营客户</button><button data-act="direct-view" data-view="orders" aria-current="${ui.directView==='orders'?'page':'false'}">使用订单</button></div>`:'';
 if(ownerSurface&&ui.directView==='customers')return scopeControls(d)+tabs+table(['客户','负责员工','使用折扣码','累计实付','已退款'],customers.map(o=>`<tr><td>${esc(o.customer_name)}</td><td>${esc([...o.owners].join('、'))}</td><td>${esc([...o.codes].join('、'))}</td><td>${fen(o.paid)}</td><td>${fen(o.refunded)}</td></tr>`).join(''),'客户使用直营码下单后，会自动显示在这里。');
 if(ownerSurface&&ui.directView==='orders')return scopeControls(d)+tabs+table(['商户订单号／客户','直营折扣码','负责员工','实付／到账额度','已退款','状态'],os.map(o=>`<tr><td>${esc(o.out_trade_no)}<small>${esc(o.customer_name)}</small></td><td>${esc(o.promo_code)}<small>${discountText(o.customer_price_percent)} · 无 VIP 返佣</small></td><td>${esc(o.owner_name)}</td><td>${fen(o.amount_fen)} / ${fen(o.face_fen)}</td><td>${fen(o.refunded_fen)}</td><td>${pill('order',o.status)}<small>${when(o.paid_at||o.created_at)}</small></td></tr>`).join(''),'暂无使用订单。');
 const size=innerHeight<560?3:5,total=Math.max(1,Math.ceil(gs.length/size));ui.codePage=Math.max(0,Math.min(ui.codePage||0,total-1));
 return scopeControls(d)+section('客户推广码',table(['推广码 / 有效期','客户实付','实付消耗 / 退款','操作'],gs.slice(ui.codePage*size,(ui.codePage+1)*size).map(g=>`<tr><td><b>${esc(g.promo_code)}</b><small>${esc(g.name)} · ${discountText(g.customer_price_percent)} · ${pill('discount',g.state)}</small><small>${dayOf(g.starts_at)} – ${lastDay(g.ends_at)}</small></td><td>${fen(g.paid_fen)}</td><td>${fen(g.used_fen||0)}<small>退款 ${fen(g.refunded_fen)}</small></td><td><button data-act="code-activity" data-id="${att(g.id)}" data-kind="direct">收支明细</button>${g.state==='pending'?` <button data-go="${ownerSurface?'approvals':'customerapplications'}">查看申请</button>`:''}${g.state==='active'?` <button data-act="direct-link" data-id="${att(g.id)}">复制链接</button> <a href="/api/staff/business/direct-codes/${att(g.id)}/qr" download="推广码.svg">二维码</a> <button data-act="discount" data-id="${att(g.id)}" data-action="revoke">停用</button>`:''}</td></tr>`).join(''),'还没有推广码。'),'<button class="primary" data-act="direct-new">生成客户推广码</button>')+`<div class="code-pages"><span>共 ${gs.length} 个码 · ${ui.codePage+1} / ${total} 页</span><button data-act="code-page" data-step="-1" ${ui.codePage===0?'disabled':''}>上一页</button><button data-act="code-page" data-step="1" ${ui.codePage===total-1?'disabled':''}>下一页</button></div>`;
};
pages.promotions=d=>{
 const codes=scopeRows(d.codes),size=innerHeight<560?3:5,total=Math.max(1,Math.ceil(codes.length/size));ui.codePage=Math.max(0,Math.min(ui.codePage||0,total-1));
 return scopeControls(d)+section('VIP 推广码',table(['VIP / 推广码','客户实付','消费提成（税前）','操作'],codes.slice(ui.codePage*size,(ui.codePage+1)*size).map(k=>`<tr><td>${esc(k.code)}<small>${esc(k.legal_name)} · ${esc(k.name)} · ${discountText(k.customer_price_percent)}</small></td><td>${fen(k.paid_fen)}</td><td>${fen(k.unlocked_fen)}</td><td><button data-act="code-activity" data-id="${att(k.id)}" data-kind="cw">收支明细</button></td></tr>`).join(''),'暂无 VIP 推广码。'))+`<div class="code-pages"><span>共 ${codes.length} 个码 · ${ui.codePage+1} / ${total} 页</span><button data-act="code-page" data-step="-1" ${ui.codePage===0?'disabled':''}>上一页</button><button data-act="code-page" data-step="1" ${ui.codePage===total-1?'disabled':''}>下一页</button></div>`;
};
pages.approvals=d=>scopeControls(d)+section(d.administrator?'待我审批':'我提交的审批',table(['业务','客户或折扣码','事项','操作'],scopeRows(d.partners).filter(p=>p.discount_pending||p.exception_pending).map(p=>`<tr><td>VIP 招募</td><td>${esc(p.legal_name)}<small>${esc(p.public_code)}</small></td><td>${p.discount_pending?'本人付款码特殊折扣':''}${p.discount_pending&&p.exception_pending?'、':''}${p.exception_pending?'按原单特批开通':''}</td><td>${vipButton(p)}</td></tr>`).join('')+scopeRows(d.grants,'created_by').filter(g=>g.state==='pending').map(g=>`<tr><td>员工直营</td><td>${esc(g.promo_code)}<small>${esc(g.created_by_name)}</small></td><td>${discountText(g.customer_price_percent)}<small>单笔门槛 ${fen(g.min_cash_fen||0)} · ${g.non_refundable?'不可自助退款':'正常退款规则'}</small><small>${esc(g.reason)}</small></td><td>${d.administrator?`<button data-act="discount" data-id="${att(g.id)}" data-action="approve">批准</button> <button data-act="discount" data-id="${att(g.id)}" data-action="reject">驳回</button>`:'等待管理员审批'}</td></tr>`).join(''),'没有待审批事项。'))
 +section('直营折扣审批记录',table(['折扣码','申请折扣','状态','处理时间／原因'],scopeRows(d.grants,'created_by').filter(g=>g.status!=='pending'&&(g.customer_price_percent!==50||g.non_refundable||Number(g.min_cash_fen)>0)).map(g=>`<tr><td>${esc(g.promo_code)}</td><td>${discountText(g.customer_price_percent)}</td><td>${pill('discount',g.state)}</td><td>${when(g.decided_at)}<small>${esc(g.decision_note||'—')}</small></td></tr>`).join(''),'暂无记录。'),'','VIP 折扣和原单特批的完整记录保留在客户档案内。');
function promotionData(d,page){
 const base={...d,administrator:false};
 return promotionChannel(page)==='customer'?{...base,partners:[],codes:[],vip_orders:[]}:{...base,grants:[],orders:[]};
}
function promotedCustomers(orders){
 return Object.values(orders.reduce((map,o)=>{const row=map[o.account_id]||={name:o.customer_name,codes:new Set(),orders:0,paid:0,refunded:0};row.codes.add(o.promo_code);row.orders++;if(o.status==='paid'){row.paid+=Number(o.amount_fen||0);row.refunded+=Number(o.refunded_fen||0);}return map;},{}));
}
pages.customeroverview=d=>{
 const grants=scopeRows(d.grants,'created_by'),orders=scopeRows(d.orders,'created_by'),customers=promotedCustomers(orders);
 return scopeControls(d)+section('客户推广概况',`<div class="todo"><button data-go="direct"><b>${grants.length}</b>客户推广码</button><button data-go="customerapplications"><b>${grants.filter(g=>g.state==='pending').length}</b>待处理申请</button></div>`)
 +section('推广客户',table(['客户','使用推广码','订单数','累计实付','已退款'],customers.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc([...c.codes].join('、'))}</td><td>${c.orders}</td><td>${fen(c.paid)}</td><td>${fen(c.refunded)}</td></tr>`).join(''),'客户使用你的推广码下单后，会显示在这里。'),'','按付款账户汇总；只统计客户推广订单。');
};
pages.vipoverview=d=>{
 const partners=scopeRows(d.partners),status={pending:'待面试',confirmed:'待开通',active:'已开通',suspended:'已暂停',rejected:'未通过'};
 return scopeControls(d)+section('VIP推广概况',`<div class="todo"><button data-go="cw"><b>${partners.length}</b>负责的 VIP</button><button data-go="vipcodes">管理 VIP推广码</button><button data-go="vipapplications"><b>${partners.reduce((n,p)=>n+Number(p.discount_pending||0)+Number(p.exception_pending||0),0)}</b>待处理申请</button></div>`)
 +section('VIP客户',table(['VIP','当前进度','下次联系','本人已实付','操作'],partners.map(p=>`<tr><td>${esc(p.legal_name)}<small>${esc(p.public_code)}</small></td><td>${esc(status[p.status]||p.status)}</td><td>${dayOf(p.next_contact_on)}</td><td>${fen(p.paid_fen)}</td><td>${vipButton(p)}</td></tr>`).join(''),'暂无负责的 VIP。'),'<button data-go="cw">进入 VIP 客户跟进</button>');
};
pages.customerapplications=d=>scopeControls(d)+section('客户推广申请',table(['客户推广码','申请事项','状态','处理时间／原因'],scopeRows(d.grants,'created_by').filter(g=>g.status==='pending'||g.customer_price_percent!==50||g.non_refundable||Number(g.min_cash_fen)>0).map(g=>`<tr><td>${esc(g.promo_code)}<small>${esc(g.name)}</small></td><td>${discountText(g.customer_price_percent)}<small>${esc(g.reason)}</small></td><td>${pill('discount',g.state)}</td><td>${when(g.decided_at)}<small>${esc(g.decision_note||(g.status==='pending'?'等待老板审批':'—'))}</small></td></tr>`).join(''),'暂无客户推广申请。'));
pages.vipcodes=d=>section('我发出的 VIP推广码',table(['推广码','已使用／次数上限','状态','备注','操作'],(d.invite_codes||[]).map(c=>`<tr><td><b>${esc(c.code)}</b></td><td>${c.used_count} / ${c.max_uses}</td><td>${c.status==='active'?'生效中':'已停用'}</td><td>${esc(c.note)}</td><td>${c.status==='active'&&c.used_count<c.max_uses?`<button data-act="vip-invite-copy" data-code="${att(c.code)}">复制申请链接</button> `:''}<button data-act="vip-invite-status" data-code="${att(c.code)}" data-status="${c.status==='active'?'disabled':'active'}">${c.status==='active'?'停用':'启用'}</button></td></tr>`).join(''),'暂无 VIP推广码。'),'<button class="primary" data-act="vip-invite-new">生成 VIP推广码</button>','客户通过推广链接提交 VIP 申请后，进入你的跟进列表。');
pages.vipapplications=d=>scopeControls(d)+section('VIP待处理申请',table(['VIP','申请事项','操作'],scopeRows(d.partners).filter(p=>p.discount_pending||p.exception_pending).map(p=>`<tr><td>${esc(p.legal_name)}<small>${esc(p.public_code)}</small></td><td>${p.discount_pending?'本人付款码特殊折扣':''}${p.discount_pending&&p.exception_pending?'、':''}${p.exception_pending?'原单开通特批':''}</td><td>${vipButton(p)}</td></tr>`).join(''),'暂无待处理的 VIP 申请。'))
 +section('VIP申请记录',table(['VIP','当前状态','查看记录'],scopeRows(d.partners).map(p=>`<tr><td>${esc(p.legal_name)}<small>${esc(p.public_code)}</small></td><td>${p.discount_pending||p.exception_pending?'有申请待处理':'无待处理申请'}</td><td>${vipButton(p)}</td></tr>`).join(''),'暂无 VIP 申请记录。'),'','进入对应 VIP 档案查看完整申请与审批记录。');
function directDialog(){
 const end=new Date(Date.now()+90*86400000).toISOString().slice(0,10);
 openForm({title:'生成客户推广码',wide:true,submit:'生成／提交审批',body:`<div class="direct-code-form"><label>折扣码<input name="promo_code" required maxlength="16" autocomplete="off" placeholder="8 个英文字母或 8 个中文字符"></label><label>用途名称<input name="name" required maxlength="100"></label><label>客户实付比例（%）<input name="customer_price_percent" type="number" min="1" max="99" required value="50"></label><label>单笔最低实付（元，0 表示不限）<input name="min_cash_yuan" type="number" min="0" max="50000" step="0.01" value="0"></label><label class="check"><input name="non_refundable" type="checkbox"> 本优惠充值不可自助退款（付款前须由客户明确确认）</label><div class="row2"><label>开始日期<input name="starts_at" type="date" required value="${today()}"></label><label>结束日期（含当天）<input name="ends_at" type="date" required value="${end}"></label></div><label>用途或特批原因<textarea name="reason" required maxlength="500"></textarea></label><p class="code-form-note">默认 5 折直接生效；其他折扣、门槛或不可退款约定需审批。到期后原码不复用。</p></div>`,onSubmit:async v=>{
  if(!/^(?:[A-Za-z]{8}|\p{Script=Han}{8})$/u.test(v.promo_code.normalize('NFKC').trim()))throw Error('请输入 8 个英文字母或 8 个中文字符，不混用数字或符号。');
  const result=await api('business/discounts',{...v,non_refundable:v.non_refundable==='on',business_line:'direct',audience:'all',customer_price_percent:Number(v.customer_price_percent),starts_at:v.starts_at+'T00:00:00+08:00',ends_at:new Date(Date.parse(v.ends_at+'T00:00:00+08:00')+86400000).toISOString()});
  return result.status==='active'?'客户推广码已生效，可以复制链接发给客户。':'已提交管理员审批，通过后才能使用。';
 }});
}

// ---- Rendering ------------------------------------------------------------------------------
addEventListener('message',e=>{if(e.origin===location.origin&&e.source===document.querySelector('.staff-code-activity')?.contentWindow&&e.data?.type==='semifly-code-activity-close'){ui.codeActivity=null;draw();}});
const navOpen=new Map();
const navStorageKey='semifly.staff.navigation.'+(ownerSurface?'owner':'employee');
try{for(const [key,value] of JSON.parse(sessionStorage.getItem(navStorageKey)||'[]'))if(typeof value==='boolean')navOpen.set(key,value);}catch{}
function rememberNav(){try{sessionStorage.setItem(navStorageKey,JSON.stringify([...navOpen]));}catch{}}
document.addEventListener('toggle',e=>{const group=e.target;if(!group.matches?.('#nav details[data-nav-group]')||!group.isConnected)return;navOpen.set(group.dataset.navGroup,group.open);rememberNav();},true);
function drawNav(page) {
 for(const group of document.querySelectorAll?.('#nav details[data-nav-group]')||[])navOpen.set(group.dataset.navGroup,group.open);

 const c = state.dash.counts, counts = { tickets: c.tickets, upgrades: c.upgrades, invoices: c.invoices_requested, transfers: c.bank_transfers_pending, discounts: c.discounts_pending };
 $('#nav').innerHTML = NAV.filter(([, , gate]) => !gate || state.dash.staff[gate]).map(([group, items]) => {
  const buttons=items.map(([key,label])=>`<button data-tab="${key}" class="${page===key?'active':''}" ${page===key?'aria-current="page"':''}>${label}${counts[key]?`<span class="count">${counts[key]}</span>`:''}</button>`).join('');
  if(group==='工作台'||group==='员工工作台')return `<div class="nav-home">${buttons}</div>`;
  const active=items.some(([key])=>key===page)||(page==='cw'&&group==='VIP推广'),preferred={support:'客户支持',operations:'推广与合作',supply:'产品与供应',finance:'订单与资金'}[state.dash.staff.role];
  if(!navOpen.has(group))navOpen.set(group,active||(ownerSurface&&page==='home'&&group===preferred));
  return `<details class="nav-group" data-nav-group="${att(group)}" ${navOpen.get(group)?'open':''}><summary>${group}</summary><div>${buttons}</div></details>`;
 }).join('');
}
async function draw() {
 const page = currentPage(), content = $('#content');
 document.body.classList.toggle('code-screen',['direct','promotions'].includes(page)||Boolean(ui.codeActivity));
 if(ui.codeActivity&&['direct','promotions'].includes(page)){content.innerHTML=`<iframe class="staff-code-activity" title="推广码收支明细" src="/code-activity.html?audience=staff&amp;kind=${ui.codeActivity.kind}&amp;code=${encodeURIComponent(ui.codeActivity.id)}"></iframe>`;return;}
 const channel=promotionChannel(page);
 if(!ownerSurface&&channel&&channel!==ui.promotionChannel){ui.promotionSearch||={};if(ui.promotionChannel)ui.promotionSearch[ui.promotionChannel]=ui.acquisitionQuery||'';ui.acquisitionQuery=ui.promotionSearch[channel]||'';ui.promotionChannel=channel;}
 document.querySelector('.shell')?.classList.toggle('shared-api',Boolean(API_VIEWS[page]));
 document.title=ownerSurface?'semifly.ai · 老板工作台':'semifly.ai · 员工工作台';
 $('#title').textContent = !ownerSurface&&['customerapplications','vipapplications'].includes(page)?(page==='customerapplications'?'客户推广 · 我的申请':'VIP推广 · 我的申请'):PAGES[page].label;
 $('#subtitle').textContent = !ownerSurface&&page==='customers'?'管理自己负责的客户，记录跟进并提供服务。':SUBTITLES[page];
 if (!state) { content.innerHTML = `<div class="panel empty">${esc(loadError || '正在读取…')}</div>`; return; }
 $('#technical').hidden = !ownerSurface||!state.dash.staff.technical;
 if(!allowedPage(page)){ $('#nav').innerHTML='';drawNav('home');content.innerHTML='<div class="panel empty">此页面不属于员工工作台。请返回今日工作；经营、供应与资金由老板身份管理。<p><button data-go="home">返回今日工作</button></p></div>';return; }
 drawNav(page);
 if (PAGES[page].gate && !state.dash.staff[PAGES[page].gate]) { content.innerHTML = '<div class="panel empty">这一页需要财务权限。请平台管理员在“账户与权限”里为你打开财务开关。</div>'; return; }
 if(API_VIEWS[page]){
  ++drawing;const frame=document.querySelector('#employee-api-frame');
  if(frame?.contentWindow){if(!apiInnerNavigation)frame.contentWindow.location.replace('/employee-api.html#'+API_VIEWS[page]);}
  else content.innerHTML=`<iframe id="employee-api-frame" class="employee-api-frame" title="我的 API" src="/employee-api.html#${API_VIEWS[page]}"></iframe>`;
  apiInnerNavigation=false;return;
 }
 apiInnerNavigation=false;
 const turn = ++drawing, started = generation, source = SOURCES[page]?.();
 const needsOverview = ['suppliers', 'products'].includes(page);
 const needsBusiness = ['overview', 'products', 'upgrades'].includes(page);
 const needsFinance = ['overview', 'products'].includes(page);
 content.innerHTML = '<div class="panel empty">正在读取…</div>';
 try {
  const [overview, biz, dash] = await Promise.all([
   needsOverview ? get('workspace/overview') : null,
   needsBusiness ? get('workspace/business') : null,
   needsFinance ? get('business/dashboard') : null,
   source ? get(source) : null
  ]);
  if (turn !== drawing || started !== generation || currentPage() !== page) return;
  Object.assign(state, { overview, biz });
  if (dash) state.dash = dash;
  content.innerHTML = (ownerSurface&&page!=='cw'&&acquisitionPages.some(([key])=>key===page)?acquisitionTabs(page):'')+pages[page](source ? (!ownerSurface&&promotionChannel(page)?promotionData(cache[source],page):cache[source]) : null);
  if (page === 'customers' && ui.customers.q) filterRows(ui.customers.q);
 } catch (e) {
  if (turn === drawing && started === generation && currentPage() === page) content.innerHTML = `<div class="panel empty">${esc(e.message)}，请点击刷新重试。</div>`;
 }
}
async function load() {
 const started = generation;
 try {
  const dash = await api('business/dashboard?summary=1');
  if (started !== generation) return;
  state = { dash }; loadError = '';
 } catch (e) { if (started !== generation) return; state = null; loadError = e.message + '，请点击刷新重试。'; }
 await draw();
}
async function reload() { generation++; drawing++; state = null; for (const key of Object.keys(cache)) delete cache[key]; notify(''); await draw(); await load(); }
function filterRows(q) {
 q=q.trim().toLowerCase();let visible=0;
 document.querySelectorAll('tr[data-find]').forEach(r=>{r.hidden=Boolean(q)&&!r.dataset.find.includes(q);if(!r.hidden)visible++;});
 const count=$('#customerResultCount');if(count)count.textContent=`${visible} / ${count.dataset.total} 个客户`;
}

// ---- Actions --------------------------------------------------------------------------------
const customerOptions = async selected => (await get('business/customers')).customers.map(c => `<option value="${att(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.code)} ${esc(c.name)}</option>`).join('');

async function customerDialog(customerId) {
 const [d, list] = await Promise.all([api('business/customers/' + customerId), get('business/customers')]), c = d.customer, f = d.finance;
 const staff = Object.fromEntries(list.staff.map(s => [s.subject, s.name]));
 const fact = (label, value) => `<div><span>${label}</span><b>${value}</b></div>`;
 let body = `<p>${pill('kind', c.kind)} ${esc(c.email)}${c.kind === 'personal' && c.orgs ? ' · 所属 ' + esc(c.orgs) : ''} · 建档 ${dayOf(c.created_at)}</p>`
  + `<div class="facts">${fact('官价额度', fen(c.list_credit_fen))}${fact('实付余额', fen(c.balance_fen))}${fact('累计实付', fen(c.recharged_fen))}${fact('内部额度已用 / 发放', `${yuan(c.credit_spent)} / ${yuan(c.credit_granted)}`)}${fact('30 天调用', c.calls_30d)}${fact('最近调用', dayOf(c.last_call_at))}${f ? fact('可开票金额', fen(f.invoice_limit.available_fen)) : ''}</div>`
  + `<div class="row2"><label>客户阶段<select name="stage">${options(LABEL.stage, c.stage)}</select></label><label>负责人<select name="owner_subject" ${ownerSurface?'':'disabled'}>${options(staff, c.owner_subject, '未分配')}</select></label></div><label>标签（用空格分隔，同时作为折扣的客户分群）<input name="tags" ${ownerSurface?'':'readonly'} value="${att(c.tags.join(' '))}" placeholder="例如：高校 重点行业"></label>`;
 body += `<h3 style="margin-top:8px">跟进记录</h3><div class="row2" style="grid-template-columns:1fr auto;align-items:end"><textarea id="noteBody" rows="2" maxlength="2000" placeholder="电话、拜访、报价、客户反馈…"></textarea><button type="button" data-act="note-add" data-id="${att(c.id)}">添加记录</button></div><div class="thread">${d.notes.map(n => `<article><header>${esc(n.created_by_name)} · ${when(n.created_at)}</header>${esc(n.body)}</article>`).join('') || '<small>还没有跟进记录。</small>'}</div>`;
 if (d.discounts.length) body += `<h3>适用的折扣授权</h3>${table(['授权', '对象', ['客户实付'], '有效期', '状态'], d.discounts.map(g => `<tr><td>${esc(g.name)}</td><td>${audienceText(g)}</td>${num(discountText(g.customer_price_percent))}<td>${dayOf(g.starts_at)} – ${lastDay(g.ends_at)}</td><td>${pill('discount', g.state)}</td></tr>`).join(''))}`;
 if (d.members.length) body += `<h3 style="margin-top:12px">成员</h3>${table(['姓名', '邮箱', '身份'], d.members.map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td>${['owner', 'admin', 'billing'].includes(m.role) ? '管理者' : '成员'}</td></tr>`).join(''))}`;
 if (d.tickets.length) body += `<h3 style="margin-top:12px">最近工单</h3>${table(['工单', '分类', '状态', '时间'], d.tickets.map(t => `<tr><td>${esc(t.subject)}</td><td>${esc(LABEL.category[t.category])}</td><td>${pill('ticket', t.status)}</td><td>${when(t.created_at)}</td></tr>`).join(''))}`;
 if (f?.orders.length) body += `<h3 style="margin-top:12px">付款记录</h3>${table(['订单', ['金额'], ['已退'], '付款时间'], f.orders.map(o => `<tr><td>${esc(o.out_trade_no)}</td>${num(fen(o.amount_fen))}${num(fen(o.refunded_fen))}<td>${when(o.paid_at)}</td></tr>`).join(''))}`;
 if (f?.invoices.length) body += `<h3 style="margin-top:12px">发票</h3>${table(['抬头', ['金额'], '状态', '发票号'], f.invoices.map(i => `<tr><td>${esc(i.title)}</td>${num(fen(i.amount_fen))}<td>${pill('invoice', i.status)}</td><td>${esc(i.invoice_number || '—')}</td></tr>`).join(''))}`;
 openForm({ title: `<code>${esc(c.code)}</code> ${esc(c.name)}`, body, wide: true, submit: ownerSurface?'保存阶段、负责人和标签':'保存客户阶段', onSubmit: async v => { await api('business/customers/' + c.id, { stage: v.stage, owner_subject: ownerSurface?(v.owner_subject||null):c.owner_subject, tags: v.tags.split(/[\s,，]+/).filter(Boolean) }); return `${c.code} 已更新。`; } });
}

async function invoiceDialog() {
 const input = ui.invoices === 'input', d = await get('business/invoices');
 const target = input ? `<label>供应商<select name="supplier_id" required>${d.suppliers.map(s => `<option value="${att(s.id)}">${esc(s.code)} ${esc(s.display_name)}</option>`).join('')}</select></label>` : `<label>客户<select name="customer_id" required>${await customerOptions()}</select></label>`;
 openForm({
  title: input ? '登记进项发票' : '登记销项发票', submit: '登记',
  body: `${target}<div class="row2"><label>发票类型<select name="invoice_type">${options(LABEL.invoiceType, input ? 'special' : 'general')}</select></label><label>金额（元，含税）<input name="amount_yuan" required inputmode="decimal" placeholder="0.00"></label></div><label>${input ? '销售方名称' : '发票抬头'}<input name="title" required maxlength="160"></label><div class="row2"><label>纳税人识别号<input name="tax_number" maxlength="20" placeholder="企业抬头和专用发票必填"></label><label>收票邮箱<input name="email" type="email" maxlength="254"></label></div><div class="row2"><label>发票号码${input ? '' : '（已开具时填写）'}<input name="invoice_number" maxlength="30" ${input ? 'required' : ''}></label><label>开票日期<input name="issued_on" type="date" value="${today()}"></label></div><label>备注<input name="note" maxlength="500"></label>${input ? '' : '<label class="check"><input type="checkbox" name="allow_over_limit" value="yes"> 允许超出实收金额（先票后款）</label><small>不填发票号码则登记为“待开票”，开具后再补号码。</small>'}`,
  onSubmit: async v => { await api('business/invoices', { ...v, direction: input ? 'input' : 'output', allow_over_limit: v.allow_over_limit === 'yes' }); return '发票已登记。'; }
 });
}

function ticketDialog(ticketId) {
 const d = cache['business/support'], t = d.tickets.find(x => x.id === ticketId), closed = t.status === 'closed', answers = d.answers.filter(a => a.category === t.category).concat(d.answers.filter(a => a.category !== t.category));
 const body = `<p>${t.customer_code ? `<code>${esc(t.customer_code)}</code> ` : ''}${esc(t.name)} · ${esc(t.email)} · ${when(t.created_at)} · ${pill('ticket', t.status)}</p><div class="thread"><article><header>客户</header>${esc(t.body)}</article>${t.replies.map(r => `<article class="staff"><header>${esc(r.created_by_name)} · ${when(r.created_at)}</header>${esc(r.body)}</article>`).join('')}</div>`
  + `<div class="row2"><label>分类<select name="category">${options(LABEL.category, t.category)}</select></label><label>处理层级<select name="tier">${options(LABEL.tier, t.tier)}</select></label></div>`
  + (closed ? '' : `<label>引用快捷问答<select id="answerPick"><option value="">不引用，自己写</option>${answers.map(a => `<option value="${att(a.id)}">${esc(LABEL.category[a.category])} · ${esc(a.question)}</option>`).join('')}</select></label><input type="hidden" name="answer_id"><label>回复客户<textarea name="body" rows="5" maxlength="2000" placeholder="回复会显示在客户面板的工单里。只改分类或层级时可以留空。"></textarea></label><label class="check"><input type="checkbox" name="close" value="yes"> 回复后关闭工单</label>`);
 openForm({ title: esc(t.subject), body, wide: true, submit: closed ? '保存分类' : '保存', onSubmit: async v => {
  if (v.category !== t.category || v.tier !== t.tier) await api(`business/tickets/${t.id}/triage`, { category: v.category, tier: v.tier });
  if (!closed && v.body?.trim()) await api(`business/tickets/${t.id}/reply`, { body: v.body, close: v.close === 'yes', answer_id: v.answer_id || undefined });
  else if (!closed && v.close === 'yes') throw Error('关闭工单前请写一句回复');
  return v.tier === 'technical' && t.tier !== 'technical' ? '已转技术；请同时在技术群里说明。' : '工单已更新。';
 } });
}

function answerDialog(answerId) {
 const a = cache['business/support'].answers.find(x => x.id === answerId) || {};
 openForm({ title: a.id ? '编辑问答' : '新建问答', body: `<label>分类<select name="category">${options(LABEL.category, a.category || 'question')}</select></label><label>客户的问题<input name="question" required maxlength="200" value="${att(a.question)}"></label><label>标准答复<textarea name="answer" required rows="7" maxlength="2000">${att(a.answer)}</textarea></label><label class="check"><input type="checkbox" name="published" value="yes" ${a.published ? 'checked' : ''}> 对客户公开（显示在客户面板的常见问题里）</label>`,
  onSubmit: async v => { await api('business/answers', { id: a.id, category: v.category, question: v.question, answer: v.answer, published: v.published === 'yes' }); return '问答已保存。'; } });
}

async function discountDialog() {
 const d = cache['business/discounts'], tags = d.tags.map(t => `<option value="${att(t.tag)}">${esc(t.tag)}（${t.customers} 个客户）</option>`).join(''), customers = await customerOptions();
 const start = today(), end = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
 openForm({ title: '新建折扣授权', submit: '提交', body: `<label>促销码（留空自动匹配合同折扣）<input name="promo_code" maxlength="40" pattern="[A-Za-z0-9_-]{1,40}"></label><label>授权名称<input name="name" required maxlength="100" placeholder="例如：某某公司年度合作价"></label>
  <label>授权对象<select name="audience" id="audiencePick"><option value="customer">单个客户</option><option value="tag" ${tags ? '' : 'disabled'}>客户分群（按标签）</option><option value="all">全部客户</option></select></label>
  <label data-audience="customer">客户<select name="customer_id">${customers}</select></label><label data-audience="tag" hidden>分群标签<select name="tag">${tags}</select></label>
  <div class="row2"><label>适用产品<select name="model_id"><option value="">全部产品</option></select></label><label>客户实付比例（%）<input name="customer_price_percent" type="number" min="1" max="99" required value="90"></label></div>
  <div class="row2"><label>开始日期<input name="starts_at" type="date" required value="${start}"></label><label>结束日期（含当天）<input name="ends_at" type="date" required value="${end}"></label></div>
  <label>优惠金额上限（元，可不填）<input name="cap_yuan" inputmode="decimal"></label><label>授权理由<textarea name="reason" required rows="3" maxlength="500" placeholder="合同、用量承诺、竞争情况…"></textarea></label><small>85 表示客户按标价的 85% 付费，即 8.5 折。</small>`,
  onSubmit: async v => {
   // Dates are Beijing calendar days; the grant runs to the end of the last day.
   const r = await api('business/discounts', { ...v, customer_price_percent: Number(v.customer_price_percent), starts_at: v.starts_at + 'T00:00:00+08:00', ends_at: new Date(Date.parse(v.ends_at + 'T00:00:00+08:00') + 86400000).toISOString() });
   return r.status === 'active' ? '折扣授权已生效。' : '已提交，等待财务或平台管理员审批。';
  } });
}

const simple = (title, body, onSubmit, submit) => openForm({ title, body, onSubmit, submit });
const ACTIONS = {
 async 'wechat-bill-sync'(b){simple('同步微信账单',`<p>核对收款、退款及实际手续费；退款退费冲减公司成本，重复同步不重复记账。每天北京时间 10 点后自动检查。</p><label>账单日期<input type="date" name="day" required max="${att(b.dataset.day)}" value="${att(b.dataset.day)}"></label>`,async v=>{const r=await api('payments/wechat-bills/sync',{day:v.day});return r.status==='pending'?`账单暂未取得，可稍后重试（${r.error_code}）。`:`已核对 ${r.matched} 笔，${r.exceptions} 笔待人工核对。`;},'同步账单');},
 async 'alipay-bill-sync'(b){simple('同步支付宝账单',`<p>获取指定日的支付宝交易账单，核对收款与渠道费用。重复同步不会重复记成本；差异保留人工核对。</p><label>账单日期<input type="date" name="day" required max="${att(b.dataset.day)}" value="${att(b.dataset.day)}"></label>`,async v=>{const r=await api('payments/alipay-bills/sync',{day:v.day});return r.status==='pending'?`账单暂未取得，可稍后重试（${r.error_code}）。`:`已核对 ${r.matched} 笔，${r.exceptions} 笔待人工核对。`;},'同步账单');},
 async 'channel-fee'(b){simple('核对支付渠道成本',`<p>按商户账单登记实际扣收费用（扣除实际退回的渠道费）。只计入公司成本，不扣客户额度；零费用也请明确登记。更正会保留审计记录。</p><label>实际渠道费用（元）<input name="amount" inputmode="decimal" required value="${b.dataset.fee===''?'':(Number(b.dataset.fee)/100).toFixed(2)}"></label><label>账单凭据 / 核对说明<input name="evidence" required maxlength="200"></label>`,async v=>{if(!/^\d+(\.\d{1,2})?$/.test(v.amount))throw Error('请输入最多两位小数的金额');await api(`payments/orders/${b.dataset.id}/channel-fee`,{amount_fen:Math.round(Number(v.amount)*100),version:Number(b.dataset.version),evidence:v.evidence});return '渠道成本已登记，客户额度不变。';},'保存核对记录');},
 async refund(b) {
  const q=await api(`payments/orders/${b.dataset.id}/refund-quote`);
  if(q.blocked)return notify(q.blocked);
  const idempotency=crypto.randomUUID().replace(/-/g,'');
  simple('退回本包剩余实付', `<p>可退红色实付 <strong>${fen(q.refundable_fen)}</strong>（无手续费）；绿色赠送 ${fen(q.bonus_fen)} 将整条收回，不可退实付 ${fen(q.retained_fen)} 将保留。</p><p>退款暂时冻结本包剩余额度；渠道明确拒绝后恢复。已开发票需先作废或红冲。</p><label>退款原因<input name="reason" required maxlength="200"></label><label class="check"><input type="checkbox" required> 我已核对客户申请和退款金额</label>`, async v => {
   const latest=await api(`payments/orders/${b.dataset.id}/refund-quote`);
   if(latest.blocked)throw Error(latest.blocked);
   if(latest.remaining_fen!==q.remaining_fen)throw Error('剩余额度已变化，请关闭后重新预览');
   const result=await api(`payments/orders/${b.dataset.id}/refunds`,{reason:v.reason,expected_amount_fen:Number(q.refundable_fen),idempotency_key:idempotency});
   return {succeeded:'退款已成功',failed:'渠道拒绝，额度已恢复',pending:'退款处理中，请稍后确认'}[result.status];
  },'确认原路退款');
 },
 async 'refund-policy'(b){
  let reviewed=null;const key=crypto.randomUUID();
  openForm({title:'按客户工单处理限制款项退款',submit:'核验工单并预览',body:`<p>仅管理员可操作。工单必须由该付款账户提交，类型为账单且尚未关闭。已开票部分须先作废或红冲。</p><label>客户账单工单编号<input name="ticket" required></label><label>特批原因<input name="reason" required maxlength="200"></label><div id="policy-refund-preview" role="status"></div>`,onSubmit:async v=>{
   if(!reviewed||reviewed.ticket!==v.ticket||reviewed.reason!==v.reason){
    const q=await api(`payments/orders/${b.dataset.id}/refund-quote?ticket=${encodeURIComponent(v.ticket)}`);if(q.blocked)throw Error(q.blocked);
    reviewed={...v,q};$('#policy-refund-preview').innerHTML=`<p>本次原路退回 <strong>${fen(q.refundable_fen)}</strong>；收回赠送 ${fen(q.bonus_fen)}；保留实付 ${fen(q.retained_fen)}。</p><label class="check"><input type="checkbox" name="confirmed" required> 已核对原单、客户工单及特批原因</label>`;$('#dialogForm [type=submit]').textContent='确认特批退款';return false;
   }
   if(!v.confirmed)throw Error('请确认核验结果');
   const result=await api(`payments/orders/${b.dataset.id}/refunds`,{reason:v.reason,policy_ticket_id:v.ticket,expected_amount_fen:Number(reviewed.q.refundable_fen),idempotency_key:key});
   return {succeeded:'特批退款已成功并留存工单记录',failed:'渠道拒绝，额度已恢复',pending:'退款处理中，请稍后核对'}[result.status];
  }});
 },
 async 'refund-retry'(b) { const r = await api(`payments/refunds/${b.dataset.id}/retry`, {}); await reload(); notify({ succeeded: '退款已确认成功。', failed: '支付渠道拒绝了这笔退款，金额已冲回。', pending: '渠道仍在处理，请稍后再试。' }[r.status], r.status === 'succeeded'); },
 'invoice-new': () => invoiceDialog(),
 'invoice-issue': b => simple('登记开具', `<p>在电子税务局开具后，把发票号码登记在这里。</p><label>发票号码<input name="invoice_number" required minlength="8" maxlength="30"></label><label>开票日期<input name="issued_on" type="date" required value="${today()}"></label>`, async v => { await api(`business/invoices/${b.dataset.id}/issue`, v); return '已登记为已开具。'; }, '登记'),
 'invoice-reject': b => simple('退回开票申请', '<label>退回原因（客户可见）<textarea name="note" required rows="3" maxlength="500"></textarea></label>', async v => { await api(`business/invoices/${b.dataset.id}/reject`, v); return '申请已退回，金额回到客户的可开票额度。'; }, '退回'),
 'invoice-void': b => simple(b.dataset.kind === 'void' ? '作废发票' : '红冲发票', `<p>请先在电子税务局完成${b.dataset.kind === 'void' ? '作废' : '红字发票开具'}，再在这里登记。金额会回到可开票额度。</p><label>原因<textarea name="note" required rows="3" maxlength="500"></textarea></label>`, async v => { await api(`business/invoices/${b.dataset.id}/${b.dataset.kind}`, v); return '已登记。'; }, '登记'),
 'payable-new': () => simple('登记给上游的付款', `<label>供应商<select name="supplier_id" required>${cache['business/supplier-payments'].suppliers.map(s => `<option value="${att(s.id)}">${esc(s.code)} ${esc(s.display_name)}</option>`).join('')}</select></label><div class="row2"><label>金额（元）<input name="amount_yuan" required inputmode="decimal" placeholder="0.00"></label><label>付款日期<input name="paid_on" type="date" required value="${today()}" max="${today()}"></label></div><div class="row2"><label>付款方式<select name="method">${options(LABEL.method, 'bank')}</select></label><label>银行或平台流水号<input name="reference" maxlength="120"></label></div><label>备注<input name="note" maxlength="500" placeholder="例如：11 月账户充值"></label>`, async v => { await api('business/supplier-payments', v); return '付款已登记。'; }, '登记'),
 'payable-void': b => simple('作废付款记录', '<p>作废后这笔付款不再计入现金支出，记录保留。</p>', async () => { await api(`business/supplier-payments/${b.dataset.id}/void`, {}); return '已作废。'; }, '作废'),
 async 'transfer-new'(b) {
  const n=cache['business/bank-transfers']?.notices?.find(n=>n.id===b?.dataset.notice);
  const customers=(await get('business/customers')).customers.filter(c=>c.kind==='enterprise'),selected=n?customers.find(c=>c.organization_id===n.organization_id)?.id:'';
  openForm({title:'登记对公到账',submit:'提交待复核',
   body:`${n?`<input type="hidden" name="notice_id" value="${att(n.id)}"><p>客户提交：${esc(n.payer_name)} · ${fen(n.cash_fen)} · 付款流水 ${esc(n.payer_reference)}</p>`:''}<label>企业客户<select name="customer_id" required>${customers.map(c=>`<option value="${att(c.id)}" ${selected===c.id?'selected':''}>${esc(c.code)} ${esc(c.name)}</option>`).join('')}</select></label><label>银行流水中的付款户名<input name="payer_name" required maxlength="160" value="${att(n?.payer_name||'')}"></label><div class="row2"><label>实际到账金额（元）<input name="cash_yuan" required inputmode="decimal" value="${n?(Number(n.cash_fen)/100).toFixed(2):''}" placeholder="0.00"></label><label>官价额度面额（元，可不填）<input name="face_yuan" inputmode="decimal" placeholder="默认与实付相同"></label></div><div class="row2"><label>到账日期<input name="received_on" type="date" required value="${today()}" max="${today()}"></label><label>收款银行到账流水号<input name="reference" required maxlength="120" placeholder="以公司收款银行流水为准"></label></div><label>核对说明<input name="note" maxlength="500" placeholder="实收与客户提交不一致时必填"></label><small>请核实公司账户已到账；提交后仍须复核，不立即增加余额。管理员可自行复核，普通财务须另一人复核。</small>`,
   onSubmit:async v=>{await api('business/bank-transfers',v);return '已登记，等待复核。';}
  });
 },
 'transfer-notice-reject':b=>simple('退回转账信息','<label>原因<textarea name="note" required maxlength="500" placeholder="例如：尚未查到到账流水，请核对付款日期和流水号"></textarea></label>',async v=>{await api(`business/bank-transfer-notices/${b.dataset.id}/reject`,v);return '已退回，客户可查看原因后重新提交。';},'退回'),
 'transfer-approve':b=>{const e=cache['business/bank-transfers'].entries.find(e=>e.id===b.dataset.id);return simple('复核入账',`${e.created_by===cache['business/bank-transfers'].current_subject&&cache['business/bank-transfers'].can_self_review?'<p>本次为管理员本人复核，将记录你的身份、复核时间及备注。</p>':''}<p>企业：${esc(e.customer_name)}<br>付款户名：${esc(e.payer_name)}<br>实付 ${fen(e.cash_fen)} · 官价额度 ${fen(e.face_fen)}<br>到账日期：${esc(e.received_day)}<br>银行到账流水：${esc(e.reference)}</p><label>备注（可选）<input name="note" maxlength="500"></label><label class="check"><input type="checkbox" required> 我已对照公司银行流水核对</label>`,async v=>{await api(`business/bank-transfers/${b.dataset.id}/approve`,{note:v.note||''});return '已入账。';},'确认入账');},
 'transfer-reject': b => simple('驳回对公登记', '<label>驳回原因<textarea name="note" required rows="3" maxlength="500"></textarea></label>', async v => { await api(`business/bank-transfers/${b.dataset.id}/reject`, v); return '已驳回。'; }, '驳回'),
 'supplier-new': () => simple('建立供应商档案', `<label>供应商名称<input name="display_name" required maxlength="100"></label><label>签约主体<input name="legal_name" required maxlength="160" placeholder="以合同或营业执照为准"></label><label>服务地区<input name="region" required maxlength="80" placeholder="未知请填待确认"></label><label>来源<select name="source_type">${options(LABEL.source, 'unconfirmed')}</select></label><p>保存后自动生成供应商编码，技术人员即可录入 Key。采购授权、合同和价格仍需在档案中核验。</p>`, async v => { await api('suppliers', { ...v, service_type: 'model_api' }); return '档案已建立并共享给技术后台。'; }, '保存档案'),
 'supplier-contact'(b) { const s = cache['business/suppliers'].suppliers.find(x => x.id === b.dataset.id); simple(`<code>${esc(s.code)}</code> ${esc(s.display_name)} 的联系人`, `<label>联系人<input name="contact_name" maxlength="80" value="${att(s.contact_name)}"></label><div class="row2"><label>电话<input name="contact_phone" maxlength="40" value="${att(s.contact_phone)}"></label><label>邮箱<input name="contact_email" type="email" maxlength="254" value="${att(s.contact_email)}"></label></div>`, async v => { await api(`business/suppliers/${s.id}/contact`, v); return '联系人已保存。'; }); },
 upgrade(b) {
  const reject = b.dataset.decision === 'reject';
  simple(`${reject ? '驳回' : '通过'}企业升级：${esc(b.dataset.name)}`, reject ? '<label>驳回原因（申请人可见）<textarea name="reason" required rows="3" maxlength="500"></textarea></label>' : '<p>通过后该账号转为企业账号，现金账户归入企业，不能降级。</p><label class="check"><input type="checkbox" required> 我已核对企业全称和统一社会信用代码</label>', async v => { await api(`upgrades/${b.dataset.id}/${b.dataset.decision}`, { reason: v.reason || '' }); return reject ? '申请已驳回。' : '已通过，企业客户编码已生成。'; }, reject ? '驳回' : '通过');
 },
 async listing(b) { await api('workspace/listings', { product_id: b.dataset.id }); await reload(); notify('申请已送达技术后台。', true); },
 async withdraw(b) { await api(`workspace/listings/${b.dataset.id}/withdraw`, {}); await reload(); notify('已撤回。', true); },
 'acquisition-search':()=>{ui.acquisitionQuery=$('#acquisitionQuery')?.value.trim()||'';return draw();},
 'vip-open':b=>{ui.vipPartner=b.dataset.id;location.hash='cw';if(currentPage()==='cw')return draw();},
 'code-activity':b=>{ui.codeActivity={id:b.dataset.id,kind:b.dataset.kind||'cw'};draw();},
 'code-page':b=>{ui.codePage=(ui.codePage||0)+Number(b.dataset.step);draw();},
 'vip-invite-new':()=>openForm({title:'生成 VIP推广码',submit:'生成推广码',body:'<label>推广码<input name="code" required minlength="2" maxlength="32" pattern="[A-Za-z0-9_-]{2,32}" autocomplete="off"></label><p>2–32 位英文字母、数字、下划线或短横线。</p><label>使用次数上限<input name="max_uses" type="number" min="1" max="100000" value="1" required></label><label>备注<input name="note" maxlength="200"></label>',onSubmit:async v=>{await api('cw/invite-codes',{...v,max_uses:Number(v.max_uses)});return 'VIP推广码已生成。';}}),
 'vip-invite-copy':async b=>{await navigator.clipboard.writeText(location.origin+'/promotion/vip.html?invite_code='+encodeURIComponent(b.dataset.code));notify('VIP申请链接已复制。',true);},
 'vip-invite-status':async b=>{await api('cw/invite-codes/'+encodeURIComponent(b.dataset.code)+'/status',{status:b.dataset.status});await reload();notify('VIP推广码状态已更新。',true);},
 'direct-new':()=>directDialog(),
 'direct-view':b=>{ui.directView=b.dataset.view;return draw();},
 'direct-copy':async b=>{const g=cache[SOURCES[currentPage()]()].grants.find(g=>g.id===b.dataset.id);await navigator.clipboard.writeText(g.promo_code);notify('折扣码已复制。',true);},
 'direct-link':async b=>{const g=cache[SOURCES[currentPage()]()].grants.find(g=>g.id===b.dataset.id);await navigator.clipboard.writeText(location.origin+'/?cw='+encodeURIComponent(g.promo_code)+'#billing/personal');notify('推广链接已复制。',true);},
 'discount-new': () => discountDialog(),
 discount(b) {
  const action = b.dataset.action, title = { approve: '批准折扣授权', reject: '驳回折扣授权', revoke: '收回折扣授权' }[action];
  simple(title, `<label>${action === 'reject' ? '驳回原因' : '说明（可不填）'}<textarea name="note" rows="3" maxlength="500" ${action === 'reject' ? 'required' : ''}></textarea></label>`, async v => { await api(`business/discounts/${b.dataset.id}/${action}`, v); return { approve: '已批准，授权生效。', reject: '已驳回。', revoke: '授权已收回。' }[action]; }, title.slice(0, 2));
 },
 ticket: b => ticketDialog(b.dataset.id),
 'answer-edit': b => answerDialog(b.dataset.id),
 'answer-archive': b => simple('归档问答', '<p>归档后不再出现在引用列表和客户的常见问题里。</p>', async () => { await api(`business/answers/${b.dataset.id}/archive`, {}); return '已归档。'; }, '归档'),
 async 'note-add'(b) {
  const body = $('#noteBody').value.trim();
  if (!body) return;
  await api(`business/customers/${b.dataset.id}/notes`, { body });
  await customerDialog(b.dataset.id);
 }
};



document.addEventListener('submit',e=>{
 if(e.target.id!=='employeeSearch')return;
 e.preventDefault();notify('');ui.customers.q=$('#employeeQuery').value.trim();location.hash='customers';
});
document.addEventListener('click', async e => {
 const work=e.target.closest('[data-work-page]');
 if(work){
  notify('');
  if(work.dataset.workPage==='tickets')ui.tickets={status:work.dataset.workKey==='all'?'all':'open',tier:work.dataset.workKey==='tickets_technical'?'technical':work.dataset.workKey==='tickets'?'first_line':'',category:''};
  location.hash=work.dataset.workPage;return;
 }
 if (e.target.closest('[data-close]')) return $('#dialog').close();
 const tab = e.target.closest('[data-tab],[data-go]');
 if (tab) { notify('');const next=tab.dataset.tab||tab.dataset.go;if(next===currentPage()&&API_VIEWS[next]){apiInnerNavigation=false;draw();}else location.hash=next;return; }
 if (e.target.id === 'refresh') { notify(''); return reload(); }
 const act = e.target.closest('[data-act]');
 if (act) {
  act.disabled = true;
  try { await ACTIONS[act.dataset.act](act); } catch (err) { ($('#dialog').open ? $('#dialogForm .form-error') : $('#notice')).textContent = err.message; } finally { act.disabled = false; }
  return;
 }
 const row = e.target.closest('tr[data-customer]');
 if (row && !e.target.closest('a,button')) customerDialog(row.dataset.customer).catch(err => notify(err.message));
});
document.addEventListener('keydown',e=>{if(e.target.id==='acquisitionQuery'&&e.key==='Enter'){e.preventDefault();ui.acquisitionQuery=e.target.value.trim();void draw();}});
document.addEventListener('input', e => {
 if (e.target.id !== 'find') return;
 if (currentPage() === 'customers') ui.customers.q = e.target.value;
 filterRows(e.target.value);
});
document.addEventListener('change', e => {
 const t = e.target;
 if(t.id==='acquisitionOwner'){ui.acquisitionOwner=t.value;return draw();}
 if (t.id === 'pnlMonth') { ui.month = t.value; return draw(); }
 if (t.id === 'invoiceDirection') { ui.invoices = t.value; return draw(); }
 if (t.dataset.filter) { ui.customers[t.dataset.filter] = t.value; return draw(); }
 if (t.dataset.ticketFilter) { ui.tickets[t.dataset.ticketFilter] = t.value; return draw(); }
 if (t.id === 'audiencePick') document.querySelectorAll('[data-audience]').forEach(l => { l.hidden = l.dataset.audience !== t.value; });
 if (t.id === 'answerPick') { const a = cache['business/support'].answers.find(x => x.id === t.value), form = $('#dialogForm'); form.elements.answer_id.value = a?.id || ''; if (a) form.elements.body.value = a.answer; }
});
for (const type of ['mouseover', 'mouseout', 'focusin', 'focusout']) document.addEventListener(type, tip);
addEventListener('message', e => {
 if(e.origin!==location.origin)return;
 if(e.source===parent&&e.data?.type==='workspace-navigate'&&!$('#dialog').open)void reload();
 if(e.data?.type==='vip-content-height'){
  const frame=document.querySelector('iframe.acquisition-vip'),height=e.data.height;
  if(e.source===frame?.contentWindow&&Number.isFinite(height)&&height>0&&height<100000)frame.style.height=Math.ceil(height)+'px';
 }
});
addEventListener('hashchange',()=>{ui.codeActivity=null;ui.codePage=0;draw();});
$('#dialog').addEventListener?.('close',()=>{$('#dialogForm').replaceChildren();});
void load();
})();
