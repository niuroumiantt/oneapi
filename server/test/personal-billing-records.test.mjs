import test from 'node:test';
import assert from 'node:assert/strict';
import {readPersonalBillingRecords,personalBillingRecordRoutes} from '../src/personal-billing-records.mjs';

test('billing records validate paging, retain fractional credit and provide next-page state',async()=>{
 let called=false;
 const db={query:async(sql,args)=>{called=true;assert.deepEqual(args,['owner',21,20,null,null]);return {rows:Array.from({length:21},(_,i)=>({id:i,model_id:'deepseek-flash',quota_fen:'0.1250000000',cash_fen:'0',gift_fen:'0.1250000000'}))};}};
 await assert.rejects(readPersonalBillingRecords(db,'owner','invalid','0'));await assert.rejects(readPersonalBillingRecords(db,'owner','usage','-1'));await assert.rejects(readPersonalBillingRecords(db,'owner','usage','1 OR 1=1'));assert.equal(called,false);
 const r=await readPersonalBillingRecords(db,'owner','usage','1');assert.equal(r.items.length,20);assert.equal(r.has_more,true);assert.equal(r.items[0].quota_fen,'0.1250000000');assert.equal(r.items[0].cash_fen,'0');assert.equal(r.items[0].model_name,'DeepSeek Flash');
});
test('records route requires customer auth and never accepts an owner supplied in query parameters',async()=>{
 let route,auth=()=>{};personalBillingRecordRoutes({get:(path,...handlers)=>{if(path==='/api/billing/personal/records')route=handlers;}},{query:async(sql,args)=>{assert.equal(args[0],'signed-in-owner');return {rows:[]};}},auth);
 assert.equal(route[0],auth);let result;await route[1]({customer:{id:'signed-in-owner'},query:{kind:'usage',owner:'other-owner'}},{json:r=>result=r});assert.deepEqual(result.items,[]);assert.equal(result.has_more,false);
});

test('SQL billing includes gift-only and multi-pack settlements, excludes other owners, paginates beyond old limits',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {default:pg}=await import('pg');assert.ok(new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
 const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();await db.query('BEGIN');
 try{
  // Transaction-local tables exercise the real SQL without modifying application data.
  await db.query(`CREATE TEMP TABLE billing_accounts(id text,owner_id text,organization_id text);
   CREATE TEMP TABLE customer_calls(id text,account_id text,key_id text,model_id text,status text,created_at timestamptz);
   CREATE TEMP TABLE customer_api_keys(id text,account_id text,label text,key_hint text);
   CREATE TEMP TABLE credit_consumptions(call_id text,face_fen numeric(30,10),cash_fen bigint);
   CREATE TEMP TABLE credit_packs(id text,account_id text,source_kind text,source_id text,refund_id text,created_at timestamptz,cash_fen bigint,face_fen bigint);
   CREATE TEMP TABLE payment_orders(id text,provider text,paid_at timestamptz);
   CREATE TEMP TABLE credit_refund_requests(pack_id text,status text,created_at timestamptz);
   CREATE TEMP TABLE payment_refunds(id text,order_id text,pack_id text,status text,amount_fen bigint,created_at timestamptz,processing_at timestamptz,completed_at timestamptz);
   INSERT INTO billing_accounts VALUES('a','owner',NULL),('b','other',NULL);
   INSERT INTO customer_api_keys VALUES('key-a','a','工作 Key','AA'),('key-b','b','别人的 Key','BB');
   INSERT INTO customer_calls VALUES('gift','a','key-a','deepseek-flash','settled',now()),('mixed','a','key-a','glm-5.3','settled',now()-interval '1 second'),('pending','a','key-a','glm-5.3','pending',now()),('private','b','key-b','glm-5.3','settled',now());
   INSERT INTO credit_consumptions VALUES('gift',0.125,0),('mixed',200,100),('mixed',300,200),('private',9999,9999);
   INSERT INTO customer_calls SELECT 'old-'||n,'a','key-a','deepseek-flash','settled',now()-n*interval '1 day' FROM generate_series(1,102) n;
   INSERT INTO credit_packs SELECT 'pack-'||n,'a','payment','order-'||n,NULL,now()-n*interval '1 day',100,200 FROM generate_series(1,105) n;
   INSERT INTO credit_packs VALUES('private-pack','b','payment','private-order',NULL,now(),999,1998);
   INSERT INTO payment_orders VALUES('order-1','alipay_f2f',now());`);
  await db.query('ALTER TABLE customer_calls ADD COLUMN input_tokens bigint DEFAULT 120, ADD COLUMN output_tokens bigint DEFAULT 30');
  const first=await readPersonalBillingRecords(db,'owner','usage','0');assert.equal(first.items.length,20);assert.equal(first.items[0].quota_fen,'0.1250000000');assert.equal(first.items[0].cash_fen,'0');assert.equal(first.items[1].quota_fen,'500.0000000000');assert.equal(first.items[1].cash_fen,'300');assert.equal(first.items[1].gift_fen,'200.0000000000');assert.equal(first.items[0].input_tokens,'120');
  const last=await readPersonalBillingRecords(db,'owner','usage','5');assert.equal(last.items.length,4);assert.equal(last.has_more,false);assert.ok(last.items.every(r=>r.key_label==='工作 Key'));
  const recharge=await readPersonalBillingRecords(db,'owner','recharge','0');assert.equal(recharge.items[0].payment_provider,'alipay_f2f');assert.equal(recharge.items[0].cash_fen,'100');
  const rechargeLast=await readPersonalBillingRecords(db,'owner','recharge','34');assert.equal(rechargeLast.items.length,3);assert.equal(rechargeLast.has_more,false);assert.equal(rechargeLast.items[2].id,'pack-105');
  assert.deepEqual((await readPersonalBillingRecords(db,'nobody','usage')).items,[]);

  assert.equal((await readPersonalBillingRecords(db,'owner','usage',0,{page_size:50})).items.length,50);
  assert.equal((await readPersonalBillingRecords(db,'owner','usage',0,{page_size:100})).items.length,100);
  await db.query(`INSERT INTO customer_calls(id,account_id,key_id,model_id,status,created_at) VALUES
   ('date-start','a','key-a','deepseek-flash','settled','2020-01-01T00:00:00+08:00'),
   ('date-end','a','key-a','deepseek-flash','settled','2020-01-01T23:59:59.999+08:00'),
   ('date-next','a','key-a','deepseek-flash','settled','2020-01-02T00:00:00+08:00');`);
  const filtered=await readPersonalBillingRecords(db,'owner','usage',0,{from:'2020-01-01',to:'2020-01-01'});
  assert.deepEqual(filtered.items.map(r=>r.id),['date-end','date-start']);
 }finally{await db.query('ROLLBACK');await db.end();}
});
