// Explicit operator action. Reuses the console executor; refuses a second first run.
import pg from 'pg';
import {config,vault} from './src/core.mjs';
import {startSupplierRun} from './src/supplier-lab.mjs';
const pool=new pg.Pool({connectionString:config().databaseURL});
try {
 if(process.argv[2]!=='--execute-once')throw Error('explicit_execute_once_required');
 if((process.env.SUPPLIER_LAB_SECRET||'').length<32)throw Error('vault_not_configured');
 const endpoints=(await pool.query(`SELECT e.id FROM supplier_lab_endpoints e JOIN supplier_lab_suppliers s ON s.id=e.supplier_id JOIN supplier_lab_credentials c ON c.id=e.credential_id WHERE lower(s.name)='kerapi' AND e.model_id='deepseek-v4.1-flash' AND e.disabled_at IS NULL AND c.disabled_at IS NULL`)).rows;
 if(endpoints.length!==1)throw Error('expected_exactly_one_flash_endpoint');
 const staff=(await pool.query("SELECT subject FROM staff_members WHERE status='active' AND role='platform_admin' ORDER BY created_at LIMIT 1")).rows[0];
 if(!staff)throw Error('administrator_missing');
 const {completion,...receipt}=await startSupplierRun(pool,vault(process.env.SUPPLIER_LAB_SECRET),{supplier_endpoint_id:endpoints[0].id,case_ids:['arithmetic','json','chinese','context']},staff.subject,{kind:'system',id:'authorized-operator-cli'},{firstRunOnly:true});
 console.log(JSON.stringify(receipt));await completion;
 const run=(await pool.query('SELECT id,status,created_at,finished_at FROM supplier_lab_runs WHERE id=$1',[receipt.run_id])).rows[0];
 console.log(JSON.stringify(run));
}catch(e){console.error(JSON.stringify({error:e.status===409?'first_run_already_exists':'operator_test_failed',code:e.code||null}));process.exitCode=1}finally{await pool.end()}
