// Seed the initial VIP invite code (vip888) for the referral program.
// Run inside the api container after deploy: node /app/scripts/seed_vip_invite.mjs
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const admin = (
  await pool.query("SELECT subject FROM staff_members WHERE role='platform_admin' AND status='active' ORDER BY created_at LIMIT 1")
).rows[0];
if (!admin) {
  console.error('No active platform_admin staff found; seed skipped.');
  process.exit(1);
}
const r = await pool.query(
  `INSERT INTO vip_invite_codes(code,max_uses,used_count,status,note,created_by)
   VALUES('VIP888',100000,0,'active','初始邀请码，由 semifly 管理员生成',$2)
   ON CONFLICT(code) DO NOTHING RETURNING code`,
  ['VIP888', admin.subject],
);
console.log(r.rowCount ? `Seeded invite code ${r.rows[0].code}` : 'Invite code VIP888 already exists');
await pool.end();
