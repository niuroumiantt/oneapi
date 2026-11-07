import { HttpError,id,text,transaction,audit } from './core.mjs';

const models=[
 {code:'demo-chat',name:'对话灵感 · 演示模型',kind:'对话与创作',input_fen_per_1000:2,output_fen_per_1000:4},
 {code:'demo-code',name:'代码搭档 · 演示模型',kind:'代码与开发',input_fen_per_1000:3,output_fen_per_1000:6},
 {code:'demo-reason',name:'深度思考 · 演示模型',kind:'分析与推理',input_fen_per_1000:4,output_fen_per_1000:8}
];
function model(code){const m=models.find(x=>x.code===code);if(!m)throw new HttpError(400,'请选择演示模型');return m;}
function integer(value,label,min,max){const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new HttpError(400,`${label}不在允许范围`);return n;}
async function scope(db,req,org,manage=false){
 if(!org)return {owner:req.customer.id,organization:null,role:'personal'};
 id(org);
 const m=(await db.query("SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[org,req.customer.id])).rows[0];
 if(!m)throw new HttpError(403,'没有这个企业的访问权限');
 if(manage&&!['owner','admin'].includes(m.role))throw new HttpError(403,'只有企业代表人可以管理采购和额度');
 return {owner:null,organization:org,role:m.role};
}
async function wallet(db,s){
 if(s.organization){await db.query('INSERT INTO demo_wallets(organization_id) VALUES($1) ON CONFLICT(organization_id) WHERE organization_id IS NOT NULL DO NOTHING',[s.organization]);return (await db.query('SELECT * FROM demo_wallets WHERE organization_id=$1',[s.organization])).rows[0];}
 await db.query('INSERT INTO demo_wallets(owner_id) VALUES($1) ON CONFLICT(owner_id) WHERE owner_id IS NOT NULL DO NOTHING',[s.owner]);
 return (await db.query('SELECT * FROM demo_wallets WHERE owner_id=$1',[s.owner])).rows[0];
}
async function view(db,req,org){
 const s=await scope(db,req,org),w=await wallet(db,s),representative=s.role==='owner'||s.role==='admin';
 const orders=(await db.query('SELECT id,model_code,amount_fen,status,created_at,paid_at FROM demo_orders WHERE wallet_id=$1'+(org&&!representative?' AND created_by=$2':'')+' ORDER BY created_at DESC LIMIT 30',org&&!representative?[w.id,req.customer.id]:[w.id])).rows;
 const keys=(await db.query('SELECT id,model_code,label,status,created_at,user_id FROM demo_keys WHERE wallet_id=$1'+(org&&!representative?' AND user_id=$2':'')+' ORDER BY created_at DESC LIMIT 50',org&&!representative?[w.id,req.customer.id]:[w.id])).rows;
 const usage=(await db.query('SELECT id,key_id,user_id,model_code,input_tokens,output_tokens,cost_fen,created_at FROM demo_usage WHERE wallet_id=$1'+(org&&!representative?' AND user_id=$2':'')+' ORDER BY created_at DESC LIMIT 100',org&&!representative?[w.id,req.customer.id]:[w.id])).rows;
 let allocations=[];
 if(org){const q=representative?"SELECT a.user_id,a.limit_fen,a.spent_fen,u.name,u.email FROM demo_allocations a JOIN \"user\" u ON u.id=a.user_id WHERE a.wallet_id=$1 ORDER BY u.name":"SELECT a.user_id,a.limit_fen,a.spent_fen,u.name,u.email FROM demo_allocations a JOIN \"user\" u ON u.id=a.user_id WHERE a.wallet_id=$1 AND a.user_id=$2";allocations=(await db.query(q,representative?[w.id]:[w.id,req.customer.id])).rows;}
 const members=org&&representative?(await db.query("SELECT m.user_id,u.name,u.email,m.role,m.status FROM memberships m JOIN \"user\" u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.status='active' ORDER BY m.created_at",[org])).rows:[];
 return {simulated:true,scope:org?'organization':'personal',organization_id:org||null,role:s.role,representative,models,wallet:{balance_fen:Number(w.balance_fen),spent_fen:Number(w.spent_fen)},orders,keys,usage,allocations,members};
}
export function demoJourneyRoutes(app,pool,requireCustomer){
 app.get('/api/demo/personal',requireCustomer,async(req,res)=>res.json(await view(pool,req,null)));
 app.get('/api/demo/organizations/:org',requireCustomer,async(req,res)=>res.json(await view(pool,req,req.params.org)));
 app.post('/api/demo/orders',requireCustomer,async(req,res)=>{const code=model(req.body.model_code).code,amount=integer(req.body.amount_yuan,'演示订单金额',1,100000)*100,org=req.body.organization_id||null;
  const order=await transaction(pool,async db=>{const s=await scope(db,req,org,!!org),w=await wallet(db,s);return (await db.query('INSERT INTO demo_orders(wallet_id,model_code,amount_fen,created_by) VALUES($1,$2,$3,$4) RETURNING id,status,amount_fen,model_code',[w.id,code,amount,req.customer.id])).rows[0];});res.status(201).json({simulated:true,order});
 });
 app.post('/api/demo/orders/:order/pay',requireCustomer,async(req,res)=>{const org=req.body.organization_id||null;const result=await transaction(pool,async db=>{
  const s=await scope(db,req,org,!!org),w=await wallet(db,s);await db.query('SELECT id FROM demo_wallets WHERE id=$1 FOR UPDATE',[w.id]);
  const order=(await db.query('SELECT * FROM demo_orders WHERE id=$1 AND wallet_id=$2 FOR UPDATE',[id(req.params.order),w.id])).rows[0];if(!order)throw new HttpError(404,'演示订单不存在');
  if(order.status==='paid')return {status:'paid',balance_fen:Number((await db.query('SELECT balance_fen FROM demo_wallets WHERE id=$1',[w.id])).rows[0].balance_fen)};
  await db.query("UPDATE demo_orders SET status='paid',paid_at=now() WHERE id=$1",[order.id]);
  const updated=(await db.query('UPDATE demo_wallets SET balance_fen=balance_fen+$2 WHERE id=$1 RETURNING balance_fen',[w.id,order.amount_fen])).rows[0];
  await audit(db,req.actor,'demo.payment_simulated',org,order.id,{amount_fen:Number(order.amount_fen)});return {status:'paid',balance_fen:Number(updated.balance_fen)};
 });res.json({simulated:true,...result});});
 app.post('/api/demo/allocations',requireCustomer,async(req,res)=>{const org=id(req.body.organization_id),target=idOrText(req.body.user_id),limit=integer(req.body.limit_yuan,'演示员工额度',0,1000000)*100;
  await transaction(pool,async db=>{const s=await scope(db,req,org,true),w=await wallet(db,s);await db.query('SELECT id FROM demo_wallets WHERE id=$1 FOR UPDATE',[w.id]);
   const member=(await db.query("SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[org,target])).rows[0];if(!member)throw new HttpError(400,'请选择有效企业成员');
   const prior=(await db.query('SELECT limit_fen,spent_fen FROM demo_allocations WHERE wallet_id=$1 AND user_id=$2',[w.id,target])).rows[0];if(limit<Number(prior?.spent_fen||0))throw new HttpError(409,'新额度不能低于已使用金额');
   const other=Number((await db.query('SELECT coalesce(sum(limit_fen),0) AS total FROM demo_allocations WHERE wallet_id=$1 AND user_id<>$2',[w.id,target])).rows[0].total);
   if(other+limit>Number(w.balance_fen)+Number(w.spent_fen))throw new HttpError(409,'分配总额不能超过已模拟付款的资金');
   await db.query('INSERT INTO demo_allocations(wallet_id,user_id,limit_fen) VALUES($1,$2,$3) ON CONFLICT(wallet_id,user_id) DO UPDATE SET limit_fen=$3',[w.id,target,limit]);
   await audit(db,req.actor,'demo.allocation_set',org,target,{limit_fen:limit});
  });res.json({simulated:true,ok:true});});
 app.post('/api/demo/keys',requireCustomer,async(req,res)=>{const org=req.body.organization_id||null,code=model(req.body.model_code).code,label=text(req.body.label,'接入名称',80);
  const key=await transaction(pool,async db=>{const s=await scope(db,req,org),w=await wallet(db,s);if(Number(w.balance_fen)<=0)throw new HttpError(409,'请先完成模拟付款');
   const paid=await db.query("SELECT 1 FROM demo_orders WHERE wallet_id=$1 AND model_code=$2 AND status='paid' LIMIT 1",[w.id,code]);if(!paid.rowCount)throw new HttpError(409,'请先为此模型完成模拟订单');
   if(org){const a=(await db.query('SELECT limit_fen,spent_fen FROM demo_allocations WHERE wallet_id=$1 AND user_id=$2',[w.id,req.customer.id])).rows[0];if(!a||Number(a.limit_fen)<=Number(a.spent_fen))throw new HttpError(409,'请企业代表人先分配可用额度');}
   return (await db.query('INSERT INTO demo_keys(wallet_id,user_id,model_code,label) VALUES($1,$2,$3,$4) RETURNING id,label,model_code,status',[w.id,req.customer.id,code,label])).rows[0];
  });res.status(201).json({simulated:true,key});});
 app.post('/api/demo/keys/:key/usage',requireCustomer,async(req,res)=>{const org=req.body.organization_id||null,input=integer(req.body.input_tokens,'输入 Token',1,1000000),output=integer(req.body.output_tokens,'输出 Token',1,1000000);
  const record=await transaction(pool,async db=>{const s=await scope(db,req,org),w=await wallet(db,s);await db.query('SELECT id FROM demo_wallets WHERE id=$1 FOR UPDATE',[w.id]);
   const key=(await db.query('SELECT * FROM demo_keys WHERE id=$1 AND wallet_id=$2 AND user_id=$3',[id(req.params.key),w.id,req.customer.id])).rows[0];if(!key||key.status!=='active')throw new HttpError(404,'演示接入不存在或已停用');
   const m=model(key.model_code),cost=Math.max(1,Math.ceil((input*m.input_fen_per_1000+output*m.output_fen_per_1000)/1000));
   const balance=Number((await db.query('SELECT balance_fen FROM demo_wallets WHERE id=$1',[w.id])).rows[0].balance_fen);if(balance<cost)throw new HttpError(409,'演示余额不足');
   if(org){const a=(await db.query('SELECT limit_fen,spent_fen FROM demo_allocations WHERE wallet_id=$1 AND user_id=$2',[w.id,req.customer.id])).rows[0];if(!a||Number(a.limit_fen)-Number(a.spent_fen)<cost)throw new HttpError(409,'员工演示额度不足');await db.query('UPDATE demo_allocations SET spent_fen=spent_fen+$3 WHERE wallet_id=$1 AND user_id=$2',[w.id,req.customer.id,cost]);}
   await db.query('UPDATE demo_wallets SET balance_fen=balance_fen-$2,spent_fen=spent_fen+$2 WHERE id=$1',[w.id,cost]);
   return (await db.query('INSERT INTO demo_usage(wallet_id,key_id,user_id,model_code,input_tokens,output_tokens,cost_fen) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,model_code,input_tokens,output_tokens,cost_fen,created_at',[w.id,key.id,req.customer.id,key.model_code,input,output,cost])).rows[0];
  });res.status(201).json({simulated:true,usage:record});});
 app.post('/api/demo/keys/:key/revoke',requireCustomer,async(req,res)=>{const org=req.body.organization_id||null;await transaction(pool,async db=>{const s=await scope(db,req,org),w=await wallet(db,s);const result=await db.query("UPDATE demo_keys SET status='revoked' WHERE id=$1 AND wallet_id=$2 AND user_id=$3",[id(req.params.key),w.id,req.customer.id]);if(!result.rowCount)throw new HttpError(404,'演示接入不存在');});res.json({simulated:true,ok:true});});
}
function idOrText(value){return text(value,'成员',128);}
