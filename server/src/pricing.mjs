import { HttpError, id, transaction, audit } from './core.mjs';

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
}
