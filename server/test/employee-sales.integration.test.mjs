import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import { customerAuth } from '../src/auth.mjs';
import { migrate } from '../src/migrate.mjs';
import { HttpError, transaction } from '../src/core.mjs';
import { enforceStaffSurface } from '../src/staff-policy.mjs';
import { employeeSalesRoutes } from '../src/employee-sales.mjs';
import { businessConsoleRoutes } from '../src/business-console.mjs';
import { seedEmployeeSales } from './fixtures/employee-sales.mjs';

const database=process.env.EMPLOYEE_SALES_TEST_DATABASE_URL;
test('employee sales and work queue respect current owners and reconcile billing records',{skip:!database},async t=>{
 assert.match(new URL(database).pathname,/_test$/);
 const db=new pg.Pool({connectionString:database});
 let server;
 t.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db.end();});
 const cfg={origin:'http://127.0.0.1',secret:'local-only-sales-test-secret-1234567890',production:false};
 await migrate(db,customerAuth(db,cfg,{queue:async()=>{}}));
 const fixture=await seedEmployeeSales(db);
 const app=express();
 const requireStaff=(req,_res,next)=>{
  const subject=req.get('x-test-staff');
  if(!subject)throw new HttpError(401,'请先登录');
  req.staff={subject,name:'Test',role:'operations',status:'active',finance_access:true};
  enforceStaffSurface(req);
  next();
 };
 employeeSalesRoutes(app,db,requireStaff);
 businessConsoleRoutes(app,db,requireStaff,cfg);
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message,code:error.code}));
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 const get=async(path,who)=>{
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/staff/business/'+path,{headers:who?{'x-test-staff':who}:{}});
  return {status:response.status,data:await response.json()};
 };
 const totals=(data,period='month')=>Object.fromEntries(['customerRevenue','vipRevenue','customerSpend','vipSpend','customers','vips','customerCodes','vipCodes']
  .map(key=>[key,data.periods[period].reduce((sum,row)=>sum+row[key],0)]));
 await t.test('balances, use, issued codes and conversions stay separate even when the VIP has another CRM owner',async()=>{
  const [a,b]=await Promise.all([get('sales?subject='+fixture.b,fixture.a),get('sales',fixture.b)]);
  assert.equal(a.status,200,JSON.stringify(a.data));
  assert.equal(b.status,200,JSON.stringify(b.data));
  const expectedA={customerRevenue:300,vipRevenue:1200,customerSpend:27.15,vipSpend:86.25,customers:1,vips:1,customerCodes:1,vipCodes:1};
  const expectedB={customerRevenue:846,vipRevenue:1800,customerSpend:75,vipSpend:0,customers:1,vips:0,customerCodes:1,vipCodes:1};
  for(const period of ['today','month']){
   assert.deepEqual(totals(a.data,period),expectedA);
   assert.deepEqual(totals(b.data,period),expectedB);
  }
  assert.deepEqual(totals(a.data,'all'),{...expectedA,customerRevenue:425});
  assert.deepEqual(totals(b.data,'all'),expectedB);
 });
 await t.test('queue sources and direct ticket read filter by employee identity',async()=>{
  const [a,b]=await Promise.all([get('sales',fixture.a),get('sales',fixture.b)]);
  assert.equal(a.data.actionCount,1);
  assert.ok(a.data.tasks.some(item=>item.record_id===fixture.tickets.a&&item.kind==='complaint'&&item.status==='action'));
  assert.ok(a.data.tasks.some(item=>item.record_id===fixture.tickets.tech&&item.status==='technical'&&item.due===null));
  assert.ok(a.data.tasks.some(item=>item.record_id===fixture.waiting&&item.status==='review'));
  assert.ok(a.data.tasks.some(item=>item.record_id===fixture.vipData.a&&item.kind==='discount'&&item.status==='review'));
  assert.ok(b.data.tasks.some(item=>item.record_id===fixture.vipData.b&&item.kind==='vip'&&item.status==='action'));
  assert.ok(!a.data.tasks.some(item=>[fixture.tickets.b,fixture.tickets.unknown,fixture.vipData.b].includes(item.record_id)));
  assert.ok(!b.data.tasks.some(item=>[fixture.tickets.a,fixture.tickets.unknown,fixture.vipData.a].includes(item.record_id)));
  assert.equal((await get('support?ticket='+fixture.tickets.a,fixture.a)).data.tickets[0].id,fixture.tickets.a);
  assert.equal((await get('support?ticket='+fixture.tickets.a,fixture.b)).status,404);
  assert.equal((await get('sales')).status,401);
  assert.equal((await get('sales?surface=owner',fixture.a)).status,403);
  assert.equal((await get('finance',fixture.a)).status,403);
 });
 await t.test('reassignment drops the previous owner’s access immediately',async()=>{
  await transaction(db,async tx=>{
   await tx.query("UPDATE customers SET owner_subject=$2 WHERE owner_subject=$1",[fixture.a,fixture.b]);
   await tx.query("UPDATE cw_partners SET owner_subject=$2 WHERE owner_subject=$1",[fixture.a,fixture.b]);
  });
  const result=await get('sales',fixture.a);
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert.deepEqual(totals(result.data),{customerRevenue:0,vipRevenue:0,customerSpend:0,vipSpend:0,customers:0,vips:0,customerCodes:1,vipCodes:1});
  assert.ok(result.data.tasks.every(item=>item.destination==='discount'));
  assert.equal((await get('support?ticket='+fixture.tickets.a,fixture.a)).status,404);
 });
});
