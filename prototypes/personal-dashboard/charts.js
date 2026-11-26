import {models,days as sampleDays} from './demo-data.js';

const fmt = n=>n.toLocaleString('zh-CN');
const short = n=>n>=1e6?`${(n/1e6).toFixed(2)}M`:n>=1000?`${+(n/1000).toFixed(1)}k`:String(n);
const dateLabel = date=>`${Number(date.slice(5,7))}月${Number(date.slice(8))}日`;
const esc = text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state='sample', expanded=false;
const getDays=()=>state==='empty'?sampleDays.map(d=>({...d,total:0,values:[0,0,0]})):sampleDays;
const arrow='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8"/></svg>';

function bars(days,wide=false){
  const max=Math.max(...days.map(d=>d.total),1),step=max<=1?1000:10**Math.floor(Math.log10(max));
  const ceiling=Math.ceil(max/step)*step,legend=models.map(m=>`<span><i style="--model-color:${m.color}"></i>${esc(m.name)}</span>`).join('');
  const ticks=[1,.75,.5,.25,0];
  return `<div class="pd-chart-scroll" ${wide?'tabindex="0" role="region" aria-label="近 30 天图表，可横向滚动"':''}><div class="pd-chart ${wide?'pd-chart-wide':''}">
    <div class="pd-y-axis" aria-hidden="true">${ticks.map(p=>`<span>${short(ceiling*p)}</span>`).join('')}</div>
    <div class="pd-plot"><div class="pd-grid" aria-hidden="true">${ticks.map(()=>'<i></i>').join('')}</div><div class="pd-bars">${days.map((d,i)=>`<button type="button" class="pd-bar" data-day="${d.date}" aria-label="${dateLabel(d.date)}，${fmt(d.total)} Token" aria-describedby="pd-chart-help"><span class="pd-bar-stack">${models.map((m,j)=>`<i style="height:${d.values[j]/ceiling*100}%;--model-color:${m.color}"></i>`).join('')}</span><span class="pd-x-label" aria-hidden="true">${!wide||i%5===0||i===days.length-1?d.date.slice(5).replace('-','/'):''}</span></button>`).join('')}</div></div>
  </div></div><div class="pd-model-legend" aria-label="模型颜色图例">${legend}</div>`;
}
function heatmap(days){
  const padding=(new Date(`${days[0].date}T00:00:00Z`).getUTCDay()+6)%7,columns=Math.ceil((days.length+padding)/7);
  const labels=Array.from({length:columns},(_,i)=>{const d=days[Math.max(0,i*7-padding)];return i===0||d?.date.slice(5,7)!==days[Math.max(0,(i-1)*7-padding)]?.date.slice(5,7)?`${Number(d.date.slice(5,7))}月`:'';});
  const intensity=n=>n===0?0:n<50000?1:n<120000?2:n<220000?3:4;
  return `<div class="pd-heatmap" style="--weeks:${columns}"><div class="pd-months" aria-hidden="true">${labels.map(l=>`<span>${l}</span>`).join('')}</div><div class="pd-weekdays" aria-hidden="true">${['一','','三','','五','','日'].map(s=>`<span>${s}</span>`).join('')}</div><div class="pd-days" role="group" aria-label="近 3 个月每日使用量，方向键切换日期">${'<span class="pd-day-blank"></span>'.repeat(padding)}${days.map((d,i)=>`<button type="button" class="pd-day pd-level-${intensity(d.total)}" data-day="${d.date}" tabindex="${i===days.length-1?0:-1}" aria-label="${d.date}，${d.total?`${fmt(d.total)} Token`:'未使用'}"></button>`).join('')}</div></div>
    <div class="pd-heat-footer"><span>8月27日 — 11月26日</span><div class="pd-heat-legend" aria-label="颜色越深，Token 用量越多"><span>少</span>${[0,1,2,3,4].map(i=>`<i class="pd-level-${i}"></i>`).join('')}<span>多</span></div></div>`;
}
function render(){
  const home=document.querySelector('.personal-home');if(!home)return;
  let root=home.querySelector('.pd-usage');if(!root){root=document.createElement('section');root.className='pd-usage';root.setAttribute('aria-label','使用概况');home.append(root);}
  const days=getDays(),week=days.slice(-7),month=days.slice(-30),total=week.reduce((sum,d)=>sum+d.total,0),active=days.filter(d=>d.total>0).length;
  const message=state==='error'?'<div class="pd-state" role="alert"><p>暂时无法加载用量</p><span>请稍后重试。</span><button type="button" data-pd-retry>重新加载</button></div>':'';
  root.innerHTML=`<div class="pd-preview"><span>本地设计预览 · 示例数据</span><label>预览状态<select data-pd-state aria-label="预览数据状态"><option value="sample" ${state==='sample'?'selected':''}>有使用记录</option><option value="empty" ${state==='empty'?'selected':''}>暂无记录</option><option value="error" ${state==='error'?'selected':''}>加载失败</option></select></label></div>
    <div class="pd-panels"><section class="pd-card pd-week" aria-labelledby="pd-week-title"><header class="pd-card-head"><div><h2 id="pd-week-title">每日模型用量</h2><p>近 7 天${state==='error'?'':` · <strong>${short(total)}</strong> Token`}</p></div><button class="pd-expand" type="button" data-pd-expand aria-expanded="${expanded}" aria-controls="pd-month">${expanded?'收起长图':'展开近 30 天'}${arrow}</button></header>
    ${message||bars(week)}<p class="pd-chart-note" id="pd-chart-help">${state==='empty'?'发起第一次调用后，这里会显示每日模型用量。':'输入 + 输出 Token · 按北京时间统计'}</p></section>
    <section class="pd-card pd-activity" aria-labelledby="pd-activity-title"><header class="pd-card-head"><div><h2 id="pd-activity-title">使用状态</h2><p>近 3 个月${state==='error'?'':` · 已使用 <strong>${active}</strong> 天`}</p></div></header>${message||heatmap(days)}<p class="pd-chart-note">${state==='empty'?'还没有使用记录，期待你的第一次调用。':'每格代表一天，颜色越深，用量越多'}</p></section></div>
    ${expanded?`<section id="pd-month" class="pd-card pd-month" aria-labelledby="pd-month-title"><header class="pd-card-head"><div><h2 id="pd-month-title">每日模型用量 · 近 30 天</h2><p>10月28日 — 11月26日${state==='error'?'':` · <strong>${short(month.reduce((sum,d)=>sum+d.total,0))}</strong> Token`}</p></div><button class="pd-expand" type="button" data-pd-close>收起长图<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m4 10 4-4 4 4"/></svg></button></header>${message||bars(month,true)}<p class="pd-chart-note pd-month-help">输入 + 输出 Token · 按北京时间统计<span>窄屏可左右滑动查看全部日期</span></p><details class="pd-data"><summary>查看每日数值</summary><div class="pd-table-wrap"><table><caption>近 30 天每日模型 Token 用量（示例数据）</caption><thead><tr><th scope="col">日期</th>${models.map(m=>`<th scope="col">${esc(m.name)}</th>`).join('')}<th scope="col">合计</th></tr></thead><tbody>${state==='error'?'':month.map(d=>`<tr><th scope="row">${d.date}</th>${d.values.map(v=>`<td>${fmt(v)}</td>`).join('')}<td>${fmt(d.total)}</td></tr>`).join('')}</tbody></table></div></details></section>`:''}
    <div class="pd-tooltip" id="pd-tooltip" role="tooltip" hidden></div>`;
  root.querySelector('[data-pd-state]').addEventListener('change',e=>{state=e.target.value;render();document.querySelector('[data-pd-state]').focus();});
  root.querySelector('[data-pd-expand]').addEventListener('click',()=>{expanded=!expanded;render();if(expanded){const target=document.querySelector('#pd-month');target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});target.querySelector('[data-pd-close]').focus({preventScroll:true});}else document.querySelector('[data-pd-expand]').focus({preventScroll:true});});
  root.querySelector('[data-pd-close]')?.addEventListener('click',()=>{expanded=false;render();document.querySelector('[data-pd-expand]').focus();});
  root.querySelectorAll('[data-pd-retry]').forEach(b=>b.addEventListener('click',()=>{state='sample';render();}));
  const tooltip=root.querySelector('.pd-tooltip');
  let hideTimer, activeButton;
  const hide=()=>{clearTimeout(hideTimer);tooltip.hidden=true;root.querySelectorAll('[data-day][aria-describedby="pd-tooltip"]').forEach(b=>b.removeAttribute('aria-describedby'));};
  const scheduleHide=()=>{clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(document.activeElement!==activeButton&&!tooltip.matches(':hover')&&!activeButton?.matches(':hover'))hide();},160);};
  tooltip.addEventListener('pointerenter',()=>clearTimeout(hideTimer));
  tooltip.addEventListener('pointerleave',scheduleHide);
  const show=button=>{
    clearTimeout(hideTimer);activeButton=button;
    const d=days.find(d=>d.date===button.dataset.day);if(!d)return;
    tooltip.innerHTML=`<b>${dateLabel(d.date)}</b><div class="pd-tip-total">${fmt(d.total)} <span>Token</span></div>${models.map((m,i)=>`<div class="pd-tip-row"><span><i style="--model-color:${m.color}"></i>${esc(m.name)}</span><b>${fmt(d.values[i])}</b></div>`).join('')}${d.total?'':'<p>当天未使用</p>'}`;
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
document.addEventListener('scroll',()=>{const tip=document.querySelector('.pd-tooltip');if(tip)tip.hidden=true;},true);
window.addEventListener('resize',()=>{const tip=document.querySelector('.pd-tooltip');if(tip)tip.hidden=true;});
new MutationObserver(()=>{if(document.querySelector('.personal-home:not(:has(.pd-usage))'))render();}).observe(document.body,{childList:true,subtree:true});
render();
