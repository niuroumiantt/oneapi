import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './core.mjs';

export const companyName = '深圳市格洛可半导体有限公司';
const algorithm = 'HMAC-SHA256';
// FASC OpenAPI Node SDK v5.4.7 uses epoch milliseconds and signs the SHA-256 hex digest of sorted fields.
export function fascSign(params, secret) {
  const canonical = Object.keys(params).sort().map((key) => key + '=' + params[key]).join('&');
  const key = createHmac('sha256', secret).update(String(params['X-FASC-Timestamp'])).digest();
  return createHmac('sha256', key).update(createHash('sha256').update(canonical).digest('hex')).digest('hex');
}

const relevantEvents = new Set([
  'sign-task-start', 'sign-task-joined', 'sign-task-signed', 'sign-task-sign-rejected',
  'report-download', 'sign-task-finished', 'sign-task-canceled', 'sign-task-expire', 'sign-task-abolish',
]);

export function fascEvent(req, cfg, now = Date.now()) {
  const appId = req.get('X-FASC-App-Id'), signType = req.get('X-FASC-Sign-Type');
  const time = req.get('X-FASC-Timestamp'), nonce = req.get('X-FASC-Nonce');
  const event = req.get('X-FASC-Event'), sign = req.get('X-FASC-Sign');
  const bizContent = req.body?.bizContent;
  if (appId !== cfg.appId || signType !== algorithm || !/^\d{13}$/.test(time || '') ||
      Math.abs(Number(time) - now) > 300_000 ||
      !nonce || nonce.length > 32 || !event || !/^[a-f0-9]{64}$/i.test(sign || '') ||
      typeof bizContent !== 'string')
    throw new HttpError(401, '签署通知认证失败');
  const expected = fascSign({
    'X-FASC-App-Id': appId, 'X-FASC-Sign-Type': signType, 'X-FASC-Timestamp': time,
    'X-FASC-Nonce': nonce, 'X-FASC-Event': event, bizContent,
  }, cfg.secret);
  if (!timingSafeEqual(Buffer.from(sign, 'hex'), Buffer.from(expected, 'hex')))
    throw new HttpError(401, '签署通知认证失败');
  if (!relevantEvents.has(event)) return null;
  let data;
  try { data = JSON.parse(bizContent); } catch { throw new HttpError(400, '签署通知格式不正确'); }
  const report = event === 'report-download';
  if (report && data?.reportType !== 'evidence_report') return null;
  const reference = report ? data?.reportDownloadId : data?.signTaskId;
  if (!vendorId(reference)) throw new HttpError(400, '法大大通知编号格式不正确');
  return { report, reference, key: expected };
}

export const vendorId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export const corp = (openId) => ({ idType: 'corp', openId });

export function fadadaClient(cfg, fetcher = fetch) {
  let token, refresh;
  async function post(path, data, accessToken) {
    const fields = {
      'X-FASC-App-Id': cfg.appId,
      'X-FASC-Sign-Type': algorithm,
      'X-FASC-Timestamp': String(Date.now()),
      'X-FASC-Nonce': randomBytes(16).toString('hex'),
      'X-FASC-Api-SubVersion': '5.1',
    };
    if (accessToken) fields['X-FASC-AccessToken'] = accessToken;
    else fields['X-FASC-Grant-Type'] = 'client_credential';
    const form = data ? { bizContent: JSON.stringify(data) } : {};
    const response = await fetcher(cfg.gateway + path, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: {
        ...fields, 'X-FASC-Sign': fascSign({ ...fields, ...form }, cfg.secret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form),
    });
    const payload = await response.json();
    if (!response.ok || String(payload.code) !== '100000') {
      const err = new HttpError(502, '法大大暂未完成此操作，请稍后重试');
      if (/^\d{6}$/.test(String(payload.code))) err.vendorCode = String(payload.code);
      throw err;
    }
    return payload.data;
  }
  async function access() {
    if (token?.until > Date.now()) return token.value;
    refresh ??= post('/service/get-access-token').then((data) => {
      if (!data?.accessToken) throw new HttpError(502, '无法取得法大大应用凭证');
      const seconds = Number(data.expiresIn);
      token = { value: data.accessToken, until: Date.now() + Math.min(900, Math.max(0, seconds - 30)) * 1000 };
      return token.value;
    }).finally(() => { refresh = null; });
    return refresh;
  }
  async function call(path, data) {
    const current = await access();
    try {
      return await post(path, data, current);
    } catch (err) {
      if (err.vendorCode !== '100002') throw err;
      if (token?.value === current) token = null;
      return post(path, data, await access());
    }
  }
  function url(value, extraHosts = new Set()) {
    const u = URL.parse(value ?? '');
    if (!u || u.protocol !== 'https:' || u.port || u.username || u.password ||
        !(u.hostname === 'fadada.com' || u.hostname.endsWith('.fadada.com') || extraHosts.has(u.hostname)))
      throw new HttpError(502, '法大大返回的链接地址未获信任');
    return u.href;
  }
  async function download(value, limit, header) {
    const response = await fetcher(url(value, cfg.downloadHosts), {
      redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok || !response.body) throw new HttpError(502, '法大大归档文件尚不可用');
    const reader = response.body.getReader(), parts = [];
    let size = 0;
    try {
      for (;;) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        size += chunk.length;
        if (size > limit) throw new HttpError(502, '法大大归档文件超出大小上限');
        parts.push(chunk);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const file = Buffer.concat(parts, size);
    if (!file.subarray(0, header.length).equals(header))
      throw new HttpError(502, '法大大归档文件格式不正确');
    return file;
  }
  return { call, url, download };
}
