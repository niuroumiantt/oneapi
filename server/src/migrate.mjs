import pg from 'pg';
import { getMigrations } from 'better-auth/db/migration';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { config } from './core.mjs';
import { customerAuth } from './auth.mjs';
export async function migrate(pool,auth){
 const lock=await pool.connect();
 try{await lock.query('SELECT pg_advisory_lock(148921,1)');const plan=await getMigrations(auth.options);if(plan.schemaProblems.length||plan.unsafeChanges.length)throw Error('Unsafe authentication migration');await plan.runMigrations();for(const name of ['001_platform.sql','002_supply.sql','003_model_products.sql','004_promotion_drafts.sql','005_supplier_intake.sql','006_supplier_test_records.sql','007_price_proposals.sql','008_promotion_price_reference.sql','009_supplier_validation_runs.sql'])await lock.query(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));}
 finally{await lock.query('SELECT pg_advisory_unlock(148921,1)');lock.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const cfg=config(),pool=new pg.Pool({connectionString:cfg.databaseURL});await migrate(pool,customerAuth(pool,cfg,{queue:async()=>{throw Error('Migrations never send mail');}}));await pool.end();console.log('Identity and platform migrations complete');}
