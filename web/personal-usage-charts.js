/* Personal Dashboard charts. Only authenticated, server-aggregated usage is rendered. */
(() => {
'use strict';
let active=null;
const palette={'deepseek-flash':'var(--personal-chart-deepseek,#5867cc)','glm-5.3':'var(--personal-chart-glm,#269c99)','glm-5.3-flash':'var(--personal-chart-flash,#d69b3b)'};
const color=id=>palette[id]||`hsl(${[...id].reduce((h,c)=>(h*31+c.charCodeAt(0))%360,0)} 48% 44%)`;
function clear(){if(active){active.controller?.abort();active.root.remove();active=null;}}
function mount(home,owner){
 if(!home||!owner){clear();return;}
 if(active?.home===home&&active.owner===owner&&active.root.isConnected)return;
 clear();const root=document.createElement('section');root.className='pd-usage';root.setAttribute('aria-label','使用概况');home.append(root);
 active={home,root,owner,expanded:false,data:null,error:false,controller:null};refresh(active);
}
async function refresh(view){
 view.controller?.abort();const controller=new AbortController();view.controller=controller;view.error=false;view.data=null;render(view);
 const timer=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch('/api/customer-credit/usage/chart',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
  if(!response.ok)throw Error('Usage unavailable');
  const data=await response.json();
  if(!Array.isArray(data.days)||data.days.length<30||!Array.isArray(data.models))throw Error('Invalid usage data');
  data.models=data.models.map(m=>({...m,color:color(m.id)}));
  data.days=data.days.map(d=>({...d,values:d.values.map(v=>BigInt(v)),total:BigInt(d.total)}));
  if(active===view)view.data=data;
 }catch{if(active===view)view.error=true;}
 finally{clearTimeout(timer);if(active===view&&view.root.isConnected)render(view);}
}


const fmt = n=>n.toLocaleString('zh-CN');
const short = n=>{n=BigInt(n);const unit=n>=1000000000n?1000000000n:n>=1000000n?1000000n:n>=1000n?1000n:1n;if(unit===1n)return String(n);const tenths=(n*100n+unit/2n)/unit;const fraction=String(tenths%100n).padStart(2,'0').replace(/0+$/,'');return `${tenths/100n}${fraction?'.'+fraction:''}${unit===1000000000n?'B':unit===1000000n?'M':'k'}`;};
const dateLabel = date=>`${Number(date.slice(5,7))}月${Number(date.slice(8))}日`;
const esc = text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const range=days=>days.length?`${dateLabel(days[0].date)} — ${dateLabel(days.at(-1).date)}`:'';
const arrow='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8"/></svg>';

function bars(days,models,wide=false){
  const max=days.reduce((n,d)=>d.total>n?d.total:n,1n);let step=1n;while(step*10n<=max)step*=10n;
  const ceiling=max===1n?1000n:(max+step-1n)/step*step,legend=models.map(m=>`<span><i style="--model-color:${m.color}"></i>${esc(m.name)}</span>`).join('');
  const ticks=[4n,3n,2n,1n,0n];
  return `<div class="pd-chart-scroll" ${wide?'tabindex="0" role="region" aria-label="近 30 天图表，可横向滚动"':''}><div class="pd-chart ${wide?'pd-chart-wide':''}">
    <div class="pd-y-axis" aria-hidden="true">${ticks.map(p=>`<span>${short(ceiling*p/4n)}</span>`).join('')}</div>
    <div class="pd-plot"><div class="pd-grid" aria-hidden="true">${ticks.map(()=>'<i></i>').join('')}</div><div class="pd-bars">${days.map((d,i)=>`<button type="button" class="pd-bar" data-day="${d.date}" aria-label="${dateLabel(d.date)}，${fmt(d.total)} Token" aria-describedby="pd-chart-help"><span class="pd-bar-stack">${models.map((m,j)=>`<i style="height:${Number(d.values[j])/Number(ceiling)*100}%;--model-color:${m.color}"></i>`).join('')}</span><span class="pd-x-label" aria-hidden="true">${!wide||i%5===0||i===days.length-1?d.date.slice(5).replace('-','/'):''}</span></button>`).join('')}</div></div>
  </div></div><div class="pd-model-legend" aria-label="模型颜色图例">${legend}</div>`;
}
function heatmap(days){
  const padding=(new Date(`${days[0].date}T00:00:00Z`).getUTCDay()+6)%7,columns=Math.ceil((days.length+padding)/7);
  const labels=Array.from({length:columns},(_,i)=>{const d=days[Math.max(0,i*7-padding)];return i===0||d?.date.slice(5,7)!==days[Math.max(0,(i-1)*7-padding)]?.date.slice(5,7)?`${Number(d.date.slice(5,7))}月`:'';});
  const max=days.reduce((n,d)=>d.total>n?d.total:n,1n);
  const intensity=n=>n===0n?0:Number((n*4n-1n)/max)+1;
  return `<div class="pd-heatmap" style="--weeks:${columns}"><div class="pd-months" aria-hidden="true">${labels.map(l=>`<span>${l}</span>`).join('')}</div><div class="pd-weekdays" aria-hidden="true">${['一','','三','','五','','日'].map(s=>`<span>${s}</span>`).join('')}</div><div class="pd-days" role="group" aria-label="近 3 个月每日使用量，方向键切换日期">${'<span class="pd-day-blank"></span>'.repeat(padding)}${days.map((d,i)=>`<button type="button" class="pd-day pd-level-${intensity(d.total)}" data-day="${d.date}" tabindex="${i===days.length-1?0:-1}" aria-label="${d.date}，${d.total?`${fmt(d.total)} Token`:'未使用'}"></button>`).join('')}</div></div>
    <div class="pd-heat-footer"><span>${range(days)}</span><div class="pd-heat-legend" aria-label="Token 用量由少到多"><span>少</span>${[0,1,2,3,4].map(i=>`<i class="pd-level-${i}"></i>`).join('')}<span>多</span></div></div>`;
}
function render(view){
  if(active!==view||!view.root.isConnected)return;
  const {root,expanded}=view,models=view.data?.models||[],days=view.data?.days||[],week=days.slice(-7),month=days.slice(-30);
  const total=week.reduce((sum,d)=>sum+d.total,0n),activeDays=days.filter(d=>d.total>0n).length;
  const loading=!view.data&&!view.error,state=view.error?'error':view.data&&!days.some(d=>d.total>0n)?'empty':'ready';
  const message=view.error?'<div class="pd-state" role="alert"><p>暂时无法加载用量</p><span>请稍后重试。</span><button type="button" data-pd-retry>重新加载</button></div>':loading?'<div class="pd-state pd-loading" role="status"><span>正在加载用量…</span><div aria-hidden="true"></div></div>':'';
  const note=BigInt(view.data?.unreported_calls||0)>0n?`<p class="pd-unreported">${fmt(BigInt(view.data.unreported_calls))} 次调用的 Token 尚未完整返回，图中仅统计已知部分。</p>`:'';
  root.innerHTML=`    <div class="pd-panels"${expanded?' hidden':''}><section class="pd-card pd-week" aria-labelledby="pd-week-title"><header class="pd-card-head"><div><h2 id="pd-week-title">每日模型用量</h2><p>近 7 天${!view.data?'':` · <strong>${short(total)}</strong> Token`}</p></div><button class="pd-expand" type="button" data-pd-expand aria-expanded="${expanded}" aria-controls="pd-month">${expanded?'收起长图':'展开近 30 天'}${arrow}</button></header>
    ${message||bars(week,models)}<p class="pd-chart-note" id="pd-chart-help">${state==='empty'?'发起第一次调用后，这里会显示每日模型用量。':'输入 + 输出 Token · 按北京时间统计'}</p></section>
    <section class="pd-card pd-activity" aria-labelledby="pd-activity-title"><header class="pd-card-head"><div><h2 id="pd-activity-title">使用状态</h2><p>近 3 个月${!view.data?'':` · 已使用 <strong>${activeDays}</strong> 天`}</p></div></header>${message||heatmap(days)}<p class="pd-chart-note">${state==='empty'?'还没有使用记录，期待你的第一次调用。':'每格代表一天，颜色按图例区分用量'}</p></section></div>
    ${expanded?`<section id="pd-month" class="pd-card pd-month" aria-labelledby="pd-month-title"><header class="pd-card-head"><div><h2 id="pd-month-title">每日模型用量 · 近 30 天</h2><p>${range(month)}${!view.data?'':` · <strong>${short(month.reduce((sum,d)=>sum+d.total,0n))}</strong> Token`}</p></div><button class="pd-expand" type="button" data-pd-close>返回概览<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m4 10 4-4 4 4"/></svg></button></header>${message||bars(month,models,true)}<p class="pd-chart-note pd-month-help">输入 + 输出 Token · 按北京时间统计<span>窄屏可左右滑动查看全部日期</span></p><details class="pd-data"><summary>查看每日数值</summary><div class="pd-table-wrap"><table><caption>近 30 天每日模型 Token 用量</caption><thead><tr><th scope="col">日期</th>${models.map(m=>`<th scope="col">${esc(m.name)}</th>`).join('')}<th scope="col">合计</th></tr></thead><tbody>${!view.data?'':month.map(d=>`<tr><th scope="row">${d.date}</th>${d.values.map(v=>`<td>${fmt(v)}</td>`).join('')}<td>${fmt(d.total)}</td></tr>`).join('')}</tbody></table></div></details></section>`:''}
    ${note}<div class="pd-tooltip" id="pd-tooltip" role="tooltip" hidden></div>`;
  root.querySelector('[data-pd-expand]').addEventListener('click',()=>{view.expanded=true;render(view);root.querySelector('[data-pd-close]').focus({preventScroll:true});});
  root.querySelector('[data-pd-close]')?.addEventListener('click',()=>{view.expanded=false;render(view);root.querySelector('[data-pd-expand]').focus({preventScroll:true});});
  root.querySelectorAll('[data-pd-retry]').forEach(b=>b.addEventListener('click',()=>refresh(view)));
  const tooltip=root.querySelector('.pd-tooltip');
  let hideTimer, activeButton;
  const hide=()=>{clearTimeout(hideTimer);tooltip.hidden=true;root.querySelectorAll('[data-day][aria-describedby="pd-tooltip"]').forEach(b=>b.classList.contains('pd-bar')?b.setAttribute('aria-describedby','pd-chart-help'):b.removeAttribute('aria-describedby'));};
  const scheduleHide=()=>{clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(document.activeElement!==activeButton&&!tooltip.matches(':hover')&&!activeButton?.matches(':hover'))hide();},160);};
  tooltip.addEventListener('pointerenter',()=>clearTimeout(hideTimer));
  tooltip.addEventListener('pointerleave',scheduleHide);
  const show=button=>{
    clearTimeout(hideTimer);activeButton=button;
    const d=days.find(d=>d.date===button.dataset.day);if(!d)return;
    tooltip.innerHTML=`<b>${dateLabel(d.date)}</b><div class="pd-tip-total">${fmt(d.total)} <span>Token</span></div>${models.map((m,i)=>d.values[i]?`<div class="pd-tip-row"><span><i style="--model-color:${m.color}"></i>${esc(m.name)}</span><b>${fmt(d.values[i])}</b></div>`:'').join('')}${d.total?'':'<p>当天暂无已知 Token 用量</p>'}`;
    tooltip.hidden=false;button.setAttribute('aria-describedby','pd-tooltip');
    const box=button.getBoundingClientRect(),tip=tooltip.getBoundingClientRect(),x=Math.min(window.innerWidth-tip.width-12,Math.max(12,box.left+box.width/2-tip.width/2)),y=box.top>tip.height+12?box.top-tip.height-8:Math.min(window.innerHeight-tip.height-12,box.bottom+8);
    tooltip.style.left=`${x}px`;tooltip.style.top=`${Math.max(8,y)}px`;
  };
  root.querySelectorAll('[data-day]').forEach(button=>{
    button.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch')show(button);});button.addEventListener('pointerleave',scheduleHide);button.addEventListener('focus',()=>show(button));button.addEventListener('blur',scheduleHide);button.addEventListener('click',()=>show(button));button.addEventListener('keydown',e=>{if(e.key==='Escape'){hide();e.stopPropagation();}});
  });
  root.querySelector('.pd-days')?.addEventListener('keydown',e=>{
    const delta={ArrowRight:7,ArrowLeft:-7,ArrowDown:1,ArrowUp:-1}[e.key];if(!delta)return;e.preventDefault();const buttons=[...root.querySelectorAll('.pd-day')],index=buttons.indexOf(e.target),next=buttons[Math.max(0,Math.min(buttons.length-1,index+delta))];e.target.tabIndex=-1;next.tabIndex=0;next.focus();
  });
}
document.addEventListener('click',e=>{if(!e.target.closest('[data-day],.pd-tooltip')){const tip=document.querySelector('.pd-tooltip');if(tip)tip.hidden=true;}});
document.addEventListener('scroll',e=>{const tip=document.querySelector('.pd-tooltip');if(tip&&!tip.contains(e.target))tip.hidden=true;},true);
window.addEventListener('resize',()=>{const tip=document.querySelector('.pd-tooltip');if(tip)tip.hidden=true;});
window.addEventListener('hashchange',()=>{if(location.hash!=='#personal'&&active){active.controller?.abort();const tip=active.root.querySelector('.pd-tooltip');if(tip)tip.hidden=true;active=null;}});
window.PersonalUsageCharts={mount,clear};
})();
