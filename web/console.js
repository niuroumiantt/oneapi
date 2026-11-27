/* Unified console at #console/<business|technical>/<section>: one fixed header, back offices load in frames below. Frames speak the protocol in server/private/workspace-bridge.js. */
(() => {
 'use strict';
 const known = {
  business: ['home','acquisition','direct','promotions','approvals','overview', 'pnl', 'payments', 'transfers', 'invoices', 'payables', 'suppliers', 'customers', 'upgrades', 'products', 'discounts', 'cw', 'tickets', 'answers'],
  technical: ['overview', 'keys', 'evalkeys', 'features', 'agents', 'agentcmp', 'matrix', 'supplier', 'suppliers', 'credentials', 'models', 'tests', 'transactions', 'compare', 'identity', 'stress', 'monitor', 'routing', 'handoff', 'releases', 'billing', 'upstream', 'servers', 'capacity', 'prices', 'catalog', 'market']
 };
 known.owner = [...known.business];
 known.business = ['apioverview','apimodels','apikeys','apiusage','apicompare','vipcodes','customeroverview','vipoverview','customerapplications','vipapplications','home','acquisition','direct','cw','customers','tickets','answers','approvals','promotions'];
 known.business.push('pending');
 const titles = { owner:'老板工作台', business: '员工工作台', technical: '技术后台' };
 const positions = { owner:'home', business: 'home', technical: 'overview' }, frames = {};
 let host = null, access = null, accessPromise = null, current = null, supplier = '', routeTicket = 0;
 const handles = view => view === 'console' || view.startsWith('console/');

 function shell() {
  if (host) return;
  host = document.createElement('div');
  host.id = 'console-view';
  host.hidden = true;
  host.innerHTML = `${window.SiteHeader.render('workspace',{className:'cs-top',account:'<a class="live-signin" href="#staff-account" data-staff-account hidden>账户与权限</a><button type="button" class="cs-signout" data-live="logout" data-session-kind="staff" hidden>退出登录</button>',tools:`<nav class="cs-tabs" role="tablist" aria-label="切换面板"><a href="#workspace" role="tab" aria-selected="false">个人与企业空间</a><a href="#console/business" data-console-tab="business" role="tab" aria-selected="false" hidden>员工工作台</a><a href="#console/owner" data-console-tab="owner" role="tab" aria-selected="false" hidden>老板工作台</a><a href="#console/technical" data-console-tab="technical" role="tab" aria-selected="false" hidden>技术后台</a></nav><a href="#staff-team" data-owner-team hidden>员工管理</a><span class="cs-live" role="status">正在验证员工权限…</span>`})}<main class="cs-panes"><div class="cs-message" role="status">正在打开后台…</div></main>${window.SiteHeader.footer()}`;
  document.body.append(host);
 }
 const panes = () => host.querySelector('.cs-panes'), message = () => host.querySelector('.cs-message'), live = text => { host.querySelector('.cs-live').textContent = text; };
 const hashFor = (workspace, section) => '#console/' + workspace + '/' + section + (workspace === 'technical' && supplier ? '?supplier=' + encodeURIComponent(supplier) : '');

 function loadAccess() {
  if (access) return Promise.resolve(access);
  if (accessPromise) return accessPromise;
  const request = fetch('/api/staff/workspace/access', { credentials: 'same-origin' }).then(async r => {
   if (!r.ok) { const e = new Error(r.status === 401 ? '员工登录已过期，请重新登录。' : '你的员工账户没有后台权限。'); e.status = r.status; throw e; }
   return r.json();
  }).then(a => { if (accessPromise===request) access = a; return a; })
   .finally(() => { if (accessPromise===request) accessPromise = null; });
  accessPromise = request;
  return request;
 }

 function denied(error, workspace, section) {
  current = null;
  for (const frame of Object.values(frames)) frame.hidden = true;
  for (const tab of host.querySelectorAll('[data-console-tab]')) tab.hidden = true;
  host.querySelector('[data-owner-team]').hidden = true;
  setAccountControls(Boolean(access?.business || access?.owner || access?.technical));
  const m = message();
  m.hidden = false;
  m.textContent = error.status === 401 ? '请使用公司身份登录。' : error.message;
  const query = new URLSearchParams({next:workspace==='business'?'employee':workspace});
  if (known[workspace].includes(section)) query.set('section',section);
  const actions = document.createElement('div');
  actions.className = 'cs-signin-actions';
  if (error.status === 401) {
   const a = document.createElement('a');
   a.href = '/api/staff/login?'+query;
   a.textContent = {owner:'老板登录',business:'员工登录',technical:'技术运维登录'}[workspace];
   actions.append(a);
  }
  query.set('relogin','1');
  const switchAccount = document.createElement('a');
  switchAccount.href = '/api/staff/login?'+query;
  switchAccount.textContent = '切换公司账号';
  actions.append(switchAccount);
  if (workspace === 'business' && error.status === 401) {
   const activate = document.createElement('a');
   activate.href = '#staff?next=employee';
   activate.textContent = '首次开通员工账号';
   actions.append(activate);
  }
  if (error.status===403 && workspace==='owner' && access?.business) {
   const employeeHome = document.createElement('a');
   employeeHome.href = '#console/business/home';
   employeeHome.textContent = '返回员工工作台';
   actions.append(employeeHome);
  }
  m.append(actions);
  live(error.status === 401 ? '未登录' : '无法进入当前工作台');
 }

 function setAccountControls(visible) {
  for(const control of host.querySelectorAll('[data-staff-account], .cs-signout')) control.hidden = !visible;
 }

 function show(workspace, section) {
  if (!access?.[workspace]) {
   const text = workspace==='owner' ? '老板工作台仅对老板账号开放。' : '当前公司账号没有此工作台的权限。';
   denied(Object.assign(new Error(text),{status:403}),workspace,section);
   return;
  }
  section = known[workspace].includes(section) ? section : positions[workspace];
  positions[workspace] = section;
  current = workspace;
  host.classList.toggle('technical', workspace === 'technical');
  host.classList.toggle('owner-workspace',workspace==='owner');
  host.querySelector('[data-owner-team]').hidden=workspace!=='owner';
  setAccountControls(true);
  for (const tab of host.querySelectorAll('[data-console-tab]')) {
   tab.hidden = !access[tab.dataset.consoleTab] || (workspace==='owner' && tab.dataset.consoleTab==='business');
   tab.setAttribute('aria-selected', String(tab.dataset.consoleTab === workspace));
   tab.href = '#console/' + tab.dataset.consoleTab + '/' + positions[tab.dataset.consoleTab];
  }
  if (!frames[workspace]) {
   const frame = document.createElement('iframe');
   frame.title = workspace === 'technical' ? '技术运维工作台' : workspace==='owner'?'老板工作台':'业务运营工作台';
   frame.src = '/api/staff/' + (workspace === 'technical' ? 'lab' : 'workspace') + '/view' + (workspace==='owner'?'?surface=owner':'') + (workspace === 'technical' && supplier ? '?supplier=' + encodeURIComponent(supplier) : '') + '#' + section;
   frame.addEventListener('load', () => {
    frame.dataset.loaded = 'true';
    if (current === workspace) message().hidden = true;
   });
   frames[workspace] = frame;
   panes().append(frame);
  }
  for (const [name, frame] of Object.entries(frames)) {
   frame.hidden = name !== workspace;
   if (name === workspace) frame.contentWindow?.postMessage({ type: 'workspace-navigate', section }, location.origin);
  }
  const loading = !frames[workspace].dataset.loaded;
  message().textContent = '正在打开' + titles[workspace] + '…';
  message().hidden = !loading;
  live(workspace==='owner' ? '老板身份' : workspace==='business' ? '员工工作空间' : '技术运维');
  document.title = 'semifly.ai · ' + titles[workspace];
  const target = hashFor(workspace, section);
  if (location.hash !== target) history.replaceState(null, '', location.pathname + location.search + target);
 }

 async function render(view) {
  shell();
  window.LandingUI?.hide();
  window.IdentityUI?.cancel?.();
  document.body.classList.remove('identity-active', 'market-active', 'welcome-active', 'universe-active', 'catalog-active');
  window.UniverseScene?.setActive(false);
  for (const id of ['identity-view', 'market-view', 'login-view']) { const el = document.getElementById(id); if (el) el.hidden = true; }
  document.body.classList.add('console-active');
  host.hidden = false;
  const [path, query = ''] = view.split('?');
  const [, requested = '', section = ''] = path.split('/');
  const workspace = Object.hasOwn(known, requested) ? requested : '';
  host.classList.toggle('owner-workspace',workspace==='owner');
  host.classList.toggle('technical',workspace==='technical');
  const ticket = ++routeTicket;
  const pick = new URLSearchParams(query).get('supplier');
  if (pick && /^[a-f0-9-]{36}$/.test(pick)) supplier = pick;
  try { await loadAccess(); } catch (e) {
   if (ticket===routeTicket) denied(e,workspace||'business',section);
   return;
  }
  if (ticket===routeTicket && !host.hidden) show(workspace || current || (access.owner?'owner':access.business?'business':'technical'), section);
 }

 function hide() {
  ++routeTicket;
  if (host) host.hidden = true;
  document.body.classList.remove('console-active');
 }

 addEventListener('message', e => {
  if (e.origin !== location.origin || !host) return;
  const workspace = Object.keys(frames).find(k => frames[k].contentWindow === e.source);
  if (!workspace) return;
  const m = e.data;
  if (m?.type === 'supplier-selected' && workspace === 'technical' && typeof m.id === 'string' && /^[a-f0-9-]{36}$/.test(m.id)) supplier = m.id;
  if (m?.type === 'workspace-switch' && known[m.workspace]) { location.hash = 'console/' + m.workspace + (m.section ? '/' + m.section : ''); return; }
  if (m?.type === 'workspace-position' && known[workspace].includes(m.section)) {
   positions[workspace] = m.section;
   const tab = host.querySelector(`[data-console-tab="${workspace}"]`);
   if (tab) tab.href = '#console/' + workspace + '/' + m.section;
   if (workspace === current && !host.hidden) history.replaceState(null, '', location.pathname + location.search + hashFor(workspace, m.section));
  }
  if (m?.type === 'lab-progress' && workspace === 'technical') live(String(m.text).slice(0, 100));
 });

 function clearAccess() {
  ++routeTicket;
  access = null;
  accessPromise = null;
  current = null;
  supplier = '';
  for (const [name, frame] of Object.entries(frames)) {
   frame.remove();
   delete frames[name];
  }
  Object.assign(positions,{owner:'home',business:'home',technical:'overview'});
 }

 window.ConsoleUI = { handles, render, hide, clearAccess };
})();
