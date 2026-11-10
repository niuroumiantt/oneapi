import {readFile} from 'node:fs/promises';
import {requireTechnical} from './workspaces.mjs';
const numeric=(v,max=Number.MAX_SAFE_INTEGER)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:null;
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v)?v:null;
// Whitelist the public-to-staff projection; never return arbitrary host file fields.
export function projectMetrics(raw,now=Date.now()) {
 if(raw?.schema!==1||!stamp(raw.collected_at))throw Error('INVALID_SNAPSHOT');
 const age=(now-Date.parse(raw.collected_at))/1000,stale=age>60||age< -5;
 const result={status:stale?'stale':'ok',collected_at:stamp(raw.collected_at),age_seconds:Math.max(0,Math.round(age)),scope:'shared_host',
  sample_seconds:numeric(raw.sample_seconds,120),cpu_percent:numeric(raw.cpu_percent,100),cpu_cores:numeric(raw.cpu_cores,65536),
  memory_total_bytes:numeric(raw.memory_total_bytes),memory_used_bytes:numeric(raw.memory_used_bytes),
  disk_total_bytes:numeric(raw.disk_total_bytes),disk_used_bytes:numeric(raw.disk_used_bytes),uptime_seconds:numeric(raw.uptime_seconds),
  network:{interface:typeof raw.network?.interface==='string'&&/^[a-zA-Z0-9_.:-]{1,32}$/.test(raw.network.interface)?raw.network.interface:null,rx_bps:numeric(raw.network?.rx_bps),tx_bps:numeric(raw.network?.tx_bps)},
  services:['api','database','edge'].map(name=>{const s=raw.services?.find(x=>x.name===name)||{};return {name,status:['running','exited','restarting','dead','paused','created'].includes(s.status)?s.status:'unknown',health:['healthy','unhealthy','starting'].includes(s.health)?s.health:null,restarts:numeric(s.restarts),started_at:stamp(s.started_at),image:typeof s.image==='string'&&/^[\w./:@-]{1,240}$/.test(s.image)?s.image:null}}),
  local_probe:{ok:raw.local_probe?.ok===true,latency_ms:numeric(raw.local_probe?.latency_ms)},
  deployment:{api_sha:sha(raw.deployment?.api_sha),web_sha:sha(raw.deployment?.web_sha)}};
 return result;
}
export function serverObservationRoutes(app,pool,requireStaff,cfg) {
 app.get('/api/staff/observability',requireStaff,async(req,res)=>{
  requireTechnical(req);
  let result;
  try{const raw=await readFile(cfg.metricsFile||process.env.ONEAPI_METRICS_FILE||'/run/oneapi-observability/snapshot.json','utf8');if(raw.length>32768)throw Error('TOO_LARGE');result=projectMetrics(JSON.parse(raw));}
  catch{result={status:'unavailable',collected_at:null,error:'尚未取得服务器采样，请检查采集服务。'};}
  res.json({...result,provider:'aliyun',host_purpose:'api_production',serving_source_sha:sha(cfg.source),server_time:new Date().toISOString()});
 });
}
