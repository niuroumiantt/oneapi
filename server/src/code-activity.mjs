import { createHash } from 'node:crypto';
import { HttpError, id, hasBusiness } from './core.mjs';
const promoSQL="coalesce(nullif(o.discount_snapshot->>'promo_code',''),nullif(o.discount_snapshot->'cw'->>'code',''))";
export function activityQuery(q={}){
 const month=String(q.month||''),type=String(q.type||'paid'),page=Number(q.page||0),size=Number(q.size||5);
 if(month&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new HttpError(400,'月份格式不正确');
 if(!['paid','used','refund'].includes(type)||!Number.isSafeInteger(page)||page<0||page>100000||!Number.isSafeInteger(size)||size<1||size>20)throw new HttpError(400,'分页或明细类型不正确');
 return {month,type,page,size};
}
export async function codeActivity(db,scope,q){
 const {month,type,page,size}=activityQuery(q);
 // Only scoped order IDs enter this CTE. No customer identifiers or API secrets are selected.
 const cte=`WITH orders AS (SELECT o.* FROM payment_orders o WHERE o.status='paid' AND ${scope.where}), events AS (
 SELECT 'paid:'||o.id AS event_id,o.id AS order_id,'paid' AS kind,o.paid_at AS occurred_at,o.amount_fen::numeric AS cash_fen,o.face_fen::numeric AS face_fen,0::bigint AS commission_fen,NULL::text AS model_id FROM orders o
 UNION ALL SELECT 'used:'||c.call_id||':'||p.id,o.id,'used',a.created_at,c.cash_fen,c.face_fen,coalesce(e.commission_fen,0),a.model_id FROM orders o
 JOIN credit_packs p ON p.source_kind='payment' AND p.source_id=o.id JOIN credit_consumptions c ON c.pack_id=p.id JOIN customer_calls a ON a.id=c.call_id
 LEFT JOIN cw_commission_events e ON e.event_key='used:'||c.call_id||':'||p.id
 UNION ALL SELECT 'refund:'||r.id,o.id,'refund',r.completed_at,coalesce(r.gross_fen,r.amount_fen),r.amount_fen,0,NULL FROM orders o JOIN payment_refunds r ON r.order_id=o.id AND r.status='succeeded'
 ), ranged AS(SELECT * FROM events WHERE ($2='' OR (occurred_at >= ($2||'-01')::timestamp AT TIME ZONE 'Asia/Shanghai' AND occurred_at < (($2||'-01')::timestamp+interval '1 month') AT TIME ZONE 'Asia/Shanghai')))`;
 const result=(await db.query(cte+` SELECT jsonb_build_object(
 'paid_fen',coalesce(sum(cash_fen) FILTER(WHERE kind='paid'),0)::text,
 'used_fen',coalesce(sum(cash_fen) FILTER(WHERE kind='used'),0)::text,
 'used_quota_fen',coalesce(sum(face_fen) FILTER(WHERE kind='used'),0)::text,
 'refunded_fen',coalesce(sum(cash_fen) FILTER(WHERE kind='refund'),0)::text,
 'refund_received_fen',coalesce(sum(face_fen) FILTER(WHERE kind='refund'),0)::text,
 'commission_fen',coalesce(sum(commission_fen) FILTER(WHERE kind='used'),0)::text) AS totals,
 (SELECT count(*)::int FROM ranged WHERE kind=$3) AS count,
 (SELECT coalesce(jsonb_agg(x ORDER BY x.occurred_at DESC,x.event_id DESC),'[]') FROM (
 SELECT event_id,order_id,kind,occurred_at,cash_fen::text,face_fen::text,commission_fen::text,model_id FROM ranged WHERE kind=$3 ORDER BY occurred_at DESC,event_id DESC LIMIT $4 OFFSET $5) x) AS items FROM ranged`,[scope.value,month,type,size,page*size])).rows[0];
 if(!scope.commission){result.totals.commission_fen='0';for(const item of result.items)item.commission_fen='0';}
 const anonymous=value=>createHash('sha256').update(scope.key+':'+value).digest('hex').slice(0,12).toUpperCase();
 return {code:scope.code,name:scope.name,commission:scope.commission,month,type,page,size,count:result.count,totals:result.totals,items:result.items.map(({event_id,order_id,...r})=>({...r,reference:anonymous(order_id),event_reference:anonymous(event_id)}))};
}
export function codeActivityRoutes(app,pool,customer,staff){
 app.get('/api/code-activity/personal',customer,async(req,res)=>{
  const rows=(await pool.query(`SELECT DISTINCT ON (${promoSQL}) o.id,${promoSQL} AS code FROM payment_orders o JOIN billing_accounts a ON a.id=o.account_id WHERE a.owner_id=$1 AND a.organization_id IS NULL AND o.status='paid' AND ${promoSQL} IS NOT NULL ORDER BY ${promoSQL},o.paid_at DESC`,[req.customer.id])).rows;
  res.set('Cache-Control','no-store').json({codes:rows.map(r=>({...r,kind:'order'}))});
 });
 const route=audience=>async(req,res)=>{
  const kind=req.params.kind,key=id(req.params.code);let row,where,value=key,commission=false;
  if(audience==='staff'&&!hasBusiness(req.staff))throw new HttpError(403,'需要商务权限');
  const owner=audience==='staff'?req.staff.subject:req.customer.id,admin=audience==='staff'&&req.staff.role==='platform_admin';
  if(kind==='cw'||kind==='task'){
   const table=kind==='cw'?'cw_codes':'vip_task_codes';
   row=(await pool.query(`SELECT k.id,k.code,p.user_id AS vip_user_id,${kind==='cw'?'k.name,k.is_self_code':'NULL::text AS name,true AS is_self_code'} FROM ${table} k JOIN cw_partners p ON p.id=k.partner_id WHERE k.id=$1 AND (${audience==='staff'?'$3 OR p.owner_subject=$2':'p.user_id=$2'})`,audience==='staff'?[key,owner,admin]:[key,owner])).rows[0];
   where=kind==='cw'?"o.discount_snapshot->'cw'->>'code_id'=$1":"o.discount_snapshot->>'task_code'=$1";
   commission=kind==='cw'&&row&&!row.is_self_code;
   if(commission){value=JSON.stringify({code:key,owner:row.vip_user_id});where="o.discount_snapshot->'cw'->>'code_id'=($1::jsonb->>'code') AND NOT EXISTS(SELECT 1 FROM billing_accounts a WHERE a.id=o.account_id AND a.owner_id=($1::jsonb->>'owner'))";}
  }else if(kind==='direct'&&audience==='staff'){
   row=(await pool.query("SELECT id,promo_code AS code,name FROM discount_grants WHERE id=$1 AND ($3 OR created_by=$2)",[key,owner,admin])).rows[0];
   where="o.discount_snapshot->>'grant_id'=$1";
  }else if(kind==='order'&&audience==='customer'){
   row=(await pool.query(`SELECT o.id,${promoSQL} AS code FROM payment_orders o JOIN billing_accounts a ON a.id=o.account_id WHERE o.id=$1 AND a.owner_id=$2 AND a.organization_id IS NULL AND ${promoSQL} IS NOT NULL`,[key,owner])).rows[0];
   // JSON parameter keeps both customer identity and code bound, never interpolated.
   value=JSON.stringify({owner,code:row?.code});where=`${promoSQL}=($1::jsonb->>'code') AND EXISTS(SELECT 1 FROM billing_accounts a WHERE a.id=o.account_id AND a.owner_id=($1::jsonb->>'owner') AND a.organization_id IS NULL)`;
  }
  if(!row)throw new HttpError(404,'此码不存在或无权查看');
  res.set('Cache-Control','no-store').json(await codeActivity(pool,{where,value,key,code:row.code,name:row.name,commission},req.query));
 };
 app.get('/api/code-activity/customer/:kind/:code',customer,route('customer'));
 app.get('/api/code-activity/staff/:kind/:code',staff,route('staff'));
}
