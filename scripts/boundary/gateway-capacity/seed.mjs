// Seeds a throwaway *_test database: 32 employees, one key each (64 in flight, 1200/min), and KerAPI routes for two models.
import pg from 'pg'; import { writeFile } from 'node:fs/promises';
import { hash, vault } from '../../../server/src/core.mjs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (s, v) => pool.query(s, v);
await q("INSERT INTO staff_members(subject,email,name,role,status) VALUES('cap-staff','cap@example.test','Cap','platform_admin','active') ON CONFLICT DO NOTHING");
await q(`INSERT INTO "user"(id,name,email,"emailVerified",disabled) VALUES('cap-owner','Owner','owner@example.test',true,false)`);
const org = (await q("INSERT INTO organizations(name,created_by) VALUES('Capacity Co','cap-owner') RETURNING id")).rows[0].id;
const keys = [];
for (let i = 0; i < 32; i++) {
  const uid = `cap-u${i}`, secret = 'sf_emp_' + String(i).padStart(2, '0') + 'x'.repeat(41);
  await q(`INSERT INTO "user"(id,name,email,"emailVerified",disabled) VALUES($1,$1,$2,true,false)`, [uid, `${uid}@example.test`]);
  await q("INSERT INTO memberships(organization_id,user_id,role,status) VALUES($1,$2,'member','active')", [org, uid]);
  await q("INSERT INTO employee_credit_accounts(user_id,organization_id,granted_yuan) VALUES($1,$2,100000)", [uid, org]);
  await q("INSERT INTO employee_api_keys(owner_id,label,secret_hash,key_hint,max_concurrent,per_minute) VALUES($1,'cap',$2,'xxxxxx',64,1200)", [uid, hash(secret)]);
  keys.push(secret);
}
const sup = (await q("INSERT INTO supplier_lab_suppliers(name,kind,created_by) VALUES('KerAPI','supplier','cap-staff') RETURNING id")).rows[0].id;
const ct = vault(process.env.SUPPLIER_LAB_SECRET).seal({ key: 'mock-upstream-key' });
const cred = (await q("INSERT INTO supplier_lab_credentials(supplier_id,label,base_url,credential_ciphertext,credential_fingerprint,created_by,priority) VALUES($1,'mock','https://kerapi.cn/v1',$2,'fp-mock','cap-staff',1) RETURNING id", [sup, ct])).rows[0].id;
for (const m of ['deepseek-v4.1-flash', 'GLM-5.3'])
  await q("INSERT INTO supplier_lab_endpoints(label,kind,base_url,model_id,credential_fingerprint,input_yuan_per_m,cached_input_yuan_per_m,output_yuan_per_m,created_by,supplier_id,credential_id) VALUES($1,'supplier','https://kerapi.cn/v1',$1,'fp-mock',1,0.02,4,'cap-staff',$2,$3)", [m, sup, cred]);
await writeFile(new URL('./seed.json', import.meta.url), JSON.stringify({ org, keys }));
console.log('seeded org', org, 'keys', keys.length); await pool.end();
