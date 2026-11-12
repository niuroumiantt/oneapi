// Early personal pilot (`sf_test_`) was retired 2026-11-12 (docs/14-gateway-settings.md L1).
// Status stays available so the personal console can hide the pilot UI; create/call return 410.
// Historical rows in pilot_api_keys / pilot_calls stay for cost reports; migration 058 revokes live keys.
// PILOT_DEEPSEEK_KEY_FILE in core.mjs remains for the employee official DeepSeek standby path — not this pilot.
import { HttpError } from './core.mjs';

const retired = () => { throw new HttpError(410, '早期试用 Key（sf_test_）已下线，请使用公司员工 Key（sf_emp_）'); };
const keyPattern = /^Bearer (sf_test_[A-Za-z0-9_-]{43})$/;

export function validatePilotRequest() { retired(); }
export function pilotUsage() { retired(); }

export function pilotInferenceRoutes(app, _pool, _cfg, requireCustomer) {
  app.get('/api/pilot/status', requireCustomer, async (_req, res) => {
    res.json({ enabled: false, retired: true, message: '早期试用 Key 已下线，请使用公司员工额度与 sf_emp_ Key' });
  });
  app.post('/api/pilot/keys', requireCustomer, async () => { retired(); });
  app.post('/api/pilot/keys/:key/revoke', requireCustomer, async () => { retired(); });
  // Leftover sf_test_ Bearer tokens: explicit 410. Anything else falls through.
  app.post('/v1/chat/completions', (req, _res, next) => {
    if (keyPattern.test(req.get('authorization') || '')) return next(new HttpError(410, '早期试用 Key（sf_test_）已下线，请使用公司员工 Key（sf_emp_）'));
    next('route');
  });
}
