import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {usageFilters,usageCsvCell,usageCsvRow,personalBillingRecordRoutes} from '../src/personal-billing-records.mjs';

test('date and page size validation accepts only actual dates and supported sizes',()=>{
 for(const opts of [{page_size:4},{page_size:1000},{from:'2026-02-30'},{from:'2026-11-28',to:'2026-11-27'},{to:'invalid'}])assert.throws(()=>usageFilters(opts));
 assert.deepEqual(usageFilters({page_size:'50',from:'2024-02-29',to:'2024-03-01'}),{size:50,from:'2024-02-29',to:'2024-03-01'});
 for(const size of [2,3,5,8])assert.equal(usageFilters({page_size:String(size)}).size,size);
 assert.equal(usageFilters().size,20);
});
test('CSV escapes text, prevents formulas and preserves sub-fen precision',()=>{
 assert.equal(usageCsvCell('=SUM(A1)'),`"'=SUM(A1)"`);assert.equal(usageCsvCell(' +1'),`"' +1"`);
 assert.equal(usageCsvCell('a,"b"'),`"a,""b"""`);
 const row=usageCsvRow({created_at:'2026-11-26T16:00:00Z',model_name:'测试',key_label:'@formula',quota_fen:'0.0000000001',cash_fen:'0',gift_fen:'0.0000000001'});
 assert.match(row,/2026-11-27 00:00:00/);assert.match(row,/0.000000000001/);assert.match(row,/'@formula/);
});
test('authenticated export streams all pages, passes owner and dates, omits secrets',async()=>{
 const queries=[];let released=false;
 const client={query:async(sql,args)=>{queries.push({sql,args});if(!args)return {rows:[]};assert.equal(args[0],'signed-in-user');assert.deepEqual(args.slice(3),['2026-11-01','2026-11-27']);return {rows:Array.from({length:Math.min(101,Math.max(0,125-args[2]))},(_,i)=>({id:String(args[2]+i),created_at:'2026-11-27T00:00:00Z',model_id:'deepseek-flash',key_label:'test-'+(args[2]+i),key_hint:'tail',input_tokens:10,output_tokens:2,quota_fen:'100',cash_fen:'50',gift_fen:'50'}))};},release:()=>released=true};
 const app=express();personalBillingRecordRoutes(app,{connect:async()=>client},(req,res,next)=>{if(req.get('x-test-user')!=='yes')return res.sendStatus(401);req.customer={id:'signed-in-user'};next();});
 app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
 const base='http://127.0.0.1:'+server.address().port+'/api/billing/personal/records/export';
 assert.equal((await fetch(base)).status,401);
 const r=await fetch(base+'?from=2026-11-01&to=2026-11-27&owner=other',{headers:{'x-test-user':'yes'}});assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/2026-11-01-2026-11-27.csv/);
 const csv=await r.text();assert.equal(csv.trim().split('\r\n').length,126);assert.match(csv,/test-124/);assert.doesNotMatch(csv,/secret|sf_paid_/);assert.equal(released,true);assert.match(queries[0].sql,/REPEATABLE READ/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
