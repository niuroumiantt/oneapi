import pg from 'pg';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {fromNodeHeaders} from 'better-auth/node';
import {createApp} from '../../server/src/app.mjs';
import {migrate} from '../../server/src/migrate.mjs';
import {config,HttpError,vault} from '../../server/src/core.mjs';
import {paymentRoutes,creditPaidOrder} from '../../server/src/payments.mjs';
import {settlePaidCall} from '../../server/src/pack-ledger.mjs';
import {OFFICIAL_MODELS} from '../../server/src/official-models.mjs';
import {cwRoutes} from '../../server/src/cw-partners.mjs';
import {billingRoutes} from '../../server/src/billing.mjs';

const port=Number(process.env.LOCAL_PREVIEW_PORT||4297);
const origin='http://127.0.0.1:'+port;
const database=process.env.LOCAL_PREVIEW_DATABASE_URL;
if(!database)throw Error('Set LOCAL_PREVIEW_DATABASE_URL to a dedicated local *_test database');
const target=new URL(database);
if(!['localhost','127.0.0.1'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Local test database only');
const pool=new pg.Pool({connectionString:database});
const usagePrices=[['deepseek-flash',8000],['glm-5.3',8500],['glm-5.3-flash',8700]];
const enabledModels=process.env.LOCAL_PREVIEW_SCOPES==='true'
 ?usagePrices.map(([id])=>id):OFFICIAL_MODELS.filter(model=>model.verified).map(model=>model.id);
const cfg=config({DATABASE_URL:database,APP_ORIGIN:origin,BETTER_AUTH_SECRET:'local-browser-fixture-not-a-real-credential-123',CW_ENABLED:'true',CW_MODEL_PACKS_ENABLED:'true',CUSTOMER_MODEL_USAGE_PRICES:usagePrices.map(([id,price])=>id+'='+price).join(','),CUSTOMER_PAID_ENABLED:'true',CUSTOMER_PAID_MODELS:enabledModels.join(',')});
const service=createApp(pool,cfg,{sendMail:async()=>({}),verify:async()=>true});
await migrate(pool,service.auth);
async function seed(email,name){
 let user=(await pool.query('SELECT id FROM "user" WHERE email=$1',[email])).rows[0];
 if(!user){
  user=(await service.auth.api.signUpEmail({body:{email,name,password:'Preview-Pack!4297-Local'}})).user;
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1',[user.id]);
 }
 return user.id;
}
const vip=await seed('vip@example.test','本地验收 VIP');
const localAdmin=await seed('admin@example.test','本地定价管理员');
const buyer=await seed('customer@example.test','本地验收客户');
await pool.query("INSERT INTO staff_members(subject,email,name,role,status) VALUES('preview-staff','staff@example.test','本地管理员','platform_admin','active') ON CONFLICT DO NOTHING");
await pool.query(`INSERT INTO cw_partners(user_id,public_code,legal_name,contact_cipher,consent_version,owner_subject,status,promotion_trial_until)
 VALUES($1,'PRVWTEST','本地验收 VIP','local','v1','preview-staff','active',now()+interval '30 days') ON CONFLICT DO NOTHING`,[vip]);
for(const model of cfg.customerPaid.models){
 await pool.query(`INSERT INTO model_pack_offers(model_id,min_price_bps,settlement_bps,cost_bps)
 VALUES($1,5000,3500,3500) ON CONFLICT DO NOTHING`,[model]);
}
const app=express();
const fixture=express.Router();
fixture.use(express.json());
fixture.use((req,res,next)=> req.method==='GET'||req.get('origin')===origin ? next() : res.sendStatus(403));
const customer=async(req,res,next)=>{
 const s=await service.auth.api.getSession({headers:fromNodeHeaders(req.headers)});
 if(!s?.user.emailVerified)throw new HttpError(401,'请先登录');
 req.customer=s.user;
 req.actor={kind:'customer',id:s.user.id};
 next();
};
// Use a signed-in fixture account for the staff boundary; all pricing handlers are real.
const previewStaff = [customer, async (req,res,next) => {
 if (req.customer.id !== localAdmin) throw new HttpError(403,'仅本地管理员可访问');
 req.staff = (await pool.query("SELECT * FROM staff_members WHERE subject='preview-staff'")).rows[0];
 req.actor = {kind:'staff',id:req.staff.subject};
 next();
}];
const staffFixture = express.Router();
staffFixture.use(express.json());
staffFixture.use((req,res,next)=>req.method==='GET'||req.get('origin')===origin?next():res.sendStatus(403));
cwRoutes(staffFixture,pool,customer,previewStaff,cfg,{sendMail:async()=>({})});
app.use((req,res,next)=>/^\/api\/staff\/cw(?:\/|$)/.test(req.path)?staffFixture(req,res,next):next());
const wechat={mchId:'local',appId:'local',
 native:async ({outTradeNo})=>({status:200,data:{code_url:origin+'/local-payment/'+outTradeNo}}),
 query:async()=>({status:200,data:{}}),
 refund:async ({outRefundNo})=>({status:200,data:{status:'SUCCESS',out_refund_no:outRefundNo}})};
const payments=paymentRoutes(fixture,pool,customer,cfg,{wechat});
billingRoutes(fixture,pool,customer,cfg,payments);
app.use((req,res,next)=>/^\/api\/(billing|customer-credit\/packs)\//.test(req.path)?fixture(req,res,next):next());
app.get('/local-payment/:order',customer,async(req,res)=>{
 const o=(await pool.query('SELECT * FROM payment_orders WHERE out_trade_no=$1 AND created_by=$2',[req.params.order,req.customer.id])).rows[0];
 if(!o||req.customer.id!==buyer)throw new HttpError(404,'本地订单不存在');
 await creditPaidOrder(pool,o.out_trade_no,{provider:'wechat_native',tradeNo:'local-'+o.id,totalFen:o.amount_fen},'local');
 res.redirect('/#billing/personal');
});
app.get('/local-lab',customer,async(req,res)=>{
 const orders=(await pool.query(`SELECT o.id,o.out_trade_no,o.status,o.amount_fen,p.id pack_id,o.discount_snapshot->'model_pack'->>'name' model,
 p.remaining_fen,p.consumed_cash_fen FROM payment_orders o LEFT JOIN credit_packs p ON p.source_id=o.id
 WHERE o.created_by=$1 ORDER BY o.created_at DESC LIMIT 5`,[req.customer.id])).rows;
 res.type('html').send(`<meta charset="utf-8"><title>本地模型账本验收</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;color:#202940}table{width:100%;border-collapse:collapse}td,th{padding:14px;border-bottom:1px solid #ddd}button,input{padding:10px}small{color:#64748b}</style><h1>本地模型账本验收</h1><p>只模拟支付和调用；真实本地账本。成本 3.5 折，最低售价 5 折，VIP 提成 10%。</p><p><a href="/#billing/personal">充值与退款</a> · <a href="/#personal/vip">VIP 工作台</a></p><table><tr><th>模型</th><th>实付 / 已消费实付</th><th>剩余额度</th><th>测试操作</th></tr>${orders.map(o=>`<tr><td>${o.model||'通用额度'}</td><td>¥${Number(o.amount_fen)/100} / ¥${Number(o.consumed_cash_fen||0)/100}</td><td>¥${Number(o.remaining_fen||0)/100}</td><td>${o.status==='pending'?`<a href="/local-payment/${o.out_trade_no}">模拟支付成功</a>`:o.pack_id?`<form method="post" action="/local-consume"><input type="hidden" name="order" value="${o.id}"><input name="amount" type="number" min="0.01" step="0.01" value="40" style="width:90px"><button>模拟消费额度</button></form>`:''}</td></tr>`).join('')}</table><p><small>退款请使用充值页的原单退款操作。支付、上游调用和退款均不连接真实服务。</small></p>`);
});
app.post('/local-consume',express.urlencoded({extended:false}),customer,async(req,res)=>{
 if(req.get('origin')!==origin||req.customer.id!==buyer)throw new HttpError(403,'仅本地测试客户');
 const amount=Number(req.body.amount);
 if(!Number.isFinite(amount)||amount<=0||amount>50000)throw new HttpError(400,'请输入有效额度');
 const o=(await pool.query(`SELECT o.account_id,p.model_id FROM payment_orders o JOIN credit_packs p ON p.source_id=o.id
 WHERE o.id=$1 AND o.created_by=$2 AND o.status='paid' AND p.refund_id IS NULL`,[req.body.order,buyer])).rows[0];
 if(!o?.model_id)throw new HttpError(404,'没有有效的模型包');
 const key=(await pool.query(`INSERT INTO customer_api_keys(account_id,owner_id,label,secret_hash,key_hint,model_ids,limit_yuan)
 VALUES($1,$2,'本地验收',$3,'local-test',$4,50000) RETURNING id`,[o.account_id,buyer,randomUUID(),[o.model_id]])).rows[0];
 const call=(await pool.query(`INSERT INTO customer_calls(account_id,key_id,owner_id,model_id,price_snapshot,status,hold_yuan)
 VALUES($1,$2,$3,$4,'{}','pending',$5) RETURNING id`,[o.account_id,key.id,buyer,o.model_id,amount])).rows[0];
 await settlePaidCall(pool,call.id,String(amount),{},'local-simulated',null,1);
 await pool.query('UPDATE customer_api_keys SET revoked_at=now() WHERE id=$1',[key.id]);
 res.redirect('/local-lab');
});
if(process.env.LOCAL_PREVIEW_SCOPES==='true'){
 // Exercise actual key issuance against local fixture routes. No inference egress.
 process.env.SUPPLIER_LAB_SECRET='local-preview-vault-only-not-a-production-secret';
 let supplier=(await pool.query("SELECT id FROM supplier_lab_suppliers WHERE name='Personal scopes local fixture'")).rows[0];
 if(!supplier){
  supplier=(await pool.query("INSERT INTO supplier_lab_suppliers(name,kind,created_by) VALUES('Personal scopes local fixture','supplier','preview-staff') RETURNING id")).rows[0];
  const credential=(await pool.query("INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by) VALUES($1,'Local fixture','https://kerapi.cn/v1',$2,'personal-scopes-local','preview-staff') RETURNING id",[supplier.id,vault(process.env.SUPPLIER_LAB_SECRET).seal({key:'local-fixture-never-used'})])).rows[0];
  for(const model of OFFICIAL_MODELS.filter(m=>cfg.customerPaid.models.includes(m.id)&&m.upstream==='kerapi')){
   await pool.query("INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,created_by,supplier_id,credential_id) VALUES('Local fixture','supplier','https://kerapi.cn/v1',$1,'personal-scopes-local','preview-staff',$2,$3)",[model.upstreamModel,supplier.id,credential.id]);
  }
 }
 app.use('/v1',(req,res)=>res.status(503).json({error:'本地预览不连接真实模型；请使用 local-lab 模拟调用。'}));
}
app.use(service.app);
app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
app.listen(port,'127.0.0.1',()=>console.log(origin));
