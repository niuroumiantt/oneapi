import { HttpError, id, text, transaction, audit } from './core.mjs';

function access(req,write=false){
 if(req.staff.status!=='active'||!['platform_admin','operations','finance'].includes(req.staff.role))throw new HttpError(403,'当前岗位不能访问活动草稿');
 if(write&&!['platform_admin','operations'].includes(req.staff.role))throw new HttpError(403,'当前岗位不能创建活动草稿');
}
function integer(value,min,max,label){
 const n=Number(value);
 if(!Number.isInteger(n)||n<min||n>max)throw new HttpError(400,`${label}不正确`);
 return n;
}
function date(value,label){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))throw new HttpError(400,`${label}不正确`);
 const d=new Date(value);
 if(!Number.isFinite(d.getTime()))throw new HttpError(400,`${label}不正确`);
 return d;
}

export function promotionRoutes(app,pool,requireStaff){
 app.get('/api/staff/promotion-campaigns',requireStaff,async(req,res)=>{
  access(req);
  const rows=(await pool.query('SELECT c.*,p.display_name AS model_product_name,p.product_code,q.input_fen_per_million,q.output_fen_per_million FROM promotion_campaigns c JOIN model_products p ON p.id=c.model_product_id LEFT JOIN model_price_proposals q ON q.id=c.price_proposal_id ORDER BY c.created_at DESC LIMIT 200')).rows;
  res.json({campaigns:rows,redemption_enabled:false,commission_enabled:false});
 });
 app.post('/api/staff/promotion-campaigns',requireStaff,async(req,res)=>{
  access(req,true);
  const b=req.body||{},name=text(b.name,'活动名称',100);
  if(!b.price_proposal_id)throw new HttpError(400,'请先选择模型的价格草稿');
  const priceId=id(b.price_proposal_id);
  const pricePercent=integer(b.customer_price_percent,1,100,'客户价格比例');
  const commissionPercent=integer(b.commission_percent,0,30,'推广佣金比例');
  const budgetYuan=integer(b.total_discount_budget_yuan,1,1000000,'优惠预算');
  const starts=date(b.starts_at,'开始时间'),ends=date(b.ends_at,'结束时间');
  if(ends<=starts||ends.getTime()-starts.getTime()>366*24*3600*1000)throw new HttpError(400,'活动期限须在一年以内且结束晚于开始');
  const row=await transaction(pool,async db=>{
   const product=(await db.query("SELECT p.id,p.status,p.source_kind,o.status AS offer_status,s.status AS supplier_status FROM model_price_proposals q JOIN model_products p ON p.id=q.model_product_id LEFT JOIN LATERAL (SELECT offer_id FROM model_product_sources WHERE product_id=p.id ORDER BY offer_id LIMIT 1) ps ON true LEFT JOIN supplier_offers o ON o.id=ps.offer_id LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE q.id=$1 FOR SHARE OF p",[priceId])).rows[0];
   if(!product)throw new HttpError(404,'价格草稿不存在，请先设计商品价格');
   if(product.status==='blocked'||product.offer_status==='blocked'||product.supplier_status==='blocked')throw new HttpError(409,'暂停的模型或供给不能创建活动草稿');
   const campaign=(await db.query('INSERT INTO promotion_campaigns(name,model_product_id,price_proposal_id,customer_price_percent,commission_percent,total_discount_budget_fen,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[name,product.id,priceId,pricePercent,commissionPercent,budgetYuan*100,starts,ends,req.staff.subject])).rows[0];
   await audit(db,req.actor,'promotion_campaign.created',null,campaign.id,{model_product_id:product.id,price_proposal_id:priceId});
   return campaign;
  });
  res.status(201).json({...row,redemption_enabled:false,commission_enabled:false});
 });
}
