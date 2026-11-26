import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import express from 'express';
import {config} from '../src/core.mjs';
import {createApp} from '../src/app.mjs';
import {migrate} from '../src/migrate.mjs';
import {generateNextVipStatement,vipStatementRoutes} from '../src/vip-statements.mjs';
const url=process.env.TEST_VIP_STATEMENT_DATABASE_URL;
test('scheduled monthly PDFs: Beijing cutoff, exact code totals, privacy, revisions and retry', {skip:!url}, async t=>{
 assert.match(new URL(url).pathname,/_test$/);const pool=new pg.Pool({connectionString:url});let server;
 try{
  const cfg=config({DATABASE_URL:url,BETTER_AUTH_SECRET:'monthly-statement-test-secret-only-123456',CW_ENABLED:'true'});
  await migrate(pool,createApp(pool,cfg).auth);
  await pool.query('TRUNCATE "user",staff_members CASCADE');
  const users={a:randomUUID(),b:randomUUID(),buyer:randomUUID()};
  for(const [key,value] of Object.entries(users))await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled,"phoneOnly") VALUES($1,$2,$3,true,now(),now(),false,false)',[value,'PRIVATE-'+key,key+'@private.example.test']);
  const partner=(await pool.query("INSERT INTO cw_partners(user_id,public_code,status,legal_name,contact_cipher,consent_version,activated_at,created_at) VALUES($1,'ABCDEFGH','active','PRIVATE NAME','PRIVATE PHONE','test','2026-10-10','2026-10-10') RETURNING id",[users.a])).rows[0];
  await pool.query("INSERT INTO cw_partners(user_id,public_code,status,legal_name,contact_cipher,consent_version) VALUES($1,'BCDEFGHJ','pending','Other','Private','test')",[users.b]);
  const account=(await pool.query('INSERT INTO billing_accounts(owner_id) VALUES($1) RETURNING id',[users.buyer])).rows[0];
  const codes=[],orders=[];
  for(const [i,code] of ['CDEFGHJK','DEFGHJKL'].entries()){
   const k=(await pool.query("INSERT INTO cw_codes(partner_id,code,name,status) VALUES($1,$2,'PRIVATE CAMPAIGN','active') RETURNING id",[partner.id,code])).rows[0];codes.push(k);
   const o=(await pool.query("INSERT INTO payment_orders(out_trade_no,account_id,created_by,provider,amount_fen,idempotency_key,expires_at) VALUES($1,$2,$3,'alipay_f2f',10000,$4,now()) RETURNING id",['MERCHANT-PRIVATE-'+i,account.id,users.buyer,randomUUID()])).rows[0];orders.push(o);
   const pack=(await pool.query("INSERT INTO credit_packs(account_id,source_kind,source_id,face_fen,cash_fen,remaining_fen) VALUES($1,'payment',$2,20000,10000,20000) RETURNING id",[account.id,o.id])).rows[0];
   await pool.query('INSERT INTO cw_commissions(order_id,pack_id,partner_id,code_id,cash_fen,rate_bps,expected_fen) VALUES($1,$2,$3,$4,10000,1000,1000)',[o.id,pack.id,partner.id,k.id]);
  }
  const event=async(order,kind,cash,commission,time)=>pool.query('INSERT INTO cw_commission_events(order_id,event_key,kind,cash_fen,commission_fen,occurred_at) VALUES($1,$2,$3,$4,$5,$6)',[order.id,randomUUID(),kind,cash,commission,time]);
  await event(orders[0],'paid',10000,1000,'2026-10-15T00:00:00+08:00');
  await event(orders[1],'paid',10000,1000,'2026-10-20T00:00:00+08:00');
  await event(orders[0],'used',4000,400,'2026-10-31T23:59:59+08:00');
  await event(orders[1],'used',2000,200,'2026-10-31T23:59:59+08:00');
  await event(orders[0],'refund',1000,-100,'2026-11-01T00:00:00+08:00');
  const now=new Date('2026-11-01T00:00:00+08:00');let statement;
  await t.test('before Beijing month-end nothing is generated; failed rendering leaves no partial inbox item',async()=>{
   assert.equal(await generateNextVipStatement(pool,{now:new Date(now-1)}),false);
   await assert.rejects(generateNextVipStatement(pool,{now,renderPDF:async()=>{throw Error('renderer offline');}}),/renderer offline/);
   assert.equal((await pool.query('SELECT count(*) n FROM cw_vip_statements')).rows[0].n,'0');
  });
  await t.test('concurrent workers create one October document, without including November refunds',async()=>{
   const results=await Promise.all([generateNextVipStatement(pool,{now}),generateNextVipStatement(pool,{now})]);
   assert.equal(results.filter(Boolean).length,1);statement=results.find(Boolean);assert.equal(statement.month,'2026-10');
   assert.equal(await generateNextVipStatement(pool,{now}),false);
   const s=(await pool.query('SELECT snapshot FROM cw_vip_statement_versions WHERE statement_id=$1',[statement.id])).rows[0].snapshot;
   assert.deepEqual(s.totals,{paid_fen:'20000',used_fen:'6000',refunded_fen:'0',commission_fen:'600'});
   assert.equal(s.codes.length,2);assert.equal(s.codes[0].commission_fen,'400');assert.equal(s.codes[1].commission_fen,'200');
   assert.ok(!JSON.stringify(s).includes('PRIVATE'));assert.ok(!JSON.stringify(s).includes(users.buyer));
  });
  const app=express();app.use(express.json());
  vipStatementRoutes(app,pool,(req,res,next)=>{req.customer={id:users[req.headers['x-user']]||'unauthorized'};next();},(_q,_s,next)=>next());
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
  const request=(path,user='a',body)=>fetch(origin+'/api/cw/statements'+path,{headers:{'x-user':user,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  let firstHash;
  await t.test('inbox and PDF are owner scoped, exact archived bytes; reads do not release any payout',async()=>{
   const list=await (await request('')).json();assert.equal(list.items.length,1);assert.equal(list.items[0].read_revision,0);
   assert.equal((await (await request('','b')).json()).items.length,0);
   assert.equal((await request('/'+statement.id+'/pdf','b')).status,404);
   assert.equal((await request('/'+statement.id+'/read','b',{revision:1})).status,404);
   const file=await request('/'+statement.id+'/pdf');assert.equal(file.headers.get('content-type'),'application/pdf');assert.equal(file.headers.get('cache-control'),'no-store');
   const bytes=Buffer.from(await file.arrayBuffer());firstHash=createHash('sha256').update(bytes).digest('hex');
   assert.equal(firstHash,(await pool.query('SELECT sha256 FROM cw_vip_statement_versions WHERE statement_id=$1',[statement.id])).rows[0].sha256);
   assert.equal((await request('/'+statement.id+'/read','a',{revision:1})).status,200);
   assert.equal((await pool.query('SELECT count(*) n FROM cw_payouts')).rows[0].n,'0');
  });
  await t.test('late October usage creates an unread revision, preserves old PDF and does not duplicate commission',async()=>{
   await event(orders[0],'used',1000,100,'2026-10-28T12:00:00+08:00');
   const revision=await generateNextVipStatement(pool,{now:new Date('2026-11-02T08:00:00+08:00')});assert.equal(revision.revision,2);
   const item=(await (await request('')).json()).items[0];assert.equal(item.read_revision,1);assert.equal(item.revision,2);assert.equal(item.totals.commission_fen,'700');assert.equal(item.versions.length,2);
   const original=Buffer.from(await (await request('/'+statement.id+'/pdf?revision=1')).arrayBuffer());assert.equal(createHash('sha256').update(original).digest('hex'),firstHash);
   await request('/'+statement.id+'/read','a',{revision:1});assert.equal((await (await request('')).json()).items[0].read_revision,1);
   assert.equal(await generateNextVipStatement(pool,{now:new Date('2026-11-03')}),false);
  });
  await t.test('restart catches up missed months; old recharge consumed next month earns next-month commission',async()=>{
   await event(orders[0],'used',1000,100,'2026-11-15T08:00:00+08:00');
   const missed=await generateNextVipStatement(pool,{now:new Date('2026-12-03T08:00:00+08:00')});assert.equal(missed.month,'2026-11');
   const s=(await pool.query('SELECT snapshot FROM cw_vip_statement_versions WHERE statement_id=$1',[missed.id])).rows[0].snapshot;
   assert.deepEqual(s.totals,{paid_fen:'0',used_fen:'1000',refunded_fen:'1000',commission_fen:'100'});
   assert.equal(await generateNextVipStatement(pool,{now:new Date('2026-12-03T08:00:00+08:00')}),false);
  });
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();}
});
