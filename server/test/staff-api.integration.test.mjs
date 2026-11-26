import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {customerAuth} from '../src/auth.mjs';
import {migrate} from '../src/migrate.mjs';
import {staffApiRoutes} from '../src/staff-api.mjs';
import {employeeInferenceRoutes} from '../src/employee-credit.mjs';
import {enforceStaffSurface} from '../src/staff-policy.mjs';
const url=process.env.STAFF_SCOPE_TEST_DATABASE_URL;
test('staff API uses only preassigned company allowance and own keys',{skip:!url},async t=>{
 assert.match(new URL(url).pathname,/_test$/);
 const pool=new pg.Pool({connectionString:url}),folder=await mkdtemp(join(tmpdir(),'staff-api-test-'));let server,upstreamCalls=0;
 const oldSecret=process.env.SUPPLIER_LAB_SECRET;process.env.SUPPLIER_LAB_SECRET='test-only-staff-api-secret-1234567890';
 t.after(async()=>{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await pool.end();await rm(folder,{recursive:true});if(oldSecret===undefined)delete process.env.SUPPLIER_LAB_SECRET;else process.env.SUPPLIER_LAB_SECRET=oldSecret;});
 const keyFile=join(folder,'fake-upstream-key');await writeFile(keyFile,'test-only-never-sent-upstream');
 const cfg={origin:'http://127.0.0.1',secret:'staff-api-fixture-secret-1234567890',production:false,pilot:{keyFile}};
 await migrate(pool,customerAuth(pool,cfg,{queue:async()=>{}}));
 const suffix=randomUUID(),a='staff-api-a-'+suffix,b='staff-api-b-'+suffix,c='staff-api-unfunded-'+suffix;
 for(const uid of [a,b,c]){
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled,"phoneOnly") VALUES($1,$1,$2,true,now(),now(),false,false)',[uid,uid+'@example.test']);
  await pool.query("INSERT INTO staff_members(subject,email,name,role,status) VALUES($1,$2,$1,'operations','active')",[uid,uid+'@example.test']);
 }
 const org=(await pool.query("INSERT INTO organizations(name,created_by) VALUES('Staff API fixture',$1) RETURNING id",[a])).rows[0].id;cfg.employeeCredit={organizationId:org};
 for(const uid of [a,b,c])await pool.query("INSERT INTO memberships(organization_id,user_id,role,status) VALUES($1,$2,'member','active')",[org,uid]);
 for(const uid of [a,b])await pool.query('INSERT INTO employee_credit_accounts(user_id,organization_id,granted_yuan) VALUES($1,$2,20)',[uid,org]);
 const app=express();app.use(express.json());
 const staff=(req,res,next)=>{const subject=req.headers['x-test-user']||a;req.staff={subject,role:'operations',status:'active'};req.actor={kind:'staff',id:subject};enforceStaffSurface(req);next();};
 staffApiRoutes(app,pool,cfg,staff);
 employeeInferenceRoutes(app,pool,cfg,async()=>{upstreamCalls++;throw Error('Must not call upstream');});
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,body,who=a,secret)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-test-user':who,...(secret?{Authorization:'Bearer '+secret}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 await t.test('status neither auto-provisions nor exposes a different user balance',async()=>{
  const ready=await call('/api/staff/self-api/status?user='+b);assert.equal(ready.status,200,JSON.stringify(ready.data));assert.equal(Number(ready.data.granted_yuan),20);
  const missing=await call('/api/staff/self-api/status',null,c);assert.equal(missing.data.enabled,false);
  assert.equal((await call('/api/staff/self-api/keys',{label:'denied'},c)).status,403);
  assert.equal((await pool.query('SELECT 1 FROM employee_credit_accounts WHERE user_id=$1',[c])).rowCount,0);
  await pool.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1',[b]);
  assert.equal((await call('/api/staff/self-api/status',null,b)).data.enabled,false);
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1',[b]);
 });
 const made=await call('/api/staff/self-api/keys',{label:'Own test key',owner_id:b});assert.equal(made.status,201,JSON.stringify(made.data));const key=made.data.key.id,secret=made.data.secret;
 await t.test('shared usage contract covers full history, periods and only this employee',async()=>{
  const another=await call('/api/staff/self-api/keys',{label:'Other employee'},b);
  await pool.query("INSERT INTO employee_calls(key_id,owner_id,model_id,price_snapshot,status,hold_yuan,charged_yuan,input_tokens,output_tokens,created_at) SELECT $1,$2,'deepseek-v4-pro','{}','settled',0,0.0125,100,20,now() FROM generate_series(1,40)",[key,a]);
  await pool.query("INSERT INTO employee_calls(key_id,owner_id,model_id,price_snapshot,status,hold_yuan,charged_yuan,input_tokens,output_tokens,created_at) VALUES($1,$2,'deepseek-v4-pro','{}','settled',0,1,10,2,now()-interval '400 days'),($3,$4,'deepseek-v4-pro','{}','settled',0,9,900,90,now())",[key,a,another.data.key.id,b]);
  const monthly=await call('/api/staff/self-api/usage?period=month&owner='+b);assert.equal(monthly.status,200,JSON.stringify(monthly.data));assert.equal(monthly.data.totals.calls,'40');assert.equal(monthly.data.totals.cash_fen,'50');assert.equal(monthly.data.models[0].input_tokens,'4000');
  const chart=await call('/api/staff/self-api/usage/chart');assert.equal(chart.status,200);assert.equal(chart.data.days.reduce((n,d)=>n+Number(d.total),0),4800);
  const all=await call('/api/staff/self-api/usage?period=all');assert.equal(all.data.totals.calls,'41');assert.equal(all.data.totals.cash_fen,'150');
  const other=await call('/api/staff/self-api/usage?period=all',null,b);assert.equal(other.data.totals.cash_fen,'900');
  const detail=await call('/api/staff/self-api/usage/calls?period=all&size=3&page=0');assert.equal(detail.status,200,JSON.stringify(detail.data));assert.equal(detail.data.items.length,3);assert.equal(detail.data.has_more,true);assert.equal(detail.data.items[0].cash_fen,'1');
  assert.equal((await call('/api/staff/self-api/usage/calls?size=100')).status,400);
  await pool.query('UPDATE employee_api_keys SET revoked_at=now() WHERE id=$1',[another.data.key.id]);
  assert.equal((await call('/api/staff/self-api/usage?period=all',null,b)).data.totals.calls,'1');
  await pool.query('DELETE FROM employee_calls WHERE owner_id=ANY($1::text[])',[[a,b]]);
 });
 await t.test('own key operations reject cross-user and over-budget edits',async()=>{
  assert.equal((await pool.query('SELECT owner_id FROM employee_api_keys WHERE id=$1',[key])).rows[0].owner_id,a);
  assert.equal((await call('/api/staff/self-api/keys/'+key+'/revoke',{},b)).status,404);
  assert.equal((await call('/api/staff/self-api/keys/'+key+'/manage',{label:'new',limit_yuan:500})).status,409);
  assert.equal((await call('/api/staff/self-api/keys/'+key+'/manage',{label:'new',limit_yuan:5})).status,200);
  const view=await call('/api/staff/self-api/status');assert.equal(view.data.keys[0].secret,undefined);
  assert.ok((await call('/api/staff/self-api/status',null,b)).data.keys.every(k=>k.id!==key));
 });
 await t.test('comparison exposes allocated account only and exhaustion stops before upstream',async()=>{
  const compare=await call('/api/staff/self-api/compare/config');assert.equal(compare.status,200,JSON.stringify(compare.data));assert.deepEqual(compare.data.products.map(p=>p.kind),['allocated']);
  await pool.query('UPDATE employee_credit_accounts SET spent_yuan=granted_yuan WHERE user_id=$1',[a]);
  assert.equal((await call('/api/staff/self-api/compare/config')).status,402);
  const request=await call('/v1/chat/completions',{model:'deepseek-v4-pro',messages:[{role:'user',content:'test'}],max_tokens:1024},a,secret);
  assert.equal(request.status,402,JSON.stringify(request.data));assert.equal(upstreamCalls,0);
 });
 await t.test('revocation and company membership suspension remove access',async()=>{
  assert.equal((await call('/api/staff/self-api/keys/'+key+'/revoke',{})).status,200);
  await pool.query("UPDATE memberships SET status='suspended' WHERE user_id=$1 AND organization_id=$2",[a,org]);
  assert.equal((await call('/api/staff/self-api/status')).data.enabled,false);
  assert.equal((await call('/api/staff/self-api/keys',{label:'denied'})).status,403);
 });
});
