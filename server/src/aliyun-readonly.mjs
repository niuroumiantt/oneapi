import {createHmac,randomUUID} from 'node:crypto';
import {HttpError,vault,audit,transaction} from './core.mjs';
import {requireTechnical} from './workspaces.mjs';
export const REGIONS=['cn-hangzhou','cn-shanghai','cn-beijing','cn-shenzhen','cn-qingdao','cn-hongkong','ap-southeast-1','us-west-1','us-east-1'];
const encode=v=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function rpcBody(params,secret){const sorted=Object.keys(params).sort().map(k=>encode(k)+'='+encode(String(params[k]))).join('&');const signature=createHmac('sha1',secret+'&').update('POST&%2F&'+encode(sorted)).digest('base64');return sorted+'&Signature='+encode(signature)}
async function rpc(auth,service,action,parameters){
 const fixed={ecs:['2014-05-26',`ecs.${auth.region}.aliyuncs.com`,['DescribeInstances']],swas:['2020-06-01',`swas.${auth.region}.aliyuncs.com`,['ListInstances']],bss:['2017-12-14','business.aliyuncs.com',['QueryAccountBill','DescribeInstanceBill']]};
 const spec=fixed[service];if(!spec||!spec[2].includes(action)||!REGIONS.includes(auth.region))throw Error('READ_ONLY_ACTION_REQUIRED');
 const params={...parameters,Action:action,Version:spec[0],AccessKeyId:auth.access_key_id,Format:'JSON',SignatureMethod:'HMAC-SHA1',SignatureNonce:randomUUID(),SignatureVersion:'1.0',Timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')};
 const r=await fetch('https://'+spec[1]+'/',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:rpcBody(params,auth.access_key_secret),signal:AbortSignal.timeout(12000)});
 const reader=r.body.getReader();let chunks=[],size=0;try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>1048576)throw Error('RESPONSE_TOO_LARGE');chunks.push(x.value)}}finally{await reader.cancel().catch(()=>{})}
 const d=JSON.parse(Buffer.concat(chunks).toString());if(!r.ok||d.Success===false||d.Code&&d.Code!=='Success'){const e=Error('CLOUD_READ_FAILED');e.code=typeof d.Code==='string'?d.Code.slice(0,80):'HTTP_'+r.status;throw e}return d;
}
const value=v=>v==null?null:String(v).slice(0,120);
export const CLOUD_SYNC_INTERVAL_MS=6*60*60*1000;
// Reject incomplete pagination instead of presenting a partial bill as the account total.
async function pages(auth,fetcher,service,action,parameters,extract,tokenMode=false){
 const items=[],seen=new Set();let next;
 for(let page=1;page<=200;page++){
  const d=await fetcher(auth,service,action,{...parameters,...(tokenMode?{MaxResults:300,...(next?{NextToken:next}:{})}:action==='QueryAccountBill'?{PageSize:100,PageNum:page}:{PageSize:100,PageNumber:page})});
  const rows=extract(d);if(!Array.isArray(rows))throw Object.assign(Error(),{code:'UNEXPECTED_RESPONSE'});items.push(...rows);
  if(tokenMode){next=d.Data?.NextToken;if(!next)return items;if(seen.has(next))break;seen.add(next)}
  else {const total=Number(d.Data?.TotalCount??d.TotalCount);if(!Number.isSafeInteger(total)||total<0)throw Object.assign(Error(),{code:'MISSING_TOTAL'});if(items.length>=total)return items;if(!rows.length)break}
 }
 throw Object.assign(Error(),{code:'INCOMPLETE_PAGINATION'});
}
export async function readAliyun(auth,fetcher=rpc){
 const period=new Date(Date.now()+28800000).toISOString().slice(0,7),collected=new Date().toISOString();
 const results=await Promise.allSettled([
  pages(auth,fetcher,auth.product,auth.product==='ecs'?'DescribeInstances':'ListInstances',{RegionId:auth.region},d=>auth.product==='ecs'?d.Instances?.Instance:d.Instances),
  pages(auth,fetcher,'bss','QueryAccountBill',{BillingCycle:period,IsGroupByProduct:true,Granularity:'MONTHLY'},d=>d.Data?.Items?.Item),
  pages(auth,fetcher,'bss','DescribeInstanceBill',{BillingCycle:period,Granularity:'MONTHLY',IsBillingItem:false},d=>d.Data?.Items,true)]);
 const error=e=>({status:'unavailable',error_code:/^[\w.-]{1,80}$/.test(e.reason?.code||'')?e.reason.code:'NETWORK_OR_PROTOCOL_ERROR'});
 const resources=results[0].status==='fulfilled'?{status:'ok',total:results[0].value.length,truncated:false,items:results[0].value.map(x=>({id:value(x.InstanceId),name:value(x.InstanceName),status:value(x.Status),region:value(x.RegionId||auth.region),cpu:x.Cpu??null,memory_mb:x.Memory??null,bandwidth_out_mbps:x.InternetMaxBandwidthOut??x.Plan?.Bandwidth??null,bandwidth_in_mbps:x.InternetMaxBandwidthIn??null,charge_type:value(x.InstanceChargeType||x.ChargeType),expires_at:value(x.ExpiredTime),public_ips:x.PublicIpAddress?.IpAddress||[x.PublicIpAddress].filter(x=>typeof x==='string')}))}:error(results[0]);
 const billing=results[1].status==='fulfilled'?{status:'ok',scope:'aliyun_account_all_projects',period,total:results[1].value.length,truncated:false,items:results[1].value.map(x=>({product:value(x.ProductName||x.ProductCode),currency:value(x.Currency),pretax_amount:value(x.PretaxAmount),payment_amount:value(x.PaymentAmount),outstanding_amount:value(x.OutstandingAmount)}))}:error(results[1]);
 const instance_billing=results[2].status==='fulfilled'?{status:'ok',period,items:results[2].value.map(x=>({id:value(x.InstanceID),product:value(x.ProductName||x.ProductCode),name:value(x.NickName),region:value(x.Region),currency:value(x.Currency),pretax_amount:value(x.PretaxAmount),bill_type:value(x.Item),allocation:'unallocated'}))}:error(results[2]);
 return {provider:'aliyun',collected_at:collected,region:auth.region,product:auth.product,resources,billing,instance_billing,forecast:{status:'unavailable',reason:'NOT_CONNECTED'},oneapi_cost:{status:'unallocated',amount:null}};
}
export function retainSuccessfulSnapshot(previous,result){
 const snapshot={...result};for(const key of ['resources','billing','instance_billing']){
  const current=result[key];snapshot[key]=current.status==='ok'?{...current,last_success_at:result.collected_at}:previous?.[key]?.status==='ok'?{...previous[key],stale:true,last_error:current.error_code,last_attempt_at:result.collected_at}:current;
 }
 snapshot.last_attempt_at=result.collected_at;snapshot.next_sync_at=new Date(Date.parse(result.collected_at)+CLOUD_SYNC_INTERVAL_MS).toISOString();return snapshot;
}
export async function syncAliyun(pool,box,{scheduled=false,actor={kind:'system',id:'aliyun-bill-sync'},reader=readAliyun}={}){
 const db=await pool.connect();let locked=false;
 try{
  locked=(await db.query('SELECT pg_try_advisory_lock(148921,11) AS ok')).rows[0].ok;
  if(!locked){if(scheduled)return {skipped:'busy'};throw new HttpError(409,'云同步正在进行')}
  const c=(await db.query("SELECT * FROM cloud_readonly_connections WHERE provider='aliyun'")).rows[0];
  if(!c){if(scheduled)return {skipped:'not_configured'};throw new HttpError(409,'请先配置阿里云只读连接')}
  const last=c.snapshot?.last_attempt_at||c.snapshot?.collected_at;
  if(last&&Date.now()-Date.parse(last)<(scheduled?CLOUD_SYNC_INTERVAL_MS:300000))return {...c.snapshot,cached:true};
  const result=retainSuccessfulSnapshot(c.snapshot,await reader({...box.open(c.credential_ciphertext),region:c.region,product:c.product}));
  await transaction(pool,async tx=>{await tx.query("UPDATE cloud_readonly_connections SET snapshot=$1,updated_at=now() WHERE provider='aliyun'",[result]);await audit(tx,actor,'cloud.readonly_synced',null,'aliyun',{trigger:scheduled?'schedule':'manual',resources:result.resources.stale?'stale':result.resources.status,billing:result.billing.stale?'stale':result.billing.status,instance_billing:result.instance_billing.stale?'stale':result.instance_billing.status})});
  return result;
 }finally{if(locked)await db.query('SELECT pg_advisory_unlock(148921,11)');db.release()}
}
export function aliyunRoutes(app,pool,requireStaff){
 const secret=process.env.SUPPLIER_LAB_SECRET,box=secret?.length>=32?vault(secret):null;
 app.get('/api/staff/observability/aliyun',requireStaff,async(req,res)=>{requireTechnical(req);const d=(await pool.query("SELECT region,product,snapshot,updated_at FROM cloud_readonly_connections WHERE provider='aliyun'")).rows[0];res.json(d?{configured:true,...d,stale:!d.snapshot?.collected_at||Date.now()-Date.parse(d.snapshot.collected_at)>21600000}:{configured:false})});
 app.post('/api/staff/observability/aliyun/configure',requireStaff,async(req,res)=>{
  requireTechnical(req);if(req.staff.role!=='platform_admin')throw new HttpError(403,'仅平台管理员可配置云连接');if(!box)throw new HttpError(503,'加密服务尚未配置');
  const b=req.body||{};if(!REGIONS.includes(b.region)||!['ecs','swas'].includes(b.product)||!/^LTAI[\w]{10,40}$/.test(b.access_key_id||'')||!/^\S{20,100}$/.test(b.access_key_secret||''))throw new HttpError(400,'请填写有效的 RAM AccessKey、实例类型与地域');
  await transaction(pool,async db=>{await db.query('SELECT pg_advisory_xact_lock(148921,11)');await db.query(`INSERT INTO cloud_readonly_connections(provider,region,product,credential_ciphertext) VALUES('aliyun',$1,$2,$3) ON CONFLICT(provider) DO UPDATE SET region=EXCLUDED.region,product=EXCLUDED.product,credential_ciphertext=EXCLUDED.credential_ciphertext,snapshot=NULL,updated_at=now()`,[b.region,b.product,box.seal({access_key_id:b.access_key_id,access_key_secret:b.access_key_secret})]);await audit(db,req.actor,'cloud.readonly_configured',null,'aliyun',{region:b.region,product:b.product})});res.json({configured:true});
 });
 app.post('/api/staff/observability/aliyun/sync',requireStaff,async(req,res)=>{
  requireTechnical(req);if(!box)throw new HttpError(503,'加密服务尚未配置');res.json(await syncAliyun(pool,box,{actor:req.actor}));
 });
}
