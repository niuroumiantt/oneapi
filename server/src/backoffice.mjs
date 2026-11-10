import { HttpError,id,text,transaction,audit,vault } from './core.mjs';
import { requireBusiness,requireTechnical } from './workspaces.mjs';
import { employeeRoutes } from './employee-credit.mjs';
import { OFFICIAL_MODELS,findOfficialModel } from './official-models.mjs';
import { CASES,runSupplierProbe,validateLabBaseUrl } from './supplier-lab.mjs';

const CREDIT_CODE=/^[0-9A-Z]{18}$/;
const TICKET_STATES=['open','in_progress','closed'];
const STRESS_LIMITS={concurrency:10,requests:50,budget:5};

export function customerBackofficeRoutes(app,pool,requireCustomer){
 app.post('/api/platform/upgrade',requireCustomer,async(req,res)=>{
  const b=req.body||{};
  const legal=text(b.legal_name,'企业全称',160),code=text(b.credit_code,'统一社会信用代码',18).toUpperCase(),contact=text(b.contact_name,'联系人',80),phone=text(b.contact_phone,'联系电话',40);
  if(!CREDIT_CODE.test(code))throw new HttpError(400,'统一社会信用代码应为 18 位数字或大写字母');
  if(b.confirm_irreversible!==true)throw new HttpError(400,'请确认升级后不能降级');
  const row=await transaction(pool,async db=>{
   await db.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[req.customer.id]);
   if((await db.query("SELECT 1 FROM account_upgrade_requests WHERE user_id=$1 AND status IN ('pending','approved')",[req.customer.id])).rowCount)throw new HttpError(409,'已有升级申请或已完成升级');
   const created=(await db.query('INSERT INTO account_upgrade_requests(user_id,legal_name,credit_code,contact_name,contact_phone) VALUES($1,$2,$3,$4,$5) RETURNING id,status,created_at',[req.customer.id,legal,code,contact,phone])).rows[0];
   await audit(db,req.actor,'account_upgrade.requested',null,created.id);return created;
  });
  res.status(201).json(row);
 });
 app.get('/api/support/tickets',requireCustomer,async(req,res)=>res.json((await pool.query('SELECT id,subject,body,status,staff_note,created_at,updated_at FROM support_tickets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[req.customer.id])).rows));
 app.post('/api/support/tickets',requireCustomer,async(req,res)=>{
  const subject=text(req.body?.subject,'问题标题',120),body=text(req.body?.body,'问题描述',4000);
  const open=(await pool.query("SELECT count(*)::int AS n FROM support_tickets WHERE user_id=$1 AND status<>'closed'",[req.customer.id])).rows[0].n;
  if(open>=20)throw new HttpError(429,'未关闭的工单过多，请等待处理');
  res.status(201).json((await pool.query('INSERT INTO support_tickets(user_id,subject,body) VALUES($1,$2,$3) RETURNING id,subject,body,status,staff_note,created_at,updated_at',[req.customer.id,subject,body])).rows[0]);
 });
}

export function stressBudget(endpoint,prompt,maxTokens,requests){
 if(endpoint.input_yuan_per_m===null||endpoint.output_yuan_per_m===null)return null;
 const perCall=(Buffer.byteLength(prompt)*Number(endpoint.input_yuan_per_m)+maxTokens*Number(endpoint.output_yuan_per_m))*2/1000000;
 return perCall*requests;
}

async function runStress(pool,box,endpoint,caseDef,runId,concurrency,requests){
 let next=0;
 const worker=async()=>{while(next<requests){next++;await runSupplierProbe(endpoint,caseDef,box,runId,pool).catch(()=>{});}};
 try{await Promise.all(Array.from({length:concurrency},worker));}
 finally{
  await pool.query("UPDATE supplier_lab_runs SET status='completed',finished_at=now() WHERE id=$1",[runId]).catch(()=>{});
  await pool.query('UPDATE supplier_lab_stress_runs SET finished_at=now() WHERE run_id=$1',[runId]).catch(()=>{});
 }
}

export function staffBackofficeRoutes(app,pool,cfg,requireStaff){
 const channelList=async()=>{
  const [live,states,usage]=await Promise.all([employeeRoutes(pool,cfg,{includePaused:true}),pool.query('SELECT model_id,paused,reason,updated_at FROM channel_states'),
   pool.query(`SELECT model_id,count(*)::int AS calls,count(*) FILTER(WHERE status='failed')::int AS failed,coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0)::bigint AS tokens,coalesce(sum(charged_yuan),0) AS yuan,percentile_cont(0.95) WITHIN GROUP(ORDER BY latency_ms) AS p95_ms,max(created_at) AS last_call_at FROM employee_calls WHERE created_at>=now()-interval '30 days' GROUP BY 1`)]);
  const routed=new Set(live.map(r=>r.model.id)),state=new Map(states.rows.map(r=>[r.model_id,r])),used=new Map(usage.rows.map(r=>[r.model_id,r]));
  return OFFICIAL_MODELS.map(m=>({id:m.id,name:m.name,upstream:m.upstream,upstream_model:m.upstreamModel,routed:routed.has(m.id),paused:Boolean(state.get(m.id)?.paused),reason:state.get(m.id)?.reason||'',input_yuan:m.rates.input,output_yuan:m.rates.output,...(used.get(m.id)||{calls:0,failed:0,tokens:0,yuan:0,p95_ms:null,last_call_at:null})}));
 };
 app.get('/api/staff/workspace/business',requireStaff,async(req,res)=>{
  requireBusiness(req);
  const [models,customers,upgrades,tickets,cash,credit]=await Promise.all([channelList(),
   pool.query(`SELECT u.id,u.name,u.email,u.disabled,o.orgs,coalesce(a.spent_yuan,0) AS spent_yuan,coalesce(a.granted_yuan,0) AS granted_yuan,coalesce(c.calls,0)::int AS calls_30d,c.last_call_at
    FROM "user" u LEFT JOIN LATERAL (SELECT string_agg(g.name,'、') AS orgs FROM memberships m JOIN organizations g ON g.id=m.organization_id WHERE m.user_id=u.id AND m.status='active') o ON true
    LEFT JOIN employee_credit_accounts a ON a.user_id=u.id LEFT JOIN LATERAL (SELECT count(*) AS calls,max(created_at) AS last_call_at FROM employee_calls WHERE owner_id=u.id AND created_at>=now()-interval '30 days') c ON true
    ORDER BY coalesce(a.spent_yuan,0) DESC,u."createdAt" DESC LIMIT 200`),
   pool.query(`SELECT r.id,r.legal_name,r.credit_code,r.contact_name,r.contact_phone,r.status,r.reject_reason,r.created_at,r.reviewed_at,u.name,u.email FROM account_upgrade_requests r JOIN "user" u ON u.id=r.user_id ORDER BY r.status='pending' DESC,r.created_at DESC LIMIT 100`),
   pool.query(`SELECT t.id,t.subject,t.body,t.status,t.staff_note,t.created_at,t.updated_at,u.name,u.email FROM support_tickets t JOIN "user" u ON u.id=t.user_id ORDER BY t.status='closed',t.created_at DESC LIMIT 100`),
   pool.query("SELECT coalesce(sum(cash_balance_fen),0)::bigint AS balance_fen,coalesce(sum(total_spent_fen),0)::bigint AS spent_fen,(SELECT coalesce(sum(amount_fen),0)::bigint FROM billing_ledger WHERE kind='recharge') AS recharged_fen FROM billing_accounts"),
   pool.query('SELECT coalesce(sum(granted_yuan),0) AS granted_yuan,coalesce(sum(spent_yuan),0) AS spent_yuan,count(*)::int AS accounts FROM employee_credit_accounts')]);
  res.json({models,customers:customers.rows,upgrades:upgrades.rows,tickets:tickets.rows,cash:cash.rows[0],credit:credit.rows[0]});
 });
 app.post('/api/staff/upgrades/:request/:decision',requireStaff,async(req,res)=>{
  requireBusiness(req);const decision=req.params.decision,requestId=id(req.params.request);
  if(!['approve','reject'].includes(decision))throw new HttpError(404,'操作不存在');
  const reason=decision==='reject'?text(req.body?.reason,'驳回原因',500):null;
  const result=await transaction(pool,async db=>{
   const row=(await db.query('SELECT * FROM account_upgrade_requests WHERE id=$1 FOR UPDATE',[requestId])).rows[0];
   if(!row)throw new HttpError(404,'申请不存在');if(row.status!=='pending')throw new HttpError(409,'申请已处理');
   if(decision==='reject'){
    await db.query("UPDATE account_upgrade_requests SET status='rejected',reject_reason=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1",[row.id,reason,req.staff.subject]);
    await audit(db,req.actor,'account_upgrade.rejected',null,row.id,{reason});return {status:'rejected'};
   }
   const org=(await db.query('INSERT INTO organizations(name,created_by) VALUES($1,$2) RETURNING id',[row.legal_name,row.user_id])).rows[0];
   await db.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[org.id,row.user_id]);
   // The cash account keeps its id, so the append-only ledger stays untouched.
   await db.query('UPDATE billing_accounts SET owner_id=NULL,organization_id=$2 WHERE owner_id=$1',[row.user_id,org.id]);
   await db.query("UPDATE account_upgrade_requests SET status='approved',organization_id=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1",[row.id,org.id,req.staff.subject]);
   await audit(db,req.actor,'account_upgrade.approved',org.id,row.id);return {status:'approved',organization_id:org.id};
  });
  res.json(result);
 });
 app.post('/api/staff/tickets/:ticket',requireStaff,async(req,res)=>{
  requireBusiness(req);const status=req.body?.status,note=typeof req.body?.staff_note==='string'?req.body.staff_note.trim().slice(0,2000):'';
  if(!TICKET_STATES.includes(status))throw new HttpError(400,'工单状态不正确');
  const row=(await pool.query('UPDATE support_tickets SET status=$2,staff_note=$3,handled_by=$4,updated_at=now() WHERE id=$1 RETURNING id,status',[id(req.params.ticket),status,note,req.staff.subject])).rows[0];
  if(!row)throw new HttpError(404,'工单不存在');res.json(row);
 });
 app.get('/api/staff/lab/channels',requireStaff,async(req,res)=>{requireTechnical(req);res.json(await channelList());});
 app.post('/api/staff/lab/channels/:model',requireStaff,async(req,res)=>{
  requireTechnical(req);const model=findOfficialModel(req.params.model);if(!model)throw new HttpError(404,'模型不存在');
  if(typeof req.body?.paused!=='boolean')throw new HttpError(400,'状态不正确');
  const reason=req.body.paused?text(req.body.reason,'暂停原因',300):'';
  await transaction(pool,async db=>{
   await db.query('INSERT INTO channel_states(model_id,paused,reason,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(model_id) DO UPDATE SET paused=EXCLUDED.paused,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now()',[model.id,req.body.paused,reason,req.staff.subject]);
   await audit(db,req.actor,req.body.paused?'channel.paused':'channel.resumed',null,model.id,{reason});
  });
  res.json({model_id:model.id,paused:req.body.paused});
 });
 app.get('/api/staff/lab/stress',requireStaff,async(req,res)=>{
  requireTechnical(req);
  const [endpoints,runs]=await Promise.all([
   pool.query("SELECT e.id,e.label,e.model_id,e.input_yuan_per_m,e.output_yuan_per_m FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id WHERE e.kind='supplier' AND e.disabled_at IS NULL AND c.disabled_at IS NULL ORDER BY e.created_at DESC LIMIT 100"),
   pool.query(`SELECT s.run_id,s.concurrency,s.requests,s.budget_yuan,s.created_at,s.finished_at,e.model_id,count(t.id)::int AS done,count(t.id) FILTER(WHERE t.error_code IS NULL)::int AS ok,count(t.id) FILTER(WHERE t.http_status=429)::int AS rate_limited,percentile_cont(0.5) WITHIN GROUP(ORDER BY t.latency_ms) AS p50_ms,percentile_cont(0.95) WITHIN GROUP(ORDER BY t.latency_ms) AS p95_ms,coalesce(sum(t.estimated_cost_yuan),0) AS cost_yuan
    FROM supplier_lab_stress_runs s JOIN supplier_lab_endpoints e ON e.id=s.endpoint_id LEFT JOIN supplier_lab_transactions t ON t.run_id=s.run_id GROUP BY s.run_id,e.model_id ORDER BY s.created_at DESC LIMIT 30`)]);
  res.json({limits:STRESS_LIMITS,endpoints:endpoints.rows,runs:runs.rows});
 });
 app.post('/api/staff/lab/stress',requireStaff,async(req,res)=>{
  requireTechnical(req);
  if(!process.env.SUPPLIER_LAB_SECRET)throw new HttpError(503,'验收加密服务未配置');
  const endpointId=id(req.body?.endpoint_id),concurrency=Number(req.body?.concurrency),requests=Number(req.body?.requests),budget=Number(req.body?.budget_yuan);
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>STRESS_LIMITS.concurrency)throw new HttpError(400,`并发需在 1 至 ${STRESS_LIMITS.concurrency} 之间`);
  if(!Number.isInteger(requests)||requests<concurrency||requests>STRESS_LIMITS.requests)throw new HttpError(400,`请求数需不少于并发且不超过 ${STRESS_LIMITS.requests}`);
  if(!Number.isFinite(budget)||budget<=0||budget>STRESS_LIMITS.budget)throw new HttpError(400,`预算需大于 0 且不超过 ${STRESS_LIMITS.budget} 元`);
  const endpoint=(await pool.query("SELECT e.*,c.credential_ciphertext AS active_ciphertext FROM supplier_lab_endpoints e JOIN supplier_lab_credentials c ON c.id=e.credential_id WHERE e.id=$1 AND e.kind='supplier' AND e.disabled_at IS NULL AND c.disabled_at IS NULL",[endpointId])).rows[0];
  if(!endpoint)throw new HttpError(404,'型号不存在或已停用');
  validateLabBaseUrl(endpoint.base_url);
  const caseDef=CASES[0],need=stressBudget(endpoint,caseDef.prompt,caseDef.maxTokens,requests);
  if(need===null)throw new HttpError(400,'请先登记这个型号的费率');
  if(need>budget)throw new HttpError(400,`最高费用约 ¥${need.toFixed(4)}，超过预算`);
  const runId=await transaction(pool,async db=>{
   await db.query('SELECT pg_advisory_xact_lock(148921,11)');
   if((await db.query("SELECT 1 FROM supplier_lab_stress_runs WHERE finished_at IS NULL AND created_at>now()-interval '10 minutes'")).rowCount)throw new HttpError(409,'已有压测正在运行');
   const run=(await db.query('INSERT INTO supplier_lab_runs(supplier_endpoint_id,case_ids,created_by) VALUES($1,$2,$3) RETURNING id',[endpointId,[caseDef.id],req.staff.subject])).rows[0].id;
   await db.query('INSERT INTO supplier_lab_stress_runs(run_id,endpoint_id,concurrency,requests,budget_yuan,created_by) VALUES($1,$2,$3,$4,$5,$6)',[run,endpointId,concurrency,requests,budget,req.staff.subject]);
   await audit(db,req.actor,'supplier_lab.stress_started',null,run,{concurrency,requests,budget});return run;
  });
  void runStress(pool,vault(process.env.SUPPLIER_LAB_SECRET),endpoint,caseDef,runId,concurrency,requests);
  res.status(202).json({run_id:runId,max_cost_yuan:need});
 });
}
