import qrcode from 'qrcode-generator';
import { randomInt } from 'node:crypto';
import { HttpError, id, text, transaction, audit, vault, hasBusiness } from './core.mjs';
import { requireFinance } from './business-console.mjs';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const code = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
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
const admin = (req) => {
  if (req.staff?.role !== 'platform_admin' || req.staff.status !== 'active')
    throw new HttpError(403, '需要管理员权限');
};
const publicPartner = (p) =>
  p
    ? {
        id: p.id,
        public_code: p.public_code,
        status: p.status,
        legal_name: p.legal_name,
        bank_last4: p.bank_last4,
        bank_verified: p.bank_verified_version !== null && p.bank_verified_version === p.bank_version,
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
  if (!p) throw new HttpError(404, '请先申请成为推广合作伙伴');
  return p;
}
async function uniqueCode(db) {
  for (let i = 0; i < 20; i++) {
    const c = code();
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['cw-code:' + c]);
    if (
      !(
        await db.query(
          'SELECT 1 FROM cw_codes WHERE code=$1 UNION ALL SELECT 1 FROM cw_partners WHERE public_code=$1 UNION ALL SELECT 1 FROM discount_grants WHERE upper(promo_code)=$1',
          [c],
        )
      ).rowCount
    )
      return c;
  }
  throw new HttpError(503, '暂时无法分配推广码，请重试');
}
export function cwRoutes(app, pool, requireCustomer, requireStaff, cfg) {
  const box = vault(cfg.secret + ':cw-private-v1');
  const enabled = (_req, _res, next) => {
    if (!cfg.cw?.enabled) throw new HttpError(503, '推广合作伙伴功能尚未开放');
    next();
  };
  app.get('/api/cw/status', (_req, res) =>
    res.json({ enabled: !!cfg.cw?.enabled, code_limit: 50, commission_bps: 1000 }),
  );
  app.get('/api/cw/offers/:code', enabled, async (req, res) => {
    const r = (
      await pool.query(
        `SELECT c.code,c.customer_price_percent FROM cw_codes c JOIN cw_partners p ON p.id=c.partner_id WHERE c.code=$1 AND c.status='active' AND p.status='active' AND c.starts_at<=now() AND c.ends_at>now() AND EXISTS(SELECT 1 FROM cw_contracts k WHERE k.partner_id=p.id AND k.expires_at>now())`,
        [String(req.params.code).toUpperCase()],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, '推广码未生效');
    res.json(r);
  });
  app.post('/api/cw/apply', requireCustomer, enabled, async (req, res) => {
    const b = req.body || {},
      name = text(b.legal_name, '姓名', 60),
      contact = text(b.contact, '联系方式', 160);
    if (b.consent_version !== 'cw-privacy-v1') throw new HttpError(400, '请阅读并同意推广合作资料处理说明');
    const p = await transaction(pool, async (db) => {
      await db.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [req.customer.id]);
      const existing = (await db.query('SELECT * FROM cw_partners WHERE user_id=$1', [req.customer.id]))
        .rows[0];
      if (existing) return existing;
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
          'INSERT INTO cw_partners(user_id,public_code,invited_by,legal_name,contact_cipher,consent_version) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
          [
            req.customer.id,
            await uniqueCode(db),
            invited?.id || null,
            name,
            box.seal({ contact }),
            b.consent_version,
          ],
        )
      ).rows[0];
      await audit(db, req.actor, 'cw.applied', null, row.id, { invited_by: invited?.id || null });
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
        `SELECT k.id,k.code,k.name,k.status,k.customer_price_percent,k.starts_at,k.ends_at,
   coalesce(sum(c.cash_fen),0)::text AS paid_fen,coalesce(sum(c.used_cash_fen),0)::text AS used_fen,coalesce(sum(c.expected_fen),0)::text AS expected_fen,coalesce(sum(c.unlocked_fen),0)::text AS unlocked_fen
   FROM cw_codes k LEFT JOIN cw_commissions c ON c.code_id=k.id WHERE k.partner_id=$1 GROUP BY k.id ORDER BY k.created_at`,
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
    res.json({
      partner: publicPartner(p),
      totals: { ...totals, available_fen: await available(pool, p.id) },
      codes,
      contracts,
      payouts,
      invited,
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
      percent = integer(b.customer_price_percent ?? 50, 1, 100, '客户价格比例');
    const c = await transaction(pool, async (db) => {
      const p = await partner(db, req.customer.id, true);
      if (['suspended', 'rejected'].includes(p.status))
        throw new HttpError(403, '当前合作资格不可申请推广码');
      if (
        Number((await db.query('SELECT count(*) FROM cw_codes WHERE partner_id=$1', [p.id])).rows[0].count) >=
        50
      )
        throw new HttpError(409, '每名 CW 最多 50 个推广码，停用码也保留在记录中');
      const r = (
        await db.query(
          'INSERT INTO cw_codes(partner_id,code,name,customer_price_percent) VALUES($1,$2,$3,$4) RETURNING id,code,name,status,customer_price_percent',
          [p.id, await uniqueCode(db), name, percent],
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
    const partners = (
      await pool.query(`SELECT p.id,p.public_code,p.legal_name,p.status,p.created_at,u.email,i.public_code AS invited_by,
   (SELECT count(*)::int FROM cw_codes k WHERE k.partner_id=p.id) AS code_count,
   (SELECT coalesce(sum(cash_fen),0)::text FROM cw_commissions c WHERE c.partner_id=p.id) AS paid_fen,
   (SELECT coalesce(sum(used_cash_fen),0)::text FROM cw_commissions c WHERE c.partner_id=p.id) AS used_fen,
   (SELECT coalesce(sum(expected_fen),0)::text FROM cw_commissions c WHERE c.partner_id=p.id) AS expected_fen
   FROM cw_partners p JOIN "user" u ON u.id=p.user_id LEFT JOIN cw_partners i ON i.id=p.invited_by ORDER BY p.created_at DESC LIMIT 500`)
    ).rows;
    res.json({ enabled: !!cfg.cw?.enabled, partners });
  });
  app.get('/api/staff/cw/:partner', requireStaff, async (req, res) => {
    business(req);
    const pid = id(req.params.partner),
      p = (await pool.query('SELECT * FROM cw_partners WHERE id=$1', [pid])).rows[0];
    if (!p) throw new HttpError(404, 'CW 不存在');
    const codes = (
      await pool.query(
        'SELECT k.id,k.code,k.name,k.status,k.customer_price_percent,k.starts_at,k.ends_at,coalesce(sum(c.cash_fen),0)::text AS paid_fen,coalesce(sum(c.used_cash_fen),0)::text AS used_fen,coalesce(sum(c.expected_fen),0)::text AS expected_fen,coalesce(sum(c.unlocked_fen),0)::text AS unlocked_fen FROM cw_codes k LEFT JOIN cw_commissions c ON c.code_id=k.id WHERE k.partner_id=$1 GROUP BY k.id ORDER BY k.created_at',
        [pid],
      )
    ).rows;
    const contracts = (
      await pool.query(
        'SELECT id,template_version,document_sha256,expires_at,verified_at,verified_by FROM cw_contracts WHERE partner_id=$1 ORDER BY verified_at DESC',
        [pid],
      )
    ).rows;
    const orders = (
      await pool.query(
        `SELECT c.public_reference,c.cash_fen::text,c.used_cash_fen::text,c.expected_fen::text,c.unlocked_fen::text,k.code,o.out_trade_no,o.paid_at,o.account_id,o.channel_fee_issue,
    u.email AS customer_email FROM cw_commissions c JOIN cw_codes k ON k.id=c.code_id JOIN payment_orders o ON o.id=c.order_id JOIN "user" u ON u.id=o.created_by WHERE c.partner_id=$1 ORDER BY c.created_at DESC LIMIT 200`,
        [pid],
      )
    ).rows;
    const payouts = (
      await pool.query(
        'SELECT id,status,gross_fen::text,withholding_fen::text,bank_last4,created_at,paid_at,reviewed_by,payment_reference FROM cw_payouts WHERE partner_id=$1 ORDER BY created_at DESC LIMIT 100',
        [pid],
      )
    ).rows;
    const events = (
      await pool.query(
        `SELECT e.kind,e.occurred_at,e.cash_fen::text,e.commission_fen::text,k.code,o.out_trade_no FROM cw_commission_events e JOIN cw_commissions c ON c.order_id=e.order_id JOIN cw_codes k ON k.id=c.code_id JOIN payment_orders o ON o.id=c.order_id WHERE c.partner_id=$1 ORDER BY e.occurred_at DESC,e.id DESC LIMIT 200`,
        [pid],
      )
    ).rows;
    const closes = (
      await pool.query(
        `SELECT x.account_id,x.month,x.closed_at,x.closed_by,x.evidence FROM cw_customer_closes x WHERE EXISTS(SELECT 1 FROM payment_orders o JOIN cw_commissions c ON c.order_id=o.id WHERE o.account_id=x.account_id AND c.partner_id=$1) ORDER BY x.month DESC LIMIT 100`,
        [pid],
      )
    ).rows;
    res.json({
      partner: publicPartner(p),
      codes,
      contracts,
      orders,
      events,
      payouts,
      closes,
      available_fen: await available(pool, pid),
    });
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
      if (!p) throw new HttpError(404, 'CW 不存在');
      await db.query(
        'INSERT INTO cw_contracts(partner_id,template_version,document_sha256,signature_reference,identity_reference,expires_at,verified_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [pid, version, sha, reference, identity, expires, req.staff.subject],
      );
      await db.query("UPDATE cw_partners SET status='active' WHERE id=$1", [pid]);
      await audit(db, req.actor, 'cw.contract_verified', null, pid, { version, document_sha256: sha });
    });
    res.json({ ok: true });
  });
  app.post('/api/staff/cw/:partner/status', requireStaff, async (req, res) => {
    admin(req);
    const state = req.body?.status;
    if (!['suspended', 'rejected'].includes(state))
      throw new HttpError(400, '仅可暂停或拒绝，启用须核验合同');
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
        const percent = integer(b.customer_price_percent, 1, 100, '价格比例'),
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
          'UPDATE cw_codes SET status=$2,customer_price_percent=$3,starts_at=$4,ends_at=$5,approved_by=$6 WHERE id=$1',
          [cid, state, percent, start, end, req.staff.subject],
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
    requireFinance(req);
    const pid = id(req.params.partner),
      p = (await pool.query('SELECT * FROM cw_partners WHERE id=$1', [pid])).rows[0];
    if (!p) throw new HttpError(404, 'CW 不存在');
    await audit(pool, req.actor, 'cw.private_viewed', null, pid, {
      reason: text(req.body.reason, '查看原因', 200),
    });
    res.json({
      contact: box.open(p.contact_cipher),
      bank: p.bank_cipher ? box.open(p.bank_cipher) : null,
      bank_version: p.bank_version,
    });
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
