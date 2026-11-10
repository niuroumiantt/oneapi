import { HttpError,id,text,transaction,audit } from './core.mjs';

const models=[
 {code:'demo-chat',name:'对话灵感 · 演示模型',kind:'对话与创作',input_fen_per_1000:2,output_fen_per_1000:4},
 {code:'demo-code',name:'代码搭档 · 演示模型',kind:'代码与开发',input_fen_per_1000:3,output_fen_per_1000:6},
 {code:'demo-reason',name:'深度思考 · 演示模型',kind:'分析与推理',input_fen_per_1000:4,output_fen_per_1000:8}
];
function model(code){const m=models.find(x=>x.code===code);if(!m)throw new HttpError(400,'请选择演示模型');return m;}
function integer(value,label,min,max){const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new HttpError(400,`${label}不在允许范围`);return n;}
function modelCodes(value){if(!Array.isArray(value)||value.length<1||value.length>models.length)throw new HttpError(400,'请选择至少一个演示模型');const codes=[...new Set(value.map(code=>model(code).code))];if(codes.length!==value.length)throw new HttpError(400,'模型选择不能重复');return codes;}
function memberModelCodes(value){if(!Array.isArray(value)||value.length>models.length)throw new HttpError(400,'员工型号授权格式不正确');if(!value.length)return [];return modelCodes(value);}
async function scope(db,req,org,manage=false){
 if(!org)return {owner:req.customer.id,organization:null,role:'personal'};
 id(org);
 const m=(await db.query("SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[org,req.customer.id])).rows[0];
 if(!m)throw new HttpError(403,'没有这个企业的访问权限');
 if(manage&&!['owner','admin'].includes(m.role))throw new HttpError(403,'只有企业管理者可以管理采购和额度');
 return {owner:null,organization:org,role:m.role};
}
async function wallet(db,s){
 if(s.organization){await db.query('INSERT INTO demo_wallets(organization_id) VALUES($1) ON CONFLICT(organization_id) WHERE organization_id IS NOT NULL DO NOTHING',[s.organization]);return (await db.query('SELECT * FROM demo_wallets WHERE organization_id=$1',[s.organization])).rows[0];}
 await db.query('INSERT INTO demo_wallets(owner_id) VALUES($1) ON CONFLICT(owner_id) WHERE owner_id IS NOT NULL DO NOTHING',[s.owner]);
 return (await db.query('SELECT * FROM demo_wallets WHERE owner_id=$1',[s.owner])).rows[0];
}
async function view(db,req,org){
 const s=await scope(db,req,org),w=await wallet(db,s),representative=s.role==='owner'||s.role==='admin';
 const orders=(await db.query('SELECT id,amount_fen,refunded_fen,status,created_at,paid_at FROM demo_orders WHERE wallet_id=$1'+(org&&!representative?' AND created_by=$2':'')+' ORDER BY created_at DESC LIMIT 30',org&&!representative?[w.id,req.customer.id]:[w.id])).rows;
 const enterpriseModels=(await db.query('SELECT model_code FROM demo_model_grants WHERE wallet_id=$1 ORDER BY selected_at,model_code',[w.id])).rows.map(r=>r.model_code);
 const allowedModels=org&&!representative?(await db.query('SELECT model_code FROM demo_member_models WHERE wallet_id=$1 AND user_id=$2',[w.id,req.customer.id])).rows.map(r=>r.model_code):enterpriseModels;
 const selected_models=enterpriseModels.filter(code=>allowedModels.includes(code));
 const keys=(await db.query('SELECT id,model_code,label,status,created_at,user_id FROM demo_keys WHERE wallet_id=$1'+(org&&!representative?' AND user_id=$2':'')+' ORDER BY created_at DESC LIMIT 50',org&&!representative?[w.id,req.customer.id]:[w.id])).rows;
 const keyModels=keys.length?(await db.query('SELECT key_id,model_code FROM demo_key_models WHERE key_id=ANY($1::uuid[])',[keys.map(k=>k.id)])).rows:[];
 for(const key of keys)key.model_codes=keyModels.filter(row=>row.key_id===key.id).map(row=>row.model_code);
 const usage=(await db.query('SELECT id,key_id,user_id,model_code,input_tokens,output_tokens,cost_fen,created_at FROM demo_usage WHERE wallet_id=$1'+(org&&!representative?' AND user_id=$2':'')+' ORDER BY created_at DESC LIMIT 100',org&&!representative?[w.id,req.customer.id]:[w.id])).rows;
 const refunds=representative||!org?(await db.query('SELECT id,amount_fen,fee_fen,status,created_at FROM demo_refunds WHERE wallet_id=$1 ORDER BY created_at DESC LIMIT 30',[w.id])).rows:[];
 const ledger=representative||!org?(await db.query('SELECT kind,amount_fen,created_at FROM demo_ledger WHERE wallet_id=$1 ORDER BY created_at DESC LIMIT 100',[w.id])).rows:[];
 let allocations=[];
 if(org){const q=representative?"SELECT a.user_id,a.limit_fen,a.spent_fen,u.name,u.email FROM demo_allocations a JOIN \"user\" u ON u.id=a.user_id WHERE a.wallet_id=$1 ORDER BY u.name":"SELECT a.user_id,a.limit_fen,a.spent_fen,u.name,u.email FROM demo_allocations a JOIN \"user\" u ON u.id=a.user_id WHERE a.wallet_id=$1 AND a.user_id=$2";allocations=(await db.query(q,representative?[w.id]:[w.id,req.customer.id])).rows;const grants=allocations.length?(await db.query('SELECT user_id,model_code FROM demo_member_models WHERE wallet_id=$1 AND user_id=ANY($2::text[])',[w.id,allocations.map(a=>a.user_id)])).rows:[];for(const a of allocations)a.model_codes=enterpriseModels.filter(code=>grants.some(g=>g.user_id===a.user_id&&g.model_code===code));}
 const members=org&&representative?(await db.query("SELECT m.user_id,u.name,u.email,m.role,m.status FROM memberships m JOIN \"user\" u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.status='active' ORDER BY m.created_at",[org])).rows:[];
 return {simulated:true,scope:org?'organization':'personal',organization_id:org||null,role:s.role,representative,models,selected_models,purchased_models:selected_models,wallet:{balance_fen:Number(w.balance_fen),spent_fen:Number(w.spent_fen)},orders,refunds,ledger,keys,usage,allocations,members};
}
export function demoJourneyRoutes(app,pool,requireCustomer){
 app.get('/api/demo/personal',requireCustomer,async(req,res)=>res.json(await view(pool,req,null)));
 app.get('/api/demo/organizations/:org',requireCustomer,async(req,res)=>res.json(await view(pool,req,req.params.org)));
 app.post('/api/demo/selections',requireCustomer,async(req,res)=>{const org=req.body?.organization_id||null,codes=modelCodes(req.body?.model_codes);await transaction(pool,async db=>{const s=await scope(db,req,org,!!org),w=await wallet(db,s);await db.query('SELECT id FROM demo_wallets WHERE id=$1 FOR UPDATE',[w.id]);const active=(await db.query("SELECT DISTINCT km.model_code FROM demo_key_models km JOIN demo_keys k ON k.id=km.key_id WHERE k.wallet_id=$1 AND k.status='active'",[w.id])).rows.map(r=>r.model_code);if(active.some(code=>!codes.includes(code)))throw new HttpError(409,'先停用包含已取消型号的演示接入');await db.query('DELETE FROM demo_model_grants WHERE wallet_id=$1',[w.id]);await db.query('DELETE FROM demo_member_models WHERE wallet_id=$1 AND NOT (model_code=ANY($2::text[]))',[w.id,codes]);for(const code of codes)await db.query('INSERT INTO demo_model_grants(wallet_id,model_code,selected_by) VALUES($1,$2,$3)',[w.id,code,req.customer.id]);await audit(db,req.actor,'demo.models_selected',org,w.id,{model_codes:codes});});res.json({simulated:true,selected_models:codes});});
 app.post('/api/demo/orders',requireCustomer,async(req,res)=>{const amount=integer(req.body.amount_yuan,'演示充值金额',5,100000)*100,org=req.body.organization_id||null;
  const order=await transaction(pool,async db=>{const s=await scope(db,req,org,!!org),w=await wallet(db,s);return (await db.query('INSERT INTO demo_orders(wallet_id,amount_fen,created_by) VALUES($1,$2,$3) RETURNING id,status,amount_fen',[w.id,amount,req.customer.id])).rows[0];});res.status(201).json({simulated:true,order});
 });
 app.post('/api/demo/orders/:order/pay',requireCustomer,async(req,res)=>{const org=req.body.organization_id||null;const result=await transaction(pool,async db=>{
  const s=await scope(db,req,org,!!org),w=await wallet(db,s);await db.query('SELECT id FROM demo_wallets WHERE id=$1 FOR UPDATE',[w.id]);
  const order=(await db.query('SELECT * FROM demo_orders WHERE id=$1 AND wallet_id=$2 FOR UPDATE',[id(req.params.order),w.id])).rows[0];if(!order)throw new HttpError(404,'演示订单不存在');
  if(order.status==='paid')return {status:'paid',balance_fen:Number((await db.query('SELECT balance_fen FROM demo_wallets WHERE id=$1',[w.id])).rows[0].balance_fen)};
  await db.query("UPDATE demo_orders SET status='paid',paid_at=now() WHERE id=$1",[order.id]);
  const updated=(await db.query('UPDATE demo_wallets SET balance_fen=balance_fen+$2 WHERE id=$1 RETURNING balance_fen',[w.id,order.amount_fen])).rows[0];
  await db.query("INSERT INTO demo_ledger(wallet_id,kind,amount_fen,reference_id) VALUES($1,'payment',$2,$3)",[w.id,order.amount_fen,order.id]);
  await audit(db,req.actor,'demo.payment_simulated',org,order.id,{amount_fen:Number(order.amount_fen)});return {status:'paid',balance_fen:Number(updated.balance_fen)};
 });res.json({simulated:true,...result});});
 app.post('/api/demo/refunds',requireCustomer,async(req,res)=>{const org=req.body?.organization_id||null,amount=integer(req.body?.amount_fen,'模拟退款金额',1,100000000);const result=await transaction(pool,async db=>{const s=await scope(db,req,org,!!org),w=await wallet(db,s);await db.query('SELECT id FROM demo_wallets WHERE id=$1 FOR UPDATE',[w.id]);const current=(await db.query('SELECT balance_fen,spent_fen FROM demo_wallets WHERE id=$1',[w.id])).rows[0];if(amount>Number(current.balance_fen))throw new HttpError(409,'模拟可退余额不足');if(org){const allocated=Number((await db.query('SELECT coalesce(sum(limit_fen),0) AS total FROM demo_allocations WHERE wallet_id=$1',[w.id])).rows[0].total);if(allocated>Number(current.balance_fen)+Number(current.spent_fen)-amount)throw new HttpError(409,'请先下调员工额度，再申请模拟退款');}let remaining=amount;const sources=(await db.query("SELECT id,amount_fen,refunded_fen FROM demo_orders WHERE wallet_id=$1 AND status='paid' AND refunded_fen<amount_fen ORDER BY paid_at DESC FOR UPDATE",[w.id])).rows;const allocation=[];for(const order of sources){const part=Math.min(remaining,Number(order.amount_fen)-Number(order.refunded_fen));if(part>0){allocation.push([order.id,part]);remaining-=part;}if(!remaining)break;}if(remaining)throw new HttpError(409,'没有足够的模拟已付款来源');const refund=(await db.query('INSERT INTO demo_refunds(wallet_id,amount_fen,created_by) VALUES($1,$2,$3) RETURNING id,amount_fen,fee_fen,status',[w.id,amount,req.customer.id])).rows[0];for(const [orderId,part] of allocation){await db.query('UPDATE demo_orders SET refunded_fen=refunded_fen+$2 WHERE id=$1',[orderId,part]);await db.query('INSERT INTO demo_refund_sources(refund_id,order_id,amount_fen) VALUES($1,$2,$3)',[refund.id,orderId,part]);}await db.query('UPDATE demo_wallets SET balance_fen=balance_fen-$2 WHERE id=$1',[w.id,amount]);await db.query("INSERT INTO demo_ledger(wallet_id,kind,amount_fen,reference_id) VALUES($1,'refund',$2,$3)",[w.id,-amount,refund.id]);await audit(db,req.actor,'demo.refund_simulated',org,refund.id,{amount_fen:amount,fee_fen:0});return refund;});res.status(201).json({simulated:true,refund:result});});
 app.post('/api/demo/allocations',requireCustomer,async(req,res)=>{const org=id(req.body.organization_id),target=idOrText(req.body.user_id),limit=integer(req.body.limit_yuan,'演示员工额度',0,1000000)*100,codes=memberModelCodes(req.body.model_codes);
  await transaction(pool,async db=>{const s=await scope(db,req,org,true),w=await wallet(db,s),locked=(await db.query('SELECT balance_fen,spent_fen FROM demo_wallets WHERE id=$1 FOR UPDATE',[w.id])).rows[0];
   const member=(await db.query("SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",[org,target])).rows[0];if(!member)throw new HttpError(400,'请选择有效企业成员');
   const prior=(await db.query('SELECT limit_fen,spent_fen FROM demo_allocations WHERE wallet_id=$1 AND user_id=$2',[w.id,target])).rows[0];if(limit<Number(prior?.spent_fen||0))throw new HttpError(409,'新额度不能低于已使用金额');
   const other=Number((await db.query('SELECT coalesce(sum(limit_fen),0) AS total FROM demo_allocations WHERE wallet_id=$1 AND user_id<>$2',[w.id,target])).rows[0].total);
   if(other+limit>Number(locked.balance_fen)+Number(locked.spent_fen))throw new HttpError(409,'分配总额不能超过已模拟付款的资金');
   const selected=(await db.query('SELECT model_code FROM demo_model_grants WHERE wallet_id=$1',[w.id])).rows.map(r=>r.model_code);if(codes.some(code=>!selected.includes(code)))throw new HttpError(409,'只能授权企业已选择的型号');
   const active=(await db.query("SELECT DISTINCT km.model_code FROM demo_key_models km JOIN demo_keys k ON k.id=km.key_id WHERE k.wallet_id=$1 AND k.user_id=$2 AND k.status='active'",[w.id,target])).rows.map(r=>r.model_code);if(active.some(code=>!codes.includes(code)))throw new HttpError(409,'先让员工停用包含已撤销型号的演示接入');
   await db.query('INSERT INTO demo_allocations(wallet_id,user_id,limit_fen) VALUES($1,$2,$3) ON CONFLICT(wallet_id,user_id) DO UPDATE SET limit_fen=$3',[w.id,target,limit]);
   await db.query('DELETE FROM demo_member_models WHERE wallet_id=$1 AND user_id=$2',[w.id,target]);for(const code of codes)await db.query('INSERT INTO demo_member_models(wallet_id,user_id,model_code) VALUES($1,$2,$3)',[w.id,target,code]);
   await audit(db,req.actor,'demo.allocation_set',org,target,{limit_fen:limit,model_codes:codes});
  });res.json({simulated:true,ok:true});});
 app.post('/api/demo/keys',requireCustomer,async(req,res)=>{const org=req.body.organization_id||null,codes=modelCodes(req.body.model_codes),label=text(req.body.label,'接入名称',80);
  const key=await transaction(pool,async db=>{const s=await scope(db,req,org),w=await wallet(db,s);if(Number(w.balance_fen)<=0)throw new HttpError(409,'请先完成模拟付款');
   const selected=(await db.query('SELECT model_code FROM demo_model_grants WHERE wallet_id=$1',[w.id])).rows.map(r=>r.model_code);if(codes.some(code=>!selected.includes(code)))throw new HttpError(409,'请先在模型清单选择这些型号');
   if(org){const a=(await db.query('SELECT limit_fen,spent_fen FROM demo_allocations WHERE wallet_id=$1 AND user_id=$2',[w.id,req.customer.id])).rows[0];if(!a||Number(a.limit_fen)<=Number(a.spent_fen))throw new HttpError(409,'请企业管理者先分配可用额度');if(s.role==='member'){const permitted=(await db.query('SELECT model_code FROM demo_member_models WHERE wallet_id=$1 AND user_id=$2',[w.id,req.customer.id])).rows.map(r=>r.model_code);if(codes.some(code=>!permitted.includes(code)))throw new HttpError(403,'企业未授权此员工使用该型号');}}
   const created=(await db.query('INSERT INTO demo_keys(wallet_id,user_id,model_code,label) VALUES($1,$2,$3,$4) RETURNING id,label,model_code,status',[w.id,req.customer.id,codes[0],label])).rows[0];for(const code of codes)await db.query('INSERT INTO demo_key_models(key_id,model_code) VALUES($1,$2)',[created.id,code]);return {...created,model_codes:codes};
  });res.status(201).json({simulated:true,key});});
 app.post('/api/demo/keys/:key/usage',requireCustomer,async(req,res)=>{const org=req.body.organization_id||null,input=integer(req.body.input_tokens,'输入 Token',1,1000000),output=integer(req.body.output_tokens,'输出 Token',1,1000000),code=model(req.body.model_code).code;
  const record=await transaction(pool,async db=>{const s=await scope(db,req,org),w=await wallet(db,s);await db.query('SELECT id FROM demo_wallets WHERE id=$1 FOR UPDATE',[w.id]);
   const key=(await db.query('SELECT * FROM demo_keys WHERE id=$1 AND wallet_id=$2 AND user_id=$3',[id(req.params.key),w.id,req.customer.id])).rows[0];if(!key||key.status!=='active')throw new HttpError(404,'演示接入不存在或已停用');
   if(!(await db.query('SELECT 1 FROM demo_key_models WHERE key_id=$1 AND model_code=$2',[key.id,code])).rowCount)throw new HttpError(403,'此接入未获该型号授权');
   if(org&&s.role==='member'&&!(await db.query('SELECT 1 FROM demo_member_models WHERE wallet_id=$1 AND user_id=$2 AND model_code=$3',[w.id,req.customer.id,code])).rowCount)throw new HttpError(403,'企业已撤销此型号授权');
   const m=model(code),cost=Math.max(1,Math.ceil((input*m.input_fen_per_1000+output*m.output_fen_per_1000)/1000));
   const balance=Number((await db.query('SELECT balance_fen FROM demo_wallets WHERE id=$1',[w.id])).rows[0].balance_fen);if(balance<cost)throw new HttpError(409,'演示余额不足');
   if(org){const a=(await db.query('SELECT limit_fen,spent_fen FROM demo_allocations WHERE wallet_id=$1 AND user_id=$2',[w.id,req.customer.id])).rows[0];if(!a||Number(a.limit_fen)-Number(a.spent_fen)<cost)throw new HttpError(409,'员工演示额度不足');await db.query('UPDATE demo_allocations SET spent_fen=spent_fen+$3 WHERE wallet_id=$1 AND user_id=$2',[w.id,req.customer.id,cost]);}
   await db.query('UPDATE demo_wallets SET balance_fen=balance_fen-$2,spent_fen=spent_fen+$2 WHERE id=$1',[w.id,cost]);
   const usage=(await db.query('INSERT INTO demo_usage(wallet_id,key_id,user_id,model_code,input_tokens,output_tokens,cost_fen) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,model_code,input_tokens,output_tokens,cost_fen,created_at',[w.id,key.id,req.customer.id,code,input,output,cost])).rows[0];await db.query("INSERT INTO demo_ledger(wallet_id,kind,amount_fen,reference_id) VALUES($1,'usage',$2,$3)",[w.id,-cost,usage.id]);return usage;
  });res.status(201).json({simulated:true,usage:record});});
 app.post('/api/demo/keys/:key/revoke',requireCustomer,async(req,res)=>{const org=req.body.organization_id||null;await transaction(pool,async db=>{const s=await scope(db,req,org),w=await wallet(db,s);const result=await db.query("UPDATE demo_keys SET status='revoked' WHERE id=$1 AND wallet_id=$2 AND user_id=$3",[id(req.params.key),w.id,req.customer.id]);if(!result.rowCount)throw new HttpError(404,'演示接入不存在');});res.json({simulated:true,ok:true});});
}
function idOrText(value){return text(value,'成员',128);}
