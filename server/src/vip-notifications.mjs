import { transaction, HttpError, hasBusiness, id, vault } from './core.mjs';
export const vipNoticeText = {
 recharge: ['VIP 客户充值到账', '请核验原单及累计有效实付，达到条件后确认开通。'],
 applied: ['新的 VIP 申请', '请尽快联系申请人，安排电话面试。'],
 existing: ['VIP 申请待跟进', '请查看当前进度并完成下一步处理。'],
 confirmed: ['VIP 面试已通过', '下一步由负责员工发放付款码；已有充值请先核验原单。'],
 payment_code: ['VIP 付款码已发放', '请查看申请进度。累计有效实付满 ¥100 后由员工核验开通，已达标无需重复付款。'],
 active: ['VIP 已开通', '正式 VIP 身份已生效，可进入 VIP 工作台。'],
 rejected: ['VIP 申请未通过', '请查看申请反馈；如有疑问请联系负责员工。'],
 suspended: ['VIP 合作已暂停', '请联系负责员工了解后续安排。'],
 assigned: ['VIP 客户负责人已调整', '请查看客户档案并继续跟进。'],
 approval_requested: ['VIP 特批待审批', '请管理员核对申请原因、原单或折扣规则，并给出审批结果。'],
 approval_decided: ['VIP 特批已有结果', '请负责员工查看审批结果及下一步操作。'],
};
export async function queueNextVipNotice(pool, cfg, mail) {
 if (!mail?.ready) return false;
 let noticeId;
 try{return await transaction(pool, async db => {
  const n=(await db.query('SELECT * FROM vip_notifications WHERE mail_queued_at IS NULL AND mail_available_at<=now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1')).rows[0];
  if(!n)return false;
  noticeId=n.id;
  const p=(await db.query(`SELECT p.*,u.email,u."phoneOnly",s.name AS owner_name,i.code AS invite_code FROM cw_partners p
   JOIN "user" u ON u.id=p.user_id LEFT JOIN staff_members s ON s.subject=p.owner_subject
   LEFT JOIN vip_invite_codes i ON i.id=p.invite_code_id WHERE p.id=$1`,[n.partner_id])).rows[0];
  const [title,body]=vipNoticeText[n.kind]||vipNoticeText.existing;
  const staff=(await db.query(`SELECT lower(btrim(email)) AS email,bool_or(role='platform_admin') AS administrator FROM staff_members
   WHERE status='active' AND role<>'pending' AND btrim(email)<>'' AND (role='platform_admin' OR subject=$1) GROUP BY lower(btrim(email))`,[p.owner_subject])).rows;
  const link=new URL('/promotion/vip.html',cfg.origin);link.search=new URLSearchParams({staff:'1',partner:p.id});
  for(const r of staff){
   const lines=[body,'申请人：'+p.legal_name,'VIP 编号：'+p.public_code,'负责销售：'+(p.owner_name||'待分配'),
    '来源邀请码：'+(p.invite_code||'—'),'时间（北京时间）：'+new Date(n.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})];
   if(n.kind==='applied' && r.administrator){
    try{lines.push('联系方式：'+vault(cfg.secret+':cw-private-v1').open(p.contact_cipher).contact);}catch{lines.push('联系方式请在客户档案中核验。');}
    if(!p.phoneOnly)lines.push('账号邮箱：'+p.email);
   }
   lines.push('处理入口：'+link.href);
   await mail.queue({to:r.email,subject:'semifly '+title+' · '+p.public_code,text:lines.join('\n')},db);
  }
  if(!p.phoneOnly && ['applied','confirmed','payment_code','active','rejected','suspended'].includes(n.kind)){
   await mail.queue({to:p.email,subject:'semifly '+(n.kind==='applied'?'VIP 申请已提交':title),
    text:[n.kind==='applied'?'申请已提交，等待负责员工联系你进行电话面试。':body,'VIP 编号：'+p.public_code,
     '查看最新进度和下一步：'+new URL('/promotion/vip.html',cfg.origin).href].join('\n')},db);
  }
  await db.query('UPDATE vip_notifications SET mail_queued_at=now() WHERE id=$1',[n.id]);
  return true;
 });}catch(error){
  if(noticeId)await pool.query("UPDATE vip_notifications SET mail_attempts=mail_attempts+1,mail_available_at=now()+interval '1 minute' WHERE id=$1 AND mail_queued_at IS NULL",[noticeId]);
  throw error;
 }
}
export function vipNotificationRoutes(app,pool,requireStaff){
 const allowed=req=>{if(!hasBusiness(req.staff))throw new HttpError(403,'需要商务权限');};
 const scope=`(p.owner_subject=$1 OR $2)`;
 app.get('/api/staff/vip-notifications',requireStaff,async(req,res)=>{
  allowed(req);const args=[req.staff.subject,req.staff.role==='platform_admin'];
  const [items,count]=await Promise.all([
   pool.query(`SELECT n.id,n.kind,n.created_at,p.id AS partner_id,p.public_code,p.legal_name,r.read_at FROM vip_notifications n
    JOIN cw_partners p ON p.id=n.partner_id LEFT JOIN vip_notification_reads r ON r.notification_id=n.id AND r.subject=$1
    WHERE ${scope} ORDER BY (r.read_at IS NULL) DESC,n.created_at DESC,n.id DESC LIMIT 30`,args),
   pool.query(`SELECT count(*)::int AS unread FROM vip_notifications n JOIN cw_partners p ON p.id=n.partner_id
    WHERE ${scope} AND NOT EXISTS(SELECT 1 FROM vip_notification_reads r WHERE r.notification_id=n.id AND r.subject=$1)`,args)
  ]);
  res.set('Cache-Control','no-store').json({unread:count.rows[0].unread,items:items.rows.map(n=>({...n,title:(vipNoticeText[n.kind]||vipNoticeText.existing)[0],next:(vipNoticeText[n.kind]||vipNoticeText.existing)[1]}))});
 });
 app.post('/api/staff/vip-notifications/:notice/read',requireStaff,async(req,res)=>{
  allowed(req);
  const r=await pool.query(`INSERT INTO vip_notification_reads(notification_id,subject)
   SELECT n.id,$1 FROM vip_notifications n JOIN cw_partners p ON p.id=n.partner_id WHERE ${scope} AND n.id=$3
   ON CONFLICT(notification_id,subject) DO UPDATE SET read_at=now() RETURNING notification_id`,[req.staff.subject,req.staff.role==='platform_admin',id(req.params.notice)]);
  if(!r.rowCount)throw new HttpError(404,'通知不存在或不在你的管理范围内');
  res.json({ok:true});
 });
}
