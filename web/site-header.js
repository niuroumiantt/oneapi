/* Shared site navigation and account markup. Page tools stay in a second row. */
(() => {
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ico=n=>`<span data-icon="${n}"></span>`;
 const assetBase=new URL('.',document.currentScript.src);
 const standalone=!!document.querySelector('[data-site-header="skills"],[data-site-header="compare"]');
 const root=(standalone||/\/cw(?:-terms)?\.html$/.test(location.pathname))?new URL('index.html',assetBase).href:'';
 const skills=new URL(assetBase.pathname.endsWith('/web/')?'../prototypes/skills/':'skills/',assetBase).href;
 function accountMenu(user,kind='customer',settingsHref='#security'){
  if(!user)return `<a class="live-signin" href="#workspace">${ico('user-round')}<span>登录 / 注册</span></a>`;
  const name=esc(user.name||user.email),initial=esc(Array.from(user.name||user.email||'U')[0]);
  return `<details class="account-menu"><summary aria-label="账户菜单：${name}，已登录"><span class="account-avatar" aria-hidden="true">${initial}<i></i></span><span class="account-label"><b>${name}</b><small>${kind==='staff'?'员工已登录':'已登录'}</small></span>${ico('chevron-down')}</summary><div class="account-popover"><div class="account-person"><b>${name}</b><small>${esc(user.email)}</small></div>${kind==='staff'?`<a href="#staff-account">${ico('shield-check')} 员工工作台</a><a href="/cw.html?staff=1">${ico('users')} CW 合作伙伴管理</a>`:`<a href="#workspace">${ico('layout-dashboard')} 我的工作台</a><a href="/cw.html">${ico('users')} 推广合作伙伴</a><a href="${settingsHref}">${ico('settings')} 账户设置</a>`}<button data-live="logout" data-session-kind="${kind}">${ico('log-in')} 退出登录</button></div></details>`;
 }

 function render(active, {account='', tools='', className=''}={}) {
  const links=[['universe','首页',root+'#universe'],['market','模型广场',root+'#market'],['skills','Skills 广场',skills],['docs','文档',root+'#docs']];
  return `<header class="site-header ${className}"><div class="site-header-main"><a class="site-brand" href="${root}#universe" aria-label="semifly.ai 首页"><img src="${new URL('pinapi-wordmark.svg',assetBase)}" alt="semifly.ai" width="168" height="44"></a><nav class="site-nav" aria-label="主要导航">${links.map(([id,label,url])=>`<a href="${url}"${id===active?' aria-current="page"':''}>${label}</a>`).join('')}</nav><div class="site-account" ${account?'':'data-account-slot'}>${account||accountMenu(null)}</div></div>${tools?`<div class="site-tools">${tools}</div>`:''}</header>`;
 }
 function footer(){
  const number=document.documentElement?.dataset.icpFiling;
  const filing=number?`<a class="site-filing" href="https://beian.miit.gov.cn/">${esc(number)}</a>`:'';
  return `<footer class="site-footer"><span>semifly.ai</span><span>深圳市格洛可半导体有限公司</span>${filing}<a href="${root}#docs">使用文档</a></footer>`;
 }
 window.SiteHeader={render,accountMenu,footer};
 document.querySelectorAll('[data-site-footer]').forEach(el=>el.outerHTML=footer());
 document.querySelectorAll('[data-site-header]').forEach(el=>el.outerHTML=render(el.dataset.siteHeader==='compare'?'workspace':el.dataset.siteHeader));
 if(standalone){
  const slot=document.querySelector('[data-account-slot]');
  const prefixLinks=()=>slot.querySelectorAll('a[href^="#"]').forEach(a=>a.href=root+a.getAttribute('href'));
  prefixLinks();
  (async()=>{try{
   let response=await fetch('/api/platform/me',{credentials:'same-origin',cache:'no-store'}),kind='customer',user;
   if(response.ok)user=(await response.json()).user;
   else if(response.status===401){response=await fetch('/api/staff/me',{credentials:'same-origin',cache:'no-store'});if(response.ok){user=(await response.json()).staff;kind='staff';}}
   if(user){slot.innerHTML=accountMenu(user,kind);prefixLinks();}
  }catch{/* Keep a working account entry when the session service is unavailable. */}})();
  document.addEventListener('click',async e=>{
   document.querySelectorAll('.account-menu[open]').forEach(menu=>{if(!menu.contains(e.target)||e.target.closest('a'))menu.open=false;});
   const button=e.target.closest('[data-live="logout"]');if(!button)return;
   button.disabled=true;
   try{const response=await fetch(button.dataset.sessionKind==='staff'?'/api/staff/logout':'/api/auth/sign-out',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw Error();slot.innerHTML=accountMenu(null);prefixLinks();}catch{button.disabled=false;button.textContent='退出失败，点击重试';}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.account-menu[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();});});
 }
})();
