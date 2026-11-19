import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.mjs';
import { config, transaction, HttpError } from '../src/core.mjs';
import { migrate } from '../src/migrate.mjs';
import { cwRoutes } from '../src/cw-partners.mjs';
import { quotePack, settlePaidCall } from '../src/pack-ledger.mjs';
import { creditPaidOrder, paymentRoutes } from '../src/payments.mjs';
import { refundCW, commissionFen } from '../src/cw-ledger.mjs';
const url = process.env.TEST_CW_DATABASE_URL;
let pool, server, origin, cfg;
const ids = { a: randomUUID(), b: randomUUID(), buyer: randomUUID() };
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
  });
  const service = createApp(pool, cfg, { sendMail: async () => ({}), verify: async () => true });
  await migrate(pool, service.auth);
  await pool.query('TRUNCATE "user",staff_members CASCADE');
  for (const [name, id] of Object.entries(ids))
    await pool.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled) VALUES($1,$2,$3,true,now(),now(),false)',
      [id, name, name + '@cw.example.test'],
    );
  await pool.query(
    "INSERT INTO staff_members(subject,email,name,role,status) VALUES('cw-test-admin','admin@cw.example.test','CW test admin','platform_admin','active')",
  );
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
      subject: 'cw-test-admin',
      status: 'active',
      role: req.headers['x-test-role'],
      finance_access: req.headers['x-test-role'] === 'platform_admin',
    };
    req.actor = { kind: 'staff', id: 'cw-test-admin' };
    next();
  };
  cwRoutes(app, pool, customer, staff, cfg);
  paymentRoutes(app, pool, customer, cfg, {
    wechat: { native: async () => ({ status: 200, data: { code_url: 'weixin://local-test-only' } }) },
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
async function call(path, body, user = 'a', role = null) {
  const r = await fetch(origin + path, {
    headers: {
      'x-test-user': user,
      ...(role ? { 'x-test-role': role } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
const staff = (path, b, role = 'platform_admin') => call('/api/staff/cw' + path, b, 'a', role);
test('CW commission uses cumulative cash precision', () => {
  assert.equal(commissionFen('10000'), 1000n);
  assert.equal(commissionFen('9'), 0n);
  assert.equal(commissionFen('10'), 1n);
});
test('CW application, code cap, payment, usage, month close and payout lifecycle', { skip }, async (t) => {
  let a, b, offer, order, account, pack;
  await t.test('application idempotency, no employee access, invitation alone earns nothing', async () => {
    const first = await call('/api/cw/apply', {
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
    const r = await call(
      '/api/cw/apply',
      {
        legal_name: 'Test B',
        contact: 'b@cw.example.test',
        invite: a.public_code,
        consent_version: 'cw-privacy-v1',
      },
      'b',
    );
    assert.equal(r.status, 201);
    b = r.data.partner;
    assert.equal((await staff('/' + b.id + '/contract', contract)).status, 200);
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
          "INSERT INTO customer_calls(account_id,key_id,owner_id,model_id,price_snapshot,status,hold_yuan) VALUES($1,$2,$3,'deepseek-flash','{}','pending',80) RETURNING id",
          [account.id, key, ids.buyer],
        )
      ).rows[0].id;
      await pool.query("UPDATE customer_calls SET created_at='2025-01-15T08:30:00+08:00' WHERE id=$1", [c]);
      await settlePaidCall(pool, c, 80, null, 'test', null, null);
      await settlePaidCall(pool, c, 80, null, 'test', null, null);
      let p = (await call('/api/cw/me', null, 'b')).data;
      assert.equal(p.totals.used_fen, '4000');
      assert.equal(p.totals.unlocked_fen, '400');
      assert.equal(p.totals.available_fen, '0');
      const ref = { id: randomUUID(), order_id: order.id, gross_fen: '6000', amount_fen: '6000' };
      await transaction(pool, (db) => refundCW(db, ref));
      await transaction(pool, (db) => refundCW(db, ref));
      p = (await call('/api/cw/me', null, 'b')).data;
      assert.equal(p.totals.expected_fen, '400');
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
      assert.equal((await staff('/' + b.id + '/private', { reason: 'test' }, 'operations')).status, 403);
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
      assert.equal((await call('/api/cw/payouts', { request_key: randomUUID() }, 'b')).status, 409);
    },
  );
});
