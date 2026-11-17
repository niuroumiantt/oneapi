// Trade statements only reconcile evidence and merchant costs, never move customer funds.
import {createHash} from 'node:crypto';
import {audit,HttpError} from './core.mjs';
import {billDay,checkBillDate} from './alipay-bills.mjs';
const fail=code=>{throw Error('WECHATPAY_BILL_'+code);};
const money=s=>{if(!/^-?\d{1,10}(\.\d{1,2}0*)?$/.test(s))fail('AMOUNT_INVALID');const [a,b='']=s.replace('-','').split('.');return (Number(a)*100+Number(b.slice(0,2).padEnd(2,'0')))*(s.startsWith('-')?-1:1);};
export function parseWechatStatement(bytes,day,mchId){
 const rows=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\ufeff/,'').trim().split(/\r?\n/).map(line=>line.split(',').map(c=>c.trim().replace(/^`/,'')));
 const h=rows[0],idx=name=>{const i=h.indexOf(name);if(i<0)fail('HEADER_UNSUPPORTED');return i;};
 const fields=['交易时间','商户号','微信订单号','商户订单号','交易类型','交易状态','货币种类','微信退款单号','商户退款单号','退款状态','手续费','订单金额','申请退款金额'];
 const cols=Object.fromEntries(fields.map(f=>[f,idx(f)])),entries=[];let footer=-1;
 for(let i=1;i<rows.length;i++){
  const row=rows[i];if(row[0]==='总交易单数'){footer=i;break;}
  if(row.length!==h.length)fail('ROW_INVALID');const v=f=>row[cols[f]];
  if(v('商户号')!==mchId||v('货币种类')!=='CNY'||!v('交易时间').startsWith(day+' '))fail('MERCHANT_DATE_OR_CURRENCY');
  const kind=v('交易状态'),refund=v('商户退款单号');
  if(!v('微信订单号')||!v('商户订单号'))fail('ROW_INVALID');
  entries.push({trade:v('微信订单号'),order:v('商户订单号'),kind,type:v('交易类型'),refund,refundTrade:v('微信退款单号'),refundStatus:v('退款状态'),amount:money(v(kind==='SUCCESS'?'订单金额':'申请退款金额')),fee:money(v('手续费'))});
 }
 if(footer<0||footer+2!==rows.length)fail('SUMMARY_MISSING');
 const sh=rows[footer],sv=rows[footer+1];
 if(Number(sv[sh.indexOf('总交易单数')])!==entries.length||money(sv[sh.indexOf('手续费总金额')])!==entries.reduce((n,e)=>n+e.fee,0))fail('SUMMARY_MISMATCH');
 for(const [col,kind] of [['订单总金额','SUCCESS'],['申请退款总金额','REFUND']])if(money(sv[sh.indexOf(col)])!==entries.filter(e=>e.kind===kind).reduce((n,e)=>n+e.amount,0))fail('SUMMARY_MISMATCH');
 return entries;
}
export async function applyWechatStatement(db,day,entries,hash,actor){
 let matched=0,exceptions=0,ignored=0;const issues=new Set(),matches=new Set();const groups=new Map(),seen=new Set(),refundSeen=new Set();
 for(const e of entries){if(!groups.has(e.order))groups.set(e.order,[]);groups.get(e.order).push(e);}
 for(const [number,rows] of groups){
  const o=(await db.query("SELECT *,to_char(paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS paid_day FROM payment_orders WHERE out_trade_no=$1 FOR UPDATE",[number])).rows[0];
  if(!o){ignored+=rows.length;continue;}seen.add(o.id);let issue=null;const keys=new Set(),receipt=rows.filter(e=>e.kind==='SUCCESS');
  if(o.provider!=='wechat_native'||o.status!=='paid'||rows.some(e=>e.trade!==o.provider_trade_no||e.type!=='NATIVE'))issue='微信交易号、渠道或支付状态不一致';
  for(const e of rows){
   e.key=e.kind==='SUCCESS'?'pay:'+e.trade:'refund:'+e.refund;
   if(keys.has(e.key))issue='微信账单存在重复流水';keys.add(e.key);
   if(e.kind==='SUCCESS'){
    if(e.amount!==Number(o.amount_fen)||o.paid_day!==day||receipt.length!==1)issue='微信收款金额或日期不一致';
    if(e.fee<0||e.fee>e.amount)issue='微信收款手续费符号或金额异常';
   }else if(e.kind==='REFUND'){
    const r=(await db.query('SELECT * FROM payment_refunds WHERE order_id=$1 AND out_request_no=$2',[o.id,e.refund])).rows[0];
    if(r)refundSeen.add(r.id);
    if(!r||r.status!=='succeeded'||Number(r.amount_fen)!==e.amount||e.refundStatus!=='SUCCESS'||!e.refundTrade||e.refundTrade==='0')issue='微信退款流水、金额或状态待核对';
    if(e.fee>0||-e.fee>e.amount)issue='微信退款手续费符号或金额异常';
   }else issue='微信账单业务类型待核对';
  }
  const old=(await db.query('SELECT * FROM wechat_bill_entries WHERE order_id=$1',[o.id])).rows;
  const other=(await db.query('SELECT entry_key FROM wechat_bill_entries WHERE order_id=$1 AND bill_date<>$2::date',[o.id,day])).rows;
  if(other.some(e=>keys.has(e.entry_key)))issue='微信流水跨账单重复';
  const current=(await db.query('SELECT entry_key FROM wechat_bill_entries WHERE order_id=$1 AND bill_date=$2::date',[o.id,day])).rows;
  if(current.some(e=>!keys.has(e.entry_key)))issue='微信账单修订缺少已核对流水';
  const candidate=[...old.filter(e=>!keys.has(e.entry_key)).map(e=>({kind:e.kind,fee:Number(e.fee_fen)})),...rows];
  const net=candidate.reduce((n,e)=>n+e.fee,0);
  if(!candidate.some(e=>e.kind==='SUCCESS'))issue='请先同步微信原收款日账单';
  if(net<0||net>Number(o.amount_fen))issue='微信净手续费金额异常';
  if(o.channel_fee_source&&o.channel_fee_source!=='wechat_bill'&&Number(o.channel_fee_fen)!==net)issue='微信账单费用与手工核对不一致';
  if(!issue){
   for(const e of rows)await db.query('INSERT INTO wechat_bill_entries(entry_key,order_id,bill_date,kind,amount_fen,fee_fen,source_sha256) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(entry_key) DO UPDATE SET amount_fen=excluded.amount_fen,fee_fen=excluded.fee_fen,source_sha256=excluded.source_sha256',[e.key,o.id,day,e.kind,e.amount,e.fee,hash]);
   if((!o.channel_fee_source||o.channel_fee_source==='wechat_bill')&&(o.channel_fee_fen===null||Number(o.channel_fee_fen)!==net||rows.some(e=>!old.some(x=>x.entry_key===e.key&&Number(x.amount_fen)===e.amount&&Number(x.fee_fen)===e.fee)))){
    await db.query("UPDATE payment_orders SET channel_fee_fen=$2,channel_fee_source='wechat_bill',channel_fee_evidence=$3,channel_fee_recorded_by=$4,channel_fee_recorded_at=now(),channel_fee_version=channel_fee_version+1 WHERE id=$1",[o.id,net,`微信交易账单 ${day} · 含退款退费 · SHA256 ${hash.slice(0,16)}`,actor.id]);
    await audit(db,actor,'billing.channel_fee.wechat_bill_reconciled',null,o.id,{before_fen:o.channel_fee_fen,amount_fen:net,bill_date:day,sha256:hash});
   }
   matches.add(o.id);await db.query('UPDATE payment_orders SET channel_fee_issue=NULL,channel_fee_issue_day=NULL WHERE id=$1 AND channel_fee_issue_day=$2::date',[o.id,day]);
  }else{issues.add(o.id);await db.query('UPDATE payment_orders SET channel_fee_issue=$2,channel_fee_issue_day=$3::date WHERE id=$1',[o.id,issue,day]);}
 }
 // Refund statements use initiation date, not completion date. Uncertain acceptance dates stay visible.
 const missing=(await db.query("SELECT id FROM payment_orders WHERE provider='wechat_native' AND status='paid' AND (paid_at AT TIME ZONE 'Asia/Shanghai')::date=$1::date",[day])).rows.filter(o=>!seen.has(o.id));
 for(const o of missing){issues.add(o.id);await db.query("UPDATE payment_orders SET channel_fee_issue='微信账单缺少本地已付款订单',channel_fee_issue_day=$2::date WHERE id=$1",[o.id,day]);}
 const refunds=(await db.query("SELECT r.id,r.order_id FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id WHERE o.provider='wechat_native' AND r.status='succeeded' AND (r.created_at AT TIME ZONE 'Asia/Shanghai')::date=$1::date AND NOT EXISTS(SELECT 1 FROM wechat_bill_entries e WHERE e.entry_key='refund:'||r.out_request_no)",[day])).rows;
 for(const r of refunds)if(!refundSeen.has(r.id)){issues.add(r.order_id);await db.query("UPDATE payment_orders SET channel_fee_issue='微信账单缺少退款，请核对受理日期',channel_fee_issue_day=$2::date WHERE id=$1",[r.order_id,day]);}
 const prior=(await db.query('SELECT entry_key,order_id FROM wechat_bill_entries WHERE bill_date=$1::date',[day])).rows;
 const fileKeys=new Set(entries.map(e=>e.kind==='SUCCESS'?'pay:'+e.trade:'refund:'+e.refund));
 for(const e of prior)if(!fileKeys.has(e.entry_key)){issues.add(e.order_id);await db.query("UPDATE payment_orders SET channel_fee_issue='微信账单修订缺少已核对流水',channel_fee_issue_day=$2::date WHERE id=$1",[e.order_id,day]);}
 exceptions=issues.size;matched=[...matches].filter(id=>!issues.has(id)).length;
 await db.query("INSERT INTO wechat_bill_days(bill_date,status,source_sha256,matched,exceptions,ignored) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(bill_date) DO UPDATE SET status=excluded.status,source_sha256=excluded.source_sha256,matched=excluded.matched,exceptions=excluded.exceptions,ignored=excluded.ignored,checked_at=now(),error_code=NULL",[day,exceptions?'review':'matched',hash,matched,exceptions,ignored]);
 return {day,status:exceptions?'review':'matched',matched,exceptions,ignored};
}
export async function syncWechatBill(pool,client,day,{actor={kind:'system',id:'wechat-bill-sync'}}={}){
 checkBillDate(day);if(!client?.billDownloadUrl)throw new HttpError(409,'微信账单接口未配置');
 const db=await pool.connect();let locked=false;
 try{
  locked=(await db.query('SELECT pg_try_advisory_lock(148921,64) AS locked')).rows[0].locked;if(!locked)throw new HttpError(409,'微信账单正在同步，请稍后刷新');
  let bytes,entries;
  try{const result=await client.billDownloadUrl(day);if(result.status!==200)fail(String(result.data.code||'API_FAILED').replace(/[^A-Z0-9_]/g,''));bytes=await client.downloadBill(result.data);entries=parseWechatStatement(bytes,day,client.mchId);
   // A downloaded refund status is frozen at bill generation. Refresh in-flight rows
   // through the signed refund query; never infer success from the bill alone.
   for(const e of entries.filter(e=>e.kind==='REFUND'&&e.refundStatus==='PROCESSING')){
    const local=(await db.query("SELECT r.id FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id WHERE o.out_trade_no=$1 AND o.provider='wechat_native' AND r.out_request_no=$2",[e.order,e.refund])).rows[0];
    if(!local||!client.queryRefund)continue;
    const r=await client.queryRefund(e.refund),v=r.data;
    if(r.status===200&&v.out_trade_no===e.order&&v.out_refund_no===e.refund&&v.refund_id===e.refundTrade&&v.amount?.refund===e.amount&&v.amount?.currency==='CNY'&&v.status==='SUCCESS')e.refundStatus='SUCCESS';
   }
}
  catch(e){const code=/^WECHATPAY_[A-Z0-9_.-]+$/.test(e.message)?e.message:'WECHATPAY_BILL_FETCH_OR_PARSE_FAILED';await db.query("INSERT INTO wechat_bill_days(bill_date,status,error_code) VALUES($1,'pending',$2) ON CONFLICT(bill_date) DO UPDATE SET status='pending',error_code=$2,checked_at=now()",[day,code]);return {day,status:'pending',error_code:code};}
  await db.query('BEGIN');try{const r=await applyWechatStatement(db,day,entries,createHash('sha256').update(bytes).digest('hex'),actor);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}
 }finally{if(locked)await db.query('SELECT pg_advisory_unlock(148921,64)');db.release();}
}
export async function syncDueWechatBills(pool,client,now=new Date()){
 if(!client||Number(new Date(now.getTime()+8*3600000).toISOString().slice(11,13))<10)return;
 const days=(await pool.query(`WITH days AS (
 SELECT (paid_at AT TIME ZONE 'Asia/Shanghai')::date AS day FROM payment_orders WHERE provider='wechat_native' AND status='paid'
 UNION SELECT (r.created_at AT TIME ZONE 'Asia/Shanghai')::date FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id WHERE o.provider='wechat_native' AND r.status IN ('pending','succeeded')
 UNION SELECT (r.completed_at AT TIME ZONE 'Asia/Shanghai')::date FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id WHERE o.provider='wechat_native' AND r.status='succeeded'
 UNION SELECT bill_date FROM wechat_bill_days WHERE status IN ('pending','review'))
 SELECT to_char(d.day,'YYYY-MM-DD') AS day FROM days d LEFT JOIN wechat_bill_days b ON b.bill_date=d.day WHERE d.day<$1::date AND d.day>=$1::date-90 AND (b.bill_date IS NULL OR (b.checked_at<now()-interval '6 hours' AND (b.status IN ('pending','review') OR d.day>=$1::date-7))) ORDER BY d.day LIMIT 8`,[billDay(now)])).rows;
 for(const {day} of days)await syncWechatBill(pool,client,day);
}
