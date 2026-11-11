/* Unified console at #console/<business|technical>/<section>: one fixed header, back offices load in frames below. Frames speak the protocol in server/private/workspace-bridge.js. */
(() => {
 'use strict';
 const known = {
  business: ['overview', 'upstream', 'products', 'customers', 'tickets', 'suppliers', 'finance'],
  technical: ['overview', 'keys', 'evalkeys', 'features', 'matrix', 'supplier', 'suppliers', 'credentials', 'models', 'tests', 'transactions', 'compare', 'stress', 'monitor', 'routing', 'handoff', 'releases', 'billing', 'upstream', 'servers']
 };
 const titles = { business: '商务后台', technical: '技术后台' };
 const positions = { business: 'overview', technical: 'overview' }, frames = {};
 let host = null, access = null, accessPromise = null, current = null, supplier = '';
 const handles = view => view === 'console' || view.startsWith('console/');

 function shell() {
  if (host) return;
  host = document.createElement('div');
  host.id = 'console-view';
  host.hidden = true;
  host.innerHTML = `<header class="cs-top"><a class="cs-brand welcome-brand pc-brand" href="#universe" aria-label="semifly.ai 首页"><img src="pinapi-wordmark.svg" alt="semifly.ai"></a><span class="cs-divider"></span><nav class="cs-tabs" role="tablist" aria-label="切换面板"><a href="#workspace" role="tab" aria-selected="false">企业管理工作台</a><a href="#console/business" data-console-tab="business" role="tab" aria-selected="false" hidden>商务后台</a><a href="#console/technical" data-console-tab="technical" role="tab" aria-selected="false" hidden>技术后台</a></nav><span class="cs-live" role="status">正在验证员工权限…</span><a class="cs-link" href="#docs">文档</a><a class="cs-link" href="#staff-account">账户与权限</a></header><main class="cs-panes"><div class="cs-message" role="status">正在打开后台…</div></main>`;
  document.body.append(host);
 }
 const panes = () => host.querySelector('.cs-panes'), message = () => host.querySelector('.cs-message'), live = text => { host.querySelector('.cs-live').textContent = text; };
 const hashFor = (workspace, section) => '#console/' + workspace + '/' + section + (workspace === 'technical' && supplier ? '?supplier=' + encodeURIComponent(supplier) : '');

 function loadAccess() {
  if (access) return Promise.resolve(access);
  accessPromise ||= fetch('/api/staff/workspace/access', { credentials: 'same-origin' }).then(async r => {
   if (!r.ok) { const e = new Error(r.status === 401 ? '员工登录已过期，请重新登录。' : '你的员工账户没有后台权限。'); e.status = r.status; throw e; }
   return r.json();
  }).then(a => { access = a; return a; }).finally(() => { accessPromise = null; });
  return accessPromise;
 }

 function denied(error, workspace) {
  const m = message();
  m.hidden = false;
  m.innerHTML = '';
  m.append(error.message + ' ');
  if (error.status === 401) {
   const a = document.createElement('a');
   a.href = '/api/staff/login?next=' + (workspace === 'technical' ? 'lab' : 'business');
   a.textContent = '公司员工登录 →';
   m.append(a);
  }
  live('未登录');
 }

 function show(workspace, section) {
  if (!access?.[workspace]) workspace = access?.business ? 'business' : 'technical';
  if (!access?.[workspace]) { denied(Object.assign(new Error('你的员工账户没有后台权限。'), { status: 403 }), workspace); return; }
  section = known[workspace].includes(section) ? section : positions[workspace];
  positions[workspace] = section;
  current = workspace;
  host.classList.toggle('technical', workspace === 'technical');
  for (const tab of host.querySelectorAll('[data-console-tab]')) {
   tab.hidden = !access[tab.dataset.consoleTab];
   tab.setAttribute('aria-selected', String(tab.dataset.consoleTab === workspace));
   tab.href = '#console/' + tab.dataset.consoleTab + '/' + positions[tab.dataset.consoleTab];
  }
  if (!frames[workspace]) {
   const frame = document.createElement('iframe');
   frame.title = workspace === 'technical' ? '技术运维工作台' : '业务运营工作台';
   frame.src = '/api/staff/' + (workspace === 'technical' ? 'lab' : 'workspace') + '/view' + (workspace === 'technical' && supplier ? '?supplier=' + encodeURIComponent(supplier) : '') + '#' + section;
   frames[workspace] = frame;
   panes().append(frame);
  }
  for (const [name, frame] of Object.entries(frames)) {
   frame.hidden = name !== workspace;
   if (name === workspace) frame.contentWindow?.postMessage({ type: 'workspace-navigate', section }, location.origin);
  }
  message().hidden = true;
  if (host.querySelector('.cs-live').textContent.startsWith('正在验证')) live('切换面板会保留各自位置');
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
  for (const id of ['identity-view', 'market-view', 'admin-view', 'login-view']) { const el = document.getElementById(id); if (el) el.hidden = true; }
  document.body.classList.add('console-active');
  host.hidden = false;
  const [path, query = ''] = view.split('?');
  const [, workspace = '', section = ''] = path.split('/');
  const pick = new URLSearchParams(query).get('supplier');
  if (pick && /^[a-f0-9-]{36}$/.test(pick)) supplier = pick;
  try { await loadAccess(); } catch (e) { denied(e, workspace); return; }
  if (!host.hidden) show(['business', 'technical'].includes(workspace) ? workspace : current || (access.technical ? 'technical' : 'business'), section);
 }

 function hide() {
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

 window.ConsoleUI = { handles, render, hide };
})();
