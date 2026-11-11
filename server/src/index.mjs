import { settleEmployeeCalls } from './employee-credit.mjs';
import {syncKerapi} from './usage-reconciliation.mjs';
import {vault} from './core.mjs';
import { runKeyWatch, WATCH_INTERVAL_MS } from './key-watch.mjs';
import pg from 'pg';
import { config } from './core.mjs';
import { createApp } from './app.mjs';
const cfg=config(),pool=new pg.Pool({connectionString:cfg.databaseURL,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
const {app,mail}=createApp(pool,cfg);await pool.query('SELECT 1');
const server=app.listen(cfg.port,'0.0.0.0',()=>console.log(JSON.stringify({event:'identity_ready',port:cfg.port,mail_configured:mail.ready,source:cfg.source})));
let sending=false;
const worker=setInterval(async()=>{if(sending)return;sending=true;try{for(let i=0;i<5&&await mail.drain();i++);}catch{console.error('mail_worker_unavailable');}finally{sending=false;}},3000);
const cleanup=setInterval(async()=>{try{await pool.query("DELETE FROM staff_oidc_states WHERE expires_at<now(); DELETE FROM staff_sessions WHERE expires_at<now(); DELETE FROM request_limits WHERE expires_at<now()-interval '1 hour'; UPDATE mail_outbox SET payload=NULL,status='failed',error_code='EXPIRED' WHERE expires_at<now() AND status IN ('pending','sending','failed') AND payload IS NOT NULL;");}catch{console.error('cleanup_unavailable');}},600000);
let syncingUsage=false;
const usageWorker=setInterval(async()=>{if(syncingUsage||!process.env.SUPPLIER_LAB_SECRET)return;syncingUsage=true;try{const keys=(await pool.query("SELECT DISTINCT ON (credential_fingerprint) id FROM supplier_lab_credentials WHERE disabled_at IS NULL AND base_url IN ('https://kerapi.cn','https://kerapi.cn/v1') ORDER BY credential_fingerprint,priority,created_at LIMIT 20")).rows;for(const key of keys){try{await syncKerapi(pool,vault(process.env.SUPPLIER_LAB_SECRET),key.id,{kind:'system',id:'kerapi-usage-sync'})}catch{console.error('supplier_usage_sync_unavailable')}}await settleEmployeeCalls(pool)}catch{console.error('supplier_usage_worker_unavailable')}finally{syncingUsage=false}},300000);
// Key watch: what each purchase key really serves, every 30 minutes (first run 2 minutes after start).
let watching=false;const watchOnce=async()=>{if(watching||!process.env.SUPPLIER_LAB_SECRET)return;watching=true;try{const r=await runKeyWatch(pool,{box:vault(process.env.SUPPLIER_LAB_SECRET),mail});console.log(JSON.stringify({event:'key_watch',new_events:r.new_events,events:r.events,mailed:r.mailed}));}catch(e){console.error('key_watch_unavailable',String(e?.message||e).slice(0,200));}finally{watching=false;}};
const watchStart=setTimeout(watchOnce,120000),watchWorker=setInterval(watchOnce,WATCH_INTERVAL_MS);
for(const signal of ['SIGTERM' ,'SIGINT'])process.on(signal,()=>{clearInterval(worker);clearInterval(cleanup);clearInterval(usageWorker);clearTimeout(watchStart);clearInterval(watchWorker);server.close(async()=>{await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),20000).unref();});
