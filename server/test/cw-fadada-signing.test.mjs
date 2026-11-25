import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { config, hash, HttpError } from '../src/core.mjs';
import { createApp } from '../src/app.mjs';
import { migrate } from '../src/migrate.mjs';
import { cwRoutes } from '../src/cw-partners.mjs';
import { fadadaSigningWorker } from '../src/cw-fadada-signing.mjs';
import { companyName, fascSign } from '../src/fadada.mjs';

const url = process.env.TEST_FADADA_DATABASE_URL;
const clientEnv = {
  FADADA_SIGNING_MODE: 'sandbox', FADADA_APP_ID: 'app',
  FADADA_APP_SECRET: 'internal-fake-fasc-credentials', FADADA_CORP_ID: 'corp',
  FADADA_MEMBER_ID: 'member', FADADA_TEMPLATE_ID: 'template',
  FADADA_TEMPLATE_VERSION: 'trial-1', FADADA_COMPANY_ACTOR_ID: 'company', FADADA_PERSON_ACTOR_ID: 'vip',
};

test('FASC callback signature agrees with official SDK test vector and separates environments', () => {
  assert.equal(fascSign({
    'X-FASC-App-Id': 'app',
    'X-FASC-Sign-Type': 'HMAC-SHA256',
    'X-FASC-Timestamp': '1795570000000',
    'X-FASC-Nonce': 'd6a521b969af413cb325105c3fda3964',
    'X-FASC-Event': 'sign-task-finished',
    bizContent: '{"signTaskId":"fixture-123"}',
  }, clientEnv.FADADA_APP_SECRET), '42cafd0c50838a95fe0e602fb05e3a8c00442fd9b894c611889ace2917d33b9b');
  const env = { DATABASE_URL: 'postgres://localhost/fadada_test', BETTER_AUTH_SECRET: 'a'.repeat(40), ...clientEnv };
  assert.throws(() => config({ ...env, APP_ORIGIN: 'https://semifly.cn' }), /Invalid Fadada/);
  assert.throws(() => config({ ...env, FADADA_SIGNING_MODE: 'live' }), /Invalid Fadada/);
  assert.throws(() => config({ ...env, DATABASE_URL: 'postgres://localhost/production' }), /Invalid Fadada/);
});

test('VIP sandbox fixture signs on both sides, archives, and enables customer codes only after verification', { skip: !url }, async () => {
  assert.match(new URL(url).pathname, /_test$/);
  const pool = new pg.Pool({ connectionString: url });
  const cfg = config({
    DATABASE_URL: url, BETTER_AUTH_SECRET: 'local-test-fadada-key-not-production-1234',
    APP_ORIGIN: 'http://127.0.0.1:4180', CW_ENABLED: 'true', ...clientEnv,
  });
  const p1 = randomUUID(), p2 = randomUUID(), u1 = randomUUID(), u2 = randomUUID();
  const codes = new Map([[u1, p1], [u2, p2]]);
  const taskId = 'fixture-123';
  const privateId = 'fake-government-identifier';
  const pdf = Buffer.from('%PDF-1.7\nfixture-data\n%%EOF');
  const evidence = Buffer.from('504b030466697874757265', 'hex');
  let draftBody, vendorStage = 'task_created', personal = false, company = false, evidenceOffline = true;
  let wrongSigner = false, retries = 0, creates = 0, reportRequests = 0;
  let appServer, realServer;
  cfg.fadadaFetch = async (address, options) => {
    const route = new URL(address).pathname;
    if (route === '/pdf') return new Response(pdf);
    if (route === '/report') {
      retries++;
      return evidenceOffline ? new Response('', { status: 503 }) : new Response(evidence);
    }
    const payload = JSON.parse(options.body.get('bizContent') || '{}');
    const respond = (data) => Response.json({ code: '100000', data });
    switch (route.replace('/api/v5', '')) {
      case '/service/get-access-token':
        assert.equal(options.headers['X-FASC-Grant-Type'], 'client_credential');
        return respond({ accessToken: 'fixture-token', expiresIn: 3600 });
      case '/corp/get-identity-info':
        return respond({ openCorpId: 'corp', corpIdentStatus: 'identified', corpIdentInfo: { corpName: companyName } });
      case '/sign-task/create-with-template':
        assert.equal(payload.autoStart, false);
        assert.equal(payload.actors[1].actor.accountName, 'partner@oneapi.test');
        assert.equal(payload.actors[1].actor.identNameForMatch, '内部测试伙伴');
        assert.equal(payload.actors[0].signConfigInfo.requestVerifyFree, false);
        draftBody = payload;
        creates++;
        return respond({ signTaskId: taskId });
      case '/sign-task/get-detail':
        return respond({
          signTaskId: taskId, transReferenceId: draftBody.transReferenceId, templateId: 'template',
          initiator: { idType: 'corp', openId: 'corp' }, signTaskStatus: vendorStage, docs: [{ docId: '1' }],
        });
      case '/sign-task/field/fill-values':
        assert.deepEqual(new Set(payload.docFieldValues.map((field) => field.fieldKey)),
          new Set(['contract_number', 'template_version', 'vip_number', 'partner_name', 'ends_on']));
        return respond(null);
      case '/sign-task/start':
        vendorStage = 'sign_progress';
        return respond(null);
      case '/sign-task/actor/get-url':
        assert.ok(['company', 'vip'].includes(payload.actorId));
        return respond({ actorSignTaskUrl: 'https://cloud.fadada.com/fixture' });
      case '/sign-task/actor/list':
        return respond([
          { actorId: 'company', actorType: 'corp', corpName: companyName, joinStatus: 'joined',
            permissions: ['sign'], signStatus: company ? 'signed' : 'wait_sign',
            memberInfo: { memberId: 'member' }, verifyMethod: 'sms', signTime: '1795570001000' },
          { actorId: 'vip', actorType: 'person', joinName: wrongSigner ? '错误的人' : '内部测试伙伴', joinStatus: 'joined',
            permissions: ['sign'], signStatus: personal ? 'signed' : 'wait_sign',
            joinIdentType: 'id_card', joinIdentNo: privateId, verifyMethod: 'face', signTime: '1795570002000' },
        ]);
      case '/sign-task/owner/get-download-url':
        assert.equal(payload.downloadMode, 'download');
        return respond({ downloadUrl: 'https://cloud.fadada.com/pdf' });
      case '/sign-task/apply-report':
        assert.equal(payload.reportType, 'evidence_report');
        reportRequests++;
        return respond({ reportDownLoadId: 'report-123', reportStatus: 'applying' });
      case '/sign-task/download-report':
        assert.equal(payload.reportDownloadId, 'report-123');
        return respond({ reportDownloadUrl: 'https://cloud.fadada.com/report' });
      default:
        assert.fail('Unexpected FASC route ' + route);
    }
  };
  try {
    const service = createApp(pool, cfg);
    await migrate(pool, service.auth);
    await pool.query('TRUNCATE "user",staff_members CASCADE');
    await pool.query('TRUNCATE cw_fadada_notifications');
    for (const [user, partner] of codes) {
      await pool.query(
        'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled,"phoneOnly") VALUES($1,$2,$3,true,now(),now(),false,false)',
        [user, '内部测试伙伴', user === u1 ? 'partner@oneapi.test' : 'other@oneapi.test'],
      );
      await pool.query(
        "INSERT INTO cw_partners(id,user_id,public_code,legal_name,contact_cipher,consent_version,status) VALUES($1,$2,$3,$4,'fixture','test','active')",
        [partner, user, user === u1 ? 'PARTNERC' : 'PARTNERE', '内部测试伙伴'],
      );
    }
    await pool.query("INSERT INTO staff_members(subject,email,name,role,status) VALUES('fasc-test-admin','staff@oneapi.test','Test admin','platform_admin','active')");
    const app = express();
    app.use(express.json());
    cwRoutes(app, pool, (req, _res, next) => {
      const user = req.get('x-user');
      if (!codes.has(user)) throw new HttpError(401, 'login');
      req.customer = { id: user };
      req.actor = { kind: 'customer', id: user };
      next();
    }, (req, _res, next) => {
      if (!req.get('x-staff')) throw new HttpError(401, 'login');
      req.staff = { subject: 'fasc-test-admin', role: req.get('x-staff'), status: 'active', finance_access: true };
      req.actor = { kind: 'staff', id: req.staff.subject };
      next();
    }, cfg);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    appServer = app.listen(0, '127.0.0.1');
    realServer = service.app.listen(0, '127.0.0.1');
    await Promise.all([once(appServer, 'listening'), once(realServer, 'listening')]);
    const origin = 'http://127.0.0.1:' + appServer.address().port;
    const realOrigin = 'http://127.0.0.1:' + realServer.address().port;
    const customerPath = '/api/cw/signing';
    const staffRoot = '/api/staff/cw/' + p1;
    const worker = fadadaSigningWorker(pool, cfg);

    const call = async (path, { user = u1, role, body } = {}) => {
      const resp = await fetch(origin + path, {
        headers: { 'x-user': user, ...(role ? { 'x-staff': role } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      });
      const data = resp.headers.get('content-type')?.includes('json') ? await resp.json() : Buffer.from(await resp.arrayBuffer());
      return { status: resp.status, data };
    };
    const customer = (path, body, user) => call('/api/cw' + path, { body, user });
    const admin = (path, body, role = 'platform_admin') => call(staffRoot + path, { body, role });
    const notify = async (valid = true, nonce = randomUUID().replaceAll('-', '')) => {
      const bizContent = JSON.stringify({ signTaskId: taskId });
      const headers = {
        'X-FASC-App-Id': 'app', 'X-FASC-Sign-Type': 'HMAC-SHA256',
        'X-FASC-Timestamp': String(Date.now()), 'X-FASC-Nonce': nonce, 'X-FASC-Event': 'sign-task-finished',
      };
      const r = await fetch(realOrigin + customerPath + '/fadada/notify', {
        method: 'POST',
        headers: { ...headers, 'X-FASC-Sign': valid ? fascSign({ ...headers, bizContent }, cfg.fadada.secret) : 'a'.repeat(64) },
        body: new URLSearchParams({ bizContent }),
      });
      return { status: r.status, data: await r.json() };
    };

    assert.equal((await customer('/codes', { name: 'Before sign' })).status, 409);
    assert.equal((await customer('/signing/request', { consent: false, template_version: 'trial-1' })).status, 400);
    const request = { consent: true, template_version: 'trial-1' };
    const responses = await Promise.all([customer('/signing/request', request), customer('/signing/request', request)]);
    assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
    const signingId = responses.find(({ status }) => status === 201).data.id;
    const staffPath = '/signing/' + signingId;
    const ends_on = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    assert.equal((await admin(staffPath + '/draft', { ends_on }, 'operations')).status, 403);
    assert.equal((await admin(staffPath + '/draft', { ends_on })).status, 201);
    assert.equal((await admin(staffPath + '/draft', { ends_on })).status, 409);
    assert.equal(creates, 1);
    assert.equal((await admin(staffPath + '/start', { confirmed: false })).status, 400);
    assert.equal((await admin(staffPath + '/start', { confirmed: true })).status, 200);
    assert.equal((await admin(staffPath + '/seal', {})).data.url, 'https://cloud.fadada.com/fixture');
    assert.equal((await customer(staffPath + '/open', {}, u2)).status, 404);
    assert.equal((await customer(staffPath + '/open', {})).data.url, 'https://cloud.fadada.com/fixture');
    assert.equal((await notify(false)).status, 401);

    personal = true;
    assert.equal(await worker(), true);
    assert.equal((await customer('/me')).data.signing.status, 'pending_company');
    company = true;
    vendorStage = 'task_finished';
    wrongSigner = true;
    assert.deepEqual(await notify(), { status: 200, data: { msg: 'success' } });
    await worker();
    assert.equal((await customer('/me')).data.signing.status, 'review');
    assert.equal((await customer('/codes', { name: 'Wrong identity' })).status, 409);
    wrongSigner = false;
    await notify();
    await worker();
    assert.equal((await customer('/me')).data.signing.status, 'archiving');
    await notify();
    await worker();
    assert.ok(retries >= 1);
    assert.equal((await customer('/me')).data.contracts.length, 0);
    await pool.query('UPDATE cw_fadada_signings SET next_check_at=now() WHERE id=$1', [signingId]);
    evidenceOffline = false;
    await worker();
    const after = await customer('/me');
    assert.equal(after.data.signing.status, 'verified');
    assert.equal(reportRequests, 1);
    assert.equal(after.data.contracts[0].document_sha256, hash(pdf));
    assert.equal((await admin('')).data.contracts[0].verified_by, null);
    assert.deepEqual((await customer(staffPath + '/pdf')).data, pdf);
    assert.equal((await customer(staffPath + '/pdf', undefined, u2)).status, 404);
    assert.equal((await admin(staffPath + '/file/evidence', undefined, 'operations')).status, 403);
    assert.deepEqual((await admin(staffPath + '/file/evidence')).data, evidence);
    const record = await pool.query('SELECT evidence_summary,pdf_cipher,evidence_sha256 FROM cw_fadada_archives WHERE signing_id=$1', [signingId]);
    assert.equal(record.rows[0].evidence_sha256, hash(evidence));
    assert.ok(!JSON.stringify(record.rows[0]).includes(privateId));
    assert.notEqual(record.rows[0].pdf_cipher, pdf.toString('base64'));
    for (let i = 0; i < 2; i++) {
      const generated = await customer('/codes', { name: 'Post-sign ' + i, customer_price_percent: 80 });
      assert.equal(generated.status, 201);
      assert.equal(generated.data.status, 'active');
      assert.equal(generated.data.commission_bps, 4000);
    }
    await notify();
    await notify();
    await worker();
    assert.equal((await customer('/me')).data.contracts.length, 1);
    vendorStage = 'revoked';
    await notify();
    await worker();
    assert.equal((await customer('/me')).data.signing.status, 'voided');
    assert.equal((await customer('/codes', { name: 'After void' })).status, 409);
  } finally {
    await Promise.all([appServer, realServer].filter(Boolean).map((server) => new Promise((resolve) => server.close(resolve))));
    await pool.end();
  }
});
