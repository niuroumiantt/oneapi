import { HttpError,id,text,transaction,audit } from './core.mjs';
import { requireBusiness,requireTechnical } from './workspaces.mjs';
import { employeeRoutes } from './employee-credit.mjs';
import { OFFICIAL_MODELS,findOfficialModel } from './official-models.mjs';

const CREDIT_CODE=/^[0-9A-Z]{18}$/;
const TICKET_STATES=['open','in_progress','closed'];

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

export function staffBackofficeRoutes(app,pool,cfg,requireStaff){
 app.post('/api/staff/lab/credentials/:credential/priority',requireStaff,async(req,res)=>{
  requireTechnical(req);const order={primary:1,standby:2,auto:100}[req.body?.role];if(!order)throw new HttpError(400,'请选择主用、备用或自动');
  const row=await transaction(pool,async db=>{
   const target=(await db.query('UPDATE supplier_lab_credentials SET priority=$2,priority_changed_at=now() WHERE id=$1 AND disabled_at IS NULL RETURNING id,supplier_id,label,priority',[id(req.params.credential),order])).rows[0];
   if(!target)throw new HttpError(404,'有效 Key 不存在');
   // One primary per supplier: the previous primary becomes the standby.
   if(order===1)await db.query('UPDATE supplier_lab_credentials SET priority=2,priority_changed_at=now() WHERE supplier_id=$1 AND id<>$2 AND priority=1',[target.supplier_id,target.id]);
   await audit(db,req.actor,'lab.credential_priority',null,target.id,{role:req.body.role,label:target.label});return target;
  });
  res.json(row);
 });
 app.get('/api/staff/lab/overview',requireStaff,async(req,res)=>{
  requireTechnical(req);
  const month="date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'",amount="CASE WHEN evidence->>'amount' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (evidence->>'amount')::numeric ELSE 0 END";
  const [routes,creds,byKey,hourly,byModel,usage,paused,unpriced,revenue,byKeyModel]=await Promise.all([
   employeeRoutes(pool,cfg,{includePaused:true}),
   pool.query(`SELECT c.id,c.label,c.base_url,c.credential_fingerprint,c.priority,c.priority_changed_at,c.created_at,c.disabled_at,c.replaces_credential_id,c.rotation_completed_at,s.canonical_supplier_id AS supplier_id,coalesce(p.display_name,s.name) AS supplier_name,count(DISTINCT e.id) FILTER(WHERE e.disabled_at IS NULL)::int AS model_count,coalesce(array_agg(DISTINCT e.model_id) FILTER(WHERE e.disabled_at IS NULL),'{}') AS models FROM supplier_lab_credentials c JOIN supplier_lab_suppliers s ON s.id=c.supplier_id LEFT JOIN suppliers p ON p.id=s.canonical_supplier_id LEFT JOIN supplier_lab_endpoints e ON e.credential_id=c.id WHERE s.kind='supplier' GROUP BY c.id,s.id,p.id ORDER BY c.priority,c.created_at DESC`),
   pool.query(`SELECT credential_id,count(*)::int AS calls_24h,count(*) FILTER(WHERE status='failed')::int AS failed_24h,max(created_at) FILTER(WHERE status<>'failed') AS last_ok_at,max(created_at) FILTER(WHERE status='failed') AS last_fail_at,(array_agg(error_code||coalesce('：'||error_detail,'') ORDER BY created_at DESC) FILTER(WHERE status='failed'))[1] AS last_error FROM employee_calls WHERE created_at>now()-interval '24 hours' GROUP BY 1`),
   pool.query(`SELECT to_char(date_trunc('hour',created_at AT TIME ZONE 'Asia/Shanghai'),'YYYY-MM-DD HH24:00') AS hour,count(*)::int AS calls,count(*) FILTER(WHERE status='failed')::int AS failed FROM employee_calls WHERE created_at>now()-interval '24 hours' GROUP BY 1 ORDER BY 1`),
   pool.query(`SELECT model_id,count(*)::int AS calls,count(*) FILTER(WHERE status='failed')::int AS failed,round(avg(latency_ms) FILTER(WHERE status<>'failed'))::int AS avg_latency,round(percentile_cont(0.95) WITHIN GROUP(ORDER BY latency_ms) FILTER(WHERE status<>'failed'))::int AS p95_latency,max(created_at) AS last_at,max(created_at) FILTER(WHERE status<>'failed') AS last_ok_at,max(created_at) FILTER(WHERE status='failed') AS last_fail_at,(array_agg(error_code||coalesce('：'||error_detail,'') ORDER BY created_at DESC) FILTER(WHERE status='failed'))[1] AS last_error FROM employee_calls WHERE created_at>now()-interval '24 hours' GROUP BY 1`),
   pool.query(`SELECT credential_id,count(*)::int AS calls,coalesce(sum(${amount}),0) AS yuan FROM supplier_usage_records WHERE occurred_at>=${month} GROUP BY 1`),
   pool.query('SELECT model_id,reason,updated_at FROM channel_states WHERE paused'),
   pool.query("SELECT count(*)::int AS n FROM supplier_lab_transactions WHERE estimated_cost_yuan IS NULL AND created_at>now()-interval '30 days'"),
   pool.query(`SELECT coalesce(sum(charged_yuan),0) AS yuan,count(*)::int AS calls FROM employee_calls WHERE settled_at>=${month}`),
   // Per key × model, so the supplier page can show which key actually served each model.
   pool.query(`SELECT credential_id,model_id,count(*)::int AS calls,count(*) FILTER(WHERE status='failed')::int AS failed,round(avg(latency_ms) FILTER(WHERE status<>'failed'))::int AS avg_latency,max(created_at) AS last_at FROM employee_calls WHERE created_at>now()-interval '24 hours' AND credential_id IS NOT NULL GROUP BY 1,2`)
  ]);
  const keyStats=new Map(byKey.rows.map(r=>[r.credential_id,r])),keyUsage=new Map(usage.rows.map(r=>[r.credential_id,r])),pausedIds=new Set(paused.rows.map(r=>r.model_id));
  const credentials=creds.rows.map(c=>({...c,...(keyStats.get(c.id)||{calls_24h:0,failed_24h:0}),month_calls:keyUsage.get(c.id)?.calls||0,month_cost:keyUsage.get(c.id)?.yuan||'0'}));
  const routeOf=new Map(routes.map(r=>[r.model.id,r])),label=id=>credentials.find(c=>c.id===id)?.label||'—';
  const models=OFFICIAL_MODELS.map(m=>{const r=routeOf.get(m.id),s=byModel.rows.find(x=>x.model_id===m.id)||{};return {id:m.id,name:m.name,upstream:m.upstream,upstream_model:m.upstreamModel,paused:pausedIds.has(m.id),pause_reason:paused.rows.find(x=>x.model_id===m.id)?.reason||'',routed:Boolean(r),primary:r?label(r.credentialId):null,fallbacks:(r?.fallbacks||[]).map(f=>label(f.credentialId)),calls_24h:s.calls||0,failed_24h:s.failed||0,avg_latency:s.avg_latency??null,p95_latency:s.p95_latency??null,last_at:s.last_at||null,last_ok_at:s.last_ok_at||null,last_fail_at:s.last_fail_at||null,last_error:s.last_error||null,
   supplier_id:r?.credentialId?credentials.find(c=>c.id===r.credentialId)?.supplier_id||null:null,
   route_keys:r?.credentialId?[r,...(r.fallbacks||[])].map((k,i)=>{const u=byKeyModel.rows.find(x=>x.credential_id===k.credentialId&&x.model_id===m.id)||{};return {credential_id:k.credentialId,label:label(k.credentialId),role:i?'fallback':'primary',calls_24h:u.calls||0,failed_24h:u.failed||0,avg_latency:u.avg_latency??null,last_at:u.last_at||null};}):[]};});
  const suppliers=[...new Map(credentials.map(c=>[c.supplier_id,{id:c.supplier_id,name:c.supplier_name}])).values()].map(s=>{const keys=credentials.filter(c=>c.supplier_id===s.id),live=keys.filter(k=>!k.disabled_at);return {...s,keys:keys.length,live_keys:live.length,standby:live.filter(k=>k.model_count>0).length>1,calls_24h:live.reduce((n,k)=>n+k.calls_24h,0),failed_24h:live.reduce((n,k)=>n+k.failed_24h,0),month_cost:live.reduce((n,k)=>n+Number(k.month_cost),0).toFixed(4),month_calls:live.reduce((n,k)=>n+k.month_calls,0)};});
  const risks=[],when=v=>v?new Date(v).toISOString():null;
  for(const c of credentials.filter(c=>!c.disabled_at&&c.failed_24h)){const down=!c.last_ok_at||new Date(c.last_fail_at)>new Date(c.last_ok_at);risks.push({level:down?'critical':'warning',area:'key',title:`${c.supplier_name} · ${c.label} ${down?'当前不可用':'24 小时内出现失败'}`,detail:`24 小时失败 ${c.failed_24h} 次，最近错误 ${c.last_error||'—'}${down?'，之后没有成功调用':'，之后已恢复'}`,at:when(c.last_fail_at),section:'credentials'});}
  for(const s of suppliers.filter(s=>s.live_keys&&!s.standby))risks.push({level:'warning',area:'key',title:`${s.name} 没有备用 Key`,detail:'主 Key 失效时员工调用会中断。建议再登记一把 Key 并设为备用。',section:'credentials'});
  for(const m of models.filter(m=>!m.routed&&!m.paused))risks.push({level:'warning',area:'model',title:`${m.name} 未接通上游`,detail:'员工调用会返回“模型暂时不可用”。可登记上游型号，或在路由中暂停。',section:'routing'});
  for(const m of models.filter(m=>m.calls_24h>=10&&m.failed_24h/m.calls_24h>0.05))risks.push({level:'warning',area:'model',title:`${m.name} 24 小时失败率 ${(m.failed_24h/m.calls_24h*100).toFixed(1)}%`,detail:`${m.failed_24h} / ${m.calls_24h} 次失败`,section:'monitor'});
  if(unpriced.rows[0].n)risks.push({level:'info',area:'billing',title:`${unpriced.rows[0].n} 笔测试缺少费率`,detail:'无法核算这些测试的成本。',section:'models'});
  for(const m of models.filter(m=>m.paused))risks.push({level:'info',area:'model',title:`${m.name} 已暂停`,detail:m.pause_reason,section:'routing'});
  const totalCalls=models.reduce((n,m)=>n+m.calls_24h,0),totalFailed=models.reduce((n,m)=>n+m.failed_24h,0);
  res.json({generated_at:new Date().toISOString(),suppliers,credentials,models,hourly:hourly.rows,totals:{models:models.length,routed:models.filter(m=>m.routed&&!m.paused).length,calls_24h:totalCalls,failed_24h:totalFailed,success_rate:totalCalls?(totalCalls-totalFailed)/totalCalls:null,month_revenue:revenue.rows[0].yuan,month_calls:revenue.rows[0].calls,month_cost:suppliers.reduce((n,s)=>n+Number(s.month_cost),0).toFixed(4)},risks});
 });
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
}
