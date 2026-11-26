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
  if(params.get('embedded')==='1' && window.parent!==window)document.documentElement.classList.add('cw-embedded');
  const referrer = params.get('invite') || '';
  const inviteParam = (params.get('invite_code') || '').normalize('NFKC').trim().toUpperCase();
  const employeeInviteCode = /^[A-Z0-9_-]{2,32}$/.test(inviteParam) ? inviteParam : '';
  const partnerParam = params.get('partner');
  const requestedPartner = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(partnerParam || '') ? partnerParam : null;
  const staff = params.get('staff') === '1',
    base = staff ? '/api/staff/cw' : '/api/cw',
    labels = {
      pending: '待电话面试',
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
    salesFilter = { query: '', stage: '', owner: '' },
    orderLookup = null,
    offset = 0,
    filter = '',
    requestKey = crypto.randomUUID();
  $('#cw-header').innerHTML = window.SiteHeader.render('workspace', {
    account: `<a href="${staff ? '/#console/business/overview' : '/#workspace'}">${staff ? '返回商务后台' : '我的工作台'}</a>`,
  });
  $('#cw-footer').innerHTML = window.SiteHeader.footer();
  if (staff) {
    document.body.classList.add('cw-staff');
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
  const hasCurrentContract = (contracts) => contracts.some((entry) => Date.parse(entry.expires_at) > Date.now());
  const hasPromotionTrial = (partner) => partner.status === 'active' && Date.parse(partner.promotion_trial_until) > Date.now();
  function promotionStatus(code, active, contractVerified, trialActive) {
    if (!['pending','active'].includes(code.status)) return labels[code.status];
    if (!active) return '待开通正式 VIP';
    if (!contractVerified && !(trialActive && !code.is_self_code)) return '待合同与实名核验';
    if (code.status === 'pending') return '暂未生效';
    const now = Date.now();
    if (!(Date.parse(code.starts_at) <= now)) return '待生效';
    return Date.parse(code.ends_at) > now ? '已生效' : '已到期';
  }
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
    $('#cw-message').dataset.error='true';
    $('#cw-message').textContent = error.status === 401 ? '' : error.message;
    const authParams = new URLSearchParams({ cw_join: referrer || '1' });
    if (employeeInviteCode) authParams.set('invite_code', employeeInviteCode);
    const customerEntry = esc('/?' + authParams);
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
          ['invite-codes', '招募邀请码'],
          ...(selected ? [['manage', '客户档案']] : []),
          ...(data.finance && selected ? [['settlement', '月结与提现']] : []),
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
      $('#cw-message').dataset.error='false';
      $('#cw-message').textContent = '';
      const result = await api(staff ? base : base + '/me');
      if (version !== loadVersion) return;
      let unavailable = false;
      if (staff && partnerId) {
        try {
          const order = orderLookup?.partner_id === partnerId ? '?order=' + encodeURIComponent(orderLookup.out_trade_no) : '';
          result.detail = await api(base + '/' + partnerId + order);
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
      if(compactVIP&&!personalStarted){tab=params.get('view')==='program'?'intro':data.partner?'overview':'intro';personalStarted=true;}
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
  let personalPage=0, personalStarted=false;
  const personalGuideTabs=['intro','process','terms'];
  function commissionStages(t){
    const amount=key=>Math.max(0,Number(t[key])||0);
    const expected=amount('expected_fen'),unlocked=amount('unlocked_fen'),available=amount('available_fen'),pending=amount('payout_pending_fen'),paid=amount('paid_out_fen');
    // These are partitions of expected commission, not overlapping cumulative metrics.
    return [
      ['locked','待解锁',Math.max(0,expected-unlocked)],
      ['settling','待结算',Math.max(0,unlocked-available-pending-paid)],
      ['available','可提现',available],['pending','提现中',pending],['paid','已提现',paid]
    ];
  }
  function commissionBar(t){
    const stages=commissionStages(t),total=stages.reduce((n,r)=>n+r[2],0);
    return `<div class="cv-commission" aria-label="佣金状态"><div class="cv-commission-track" aria-hidden="true">${stages.map(([kind,,value])=>value?`<span class="cv-stage-${kind}" style="width:${value/total*100}%"></span>`:'').join('')}</div><div class="cv-commission-legend">${stages.filter((r,i)=>i<3||r[2]>0).map(([kind,label,value])=>`<span><i class="cv-stage-${kind}" aria-hidden="true"></i>${label} <strong>${money(value)}</strong></span>`).join('')}</div></div>`;
  }
  function promotionAmounts(t){
    return `<div class="cv-code-amounts"><span>客户累计实付 <strong>${money(t.paid_fen)}</strong></span><span>实付已消费 <strong>${money(t.used_fen)}</strong></span><span>预计佣金 <strong>${money(t.expected_fen)}</strong></span>${Number(t.refunded_fen)>0?`<small>已退款 ${money(t.refunded_fen)}</small>`:''}</div>`;
  }
  const commissionNote='<p class="cv-commission-note">实付含扫码与付款链接，按推广码归属；退款单列，佣金已扣除退款影响。客户消费后解锁，月结核对后可提现；条内金额均为税前。</p>';
  function promotionCodeRows(codes,verified,trial){
    const size=innerWidth<700||innerHeight<540?1:innerHeight<780?2:3,total=Math.max(1,Math.ceil(codes.length/size));
    personalPage=Math.max(0,Math.min(personalPage,total-1));
    const rows=codes.slice(personalPage*size,(personalPage+1)*size).map(k=>{
      const status=promotionStatus(k,true,verified,trial);
      return `<article class="cv-code-row"><div class="cv-code-heading"><div><strong>${esc(k.name||k.code)}</strong><small>${esc(k.code)} · ${discount(k.customer_price_percent)} · ${esc(status)}</small></div><div class="cv-code-actions">${status==='已生效'?`<button data-copy="${esc(location.origin+payLink(k.code))}">复制链接</button><a target="_blank" rel="noopener" href="/api/cw/codes/${encodeURIComponent(k.id)}/qr">二维码 ↗</a>`:''}</div></div>${k.is_self_code?'<p>自用充值码，不计推广佣金；充值记录见「充值与账单」。</p>':promotionAmounts(k)+commissionBar(k)}</article>`;
    }).join('');
    return `<section class="cv-code-list" aria-label="各推广码收益">${rows||'<p>还没有推广码。生成后分享给客户，可在这里查看实付与佣金。</p>'}</section>${total>1?`<nav class="cv-pages" aria-label="推广码分页"><button data-vip-page="${personalPage-1}" ${personalPage===0?'disabled':''}>上一页</button><span>${personalPage+1} / ${total}</span><button data-vip-page="${personalPage+1}" ${personalPage===total-1?'disabled':''}>下一页</button></nav>`:''}`;
  }
  const personalSigningLabels={available:'可申请线上签约',requested:'等待准备合同',creating:'合同准备中',draft:'合同待公司确认',starting:'签约发起中',pending_both:'待双方签署',pending_person:'待本人实名签署',pending_company:'待公司盖章',archiving:'已签署，归档核验中',verified:'签署与实名已核验',rejected:'已拒签',expired:'已过期',canceled:'已撤销',voided:'已作废',review:'签署记录待核对'};
  function personalSigningStatus(job){return job?(job.mode==='sandbox'?'内部试签 · ':'')+(personalSigningLabels[job.status]||'状态待核对'):'暂未开放';}
  function personalSigningAction(job,contracts){
    if(!job)return '<p class="cv-detail-note">在线签约开放后，可在这里完成实名、签署并下载已归档合同。</p>';
    if(['pending_both','pending_person'].includes(job.status)&&job.id)return form('vip-sign-open',`<input type="hidden" name="signing_id" value="${esc(job.id)}">`,'去法大大实名并签署');
    if(!hasCurrentContract(contracts)&&['available','verified','rejected','expired','canceled','voided'].includes(job.status)&&job.request_version)return '<button data-tab="sign-request">申请线上签约</button>';
    return '<p class="cv-detail-note">请留意当前处理进度；双方签署并归档核验后，可下载合同。</p>';
  }
  const compactVIP=!staff&&params.get('personal')==='1';
  if(compactVIP){document.documentElement.classList.add('cw-personal');tab='intro';}
  function personalList(heads,rows,more=false,rowLimit=0){
    const size=rowLimit||(innerWidth<700?2:innerHeight<600?3:5),total=Math.max(1,Math.ceil(rows.length/size));
    personalPage=Math.max(0,Math.min(personalPage,total-1));
    return table(heads,rows.slice(personalPage*size,(personalPage+1)*size).join(''))+(total===1&&!more&&!offset?'':`<nav class="cv-pages" aria-label="记录分页"><button data-vip-page="${personalPage-1}" ${personalPage===0?'disabled':''}>上一页</button><span>${personalPage+1} / ${total}</span><button data-vip-page="${personalPage+1}" ${personalPage===total-1?'disabled':''}>下一页</button>${more?'<button data-page="1">下一批记录</button>':''}${offset?'<button data-page="-1">上一批记录</button>':''}</nav>`);
  }
  async function drawPersonalVIP(c,version){
    const p=data.partner,t=data.totals||{},active=p?.status==='active',codes=data.codes||[],contracts=data.contracts||[];
    const guide=personalGuideTabs.includes(tab),destination=p?'overview':'apply';
    const sections=active?[['overview','概览'],['codes','推广码'],['events','推广明细'],['payouts','佣金与提现'],['profile','个人信息与合同']]:p?[['overview','申请进度'],['profile','申请资料']]:[['apply','填写申请']];
    const section=['new-code'].includes(tab)?'codes':['withdraw'].includes(tab)?'payouts':['bank','invites','feedback','contracts','sign-request'].includes(tab)?'profile':tab;
    $('#cw-title').textContent=guide?'VIP 合作计划':active?'VIP 工作台':'VIP 申请';
    $('#cw-description').textContent='';
    const guideLink=$('#cw-guide-link');guideLink.textContent=guide?(active?'返回工作台':p?'查看申请进度':'申请指南'):'了解合作计划';
    guideLink.href=guide?(p?'?embedded=1&personal=1':'vip-start.html'):'?embedded=1&personal=1&view=program';
    guideLink.target=guide&&!p?'_blank':'_self';guideLink.dataset.vipGuide=guide?(p?'overview':'external'):'intro';
    $('#refresh').hidden=guide;
    document.querySelector('.cv-management-nav')?.remove();
    const items=guide?[['intro','计划介绍'],['process','申请流程'],['terms','合作规则'],[destination,active?'我的 VIP':'我的申请']]:sections;
    const navButton=([k,v])=>`<button data-tab="${k}" aria-current="${(guide?tab:section)===k?'page':'false'}">${v}</button>`;
    $('#cw-nav').innerHTML=items.map(navButton).join('');
    if(window.parent!==window)parent.postMessage({type:'personal-vip-status',status:p?.status||'none'},location.origin);
    const go=(k,v)=>`<button data-tab="${k}">${v}</button>`;
    if(tab==='intro'){
      c.innerHTML=`<section class="cv-program"><h2>用模型，也把好模型推荐给客户。</h2><p>了解专属充值与推广合作，按自己的需要申请。</p><dl class="cv-benefits"><div><dt>专属充值</dt><dd>审核后领取付款码，付款前核对折扣与到账额度。</dd></div><div><dt>推广合作</dt><dd>符合条件后使用推广码，查看客户用量与佣金明细。</dd></div><div><dt>清楚可查</dt><dd>申请进度、资料、推广和结算，都在这里管理。</dd></div></dl><div class="cw-inline"><button class="cw-primary" data-tab="${destination}">${p?(active?'进入我的 VIP':'查看我的申请'):'开始申请'}</button>${go('process','了解申请流程')}</div></section>`;return;
    }
    if(tab==='process'){
      c.innerHTML=`<section class="cv-program"><h2>四步开通</h2><ol class="cv-program-steps"><li><strong>提交申请</strong><p>准备真实姓名、联系方式和员工提供的邀请码。</p></li><li><strong>电话面试</strong><p>通过后，由负责员工发放 VIP 付款码。</p></li><li><strong>充值与核验</strong><p>累计有效实付满 ¥100，由负责员工核验开通。</p></li><li><strong>开始使用与推广</strong><p>开通后查看专属充值；推广须符合合同与实名核验要求。</p></li></ol><div class="cw-inline"><button class="cw-primary" data-tab="${destination}">${p?'查看我的申请':'填写申请资料'}</button>${go('terms','查看合作规则')}</div></section>`;return;
    }
    if(tab==='terms'){
      c.innerHTML=`<section class="cv-program"><h2>申请前，了解这三点</h2><dl class="cv-benefits"><div><dt>充值与退款</dt><dd>有效实付不含赠送和已退款金额。开通后首次 ¥100 激活款可消费，不支持自助退款。</dd></div><div><dt>佣金与结算</dt><dd>客户实际使用后解锁佣金，月结核对后可提现；预计佣金不等于可提现金额。</dd></div><div><dt>推广与邀请</dt><dd>推广资格、折扣与期限以核验结果为准。邀请伙伴独立申请，邀请关系不产生佣金。</dd></div></dl><div class="cw-inline"><a href="/cw-terms.html" target="_blank" rel="noopener">完整合作说明 ↗</a><a href="/cw-terms.html#privacy" target="_blank" rel="noopener">资料处理说明 ↗</a></div></section>`;return;
    }
    c.innerHTML='';
    if(!p){c.innerHTML=`<h2>申请成为 VIP</h2><p>提交资料后，由负责员工联系你。当前无需付款。</p>`+form('apply',field('legal_name','真实姓名','text','maxlength="60" autocomplete="name"')+field('contact','联系方式','text','maxlength="160"')+field('invite_code','员工提供的邀请码','text',`maxlength="32" value="${esc(employeeInviteCode)}"`)+field('invite','邀请人 VIP 编号（选填）','text',`maxlength="8" value="${esc(referrer)}"`,false)+'<label class="cw-check"><input type="checkbox" name="consent" required><span>我已阅读<a href="/cw-terms.html#privacy" target="_blank" rel="noopener">资料处理说明</a>，同意处理申请资料。</span></label>','提交申请');return;}
    if(tab==='overview'){
      const prog=document.createElement('div');prog.innerHTML=applicationProgress(data);prog.querySelectorAll('time,.cw-steps small').forEach(e=>e.remove());if(active){prog.querySelector('.cw-steps')?.remove();prog.querySelector('.cw-next')?.remove();}
      // Feedback stays available as a separate view; it does not crowd the current action.
      prog.querySelectorAll('.cw-progress>p:not(.cw-next):not(.cw-muted)').forEach(e=>e.remove());
      const current=data.task_codes?.[0],ap=data.activation_progress;
      c.innerHTML=prog.innerHTML+(active?`<section class="cv-code-overview">${promotionAmounts(t)}${commissionBar(t)}${commissionNote}</section><p>${hasCurrentContract(contracts)?'合同与实名已核验，可使用推广码。':hasPromotionTrial(p)?'推广试用中，请在到期前完成合同与实名核验。':'下一步：联系负责员工完成合同与实名核验，再开始推广。'}</p><div class="cw-inline">${go('codes','查看推广码')}${go('payouts','佣金与提现')}${current?`<a class="cw-button" target="_parent" href="${payLink(current.code)}">专属折扣充值 · ${discount(current.customer_price_percent)}</a>`:''}</div>`:p.status==='confirmed'?`<section class="cv-next"><p>有效实付 ${money(ap?.total_fen)} / ¥100.00 · ${ap?.eligible?'已达标，等待核验':'还差 '+money(ap?.shortfall_fen)}</p>${!ap?.eligible&&current?paymentCard(current).replace('<a ','<a target="_parent" '):''}<div class="cw-inline">${go('rules','充值与退款规则')}<a target="_parent" href="/#support">联系支持</a></div></section>`:`<div class="cw-inline"><a target="_parent" href="/#support">联系支持</a>${data.feedback?go('feedback','查看处理反馈'):''}</div>`);return;
    }
    if(tab==='profile'){
      c.innerHTML=`<div class="cv-profile-sections"><section><h2>个人信息</h2><dl class="cv-info-list"><div><dt>真实姓名</dt><dd>${esc(p.legal_name)}</dd></div><div><dt>VIP 编号</dt><dd>${esc(p.public_code)}</dd></div><div><dt>负责员工</dt><dd>${esc(data.owner_name||p.owner_name||'待分配')}</dd></div></dl><a class="cw-button" target="_parent" href="/#security">管理账号与联系方式</a><p class="cv-detail-note">资料变更请联系负责员工。</p></section><section><h2>合同管理</h2><dl class="cv-info-list"><div><dt>合同核验</dt><dd>${hasCurrentContract(contracts)?'已核验且有效':contracts.length?'已过期或待核验':'暂无已核验合同'}</dd></div><div><dt>法大大签约</dt><dd>${esc(personalSigningStatus(data.signing))}</dd></div><div><dt>合同记录</dt><dd>${contracts.length} 份</dd></div></dl>${go('contracts','管理合同')}<p class="cv-detail-note">签约、有效期与归档文件。</p></section></div>${active?`<div class="cv-bank-status"><span>本人收款账户 <strong>${p.bank_last4?'尾号 '+esc(p.bank_last4):'未填写'}</strong> · ${p.bank_verified?'已核验':'待核验'}</span>${go('bank','管理收款账户')}</div>`:''}<div class="cw-inline">${data.feedback?go('feedback','处理反馈'):''}${active?go('invites','邀请伙伴'):''}<a href="/cw-terms.html" target="_blank" rel="noopener">合作说明</a></div>`;return;
    }
    if(tab==='contracts'){
      const job=data.signing;
      c.innerHTML=`<div class="cv-line"><h2>我的合同</h2>${go('profile','返回个人信息')}</div><div class="cv-signing-status"><div><strong>法大大签约</strong><p>${esc(personalSigningStatus(job))}</p></div>${personalSigningAction(job,contracts)}</div>`+personalList(['合同版本','核验 / 有效期','归档文件'],contracts.map(k=>`<tr><td>${esc(k.template_version)}</td><td>${when(k.verified_at)}<small>有效期至 ${when(k.expires_at)}</small></td><td>${/^[a-f0-9-]{36}$/i.test(k.fadada_signing_id||'')?`<a target="_blank" rel="noopener" href="/api/cw/signing/${encodeURIComponent(k.fadada_signing_id)}/pdf">下载已签 PDF</a>`:'暂无在线文件'}</td></tr>`),false,innerWidth<700?1:innerHeight<600?2:3);return;
    }
    if(tab==='sign-request'){
      const job=data.signing;
      if(!active||!job?.request_version||hasCurrentContract(contracts)){tab='contracts';return drawPersonalVIP(c,version);}
      c.innerHTML='<h2>申请法大大线上签约</h2><p>提交后由公司准备合同，你可在合同页跟进实名和签署。</p>'+form('vip-sign-request',`<input type="hidden" name="template_version" value="${esc(job.request_version)}">`+(data.signing_phone_required?field('phone','当前账号已验证的手机号','tel','inputmode="tel" autocomplete="tel" maxlength="16"'):'')+'<label class="cw-check"><input type="checkbox" name="consent" required><span>我同意将实名姓名和已验证的联系方式提供给<a href="https://legal.fadada.com/policy/1597793752477609984" target="_blank" rel="noopener">法大大</a>，用于身份核验、签署和保存本协议的签署凭证。</span></label>','同意并申请签约')+go('contracts','返回合同');return;
    }
    if(tab==='feedback'){const chars=innerWidth<700?180:500;const text=String(data.feedback||'暂无处理反馈');const chunks=Array.from({length:Math.ceil(text.length/chars)},(_,i)=>text.slice(i*chars,(i+1)*chars));c.innerHTML='<h2>处理反馈</h2>'+personalList(['反馈'],chunks.map(s=>`<tr><td>${esc(s)}</td></tr>`),false,1)+go('overview','返回进度');return;}
    if(tab==='rules'){c.innerHTML=`<h2>充值与退款规则</h2><p>累计有效实付满 ¥100 后，由负责员工核验开通。</p><p>可多次充值；赠送、已退款金额不计入，处理中退款核实后再计算。</p><p>开通后首次 ¥100 实付作为激活款，可用于消费，不支持自助退款。特殊诉求请联系支持。</p>${go('overview','返回我的 VIP')}`;return;}
    if(!active){tab='overview';return drawPersonalVIP(c,version);}
    const verified=hasCurrentContract(contracts),trial=hasPromotionTrial(p),eligible=verified||trial;
    if(tab==='codes'){
      c.innerHTML=`<div class="cv-line"><h2>推广码 <small>${codes.length} / 50</small></h2>${eligible&&codes.length<50?go('new-code','生成推广码'):''}</div>${!eligible?'<p>完成合同与实名核验后，可生成推广码。<button data-tab="profile">查看个人信息与合同</button></p>':trial&&!verified?`<p>试用至 ${when(p.promotion_trial_until)}</p>`:''}`+promotionCodeRows(codes,verified,trial)+commissionNote;return;
    }
    if(tab==='new-code'){c.innerHTML='<h2>生成推广码</h2><p>符合推广条件后，生成即生效，无需逐个审批。提成 = 客户价格比例 − 40%。客户实际使用后解锁，月结确认后可提现。</p>'+(eligible&&codes.length<50?form('code',field('name','推广码名称','text','maxlength="60"')+field('customer_price_percent','客户价格比例（50 表示五折）','number','min="50" max="100" value="50"'),'生成并启用'):'<p>当前未具备生成条件。</p>')+go('codes','返回推广码');return;}
    if(tab==='events'){
      c.innerHTML='<p role="status">正在读取推广明细…</p>';
      try{
        const events=await api(base+'/events?offset='+offset);if(version!==viewVersion)return;
        c.innerHTML='<h2>推广明细</h2><p>按推广码与匿名交易编号核对充值、使用和佣金变化。</p>'+personalList(['时间 / 推广码','事件 / 交易编号','实付 / 实用','佣金变化'],events.events.map(e=>`<tr><td>${when(e.occurred_at)}<small>${esc(e.code)}</small></td><td>${e.kind==='paid'?'充值实付':esc(labels[e.kind]||e.kind)}<small>${esc(e.public_reference)}</small></td><td>${money(e.cash_fen)}</td><td>${money(e.commission_fen)}</td></tr>`),events.has_more);
        if(!events.events.length&&!offset)c.innerHTML='<h2>还没有推广记录</h2><p>客户通过推广码充值后，这里会显示充值、实际使用和佣金变化。</p>'+go('codes','查看推广码');
      }catch(error){if(version!==viewVersion)return;c.innerHTML=`<h2>暂时无法读取推广明细</h2><p>${esc(error.message)}</p>${go('events','重新读取')}`;}
      return;
    }
    if(tab==='payouts'){
      const canWithdraw=p.bank_verified&&Number(t.available_fen)>0;
      c.innerHTML=`<div class="cv-line"><h2>可提现 <strong>${money(t.available_fen)}</strong><small> 税前</small></h2><button data-tab="withdraw" ${canWithdraw?'':'disabled'}>申请提现</button></div><p>客户使用 → 解锁佣金 → 月结确认 → 可提现。税后到账金额以结算单为准。</p><div class="cv-bank-status"><span>收款账户：${p.bank_last4?'尾号 '+esc(p.bank_last4):'未填写'} · ${p.bank_verified?'已核验':'待核验'}</span>${go('bank',p.bank_last4?'查看 / 修改':'填写收款账户')}</div>${!p.bank_verified?'<p>下一步：填写本人收款账户，并联系负责员工核验。</p>':Number(t.available_fen)<=0?'<p>暂无可提现佣金，月结确认后会显示在这里。</p>':''}`+personalList(['申请时间','税前 / 代扣税','税后金额','状态'],(data.payouts||[]).map(r=>`<tr><td>${when(r.created_at)}</td><td>${money(r.gross_fen)} / ${r.status==='requested'?'待核定':money(r.withholding_fen)}</td><td>${r.status==='requested'?'审核后确定':money(Number(r.gross_fen)-Number(r.withholding_fen))}</td><td>${esc(labels[r.status]||r.status)}${r.paid_at?'<small>'+when(r.paid_at)+'</small>':''}</td></tr>`),false,innerWidth<700?1:innerHeight<600?2:3);return;
    }
    if(tab==='withdraw'){
      c.innerHTML=`<h2>核对提现申请</h2><div class="cv-profile"><p>申请金额 · 税前 <strong>${money(t.available_fen)}</strong></p><p>本人收款账户 <strong>尾号 ${esc(p.bank_last4||'—')}</strong></p></div><p>提交全部可提现佣金；审核后确认代扣税和税后金额，可在提现记录查看进度。</p><div class="cw-inline"><button class="cw-primary" data-withdraw ${!p.bank_verified||Number(t.available_fen)<=0?'disabled':''}>确认提交提现申请</button>${go('payouts','返回提现记录')}</div>`;return;
    }
    if(tab==='bank'){c.innerHTML='<h2>本人收款账户</h2>'+form('bank',field('holder','本人姓名','text',`value="${esc(p.legal_name)}" maxlength="60"`)+field('bank','开户银行及支行','text','maxlength="120"')+field('number','银行卡号','text','inputmode="numeric" autocomplete="off" maxlength="32"')+'<label class="cw-check"><input type="checkbox" required><span>我已阅读<a href="/cw-terms.html#privacy" target="_blank" rel="noopener">资料处理说明</a>，单独同意为佣金结算处理本人银行卡信息。</span></label>','提交核验')+go('profile','返回资料');return;}
    if(tab==='invites'){c.innerHTML='<h2>邀请伙伴</h2><p>伙伴独立申请与签约，邀请关系不产生佣金。</p>'+`<button data-copy="${esc(location.origin+'/promotion/vip.html?invite='+p.public_code)}">复制邀请链接</button>`+personalList(['伙伴编号','加入时间','状态'],(data.invited||[]).map(i=>`<tr><td>${esc(i.public_code)}</td><td>${when(i.created_at)}</td><td>${esc(labels[i.status])}</td></tr>`));}
  }

  async function draw() {
    if (!data) return;
    const version = ++viewVersion;
    if(compactVIP)return drawPersonalVIP($('#cw-content'),version);
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
      const referralField = referrer
        ? `<input type="hidden" name="invite" value="${esc(referrer)}">`
        : `<details class="cw-referrer"><summary>填写邀请人的 VIP 编号（选填）</summary>${field('invite', '邀请人的 VIP 编号', 'text', 'maxlength="8" autocomplete="off"', false)}</details>`;
      const fields =
        field('legal_name', '真实姓名', 'text', 'maxlength="60" autocomplete="name"') +
        field('contact', '联系电话或其他联系方式', 'text', 'maxlength="160"') +
        field('invite_code', '员工提供的 VIP 客户邀请码', 'text',
          `maxlength="32" autocomplete="off" autocapitalize="characters" value="${esc(employeeInviteCode)}"`) +
        referralField +
        '<label class="cw-check"><input type="checkbox" name="consent" required><span>我已阅读<a href="/cw-terms.html#privacy" target="_blank" rel="noopener">资料处理说明</a>，同意处理申请资料。</span></label>';
      c.innerHTML = form('apply', fields, '提交申请');
      return;
    }
    const p = data.partner,
      t = data.totals;
    if (p.status !== 'active') {
      const current=data.task_codes?.[0],progress=data.activation_progress;
      c.innerHTML=applicationProgress(data)+
        (p.status==='confirmed' ? `<section class="cw-payment-step"><h3>充值与开通</h3>
          <p>累计有效实付 <strong>${money(progress?.total_fen)}</strong> / ¥100.00${progress?.eligible?' · 已达标':` · 还差 ${money(progress?.shortfall_fen)}`}。</p>
          ${progress?.eligible?'<p>等待负责员工核验开通，无需再次付款。</p>':current?paymentCard(current):'<p>付款码尚未发放，请等待负责员工处理。已有充值会计入核验，无需重复支付。</p>'}
          <details><summary>充值及退款规则</summary><p>可分多次充值；赠送、已退款金额不计入，处理中退款核实后再计算。开通后首次 ¥100 实付作为激活款，不支持自助退款，仍可消费。特殊诉求请提交工单。</p></details></section>`:'')+
        `<details><summary>申请资料</summary><p>姓名：${esc(p.legal_name)}<br>VIP 编号：${esc(p.public_code)}<br>提交时间：${when(p.created_at)}</p></details>
         <div class="cw-inline"><button data-refresh-status>刷新进度</button><a href="/#support">联系支持</a><span class="cw-muted" id="cw-sync-status" role="status">页面每 15 秒自动检查进度</span></div>`;
      return;
    }
    const taskCodes = data.task_codes || [];
    if (tab === 'overview')
      c.innerHTML = applicationProgress(data)+`<h2>${esc(p.legal_name)} <span class="cw-status">${labels[p.status]}</span></h2><p>VIP 编号：<strong>${esc(p.public_code)}</strong></p><div class="cw-metrics">${stat('客户实付', t.paid_fen)}${stat('客户实用', t.used_fen)}${stat('预计总佣金（税前）', t.expected_fen)}${stat('已解锁佣金（税前）', t.unlocked_fen)}${stat('可提现（税前）', t.available_fen)}</div><p>预计佣金包含已解锁部分，不代表全部可提现。客户退款会取消未使用部分的预计佣金。已解锁佣金需待客户月结与收款对账确认后方可申请提现。</p><p>提成 = 卖出折扣 − 4 折。以 5 折卖出提成 10%、8 折卖出提成 40%，多卖多得。</p><h3>我的 VIP 付款码</h3>${taskCodes.length ? paymentCard(taskCodes[0]) : '<p>暂无付款码，请联系负责销售。</p>'}`;
    if (tab === 'codes') {
      const contractVerified = hasCurrentContract(data.contracts);
      const trialActive = hasPromotionTrial(p);
      const eligible = contractVerified || trialActive;
      c.innerHTML = `<h2>我的推广码 <small>${data.codes.length} / 50</small></h2>
        ${eligible ? '<p>生成后即生效。客户价格最低五折。</p>' : '<p>请联系负责销售完成合同与实名核验，核验后即可生成推广码。</p>'}
        ${trialActive && !contractVerified ? `<p>推广试用至 ${when(p.promotion_trial_until)}。</p>` : ''}
        ${table(['名称／推广码', '状态／客户价格', '你的提成', '客户实付', '客户实用', '预计／已解锁／可提现', '推广'], data.codes.map((k) => {
          const status = promotionStatus(k, true, contractVerified, trialActive);
          return `<tr><td>${esc(k.name)}${k.is_self_code ? '<small class="cw-self">专属自购码</small>' : ''}<small>${esc(k.code)}</small></td>
            <td>${status}<small>客户价 ${k.customer_price_percent}%</small></td><td>${k.is_self_code ? '自购无提成' : (k.customer_price_percent - 40) + '%'}</td>
            <td>${money(k.paid_fen)}</td><td>${money(k.used_fen)}</td><td>${money(k.expected_fen)} / ${money(k.unlocked_fen)} / ${money(k.available_fen)}</td>
            <td>${status === '已生效' ? `<button data-copy="${esc(location.origin + payLink(k.code))}">复制推广链接</button><details><summary>推广二维码</summary><img class="cw-qr" src="/api/cw/codes/${k.id}/qr" alt="推广码 ${esc(k.code)} 的二维码" loading="lazy"></details>` : '—'}</td></tr>`;
        }).join(''))}
        ${eligible && data.codes.length < 50 ? `<details><summary>生成推广码</summary>${form('code',
          field('name', '推广码名称', 'text', 'maxlength="60"') +
          field('customer_price_percent', '客户价格比例（50 表示五折）', 'number', 'min="50" max="100" value="50"'),
          '生成并启用')}</details>` : ''}`;
    }
    if (tab === 'events') {
      const events = await api(base + '/events?offset=' + offset + (filter ? '&code_id=' + filter : ''));
      if (version !== viewVersion) return;
      c.innerHTML = `<h2>付费与使用明细</h2><p>充值实付形成预计佣金，实际使用解锁其中一部分；两者不重复计佣。</p><div class="cw-inline"><label>推广码<select id="event-code"><option value="">全部</option>${data.codes.map((k) => `<option value="${k.id}" ${filter === k.id ? 'selected' : ''}>${esc(k.name)} · ${k.code}</option>`).join('')}</select></label></div>${table(['时间', '推广码', '事件', '匿名成交编号', '实付／实用金额', '预计／解锁变化'], events.events.map((e) => `<tr><td>${when(e.occurred_at)}</td><td>${e.code}</td><td>${e.kind === 'paid' ? '充值实付' : labels[e.kind]}</td><td>${esc(e.public_reference)}</td><td>${money(e.cash_fen)}</td><td>${money(e.commission_fen)}</td></tr>`).join(''))}<div class="cw-inline"><button data-page="-1" ${offset === 0 ? 'disabled' : ''}>上一页</button><span>第 ${offset / 50 + 1} 页</span><button data-page="1" ${!events.has_more ? 'disabled' : ''}>下一页</button></div>`;
    }
    if (tab === 'payouts')
      c.innerHTML = `<h2>佣金与提现</h2><div class="cw-metrics">${stat('已解锁（累计，税前）', t.unlocked_fen)}${stat('当前可提现（税前）', t.available_fen)}</div><p>自然月结束后，公司完成客户账单核对和结算确认，再释放可提现金额。提现审核时确认适用的代扣税额，税后金额以结算单为准。</p><p>收款银行卡：${p.bank_last4 ? '尾号 ' + p.bank_last4 : '未填写'} · ${p.bank_verified ? '已核验' : '待核验'}</p><button data-withdraw ${!p.bank_verified || Number(t.available_fen) <= 0 ? 'disabled' : ''}>申请提现全部可提现佣金</button>${table(['申请时间', '税前佣金', '代扣税额', '税后金额', '状态', '到账时间'], data.payouts.map((r) => `<tr><td>${when(r.created_at)}</td><td>${money(r.gross_fen)}</td><td>${money(r.withholding_fen)}</td><td>${r.status === 'requested' ? '审核后确定' : money(Number(r.gross_fen) - Number(r.withholding_fen))}</td><td>${labels[r.status]}</td><td>${when(r.paid_at)}</td></tr>`).join(''))}`;
    if (tab === 'profile')
      c.innerHTML = `<h2>合同与资料</h2><p>合作状态：${labels[p.status]}。<a href="/cw-terms.html" target="_blank" rel="noopener">查看推广合作协议草案</a>。由公司提供正式合同。签署及实名核验结果登记在下方。</p>${table(['合同版本', '核验时间', '有效期'], data.contracts.map((k) => `<tr><td>${esc(k.template_version)}</td><td>${when(k.verified_at)}</td><td>${when(k.expires_at)}</td></tr>`).join(''))}<details><summary>填写／更换本人收款银行卡</summary>${form('bank', field('holder', '本人姓名', 'text', `value="${esc(p.legal_name)}" maxlength="60"`) + field('bank', '开户银行及支行', 'text', 'maxlength="120"') + field('number', '银行卡号', 'text', 'inputmode="numeric" autocomplete="off" maxlength="32"') + `<label class="cw-check"><input type="checkbox" required>我已阅读<a href="/cw-terms.html#privacy" target="_blank" rel="noopener">资料处理说明</a>，单独同意为佣金结算处理本人银行卡信息。</label>`, '提交收款账户核验')}</details>`;
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
  function rechargeTable(orders) {
    return table(['商户订单号／渠道', '充值类型', '实付／到账额度', '退款（含处理中）', '状态', '下单／入账时间'], orders.map((o) => {
      const channel = o.provider === 'wechat_native' ? '微信支付' : '支付宝';
      const status = o.credited_at ? '已到账' : o.status === 'paid' ? '已支付，待核对入账' : o.status === 'pending' ? '待支付' : '已关闭';
      return `<tr><td><strong>${esc(o.out_trade_no)}</strong><small>${channel}</small></td>
        <td>${o.vip_payment ? 'VIP 付款码' : '普通充值'}${o.promo_code ? '<small>' + esc(o.promo_code) + '</small>' : ''}</td>
        <td>${money(o.amount_fen)} / ${money(o.face_fen)}</td>
        <td>${Number(o.refunded_fen) > 0 ? money(o.refunded_fen) : '—'}</td>
        <td>${status}</td><td>${when(o.created_at)}${o.credited_at ? '<small>入账 ' + when(o.credited_at) + '</small>' : ''}</td></tr>`;
    }).join(''));
  }
  function rechargeHistory(d) {
    const orders = d.recharges || [];
    const matched = orderLookup?.partner_id === d.partner.id ? orders.find((o) => o.id === orderLookup.id) : null;
    const rows = matched ? [matched, ...orders.filter((o) => o.id !== matched.id)] : orders;
    return `<section class="cw-sales-section cw-recharge-history" aria-labelledby="vip-recharge-history">
      <h3 id="vip-recharge-history" tabindex="-1">充值记录</h3>
      ${matched ? `<p class="cw-callout">已定位原单 ${esc(matched.out_trade_no)}，显示在第一行。</p>` : ''}
      ${rows.length ? rechargeTable(rows) : '<p class="cw-muted">该客户暂无在线充值订单。</p>'}
    </section>`;
  }
  function drawSalesList(c) {
    const stageOptions = [
      ['', '全部状态'], ['due', '到期需跟进'], ['activation-exception', '原单开通待特批'], ['discount', '付款折扣待特批'], ['pending', '待电话面试'],
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
      if(salesFilter.owner && p.owner_subject!==salesFilter.owner)return false;
      if (stage === 'due' && !(p.next_contact_on && p.next_contact_on <= today)) return false;
      if (stage === 'unassigned' && p.owner_subject) return false;
      if (stage === 'discount' && !p.discount_pending) return false;
      if (stage === 'activation-exception' && !p.activation_exception_pending) return false;
      if (stage && !['due', 'unassigned', 'discount', 'activation-exception', 'finance'].includes(stage) && p.status !== stage) return false;
      return !query || [p.legal_name, p.public_code, p.invite_code, p.email, p.owner_name]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
    c.innerHTML = `<h2>${stage === 'finance' ? '财务结算客户' : data.administrator ? '全部 VIP 客户' : '我的 VIP 客户'}</h2>
      <form class="cw-order-lookup" data-action="order-lookup">
        ${field('out_trade_no', '商户订单号', 'search', `value="${esc(orderLookup?.out_trade_no || '')}" maxlength="64"`)}
        <button type="submit">按订单查客户</button>
      </form>
      ${data.administrator && orderLookup && !orderLookup.partner_id ? `<section aria-labelledby="vip-order-result">
        <h3 id="vip-order-result" tabindex="-1">订单归属 · ${esc(orderLookup.account_name)}</h3>
        <p>${orderLookup.account_kind === 'organization' ? '企业账户' : '个人账户'} · 未关联 VIP 申请</p>
        ${rechargeTable([orderLookup])}
      </section>` : ''}
      <form class="cw-sales-filters" data-action="sales-filter">
        ${data.administrator?`<label>负责销售<select name="owner"><option value="">全部员工</option>${(data.owners||[]).map(o=>`<option value="${esc(o.subject)}" ${salesFilter.owner===o.subject?'selected':''}>${esc(o.name)}</option>`).join('')}</select></label>`:''}
        ${field('query', '搜索客户或邀请码', 'search', `value="${esc(salesFilter.query)}" maxlength="120"`, false)}
        <label>状态<select name="stage">${stageOptions.map(([value, label]) => `<option value="${value}"${value === stage ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <button type="submit">筛选</button>
      </form>
      ${partners.length ? '<div class="cw-sales-table">' + table(['客户／VIP 编号', '来源邀请码', '负责销售', '申请状态', '下次联系'], partners.map((p) => `<tr>
        <td><button class="cw-lead-link" data-partner="${esc(p.id)}" aria-label="打开 ${esc(p.legal_name)} 的档案">${esc(p.legal_name)}</button><small>${esc(p.public_code)}${p.email ? ' · ' + esc(p.email) : ''}</small></td>
        <td>${esc(p.invite_code || '—')}</td><td>${esc(p.owner_name || '待分配')}</td>
        <td>${esc(labels[p.status] || p.status)}${p.activation_exception_pending ? '<small class="cw-status">原单开通待特批</small>' : ''}
          ${p.discount_pending ? '<small class="cw-status">付款折扣待特批</small>' : ''}</td>
        <td>${p.next_contact_on ? `<time datetime="${esc(p.next_contact_on)}">${esc(p.next_contact_on)}</time>` : '—'}</td>
      </tr>`).join('')) + '</div>' : `<p class="cw-muted">${query || stage || salesPartners.length ? '暂无符合条件的 VIP 客户。' : '已有邀请码带来的申请会显示在这里。'}</p>`}`;
  }
  function drawInviteCodes(c) {
    c.innerHTML = `<h2>${data.administrator ? 'VIP 客户邀请码' : '我发出的邀请码'}</h2>
      <p>复制申请链接发给客户。链接会自动填入邀请码，客户提交后会进入发码人的跟进列表。</p>
      <details><summary>生成邀请码</summary>${form('invite-code',
        field('code', '邀请码', 'text', 'maxlength="32" autocomplete="off" autocapitalize="characters"') +
        field('max_uses', '使用次数上限', 'number', 'min="1" max="100000" value="1"') +
        field('note', '备注', 'text', 'maxlength="200"', false), '生成邀请码')}</details>
      ${table(['邀请码', '使用次数', '状态', '备注', '创建人／时间', '操作'], (data.invite_codes || []).map((v) => `<tr>
        <td><strong>${esc(v.code)}</strong></td><td>${v.used_count} / ${v.max_uses}</td>
        <td>${v.status === 'active' ? '生效中' : '已停用'}</td><td>${esc(v.note || '—')}</td>
        <td>${esc(v.creator_name || v.created_by)}<small>${when(v.created_at)}</small></td>
        <td><div class="cw-row-actions">
          ${v.status === 'active' && v.used_count < v.max_uses
            ? `<button data-copy="${esc(location.origin + '/promotion/vip.html?' + new URLSearchParams({ invite_code: v.code }))}" data-copy-label="申请链接">复制申请链接</button>`
            : ''}
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
  function activationExceptions(d) {
    const p = d.partner;
    const requests = d.activation_exceptions || [];
    const pending = requests.find((r) => r.status === 'pending');
    const history = requests.filter((r) => r.status !== 'pending');
    if (p.status !== 'confirmed' && !requests.length) return '';
    const orderNumber = orderLookup?.partner_id === p.id ? orderLookup.out_trade_no : '';
    const refundBlocked = pending?.refund || Number(pending?.refunded_fen) > 0;
    const credited = pending?.order_status === 'paid' && pending?.credited_at;
    const eligible = p.status === 'confirmed' && credited && !refundBlocked;
    return `<section class="cw-sales-section" aria-labelledby="vip-order-exceptions">
      <h3 id="vip-order-exceptions">原单特批开通</h3>
      ${pending ? `<p><strong>待管理员审批</strong> · ${esc(pending.out_trade_no)} · 实付 ${money(pending.amount_fen)}</p>
        <p>申请原因：${esc(pending.request_reason)}</p>
        <p class="cw-muted">${esc(pending.requested_by_name)} · ${when(pending.created_at)} ·
          ${credited ? '已到账 ' + when(pending.credited_at) : '待核对入账'} · ${refundBlocked ? '已退款或退款处理中' : '无退款记录'}</p>
        ${data.administrator ? `<form class="cw-form" data-action="activation-exception-decision">
          <input type="hidden" name="request_id" value="${esc(pending.id)}">
          <label>审批原因<textarea name="reason" maxlength="500" rows="3" required></textarea></label>
          <div class="cw-inline">
            <button type="submit" name="decision" value="approved"${eligible ? '' : ' disabled'}>批准并开通 VIP</button>
            <button type="submit" name="decision" value="rejected">退回特批</button>
          </div>
        </form>` : ''}`
        : p.status === 'confirmed' ? `<details><summary>提交原单特批</summary>
          <p>填写本客户已到账、未退款的商户订单号。审批通过后，客户可凭原付款开通。</p>
          ${form('activation-exception', field('out_trade_no', '特批商户订单号', 'text', `maxlength="64" value="${esc(orderNumber)}"`) +
            '<label>申请原因<textarea name="reason" maxlength="500" rows="3" required></textarea></label>', '提交原单特批')}</details>` : ''}
      ${history.length ? table(['原单／实付', '申请人／原因', '结果', '审批人／时间', '审批原因'], history.map((r) =>
        `<tr><td>${esc(r.out_trade_no)}<small>${money(r.amount_fen)}</small></td>
          <td>${r.source_audit_id ? '历史运维特批' : esc(r.requested_by_name) + '<small>' + esc(r.request_reason) + '</small>'}</td>
          <td>${r.status === 'approved' ? '已批准' : '已退回'}</td>
          <td>${r.source_audit_id ? '历史审计 #' + esc(r.source_audit_id) : esc(r.decided_by_name)}<small>${when(r.decided_at)}</small></td>
          <td>${esc(r.decision_reason)}</td></tr>`).join('')) : ''}
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
      ${d.activation_progress?`<p>累计有效实付 ${money(d.activation_progress.total_fen)} · 距 ¥100 还差 ${money(d.activation_progress.shortfall_fen)}。激活款不支持自助退款，可继续消费。</p>`:''}
      ${p.status === 'confirmed' ? `<button class="cw-primary" data-activate="${p.id}"${d.can_activate ? '' : ' disabled'}>${d.can_activate ? '确认正式 VIP' : '待累计实付满 ¥' + ((d.activate_min_cash_fen || 10000) / 100).toFixed(0)}</button>` : ''}
    </section>`;
  }
  function applicationProgress(d, employee=false) {
    const p=d.partner,paid=d.activation_progress?.eligible;
    const usable=(d.task_codes||[]).some(k=>employee?k.usable:true);
    const stopped=['rejected','suspended'].includes(p.status);
    const index=p.status==='pending'?1:p.status==='confirmed'?(paid?3:2):p.status==='active'?4:-1;
    const title=p.status==='pending'?'申请已提交，等待电话面试':p.status==='confirmed'?(paid?'充值已达标，等待核验开通':usable?'面试已通过，可以充值':'面试已通过，等待发放付款码'):p.status==='active'?'VIP 已开通':labels[p.status];
    const next=p.status==='pending'?(employee?'请查看联系方式，联系申请人完成电话面试，再确认面试结果。':'负责员工会联系你进行电话面试，请保持电话畅通。当前无需付款。'):
      p.status==='confirmed'?(paid?(employee?'请核对到账记录，确认后开通正式 VIP。':'由负责员工核对到账记录并开通 VIP，你无需再次付款。'):
      usable?(employee?'等待客户累计有效实付满 ¥100；已有付款请先核对原单。':'使用下方专属付款码充值，累计有效实付满 ¥100 后由员工核验开通。'):
      employee?'请发放默认 5 折付款码，客户可在申请页查看并充值。':'负责员工正在处理付款码，发放后会显示在此处。'):
      p.status==='active'?'正式 VIP 身份已生效。':'如需了解原因或后续安排，请联系负责员工或提交工单。';
    const steps=['提交申请','电话面试','账户充值','核验开通','正式 VIP'];
    const dates=[p.created_at,p.confirmed_at,null,null,p.activated_at];
    return `<section class="cw-progress" aria-label="VIP 申请流程"><h2>${esc(title)}</h2>
      <ol class="cw-steps">${steps.map((label,i)=>`<li${!stopped&&i===index?' aria-current="step"':''} class="${!stopped&&(i<index||p.status==='active')?'is-done':''}"><strong>${i+1}. ${label}</strong><small>${stopped?'流程已停止':i<index||p.status==='active'?'已完成':i===index?'当前阶段':'待完成'}</small>${dates[i]?`<time>${when(dates[i])}</time>`:''}</li>`).join('')}</ol>
      <p class="cw-next"><strong>${stopped?'后续处理':'下一步'}：</strong>${esc(next)}</p>
      ${d.feedback?`<p><strong>处理反馈：</strong>${esc(d.feedback)}</p>`:''}
      <p class="cw-muted">负责员工：${esc(d.owner_name||p.owner_name||'待管理员分配')}${!stopped&&index<4?' · 当前由'+(index===2&&usable&&!paid?'申请人':'公司')+'处理':''}</p></section>`;
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
    c.innerHTML = `<button data-tab="overview">返回客户列表</button><h2 class="cw-partner-title">${esc(p.legal_name)} · ${esc(p.public_code)}</h2><p>申请状态：${esc(labels[p.status])}${d.finance && p.status==='active' ? ' · 可提现（税前）' + money(d.available_fen) : ''}</p>`;
    if (tab === 'manage') {
      const verified=d.contract_current??hasCurrentContract(d.contracts);
      const trial=hasPromotionTrial(p);
      if(p.status==='active'||p.status==='suspended') c.innerHTML+=`<div class="cw-callout"><p>VIP 身份：${esc(labels[p.status])}</p><p>合同与实名核验：${verified?'已完成且有效':'尚未完成或已过期'}</p><p>推广资格：${p.status!=='active'?'待正式开通 VIP':verified?'已具备，可自行生成推广码':trial?'单独试用中，至 '+when(p.promotion_trial_until):'待合同与实名核验'}</p></div>`;
      if (d.can_follow) {
        c.innerHTML += applicationProgress(d,true);
        const contact = `<div class="cw-contact-box"><p><b>申请人联系方式</b></p><div id="contact-details" aria-live="polite"><p class="cw-muted">查看操作会记入审计。</p></div>${form('contact', field('reason', '查看原因', 'text', p.status === 'pending' ? 'value="电话面试" maxlength="200"' : 'maxlength="200"'), '查看联系方式')}</div>`;
        c.innerHTML += `${p.status==='pending'?contact:`<details><summary>申请人联系方式</summary>${contact}</details>`}
          ${p.status === 'pending' ? `<button class="cw-primary" data-confirm="${p.id}">确认面试通过</button>` : ''}
          ${data.administrator&&p.status==='pending'?`<details><summary>申请未通过</summary>${form('reject',field('reason','未通过原因（申请人可见）','text','maxlength="300"'),'确认申请未通过')}</details>`:''}
          ${staffPaymentCodes(d)}${p.status==='confirmed'?rechargeHistory(d):''}
          <details><summary>特殊审批与原单处理</summary>${activationExceptions(d)}</details>${salesFollowups(d)}`;
      }
      const trialActive = hasPromotionTrial(p);
      const contractVerified = hasCurrentContract(d.contracts);
      if (data.administrator && p.status === 'active') c.innerHTML += `<details class="cw-sales-section">
        <summary>推广码试用${trialActive ? ' · 试用中' : ''}</summary>
        <p>${trialActive ? '试用至 ' + when(p.promotion_trial_until) + '。' : '开通后，此 VIP 可在 7 天内生成并使用客户推广码。'}</p>
        ${form('promotion-trial', `<input type="hidden" name="enabled" value="${!trialActive}">` +
          field('reason', trialActive ? '撤回原因' : '试用原因', 'text', 'maxlength="300"'),
          trialActive ? '撤回试用' : '开通 7 天试用')}
        </details>`;
      if (d.finance) c.innerHTML += `<details${p.status==='active'?' open':''}><summary>推广、合同与财务资料</summary><h3>推广码</h3>${table(['推广码／名称', '客户价格', '提成', '有效期', '状态', '实付／实用', '预计／解锁佣金', '操作'], d.codes.map((k) => `<tr><td>${k.code}${k.is_self_code ? '<small>专属自购码</small>' : ''}<small>${esc(k.name)}</small></td><td>${k.customer_price_percent}%</td><td>${k.is_self_code ? '无' : (k.customer_price_percent - 40) + '%'}</td><td>${when(k.starts_at)} 至 ${when(k.ends_at)}</td><td>${promotionStatus(k, p.status === 'active', contractVerified, trialActive)}</td><td>${money(k.paid_fen)} / ${money(k.used_fen)}</td><td>${money(k.expected_fen)} / ${money(k.unlocked_fen)}</td><td>${k.is_self_code ? '' : `<button data-code-review="${k.id}">设置／停用</button>`}</td></tr>`).join(''))}<div id="code-editor"></div><h3>签约记录</h3>${table(['合同版本', '文件摘要', '核验人／时间', '有效期'], d.contracts.map((k) => `<tr><td>${esc(k.template_version)}</td><td>${esc(k.document_sha256)}</td><td>${esc(k.verified_by)}<small>${when(k.verified_at)}</small></td><td>${when(k.expires_at)}</td></tr>`).join(''))}<details><summary>合同与身份核验（管理员）</summary><p>请核验真实签约服务凭证，不能把提交申请视为已签约。</p>${form('contract', field('template_version', '正式合同版本') + field('document_sha256', '已签署文件 SHA-256', 'text', 'pattern="[a-f0-9]{64}"') + field('signature_reference', '签约服务商及凭证编号') + field('identity_reference', '实名核验服务及凭证编号') + field('expires_at', '合同截止时间', 'datetime-local') + `<label class="cw-check"><input type="checkbox" required>已核验双方签署证据和合作人身份</label>`, '登记签署证据')}</details><details><summary>收款账户（财务）</summary>${form('bank-details', field('reason', '查看原因', 'text', 'maxlength="200"'), '查看收款资料')}<div id="private-details" aria-live="polite"></div>${form('bank-verify', field('bank_version', '已核验银行卡版本', 'number', 'min="1"') + field('evidence', '本人账户核验凭证编号'), '确认核验（财务）')}</details><details><summary>暂停合作</summary>${form('suspend', field('reason', '暂停原因（申请人可见）'), '暂停新推广与提现')}</details></details>`;
    }
    if (tab === 'settlement' && d.finance)
      c.innerHTML += `<h3>客户付款订单</h3><p class="cw-muted">最近 200 笔成交</p>${table(['客户／付款订单', '推广码', '付款时间', '客户实付／实用', '预计／解锁佣金', '客户计费账户'], d.orders.map((o) => `<tr><td>${esc(o.customer_email)}<small>${esc(o.out_trade_no)}</small></td><td>${o.code}</td><td>${when(o.paid_at)}</td><td>${money(o.cash_fen)} / ${money(o.used_cash_fen)}</td><td>${money(o.expected_fen)} / ${money(o.unlocked_fen)}</td><td>${o.account_id}${o.channel_fee_issue ? '<small>' + esc(o.channel_fee_issue) + '</small>' : ''}</td></tr>`).join(''))}<h3>付款与使用明细</h3>${table(['时间', '码／付款订单', '事件', '实付／实用', '预计／解锁变化'], d.events.map((e) => `<tr><td>${when(e.occurred_at)}</td><td>${e.code}<small>${esc(e.out_trade_no)}</small></td><td>${e.kind === 'paid' ? '充值实付' : labels[e.kind]}</td><td>${money(e.cash_fen)}</td><td>${money(e.commission_fen)}</td></tr>`).join(''))}<details><summary>确认客户月结（财务）</summary><p>自然月已结束、调用结算与支付账单核对完成，并已与客户完成结算，才可确认。</p>${form('close', `<label>客户计费账户<select name="account_id" required><option value="">请选择客户账户</option>${[...new Map(d.orders.map((o) => [o.account_id, o])).values()].map((o) => `<option value="${o.account_id}">${esc(o.customer_email)} · ${o.account_id}</option>`).join('')}</select></label>` + field('month', '结算月份', 'month') + field('evidence', '客户结算单／确认凭证编号'), '确认客户月结')}${table(['已结月份', '客户账户', '结算凭证', '确认时间'], d.closes.map((x) => `<tr><td>${x.month}</td><td>${x.account_id}</td><td>${esc(x.evidence)}</td><td>${when(x.closed_at)}</td></tr>`).join(''))}</details><h3>提现申请与付款结果</h3>${table(['申请时间', '税前／代扣税', '状态', '银行卡', '操作'], d.payouts.map((r) => `<tr><td>${when(r.created_at)}</td><td>${money(r.gross_fen)} / ${money(r.withholding_fen)}</td><td>${labels[r.status]}</td><td>尾号 ${r.bank_last4}</td><td>${r.status === 'requested' ? `<button data-payout-review="${r.id}">审核</button>` : r.status === 'approved' ? `<button data-payout-complete="${r.id}">付款与结果确认</button>` : ''}</td></tr>`).join(''))}<div id="payout-editor"></div>`;
  }
  document.addEventListener('click', async (e) => {
    const guideLink=e.target.closest('[data-vip-guide]');
    if(compactVIP&&guideLink&&guideLink.dataset.vipGuide!=='external'){e.preventDefault();tab=guideLink.dataset.vipGuide;personalPage=0;await draw();return;}
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if(compactVIP&&b.hasAttribute('data-vip-page')){personalPage=Number(b.dataset.vipPage);await draw();return;}
      if (b.dataset.tab) {
        personalPage=0;
        tab = b.dataset.tab;
        if (staff && ['overview','invite-codes'].includes(tab)) {
          setSelected(null);
          orderLookup = null;
        }
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
        if(compactVIP)tab='payouts';
        await load();
      } else if (b.dataset.page) {
        personalPage=0;
        offset = Math.max(0, offset + Number(b.dataset.page) * 50);
        await draw();
      } else if (b.dataset.codeReview) {
        const k = data.detail.codes.find((k) => k.id === b.dataset.codeReview);
        $('#code-editor').innerHTML = form(
          'code-review',
          `<input name="code_id" type="hidden" value="${k.id}"><h3>推广码设置 · ${k.code}</h3><label>状态<select name="status"><option value="active">启用</option><option value="paused">暂停</option><option value="rejected">拒绝</option></select></label>` +
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
      $('#cw-message').dataset.error='true';
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
        $('#cw-message').dataset.error='true';
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
      if (action === 'order-lookup') {
        const result = await api(base + '/order-lookup?out_trade_no=' + encodeURIComponent(b.out_trade_no.trim()));
        if (!f.isConnected) return;
        orderLookup = result.order;
        if (orderLookup.partner_id) {
          setSelected(orderLookup.partner_id);
          tab = 'manage';
          await load();
          $('#vip-recharge-history')?.focus();
        } else {
          drawSalesList($('#cw-content'));
          $('#vip-order-result')?.focus();
        }
        return;
      }
      if (action === 'sales-filter') {
        salesFilter = { query: b.query.trim(), stage: b.stage, owner:b.owner||'' };
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
      if(action==='vip-sign-request'){
        path='/api/cw/signing/request';body={consent:b.consent==='on',template_version:b.template_version,phone:b.phone};
      }
      if(action==='vip-sign-open'){
        const result=await api('/api/cw/signing/'+encodeURIComponent(b.signing_id)+'/open',{});
        const target=new URL(result.url);if(target.protocol!=='https:')throw Error('签署链接无效，请刷新后重试。');
        window.top.location.assign(target.href);return;
      }
      if (action === 'promotion-trial') {
        path = base + '/' + selected + '/promotion-trial';
        body = { enabled: b.enabled === 'true', reason: b.reason };
      }
      if (action === 'contract') {
        path = base + '/' + selected + '/contract';
        body = { ...b, verified: true, expires_at: new Date(b.expires_at).toISOString() };
      }
      if (action === 'task-code') {
        path = base + '/' + selected + '/task-code';
      }
      if (action === 'activation-exception') {
        path = base + '/' + selected + '/activation-exceptions';
      }
      if (action === 'activation-exception-decision') {
        path = base + '/' + selected + '/activation-exceptions/' + encodeURIComponent(b.request_id) + '/decision';
        body = { status: submit.value, reason: b.reason };
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
      if (action === 'suspend' || action === 'reject') {
        path = base + '/' + selected + '/status';
        body = { ...b, status: action==='reject'?'rejected':'suspended', customer_feedback:b.reason };
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
      if(compactVIP&&action==='vip-sign-request')tab='contracts';
      if(compactVIP&&action==='apply')tab='overview';
      if(compactVIP&&action==='code'){tab='codes';personalPage=0;}
      if(compactVIP&&action==='bank')tab='profile';
      await load();
      $('#cw-message').textContent = action === 'activation-exception' ? '原单特批已提交，等待管理员审批。'
        : action === 'activation-exception-decision' ? (submit.value === 'approved' ? '已按原单特批开通 VIP。' : '原单特批已退回。')
        : action === 'promotion-trial' ? (body.enabled ? '已开通 7 天推广试用。' : '推广试用已撤回。')
        : action === 'reject' ? '申请已标记为未通过，原因已反馈给申请人。'
        : action === 'vip-sign-request' ? '签约申请已提交，请在合同页查看进度。'
        : action === 'code' ? '推广码已生成并生效，可以复制推广链接。'
        : '已保存。';
    } catch (err) {
      $('#cw-message').dataset.error='true';
      $('#cw-message').textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });
  let checking=false;
  async function checkProgress(){
    if(staff||!data?.partner||data.partner.status==='active'||document.hidden||checking||$('#cw-content').inert)return;
    checking=true;
    try{
      const version=loadVersion,result=await api('/api/cw/me');
      if(version!==loadVersion)return;
      if(JSON.stringify(result)!==JSON.stringify(data)){data=result;await draw();}
      const status=$('#cw-sync-status');if(status)status.textContent='进度已同步 · 每 15 秒自动检查';
    }catch{const status=$('#cw-sync-status');if(status)status.textContent='暂时无法同步，请点击刷新进度重试';}
    finally{checking=false;}
  }
  setInterval(checkProgress,15000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkProgress();});
  if(document.documentElement.classList.contains('cw-embedded')){
    let lastHeight=0;
    new ResizeObserver(()=>{const height=Math.ceil(document.querySelector('.cw-app').getBoundingClientRect().height);if(height!==lastHeight){lastHeight=height;parent.postMessage({type:'vip-content-height',height},location.origin);}}).observe(document.querySelector('.cw-app'));
  }
  load();
})();
