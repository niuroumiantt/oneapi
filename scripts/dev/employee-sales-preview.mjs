// Local-only preview: real app routes and database, two isolated sample identities.
import express from 'express';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/src/app.mjs';
import { migrate } from '../../server/src/migrate.mjs';
import { config,HttpError } from '../../server/src/core.mjs';
import { enforceStaffSurface } from '../../server/src/staff-policy.mjs';
import { employeeSalesRoutes } from '../../server/src/employee-sales.mjs';
import { workspaceRoutes } from '../../server/src/workspaces.mjs';
import { businessConsoleRoutes } from '../../server/src/business-console.mjs';
import { cwRoutes } from '../../server/src/cw-partners.mjs';
import { seedEmployeeSales } from '../../server/test/fixtures/employee-sales.mjs';

const port=Number(process.env.LOCAL_SALES_PORT||3348);
const origin='http://127.0.0.1:'+port;
const database=process.env.LOCAL_SALES_DATABASE_URL;
if(!database)throw Error('Set LOCAL_SALES_DATABASE_URL to an isolated local *_test database');
const target=new URL(database);
if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Local test database only');

const pool=new pg.Pool({connectionString:database});
const cfg=config({APP_ORIGIN:origin,DATABASE_URL:database,BETTER_AUTH_SECRET:'local-only-sales-preview-secret-1234567890',CW_ENABLED:'true'});
const service=createApp(pool,cfg);
await migrate(pool,service.auth);
const fixture=await seedEmployeeSales(pool);
const sessions=new Map([[randomUUID(),fixture.a],[randomUUID(),fixture.b]]);
const visit=['a','b'];
const app=express();
app.use((req,res,next)=>{
 if(req.get('host')!=='127.0.0.1:'+port || (req.method!=='GET'&&req.method!=='HEAD'&&req.get('origin')!==origin))return res.sendStatus(403);
 next();
});
app.get('/local-sales',(req,res)=>res.type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8">
 <meta name="viewport" content="width=device-width,initial-scale=1"><title>Semifly 销售工作台本地验收</title>
 <style>body{font:16px/1.6 system-ui;max-width:660px;margin:8vh auto;padding:0 24px;color:#242735}a{display:block;margin:12px 0;color:#98221b}</style>
 <h1>销售工作台本地验收</h1><p>使用真实查询和本地验收数据库。两位示例销售的数据相互独立。</p>
 <a href="/local-sales/a">以验收销售 A 打开工作台</a><a href="/local-sales/b">以验收销售 B 打开工作台</a></html>`));
app.get('/local-sales/:employee',(req,res)=>{
 const index=visit.indexOf(req.params.employee);
 if(index===-1)return res.sendStatus(404);
 res.cookie('local_employee_sales',[...sessions.keys()][index],{httpOnly:true,sameSite:'strict',path:'/'});
 res.redirect('/#console/business/home');
});
const staff=express.Router();
staff.use(express.json());
const requireStaff=async(req,_res,next)=>{
 const key=(req.get('cookie')||'').split('; ').find(value=>value.startsWith('local_employee_sales='))?.split('=')[1];
 const subject=sessions.get(key);
 if(!subject)throw new HttpError(401,'请从本地验收入口选择员工');
 req.staff=(await pool.query('SELECT * FROM staff_members WHERE subject=$1',[subject])).rows[0];
 req.actor={kind:'staff',id:subject};
 enforceStaffSurface(req);
 next();
};
staff.get('/api/staff/me',requireStaff,(req,res)=>res.json({staff:req.staff}));
employeeSalesRoutes(staff,pool,requireStaff);
workspaceRoutes(staff,pool,requireStaff,cfg);
businessConsoleRoutes(staff,pool,requireStaff,cfg);
const requireCustomer=(_req,_res,next)=>next(new HttpError(401,'本预览仅提供员工身份'));
cwRoutes(staff,pool,requireCustomer,requireStaff,cfg,service.mail);
app.use((req,res,next)=>req.path.startsWith('/api/staff/')?staff(req,res,next):next());
app.use(service.app);
app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.status?error.message:'本地验收接口出错'}));
app.listen(port,'127.0.0.1',()=>console.log(origin+'/local-sales'));
