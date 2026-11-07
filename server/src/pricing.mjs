import { HttpError, id, transaction, audit } from './core.mjs';
import { supplierReadiness } from './supplier-readiness.mjs';

function access(req,write=false){
 if(req.staff.status!=='active'||!['platform_admin','finance','operations','supply'].includes(req.staff.role))throw new HttpError(403,'当前岗位不能查看价格草稿');
 if(write&&!['platform_admin','finance'].includes(req.staff.role))throw new HttpError(403,'当前岗位不能设计价格草稿');
}
function fen(value,label){
 const raw=String(value??'').trim();
 if(!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(raw))throw new HttpError(400,`${label}需为最多两位小数的人民币金额`);
 const [whole,decimal='']=raw.split('.');
 const amount=Number(whole)*100+Number(decimal.padEnd(2,'0'));
 if(amount<1||amount>100000000)throw new HttpError(400,`${label}须在 0.01–1000000 元之间`);
 return amount;
}
function evidence(value){
 if(typeof value!=='string'||value.length>500)throw new HttpError(400,'价格依据须为 HTTPS 链接');
 let url;try{url=new URL(value);}catch{throw new HttpError(400,'价格依据须为 HTTPS 链接');}
 if(url.protocol!=='https:'||url.username||url.password)throw new HttpError(400,'价格依据须为 HTTPS 链接');
 return url.toString();
}

export function pricingRoutes(app,pool,requireStaff){
 app.get('/api/staff/price-proposals',requireStaff,async(req,res)=>{
  access(req);
  const rows=(await pool.query('SELECT q.*,p.display_name AS model_product_name,p.product_code FROM model_price_proposals q JOIN model_products p ON p.id=q.model_product_id ORDER BY q.created_at DESC,q.id DESC LIMIT 200')).rows;
  res.json({proposals:rows,public_pricing_enabled:false,checkout_enabled:false});
 });
 app.post('/api/staff/price-proposals',requireStaff,async(req,res)=>{
  access(req,true);
  const b=req.body||{},productId=id(b.model_product_id),input=fen(b.input_yuan_per_million,'输入价格'),output=fen(b.output_yuan_per_million,'输出价格'),url=evidence(b.evidence_url);
  const notes=b.notes===undefined?'':b.notes;
  if(typeof notes!=='string'||notes.length>1000)throw new HttpError(400,'价格说明过长');
  const row=await transaction(pool,async db=>{
   const product=(await db.query('SELECT p.id,p.status,p.source_kind,p.source_description,o.status AS offer_status,s.status AS supplier_status FROM model_products p LEFT JOIN LATERAL (SELECT offer_id FROM model_product_sources WHERE product_id=p.id ORDER BY offer_id LIMIT 1) ps ON true LEFT JOIN supplier_offers o ON o.id=ps.offer_id LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE p.id=$1 FOR SHARE OF p',[productId])).rows[0];
   if(!product)throw new HttpError(404,'模型商品不存在');
   if(product.status==='blocked'||product.offer_status==='blocked'||product.supplier_status==='blocked')throw new HttpError(409,'暂停的商品或供给不能设计价格');
   if(product.source_kind==='owned_service'&&!product.source_description)throw new HttpError(409,'请先说明自有服务的实际交付与底层能力');
   const q=(await db.query('INSERT INTO model_price_proposals(model_product_id,input_fen_per_million,output_fen_per_million,evidence_url,notes,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[productId,input,output,url,notes.trim(),req.staff.subject])).rows[0];
   await audit(db,req.actor,'model_price.proposed',null,q.id,{model_product_id:productId});
   return q;
  });
  res.status(201).json({...row,public_pricing_enabled:false,checkout_enabled:false});
 });
 app.get('/api/staff/price-decisions',requireStaff,async(req,res)=>{
  access(req);
  const rows=(await pool.query('SELECT d.*,q.model_product_id,p.display_name AS model_product_name FROM model_price_decisions d JOIN model_price_proposals q ON q.id=d.price_proposal_id JOIN model_products p ON p.id=q.model_product_id ORDER BY d.decided_at DESC,d.id DESC LIMIT 200')).rows;
  res.json({decisions:rows,public_pricing_enabled:false,checkout_enabled:false});
 });
 app.post('/api/staff/price-proposals/:id/decision',requireStaff,async(req,res)=>{
  access(req,true);
  const proposalId=id(req.params.id),status=req.body?.status,notes=req.body?.notes;
  if(!['approved','rejected'].includes(status))throw new HttpError(400,'价格复核结论不正确');
  if(typeof notes!=='string'||notes.trim().length<10||notes.trim().length>1000)throw new HttpError(400,'请填写 10–1000 字的价格复核说明');
  let decision;
  try{decision=await transaction(pool,async db=>{
   const proposal=(await db.query('SELECT * FROM model_price_proposals WHERE id=$1 FOR SHARE',[proposalId])).rows[0];
   if(!proposal)throw new HttpError(404,'价格草稿不存在');
   if(proposal.created_by===req.staff.subject)throw new HttpError(409,'价格草稿设计人不能复核自己的价格');
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[proposal.model_product_id]);
   if((await db.query('SELECT 1 FROM model_price_decisions WHERE price_proposal_id=$1',[proposalId])).rowCount)throw new HttpError(409,'这版价格已经复核');
   const latest=(await db.query('SELECT id FROM model_price_proposals WHERE model_product_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[proposal.model_product_id])).rows[0];
   if(latest.id!==proposalId)throw new HttpError(409,'只能复核最新价格版本');
   const review=(await db.query('SELECT * FROM model_product_reviews WHERE model_product_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[proposal.model_product_id])).rows[0];
   if(!review||review.price_proposal_id!==proposalId||review.status!=='internally_reviewed')throw new HttpError(409,'请先完成与此价格版本对应的商品内部复核');
   const source=(await db.query('SELECT p.status AS product_status,o.status AS offer_status,s.status AS supplier_status FROM model_products p JOIN model_product_sources ps ON ps.product_id=p.id JOIN supplier_offers o ON o.id=ps.offer_id JOIN suppliers s ON s.id=o.supplier_id WHERE p.id=$1 AND o.id=$2',[proposal.model_product_id,review.offer_id])).rows[0];
   if(!source||source.product_status==='blocked'||source.offer_status==='blocked'||source.supplier_status==='blocked')throw new HttpError(409,'商品或供应来源已暂停');
   const checks=(await db.query('SELECT check_key,result,evidence_url FROM supplier_offer_checks WHERE offer_id=$1',[review.offer_id])).rows;
   if(!supplierReadiness({status:source.offer_status,supplier_status:source.supplier_status},checks).documents_complete)throw new HttpError(409,'供给资料已变化，请重新核对');
   const run=(await db.query('SELECT id,conclusion,usage_check FROM supplier_validation_runs WHERE offer_id=$1 ORDER BY window_end DESC,created_at DESC LIMIT 1',[review.offer_id])).rows[0];
   if(!run||run.id!==review.validation_run_id||run.conclusion!=='passed'||run.usage_check!=='matched')throw new HttpError(409,'最新验收报告已变化，请重新复核商品');
   const row=(await db.query('INSERT INTO model_price_decisions(price_proposal_id,product_review_id,status,notes,decided_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[proposalId,review.id,status,notes.trim(),req.staff.subject])).rows[0];
   await audit(db,req.actor,'model_price.decided',null,proposal.model_product_id,{price_proposal_id:proposalId,product_review_id:review.id,status});
   return row;
  });}catch(error){if(error.code==='23505')throw new HttpError(409,'这版价格已经复核');throw error;}
  res.status(201).json({...decision,public_pricing_enabled:false,checkout_enabled:false});
 });
}
