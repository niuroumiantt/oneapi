// Cloud cost and capacity model for the employee gateway (docs/15-aliyun-capacity-and-cost.md).
// Read-only: usage comes from employee_calls, gateway load from this process's own cgroup, prices from the defaults below.
import {readFileSync} from 'node:fs';
import v8 from 'node:v8';
import {HttpError} from './core.mjs';
import {requireTechnical} from './workspaces.mjs';

const OFFICIAL='阿里云价格计算器 · 华北1（青岛）· 2026-11-12 查询';
// Every default names where it came from; staff can override the adjustable ones per request to try "what if".
export const ASSUMPTIONS={
 egress_yuan_per_gb:{value:0.72,unit:'元/GB',source:OFFICIAL+' · ECS 按使用流量，只收出方向',adjustable:[0,10]},
 bytes_per_input_token:{value:6.32,unit:'字节',source:'实测：整机出方向流量对网关 Token 回归，217 个 10 分钟时段，R²=0.93（2026-11-12）'},
 bytes_per_output_token:{value:6.2,unit:'字节',source:'同上回归；流式回答开销很小'},
 instance_monthly:{value:71.28,unit:'元/月',source:OFFICIAL+' · ecs.e-c1m4.large 2 核 8 GiB 包月折扣价（年付折合 ¥55.08）；实付价待确认',adjustable:[0,100000]},
 disks_monthly:{value:49,unit:'元/月',source:OFFICIAL+' · 40 GiB 系统盘 + 100 GiB 数据盘，按 ESSD Entry ¥0.35/GiB；数据盘类型待确认'},
 gateway_share:{value:0.25,unit:'比例',source:'估算：整机由网关、官网、OA、邮件等共用；网关与数据库的 CPU 上限占 1.25/2 核，内存上限占 11%，取 25% 分摊',adjustable:[0,1]},
 cpu_per_slot:{value:0.012,unit:'核/路',source:'实测：网关重启后 31 分钟 811 次调用用了 143 CPU 秒，平均每路并发约 0.012 核',adjustable:[0.001,1]},
 cpu_target:{value:0.7,unit:'比例',source:'规划余量：CPU 用到 70% 视为满'},
 peak_mbps:{value:100,unit:'Mbps',source:'按使用流量时设置的峰值带宽；实测单连接已到 15.5 Mbps，控制台实际设置待确认',adjustable:[1,10000]},
 kerapi_tpm:{value:20000000,unit:'Token/分钟',source:'KerAPI 口头告知（负责人转述），是否计入缓存命中未确认',adjustable:[0,1e10]},
 dedicated_monthly:{value:85.28,unit:'元/月',source:OFFICIAL+' · 网关专用 e-c1m4.large ¥71.28 + 40 GiB ESSD Entry ¥14'},
 dedicated_vcpu:{value:2,unit:'核',source:'e-c1m4.large'},
 scale:{value:10,unit:'倍',source:'自定义规模倍数',adjustable:[0.1,10000]}
};
// Qingdao economy instances; the planner picks the cheapest whole-number mix of one type. Disk per instance: 40 GiB ESSD Entry.
export const CATALOG=[['ecs.e-c1m4.large',2,8,71.28],['ecs.e-c1m2.xlarge',4,8,159.84],['ecs.e-c1m4.xlarge',4,16,239.76],['ecs.e-c1m2.2xlarge',8,16,319.68]].map(([type,vcpu,memory_gib,monthly])=>({type,vcpu,memory_gib,monthly,disk_monthly:14}));
// Prepaid fixed bandwidth in Qingdao: 1–5 Mbps stepped, then ¥72 for each further Mbps.
export function fixedBandwidthMonthly(mbps){const n=Math.max(1,Math.ceil(mbps));return n<=5?[20.7,41.4,63.9,86.4,112.5][n-1]:112.5+(n-5)*72;}

export function assumptions(query={}){
 const out={};
 for(const [k,d] of Object.entries(ASSUMPTIONS)){
  let value=d.value,overridden=false;
  if(d.adjustable&&query[k]!==undefined&&query[k]!==''){const n=Number(query[k]);if(!Number.isFinite(n)||n<d.adjustable[0]||n>d.adjustable[1])throw new HttpError(400,`假设 ${k} 超出范围`);value=n;overridden=n!==d.value;}
  out[k]={...d,value,default:d.value,overridden};
 }
 return out;
}

const r=(v,d=6)=>v==null||!Number.isFinite(v)?null:Number(v.toFixed(d));
// One machine while one is enough (several need a load balancer and more upkeep); beyond that, the fewest of the largest size.
function plan(vcpu){
 const need=Math.max(vcpu,0.001),single=CATALOG.filter(t=>t.vcpu>=need).sort((a,b)=>a.monthly-b.monthly)[0];
 const t=single||CATALOG.reduce((a,b)=>b.vcpu>a.vcpu?b:a),count=single?1:Math.ceil(need/t.vcpu);
 return {type:t.type,count,vcpu:count*t.vcpu,monthly:count*(t.monthly+t.disk_monthly)};
}

/** Turns measured usage into costs, per-slot figures, capacity limits and scale projections. Pure; tested. */
export function capacityModel(u,gateway,a){
 const v=k=>a[k].value,days=u.days,month=30/days;
 const egress=(i,o)=>i*v('bytes_per_input_token')+o*v('bytes_per_output_token');
 const yuan=bytes=>bytes/1e9*v('egress_yuan_per_gb');
 const egressBytes=egress(u.input_tokens,u.output_tokens),bandwidth=yuan(egressBytes);
 const serverMonthly=v('instance_monthly')+v('disks_monthly'),hardwareMonthly=serverMonthly*v('gateway_share');
 const busy=u.busy_seconds>0?u.busy_seconds:null;
 const slot={
  avg_concurrency:r(u.busy_seconds/(days*86400),3),
  egress_mbps:busy&&r(egressBytes*8/busy/1e6,4),
  tpm_all:busy&&Math.round((u.input_tokens+u.output_tokens)/busy*60),
  tpm_uncached:busy&&Math.round((u.input_tokens-u.cached_input_tokens+u.output_tokens)/busy*60),
  dedicated_slots:Math.floor(v('dedicated_vcpu')*v('cpu_target')/v('cpu_per_slot'))
 };
 slot.hardware_monthly=r(v('dedicated_monthly')/slot.dedicated_slots,4);
 slot.bandwidth_hour=busy&&r(yuan(egressBytes/busy*3600),5);
 slot.bandwidth_month_workday=slot.bandwidth_hour&&r(slot.bandwidth_hour*176,2);
 slot.bandwidth_month_full=slot.bandwidth_hour&&r(slot.bandwidth_hour*720,2);
 const limits=[
  {key:'gateway_cpu',label:'网关 CPU 上限',short:'网关 CPU',slots:gateway.cpu_limit_cores?Math.floor(gateway.cpu_limit_cores*v('cpu_target')/v('cpu_per_slot')):null,basis:gateway.cpu_limit_cores?`${gateway.cpu_limit_cores} 核 × ${v('cpu_target')*100}% ÷ ${v('cpu_per_slot')} 核/路`:'本进程没有 CPU 上限，按整机算'},
  {key:'bandwidth',label:'出口带宽',short:'出口带宽',slots:slot.egress_mbps?Math.floor(v('peak_mbps')/slot.egress_mbps):null,basis:slot.egress_mbps?`${v('peak_mbps')} Mbps ÷ 每路 ${slot.egress_mbps} Mbps`:'窗口内没有完成的调用'},
  {key:'kerapi_all',label:'KerAPI TPM（缓存命中计入）',short:'KerAPI TPM',slots:slot.tpm_all?Math.floor(v('kerapi_tpm')/slot.tpm_all):null,basis:slot.tpm_all?`${v('kerapi_tpm').toLocaleString('en')} ÷ 每路 ${slot.tpm_all.toLocaleString('en')} TPM`:'窗口内没有完成的调用'},
  {key:'kerapi_uncached',label:'KerAPI TPM（缓存命中不计入）',slots:slot.tpm_uncached?Math.floor(v('kerapi_tpm')/slot.tpm_uncached):null,basis:slot.tpm_uncached?`${v('kerapi_tpm').toLocaleString('en')} ÷ 每路 ${slot.tpm_uncached.toLocaleString('en')} TPM`:'窗口内没有完成的调用'}
 ];
 const known=limits.filter(x=>x.slots!=null&&x.key!=='kerapi_uncached');
 const first=known.length?known.reduce((m,x)=>x.slots<m.slots?x:m):null;
 const peakEgress=egress(u.peak_minute.input_tokens,u.peak_minute.output_tokens);
 const monthly={calls:Math.round(u.calls*month),egress_gb:r(egressBytes/1e9*month,3),bandwidth:r(bandwidth*month,2),hardware:r(hardwareMonthly,2),revenue:r(u.revenue_yuan*month,2)};
 monthly.total=r(monthly.bandwidth+monthly.hardware,2);monthly.cost_ratio=monthly.revenue?r(monthly.total/monthly.revenue,4):null;
 const fits=vcpu=>gateway.cpu_limit_cores?vcpu<=gateway.cpu_limit_cores:false;
 const scales=[...new Set([1,10,100,v('scale')])].map(m=>{
  const peak=u.peak_concurrency*m,vcpu=peak*v('cpu_per_slot')/v('cpu_target'),shared=m===1||fits(vcpu);
  const p=shared?{type:'现有共享机器',count:1,vcpu:gateway.cpu_limit_cores,monthly:hardwareMonthly}:plan(vcpu);
  const bw=monthly.bandwidth*m,revenue=monthly.revenue*m,total=p.monthly+bw,calls=monthly.calls*m;
  const fixedMbps=peakEgress*8/60/1e6*m;
  return {multiplier:m,calls,egress_gb:r(monthly.egress_gb*m,2),bandwidth:r(bw,2),peak_concurrency:Math.round(peak),vcpu_needed:r(vcpu,2),plan:p.type,instances:p.count,server:r(p.monthly,2),total:r(total,2),per_call:calls?r(total/calls,6):null,revenue:r(revenue,2),cost_ratio:revenue?r(total/revenue,4):null,fixed_mbps:r(fixedMbps,2),fixed_bandwidth_monthly:fixedBandwidthMonthly(fixedMbps)};
 });
 const row=x=>{const b=egress(x.input_tokens,x.output_tokens),cost=yuan(b);return {...x,egress_mb:r(b/1e6,3),bandwidth:r(cost,6),bandwidth_per_call:x.calls?r(cost/x.calls,6):null,revenue_per_call:x.calls?r(x.revenue_yuan/x.calls,5):null,bandwidth_ratio:x.revenue_yuan?r(cost/x.revenue_yuan,5):null}};
 return {
  window:{days,calls:u.calls,egress_gb:r(egressBytes/1e9,4),bandwidth:r(bandwidth,4),revenue:r(u.revenue_yuan,2),bandwidth_per_call:u.calls?r(bandwidth/u.calls,6):null,bandwidth_ratio:u.revenue_yuan?r(bandwidth/u.revenue_yuan,5):null,per_million_input:r(yuan(1e6*v('bytes_per_input_token')),5)},
  monthly,slot,limits,first_limit:first&&{key:first.key,label:first.label,short:first.short,slots:first.slots},
  peak_minute:{...u.peak_minute,egress_mbps:r(peakEgress*8/60/1e6,3),tpm_share:r((u.peak_minute.input_tokens+u.peak_minute.output_tokens)/v('kerapi_tpm'),4)},
  scales,
  clients:u.clients.map(row),
  people:u.persons.map(x=>{const y=row(x);return {...y,hardware_monthly:r(x.peak_concurrency*slot.hardware_monthly,2),monthly_total:r(y.bandwidth*month+x.peak_concurrency*slot.hardware_monthly,2),monthly_revenue:r(x.revenue_yuan*month,2)}})
 };
}

// The gateway reads its own cgroup v2 files; on a laptop without them every field is null.
const read=f=>{try{return readFileSync('/sys/fs/cgroup/'+f,'utf8').trim()}catch{return null}};
export function parseCgroup(files){
 const stat=Object.fromEntries((files.cpuStat||'').split('\n').map(l=>l.split(' ')).filter(p=>p.length===2).map(([k,v])=>[k,Number(v)]));
 const [quota,period]=(files.cpuMax||'').split(' ');const limit=quota&&quota!=='max'&&Number(period)>0?Number(quota)/Number(period):null;
 const num=x=>x&&x!=='max'&&Number.isFinite(Number(x))?Number(x):null;
 return {usage_usec:stat.usage_usec??null,nr_periods:stat.nr_periods??null,nr_throttled:stat.nr_throttled??null,cpu_limit_cores:limit,memory_bytes:num(files.memoryCurrent),memory_limit_bytes:num(files.memoryMax),memory_peak_bytes:num(files.memoryPeak)};
}
const sampleNow=()=>({at:Date.now(),...parseCgroup({cpuStat:read('cpu.stat'),cpuMax:read('cpu.max'),memoryCurrent:read('memory.current'),memoryMax:read('memory.max'),memoryPeak:read('memory.peak')})});
const samples=[];let timer=null;
function startSampler(){if(timer)return;samples.push(sampleNow());timer=setInterval(()=>{samples.push(sampleNow());if(samples.length>41)samples.shift();},15000);timer.unref?.();}
export function gatewayStats(now=sampleNow(),history=samples){
 const old=history.find(s=>now.at-s.at>=10000&&now.at-s.at<=11*60000);
 const dt=old&&(now.at-old.at)/1000;
 const used=old&&now.usage_usec!=null&&old.usage_usec!=null?(now.usage_usec-old.usage_usec)/1e6/dt:null;
 const periods=old&&now.nr_periods!=null?now.nr_periods-old.nr_periods:null,throttled=old&&now.nr_throttled!=null?now.nr_throttled-old.nr_throttled:null;
 const m=process.memoryUsage(),heap=v8.getHeapStatistics();
 return {cpu_limit_cores:now.cpu_limit_cores,cpu_used_cores:r(used,3),cpu_window_seconds:dt?Math.round(dt):null,throttled_share:periods?r(throttled/periods,4):null,throttled_periods:throttled,
  cpu_avg_since_start:now.usage_usec!=null?r(now.usage_usec/1e6/process.uptime(),3):null,memory_bytes:now.memory_bytes??m.rss,memory_limit_bytes:now.memory_limit_bytes,memory_peak_bytes:now.memory_peak_bytes,
  heap_used_bytes:m.heapUsed,heap_limit_bytes:heap.heap_size_limit,uptime_seconds:Math.round(process.uptime())};
}

const OK="status IN ('settled','awaiting_bill') AND error_code IS NULL";
// A pending call older than the 15-minute total limit was cut by a restart; it is not occupying anything now.
const END="CASE WHEN finished_at IS NOT NULL THEN finished_at WHEN status='pending' AND created_at>now()-interval '16 minutes' THEN now() ELSE created_at END";
const AGG=`count(*)::int AS calls,count(DISTINCT owner_id)::int AS people,count(*) FILTER(WHERE ${OK})::int AS ok,count(*) FILTER(WHERE error_code='CLIENT_CLOSED')::int AS client_closed,
 count(*) FILTER(WHERE status='failed' AND error_code IS DISTINCT FROM 'CLIENT_CLOSED')::int AS failed,coalesce(sum(input_tokens),0)::float8 AS input_tokens,coalesce(sum(cached_input_tokens),0)::float8 AS cached_input_tokens,
 coalesce(sum(output_tokens),0)::float8 AS output_tokens,coalesce(sum(charged_yuan),0)::float8 AS revenue_yuan,coalesce(sum(extract(epoch FROM (${END})-created_at)),0)::float8 AS busy_seconds,
 coalesce(round(avg(input_tokens)),0)::int AS avg_input_tokens,coalesce(round(avg(latency_ms) FILTER(WHERE ${OK})),0)::int AS avg_latency_ms`;

export async function readUsage(pool,days){
 const since=`now()-$1::int*interval '1 day'`;
 const [sum,clients,people,conc,hours,minute,active]=await Promise.all([
  pool.query(`SELECT ${AGG},count(DISTINCT key_id)::int AS keys FROM employee_calls WHERE created_at>=${since}`,[days]),
  pool.query(`SELECT coalesce(nullif(client,''),'未识别') AS name,${AGG} FROM employee_calls WHERE created_at>=${since} GROUP BY 1 ORDER BY calls DESC LIMIT 30`,[days]),
  pool.query(`SELECT p.*,coalesce(nullif(u.name,''),u.email,'未知员工') AS name,u.email FROM (SELECT owner_id,string_agg(DISTINCT coalesce(nullif(client,''),'未识别'),'、') AS tools,${AGG} FROM employee_calls WHERE created_at>=${since} GROUP BY owner_id) p LEFT JOIN "user" u ON u.id=p.owner_id ORDER BY p.calls DESC LIMIT 200`,[days]),
  pool.query(`WITH c AS (SELECT owner_id,created_at AS s,${END} AS e FROM employee_calls WHERE created_at>=${since}),
   ev AS (SELECT owner_id,s AS t,1 AS d FROM c UNION ALL SELECT owner_id,greatest(e,s),-1 FROM c),
   run AS (SELECT owner_id,t,sum(d) OVER (ORDER BY t,d ROWS UNBOUNDED PRECEDING) AS total,sum(d) OVER (PARTITION BY owner_id ORDER BY t,d ROWS UNBOUNDED PRECEDING) AS mine FROM ev)
   SELECT (SELECT json_build_object('peak',max(total),'at',(SELECT t FROM run ORDER BY total DESC,t LIMIT 1)) FROM run) AS overall,
    (SELECT coalesce(json_object_agg(owner_id,peak),'{}') FROM (SELECT owner_id,max(mine) AS peak FROM run GROUP BY owner_id) p) AS people,
    (SELECT coalesce(json_object_agg(h,peak),'{}') FROM (SELECT to_char(date_trunc('hour',t AT TIME ZONE 'Asia/Shanghai'),'YYYY-MM-DD"T"HH24') AS h,max(total) AS peak FROM run GROUP BY 1) x) AS hours`,[days]),
  pool.query(`WITH h AS (SELECT generate_series(date_trunc('hour',(${since}) AT TIME ZONE 'Asia/Shanghai'),date_trunc('hour',now() AT TIME ZONE 'Asia/Shanghai'),interval '1 hour') AS hour),
   c AS (SELECT date_trunc('hour',created_at AT TIME ZONE 'Asia/Shanghai') AS hour,count(*)::int AS calls,count(DISTINCT owner_id)::int AS people,coalesce(sum(input_tokens),0)::float8 AS input_tokens,coalesce(sum(output_tokens),0)::float8 AS output_tokens,
    coalesce(sum(extract(epoch FROM (${END})-created_at)),0)::float8/3600 AS avg_concurrency FROM employee_calls WHERE created_at>=${since} GROUP BY 1)
   SELECT to_char(h.hour,'YYYY-MM-DD"T"HH24') AS hour,coalesce(c.calls,0) AS calls,coalesce(c.people,0) AS people,coalesce(c.input_tokens,0) AS input_tokens,coalesce(c.output_tokens,0) AS output_tokens,coalesce(c.avg_concurrency,0) AS avg_concurrency FROM h LEFT JOIN c USING(hour) ORDER BY h.hour`,[days]),
  pool.query(`SELECT date_trunc('minute',created_at) AS at,coalesce(sum(input_tokens),0)::float8 AS input_tokens,coalesce(sum(cached_input_tokens),0)::float8 AS cached_input_tokens,coalesce(sum(output_tokens),0)::float8 AS output_tokens FROM employee_calls WHERE created_at>=${since} GROUP BY 1 ORDER BY coalesce(sum(input_tokens),0)+coalesce(sum(output_tokens),0) DESC LIMIT 1`,[days]),
  pool.query(`SELECT count(*)::int AS n FROM employee_calls WHERE status='pending' AND created_at>now()-interval '16 minutes'`)
 ]);
 const c=conc.rows[0],peaks=c.people||{},hourPeaks=c.hours||{};
 return {days,...sum.rows[0],clients:clients.rows,
  persons:people.rows.map(({owner_id,...x})=>({...x,peak_concurrency:Number(peaks[owner_id]||0)})),
  peak_concurrency:Number(c.overall?.peak||0),peak_at:c.overall?.at||null,active_now:active.rows[0].n,
  hours:hours.rows.map(h=>({...h,avg_concurrency:Number(h.avg_concurrency.toFixed(3)),peak_concurrency:Number(hourPeaks[h.hour]||0)})),
  peak_minute:minute.rows[0]||{at:null,input_tokens:0,cached_input_tokens:0,output_tokens:0}};
}

export function capacityRoutes(app,pool,requireStaff){
 startSampler();
 app.get('/api/staff/capacity',requireStaff,async(req,res)=>{
  requireTechnical(req);
  const days=Number(req.query.days||1);if(![1,7,30].includes(days))throw new HttpError(400,'时间范围只能是 1、7 或 30 天');
  const a=assumptions(req.query),usage=await readUsage(pool,days),gateway=gatewayStats();
  res.json({generated_at:new Date().toISOString(),days,usage:{...usage,clients:undefined,persons:undefined},gateway,assumptions:a,catalog:CATALOG,model:capacityModel(usage,gateway,a)});
 });
}
