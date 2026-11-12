// Company-wide and per-organization gates in front of KerAPI (owner decision 2026-11-12, docs/14-gateway-settings.md C6/C10).
// Two shared resources run out before anything else: the gateway's own CPU (about 60 requests at once on 0.75 cores) and
// KerAPI's 20 million tokens per minute on our single key, cache hits included, with a 429 for everyone beyond it.
// The gates stop new requests before either is reached and say which layer is full, so one organization's burst cannot
// push the whole company into KerAPI's 429. Requests already running are never cut.
// The gateway is one Node process, so the counters live in memory: a restart empties them, and a call left pending by a
// crash never holds a slot.
import { HttpError, audit, transaction } from './core.mjs';
import { requireTechnical } from './workspaces.mjs';

export const GATEWAY_DEFAULTS=Object.freeze({max_concurrent:50,tpm:15000000,org_max_concurrent:10,org_tpm:2000000});
export const CONCURRENT_RANGE=[1,1000],TPM_RANGE=[1000,1000000000];
const WINDOW_MS=60000;
// Input is reserved at admission from the request size; the measured average is about 6.4 bytes per input token, so
// 4 bytes per token reserves a little more than the real count. Completion replaces it with the real input and output.
export const BYTES_PER_TOKEN=4;
export const estimateTokens=bytes=>Math.ceil(bytes/BYTES_PER_TOKEN);
const amount=n=>n>=10000?`${Math.round(n/1000)/10} 万`:String(n);

/** In-memory counters for one gateway process. */
export function createGate(now=()=>Date.now()){
 // running: reservations of calls still open, counted until they end. window: tokens of finished calls, each counted for
 // the 60 seconds after its call ended. A call therefore counts from its start until a minute after it ends.
 let active=0;const orgActive=new Map(),running=new Set(),window=[];
 const prune=()=>{const cut=now()-WINDOW_MS;while(window.length&&window[0].at<=cut)window.shift();};
 const used=org=>{prune();let all=0,mine=0;for(const e of [...running,...window]){all+=e.n;if(e.org===org)mine+=e.n;}return {all,mine};};
 // Seconds until enough finished calls have left the window for `need` more tokens to fit under `limit`.
 const wait=(org,need,limit,scope)=>{
  const u=used(org);let total=(scope==='all'?u.all:u.mine)+need;
  for(const e of window){if(scope!=='all'&&e.org!==org)continue;total-=e.n;if(total<=limit)return Math.max(1,Math.ceil((e.at+WINDOW_MS-now())/1000));}
  return WINDOW_MS/1000;
 };
 return {
  /** Admits one request or throws a 429 saying which layer is full. Synchronous, so check and reservation cannot interleave. */
  admit(org,estimate,limits){
   const fail=(code,message,retry,layer,kind)=>{console.warn(JSON.stringify({event:'gateway_limit',layer,kind,org}));throw Object.assign(new HttpError(429,message,code),{retryAfter:retry});};
   const mineActive=orgActive.get(org)||0,{all,mine}=used(org);
   if(active>=limits.max_concurrent)fail('gateway_busy',`公司总通道繁忙：全平台同时进行的请求已达 ${limits.max_concurrent} 个上限，请几秒后重试。这不是你的额度问题`,5,'company','concurrency');
   if(all+estimate>limits.tpm)fail('gateway_busy',`公司总通道繁忙：全平台最近一分钟的 Token 用量已到上限，请稍后重试。这不是你的额度问题`,wait(org,estimate,limits.tpm,'all'),'company','tpm');
   if(mineActive>=limits.org_max_concurrent)fail('organization_limit_exceeded',`贵公司同时进行的请求已达 ${limits.org_max_concurrent} 个上限，请等其他请求完成后重试`,5,'organization','concurrency');
   if(mine+estimate>limits.org_tpm)fail('organization_limit_exceeded',`贵公司最近一分钟已用约 ${amount(mine)} Token，上限 ${amount(limits.org_tpm)}（输入加输出，含缓存命中），请稍后重试`,wait(org,estimate,limits.org_tpm,'mine'),'organization','tpm');
   active++;orgActive.set(org,mineActive+1);const reserved={org,n:estimate};running.add(reserved);
   let open=true,counted=null,finished=null;
   const close=n=>{if(!open)return;open=false;running.delete(reserved);if(n){finished={at:now(),org,n};window.push(finished);}active--;const left=(orgActive.get(org)||1)-1;if(left>0)orgActive.set(org,left);else orgActive.delete(org);};
   return {
    /** Records what KerAPI counted: input (cache hits included) plus output. Replaces the admission estimate. */
    // A caller that hung up mid-stream frees the slot first; the real count still replaces the estimate when it arrives.
    settle(usage){if(!usage)return;counted=usage.input+usage.output;if(finished)finished.n=counted;},
    /** The call has ended: its tokens (real ones, or the estimate when KerAPI reported none) stay counted for 60 seconds. */
    release(){close(counted??estimate);},
    /** The call never reached KerAPI (refused by a later check): frees the slot and counts nothing. */
    cancel(){close(0);}
   };
  },
  snapshot(){prune();const tpm=new Map();for(const e of [...running,...window])tpm.set(e.org,(tpm.get(e.org)||0)+e.n);const orgs=new Set([...orgActive.keys(),...tpm.keys()]);
   return {active,tpm:[...tpm.values()].reduce((a,b)=>a+b,0),organizations:[...orgs].map(id=>({id,active:orgActive.get(id)||0,tpm:tpm.get(id)||0}))};}
 };
}

/** The limits that apply to one organization: its own values where staff set them, the platform defaults otherwise. */
export async function gatewayLimits(db,org){
 const r=(await db.query(`SELECT g.max_concurrent,g.tpm,coalesce(o.max_concurrent,g.org_max_concurrent) AS org_max_concurrent,coalesce(o.tpm,g.org_tpm) AS org_tpm
  FROM gateway_limits g LEFT JOIN organizations o ON o.id=$1 WHERE g.id`,[org||null])).rows[0];
 return r?{max_concurrent:r.max_concurrent,tpm:Number(r.tpm),org_max_concurrent:r.org_max_concurrent,org_tpm:Number(r.org_tpm)}:{...GATEWAY_DEFAULTS};
}

const whole=(value,label,[min,max],{optional=false}={})=>{
 if(optional&&(value===null||value===undefined||value===''))return null;
 const n=typeof value==='string'&&/^\d+$/.test(value.trim())?Number(value):value;
 if(!Number.isInteger(n)||n<min||n>max)throw new HttpError(400,`${label}必须是 ${min} 至 ${max} 之间的整数${optional?'，留空表示用默认值':''}`);
 return n;
};

export function gatewayLimitRoutes(app,pool,requireStaff,gate){
 const view=async()=>{
  const [settings,orgs]=await Promise.all([pool.query('SELECT max_concurrent,tpm,org_max_concurrent,org_tpm,updated_by,updated_at FROM gateway_limits WHERE id'),
   pool.query('SELECT id,name,max_concurrent,tpm,limits_updated_at FROM organizations ORDER BY (max_concurrent IS NOT NULL OR tpm IS NOT NULL) DESC,created_at LIMIT 500')]);
  const s=settings.rows[0],live=gate.snapshot(),now=new Map(live.organizations.map(o=>[o.id,o]));
  return {settings:{...s,tpm:Number(s.tpm),org_tpm:Number(s.org_tpm)},live:{active:live.active,tpm:live.tpm},
   organizations:orgs.rows.map(o=>({id:o.id,name:o.name,max_concurrent:o.max_concurrent,tpm:o.tpm===null?null:Number(o.tpm),limits_updated_at:o.limits_updated_at,
    effective:{max_concurrent:o.max_concurrent??s.org_max_concurrent,tpm:Number(o.tpm??s.org_tpm)},active:now.get(o.id)?.active||0,tpm_now:now.get(o.id)?.tpm||0}))};
 };
 app.get('/api/staff/lab/gateway-limits',requireStaff,async(req,res)=>{requireTechnical(req);res.json(await view());});
 app.post('/api/staff/lab/gateway-limits',requireStaff,async(req,res)=>{
  requireTechnical(req);const b=req.body||{};
  const next={max_concurrent:whole(b.max_concurrent,'全平台同时请求数',CONCURRENT_RANGE),tpm:whole(b.tpm,'全平台每分钟 Token 数',TPM_RANGE),
   org_max_concurrent:whole(b.org_max_concurrent,'每个企业默认同时请求数',CONCURRENT_RANGE),org_tpm:whole(b.org_tpm,'每个企业默认每分钟 Token 数',TPM_RANGE)};
  await transaction(pool,async db=>{
   const before=(await db.query('SELECT max_concurrent,tpm,org_max_concurrent,org_tpm FROM gateway_limits WHERE id FOR UPDATE')).rows[0];
   await db.query('UPDATE gateway_limits SET max_concurrent=$1,tpm=$2,org_max_concurrent=$3,org_tpm=$4,updated_by=$5,updated_at=now() WHERE id',[next.max_concurrent,next.tpm,next.org_max_concurrent,next.org_tpm,req.staff.subject]);
   await audit(db,req.actor,'gateway.limits_set',null,'gateway',{before:{...before,tpm:Number(before.tpm),org_tpm:Number(before.org_tpm)},after:next});
  });
  res.json(await view());
 });
 app.post('/api/staff/lab/gateway-limits/organizations/:org',requireStaff,async(req,res)=>{
  requireTechnical(req);const b=req.body||{};
  if(!/^[0-9a-f-]{36}$/i.test(req.params.org))throw new HttpError(404,'企业不存在');
  const max=whole(b.max_concurrent,'这家企业的同时请求数',CONCURRENT_RANGE,{optional:true}),tpm=whole(b.tpm,'这家企业的每分钟 Token 数',TPM_RANGE,{optional:true});
  await transaction(pool,async db=>{
   const before=(await db.query('SELECT max_concurrent,tpm FROM organizations WHERE id=$1 FOR UPDATE',[req.params.org])).rows[0];
   if(!before)throw new HttpError(404,'企业不存在');
   await db.query('UPDATE organizations SET max_concurrent=$2,tpm=$3,limits_updated_at=now() WHERE id=$1',[req.params.org,max,tpm]);
   await audit(db,req.actor,'gateway.organization_limits_set',req.params.org,req.params.org,{before:{max_concurrent:before.max_concurrent,tpm:before.tpm===null?null:Number(before.tpm)},after:{max_concurrent:max,tpm}});
  });
  res.json(await view());
 });
}
