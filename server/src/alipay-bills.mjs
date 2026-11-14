// Read-only Alipay trade statements; the only financial write is merchant channel cost.
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {audit,HttpError} from './core.mjs';
const LIMIT=16*1024*1024;
const fail=code=>{throw Error(code);};
export const billDay=(now=new Date())=>new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
export function checkBillDate(day,now=new Date()){
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||day>=billDay(now)||day<'2020-01-01')throw new HttpError(400,'请选择已结束的账单日期；当天账单通常次日上午生成');
 return day;
}
function crc32(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
// Bounded ZIP reader, no filesystem extraction, no ZIP64/encryption, CRC checked.
export function statementFiles(zip){
 if(zip.length>LIMIT)fail('BILL_TOO_LARGE');let end=-1;
 for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--)if(zip.readUInt32LE(i)===0x06054b50&&i+22+zip.readUInt16LE(i+20)===zip.length){end=i;break;}
 if(end<0||zip.readUInt16LE(end+4)||zip.readUInt16LE(end+6))fail('BILL_ZIP_INVALID');
 const count=zip.readUInt16LE(end+10),size=zip.readUInt32LE(end+12),offset=zip.readUInt32LE(end+16);
 if(count<1||count>20||count!==zip.readUInt16LE(end+8)||offset+size!==end)fail('BILL_ZIP_INVALID');
 const files=[];let at=offset,total=0;
 for(let i=0;i<count;i++){
  if(at+46>end||zip.readUInt32LE(at)!==0x02014b50)fail('BILL_ZIP_INVALID');
  const flags=zip.readUInt16LE(at+8),method=zip.readUInt16LE(at+10),crc=zip.readUInt32LE(at+16),compressed=zip.readUInt32LE(at+20),length=zip.readUInt32LE(at+24),nameLen=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),comment=zip.readUInt16LE(at+32),local=zip.readUInt32LE(at+42);
  if(flags&1||![0,8].includes(method)||(total+=length)>LIMIT||at+46+nameLen+extra+comment>end||local+30>offset)fail('BILL_ZIP_INVALID');
  const name=zip.subarray(at+46,at+46+nameLen),decoded=new TextDecoder(flags&0x800?'utf-8':'gb18030',{fatal:true}).decode(name);
  if(zip.readUInt32LE(local)!==0x04034b50||zip.readUInt16LE(local+8)!==method||zip.readUInt16LE(local+6)!==flags||zip.readUInt16LE(local+26)!==nameLen||!zip.subarray(local+30,local+30+nameLen).equals(name))fail('BILL_ZIP_INVALID');
  const start=local+30+nameLen+zip.readUInt16LE(local+28);
  if(start+compressed>offset)fail('BILL_ZIP_INVALID');
  const bytes=method===8?inflateRawSync(zip.subarray(start,start+compressed),{maxOutputLength:LIMIT}):zip.subarray(start,start+compressed);
  if(bytes.length!==length||crc32(bytes)!==crc)fail('BILL_ZIP_INVALID');
  if(decoded.endsWith('.csv'))files.push(bytes);
  at+=46+nameLen+extra+comment;
 }
 if(at!==end||!files.length)fail('BILL_ZIP_INVALID');return files;
}
export function csvRows(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}else if(c==='"'&&cell==='')quoted=true;else if(c===','){row.push(cell.trim());cell='';}else if(c==='\n'){row.push(cell.trim());rows.push(row);row=[];cell='';}else if(c!=='\r')cell+=c;}
 if(quoted)fail('BILL_CSV_INVALID');if(cell||row.length){row.push(cell.trim());rows.push(row);}return rows;
}
const money=s=>{if(!/^-?\d{1,10}(\.\d{1,2})?$/.test(s))fail('BILL_AMOUNT_INVALID');const negative=s.startsWith('-'),[a,b='']=s.replace('-','').split('.');return (Number(a)*100+Number(b.padEnd(2,'0')))*(negative?-1:1);};
// Header driven, never column positions. Unknown formats fail closed.
export function parseStatement(files){
 const entries=[];let found=false;
 for(const bytes of files){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}
  const rows=csvRows(text),index=rows.findIndex(r=>r.includes('支付宝交易号')&&(r.includes('商户订单号')||r.includes('商家订单号'))&&r.includes('业务类型'));
  if(index<0)continue;found=true;const header=rows[index],col=(...names)=>{const i=header.findIndex(v=>names.includes(v));if(i<0)fail('BILL_HEADER_UNSUPPORTED');return i;};
  const trade=col('支付宝交易号'),order=col('商户订单号','商家订单号'),kind=col('业务类型'),amount=col('订单金额（元）','订单金额(元)'),fee=col('服务费（元）','服务费(元)'),refund=col('退款批次号/请求号','退款批次号','退款请求号');
  for(const row of rows.slice(index+1)){if(!row.some(Boolean)||row[0].startsWith('#'))continue;if(row.length<header.length)fail('BILL_ROW_INVALID');
   const entry={trade:row[trade],order:row[order],kind:row[kind],amount:money(row[amount]),fee:money(row[fee]),refund:row[refund]};
   if(!entry.trade||!entry.order)fail('BILL_ROW_INVALID');entries.push(entry);
  }
 }
 if(!found)fail('BILL_HEADER_UNSUPPORTED');return entries;
}
export async function downloadStatement(url,fetchImpl=fetch){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!(u.hostname==='alipay.com'||u.hostname.endsWith('.alipay.com')))fail('BILL_DOWNLOAD_HOST_REJECTED');
 const r=await fetchImpl(u,{redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)fail('BILL_DOWNLOAD_FAILED');if(Number(r.headers.get('content-length'))>LIMIT)fail('BILL_TOO_LARGE');
 const chunks=[];let size=0;for await(const b of r.body){if((size+=b.length)>LIMIT)fail('BILL_TOO_LARGE');chunks.push(b);}return Buffer.concat(chunks);
}
// The transaction caller holds a global advisory lock. A different/repeated file is a
// fresh comparison, not an additive expense, and never overwrites manual corrections.
export async function applyStatement(db,day,entries,hash,actor){
 let matched=0,exceptions=0,ignored=0;const groups=new Map();
 for(const entry of entries){if(!groups.has(entry.order))groups.set(entry.order,[]);groups.get(entry.order).push(entry);}
 const seen=new Set();
 for(const [number,rows] of groups){
  const o=(await db.query("SELECT *,to_char(paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS paid_day,to_char(channel_fee_issue_day,'YYYY-MM-DD') AS issue_day FROM payment_orders WHERE out_trade_no=$1 FOR UPDATE",[number])).rows[0];
  if(!o){ignored+=rows.length;continue;}seen.add(o.id);
  let issue=null;const receipts=rows.filter(r=>r.kind==='交易'||r.kind==='收入');
  if(o.provider!=='alipay_f2f'||o.status!=='paid'||rows.some(r=>r.trade!==o.provider_trade_no))issue='交易号或支付状态不一致';
  else if(rows.some(r=>!['交易','收入','退款'].includes(r.kind)))issue='账单业务类型待核对';
  else if(receipts.length>1)issue='账单有重复收款行';
  else if(receipts.length===1&&(receipts[0].amount!==Number(o.amount_fen)||o.paid_day!==day||receipts[0].refund))issue='收款金额或日期不一致';
  else if(receipts.some(r=>r.fee<0||r.fee>r.amount))issue='收款服务费符号或金额待核对';
  for(const r of rows.filter(r=>r.kind==='退款')){
   const refund=(await db.query("SELECT amount_fen FROM payment_refunds WHERE order_id=$1 AND out_request_no=$2 AND status='succeeded'",[o.id,r.refund])).rows[0];
   if(!refund||Math.abs(r.amount)!==Number(refund.amount_fen))issue='退款流水或金额待核对';
   // Trade statement revisions differ in how refunded service fees are represented.
   // Until confirmed against a real merchant sample, never guess the direction.
   else if(r.fee!==0)issue='账单含退费调整，请核对净渠道费';
  }
  if(!issue&&receipts.length===1){const amount=receipts[0].fee;
   if(o.channel_fee_fen!==null&&o.channel_fee_source!=='alipay_bill'){
    if(Number(o.channel_fee_fen)!==amount)issue='账单费用与手工核对不一致';
   }else if(o.channel_fee_issue&&o.issue_day!==day)issue=o.channel_fee_issue;
   else if(o.channel_fee_fen===null||Number(o.channel_fee_fen)!==amount){
    await db.query("UPDATE payment_orders SET channel_fee_fen=$2,channel_fee_source='alipay_bill',channel_fee_evidence=$3,channel_fee_recorded_by=$4,channel_fee_recorded_at=now(),channel_fee_version=channel_fee_version+1 WHERE id=$1",[o.id,amount,`支付宝交易账单 ${day} · SHA256 ${hash.slice(0,16)}`,actor.id]);
    await audit(db,actor,'billing.channel_fee.bill_reconciled',null,o.id,{before_fen:o.channel_fee_fen,amount_fen:amount,bill_date:day,sha256:hash});
   }
  }
  if(issue){exceptions++;await db.query('UPDATE payment_orders SET channel_fee_issue=$2,channel_fee_issue_day=CASE WHEN channel_fee_issue=$2 THEN coalesce(channel_fee_issue_day,$3::date) ELSE $3::date END WHERE id=$1',[o.id,issue,day]);}
  else{matched++;/* Only clear discrepancies from this same receipt day, never a later adjustment. */await db.query('UPDATE payment_orders SET channel_fee_issue=NULL,channel_fee_issue_day=NULL WHERE id=$1 AND channel_fee_issue_day=$2::date',[o.id,day]);}
 }
 const missing=(await db.query("SELECT id FROM payment_orders WHERE provider='alipay_f2f' AND status='paid' AND (paid_at AT TIME ZONE 'Asia/Shanghai')::date=$1::date",[day])).rows.filter(o=>!seen.has(o.id));
 for(const o of missing){exceptions++;await db.query("UPDATE payment_orders SET channel_fee_issue='账单缺少本地已付款订单',channel_fee_issue_day=$2::date WHERE id=$1",[o.id,day]);}
 await db.query("INSERT INTO alipay_bill_days(bill_date,status,source_sha256,matched,exceptions,ignored) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(bill_date) DO UPDATE SET status=excluded.status,source_sha256=excluded.source_sha256,matched=excluded.matched,exceptions=excluded.exceptions,ignored=excluded.ignored,checked_at=now(),error_code=NULL",[day,exceptions?'review':'matched',hash,matched,exceptions,ignored]);
 return {day,status:exceptions?'review':'matched',matched,exceptions,ignored};
}
export async function syncAlipayBill(pool,client,day,{actor={kind:'system',id:'alipay-bill-sync'},fetchImpl=fetch}={}){
 checkBillDate(day);if(!client?.billDownloadUrl)throw new HttpError(409,'支付宝账单接口未配置');
 const db=await pool.connect();let locked=false;
 try{
  locked=(await db.query('SELECT pg_try_advisory_lock(148921,63) AS locked')).rows[0].locked;if(!locked)throw new HttpError(409,'账单正在同步，请稍后刷新');
  let bytes,entries;
  try{const result=await client.billDownloadUrl(day);if(result.code!=='10000')fail('BILL_API_'+String(result.sub_code||result.code).replace(/[^A-Z0-9_.-]/g,'').slice(0,90));
   bytes=await downloadStatement(result.bill_download_url,fetchImpl);entries=parseStatement(statementFiles(bytes));
  }catch(error){const code=/^(BILL_|ALIPAY_)[A-Z0-9_.-]+$/.test(error.message)?error.message:'BILL_FETCH_OR_PARSE_FAILED';
   await db.query("INSERT INTO alipay_bill_days(bill_date,status,error_code) VALUES($1,'pending',$2) ON CONFLICT(bill_date) DO UPDATE SET status='pending',error_code=$2,checked_at=now()",[day,code]);
   return {day,status:'pending',error_code:code};
  }
  await db.query('BEGIN');try{const result=await applyStatement(db,day,entries,createHash('sha256').update(bytes).digest('hex'),actor);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}
 }finally{if(locked)await db.query('SELECT pg_advisory_unlock(148921,63)');db.release();}
}
// Retry older missing days too, not just yesterday. Eight days/run bounds startup load.
export async function syncDueAlipayBills(pool,client,now=new Date()){
 if(Number(new Date(now.getTime()+8*3600000).toISOString().slice(11,13))<9)return;
 const days=(await pool.query(`WITH days AS (
 SELECT (paid_at AT TIME ZONE 'Asia/Shanghai')::date AS day FROM payment_orders WHERE provider='alipay_f2f' AND status='paid'
 UNION SELECT (r.completed_at AT TIME ZONE 'Asia/Shanghai')::date FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id WHERE o.provider='alipay_f2f' AND r.status='succeeded')
 SELECT to_char(d.day,'YYYY-MM-DD') AS day FROM days d LEFT JOIN alipay_bill_days b ON b.bill_date=d.day WHERE d.day<$1::date AND (b.bill_date IS NULL OR (b.checked_at<now()-interval '6 hours' AND (b.status='pending' OR d.day>=$1::date-7))) ORDER BY b.checked_at NULLS FIRST,d.day LIMIT 8`,[billDay(now)])).rows;
 for(const {day} of days)await syncAlipayBill(pool,client,day);
}
