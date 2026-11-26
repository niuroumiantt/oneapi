import test from 'node:test';
import assert from 'node:assert/strict';
import {readPersonalUsage,readPersonalCalls} from '../src/personal-usage.mjs';

test('usage merges model and key totals without losing integer precision or revoked keys',async()=>{
 const rows=[
  {key_id:'a',model_id:'deepseek-flash',label:'Key A',key_hint:'A',calls:'101',input_tokens:'9007199254740993',output_tokens:'10',cash_fen:'20',unsettled_calls:'2'},
  {key_id:'a',model_id:'glm-5.3',label:'Key A',key_hint:'A',calls:'1',input_tokens:'4',output_tokens:'2',cash_fen:'10',unsettled_calls:'0'},
  {key_id:'b',model_id:'deepseek-flash',label:'Key B',key_hint:'B',revoked_at:'2026-11-01',calls:'2',input_tokens:'3',output_tokens:'1',cash_fen:'5',unsettled_calls:'0'}
 ];
 const result=await readPersonalUsage({query:async(sql,args)=>{assert.deepEqual(args,['owner','all']);assert.match(sql,/a.owner_id=\$1/);assert.match(sql,/k.purpose='api'/);assert.match(sql,/c.status='settled'/);assert.doesNotMatch(sql,/LIMIT 100|revoked_at IS NULL/);return {rows};}},'owner','all');
 assert.equal(result.totals.input_tokens,'9007199254741000');assert.equal(result.totals.cash_fen,'35');assert.equal(result.totals.calls,'104');
 assert.equal(result.keys[0].cash_fen,'30');assert.equal(result.models[0].cash_fen,'25');assert.equal(result.keys[1].revoked_at,'2026-11-01');
});
test('usage validates the period before querying and renders empty totals explicitly',async()=>{
 let queried=false;const db={query:async()=>{queried=true;return {rows:[]};}};
 await assert.rejects(readPersonalUsage(db,'owner','invalid'));assert.equal(queried,false);
 const result=await readPersonalUsage(db,'owner');assert.equal(result.totals.cash_fen,'0');assert.deepEqual(result.models,[]);assert.deepEqual(result.keys,[]);
});

test('SQL usage covers full history, cash across packs, time ranges and account isolation',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {default:pg}=await import('pg');const {randomUUID}=await import('node:crypto');
 assert.ok(new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
 const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();await db.query('BEGIN');
 try{
  async function setup(purpose='api'){
   const owner=randomUUID();await db.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled,"phoneOnly") VALUES($1,$2,$3,true,now(),now(),false,false)',[owner,'usage fixture',owner+'@example.test']);
   const account=(await db.query('INSERT INTO billing_accounts(owner_id) VALUES($1) RETURNING id',[owner])).rows[0].id;
   const key=(await db.query("INSERT INTO customer_api_keys(account_id,owner_id,label,secret_hash,key_hint,model_ids,limit_yuan,purpose) VALUES($1,$2,'fixture',$3,'DEMO',ARRAY['deepseek-flash'],100,$4) RETURNING id",[account,owner,randomUUID(),purpose])).rows[0].id;
   return {owner,account,key};
  }
  async function call(f,status='settled',age='0 days'){
   return (await db.query("INSERT INTO customer_calls(account_id,key_id,owner_id,model_id,price_snapshot,status,hold_yuan,charged_yuan,input_tokens,output_tokens,created_at) VALUES($1,$2,$3,'deepseek-flash','{}',$4,1,0.50,100,20,now()-$5::interval) RETURNING id",[f.account,f.key,f.owner,status,age])).rows[0].id;
  }
  const own=await setup(),other=await setup();
  for(let i=0;i<101;i++)await call(own);
  const selected=await call(own);
  await call(own,'pending');await call(own,'settled','400 days');await call(other);
  const compareKey=(await db.query("INSERT INTO customer_api_keys(account_id,owner_id,label,secret_hash,key_hint,model_ids,limit_yuan,purpose) VALUES($1,$2,'compare',$3,'DEMO',ARRAY['deepseek-flash'],100,'compare') RETURNING id",[own.account,own.owner,randomUUID()])).rows[0].id;
  await call({...own,key:compareKey});
  for(const cash of [2,3]){
   const pack=(await db.query("INSERT INTO credit_packs(account_id,source_kind,source_id,face_fen,cash_fen,remaining_fen) VALUES($1,'payment',$2,100,100,95) RETURNING id",[own.account,randomUUID()])).rows[0].id;
   await db.query('INSERT INTO credit_consumptions(call_id,pack_id,face_fen,cash_fen) VALUES($1,$2,5,$3)',[selected,pack,cash]);
  }
  await db.query('UPDATE customer_api_keys SET revoked_at=now() WHERE id=$1',[own.key]);
  const all=await readPersonalUsage(db,own.owner,'all');
  assert.equal(all.totals.calls,'104');assert.equal(all.totals.input_tokens,'10400');assert.equal(all.totals.cash_fen,'5');assert.equal(all.totals.unsettled_calls,'1');assert.equal(all.keys.length,1);assert.ok(all.keys[0].revoked_at);
  for(const period of ['month','week'])assert.equal((await readPersonalUsage(db,own.owner,period)).totals.calls,'103');
  assert.equal((await readPersonalUsage(db,other.owner,'all')).totals.calls,'1');
  const ids=new Set();let money=0n,page=0;
  while(true){const calls=await readPersonalCalls(db,own.owner,{period:'all',page:String(page++),size:'3'});for(const row of calls.items){assert.ok(!ids.has(row.id));ids.add(row.id);money+=BigInt(row.cash_fen||0);if(row.status==='pending')assert.equal(row.cash_fen,null);}if(!calls.has_more)break;}
  assert.equal(ids.size,104,'all personal calls remain reachable, including revoked keys');assert.equal(money,5n,'multi-pack charge is one call');
  assert.equal((await readPersonalCalls(db,other.owner,{period:'all'})).items.length,1);
  assert.equal((await readPersonalCalls(db,own.owner,{period:'all',page:'999'})).items.length,0);

 }finally{await db.query('ROLLBACK');await db.end();}
});

test('call detail rejects invalid pagination before executing SQL',async()=>{
 const db={query:()=>{throw Error('must not query');}};
 for(const options of [{period:'bad'},{size:'100'},{page:'-1'},{page:'1;DROP'}])await assert.rejects(readPersonalCalls(db,'owner',options),/分页无效/);
});
