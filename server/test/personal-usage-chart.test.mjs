import test from 'node:test';
import assert from 'node:assert/strict';
import {readPersonalUsageChart,personalUsageRoutes} from '../src/personal-usage.mjs';

test('chart uses authenticated owner, full daily aggregation and exact integer totals',async()=>{
 const result=await readPersonalUsageChart({query:async(sql,args)=>{
  assert.deepEqual(args,['owner','2026-11-26T08:00:00.000Z']);
  assert.match(sql,/a.owner_id=\$1/);assert.match(sql,/k.purpose='api'/);
  assert.doesNotMatch(sql,/LIMIT|credit_consumptions|revoked_at IS NULL/);
  return {rows:[{date:'2026-11-25',model_id:null},{date:'2026-11-26',model_id:'custom-model',input_tokens:'9007199254740993',output_tokens:'19',unreported_calls:'1'}]};
 }},'owner',new Date('2026-11-26T08:00:00Z'));
 assert.equal(result.days[0].total,'0');assert.deepEqual(result.days[0].values,['0']);
 assert.equal(result.days[1].total,'9007199254741012');assert.equal(result.unreported_calls,'1');
 assert.equal(result.models[0].name,'custom-model');
});

test('chart route uses authenticated identity and prevents cached account data',async()=>{
 const routes=new Map(),guard=()=>{};let authenticatedOwner;
 personalUsageRoutes({get:(path,...handlers)=>routes.set(path,handlers)},{query:async(_sql,args)=>{authenticatedOwner=args[0];return {rows:[]};}},guard);
 const handlers=routes.get('/api/customer-credit/usage/chart');assert.equal(handlers[0],guard);
 let cache;await handlers[1]({customer:{id:'signed-in-user'},query:{owner:'other-user'}},{set:(key,value)=>{assert.equal(key,'Cache-Control');cache=value;},json:()=>{}});
 assert.equal(authenticatedOwner,'signed-in-user');assert.equal(cache,'no-store');
});

test('SQL chart isolates owners, retains revoked history, includes all calls and uses Shanghai calendar bounds',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {default:pg}=await import('pg');assert.ok(new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
 const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();await db.query('BEGIN');
 try{
  await db.query(`CREATE TEMP TABLE billing_accounts(id text,owner_id text);
   CREATE TEMP TABLE customer_api_keys(id text,account_id text,purpose text,revoked_at timestamptz);
   CREATE TEMP TABLE customer_calls(account_id text,key_id text,model_id text,status text,input_tokens bigint,output_tokens bigint,cached_input_tokens bigint,created_at timestamptz);
   INSERT INTO billing_accounts VALUES ('a','owner'),('b','other');
   INSERT INTO customer_api_keys VALUES ('key','a','api',now()),('compare','a','compare',null),('other','b','api',null);
   INSERT INTO customer_calls SELECT 'a','key','deepseek-flash','settled',100,20,90,'2026-11-26T08:00:00Z'::timestamptz FROM generate_series(1,105);
   INSERT INTO customer_calls VALUES
    ('a','key','deepseek-flash','settled',9007199254740993,7,0,'2026-11-25T16:00:00Z'),
    ('a','key','glm-5.3','settled',20,5,10,'2026-11-25T15:59:59Z'),
    ('a','key','glm-5.3','pending',null,null,null,'2026-11-26T08:00:00Z'),
    ('a','key','glm-5.3','failed',null,null,null,'2026-11-26T08:00:00Z'),
    ('a','key','glm-5.3','settled',10,1,0,'2026-08-26T16:00:00Z'),
    ('a','key','excluded-old','settled',999,999,0,'2026-08-26T15:59:59Z'),
    ('a','key','excluded-future','settled',999,999,0,'2026-11-26T16:00:00Z'),
    ('a','compare','excluded-compare','settled',999,999,0,'2026-11-26T08:00:00Z'),
    ('b','other','excluded-owner','settled',999,999,0,'2026-11-26T08:00:00Z');`);
  const clock=new Date('2026-11-26T08:00:00Z'),data=await readPersonalUsageChart(db,'owner',clock);
  assert.equal(data.days.length,92);assert.equal(data.start,'2026-08-27');assert.equal(data.end,'2026-11-26');
  assert.equal(data.days[0].total,'11');assert.equal(data.days[1].total,'0');
  assert.equal(data.days.at(-2).total,'25');assert.equal(data.days.at(-1).total,String(9007199254741000n+105n*120n));
  assert.equal(data.unreported_calls,'1');assert.equal(data.models.length,2);assert.ok(data.models.every(m=>!m.id.startsWith('excluded')));
  const other=await readPersonalUsageChart(db,'other',clock);assert.equal(other.days.at(-1).total,'1998');
  const empty=await readPersonalUsageChart(db,'new-account',clock);assert.equal(empty.models.length,0);assert.ok(empty.days.every(d=>d.total==='0'));
  for(const [at,start,end,length] of [
   ['2026-05-31T08:00:00Z','2026-03-01','2026-05-31',92],
   ['2024-05-31T08:00:00Z','2024-03-01','2024-05-31',92],
   ['2026-01-01T15:59:59Z','2025-10-02','2026-01-01',92],
   ['2026-01-01T16:00:00Z','2025-10-03','2026-01-02',92]
  ]){const r=await readPersonalUsageChart(db,'new-account',new Date(at));assert.equal(r.start,start);assert.equal(r.end,end);assert.equal(r.days.length,length);}
 }finally{await db.query('ROLLBACK');await db.end();}
});
