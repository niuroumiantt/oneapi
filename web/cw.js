(() => {
  'use strict';
  const $ = (s) => document.querySelector(s),
    esc = (v) =>
      String(v ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      ),
    money = (v) => '¥' + (Number(v || 0) / 100).toFixed(2),
    when = (v) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—');
  const staff = new URLSearchParams(location.search).get('staff') === '1',
    base = staff ? '/api/staff/cw' : '/api/cw',
    labels = {
      pending: '待审核',
      active: '已生效',
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
    selected = null,
    tab = 'overview',
    offset = 0,
    filter = '',
    requestKey = crypto.randomUUID();
  $('#cw-header').innerHTML = window.SiteHeader.render('workspace', {
    account: `<a href="${staff ? '/#console/business/overview' : '/#workspace'}">${staff ? '返回商务后台' : '我的工作台'}</a>`,
  });
  $('#cw-footer').innerHTML = window.SiteHeader.footer();
  if (staff) {
    $('#cw-title').textContent = 'VIP 合作伙伴管理';
    document.title = 'VIP 合作伙伴管理 · semifly.ai';
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
  const field = (name, title, type = 'text', extra = '') =>
    `<label>${title}<input name="${name}" type="${type}" required ${extra}></label>`;
  const form = (action, html, label) =>
    `<form class="cw-form" data-action="${action}">${html}<button type="submit">${label}</button></form>`;
  const table = (heads, rows) =>
    `<div class="cw-table"><table><thead><tr>${heads.map((t) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}">暂无记录</td></tr>`}</tbody></table></div>`;
  const privateDetails = (r) =>
    `<dl class="cw-proof">${r.contact ? `<dt>联系方式</dt><dd>${esc(r.contact.contact)}</dd>` : ''}${r.bank ? `<dt>收款人</dt><dd>${esc(r.bank.holder)}</dd><dt>开户银行</dt><dd>${esc(r.bank.bank)}</dd><dt>银行卡号</dt><dd>${esc(r.bank.number)}</dd>` : '<dt>银行卡</dt><dd>尚未填写</dd>'}${r.bank_version !== undefined ? `<dt>银行卡版本</dt><dd>${r.bank_version}</dd>` : ''}${r.net_fen !== undefined ? `<dt>应付税后金额</dt><dd>${money(r.net_fen)}</dd>` : ''}</dl>`;
  const stat = (title, value) => `<dl><dt>${title}</dt><dd>${money(value)}</dd></dl>`;
  function clearView(error) {
    data = null;
    selected = null;
    ++viewVersion;
    ++loadVersion;
    $('#cw-content').inert = false;
    $('#cw-content').removeAttribute('aria-busy');
    $('#cw-nav').replaceChildren();
    $('#cw-message').textContent = error.message;
    $('#cw-content').innerHTML = error.status === 401
      ? `<h2>登录已过期</h2><p>请先${staff ? '完成员工登录' : '注册或登录个人账户'}，再刷新此页。</p><a class="cw-button" href="${staff ? '/api/staff/login?next=business' : '/?cw_join=' + encodeURIComponent(new URLSearchParams(location.search).get('invite') || '1') + '#register'}">${staff ? '员工登录' : '注册／登录'}</a>`
      : `<h2>${error.status === 403 ? '暂时无法访问' : '加载未完成'}</h2><p>${error.status === 403 ? '请确认当前员工账号具有商务权限。' : '请点击右上角“刷新”重试。'}</p>`;
  }
  function nav() {
    const focused = $('#cw-nav').contains(document.activeElement) ? document.activeElement.dataset.tab : null;
    const items = staff
      ? [
          ['overview', 'VIP 伙伴与邀请码'],
          ['manage', '档案与推广码'],
          ['settlement', '月结与提现'],
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
      if (staff && partnerId) {
        result.detail = await api(base + '/' + partnerId);
        if (version !== loadVersion) return;
      }
      data = result;
      await draw();
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
    nav();
    const c = $('#cw-content');
    if (staff) {
      drawStaff(c);
      return;
    }
    if (!data.partner) {
      c.innerHTML = `<h2>申请成为 VIP</h2><p>与公司独立签约，使用专属推广码推广产品。客户实付形成预计收益，实际使用解锁佣金；客户月结确认后可提现。申请免费，需邀请码，邀请其他 VIP 本身不产生佣金。</p>${form('apply', field('legal_name', '真实姓名', 'text', 'maxlength="60"') + field('contact', '手机号或其他联系方式', 'text', 'maxlength="160"') + `<label>邀请码（必填，由 semifly 提供）<input name="invite_code" maxlength="32" required placeholder="输入邀请码"></label><label>邀请人的 VIP 编号（可选）<input name="invite" maxlength="8" value="${esc(new URLSearchParams(location.search).get('invite') || '')}"></label><label class="cw-check"><input type="checkbox" name="consent" required>我已阅读<a href="/cw-terms.html#privacy" target="_blank" rel="noopener">资料处理说明</a>，同意为合作申请处理上述资料。</label>`, '提交申请')}`;
      return;
    }
    const p = data.partner,
      t = data.totals;
    if (tab === 'overview')
      c.innerHTML = `<h2>${esc(p.legal_name)} <span class="cw-status">${labels[p.status]}</span></h2><p>VIP 编号：<strong>${esc(p.public_code)}</strong></p><div class="cw-metrics">${stat('客户实付', t.paid_fen)}${stat('客户实用', t.used_fen)}${stat('预计总佣金（税前）', t.expected_fen)}${stat('已解锁佣金（税前）', t.unlocked_fen)}${stat('可提现（税前）', t.available_fen)}</div><p>预计佣金包含已解锁部分，不代表全部可提现。客户退款会取消未使用部分的预计佣金。已解锁佣金需待客户月结与收款对账确认后方可申请提现。</p><p>提成 = 卖出折扣 − 4 折。以 5 折卖出提成 10%、8 折卖出提成 40%，多卖多得。你可用专属 5 折码自购，不产生提成。</p>`;
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
      c.innerHTML = `<h2>邀请新的 VIP 伙伴</h2><p>受邀伙伴独立申请、独立签约、使用自己的推广码。邀请关系不产生佣金，也不分享对方的客户与收入数据。</p><button data-copy="${esc(location.origin + '/cw.html?invite=' + p.public_code)}">复制邀请链接</button>${table(['伙伴编号', '加入时间', '合作状态'], data.invited.map((i) => `<tr><td>${i.public_code}</td><td>${when(i.created_at)}</td><td>${labels[i.status]}</td></tr>`).join(''))}`;
  }
  function drawStaff(c) {
    if (tab === 'overview') {
      const invites = data.invite_codes || [];
      c.innerHTML = `<h2>VIP 合作伙伴</h2><p>申请入口：<a href="/cw.html">VIP 工作台</a> · 当前${data.enabled ? '已开放申请' : '尚未开放申请'}</p><h3>邀请码管理（管理员）</h3>${table(['邀请码', '使用次数', '状态', '备注', '创建人／时间', '操作'], invites.map((v) => `<tr><td>${esc(v.code)}</td><td>${v.used_count} / ${v.max_uses}</td><td>${v.status === 'active' ? '生效中' : '已停用'}</td><td>${esc(v.note || '')}</td><td>${esc(v.created_by)}<small>${when(v.created_at)}</small></td><td>${v.status === 'active' ? `<button data-invite-disable="${esc(v.code)}">停用</button>` : ''}</td></tr>`).join(''))}<details><summary>生成新邀请码</summary>${form('invite-code', field('code', '邀请码（如 VIP888）', 'text', 'maxlength="32"') + field('max_uses', '使用次数上限', 'number', 'min="1" value="1"') + field('note', '备注', 'text', 'maxlength="200"'), '生成邀请码')}</details><h3>伙伴列表</h3>${table(['姓名／VIP 编号', '登录邮箱', '邀请来源', '状态／码数', '实付／实用', '预计佣金', '管理'], data.partners.map((p) => `<tr><td>${esc(p.legal_name)}<small>${p.public_code}</small></td><td>${esc(p.email)}</td><td>${p.invited_by || '自主申请'}</td><td>${labels[p.status]} / ${p.code_count}</td><td>${money(p.paid_fen)} / ${money(p.used_fen)}</td><td>${money(p.expected_fen)}</td><td><button data-partner="${p.id}">管理</button></td></tr>`).join(''))}`;
      return;
    }
    const d = data.detail;
    if (!d) {
      c.innerHTML = `<h2>${tab === 'manage' ? '档案与推广码' : '月结与提现'}</h2><p>${data.partners.length ? '请先选择要管理的 VIP，再查看其档案、推广码和结算记录。' : '目前还没有 VIP 申请记录。收到申请后，可在伙伴列表选择并管理。'}</p><button data-tab="overview">返回伙伴列表</button>`;
      return;
    }
    const p = d.partner;
    c.innerHTML = `<button data-tab="overview">返回伙伴列表</button><h2 class="cw-partner-title">${esc(p.legal_name)} · ${p.public_code}</h2><p>合作状态：${labels[p.status]} · 可提现（税前）：${money(d.available_fen)}</p>`;
    if (tab === 'manage')
      c.innerHTML += `<h3>推广码</h3>${table(['推广码／名称', '客户价格', '提成', '有效期', '状态', '实付／实用', '预计／解锁佣金', '审核'], d.codes.map((k) => `<tr><td>${k.code}${k.is_self_code ? '<small>专属自购码</small>' : ''}<small>${esc(k.name)}</small></td><td>${k.customer_price_percent}%</td><td>${k.is_self_code ? '无' : (k.customer_price_percent - 40) + '%'}</td><td>${when(k.starts_at)} 至 ${when(k.ends_at)}</td><td>${labels[k.status]}</td><td>${money(k.paid_fen)} / ${money(k.used_fen)}</td><td>${money(k.expected_fen)} / ${money(k.unlocked_fen)}</td><td>${k.is_self_code ? '' : `<button data-code-review="${k.id}">审核／停用</button>`}</td></tr>`).join(''))}<div id="code-editor"></div><h3>签约记录</h3>${table(['合同版本', '文件摘要', '核验人／时间', '有效期'], d.contracts.map((k) => `<tr><td>${esc(k.template_version)}</td><td>${esc(k.document_sha256)}</td><td>${esc(k.verified_by)}<small>${when(k.verified_at)}</small></td><td>${when(k.expires_at)}</td></tr>`).join(''))}<details><summary>合同与身份核验（管理员）</summary><p>请核验真实签约服务凭证，不能把提交申请视为已签约。</p>${form('contract', field('template_version', '正式合同版本') + field('document_sha256', '已签署文件 SHA-256', 'text', 'pattern="[a-f0-9]{64}"') + field('signature_reference', '签约服务商及凭证编号') + field('identity_reference', '实名核验服务及凭证编号') + field('expires_at', '合同截止时间', 'datetime-local') + `<label class="cw-check"><input type="checkbox" required>已核验双方签署证据和合作人身份</label>`, '登记签署证据并激活')}</details><details><summary>收款账户与联系资料（财务）</summary>${form('private', field('reason', '查看原因'), '查看敏感资料')}<div id="private-details"></div>${form('bank-verify', field('bank_version', '已核验银行卡版本', 'number', 'min="1"') + field('evidence', '本人账户核验凭证编号'), '确认核验')}</details><details><summary>暂停合作</summary>${form('suspend', field('reason', '暂停原因'), '暂停新推广与提现')}</details>`;
    if (tab === 'settlement')
      c.innerHTML += `<h3>客户付款订单</h3><p class="cw-muted">最近 200 笔成交</p>${table(['客户／付款订单', '推广码', '付款时间', '客户实付／实用', '预计／解锁佣金', '客户计费账户'], d.orders.map((o) => `<tr><td>${esc(o.customer_email)}<small>${esc(o.out_trade_no)}</small></td><td>${o.code}</td><td>${when(o.paid_at)}</td><td>${money(o.cash_fen)} / ${money(o.used_cash_fen)}</td><td>${money(o.expected_fen)} / ${money(o.unlocked_fen)}</td><td>${o.account_id}${o.channel_fee_issue ? '<small>' + esc(o.channel_fee_issue) + '</small>' : ''}</td></tr>`).join(''))}<h3>付款与使用明细</h3>${table(['时间', '码／付款订单', '事件', '实付／实用', '预计／解锁变化'], d.events.map((e) => `<tr><td>${when(e.occurred_at)}</td><td>${e.code}<small>${esc(e.out_trade_no)}</small></td><td>${e.kind === 'paid' ? '充值实付' : labels[e.kind]}</td><td>${money(e.cash_fen)}</td><td>${money(e.commission_fen)}</td></tr>`).join(''))}<details><summary>确认客户月结（财务）</summary><p>自然月已结束、调用结算与支付账单核对完成，并已与客户完成结算，才可确认。</p>${form('close', `<label>客户计费账户<select name="account_id" required><option value="">请选择客户账户</option>${[...new Map(d.orders.map((o) => [o.account_id, o])).values()].map((o) => `<option value="${o.account_id}">${esc(o.customer_email)} · ${o.account_id}</option>`).join('')}</select></label>` + field('month', '结算月份', 'month') + field('evidence', '客户结算单／确认凭证编号'), '确认客户月结')}${table(['已结月份', '客户账户', '结算凭证', '确认时间'], d.closes.map((x) => `<tr><td>${x.month}</td><td>${x.account_id}</td><td>${esc(x.evidence)}</td><td>${when(x.closed_at)}</td></tr>`).join(''))}</details><h3>提现申请与付款结果</h3>${table(['申请时间', '税前／代扣税', '状态', '银行卡', '操作'], d.payouts.map((r) => `<tr><td>${when(r.created_at)}</td><td>${money(r.gross_fen)} / ${money(r.withholding_fen)}</td><td>${labels[r.status]}</td><td>尾号 ${r.bank_last4}</td><td>${r.status === 'requested' ? `<button data-payout-review="${r.id}">审核</button>` : r.status === 'approved' ? `<button data-payout-complete="${r.id}">付款与结果确认</button>` : ''}</td></tr>`).join(''))}<div id="payout-editor"></div>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.tab) {
        tab = b.dataset.tab;
        await draw();
        $('#cw-content').scrollTop = 0;
      } else if (b.id === 'refresh') await load();
      else if (b.dataset.partner) {
        selected = b.dataset.partner;
        tab = 'manage';
        $('#cw-content').textContent = '正在加载合作伙伴资料…';
        await load();
        $('#cw-content').scrollTop = 0;
      } else if (b.dataset.copy) {
        await navigator.clipboard.writeText(b.dataset.copy);
        $('#cw-message').textContent = '链接已复制。';
      } else if (b.dataset.inviteDisable) {
        await api(base + '/invite-codes/' + encodeURIComponent(b.dataset.inviteDisable) + '/status', { status: 'disabled' });
        await load();
        $('#cw-message').textContent = '邀请码已停用。';
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
      submit = f.querySelector('button');
    submit.disabled = true;
    try {
      let path,
        body = b;
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
      if (action === 'private') {
        const r = await api(base + '/' + selected + '/private', b);
        $('#private-details').innerHTML = privateDetails(r);
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
