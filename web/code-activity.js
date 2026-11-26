(()=>{'use strict';
const $=s=>document.querySelector(s),args=new URLSearchParams(location.search),personal=args.get('audience')==='personal',audience=args.get('audience')==='staff'?'staff':'customer';
let kind=args.get('kind')||'cw',code=args.get('code')||'',type='paid',page=0,size=3,request=0,lastCount=0;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'¥'+Number(Number(v||0)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:12});
const now=new Date();$('#month').value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(now);
const time=v=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));
async function get(url){const r=await fetch(url,{credentials:'same-origin',cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'暂时无法读取，请重试');return d;}
function fit(){return Math.max(1,Math.min(12,Math.floor(($('#records').getBoundingClientRect().height-32)/(innerWidth<650?60:48))));}
async function load(){if(!code)return;const version=++request;$('#records').innerHTML='<p role="status">正在读取明细…</p>';$('#prev').disabled=$('#next').disabled=true;size=fit();
 try{const d=await get(`/api/code-activity/${audience}/${encodeURIComponent(kind)}/${encodeURIComponent(code)}?`+new URLSearchParams({month:$('#month').value,type,page,size}));if(version!==request)return;
 $('#code-label').textContent=(d.name?d.name+' · ':'')+d.code;lastCount=d.count;
 $('#totals').innerHTML=[['客户实付',d.totals.paid_fen],['实际消费（实付部分）',d.totals.used_fen],['退款扣减',d.totals.refunded_fen],...(d.commission?[['消费提成（税前）',d.totals.commission_fen]]:[])].map(([k,v])=>`<div><span>${esc(k)}</span><strong>${money(v)}</strong></div>`).join('');
 const labels=type==='paid'?['实付金额','到账额度']:type==='used'?['实付消耗','额度消耗']:['退款扣减','实际退回'];
 $('#note').textContent=type==='used'?'额度消耗含赠送部分；实付消耗用于计算提成。时间为北京时间，编号已脱敏。':type==='refund'?'退款扣减为扣除的实付本金；实际退回为扣除相关手续费后退回的金额。':'实付与消费按各自发生月份统计。同一匿名订单编号可核对后续消费及退款。';
 $('#records').innerHTML=d.items.length?`<table><thead><tr><th>时间 / 匿名订单</th><th>${labels[0]}</th><th>${labels[1]}</th><th class="extra">${type==='used'?'模型 / 提成':'记录编号'}</th></tr></thead><tbody>${d.items.map(r=>`<tr><td>${time(r.occurred_at)}<small>${esc(r.reference)}</small></td><td class="amount">${money(r.cash_fen)}${type==='used'?`<small class="mobile-extra">${esc(r.model_id)}</small>`:''}</td><td class="amount">${money(r.face_fen)}${d.commission&&type==='used'?`<small class="mobile-extra">提成 ${money(r.commission_fen)}</small>`:''}</td><td class="extra">${type==='used'?esc(r.model_id):esc(r.event_reference)}${type==='used'&&d.commission?`<small>提成 ${money(r.commission_fen)}</small>`:''}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">所选期间暂无这类记录。</p>';
 $('#page-info').textContent=`共 ${d.count} 条 · ${page+1} / ${Math.max(1,Math.ceil(d.count/size))} 页`;$('#prev').disabled=page===0;$('#next').disabled=(page+1)*size>=d.count;
 const fitted=fit();if(fitted!==size){page=0;load();}
 }catch(e){if(version!==request)return;$('#totals').innerHTML='';$('#records').innerHTML=`<p class="error">${esc(e.message)}</p>`;$('#page-info').textContent='';}}
$('#back').onclick=()=>{if(parent!==window)parent.postMessage({type:'semifly-code-activity-close'},location.origin);else location.href='/#billing/personal';};
$('#refresh').onclick=()=>load();$('#month').onchange=()=>{page=0;load();};$('#all').onclick=()=>{$('#month').value='';page=0;load();};
document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{type=b.dataset.type;page=0;document.querySelectorAll('[data-type]').forEach(x=>x.setAttribute('aria-current',x===b?'page':'false'));load();});
$('#prev').onclick=()=>{page=Math.max(0,page-1);load();};$('#next').onclick=()=>{if((page+1)*size<lastCount){page++;load();}};
let resize;addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(()=>{if(code&&fit()!==size){page=0;load();}},100);});
(async()=>{try{if(personal){const d=await get('/api/code-activity/personal');if(!d.codes.length){$('#code-label').textContent='我的优惠码';$('#records').innerHTML='<p class="empty">使用优惠码充值后，可在这里查看每个码的付款与使用记录。</p>';return;}$('#code-picker').hidden=false;$('#codes').innerHTML=d.codes.map(c=>`<option value="${esc(c.id)}">${esc(c.code)}</option>`).join('');kind='order';code=d.codes[0].id;$('#codes').onchange=()=>{code=$('#codes').value;page=0;load();};}await load();}catch(e){$('#records').textContent=e.message;}})();
})();
