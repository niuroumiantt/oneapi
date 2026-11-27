import { modelPackName } from './model-packs.mjs';
import { createHash } from 'node:crypto';
import { transaction, HttpError, id } from './core.mjs';
import { renderVipStatementPDF } from './vip-statement-pdf.mjs';
const integer=(v,min,max,label)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw new HttpError(400,label+'格式不正确');return v;};
const sumFields=['paid_fen','used_fen','refunded_fen','commission_fen'];
const beijingTime=value=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));return `${p.month}-${p.day} ${p.hour}:${p.minute}`;};
const zero=()=>Object.fromEntries(sumFields.map(k=>[k,'0']));
export function statementSnapshot(partner,month,revision,rows,now=new Date()){
 const totals=zero(),codes=new Map();
 const entries=rows.map(e=>{
  if(!codes.has(e.code))codes.set(e.code,{code:e.code,...zero()});
  const c=codes.get(e.code);
  if(e.model_id)c.model=modelPackName(e.model_id);
  const key={paid:'paid_fen',used:'used_fen',refund:'refunded_fen'}[e.kind];
  if(!key)throw Error('Unknown commission event');
  for(const target of [totals,c]){target[key]=(BigInt(target[key])+BigInt(e.cash_fen)).toString();if(e.kind==='used')target.commission_fen=(BigInt(target.commission_fen)+BigInt(e.commission_fen)).toString();}
  // Explicit allowlist: raw order/customer IDs and customer details never enter the archive.
  return {time:beijingTime(e.occurred_at),code:e.code,reference:createHash('sha256').update(month+':'+e.public_reference).digest('hex').slice(0,10).toUpperCase(),kind:e.kind,...(e.model_id?{model:modelPackName(e.model_id),face_fen:String(e.face_fen)}:{}),cash_fen:String(e.cash_fen),commission_fen:e.kind==='used'?String(e.commission_fen):'0'};
 });
 return {version:1,number:partner.public_code+'-'+month,month,revision,vip_code:partner.public_code,generated_at:now.toISOString(),totals,codes:[...codes.values()].sort((a,b)=>a.code.localeCompare(b.code)),entries};
}
// Runs from the backend timer, not from a VIP login. Missed months and late usage are retried.
export async function generateNextVipStatement(pool,{now=new Date(),renderPDF=renderVipStatementPDF}={}){
 return transaction(pool,async db=>{
  if(!(await db.query('SELECT pg_try_advisory_xact_lock(148921,90) AS locked')).rows[0].locked)return false;
  const candidate=(await db.query(`WITH bounds AS (
   SELECT date_trunc('month',$1::timestamptz AT TIME ZONE 'Asia/Shanghai') current_month
  ), months AS (
   SELECT p.id partner_id,to_char(m,'YYYY-MM') AS month FROM cw_partners p CROSS JOIN bounds b
   CROSS JOIN LATERAL generate_series(date_trunc('month',coalesce(p.activated_at,p.created_at) AT TIME ZONE 'Asia/Shanghai'),b.current_month-interval '1 month',interval '1 month') m
   WHERE p.status='active'
   UNION
   SELECT c.partner_id,to_char(e.occurred_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM') FROM cw_commissions c
   JOIN cw_commission_events e ON e.order_id=c.order_id CROSS JOIN bounds b
   WHERE e.occurred_at < b.current_month AT TIME ZONE 'Asia/Shanghai'
  ) SELECT m.*,p.public_code,s.id statement_id,s.latest_revision FROM months m JOIN cw_partners p ON p.id=m.partner_id
  LEFT JOIN cw_vip_statements s ON s.partner_id=m.partner_id AND s.month=m.month
  WHERE s.id IS NULL OR EXISTS (
   SELECT 1 FROM cw_commissions c JOIN cw_commission_events e ON e.order_id=c.order_id
   WHERE c.partner_id=m.partner_id AND to_char(e.occurred_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM')=m.month
   AND NOT EXISTS(SELECT 1 FROM cw_vip_statement_events se WHERE se.statement_id=s.id AND se.event_id=e.id)
  ) ORDER BY m.month,m.partner_id LIMIT 1`,[now])).rows[0];
  if(!candidate)return false;
  const rows=(await db.query(`SELECT e.id,e.kind,e.occurred_at,e.cash_fen::text,e.commission_fen::text,k.code,c.public_reference,e.model_id,e.face_fen::text
   FROM cw_commissions c JOIN cw_commission_events e ON e.order_id=c.order_id JOIN cw_codes k ON k.id=c.code_id
   WHERE c.partner_id=$1 AND e.occurred_at >= ($2||'-01')::timestamp AT TIME ZONE 'Asia/Shanghai'
   AND e.occurred_at < (($2||'-01')::timestamp+interval '1 month') AT TIME ZONE 'Asia/Shanghai'
   ORDER BY e.occurred_at,e.id`,[candidate.partner_id,candidate.month])).rows;
  const revision=(candidate.latest_revision||0)+1,snapshot=statementSnapshot(candidate,candidate.month,revision,rows,now);
  const pdf=await renderPDF(snapshot),sha=createHash('sha256').update(pdf).digest('hex');
  const statement=(await db.query(`INSERT INTO cw_vip_statements(partner_id,month,latest_revision,created_at,updated_at)
   VALUES($1,$2,$3,$4,$4) ON CONFLICT(partner_id,month) DO UPDATE SET latest_revision=$3,updated_at=$4 RETURNING id`,[candidate.partner_id,candidate.month,revision,now])).rows[0];
  await db.query('INSERT INTO cw_vip_statement_versions(statement_id,revision,snapshot,pdf,sha256,generated_at) VALUES($1,$2,$3,$4,$5,$6)',[statement.id,revision,snapshot,pdf,sha,now]);
  if(rows.length)await db.query('INSERT INTO cw_vip_statement_events(statement_id,event_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING',[statement.id,rows.map(e=>e.id)]);
  return {id:statement.id,month:candidate.month,revision};
 });
}
export async function vipMonthlySummary(db,partnerId){
 const [current,latest,unread]=await Promise.all([
  db.query(`SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai','YYYY-MM') AS month,
   coalesce(sum(e.cash_fen) FILTER(WHERE e.kind='paid'),0)::text paid_fen,
   coalesce(sum(e.cash_fen) FILTER(WHERE e.kind='used'),0)::text used_fen
   FROM cw_commissions c JOIN cw_commission_events e ON e.order_id=c.order_id
   WHERE c.partner_id=$1 AND e.occurred_at >= date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
   AND e.occurred_at < (date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai')+interval '1 month') AT TIME ZONE 'Asia/Shanghai'`,[partnerId]),
  db.query(`SELECT s.id,s.month,s.latest_revision revision,v.snapshot->'totals' totals FROM cw_vip_statements s
   JOIN cw_vip_statement_versions v ON v.statement_id=s.id AND v.revision=s.latest_revision
   WHERE s.partner_id=$1 ORDER BY s.month DESC LIMIT 1`,[partnerId]),
  db.query('SELECT count(*)::int n FROM cw_vip_statements WHERE partner_id=$1 AND read_revision<latest_revision',[partnerId])
 ]);
 return {...current.rows[0],latest_statement:latest.rows[0]||null,unread:unread.rows[0].n};
}
export function vipStatementRoutes(app,pool,requireCustomer,enabled){
 app.get('/api/cw/statements',requireCustomer,enabled,async(req,res)=>{
  const offset=integer(Number(req.query.offset||0),0,100000,'页码');
  const result=await pool.query(`SELECT s.id,s.month,s.latest_revision revision,s.read_revision,s.updated_at,
   v.snapshot->'totals' totals,(SELECT jsonb_agg(jsonb_build_object('revision',v2.revision,'generated_at',v2.generated_at) ORDER BY v2.revision DESC) FROM cw_vip_statement_versions v2 WHERE v2.statement_id=s.id) versions
   FROM cw_vip_statements s JOIN cw_partners p ON p.id=s.partner_id
   JOIN cw_vip_statement_versions v ON v.statement_id=s.id AND v.revision=s.latest_revision
   WHERE p.user_id=$1 ORDER BY s.month DESC LIMIT 13 OFFSET $2`,[req.customer.id,offset]);
  res.set('Cache-Control','no-store').json({items:result.rows.slice(0,12),has_more:result.rows.length>12});
 });
 app.get('/api/cw/statements/:statement/pdf',requireCustomer,enabled,async(req,res)=>{
  const revision=req.query.revision?integer(Number(req.query.revision),1,100000,'版本'):null;
  const row=(await pool.query(`SELECT s.month,v.revision,v.pdf,v.sha256 FROM cw_vip_statements s
   JOIN cw_partners p ON p.id=s.partner_id JOIN cw_vip_statement_versions v ON v.statement_id=s.id AND v.revision=coalesce($3,s.latest_revision)
   WHERE s.id=$1 AND p.user_id=$2`,[id(req.params.statement),req.customer.id,revision])).rows[0];
  if(!row)throw new HttpError(404,'账单不存在');
  res.set({'Content-Type':'application/pdf','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="semifly-vip-${row.month}-v${row.revision}.pdf"`}).send(row.pdf);
 });
 app.post('/api/cw/statements/:statement/read',requireCustomer,enabled,async(req,res)=>{
  const revision=integer(Number(req.body?.revision),1,100000,'版本');
  const row=await pool.query(`UPDATE cw_vip_statements s SET read_revision=greatest(read_revision,$3) FROM cw_partners p
   WHERE s.partner_id=p.id AND s.id=$1 AND p.user_id=$2 AND s.latest_revision>=$3 RETURNING s.id`,[id(req.params.statement),req.customer.id,revision]);
  if(!row.rowCount)throw new HttpError(404,'账单不存在');res.json({ok:true});
 });
}
