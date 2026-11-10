import { HttpError, id, text, transaction, audit, hash } from './core.mjs';
import { supplierReadiness } from './supplier-readiness.mjs';

export function requireTechnical(req) {
 if(req.staff?.status!=='active'||!(req.staff.role==='platform_admin'||req.staff.technical_access===true))throw new HttpError(403,'需要技术运维权限');
}
export function requireBusiness(req) {
 if(req.staff?.status!=='active'||!['platform_admin','operations','supply','finance','support'].includes(req.staff.role))throw new HttpError(403,'需要业务运营权限');
}
function businessWrite(req){requireBusiness(req);if(!['platform_admin','supply'].includes(req.staff.role))throw new HttpError(403,'需要商品管理权限');}
export function acceptanceResult(run,tx,reconciliation){
 const expected=['arithmetic','json','chinese','context'];
 if(run.status!=='completed'||expected.some(c=>!run.case_ids.includes(c))||tx.length!==run.case_ids.length||new Set(tx.map(t=>t.case_id)).size!==tx.length||tx.some(t=>!run.case_ids.includes(t.case_id)))throw new HttpError(409,'需要已完成的完整基础题集及逐笔交易');
 const passed=tx.every(t=>!t.error_code&&t.quality_score===100&&t.checks?.usage_present_and_consistent===true&&t.checks?.model_matches_request===true&&t.estimated_cost_yuan!==null);
 const covered=reconciliation&&tx.every(t=>new Date(t.created_at)>=new Date(reconciliation.period_start)&&new Date(t.created_at)<new Date(reconciliation.period_end));
 const matched=covered&&/^0(?:\.0+)?$/.test(String(reconciliation.difference_yuan));
 return {conclusion:!passed?'failed':matched?'passed':'inconclusive',usage:covered?(matched?'matched':'mismatched'):'not_checked',success:tx.filter(t=>!t.error_code&&t.quality_score===100).length};
}
export async function listingEvidence(db,productId){
 const p=(await db.query(`SELECT p.*,o.id AS offer_id,o.status AS offer_status,s.status AS supplier_status
 FROM model_products p JOIN model_product_sources ps ON ps.product_id=p.id JOIN supplier_offers o ON o.id=ps.offer_id JOIN suppliers s ON s.id=o.supplier_id WHERE p.id=$1 ORDER BY o.id LIMIT 1`,[productId])).rows[0];
 if(!p||[p.status,p.offer_status,p.supplier_status].includes('blocked'))throw new HttpError(409,'商品或供应已暂停');
 const checks=(await db.query('SELECT * FROM supplier_offer_checks WHERE offer_id=$1 ORDER BY check_key',[p.offer_id])).rows;
 if(!supplierReadiness({status:p.offer_status,supplier_status:p.supplier_status},checks).documents_complete)throw new HttpError(409,'供应资料尚未核验完整');
 const v=(await db.query('SELECT * FROM supplier_validation_runs WHERE offer_id=$1 ORDER BY window_end DESC,created_at DESC LIMIT 1',[p.offer_id])).rows[0];
 if(!v?.lab_run_id||v.conclusion!=='passed'||v.usage_check!=='matched')throw new HttpError(409,'需要真实测试通过且账单核对一致的验收报告');
 const e=(await db.query(`SELECT e.id,e.model_id,e.disabled_at,e.credential_id,e.offer_id,c.disabled_at AS key_disabled,s.disabled_at AS supplier_disabled
 FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id JOIN supplier_lab_suppliers s ON s.id=e.supplier_id WHERE e.id=$1`,[v.lab_endpoint_id])).rows[0];
 if(!e||e.disabled_at||e.key_disabled||e.supplier_disabled||e.offer_id!==p.offer_id)throw new HttpError(409,'验收对应的型号或 Key 已停用');
 const price=(await db.query('SELECT * FROM model_price_proposals WHERE model_product_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[p.id])).rows[0];
 const review=(await db.query("SELECT * FROM model_product_reviews WHERE model_product_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[p.id])).rows[0];
 if(!price||review?.status!=='internally_reviewed'||review.validation_run_id!==v.id||review.price_proposal_id!==price.id)throw new HttpError(409,'需要按最新验收和售价完成商品复核');
 const decision=(await db.query("SELECT id FROM model_price_decisions WHERE price_proposal_id=$1 AND product_review_id=$2 AND status='approved'",[price.id,review.id])).rows[0];
 if(!decision)throw new HttpError(409,'售价尚未批准');
 return {product:p,endpoint:e,price,snapshot:hash(JSON.stringify({product:p,checks,validation:v.id,endpoint:e,price:price.id,review:review.id,decision:decision.id}))};
}
export function workspaceRoutes(app,pool,requireStaff,cfg){
 app.get('/api/staff/workspace/console',requireStaff,(req,res)=>{requireBusiness(req);res.sendFile(new URL('../private/workspace.html',import.meta.url).pathname)});
 app.get('/api/staff/workspace/console.js',requireStaff,(req,res)=>{requireBusiness(req);res.type('js').sendFile(new URL('../private/workspace.js',import.meta.url).pathname)});
 app.get('/api/staff/workspace/access',requireStaff,(req,res)=>res.json({business:req.staff.status==='active'&&['platform_admin','operations','supply','finance','support'].includes(req.staff.role),technical:req.staff.status==='active'&&(req.staff.role==='platform_admin'||req.staff.technical_access===true)}));
 app.put('/api/staff/members/:subject/technical-access',requireStaff,async(req,res)=>{
  if(req.staff.role!=='platform_admin'||req.staff.status!=='active')throw new HttpError(403,'仅平台管理员可分配技术权限');
  const subject=text(req.params.subject,'员工标识',120),enabled=req.body?.enabled;
  if(typeof enabled!=='boolean')throw new HttpError(400,'请选择授权或撤销');
  await transaction(pool,async db=>{
   await db.query('SELECT pg_advisory_xact_lock(148921,2)');
   if(!(await db.query("SELECT 1 FROM staff_members WHERE subject=$1 AND role='platform_admin' AND status='active'",[req.staff.subject])).rowCount)throw new HttpError(403,'权限已变化');
   if(!(await db.query("SELECT 1 FROM staff_members WHERE subject=$1 AND status='active'",[subject])).rowCount)throw new HttpError(404,'员工须先获准登录');
   if(enabled)await db.query('INSERT INTO staff_technical_access(subject,granted_by) VALUES($1,$2) ON CONFLICT(subject) DO NOTHING',[subject,req.staff.subject]);
   else await db.query('DELETE FROM staff_technical_access WHERE subject=$1',[subject]);
   await audit(db,req.actor,'staff.technical_access_changed',null,subject,{enabled});
  });res.json({ok:true});
 });
 app.get('/api/staff/workspace/overview',requireStaff,async(req,res)=>{
  requireBusiness(req);
  // Deliberately project only non-secret evidence. No ciphertext or upstream key material.
  const [suppliers,reports,products,listings]=await Promise.all([
   pool.query(`SELECT p.id,p.display_name,p.status,count(DISTINCT c.id)::int AS keys,count(DISTINCT e.id)::int AS models
    FROM suppliers p LEFT JOIN supplier_lab_suppliers s ON s.canonical_supplier_id=p.id LEFT JOIN supplier_lab_credentials c ON c.supplier_id=s.id
    LEFT JOIN supplier_lab_endpoints e ON e.credential_id=c.id GROUP BY p.id ORDER BY p.created_at DESC LIMIT 200`),
   pool.query(`SELECT v.id,v.offer_id,v.lab_run_id,v.lab_endpoint_id,v.reconciliation_id,v.objective,v.sample_count,v.success_count,v.p95_total_ms,v.usage_check,v.conclusion,v.created_at,
    o.model_name,s.display_name AS supplier_name FROM supplier_validation_runs v JOIN supplier_offers o ON o.id=v.offer_id JOIN suppliers s ON s.id=o.supplier_id ORDER BY v.created_at DESC LIMIT 100`),
   pool.query('SELECT id,display_name,product_code FROM model_products ORDER BY created_at DESC LIMIT 200'),
   pool.query('SELECT l.*,p.display_name FROM model_listing_requests l JOIN model_products p ON p.id=l.product_id ORDER BY l.created_at DESC LIMIT 100')]);
  const readiness=[];for(const p of products.rows){try{const ev=await listingEvidence(pool,p.id);readiness.push({...p,ready:true,input_fen:ev.price.input_fen_per_million,output_fen:ev.price.output_fen_per_million})}catch(e){if(!(e instanceof HttpError))throw e;readiness.push({...p,ready:false,reason:e.message})}}
  res.json({suppliers:suppliers.rows,reports:reports.rows,products:readiness,listings:listings.rows,can_manage:['platform_admin','supply'].includes(req.staff.role),technical_access:req.staff.role==='platform_admin'||req.staff.technical_access===true});
 });
 app.get('/api/staff/lab/handoffs',requireStaff,async(req,res)=>{requireTechnical(req);res.json((await pool.query(`SELECT v.id,v.lab_run_id,v.lab_endpoint_id,v.conclusion,v.usage_check,v.sample_count,v.created_at,o.model_name FROM supplier_validation_runs v JOIN supplier_offers o ON o.id=v.offer_id WHERE v.lab_run_id IS NOT NULL ORDER BY v.created_at DESC LIMIT 100`)).rows)});
 app.post('/api/staff/lab/runs/:id/handoff',requireStaff,async(req,res)=>{
  requireTechnical(req);const runId=id(req.params.id),endpointId=id(req.body?.endpoint_id),reconciliationId=req.body?.reconciliation_id?id(req.body.reconciliation_id):null;
  const report=await transaction(pool,async db=>{
   const run=(await db.query('SELECT * FROM supplier_lab_runs WHERE id=$1 FOR SHARE',[runId])).rows[0];
   if(!run||![run.supplier_endpoint_id,run.reference_endpoint_id].includes(endpointId))throw new HttpError(404,'测试批次和型号不匹配');
   const endpoint=(await db.query(`SELECT e.offer_id,e.disabled_at,c.disabled_at AS key_disabled FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id WHERE e.id=$1 FOR SHARE OF e,c`,[endpointId])).rows[0];
   if(!endpoint?.offer_id||endpoint.disabled_at||endpoint.key_disabled)throw new HttpError(409,'型号须关联供应产品且 Key 有效');
   const previous=(await db.query('SELECT id FROM supplier_validation_runs WHERE lab_run_id=$1 AND lab_endpoint_id=$2',[runId,endpointId])).rows[0];
   if(previous)throw new HttpError(409,'本批次已交付业务，请运行新批次再交付');
   const tx=(await db.query('SELECT * FROM supplier_lab_transactions WHERE run_id=$1 AND endpoint_id=$2 ORDER BY created_at',[runId,endpointId])).rows;
   const reconciliation=reconciliationId?(await db.query('SELECT * FROM supplier_lab_reconciliations WHERE id=$1 AND endpoint_id=$2',[reconciliationId,endpointId])).rows[0]:null;
   if(reconciliationId&&!reconciliation)throw new HttpError(400,'账单核对与型号不匹配');
   const result=acceptanceResult(run,tx,reconciliation);
   const latencies=tx.map(t=>t.latency_ms).sort((a,b)=>a-b),p95=latencies[Math.ceil(latencies.length*.95)-1];
   const r=(await db.query(`INSERT INTO supplier_validation_runs(offer_id,objective,window_start,window_end,sample_count,success_count,p95_total_ms,usage_check,conclusion,evidence_url,notes,recorded_by,lab_run_id,lab_endpoint_id,reconciliation_id)
    VALUES($1,'基础协议、固定题与采购计量抽样验收',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,conclusion,usage_check`,
    [endpoint.offer_id,run.created_at,run.finished_at,tx.length,result.success,p95,result.usage,result.conclusion,cfg.origin+'/api/staff/workspace/console#reports',
    '来自服务器真实交易；四道基础题不证明模型身份、长上下文、持续稳定性或 SLA。账单金额为人工录入的上游依据。',req.staff.subject,runId,endpointId,reconciliationId])).rows[0];
   await audit(db,req.actor,'supplier_lab.handoff',null,r.id,{run_id:runId,endpoint_id:endpointId,conclusion:r.conclusion});return r;
  });res.status(201).json(report);
 });
 app.get('/api/staff/lab/releases',requireStaff,async(req,res)=>{requireTechnical(req);res.json((await pool.query('SELECT l.*,p.display_name FROM model_listing_requests l JOIN model_products p ON p.id=l.product_id ORDER BY l.created_at DESC LIMIT 100')).rows)});
 app.post('/api/staff/workspace/listings',requireStaff,async(req,res)=>{
  businessWrite(req);const product=id(req.body?.product_id);
  const row=await transaction(pool,async db=>{await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[product]);const evidence=await listingEvidence(db,product);
   if((await db.query("SELECT 1 FROM model_listing_requests WHERE product_id=$1 AND status IN ('requested','published')",[product])).rowCount)throw new HttpError(409,'已有上架申请或已上架，请先撤回旧版本');
   const r=(await db.query('INSERT INTO model_listing_requests(product_id,snapshot,requested_by) VALUES($1,$2,$3) RETURNING *',[product,evidence.snapshot,req.staff.subject])).rows[0];await audit(db,req.actor,'catalog.requested',null,r.id,{product_id:product});return r;
  });res.status(201).json(row);
 });
 app.post('/api/staff/lab/releases/:id/publish',requireStaff,async(req,res)=>{
  requireTechnical(req);const listing=id(req.params.id);
  const row=await transaction(pool,async db=>{const l=(await db.query('SELECT * FROM model_listing_requests WHERE id=$1 FOR UPDATE',[listing])).rows[0];if(!l||l.status!=='requested')throw new HttpError(409,'没有待发布版本');
   const ev=await listingEvidence(db,l.product_id);if(ev.snapshot!==l.snapshot)throw new HttpError(409,'依据已变化，请业务撤回并重新申请');
   const r=(await db.query("UPDATE model_listing_requests SET status='published',published_by=$2,published_at=now() WHERE id=$1 RETURNING *",[listing,req.staff.subject])).rows[0];await audit(db,req.actor,'catalog.published',null,listing,{product_id:l.product_id});return r;
  });res.json({...row,customer_inference_enabled:false});
 });
 app.post('/api/staff/workspace/listings/:id/withdraw',requireStaff,async(req,res)=>{
  if(req.staff.role==='platform_admin'||req.staff.technical_access===true)requireTechnical(req);else businessWrite(req);
  const listing=id(req.params.id);await transaction(pool,async db=>{const r=await db.query("UPDATE model_listing_requests SET status='withdrawn' WHERE id=$1 AND status<>'withdrawn' RETURNING id",[listing]);if(!r.rowCount)throw new HttpError(404,'记录不存在或已撤回');await audit(db,req.actor,'catalog.withdrawn',null,listing)});res.json({ok:true});
 });
 app.get('/api/catalog/published',async(req,res)=>{
  const listings=(await pool.query("SELECT product_id,snapshot FROM model_listing_requests WHERE status='published' ORDER BY published_at DESC LIMIT 200")).rows;
  const products=[];for(const l of listings){try{const e=await listingEvidence(pool,l.product_id);if(e.snapshot!==l.snapshot)continue;products.push({id:e.product.id,name:e.product.display_name,model_id:e.endpoint.model_id,summary:e.product.summary,input_yuan_per_m:Number(e.price.input_fen_per_million)/100,output_yuan_per_m:Number(e.price.output_fen_per_million)/100,availability:'catalog_only'})}catch(e){if(!(e instanceof HttpError))throw e}}
  res.json({products,customer_inference_enabled:false});
 });
}
