import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.mjs';
import { config, transaction, HttpError } from '../src/core.mjs';
import { migrate } from '../src/migrate.mjs';
import { businessConsoleRoutes } from '../src/business-console.mjs';
import { cwRoutes } from '../src/cw-partners.mjs';
import { mailService } from '../src/mail.mjs';
import { queueNextVipNotice } from '../src/vip-notifications.mjs';
import { quotePack, settlePaidCall } from '../src/pack-ledger.mjs';
import { creditPaidOrder, paymentRoutes } from '../src/payments.mjs';
import { refundCW, commissionFen } from '../src/cw-ledger.mjs';
const url = process.env.TEST_CW_DATABASE_URL;
let pool, server, origin, cfg;
const ids = { notify: randomUUID(), a: randomUUID(), b: randomUUID(), buyer: randomUUID(), candidate: randomUUID(), lead: randomUUID(), legacy: randomUUID(), triage: randomUUID(), triageOther: randomUUID(), exception: randomUUID(), exceptionOther: randomUUID(), exceptionLegacy: randomUUID(), trialVip: randomUUID(), trialOther: randomUUID(), trialPending: randomUUID() };
const notifications = [], paymentNotices = [];
const mockWechatTrades = new Map();
let failPaymentNotice = false;
const skip = !url;
before(async () => {
  if (skip) return;
  assert.match(new URL(url).pathname, /_test$/, 'CW integration tests require a dedicated *_test database');
  pool = new pg.Pool({ connectionString: url });
  cfg = config({
    APP_ORIGIN: 'http://127.0.0.1:4180',
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: 'cw-local-integration-secret-not-production-12345',
    CW_ENABLED: 'true',
    CW_PAYMENT_NOTICE_EMAIL: 'admin@cw.example.test',
  });
  const service = createApp(pool, cfg, { sendMail: async () => ({}), verify: async () => true });
  await migrate(pool, service.auth);
  await pool.query('TRUNCATE "user",staff_members CASCADE');
  for (const [name, id] of Object.entries(ids))
    await pool.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled,"phoneOnly") VALUES($1,$2,$3,true,now(),now(),false,false)',
      [id, name, name + '@cw.example.test'],
    );
  await pool.query(
    "INSERT INTO staff_members(subject,email,name,role,status) VALUES('cw-test-admin','admin@cw.example.test','CW test admin','platform_admin','active')",
  );
  await pool.query(`INSERT INTO staff_members(subject,email,name,role,status) VALUES
    ('cw-sales-a','sales-a@cw.example.test','Sales A','operations','active'),
    ('cw-sales-b','sales-b@cw.example.test','Sales B','operations','active'),
    ('cw-finance','finance@cw.example.test','Finance','finance','active'),
    ('cw-former','former@cw.example.test','Former sales','operations','suspended')`);
  const app = express();
  app.use(express.json());
  const customer = (req, _res, next) => {
    const uid = ids[req.headers['x-test-user']];
    if (!uid) throw new HttpError(401, 'login');
    req.customer = { id: uid, email: req.headers['x-test-user'] + '@cw.example.test' };
    req.actor = { kind: 'customer', id: uid };
    next();
  };
  const staff = (req, _res, next) => {
    if (!req.headers['x-test-role']) throw new HttpError(401, 'staff');
    req.staff = {
      subject: req.headers['x-test-subject'] || 'cw-test-admin',
      status: 'active',
      role: req.headers['x-test-role'],
      finance_access: ['platform_admin', 'finance'].includes(req.headers['x-test-role']),
    };
    req.actor = { kind: 'staff', id: req.staff.subject };
    next();
  };
  businessConsoleRoutes(app,pool,staff,cfg);
  cwRoutes(app, pool, customer, staff, cfg, {
    ready: true,
    queue: async (message, db) => {
      assert.notEqual(db, pool, 'enqueue through the application transaction');
      notifications.push(message);
    },
  });
  paymentRoutes(app, pool, customer, cfg, {
    wechat: {
      mchId: 'test-merchant', appId: 'test-app',
      native: async () => ({ status: 200, data: { code_url: 'weixin://local-test-only' } }),
      query: async (number) => ({ status: 200, data: {
        out_trade_no: number, mchid: 'test-merchant', appid: 'test-app',
        ...(mockWechatTrades.has(number) ? { trade_state: 'SUCCESS', transaction_id: 'test-' + number,
          amount: { total: mockWechatTrades.get(number) } } : { trade_state: 'NOTPAY' }),
      } }),
    },
    mail: { ready: true, queue: async (message, db) => {
      assert.notEqual(db, pool);
      if (failPaymentNotice) throw Error('temporary mail queue failure');
      paymentNotices.push(message);
    } },
  });
  app.use((e, _req, res, _next) => res.status(e.status || 500).json({ error: e.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  server?.close();
  await pool?.end();
});
async function call(path, body, user = 'a', role = null, subject = 'cw-test-admin') {
  const r = await fetch(origin + path, {
    headers: {
      'x-test-user': user,
      ...(role ? { 'x-test-role': role, 'x-test-subject': subject } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  while(await queueNextVipNotice(pool,cfg,{ready:true,queue:async message=>notifications.push(message)}));
  return { status: r.status, data: await r.json() };
}
const staff = (path, b, role = 'platform_admin', subject) => call('/api/staff/cw' + path, b, 'a', role, subject);
test('CW commission uses cumulative cash precision (percent - 40) * 100', () => {
  assert.equal(commissionFen('10000', 50), 1000n);
  assert.equal(commissionFen('9', 50), 0n);
  assert.equal(commissionFen('10', 50), 1n);
  assert.equal(commissionFen('10000', 40), 0n);
  assert.equal(commissionFen('10000', 80), 4000n);
});
test('CW application, code cap, payment, usage, month close and payout lifecycle', { skip }, async (t) => {
  let a, b, offer, order, account, pack;
  await t.test('application idempotency, no employee access, invitation alone earns nothing', async () => {
    assert.equal((await staff('/invite-codes', { code: 'LEGACYTEST', max_uses: 2 })).status, 201);
    const first = await call('/api/cw/apply', {
      invite_code: 'LEGACYTEST',
      legal_name: 'Test A',
      contact: 'a@cw.example.test',
      consent_version: 'cw-privacy-v1',
    });
    assert.equal(first.status, 201);
    a = first.data.partner;
    assert.equal(
      (
        await call('/api/cw/apply', {
          legal_name: 'Test A',
          contact: 'another',
          consent_version: 'cw-privacy-v1',
        })
      ).data.partner.id,
      a.id,
    );
    assert.equal((await call('/api/staff/cw')).status, 401);
    const contract = {
      template_version: 'test-only',
      document_sha256: 'a'.repeat(64),
      signature_reference: 'TEST ONLY signature',
      identity_reference: 'TEST ONLY identity',
      expires_at: '2099-01-01',
      verified: true,
    };
    assert.equal((await staff('/' + a.id + '/contract', contract)).status, 200);
    // Seed existing signed partners for the legacy commission and payout lifecycle.
    await pool.query("UPDATE cw_partners SET status='active' WHERE id=$1", [a.id]);
    const r = await call(
      '/api/cw/apply',
      {
        legal_name: 'Test B',
        contact: 'b@cw.example.test',
        invite: a.public_code,
        invite_code: 'LEGACYTEST',
        consent_version: 'cw-privacy-v1',
      },
      'b',
    );
    assert.equal(r.status, 201);
    b = r.data.partner;
    assert.equal((await staff('/' + b.id + '/contract', contract)).status, 200);
    await pool.query("UPDATE cw_partners SET status='active' WHERE id=$1", [b.id]);
    assert.equal((await call('/api/cw/me')).data.totals.expected_fen, '0');
  });
  await t.test('concurrent code creation never exceeds 50 and code ownership is private', async () => {
    const results = await Promise.all(
      Array.from({ length: 54 }, (_, i) =>
        call('/api/cw/codes', { name: 'campaign ' + i, customer_price_percent: 50 }, 'b'),
      ),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 50);
    assert.equal(results.filter((r) => r.status === 409).length, 4);
    offer = results.find((r) => r.status === 201).data;
    assert.equal((await call('/api/cw/me')).data.codes.length, 0);
    assert.equal((await call('/api/cw/me', null, 'b')).data.codes.length, 50);
    assert.equal(
      (
        await staff(
          '/codes/' + offer.id + '/review',
          { status: 'active', customer_price_percent: 50, starts_at: '2020-01-01', ends_at: '2099-01-01' },
          'operations',
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await staff('/codes/' + offer.id + '/review', {
          status: 'active',
          customer_price_percent: 50,
          starts_at: '2020-01-01',
          ends_at: '2099-01-01',
        })
      ).status,
      200,
    );
  });
  await t.test('100 cash buys 200 list credit; signed payment credits commission once', async () => {
    account = (await pool.query('INSERT INTO billing_accounts(owner_id) VALUES($1) RETURNING *', [ids.buyer]))
      .rows[0];
    await assert.rejects(
      () =>
        transaction(pool, (db) =>
          quotePack(db, account, 10000, offer.code, { cashFen: 10000, buyerId: ids.buyer }),
        ),
      /尚未开放/,
    );
    const q = await transaction(pool, (db) =>
      quotePack(db, account, 10000, offer.code, { cashFen: 10000, buyerId: ids.buyer, cwEnabled: true }),
    );
    assert.equal(q.face_fen, 20000);
    assert.equal(q.amount_fen, 10000);
    await assert.rejects(
      () =>
        transaction(pool, (db) =>
          quotePack(db, account, 10000, offer.code, { cashFen: 10000, buyerId: ids.b, cwEnabled: true }),
        ),
      /自己的推广码/,
    );
    order = (
      await pool.query(
        "INSERT INTO payment_orders(out_trade_no,account_id,created_by,provider,amount_fen,face_fen,discount_snapshot,idempotency_key,expires_at) VALUES($1,$2,$3,'wechat_native',$4,$5,$6,$7,now()+interval '15 minutes') RETURNING *",
        [
          'CWTEST' + Date.now(),
          account.id,
          ids.buyer,
          q.amount_fen,
          q.face_fen,
          q.discount_snapshot,
          randomUUID(),
        ],
      )
    ).rows[0];
    await staff('/codes/' + offer.id + '/review', {
      status: 'active',
      customer_price_percent: 80,
      starts_at: '2020-01-01',
      ends_at: '2099-01-01',
    });
    const paid = { provider: 'wechat_native', tradeNo: 'test-trade', totalFen: 10000 };
    await creditPaidOrder(pool, order.out_trade_no, paid, 'cw-test');
    await creditPaidOrder(pool, order.out_trade_no, paid, 'cw-test');
    pack = (await pool.query('SELECT * FROM credit_packs WHERE source_id=$1', [order.id])).rows[0];
    const p = (await call('/api/cw/me', null, 'b')).data;
    assert.equal(p.totals.expected_fen, '1000');
    assert.equal(p.totals.paid_fen, '10000');
    assert.equal(p.codes.find(k=>k.id===offer.id).paid_fen, '10000');
    assert.equal(p.codes.find(k=>k.id===offer.id).expected_fen, '1000');
    assert.equal(p.totals.refunded_fen, '0');
    for(const key of Object.keys(p.totals)) assert.equal(p.codes.reduce((sum,k)=>sum+BigInt(k[key]),0n).toString(),p.totals[key]);
    assert.equal(
      Number(pack.face_fen),
      20000,
      'existing order retains quoted offer after code price changes',
    );
    assert.equal(p.totals.unlocked_fen, '0');
    assert.equal(p.totals.available_fen, '0');
    assert.equal((await call('/api/cw/me')).data.totals.expected_fen, '0');
    assert.equal(
      (await pool.query('SELECT count(*) FROM cw_commission_events WHERE order_id=$1', [order.id])).rows[0]
        .count,
      '1',
    );
  });
  await t.test(
    'cash checkout requires confirmed credit and rejects stale terms including idempotent retries',
    async () => {
      const body = {
        cash_fen: 10000,
        promo_code: offer.code,
        idempotency_key: randomUUID(),
        expected_cash_fen: 10000,
      };
      assert.equal((await call('/api/billing/personal/wechat-orders', body, 'buyer')).status, 400);
      assert.equal(
        (await call('/api/billing/personal/wechat-orders', { ...body, expected_face_fen: 20000 }, 'buyer'))
          .status,
        409,
      );
      const created = await call(
        '/api/billing/personal/wechat-orders',
        { ...body, expected_face_fen: 12500 },
        'buyer',
      );
      assert.equal(created.status, 201);
      assert.equal(
        (await call('/api/billing/personal/wechat-orders', { ...body, expected_face_fen: 12500 }, 'buyer'))
          .data.order.id,
        created.data.order.id,
      );
      assert.equal(
        (await call('/api/billing/personal/wechat-orders', { ...body, expected_face_fen: 20000 }, 'buyer'))
          .status,
        409,
      );
    },
  );
  await t.test(
    'actual cash use unlocks 10%, repeat settlement does not pay twice; refunds cancel unused only',
    async () => {
      const key = (
        await pool.query(
          "INSERT INTO customer_api_keys(account_id,owner_id,label,secret_hash,key_hint,model_ids,limit_yuan) VALUES($1,$2,'test','testhash','test',ARRAY['deepseek-flash'],1000) RETURNING id",
          [account.id, ids.buyer],
        )
      ).rows[0].id;
      const c = (
        await pool.query(
          "INSERT INTO customer_calls(account_id,key_id,owner_id,model_id,price_snapshot,status,hold_yuan) VALUES($1,$2,$3,'deepseek-flash','{}','pending',40) RETURNING id",
          [account.id, key, ids.buyer],
        )
      ).rows[0].id;
      await pool.query("UPDATE customer_calls SET created_at='2025-01-15T08:30:00+08:00' WHERE id=$1", [c]);
      await settlePaidCall(pool, c, 40, null, 'test', null, null);
      await settlePaidCall(pool, c, 40, null, 'test', null, null);
      let p = (await call('/api/cw/me', null, 'b')).data;
      assert.equal(p.totals.used_fen, '4000');
      assert.equal(p.totals.unlocked_fen, '400');
      assert.equal(p.totals.available_fen, '0');
      const ref = { id: randomUUID(), order_id: order.id, gross_fen: '6000', amount_fen: '6000' };
      await transaction(pool, (db) => refundCW(db, ref));
      await transaction(pool, (db) => refundCW(db, ref));
      p = (await call('/api/cw/me', null, 'b')).data;
      assert.equal(p.totals.expected_fen, '400');
      assert.equal(p.totals.paid_fen, '10000', 'refund does not rewrite cumulative actual payment');
      assert.equal(p.totals.refunded_fen, '6000', 'duplicate refund is counted once');
      assert.equal(p.codes.find(k=>k.id===offer.id).refunded_fen, '6000');
      assert.equal(p.totals.unlocked_fen, '400');
      const events = await call('/api/cw/events', null, 'b');
      assert.equal(events.data.events.length, 3);
      assert.equal(
        new Date(events.data.events.find((e) => e.kind === 'used').occurred_at).toISOString(),
        '2025-01-15T00:30:00.000Z',
        'cross-month billing retains usage time',
      );
      assert.ok(!JSON.stringify(events.data).includes('buyer@'));
      assert.ok(!JSON.stringify(events.data).includes(order.out_trade_no));
      assert.ok(!JSON.stringify(events.data).includes(account.id));
      assert.equal((await call('/api/cw/events?code_id=' + offer.id)).data.events.length, 0);
    },
  );
  await t.test(
    'month end and customer settlement both required; bank fields encrypted and versioned',
    async () => {
      const m = (await pool.query("SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai','YYYY-MM') AS m"))
        .rows[0].m;
      assert.equal(
        (await staff('/customer-closes', { account_id: account.id, month: m, evidence: 'test' })).status,
        409,
      );
      await pool.query(
        "UPDATE cw_commission_events SET occurred_at='2025-01-15T00:00:00Z' WHERE order_id=$1 AND kind='used'",
        [order.id],
      );
      assert.equal(
        (await staff('/customer-closes', { account_id: account.id, month: '2025-01', evidence: 'test' }))
          .status,
        409,
      );
      await pool.query(
        "UPDATE payment_orders SET channel_fee_source='wechat_bill',channel_fee_fen=0 WHERE id=$1",
        [order.id],
      );
      assert.equal(
        (
          await staff('/customer-closes', {
            account_id: account.id,
            month: '2025-01',
            evidence: 'TEST ONLY customer statement',
          })
        ).status,
        200,
      );
      assert.equal((await call('/api/cw/me', null, 'b')).data.totals.available_fen, '400');
      assert.equal((await call('/api/cw/payouts', { request_key: randomUUID() }, 'b')).status, 409);
      assert.equal(
        (
          await call(
            '/api/cw/bank',
            { holder: 'Wrong', bank: 'Test', number: '1111222233334444', consent_version: 'cw-bank-v1' },
            'b',
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            '/api/cw/bank',
            { holder: 'Test B', bank: 'Test', number: '1111222233334444', consent_version: 'cw-bank-v1' },
            'b',
          )
        ).status,
        200,
      );
      const raw = (await pool.query('SELECT bank_cipher FROM cw_partners WHERE id=$1', [b.id])).rows[0]
        .bank_cipher;
      assert.ok(!raw.includes('11112222'));
      const opsPrivate = await staff('/' + b.id + '/private', { reason: 'interview' }, 'operations');
      assert.equal(opsPrivate.status, 200);
      assert.ok(opsPrivate.data.contact?.contact);
      assert.equal(opsPrivate.data.bank, null);
      const financePrivate = await staff('/' + b.id + '/private', { reason: 'payout review' });
      assert.equal(financePrivate.status, 200);
      assert.ok(financePrivate.data.bank?.number);
      const bankOnly = await staff('/' + b.id + '/private', { reason: 'payout review', scope: 'bank' });
      assert.equal(bankOnly.status, 200);
      assert.equal(bankOnly.data.contact, undefined);
      assert.equal(bankOnly.data.bank.number, '1111222233334444');
      assert.equal(
        (await staff('/' + b.id + '/bank-verify', { bank_version: 2, evidence: 'stale' })).status,
        409,
      );
      assert.equal(
        (await staff('/' + b.id + '/bank-verify', { bank_version: 1, evidence: 'TEST ONLY matched account' }))
          .status,
        200,
      );
    },
  );
  await t.test(
    'concurrent withdrawals reserve once, retries are idempotent, final failure releases with history',
    async () => {
      const keys = [randomUUID(), randomUUID()],
        results = await Promise.all(keys.map((request_key) => call('/api/cw/payouts', { request_key }, 'b')));
      assert.equal(results.filter((r) => r.status === 201).length, 1);
      assert.equal(results.filter((r) => r.status === 409).length, 1);
      const i = results.findIndex((r) => r.status === 201),
        r = results[i].data;
      assert.equal((await call('/api/cw/payouts', { request_key: keys[i] }, 'b')).data.id, r.id);
      const pending = (await call('/api/cw/me', null, 'b')).data;
      assert.equal(pending.totals.payout_pending_fen, '400');
      assert.equal(pending.totals.paid_out_fen, '0');
      assert.equal(pending.totals.available_fen, '0');
      assert.equal(pending.codes.find(k=>k.id===offer.id).payout_pending_fen, '400');
      assert.equal(
        (
          await call(
            '/api/cw/bank',
            { holder: 'Test B', bank: 'Test', number: '1111222233335555', consent_version: 'cw-bank-v1' },
            'b',
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await staff('/payouts/' + r.id + '/review', {
            status: 'approved',
            withholding_fen: 40,
            evidence: 'TEST ONLY tax review',
          })
        ).status,
        200,
      );
      assert.equal(
        (await staff('/payouts/' + r.id + '/payment-details', { reason: 'test' })).data.net_fen,
        '360',
      );
      assert.equal(
        (
          await staff('/payouts/' + r.id + '/complete', {
            status: 'failed',
            payment_reference: 'test-failed',
            evidence: 'TEST ONLY bank final failure',
            bank_result_verified: true,
          })
        ).status,
        200,
      );
      assert.equal((await call('/api/cw/me', null, 'b')).data.totals.available_fen, '400');
      assert.equal((await call('/api/cw/me', null, 'b')).data.totals.payout_pending_fen, '0');
      assert.equal(
        (
          await pool.query(
            'SELECT count(*) FROM cw_payout_items WHERE payout_id=$1 AND released_at IS NOT NULL',
            [r.id],
          )
        ).rows[0].count,
        '1',
      );
    },
  );
  await t.test(
    'confirmed successful payout stays reserved and cannot be confirmed or withdrawn again',
    async () => {
      const payout = (await call('/api/cw/payouts', { request_key: randomUUID() }, 'b')).data;
      assert.equal(
        (
          await staff('/payouts/' + payout.id + '/review', {
            status: 'approved',
            withholding_fen: 40,
            evidence: 'TEST ONLY tax review',
          })
        ).status,
        200,
      );
      const done = {
        status: 'paid',
        payment_reference: 'test-paid-unique',
        evidence: 'TEST ONLY bank receipt',
        bank_result_verified: true,
      };
      assert.equal((await staff('/payouts/' + payout.id + '/complete', done)).status, 200);
      assert.equal((await staff('/payouts/' + payout.id + '/complete', done)).status, 409);
      assert.equal((await call('/api/cw/me', null, 'b')).data.totals.available_fen, '0');
      const settled = (await call('/api/cw/me', null, 'b')).data;
      assert.equal(settled.totals.payout_pending_fen, '0');
      assert.equal(settled.totals.paid_out_fen, '400', 'commission bar uses gross, not net after withholding');
      assert.equal(settled.codes.find(k=>k.id===offer.id).paid_out_fen, '400');
      for(const key of Object.keys(settled.totals)) assert.equal(settled.codes.reduce((sum,k)=>sum+BigInt(k[key]),0n).toString(),settled.totals[key]);
      assert.equal((await call('/api/cw/payouts', { request_key: randomUUID() }, 'b')).status, 409);
    },
  );
});
test('sales activates formal VIP after verifying discount recharge ≥ ¥100', { skip }, async () => {
  assert.equal(
    (await staff('/invite-codes', { code: 'OPSINVITE1', max_uses: 5 }, 'operations')).status,
    201,
  );
  assert.equal(
    (await staff('/invite-codes', { code: 'PENDINVITE', max_uses: 1 }, 'pending')).status,
    403,
  );
  const applied = await call(
    '/api/cw/apply',
    {
      legal_name: 'Ops Candidate',
      contact: '13800000000',
      consent_version: 'cw-privacy-v1',
      invite_code: 'OPSINVITE1',
    },
    'candidate',
  );
  assert.equal(applied.status, 201);
  assert.equal(applied.data.partner.status, 'pending');
  const pid = applied.data.partner.id;
  const profile = await call('/api/cw/me', null, 'candidate');
  assert.equal(profile.data.partner.legal_name, 'Ops Candidate');
  assert.ok(profile.data.partner.created_at);
  assert.doesNotMatch(JSON.stringify(profile.data), /13800000000/);
  const path = '/' + pid + '/private';
  const request = { reason: '电话面试', scope: 'contact' };
  assert.equal((await call('/api/staff/cw' + path, request, 'candidate')).status, 401);
  assert.equal((await staff(path, request, 'pending')).status, 403);
  for (const role of ['operations', 'platform_admin']) {
    const contact = await staff(path, request, role);
    assert.equal(contact.status, 200);
    assert.equal(contact.data.contact.contact, '13800000000');
    assert.equal(contact.data.bank, null);
    assert.equal(contact.data.bank_version, undefined);
  }
  assert.equal((await staff(path, { ...request, scope: 'bank' }, 'operations')).status, 403);
  assert.equal((await staff('/' + pid + '/confirm', {}, 'pending')).status, 403);
  assert.equal((await staff('/' + pid + '/confirm', {}, 'operations')).status, 200);
  assert.equal(
    (await pool.query('SELECT status FROM cw_partners WHERE id=$1', [pid])).rows[0].status,
    'confirmed',
  );
  assert.equal((await staff('/' + pid + '/activate', {}, 'operations')).status, 409);
  const issued = await staff(
    '/' + pid + '/task-code',
    { code: 'OPSDISC50', customer_price_percent: 50 },
    'operations',
  );
  assert.equal(issued.status, 201);
  const account = (
    await pool.query('INSERT INTO billing_accounts(owner_id) VALUES($1) RETURNING *', [ids.candidate])
  ).rows[0];
  // Below ¥100: payment succeeds but sales still cannot activate.
  const low = await transaction(pool, (db) =>
    quotePack(db, account, 10000, 'OPSDISC50', { cashFen: 5000, buyerId: ids.candidate, cwEnabled: true }),
  );
  const lowOrder = (
    await pool.query(
      "INSERT INTO payment_orders(out_trade_no,account_id,created_by,provider,amount_fen,face_fen,discount_snapshot,idempotency_key,expires_at) VALUES($1,$2,$3,'wechat_native',$4,$5,$6,$7,now()+interval '15 minutes') RETURNING *",
      ['VIPLOW' + Date.now(), account.id, ids.candidate, low.amount_fen, low.face_fen, low.discount_snapshot, randomUUID()],
    )
  ).rows[0];
  await creditPaidOrder(
    pool,
    lowOrder.out_trade_no,
    { provider: 'wechat_native', tradeNo: 'vip-low-trade', totalFen: low.amount_fen },
    'cw-vip-low',
  );
  assert.equal(
    (await pool.query('SELECT status FROM cw_partners WHERE id=$1', [pid])).rows[0].status,
    'confirmed',
  );
  assert.equal((await staff('/' + pid + '/activate', {}, 'operations')).status, 409);
  // ≥ ¥100 discount recharge: sales can activate.
  const q = await transaction(pool, (db) =>
    quotePack(db, account, 20000, 'OPSDISC50', { cashFen: 10000, buyerId: ids.candidate, cwEnabled: true }),
  );
  assert.equal(q.amount_fen, 10000);
  const order = (
    await pool.query(
      "INSERT INTO payment_orders(out_trade_no,account_id,created_by,provider,amount_fen,face_fen,discount_snapshot,idempotency_key,expires_at) VALUES($1,$2,$3,'wechat_native',$4,$5,$6,$7,now()+interval '15 minutes') RETURNING *",
      ['VIPACT' + Date.now(), account.id, ids.candidate, q.amount_fen, q.face_fen, q.discount_snapshot, randomUUID()],
    )
  ).rows[0];
  await creditPaidOrder(
    pool,
    order.out_trade_no,
    { provider: 'wechat_native', tradeNo: 'vip-act-trade', totalFen: q.amount_fen },
    'cw-vip-pay',
  );
  assert.equal(
    (await pool.query('SELECT status FROM cw_partners WHERE id=$1', [pid])).rows[0].status,
    'confirmed',
    'payment alone must not activate VIP',
  );
  assert.equal((await staff('/' + pid + '/activate', {}, 'operations')).status, 200);
  const row = (await pool.query('SELECT status,activated_at FROM cw_partners WHERE id=$1', [pid])).rows[0];
  assert.equal(row.status, 'active');
  assert.ok(row.activated_at);
});

test('VIP invitation ownership, scoped leads, manager notifications and reassignment', { skip }, async () => {
  const sales = (subject, path, body) => staff(path, body, 'operations', 'cw-sales-' + subject);
  const a = (path, body) => sales('a', path, body);
  const b = (path, body) => sales('b', path, body);
  assert.equal((await a('/invite-codes', { code: 'SALESA' })).status, 201);
  assert.equal((await b('/invite-codes', { code: 'SALESB' })).status, 201);
  assert.equal((await b('/invite-codes/SALESA/status', { status: 'disabled' })).status, 404);

  const beforeMail = notifications.length;
  const application = {
    legal_name: 'Follow-up fixture', contact: '13800000012', invite_code: 'SALESA', consent_version: 'cw-privacy-v1',
  };
  const applied = await call('/api/cw/apply', application, 'lead');
  assert.equal(applied.status, 201, JSON.stringify(applied.data));
  const partner = '/' + applied.data.partner.id;
  assert.equal((await call('/api/cw/apply', application, 'lead')).status, 201);
  const allMail = notifications.slice(beforeMail);
  assert.ok(allMail.some(m=>m.to==='lead@cw.example.test' && m.text.includes('申请已提交')));
  const mail = allMail.filter(m=>m.to!=='lead@cw.example.test');
  assert.deepEqual(mail.map(m => m.to).sort(), ['admin@cw.example.test', 'sales-a@cw.example.test']);
  const administrator = mail.find(m => m.to.startsWith('admin@'));
  assert.match(administrator.text, /13800000012/);
  assert.match(administrator.text, /lead@cw\.example\.test/);
  assert.match(administrator.text, /北京时间/);
  for (const item of mail) {
    assert.ok(item.text.includes('?staff=1&partner=' + applied.data.partner.id));
    assert.ok(item.text.includes('SALESA'));
  }
  const ownerMail = mail.find(m => m.to.startsWith('sales-a@'));
  assert.doesNotMatch(ownerMail.text, /13800000012|lead@cw.example.test/);

  assert.deepEqual((await a('')).data.partners.map(p => p.id), [applied.data.partner.id]);
  assert.deepEqual((await b('')).data.partners, []);
  assert.deepEqual((await b('')).data.invite_codes.map(i => i.code), ['SALESB']);
  assert.equal((await staff('')).data.partners.find(p => p.id === applied.data.partner.id).invite_code, 'SALESA');
  assert.equal((await b(partner)).status, 404);
  assert.equal((await staff(partner, null, 'finance', 'cw-finance')).status, 404);
  const contact = { reason: '电话面试', scope: 'contact' };
  assert.equal((await b(partner + '/private', contact)).status, 404);
  assert.equal((await a(partner + '/private', contact)).data.contact.contact, '13800000012');

  const followup = { body: '已预约电话面试', next_contact_on: '2026-12-04' };
  assert.equal((await a(partner + '/followups', { ...followup, next_contact_on: '2026-02-31' })).status, 400);
  assert.equal((await a(partner + '/followups', followup)).status, 201);
  assert.equal((await b(partner + '/followups', followup)).status, 404);
  const details = (await a(partner)).data;
  assert.equal(details.partner.next_contact_on, '2026-12-04');
  assert.equal(details.followups[0].author_name, 'Sales A');
  assert.equal(details.followups[0].body, followup.body);
  assert.deepEqual(details.payouts, []);
  assert.equal((await b(partner + '/confirm', {})).status, 404);
  assert.equal((await b(partner + '/task-code', {})).status, 404);
  assert.equal((await b(partner + '/activate', {})).status, 404);
  assert.equal((await a(partner + '/owner', { owner_subject: 'cw-sales-b' })).status, 403);
  assert.equal((await staff(partner + '/owner', { owner_subject: 'cw-former' })).status, 400);

  const migration = await readFile(new URL('../migrations/083_vip_sales_followup.sql', import.meta.url), 'utf8');
  await pool.query('UPDATE cw_partners SET owner_subject=NULL,invite_code_id=NULL WHERE id=$1', [applied.data.partner.id]);
  await pool.query(migration);
  assert.equal((await a(partner)).data.partner.owner_subject, 'cw-sales-a');
  assert.equal((await staff(partner + '/owner', { owner_subject: 'cw-sales-b' })).status, 200);
  await pool.query(migration);
  assert.equal((await a(partner)).status, 404);
  assert.equal((await a(partner + '/private', contact)).status, 404);
  const reassigned = (await b(partner)).data;
  assert.equal(reassigned.partner.owner_subject, 'cw-sales-b');
  assert.equal(reassigned.partner.invite_code, 'SALESA');
  assert.equal(reassigned.followups[0].body, followup.body);
  assert.equal((await b(partner + '/followups', { body: '面试已完成' })).status, 201);
  assert.equal((await b(partner)).data.partner.next_contact_on, null);
  assert.equal((await b(partner + '/confirm', {})).status, 200);
  const second = await call('/api/cw/apply', { ...application, invite_code: 'SALESB' }, 'legacy');
  assert.equal(second.status, 201);
  const other = '/' + second.data.partner.id;
  assert.equal((await b(other + '/confirm', {})).status, 200);
  assert.equal((await b(other + '/task-code', { code: 'LEADSALE50' })).status, 201);
  assert.equal((await b(partner + '/task-code', { code: 'LEADSALE50' })).status, 409);
  const issued = await Promise.all([b(partner + '/task-code', {}), b(partner + '/task-code', {})]);
  assert.equal(issued[0].status, 201);
  assert.equal(issued[1].data.code, issued[0].data.code);
  assert.equal(issued[0].data.customer_price_percent, 50);
  const original = issued[0].data.code;
  assert.equal((await b(partner + '/task-code', { customer_price_percent: 40 })).status, 403);
  assert.equal((await staff(partner + '/task-code', { customer_price_percent: 40 })).status, 403);
  assert.equal((await call('/api/cw/me', null, 'lead')).data.task_codes[0].code, original);
  const proposal = { customer_price_percent: 40, reason: '具备长期采购需求' };
  const firstRequest = await b(partner + '/discount-requests', proposal);
  assert.equal(firstRequest.status, 201);
  assert.equal((await b(partner + '/discount-requests', proposal)).status, 409);
  assert.equal((await staff('')).data.partners.find(p => p.id === applied.data.partner.id).discount_pending, true);
  const firstDecision = partner + '/discount-requests/' + firstRequest.data.id + '/decision';
  assert.equal((await b(firstDecision, { status: 'approved' })).status, 403);
  assert.equal((await staff(firstDecision, { status: 'approved' }, 'finance', 'cw-finance')).status, 403);
  assert.equal((await staff(firstDecision, { status: 'rejected' })).status, 400);
  assert.equal((await staff(firstDecision, { status: 'rejected', decision_note: '请补充预计用量' })).status, 200);
  assert.equal((await call('/api/cw/me', null, 'lead')).data.task_codes[0].code, original);

  const nextRequest = await b(partner + '/discount-requests', { ...proposal, reason: '已补充预计用量' });
  const decision = partner + '/discount-requests/' + nextRequest.data.id + '/decision';
  const approved = await staff(decision, { status: 'approved' });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const discounted = approved.data.payment_code;
  assert.equal(discounted.customer_price_percent, 40);
  assert.notEqual(discounted.code, original);
  assert.equal((await staff(decision, { status: 'approved' })).status, 409);
  assert.equal((await b(partner + '/task-code', {})).data.code, discounted.code);
  assert.equal((await call('/api/cw/offers/' + original, null, 'lead')).status, 404);
  assert.deepEqual((await call('/api/cw/me', null, 'lead')).data.task_codes.map(k => k.code), [discounted.code]);
  const quote = await transaction(pool, db =>
    quotePack(db, { owner_id: ids.lead }, 10000, discounted.code, { cashFen: 10000, buyerId: ids.lead, cwEnabled: true }),
  );
  assert.equal(quote.amount_fen, 10000);
  assert.equal(quote.face_fen, 25000);
  await assert.rejects(transaction(pool, db =>
    quotePack(db, { owner_id: ids.legacy }, 10000, discounted.code, { cashFen: 10000, buyerId: ids.legacy, cwEnabled: true }),
  ), /仅限本人/);

  assert.equal((await a('/invite-codes/SALESA/status', { status: 'disabled' })).status, 200);
  assert.equal((await a('/invite-codes/SALESA/status', { status: 'active' })).status, 200);
});

test('VIP order lookup and recharge history reconcile ordinary and VIP payments and notify only once', { skip }, async () => {
  const sales = (path, body) => staff(path, body, 'operations', 'cw-sales-a');
  const otherSales = (path) => staff(path, null, 'operations', 'cw-sales-b');
  assert.equal((await sales('/invite-codes', { code: 'TRIAGEA' })).status, 201);
  const application = await call('/api/cw/apply', {
    legal_name: 'Order fixture', contact: 'test-contact-not-for-email', invite_code: 'TRIAGEA', consent_version: 'cw-privacy-v1',
  }, 'triage');
  assert.equal(application.status, 201);
  const partner = '/' + application.data.partner.id;
  const lookup = (number) => '/order-lookup?out_trade_no=' + encodeURIComponent(number);
  const account = (await pool.query('INSERT INTO billing_accounts(owner_id) VALUES($1) RETURNING *', [ids.triage])).rows[0];
  const payer = (await pool.query('INSERT INTO billing_accounts(owner_id) VALUES($1) RETURNING *', [ids.triageOther])).rows[0];
  await pool.query('SELECT ensure_customers()');
  await pool.query(`INSERT INTO discount_grants(name,audience,customer_id,customer_price_percent,starts_at,ends_at,reason,status,created_by,promo_code)
    SELECT 'Triage fixture','customer',c.id,50,now()-interval '1 hour',now()+interval '1 day','test','active','cw-test-admin','TRIAGE50'
    FROM customers c WHERE c.user_id=$1`, [ids.triage]);
  const makeOrder = async (number, userId, billing, cash, code = '') => {
    const q = await transaction(pool, db => quotePack(db, billing, cash, code, { cashFen: cash, buyerId: userId, cwEnabled: true }));
    return (await pool.query(`INSERT INTO payment_orders(out_trade_no,account_id,created_by,provider,amount_fen,face_fen,discount_snapshot,idempotency_key,expires_at)
       VALUES($1,$2,$3,'wechat_native',$4,$5,$6,$7,now()+interval '15 minutes') RETURNING *`,
    [number, billing.id, userId, q.amount_fen, q.face_fen, q.discount_snapshot, randomUUID()])).rows[0];
  };
  const refresh = (order, login = 'triage') => call('/api/billing/payment-orders/' + order.id, null, login);
  const start = paymentNotices.length;
  const ordinary = await makeOrder('TRIAGE-ORDINARY', ids.triage, account, 10000, 'TRIAGE50');
  assert.equal((await sales(lookup(ordinary.out_trade_no))).data.order.status, 'pending');
  mockWechatTrades.set(ordinary.out_trade_no, 10000);
  const polled = await Promise.all([refresh(ordinary), refresh(ordinary)]);
  assert.ok(polled.every(r => r.data.order.status === 'paid'));
  const ordinaryMail = paymentNotices.slice(start);
  assert.deepEqual(ordinaryMail.map(m => m.to).sort(), ['admin@cw.example.test', 'sales-a@cw.example.test']);
  for (const mail of ordinaryMail) {
    assert.match(mail.text, /TRIAGE-ORDINARY/);
    assert.match(mail.text, /普通充值/);
    assert.doesNotMatch(mail.text, /test-contact-not-for-email/);
  }
  assert.equal((await sales('/' + application.data.partner.id)).data.recharges[0].vip_payment, false);
  assert.equal((await otherSales(lookup(ordinary.out_trade_no))).status, 404);
  assert.equal((await sales(partner + '/confirm', {})).status, 200);
  assert.equal((await sales(partner)).data.can_activate, true);
  const found = (await sales(lookup(ordinary.out_trade_no))).data.order;
  assert.equal(found.partner_id, application.data.partner.id);
  assert.equal(found.promo_code, 'TRIAGE50');
  assert.ok(found.credited_at);

  const issued = await sales(partner + '/task-code', {});
  assert.equal(issued.status, 201);
  const vip = await makeOrder('TRIAGE-VIP', ids.triage, account, 10000, issued.data.code);
  mockWechatTrades.set(vip.out_trade_no, 10000);
  assert.equal((await refresh(vip)).data.order.status, 'paid');
  await refresh(vip);
  assert.equal(paymentNotices.length - start, 4);
  assert.ok(paymentNotices.slice(start + 2).every(m => m.text.includes('VIP 付款码')));
  const detail = (await sales(partner + '?order=TRIAGE-ORDINARY')).data;
  assert.equal(detail.can_activate, true);
  assert.deepEqual(detail.recharges.map(o => o.vip_payment), [false, true]);
  const queued = (await pool.query(`SELECT count(*)::int AS count FROM audit_events
    WHERE action='cw.recharge_notice_queued' AND subject_id IN ($1,$2)`, [ordinary.id, vip.id])).rows[0].count;
  assert.equal(queued, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM vip_notifications WHERE partner_id=$1 AND kind='recharge'",[application.data.partner.id])).rows[0].n,2,'duplicate payment callbacks create one inbox event per recharge');

  const unmatched = await makeOrder('TRIAGE-NON-VIP', ids.triageOther, payer, 500);
  mockWechatTrades.set(unmatched.out_trade_no, 500);
  assert.equal((await refresh(unmatched, 'triageOther')).data.order.status, 'paid');
  assert.equal((await staff(lookup(unmatched.out_trade_no))).data.order.partner_id, null);
  assert.equal((await sales(lookup(unmatched.out_trade_no))).status, 404);
  assert.equal(paymentNotices.length - start, 4);

  await staff(partner + '/owner', { owner_subject: 'cw-test-admin' });
  const sameMailbox = await makeOrder('TRIAGE-DEDUP', ids.triage, account, 500);
  mockWechatTrades.set(sameMailbox.out_trade_no, 500);
  assert.equal((await refresh(sameMailbox)).data.order.status, 'paid');
  assert.deepEqual(paymentNotices.slice(start + 4).map(m => m.to), ['admin@cw.example.test']);

  const failure = await makeOrder('TRIAGE-MAIL-FAIL', ids.triage, account, 500);
  mockWechatTrades.set(failure.out_trade_no, 500);
  failPaymentNotice = true;
  try {
    assert.equal((await refresh(failure)).data.order.status, 'paid');
    assert.ok((await staff(lookup(failure.out_trade_no))).data.order.credited_at);
  } finally {
    failPaymentNotice = false;
  }
});

test('VIP original-order exception requires a settled unused payment and a separate administrator decision', { skip }, async () => {
  const sales = (path, body) => staff(path, body, 'operations', 'cw-sales-a');
  assert.equal((await sales('/invite-codes', { code: 'ORDER-EXCEPTION', max_uses: 3 })).status, 201);
  const enroll = async (login) => {
    const result = await call('/api/cw/apply', {
      legal_name: 'VIP original-order fixture', contact: 'example-test', invite_code: 'ORDER-EXCEPTION',
      consent_version: 'cw-privacy-v1',
    }, login);
    assert.equal(result.status, 201);
    const person = result.data.partner;
    const account = (await pool.query('INSERT INTO billing_accounts(owner_id) VALUES($1) RETURNING id', [ids[login]])).rows[0];
    return { login, person, account: account.id, path: '/' + person.id };
  };
  const orderFor = async (customer, number, { credit = true } = {}) => {
    const order = (await pool.query(`INSERT INTO payment_orders
      (out_trade_no,account_id,created_by,provider,amount_fen,face_fen,idempotency_key,expires_at)
      VALUES($1,$2,$3,'wechat_native',5000,10000,$4,now()+interval '15 minutes') RETURNING id,out_trade_no`,
    [number, customer.account, ids[customer.login], randomUUID()])).rows[0];
    if (credit) await creditPaidOrder(pool, number, { provider: 'wechat_native', tradeNo: 'TR-' + number, totalFen: 5000 }, 'exception-test');
    return order;
  };
  const lead = await enroll('exception');
  const sibling = await enroll('exceptionOther');
  const historic = await enroll('exceptionLegacy');
  const endpoint = lead.path + '/activation-exceptions';
  const submit = (order, reason = '核对原单后申请一次性开通') => sales(endpoint, { out_trade_no: order.out_trade_no, reason });
  const historicalOrder = await orderFor(historic, 'EXCEPTION-HISTORIC');
  const historicalAudit = (await pool.query(`INSERT INTO audit_events(actor_kind,actor_id,action,subject_id,detail)
      VALUES('system','operator-vip-order-exception','cw.activation_exception_approved',$1,$2) RETURNING id`,
    [historic.person.id, { order_id: historicalOrder.id, reason: '历史审批凭证' }])).rows[0].id;
  const migration = await readFile(new URL('../migrations/085_vip_activation_exceptions.sql', import.meta.url), 'utf8');
  await pool.query(migration);
  await pool.query(migration);
  const historical = (await sales(historic.path)).data.activation_exceptions;
  assert.equal(historical.length, 1);
  assert.equal(historical[0].source_audit_id, historicalAudit);
  assert.equal(historical[0].decision_reason, '历史审批凭证');
  assert.equal((await sales(historic.path + '/confirm', {})).status, 200);
  assert.equal((await sales(historic.path + '/activation-exceptions', {
    out_trade_no: historicalOrder.out_trade_no, reason: '尝试复用历史订单',
  })).status, 409);

  const original = await orderFor(lead, 'EXCEPTION-ORIGINAL');
  const foreign = await orderFor(sibling, 'EXCEPTION-FOREIGN');
  assert.equal((await submit(original)).status, 409);
  assert.equal((await sales(lead.path + '/confirm', {})).status, 200);
  assert.equal((await sales(lead.path + '/activate', {})).status, 409, 'regular VIP still requires a qualifying ¥100 payment');
  assert.equal((await submit(original, ' ')).status, 400);
  assert.equal((await submit(foreign)).status, 404);
  assert.equal((await staff(endpoint, { out_trade_no: original.out_trade_no, reason: '越权账号' }, 'operations', 'cw-sales-b')).status, 404);

  const unpaid = await orderFor(lead, 'EXCEPTION-UNPAID', { credit: false });
  assert.equal((await submit(unpaid)).status, 409);
  await pool.query("UPDATE payment_orders SET status='paid',paid_at=now(),provider_trade_no='fixture-no-ledger' WHERE id=$1",[unpaid.id]);
  assert.equal((await submit(unpaid)).status, 409);

  const first = await submit(original);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal((await submit(original)).status, 409);
  assert.equal((await sales(lead.path)).data.activation_exceptions[0].status, 'pending');
  const decision = endpoint + '/' + first.data.id + '/decision';
  assert.equal((await sales(decision, { status: 'approved', reason: '销售禁止自审' })).status, 403);
  assert.equal((await staff(decision, { status: 'approved', reason: '财务不是管理员' }, 'finance', 'cw-finance')).status, 403);
  assert.equal((await staff(decision, { status: 'approved' })).status, 400);

  const refundId = await transaction(pool, async db => {
    await db.query('UPDATE payment_orders SET refunded_fen=1000 WHERE id=$1', [original.id]);
    return (await db.query(`INSERT INTO payment_refunds(order_id,out_request_no,amount_fen,reason,requested_by,idempotency_key)
      VALUES($1,'REF-EXCEPTION',1000,'fixture','cw-test-admin',$2) RETURNING id`,
    [original.id, randomUUID()])).rows[0].id;
  });
  assert.equal((await staff(decision, { status: 'approved', reason: '退款处理中不可通过' })).status, 409);
  assert.equal((await sales(lead.path)).data.partner.status, 'confirmed');
  await pool.query("UPDATE payment_refunds SET status='succeeded',completed_at=now() WHERE id=$1", [refundId]);
  assert.equal((await staff(decision, { status: 'approved', reason: '已退款不可通过' })).status, 409);
  assert.equal((await staff(decision, { status: 'rejected', reason: '原单存在退款' })).status, 200);

  const clean = await orderFor(lead, 'EXCEPTION-CLEAN');
  const next = await submit(clean);
  assert.equal(next.status, 201);
  const approval = endpoint + '/' + next.data.id + '/decision';
  const decisions = await Promise.all([1,2].map(() => staff(approval, { status: 'approved', reason: '核验普通充值已到账，批准一次性开通' })));
  assert.deepEqual(decisions.map(d => d.status).sort(), [200,409]);
  const detail = (await sales(lead.path)).data;
  assert.equal(detail.partner.status, 'active');
  assert.deepEqual(detail.activation_exceptions.map(e => e.status), ['approved', 'rejected']);
  assert.equal(detail.activation_exceptions[0].decided_by_name, 'CW test admin');
  assert.match(detail.activation_exceptions[0].decision_reason, /批准一次性开通/);
  assert.equal((await submit(clean)).status, 409);
  assert.equal((await sales(sibling.path)).data.partner.status, 'pending');
  const evidence = (await pool.query(`SELECT action,detail FROM audit_events WHERE subject_id=$1
     AND action IN ('cw.activation_exception_approved','cw.activated') ORDER BY id`, [lead.person.id])).rows;
  assert.deepEqual(evidence.map(e => e.action), ['cw.activation_exception_approved','cw.activated']);
  assert.ok(evidence.every(e => e.detail.order_id === clean.id && e.detail.exception_id === next.data.id));
  const credits = (await pool.query("SELECT count(*)::int AS n FROM billing_ledger WHERE reference_kind='payment' AND reference_id=$1", [clean.id])).rows[0];
  assert.equal(credits.n, 1);
  assert.equal((await call('/api/cw/status')).data.activate_min_cash_fen, 10000);
});


test('administrator can grant and revoke a single formal VIP promotion trial', { skip }, async () => {
  const application = (await pool.query(
    "INSERT INTO cw_partners(user_id,public_code,legal_name,contact_cipher,consent_version,status,owner_subject) VALUES($1,'TRLVPAAA','Trial VIP','test','cw-privacy-v1','active','cw-sales-a') RETURNING id",
    [ids.trialVip],
  )).rows[0];
  const pending = (await pool.query(
    "INSERT INTO cw_partners(user_id,public_code,legal_name,contact_cipher,consent_version) VALUES($1,'TRLPNDNG','Pending VIP','test','cw-privacy-v1') RETURNING id",
    [ids.trialPending],
  )).rows[0];
  assert.equal((await call('/api/cw/codes', {name:'Awaiting activation'}, 'trialPending')).status, 403);
  const activeUnverified = (await pool.query(
    "INSERT INTO cw_partners(user_id,public_code,legal_name,contact_cipher,consent_version,status) VALUES($1,'TRLUTHAA','Other VIP','test','cw-privacy-v1','active') RETURNING id",
    [ids.trialOther],
  )).rows[0];
  const trial = '/' + application.id + '/promotion-trial';
  const grant = { enabled: true, reason: 'Local promotion trial' };
  assert.equal((await staff(trial, grant, 'operations', 'cw-sales-a')).status, 403);
  assert.equal((await staff(trial, grant, 'finance', 'cw-finance')).status, 403);
  assert.equal((await staff('/' + pending.id + '/promotion-trial', grant)).status, 409);
  const legacy = (await pool.query(
    "INSERT INTO cw_codes(partner_id,code,name,customer_price_percent) VALUES($1,'TRLPASTX','Legacy trial promotion',50) RETURNING code",
    [application.id],
  )).rows[0];
  const allowed = await staff(trial, grant);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
  const until = allowed.data.promotion_trial_until;
  assert.ok(Date.parse(until) > Date.now());
  assert.equal((await staff(trial, grant)).data.promotion_trial_until, until);
  assert.equal((await staff('/' + activeUnverified.id)).data.partner.promotion_trial_until, null);
  assert.equal((await call('/api/cw/codes', {name:'Unverified'}, 'trialOther')).status, 409);
  assert.equal((await call('/api/cw/offers/' + legacy.code)).status, 200);
  const me = (await call('/api/cw/me', null, 'trialVip')).data;
  assert.equal(me.partner.promotion_trial_until, until);
  assert.deepEqual(me.contracts, []);
  assert.equal(me.codes.find((c) => c.code === legacy.code).status, 'active');

  const codes = [];
  for (const name of ['Trial A', 'Trial B']) {
    const result = await call('/api/cw/codes', { name }, 'trialVip');
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.status, 'active');
    assert.equal(result.data.ends_at, until);
    assert.equal(result.data.commission_bps, 1000);
    codes.push(result.data.code);
  }
  const [code, otherCode] = codes;
  assert.notEqual(code, otherCode);
  assert.equal((await call('/api/cw/offers/' + code)).data.kind, 'referral');

  const quote = await call('/api/billing/quote', { cash_fen: 5000, promo_code: code }, 'buyer');
  assert.equal(quote.status, 200, JSON.stringify(quote.data));
  assert.equal(quote.data.amount_fen, 5000);
  assert.equal(quote.data.face_fen, 10000);
  assert.equal(quote.data.discount_snapshot.cw.rate_bps, 1000);
  const created = await call('/api/billing/personal/wechat-orders', {
    cash_fen: 5000, promo_code: code, idempotency_key: randomUUID(),
    expected_cash_fen: 5000, expected_face_fen: 10000,
  }, 'buyer');
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const order = (await pool.query('SELECT id,out_trade_no FROM payment_orders WHERE id=$1', [created.data.order.id])).rows[0];

  const expired = await pool.query(
    "UPDATE cw_partners SET promotion_trial_until=now()-interval '1 second' WHERE id=$1",
    [application.id],
  );
  assert.equal(expired.rowCount, 1);
  assert.equal((await call('/api/cw/offers/' + code)).status, 404);
  assert.equal((await call('/api/cw/codes', { name:'Expired' }, 'trialVip')).status, 409);
  assert.equal((await staff(trial, grant)).status, 200);
  assert.equal((await call('/api/cw/offers/' + code)).status, 200);
  const revoked = await staff(trial, { enabled: false, reason: 'Test revoke' });
  assert.deepEqual(revoked, { status: 200, data: { promotion_trial_until: null } });
  assert.equal((await call('/api/cw/offers/' + code)).status, 404);
  assert.equal((await call('/api/billing/quote', { cash_fen: 5000, promo_code: code }, 'buyer')).status, 400);

  const paid = { provider: 'wechat_native', tradeNo: 'trial-payment', totalFen: 5000 };
  await creditPaidOrder(pool, order.out_trade_no, paid, 'trial-fixture');
  await creditPaidOrder(pool, order.out_trade_no, paid, 'trial-fixture');
  const rebate = (await pool.query(
    'SELECT partner_id, rate_bps, expected_fen, unlocked_fen FROM cw_commissions WHERE order_id=$1', [order.id],
  )).rows[0];
  assert.deepEqual(rebate, { partner_id: application.id, rate_bps: 1000, expected_fen: '500', unlocked_fen: '0' });
  const audit = (await pool.query(
    "SELECT actor_id,detail FROM audit_events WHERE action='cw.promotion_trial_changed' AND subject_id=$1 ORDER BY id DESC LIMIT 1",
    [application.id],
  )).rows[0];
  assert.equal(audit.actor_id, 'cw-test-admin');
  assert.equal(audit.detail.reason, 'Test revoke');
  assert.equal(audit.detail.enabled, false);

  const verified = await staff('/' + activeUnverified.id + '/contract', {
    template_version: 'fixture', document_sha256: 'a'.repeat(64),
    signature_reference: 'Local signature evidence', identity_reference: 'Local identity evidence',
    expires_at: '2098-01-01', verified: true,
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  for (const [name, percent, rate] of [['Verified A', 50, 1000], ['Verified B', 80, 4000]]) {
    const result = await call('/api/cw/codes', {name, customer_price_percent: percent}, 'trialOther');
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.status, 'active');
    assert.equal(result.data.commission_bps, rate);
    assert.equal((await call('/api/cw/offers/' + result.data.code)).status, 200);
  }
});

test('employee direct codes: exact custom text, owner scope, admin-only exceptions, expiry and no commission', {skip}, async()=>{
 const biz=(path,body,subject='cw-sales-a',role='operations')=>call('/api/staff/business/'+path,body,'buyer',role,subject);
 const body=(code,percent=50)=>({business_line:'direct',promo_code:code,name:'直营测试',audience:'all',customer_price_percent:percent,
  starts_at:new Date(Date.now()-60000).toISOString(),ends_at:new Date(Date.now()+86400000).toISOString(),reason:'独立测试，不对外发放'});
 for(const bad of ['SHORT','ABCDEFG1','中文测试','中文测试ABCDEFGH'])assert.equal((await biz('discounts',body(bad))).status,400);
 const en=await biz('discounts',body('directab'));assert.equal(en.status,201,JSON.stringify(en.data));assert.equal(en.data.status,'active');
 const zh=await biz('discounts',body('格洛可客户专享码'));assert.equal(zh.status,201);assert.equal(zh.data.status,'active');
 assert.equal((await biz('discounts',body('DIRECTAB'),'cw-sales-b')).status,409);
 const race=await Promise.all([biz('discounts',body('DIRECTAC')),biz('discounts',body('DIRECTAC'),'cw-sales-b')]);
 assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);
 const special=await biz('discounts',body('DIRECTAD',40));assert.equal(special.data.status,'pending');
 assert.equal((await biz(`discounts/${special.data.id}/approve`,{})).status,403);
 assert.equal((await biz(`discounts/${special.data.id}/approve`,{},'cw-finance','finance')).status,403);
 assert.equal((await biz(`discounts/${special.data.id}/approve`,{note:'测试管理员批准'},'cw-test-admin','platform_admin')).status,200);
 const list=await biz('acquisition');assert.equal(list.status,200,JSON.stringify(list.data));
 assert.ok(list.data.grants.some(g=>g.promo_code==='DIRECTAB'));assert.ok(!list.data.administrator);
 const other=await biz('acquisition',undefined,'cw-sales-b');assert.equal(other.status,200);assert.ok(!other.data.grants.some(g=>g.id===en.data.id));
 const all=await biz('acquisition',undefined,'cw-test-admin','platform_admin');assert.equal(all.status,200);assert.ok(all.data.grants.some(g=>g.id===en.data.id));
 assert.equal((await biz(`discounts/${en.data.id}/revoke`,{},'cw-sales-b')).status,403);
 for(const code of ['DIRECTAB','格洛可客户专享码']){
  const account=(await pool.query('INSERT INTO billing_accounts(owner_id) VALUES($1) ON CONFLICT(owner_id) WHERE owner_id IS NOT NULL DO UPDATE SET owner_id=excluded.owner_id RETURNING *',[ids.buyer])).rows[0];
  const quote=await transaction(pool,db=>quotePack(db,account,10000,code,{cashFen:10000,buyerId:ids.buyer,cwEnabled:true}));
  assert.equal(quote.amount_fen,10000);assert.equal(quote.face_fen,20000);assert.equal(quote.discount_snapshot.business_line,'direct');
  assert.equal(quote.discount_snapshot.owner_subject,'cw-sales-a');assert.equal(quote.discount_snapshot.cw,undefined);
  const order=(await pool.query(`INSERT INTO payment_orders(out_trade_no,account_id,created_by,provider,amount_fen,face_fen,discount_snapshot,idempotency_key,expires_at)
    VALUES($1,$2,$3,'wechat_native',$4,$5,$6,$7,now()+interval '15 minutes') RETURNING *`,['DIRECT-'+randomUUID(),account.id,ids.buyer,quote.amount_fen,quote.face_fen,quote.discount_snapshot,randomUUID()])).rows[0];
  await creditPaidOrder(pool,order.out_trade_no,{provider:'wechat_native',tradeNo:'test-'+order.id,totalFen:10000},'direct-test');
  assert.equal((await pool.query('SELECT 1 FROM cw_commissions WHERE order_id=$1',[order.id])).rowCount,0);
  const updated=await biz('acquisition');assert.ok(updated.data.orders.some(o=>o.out_trade_no===order.out_trade_no));
  const hidden=await biz('acquisition',undefined,'cw-sales-b');assert.ok(!hidden.data.orders.some(o=>o.out_trade_no===order.out_trade_no));
  const found=await biz('acquisition?q='+encodeURIComponent(order.out_trade_no));assert.equal(found.status,200);assert.equal(found.data.orders.length,1);assert.equal(found.data.orders[0].out_trade_no,order.out_trade_no);
  const hiddenSearch=await biz('acquisition?q='+encodeURIComponent(order.out_trade_no),undefined,'cw-sales-b');assert.equal(hiddenSearch.status,200);assert.equal(hiddenSearch.data.orders.length,0);
  const offer=await call('/api/cw/offers/'+encodeURIComponent(code));assert.equal(offer.data.kind,'direct');
 }
 const qr=await fetch(origin+'/api/staff/business/direct-codes/'+zh.data.id+'/qr',{headers:{'x-test-role':'operations','x-test-subject':'cw-sales-a'}});
 assert.equal(qr.status,200);assert.match(await qr.text(),/<svg/);
 const hiddenQr=await fetch(origin+'/api/staff/business/direct-codes/'+zh.data.id+'/qr',{headers:{'x-test-role':'operations','x-test-subject':'cw-sales-b'}});assert.equal(hiddenQr.status,404);
 await pool.query("UPDATE discount_grants SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE id=$1",[en.data.id]);
 await assert.rejects(()=>transaction(pool,db=>quotePack(db,{owner_id:ids.buyer},10000,'DIRECTAB',{cashFen:10000,buyerId:ids.buyer,cwEnabled:true})),/未生效/);
 assert.equal((await biz(`discounts/${en.data.id}/approve`,{},'cw-test-admin','platform_admin')).status,409);
 assert.equal((await biz('discounts',body('DIRECTAB'))).status,409);
 const retained=await biz('acquisition');assert.ok(retained.data.orders.some(o=>o.promo_code==='DIRECTAB'));
 assert.equal((await biz('discounts')).data.grants.some(g=>g.business_line==='direct'),false,'direct codes have a separate register');
});

test('VIP notifications persist, isolate owners, survive mail failures and mark read per employee', {skip}, async()=>{
 await staff('/invite-codes',{code:'NOTIFY'},'operations','cw-sales-a');
 const applied=await call('/api/cw/apply',{legal_name:'通知测试',contact:'test contact',invite_code:'NOTIFY',consent_version:'cw-privacy-v1'},'notify');
 assert.equal(applied.status,201);
 const pid=applied.data.partner.id;
 await call('/api/cw/apply',{legal_name:'通知测试',contact:'test contact',invite_code:'NOTIFY',consent_version:'cw-privacy-v1'},'notify');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM vip_notifications WHERE partner_id=$1 AND kind='applied'",[pid])).rows[0].n,1);
 const inbox=(role,subject)=>call('/api/staff/vip-notifications',null,'a',role,subject);
 const owner=await inbox('operations','cw-sales-a');
 const notice=owner.data.items.find(n=>n.partner_id===pid);
 assert.ok(notice);assert.equal(notice.read_at,null);
 assert.equal((await inbox('operations','cw-sales-b')).data.items.some(n=>n.partner_id===pid),false);
 assert.equal((await inbox('finance','cw-finance')).data.items.some(n=>n.partner_id===pid),false);
 assert.equal((await call('/api/staff/vip-notifications/'+notice.id+'/read',{},'a','operations','cw-sales-b')).status,404);
 assert.equal((await call('/api/staff/vip-notifications/'+notice.id+'/read',{},'a','operations','cw-sales-a')).status,200);
 assert.ok((await inbox('operations','cw-sales-a')).data.items.find(n=>n.id===notice.id).read_at);
 assert.equal((await inbox('platform_admin','cw-test-admin')).data.items.find(n=>n.id===notice.id).read_at,null);
 const countBefore=(await pool.query('SELECT count(*)::int AS n FROM vip_notifications')).rows[0].n;
 await assert.rejects(transaction(pool,async db=>{await db.query("UPDATE cw_partners SET status='confirmed' WHERE id=$1",[pid]);throw Error('rollback');}));
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM vip_notifications')).rows[0].n,countBefore);
 // No configured SMTP: retain the event for a later worker run.
 await pool.query("UPDATE cw_partners SET status='confirmed' WHERE id=$1",[pid]);
 const queued=(await pool.query("SELECT id FROM vip_notifications WHERE partner_id=$1 AND kind='confirmed'",[pid])).rows[0];
 assert.equal(await queueNextVipNotice(pool,cfg,{ready:false}),false);
 assert.equal((await pool.query('SELECT mail_queued_at FROM vip_notifications WHERE id=$1',[queued.id])).rows[0].mail_queued_at,null);
 await pool.query('TRUNCATE mail_outbox');
 const sent=[];const delivery=mailService(pool,cfg,{sendMail:async m=>sent.push(m)});
 let calls=0;
 await assert.rejects(queueNextVipNotice(pool,cfg,{ready:true,queue:async(m,db)=>{await delivery.queue(m,db);if(++calls===2)throw Error('queue unavailable');}}));
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM mail_outbox')).rows[0].n,0,'partial recipient enqueue rolls back');
 assert.equal((await pool.query('SELECT mail_attempts FROM vip_notifications WHERE id=$1',[queued.id])).rows[0].mail_attempts,1);
 await pool.query('UPDATE vip_notifications SET mail_available_at=now() WHERE id=$1',[queued.id]);
 const results=await Promise.all([queueNextVipNotice(pool,cfg,delivery),queueNextVipNotice(pool,cfg,delivery)]);
 assert.deepEqual(results.sort(),[false,true],'multiple workers enqueue one event exactly once');
 while(await delivery.drain());
 assert.deepEqual(sent.map(m=>m.to).sort(),['admin@cw.example.test','notify@cw.example.test','sales-a@cw.example.test']);
 await pool.query("UPDATE cw_partners SET owner_subject='cw-sales-b' WHERE id=$1",[pid]);
 assert.equal((await inbox('operations','cw-sales-a')).data.items.some(n=>n.partner_id===pid),false);
 assert.ok((await inbox('operations','cw-sales-b')).data.items.some(n=>n.partner_id===pid));
 assert.equal((await staff('/'+pid+'/status',{status:'rejected',reason:'internal review note',customer_feedback:'请补充申请资料'})).status,200);
 const feedback=await call('/api/cw/me',null,'notify');
 assert.equal(feedback.data.feedback,'请补充申请资料');
 assert.ok(!JSON.stringify(feedback.data).includes('internal review note'));
});
