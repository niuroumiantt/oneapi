import {HttpError} from './core.mjs';
import {findOfficialModel} from './official-models.mjs';
import {refundQuote} from './pack-ledger.mjs';

// Read the settlement ledger, including gift-only consumption. Cash ledger rows alone
// are insufficient: no cash movement is written when a call only spends gift credit.
export async function readPersonalBillingRecords(pool,owner,kind='usage',page='0'){
 if(!['usage','recharge','refund'].includes(kind)||!/^\d{1,6}$/.test(String(page)))throw new HttpError(400,'请选择有效的账单分页');
 const size=kind==='refund'?1:3,offset=Number(page)*size;
 const result=kind==='usage'?await pool.query(`
  SELECT c.id,c.created_at,c.model_id,k.label AS key_label,k.key_hint,
   coalesce(s.face_fen,0)::text AS quota_fen,coalesce(s.cash_fen,0)::text AS cash_fen
  FROM billing_accounts a JOIN customer_calls c ON c.account_id=a.id
  JOIN customer_api_keys k ON k.id=c.key_id AND k.account_id=a.id
  LEFT JOIN LATERAL (SELECT sum(cc.face_fen) AS face_fen,sum(cc.cash_fen) AS cash_fen
   FROM credit_consumptions cc WHERE cc.call_id=c.id) s ON true
  WHERE a.owner_id=$1 AND c.status='settled'
  ORDER BY c.created_at DESC,c.id DESC LIMIT $2 OFFSET $3
 `,[owner,size+1,offset]):await pool.query(`
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
  if(kind==='usage')item.model_name=findOfficialModel(item.model_id)?.name||item.model_id;
  if(kind==='refund'){
   const q=await refundQuote(pool,item.id),expired=item.gift_expires_at&&new Date(item.gift_expires_at)<new Date();
   Object.assign(item,{net_fen:q.refundable_fen,red_fen:q.red_fen,refundable_fen:q.refundable_fen,non_refundable_fen:q.non_refundable_fen,retained_fen:q.retained_fen,refund_restrictions:q.restrictions,manual_only:q.manual_only,bonus_fen:expired?'0':q.bonus_fen,fee_fen:'0',refund_blocked:q.blocked});
  }
 }
 return {kind,page:Number(page),has_more:result.rows.length>size,items};
}
export function personalBillingRecordRoutes(app,pool,requireCustomer){
 app.get('/api/billing/personal/records',requireCustomer,async(req,res)=>{
  res.json(await readPersonalBillingRecords(pool,req.customer.id,req.query.kind||'usage',req.query.page||'0'));
 });
}
