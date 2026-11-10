// One-time, operator-invoked migration. Input arrives on stdin; never log credentials.
import pg from 'pg';
import {config,vault,hash,transaction,audit} from './src/core.mjs';
import {validateLabBaseUrl} from './src/supplier-lab.mjs';
if((process.env.SUPPLIER_LAB_SECRET||'').length<32)throw Error('credential_encryption_not_configured');
const cfg=config(),box=vault(process.env.SUPPLIER_LAB_SECRET||''),pool=new pg.Pool({connectionString:cfg.databaseURL});
try {
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>131072)throw Error('input_too_large')}
 const records=JSON.parse(raw);let count=0;
 await transaction(pool,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(148921,27)');
  const staff=(await db.query("SELECT subject FROM staff_members WHERE status='active' AND role='platform_admin' ORDER BY created_at LIMIT 1")).rows[0];
  if(!staff)throw Error('administrator_missing');
  for(const [name,item] of Object.entries(records)){
   if(!/^[a-z0-9-]{1,40}$/.test(name)||typeof item.key!=='string'||!item.key||item.key.length>1000||/\s/.test(item.key)||!Array.isArray(item.models))throw Error('invalid_input');
   const base=validateLabBaseUrl(item.base_url),fingerprint=hash(item.key).slice(0,12);
   if((await db.query('SELECT 1 FROM supplier_lab_credentials WHERE credential_fingerprint=$1 AND base_url=$2',[fingerprint,base])).rowCount)continue;
   const supplier=(await db.query("INSERT INTO suppliers(legal_name,display_name,source_type,service_type,region,notes,created_by) VALUES('主体待确认',$1,'unconfirmed','model_api','待确认','由本机已录入凭据迁入；合同、采购价和验收结果待核实',$2) RETURNING id",[name==='kerapi'?'KerAPI':name,staff.subject])).rows[0];
   await db.query("INSERT INTO supplier_lab_suppliers(id,canonical_supplier_id,name,kind,created_by) VALUES($1,$1,$2,'supplier',$3)",[supplier.id,name==='kerapi'?'KerAPI':name,staff.subject]);
   const key=(await db.query('INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[supplier.id,'企业采购 Key（本机迁入）',base,box.seal({key:item.key}),fingerprint,staff.subject])).rows[0];
   for(const model of [...new Set(item.models)]){
    if(typeof model!=='string'||!model||model.length>100)throw Error('invalid_model');
    const offer=(await db.query("INSERT INTO supplier_offers(supplier_id,model_name,upstream_model_id,protocol,region,created_by) VALUES($1,$2,$2,'openai_compatible','待确认',$3) RETURNING id",[supplier.id,model,staff.subject])).rows[0];
    await db.query("INSERT INTO supplier_offer_checks(offer_id,check_key) SELECT $1,unnest(ARRAY['source','sales_rights','model_version','protocol','data_region','usage_billing','capacity'])",[offer.id]);
    await db.query("INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,created_by,supplier_id,credential_id,offer_id) VALUES($1,'supplier',$2,$1,$3,$4,$5,$6,$7)",[model,base,fingerprint,staff.subject,supplier.id,key.id,offer.id]);
   }
   await audit(db,{kind:'staff',id:staff.subject},'supplier_lab.local_key_migrated',null,key.id,{supplier_id:supplier.id,models:item.models.length});count++;
  }
 });console.log(JSON.stringify({migrated_credentials:count,customer_traffic_enabled:false}));
}catch{console.error('Migration failed; transaction rolled back. No credentials printed.');process.exitCode=1}finally{await pool.end()}
