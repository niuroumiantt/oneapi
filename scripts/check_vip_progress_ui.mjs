import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const root=process.argv[2];
assert.ok(root,'Pass the local web directory');
const profile=await mkdtemp('/private/tmp/oneapi-vip-chrome.');
const partnerId='1ac344ff-74f2-48aa-bca5-a55d9f694683';
const stamp='2026-11-25T03:10:06Z';
const lead={id:partnerId, status:'confirmed',legal_name:'测试客户',public_code:'VIPDEMOA',owner_subject:'sales-a',owner_name:'销售甲',invite_code:'SALESA',created_at:stamp,can_follow:true};
let role='sales', issued=null, approval=null, exception=null, quote, attempts=0, followups=[];
const payments=[];
let progress={eligible:false,total_fen:'500',shortfall_fen:'9500',required_fen:'10000'};let read=false;
issued={code:'VIPTESTB',customer_price_percent:50,usable:true,created_at:stamp};
const ordinary={id:'ordinary',out_trade_no:'TRIAGE-ORIGINAL',provider:'wechat_native',created_at:stamp,credited_at:stamp,paid_at:stamp,status:'paid',amount_fen:'5000',face_fen:'10000',promo_code:'TEST50',vip_payment:false,partner_id:partnerId};
const vipOrder={...ordinary,id:'vip-order',out_trade_no:'TRIAGE-VIP',amount_fen:'10000',face_fen:'20000',promo_code:'VIPTESTA',vip_payment:true};
const unmatched={...ordinary,id:'unmatched',out_trade_no:'TRIAGE-OTHER',partner_id:null,account_name:'另一测试账户',account_kind:'personal'};
const server=http.createServer(async (req,res)=>{
  const url=new URL(req.url,'http://localhost'), p=url.pathname;
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const readBody=async()=>{let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text);};
  if(p==='/api/staff/vip-notifications')return json({unread:read?0:1,items:[{id:'notice',partner_id:partnerId,public_code:'VIPDEMOA',legal_name:'测试客户',title:'新的 VIP 申请',next:'请尽快联系申请人，安排电话面试。',created_at:stamp,read_at:read?stamp:null}]});
  if(p==='/api/staff/vip-notifications/notice/read'){read=true;return json({ok:true});}
  if(p==='/embedded') {res.writeHead(200,{'Content-Type':'text/html'});return res.end(`<html><style>body{margin:0}iframe{border:0;width:100%;height:500px}</style><iframe title="VIP" src="/promotion/vip.html?staff=1&embedded=1&partner=${partnerId}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='vip-content-height')document.querySelector('iframe').style.height=e.data.height+'px'})</script></html>`);}
  if(p==='/api/cw/me')return json({totals:{},contracts:[],codes:[],payouts:[],invited:[],partner:lead,activation_progress:progress,owner_name:'销售甲',feedback:lead.status==='rejected'?'申请资料不完整，请联系负责员工补充。':null,task_codes:issued?[issued]:[]});
  if(p==='/api/staff/cw'){
    if(role==='guest')return json({error:'请先登录'},401);
    return json({enabled:true,finance:role==='admin',administrator:role==='admin',partners:[{...lead,discount_pending:approval?.status==='pending',activation_exception_pending:exception?.status==='pending'}],
      invite_codes:[{code:'SALESA',used_count:1,max_uses:4,status:'active',creator_name:'销售甲',created_at:stamp}],
      owners:role==='admin'?[{subject:'sales-a',name:'销售甲',email:'example@example.test'}]:[]});
  }
  if(p==='/api/staff/cw/order-lookup'){
    const order=[ordinary,vipOrder,unmatched].find(o=>o.out_trade_no===url.searchParams.get('out_trade_no'));
    if(!order || (!order.partner_id&&role!=='admin'))return json({error:'找不到订单'},404);
    return json({order});
  }
  if(p==='/api/staff/cw/'+partnerId)return json({partner:lead,activation_progress:progress,recharges:[vipOrder,ordinary],activation_exceptions:exception?[exception]:[],can_activate:progress.eligible,can_follow:true,finance:role==='admin',followups,task_codes:issued?[issued]:[],discount_requests:approval?[approval]:[],discount_payments:[],codes:[],contracts:[],orders:[],events:[],payouts:[],closes:[]});
  if(p==='/api/platform/me')return json({user:{name:'个人账号示例',email:'test@example.test',vip:false},organizations:[]});
  if(p==='/api/billing/personal')return json({list_credit_fen:'0',total_spent_fen:'0',payments_enabled:true,recharge:{channels:['alipay_f2f']},entries:[],packs:[]});
  if(p==='/api/customer-credit/status')return json({enabled:true,keys:[],models:[],base_url:'https://semifly.cn/v1'});
  if(p.startsWith('/api/'))return json({enabled:false},404);
  try{
    const file=path.join(root,p==='/'?'index.html':p),types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.webp':'image/webp'};
    const content=await readFile(file);
    res.writeHead(200,{'Content-Type':(types[path.extname(file)]||'application/octet-stream')+'; charset=utf-8'});
    res.end(content);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','about:blank'],{stdio:'ignore'});
let ws;
try {
  let port;
  for(let i=0;i<80&&!port;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{await delay(100);}}
  assert.ok(port,'Chrome CDP listening');
  const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let seq=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}};
  const cmd=(method,params={})=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}));});
  const ev=async expression=>{const {result,error}=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(error||result.exceptionDetails)throw Error(JSON.stringify(error||result.exceptionDetails));return result.result.value;};
  const ready=async x=>{for(let i=0;i<60;i++){if(await ev(x))return;await delay(60);}throw Error('Timed out: '+x+' '+String(await ev('document.body?.innerText')).slice(-500));};
  const open=async p=>{await cmd('Page.navigate',{url:origin+p});await delay(150);};
  const vp=async(width,height)=>cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await cmd('Page.enable');
  const shot=async name=>{
    const result=await cmd('Page.captureScreenshot',{format:'png'});
    await writeFile('/private/tmp/vip-progress-'+name+'.png',Buffer.from(result.result.data,'base64'));
  };
  const customer='/promotion/vip.html';
  const manage='/promotion/vip.html?staff=1&partner='+partnerId;
  const checks=[];
  await vp(1440,1000);
  lead.status='pending';issued=null;
  await open(customer);await ready("document.querySelector('.cw-steps')");
  assert.match(await ev("document.querySelector('.cw-next').textContent"),/当前无需付款/);
  assert.equal(await ev("document.querySelectorAll('[aria-current=step]').length"),1);
  await shot('pending-desktop');checks.push('submitted application shows current stage, owner and next step');
  await vp(390,844);await shot('pending-mobile');
  assert.ok(await ev('document.documentElement.scrollWidth<=innerWidth'));
  lead.status='confirmed';lead.confirmed_at=stamp;
  await ev("document.querySelector('[data-refresh-status]').click()");await ready("document.querySelector('.cw-progress h2')?.textContent.includes('等待发放')");
  issued={code:'VIPTESTB',customer_price_percent:50,usable:true,created_at:stamp};
  await delay(15500);await ready("document.querySelector('.cw-payment-card a')");checks.push('applicant status updates automatically without reload');
  assert.match(await ev("document.querySelector('.cw-payment-step').textContent"),/还差 ¥95.00/);
  await shot('payment-mobile');checks.push('partial recharge remains at recharge stage, with exact shortfall');
  progress={...progress,eligible:true,total_fen:'10000',shortfall_fen:'0'};
  await ev("document.querySelector('[data-refresh-status]').click()");await ready("document.querySelector('.cw-progress h2')?.textContent.includes('等待核验')");
  assert.equal(await ev("document.querySelectorAll('.cw-payment-card a').length"),0);
  assert.match(await ev("document.querySelector('.cw-next').textContent"),/无需再次付款/);checks.push('eligible payment shows staff review and removes redundant payment action');
  lead.status='rejected';await ev("document.querySelector('[data-refresh-status]').click()");await ready("document.querySelector('.cw-progress h2')?.textContent==='未通过'");
  assert.match(await ev("document.querySelector('.cw-progress').textContent"),/申请资料不完整/);
  assert.equal(await ev("document.querySelectorAll('[aria-current=step]').length"),0);checks.push('rejection feedback is visible without a misleading current step');
  lead.status='active';lead.activated_at=stamp;await ev("document.querySelector('[data-refresh-status]').click()");await ready("document.querySelector('.cw-progress h2')?.textContent==='VIP 已开通'");checks.push('activation completes the application flow');
  lead.status='pending';lead.confirmed_at=null;lead.activated_at=null;issued=null;role='admin';await vp(1440,1000);
  await open(manage);await ready("document.querySelector('[data-confirm]')");
  assert.ok(await ev("document.querySelector('[data-confirm]').getBoundingClientRect().top<innerHeight"));
  await shot('staff-desktop');
  await ready("document.querySelector('.vip-inbox:not([hidden])')");
  await ev("document.querySelector('.vip-inbox summary').click()");await ready("document.querySelector('[data-notice]')");
  assert.match(await ev("document.querySelector('.vip-inbox-items').textContent"),/电话面试/);
  await shot('notifications-desktop');
  await ev("document.querySelector('[data-notice]').click()");await delay(300);assert.ok(read);checks.push('staff notification badge opens actionable notice and marks it read');
  await open('/embedded');await ready("document.querySelector('iframe').contentDocument.querySelector('[data-confirm]')");await delay(400);
  assert.equal(await ev("getComputedStyle(document.querySelector('iframe').contentDocument.querySelector('#cw-content')).overflowY"),'visible');
  assert.ok(await ev("document.querySelector('iframe').clientHeight>=document.querySelector('iframe').contentDocument.querySelector('.cw-app').offsetHeight"));
  await shot('staff-embedded');checks.push('embedded client detail uses one outer page scroll');
  await vp(390,844);await delay(300);
  assert.ok(await ev("document.querySelector('iframe').contentDocument.documentElement.scrollWidth<=390"));
  await shot('staff-mobile');
  console.log(JSON.stringify({checks,screenshots:'/private/tmp/vip-progress-*.png'}));
} finally { ws?.close();chrome.kill();server.close(); }
