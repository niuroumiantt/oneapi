// 全站下拉框：点开后在选择框下方弹出圆角菜单，代替系统那种盖在选择框上的弹层。
// 原生 <select> 保留：取值、表单提交和各页面的 change 监听都不变，这里只换弹出的菜单。
// 触屏设备、多选框、带 data-native-select 的区域继续用系统菜单。
(()=>{
 if(window.matchMedia&&matchMedia('(pointer: coarse)').matches)return;
 let menu=null,owner=null,rows=[],active=-1;
 const usable=s=>s&&s.tagName==='SELECT'&&!s.multiple&&!(s.size>1)&&!s.disabled&&!s.closest('[data-native-select]');
 const setActive=i=>{if(active>=0&&rows[active])rows[active].el.classList.remove('is-active');active=i;if(i>=0&&rows[i]){rows[i].el.classList.add('is-active');rows[i].el.scrollIntoView({block:'nearest'});}};
 const step=(from,dir)=>{for(let i=from+dir;i>=0&&i<rows.length;i+=dir)if(!rows[i].opt.disabled)return i;return from;};
 function close(refocus){
  if(!menu)return;menu.remove();menu=null;rows=[];active=-1;
  window.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',dismiss);window.removeEventListener('blur',dismiss);
  const s=owner;owner=null;if(refocus&&s&&document.contains(s))s.focus({preventScroll:true});
 }
 const dismiss=()=>close(false);
 const onScroll=e=>{if(menu&&!menu.contains(e.target))close(false);};
 function choose(i){
  const s=owner,opt=rows[i]?.opt;if(!s||!opt||opt.disabled)return;
  const changed=s.value!==opt.value||s.selectedIndex!==opt.index;
  s.selectedIndex=opt.index;close(true);
  if(changed){s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));}
 }
 function item(opt){
  const el=document.createElement('div');el.className='sm-item'+(opt.selected?' is-selected':'')+(opt.disabled?' is-disabled':'');
  el.setAttribute('role','option');el.setAttribute('aria-selected',String(opt.selected));if(opt.disabled)el.setAttribute('aria-disabled','true');
  const check=document.createElement('span');check.className='sm-check';check.setAttribute('aria-hidden','true');
  const text=document.createElement('span');text.className='sm-text';text.textContent=opt.label||opt.textContent;
  el.append(check,text);const index=rows.length;rows.push({el,opt});
  el.addEventListener('mousemove',()=>{if(active!==index&&!opt.disabled)setActive(index);});
  el.addEventListener('click',()=>choose(index));
  return el;
 }
 function open(s){
  close(false);owner=s;menu=document.createElement('div');menu.className='sm-menu';menu.setAttribute('role','listbox');
  if(s.getAttribute('aria-label'))menu.setAttribute('aria-label',s.getAttribute('aria-label'));
  for(const child of s.children){
   if(child.tagName==='OPTION'){if(!child.hidden)menu.append(item(child));continue;}
   if(child.tagName!=='OPTGROUP')continue;
   if(menu.childElementCount){const sep=document.createElement('div');sep.className='sm-sep';menu.append(sep);}
   const head=document.createElement('div');head.className='sm-group';head.textContent=child.label;menu.append(head);
   for(const opt of child.children)if(opt.tagName==='OPTION'&&!opt.hidden)menu.append(item(opt));
  }
  if(!rows.length){owner=null;menu=null;return;}
  const r=s.getBoundingClientRect(),size=parseFloat(getComputedStyle(s).fontSize)||14;
  menu.style.fontSize=Math.max(13,Math.min(15,size))+'px';menu.style.minWidth=Math.max(160,r.width)+'px';menu.style.maxWidth=Math.max(r.width,Math.min(560,innerWidth-24))+'px';
  menu.style.left='0px';menu.style.top='0px';document.body.append(menu);
  const below=innerHeight-r.bottom-12,above=r.top-12,h=menu.offsetHeight,up=h>below&&above>below;
  menu.style.maxHeight=Math.max(120,Math.min(h,up?above:below))+'px';
  const w=menu.offsetWidth;menu.style.left=Math.max(12,Math.min(r.left,innerWidth-w-12))+'px';
  menu.style.top=(up?Math.max(12,r.top-6-Math.min(h,above)):r.bottom+6)+'px';
  if(up)menu.classList.add('is-up');
  setActive(Math.max(0,rows.findIndex(x=>x.opt.selected)));if(rows[active]?.opt.disabled)setActive(step(active,1));
  window.addEventListener('scroll',onScroll,true);window.addEventListener('resize',dismiss);window.addEventListener('blur',dismiss);
 }
 document.addEventListener('mousedown',e=>{
  if(menu&&menu.contains(e.target)){e.preventDefault();return;}
  const s=e.target.closest?.('select');
  if(e.button===0&&usable(s)){e.preventDefault();if(owner===s){close(true);return;}s.focus({preventScroll:true});open(s);return;}
  if(menu)close(false);
 },true);
 document.addEventListener('keydown',e=>{
  if(menu){
   const k=e.key;
   if(k==='ArrowDown'||k==='ArrowUp'){e.preventDefault();setActive(step(active,k==='ArrowDown'?1:-1));}
   else if(k==='Home'||k==='End'){e.preventDefault();setActive(k==='Home'?step(-1,1):step(rows.length,-1));}
   else if(k==='Enter'||k===' '){e.preventDefault();choose(active);}
   else if(k==='Escape'){e.preventDefault();e.stopPropagation();close(true);}
   else if(k==='Tab')close(false);
   else if(k.length===1){const from=active+1,hit=[...rows.slice(from),...rows.slice(0,from)].find(x=>!x.opt.disabled&&(x.opt.label||x.opt.textContent).trim().toLowerCase().startsWith(k.toLowerCase()));if(hit)setActive(rows.indexOf(hit));}
   return;
  }
  const s=e.target;
  if(usable(s)&&(e.key===' '||e.key==='Enter'||((e.key==='ArrowDown'||e.key==='ArrowUp')&&(e.altKey||/Mac/.test(navigator.platform))))){e.preventDefault();open(s);}
 },true);
 // 页面重绘把选择框拿掉时，菜单跟着关掉。
 new MutationObserver(()=>{if(menu&&owner&&!document.contains(owner))close(false);}).observe(document.documentElement,{childList:true,subtree:true});
})();
