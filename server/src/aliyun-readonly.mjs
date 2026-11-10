import {createHmac,randomUUID} from 'node:crypto';
import {HttpError,vault,audit,transaction} from './core.mjs';
import {requireTechnical} from './workspaces.mjs';
export const REGIONS=['cn-hangzhou','cn-shanghai','cn-beijing','cn-shenzhen','cn-qingdao','cn-hongkong','ap-southeast-1','us-west-1','us-east-1'];
const encode=v=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function rpcBody(params,secret){const sorted=Object.keys(params).sort().map(k=>encode(k)+'='+encode(String(params[k]))).join('&');const signature=createHmac('sha1',secret+'&').update('POST&%2F&'+encode(sorted)).digest('base64');return sorted+'&Signature='+encode(signature)}
async function rpc(auth,service,action,parameters){
 const fixed={ecs:['2014-05-26',`ecs.${auth.region}.aliyuncs.com`,['DescribeInstances']],swas:['2020-06-01',`swas.${auth.region}.aliyuncs.com`,['ListInstances']],bss:['2017-12-14','business.aliyuncs.com',['QueryAccountBill']]};
 const spec=fixed[service];if(!spec||!spec[2].includes(action)||!REGIONS.includes(auth.region))throw Error('READ_ONLY_ACTION_REQUIRED');
 const params={...parameters,Action:action,Version:spec[0],AccessKeyId:auth.access_key_id,Format:'JSON',SignatureMethod:'HMAC-SHA1',SignatureNonce:randomUUID(),SignatureVersion:'1.0',Timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')};
 const r=await fetch('https://'+spec[1]+'/',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:rpcBody(params,auth.access_key_secret),signal:AbortSignal.timeout(12000)});
 const reader=r.body.getReader();let chunks=[],size=0;try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>1048576)throw Error('RESPONSE_TOO_LARGE');chunks.push(x.value)}}finally{await reader.cancel().catch(()=>{})}
 const d=JSON.parse(Buffer.concat(chunks).toString());if(!r.ok||d.Success===false||d.Code&&d.Code!=='Success'){const e=Error('CLOUD_READ_FAILED');e.code=typeof d.Code==='string'?d.Code.slice(0,80):'HTTP_'+r.status;throw e}return d;
}
const value=v=>v==null?null:String(v).slice(0,120);
export async function readAliyun(auth,fetcher=rpc){
 const period=new Date(Date.now()+28800000).toISOString().slice(0,7),collected=new Date().toISOString();
 const results=await Promise.allSettled([
  fetcher(auth,auth.product,auth.product==='ecs'?'DescribeInstances':'ListInstances',{RegionId:auth.region,PageSize:100,PageNumber:1}),
  fetcher(auth,'bss','QueryAccountBill',{BillingCycle:period,PageSize:100,PageNum:1,IsGroupByProduct:true,Granularity:'MONTHLY'})]);
 const error=e=>({status:'unavailable',error_code:e.reason?.code||'NETWORK_OR_PROTOCOL_ERROR'});
 const resources=results[0].status==='fulfilled'?(()=>{const d=results[0].value,items=auth.product==='ecs'?d.Instances?.Instance:d.Instances;if(!Array.isArray(items))return {status:'unavailable',error_code:'UNEXPECTED_RESPONSE'};return {status:'ok',total:d.TotalCount??items.length,truncated:(d.TotalCount??items.length)>items.length,items:items.map(x=>({id:value(x.InstanceId),name:value(x.InstanceName),status:value(x.Status),region:value(x.RegionId||auth.region),cpu:x.Cpu??null,memory_mb:x.Memory??null,bandwidth_out_mbps:x.InternetMaxBandwidthOut??x.Plan?.Bandwidth??null,bandwidth_in_mbps:x.InternetMaxBandwidthIn??null,charge_type:value(x.InstanceChargeType||x.ChargeType),expires_at:value(x.ExpiredTime),public_ips:x.PublicIpAddress?.IpAddress||[x.PublicIpAddress].filter(x=>typeof x==='string')}))}})():error(results[0]);
 const billing=results[1].status==='fulfilled'?(()=>{const d=results[1].value,items=d.Data?.Items?.Item;if(!Array.isArray(items))return {status:'unavailable',error_code:'UNEXPECTED_RESPONSE'};return {status:'ok',scope:'aliyun_account_all_projects',period,total:d.Data.TotalCount??items.length,truncated:(d.Data.TotalCount??items.length)>items.length,items:items.map(x=>({product:value(x.ProductName||x.ProductCode),currency:value(x.Currency),pretax_amount:value(x.PretaxAmount),payment_amount:value(x.PaymentAmount),outstanding_amount:value(x.OutstandingAmount)}))}})():error(results[1]);
 return {provider:'aliyun',collected_at:collected,region:auth.region,product:auth.product,resources,billing};
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
  requireTechnical(req);if(!box)throw new HttpError(503,'加密服务尚未配置');const db=await pool.connect();let locked=false;
  try{locked=(await db.query('SELECT pg_try_advisory_lock(148921,11) AS ok')).rows[0].ok;if(!locked)throw new HttpError(409,'云同步正在进行');
   const c=(await db.query("SELECT * FROM cloud_readonly_connections WHERE provider='aliyun'")).rows[0];if(!c)throw new HttpError(409,'请先配置阿里云只读连接');
   if(c.snapshot?.collected_at&&Date.now()-Date.parse(c.snapshot.collected_at)<300000)return res.json({...c.snapshot,cached:true});
   const result=await readAliyun({...box.open(c.credential_ciphertext),region:c.region,product:c.product});await db.query("UPDATE cloud_readonly_connections SET snapshot=$1,updated_at=now() WHERE provider='aliyun'",[result]);await audit(db,req.actor,'cloud.readonly_synced',null,'aliyun',{resources:result.resources.status,billing:result.billing.status});res.json(result);
  }finally{if(locked)await db.query('SELECT pg_advisory_unlock(148921,11)');db.release()}
 });
}
