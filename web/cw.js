(() => {
  'use strict';
  const $ = (s) => document.querySelector(s),
    esc = (v) =>
      String(v ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      ),
    money = (v) => '¥' + (Number(v || 0) / 100).toFixed(2),
    when = (v) => (v ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—');
  const params = new URLSearchParams(location.search);
  const partnerParam = params.get('partner');
  const requestedPartner = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(partnerParam || '') ? partnerParam : null;
  const staff = params.get('staff') === '1',
    base = staff ? '/api/staff/cw' : '/api/cw',
    labels = {
      pending: '待销售确认',
      confirmed: '已面试，待充值核验',
      active: '正式 VIP',
      suspended: '已暂停',
      rejected: '未通过',
      paused: '已停用',
      requested: '待审核',
      approved: '待确认银行结果',
      paid: '已支付',
      failed: '付款失败',
      used: '实际使用',
      refund: '退款调整',
    };
  let viewVersion = 0,
    loadVersion = 0;
  let data = null,
    selected = staff ? requestedPartner : null,
    tab = selected ? 'manage' : 'overview',
    salesFilter = { query: '', stage: '' },
    offset = 0,
    filter = '',
    requestKey = crypto.randomUUID();
  $('#cw-header').innerHTML = window.SiteHeader.render('workspace', {
    account: `<a href="${staff ? '/#console/business/overview' : '/#workspace'}">${staff ? '返回商务后台' : '我的工作台'}</a>`,
  });
  $('#cw-footer').innerHTML = window.SiteHeader.footer();
  if (staff) {
    $('#cw-title').textContent = 'VIP 客户跟进';
    document.title = 'VIP 客户跟进 · semifly.ai';
    $('#cw-description').textContent = '查看申请、邀请码和下一次联系时间。';
    $('#cw-guide-link').hidden = true;
  }
  async function api(path, body) {
    const r = await fetch(path, {
      credentials: 'same-origin',
      ...(body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
    const d = await r.json().catch(() => ({ error: '服务暂时不可用，请稍后刷新重试。' }));
    if (!r.ok) {
      const e = Error(d.error || '请求失败');
      e.status = r.status;
      if (r.status === 401) clearView(e);
      throw e;
    }
    return d;
  }
  const localDate = (v) => {
    const d = new Date(v);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const field = (name, title, type = 'text', extra = '', required = true) =>
    `<label>${title}<input name="${name}" type="${type}" ${required ? 'required' : ''} ${extra}></label>`;
  const form = (action, html, label) =>
    `<form class="cw-form" data-action="${action}">${html}<button type="submit">${label}</button></form>`;
  const table = (heads, rows) =>
    `<div class="cw-table"><table><thead><tr>${heads.map((t) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}">暂无记录</td></tr>`}</tbody></table></div>`;
  const privateDetails = (r) =>
    `<dl class="cw-proof">${r.contact ? `<dt>联系方式</dt><dd>${esc(r.contact.contact)}</dd>` : ''}${r.bank ? `<dt>收款人</dt><dd>${esc(r.bank.holder)}</dd><dt>开户银行</dt><dd>${esc(r.bank.bank)}</dd><dt>银行卡号</dt><dd>${esc(r.bank.number)}</dd>` : r.bank_version !== undefined ? '<dt>银行卡</dt><dd>尚未填写</dd>' : ''}${r.bank_version !== undefined ? `<dt>银行卡版本</dt><dd>${r.bank_version}</dd>` : ''}${r.net_fen !== undefined ? `<dt>应付税后金额</dt><dd>${money(r.net_fen)}</dd>` : ''}</dl>`;
  const discount = (percent) => (Number(percent) / 10).toFixed(1).replace(/\.0$/, '') + ' 折';
  const payLink = (code) => '/?cw=' + encodeURIComponent(code) + '#billing/personal';
  const paymentCard = (k, staffView = false) => `<div class="cw-payment-card">
    <div><span>专属付款码</span><strong>${esc(k.code)}</strong></div><div><span>充值折扣</span><strong>${discount(k.customer_price_percent)}</strong></div>
    ${k.ends_at ? `<div><span>有效期至</span><strong>${when(k.ends_at)}</strong></div>` : ''}
    ${staffView ? `<button data-copy="${esc(location.origin + payLink(k.code))}" data-copy-label="付款链接">复制付款链接</button>`
      : `<a class="cw-button cw-primary" href="${payLink(k.code)}">使用此码充值</a>`}
  </div>`;
  const stat = (title, value) => `<dl><dt>${title}</dt><dd>${money(value)}</dd></dl>`;
  function clearView(error) {
    const loginPartner = staff && selected ? '&amp;partner=' + encodeURIComponent(selected) : '';
    data = null;
    ++viewVersion;
    ++loadVersion;
    $('#cw-content').inert = false;
    $('#cw-content').removeAttribute('aria-busy');
    $('#cw-nav').replaceChildren();
    document.body.classList.toggle('cw-applicant', !staff);
    $('#refresh').hidden = error.status === 401;
    $('#cw-message').textContent = error.status === 401 ? '' : error.message;
    const customerEntry = '/?cw_join=' + encodeURIComponent(new URLSearchParams(location.search).get('invite') || '1');
    $('#cw-content').innerHTML = error.status === 401
      ? staff
        ? `<h2>请先进行员工登录</h2><a class="cw-button" href="/api/staff/login?next=vip${loginPartner}">员工登录</a>`
        : `<h2>用个人账户继续</h2><p>登录或完成注册后会返回这里，你可以申请 VIP 或查看进度。</p><div class="cw-inline"><a class="cw-button" href="${customerEntry}#workspace">登录个人账户</a><a class="cw-button" href="${customerEntry}#register">注册个人账户</a></div>`
      : `<h2>${error.status === 403 ? '暂时无法访问' : '加载未完成'}</h2><p>${error.status === 403 ? '请确认当前员工账号具有商务权限。' : '请点击右上角“刷新”重试。'}</p>`;
  }
  function nav() {
    const focused = $('#cw-nav').contains(document.activeElement) ? document.activeElement.dataset.tab : null;
    const items = staff
      ? [
          ['overview', data.administrator ? '全部 VIP 客户' : '我的 VIP 客户'],
          ['invite-codes', 'VIP 邀请码'],
          ['manage', '客户档案'],
          ...(data.finance ? [['settlement', '月结与提现']] : []),
        ]
      : [
          ['overview', '收益概览'],
          ['codes', '推广码'],
          ['events', '付费与使用明细'],
          ['payouts', '佣金与提现'],
          ['profile', '合同与资料'],
          ['invites', '邀请伙伴'],
        ];
    $('#cw-nav').innerHTML = items
      .map(([k, v]) => `<button data-tab="${k}" aria-current="${tab === k ? 'page' : 'false'}">${v}</button>`)
      .join('');
    if (focused) $('#cw-nav').querySelector(`[data-tab="${focused}"]`)?.focus({ preventScroll: true });
  }
  async function load() {
    const version = ++loadVersion;
    const partnerId = selected;
    const content = $('#cw-content');
    content.setAttribute('aria-busy', 'true');
    content.inert = true;
    try {
      $('#cw-message').textContent = '';
      const result = await api(staff ? base : base + '/me');
      if (version !== loadVersion) return;
      let unavailable = false;
      if (staff && partnerId) {
        try {
          result.detail = await api(base + '/' + partnerId);
        } catch (error) {
          if (error.status !== 404) throw error;
          if (version !== loadVersion) return;
          unavailable = true;
          setSelected(null);
          tab = 'overview';
        }
        if (version !== loadVersion) return;
      }
      data = result;
      await draw();
      if (unavailable) $('#cw-message').textContent = '这位 VIP 客户当前不在你的管理范围内。';
    } catch (e) {
      if (version !== loadVersion) return;
      clearView(e);
      if (e.status === 503) content.textContent = '推广合作伙伴申请尚未开放，请稍后再来。';
    } finally {
      if (version === loadVersion) {
        content.removeAttribute('aria-busy');
        content.inert = false;
      }
    }
  }
  async function draw() {
    if (!data) return;
    const version = ++viewVersion;
    const dashboard = staff || data.partner?.status === 'active';
    document.body.classList.toggle('cw-applicant', !dashboard);
    $('#refresh').hidden = !dashboard;
    if (dashboard) nav();
    else $('#cw-nav').replaceChildren();
    if (!staff) {
      $('#cw-title').textContent = dashboard ? 'VIP 推广合作伙伴' : data.partner ? 'VIP 申请进度' : '申请 VIP';
      $('#cw-description').textContent = dashboard
        ? '客户实付看预计收益，实际使用解锁佣金，客户月结确认后可提现。'
        : data.partner
          ? '查看你的申请状态和下一步。'
          : '填写资料与员工提供的邀请码，提交后请留意销售来电。';
    }
    const c = $('#cw-content');
    if (staff) {
      drawStaff(c);
      return;
    }
    if (!data.partner) {
      const referrer = new URLSearchParams(location.search).get('invite') || '';
      const referralField = referrer
        ? `<input type="hidden" name="invite" value="${esc(referrer)}">`
        : `<details class="cw-referrer"><summary>填写邀请人的 VIP 编号（选填）</summary>${field('invite', '邀请人的 VIP 编号', 'text', 'maxlength="8" autocomplete="off"', false)}</details>`;
      const fields =
        field('legal_name', '真实姓名', 'text', 'maxlength="60" autocomplete="name"') +
        field('contact', '联系电话或其他联系方式', 'text', 'maxlength="160"') +
        field('invite_code', '员工提供的 VIP 客户邀请码', 'text', 'maxlength="32" autocomplete="off" autocapitalize="characters"') +
        referralField +
        '<label class="cw-check"><input type="checkbox" name="consent" required><span>我已阅读<a href="/cw-terms.html#privacy" target="_blank" rel="noopener">资料处理说明</a>，同意处理申请资料。</span></label>';
      c.innerHTML = form('apply', fields, '提交申请');
      return;
    }
    const p = data.partner,
      t = data.totals;
    if (p.status === 'pending')
      c.innerHTML = `<h2>申请已提交，等待公司销售电话面试并确认</h2><p>你的 VIP 编号：<strong>${esc(p.public_code)}</strong></p><div class="cw-callout"><p><b>你提交的申请信息</b></p><p>真实姓名：<strong>${esc(p.legal_name || '—')}</strong></p><p>申请时间：${when(p.created_at)}</p><p>当前状态：${labels[p.status]}</p><p class="cw-muted">联系方式已加密保存在系统中，用于电话面试和申请处理。</p></div><p>公司销售会主动联系你面试；面试通过后会发放 <strong>VIP 付款码</strong>。你充值后联系销售核验到账，销售确认后才成为正式 VIP（顶栏显示金色 VIP 角标）。请留意邮件或电话。</p><p><button data-refresh-status>刷新状态</button></p>`;
    if (p.status === 'rejected')
      c.innerHTML = `<h2>申请未通过</h2><p>很抱歉，你的 VIP 申请未通过。如有疑问请联系邀请你的员工或 sales。</p>`;
    if (p.status === 'confirmed') {
      const current = data.task_codes?.[0];
      c.innerHTML = `<h2>${current ? '付款码已发放' : '面试已通过，等待销售发放付款码'}</h2>
        <p>你的 VIP 编号：<strong>${esc(p.public_code)}</strong></p>
        ${current ? `<p>使用下方付款码单笔实付至少 <strong>¥100</strong>，付款后请联系销售核验开通。</p>${paymentCard(current)}`
          : '<p>销售发放付款码后会显示在这里，你可以用它直接充值。</p>'}
        <p><button data-refresh-status>刷新状态</button></p>`;
      return;
    }
    if (p.status === 'suspended') {
      c.innerHTML = '<h2>VIP 合作已暂停</h2><p>如需了解后续安排，请联系公司销售。</p>';
      return;
    }
    if (p.status !== 'active') return;
    const taskCodes = data.task_codes || [];
    if (tab === 'overview')
      c.innerHTML = `<h2>${esc(p.legal_name)} <span class="cw-status">${labels[p.status]}</span></h2><p>VIP 编号：<strong>${esc(p.public_code)}</strong></p><div class="cw-metrics">${stat('客户实付', t.paid_fen)}${stat('客户实用', t.used_fen)}${stat('预计总佣金（税前）', t.expected_fen)}${stat('已解锁佣金（税前）', t.unlocked_fen)}${stat('可提现（税前）', t.available_fen)}</div><p>预计佣金包含已解锁部分，不代表全部可提现。客户退款会取消未使用部分的预计佣金。已解锁佣金需待客户月结与收款对账确认后方可申请提现。</p><p>提成 = 卖出折扣 − 4 折。以 5 折卖出提成 10%、8 折卖出提成 40%，多卖多得。</p><h3>我的 VIP 付款码</h3>${taskCodes.length ? paymentCard(taskCodes[0]) : '<p>暂无付款码，请联系负责销售。</p>'}`;
    if (tab === 'codes')
      c.innerHTML = `<h2>我的推广码 <small>${data.codes.length} / 50</small></h2><p>每个码可申请不同折扣（不低于 5 折），审核通过后生效。历史码保留，不转让、不删除。提成 = 卖出折扣 − 4 折。</p>${table(['名称／推广码', '状态／客户价格', '你的提成', '客户实付', '客户实用', '预计／已解锁／可提现', '推广'], data.codes.map((k) => `<tr><td>${esc(k.name)}${k.is_self_code ? '<small class="cw-self">专属自购码</small>' : ''}<small>${k.code}</small></td><td>${labels[k.status]}<small>客户价 ${k.customer_price_percent}%</small></td><td>${k.is_self_code ? '自购无提成' : (k.customer_price_percent - 40) + '%'}</td><td>${money(k.paid_fen)}</td><td>${money(k.used_fen)}</td><td>${money(k.expected_fen)} / ${money(k.unlocked_fen)} / ${money(k.available_fen)}</td><td>${k.status === 'active' ? `<button data-copy="${esc(location.origin + '/?cw=' + k.code + '#billing/personal')}">复制推广链接</button><details><summary>推广二维码</summary><img class="cw-qr" src="/api/cw/codes/${k.id}/qr" alt="推广码 ${k.code} 的二维码" loading="lazy"></details>` : '审核后可推广'}</td></tr>`).join(''))}${data.codes.length < 50 ? `<details><summary>申请新推广码</summary>${form('code', field('name', '推广码名称', 'text', 'maxlength="60"') + field('customer_price_percent', '申请客户价格比例（50 表示五折，最低 50）', 'number', 'min="50" max="100" value="50"'), '提交审核')}</details>` : ''}`;
    if (tab === 'events') {
      const events = await api(base + '/events?offset=' + offset + (filter ? '&code_id=' + filter : ''));
      if (version !== viewVersion) return;
      c.innerHTML = `<h2>付费与使用明细</h2><p>充值实付形成预计佣金，实际使用解锁其中一部分；两者不重复计佣。</p><div class="cw-inline"><label>推广码<select id="event-code"><option value="">全部</option>${data.codes.map((k) => `<option value="${k.id}" ${filter === k.id ? 'selected' : ''}>${esc(k.name)} · ${k.code}</option>`).join('')}</select></label></div>${table(['时间', '推广码', '事件', '匿名成交编号', '实付／实用金额', '预计／解锁变化'], events.events.map((e) => `<tr><td>${when(e.occurred_at)}</td><td>${e.code}</td><td>${e.kind === 'paid' ? '充值实付' : labels[e.kind]}</td><td>${esc(e.public_reference)}</td><td>${money(e.cash_fen)}</td><td>${money(e.commission_fen)}</td></tr>`).join(''))}<div class="cw-inline"><button data-page="-1" ${offset === 0 ? 'disabled' : ''}>上一页</button><span>第 ${offset / 50 + 1} 页</span><button data-page="1" ${!events.has_more ? 'disabled' : ''}>下一页</button></div>`;
    }
    if (tab === 'payouts')
      c.innerHTML = `<h2>佣金与提现</h2><div class="cw-metrics">${stat('已解锁（累计，税前）', t.unlocked_fen)}${stat('当前可提现（税前）', t.available_fen)}</div><p>自然月结束后，公司完成客户账单核对和结算确认，再释放可提现金额。提现审核时确认适用的代扣税额，税后金额以结算单为准。</p><p>收款银行卡：${p.bank_last4 ? '尾号 ' + p.bank_last4 : '未填写'} · ${p.bank_verified ? '已核验' : '待核验'}</p><button data-withdraw ${!p.bank_verified || Number(t.available_fen) <= 0 ? 'disabled' : ''}>申请提现全部可提现佣金</button>${table(['申请时间', '税前佣金', '代扣税额', '税后金额', '状态', '到账时间'], data.payouts.map((r) => `<tr><td>${when(r.created_at)}</td><td>${money(r.gross_fen)}</td><td>${money(r.withholding_fen)}</td><td>${r.status === 'requested' ? '审核后确定' : money(Number(r.gross_fen) - Number(r.withholding_fen))}</td><td>${labels[r.status]}</td><td>${when(r.paid_at)}</td></tr>`).join(''))}`;
    if (tab === 'profile')
      c.innerHTML = `<h2>合同与资料</h2><p>合作状态：${labels[p.status]}。<a href="/cw-terms.html" target="_blank" rel="noopener">查看推广合作协议草案</a>。签约服务尚未接入；由公司提供正式合同，双方签署并核验后激活合作资格。</p>${table(['合同版本', '核验时间', '有效期'], data.contracts.map((k) => `<tr><td>${esc(k.template_version)}</td><td>${when(k.verified_at)}</td><td>${when(k.expires_at)}</td></tr>`).join(''))}<details><summary>填写／更换本人收款银行卡</summary>${form('bank', field('holder', '本人姓名', 'text', `value="${esc(p.legal_name)}" maxlength="60"`) + field('bank', '开户银行及支行', 'text', 'maxlength="120"') + field('number', '银行卡号', 'text', 'inputmode="numeric" autocomplete="off" maxlength="32"') + `<label class="cw-check"><input type="checkbox" required>我已阅读<a href="/cw-terms.html#privacy" target="_blank" rel="noopener">资料处理说明</a>，单独同意为佣金结算处理本人银行卡信息。</label>`, '提交收款账户核验')}</details>`;
    if (tab === 'invites')
      c.innerHTML = `<h2>邀请新的 VIP 伙伴</h2><p>受邀伙伴独立申请、独立签约、使用自己的推广码。邀请关系不产生佣金，也不分享对方的客户与收入数据。</p><button data-copy="${esc(location.origin + '/promotion/vip.html?invite=' + p.public_code)}">复制邀请链接</button>${table(['伙伴编号', '加入时间', '合作状态'], data.invited.map((i) => `<tr><td>${i.public_code}</td><td>${when(i.created_at)}</td><td>${labels[i.status]}</td></tr>`).join(''))}`;
  }
  function setSelected(value) {
    selected = value;
    const url = new URL(location.href);
    if (value) url.searchParams.set('partner', value);
    else url.searchParams.delete('partner');
    history.replaceState(history.state, '', url);
  }
  function drawSalesList(c) {
    const stageOptions = [
      ['', '全部状态'], ['due', '到期需跟进'], ['discount', '付款折扣待特批'], ['pending', '待电话面试'],
      ['confirmed', '面试通过，待开通'], ['active', '正式 VIP'], ['suspended', '已暂停'], ['rejected', '未通过'],
    ];
    if (data.administrator) stageOptions.splice(2, 0, ['unassigned', '待分配']);
    if (data.finance && !data.administrator) stageOptions.push(['finance', '财务结算']);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format();
    const query = salesFilter.query.toLowerCase();
    const stage = salesFilter.stage;
    const salesPartners = data.partners.filter((p) => p.can_follow || data.administrator);
    const partners = data.partners.filter((p) => {
      const inSalesQueue = p.can_follow || data.administrator;
      if (stage === 'finance' ? inSalesQueue : !inSalesQueue) return false;
      if (stage === 'due' && !(p.next_contact_on && p.next_contact_on <= today)) return false;
      if (stage === 'unassigned' && p.owner_subject) return false;
      if (stage === 'discount' && !p.discount_pending) return false;
      if (stage && !['due', 'unassigned', 'discount', 'finance'].includes(stage) && p.status !== stage) return false;
      return !query || [p.legal_name, p.public_code, p.invite_code, p.email, p.owner_name]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
    c.innerHTML = `<h2>${stage === 'finance' ? '财务结算客户' : data.administrator ? '全部 VIP 客户' : '我的 VIP 客户'}</h2>
      <form class="cw-sales-filters" data-action="sales-filter">
        ${field('query', '搜索客户或邀请码', 'search', `value="${esc(salesFilter.query)}" maxlength="120"`, false)}
        <label>状态<select name="stage">${stageOptions.map(([value, label]) => `<option value="${value}"${value === stage ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <button type="submit">筛选</button>
      </form>
      ${partners.length ? '<div class="cw-sales-table">' + table(['客户／VIP 编号', '来源邀请码', '负责销售', '申请状态', '下次联系'], partners.map((p) => `<tr>
        <td><button class="cw-lead-link" data-partner="${esc(p.id)}" aria-label="打开 ${esc(p.legal_name)} 的档案">${esc(p.legal_name)}</button><small>${esc(p.public_code)}${p.email ? ' · ' + esc(p.email) : ''}</small></td>
        <td>${esc(p.invite_code || '—')}</td><td>${esc(p.owner_name || '待分配')}</td>
        <td>${esc(labels[p.status] || p.status)}${p.discount_pending ? '<small class="cw-status">付款折扣待特批</small>' : ''}</td>
        <td>${p.next_contact_on ? `<time datetime="${esc(p.next_contact_on)}">${esc(p.next_contact_on)}</time>` : '—'}</td>
      </tr>`).join('')) + '</div>' : `<p class="cw-muted">${query || stage || salesPartners.length ? '暂无符合条件的 VIP 客户。' : '已有邀请码带来的申请会显示在这里。'}</p>`}`;
  }
  function drawInviteCodes(c) {
    c.innerHTML = `<h2>${data.administrator ? 'VIP 客户邀请码' : '我发出的邀请码'}</h2>
      <p>把邀请码和<a href="/promotion/vip.html">申请入口</a>发给客户。客户提交后会进入发码人的跟进列表。</p>
      <details><summary>生成邀请码</summary>${form('invite-code',
        field('code', '邀请码', 'text', 'maxlength="32" autocomplete="off" autocapitalize="characters"') +
        field('max_uses', '使用次数上限', 'number', 'min="1" max="100000" value="1"') +
        field('note', '备注', 'text', 'maxlength="200"', false), '生成邀请码')}</details>
      ${table(['邀请码', '使用次数', '状态', '备注', '创建人／时间', '操作'], (data.invite_codes || []).map((v) => `<tr>
        <td><strong>${esc(v.code)}</strong></td><td>${v.used_count} / ${v.max_uses}</td>
        <td>${v.status === 'active' ? '生效中' : '已停用'}</td><td>${esc(v.note || '—')}</td>
        <td>${esc(v.creator_name || v.created_by)}<small>${when(v.created_at)}</small></td>
        <td><div class="cw-row-actions">
          <button data-invite-customers="${esc(v.code)}">查看客户</button>
          ${v.status === 'active' ? `<button data-copy="${esc(v.code)}" data-copy-label="邀请码">复制码</button><button data-invite-status="disabled" data-invite-code="${esc(v.code)}">停用</button>` : `<button data-invite-status="active" data-invite-code="${esc(v.code)}">启用</button>`}
        </div></td>
      </tr>`).join(''))}`;
  }
  function salesFollowups(d) {
    const p = d.partner;
    const owner = !data.administrator ? '' : form('owner',
      `<label>负责销售<select name="owner_subject"><option value="">待分配</option>${(data.owners || []).map((o) =>
        `<option value="${esc(o.subject)}"${o.subject === p.owner_subject ? ' selected' : ''}>${esc(o.name)} · ${esc(o.email)}</option>`).join('')}</select></label>`,
      '保存负责人');
    const notes = (d.followups || []).map((n) => `<li><strong>${esc(n.author_name)}</strong> <small>${when(n.created_at)}</small>
      <p>${esc(n.body)}</p>${n.next_contact_on ? `<small>下次联系 ${esc(n.next_contact_on)}</small>` : ''}</li>`).join('');
    return `<section class="cw-sales-section" aria-labelledby="vip-followups">
      <h3 id="vip-followups">销售跟进</h3>
      <dl class="cw-lead-facts"><div><dt>来源邀请码</dt><dd>${esc(p.invite_code || '—')}</dd></div>
      <div><dt>负责销售</dt><dd>${esc(p.owner_name || '待分配')}</dd></div>
      <div><dt>申请时间</dt><dd>${when(p.created_at)}</dd></div>
      <div><dt>下次联系</dt><dd>${esc(p.next_contact_on || '未安排')}</dd></div></dl>
      ${owner ? `<details><summary>分配负责销售</summary>${owner}</details>` : ''}
      <details><summary>记录跟进</summary>${form('followup',
        '<label>跟进内容<textarea name="body" required maxlength="2000" rows="3"></textarea></label>' +
        field('next_contact_on', '下次联系日期（留空清除）', 'date', `value="${esc(p.next_contact_on || '')}"`, false),
        '保存跟进')}</details>
      ${notes ? `<ol class="cw-followup-list">${notes}</ol>` : '<p class="cw-muted">还没有跟进记录。</p>'}
    </section>`;
  }
  function staffPaymentCodes(d) {
    const p = d.partner;
    const canIssue = ['confirmed', 'active'].includes(p.status);
    const requests = d.discount_requests || [];
    const pending = requests.find((r) => r.status === 'pending');
    if (!canIssue && !pending) return '';
    const recent = requests.find((r) => r.status !== 'pending');
    const current = canIssue ? d.task_codes?.find((code) => code.usable) : null;
    return `<section class="cw-sales-section" aria-labelledby="staff-payment-code">
      <h3 id="staff-payment-code">VIP 付款码</h3>
      ${current ? paymentCard(current, true) : canIssue ? `<p>生成后，客户可在申请页直接使用该码充值。</p>
        ${form('task-code', '', '生成 5 折付款码')}` : ''}
      ${pending ? `<h4>待审批 · ${discount(pending.customer_price_percent)}</h4>
        <p>${esc(pending.reason)}</p><p class="cw-muted">由 ${esc(pending.requested_by_name)} 于 ${when(pending.created_at)} 申请</p>
        ${data.administrator ? `<form class="cw-form" data-action="discount-decision">
          <input name="request_id" type="hidden" value="${esc(pending.id)}">
          <label>审批意见（退回时必填）<textarea name="decision_note" maxlength="300" rows="2"></textarea></label>
          ${current ? '<p class="cw-muted">批准后会生成新付款码，当前码停止用于新充值。</p>' : ''}
          <div class="cw-inline"><button type="submit" name="decision" value="approved"${canIssue ? '' : ' disabled'}>批准并生成付款码</button>
          <button type="submit" name="decision" value="rejected">退回申请</button></div>
        </form>` : '<p class="cw-muted">等待管理员审批。</p>'}`
        : `<details><summary>申请其他折扣</summary>${form('discount-request',
          field('customer_price_percent', '实付比例（例如 40 表示 4 折）', 'number', 'min="1" max="100"') +
          '<label>申请原因<textarea name="reason" maxlength="300" rows="3" required></textarea></label>',
          '提交特批申请')}</details>`}
      ${recent ? `<p class="cw-muted">上次申请 ${discount(recent.customer_price_percent)} · ${recent.status === 'approved' ? '已批准' : '已退回'} · ${when(recent.decided_at)}${recent.decision_note ? ' · ' + esc(recent.decision_note) : ''}</p>` : ''}
      ${d.task_codes?.length > 1 ? `<details><summary>历史付款码</summary>${table(['付款码', '折扣', '状态', '发放时间'], d.task_codes.map((k) =>
        `<tr><td>${esc(k.code)}</td><td>${discount(k.customer_price_percent)}</td><td>${k.usable ? '可用' : '已失效'}</td><td>${when(k.created_at)}</td></tr>`).join(''))}</details>` : ''}
      <h4>付款码充值记录</h4>
      ${d.discount_payments?.length ? table(['付款单', '付款码', '实付／官价额度', '状态', '付款时间'],
         d.discount_payments.map((o) => `<tr><td>${esc(o.out_trade_no)}</td><td>${esc(o.promo_code || '—')}</td>
         <td>${money(o.amount_fen)} / ${money(o.face_fen)}</td><td>${o.status === 'paid' ? '已支付' : esc(o.status)}</td><td>${when(o.paid_at)}</td></tr>`).join(''))
         : '<p class="cw-muted">暂无通过付款码完成的充值。</p>'}
      ${p.status === 'confirmed' ? `<button data-activate="${p.id}"${d.can_activate ? '' : ' disabled'}>${d.can_activate ? '确认正式 VIP' : '待单笔实付满 ¥' + ((d.activate_min_cash_fen || 10000) / 100).toFixed(0)}</button>` : ''}
    </section>`;
  }
  function drawStaff(c) {
    if (tab === 'overview') { drawSalesList(c); return; }
    if (tab === 'invite-codes') { drawInviteCodes(c); return; }
    const d = data.detail;
    if (!d) {
      c.innerHTML = `<h2>${tab === 'manage' ? '客户档案' : '月结与提现'}</h2><p>${data.partners.length ? '请先选择要管理的 VIP，再查看其档案、推广码和结算记录。' : '目前还没有 VIP 申请记录。收到申请后，可在伙伴列表选择并管理。'}</p><button data-tab="overview">返回伙伴列表</button>`;
      return;
    }
    const p = d.partner;
    c.innerHTML = `<button data-tab="overview">返回客户列表</button><h2 class="cw-partner-title">${esc(p.legal_name)} · ${esc(p.public_code)}</h2><p>申请状态：${esc(labels[p.status])}${d.finance ? ' · 可提现（税前）' + money(d.available_fen) : ''}</p>`;
    if (tab === 'manage') {
      if (d.can_follow) {
        const contact = `<div class="cw-contact-box"><p><b>申请人联系方式</b></p><div id="contact-details" aria-live="polite"><p class="cw-muted">查看操作会记入审计。</p></div>${form('contact', field('reason', '查看原因', 'text', p.status === 'pending' ? 'value="电话面试" maxlength="200"' : 'maxlength="200"'), '查看联系方式')}</div>`;
        c.innerHTML += `${staffPaymentCodes(d)}${contact}
          ${p.status === 'pending' ? `<button data-confirm="${p.id}">确认面试通过</button>` : ''}
          ${salesFollowups(d)}`;
      }
      if (d.finance) c.innerHTML += `<h3>推广码</h3>${table(['推广码／名称', '客户价格', '提成', '有效期', '状态', '实付／实用', '预计／解锁佣金', '审核'], d.codes.map((k) => `<tr><td>${k.code}${k.is_self_code ? '<small>专属自购码</small>' : ''}<small>${esc(k.name)}</small></td><td>${k.customer_price_percent}%</td><td>${k.is_self_code ? '无' : (k.customer_price_percent - 40) + '%'}</td><td>${when(k.starts_at)} 至 ${when(k.ends_at)}</td><td>${labels[k.status]}</td><td>${money(k.paid_fen)} / ${money(k.used_fen)}</td><td>${money(k.expected_fen)} / ${money(k.unlocked_fen)}</td><td>${k.is_self_code ? '' : `<button data-code-review="${k.id}">审核／停用</button>`}</td></tr>`).join(''))}<div id="code-editor"></div><h3>签约记录</h3>${table(['合同版本', '文件摘要', '核验人／时间', '有效期'], d.contracts.map((k) => `<tr><td>${esc(k.template_version)}</td><td>${esc(k.document_sha256)}</td><td>${esc(k.verified_by)}<small>${when(k.verified_at)}</small></td><td>${when(k.expires_at)}</td></tr>`).join(''))}<details><summary>合同与身份核验（管理员）</summary><p>请核验真实签约服务凭证，不能把提交申请视为已签约。</p>${form('contract', field('template_version', '正式合同版本') + field('document_sha256', '已签署文件 SHA-256', 'text', 'pattern="[a-f0-9]{64}"') + field('signature_reference', '签约服务商及凭证编号') + field('identity_reference', '实名核验服务及凭证编号') + field('expires_at', '合同截止时间', 'datetime-local') + `<label class="cw-check"><input type="checkbox" required>已核验双方签署证据和合作人身份</label>`, '登记签署证据')}</details><details><summary>收款账户（财务）</summary>${form('bank-details', field('reason', '查看原因', 'text', 'maxlength="200"'), '查看收款资料')}<div id="private-details" aria-live="polite"></div>${form('bank-verify', field('bank_version', '已核验银行卡版本', 'number', 'min="1"') + field('evidence', '本人账户核验凭证编号'), '确认核验（财务）')}</details><details><summary>暂停合作</summary>${form('suspend', field('reason', '暂停原因'), '暂停新推广与提现')}</details>`;
    }
    if (tab === 'settlement' && d.finance)
      c.innerHTML += `<h3>客户付款订单</h3><p class="cw-muted">最近 200 笔成交</p>${table(['客户／付款订单', '推广码', '付款时间', '客户实付／实用', '预计／解锁佣金', '客户计费账户'], d.orders.map((o) => `<tr><td>${esc(o.customer_email)}<small>${esc(o.out_trade_no)}</small></td><td>${o.code}</td><td>${when(o.paid_at)}</td><td>${money(o.cash_fen)} / ${money(o.used_cash_fen)}</td><td>${money(o.expected_fen)} / ${money(o.unlocked_fen)}</td><td>${o.account_id}${o.channel_fee_issue ? '<small>' + esc(o.channel_fee_issue) + '</small>' : ''}</td></tr>`).join(''))}<h3>付款与使用明细</h3>${table(['时间', '码／付款订单', '事件', '实付／实用', '预计／解锁变化'], d.events.map((e) => `<tr><td>${when(e.occurred_at)}</td><td>${e.code}<small>${esc(e.out_trade_no)}</small></td><td>${e.kind === 'paid' ? '充值实付' : labels[e.kind]}</td><td>${money(e.cash_fen)}</td><td>${money(e.commission_fen)}</td></tr>`).join(''))}<details><summary>确认客户月结（财务）</summary><p>自然月已结束、调用结算与支付账单核对完成，并已与客户完成结算，才可确认。</p>${form('close', `<label>客户计费账户<select name="account_id" required><option value="">请选择客户账户</option>${[...new Map(d.orders.map((o) => [o.account_id, o])).values()].map((o) => `<option value="${o.account_id}">${esc(o.customer_email)} · ${o.account_id}</option>`).join('')}</select></label>` + field('month', '结算月份', 'month') + field('evidence', '客户结算单／确认凭证编号'), '确认客户月结')}${table(['已结月份', '客户账户', '结算凭证', '确认时间'], d.closes.map((x) => `<tr><td>${x.month}</td><td>${x.account_id}</td><td>${esc(x.evidence)}</td><td>${when(x.closed_at)}</td></tr>`).join(''))}</details><h3>提现申请与付款结果</h3>${table(['申请时间', '税前／代扣税', '状态', '银行卡', '操作'], d.payouts.map((r) => `<tr><td>${when(r.created_at)}</td><td>${money(r.gross_fen)} / ${money(r.withholding_fen)}</td><td>${labels[r.status]}</td><td>尾号 ${r.bank_last4}</td><td>${r.status === 'requested' ? `<button data-payout-review="${r.id}">审核</button>` : r.status === 'approved' ? `<button data-payout-complete="${r.id}">付款与结果确认</button>` : ''}</td></tr>`).join(''))}<div id="payout-editor"></div>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.tab) {
        tab = b.dataset.tab;
        if (staff && ['overview','invite-codes'].includes(tab)) setSelected(null);
        await draw();
        $('#cw-content').scrollTop = 0;
      } else if (b.id === 'refresh' || b.hasAttribute('data-refresh-status')) await load();
      else if (b.dataset.partner) {
        setSelected(b.dataset.partner);
        tab = 'manage';
        $('#cw-content').textContent = '正在加载合作伙伴资料…';
        await load();
        $('#cw-content').scrollTop = 0;
      } else if (b.dataset.copy) {
        await navigator.clipboard.writeText(b.dataset.copy);
        $('#cw-message').textContent = (b.dataset.copyLabel || '链接') + '已复制。';
      } else if (b.dataset.confirm) {
        b.disabled = true;
        await api(base + '/' + b.dataset.confirm + '/confirm', {});
        await load();
        $('#cw-message').textContent = '已确认面试通过。现在可以发放付款码。';
      } else if (b.dataset.activate) {
        b.disabled = true;
        await api(base + '/' + b.dataset.activate + '/activate', {});
        await load();
        $('#cw-message').textContent = '已确认正式 VIP。客户顶栏将显示金色 VIP 角标。';
      } else if (b.dataset.inviteCustomers) {
        salesFilter = { query: b.dataset.inviteCustomers, stage: '' };
        tab = 'overview';
        await draw();
      } else if (b.dataset.inviteStatus) {
        b.disabled = true;
        await api(base + '/invite-codes/' + encodeURIComponent(b.dataset.inviteCode) + '/status', { status: b.dataset.inviteStatus });
        await load();
        $('#cw-message').textContent = b.dataset.inviteStatus === 'active' ? '邀请码已启用。' : '邀请码已停用。';
      } else if (b.hasAttribute('data-withdraw')) {
        b.disabled = true;
        await api(base + '/payouts', { request_key: requestKey });
        requestKey = crypto.randomUUID();
        await load();
      } else if (b.dataset.page) {
        offset = Math.max(0, offset + Number(b.dataset.page) * 50);
        await draw();
      } else if (b.dataset.codeReview) {
        const k = data.detail.codes.find((k) => k.id === b.dataset.codeReview);
        $('#code-editor').innerHTML = form(
          'code-review',
          `<input name="code_id" type="hidden" value="${k.id}"><h3>审核 ${k.code}</h3><label>状态<select name="status"><option value="active">批准生效</option><option value="paused">暂停</option><option value="rejected">拒绝</option></select></label>` +
            field(
              'customer_price_percent',
              '客户价格比例',
              'number',
              `min="50" max="100" value="${k.customer_price_percent}"`,
            ) +
            field(
              'starts_at',
              '生效时间',
              'datetime-local',
              `value="${localDate(k.starts_at || new Date())}"`,
            ) +
            field(
              'ends_at',
              '结束时间',
              'datetime-local',
              k.ends_at ? `value="${localDate(k.ends_at)}"` : '',
            ),
          '保存审核',
        );
      } else if (b.dataset.payoutReview)
        $('#payout-editor').innerHTML = form(
          'payout-review',
          `<input name="payout_id" type="hidden" value="${b.dataset.payoutReview}"><label>审核结果<select name="status"><option value="approved">批准</option><option value="rejected">拒绝</option></select></label>` +
            field('withholding_fen', '代扣税额（分）', 'number', 'min="0" value="0"') +
            field('evidence', '税务计算与审核依据'),
          '保存审核',
        );
      else if (b.dataset.payoutComplete)
        $('#payout-editor').innerHTML =
          form(
            'payment-details',
            `<input name="payout_id" type="hidden" value="${b.dataset.payoutComplete}">` +
              field('reason', '查看收款账户原因'),
            '查看已审核付款资料',
          ) +
          '<div id="payment-details"></div>' +
          form(
            'payout-complete',
            `<input name="payout_id" type="hidden" value="${b.dataset.payoutComplete}"><p>请通过公司银行渠道付款并核验最终结果。结果未知时不要选择失败，也不要重新付款。</p><label>银行最终结果<select name="status"><option value="paid">已到账</option><option value="failed">已确认失败</option></select></label>` +
              field('payment_reference', '银行流水／失败查询编号') +
              field('evidence', '银行最终结果凭证') +
              `<label class="cw-check"><input type="checkbox" required>已核验银行最终结果</label>`,
            '记录银行结果',
          );
    } catch (err) {
      $('#cw-message').textContent = err.message;
    } finally {
      b.disabled = false;
    }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.matches('[data-action=code-review] select[name=status]')) {
      const f = e.target.form;
      for (const name of ['customer_price_percent', 'starts_at', 'ends_at']) {
        f.elements[name].required = e.target.value === 'active';
        f.elements[name].disabled = e.target.value !== 'active';
      }
    }
    if (e.target.id === 'event-code') {
      filter = e.target.value;
      offset = 0;
      try {
        await draw();
      } catch (err) {
        $('#cw-message').textContent = err.message;
      }
    }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-action]');
    if (!f) return;
    e.preventDefault();
    const b = Object.fromEntries(new FormData(f)),
      action = f.dataset.action,
      submit = e.submitter || f.querySelector('button');
    submit.disabled = true;
    try {
      let path,
        body = b;
      if (action === 'sales-filter') {
        salesFilter = { query: b.query.trim(), stage: b.stage };
        drawSalesList($('#cw-content'));
        $('.cw-sales-filters button').focus({ preventScroll: true });
        return;
      }
      if (action === 'owner' || action === 'followup') {
        path = base + '/' + selected + (action === 'owner' ? '/owner' : '/followups');
      }
      if (action === 'apply') {
        path = '/api/cw/apply';
        body = { ...b, consent_version: 'cw-privacy-v1' };
      }
      if (action === 'invite-code') {
        path = base + '/invite-codes';
        body = { ...b, max_uses: Number(b.max_uses) };
      }
      if (action === 'code') {
        path = '/api/cw/codes';
        body = { ...b, customer_price_percent: Number(b.customer_price_percent) };
      }
      if (action === 'bank') {
        path = '/api/cw/bank';
        body = { ...b, consent_version: 'cw-bank-v1' };
      }
      if (action === 'contract') {
        path = base + '/' + selected + '/contract';
        body = { ...b, verified: true, expires_at: new Date(b.expires_at).toISOString() };
      }
      if (action === 'task-code') {
        path = base + '/' + selected + '/task-code';
      }
      if (action === 'discount-request') {
        path = base + '/' + selected + '/discount-requests';
        body = { customer_price_percent: Number(b.customer_price_percent), reason: b.reason };
      }
      if (action === 'discount-decision') {
        path = base + '/' + selected + '/discount-requests/' + encodeURIComponent(b.request_id) + '/decision';
        body = { status: submit.value, decision_note: b.decision_note };
      }
      if (action === 'contact' || action === 'bank-details') {
        const contactOnly = action === 'contact';
        const r = await api(base + '/' + selected + '/private', { ...b, scope: contactOnly ? 'contact' : 'bank' });
        if (!f.isConnected) return;
        const details = $(contactOnly ? '#contact-details' : '#private-details');
        details.innerHTML = privateDetails(r);
        return;
      }
      if (action === 'bank-verify') {
        path = base + '/' + selected + '/bank-verify';
        body = { ...b, bank_version: Number(b.bank_version) };
      }
      if (action === 'suspend') {
        path = base + '/' + selected + '/status';
        body = { ...b, status: 'suspended' };
      }
      if (action === 'code-review') {
        path = base + '/codes/' + b.code_id + '/review';
        body =
          b.status === 'active'
            ? {
                ...b,
                customer_price_percent: Number(b.customer_price_percent),
                starts_at: new Date(b.starts_at).toISOString(),
                ends_at: new Date(b.ends_at).toISOString(),
              }
            : b;
      }
      if (action === 'close') path = base + '/customer-closes';
      if (action === 'payout-review') {
        path = base + '/payouts/' + b.payout_id + '/review';
        body = { ...b, withholding_fen: Number(b.withholding_fen) };
      }
      if (action === 'payment-details') {
        const r = await api(base + '/payouts/' + b.payout_id + '/payment-details', b);
        $('#payment-details').innerHTML = privateDetails(r);
        return;
      }
      if (action === 'payout-complete') {
        path = base + '/payouts/' + b.payout_id + '/complete';
        body = { ...b, bank_result_verified: true };
      }
      await api(path, body);
      await load();
      $('#cw-message').textContent = '已保存。';
    } catch (err) {
      $('#cw-message').textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });
  load();
})();
