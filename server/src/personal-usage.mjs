import {HttpError} from './core.mjs';
import {findOfficialModel} from './official-models.mjs';

// Table choice is an internal option, never request input. Both identities share
// periods, aggregation, pagination and the response contract used by identity.js.
const usageSource=allocated=>allocated
 ? 'FROM employee_calls c JOIN employee_api_keys k ON k.id=c.key_id AND k.owner_id=c.owner_id'
 : 'FROM billing_accounts a JOIN customer_calls c ON c.account_id=a.id JOIN customer_api_keys k ON k.id=c.key_id AND k.account_id=a.id';

// Aggregate all calls in the chosen interval; never derive totals from the recent-call feed.
export async function readPersonalUsage(pool,owner,period='month',{allocated=false}={}){
 if(!['month','week','all'].includes(period))throw new HttpError(400,'请选择有效时间范围');
 const result=await pool.query(`
  WITH bounds AS (
   SELECT CASE $2::text
    WHEN 'month' THEN date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
    WHEN 'week' THEN now()-interval '7 days'
    ELSE '-infinity'::timestamptz END AS start_at
  )
  SELECT c.key_id,c.model_id,k.label,k.key_hint,k.revoked_at,
   count(*)::text AS calls,
   coalesce(sum(c.input_tokens),0)::text AS input_tokens,
   coalesce(sum(c.output_tokens),0)::text AS output_tokens,
   ${allocated?"coalesce(sum(CASE WHEN c.status='settled' THEN c.charged_yuan ELSE 0 END)*1000000000000,0)::numeric(30,0)":'coalesce(sum(cash.cash_fen),0)'}::text AS cash_fen,
   count(*) FILTER(WHERE c.status IN ('pending','awaiting_bill'))::text AS unsettled_calls
  ${usageSource(allocated)}
  CROSS JOIN bounds
  ${allocated?'':`LEFT JOIN LATERAL (
   SELECT sum(cc.cash_fen) AS cash_fen FROM credit_consumptions cc
   WHERE cc.call_id=c.id AND c.status='settled'
  ) cash ON true`}
  WHERE ${allocated?'c.owner_id':'a.owner_id'}=$1 AND k.purpose='api' AND c.created_at>=bounds.start_at
  GROUP BY c.key_id,c.model_id,k.label,k.key_hint,k.revoked_at
 `,[owner,period]);
 const fields=['calls','input_tokens','output_tokens','cash_fen','unsettled_calls'];
 const zero=()=>Object.fromEntries(fields.map(k=>[k,'0']));
 const add=(target,row)=>{for(const k of fields)target[k]=String(BigInt(target[k])+BigInt(row[k]||0));};
 const models=new Map(),keys=new Map(),totals=zero();
 for(const row of result.rows){
  if(!models.has(row.model_id))models.set(row.model_id,{id:row.model_id,name:findOfficialModel(row.model_id)?.name||row.model_id,...zero()});
  if(!keys.has(row.key_id))keys.set(row.key_id,{id:row.key_id,name:row.label,key_hint:row.key_hint,revoked_at:row.revoked_at,...zero()});
  add(models.get(row.model_id),row);add(keys.get(row.key_id),row);add(totals,row);
 }
 if(allocated)for(const row of [totals,...models.values(),...keys.values()])row.cash_fen=String(BigInt(row.cash_fen)/10000000000n);
 const order=(a,b)=>BigInt(a.cash_fen)===BigInt(b.cash_fen)?a.name.localeCompare(b.name):BigInt(a.cash_fen)>BigInt(b.cash_fen)?-1:1;
 return {period,totals,models:[...models.values()].sort(order),keys:[...keys.values()].sort(order)};
}
export function personalUsageRoutes(app,pool,requireCustomer){
 app.get('/api/customer-credit/usage/chart',requireCustomer,async(req,res)=>{
  res.set('Cache-Control','no-store');res.json(await readPersonalUsageChart(pool,req.customer.id));
 });
 app.get('/api/customer-credit/usage/calls',requireCustomer,async(req,res)=>res.json(await readPersonalCalls(pool,req.customer.id,req.query)));
 app.get('/api/customer-credit/usage',requireCustomer,async(req,res)=>{
  res.json(await readPersonalUsage(pool,req.customer.id,req.query.period||'month'));
 });
}

export async function readPersonalCalls(pool,owner,{period='month',page='0',size='3'}={},{allocated=false}={}){
 if(!['month','week','all'].includes(period)||!/^\d{1,6}$/.test(String(page))||!['2','3'].includes(String(size)))throw new HttpError(400,'调用明细的时间范围或分页无效');
 const offset=Number(page)*Number(size),limit=Number(size);
 const result=await pool.query(`WITH bounds AS (
  SELECT CASE $2::text WHEN 'month' THEN date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
   WHEN 'week' THEN now()-interval '7 days' ELSE '-infinity'::timestamptz END AS start_at
 ) SELECT c.id,c.created_at,c.model_id,k.label AS key_label,k.key_hint,c.status,
  c.input_tokens::text,c.output_tokens::text,c.cached_input_tokens::text,c.charged_yuan::text,
  CASE WHEN c.status='settled' THEN ${allocated?'floor(coalesce(c.charged_yuan,0)*100)':'coalesce(cash.fen,0)'}::text ELSE NULL END AS cash_fen
 ${usageSource(allocated)} CROSS JOIN bounds
 ${allocated?'':`LEFT JOIN LATERAL (SELECT sum(cc.cash_fen) AS fen FROM credit_consumptions cc WHERE cc.call_id=c.id) cash ON true`}
 WHERE ${allocated?'c.owner_id':'a.owner_id'}=$1 AND k.purpose='api' AND c.created_at>=bounds.start_at
 ORDER BY c.created_at DESC,c.id DESC LIMIT $3 OFFSET $4`,[owner,period,limit+1,offset]);
 return {period,page:Number(page),has_more:result.rows.length>limit,items:result.rows.slice(0,limit).map(row=>({...row,model_name:findOfficialModel(row.model_id)?.name||row.model_id}))};
}

// One bounded query over the owner's complete call history, grouped by Shanghai day.
// The optional clock is for deterministic boundary tests; routes never accept it from clients.
export async function readPersonalUsageChart(pool,owner,clock=new Date(),{allocated=false}={}){
 const result=await pool.query(`
  WITH today AS (SELECT ($2::timestamptz AT TIME ZONE 'Asia/Shanghai')::date AS day),
  bounds AS (SELECT (day-interval '3 months'+interval '1 day')::date AS start_day,day AS end_day FROM today),
  daily AS (
   SELECT (c.created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,c.model_id,
    coalesce(sum(c.input_tokens),0)::text AS input_tokens,
    coalesce(sum(c.output_tokens),0)::text AS output_tokens,
    count(*) FILTER(WHERE c.status<>'failed' AND (c.input_tokens IS NULL OR c.output_tokens IS NULL))::text AS unreported_calls
   ${usageSource(allocated)}
   CROSS JOIN bounds b
   WHERE ${allocated?'c.owner_id':'a.owner_id'}=$1 AND k.purpose='api'
    AND c.created_at >= (b.start_day::timestamp AT TIME ZONE 'Asia/Shanghai')
    AND c.created_at < ((b.end_day+1)::timestamp AT TIME ZONE 'Asia/Shanghai')
   GROUP BY 1,c.model_id
  ), calendar AS (
   SELECT generate_series(start_day::timestamp,end_day::timestamp,interval '1 day')::date AS day FROM bounds
  )
  SELECT calendar.day::text AS date,daily.model_id,daily.input_tokens,daily.output_tokens,daily.unreported_calls
  FROM calendar LEFT JOIN daily USING(day) ORDER BY calendar.day,daily.model_id
 `,[owner,clock.toISOString()]);
 const models=[...new Set(result.rows.map(r=>r.model_id).filter(Boolean))].sort().map(id=>({id,name:findOfficialModel(id)?.name||id}));
 const modelIndex=new Map(models.map((m,i)=>[m.id,i])),days=new Map();let unreported=0n;
 for(const row of result.rows){
  if(!days.has(row.date))days.set(row.date,{date:row.date,values:models.map(()=>'0'),total:'0'});
  const day=days.get(row.date);
  if(row.model_id){
   const tokens=BigInt(row.input_tokens||0)+BigInt(row.output_tokens||0),index=modelIndex.get(row.model_id);
   day.values[index]=String(BigInt(day.values[index])+tokens);day.total=String(BigInt(day.total)+tokens);
   unreported+=BigInt(row.unreported_calls||0);
  }
 }
 const all=[...days.values()];
 return {time_zone:'Asia/Shanghai',start:all[0]?.date,end:all.at(-1)?.date,models,days:all,unreported_calls:String(unreported)};
}
