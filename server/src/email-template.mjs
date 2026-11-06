const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function accountEmail({kind,name,url}){
 const target=new URL(url);
 if(!['https:','http:'].includes(target.protocol))throw new Error('Invalid email link');
 const reset=kind==='reset',greeting=name?`${name}，你好。`:'你好。';
 const title=reset?'找回密码，继续你的探索。':'欢迎登船，你的灵感在这里启程。';
 const intro=reset?'偶尔忘记密码也没关系，设置一个新的，就能回到自己的空间。':'选一个喜欢的模型，把“如果可以”变成“已经做到”。';
 const action=reset?'设置新密码':'验证邮箱，开启旅程';
 const instruction=reset?'这个重设链接在 1 小时内有效。':'请在 1 小时内验证邮箱，我们就能为你准备好自己的空间。';
 const footer="semifly.ai, It's your API.";
 const text=`${greeting}\n\n${title}\n${intro}\n\n${instruction}\n${action}：\n${url}\n\n如果这不是你的操作，忽略这封邮件即可。\n\n${footer}`;
 const html=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#F5F3ED;color:#1C2541;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:auto;background:#fffdf8;border-radius:20px"><tr><td style="padding:36px 32px 22px"><img src="${escapeHtml(target.origin)}/semifly-email-logo.png" width="190" alt="semifly.ai" style="display:block;width:190px;max-width:100%;height:auto;border:0"><p style="color:#818697;font-size:10px;letter-spacing:2px;margin:12px 0 28px">YOUR NEXT LITTLE BIG IDEA</p><p style="font-size:14px;line-height:1.8">${escapeHtml(greeting)}</p><h1 style="font-size:25px;line-height:1.6;font-weight:600;margin:16px 0">${title}</h1><p style="font-size:14px;line-height:1.9;color:#606b80">${intro}</p><p style="font-size:13px;line-height:1.9;color:#606b80;margin-top:25px">${instruction}</p><table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td bgcolor="#1C2541" style="border-radius:9px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:15px 24px;color:#fff5e7;font-size:14px;font-weight:600;text-decoration:none">${action} →</a></td></tr></table><p style="font-size:12px;line-height:1.9;color:#858b99">按钮打不开？<a href="${escapeHtml(url)}" style="color:#1C2541">点击这里继续</a>，或使用邮件的纯文本版本。<br>如果这不是你的操作，忽略这封邮件即可。</p></td></tr><tr><td style="padding:22px 32px 28px;border-top:1px solid #ede9df;font-size:13px;font-weight:600;color:#1C2541">semifly.ai, It's your <span style="color:#E43C2F">A</span>P<span style="color:#E43C2F">I</span>.</td></tr></table></td></tr></table></body></html>`;
 return {subject:reset?'重设密码 · semifly.ai':'欢迎登船，请验证你的邮箱 · semifly.ai',text,html};
}
