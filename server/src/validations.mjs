import { HttpError, id, text, transaction, audit,hasBusiness } from './core.mjs';

function access(req,write=false){
 if(!hasBusiness(req.staff))throw new HttpError(403,'当前岗位不能查看供应验收');
 if(write&&!hasBusiness(req.staff))throw new HttpError(403,'当前岗位不能登记供应验收');
}
function integer(value,min,max,label,optional=false){
 if(optional&&(value===undefined||value===null||value===''))return null;
 if(typeof value!=='number'&&typeof value!=='string')throw new HttpError(400,`${label}不正确`);
 const raw=String(value);
 if(!/^(0|[1-9]\d*)$/.test(raw))throw new HttpError(400,`${label}不正确`);
 const n=Number(raw);
 if(!Number.isSafeInteger(n)||n<min||n>max)throw new HttpError(400,`${label}须在 ${min}–${max} 之间`);
 return n;
}
function observed(value,label){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value))throw new HttpError(400,`${label}需要带时区的时间`);
 const date=new Date(value);
 if(!Number.isFinite(date.valueOf()))throw new HttpError(400,`${label}不正确`);
 return date;
}
function evidence(value){
 if(typeof value!=='string'||value.length>500)throw new HttpError(400,'验收证据必须是 HTTPS 链接');
 let url;try{url=new URL(value);}catch{throw new HttpError(400,'验收证据必须是 HTTPS 链接');}
 if(url.protocol!=='https:'||url.username||url.password)throw new HttpError(400,'验收证据必须是 HTTPS 链接');
 return url.toString();
}
function choice(value,options,label){if(!options.includes(value))throw new HttpError(400,`${label}不正确`);return value;}

export function validationRoutes(app,pool,requireStaff){
 app.get('/api/staff/validation-summary',requireStaff,async(req,res)=>{
  access(req);
  const rows=(await pool.query('SELECT DISTINCT ON (offer_id) offer_id,id,window_end,sample_count,success_count,usage_check,conclusion FROM supplier_validation_runs ORDER BY offer_id,window_end DESC,created_at DESC')).rows;
  res.json({latest:rows,source:'staff_recorded',technical_verified:false});
 });
 app.get('/api/staff/supplier-offers/:id/validations',requireStaff,async(req,res)=>{
  access(req);
  const offerId=id(req.params.id);
  if(!(await pool.query('SELECT 1 FROM supplier_offers WHERE id=$1',[offerId])).rowCount)throw new HttpError(404,'供应产品不存在');
  const rows=(await pool.query('SELECT id,offer_id,objective,window_start,window_end,sample_count,success_count,p95_ttft_ms,p95_total_ms,usage_check,conclusion,evidence_url,notes,recorded_by,created_at FROM supplier_validation_runs WHERE offer_id=$1 ORDER BY window_end DESC,created_at DESC LIMIT 50',[offerId])).rows;
  res.json({runs:rows,source:'staff_recorded',technical_verified:false,sale_ready:false});
 });
 app.post('/api/staff/supplier-offers/:id/validations',requireStaff,async(req,res)=>{
  access(req,true);
  const offerId=id(req.params.id),b=req.body||{},objective=text(b.objective,'验收目标',200),start=observed(b.window_start,'开始时间'),end=observed(b.window_end,'结束时间');
  const now=Date.now();
  if(start.valueOf()<now-366*86400000||end.valueOf()>now+60000||end<=start||end-start>72*3600000)throw new HttpError(400,'验收时间窗须在过去一年内，且不超过 72 小时');
  const sampleCount=integer(b.sample_count,1,1000000,'样本数'),successCount=integer(b.success_count,0,sampleCount,'成功数');
  const ttft=integer(b.p95_ttft_ms,0,600000,'首 Token p95',true),total=integer(b.p95_total_ms,0,600000,'完整耗时 p95',true);
  if(ttft!==null&&total!==null&&ttft>total)throw new HttpError(400,'首 Token p95 不能大于完整耗时 p95');
  const usage=choice(b.usage_check,['not_checked','matched','mismatched'],'计量核对'),conclusion=choice(b.conclusion,['passed','failed','inconclusive'],'验收结论'),url=evidence(b.evidence_url);
  const notes=b.notes===undefined?'':b.notes;
  if(typeof notes!=='string'||notes.length>1000)throw new HttpError(400,'验收说明过长');
  const row=await transaction(pool,async db=>{
   if(!(await db.query('SELECT 1 FROM supplier_offers WHERE id=$1 FOR SHARE',[offerId])).rowCount)throw new HttpError(404,'供应产品不存在');
   const r=(await db.query('INSERT INTO supplier_validation_runs(offer_id,objective,window_start,window_end,sample_count,success_count,p95_ttft_ms,p95_total_ms,usage_check,conclusion,evidence_url,notes,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[offerId,objective,start,end,sampleCount,successCount,ttft,total,usage,conclusion,url,notes.trim(),req.staff.subject])).rows[0];
   await audit(db,req.actor,'supplier_offer.validation_recorded',null,offerId,{run_id:r.id,conclusion,window_end:end.toISOString(),sample_count:sampleCount});
   return r;
  });
  res.status(201).json({...row,source:'staff_recorded',technical_verified:false,sale_ready:false});
 });
}
