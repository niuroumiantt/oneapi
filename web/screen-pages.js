/* Fixed viewport reading controls for legacy long documents and back-office panels.
 * Native forms/listeners stay intact. Pages overlap a line/row so no boundary text is lost.
 * Each overflowing region owns its pager; navigation and surrounding panels remain stationary.
 */
(() => {
 'use strict';
 function init(){
 if(window.ScreenPages)return;
 const records=new Map();let pending=0;
 const selectors='main,aside,section,article,nav,pre,div,dialog';
 const visible=el=>el.isConnected&&el.getClientRects().length&&!el.closest('[hidden],dialog:not([open]),.sp-controls');
 const px=n=>Math.max(0,Math.round(n))+'px';
 const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
 function viewport(el){
  const r=el.getBoundingClientRect();let top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right);
  for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(s.overflowY+s.overflowX)){const b=p.getBoundingClientRect();top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);left=Math.max(left,b.left);right=Math.min(right,b.right);}}
  return {top,bottom,left,right,width:right-left,height:bottom-top};
 }
 function attach(el){
  if(records.has(el))return records.get(el);
  const controls=document.createElement('nav');controls.className='sp-controls';controls.setAttribute('aria-label','内容分页');
  controls.innerHTML='<button type="button" data-sp="up" aria-label="上一页">上一页</button><output aria-live="polite"></output><button type="button" data-sp="down" aria-label="下一页">下一页</button><button type="button" data-sp="left" aria-label="前一组字段">前组</button><span></span><button type="button" data-sp="right" aria-label="后一组字段">后组</button>';
  (el.closest('dialog')||document.body).append(controls);
  const rec={el,controls,vertical:false,horizontal:false,oldPadding:el.style.paddingBottom};records.set(el,rec);el.classList.add('sp-surface');
  controls.addEventListener('click',event=>{const action=event.target.closest('[data-sp]')?.dataset.sp;if(!action)return;
   const stepY=Math.max(48,el.clientHeight-76),stepX=Math.max(60,el.clientWidth-48);
   const delta={up:[0,-stepY],down:[0,stepY],left:[-stepX,0],right:[stepX,0]}[action];
   const maxY=el.scrollHeight-el.clientHeight,maxX=el.scrollWidth-el.clientWidth;
   const top=action==='down'&&maxY-el.scrollTop<=stepY+40?maxY:clamp(el.scrollTop+delta[1],0,maxY);
   const left=action==='right'&&maxX-el.scrollLeft<=stepX+24?maxX:clamp(el.scrollLeft+delta[0],0,maxX);
   el.scrollTo({top,left,behavior:'instant'});update(rec);
  });
  el.addEventListener('scroll',schedule,{passive:true});return rec;
 }
 function update(rec){
  const {el,controls}=rec;if(!visible(el)){controls.hidden=true;return;}
  const area=viewport(el),v=el.scrollHeight>el.clientHeight+3,h=el.scrollWidth>el.clientWidth+3;
  rec.vertical=v;rec.horizontal=h;controls.hidden=(!v&&!h)||area.width<110||area.height<85;
  if(controls.hidden)return;
  Object.assign(controls.style,{left:px(area.left),top:px(area.bottom-32),width:px(area.width)});
  const yStep=Math.max(48,el.clientHeight-76),xStep=Math.max(60,el.clientWidth-48);
  const yMax=Math.max(0,el.scrollHeight-el.clientHeight),xMax=Math.max(0,el.scrollWidth-el.clientWidth);
  const yCount=yMax?Math.max(2,Math.ceil(Math.max(0,yMax-40)/yStep)+1):1,xCount=xMax?Math.max(2,Math.ceil(Math.max(0,xMax-24)/xStep)+1):1;
  const y=el.scrollTop>=yMax-2?yCount:Math.floor(el.scrollTop/yStep)+1,x=el.scrollLeft>=xMax-2?xCount:Math.floor(el.scrollLeft/xStep)+1;
  controls.querySelector('output').textContent=v?`${y} / ${yCount}`:'';controls.querySelector('span').textContent=h?`字段 ${x} / ${xCount}`:'';
  for(const action of ['up','down','left','right']){const b=controls.querySelector(`[data-sp="${action}"]`);b.hidden=(action==='up'||action==='down')?!v:!h;b.disabled=action==='up'?el.scrollTop<2:action==='down'?el.scrollTop>=yMax-2:action==='left'?el.scrollLeft<2:el.scrollLeft>=xMax-2;}
 }
 function documentChapters(){
  const main=document.querySelector('body[data-screen-document]>main');if(!main||main.dataset.screenChapters)return;
  const sections=[...main.children].filter(el=>el.tagName==='SECTION');if(sections.length<2)return;
  main.dataset.screenChapters='true';main.classList.add('sp-document-chapters');
  const nav=document.createElement('nav');nav.className='sp-chapters';nav.setAttribute('aria-label','页面栏目');
  const select=document.createElement('select');select.setAttribute('aria-label','选择页面栏目');
  sections.forEach((section,i)=>{const option=document.createElement('option');option.value=i;option.textContent=section.querySelector('h1,h2,h3')?.textContent.trim()||'第 '+(i+1)+' 节';select.append(option);section.classList.add('sp-chapter');});
  nav.append(select);main.prepend(nav);const show=()=>{sections.forEach((section,i)=>section.hidden=i!==Number(select.value));main.scrollTop=0;schedule();};select.addEventListener('change',show);show();
 }
 function compactNavigation(){
  if(!document.documentElement.classList.contains('framed'))return;
  const nav=document.querySelector('aside #nav');if(!nav)return;
  let select=nav.parentElement.querySelector('.sp-nav-select');
  if(!select){select=document.createElement('select');select.className='sp-nav-select';select.setAttribute('aria-label','后台栏目');nav.before(select);select.addEventListener('change',()=>nav.querySelectorAll('button[data-tab]')[Number(select.value)]?.click());}
  const buttons=[...nav.querySelectorAll('button[data-tab]')],signature=buttons.map(b=>b.textContent).join('|');
  if(select.dataset.signature!==signature){select.replaceChildren(...buttons.map((b,i)=>{const option=document.createElement('option');option.value=i;option.textContent=b.textContent;return option;}));select.dataset.signature=signature;}
  const current=buttons.findIndex(b=>b.classList.contains('active'));if(current>=0)select.value=String(current);
 }
 function fitPrimary(){
  const candidates=document.querySelectorAll('#identity-view>.live-main,.lp-main,.rt-main,.skills-page>#app,html.framed .shell>main,html.framed .layout>.main,.testing-manual .wrap,body[data-screen-document]>main,body.compare-page>main,body.cw-applicant>main');
  for(const el of candidates){if(!visible(el))continue;const r=el.getBoundingClientRect();const footer=document.querySelector('.site-footer');const bottom=footer&&visible(footer)?footer.getBoundingClientRect().height:0;const size=Math.max(120,innerHeight-r.top-bottom);el.style.maxHeight=px(size);el.style.minHeight='0';el.style.overflow='auto';}
 }
 function scan(){
  pending=0;documentChapters();compactNavigation();fitPrimary();
  for(const [el,rec] of records){if(!el.isConnected){rec.controls.remove();records.delete(el);}else update(rec);}
  for(const el of document.querySelectorAll(selectors)){
   if(records.has(el)||!visible(el)||el.closest('.sp-controls,.site-header,.account-popover,[role="listbox"],[data-screen-local]')||el.matches('.mx-story,.mx-watermark'))continue;
   const r=el.getBoundingClientRect();if(r.width<110||r.height<85)continue;
   const style=getComputedStyle(el);if(!/auto|scroll/.test(style.overflowY+style.overflowX))continue;
   if(el.scrollHeight<=el.clientHeight+3&&el.scrollWidth<=el.clientWidth+3)continue;
   // Reserve a stable line for controls inside this region, not on the whole page.
   const pad=parseFloat(style.paddingBottom)||0;const rec=attach(el);el.style.paddingBottom=(pad+36)+'px';update(rec);
  }
 }
 function schedule(){if(!pending)pending=requestAnimationFrame(scan);}
 new MutationObserver(changes=>{if(changes.some(c=>!c.target.closest?.('.sp-controls')&&(c.type==='childList'||['hidden','open'].includes(c.attributeName))))schedule();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open']});
 addEventListener('resize',schedule);addEventListener('hashchange',()=>{for(const {el} of records.values()){el.scrollTop=0;el.scrollLeft=0;}schedule();});document.addEventListener('toggle',schedule,true);document.addEventListener('click',schedule);document.fonts?.ready.then(schedule);
 // Focus may reveal a field on another page; synchronize the pager with native focus scrolling.
 document.addEventListener('focusin',schedule);
 window.ScreenPages={refresh:schedule};
 schedule();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
