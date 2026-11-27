/** Local-only review host. Never proxies production; illustrative data lives in memory. */
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {OFFICIAL_MODELS,publicCapabilities} from '../../server/src/official-models.mjs';
import {REFERENCE_PROVIDERS} from '../../server/src/compare-network.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const port=Number(process.env.STAFF_PREVIEW_PORT||3326);
const roles={operations:'员工身份',platform_admin:'老板身份'};
const stamp='2026-11-26T02:20:00.000Z';
const customers=[['c1','E26-示例01','示例 · 云帆科技','enterprise'],['c2','P26-示例02','示例 · 林同学','personal'],['c3','E26-示例03','示例 · 远山设计','enterprise']].map(([id,code,name,kind],i)=>({id,code,name,kind,email:`customer${i+1}@example.com`,tags:i===0?['重点客户']:[],stage:i===0?'following':'new',owner_subject:i===2?'other-demo':'demo',owner_name:i===2?'其他员工':'示例员工',list_credit_fen:180000,balance_fen:90000,recharged_fen:100000,credit_spent:0,credit_granted:0,calls_30d:24+i,last_call_at:stamp,created_at:stamp,open_tickets:1,members:3,organization_id:kind==='enterprise'?id:null}));
let tickets=[['t1','充值到账进度咨询','billing','open','first_line','c1'],['t2','客户端连接需要协助','question','in_progress','first_line','c2'],['t3','模型请求超时待排查','bug','in_progress','technical','c3']].map(([id,subject,category,status,tier,cid])=>({id,subject,category,status,tier,customer_id:cid,name:customers.find(c=>c.id===cid).name,customer_code:customers.find(c=>c.id===cid).code,email:'customer@example.com',created_at:stamp,body:'这是本地示例工单，用于检查处理流程。请协助核对并告知下一步。',replies:[]}));
const notes=new Map();
const promotionGrants=[];
const grantView=g=>({...g,state:g.status==='active'?(Date.parse(g.ends_at)<=Date.now()?'expired':Date.parse(g.starts_at)>Date.now()?'scheduled':'active'):g.status});
let answers=[{id:'a1',category:'question',question:'如何配置 API 接入地址？',answer:'在客户端中填写 API 接入地址，再使用自己的 API 密钥进行连接测试。',published:false,use_count:0}];
const financial={current:{month:'2026-11',accrual:{revenue:1200,upstream_cost:480,sales_cost:460,other_cost:20,gross_profit:720,operating_profit:720,channel_cost:0,credit_list:0,list_margin:0},cash:{received:2000,refunded:0,supplier_paid:600,channel_cost:0,net:1400,invoiced:0},balances:{customer_cash:800,credit_unused:0},by_product:[],by_customer:[],by_supplier:[]},series:[]};
const models=[{id:'model-demo',name:'示例模型',upstream_model:'demo-model',upstream:'示例供应商',routed:true,paused:false,input_yuan:2,output_yuan:6,calls:78,failed:0,yuan:12,last_call_at:stamp}];
const invoice={id:'i1',customer_id:'c1',customer_code:customers[0].code,customer_name:customers[0].name,title:'示例 · 云帆科技',direction:'output',invoice_type:'general',amount_fen:100000,status:'requested',created_at:stamp};
const transfer={id:'b1',customer_code:customers[0].code,customer_name:customers[0].name,customer_kind:'enterprise',cash_fen:100000,face_fen:200000,received_day:'2026-11-26',payer_name:customers[0].name,reference:'DEMO-ONLY-001',status:'pending',created_by:'other-demo',created_by_name:'示例同事',created_at:stamp};
const apiModels=OFFICIAL_MODELS.slice(0,3).map(m=>({id:m.id,name:m.name,family:m.family,tags:m.tags,uses:m.uses,capabilities:publicCapabilities(m,32768),input_yuan:m.rates.input,cached_yuan:m.rates.cached,output_yuan:m.rates.output,peak_multiplier:m.peakPricing?2:1}));
const apiKeys=[{id:'local-demo-key',label:'示例 · 我的客户端',key_hint:'DEMO01',created_at:stamp,model_ids:null,limit_yuan:null,used_yuan:'12.35',calls:128,tokens:45200}];
const apiCalls=Array.from({length:12},(_,i)=>({id:'local-call-'+i,key_label:'示例 · 我的客户端',model_id:apiModels[i%apiModels.length].id,status:i===2?'failed':'settled',charged_yuan:i===2?'0':'0.0125',hold_yuan:0,input_tokens:1000+i*50,cached_input_tokens:200,output_tokens:800,latency_ms:320+i*80,error_code:i===2?'upstream_timeout':null,client:'示例客户端',created_at:new Date(Date.parse(stamp)-i*3600000).toISOString()}));
const apiStatus=()=>({enabled:true,user_id:'local-demo-employee',organization_name:'Semifly · 本地示例公司',organization_id:'local-demo-company',granted_yuan:'50',spent_yuan:'12.35',held_yuan:'0.40',available_yuan:'37.25',month_yuan:'12.35',calls_30d:128,failed_30d:1,base_url:`http://127.0.0.1:${port}/v1`,model_ids:apiModels.map(m=>m.id),models:apiModels,key_limit:5,keys:apiKeys,recent_calls:apiCalls,daily:Array.from({length:7},(_,i)=>({day:'2026-11-'+(20+i),model_id:apiModels[0].id,calls:10+i*2,yuan:0.5+i*0.1}))});
const mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html','.png':'image/png','.webp':'image/webp'};
const privateFiles={'/api/staff/workspace/view':'workspace.html','/api/staff/workspace/console.js':'workspace.js','/api/staff/workspace/bridge.js':'workspace-bridge.js','/api/staff/select-menu.js':'select-menu.js','/api/staff/table-sort.js':'table-sort.js'};
const rootHtml=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Semifly 员工工作台 · 本地评审</title><link rel="stylesheet" href="/site-header.css"><link rel="stylesheet" href="/console.css"><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}.preview-bar{position:fixed;inset:0 0 auto;height:42px;z-index:200;background:#edf1f6;border-bottom:1px solid #d5dce7;color:#3b4658;display:flex;align-items:center;gap:18px;padding:0 24px;font-size:13px}.preview-bar a{color:inherit;text-decoration:none;padding:4px 6px}.preview-bar a[aria-current]{font-weight:700;text-decoration:underline;text-underline-offset:5px}body.console-active>#previewBar{display:flex!important}#console-view{top:42px}.preview-bar nav{display:flex;gap:4px}.preview-bar span{margin-right:auto}.site-footer{display:flex;gap:18px;padding:12px 24px;color:#626875;font-size:12px;border-top:1px solid #e7e9ed}.site-footer a{margin-left:auto;color:inherit}.site-header-main{display:flex!important}.site-header .site-brand{width:auto}.site-header .site-account{margin-left:auto}.site-tools{min-height:45px}.preview-bar a:focus-visible{outline:2px solid #455d83}@media(max-width:650px){.preview-bar{height:70px;padding:8px 16px;flex-wrap:wrap;gap:2px}.preview-bar span{width:100%}#console-view{top:70px}.site-header .site-header-main{min-height:60px;padding-top:0}}</style><div class="preview-bar" id="previewBar" style="display:flex!important"><span><strong>本地评审</strong> · 示例数据 · 操作不触及真实业务</span><nav aria-label="本地示例身份">${Object.entries(roles).map(([key,label])=>`<a href="/?identity=${key==='platform_admin'?'owner':'employee'}#console/${key==='platform_admin'?'owner/overview':'business/home'}" data-role="${key}">${label}</a>`).join('')}</nav></div><script src="/site-header.js"></script><script src="/console.js"></script><script>const role=new URLSearchParams(location.search).get('identity')==='owner'?'platform_admin':'operations';document.querySelector('[data-role="'+(Object.keys(${JSON.stringify(roles)}).includes(role)?role:'platform_admin')+'"]').setAttribute('aria-current','page');function route(){if(!location.hash.startsWith('#console/'))location.hash='console/business/home';else ConsoleUI.render(location.hash.slice(1));}addEventListener('hashchange',route);route();</script></html>`;
http.createServer(async(req,res)=>{
 const origin=`http://127.0.0.1:${port}`;
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)||req.headers.origin&&!['http://'+req.headers.host].includes(req.headers.origin)){res.writeHead(403);return res.end('Local access only');}
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'");
 const url=new URL(req.url,origin),p=url.pathname;
 let role=(req.headers.cookie||'').match(/(?:^|;\s*)previewRole=(\w+)/)?.[1]||'operations';
 if(!roles[role])role='operations';
 const finance=role==='platform_admin',staff={name:finance?'示例老板':'示例员工',role,finance,admin:role==='platform_admin',technical:false};
 const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 const html=body=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(body);};
 try{
 if(p==='/'){const chosen=url.searchParams.get('identity')==='owner'?'platform_admin':'operations';res.setHeader('Set-Cookie',`previewRole=${chosen}; Path=/; HttpOnly; SameSite=Strict`);return html(url.searchParams.get('entry')==='legacy'?await readFile(path.join(root,'web/index.html'),'utf8'):rootHtml);}
 if(['/compare.html','/employee-api.html'].includes(p))return html(await readFile(path.join(root,'web',p.slice(1)),'utf8'));
 if(p==='/promotion/vip.html')return html('<!doctype html><meta charset="utf-8"><style>body{font:15px/1.8 system-ui;padding:32px;color:#343d50}h2{font-size:22px}</style><h2>VIP 招募与客户档案</h2><p>本地评审保留此业务入口；本轮未接入 VIP 独立工作台的数据与操作。</p><p>可返回左侧“商务概览”查看业务结构。</p>');
 if(url.searchParams.get('surface')==='owner'&&!finance)return json({error:'老板工作台需要独立的老板身份'},403);
 if(privateFiles[p]){res.setHeader('Content-Type',(mime[path.extname(privateFiles[p])]||'text/plain')+'; charset=utf-8');return res.end(await readFile(path.join(root,'server/private',privateFiles[p])));}
 if(/^\/[a-z0-9-]+\.(js|css|svg|png|webp)$/.test(p)){res.setHeader('Content-Type',mime[path.extname(p)]);return res.end(await readFile(path.join(root,'web',p.slice(1))));}
 if(p==='/api/platform/me')return json({
  user:{id:'local-demo-employee',name:staff.name},
  organizations:[{id:'local-demo-company',name:'本地示例公司',role:finance?'owner':'member',company_workspace:finance?'owner':'employee'}],
  personal_assets:false,backoffice:{business:true,technical:finance},
 });
 const api=p.replace('/api/staff/','');
 const myCustomers=finance?customers:customers.filter(c=>c.owner_subject==='demo');
 const myTickets=tickets.filter(t=>myCustomers.some(c=>c.id===t.customer_id));
 if(!finance&&/^(business\/(finance|invoices|bank-transfers|supplier-payments|suppliers)|workspace\/(business|overview)|payments\/)/.test(api))return json({error:'当前示例岗位没有财务权限'},403);
 if(!finance&&req.method==='GET'&&api==='business/discounts')return json({error:'公司折扣管理需要老板身份'},403);
 if(req.method!=='GET'){
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)return json({error:'内容过长'},413);}const b=JSON.parse(raw||'{}');
  if(req.method==='POST'&&api==='business/discounts'){
   // Local simulation of the existing direct-code rules, not financial privileges.
   if(b.business_line!=='direct')return json({error:'此预览只支持客户推广码申请'},403);
   const promo=String(b.promo_code||'').normalize('NFKC').trim().toUpperCase(),percent=Number(b.customer_price_percent),minimum=String(b.min_cash_yuan??'0'),starts=Date.parse(b.starts_at),ends=Date.parse(b.ends_at);
   if(!/^(?:[A-Z]{8}|\p{Script=Han}{8})$/u.test(promo))return json({error:'推广码须为 8 个英文字母或 8 个中文字符'},400);
   if(!b.name?.trim()||b.name.length>100||!b.reason?.trim()||b.reason.length>500)return json({error:'请填写用途名称和申请原因'},400);
   if(!Number.isInteger(percent)||percent<1||percent>99||!/^\d+(?:\.\d{1,2})?$/.test(minimum)||Number(minimum)>50000)return json({error:'请核对折扣比例与最低实付金额'},400);
   if(b.audience!=='all'||b.model_id||b.cap_yuan!=null&&b.cap_yuan!==''||b.non_refundable!==undefined&&typeof b.non_refundable!=='boolean')return json({error:'推广码适用于全部产品，请核对申请内容'},400);
   if(!Number.isFinite(starts)||!Number.isFinite(ends)||ends<=starts||ends-starts>366*86400000||ends<=Date.now())return json({error:'有效期须在一年以内且结束晚于现在和开始日期'},400);
   if(promotionGrants.some(g=>g.promo_code===promo))return json({error:'此码已被使用或保留，请换一个码'},409);
   const status=finance||percent===50&&!b.non_refundable&&Number(minimum)===0?'active':'pending',creator=finance?'demo-owner':'demo';
   const grant={id:randomUUID(),name:b.name.trim(),reason:b.reason.trim(),promo_code:promo,business_line:'direct',audience:'all',customer_price_percent:percent,min_cash_fen:Math.round(Number(minimum)*100),non_refundable:b.non_refundable===true,starts_at:new Date(starts).toISOString(),ends_at:new Date(ends).toISOString(),status,created_by:creator,created_by_name:staff.name,created_at:new Date().toISOString(),customers:0,paid_fen:0,decided_at:status==='active'?new Date().toISOString():null};
   promotionGrants.unshift(grant);return json({id:grant.id,status},201);
  }
  const decision=api.match(/^business\/discounts\/([^/]+)\/(approve|reject|revoke)$/);
  if(req.method==='POST'&&decision){
   const [,grantId,action]=decision,grant=promotionGrants.find(g=>g.id===grantId),subject=finance?'demo-owner':'demo';
   if(!finance&&action!=='revoke')return json({error:'客户推广申请由老板审批'},403);
   if(!grant||!finance&&grant.created_by!==subject)return json({error:'推广码不存在或不属于你'},404);
   if(Date.parse(grant.ends_at)<=Date.now())return json({error:'推广码已过期，不能恢复或复用'},409);
   if(action==='revoke'?grant.status!=='active':grant.status!=='pending')return json({error:'这条申请已处理或当前状态不支持此操作'},409);
   if(action!=='revoke'&&grant.created_by===subject)return json({error:'不能审批自己的申请'},409);
   if(action==='reject'&&!b.note?.trim())return json({error:'请填写驳回原因'},400);
   Object.assign(grant,{status:{approve:'active',reject:'rejected',revoke:'revoked'}[action],decided_at:new Date().toISOString(),decided_by:subject,decided_by_name:staff.name,decision_note:b.note||''});return json({id:grant.id,status:grant.status});
  }
  if(api==='self-api/keys'){
   if(!b.label?.trim()||b.label.length>50)return json({error:'请填写用途名称'},400);
   if(apiKeys.filter(k=>!k.revoked_at).length>=5)return json({error:'最多保留5枚有效Key'},409);
   if(b.limit_yuan!=null&&(!Number.isFinite(Number(b.limit_yuan))||Number(b.limit_yuan)<=0||Number(b.limit_yuan)>37.25))return json({error:'消费上限超过公司可用额度'},400);
   const k={id:randomUUID(),label:b.label,key_hint:'DEMO02',created_at:new Date().toISOString(),model_ids:b.models||null,limit_yuan:b.limit_yuan,used_yuan:0,calls:0,tokens:0};apiKeys.push(k);return json({key:k,secret:'local_demo_not_a_real_api_key_'+randomUUID(),show_once:true},201);
  }
  const apiKey=api.match(/^self-api\/keys\/([^/]+)\/(manage|revoke)$/);
  if(apiKey){const k=apiKeys.find(k=>k.id===apiKey[1]);if(!k)return json({error:'Key不存在'},404);if(apiKey[2]==='revoke')k.revoked_at=new Date().toISOString();else{if(b.limit_yuan!=null&&Number(b.limit_yuan)>37.25+Number(k.used_yuan||0))return json({error:'消费上限超过公司可用额度'},409);k.label=b.label;k.limit_yuan=b.limit_yuan;}return json({ok:true});}
  const ticket=api.match(/^business\/tickets\/([^/]+)\/(reply|triage)$/);
  if(ticket){const t=tickets.find(t=>t.id===ticket[1]);if(!t||!finance&&!customers.some(c=>c.id===t.customer_id&&c.owner_subject==='demo'))return json({error:'工单不存在或不在你的负责范围内'},404);if(ticket[2]==='triage'){t.category=b.category;t.tier=b.tier;}else{t.replies.push({body:b.body,created_by_name:'示例员工',created_at:new Date().toISOString()});t.status=b.close?'closed':'in_progress';}return json({ok:true});}
  const customer=api.match(/^business\/customers\/([^/]+)(\/notes)?$/);
  if(customer){const c=customers.find(c=>c.id===customer[1]);if(!c||!finance&&c.owner_subject!=='demo')return json({error:'客户不存在或不在你的负责范围内'},404);if(!finance&&!customer[2]&&(b.owner_subject!==c.owner_subject||JSON.stringify(b.tags)!==JSON.stringify(c.tags)))return json({error:'客户归属和优惠分群由老板管理'},403);if(customer[2])notes.set(c.id,[...(notes.get(c.id)||[]),{body:b.body,created_by_name:'示例员工',created_at:new Date().toISOString()}]);else Object.assign(c,{stage:b.stage,owner_subject:b.owner_subject,tags:b.tags});return json({ok:true});}
  return json({error:'此操作未接入本地评审；未写入任何真实业务数据。'},409);
 }
 if(api==='self-api/usage/chart')return json({time_zone:'Asia/Shanghai',models:apiModels.map(({id,name})=>({id,name})),days:Array.from({length:90},(_,i)=>({date:new Date(Date.now()-(89-i)*86400000).toISOString().slice(0,10),values:apiModels.map((_,j)=>String((i+j)%4?1000+i*40:0)),total:String(apiModels.reduce((n,_,j)=>n+((i+j)%4?1000+i*40:0),0))})),unreported_calls:'0'});
 if(api==='self-api/usage'||api==='self-api/usage/calls'){
  const period=url.searchParams.get('period')||'month',page=Number(url.searchParams.get('page')||0),size=Number(url.searchParams.get('size')||3);
  const items=apiCalls.map(c=>({...c,model_name:apiModels.find(m=>m.id===c.model_id)?.name,key_hint:'DEMO01',cash_fen:c.status==='settled'?'1':null}));
  if(api.endsWith('/calls'))return json({period,page,has_more:items.length>(page+1)*size,items:items.slice(page*size,(page+1)*size)});
  const sum=rows=>({calls:rows.length,input_tokens:rows.reduce((n,c)=>n+c.input_tokens,0),output_tokens:rows.reduce((n,c)=>n+c.output_tokens,0),cash_fen:Math.floor(rows.reduce((n,c)=>n+Number(c.charged_yuan||0),0)*100),unsettled_calls:0});
  return json({period,totals:sum(apiCalls),models:apiModels.map(m=>({id:m.id,name:m.name,...sum(apiCalls.filter(c=>c.model_id===m.id))})),keys:[{id:'local-demo-key',name:'示例 · 我的客户端',key_hint:'DEMO01',...sum(apiCalls)}]});
 }
 if(api==='self-api/status')return json(apiStatus());
 if(api==='self-api/compare/config')return json({products:[{account_id:'local-demo-company',name:'公司分配额度 · 示例',kind:'allocated',available_yuan:'37.25',model_ids:apiModels.map(m=>m.id)}],models:apiModels,providers:REFERENCE_PROVIDERS,reference_prices:[],max_file_bytes:8000000,max_files:5,max_output_tokens:8192,timeout_seconds:180});
 if(api==='workspace/access')return json({business:true,owner:finance,technical:false,finance});
 if(api==='business/dashboard'&&!finance)return json({staff,counts:{tickets:myTickets.filter(t=>t.status!=='closed'&&t.tier==='first_line').length,tickets_technical:myTickets.filter(t=>t.status!=='closed'&&t.tier==='technical').length,my_customers:myCustomers.length,vip_pending:0,vip_confirmed:0,vip_discount_pending:0,vip_activation_exception_pending:0},top_customers:[],finance:null});
 if(api==='business/dashboard')return json({staff,counts:{tickets:myTickets.filter(t=>t.status!=='closed'&&t.tier==='first_line').length,tickets_technical:myTickets.filter(t=>t.status!=='closed'&&t.tier==='technical').length,upgrades:0,vip_pending:0,vip_discount_pending:0,vip_activation_exception_pending:0,discounts_pending:promotionGrants.filter(g=>g.status==='pending').length,models_paused:0,enterprises:2,individuals:1,customers_new_30d:3,users_active_30d:3,suppliers:0,discounts_active:promotionGrants.filter(g=>grantView(g).state==='active').length,...(finance?{invoices_requested:1,bank_transfers_pending:1,refunds_pending:0}:{})},top_customers:finance?customers:[],finance:finance&&!url.searchParams.has('summary')?financial:null});
 if(api==='business/support')return json({tickets:myTickets,answers});
 if(api==='business/customers')return json({customers:myCustomers,tags:[{tag:'重点客户',customers:1}],staff:[{subject:'demo',name:'示例员工'}]});
 if(api.startsWith('business/customers/')){const c=myCustomers.find(c=>c.id===api.split('/')[2]);return c?json({customer:c,notes:notes.get(c.id)||[],members:[],tickets:myTickets.filter(t=>t.customer_id===c.id),discounts:[],finance:finance?{invoice_limit:{available_fen:100000},orders:[],invoices:[]}:null}):json({error:'客户不存在'},404);}
 if(api==='business/finance')return json(financial);
 if(api==='business/invoices')return json({output:[invoice],input:[],suppliers:[]});
 if(api==='business/bank-transfers')return json({entries:[transfer],notices:[],current_subject:'demo',can_self_review:staff.admin});
 if(api==='business/supplier-payments')return json({payments:[],suppliers:[]});
 if(api==='payments/orders')return json({orders:[],requests:[]});
 if(api==='cw')return json({enabled:true,administrator:staff.admin,partners:[],invite_codes:[],owners:[]});
 if(api==='business/acquisition')return json({administrator:staff.admin,owners:[{subject:'demo',name:'示例员工'}],partners:[],grants:promotionGrants.filter(g=>finance||g.created_by==='demo').map(grantView),codes:[],orders:[],vip_orders:[],customers:[],commissions:[],stats:{}});
 if(api==='business/discounts')return json({grants:[],models:[],campaigns:[],customers,segments:[],admin:staff.admin});
 if(api==='business/suppliers')return json({suppliers:[]});
 if(api==='workspace/business')return json({models,upgrades:[]});
 if(api==='workspace/overview')return json({suppliers:[],reports:[],products:[],listings:[],can_manage:false});
 return json({error:'此入口未接入本地评审'},404);
 }catch(e){if(e.code==='ENOENT')return json({error:'文件不存在'},404);console.error(e.message);json({error:'本地示例读取失败'},500);}
}).listen(port,'127.0.0.1',()=>console.log(`Local employee preview: http://127.0.0.1:${port}/#console/business/home (sample data only)`));
