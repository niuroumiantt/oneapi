import test from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../src/core.mjs';

test('private WeChat testing requires complete credentials and exactly one account',()=>{
 const env={DATABASE_URL:'postgres://test',BETTER_AUTH_SECRET:'x'.repeat(32),
  WECHATPAY_MCH_ID:'merchant',WECHATPAY_APP_ID:'app',WECHATPAY_CERT_SERIAL:'serial',
  WECHATPAY_PRIVATE_KEY_FILE:'private',WECHATPAY_PUBLIC_KEY_ID:'id',
  WECHATPAY_PUBLIC_KEY_FILE:'public',WECHATPAY_API_V3_KEY_FILE:'key',
  WECHATPAY_PILOT_ENABLED:'true'};
 for(const allowlist of ['', 'a@example.test,b@example.test'])
  assert.equal(config({...env,WECHATPAY_ALLOWED_EMAILS:allowlist}).wechat.pilotEnabled,false);
 const pilot={...env,WECHATPAY_ALLOWED_EMAILS:'a@example.test'};
 assert.equal(config(pilot).wechat.pilotEnabled,true);
 assert.equal(config(pilot).wechat.enabled,false);
 assert.equal(config({...pilot,WECHATPAY_APP_ID:''}).wechat.pilotEnabled,false);
 assert.equal(config({...pilot,WECHATPAY_ENABLED:'true'}).wechat.pilotEnabled,false);
});
