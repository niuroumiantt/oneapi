import qrcode from 'qrcode-generator';
import { randomInt } from 'node:crypto';
import { HttpError, id, text, transaction, audit, vault, hasBusiness } from './core.mjs';
import { requireFinance, hasFinance } from './business-console.mjs';
import { commissionBps, VIP_SELF_PERCENT, VIP_ACTIVATE_MIN_CASH_FEN } from './cw-ledger.mjs';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const code = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const optionalNote = (value, max) =>
  value == null || (typeof value === 'string' && !value.trim()) ? '' : text(value, '备注', max);
const normalizedInvite = (v) =>
  String(v || '')
    .normalize('NFKC')
    .trim()
    .toUpperCase();
const integer = (v, min, max, label) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new HttpError(400, label + '格式不正确');
  return v;
};
const month = (v) => {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v || '')) throw new HttpError(400, '月份格式不正确');
  return v;
};
const business = (req) => {
  if (!hasBusiness(req.staff)) throw new HttpError(403, '需要商务权限');
};
const isAdmin = (staff) => staff?.role === 'platform_admin' && staff.status === 'active';
const admin = (req) => {
  if (!isAdmin(req.staff)) throw new HttpError(403, '需要管理员权限');
};
const canFollow = (staff, p) => isAdmin(staff) || p.owner_subject === staff.subject;
const financePartner = "p.status IN ('active','suspended') OR EXISTS (SELECT 1 FROM cw_payouts f WHERE f.partner_id=p.id)";
async function ownedPartner(db, pid, staff, lock = true) {
  const p = (await db.query('SELECT * FROM cw_partners WHERE id=$1' + (lock ? ' FOR UPDATE' : ' FOR SHARE'), [pid])).rows[0];
  if (!p || !canFollow(staff, p)) throw new HttpError(404, 'VIP 客户不存在或不在你的名下');
  return p;
}
function followupDate(value) {
  if (value === '' || value == null) return null;
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value))
    throw new HttpError(400, '下次联系日期格式不正确');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new HttpError(400, '下次联系日期无效');
  return value;
}
const publicPartner = (p) =>
  p
    ? {
        id: p.id,
        public_code: p.public_code,
        status: p.status,
        legal_name: p.legal_name,
        bank_last4: p.bank_last4,
        bank_verified: p.bank_verified_version !== null && p.bank_verified_version === p.bank_version,
        confirmed_at: p.confirmed_at,
        activated_at: p.activated_at,
        created_at: p.created_at,
      }
    : null;
const eligible = `SELECT e.id,e.commission_fen,c.code_id FROM cw_commission_events e JOIN cw_commissions c ON c.order_id=e.order_id
 JOIN payment_orders o ON o.id=c.order_id JOIN cw_customer_closes x ON x.account_id=o.account_id AND x.month=to_char(e.occurred_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM')
 WHERE c.partner_id=$1 AND e.kind='used' AND e.commission_fen>0 AND NOT EXISTS(SELECT 1 FROM cw_payout_items i WHERE i.event_id=e.id AND i.released_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM payment_refunds r WHERE r.order_id=o.id AND r.status='pending')
 AND o.channel_fee_issue IS NULL AND o.channel_fee_source IN ('wechat_bill','alipay_bill')`;
async function available(db, partnerId) {
  return (
    await db.query(`SELECT coalesce(sum(z.commission_fen),0)::text AS n FROM (${eligible}) z`, [partnerId])
  ).rows[0].n;
}
async function partner(db, userId, lock = false) {
  const p = (
    await db.query('SELECT * FROM cw_partners WHERE user_id=$1' + (lock ? ' FOR UPDATE' : ''), [userId])
  ).rows[0];
  if (!p) throw new HttpError(404, '请先申请成为 VIP 合作伙伴');
  return p;
}
async function uniqueCode(db) {
  for (let i = 0; i < 20; i++) {
    const c = code();
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['cw-code:' + c]);
    if (
      !(
        await db.query(
          'SELECT 1 FROM cw_codes WHERE code=$1 UNION ALL SELECT 1 FROM cw_partners WHERE public_code=$1 UNION ALL SELECT 1 FROM discount_grants WHERE upper(promo_code)=$1 UNION ALL SELECT 1 FROM vip_task_codes WHERE code=$1 UNION ALL SELECT 1 FROM vip_invite_codes WHERE code=$1',
          [c],
        )
      ).rowCount
    )
      return c;
  }
  throw new HttpError(503, '暂时无法分配推广码，请重试');
}
function canIssuePaymentCode(p) {
  if (!['confirmed', 'active'].includes(p.status))
    throw new HttpError(409, '请先确认面试通过，再发放付款码');
}
// Check at the statement time so an issuer waiting on the partner lock sees the code just committed.
const validTaskCode = "status='active' AND starts_at<=statement_timestamp() AND (ends_at IS NULL OR ends_at>statement_timestamp())";
async function issuePaymentCode(db, req, partnerId, percent, { requestedCode = '', endsAt = null, note = '' } = {}) {
  const taskCode = requestedCode || await uniqueCode(db);
  const row = (await db.query(
    `INSERT INTO vip_task_codes(partner_id,code,customer_price_percent,created_by,ends_at,note)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(code) DO NOTHING
     RETURNING id,code,customer_price_percent,status,starts_at,ends_at`,
    [partnerId, taskCode, percent, req.staff.subject, endsAt, note],
  )).rows[0];
  if (!row) throw new HttpError(409, '付款码已存在，请生成新码');
  await audit(db, req.actor, 'cw.task_code_issued', null, row.id, {
    partner_id: partnerId, percent, code: taskCode,
  });
  return row;
}
export function cwRoutes(app, pool, requireCustomer, requireStaff, cfg, mail) {
  const box = vault(cfg.secret + ':cw-private-v1');
  const enabled = (_req, _res, next) => {
    if (!cfg.cw?.enabled) throw new HttpError(503, 'VIP 合作伙伴功能尚未开放');
    next();
  };
  app.get('/api/cw/status', (_req, res) =>
    res.json({
      enabled: !!cfg.cw?.enabled,
      code_limit: 50,
      base_percent: 40,
      self_percent: 50,
      activate_min_cash_fen: VIP_ACTIVATE_MIN_CASH_FEN,
    }),
  );
  app.get('/api/cw/offers/:code', enabled, async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    // Task code: a VIP's own self-purchase discount. The quote path enforces self-use;
    // here we only surface the discount ratio so the top-up form can switch to "pay amount" mode.
    const task = (
      await pool.query(
        `SELECT t.code,t.customer_price_percent FROM vip_task_codes t JOIN cw_partners p ON p.id=t.partner_id WHERE t.code=$1 AND t.status='active' AND p.status IN ('confirmed','active') AND t.starts_at<=now() AND (t.ends_at IS NULL OR t.ends_at>now())`,
        [code],
      )
    ).rows[0];
    if (task) return res.json({ ...task, kind: 'task' });
    const r = (
      await pool.query(
        `SELECT c.code,c.customer_price_percent FROM cw_codes c JOIN cw_partners p ON p.id=c.partner_id WHERE c.code=$1 AND c.status='active' AND p.status='active' AND c.starts_at<=now() AND c.ends_at>now() AND EXISTS(SELECT 1 FROM cw_contracts k WHERE k.partner_id=p.id AND k.expires_at>now())`,
        [code],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, '推广码未生效');
    res.json({ ...r, kind: 'referral' });
  });
  app.post('/api/cw/apply', requireCustomer, enabled, async (req, res) => {
    const b = req.body || {},
      name = text(b.legal_name, '姓名', 60),
      contact = text(b.contact, '联系方式', 160);
    if (b.consent_version !== 'cw-privacy-v1') throw new HttpError(400, '请阅读并同意推广合作资料处理说明');
    const inviteCode = normalizedInvite(b.invite_code);
    const p = await transaction(pool, async (db) => {
      const customer = (await db.query(
        'SELECT email,"phoneOnly" FROM "user" WHERE id=$1 FOR UPDATE', [req.customer.id],
      )).rows[0];
      const existing = (await db.query('SELECT * FROM cw_partners WHERE user_id=$1', [req.customer.id]))
        .rows[0];
      if (existing) return existing;
      // Invite code is mandatory to join the VIP program.
      const invite = (
        await db.query(
          `SELECT i.id,i.max_uses,i.used_count,s.subject AS owner_subject,s.name AS owner_name
             FROM vip_invite_codes i LEFT JOIN staff_members s ON s.subject=i.created_by AND s.status='active' AND s.role<>'pending'
            WHERE i.code=$1 AND i.status=$2 FOR UPDATE OF i`,
          [inviteCode, 'active'],
        )
      ).rows[0];
      if (!invite) throw new HttpError(400, '邀请码无效或已停用');
      if (invite.used_count >= invite.max_uses) throw new HttpError(400, '邀请码使用次数已达上限');
      await db.query('UPDATE vip_invite_codes SET used_count=used_count+1 WHERE id=$1', [invite.id]);
      let invited = null;
      if (b.invite) {
        invited = (
          await db.query("SELECT id FROM cw_partners WHERE public_code=$1 AND status='active'", [
            String(b.invite).trim().toUpperCase(),
          ])
        ).rows[0];
        if (!invited) throw new HttpError(400, '邀请编号无效');
      }
      const row = (
        await db.query(
          `INSERT INTO cw_partners(user_id,public_code,invited_by,legal_name,contact_cipher,consent_version,invite_code_id,owner_subject)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            req.customer.id,
            await uniqueCode(db),
            invited?.id || null,
            name,
            box.seal({ contact }),
            b.consent_version,
            invite.id,
            invite.owner_subject,
          ],
        )
      ).rows[0];
      await audit(db, req.actor, 'cw.applied', null, row.id, {
        invited_by: invited?.id || null,
        invite_code: inviteCode,
      });
      if (mail?.ready) {
        const recipients = (await db.query(
          `SELECT email,bool_or(role='platform_admin') AS administrator
             FROM (SELECT lower(btrim(email)) AS email,role FROM staff_members
                   WHERE status='active' AND role<>'pending' AND btrim(email)<>''
                     AND (role='platform_admin' OR subject=$1)) recipients
            GROUP BY email`,
          [row.owner_subject],
        )).rows;
        const link = new URL('/promotion/vip.html', cfg.origin);
        link.search = new URLSearchParams({ staff: '1', partner: row.id });
        const submitted = row.created_at.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
        for (const recipient of recipients) {
          const details = [
            '有一位客户提交了 VIP 申请，等待电话面试。',
            '申请人：' + name,
            'VIP 编号：' + row.public_code,
            '来源邀请码：' + inviteCode,
            '申请时间（北京时间）：' + submitted,
            '负责销售：' + (invite.owner_name || '待分配'),
          ];
          if (recipient.administrator) {
            details.push('联系方式：' + contact);
            if (!customer.phoneOnly) details.push('账号邮箱：' + customer.email);
          }
          details.push('处理入口：' + link.href, '面试通过后发放付款码，核验客户充值后确认正式 VIP。');
          await mail.queue({ to: recipient.email, subject: 'semifly VIP 新申请 · ' + row.public_code, text: details.join('\n') }, db);
        }
      }
      return row;
    });
    res.status(201).json({ partner: publicPartner(p) });
  });
  app.get('/api/cw/me', requireCustomer, enabled, async (req, res) => {
    const p = (await pool.query('SELECT * FROM cw_partners WHERE user_id=$1', [req.customer.id])).rows[0];
    if (!p) return res.json({ partner: null });
    const totals = (
      await pool.query(
        `SELECT coalesce(sum(cash_fen),0)::text AS paid_fen,coalesce(sum(used_cash_fen),0)::text AS used_fen,coalesce(sum(expected_fen),0)::text AS expected_fen,coalesce(sum(unlocked_fen),0)::text AS unlocked_fen FROM cw_commissions WHERE partner_id=$1`,
        [p.id],
      )
    ).rows[0];
    const codes = (
      await pool.query(
        `SELECT k.id,k.code,k.name,k.status,k.customer_price_percent,k.commission_bps,k.is_self_code,k.starts_at,k.ends_at,
   coalesce(sum(c.cash_fen),0)::text AS paid_fen,coalesce(sum(c.used_cash_fen),0)::text AS used_fen,coalesce(sum(c.expected_fen),0)::text AS expected_fen,coalesce(sum(c.unlocked_fen),0)::text AS unlocked_fen
   FROM cw_codes k LEFT JOIN cw_commissions c ON c.code_id=k.id WHERE k.partner_id=$1 GROUP BY k.id ORDER BY k.is_self_code DESC,k.created_at`,
        [p.id],
      )
    ).rows;
    const contracts = (
      await pool.query(
        'SELECT template_version,document_sha256,expires_at,verified_at FROM cw_contracts WHERE partner_id=$1 ORDER BY verified_at DESC',
        [p.id],
      )
    ).rows;
    const payouts = (
      await pool.query(
        'SELECT id,gross_fen::text,withholding_fen::text,status,bank_last4,created_at,paid_at FROM cw_payouts WHERE partner_id=$1 ORDER BY created_at DESC LIMIT 100',
        [p.id],
      )
    ).rows;
    const invited = (
      await pool.query(
        'SELECT public_code,status,created_at FROM cw_partners WHERE invited_by=$1 ORDER BY created_at DESC LIMIT 100',
        [p.id],
      )
    ).rows;
    const perCode = (
      await pool.query(
        `SELECT z.code_id,sum(z.commission_fen)::text AS amount FROM (${eligible}) z GROUP BY z.code_id`,
        [p.id],
      )
    ).rows;
    for (const k of codes) k.available_fen = perCode.find((r) => r.code_id === k.id)?.amount || '0';
    const taskCodes = (
      await pool.query(
        "SELECT id,code,customer_price_percent,status,starts_at,ends_at,note FROM vip_task_codes WHERE partner_id=$1 AND status='active' AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now()) ORDER BY created_at DESC LIMIT 50",
        [p.id],
      )
    ).rows;
    res.json({
      partner: publicPartner(p),
      totals: { ...totals, available_fen: await available(pool, p.id) },
      codes,
      contracts,
      payouts,
      invited,
      task_codes: taskCodes,
    });
  });
  app.get('/api/cw/events', requireCustomer, enabled, async (req, res) => {
    const p = await partner(pool, req.customer.id),
      offset = integer(Number(req.query.offset || 0), 0, 100000, '页码'),
      codeId = req.query.code_id ? id(req.query.code_id) : null;
    // No customer identifier, order number, email, API key or prompt leaves this endpoint.
    const rows = (
      await pool.query(
        `SELECT e.id,e.kind,e.occurred_at,e.cash_fen::text,e.commission_fen::text,c.public_reference,k.code,k.name
   FROM cw_commission_events e JOIN cw_commissions c ON c.order_id=e.order_id JOIN cw_codes k ON k.id=c.code_id
   WHERE c.partner_id=$1 AND ($2::uuid IS NULL OR c.code_id=$2) ORDER BY e.occurred_at DESC,e.id DESC LIMIT 51 OFFSET $3`,
        [p.id, codeId, offset],
      )
    ).rows;
    res.json({ events: rows.slice(0, 50), has_more: rows.length > 50 });
  });
  app.post('/api/cw/codes', requireCustomer, enabled, async (req, res) => {
    const b = req.body || {},
      name = text(b.name, '推广码名称', 60),
      percent = integer(b.customer_price_percent ?? 50, 50, 100, '客户价格比例');
    const c = await transaction(pool, async (db) => {
      const p = await partner(db, req.customer.id, true);
      if (['suspended', 'rejected'].includes(p.status))
        throw new HttpError(403, '当前合作资格不可申请推广码');
      if (
        Number((await db.query('SELECT count(*) FROM cw_codes WHERE partner_id=$1', [p.id])).rows[0].count) >=
        50
      )
        throw new HttpError(409, '每名 VIP 最多 50 个推广码，停用码也保留在记录中');
      const r = (
        await db.query(
          'INSERT INTO cw_codes(partner_id,code,name,customer_price_percent,commission_bps) VALUES($1,$2,$3,$4,$5) RETURNING id,code,name,status,customer_price_percent,commission_bps',
          [p.id, await uniqueCode(db), name, percent, commissionBps(percent)],
        )
      ).rows[0];
      await audit(db, req.actor, 'cw.code_requested', null, r.id, { partner_id: p.id, percent });
      return r;
    });
    res.status(201).json(c);
  });
  app.get('/api/cw/codes/:code/qr', requireCustomer, enabled, async (req, res) => {
    const p = await partner(pool, req.customer.id),
      c = (
        await pool.query('SELECT code FROM cw_codes WHERE id=$1 AND partner_id=$2', [
          id(req.params.code),
          p.id,
        ])
      ).rows[0];
    if (!c) throw new HttpError(404, '推广码不存在');
    const q = qrcode(0, 'M');
    q.addData(cfg.origin + '/?cw=' + c.code + '#billing/personal');
    q.make();
    res.type('image/svg+xml').send(q.createSvgTag({ cellSize: 4, margin: 4, scalable: true }));
  });
  app.post('/api/cw/bank', requireCustomer, enabled, async (req, res) => {
    const b = req.body || {},
      holder = text(b.holder, '收款人', 60),
      bank = text(b.bank, '开户银行', 120),
      number = text(b.number, '银行卡号', 32).replace(/\s/g, '');
    if (!/^\d{12,32}$/.test(number) || b.consent_version !== 'cw-bank-v1')
      throw new HttpError(400, '请填写正确银行卡号并同意收款资料处理说明');
    await transaction(pool, async (db) => {
      const p = await partner(db, req.customer.id, true);
      if (holder !== p.legal_name) throw new HttpError(400, '请使用本人实名银行卡');
      if (
        (
          await db.query(
            "SELECT 1 FROM cw_payouts WHERE partner_id=$1 AND status IN ('requested','approved')",
            [p.id],
          )
        ).rowCount
      )
        throw new HttpError(409, '存在处理中提现，暂不能更换银行卡');
      await db.query(
        'UPDATE cw_partners SET bank_cipher=$2,bank_last4=$3,bank_version=bank_version+1,bank_verified_version=NULL WHERE id=$1',
        [p.id, box.seal({ holder, bank, number }), number.slice(-4)],
      );
      await audit(db, req.actor, 'cw.bank_changed', null, p.id, {
        consent_version: 'cw-bank-v1',
        bank_version: p.bank_version + 1,
      });
    });
    res.json({ ok: true });
  });
  app.post('/api/cw/payouts', requireCustomer, enabled, async (req, res) => {
    const key = id(req.body?.request_key);
    const payout = await transaction(pool, async (db) => {
      const p = await partner(db, req.customer.id, true);
      const old = (
        await db.query(
          'SELECT id,status,gross_fen::text FROM cw_payouts WHERE partner_id=$1 AND request_key=$2',
          [p.id, key],
        )
      ).rows[0];
      if (old) return old;
      if (p.status !== 'active' || !p.bank_cipher || p.bank_verified_version !== p.bank_version)
        throw new HttpError(409, '合作资格和本人收款账户须审核通过');
      const events = (await db.query(eligible, [p.id])).rows,
        gross = events.reduce((n, e) => n + BigInt(e.commission_fen), 0n);
      if (gross <= 0n) throw new HttpError(409, '暂无可提现佣金，请等待客户月结确认');
      const r = (
        await db.query(
          'INSERT INTO cw_payouts(partner_id,request_key,gross_fen,bank_version,bank_cipher,bank_last4) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,status,gross_fen::text',
          [p.id, key, gross.toString(), p.bank_version, p.bank_cipher, p.bank_last4],
        )
      ).rows[0];
      await db.query('INSERT INTO cw_payout_items(event_id,payout_id) SELECT unnest($1::uuid[]),$2', [
        events.map((e) => e.id),
        r.id,
      ]);
      await audit(db, req.actor, 'cw.payout_requested', null, r.id, { gross_fen: gross.toString() });
      return r;
    });
    res.status(201).json(payout);
  });
  app.get('/api/staff/cw', requireStaff, async (req, res) => {
    business(req);
    const administrator = isAdmin(req.staff), finance = hasFinance(req.staff);
    const [partners, invites, owners] = await Promise.all([
      pool.query(
        `SELECT p.id,p.public_code,p.legal_name,p.status,p.created_at,p.owner_subject,s.name AS owner_name,
                CASE WHEN $1 OR p.owner_subject=$2 THEN i.code END AS invite_code,
                CASE WHEN $1 OR p.owner_subject=$2 THEN to_char(p.next_contact_on,'YYYY-MM-DD') END AS next_contact_on,
                ($1 OR p.owner_subject=$2) AND EXISTS (
                  SELECT 1 FROM vip_payment_discount_requests r WHERE r.partner_id=p.id AND r.status='pending'
                ) AS discount_pending,
                $1 OR p.owner_subject IS NOT DISTINCT FROM $2 AS can_follow,
                CASE WHEN ($1 OR p.owner_subject=$2) AND NOT u."phoneOnly" THEN u.email END AS email
           FROM cw_partners p JOIN "user" u ON u.id=p.user_id
           LEFT JOIN vip_invite_codes i ON i.id=p.invite_code_id
           LEFT JOIN staff_members s ON s.subject=p.owner_subject
          WHERE $1 OR p.owner_subject=$2 OR ($3 AND (${financePartner}))
          ORDER BY discount_pending DESC NULLS LAST,(p.status IN ('pending','confirmed')) DESC,p.next_contact_on ASC NULLS LAST,p.created_at DESC
          LIMIT 500`, [administrator, req.staff.subject, finance],
      ),
      pool.query(
        `SELECT i.id,i.code,i.max_uses,i.used_count,i.status,i.note,i.created_by,i.created_at,s.name AS creator_name
           FROM vip_invite_codes i JOIN staff_members s ON s.subject=i.created_by
          WHERE $1 OR i.created_by=$2 ORDER BY i.created_at DESC LIMIT 200`, [administrator, req.staff.subject],
      ),
      administrator
        ? pool.query("SELECT subject,name,email FROM staff_members WHERE status='active' AND role<>'pending' ORDER BY name,subject")
        : { rows: [] },
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({
      enabled: !!cfg.cw?.enabled, partners: partners.rows, invite_codes: invites.rows,
      owners: owners.rows, administrator, finance,
    });
  });

  app.post('/api/staff/cw/invite-codes', requireStaff, async (req, res) => {
    business(req);
    const b = req.body || {};
    const inviteCode = normalizedInvite(b.code);
    if (!/^[A-Z0-9_-]{2,32}$/.test(inviteCode)) throw new HttpError(400, '邀请码格式不正确');
    const maxUses = integer(b.max_uses ?? 1, 1, 100000, '使用次数上限');
    const note = optionalNote(b.note, 200);
    const r = await transaction(pool, async (db) => {
      const row = (
        await db.query(
          `INSERT INTO vip_invite_codes(code,max_uses,note,created_by) VALUES($1,$2,$3,$4)
           ON CONFLICT(code) DO NOTHING RETURNING id,code,max_uses,used_count,status,note,created_at`,
          [inviteCode, maxUses, note, req.staff.subject],
        )
      ).rows[0];
      if (!row) throw new HttpError(409, '该邀请码已存在');
      await audit(db, req.actor, 'cw.invite_code_created', null, row.id, { code: inviteCode, max_uses: maxUses });
      return row;
    });
    res.status(201).json(r);
  });

  app.post('/api/staff/cw/invite-codes/:code/status', requireStaff, async (req, res) => {
    business(req);
    const state = req.body?.status;
    if (!['active', 'disabled'].includes(state)) throw new HttpError(400, '状态不正确');
    await transaction(pool, async (db) => {
      const r = await db.query(
        'UPDATE vip_invite_codes SET status=$2 WHERE code=$1 AND ($3 OR created_by=$4) RETURNING id',
        [normalizedInvite(req.params.code), state, isAdmin(req.staff), req.staff.subject],
      );
      if (!r.rowCount) throw new HttpError(404, '邀请码不存在');
      await audit(db, req.actor, 'cw.invite_code_status', null, r.rows[0].id, { status: state });
    });
    res.json({ ok: true });
  });
  app.post('/api/staff/cw/:partner/owner', requireStaff, async (req, res) => {
    admin(req);
    const pid = id(req.params.partner);
    const owner = req.body?.owner_subject === '' || req.body?.owner_subject === null
      ? null : text(req.body?.owner_subject, '负责销售', 120);
    await transaction(pool, async (db) => {
      await ownedPartner(db, pid, req.staff);
      if (owner && !(await db.query(
        "SELECT 1 FROM staff_members WHERE subject=$1 AND status='active' AND role<>'pending'", [owner],
      )).rowCount) throw new HttpError(400, '负责人必须是有商务权限的在职员工');
      await db.query('UPDATE cw_partners SET owner_subject=$2 WHERE id=$1', [pid, owner]);
      await audit(db, req.actor, 'cw.owner_changed', null, pid, { owner_subject: owner });
    });
    res.json({ ok: true });
  });

  app.post('/api/staff/cw/:partner/followups', requireStaff, async (req, res) => {
    business(req);
    const pid = id(req.params.partner);
    const body = text(req.body?.body, '跟进记录', 2000);
    const next = followupDate(req.body?.next_contact_on);
    await transaction(pool, async (db) => {
      await ownedPartner(db, pid, req.staff);
      const note = (await db.query(
        'INSERT INTO cw_sales_followups(partner_id,created_by,body,next_contact_on) VALUES($1,$2,$3,$4) RETURNING id',
        [pid, req.staff.subject, body, next],
      )).rows[0];
      await db.query('UPDATE cw_partners SET next_contact_on=$2 WHERE id=$1', [pid, next]);
      await audit(db, req.actor, 'cw.followup_added', null, pid, { followup_id: note.id, next_contact_on: next });
    });
    res.status(201).json({ ok: true });
  });

  app.get('/api/staff/cw/:partner', requireStaff, async (req, res) => {
    business(req);
    const pid = id(req.params.partner), finance = hasFinance(req.staff);
    const detail = await transaction(pool, async (db) => {
      const p = (await db.query(
        `SELECT p.*,i.code AS invite_code,s.name AS owner_name,to_char(p.next_contact_on,'YYYY-MM-DD') AS contact_day
           FROM cw_partners p LEFT JOIN vip_invite_codes i ON i.id=p.invite_code_id
           LEFT JOIN staff_members s ON s.subject=p.owner_subject
          WHERE p.id=$1 AND ($2 OR p.owner_subject=$3 OR ($4 AND (${financePartner}))) FOR SHARE OF p`,
        [pid, isAdmin(req.staff), req.staff.subject, finance],
      )).rows[0];
      if (!p) throw new HttpError(404, 'VIP 客户不存在或不在你的名下');
      const follow = canFollow(req.staff, p);
      const followups = follow ? (await db.query(
        `SELECT f.id,f.body,f.created_at,to_char(f.next_contact_on,'YYYY-MM-DD') AS next_contact_on,s.name AS author_name
           FROM cw_sales_followups f JOIN staff_members s ON s.subject=f.created_by
          WHERE f.partner_id=$1 ORDER BY f.created_at DESC,f.id DESC LIMIT 100`, [pid],
      )).rows : [];
      const codes = finance ? (
        await db.query(
          'SELECT k.id,k.code,k.name,k.status,k.customer_price_percent,k.commission_bps,k.is_self_code,k.starts_at,k.ends_at,coalesce(sum(c.cash_fen),0)::text AS paid_fen,coalesce(sum(c.used_cash_fen),0)::text AS used_fen,coalesce(sum(c.expected_fen),0)::text AS expected_fen,coalesce(sum(c.unlocked_fen),0)::text AS unlocked_fen FROM cw_codes k LEFT JOIN cw_commissions c ON c.code_id=k.id WHERE k.partner_id=$1 GROUP BY k.id ORDER BY k.is_self_code DESC,k.created_at',
          [pid],
        )
      ).rows : [];
      const contracts = finance ? (
        await db.query(
          'SELECT id,template_version,document_sha256,expires_at,verified_at,verified_by FROM cw_contracts WHERE partner_id=$1 ORDER BY verified_at DESC',
          [pid],
        )
      ).rows : [];
      const orders = finance ? (
        await db.query(
          `SELECT c.public_reference,c.cash_fen::text,c.used_cash_fen::text,c.expected_fen::text,c.unlocked_fen::text,k.code,o.out_trade_no,o.paid_at,o.account_id,o.channel_fee_issue,
      u.email AS customer_email FROM cw_commissions c JOIN cw_codes k ON k.id=c.code_id JOIN payment_orders o ON o.id=c.order_id JOIN "user" u ON u.id=o.created_by WHERE c.partner_id=$1 ORDER BY c.created_at DESC LIMIT 200`,
          [pid],
        )
      ).rows : [];
      const payouts = finance ? (
        await db.query(
          'SELECT id,status,gross_fen::text,withholding_fen::text,bank_last4,created_at,paid_at,reviewed_by,payment_reference FROM cw_payouts WHERE partner_id=$1 ORDER BY created_at DESC LIMIT 100',
          [pid],
        )
      ).rows : [];
      const events = finance ? (
        await db.query(
          `SELECT e.kind,e.occurred_at,e.cash_fen::text,e.commission_fen::text,k.code,o.out_trade_no FROM cw_commission_events e JOIN cw_commissions c ON c.order_id=e.order_id JOIN cw_codes k ON k.id=c.code_id JOIN payment_orders o ON o.id=c.order_id WHERE c.partner_id=$1 ORDER BY e.occurred_at DESC,e.id DESC LIMIT 200`,
          [pid],
        )
      ).rows : [];
      const closes = finance ? (
        await db.query(
          `SELECT x.account_id,x.month,x.closed_at,x.closed_by,x.evidence FROM cw_customer_closes x WHERE EXISTS(SELECT 1 FROM payment_orders o JOIN cw_commissions c ON c.order_id=o.id WHERE o.account_id=x.account_id AND c.partner_id=$1) ORDER BY x.month DESC LIMIT 100`,
          [pid],
        )
      ).rows : [];
      const taskCodes = follow ? (await db.query(
        `SELECT id,code,customer_price_percent,status,starts_at,ends_at,note,created_by,created_at,
                (${validTaskCode}) AS usable
           FROM vip_task_codes WHERE partner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`, [pid],
      )).rows : [];
      const discountRequests = follow ? (await db.query(
        `SELECT r.id,r.customer_price_percent,r.status,r.reason,r.created_at,r.decided_at,r.decision_note,
                author.name AS requested_by_name, approver.name AS decided_by_name,c.code AS issued_code
           FROM vip_payment_discount_requests r JOIN staff_members author ON author.subject=r.requested_by
           LEFT JOIN staff_members approver ON approver.subject=r.decided_by
           LEFT JOIN vip_task_codes c ON c.id=r.issued_code_id
          WHERE r.partner_id=$1 ORDER BY (r.status='pending') DESC,r.created_at DESC,r.id DESC LIMIT 30`, [pid],
      )).rows : [];
      // Self-purchase discount-code payments — sales uses this list to verify recharge before activate.
      const discountPayments = follow ? (
        await db.query(
          `SELECT o.id,o.out_trade_no,o.amount_fen::text,o.face_fen::text,o.paid_at,o.status,
                  o.discount_snapshot->>'promo_code' AS promo_code
             FROM payment_orders o
             JOIN billing_accounts a ON a.id=o.account_id
            WHERE a.owner_id=$1
              AND coalesce((o.discount_snapshot->'cw'->>'is_self_code')::boolean,false)=true
              AND nullif(o.discount_snapshot->>'task_code','') IS NOT NULL
            ORDER BY o.paid_at DESC NULLS LAST, o.created_at DESC
            LIMIT 50`,
          [p.user_id],
        )
      ).rows : [];
      const qualifying = discountPayments.find(
        (o) => o.status === 'paid' && Number(o.amount_fen) >= VIP_ACTIVATE_MIN_CASH_FEN,
      );
      return {
        partner: {
          ...publicPartner(p), owner_subject: p.owner_subject, owner_name: p.owner_name,
          bank_last4: finance ? p.bank_last4 : undefined,
          bank_verified: finance ? publicPartner(p).bank_verified : undefined,
          invite_code: follow ? p.invite_code : null, next_contact_on: follow ? p.contact_day : null,
        },
        can_follow: follow, finance, followups,
        codes,
        contracts,
        orders,
        events,
        payouts,
        closes,
        task_codes: taskCodes,
        discount_requests: discountRequests,
        discount_payments: discountPayments,
        activate_min_cash_fen: VIP_ACTIVATE_MIN_CASH_FEN,
        can_activate: p.status === 'confirmed' && Boolean(qualifying),
        available_fen: finance ? await available(db, pid) : null,
      };
    });
    res.set('Cache-Control', 'no-store');
    res.json(detail);
  });
  app.post('/api/staff/cw/:partner/contract', requireStaff, async (req, res) => {
    admin(req);
    const b = req.body || {},
      pid = id(req.params.partner),
      version = text(b.template_version, '合同版本', 80),
      reference = text(b.signature_reference, '签约服务商凭证编号', 200),
      identity = text(b.identity_reference, '实名核验凭证编号', 200),
      sha = String(b.document_sha256 || ''),
      expires = new Date(b.expires_at);
    if (!/^[a-f0-9]{64}$/.test(sha) || !Number.isFinite(expires.getTime()) || expires <= new Date())
      throw new HttpError(400, '合同哈希或有效期不正确');
    if (b.verified !== true) throw new HttpError(400, '请核验双方签署记录及身份凭证');
    await transaction(pool, async (db) => {
      const p = (await db.query('SELECT id FROM cw_partners WHERE id=$1 FOR UPDATE', [pid])).rows[0];
      if (!p) throw new HttpError(404, 'VIP 不存在');
      await db.query(
        'INSERT INTO cw_contracts(partner_id,template_version,document_sha256,signature_reference,identity_reference,expires_at,verified_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [pid, version, sha, reference, identity, expires, req.staff.subject],
      );
      // Contract signing alone does NOT activate the partner. The sales confirmation
      // (POST /:partner/confirm) is what turns a pending application into an active VIP,
      // and the task code is issued separately by an approver after confirmation.
      await audit(db, req.actor, 'cw.contract_verified', null, pid, { version, document_sha256: sha });
    });
    res.json({ ok: true });
  });

  // Interview confirmation: pending → confirmed. Applicant may then receive a discount code
  // and recharge; formal VIP still requires a separate sales activation after payment check.
  app.post('/api/staff/cw/:partner/confirm', requireStaff, async (req, res) => {
    business(req);
    const pid = id(req.params.partner);
    await transaction(pool, async (db) => {
      const p = await ownedPartner(db, pid, req.staff);
      if (p.status === 'active') throw new HttpError(409, '该申请已是正式 VIP，无需重复确认');
      if (p.status === 'confirmed') throw new HttpError(409, '已面试确认，请发放打折码；客户充值后由销售核验并确认正式 VIP');
      if (p.status !== 'pending') throw new HttpError(409, '当前状态不可确认');
      await db.query(
        "UPDATE cw_partners SET status='confirmed',confirmed_by=$2,confirmed_at=now() WHERE id=$1",
        [pid, req.staff.subject],
      );
      await audit(db, req.actor, 'cw.confirmed', null, pid, {
        note: optionalNote(req.body?.note, 300),
      });
    });
    res.json({ ok: true });
  });

  // Sales grants formal VIP after verifying a successful discount-code recharge (≥ ¥100 provisional).
  app.post('/api/staff/cw/:partner/activate', requireStaff, async (req, res) => {
    business(req);
    const pid = id(req.params.partner);
    const result = await transaction(pool, async (db) => {
      const p = await ownedPartner(db, pid, req.staff);
      if (p.status === 'active') throw new HttpError(409, '已是正式 VIP');
      if (p.status !== 'confirmed') throw new HttpError(409, '请先完成面试确认并等待客户充值');
      const paid = (
        await db.query(
          `SELECT o.id,o.out_trade_no,o.amount_fen::text,o.paid_at
             FROM payment_orders o
             JOIN billing_accounts a ON a.id=o.account_id
            WHERE a.owner_id=$1 AND o.status='paid'
              AND coalesce((o.discount_snapshot->'cw'->>'is_self_code')::boolean,false)=true
              AND nullif(o.discount_snapshot->>'task_code','') IS NOT NULL
              AND o.amount_fen>=$2
            ORDER BY o.paid_at DESC NULLS LAST
            LIMIT 1`,
          [p.user_id, VIP_ACTIVATE_MIN_CASH_FEN],
        )
      ).rows[0];
      if (!paid)
        throw new HttpError(
          409,
          `尚未找到实付 ≥ ¥${(VIP_ACTIVATE_MIN_CASH_FEN / 100).toFixed(0)} 的打折码充值记录，请核验后再确认`,
        );
      await db.query(
        "UPDATE cw_partners SET status='active',activated_at=coalesce(activated_at,now()) WHERE id=$1",
        [pid],
      );
      await audit(db, req.actor, 'cw.activated', null, pid, {
        order_id: paid.id,
        amount_fen: paid.amount_fen,
        out_trade_no: paid.out_trade_no,
        note: optionalNote(req.body?.note, 300),
      });
      return paid;
    });
    res.json({ ok: true, payment: result });
  });

  // The default payment code is bound to the applicant. A retry returns the current code.
  app.post('/api/staff/cw/:partner/task-code', requireStaff, async (req, res) => {
    business(req);
    const b = req.body || {}, pid = id(req.params.partner);
    if (b.customer_price_percent != null && b.customer_price_percent !== VIP_SELF_PERCENT)
      throw new HttpError(403, '非 5 折付款码须由管理员特批');
    const requestedCode = normalizedInvite(b.code);
    if (requestedCode && !/^[A-Z0-9_-]{2,32}$/.test(requestedCode)) throw new HttpError(400, '付款码格式不正确');
    const endsAt = b.ends_at ? new Date(b.ends_at) : null;
    if (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= new Date()))
      throw new HttpError(400, '付款码有效期不正确');
    const note = optionalNote(b.note, 200);
    const c = await transaction(pool, async (db) => {
      canIssuePaymentCode(await ownedPartner(db, pid, req.staff));
      const current = (await db.query(
        `SELECT id,code,customer_price_percent,status,starts_at,ends_at FROM vip_task_codes
          WHERE partner_id=$1 AND ${validTaskCode} ORDER BY created_at DESC,id DESC LIMIT 1`, [pid],
      )).rows[0];
      if (current && requestedCode && current.code !== requestedCode)
        throw new HttpError(409, '已有可用付款码');
      return current || issuePaymentCode(db, req, pid, VIP_SELF_PERCENT, { requestedCode, endsAt, note });
    });
    res.status(201).json(c);
  });

  app.post('/api/staff/cw/:partner/discount-requests', requireStaff, async (req, res) => {
    business(req);
    const pid = id(req.params.partner);
    const percent = integer(req.body?.customer_price_percent, 1, 100, '实付比例');
    if (percent === VIP_SELF_PERCENT) throw new HttpError(400, '5 折可直接生成付款码');
    const reason = text(req.body?.reason, '特批原因', 300);
    const request = await transaction(pool, async (db) => {
      canIssuePaymentCode(await ownedPartner(db, pid, req.staff));
      const proposed = (await db.query(
        `INSERT INTO vip_payment_discount_requests(partner_id,customer_price_percent,reason,requested_by)
         VALUES($1,$2,$3,$4) ON CONFLICT(partner_id) WHERE status='pending' DO NOTHING
         RETURNING id,customer_price_percent,status`, [pid, percent, reason, req.staff.subject],
      )).rows[0];
      if (!proposed) throw new HttpError(409, '该客户已有待审批的折扣申请');
      await audit(db, req.actor, 'cw.payment_discount_requested', null, proposed.id, { partner_id: pid, percent });
      return proposed;
    });
    res.status(201).json(request);
  });

  app.post('/api/staff/cw/:partner/discount-requests/:request/decision', requireStaff, async (req, res) => {
    admin(req);
    const pid = id(req.params.partner), rid = id(req.params.request), state = req.body?.status;
    if (!['approved', 'rejected'].includes(state)) throw new HttpError(400, '审批结果不正确');
    const note = state === 'rejected' ? text(req.body?.decision_note, '退回原因', 300) : optionalNote(req.body?.decision_note, 300);
    const result = await transaction(pool, async (db) => {
      const p = await ownedPartner(db, pid, req.staff);
      const pending = (await db.query(
        'SELECT customer_price_percent,status FROM vip_payment_discount_requests WHERE id=$1 AND partner_id=$2 FOR UPDATE',
        [rid, pid],
      )).rows[0];
      if (!pending) throw new HttpError(404, '折扣申请不存在');
      if (pending.status !== 'pending') throw new HttpError(409, '该折扣申请已处理');
      let issued = null;
      if (state === 'approved') {
        canIssuePaymentCode(p);
        await db.query("UPDATE vip_task_codes SET status='paused' WHERE partner_id=$1 AND status='active'", [pid]);
        issued = await issuePaymentCode(db, req, pid, pending.customer_price_percent);
      }
      await db.query(
        `UPDATE vip_payment_discount_requests SET status=$2,decision_note=$3,decided_by=$4,decided_at=now(),issued_code_id=$5 WHERE id=$1`,
        [rid, state, note, req.staff.subject, issued?.id || null],
      );
      await audit(db, req.actor, 'cw.payment_discount_decided', null, rid, {
        partner_id: pid, status: state, percent: pending.customer_price_percent, issued_code_id: issued?.id || null,
      });
      return issued;
    });
    res.json({ ok: true, payment_code: result });
  });

  app.post('/api/staff/cw/:partner/status', requireStaff, async (req, res) => {
    admin(req);
    const state = req.body?.status;
    if (!['suspended', 'rejected'].includes(state))
      throw new HttpError(400, '仅可暂停或拒绝，启用须销售确认');
    await transaction(pool, async (db) => {
      await db.query('UPDATE cw_partners SET status=$2 WHERE id=$1', [id(req.params.partner), state]);
      await audit(db, req.actor, 'cw.status_changed', null, req.params.partner, {
        status: state,
        reason: text(req.body.reason, '原因', 300),
      });
    });
    res.json({ ok: true });
  });
  app.post('/api/staff/cw/codes/:code/review', requireStaff, async (req, res) => {
    requireFinance(req);
    const b = req.body || {},
      cid = id(req.params.code),
      state = b.status;
    if (!['active', 'paused', 'rejected'].includes(state)) throw new HttpError(400, '审核状态不正确');
    await transaction(pool, async (db) => {
      const c = (await db.query('SELECT * FROM cw_codes WHERE id=$1 FOR UPDATE', [cid])).rows[0];
      if (!c) throw new HttpError(404, '推广码不存在');
      if (state === 'active') {
        if (
          !(
            await db.query(
              "SELECT 1 FROM cw_partners p WHERE p.id=$1 AND p.status='active' AND EXISTS(SELECT 1 FROM cw_contracts k WHERE k.partner_id=p.id AND k.expires_at>now())",
              [c.partner_id],
            )
          ).rowCount
        )
          throw new HttpError(409, '请先完成有效合同和身份核验');
        const percent = integer(b.customer_price_percent, 50, 100, '价格比例'),
          start = new Date(b.starts_at),
          end = new Date(b.ends_at);
        if (
          !Number.isFinite(start.getTime()) ||
          !Number.isFinite(end.getTime()) ||
          end <= start ||
          end <= new Date()
        )
          throw new HttpError(400, '活动有效期不正确');
        if ((await db.query('SELECT 1 FROM discount_grants WHERE upper(promo_code)=$1', [c.code])).rowCount)
          throw new HttpError(409, '此码与历史活动冲突，请联系管理员');
        await db.query(
          'UPDATE cw_codes SET status=$2,customer_price_percent=$3,commission_bps=$4,starts_at=$5,ends_at=$6,approved_by=$7 WHERE id=$1',
          [cid, state, percent, commissionBps(percent), start, end, req.staff.subject],
        );
      } else await db.query('UPDATE cw_codes SET status=$2 WHERE id=$1', [cid, state]);
      await audit(db, req.actor, 'cw.code_reviewed', null, cid, {
        status: state,
        percent: b.customer_price_percent || null,
      });
    });
    res.json({ ok: true });
  });
  app.post('/api/staff/cw/:partner/private', requireStaff, async (req, res) => {
    business(req);
    const scope = req.body?.scope;
    if (scope === 'bank') requireFinance(req);
    const finance = scope !== 'contact' && hasFinance(req.staff);
    const pid = id(req.params.partner), reason = text(req.body?.reason, '查看原因', 200);
    const result = await transaction(pool, async (db) => {
      const p = scope === 'bank'
        ? (await db.query('SELECT * FROM cw_partners WHERE id=$1', [pid])).rows[0]
        : await ownedPartner(db, pid, req.staff, false);
      if (!p) throw new HttpError(404, 'VIP 不存在');
      await audit(db, req.actor, 'cw.private_viewed', null, pid, {
        reason, scope: scope === 'bank' ? 'bank' : finance ? 'contact+bank' : 'contact',
      });
      return {
        contact: scope === 'bank' ? undefined : box.open(p.contact_cipher),
        bank: finance && p.bank_cipher ? box.open(p.bank_cipher) : null,
        bank_version: finance ? p.bank_version : undefined,
      };
    });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  });
  app.post('/api/staff/cw/:partner/bank-verify', requireStaff, async (req, res) => {
    requireFinance(req);
    const pid = id(req.params.partner),
      version = integer(req.body?.bank_version, 1, 100000, '银行卡版本');
    await transaction(pool, async (db) => {
      const r = await db.query(
        'UPDATE cw_partners SET bank_verified_version=$2 WHERE id=$1 AND bank_version=$2 AND bank_cipher IS NOT NULL RETURNING id',
        [pid, version],
      );
      if (!r.rowCount) throw new HttpError(409, '银行卡已变更，请重新核验');
      await audit(db, req.actor, 'cw.bank_verified', null, pid, {
        bank_version: version,
        evidence: text(req.body.evidence, '本人账户核验凭证', 200),
      });
    });
    res.json({ ok: true });
  });
  app.post('/api/staff/cw/customer-closes', requireStaff, async (req, res) => {
    requireFinance(req);
    const b = req.body || {},
      account = id(b.account_id),
      m = month(b.month),
      evidence = text(b.evidence, '客户月结凭证', 300);
    await transaction(pool, async (db) => {
      await db.query('SELECT id FROM billing_accounts WHERE id=$1 FOR UPDATE', [account]);
      const ended = (
        await db.query(
          "SELECT (($1||'-01')::timestamp+interval '1 month') AT TIME ZONE 'Asia/Shanghai' <= now() AS ok",
          [m],
        )
      ).rows[0].ok;
      if (!ended) throw new HttpError(409, '自然月尚未结束');
      const busy = (
        await db.query(
          "SELECT 1 FROM customer_calls WHERE account_id=$1 AND status IN ('pending','awaiting_bill') AND created_at < (($2||'-01')::timestamp+interval '1 month') AT TIME ZONE 'Asia/Shanghai'",
          [account, m],
        )
      ).rowCount;
      if (busy) throw new HttpError(409, '客户仍有待结算调用');
      const mismatch = (
        await db.query(
          `SELECT 1 FROM cw_commissions c JOIN payment_orders o ON o.id=c.order_id WHERE o.account_id=$1 AND EXISTS(SELECT 1 FROM cw_commission_events e WHERE e.order_id=o.id AND e.kind='used' AND to_char(e.occurred_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM')=$2) AND (o.channel_fee_issue IS NOT NULL OR o.channel_fee_source IS NULL OR o.channel_fee_source NOT IN ('wechat_bill','alipay_bill') OR EXISTS(SELECT 1 FROM payment_refunds r WHERE r.order_id=o.id AND r.status='pending'))`,
          [account, m],
        )
      ).rowCount;
      if (mismatch) throw new HttpError(409, '相关收款账单或退款尚未核对完成');
      await db.query(
        'INSERT INTO cw_customer_closes(account_id,month,evidence,closed_by) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,month) DO NOTHING',
        [account, m, evidence, req.staff.subject],
      );
      await audit(db, req.actor, 'cw.customer_month_closed', null, account, { month: m, evidence });
    });
    res.json({ ok: true });
  });
  app.post('/api/staff/cw/payouts/:payout/review', requireStaff, async (req, res) => {
    requireFinance(req);
    const pid = id(req.params.payout),
      b = req.body || {};
    if (!['approved', 'rejected'].includes(b.status)) throw new HttpError(400, '审核状态不正确');
    await transaction(pool, async (db) => {
      const r = (await db.query('SELECT * FROM cw_payouts WHERE id=$1 FOR UPDATE', [pid])).rows[0];
      if (!r || r.status !== 'requested') throw new HttpError(409, '提现已处理');
      if (b.status === 'approved') {
        const p = (await db.query('SELECT * FROM cw_partners WHERE id=$1', [r.partner_id])).rows[0];
        if (p.status !== 'active' || p.bank_verified_version !== r.bank_version)
          throw new HttpError(409, '合作状态或银行卡核验已变化');
        const bad = (
          await db.query(
            `SELECT 1 FROM cw_payout_items i JOIN cw_commission_events e ON e.id=i.event_id JOIN payment_orders o ON o.id=e.order_id WHERE i.payout_id=$1 AND (o.channel_fee_issue IS NOT NULL OR EXISTS(SELECT 1 FROM payment_refunds r WHERE r.order_id=o.id AND r.status='pending'))`,
            [pid],
          )
        ).rowCount;
        if (bad) throw new HttpError(409, '相关交易存在待处理退款或对账异常');
      }
      const tax = integer(b.withholding_fen ?? 0, 0, Number(r.gross_fen) - 1, '代扣税额');
      await db.query(
        'UPDATE cw_payouts SET status=$2,withholding_fen=$3,reviewed_by=$4,evidence=$5 WHERE id=$1',
        [pid, b.status, tax, req.staff.subject, text(b.evidence, '审核依据', 300)],
      );
      if (b.status === 'rejected')
        await db.query('UPDATE cw_payout_items SET released_at=now() WHERE payout_id=$1', [pid]);
      await audit(db, req.actor, 'cw.payout_reviewed', null, pid, { status: b.status, withholding_fen: tax });
    });
    res.json({ ok: true });
  });
  app.post('/api/staff/cw/payouts/:payout/payment-details', requireStaff, async (req, res) => {
    requireFinance(req);
    const r = (
      await pool.query("SELECT * FROM cw_payouts WHERE id=$1 AND status='approved'", [id(req.params.payout)])
    ).rows[0];
    if (!r) throw new HttpError(409, '请先完成提现审核');
    await audit(pool, req.actor, 'cw.payout_bank_viewed', null, r.id, {
      reason: text(req.body.reason, '查看原因', 200),
    });
    res.json({
      id: r.id,
      net_fen: (BigInt(r.gross_fen) - BigInt(r.withholding_fen)).toString(),
      bank: box.open(r.bank_cipher),
    });
  });
  app.post('/api/staff/cw/payouts/:payout/complete', requireStaff, async (req, res) => {
    requireFinance(req);
    const pid = id(req.params.payout),
      b = req.body || {};
    if (!['paid', 'failed'].includes(b.status))
      throw new HttpError(400, '仅确认银行最终结果，未知结果请保持处理中');
    await transaction(pool, async (db) => {
      const r = (await db.query('SELECT * FROM cw_payouts WHERE id=$1 FOR UPDATE', [pid])).rows[0];
      if (!r || r.status !== 'approved') throw new HttpError(409, '仅可确认已审核提现');
      const ref = text(b.payment_reference, '银行流水或失败查询编号', 160),
        evidence = text(b.evidence, '银行最终结果凭证', 300);
      if (b.bank_result_verified !== true) throw new HttpError(400, '请先核验银行最终结果');
      await db.query(
        "UPDATE cw_payouts SET status=$2,payment_reference=$3,evidence=$4,paid_at=CASE WHEN $2='paid' THEN now() ELSE NULL END WHERE id=$1",
        [pid, b.status, ref, evidence],
      );
      if (b.status === 'failed')
        await db.query('UPDATE cw_payout_items SET released_at=now() WHERE payout_id=$1', [pid]);
      await audit(db, req.actor, 'cw.payout_completed', null, pid, { status: b.status, reference: ref });
    });
    res.json({ ok: true });
  });
}
