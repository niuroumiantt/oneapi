import { HttpError, id, transaction, audit } from './core.mjs';
import { supplierReadiness } from './supplier-readiness.mjs';

function access(req,write=false){
 if(req.staff.status!=='active'||!['platform_admin','supply','finance','operations'].includes(req.staff.role))throw new HttpError(403,'当前岗位不能查看商品复核');
 if(write&&!['platform_admin','supply'].includes(req.staff.role))throw new HttpError(403,'当前岗位不能提交商品复核');
}
function notes(value,required=false){
 if(value===undefined&&!required)return '';
 if(typeof value!=='string'||value.length>1000||(required&&!value.trim()))throw new HttpError(400,'请填写 1000 字以内的复核说明');
 return value.trim();
}
async function evidence(db,productId){
 const product=(await db.query('SELECT p.id,p.status,o.id AS offer_id,o.status AS offer_status,s.status AS supplier_status FROM model_products p JOIN model_product_sources ps ON ps.product_id=p.id JOIN supplier_offers o ON o.id=ps.offer_id JOIN suppliers s ON s.id=o.supplier_id WHERE p.id=$1 ORDER BY o.id LIMIT 1',[productId])).rows[0];
 if(!product)throw new HttpError(404,'模型商品不存在');
 if(product.status==='blocked'||product.offer_status==='blocked'||product.supplier_status==='blocked')throw new HttpError(409,'商品或供给已暂停');
 const [checks,run,price]=await Promise.all([
  db.query('SELECT check_key,result,evidence_url FROM supplier_offer_checks WHERE offer_id=$1',[product.offer_id]),
  db.query('SELECT id,conclusion,usage_check FROM supplier_validation_runs WHERE offer_id=$1 ORDER BY window_end DESC,created_at DESC LIMIT 1',[product.offer_id]),
  db.query('SELECT id FROM model_price_proposals WHERE model_product_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[productId])
 ]);
 if(!supplierReadiness({status:product.offer_status,supplier_status:product.supplier_status},checks.rows).documents_complete)throw new HttpError(409,'供给资料尚未完整登记');
 if(!run.rows[0]||run.rows[0].conclusion!=='passed'||run.rows[0].usage_check!=='matched')throw new HttpError(409,'需要最近一次通过且用量已核对的验收报告');
 if(!price.rows[0])throw new HttpError(409,'需要先建立价格草稿');
 return {offerId:product.offer_id,validationId:run.rows[0].id,priceId:price.rows[0].id};
}

export function productReviewRoutes(app,pool,requireStaff){
 app.get('/api/staff/model-product-reviews',requireStaff,async(req,res)=>{
  access(req);
  const rows=(await pool.query('SELECT r.*,p.display_name AS model_product_name,p.product_code FROM model_product_reviews r JOIN model_products p ON p.id=r.model_product_id ORDER BY r.created_at DESC,r.id DESC LIMIT 200')).rows;
  res.json({reviews:rows,public_catalog_enabled:false,sale_ready:false});
 });
 app.post('/api/staff/model-products/:id/reviews',requireStaff,async(req,res)=>{
  access(req,true);
  const productId=id(req.params.id),requestNotes=notes(req.body?.notes);
  let row;
  try{row=await transaction(pool,async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[productId]);
   const snapshot=await evidence(db,productId);
   const previous=(await db.query('SELECT status,offer_id,validation_run_id,price_proposal_id FROM model_product_reviews WHERE model_product_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[productId])).rows[0];
   if(previous?.status==='requested')throw new HttpError(409,'该商品已有待处理复核');
   if(previous?.status==='internally_reviewed'&&previous.offer_id===snapshot.offerId&&previous.validation_run_id===snapshot.validationId&&previous.price_proposal_id===snapshot.priceId)throw new HttpError(409,'相同依据已经完成内部复核');
   const r=(await db.query('INSERT INTO model_product_reviews(model_product_id,offer_id,validation_run_id,price_proposal_id,request_notes,requested_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[productId,snapshot.offerId,snapshot.validationId,snapshot.priceId,requestNotes,req.staff.subject])).rows[0];
   await audit(db,req.actor,'model_product.review_requested',null,productId,{review_id:r.id,validation_run_id:r.validation_run_id,price_proposal_id:r.price_proposal_id});
   return r;
  });}catch(error){if(error.code==='23505')throw new HttpError(409,'该商品已有待处理复核');throw error;}
  res.status(201).json({...row,public_catalog_enabled:false,sale_ready:false});
 });
 app.post('/api/staff/model-product-reviews/:id/decision',requireStaff,async(req,res)=>{
  access(req);
  if(req.staff.role!=='platform_admin')throw new HttpError(403,'只有平台管理员能完成商品内部复核');
  const reviewId=id(req.params.id),status=req.body?.status,reviewerNotes=notes(req.body?.notes,true);
  if(!['changes_requested','internally_reviewed'].includes(status))throw new HttpError(400,'复核结论不正确');
  const row=await transaction(pool,async db=>{
   const review=(await db.query('SELECT * FROM model_product_reviews WHERE id=$1 FOR UPDATE',[reviewId])).rows[0];
   if(!review)throw new HttpError(404,'商品复核不存在');
   if(review.status!=='requested')throw new HttpError(409,'复核已经处理');
   if(review.requested_by===req.staff.subject)throw new HttpError(409,'申请人不能复核自己的商品');
   if(status==='internally_reviewed'){
    const current=await evidence(db,review.model_product_id);
    if(current.offerId!==review.offer_id||current.validationId!==review.validation_run_id||current.priceId!==review.price_proposal_id)throw new HttpError(409,'供给、验收或价格依据已变化，请退回后重新申请');
   }
   const result=(await db.query('UPDATE model_product_reviews SET status=$2,reviewer_notes=$3,reviewed_by=$4,decided_at=now() WHERE id=$1 RETURNING *',[reviewId,status,reviewerNotes,req.staff.subject])).rows[0];
   await audit(db,req.actor,'model_product.review_decided',null,review.model_product_id,{review_id:reviewId,status});
   return result;
  });
  res.json({...row,public_catalog_enabled:false,sale_ready:false});
 });
}
