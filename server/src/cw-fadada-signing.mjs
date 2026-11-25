import express from 'express';
import { createHmac } from 'node:crypto';
import { audit, hash, HttpError, id, transaction, vault } from './core.mjs';
import { companyName, corp, fadadaClient, fascEvent, vendorId } from './fadada.mjs';

const signable = ['pending_both', 'pending_person', 'pending_company'];
const activePartner = (status) => status === 'active';
const selectState = 'id,mode,status,template_version,ends_on::text,updated_at,last_error';
const signTask = (job) => ({ signTaskId: job.provider_id });
const businessCode = (id) => id.replaceAll('-', '').slice(0, 30);
const archiveVault = (cfg) => vault(cfg.secret + ':cw-fadada-v1');
const dayEnd = (day) => new Date(day + 'T23:59:59.999+08:00');
const same = (a, b) => typeof a === 'string' && a.trim() === b;
const system = { kind: 'system', id: 'fadada' };

export const fadadaAvailableTo = (settings, partner) => Boolean(
  settings && activePartner(partner.status) &&
  (!settings.partnerIds.size || settings.partnerIds.has(partner.id)),
);

export async function fadadaState(db, settings, partner) {
  if (!fadadaAvailableTo(settings, partner)) return null;
  const { rows: [job] } = await db.query(
    'SELECT ' + selectState + ' FROM cw_fadada_signings WHERE partner_id=$1 AND mode=$2 AND app_id=$3 ORDER BY created_at DESC LIMIT 1',
    [partner.id, settings.mode, settings.appId],
  );
  return { ...(job || { mode: settings.mode, status: 'available', template_version: settings.version }), request_version: settings.version };
}

function signingDate(value) {
  const checked = new Date(value + 'T00:00:00Z');
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(value) ||
      !Number.isFinite(checked.getTime()) || checked.toISOString().slice(0, 10) !== value ||
      dayEnd(value) <= new Date())
    throw new HttpError(400, '请选择有效的合同截止日期（北京时间）');
  return value;
}

async function signingAccount(db, cfg, customerId, phone) {
  const { rows: [account] } = await db.query(
    'SELECT email,"emailVerified","phoneOnly",disabled FROM "user" WHERE id=$1 FOR SHARE', [customerId],
  );
  if (account && !account.disabled && !account.phoneOnly && account.emailVerified && account.email.length <= 60 && !phone) return account.email;
  const normalized = typeof phone === 'string' ? phone.trim().replace(/^(?:\+86|0086)/, '') : '';
  if (!account || account.disabled || !cfg.sms || !/^1[3-9]\d{9}$/.test(normalized))
    throw new HttpError(400, '请填写当前账号已验证的手机号');
  const digest = createHmac('sha256', cfg.sms.phoneHashSecret).update('sms-phone:' + normalized).digest('hex');
  if (!(await db.query('SELECT 1 FROM customer_sms_phones WHERE user_id=$1 AND phone_hash=$2 FOR SHARE', [customerId, digest])).rowCount)
    throw new HttpError(400, '请使用当前账号已验证的手机号');
  return normalized;
}

async function readTask(client, job) {
  const detail = await client.call('/sign-task/get-detail', { ...signTask(job), filter: ['doc', 'attach'] });
  if (detail?.signTaskId !== job.provider_id || detail.transReferenceId !== job.id ||
      detail.templateId !== job.template_id || detail.initiator?.idType !== 'corp' ||
      detail.initiator.openId !== job.open_corp_id)
    throw new HttpError(409, '法大大任务与此 VIP 协议不匹配');
  return detail;
}

async function createDraft(client, job, signer) {
  const cert = await client.call('/corp/get-identity-info', { openCorpId: job.open_corp_id });
  if (cert?.openCorpId !== job.open_corp_id || cert.corpIdentStatus !== 'identified' ||
      cert.corpIdentInfo?.corpName !== companyName)
    throw new HttpError(409, '法大大账号未核实为协议甲方');
  const created = await client.call('/sign-task/create-with-template', {
    signTaskSubject: (job.mode === 'sandbox' ? '内部试签 ' : '') + 'VIP 推广合作协议 ' + job.public_code,
    signTemplateId: job.template_id,
    initiator: corp(job.open_corp_id),
    initiatorMemberId: job.company_member_id,
    businessCode: businessCode(job.id),
    transReferenceId: job.id,
    signDocType: 'contract',
    autoStart: false,
    autoFinish: true,
    autoFillFinalize: true,
    expiresTime: String(dayEnd(job.ends_on).getTime()),
    actors: [{
      actor: {
        actorId: job.company_actor, actorType: 'corp', actorName: companyName,
        actorOpenId: job.open_corp_id, permissions: ['sign'],
        actorCorpMembers: [{ memberId: job.company_member_id }], sendNotification: false, sendInSiteMessage: false,
      },
      signConfigInfo: { requestVerifyFree: false, joinByLink: false, identifiedView: true },
    }, {
      actor: {
        actorId: job.person_actor, actorType: 'person', actorName: signer.name,
        identNameForMatch: signer.name, accountName: signer.account, accountEditable: false,
        permissions: ['sign'], sendNotification: false, sendInSiteMessage: false,
      },
      signConfigInfo: { requestVerifyFree: false, freeLogin: false, identifiedView: true, readingToEnd: true },
    }],
  });
  if (!vendorId(created?.signTaskId)) throw new HttpError(502, '法大大未返回有效的任务编号');
  return created.signTaskId;
}

async function prepareDocument(client, job, signer, detail) {
  if (detail.signTaskStatus !== 'task_created' || detail.docs?.length !== 1 || !detail.docs[0].docId || detail.attachs?.length)
    throw new HttpError(409, '请核对法大大草稿状态和模板正文');
  const docId = String(detail.docs[0].docId);
  await client.call('/sign-task/field/fill-values', {
    ...signTask(job),
    docFieldValues: Object.entries({
      contract_number: businessCode(job.id),
      template_version: job.template_version,
      vip_number: job.public_code,
      partner_name: signer.name,
      ends_on: job.ends_on,
    }).map(([fieldKey, fieldValue]) => ({ docId, fieldKey, fieldValue })),
  });
}

function pdfFilename(kind) {
  return kind === 'pdf'
    ? { type: 'application/pdf', name: 'VIP-cooperation-agreement.pdf' }
    : { type: 'application/zip', name: 'VIP-signing-evidence.zip' };
}

function serveArchive(res, box, archive, kind) {
  if (!archive) throw new HttpError(404, '归档文件不存在');
  const { type, name } = pdfFilename(kind);
  const file = Buffer.from(box.open(archive.cipher), 'base64');
  if (hash(file) !== archive.sha) throw new HttpError(500, '归档文件校验失败');
  res.set({ 'Content-Type': type, 'Content-Disposition': 'attachment; filename="' + name + '"', 'Cache-Control': 'no-store' });
  res.send(file);
}

export function fadadaSigningRoutes(app, pool, requireCustomer, requireStaff, cfg, enabled, admin) {
  const settings = cfg.fadada, box = archiveVault(cfg);
  const client = settings && fadadaClient(settings, cfg.fadadaFetch);
  const online = (_req, _res, next) => {
    if (!client) throw new HttpError(404, '法大大签署功能尚未开放');
    next();
  };
  const requireAdmin = (req, _res, next) => { admin(req); next(); };

  app.post('/api/cw/signing/request', requireCustomer, enabled, online, async (req, res) => {
    if (req.body?.consent !== true || req.body?.template_version !== settings.version)
      throw new HttpError(400, '请确认合同版本和签署资料授权');
    const job = await transaction(pool, async (db) => {
      const { rows: [p] } = await db.query('SELECT * FROM cw_partners WHERE user_id=$1 FOR UPDATE', [req.customer.id]);
      if (!p || !fadadaAvailableTo(settings, p)) throw new HttpError(409, '当前申请尚不能发起签署');
      if ((await db.query('SELECT 1 FROM cw_contracts WHERE partner_id=$1 AND expires_at>statement_timestamp()', [p.id])).rowCount)
        throw new HttpError(409, '当前协议仍在有效期内');
      const open = await db.query(
        "SELECT 1 FROM cw_fadada_signings WHERE partner_id=$1 AND mode=$2 AND status NOT IN ('verified','rejected','expired','canceled','voided')",
        [p.id, settings.mode],
      );
      if (open.rowCount) throw new HttpError(409, '该客户已有办理中的签署任务');
      const account = await signingAccount(db, cfg, req.customer.id, req.body.phone);
      const { rows: [j] } = await db.query(
        'INSERT INTO cw_fadada_signings(partner_id,app_id,mode,open_corp_id,company_member_id,template_id,template_version,company_actor,person_actor,signer_cipher,status)' +
        " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'requested')" +
        " ON CONFLICT(partner_id,mode) WHERE status NOT IN ('verified','rejected','expired','canceled','voided') DO NOTHING RETURNING id",
        [p.id, settings.appId, settings.mode, settings.corpId, settings.memberId, settings.templateId,
          settings.version, settings.corpActor, settings.personActor, box.seal({ name: p.legal_name, account })],
      );
      if (!j) throw new HttpError(409, '该客户已有办理中的签署任务');
      await audit(db, req.actor, 'cw.fadada_consent', null, p.id, { signing_id: j.id, version: settings.version, mode: settings.mode });
      return j;
    });
    res.status(201).json(job);
  });

  const staffBase = '/api/staff/cw/:partner/signing/:signing';
  async function staffJob(db, req) {
    const { rows: [job] } = await db.query(
      'SELECT j.*,j.ends_on::text AS ends_on,p.public_code,p.status AS partner_status FROM cw_fadada_signings j JOIN cw_partners p ON p.id=j.partner_id' +
      ' WHERE j.id=$1 AND p.id=$2 AND j.mode=$3 AND j.app_id=$4 FOR UPDATE OF j',
      [id(req.params.signing), id(req.params.partner), settings.mode, settings.appId],
    );
    if (!job) throw new HttpError(404, '签署任务不存在');
    if (!activePartner(job.partner_status) || !fadadaAvailableTo(settings, { id: job.partner_id, status: job.partner_status }))
      throw new HttpError(409, '当前 VIP 不可发起线上签署');
    return job;
  }

  app.post(staffBase + '/draft', requireStaff, requireAdmin, enabled, online, async (req, res) => {
    const end = signingDate(req.body?.ends_on);
    const job = await transaction(pool, async (db) => {
      const j = await staffJob(db, req);
      if (j.status !== 'requested') throw new HttpError(409, '请在当前签署任务继续办理');
      await db.query(
        "UPDATE cw_fadada_signings SET status='creating',ends_on=$2,requested_by=$3,updated_at=now() WHERE id=$1",
        [j.id, end, req.staff.subject],
      );
      await audit(db, req.actor, 'cw.fadada_draft_requested', null, j.partner_id, { signing_id: j.id, mode: j.mode });
      return { ...j, ends_on: end };
    });

    let providerId;
    try {
      providerId = await createDraft(client, job, box.open(job.signer_cipher));
    } catch (err) {
      if (err.status === 409) {
        await pool.query("UPDATE cw_fadada_signings SET status='requested',updated_at=now() WHERE id=$1 AND status='creating'", [job.id]);
        throw err;
      }
      throw new HttpError(502, '创建结果待核对，请先在法大大查询该业务编号');
    }
    await pool.query(
      "UPDATE cw_fadada_signings SET status='draft',provider_id=$2,updated_at=now() WHERE id=$1 AND status='creating'",
      [job.id, providerId],
    );
    res.status(201).json({ id: job.id });
  });

  app.post(staffBase + '/recover', requireStaff, requireAdmin, enabled, online, async (req, res) => {
    let providerId = typeof req.body?.provider_id === 'string' ? req.body.provider_id.trim() : '';
    if (providerId && !vendorId(providerId)) throw new HttpError(400, '请填写有效的法大大任务编号');
    await transaction(pool, async (db) => {
      const job = await staffJob(db, req);
      if (job.status !== 'creating') throw new HttpError(409, '该任务无需补登记');
      if (!providerId) {
        if (Date.now() - job.updated_at.getTime() < 120_000)
          throw new HttpError(409, '法大大可能仍在处理创建结果，请两分钟后核对');
        const result = await client.call('/sign-task/owner/get-list', {
          ownerId: corp(job.open_corp_id), ownerRole: 'initiator',
          listFilter: { businessCode: businessCode(job.id) }, listPageNo: 1, listPageSize: 20,
        });
        if (!Array.isArray(result?.signTasks) || !Number.isInteger(result.totalCount) || result.totalCount > 20)
          throw new HttpError(409, '法大大结果无法确认，请手动核对并填写任务编号');
        const matches = result.signTasks.filter((task) => task.transReferenceId === job.id);
        if (matches.length === 1 && vendorId(matches[0].signTaskId)) providerId = matches[0].signTaskId;
        else if (result.totalCount === 0 && result.signTasks.length === 0) {
          await db.query("UPDATE cw_fadada_signings SET status='requested',updated_at=now() WHERE id=$1", [job.id]);
          await audit(db, req.actor, 'cw.fadada_draft_not_found', null, job.partner_id, { signing_id: job.id });
          return;
        } else throw new HttpError(409, '法大大结果无法确认，请手动核对并填写任务编号');
      }
      const detail = await readTask(client, { ...job, provider_id: providerId });
      if (detail.signTaskStatus !== 'task_created') throw new HttpError(409, '仅可补登记匹配的法大大未提交草稿');
      await db.query(
        "UPDATE cw_fadada_signings SET status='draft',provider_id=$2,updated_at=now() WHERE id=$1",
        [job.id, providerId],
      );
      await audit(db, req.actor, 'cw.fadada_draft_recovered', null, job.partner_id, { signing_id: job.id });
    });
    res.json({ ok: true });
  });

  app.post(staffBase + '/start', requireStaff, requireAdmin, enabled, online, async (req, res) => {
    if (req.body?.confirmed !== true) throw new HttpError(400, '请确认协议内容与经办人用印授权');
    const job = await transaction(pool, async (db) => {
      const j = await staffJob(db, req);
      if (j.status !== 'draft' || dayEnd(j.ends_on) <= new Date()) throw new HttpError(409, '请确认法大大草稿及有效期');
      const current = await db.query('SELECT 1 FROM cw_contracts WHERE partner_id=$1 AND expires_at>statement_timestamp()', [j.partner_id]);
      if (current.rowCount) throw new HttpError(409, '当前协议仍在有效期内');
      await prepareDocument(client, j, box.open(j.signer_cipher), await readTask(client, j));
      await db.query(
        "UPDATE cw_fadada_signings SET status='starting',next_check_at=now()+interval '30 seconds',updated_at=now() WHERE id=$1",
        [j.id],
      );
      await audit(db, req.actor, 'cw.fadada_start_requested', null, j.partner_id, { signing_id: j.id, mode: j.mode });
      return j;
    });
    try {
      await client.call('/sign-task/start', signTask(job));
    } catch {
      throw new HttpError(502, '提交结果待核对，系统会自动向法大大查询');
    }
    await pool.query(
      "UPDATE cw_fadada_signings SET status='pending_both',next_check_at=now(),updated_at=now() WHERE id=$1 AND status='starting'",
      [job.id],
    );
    res.json({ ok: true });
  });

  async function signerLink(job, actorId) {
    const result = await client.call('/sign-task/actor/get-url', {
      ...signTask(job), actorId,
      redirectUrl: encodeURIComponent(new URL('/promotion/vip.html?contract=1' + (actorId === job.company_actor ? '&staff=1&partner=' + job.partner_id : ''), cfg.origin).href),
    });
    return client.url(result?.actorSignTaskUrl);
  }

  app.post('/api/cw/signing/:signing/open', requireCustomer, enabled, online, async (req, res) => {
    const { rows: [job] } = await pool.query(
      'SELECT j.*,p.status AS partner_status FROM cw_fadada_signings j JOIN cw_partners p ON p.id=j.partner_id' +
      " WHERE j.id=$1 AND p.user_id=$2 AND j.app_id=$3 AND j.mode=$4 AND j.status IN ('pending_both','pending_person')",
      [id(req.params.signing), req.customer.id, settings.appId, settings.mode],
    );
    if (!job || !fadadaAvailableTo(settings, { id: job.partner_id, status: job.partner_status }))
      throw new HttpError(404, '当前无待签署协议');
    res.json({ url: await signerLink(job, job.person_actor) });
  });
  app.post(staffBase + '/seal', requireStaff, requireAdmin, enabled, online, async (req, res) => {
    const job = await transaction(pool, (db) => staffJob(db, req));
    if (!['pending_both', 'pending_company'].includes(job.status)) throw new HttpError(409, '当前无待盖章协议');
    res.json({ url: await signerLink(job, job.company_actor) });
  });

  app.post('/api/cw/signing/fadada/notify', online, express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
    const event = fascEvent(req, settings);
    if (event) await pool.query(
      'INSERT INTO cw_fadada_notifications(signing_id,event_key)' +
      ' SELECT id,$4 FROM cw_fadada_signings WHERE mode=$1 AND app_id=$2 AND ' +
      (event.report ? 'report_id' : 'provider_id') + '=$3' +
      " AND status NOT IN ('draft','requested','creating','voided','canceled','rejected','expired') ON CONFLICT DO NOTHING",
      [settings.mode, settings.appId, event.reference, event.key],
    );
    res.json({ msg: 'success' });
  });

  app.get('/api/cw/signing/:signing/pdf', requireCustomer, async (req, res) => {
    const { rows: [file] } = await pool.query(
      'SELECT a.pdf_cipher AS cipher,a.pdf_sha256 AS sha FROM cw_fadada_archives a JOIN cw_fadada_signings j ON j.id=a.signing_id' +
      ' JOIN cw_partners p ON p.id=j.partner_id WHERE j.id=$1 AND p.user_id=$2',
      [id(req.params.signing), req.customer.id],
    );
    serveArchive(res, box, file, 'pdf');
  });
  app.get(staffBase + '/file/:kind', requireStaff, requireAdmin, async (req, res) => {
    const kind = req.params.kind;
    if (!['pdf', 'evidence'].includes(kind)) throw new HttpError(404, '归档文件不存在');
    const file = await transaction(pool, async (db) => {
      const { rows: [archive] } = await db.query(
        'SELECT a.' + kind + '_cipher AS cipher,a.' + kind + '_sha256 AS sha FROM cw_fadada_archives a' +
        ' JOIN cw_fadada_signings j ON j.id=a.signing_id WHERE j.id=$1 AND j.partner_id=$2',
        [id(req.params.signing), id(req.params.partner)],
      );
      if (archive) await audit(db, req.actor, 'cw.fadada_archive_download', null, id(req.params.partner), {
        signing_id: id(req.params.signing), kind,
      });
      return archive;
    });
    serveArchive(res, box, file, kind);
  });
}

const taskEnded = new Map([['expired', 'expired'], ['revoked', 'voided']]);

async function signingResult(db, client, box, job, detail) {
  const ended = taskEnded.get(detail.signTaskStatus);
  if (ended) {
    if (job.status === 'verified' && ended !== 'voided') return 'verified';
    if (ended === 'voided') await db.query(
      'UPDATE cw_contracts SET expires_at=least(expires_at,now()) WHERE fadada_signing_id=$1', [job.id],
    );
    await audit(db, system, 'cw.fadada_' + ended, null, job.partner_id, { signing_id: job.id });
    return ended;
  }
  if (job.status === 'verified') return 'verified';
  if (detail.signTaskStatus === 'task_created') return 'draft';

  const response = await client.call('/sign-task/actor/list', signTask(job));
  const rows = Array.isArray(response) ? response : response?.actors;
  const company = rows?.find((actor) => actor.actorId === job.company_actor && actor.actorType === 'corp');
  const person = rows?.find((actor) => actor.actorId === job.person_actor && actor.actorType === 'person');
  if (!company || !person || rows.length !== 2 || !company.permissions?.includes('sign') || !person.permissions?.includes('sign'))
    return 'review';
  if ([company, person].some((actor) => actor.signStatus === 'sign_rejected' || actor.fillStatus === 'fill_rejected')) return 'rejected';
  if (detail.signTaskStatus === 'task_terminated') return 'canceled';
  if (!['sign_progress', 'sign_completed', 'task_finished'].includes(detail.signTaskStatus)) return 'starting';

  const companySigned = company.signStatus === 'signed', personSigned = person.signStatus === 'signed';
  if (!companySigned || !personSigned) return companySigned ? 'pending_person' : personSigned ? 'pending_company' : 'pending_both';
  if (detail.signTaskStatus !== 'task_finished') return 'archiving';

  const { name, account } = box.open(job.signer_cipher);
  // Do not retain identity numbers returned by FASC. The account and real name were locked when the customer consented.
  if (!same(company.corpName || company.joinName, companyName) || !same(person.joinName, name) ||
      company.joinStatus !== 'joined' || person.joinStatus !== 'joined' ||
      !person.joinIdentType || !person.verifyMethod || !company.verifyMethod || !company.signTime || !person.signTime ||
      (person.notification?.notifyAddress && !same(person.notification.notifyAddress, account)) ||
      company.memberInfo?.memberId !== job.company_member_id ||
      detail.docs?.length !== 1 || !detail.docs[0].docId || detail.attachs?.length)
    return 'review';

  if (!job.report_id) {
    // This official report type is free. Persist its ID before trying downloads.
    const report = await client.call('/sign-task/apply-report', {
      ...signTask(job), ownerId: corp(job.open_corp_id), reportType: 'evidence_report',
    });
    const reportId = report?.reportDownLoadId || report?.reportDownloadId;
    if (!vendorId(reportId)) throw new HttpError(502, '法大大未返回存证报告编号');
    await db.query('UPDATE cw_fadada_signings SET report_id=$2 WHERE id=$1', [job.id, reportId]);
    return 'archiving';
  }
  const evidence = await client.call('/sign-task/download-report', { reportDownloadId: job.report_id });
  const reportUrl = evidence?.reportDownloadUrl || evidence?.downloadUrl;
  if (!reportUrl) return 'archiving';
  const docId = String(detail.docs[0].docId);
  const signed = await client.call('/sign-task/owner/get-download-url', {
    ...signTask(job), ownerId: corp(job.open_corp_id), compression: false, downloadMode: 'download',
  });
  const [pdf, report] = await Promise.all([
    client.download(signed?.downloadUrl, 10 * 1024 ** 2, Buffer.from('%PDF-')),
    client.download(reportUrl, 15 * 1024 ** 2, Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  ]);
  const pdfHash = hash(pdf), reportHash = hash(report);
  if (!(await db.query('SELECT id FROM cw_partners WHERE id=$1 FOR UPDATE', [job.partner_id])).rowCount)
    throw new HttpError(409, 'VIP 客户不存在');
  await db.query(
    'INSERT INTO cw_fadada_archives(signing_id,pdf_cipher,pdf_sha256,evidence_cipher,evidence_sha256,evidence_summary) VALUES($1,$2,$3,$4,$5,$6)',
    [job.id, box.seal(pdf.toString('base64')), pdfHash, box.seal(report.toString('base64')), reportHash, {
      provider_task_id: job.provider_id, provider_document_id: docId, provider_report_id: job.report_id,
      company_actor_id: job.company_actor, company_signed_at: company.signTime, company_member_id: job.company_member_id,
      person_actor_id: job.person_actor, person_signed_at: person.signTime, person_verify_method: person.verifyMethod,
      identity_verified: true,
    }],
  );
  const expiry = dayEnd(job.ends_on);
  await db.query(
    'INSERT INTO cw_contracts(partner_id,template_version,document_sha256,signature_reference,identity_reference,expires_at,fadada_signing_id)' +
    ' VALUES($1,$2,$3,$4,$5,$6,$7)',
    [job.partner_id, job.template_version, pdfHash, 'fadada:' + job.provider_id,
      'fadada:' + job.provider_id + ':' + job.person_actor, expiry, job.id],
  );
  const { rows: [{ count }] } = await db.query('SELECT enable_eligible_cw_promotions($1) AS count', [job.partner_id]);
  await audit(db, system, 'cw.contract_verified', null, job.partner_id, {
    mode: job.mode, version: job.template_version, signing_id: job.id,
    document_sha256: pdfHash, evidence_sha256: reportHash, enabled_pending_codes: count,
  });
  return expiry <= new Date() ? 'expired' : 'verified';
}

export function fadadaSigningWorker(pool, cfg) {
  const settings = cfg.fadada, box = archiveVault(cfg);
  const client = settings && fadadaClient(settings, cfg.fadadaFetch);
  return async () => {
    if (!client) return false;
    return transaction(pool, async (db) => {
      const { rows: [job] } = await db.query(
        'SELECT *,ends_on::text AS ends_on FROM cw_fadada_signings j WHERE mode=$1 AND app_id=$2' +
        ' AND (next_check_at<=now() OR EXISTS(SELECT 1 FROM cw_fadada_notifications n WHERE n.signing_id=j.id))' +
        ' ORDER BY next_check_at NULLS LAST LIMIT 1 FOR UPDATE SKIP LOCKED', [settings.mode, settings.appId],
      );
      if (!job) return false;
      await db.query('SAVEPOINT fadada_check');
      try {
        const state = await signingResult(db, client, box, job, await readTask(client, job));
        const delay = state === 'verified' ? 86_400 : state === 'review' ? 3600 : ['starting','archiving'].includes(state) ? 30 : signable.includes(state) ? 300 : null;
        await db.query(
          'UPDATE cw_fadada_signings SET status=$2,attempts=0,last_error=NULL,' +
          ' next_check_at=CASE WHEN $3::int IS NULL THEN NULL ELSE clock_timestamp()+make_interval(secs=>$3) END,updated_at=now() WHERE id=$1',
          [job.id, state, delay],
        );
      } catch (err) {
        await db.query('ROLLBACK TO SAVEPOINT fadada_check');
        const code = err.vendorCode || (err.status === 409 ? 'task_mismatch' : 'check_unavailable');
        await db.query(
          'UPDATE cw_fadada_signings SET attempts=attempts+1,last_error=$2,' +
          ' next_check_at=clock_timestamp()+make_interval(secs=>$3),updated_at=now() WHERE id=$1',
          [job.id, code, Math.min(3600, 30 * 2 ** Math.min(job.attempts, 7))],
        );
      }
      await db.query('DELETE FROM cw_fadada_notifications WHERE signing_id=$1 AND received_at<=transaction_timestamp()', [job.id]);
      return true;
    });
  };
}
