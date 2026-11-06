import nodemailer from 'nodemailer';
import { vault,transaction } from './core.mjs';
export function mailService(pool,cfg,transport){
 const box=vault(cfg.secret),smtp=transport||nodemailer.createTransport({...cfg.smtp,connectionTimeout:12000,socketTimeout:20000,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}});
 const sender=`semifly.ai <${cfg.mailFrom||'test@example.test'}>`;
 const ready=!!(transport||(cfg.smtp.host&&cfg.smtp.auth.user&&cfg.smtp.auth.pass&&cfg.mailFrom));
 async function queue(message,db=pool){if(!ready)throw Error('Mail delivery is not configured');await db.query('INSERT INTO mail_outbox(payload) VALUES($1)',[box.seal({...message,from:sender})]);}
 async function drain(){
  const row=await transaction(pool,async db=>{const r=(await db.query("SELECT * FROM mail_outbox WHERE expires_at>now() AND attempts<5 AND ((status='pending' AND available_at<=now()) OR (status='sending' AND locked_at<now()-interval '5 minutes')) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(r)await db.query("UPDATE mail_outbox SET status='sending',attempts=attempts+1,locked_at=now() WHERE id=$1",[r.id]);return r;});
  if(!row)return false;
  try{await smtp.sendMail({...box.open(row.payload),from:sender});await pool.query("UPDATE mail_outbox SET status='sent',payload=NULL,error_code=NULL WHERE id=$1",[row.id]);}
  catch(e){await pool.query("UPDATE mail_outbox SET status=$2,available_at=now()+interval '1 minute',error_code=$3 WHERE id=$1",[row.id,row.attempts>=4?'failed':'pending',String(e.code||'DELIVERY_ERROR').slice(0,50)]);}
  return true;
 }
 return {queue,drain,ready,verify:()=>smtp.verify()};
}
