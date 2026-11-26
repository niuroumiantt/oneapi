(() => {
 'use strict';
 if(window.parent!==window)return;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const inbox=document.createElement('details');inbox.className='vip-inbox';inbox.hidden=true;
 inbox.innerHTML='<summary aria-label="VIP 通知"><span>通知</span><b hidden></b></summary><section aria-label="VIP 通知列表"><h2>VIP 通知</h2><p class="vip-inbox-state" role="status"></p><div class="vip-inbox-items"></div></section>';
 let latest=null,busy=false;
 function mount(){
  const slots=[...document.querySelectorAll('.site-account')];
  const slot=slots.find(s=>s.getClientRects().length);
  if(slot&&!slot.contains(inbox))slot.prepend(inbox);
 }
 new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});mount();
 async function refresh(){
  if(busy||document.hidden)return;busy=true;
  try{
   const response=await fetch('/api/staff/vip-notifications',{credentials:'same-origin',cache:'no-store'});
   if([401,403].includes(response.status)){inbox.hidden=true;inbox.open=false;latest=null;inbox.querySelector('.vip-inbox-items').replaceChildren();return;}
   if(!response.ok)throw Error();
   const data=await response.json();inbox.hidden=false;
   const badge=inbox.querySelector('summary b');badge.hidden=!data.unread;badge.textContent=data.unread>99?'99+':data.unread;
   inbox.querySelector('summary').setAttribute('aria-label',`VIP 通知，${data.unread} 条未读`);
   inbox.querySelector('.vip-inbox-state').textContent=data.items.length?(data.unread?`${data.unread} 条未读 · 打开后标为已读`:'没有未读通知'):'暂时没有 VIP 通知';
   const snapshot=JSON.stringify(data.items);
   if(latest!==snapshot){latest=snapshot;inbox.querySelector('.vip-inbox-items').innerHTML=data.items.map(n=>`<a data-notice="${esc(n.id)}" class="${n.read_at?'':'is-unread'}" href="/promotion/vip.html?staff=1&amp;partner=${encodeURIComponent(n.partner_id)}"><strong>${esc(n.title)}</strong><span>${esc(n.legal_name)} · ${esc(n.public_code)}</span><span>${esc(n.next)}</span><time>${new Date(n.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）</time></a>`).join('');}
  }catch{if(!inbox.hidden)inbox.querySelector('.vip-inbox-state').innerHTML='通知暂时未能更新。<button type="button" data-retry>重试</button>';}
  finally{busy=false;}
 }
 inbox.addEventListener('click',async event=>{
  if(event.target.closest('[data-retry]')){refresh();return;}
  const link=event.target.closest('[data-notice]');if(!link)return;
  event.preventDefault();
  try{const r=await fetch('/api/staff/vip-notifications/'+encodeURIComponent(link.dataset.notice)+'/read',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error();location.assign(link.href);}
  catch{inbox.querySelector('.vip-inbox-state').textContent='未能标记已读，请重试或从 VIP 客户列表进入。';}
 });
 document.addEventListener('click',e=>{if(!inbox.contains(e.target))inbox.open=false;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&inbox.open){inbox.open=false;inbox.querySelector('summary').focus();}});
 inbox.addEventListener('toggle',()=>{if(inbox.open)refresh();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 setInterval(refresh,15000);refresh();
})();
