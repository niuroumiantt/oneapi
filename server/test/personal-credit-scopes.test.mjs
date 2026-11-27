import test from 'node:test';
import assert from 'node:assert/strict';
import {readCreditScopes} from '../src/billing.mjs';

test('scope totals cover all batches, protect account boundaries and exclude refunded and expired gifts',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {default:pg}=await import('pg');
 assert.ok(new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
 const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();await db.query('BEGIN');
 try{
  await db.query(`CREATE TEMP TABLE credit_packs(account_id text,model_id text,cash_fen bigint,consumed_cash_fen bigint,refunded_cash_fen bigint,remaining_fen numeric(30,10),gift_expires_at timestamptz,refund_id text);
   INSERT INTO credit_packs SELECT 'mine',NULL,100,0,0,100,NULL,NULL FROM generate_series(1,105);
   INSERT INTO credit_packs VALUES
   ('mine','deepseek-flash',5000,2000,0,6000,now()+interval '30 days',NULL),
   ('mine','deepseek-flash',100,100,0,0.0000000001,now()+interval '10 days',NULL),
   ('mine','glm-5.3',1000,100,0,1800,now()-interval '1 day',NULL),
   ('mine','glm-5.3',1000,0,1000,0,NULL,'frozen'),
   ('other','deepseek-flash',99999,0,0,99999,NULL,NULL);`);
  const rows=await readCreditScopes(db,'mine');
  assert.equal(rows.length,3);assert.equal(rows[0].model_id,null);assert.equal(rows[0].paid_fen,'10500');
  const ds=rows.find(r=>r.model_id==='deepseek-flash');assert.equal(ds.paid_fen,'3000');assert.equal(ds.gift_fen,'3000.0000000001');assert.ok(ds.next_gift_expires_at);
  const glm=rows.find(r=>r.model_id==='glm-5.3');assert.equal(glm.paid_fen,'900');assert.equal(Number(glm.gift_fen),0);assert.equal(glm.next_gift_expires_at,null);
  assert.deepEqual(await readCreditScopes(db,'missing'),[]);
 }finally{await db.query('ROLLBACK');await db.end();}
});
