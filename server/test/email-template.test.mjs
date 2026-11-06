import test from 'node:test';
import assert from 'node:assert/strict';
import {accountEmail} from '../src/email-template.mjs';
test('account emails escape user text and URL attributes while preserving the plain-text action link',()=>{
 const url='https://oneapi.glocalstorage.cn/api/auth/verify-email?token=sample&callbackURL=%2F%23personal';
 const message=accountEmail({kind:'verify',name:'<img src=x onerror=alert(1)>',url});
 assert.ok(!message.html.includes('<img src=x'));
 assert.ok(message.html.includes('&lt;img'));
 assert.ok(message.html.includes('sample&amp;callbackURL='));
 assert.ok(message.text.includes(url));
 assert.ok(message.text.endsWith("semifly.ai, It's your API."));
 assert.throws(()=>accountEmail({kind:'verify',name:'Test',url:'javascript:alert(1)'}));
});
test('password reset keeps its purpose and one-hour expiry in both email alternatives',()=>{
 const message=accountEmail({kind:'reset',name:'小宇',url:'https://oneapi.glocalstorage.cn/?reset_token=sample#reset-password'});
 for(const value of [message.text,message.html]){assert.ok(value.includes('设置新密码'));assert.ok(value.includes('1 小时'));}
 assert.ok(!message.html.includes('验证邮箱，开启旅程'));
});
