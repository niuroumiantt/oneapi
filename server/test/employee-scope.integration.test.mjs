import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {customerAuth} from '../src/auth.mjs';
import {migrate} from '../src/migrate.mjs';
import {businessConsoleRoutes} from '../src/business-console.mjs';
import {workspaceRoutes} from '../src/workspaces.mjs';
import {enforceStaffSurface} from '../src/staff-policy.mjs';
const databaseURL=process.env.STAFF_SCOPE_TEST_DATABASE_URL;
test('authenticated employee scope against PostgreSQL and HTTP routes',{skip:!databaseURL},async t=>{
 assert.ok(new URL(databaseURL).pathname.endsWith('_test'),'Dedicated *_test database required');
 const pool=new pg.Pool({connectionString:databaseURL});let server;
 t.after(async()=>{if(server)await new Promise(r=>server.close(r));await pool.end();});
 const cfg={origin:'http://127.0.0.1',secret:'employee-scope-test-only-secret-1234567890',production:false};
 await migrate(pool,customerAuth(pool,cfg,{queue:async()=>{}}));
 const suffix=randomUUID().slice(0,8),a='employee-a-'+suffix,b='employee-b-'+suffix,owner='owner-'+suffix;
 for(const [subject,role] of [[a,'operations'],[b,'support'],[owner,'platform_admin']])await pool.query('INSERT INTO staff_members(subject,email,name,role,status) VALUES($1,$2,$1,$3,\'active\')',[subject,subject+'@example.test',role]);
 const users=[a+'-customer',b+'-customer',a+'-unassigned'];
 for(const uid of users)await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled,"phoneOnly") VALUES($1,$1,$2,true,now(),now(),false,false)',[uid,uid+'@example.test']);
 await pool.query('SELECT ensure_customers()');
 await pool.query('UPDATE customers SET owner_subject=$1 WHERE user_id=$2',[a,users[0]]);
 await pool.query('UPDATE customers SET owner_subject=$1 WHERE user_id=$2',[b,users[1]]);
 const records=(await pool.query('SELECT id,user_id FROM customers WHERE user_id=ANY($1::text[])',[users])).rows;
 const own=records.find(c=>c.user_id===users[0]).id,other=records.find(c=>c.user_id===users[1]).id;
 const tickets=[];for(const uid of users)tickets.push((await pool.query("INSERT INTO support_tickets(user_id,subject,body) VALUES($1,$1,'private issue') RETURNING id",[uid])).rows[0].id);
 const app=express();app.use(express.json());
 const auth=(req,res,next)=>{const identity=req.headers['x-test-identity']==='owner'?owner:req.headers['x-test-identity']==='b'?b:a;req.staff={subject:identity,name:identity,status:'active',role:identity===owner?'platform_admin':'operations',finance_access:true,technical_access:true};req.actor={kind:'staff',id:identity};enforceStaffSurface(req);next();};
 businessConsoleRoutes(app,pool,auth,cfg);workspaceRoutes(app,pool,auth,cfg);
 app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
 server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const origin='http://127.0.0.1:'+server.address().port;
 const call=async(path,{identity='a',body,method=body?'POST':'GET'}={})=>{const r=await fetch(origin+path,{method,headers:{'x-test-identity':identity,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 await t.test('customer list, tags, detail and staff options contain only assigned scope',async()=>{
  const list=await call('/api/staff/business/customers');assert.equal(list.status,200,JSON.stringify(list.data));assert.deepEqual(list.data.customers.map(c=>c.id),[own]);assert.deepEqual(list.data.staff.map(s=>s.subject),[a]);
  assert.equal((await call('/api/staff/business/customers/'+other)).status,404);
  const detail=await call('/api/staff/business/customers/'+own);assert.equal(detail.status,200,JSON.stringify(detail.data));assert.equal(detail.data.finance,null);
  const all=await call('/api/staff/business/customers',{identity:'owner'});assert.ok(all.data.customers.some(c=>c.id===other));
 });
 await t.test('employee can follow own customer but cannot reassign or edit other customer',async()=>{
  assert.equal((await call('/api/staff/business/customers/'+own+'/notes',{body:{body:'local followup'}})).status,201);
  assert.equal((await call('/api/staff/business/customers/'+other+'/notes',{body:{body:'forbidden'}})).status,404);
  assert.equal((await call('/api/staff/business/customers/'+own,{body:{stage:'following',tags:[],owner_subject:b}})).status,403);
  assert.equal((await call('/api/staff/business/customers/'+own,{body:{stage:'following',tags:[],owner_subject:a}})).status,200);
  assert.equal((await call('/api/staff/business/customers/'+own,{body:{stage:'following',tags:['discount'],owner_subject:a}})).status,403);
 });
 await t.test('support reads and writes do not leak other or unassigned customer tickets',async()=>{
  const support=await call('/api/staff/business/support');assert.equal(support.status,200,JSON.stringify(support.data));assert.deepEqual(support.data.tickets.map(t=>t.id),[tickets[0]]);
  assert.equal((await call(`/api/staff/business/tickets/${tickets[1]}/reply`,{body:{body:'forbidden'}})).status,404);
  assert.equal((await call(`/api/staff/business/tickets/${tickets[1]}/triage`,{body:{category:'billing',tier:'technical'}})).status,404);
  assert.equal((await call(`/api/staff/business/tickets/${tickets[0]}/reply`,{body:{body:'reply to own customer'}})).status,200);
 });
 await t.test('employee dashboard omits company financial and supplier statistics',async()=>{
  const dash=await call('/api/staff/business/dashboard');assert.equal(dash.status,200,JSON.stringify(dash.data));assert.equal(dash.data.counts.my_customers,1);assert.equal(dash.data.counts.tickets,1);assert.equal(dash.data.finance,null);assert.equal(dash.data.staff.finance,false);assert.equal(dash.data.counts.suppliers,undefined);
  const access=await call('/api/staff/workspace/access');assert.deepEqual(access.data,{business:true,owner:false,technical:false,finance:false});
  const ownerAccess=await call('/api/staff/workspace/access',{identity:'owner'});assert.deepEqual(ownerAccess.data,{business:true,owner:true,technical:true,finance:true});
  for(const path of ['/api/staff/business/finance','/api/staff/business/suppliers','/api/staff/business/invoices','/api/staff/workspace/overview','/api/staff/workspace/view?surface=owner'])assert.equal((await call(path)).status,403,path);
 });
 await t.test('owner reassignment immediately removes previous employee access',async()=>{
  const change=await call('/api/staff/business/customers/'+own,{identity:'owner',body:{stage:'following',tags:[],owner_subject:b}});assert.equal(change.status,200,JSON.stringify(change.data));
  assert.equal((await call('/api/staff/business/customers/'+own)).status,404);
  assert.equal((await call(`/api/staff/business/tickets/${tickets[0]}/reply`,{body:{body:'no longer mine'}})).status,404);
  assert.equal((await call('/api/staff/business/customers/'+own,{identity:'b'})).status,200);
 });
});
