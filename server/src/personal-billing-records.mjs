import {HttpError} from './core.mjs';
import {findOfficialModel} from './official-models.mjs';
import {refundQuote} from './pack-ledger.mjs';

// Read the settlement ledger, including gift-only consumption. Cash ledger rows alone
// are insufficient: no cash movement is written when a call only spends gift credit.
export function usageFilters(options={}){
 const size=Number(options.page_size??20);
 if(![2,3,5,8,20,50,100].includes(size))throw new HttpError(400,'不支持此账单分页大小');
 const day=value=>{if(!value)return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new HttpError(400,'请选择有效日期');return value;};
 const from=day(options.from),to=day(options.to);
 if(from&&to&&from>to)throw new HttpError(400,'开始日期不能晚于结束日期');
 return {size,from,to};
}
export const usageCsvCell=value=>'"'+String(value??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';
export function usageCsvRow(row){
 const yuan=value=>{if(value==null)return '';const [a,b='']=String(value).split('.');const n=BigInt(a)*10000000000n+BigInt(b.padEnd(10,'0').slice(0,10));return String(n/1000000000000n)+'.'+String(n%1000000000000n).padStart(12,'0');};
 const time=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(row.created_at));
 return [time,row.model_name,row.model_id,row.key_label,row.key_hint,row.input_tokens,row.output_tokens,yuan(row.quota_fen),yuan(row.cash_fen),yuan(row.gift_fen)].map(usageCsvCell).join(',')+'\r\n';
}
export async function readPersonalBillingRecords(pool,owner,kind='usage',page='0',options={}){
 if(!['usage','recharge','refund'].includes(kind)||!/^\d{1,6}$/.test(String(page)))throw new HttpError(400,'请选择有效的账单分页');
 const filter=usageFilters(options),size=kind==='usage'?filter.size:kind==='refund'?1:3,offset=Number(page)*size;
 const result=kind==='usage'?await pool.query(`
  SELECT c.id,c.created_at,c.model_id,c.input_tokens,c.output_tokens,k.label AS key_label,k.key_hint,
   coalesce(s.face_fen,0)::text AS quota_fen,coalesce(s.cash_fen,0)::text AS cash_fen,
   greatest(0,coalesce(s.face_fen,0)-coalesce(s.cash_fen,0))::text AS gift_fen
  FROM billing_accounts a JOIN customer_calls c ON c.account_id=a.id
  JOIN customer_api_keys k ON k.id=c.key_id AND k.account_id=a.id
  LEFT JOIN LATERAL (SELECT sum(cc.face_fen) AS face_fen,sum(cc.cash_fen) AS cash_fen
   FROM credit_consumptions cc WHERE cc.call_id=c.id) s ON true
  WHERE a.owner_id=$1 AND a.organization_id IS NULL AND c.status='settled'
   AND ($4::date IS NULL OR c.created_at >= ($4::date::timestamp AT TIME ZONE 'Asia/Shanghai'))
   AND ($5::date IS NULL OR c.created_at < (($5::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai'))
  ORDER BY c.created_at DESC,c.id DESC LIMIT $2 OFFSET $3
 `,[owner,size+1,offset,filter.from,filter.to]):await pool.query(`
  SELECT p.*,o.provider AS payment_provider,o.paid_at,
   r.status AS refund_request_status,r.created_at AS refund_request_at,
   f.status AS refund_status,f.amount_fen::text AS refund_amount_fen,
   f.created_at AS refund_submitted_at,f.processing_at AS refund_processing_at,f.completed_at AS refund_completed_at
  FROM billing_accounts a JOIN credit_packs p ON p.account_id=a.id
  LEFT JOIN payment_orders o ON p.source_kind='payment' AND o.id=p.source_id
  LEFT JOIN LATERAL (SELECT status,created_at FROM credit_refund_requests WHERE pack_id=p.id
   AND status IN ('requested','processing') ORDER BY created_at DESC LIMIT 1) r ON true
  LEFT JOIN LATERAL (SELECT status,amount_fen,created_at,processing_at,completed_at FROM payment_refunds
   WHERE id=p.refund_id OR (p.refund_id IS NULL AND order_id=o.id AND pack_id=p.id AND status IN ('failed','succeeded'))
   ORDER BY created_at DESC,id DESC LIMIT 1) f ON true
  WHERE a.owner_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT $2 OFFSET $3
 `,[owner,size+1,offset]);
 const items=result.rows.slice(0,size);
 for(const item of items){
  delete item.model_cost_bps;delete item.model_settlement_bps;
  if(item.model_id)item.model_name=findOfficialModel(item.model_id)?.name||item.model_id;
  if(kind==='refund'){
   const q=await refundQuote(pool,item.id),expired=item.gift_expires_at&&new Date(item.gift_expires_at)<new Date();
   Object.assign(item,{net_fen:q.refundable_fen,red_fen:q.red_fen,refundable_fen:q.refundable_fen,non_refundable_fen:q.non_refundable_fen,retained_fen:q.retained_fen,refund_restrictions:q.restrictions,manual_only:q.manual_only,bonus_fen:expired?'0':q.bonus_fen,fee_fen:'0',refund_blocked:q.blocked});
  }
 }
 return {kind,page:Number(page),page_size:size,from:filter.from,to:filter.to,has_more:result.rows.length>size,items};
}
export function personalBillingRecordRoutes(app,pool,requireCustomer){
 app.get('/api/billing/personal/records/export',requireCustomer,async(req,res)=>{
  const filter=usageFilters(req.query),db=await pool.connect();
  try{
   await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   // A consistent snapshot prevents duplicate or missing rows while new calls settle.
   let page=0,data=await readPersonalBillingRecords(db,req.customer.id,'usage',0,{...req.query,page_size:100});
   res.setHeader('Content-Type','text/csv; charset=utf-8');
   res.setHeader('Content-Disposition',`attachment; filename="semifly-usage-${filter.from||'all'}-${filter.to||'latest'}.csv"`);
   res.setHeader('Cache-Control','no-store');
   res.write('\uFEFF'+['时间（北京时间）','模型','模型 ID','Key 名称','Key 尾号','输入 Token','输出 Token','扣减额度（元）','实付扣减（元）','赠送扣减（元）'].map(usageCsvCell).join(',')+'\r\n');
   while(!res.destroyed){
    for(const row of data.items){if(res.destroyed)break;if(!res.write(usageCsvRow(row)))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});}
    if(!data.has_more||res.destroyed)break;
    data=await readPersonalBillingRecords(db,req.customer.id,'usage',++page,{...req.query,page_size:100});
   }
   await db.query('COMMIT');res.end();
  }catch(error){await db.query('ROLLBACK');if(res.headersSent)res.destroy(error);else throw error;}finally{db.release();}
 });
 app.get('/api/billing/personal/records',requireCustomer,async(req,res)=>{
  res.json(await readPersonalBillingRecords(pool,req.customer.id,req.query.kind||'usage',req.query.page||'0',req.query));
 });
}
