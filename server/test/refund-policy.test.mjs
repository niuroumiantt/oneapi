import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import express from 'express';
import {createApp} from '../src/app.mjs';
import {paidBackend} from '../src/customer-credit.mjs';
import {generateNextVipStatement} from '../src/vip-statements.mjs';
import {config,HttpError} from '../src/core.mjs';
import {migrate} from '../src/migrate.mjs';
import {businessConsoleRoutes,customerBusinessRoutes,requireFinance} from '../src/business-console.mjs';
import {cwRoutes} from '../src/cw-partners.mjs';
import {billingRoutes} from '../src/billing.mjs';
import {paymentRoutes,staffPaymentRoutes,creditPaidOrder,finishRefund} from '../src/payments.mjs';
import {refundQuote,settlePaidCall,expirePackGifts} from '../src/pack-ledger.mjs';
import {vipActivationProgress} from '../src/vip-recharges.mjs';
const url=process.env.TEST_REFUND_POLICY_DATABASE_URL,skip=!url;
let pool,server,origin,cfg,auth;let refundMode='SUCCESS',refundCalls=0;
before(async()=>{
 if(skip)return;assert.match(new URL(url).pathname,/_test$/);
 pool=new pg.Pool({connectionString:url});cfg=config({DATABASE_URL:url,APP_ORIGIN:'http://127.0.0.1:4180',BETTER_AUTH_SECRET:'policy-fixture-secret-12345678901234567890',CW_ENABLED:'true',CUSTOMER_PAID_ENABLED:'true',CUSTOMER_PAID_MODELS:'deepseek-flash,glm-5.3,glm-5.3-flash'});
 auth=createApp(pool,cfg,{sendMail:async()=>({}),verify:async()=>true}).auth;await migrate(pool,auth);await pool.query('TRUNCATE "user",staff_members,model_pack_offers CASCADE');
 for(const [subject,role]of [['admin','platform_admin'],['sales','operations'],['finance','finance']])await pool.query('INSERT INTO staff_members(subject,email,name,role,status) VALUES($1,$2,$1,$3,\'active\')',[subject,subject+'@test.invalid',role]);
 const app=express();app.use(express.json());
 const customer=(req,res,next)=>{if(!req.headers['x-user'])throw new HttpError(401,'login');req.customer={id:req.headers['x-user'],email:req.headers['x-user']+'@test.invalid'};req.actor={kind:'customer',id:req.customer.id};next();};
 const staff=(req,res,next)=>{const subject=req.headers['x-staff'];if(!['admin','sales','finance'].includes(subject))throw new HttpError(401,'staff');req.staff={subject,role:{admin:'platform_admin',sales:'operations',finance:'finance'}[subject],status:'active',finance_access:subject!=='sales'};req.actor={kind:'staff',id:subject};next();};
 const clients={wechat:{mchId:'test',appId:'test',native:async()=>({status:200,data:{code_url:'weixin://test-only'}}),refund:async r=>{refundCalls++;return refundMode==='REJECTED'?{status:400,data:{code:'PARAM_ERROR'}}:{status:200,data:{status:refundMode,out_refund_no:r.outRefundNo,out_trade_no:r.outTradeNo,amount:{refund:Number(r.amountFen),total:Number(r.totalFen)}}};}}};
 paymentRoutes(app,pool,customer,cfg,clients);staffPaymentRoutes(app,pool,staff,requireFinance,cfg,clients);businessConsoleRoutes(app,pool,staff,cfg);customerBusinessRoutes(app,pool,customer);cwRoutes(app,pool,customer,staff,cfg);billingRoutes(app,pool,customer,cfg,{channelsFor:()=>['wechat_native']});
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin='http://127.0.0.1:'+server.address().port;
});
after(async()=>{server?.closeAllConnections();server?.close();await pool?.end();});
async function api(path,body,{user,staff}={}){const r=await fetch(origin+path,{headers:{'Content-Type':'application/json',...(user?{'x-user':user}:{}),...(staff?{'x-staff':staff}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
async function person({vip=false,state='confirmed'}={}){
 const user=randomUUID();await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled,"phoneOnly") VALUES($1,$1,$2,true,now(),now(),false,false)',[user,user+'@test.invalid']);
 const account=(await pool.query('INSERT INTO billing_accounts(owner_id) VALUES($1) RETURNING *',[user])).rows[0];let partner;
 if(vip)partner=(await pool.query("INSERT INTO cw_partners(user_id,public_code,legal_name,contact_cipher,consent_version,owner_subject,status) VALUES($1,$2,'test','encrypted','v1','sales',$3) RETURNING id",[user,Array.from({length:8},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random()*24)]).join(''),state])).rows[0].id;
 return {user,account,partner};
}
async function paid(who,cash=10000,face=cash,snapshot={}){
 const order=(await pool.query("INSERT INTO payment_orders(out_trade_no,account_id,created_by,provider,amount_fen,face_fen,discount_snapshot,idempotency_key,expires_at) VALUES($1,$2,$3,'wechat_native',$4,$5,$6,$7,now()+interval '15 minutes') RETURNING *",['T'+randomUUID(),who.account.id,who.user,cash,face,snapshot,randomUUID()])).rows[0];
 await creditPaidOrder(pool,order.out_trade_no,{provider:'wechat_native',tradeNo:randomUUID(),totalFen:cash},'test-only');
 const pack=(await pool.query("SELECT * FROM credit_packs WHERE source_kind='payment' AND source_id=$1",[order.id])).rows[0];return {order,pack};
}
async function activate(who){return api('/api/staff/cw/'+who.partner+'/activate',{}, {staff:'sales'});}
async function ticket(who){return (await pool.query("INSERT INTO support_tickets(user_id,subject,body,category) VALUES($1,'退款诉求','请按原单核对','billing') RETURNING id",[who.user])).rows[0].id;}
async function consume(who,amount){
 const key=(await pool.query("INSERT INTO customer_api_keys(account_id,owner_id,label,secret_hash,key_hint,model_ids,limit_yuan) VALUES($1,$2,'test',$3,'test',ARRAY['deepseek-flash'],100000) RETURNING id",[who.account.id,who.user,randomUUID()])).rows[0].id;
 const call=(await pool.query("INSERT INTO customer_calls(account_id,key_id,owner_id,model_id,price_snapshot,status,hold_yuan) VALUES($1,$2,$3,'deepseek-flash','{}','pending',$4) RETURNING id",[who.account.id,key,who.user,amount])).rows[0].id;
 await settlePaidCall(pool,call,String(amount),{},'fixture',null,1);
}
async function invoice(who,amount){const v=await api('/api/billing/personal/invoices',{invoice_type:'general',title:'Test',amount_yuan:String(amount),email:'invoice@test.invalid'},{user:who.user});assert.equal(v.status,201,JSON.stringify(v.data));return v.data.id;}
async function selfRefund(who,pack,amount,key=randomUUID()){return api('/api/customer-credit/packs/'+pack.id+'/refund',{reason:'test refund',expected_amount_fen:amount,idempotency_key:key},{user:who.user});}

test('multiple ordinary recharges reach exactly 100; credit/failed/pending payments are not money',{skip},async()=>{
 const w=await person({vip:true});await paid(w,5000,10000);let progress=await vipActivationProgress(pool,w.partner);assert.equal(progress.total_fen,'5000');assert.equal(progress.eligible,false);assert.equal((await activate(w)).status,409);
 await paid(w,5000,10000);progress=await vipActivationProgress(pool,w.partner);assert.equal(progress.total_fen,'10000');assert.equal(progress.eligible,true);
 const a=await activate(w);assert.equal(a.status,200,JSON.stringify(a));assert.equal(a.data.payment.orders.length,2);
 const rs=(await pool.query('SELECT amount_fen FROM vip_activation_payments WHERE partner_id=$1',[w.partner])).rows;assert.deepEqual(rs.map(x=>x.amount_fen),['5000','5000']);
 assert.equal((await pool.query('SELECT list_credit_fen::text FROM billing_accounts WHERE id=$1',[w.account.id])).rows[0].list_credit_fen,'20000.0000000000');
 assert.equal((await activate(w)).status,409);
});

test('partial refund preserves activation money; metering consumes it without freezing later topups',{skip},async()=>{
 const w=await person({vip:true}),p=await paid(w,30000,60000);assert.equal((await activate(w)).status,200);
 let q=await refundQuote(pool,p.pack.id);assert.equal(q.red_fen,'30000');assert.equal(q.refundable_fen,'20000');assert.equal(q.retained_fen,'10000');
 const key=randomUUID(),r=await selfRefund(w,p.pack,20000,key);assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.data.status,'succeeded');assert.equal(r.data.amount_fen,'20000');
 const replay=await selfRefund(w,p.pack,20000,key);assert.equal(replay.status,200);assert.equal(replay.data.amount_fen,'20000');
 q=await refundQuote(pool,p.pack.id);assert.equal(q.red_fen,'10000');assert.equal(q.refundable_fen,'0');assert.equal(Number(q.remaining_fen),10000);assert.equal(q.bonus_fen,'0');
 await consume(w,30);q=await refundQuote(pool,p.pack.id);assert.equal(q.red_fen,'7000');assert.equal(q.non_refundable_fen,'7000');
 const next=await paid(w,5000);assert.equal((await refundQuote(pool,next.pack.id)).refundable_fen,'5000');
 const view=await api('/api/billing/personal',undefined,{user:w.user});assert.equal(view.status,200);assert.equal(view.data.credit_split.red_fen,'12000');assert.equal(view.data.credit_split.refundable_fen,'5000');
});

test('restricted refund requires administrator and same-account open billing ticket; customer cannot opt in',{skip},async()=>{
 const w=await person({vip:true}),p=await paid(w,10000,20000);await activate(w);const t=await ticket(w),other=await person(),foreign=await ticket(other);
 const spoof=await api('/api/customer-credit/packs/'+p.pack.id+'/refund',{reason:'spoof',policy_ticket_id:t,expected_amount_fen:10000,idempotency_key:randomUUID()},{user:w.user});assert.equal(spoof.status,409);
 const body={reason:'管理员核对客户工单，特批原路退款',policy_ticket_id:t,expected_amount_fen:10000,idempotency_key:randomUUID()};
 assert.equal((await api('/api/staff/payments/orders/'+p.order.id+'/refunds',body,{staff:'finance'})).status,403);
 assert.equal((await api('/api/staff/payments/orders/'+p.order.id+'/refunds',{...body,policy_ticket_id:foreign},{staff:'admin'})).status,409);
 const r=await api('/api/staff/payments/orders/'+p.order.id+'/refunds',body,{staff:'admin'});assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.data.status,'succeeded');
 const row=(await pool.query('SELECT policy_ticket_id,policy_override FROM payment_refunds WHERE id=$1',[r.data.refund_id])).rows[0];assert.equal(row.policy_ticket_id,t);assert.equal(row.policy_override,true);
});

test('invoice and activation restrictions overlap once; unbilled cash remains refundable',{skip},async()=>{
 const w=await person({vip:true}),p=await paid(w,30000);await activate(w);const iid=await invoice(w,80);
 let q=await refundQuote(pool,p.pack.id);assert.equal(q.non_refundable_fen,'10000');assert.equal(q.refundable_fen,'20000');assert.equal(q.invoice_fen,'8000');
 const r=await selfRefund(w,p.pack,20000);assert.equal(r.data.status,'succeeded',JSON.stringify(r));
 q=await refundQuote(pool,p.pack.id,{override:true});assert.equal(q.refundable_fen,'2000');assert.equal(q.retained_fen,'8000');
 const reject=await api('/api/staff/business/invoices/'+iid+'/reject',{note:'客户撤回开票申请'},{staff:'admin'});assert.equal(reject.status,200);
 q=await refundQuote(pool,p.pack.id,{override:true});assert.equal(q.refundable_fen,'10000');
});

test('invoice of consumed cash does not block later unrelated recharge',{skip},async()=>{
 const w=await person();await paid(w,10000);await consume(w,100);const newer=await paid(w,20000);await invoice(w,100);
 const q=await refundQuote(pool,newer.pack.id);assert.equal(q.invoice_fen,'0');assert.equal(q.refundable_fen,'20000');assert.equal(q.blocked,null);
});

test('channel rejection reverses held cash and face exactly; retry is idempotent',{skip},async()=>{
 const w=await person({vip:true}),p=await paid(w,30000,60000);await activate(w);refundMode='REJECTED';
 const r=await selfRefund(w,p.pack,20000);assert.equal(r.data.status,'failed',JSON.stringify(r));refundMode='SUCCESS';
 let q=await refundQuote(pool,p.pack.id);assert.equal(q.refunded_cash_fen,'0');assert.equal(Number(q.remaining_fen),60000);assert.equal(q.refundable_fen,'20000');
 await finishRefund(pool,r.data.refund_id,{outcome:'rejected',code:'PARAM_ERROR'},'duplicate');q=await refundQuote(pool,p.pack.id);assert.equal(Number(q.remaining_fen),60000);
 assert.equal((await selfRefund(w,p.pack,20000)).data.status,'succeeded');
});

test('pending/refunded orders do not satisfy activation and cannot race activation protection',{skip},async()=>{
 const w=await person({vip:true}),p=await paid(w,10000);refundMode='PROCESSING';const rr=await selfRefund(w,p.pack,10000);assert.equal(rr.data.status,'pending',JSON.stringify(rr));assert.equal((await activate(w)).status,409);
 await finishRefund(pool,rr.data.refund_id,{outcome:'succeeded'},'fixture');assert.equal((await vipActivationProgress(pool,w.partner)).total_fen,'0');refundMode='SUCCESS';
 const w2=await person({vip:true}),p2=await paid(w2,10000);const [a,b]=await Promise.all([activate(w2),selfRefund(w2,p2.pack,10000)]);assert.ok(!(a.status===200&&b.data.status==='succeeded'),JSON.stringify([a,b]));assert.ok([a.status,b.status].includes(409));
});

test('special discount minimum, admin approval, payment acceptance and immutable order terms',{skip},async()=>{
 const w=await person();const created=await api('/api/staff/business/discounts',{business_line:'direct',audience:'all',name:'一次一万三折',promo_code:'SPECIALX',customer_price_percent:30,non_refundable:true,min_cash_yuan:'10000',starts_at:new Date(Date.now()-1000).toISOString(),ends_at:new Date(Date.now()+86400000).toISOString(),reason:'特殊优惠约定'},{staff:'sales'});assert.equal(created.status,201,JSON.stringify(created));assert.equal(created.data.status,'pending');
 assert.equal((await api('/api/staff/business/discounts/'+created.data.id+'/approve',{note:'test'},{staff:'finance'})).status,403);
 assert.equal((await api('/api/staff/business/discounts/'+created.data.id+'/approve',{note:'同意门槛和不退款条款'},{staff:'admin'})).status,200);
 assert.equal((await api('/api/billing/quote',{cash_fen:999900,promo_code:'SPECIALX'},{user:w.user})).status,400);
 const quote=await api('/api/billing/quote',{cash_fen:1000000,promo_code:'SPECIALX'},{user:w.user});assert.equal(quote.status,200);assert.equal(quote.data.amount_fen,1000000);assert.equal(quote.data.discount_snapshot.refund_policy.non_refundable,true);
 const body={cash_fen:1000000,promo_code:'SPECIALX',expected_cash_fen:1000000,expected_face_fen:quote.data.face_fen,idempotency_key:randomUUID()};
 assert.equal((await api('/api/billing/personal/wechat-orders',body,{user:w.user})).status,409);
 const checkout=await api('/api/billing/personal/wechat-orders',{...body,accepted_refund_policy:quote.data.discount_snapshot.refund_policy_key},{user:w.user});assert.equal(checkout.status,201,JSON.stringify(checkout));
 const order=(await pool.query('SELECT * FROM payment_orders WHERE id=$1',[checkout.data.order.id])).rows[0];await creditPaidOrder(pool,order.out_trade_no,{provider:'wechat_native',tradeNo:randomUUID(),totalFen:1000000},'test');
 await pool.query('UPDATE discount_grants SET non_refundable=false,min_cash_fen=0 WHERE id=$1',[created.data.id]);
 const pack=(await pool.query('SELECT id FROM credit_packs WHERE source_id=$1',[order.id])).rows[0];assert.equal((await refundQuote(pool,pack.id)).refundable_fen,'0');
 const old=await paid(w,5000,10000,{grant_id:created.data.id,percent:50});assert.equal((await refundQuote(pool,old.pack.id)).refundable_fen,'5000');
});

test('historical backfill is capped at actual paid cash and migration reruns preserve partial refunds',{skip},async()=>{
 const w=await person({vip:true,state:'active'}),p=await paid(w,5000,10000);const newer=await person({vip:true}),p2=await paid(newer,30000,60000);await activate(newer);await selfRefund(newer,p2.pack,20000);await consume(newer,20);
 const before=(await pool.query('SELECT consumed_cash_fen,refunded_cash_fen,remaining_fen,removed_face_fen FROM credit_packs WHERE id=$1',[p2.pack.id])).rows[0];
 await migrate(pool,auth);await migrate(pool,auth);
 const after=(await pool.query('SELECT consumed_cash_fen,refunded_cash_fen,remaining_fen,removed_face_fen FROM credit_packs WHERE id=$1',[p2.pack.id])).rows[0];assert.deepEqual(after,before);
 const hold=(await pool.query('SELECT sum(amount_fen)::text n FROM vip_activation_payments WHERE partner_id=$1',[w.partner])).rows[0];assert.equal(hold.n,'5000');
 const count=(await pool.query("SELECT count(*)::int n FROM audit_events WHERE subject_id=$1 AND action='cw.activation_policy_backfilled'",[w.partner])).rows[0].n;assert.equal(count,1);
 assert.equal(Number((await refundQuote(pool,p.pack.id)).remaining_fen),10000);
});


test('partial refunds cancel only corresponding commission; retained cash still unlocks commission once',{skip},async()=>{
 const seller=await person({vip:true,state:'active'}),buyer=await person({vip:true});
 const code=(await pool.query("INSERT INTO cw_codes(partner_id,code,name,status,starts_at,ends_at) VALUES($1,'QWERTYUP','fixture','active',now(),now()+interval '1 day') RETURNING id",[seller.partner])).rows[0];
 const p=await paid(buyer,30000,60000,{cw:{partner_id:seller.partner,code_id:code.id,rate_bps:1000,percent:50,is_self_code:false}});await activate(buyer);
 const first=await selfRefund(buyer,p.pack,20000);assert.equal(first.data.status,'succeeded');
 let c=(await pool.query('SELECT expected_fen,unlocked_fen FROM cw_commissions WHERE order_id=$1',[p.order.id])).rows[0];assert.equal(c.expected_fen,'1000');assert.equal(c.unlocked_fen,'0');
 await consume(buyer,30);c=(await pool.query('SELECT expected_fen,unlocked_fen FROM cw_commissions WHERE order_id=$1',[p.order.id])).rows[0];assert.equal(c.unlocked_fen,'300');
 const ti=await ticket(buyer);const r=await api('/api/staff/payments/orders/'+p.order.id+'/refunds',{reason:'测试客户工单，退回尚未消费的激活款',policy_ticket_id:ti,expected_amount_fen:7000,idempotency_key:randomUUID()},{staff:'admin'});assert.equal(r.data.status,'succeeded',JSON.stringify(r));
 await finishRefund(pool,r.data.refund_id,{outcome:'succeeded'},'duplicate');
 c=(await pool.query('SELECT expected_fen,unlocked_fen FROM cw_commissions WHERE order_id=$1',[p.order.id])).rows[0];assert.equal(c.expected_fen,'300');assert.equal(c.unlocked_fen,'300');
 assert.equal((await pool.query("SELECT count(*)::int n FROM cw_commission_events WHERE order_id=$1 AND kind='refund'",[p.order.id])).rows[0].n,2);
});

test('gift expiry cannot turn into cash consumption, and closed tickets cannot authorize refund',{skip},async()=>{
 const w=await person({vip:true}),p=await paid(w,20000,40000);await activate(w);
 await pool.query("UPDATE credit_packs SET gift_expires_at=now()-interval '1 day' WHERE id=$1",[p.pack.id]);
 await Promise.all([expirePackGifts(pool),expirePackGifts(pool)]);await consume(w,20);
 const q=await refundQuote(pool,p.pack.id);assert.equal(q.red_fen,'18000');assert.equal(q.refundable_fen,'10000');assert.equal(q.non_refundable_fen,'8000');assert.equal(q.bonus_fen,'0');
 const t=await ticket(w);await pool.query("UPDATE support_tickets SET status='closed' WHERE id=$1",[t]);
 assert.equal((await api('/api/staff/payments/orders/'+p.order.id+'/refunds',{reason:'closed ticket',policy_ticket_id:t,expected_amount_fen:18000,idempotency_key:randomUUID()},{staff:'admin'})).status,409);
 assert.equal((await selfRefund(w,p.pack,9999)).status,409,'stale confirmed amount cannot refund');
});

test('model code → confirmed payment → isolated metering → original-order refund → monthly statement',{skip},async()=>{
 cfg.cw.modelPacks=true;
 try {
  const vip=await person({vip:true,state:'active'}),buyer=await person(),buyer2=await person();
  await pool.query("UPDATE cw_partners SET promotion_trial_until=now()+interval '7 days' WHERE id=$1",[vip.partner]);
  await pool.query(`INSERT INTO model_pack_offers(model_id,min_price_bps,settlement_bps)
   VALUES ('deepseek-flash',5000,4000),('glm-5.3',7000,5800),('glm-5.3-flash',8000,6500)`);
  assert.equal((await api('/api/cw/codes',{name:'Missing model'},{user:vip.user})).status,400);
  assert.equal((await api('/api/cw/codes',{name:'Below floor',model_id:'glm-5.3',model_price_bps:6999},{user:vip.user})).status,409);
  const backend=paidBackend(pool,cfg);
  const {id:keyId}= (await pool.query(`INSERT INTO customer_api_keys(account_id,owner_id,label,secret_hash,key_hint,model_ids,limit_yuan)
   VALUES($1,$2,'test',$3,'test',$4,1000) RETURNING id`,[buyer.account.id,buyer.user,randomUUID(),cfg.customerPaid.models])).rows[0];
  const reserve=(model,amount)=>backend.reserve({key:{account_id:buyer.account.id,key_id:keyId,owner_id:buyer.user,limit_yuan:'1000'},
   model:{id:model,rates:{},multiplier:1},route:{credentialId:null},hold:String(amount),origin:{client:'fixture'}});
  const examples=[
   ['deepseek-flash',5000,5000,20,1000,4000,4000,200],
   ['deepseek-flash',6500,6500,20,1300,5200,2800,500],
   ['glm-5.3',7000,7000,30,2100,4900,2100,360],
   ['glm-5.3-flash',8000,8000,40,3200,4800,1200,600],
  ];
  const orders=[];
  for(const [model,rate,cash] of examples){
   const made=await api('/api/cw/codes',{name:model+' '+rate,model_id:model,model_price_bps:rate},{user:vip.user});
   assert.equal(made.status,201,JSON.stringify(made.data));
   const promo_code=made.data.code;
   const quote=await api('/api/billing/quote',{cash_fen:cash,promo_code},{user:buyer.user});
   assert.equal(quote.status,200,JSON.stringify(quote.data));
   assert.equal(quote.data.face_fen,10000);
   assert.equal(quote.data.discount_snapshot.model_pack.id,model);
   assert.equal((await api('/api/billing/quote',{cash_fen:cash,promo_code},{user:vip.user})).status,400);
   const request={cash_fen:cash,promo_code,expected_cash_fen:cash,expected_face_fen:10000,idempotency_key:randomUUID()};
   assert.equal((await api('/api/billing/personal/wechat-orders',request,{user:buyer.user})).status,409);
   request.model_pack_confirmation=quote.data.discount_snapshot.model_pack_confirmation;
   const checkout=await api('/api/billing/personal/wechat-orders',request,{user:buyer.user});
   assert.equal(checkout.status,201,JSON.stringify(checkout.data));
   const order=(await pool.query('SELECT * FROM payment_orders WHERE id=$1',[checkout.data.order.id])).rows[0];
   assert.equal((await api('/api/billing/personal/wechat-orders',request,{user:buyer.user})).data.order.id,order.id);
   const receipt={provider:'wechat_native',tradeNo:randomUUID(),totalFen:cash};
   const results=await Promise.all(Array.from({length:2},()=>creditPaidOrder(pool,order.out_trade_no,receipt,'local-fixture')));
   assert.equal(results.filter(x=>x.credited).length,1);
   const {id:packId}=(await pool.query("SELECT id FROM credit_packs WHERE source_kind='payment' AND source_id=$1",[order.id])).rows[0];
   assert.equal((await pool.query('SELECT unlocked_fen FROM cw_commissions WHERE order_id=$1',[order.id])).rows[0].unlocked_fen,'0');
   orders.push({order,packId});
  }
  const foreign=(await api('/api/billing/personal/model-packs?model=deepseek-flash',undefined,{user:buyer2.user})).data;
  assert.deepEqual(foreign.items,[]);
  await assert.rejects(reserve('deepseek-v4-pro',1),{status:402});
  const held=await reserve('glm-5.3',90);
  await assert.rejects(reserve('glm-5.3',11),{status:402});
  await pool.query("UPDATE customer_calls SET status='failed' WHERE id=$1",[held]);
  // A model policy change after payment must not reprice this order.
  await pool.query("UPDATE model_pack_offers SET enabled=false WHERE model_id='deepseek-flash'");
  await pool.query("INSERT INTO model_pack_offers(model_id,min_price_bps,settlement_bps) VALUES('deepseek-flash',6000,5500)");
  for(let i=0;i<examples.length;i++){
   const [model,,cash,used,spent,refund,gift,commission]=examples[i],{order,packId}=orders[i];
   const call=await reserve(model,used);
   await Promise.all([1,2].map(()=>settlePaidCall(pool,call,String(used),{input:1,output:1},'fixture',null,1)));
   let quote=await refundQuote(pool,packId);
   assert.deepEqual([quote.consumed_cash_fen,quote.refundable_fen,quote.bonus_fen],[String(spent),String(refund),String(gift)]);
   if(i===0){
    await migrate(pool,auth);
    assert.equal((await refundQuote(pool,packId)).consumed_cash_fen,String(spent));
   }
   assert.equal((await selfRefund(buyer2,{id:packId},refund)).status,404);
   if(i===0){
    refundMode='REJECTED';
    const failure=await selfRefund(buyer,{id:packId},refund);
    refundMode='SUCCESS';
    assert.equal(failure.data.status,'failed',JSON.stringify(failure.data));
    quote=await refundQuote(pool,packId);
    assert.equal(quote.refundable_fen,String(refund));
   }
   const refundKey=randomUUID();
   const result=await selfRefund(buyer,{id:packId},refund,refundKey);
   assert.equal(result.data.status,'succeeded',JSON.stringify(result.data));
   assert.equal((await selfRefund(buyer,{id:packId},refund,refundKey)).data.refund_id,result.data.refund_id);
   assert.deepEqual((await pool.query('SELECT used_cash_fen,unlocked_fen,expected_fen FROM cw_commissions WHERE order_id=$1',[order.id])).rows[0],
    {used_cash_fen:String(spent),unlocked_fen:String(commission),expected_fen:String(commission)});
   assert.equal((await pool.query('SELECT refunded_fen FROM payment_orders WHERE id=$1',[order.id])).rows[0].refunded_fen,String(cash-spent));
  }
  const vipView=await api('/api/cw/me',undefined,{user:vip.user});
  assert.equal(vipView.status,200,JSON.stringify(vipView.data));
  assert.deepEqual(vipView.data.activity.promotion,{paid_fen:'26500',used_fen:'7600',used_quota_fen:'11000',refunded_fen:'18900',commission_fen:'1660'});
  assert.equal(vipView.data.activity.personal.paid_fen,'0');
  const account=(await pool.query('SELECT cash_balance_fen,list_credit_fen,total_spent_fen FROM billing_accounts WHERE id=$1',[buyer.account.id])).rows[0];
  assert.deepEqual(account,{cash_balance_fen:'0',list_credit_fen:'0.0000000000',total_spent_fen:'7600'});
  const now=new Date((await pool.query("SELECT date_trunc('month',now())+interval '1 month 2 days' AS ts")).rows[0].ts);
  while(await generateNextVipStatement(pool,{now})){}
  const {rows:[statement]}=await pool.query(`SELECT v.snapshot,substring(v.pdf for 4) AS header FROM cw_vip_statement_versions v
   JOIN cw_vip_statements s ON s.id=v.statement_id WHERE partner_id=$1 ORDER BY s.month DESC LIMIT 1`,[vip.partner]);
  assert.equal(statement.header.toString(),'%PDF');
  assert.equal(statement.snapshot.totals.commission_fen,'1660');
  assert.ok(statement.snapshot.entries.some(e=>e.model==='GLM-5.3'&&e.kind==='used'&&Number(e.face_fen)===3000));
  assert.ok(!JSON.stringify(statement.snapshot).includes(buyer.user));
  await migrate(pool,auth);
  assert.equal((await pool.query('SELECT consumed_cash_fen FROM credit_packs WHERE id=$1',[orders[0].packId])).rows[0].consumed_cash_fen,'1000');
 } finally {cfg.cw.modelPacks=false;refundMode='SUCCESS';}
});
