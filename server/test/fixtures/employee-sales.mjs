import { randomUUID } from 'node:crypto';
import { transaction } from '../../src/core.mjs';
import { creditPaidOrder } from '../../src/payments.mjs';
import { settlePaidCall } from '../../src/pack-ledger.mjs';

export async function seedEmployeeSales(pool) {
 const prefix='sales-'+randomUUID().slice(0,8);
 const a=prefix+'-a', b=prefix+'-b';
 const userId = suffix => prefix+'-'+suffix;
 const [alice,other,vipA,vipB,unknown]=['customer-a','customer-b','vip-a','vip-b','unassigned'].map(userId);
 const [aCode,bCode,waiting]=await transaction(pool,async db=>{
  for(const [subject,name] of [[a,'验收销售 A'],[b,'验收销售 B']]){
   await db.query("INSERT INTO staff_members(subject,email,name,role,status) VALUES($1,$1||'@example.test',$2,'operations','active')",[subject,name]);
  }
  for(const [uid,name,owner] of [
   [alice,'云帆科技',a],[other,'北辰设计',b],[vipA,'山岚研究',b],[vipB,'启明云图',b],[unknown,'未分配客户',null]
  ]){
   await db.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled,"phoneOnly") VALUES($1,$2,$1||\'@example.test\',true,now(),now(),false,false)',[uid,name]);
   await db.query("INSERT INTO customers(code,kind,user_id,owner_subject) VALUES($1,'personal',$1,$2) ON CONFLICT (user_id) DO UPDATE SET owner_subject=$2",[uid,owner]);
  }
  const aCode=(await db.query(`INSERT INTO discount_grants(name,audience,customer_price_percent,starts_at,ends_at,reason,status,created_by,promo_code,business_line)
   VALUES('客户推广码','all',50,now()-interval '1 day',now()+interval '30 days','本地测试','active',$1,$2,'direct') RETURNING id`,[a,'A'+prefix])).rows[0].id;
  const bCode=(await db.query(`INSERT INTO discount_grants(name,audience,customer_price_percent,starts_at,ends_at,reason,status,created_by,promo_code,business_line)
   VALUES('同事推广码','all',50,now()-interval '1 day',now()+interval '30 days','本地测试','active',$1,$2,'direct') RETURNING id`,[b,'B'+prefix])).rows[0].id;
  const waiting=(await db.query(`INSERT INTO discount_grants(name,audience,customer_price_percent,starts_at,ends_at,reason,status,created_by,promo_code,business_line)
   VALUES('首单折扣申请','all',40,now()-interval '1 day',now()+interval '30 days','客户预计增加调用量。','pending',$1,$2,'direct') RETURNING id`,[a,'P'+prefix])).rows[0].id;
  return [aCode,bCode,waiting];
 });
 const vipData=await transaction(pool,async db=>{
  const code = n => [...prefix.slice(-8)].map((c,i)=>'ABCDEFGHJKLMNPQRSTUVWXYZ'[(parseInt(c,16)+i+n)%24]).join('');
  const requestCode = (await db.query("INSERT INTO vip_invite_codes(code,created_by,max_uses) VALUES($1,$2,5) RETURNING id",[code(4),a])).rows[0].id;
  const otherInvite = (await db.query("INSERT INTO vip_invite_codes(code,created_by,max_uses) VALUES($1,$2,5) RETURNING id",[code(5),b])).rows[0].id;
  const result = {};
  for(const [suffix,user,owner,invite,offset,status] of [
   ['a',vipA,a,requestCode,0,'active'],['b',vipB,b,otherInvite,1,'confirmed']
  ]){
   result[suffix]=(await db.query(`INSERT INTO cw_partners(user_id,public_code,legal_name,contact_cipher,consent_version,owner_subject,invite_code_id,status,activated_at,next_contact_on)
    SELECT id,$2,name,'local-preview','fixture',$3,$4,$5,CASE WHEN $5='active' THEN now() END,current_date FROM "user" WHERE id=$1 RETURNING id`,[user,code(offset),owner,invite,status])).rows[0].id;
  }
  await db.query("INSERT INTO vip_payment_discount_requests(partner_id,customer_price_percent,reason,requested_by) VALUES($1,40,'VIP 折扣本地测试',$2)",[result.a,a]);
  return result;
 });
 async function pay(user, amount, grant) {
  const wallet=(await pool.query(`INSERT INTO billing_accounts(owner_id) VALUES($1)
   ON CONFLICT(owner_id) WHERE owner_id IS NOT NULL DO UPDATE SET owner_id=EXCLUDED.owner_id RETURNING id`,[user])).rows[0].id;
  const order=(await pool.query(`INSERT INTO payment_orders(out_trade_no,account_id,created_by,provider,amount_fen,idempotency_key,expires_at,discount_snapshot)
   VALUES($1,$2,$3,'alipay_f2f',$4,$1,now()+interval '24 hours',$5) RETURNING id,out_trade_no`,
   [randomUUID(),wallet,user,amount,grant?{grant_id:grant}:{}])).rows[0];
  await creditPaidOrder(pool,order.out_trade_no,{provider:'alipay_f2f',tradeNo:'fixture-'+order.id,totalFen:amount},'local-fixture');
  return { ...order,wallet,user };
 }
 async function use(order,amount) {
  const key=(await pool.query(`INSERT INTO customer_api_keys(account_id,owner_id,label,secret_hash,key_hint,model_ids,limit_yuan)
   VALUES($1,$2,'本地验收',$3,'local',ARRAY['deepseek-flash'],1000) RETURNING id`,[order.wallet,order.user,randomUUID()])).rows[0].id;
  const call=(await pool.query(`INSERT INTO customer_calls(account_id,key_id,owner_id,model_id,price_snapshot,status,hold_yuan)
   VALUES($1,$2,$3,'deepseek-flash','{}','pending',$4) RETURNING id`,[order.wallet,key,order.user,amount])).rows[0].id;
  await settlePaidCall(pool,call,String(amount),{},'local-sales-fixture',null,1);
 }
 const paidA=await pay(alice,25000,aCode);
 await pay(alice,10000,aCode);
 const paidB=await pay(other,84600,bCode);
 const paidVip=await pay(vipA,120000);
 await pay(vipB,180000);
 await pay(unknown,990000);
 await Promise.all([use(paidA,27.15),use(paidB,75),use(paidVip,86.25)]);
 // An older verified receipt exercises the difference between monthly and lifetime views.
 await pool.query(`INSERT INTO billing_ledger(account_id,kind,amount_fen,balance_after_fen,reference_kind,reference_id,created_at)
  VALUES($1,'recharge',12500,12500,'payment',$2,
   (date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai')-interval '10 days') AT TIME ZONE 'Asia/Shanghai')`,[paidA.wallet,randomUUID()]);
 const addRefund=(type,amount)=>pool.query(`INSERT INTO payment_refunds(order_id,out_request_no,amount_fen,reason,status,requested_by,idempotency_key,completed_at)
  VALUES($1,$2,$3,'本地验收退款',$4,$5,$2,CASE WHEN $4='pending' THEN NULL ELSE now() END)`,
  [paidA.id,randomUUID(),amount,type,alice]);
 await addRefund('succeeded',5000);
 await addRefund('pending',4000);
 await pool.query("INSERT INTO support_answers(category,question,answer,created_by) VALUES('complaint','如何核对扣费','我们会核对对应调用并回复。',$1)",[a]);
 const tickets={};
 for(const [label,user,subject,category,tier] of [
  ['a',alice,'调用超时及扣费投诉','complaint','first_line'], ['tech',alice,'等技术指引','question','technical'],
  ['b',other,'第二位员工负责的建议','feedback','first_line'], ['unknown',unknown,'未分配客户的请求','question','first_line']
 ]){
  tickets[label]=(await pool.query('INSERT INTO support_tickets(user_id,subject,body,category,tier) VALUES($1,$2,$3,$4,$5) RETURNING id',
   [user,subject,'真实工单表中的本地验收记录。',category,tier])).rows[0].id;
 }
 return {a,b,tickets,waiting,vipData};
}
