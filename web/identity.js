/* Real identities and organizations. No demo role selector is used by this module. */
(() => {
 'use strict';
 const customerRoles={owner:'企业管理者',admin:'企业管理者',billing:'企业管理者',department_admin:'企业成员',member:'企业成员'};
 const staffRoles={platform_admin:'平台管理员',operations:'商务',supply:'商务',finance:'商务',support:'商务',pending:'未开通'};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ico=n=>`<span data-icon="${n}"></span>`;
 const modelIntentKey='semifly.model-intent.v1';
 const modelIntentNames=Object.fromEntries((window.SemiflyModels||[]).map(m=>[m.id,m.name]));
 function readModelIntent(){try{const intent=JSON.parse(localStorage.getItem(modelIntentKey)||'null'),age=Date.now()-intent?.at;return intent&&['personal','enterprise'].includes(intent.scope)&&Number.isFinite(age)&&age>=0&&age<7*86400000&&((intent.scope==='personal'&&intent.id==='all')||(window.SemiflyModels||[]).some(m=>m.id===intent.id))?intent:null;}catch{return null;}}
 function chooseModelIntent(id,scope){if(!((scope==='personal'&&id==='all')||(window.SemiflyModels||[]).some(m=>m.id===id))||!['personal','enterprise'].includes(scope))return false;try{localStorage.setItem(modelIntentKey,JSON.stringify({id,scope,at:Date.now()}));}catch{}return true;}
 function modelIntentNote(scope){const intent=readModelIntent(),model=(window.SemiflyModels||[]).find(m=>m.id===intent?.id);return intent?.scope===scope&&model?`<p class="model-intent">已选择 <b>${esc(model.name)}</b>，登录后继续配置。 <a href="#market">返回模型广场 ${ico('arrow-right')}</a></p>`:'';}

 let host,current='account',authMode='login',generation=0,lastOrg=null,lastOrgBilling=null,joinPreview=null,me=null,staff=null,staffList=[],customers=[],sessions=[],resetToken=new URL(location.href).searchParams.get('reset_token'),supplyData={suppliers:[],offers:[]},offerDetail=null,promotionData={campaigns:[],products:[]},pricingData={products:[],proposals:[],decisions:[]},reviewData={products:[],reviews:[]},resetScrollOnMount=false;
 const opsPageCache=new Map();
 if(resetToken)history.replaceState(null,'',location.pathname+'#reset-password');
 const handles=v=>['workspace','enterprise-register','enterprise-login','register','personal','personal/models','personal/keys','personal/usage','personal/compare','personal/vip','enterprise','account','reset-password','staff','staff-account','admin','security','demo/personal','upgrade','support'].includes(v)||v.startsWith('personal/connect/')||personalBillingRoute(v)||v.startsWith('billing/organization/')||v.startsWith('demo/organization/')||v.startsWith('organization/')||v.startsWith('join/')||v.startsWith('ops/');
 let orgLoadedAt=0,panelDataAt=0,modelHealth=null,modelHealthAt=0,modelHealthTried=0,modelHealthLoading=false;
 async function api(path,body,method){if(body||method){orgLoadedAt=0;panelDataAt=0;lastOrgBilling=null;}const r=await fetch(path,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'});let data;try{data=await r.json();}catch{data={};}if(!r.ok){const err=Error(data.error||translate(data.code,data.message)||'暂时无法完成，请稍后重试。');err.status=r.status;err.code=data.code;throw err;}return data;}
 async function customerSignedIn(){try{return !!(await api('/api/platform/me')).user;}catch(e){return e.status!==401;}}
 function translate(code,message){const known={SESSION_NOT_FRESH:'查看登录设备前，请退出后重新登录以验证身份。',INVALID_EMAIL_OR_PASSWORD:'邮箱或密码不正确。',EMAIL_NOT_VERIFIED:'请先到邮箱完成验证；可重发验证邮件。',PASSWORD_POLICY:'密码须为 8–128 位，包含大写字母、小写字母和符号。',PASSWORD_TOO_SHORT:'密码至少需要 8 个字符。',PASSWORD_TOO_LONG:'密码不能超过 128 个字符。',INVALID_TOKEN:'链接无效或已经过期，请重新申请。',INVALID_PASSWORD:'当前密码不正确。',TOO_MANY_REQUESTS:'操作频繁，请稍后重试。',USER_ALREADY_EXISTS:'该邮箱已注册，请直接登录；忘记密码请点击「找回密码」。',USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:'该邮箱已注册，请直接登录；忘记密码请点击「找回密码」。',EMAIL_ALREADY_VERIFIED:'邮箱已经验证，无需再等验证邮件，请直接登录。'};return known[code]||(message&&/^[\u3400-\u9fff]/.test(message)?message:'操作未完成，请检查输入或稍后重试。');}
 const btn=(label,action,attrs='',kind='')=>`<button class="live-button ${kind}" data-live="${action}" ${attrs}>${label}</button>`;
 const accountMenu=(...args)=>window.SiteHeader.accountMenu(...args);
 function contextKind(){
  if(['staff','staff-account','admin'].includes(current)||current.startsWith('ops/'))return 'staff';
  if(['enterprise','enterprise-register','enterprise-login'].includes(current)||current.startsWith('organization/')||current.startsWith('billing/organization/')||current.startsWith('demo/organization/')||current.startsWith('join/'))return 'enterprise';
  return 'personal';
 }
 // 客户只有一个身份入口，这里只给内部员工标明当前身份。
 function contextIndicator(){
  if(contextKind()!=='staff')return '';
  return `<div class="workspace-context workspace-context-staff" aria-label="当前身份：${esc(staffRoles[staff?.role]||'员工身份')}，平台内部"><i aria-hidden="true"></i><span><small>当前身份 · ${esc(staffRoles[staff?.role]||'员工身份')}</small><strong>平台内部</strong></span></div>`;
 }
 function header(){
  const kind=contextKind();
  const nav=kind==='staff'?(staff?`<a href="#staff-account">员工工作台</a>${(staff.role==='platform_admin'||staff.technical_access)?'<a href="#console/technical/overview">技术运维</a>':''}`:''):'<a href="#universe">首页</a><a href="#market">模型广场</a><a href="#workspace">工作台</a>';
  return window.SiteHeader.render('workspace',{className:'live-header',account:accountMenu(staff||me?.user,staff?'staff':'customer'),tools:kind==='staff'?contextIndicator()+`<nav>${nav}</nav>`:''});
 }
 let publicTicket=0;
 async function refreshPublic(){
  const ticket=++publicTicket;let customer=null,employee=null;
  try{customer=await api('/api/platform/me');}catch(e){if(e.status===401)try{employee=(await api('/api/staff/me')).staff;}catch{}}
  if(ticket!==publicTicket||document.body.classList.contains('identity-active'))return;
  document.querySelectorAll('[data-account-slot]').forEach(slot=>slot.innerHTML=accountMenu(customer?.user||employee,customer?'customer':'staff'));
  const label=document.getElementById('welcome-continue-label');if(label)label.textContent=customer||employee?'进入工作台':'登录 / 注册';const link=document.getElementById('welcome-continue');if(link)link.href=employee?'#staff-account':'#workspace';const help=document.querySelector('.welcome-preview-note');if(help)help.textContent=customer||employee?'你已登录':'个人和企业用同一个账号，登录后按权限显示功能。';
 }
 function sameWorkspaceFrame(previous,next){
  const a=previous.querySelector('.workspace-compare-frame'),b=next.querySelector('.workspace-compare-frame');
  return Boolean(a&&b&&a.getAttribute('src')===b.getAttribute('src'));
 }
 function mount(content){
  const wasIdentityActive=document.body.classList.contains('identity-active');
  host.classList.toggle('org-dashboard',current.startsWith('organization/'));host.classList.toggle('supply-dashboard',current.startsWith('ops/supply')||current==='ops/products'||current==='ops/payments'||current==='ops/promotions');host.classList.toggle('invite-dashboard',current.startsWith('join/'));host.classList.toggle('enterprise-dashboard',['enterprise','enterprise-login','enterprise-register'].includes(current)&&!!me);host.classList.toggle('auth-dashboard',content.includes('class="live-auth-layout"'));
  const existing=host.querySelector('.supply-shell');
  const template=document.createElement('template');template.innerHTML=content;
  const next=template.content.querySelector('.supply-shell');
  const oldPanel=host.querySelector('.personal-console'),newPanel=template.content.querySelector('.personal-console');
  if(wasIdentityActive&&oldPanel&&newPanel&&oldPanel.dataset.workspaceScope===newPanel.dataset.workspaceScope){
   // Keep the chrome mounted; asynchronous data must not rebuild the whole workspace.
   const newHeader=newPanel.querySelector('.site-header');
   if(oldPanel.headerMarkup&&oldPanel.headerMarkup!==newHeader.outerHTML)oldPanel.querySelector('.site-header').replaceWith(newHeader.cloneNode(true));
   const oldNav=oldPanel.querySelector('.pc-sidebar nav'),newNav=newPanel.querySelector('.pc-sidebar nav');
   if(oldNav.innerHTML!==newNav.innerHTML)oldNav.innerHTML=newNav.innerHTML;
   const oldStage=oldPanel.querySelector('.pc-stage'),newStage=newPanel.querySelector('.pc-stage');
   const sameCompare=sameWorkspaceFrame(oldStage,newStage);
   if(!sameCompare){oldStage.className=newStage.className;replacePanelContent(oldStage,newStage.innerHTML);}
  }else if(wasIdentityActive&&current.startsWith('ops/')&&existing&&next){
   existing.querySelector('.supply-side').innerHTML=next.querySelector('.supply-side').innerHTML;
   existing.querySelector('.supply-content').replaceWith(next.querySelector('.supply-content'));
  }else if(wasIdentityActive&&current.startsWith('organization/')&&host.querySelector('.org-shell')&&template.content.querySelector('.org-shell')){
   const existingOrg=host.querySelector('.org-shell'),nextOrg=template.content.querySelector('.org-shell');
   existingOrg.querySelector('.org-sidebar').innerHTML=nextOrg.querySelector('.org-sidebar').innerHTML;
   existingOrg.querySelector('.org-content').replaceWith(nextOrg.querySelector('.org-content'));
  }else host.innerHTML=header()+`<main class="live-main">${content}</main>${window.SiteHeader.footer()}`;
  if(newPanel){const mounted=host.querySelector('.personal-console');if(mounted)mounted.headerMarkup=newPanel.querySelector('.site-header').outerHTML;}
  if(!wasIdentityActive){document.querySelectorAll('#market-view,#login-view').forEach(el=>el.hidden=true);window.LandingUI?.hide();}
  host.hidden=false;document.body.classList.remove('market-active','welcome-active','universe-active','ops-active','catalog-active','identity-context-personal','identity-context-enterprise','identity-context-staff');document.body.classList.add('identity-active','identity-context-'+contextKind());document.body.classList.toggle('personal-console-active',content.includes('class="personal-console"'));window.UniverseScene?.setActive(false);document.title='semifly.ai · '+(content.includes('personal-connect')?'模型接入':content.includes('my-models')?'我的模型':{personal:'个人工作台',enterprise:'企业管理工作台',staff:'内部工作台'}[contextKind()]);
  document.body.classList.remove('identity-route-pending');
  if(resetScrollOnMount){window.scrollTo(0,0);resetScrollOnMount=false;}
  host.classList.remove('route-loading');
  syncPersonalUsageCharts();
 }
 function syncPersonalUsageCharts(){window.PersonalUsageCharts?.mount(host?.querySelector('.personal-home'),me?.user?.id);}
 async function staffContext(ticket){if(!staff){const info=await api('/api/staff/me');if(ticket!==generation)return false;staff=info.staff;}me=null;return true;}
 const note=(message,error=false)=>`<div class="live-notice ${error?'error':''}" role="${error?'alert':'status'}">${esc(message)}</div>`;
 let phoneLoginAvailable=false,phoneRegistrationAvailable=false,phonePasswordAvailable=false,authMethodsRequest;
 function loadAuthMethods(){
  return authMethodsRequest??=api('/api/public/auth-methods').then(result=>{
   phoneLoginAvailable=Boolean(result.methods.phoneCode);
   phoneRegistrationAvailable=Boolean(result.methods.phoneRegistration);
   phonePasswordAvailable=Boolean(result.methods.phonePassword);
  }).catch(()=>{authMethodsRequest=undefined;});
 }
 function registrationActions(){
  return `<div class="live-auth-help">${btn('直接登录','auth-mode','type="button" data-mode="login"','quiet')}${btn('找回密码','auth-mode','type="button" data-mode="recover"','quiet')}${btn('换个邮箱注册','registration-email','type="button"','quiet')}</div>`;
 }
 function verificationHelp(registration){
  const message=registration?'已有账号？请登录或找回密码。首次注册？请查收来自 isaac@semifly.ai 的验证链接。':'只有尚未验证的账号会收到验证链接。请检查收件箱和垃圾邮件。';
  return note(message)+registrationActions();
 }


 const hero=(kicker,title,description)=>`<section class="live-hero"><div><span>${kicker}</span><h1>${title}</h1><p>${description}</p></div><img src="pinapi-mark.svg" alt="" aria-hidden="true"></section>`;
 function modelUsagePanel(scope,items=[]){
  const rows=items.map(item=>`<tr><td><b>${esc(item.model_name)}</b></td><td>${Number(item.calls||0).toLocaleString('zh-CN')}</td><td>${Number(item.input_tokens||0).toLocaleString('zh-CN')} / ${Number(item.output_tokens||0).toLocaleString('zh-CN')}</td><td>${esc(item.cost_display||'—')}</td></tr>`).join('');
  return `<section class="usage-panel" aria-label="${scope==='organization'?'企业':'个人'}模型使用情况"><div class="usage-panel-head"><div><span class="live-eyebrow">MODEL USAGE / 本月</span><h2>每个模型，用了多少</h2></div><a href="#market">查看模型与价格 ${ico('arrow-right')}</a></div>${rows?`<div class="live-table-wrap"><table><thead><tr><th>模型</th><th>调用次数</th><th>输入 / 输出 Token</th><th>费用</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="usage-empty"><b>尚无真实模型调用</b><span>真实调用开放后，这里按模型显示次数、输入与输出 Token、费用和预算进度。</span></div>'}</section>`;
 }
 const passwordRules='8–128 位，包含大写字母、小写字母和符号，空格不算符号。';
 function passwordField(name,label,fresh=false){return `<label>${label}<span class="password-control"><input name="${name}" type="password" autocomplete="${fresh?'new-password':'current-password'}" required ${fresh?'minlength="8" data-password-new aria-describedby="password-rules-'+name+'"':''} maxlength="128"><button type="button" data-password-toggle aria-label="显示${label}" aria-pressed="false">显示</button></span>${fresh?`<small id="password-rules-${name}">${passwordRules}</small><span class="password-checks" data-password-checks aria-live="polite"></span>`:''}</label>`;}
 function passwordValid(value){return value.length>=8&&value.length<=128&&/[A-Z]/.test(value)&&/[a-z]/.test(value)&&/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(value);}
 document.addEventListener('click',e=>{const b=e.target.closest('[data-password-toggle]');if(!b)return;const input=b.parentElement.querySelector('input'),show=input.type==='password';input.type=show?'text':'password';b.textContent=show?'隐藏':'显示';b.setAttribute('aria-pressed',String(show));b.setAttribute('aria-label',show?'隐藏密码':'显示密码');});
 document.addEventListener('input',e=>{if(e.target.id!=='alipay-yuan')return;if(host?.querySelector('.personal-billing'))billingAmountDraft=e.target.value;const value=e.target.value.trim(),fen=/^\d+(?:\.\d{1,2})?$/.test(value)?Math.round(Number(value)*100):NaN;host?.querySelectorAll('[data-live="alipay-amount"]').forEach(b=>{const selected=Number(b.dataset.fen)===fen;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});const message=host?.querySelector('#live-form-message');if(message)message.innerHTML='';});
 document.addEventListener('input',e=>{const input=e.target;if(!input.matches('[data-password-new]'))return;input.setCustomValidity(input.value&&!passwordValid(input.value)?passwordRules:'');const checks=input.closest('label').querySelector('[data-password-checks]');if(checks)checks.textContent=input.value?(passwordValid(input.value)?'已满足密码要求':'尚未满足全部要求'):'';});
 const phoneField=()=>'<label>中国大陆手机号<input name="phone" type="tel" autocomplete="tel" placeholder="11 位手机号，+86 可省略" maxlength="32" required></label>';
 function smsFields(binding=false){
  return `${binding?passwordField('password','当前密码'):''}${phoneField()}
   <div class="live-sms-code-row">
    <label>短信验证码<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
    ${btn('发送验证码','sms-send','type="button"','quiet')}
   </div>`;
 }
 function authForm(){
  const phoneSignup=phoneRegistrationAvailable&&['register','phone-register'].includes(authMode);
  const emailSignup=authMode==='email-register'||(authMode==='register'&&!phoneSignup);
  const registration=phoneSignup||emailSignup;
  const recovery=authMode==='recover';
  const phonePassword=authMode==='phone-password'&&phonePasswordAvailable;
  const smsLogin=authMode==='sms'&&phoneLoginAvailable;
  const phoneLogin=phonePassword||smsLogin;
  const modeButton=(label,mode,selected)=>btn(label,'auth-mode',`type="button" data-mode="${mode}" aria-pressed="${selected}"`,selected?'selected':'');
  const textButton=(label,mode)=>btn(label,'auth-mode',`type="button" data-mode="${mode}"`,'quiet');
  const showTabs=!recovery&&(registration?phoneRegistrationAvailable:phoneLoginAvailable);
  const tabs=showTabs?`<div class="live-tabs" role="group" aria-label="${registration?'注册方式':'登录方式'}">
   ${modeButton('手机号',registration?'phone-register':phonePassword?'phone-password':'sms',phoneSignup||phoneLogin)}
   ${modeButton('邮箱',registration?'email-register':'login',emailSignup||!phoneLogin&&!registration)}</div>`:'';

  const form=phoneSignup||phoneLogin?`<form class="live-form" id="live-${phoneSignup?'sms-register':phonePassword?'phone-password-login':'sms-login'}"
    ${phonePassword?'':`data-sms-purpose="${phoneSignup?'register':'login'}"`}>
    ${phonePassword?phoneField()+passwordField('password','密码'):smsFields()}
    <div id="live-form-message" role="status"></div>
    <button class="live-button primary" type="submit">${phoneSignup?'注册并登录':'登录'}</button>
   </form>`:`<form class="live-form" id="live-auth-form">
    ${emailSignup?'<label>姓名或昵称<input name="name" autocomplete="name" required maxlength="80"></label>':''}
    <label>邮箱<input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label>
    ${recovery?'':passwordField('password','密码',emailSignup)}
    <div id="live-form-message" role="status"></div>
    <button class="live-button primary" type="submit">${recovery?'发送重设链接':emailSignup?'注册并验证邮箱':'登录'}</button>
   </form>`;

  const help=phoneLogin&&phonePasswordAvailable
   ?textButton(phonePassword?'用短信验证码登录':'用密码登录',phonePassword?'sms':'phone-password')
   :!registration&&!recovery&&!phoneLogin
    ?textButton('忘记密码','recover')+btn('重发验证邮件','resend','type="button"','quiet')
    :'';
  const switchMode=recovery?textButton('返回登录','login')
   :registration?`已有账号？${textButton('去登录',phoneSignup&&phoneLoginAvailable?'sms':'login')}`
    :`新用户？${textButton('去注册','register')}`;
  mount(`<div class="live-auth-layout"><section class="live-auth-story"><h1>让灵感，<br>有个落脚的地方。</h1><p>选一个喜欢的模型，<br>把“如果可以”变成“已经做到”。</p><img src="pinapi-mark.svg" alt="" aria-hidden="true"><small>semifly.ai, It's your API.</small></section><section class="live-auth-card">
   <h2>${recovery?'找回密码':registration?'创建账号':'登录工作台'}</h2>
   ${recovery?'<p>重设链接会发送到你的注册邮箱。</p>':''}
   ${tabs}${form}
   ${help?`<div class="live-auth-help">${help}</div>`:''}
   <div class="live-auth-switch">${switchMode}</div>
   </section></div>`);
 }
 const creditActive=()=>Boolean(panelOrg&&employeeCredit?.enabled&&panelOrg.organization.id===employeeCredit.organization_id);
 const cwAuthQuery=()=>{
  const params=new URLSearchParams(location.search),query=new URLSearchParams();
  const promo=params.get('cw')||'',join=params.get('cw_join')||'';
  if(/^(?:[A-Z]{8}|\p{Script=Han}{8})$/iu.test(promo))query.set('cw',promo);
  if(join==='1'||/^[A-Z]{8}$/i.test(join)){
   query.set('cw_join',join);
   const inviteCode=params.get('invite_code')||'';
   if(/^[A-Z0-9_-]{2,32}$/.test(inviteCode))query.set('invite_code',inviteCode);
  }
  return query.size?'?'+query:'';
 };
 let cwOfferCode='',cwOfferKind='',cwInputCode=new URLSearchParams(location.search).get('cw')||'';
 const cwOfferHelp=()=>cwOfferCode
  ? (cwOfferKind==='direct'?'已识别员工直营折扣码。请填写实付金额，付款前核对到账额度。':cwOfferKind==='task'?'已填入专属 VIP 付款码。请填写实付金额，付款前核对到账额度。':'已识别 VIP 推广码，请填写实付金额。')
  : '填写实付金额，使用折扣码后请在付款前核对到账额度。';

 let alipayPay=null,alipayTimer=null,alipayFen=10000,payChannel='alipay_f2f',rechargeReview=null;
  const PAY_CHANNELS={alipay_f2f:{name:'支付宝',path:'alipay',chip:'支付宝电脑网站支付'},wechat_native:{name:'微信支付',path:'wechat',chip:'微信支付 Native'}};
 let directPicked=new Set(),directIssued=null,panelOrg=null,teamUsage=null,personalBilling=null,personalPilot=null,employeeCredit=null,employeeIssuedKey=null,employeeKeyModel=null,agentToolId='workbuddy',personalTab='overview',personalFamily='all',personalUse='all',personalSearch='',personalSelected='deepseek-flash',personalPricePeriod='offpeak';
 let personalPaneShare=62,personalPaneDrag=null;try{const saved=Number(localStorage.getItem('semifly.personal-pane-share'));if(saved>=39&&saved<=72)personalPaneShare=saved;}catch{}
 // API balances are decimal fen; trim sub-fen digits only for whole-fen display/checks.
 const wholeFen=value=>BigInt(String(value).split('.')[0]);
 const personalMoney=value=>{if(value===null||value===undefined)return '—';const cents=wholeFen(value),absolute=cents<0n?-cents:cents;return `${cents<0n?'-':''}¥${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;};
 const employeeCatalog=()=>(employeeCredit.models||[]).map(m=>{const base={hit:Number(m.cached_yuan),miss:Number(m.input_yuan),output:Number(m.output_yuan)},peak={hit:base.hit*m.peak_multiplier,miss:base.miss*m.peak_multiplier,output:base.output*m.peak_multiplier};return {id:m.id,family:m.family,name:m.name,subtitle:m.tags.join('、'),tags:m.capability_tags||m.tags,uses:m.uses,upstreamId:m.id,price:m.peak_multiplier>1?{kind:'timed',offpeak:base,peak}:{kind:'standard',standard:base}};});
 const personalCatalog=()=>creditActive()?employeeCatalog():((window.SemiflyModels||[]).filter(m=>['deepseek','glm'].includes(m.family)));
 const personalBaseRate=m=>m.price?.kind==='timed'?m.price[personalPricePeriod]:m.price?.standard;
 const personalDiscount=value=>window.SemiflyPrice?.discountedRate(value)||'待发布';
 const personalPrice=value=>creditActive()?'¥'+Number(value):personalDiscount(value);
 let personalModelGuideOpen=false;
 function personalModelAccess(model){
  if(paidCredit?.enabled&&paidCredit.models?.some(m=>m.id===model.id))return {label:'可调用',action:'paid-create',base:paidCredit.base_url};
  if(personalPilot?.enabled&&personalPilot.model_ids?.includes(model.id))return {label:'限量测试',action:'pilot-create',base:personalPilot.base_url};
  return {label:'待开放',action:null,base:null};
 }
 const personalModelChoices=new Map();
 function personalModelChoiceKey(){return me?.user?.id?'semifly.personal-models.v1:'+me.user.id:null;}
 function personalChosenModels(){
  const key=personalModelChoiceKey(),valid=new Set(personalCatalog().map(m=>m.id));
  let ids=personalModelChoices.get(key);
  if(!ids&&key){try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(Array.isArray(saved))ids=saved;}catch{}}
  if(!ids)ids=[];
  return [...new Set(ids.filter(id=>valid.has(id)))];
 }
 function setPersonalModelChoice(id,selected){
  if(!personalCatalog().some(m=>m.id===id))return false;
  const key=personalModelChoiceKey(),ids=new Set(personalChosenModels());
  if(selected)ids.add(id);else{ids.delete(id);if(readModelIntent()?.id===id)try{localStorage.removeItem(modelIntentKey);}catch{}}
  const saved=[...ids];personalModelChoices.set(key,saved);
  if(key){try{localStorage.setItem(key,JSON.stringify(saved));}catch{}}
  return true;
 }
 function setAllPersonalModels(selected){
  const key=personalModelChoiceKey(),ids=selected?personalCatalog().map(m=>m.id):[];
  personalModelChoices.set(key,ids);if(key)try{localStorage.setItem(key,JSON.stringify(ids));}catch{}
  if(!selected)try{localStorage.removeItem(modelIntentKey);}catch{}
 }
 function personalModelCollection(models,selected){
  if(!models.length)return `<p class="mm-empty">${selected?'点击下方「+ 加入」选择模型，或全选后生成 Key。':'全部模型都已加入。'}</p>`;
  return `<table class="mm-table" data-nosort aria-label="${selected?'已选模型':'备选模型'}"><thead><tr><th>模型</th><th>能力</th><th>状态</th><th>输入 / 输出</th><th><span class="mm-sr-only">操作</span></th></tr></thead><tbody>${models.map(m=>{
   const rate=personalBaseRate(m),access=personalModelAccess(m),tags=[m.capabilities?.input?.includes('image')?'图文':'文本',m.uses.includes('coding')?'编程':'推理'];
   return `<tr><td><a href="#market/${esc(m.id)}" title="了解 ${esc(m.name)}">${esc(m.name)}</a></td><td><div class="mm-tags">${tags.map(t=>`<span>${t}</span>`).join('')}</div></td><td class="mm-status">${access.action?'<i aria-hidden="true"></i>':''}${access.label}</td><td class="mm-price"><span>${personalPrice(rate.miss)}</span><em>/</em><span>${personalPrice(rate.output)}</span></td><td><div class="mm-actions">${access.action?`<button type="button" class="mm-use" data-live="personal-model-use" data-id="${esc(m.id)}" aria-label="一键接入 ${esc(m.name)}" title="为此模型生成独立 Key 并查看设置方法">${ico('key-round')}一键接入</button>`:'<span class="mm-wait">待开放</span>'}${selected?`<button type="button" class="mm-remove" data-live="personal-model-remove" data-id="${esc(m.id)}" aria-label="移除 ${esc(m.name)}" title="从清单移除，不会停用 Key">${ico('x')}</button>`:`<button type="button" class="mm-add" data-live="personal-model-add" data-id="${esc(m.id)}" aria-label="加入 ${esc(m.name)}">${ico('plus')}加入</button>`}</div></td></tr>`;
  }).join('')}</tbody></table>`;
 }
 function personalModelsContent(){
  const chosen=new Set(personalChosenModels()),catalog=personalCatalog(),selected=catalog.filter(m=>chosen.has(m.id)),available=catalog.filter(m=>!chosen.has(m.id)),callable=(paidCredit?.models||[]).filter(m=>chosen.has(m.id));
  return `<section class="personal-models my-models" aria-labelledby="pm-title"><header class="mm-heading"><div><h1 id="pm-title">我的模型</h1><p class="mm-intro">选好模型，生成一把共用 Key；单个模型也可直接接入。</p></div><nav class="mm-head-actions" aria-label="模型与密钥"><a href="#market">模型广场${ico('arrow-up-right')}</a><a href="#personal/keys" data-live="personal-model-manage">管理 Key${ico('arrow-right')}</a></nav></header>
   <section class="mm-section mm-selected" aria-labelledby="mm-selected-title"><div class="mm-section-head"><div class="mm-selection-heading"><h2 id="mm-selected-title">已选模型 <span>${selected.length}</span></h2>${selected.length?`<span class="mm-selection-note">${callable.length} 个可用于 Key${selected.length>callable.length?` · ${selected.length-callable.length} 个待开放`:''}</span>`:''}</div><div class="mm-section-actions">${available.length?`<button type="button" data-live="personal-model-add-all">${ico('list-plus')}全选</button>`:''}<button type="button" data-live="personal-model-clear" ${selected.length?'':'disabled'}>${ico('list-x')}清除</button><button type="button" class="mm-generate" data-live="connect-selected" ${callable.length&&paidCredit?.enabled?'':'disabled'}>${ico('key-round')}为已选模型生成 Key</button></div></div>${personalModelCollection(selected,true)}</section>
   ${available.length?`<section class="mm-section mm-available" aria-labelledby="mm-available-title"><div class="mm-section-head"><h2 id="mm-available-title">备选模型 <span>${available.length}</span></h2><span class="mm-selection-note">加入上方清单，或直接接入</span></div>${personalModelCollection(available,false)}</section>`:''}
   <footer class="mm-foot"><span>官网价 · 元 / 百万 Token</span><label>DeepSeek 时段<select data-personal-price-period aria-label="DeepSeek 价格时段"><option value="offpeak" ${personalPricePeriod==='offpeak'?'selected':''}>空闲</option><option value="peak" ${personalPricePeriod==='peak'?'selected':''}>高峰</option></select></label></footer>
  </section>`;
 }
 // Green: answering. Red: failing or not connected. Amber: not measured yet or paused.
 const modelLight=x=>x.tone==='live'?'green':x.tone==='failed'||x.status==='未接通'?'red':'amber';
 function personalModelMeasurement(modelId){
  if(creditActive()){const h=modelHealth?.get(modelId);
   if(h){if(h.status==='ok')return {latency:`${h.latency_ms} ms`,status:'实测正常',tone:'live',time:msTime(h.checked_at)};if(h.status==='failed')return {latency:h.error==='timeout'?'超时':'—',status:'实测失败',tone:'failed'};if(h.status==='paused')return {latency:'—',status:'已暂停',tone:'stale'};return {latency:'—',status:'未接通',tone:'stale'};}
   const c=(panelOrg?.permissions?.manager&&teamUsage?teamUsage.recent_calls:employeeCredit.recent_calls||[]).find(row=>row.model_id===modelId);if(!c)return {latency:modelHealthLoading?'测量中':'待实测',status:'可调用',tone:''};if(c.status==='failed')return {latency:'—',status:'上次失败',tone:'failed'};if(c.status==='pending')return {latency:'测试中',status:'进行中',tone:''};return {latency:c.latency_ms==null?'—':`${Math.round(c.latency_ms)} ms`,status:'最近成功',tone:'live',time:new Date(c.created_at).toLocaleString('zh-CN')};}
  const call=personalPilot?.enabled?(personalPilot.recent_calls||[]).find(row=>row.model_id===modelId):null;
  if(!call)return {latency:'待实测',status:paidCredit?.enabled&&paidCredit.models?.some(m=>m.id===modelId)?'可调用':'待验收',tone:''};
  if(call.status==='pending')return {latency:'测试中',status:'进行中',tone:''};
  if(call.status!=='succeeded')return {latency:'—',status:'上次失败',tone:'failed'};
  const ms=Number(call.latency_ms),age=Date.now()-Date.parse(call.created_at);
  if(call.latency_ms==null||!Number.isFinite(ms)||ms<0)return {latency:'待实测',status:'待验收',tone:''};
  const fresh=age>=0&&age<=24*60*60*1000;
  return {latency:`${Math.round(ms)} ms`,status:fresh?'最近成功':'需复测',tone:fresh?'live':'stale',time:new Date(call.created_at).toLocaleString('zh-CN')};
 }
 function personalCatalogRows(){
  const query=personalSearch.trim().toLowerCase();
  const list=personalCatalog().filter(m=>(personalFamily==='all'||m.family===personalFamily)&&(personalUse==='all'||m.uses.includes(personalUse))&&(!query||`${m.name} ${m.subtitle} ${m.tags.join(' ')}`.toLowerCase().includes(query)));
  return {count:list.length,html:list.length?list.map(m=>{const measurement=personalModelMeasurement(m.id);return `<tr class="${personalSelected===m.id?'selected':''}" data-live="personal-model" data-id="${esc(m.id)}">${creditActive()?`<td class="col-pick"><input type="checkbox" data-live="pick-model" data-id="${esc(m.id)}" aria-label="勾选 ${esc(m.name)}" ${directPicked.has(m.id)?'checked':''}></td>`:''}<td><span class="personal-model-name"><i class="${m.family}"></i><span><b>${esc(m.name)}</b><small>${esc(m.upstreamId)}</small></span></span></td><td class="col-status" data-sort="${/^\d/.test(measurement.latency)?parseInt(measurement.latency,10):''}" title="${esc(measurement.time?`实测于 ${measurement.time} · 平台到上游的响应耗时`:'尚无实测结果')}"><span class="model-light ${modelLight(measurement)}" aria-hidden="true"></span><span class="model-state"><b class="personal-status ${measurement.tone}">${measurement.status}</b><small>${measurement.latency}</small></span></td><td class="col-cap">${esc(m.tags.slice(0,2).join('、'))}</td><td class="personal-rate">${personalPrice(personalBaseRate(m).miss)}</td><td class="personal-rate">${personalPrice(personalBaseRate(m).output)}</td><td class="col-act"><button type="button" data-live="personal-model" data-id="${esc(m.id)}" aria-label="查看 ${esc(m.name)}">查看</button></td></tr>`}).join(''):`<tr><td colspan="${creditActive()?7:6}" class="personal-model-empty">没有匹配的型号，请调整筛选条件。</td></tr>`};
 }
 function personalRecent(){
  const pilot=personalPilot?.enabled?(personalPilot.recent_calls||[]).slice(0,8):[];
  const entries=(personalBilling?.entries||[]).filter(e=>e.kind==='usage'&&e.model_name&&e.input_tokens!=null&&e.output_tokens!=null).slice(0,5);
  const pilotRows=pilot.map(e=>`<tr><td>${new Date(e.created_at).toLocaleString('zh-CN')}</td><td>${esc(modelIntentNames[e.model_id]||e.model_id)} · 测试</td><td>${e.input_tokens??'—'}</td><td>${e.output_tokens??'—'}</td><td>${e.estimated_upstream_yuan==null?'—':'约 ¥'+Number(e.estimated_upstream_yuan).toFixed(6)}</td><td>${e.status==='succeeded'?'成功':e.status==='pending'?'进行中':'失败'}</td></tr>`).join('');
  const billingRows=entries.map(e=>`<tr><td>${new Date(e.created_at).toLocaleString('zh-CN')}</td><td>${esc(e.model_name)}</td><td>${Number(e.input_tokens).toLocaleString('zh-CN')}</td><td>${Number(e.output_tokens).toLocaleString('zh-CN')}</td><td>${personalMoney(e.amount_fen)}</td><td>已入账</td></tr>`).join('');
  return `<section class="personal-recent"><div class="personal-section-title"><h2>${ico('chart-no-axes-combined')} 最近调用</h2><span>${pilot.length?'平台测试 · 不扣客户余额':'当前个人空间 · 真实记录'}</span></div><div class="personal-table-wrap"><table><thead><tr><th>时间</th><th>模型</th><th>输入 tokens</th><th>输出 tokens</th><th>${pilot.length?'上游成本估计':'费用'}</th><th>结果</th></tr></thead><tbody>${pilotRows||billingRows||'<tr><td colspan="6" class="personal-model-empty">暂无真实调用记录。</td></tr>'}</tbody></table></div></section>`;
 }
 function personalPilotUsage(){
  const chart=personalPilot?.usage_chart,rows=chart?.rows||[],calls=personalPilot?.recent_calls||[],colors=['#2563eb','#7c3aed','#10b981','#06b6d4','#f59e0b'];
  const modelIds=[...new Set(rows.map(x=>x.model_id))],count=v=>Number(v||0).toLocaleString('zh-CN'),sum=f=>rows.reduce((n,r)=>n+Number(r[f]||0),0);
  const start=chart?Date.parse(chart.start):Date.now()-86400000,end=chart?Date.parse(chart.end):Date.now();const first=Math.floor(start/3600000)*3600000,slots=Array.from({length:Math.floor(end/3600000)-Math.floor(start/3600000)+1},(_,i)=>first+i*3600000);
  const buckets=modelIds.map(id=>slots.map(hour=>rows.filter(r=>r.model_id===id&&Date.parse(r.hour)===hour).reduce((a,r)=>({calls:a.calls+Number(r.calls),tokens:a.tokens+Number(r.input_tokens||0)+Number(r.output_tokens||0)}),{calls:0,tokens:0})));
  const legend=modelIds.map((id,i)=>`<span><i style="background:${colors[i%colors.length]}"></i>${esc(modelIntentNames[id]||id)}</span>`).join('');
  const svg=(mode)=>{
   const w=560,h=210,left=44,right=14,top=14,bottom=34,pw=w-left-right,ph=h-top-bottom;
   const totals=slots.map((_,i)=>buckets.reduce((n,b)=>n+b[i][mode],0)),max=Math.max(1,...totals),x=i=>left+(i+.5)*pw/slots.length,y=v=>top+ph-v/max*ph;
   let content=[0,.5,1].map(f=>`<line x1="${left}" x2="${w-right}" y1="${y(f*max)}" y2="${y(f*max)}" stroke="#e8ebf3"/><text x="${left-7}" y="${y(f*max)+4}" text-anchor="end" fill="#7d8699" font-size="10">${Math.round(max*f)}</text>`).join('');
   if(mode==='tokens')slots.forEach((_,i)=>{let base=0;buckets.forEach((b,j)=>{const v=b[i].tokens;if(v)content+=`<rect x="${x(i)-pw/slots.length*.35}" y="${y(base+v)}" width="${pw/slots.length*.7}" height="${v/max*ph}" fill="${colors[j%colors.length]}"><title>${esc(modelIds[j])} · ${new Date(slots[i]).toLocaleString('zh-CN')} · ${v} Token</title></rect>`;base+=v})});
   else buckets.forEach((b,j)=>{content+=`<polyline points="${b.map((v,i)=>x(i)+','+y(v.calls)).join(' ')}" stroke="${colors[j%colors.length]}" stroke-width="2" fill="none"/>`;b.forEach((v,i)=>{if(v.calls)content+=`<circle cx="${x(i)}" cy="${y(v.calls)}" r="3" fill="${colors[j%colors.length]}"><title>${esc(modelIds[j])} · ${new Date(slots[i]).toLocaleString('zh-CN')} · ${v.calls} 次</title></circle>`})});
   [0,Math.floor((slots.length-1)/2),slots.length-1].forEach(i=>{content+=`<text x="${x(i)}" y="${h-9}" text-anchor="middle" fill="#7d8699" font-size="10">${new Date(slots[i]).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</text>`});
   if(!rows.length)content+=`<text x="${w/2}" y="${h/2}" text-anchor="middle" fill="#8490a5" font-size="13">暂无真实调用，首次调用后显示</text>`;
   return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${mode==='tokens'?'按模型的每小时 Token 消耗':'按模型的每小时调用次数'}">${content}</svg>`;
  };
  const minutes=(end-start)/60000,requests=sum('calls'),tokens=sum('input_tokens')+sum('output_tokens');
  const callPage=pagedRows('pilot-calls',calls.slice(0,50)),callRows=callPage.items.map(c=>`<tr><td>${new Date(c.created_at).toLocaleString('zh-CN')}</td><td>${esc(modelIntentNames[c.model_id]||c.model_id)}<small>${esc(c.key_label)}</small></td><td>${c.input_tokens??'—'} / ${c.cache_hit_tokens??'—'} / ${c.output_tokens??'—'}</td><td>${c.latency_ms==null?'—':c.latency_ms+' ms'}</td><td>¥0 · 试用未扣款</td><td>${esc({succeeded:'成功',pending:'进行中',failed:'失败'}[c.status]||c.status)}</td></tr>`).join('');
  const usageViews=[['overview','用量概览'],['calls',`调用历史 · ${calls.length}`],['about','统计说明']],usageView=pageView('pilot-usage',usageViews);
  return tabbedPage('pilot-usage',usageViews,usageView==='calls'?`<div class="personal-table-wrap"><table><thead><tr><th>时间</th><th>模型 / Key</th><th>输入 / 缓存 / 输出</th><th>耗时</th><th>客户扣费</th><th>结果</th></tr></thead><tbody>${callRows||'<tr><td colspan="6" class="personal-model-empty">尚无真实调用记录。</td></tr>'}</tbody></table></div>${callPage.pager}`:usageView==='about'?`<p class="personal-pilot-disclaimer">当前为限量试用，不产生客户扣款，因此左图展示真实 Token 消耗，不虚构付费金额。缓存包含在输入中，不重复相加；RPM / TPM 为 24 小时平均值。尚未返回的 Token 不计入已知用量。上游采购账单仅在管理员后台查看。</p>`:`<div class="personal-pilot-usage"><div class="personal-usage-intro"><div><strong>用量统计</strong><span>最近 24 小时 · 当前个人空间</span></div><button data-live="pilot-refresh">刷新数据</button><a href="#billing/personal">付款与资金记录 →</a></div><div class="personal-pilot-metrics"><div><span>请求总数</span><strong>${count(requests)}</strong></div><div><span>${personalPilot?.enabled?'客户扣费 · 试用':'客户扣费 · 尚未调用'}</span><strong>¥0.00</strong></div><div><span>总 Token / 其中缓存</span><strong>${count(tokens)} / ${count(sum('cache_hit_tokens'))}</strong></div><div><span>平均 RPM</span><strong>${(requests/Math.max(1,minutes)).toFixed(3)}</strong></div><div><span>平均 TPM</span><strong>${(tokens/Math.max(1,minutes)).toFixed(2)}</strong></div></div><div class="customer-chart-grid"><section><div class="personal-section-title"><h2>Token 消耗分布</h2><span>按模型 · 每小时</span></div>${svg('tokens')}<div class="chart-legend">${legend}</div></section><section><div class="personal-section-title"><h2>模型调用趋势</h2><span>每小时请求数</span></div>${svg('calls')}<div class="chart-legend">${legend}</div></section></div></div>`);
 }
 const employeeYuan=v=>{const n=Number(v||0);return '¥'+(n>0&&n<0.01?n.toFixed(6):n.toFixed(2));};
 // Key 只显示一次，发放时必须同时给出接入地址、模型名称和可直接运行的示例。
 const curlExample=(baseUrl,model,key)=>`curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Semifly-Client: my-script" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"你好"}]}'`;
 const nodeExample=(baseUrl,model,key)=>`import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "${baseUrl}",\n  apiKey: "${key}",\n  defaultHeaders: { "X-Semifly-Client": "my-script" },\n});\nconst reply = await client.chat.completions.create({\n  model: "${model}",\n  messages: [{ role: "user", content: "你好" }],\n});\nconsole.log(reply.choices[0].message.content);`;
const pythonExample=(baseUrl,model,key)=>`from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${baseUrl}",\n    api_key="${key}",\n    default_headers={"X-Semifly-Client": "my-script"},\n)\nreply = client.chat.completions.create(\n    model="${model}",\n    messages=[{"role": "user", "content": "你好"}],\n)\nprint(reply.choices[0].message.content)`;
 const keyExamples=(baseUrl,model,key)=>`<details class="key-guide-example"><summary>命令行示例（curl）</summary><pre>${esc(curlExample(baseUrl,model,key))}</pre></details><details class="key-guide-example"><summary>Python 示例（OpenAI SDK）</summary><pre>${esc(pythonExample(baseUrl,model,key))}</pre></details>`;
 function keyUsageSteps(baseUrl,model,key,note){
  return `<ol class="key-guide-steps"><li>在工具或代码里选择“OpenAI 兼容”（自定义接口）。</li><li>填入 Base URL 和 API Key。地址已包含 <code>/v1</code>，不要再追加。</li><li>模型名称按上面的写法原样填写，然后发送一条消息测试。</li></ol>${keyExamples(baseUrl,model,key)}${note?`<p class="live-small">${esc(note)}</p>`:''}`;
 }
 function keyIssuedGuide({secret,baseUrl,modelIds,note}){
  const model=modelIds[0],others=modelIds.slice(1);
  const config=[`API Key: ${secret}`,`Base URL: ${baseUrl}`,`Model: ${model||'暂无可用模型'}`,...(others.length?[`其他可用模型: ${others.join(', ')}`]:[]),...(model?['',curlExample(baseUrl,model,secret)]:[])].join('\n');
  const field=(label,value,extra='')=>`<div class="key-guide-field"><div class="key-guide-field-meta"><small>${esc(label)}</small><button type="button" data-live="key-guide-copy" data-copy="${esc(value)}" data-toast="${esc(label)}已复制。">复制</button></div><code${label==='API Key'?' id="pilot-secret" class="pilot-secret"':''}>${esc(value)}</code>${extra}</div>`;
  return `<p class="key-guide-warning">这把 Key 只显示这一次，关闭后无法再次查看，请先保存。</p><div class="key-guide-fields">${field('API Key',secret)}${field('接入地址（Base URL）',baseUrl)}${field('模型名称（Model）',model||'暂无可用模型',others.length?`<small>也可换成：${others.map(esc).join('、')}</small>`:'')}</div><div class="key-guide-actions">${btn('复制全部配置','key-guide-copy',`data-copy="${esc(config)}"`,'primary')}${btn('只复制 Key','pilot-copy')}</div>${model?keyUsageSteps(baseUrl,model,secret,note):''}`;
 }
 const employeeKeyNote=c=>`只支持对话接口 /chat/completions，可用流式和工具调用；单次 max_tokens 不超过 ${c.max_output_tokens}。所有 Key 共用你的公司额度，余额和调用历史在“密钥”页查看。Key 遗失后请停用并重新生成。`;
 function employeeCreditBand(){
  if(!employeeCredit?.enabled||panelOrg)return '';
  return `<a class="employee-credit-reminder" href="#organization/${esc(employeeCredit.organization_id)}/keys"><span>你有 <b>${esc(employeeCredit.organization_name)}</b> 的公司额度 <b>${employeeYuan(employeeCredit.available_yuan)}</b> 可用，在企业空间生成 Key 并使用</span>${ico('arrow-right')}</a>`;
 }
 // 字段名和路径取自各工具官方文档（2026-11 查证）。只收录能走 OpenAI Chat Completions 的工具，其余明确标为暂不支持。
 const AGENT_TOOLS=[
  {id:'workbuddy',name:'WorkBuddy',base:'接口地址',key:'API Key',model:'模型名称',steps:['打开 头像 → 系统设置 → 模型，添加模型。','供应商选“自定义 / Custom”，填入下面三项，点“测试连接”。','让 Agent 操作文件时打开“工具调用”，最大输出 Token 不要超过 32768。']},
  {id:'qoder',name:'Qoder',base:'接口地址（Base URL）',key:'API Key',model:'Model ID',steps:['打开 设置 → 模型 → 添加模型。','供应商的“自定义”分组选 OpenAI Compatible，类型选 Chat Completions API。','填入下面三项，点“校验并添加模型”。Model ID 添加后不能修改。']},
  {id:'trae',name:'Trae',base:'自定义请求地址',key:'API 密钥',model:'模型 ID',steps:['打开 设置 → 模型 → 添加模型，选“自定义模型”。','API 格式选“OpenAI Chat Completions”，关闭“完整 URL”开关。','填入下面三项，点“添加模型”，Trae 会自动检测连接。']},
  {id:'cursor',name:'Cursor',base:'Override OpenAI Base URL',key:'OpenAI API Key',model:'Custom Model',steps:['打开 Cursor Settings → Models → API Keys。','打开 OpenAI API Key 和 Override OpenAI Base URL 两个开关，分别填入 Key 和地址。','点 Add Custom Model，添加下面的模型名称。'],note:'Cursor 自定义地址一般需要付费方案，开启后其他 OpenAI 模型的请求也会发到这里。有用户反映 Agent 模式不能使用自定义模型，Ask 模式可用。'},
  {id:'cline',name:'Cline',base:'Base URL',key:'API Key',model:'Model ID',steps:['在 VS Code 打开 Cline 设置（⚙）。','API Provider 选 OpenAI Compatible，填入下面三项。','在 Model Configuration 把 Max Output Tokens 设为不超过 32768。']},
  {id:'roo',name:'Roo Code',base:'Base URL',key:'API Key',model:'Model',steps:['在 VS Code 打开 Roo Code 设置。','API Provider 选 OpenAI Compatible，填入下面三项。','把最大输出 Token 设为不超过 32768。']},
  {id:'opencode',name:'OpenCode',base:'baseURL',key:'apiKey',model:'models',steps:['把下面的配置写入 ~/.config/opencode/opencode.json，不要提交到代码仓库。','在 OpenCode 里运行 /models，选择 semifly 下的模型。'],snippet:(b,k,m)=>{const j=JSON.stringify;return `{\n  "$schema": "https://opencode.ai/config.json",\n  "provider": { "semifly": {\n    "npm": "@ai-sdk/openai-compatible",\n    "name": "Semifly",\n    "options": { "baseURL": ${j(b)}, "apiKey": ${j(k)} },\n    "models": { ${j(m)}: { "name": ${j(m)}, "limit": { "context": 128000, "output": 32768 } } }\n  } }\n}`;}},
  {id:'api',name:'不用 Agent · 直接调用 API（curl / Python / Node）',base:'Base URL',key:'API Key',model:'Model',steps:['按 OpenAI Chat Completions 格式请求 接口地址 + /chat/completions，地址已包含 /v1。','请求头带 Authorization: Bearer 你的 Key；model 填下面的模型名称。','在“curl / Python / Node”页复制示例代码，替换 Key 后即可运行。','建议在请求头加 X-Semifly-Client: 你的脚本名，管理者就能看出调用来自哪里。中文名请先做 URL 编码。'],examples:true},
  {id:'other',name:'自建 Agent / 其他 OpenAI 兼容工具',base:'Base URL',key:'API Key',model:'Model',steps:['在工具或自建 Agent 里选择“OpenAI 兼容”或“自定义接口”。','填入下面三项。地址已包含 /v1，不要再追加。','自建 Agent 请在请求头加 X-Semifly-Client: 你的 Agent 名，管理者就能看出调用来自哪里。中文名请先做 URL 编码。','需要工具调用（function calling）时用 tools 参数；单次输出不超过 32768 Token。'],examples:true},
  {id:'claude-code',name:'Claude Code',unsupported:'Claude Code 需要 Anthropic Messages 接口（/v1/messages）。Semifly 目前只提供 OpenAI Chat Completions，暂时不能直接接入。'},
  {id:'codex',name:'Codex',unsupported:'Codex 的自定义服务商只支持 Responses API（/v1/responses）。Semifly 目前只提供 OpenAI Chat Completions，暂时不能直接接入。'}
 ];
 const agentTool=()=>AGENT_TOOLS.find(t=>t.id===agentToolId)||AGENT_TOOLS[0];
 const agentToolSelect=()=>{const option=t=>`<option value="${t.id}"${t.id===agentTool().id?' selected':''}>${esc(t.name)}</option>`;return `<select data-agent-tool aria-label="选择接入工具">${AGENT_TOOLS.filter(t=>!t.unsupported).map(option).join('')}<optgroup label="暂不支持">${AGENT_TOOLS.filter(t=>t.unsupported).map(option).join('')}</optgroup></select>`;};
 const agentToolHint=()=>agentTool().unsupported||agentTool().steps.slice(0,2).join(' ');
 const agentToolTitle=()=>{const t=agentTool();return t.unsupported?`${t.name} 暂不支持接入：`:t.id==='other'?'在自建 Agent 或其他兼容工具中使用此 API 的方法：':t.id==='api'?'不用 Agent，直接调用此 API 的方法：':`在 ${t.name} 智能体中使用此 API 的方法：`;};
 const labelEm=(...labels)=>(Math.max(...labels.map(t=>[...String(t||'')].reduce((n,c)=>n+(/[\u2e80-\uffff]/.test(c)?1:.56),0)))+.8).toFixed(1);
 const agentStepTitle=m=>{const t=agentTool(),n=`<b>${esc(m.name)}</b>`;return t.unsupported?`<b>${esc(t.name)}</b> 暂不支持接入 ${n}`:t.id==='api'?`不用 Agent，直接调用 ${n} 的方法`:t.id==='other'?`在自建 Agent / 兼容工具中接入 ${n} 的方法`:`在 <b>${esc(t.name)}</b> 中接入 ${n} 的方法`;};
 // 工作台各页固定在一屏内，内容多时用这组标签切换视角。
 const pageViews={};
 const pageView=(group,items)=>items.some(([key])=>key===pageViews[group])?pageViews[group]:items[0][0];
 const pageTabs=(group,items)=>`<div class="pc-view-tabs" role="tablist">${items.map(([key,label])=>`<button type="button" role="tab" aria-selected="${pageView(group,items)===key}" class="${pageView(group,items)===key?'active':''}" data-live="page-view" data-group="${group}" data-page-view="${key}">${label}</button>`).join('')}</div>`;
 // 长表格按当前窗口能放下的行数分页，不在页面里滚动。
 const pageSize=()=>Math.max(5,Math.floor((window.innerHeight-270)/44));
 function pagedRows(group,items){
  const size=pageSize(),pages=Math.max(1,Math.ceil(items.length/size)),page=Math.min(pages,Math.max(1,pageViews[group+':page']||1));
  const turn=(label,target,off)=>`<button type="button" ${off?'disabled':''} data-live="page-turn" data-group="${group}" data-page="${target}">${label}</button>`;
  return {items,pager:pages>1?`<div class="pc-pager" data-pager="${group}" data-page="${page}" data-size="${size}">${turn('上一页',page-1,page<=1)}<span>第 ${page} / ${pages} 页 · 共 ${items.length} 条</span>${turn('下一页',page+1,page>=pages)}</div>`:''};
 }
 const tabbedPage=(group,items,body)=>`<section class="pc-tab-page">${pageTabs(group,items)}<div class="pc-tab-body">${body}</div></section>`;
 const employeeKeyModelId=c=>c.model_ids.includes(employeeKeyModel)?employeeKeyModel:c.model_ids[0];
 const keyAgentCopy=(value,label)=>`<button type="button" class="key-agent-copy" data-live="key-guide-copy" data-copy="${esc(value)}" data-toast="${esc(label)} 已复制。" aria-label="复制 ${esc(label)}">复制</button>`;
 const keyAgentRow=(index,label,value,copyValue)=>`<div class="key-agent-row"><span class="key-agent-index">${index}</span><small>${label}</small>${value}${copyValue?keyAgentCopy(copyValue,label):'<span></span>'}</div>`;
 // 右侧固定列出 Agent 需要的三项信息；完整 Key 只保存在当前页面内存，刷新后不再显示。
 function employeeKeyPanel(c){
  const tool=agentTool(),model=employeeKeyModelId(c),issued=employeeIssuedKey,active=(c.keys||[]).find(k=>!k.revoked_at);
  const picked=(c.models||[]).find(m=>m.id===model)||{name:model||'所选模型'};
  const head=`<header class="kg-step3-head"><span class="pc-step-no">3</span><h4>${agentStepTitle(picked)}</h4></header>`;
  if(tool.unsupported)return `<section class="kg-step3 pc-step-blocked" data-key-agent-panel>${head}<p class="pc-step-warn">${esc(tool.unsupported)}</p></section>`;
  const keyField=issued?`<code class="is-secret">${esc(issued.secret)}</code>`:active?`<code class="is-muted">sf_emp_…${esc(active.key_hint)}</code>`:'<code class="is-muted">生成后显示在这里</code>';
  const all=[`${tool.base}: ${c.base_url}`,`${tool.key}: ${issued?issued.secret:'（填入你保存的 Key）'}`,`${tool.model}: ${model||'暂无可用模型'}`].join('\n');
  const hint=issued?'<p class="key-agent-warning">这把 Key 只显示这一次，刷新或离开后无法再查看，请现在保存。</p>':'';
  const gen=`<form id="live-employee-create" class="kg-gen"><input name="label" required maxlength="50" aria-label="用途名称" placeholder="用途名称，例如：我的 ${esc(tool.id==='api'||tool.id==='other'?'Agent':tool.name)}"><button class="personal-key-button personal-key-button-active" type="submit">${ico('command')} ${issued||active?'再生成一把':'生成 API Key'}</button><div role="status"></div></form>`;
  const key=issued?.secret||'YOUR_API_KEY',guides=[['steps','操作步骤'],...(tool.snippet&&model?[['file','配置文件']]:[]),...(tool.examples&&model?[['curl','curl'],['python','Python'],['node','Node']]:[]),['limits','使用限制']],guide=pageView('agent-guide',guides);
  const code=value=>`<pre class="key-agent-snippet">${esc(value)}</pre>`;
  const guideBody=guide==='file'?code(tool.snippet(c.base_url,key,model))+keyAgentCopy(tool.snippet(c.base_url,key,model),'配置文件'):guide==='curl'?code(curlExample(c.base_url,model,key)):guide==='python'?code(pythonExample(c.base_url,model,key)):guide==='node'?code(nodeExample(c.base_url,model,key)):guide==='limits'?`${tool.note?`<p class="live-small">${esc(tool.note)}</p>`:''}<p class="live-small">${esc(employeeKeyNote(c))}</p><p class="live-small">公司额度按模型官网价扣除，DeepSeek 工作日高峰时段为 2 倍。</p>`:`<ol class="pc-howto">${tool.steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`;
  return `<section class="kg-step3" data-key-agent-panel>${head}<div class="kg-step3-grid"><div class="kg-guide">${pageTabs('agent-guide',guides)}<div class="key-agent-guide">${guideBody}</div></div><div class="kg-values">${gen}<div class="key-agent-rows" style="--kv-label:${labelEm(tool.base,tool.key,tool.model)}">${keyAgentRow(1,esc(tool.base),`<code>${esc(c.base_url)}</code>`,c.base_url)}${keyAgentRow(2,esc(tool.key),keyField,issued?.secret)}${keyAgentRow(3,esc(tool.model),`<code>${esc(model||'暂无可用模型')}</code>`,model)}</div>${hint}<button type="button" class="key-agent-copy-all" data-live="key-guide-copy" data-copy="${esc(all)}" data-toast="配置已复制。">复制全部</button></div></div></section>`;
 }
 function employeeCreditKeys(){
  const c=employeeCredit,keys=c.keys||[],calls=c.recent_calls||[],callPage=pagedRows('employee-calls',calls);
  const state={pending:'进行中',awaiting_bill:'结算中',settled:'已结算',failed:'失败 · 未扣'};
  const rows=callPage.items.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString('zh-CN')}</td><td>${esc(x.client||'未记录')}</td><td>${esc(x.model_id)}<small>${esc(x.key_label)}</small></td><td>${x.input_tokens??'—'} / ${x.cached_input_tokens??'—'} / ${x.output_tokens??'—'}</td><td>${x.status==='settled'?employeeYuan(x.charged_yuan):x.status==='failed'?'¥0':'预留 '+employeeYuan(x.hold_yuan)}</td><td>${esc(state[x.status]||x.status)}</td></tr>`).join('');
  // Generating a key is one framed step with two ways to do it; owning keys and their history is "my usage".
  // Managers have that under 用量 → 我的用量; other employees keep it here, under the box.
  const manager=Boolean(lastOrg?.permissions?.manager&&lastOrg?.organization?.id),genViews=[['setup','① 为指定 Agent 生成 Key'],['direct','② 为多个模型生成 Key']],genView=pageView('employee-gen',genViews);
  const views=[['keys',`我的 Key · ${keys.filter(k=>!k.revoked_at).length}`],['calls',`调用历史 · ${calls.length}`]],view=pageView('employee-keys',views);
  const setup=`<div class="kg-flow"><div class="kg-pick"><label class="kg-step"><span class="pc-step-no">1</span><span class="kg-step-body"><small>您选择的模型</small><select data-employee-key-model${c.model_ids.length?'':' disabled'}>${c.model_ids.length?(c.models||[]).map(m=>`<option value="${esc(m.id)}"${m.id===employeeKeyModelId(c)?' selected':''}>${esc(m.name)}</option>`).join(''):'<option>暂无可用模型</option>'}</select></span></label><span class="kg-arrow" aria-hidden="true">→</span><label class="kg-step"><span class="pc-step-no">2</span><span class="kg-step-body"><small>您正在使用的 Agent 工具：请选择</small>${agentToolSelect()}</span></label></div>${employeeKeyPanel(c)}<p class="live-small kg-foot">一把 Key 可调用全部模型，第 1 步只决定填进工具的模型名。最多保留 ${c.key_limit} 枚有效 Key，离开公司企业空间后自动失效。</p>${c.summaries_enabled?`<p class="summary-notice">${ico('circle-alert')} 本公司已开启调用摘要：每次调用会保存你最后一条提问的前 ${c.summary_chars||60} 个字，密钥、邮箱、手机号、证件号等会自动隐去，保存 30 天，仅企业管理者可见。不会保存完整对话。</p>`:''}</div>`;
  const list=keyTable(keys,{action:'employee-revoke'});
  const table=`<div class="personal-table-wrap"><table><thead><tr><th>时间</th><th>来源</th><th>模型 / Key</th><th>输入 / 缓存 / 输出</th><th>金额</th><th>状态</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="personal-model-empty">尚无调用记录。</td></tr>'}</tbody></table></div>${callPage.pager}`;
  const box=`<section class="keygen-box"><header><h3>一键生成 Key</h3><p>接 WorkBuddy、Cursor 等工具选 <b>①</b>；自己写脚本或程序选 <b>②</b>。</p></header>${tabbedPage('employee-gen',genViews,genView==='direct'?directKeyPanel(c):setup)}</section>`;
  const mine=manager?`<p class="keygen-mine">${ico('chart-no-axes-combined')} 我的 ${keys.filter(k=>!k.revoked_at).length} 把 Key 和最近 ${calls.length} 次调用，在 <button type="button" class="link" data-live="go-my-usage">用量 → 我的用量</button> 查看和管理。</p>`:tabbedPage('employee-keys',views,view==='calls'?table:list);
  return purchaseEntry('keys')+box+mine;
 }
 function warmOrg(orgId){
  setTimeout(()=>{
   if(lastOrg?.organization?.id!==orgId)return;
   const redraw=()=>{if(panelOrg&&lastOrg?.organization?.id===orgId&&['support','settings'].includes(orgTab))organizationV2(lastOrg);};
   loadPanelData('tickets','/api/support/tickets',redraw);loadPanelData('answers','/api/support/answers',redraw);loadPanelData('sessions','/api/auth/list-sessions',redraw);
   if(lastOrg.permissions?.manager&&!(lastOrgBilling?.id===orgId&&Date.now()-lastOrgBilling.at<orgFreshMs))api('/api/billing/organizations/'+encodeURIComponent(orgId)).then(data=>{lastOrgBilling={id:orgId,data,at:Date.now()};}).catch(()=>{});
  },300);
 }
 const healthBar=()=>{const t=modelHealthAt?new Date(modelHealthAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'';return `<span class="health-bar">${modelHealthLoading?'正在实测…':t?`实测于 ${t} · 每 10 分钟自动更新`:'尚未实测'}<button type="button" class="health-refresh" data-live="health-refresh" ${modelHealthLoading?'disabled':''}>${ico('clock')} 立即实测</button></span>`;};
 function loadModelHealth(redraw){
  if(!creditActive()||modelHealthLoading||Date.now()-modelHealthTried<5*60000)return;
  modelHealthLoading=true;modelHealthTried=Date.now();
  api('/api/employee-credit/model-health').then(r=>{modelHealth=new Map(r.models.map(m=>[m.model_id,m]));modelHealthAt=Date.parse(r.checked_at)||Date.now();}).catch(()=>{}).finally(()=>{modelHealthLoading=false;redraw();});
 }
 function msTime(value){
  if(!value)return '—';const d=new Date(value),p=Object.fromEntries(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}.${String(d.getMilliseconds()).padStart(3,'0')}`;
 }
 function connectedFor(from,to){
  const ms=Math.max(0,(to?Date.parse(to):Date.now())-Date.parse(from)),d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000),m=Math.floor(ms%3600000/60000);
  return d?`${d} 天 ${h} 小时`:h?`${h} 小时 ${m} 分`:`${m} 分钟`;
 }
 function usageShare(used,granted){
  const g=Number(granted),u=Number(used),pct=g>0?Math.min(100,u/g*100):0;
  return {pct,tone:pct>=90?'high':pct>=60?'mid':'low',label:u>0&&pct<0.1?'<0.1':pct.toFixed(pct<10?1:0)};
 }
 const usageMeter=(used,granted)=>{const x=usageShare(used,granted);return `<span class="usage-meter ${x.tone}" title="已用 ${x.label}%"><i style="width:${x.pct.toFixed(2)}%"></i></span>`;};
 const usagePct=(used,granted)=>`<b class="usage-pct">${usageShare(used,granted).label}%</b>`;
 const usageBar=(used,granted)=>usageMeter(used,granted)+usagePct(used,granted);
 const yuan2=v=>{const n=Number(v||0);return n>0&&n<0.01?'<¥0.01':'¥'+n.toFixed(2);};
 const rolePill=role=>{const manager=['owner','admin','billing'].includes(role);return `<span class="role-pill ${manager?'manager':''}">${customerRoles[role]||'企业成员'}</span>`;};
 const LIVE_MS=5*60*1000;
 const isLive=(lastAt,active)=>Number(active)>0||(lastAt&&Date.now()-Date.parse(lastAt)<LIVE_MS);
 const liveDot=(on,label='使用中')=>on?`<span class="live-dot" title="进行中或 5 分钟内有调用"><i></i>${label}</span>`:'';
 // Average per minute over the last 24 hours, the same definition KerAPI uses.
 const perMinute=(value,minutes=1440)=>{const v=Number(value||0)/minutes;return v===0?'0':v<0.01?'<0.01':v<10?v.toFixed(2):Math.round(v).toLocaleString('zh-CN');};
 const loadCell=x=>`<td class="load-cell" data-sort="${Number(x.calls_24h||0)}" title="最近 24 小时：${Number(x.calls_24h||0)} 次调用，${Number(x.tokens_24h||0).toLocaleString('zh-CN')} Token；峰值为最忙的一分钟"><b>${perMinute(x.calls_24h)}</b> / ${perMinute(x.tokens_24h)}<small>峰值 ${Number(x.peak_rpm||0)} 次/分</small></td>`;
 function directKeyPanel(c){
  const models=c.models||[],count=[...directPicked].filter(id=>models.some(m=>m.id===id)).length,issued=directIssued;
  const rows=models.map(m=>{const x=personalModelMeasurement(m.id);return `<label class="direct-model ${directPicked.has(m.id)?'on':''}"><input type="checkbox" data-direct-model value="${esc(m.id)}" ${directPicked.has(m.id)?'checked':''}><span class="model-light ${modelLight(x)}" aria-hidden="true"></span><span class="direct-model-name"><b>${esc(m.name)}</b><small>${esc(m.id)}</small></span><span class="direct-model-price">¥${Number(m.input_yuan)} / ¥${Number(m.output_yuan)}<small>输入 / 输出 每百万</small></span></label>`;}).join('')||'<p class="personal-model-empty">暂无可用模型。</p>';
  const form=`<div class="direct-key-form"><div class="direct-head"><div><h3>勾选这把 Key 能调用的模型</h3><p class="live-small">适合自己写脚本、命令行或程序直接调用。生成的 Key 只能调用勾选的模型；接入 WorkBuddy、Cursor 等工具请用“为 Agent 生成 Key”。</p></div><div class="direct-quick"><button type="button" data-live="direct-all">全选</button><button type="button" data-live="direct-none">清空</button></div></div><div class="direct-models">${rows}</div>`
   +`<form id="live-direct-create" class="direct-create"><label>用途名称<input name="label" required maxlength="50" placeholder="例如：命令行脚本"></label><label>消费上限（元）<input name="limit_yuan" inputmode="decimal" placeholder="不填则不限"></label><button type="submit" class="personal-key-button personal-key-button-active" data-direct-submit ${count?'':'disabled'}>${ico('command')} 生成 API Key · ${count} 个模型</button><div role="status"></div></form><p class="live-small">每人最多 ${c.key_limit} 枚有效 Key。Key 的费用从你的公司额度扣除；设置上限后，这把 Key 用到上限就会停止。</p></div>`;
  const env=issued?`export SEMIFLY_API_KEY="${issued.secret}"\nexport SEMIFLY_BASE_URL="${c.base_url}"`:'';
  const sample=issued?curlExample(c.base_url,issued.models[0],'$SEMIFLY_API_KEY'):'';
  const result=issued?`<aside class="direct-result"><h3>${esc(issued.label)} · 已生成</h3><p class="key-agent-warning">完整 Key 只显示这一次，离开页面后无法再查看，请现在保存。</p>${keyAgentRow(1,'API Key',`<code class="is-secret">${esc(issued.secret)}</code>`,issued.secret)}${keyAgentRow(2,'接口地址',`<code>${esc(c.base_url)}</code>`,c.base_url)}${keyAgentRow(3,'可用模型',`<code>${esc(issued.models.join(', '))}</code>`,issued.models.join(', '))}${issued.limit?`<p class="live-small">消费上限 ¥${esc(issued.limit)}</p>`:''}<h4>放进命令行</h4><pre class="key-agent-snippet">${esc(env)}</pre>${keyAgentCopy(env,'环境变量')}<h4>调用示例</h4><pre class="key-agent-snippet">${esc(sample)}</pre>${keyAgentCopy(sample,'curl 示例')}<p class="live-small">更多示例和错误码见 <a href="#docs/quickstart">文档中心</a>。</p></aside>`
   :'';
  return `<div class="direct-key${issued?'':' is-solo'}">${form}${result}</div>`;
 }
 function keyTable(keys,{owner=false,action}={}){
  if(!keys.length)return '<p class="personal-model-empty">尚未生成 Key。</p>';
  return `<div class="personal-table-wrap"><table class="key-usage-table"><thead><tr><th>Key</th>${owner?'<th>员工</th>':''}<th>创建时间</th><th>已接通</th><th>可用模型</th><th>调用</th><th>Token</th><th>金额</th><th title="最近 24 小时平均每分钟请求数 / Token 数">RPM / TPM<br><small>24 小时平均</small></th><th>最近来源</th><th>状态</th><th></th></tr></thead><tbody>${keys.map(k=>`<tr><td><b>${esc(k.label)}</b><small>尾号 ${esc(k.key_hint)}</small></td>${owner?`<td>${esc(k.name)}</td>`:''}<td class="mono">${msTime(k.created_at)}</td><td data-sort="${(k.revoked_at?Date.parse(k.revoked_at):Date.now())-Date.parse(k.created_at)}">${k.revoked_at?`${connectedFor(k.created_at,k.revoked_at)} · 已停用`:`${connectedFor(k.created_at)} · 至今`}</td><td class="scope-cell" title="${esc(k.model_ids?k.model_ids.join('、'):'可调用全部已开放模型')}">${k.model_ids?`${k.model_ids.length} 个模型`:'全部模型'}${k.limit_yuan?`<small>上限 ¥${Number(k.limit_yuan)} · 已用 ${yuan2(k.used_yuan)}</small>`:''}</td><td>${Number(k.calls||0).toLocaleString('zh-CN')}</td><td>${Number(k.tokens||0).toLocaleString('zh-CN')}</td><td>${employeeYuan(k.yuan||0)}</td>${loadCell(k)}<td>${esc(k.last_client||'—')}</td><td>${k.revoked_at?'<span class="live-pill muted">已停用</span>':isLive(k.last_call_at,k.active_calls)?liveDot(true):'<span class="live-pill">可调用</span>'}</td><td>${k.revoked_at?'':`<button type="button" data-live="${action==='team-key-revoke'?'team-key-manage':'employee-key-manage'}" data-id="${esc(k.id)}">管理</button> <button type="button" data-live="${action}" data-id="${esc(k.id)}">停用</button>`}</td></tr>`).join('')}</tbody></table></div>`;
 }
 let memberTimer=null;
 function memberDetailBody(userId,d){
  const p=lastOrg?.members.find(x=>x.user_id===userId)||{},u=teamUsage?.members.find(x=>x.user_id===userId),index=lastOrg?.members.findIndex(x=>x.user_id===userId)??-1;
  const name=p.name||u?.name||'员工',on=(p.status||u?.status)==='active',fact=(k,v)=>`<div><span>${k}</span><b>${v}</b></div>`,when=v=>v?msTime(v):'—';
  const calls=d?.calls||[],liveKeys=new Set(calls.filter(c=>c.status==='pending'||Date.now()-Date.parse(c.created_at)<LIVE_MS).map(c=>c.key_id));
  const keys=(teamUsage?.keys||[]).filter(k=>k.owner_id===userId).map(k=>liveKeys.has(k.id)?{...k,active_calls:1}:k),state={pending:'进行中',awaiting_bill:'结算中',settled:'已结算',failed:'失败 · 未扣'};
  const liveNow=d?[...(d.models||[]).filter(m=>isLive(m.last_call_at,m.active_calls)).map(m=>m.model_id),...keys.filter(k=>!k.revoked_at&&isLive(k.last_call_at,k.active_calls)).map(k=>'Key '+k.label)]:[];
  const quota=u?`<section class="detail-block"><h3>公司额度</h3><div class="detail-meter">${usageBar(u.spent_yuan,u.granted_yuan)}</div><div class="detail-facts">${fact('总额度',yuan2(u.granted_yuan))}${fact('已用',yuan2(u.spent_yuan))}${fact('结算中',yuan2(u.held_yuan))}${fact('剩余',yuan2(Math.max(0,Number(u.granted_yuan)-Number(u.spent_yuan)-Number(u.held_yuan))))}</div></section>`:'<p class="live-small">这个企业尚未开通公司额度。</p>';
  if(!d)return `<div class="member-detail"><p class="live-small">正在读取 ${esc(name)} 的使用明细…</p>${quota}</div>`;
  const now=`<section class="detail-block detail-now"><h3>此刻 ${liveNow.length?liveDot(true,'正在使用'):'<span class="live-idle">5 分钟内没有调用</span>'}</h3>${liveNow.length?`<p>${liveNow.map(esc).join('、')}</p>`:''}</section>`;
  const models=`<section class="detail-block"><h3>模型 <small>近 30 天</small></h3>${d.models.length?`<div class="personal-table-wrap"><table><thead><tr><th>模型</th><th>调用</th><th>Token</th><th>金额</th><th>RPM / TPM<br><small>24 小时平均</small></th><th>最近使用</th></tr></thead><tbody>${d.models.map(m=>`<tr><td>${isLive(m.last_call_at,m.active_calls)?liveDot(true,''):'<span class="idle-dot"></span>'}${esc(m.model_id)}</td><td>${m.calls}</td><td>${Number(m.tokens).toLocaleString('zh-CN')}</td><td>${yuan2(m.yuan)}</td>${loadCell(m)}<td class="mono">${when(m.last_call_at)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="personal-model-empty">近 30 天没有调用。</p>'}</section>`;
  const clients=`<section class="detail-block"><h3>调用来源 <small>按请求自带的客户端标识识别</small></h3>${d.clients.length?`<div class="detail-sources">${d.clients.map(c=>`<div>${isLive(c.last_call_at)?liveDot(true,''):'<span class="idle-dot"></span>'}<b>${esc(c.client)}</b><small>${c.calls} 次 · ${esc((c.models||[]).join('、'))} · 最近 ${when(c.last_call_at)}</small></div>`).join('')}</div>`:'<p class="personal-model-empty">暂无记录。</p>'}<p class="live-small">“未识别”表示工具用了通用开发包，没有写明自己的名字；自建 Agent 可在请求头加 X-Semifly-Client 自报名称。</p></section>`;
  const callTable=calls.length?`<div class="personal-table-wrap detail-calls"><table><thead><tr><th>时间</th><th>来源</th><th>模型 / Key</th><th>输入 / 输出</th><th>金额</th><th>状态</th>${d.summaries_enabled?'<th>提问摘要</th>':''}</tr></thead><tbody>${calls.map(c=>`<tr><td class="mono">${msTime(c.created_at)}</td><td title="${esc(c.client_detail||'')}">${esc(c.client||'未记录')}</td><td>${esc(c.model_id)}<small>${esc(c.key_label)}</small></td><td>${c.input_tokens??'—'} / ${c.output_tokens??'—'}</td><td>${c.status==='settled'?yuan2(c.charged_yuan):c.status==='failed'?'¥0':'预留 '+yuan2(c.hold_yuan)}</td><td>${c.status==='pending'?liveDot(true,'进行中'):esc(state[c.status]||c.status)}</td>${d.summaries_enabled?`<td class="detail-summary">${esc(c.summary||'—')}</td>`:''}</tr>`).join('')}</tbody></table></div>`:'<p class="personal-model-empty">最近没有调用。</p>';
  const actions=`<div class="detail-actions">${on&&u?btn('调整额度','team-quota',`data-user="${esc(userId)}" data-name="${esc(name)}"`,'quiet'):''}${index>=0?btn('管理身份与部门','edit-member',`data-index="${index}"`,'quiet'):''}</div>`;
  return `<div class="member-detail"><div class="detail-head">${rolePill(p.role||u?.role)}<span class="live-pill ${on?'':'muted'}">${on?'已启用':'已停用'}</span><span>${esc(p.email||u?.email||'')}</span><span>部门：${esc(p.department||u?.department||'')||'未分组'}</span>${p.created_at?`<span>加入于 ${msTime(p.created_at)}</span>`:''}<span class="detail-refresh">每 20 秒自动刷新 · 更新于 ${new Date().toLocaleTimeString('zh-CN',{hourCycle:'h23'})}</span></div>${now}${quota}<section class="detail-block"><h3>近 30 天</h3><div class="detail-facts">${fact('调用',Number(u?.calls_30d||0).toLocaleString('zh-CN'))}${fact('Token',Number(u?.tokens_30d||0).toLocaleString('zh-CN'))}${fact('最近使用',u?.last_call_at?msTime(u.last_call_at):'尚未使用')}${fact('来源',d.clients.length?esc(d.clients.map(c=>c.client).join('、')):'—')}</div></section>${clients}${models}<section class="detail-block"><h3>名下 Key · ${keys.length}</h3>${keyTable(keys,{action:'team-key-revoke'})}</section><section class="detail-block"><h3>最近调用 <small>最近 30 次${d.summaries_enabled?' · 摘要只保留提问前 60 个字':' · 未开启调用摘要'}</small></h3>${callTable}</section>${actions}</div>`;
 }
 function openMemberDetail(userId){
  clearInterval(memberTimer);
  const name=lastOrg?.members.find(x=>x.user_id===userId)?.name||teamUsage?.members.find(x=>x.user_id===userId)?.name||'员工';
  dialog(esc(name)+' · 员工详情',`<div data-member-detail="${esc(userId)}">${memberDetailBody(userId,null)}</div>`);
  const box=()=>document.querySelector(`#config-dialog [data-member-detail="${CSS.escape(userId)}"]`);
  document.querySelector('#config-dialog')?.classList.add('wide-dialog');
  const load=async()=>{const el=box();if(!el||!document.querySelector('#config-dialog')?.open){clearInterval(memberTimer);return;}
   try{const d=await api('/api/employee-credit/team/members/'+encodeURIComponent(userId));const target=box();if(target)target.innerHTML=memberDetailBody(userId,d);}catch(e){const target=box();if(target)target.insertAdjacentHTML('afterbegin',note(e.message,true));clearInterval(memberTimer);}};
  load();memberTimer=setInterval(load,20000);
 }
 function managerOverview(hero,trend,connect,attention){
  const team=teamUsage,share=m=>Number(m.spent_yuan)/Math.max(Number(m.granted_yuan),0.01),tab=(t,text)=>`<button type="button" data-live="org-tab" data-tab="${t}">${text}</button>`;
  const members=team.members.filter(m=>m.status==='active').sort((a,b)=>share(b)-share(a)).slice(0,6);
  const quota=`<section class="personal-pilot-log mgr-quota"><div class="personal-section-title"><h2>员工额度使用</h2>${tab('people','全部员工')}</div><div class="mgr-quota-list">${members.map(m=>`<div class="mgr-quota-row"><span class="mgr-quota-name"><span class="mgr-quota-title"><button type="button" class="member-link" data-live="member-detail" data-user="${esc(m.user_id)}">${esc(m.name)}</button>${rolePill(m.role)}</span><small title="${esc(m.email)}">${esc(m.email)}</small></span><span class="mgr-quota-meter">${usageMeter(m.spent_yuan,m.granted_yuan)}</span>${usagePct(m.spent_yuan,m.granted_yuan)}<span class="mgr-quota-amount">${yuan2(m.spent_yuan)} / ${yuan2(m.granted_yuan)}</span>${btn('调整','team-quota',`data-user="${esc(m.user_id)}" data-name="${esc(m.name)}"`,'quiet')}</div>`).join('')||'<p class="personal-model-empty">暂无员工。</p>'}</div></section>`;
  const routed=employeeCredit.models||[],catalog=personalCatalog(),ids=[...new Set([...routed.map(m=>m.id),...(modelHealth?[...modelHealth.values()].filter(m=>m.status!=='paused').map(m=>m.model_id):[])])];
  const price=id=>{const r=routed.find(m=>m.id===id);return r?`¥${Number(r.input_yuan)} / ¥${Number(r.output_yuan)}`:'—';},name=id=>routed.find(m=>m.id===id)?.name||modelHealth?.get(id)?.name||catalog.find(m=>m.id===id)?.name||id;
  const checked=modelHealthAt?new Date(modelHealthAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'';
  const models=`<section class="personal-pilot-log mgr-models"><div class="personal-section-title"><h2>模型状态</h2>${healthBar()}</div><div class="ov-model-cards">${ids.map(id=>{const x=personalModelMeasurement(id);return `<button type="button" class="ov-model-card" data-live="org-tab" data-tab="models" title="${esc(x.time?`实测于 ${x.time}`:'尚无实测结果')} · 点击查看价格与接入"><span class="model-light ${modelLight(x)}" aria-hidden="true"></span><span class="ov-model-name"><b>${esc(name(id))}</b><small>${esc(id)}</small></span><span class="ov-model-state"><b class="personal-status ${x.tone}">${x.status}</b><small>${x.latency}</small></span></button>`;}).join('')||'<p class="personal-model-empty">暂无已接通的模型。</p>'}</div></section>`;
  return `<div class="overview-page mgr-overview">${hero}<div class="mgr-grid"><div class="mgr-col">${trend}${models}</div><div class="mgr-col">${quota}${attention}${connect}</div></div></div>`;
 }
 function overviewData(){
  const credit=creditActive(),team=credit&&panelOrg?.permissions?.manager?teamUsage:null;
  const failedCalls=rows=>rows.filter(c=>c.status==='failed').slice(0,3).map(c=>`<b>${esc(c.model_id)}</b> 调用失败${c.name?' · '+esc(c.name):''} · ${new Date(c.created_at).toLocaleString('zh-CN')}`);
  if(team){
   const t=team.totals,calls=team.models.reduce((n,m)=>n+m.calls,0),failed=team.models.reduce((n,m)=>n+m.failed,0);
   const low=team.members.filter(m=>m.status==='active'&&Number(m.granted_yuan)>0&&(Number(m.granted_yuan)-Number(m.spent_yuan)-Number(m.held_yuan))/Number(m.granted_yuan)<0.1).map(m=>`<b>${esc(m.name)}</b> 额度即将用完`);
   return {title:'员工额度余额',balance:Number(t.available_yuan),note:`${t.active_members} / ${t.members} 位员工最近 30 天有调用`,daily:team.daily,figures:[['本月消费',employeeYuan(t.month_yuan)],['30 天调用',calls.toLocaleString('zh-CN')],['成功率',calls?((calls-failed)/calls*100).toFixed(1)+'%':'—']],used:team.models.map(m=>m.model_id),attention:[...low,...failedCalls(team.recent_calls)],action:'recharge'};
  }
  if(credit){
   const e=employeeCredit;
   return {title:'我的公司额度',balance:Math.max(0,Number(e.available_yuan)),note:`发放 ${employeeYuan(e.granted_yuan)}，结算中 ${employeeYuan(e.held_yuan)}`,daily:e.daily||[],figures:[['本月消费',employeeYuan(e.month_yuan)],['30 天调用',Number(e.calls_30d||0).toLocaleString('zh-CN')],['成功率',e.calls_30d?((e.calls_30d-e.failed_30d)/e.calls_30d*100).toFixed(1)+'%':'—']],used:[...new Set((e.daily||[]).map(d=>d.model_id))],attention:[...(Number(e.granted_yuan)>0&&Number(e.available_yuan)/Number(e.granted_yuan)<0.1?['公司额度即将用完，请联系企业管理者追加']:[]),...failedCalls(e.recent_calls||[])],action:null};
  }
  if(panelOrg){const manager=Boolean(panelOrg.permissions?.manager);return {title:manager?'公司额度':'我的额度',balance:null,note:manager?'这个企业尚未开通公司额度':'你的企业尚未开通额度',daily:[],figures:manager?[['团队成员',String(panelOrg.members.filter(p=>p.status==='active').length)],['待审批',String((panelOrg.joinRequests||[]).length)],['模型调用','—']]:[['本月消费','—'],['30 天调用','—'],['成功率','—']],used:[],attention:[],action:null};}
  const pilot=personalPilot?.enabled?personalPilot:null,models=pilot?.usage_by_model||[],ok=models.reduce((n,m)=>n+Number(m.successful_calls||0),0),bad=models.reduce((n,m)=>n+Number(m.failed_calls||0),0);
  return {title:'官价额度',balance:Number(personalBilling?.list_credit_fen??personalBilling?.cash_balance_fen??0)/100,note:`按官网价可消费 · 实付见账单`,daily:[],figures:[['累计已用',personalMoney(personalBilling?.total_spent_fen)],['30 天调用',(ok+bad).toLocaleString('zh-CN')],['成功率',ok+bad?(ok/(ok+bad)*100).toFixed(1)+'%':'—']],used:models.map(m=>m.model_id),attention:failedCalls(pilot?.recent_calls||[]),action:'recharge'};
 }
 function purchaseEntry(place='usage',compact=false){
  const org=panelOrg?.organization,manager=Boolean(panelOrg?.permissions?.manager);
  if(org&&!manager){
   if(compact)return '';
   return `<aside class="purchase-entry"><div><b>使用公司分配的额度</b><p>额度不足时请联系企业管理员；无需向个人账户充值。</p></div><a href="#organization/${esc(org.id)}/support">联系支持</a></aside>`;
  }
  const billing=org?(lastOrgBilling?.id===org.id?lastOrgBilling.data:null):personalBilling,href=org?'#billing/organization/'+esc(org.id):'#billing/personal';
  const available=org?null:paidCredit?Math.max(0,(Number(paidCredit.list_credit_fen)-Number(paidCredit.held_fen??0))/100):billing?Number(billing.list_credit_fen??billing.cash_balance_fen)/100:null;
  const enabled=Boolean(billing?.payments_enabled),label=org?'企业充值':enabled?'充值额度':'额度与账单';
  if(compact)return `<a class="pc-purchase-link" href="${href}">${label}</a>`;
  const low=available!==null&&available<=0,title=low?'可用额度已用完':place==='models'?'按用量付费，额度可用于已开放模型':place==='keys'?'Key 负责接入，额度用于调用':'查看消耗，随时补充额度';
  const detail=org?'充值进入当前企业账户，员工使用公司分配的额度。':low?'充值后继续使用现有 Key；创建 Key 或设置上限不会增加余额。':'充值进入当前个人账户，按实际调用扣除官价额度。';
  return `<aside class="purchase-entry${low?' purchase-entry-low':''}"><div><b>${title}</b><p>${available===null?'':`可用官价额度 ¥${available.toFixed(2)} · `}${detail}</p></div><a href="${href}">${label}</a></aside>`;
 }
// Red/green progress bar: dashed outline = historical maximum list total.
// Inside, left green (gift, expires in 180d) then red (paid cash, never expires),
// then the already-spent red as a transparent segment. Red is consumed first.
function creditBarBlock(){
const s=personalBilling?.credit_split;if(!s||!BigInt(s.max_face_fen||s.face_fen||0))return '';
const max=BigInt(s.max_face_fen||s.face_fen),green=BigInt(s.green_fen||0),red=BigInt(s.red_fen||0),spent=BigInt(s.spent_red_fen||0);
const pct=v=>Number(max)>0?Math.max(0,Math.min(100,Number(v)/Number(max)*100)):0;
const gw=pct(green),rw=pct(red),sw=pct(spent);
const refund=panelOrg?'':`<div class="credit-bar-refund">当前可自助退 ${personalMoney(refundableTotal(personalBilling.packs||[]))}${refundableTotal(personalBilling.packs||[])>0n?`<a href="#${refundRoute}">去退款 →</a>`:''}<a href="#support">提交工单</a></div><p class="credit-bar-policy">可退金额不包含首次 VIP 激活款、已开票金额及约定不可退款的优惠款项。不可退实付仍可用于消费；特殊情况请提交工单。</p>`;
const expired=s.expired_gift_fen&&BigInt(s.expired_gift_fen)>0n?`<p class="credit-bar-expired">已过期赠送 ${personalMoney(s.expired_gift_fen)}（赠送额度半年有效，过期自动作废，实付不受影响）</p>`:'';
return `<div class="credit-bar-block"><div class="credit-bar-head"><span>官价额度构成</span><b>可用 ${personalMoney(s.remaining_fen)} / 历史累计 ${personalMoney(s.max_face_fen||s.face_fen)}</b></div><div class="credit-bar-outline"><div class="credit-bar" role="img" aria-label="赠送 ${personalMoney(String(green))}，实付剩余 ${personalMoney(String(red))}，已用实付 ${personalMoney(String(spent))}"><i class="seg-green" style="width:${gw}%">${gw>=18?personalMoney(String(green)):''}</i><i class="seg-red" style="width:${rw}%">${rw>=18?personalMoney(String(red)):''}</i><i class="seg-spent-red" style="width:${sw}%"></i></div></div><div class="credit-bar-legend"><span><i class="dot-green"></i>赠送 ${personalMoney(String(green))}</span><span><i class="dot-red"></i>实付剩余 ${personalMoney(String(red))}</span><span><i class="dot-spent"></i>已用实付 ${personalMoney(String(spent))}</span></div>${expired}${refund}</div>`;
}
function personalHomeContent(){
  const credit=paidCredit?.enabled?paidCredit:personalPilot?.enabled?personalPilot:null;
  const base=credit?.base_url,keys=(credit?.keys||[]).filter(k=>!k.revoked_at);
  const remaining=personalBilling?BigInt(personalBilling.list_credit_fen??personalBilling.cash_balance_fen??0)-BigInt(Math.ceil(Number(paidCredit?.held_fen??0))):null;
  const available=remaining===null?null:remaining>0n?remaining:0n;
  const tab=(name,label)=>`<button type="button" class="ph-link" data-live="personal-tab" data-tab="${name}">${label}${ico('arrow-right')}</button>`;
  return `<section class="personal-home" aria-labelledby="ph-title">
    <h1 id="ph-title">概览</h1>
    <section class="ph-balance" aria-label="个人额度">
      <div class="ph-balance-main"><span>可用官价额度</span><strong>${available===null?'—':personalMoney(available)}</strong><p>${available===null?'额度暂未加载，请刷新重试。':'按模型官网价计费'}</p></div>
      <div class="ph-balance-actions"><a class="ph-primary" href="#billing/personal">${personalBilling?.payments_enabled?'充值':'查看账单'}</a>${personalBilling?.payments_enabled?'<a class="ph-link" href="#billing/personal/usage">消费账单</a>':''}</div>
      ${personalBilling?personalBalanceBar(personalBilling,{overview:true}):'<div class="ph-spent"><span>累计消费</span><b>—</b></div>'}
    </section>
    <section class="ph-connect" aria-labelledby="ph-connect-title"><div class="ph-section-head"><h2 id="ph-connect-title">API 接入</h2><a class="ph-link" href="#docs">接入文档${ico('arrow-up-right')}</a></div>
      ${base?`<div class="ph-endpoint"><span>API 地址</span><code>${esc(base)}</code><button type="button" class="ph-copy" data-live="copy-text" data-text="${esc(base)}" aria-label="复制 API 地址">${ico('copy')}<span>复制</span></button></div><div class="ph-key-row"><span>${keys.length?`${keys.length} 枚有效密钥`:'创建密钥，开始第一次调用'}</span>${tab('keys',keys.length?'管理密钥':'创建密钥')}</div>`:'<p class="ph-unavailable">个人 API 调用暂未开放。</p>'}
    </section>
  </section>`;
}
function overviewContent(){
  if(!panelOrg)return personalHomeContent();
const d=overviewData(),tabLink=(tab,text,cls='')=>panelOrg?`<button type="button" class="${cls}" data-live="org-tab" data-tab="${tab}">${text}</button>`:`<button type="button" class="${cls}" data-live="personal-tab" data-tab="${tab}">${text}</button>`;
  const days=Array.from({length:14},(_,i)=>new Date(Date.now()+8*3600000-(13-i)*86400000).toISOString().slice(0,10)),week=days.slice(-7);
  const total=day=>d.daily.filter(x=>x.day===day).reduce((n,x)=>n+Number(x.yuan),0),burn=week.reduce((n,day)=>n+total(day),0)/7,left=d.balance!==null&&burn>0?Math.floor(d.balance/burn):null;
  const modelIds=[...new Set(d.daily.map(x=>x.model_id))],palette=['#8e2deb','#17a673','#f58d09','#2f7de1','#e0457b','#5b6478'],color=id=>palette[modelIds.indexOf(id)%palette.length],max=Math.max(...days.map(total),0.000001);
  const bars=days.map(day=>`<div class="team-bar" title="${day} · ${employeeYuan(total(day))}">${d.daily.filter(x=>x.day===day).map(x=>`<i style="height:${Math.max(Number(x.yuan)/max*100,Number(x.yuan)>0?2:0)}%;background:${color(x.model_id)}" title="${esc(x.model_id)} · ${employeeYuan(x.yuan)} · ${x.calls} 次"></i>`).join('')}<small>${day.slice(5)}</small></div>`).join('');
  const recharge=d.action==='recharge'&&(panelOrg||personalBilling?.payments_enabled)?`<a class="overview-primary" href="${panelOrg?'#billing/organization/'+esc(panelOrg.organization.id):'#billing/personal'}">${ico('server')} 充值</a>`:'';
  // 个人账户：已充值显示红绿条，未充值显示「待充值」引导，去掉复杂标签。
  const isPersonalEmpty=!panelOrg&&!creditActive()&&!(personalBilling?.credit_split&&BigInt(personalBilling.credit_split.remaining_fen||0)>0);
  const personalEmpty=`<div class="overview-empty-state"><p>还没有可用额度。充值后这里会显示官价额度构成——虚线框是历史累计总额，左侧绿色是赠送、中间红色是你实付的金额，用量永远先扣红色、扣完才扣绿色，随时可退、无手续费。实付长期有效，赠送额度半年内有效。</p><a class="overview-primary" href="#billing/personal">${ico('server')} 去充值</a></div>`;
  const hero=`<section class="overview-hero"><div class="overview-balance"><span>${d.title}</span><strong>${d.balance===null?'未开通':'¥'+d.balance.toFixed(2)}</strong><small>${isPersonalEmpty?'待充值 · 充值后按官价使用':left===null?d.note:`按近 7 天消费，预计可用 ${left.toLocaleString('zh-CN')} 天 · ${d.note}`}</small></div>${isPersonalEmpty?personalEmpty:creditBarBlock()}<div class="overview-figures">${d.figures.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>${isPersonalEmpty?'':recharge}</section>`;
  const trend=`<section class="personal-pilot-log"><div class="personal-section-title"><h2>消费趋势</h2><span>最近 14 天 · 按模型</span></div>${d.daily.length?`<div class="team-bars">${bars}</div><div class="chart-legend trend-legend">${modelIds.map(id=>`<span><i class="team-dot" style="background:${color(id)}"></i>${esc(id)}</span>`).join('')}</div>`:`<div class="overview-empty"><p>还没有消费记录。生成 Key 并发起第一次调用后，这里会显示真实消费。</p>${tabLink('keys','去生成 Key')}</div>`}</section>`;
  const credit=creditActive(),base=credit?employeeCredit.base_url:paidCredit?.enabled?paidCredit.base_url:(!panelOrg&&personalPilot?.enabled?personalPilot.base_url:null),keyCount=credit?(employeeCredit.keys||[]).filter(k=>!k.revoked_at).length:paidCredit?.enabled?(paidCredit.keys||[]).filter(k=>!k.revoked_at).length:(!panelOrg&&personalPilot?.enabled?(personalPilot.keys||[]).filter(k=>!k.revoked_at).length:0),sampleModel=credit?employeeCredit.model_ids?.[0]:paidCredit?.enabled?paidCredit.models?.[0]?.id:(!panelOrg?personalPilot?.model_ids?.[0]:null);
  const sample=base&&sampleModel?`curl ${base}/chat/completions -H "Authorization: Bearer 你的Key" -H "Content-Type: application/json" -d '{"model":"${sampleModel}","messages":[{"role":"user","content":"你好"}]}'`:'';
  const connect=`<section class="personal-pilot-log overview-connect"><div class="personal-section-title"><h2>快速接入</h2></div>${base?`<div class="overview-row"><div><small>接入地址</small><code>${esc(base)}</code></div><button type="button" data-live="copy-text" data-text="${esc(base)}">复制</button></div><div class="overview-row"><div><small>我的 Key</small><b>${keyCount} 枚有效</b></div>${tabLink('keys',keyCount?'管理':'生成')}</div><div class="overview-row"><div><small>调用示例</small><code class="overview-sample">${esc(sample)}</code></div><button type="button" data-live="copy-text" data-text="${esc(sample)}">复制</button></div>`:`<p class="personal-model-empty">${employeeCredit?.enabled&&!panelOrg?`你的公司额度在 <a href="#organization/${esc(employeeCredit.organization_id)}/overview">${esc(employeeCredit.organization_name)}</a> 空间使用。`:'当前账号尚未开通调用。'}</p>`}</section>`;
  const catalog=personalCatalog(),inUse=catalog.filter(m=>d.used.includes(m.id));
  const modelsCta=`<section class="overview-models-cta"><div><b>${ico('layers')} ${inUse.length?`我在用 ${inUse.length} 个模型`:'模型与价格'}</b><p>${inUse.length?'详细型号、延迟与接入配置在「模型」页。':'在「模型」页查看可用型号、价格与接入配置。'}</p></div>${tabLink('models','打开模型页')}</section>`;
  const attention=`<section class="personal-pilot-log overview-attention"><div class="personal-section-title"><h2>需要处理</h2></div>${d.attention.length?`<ul>${d.attention.map(x=>`<li>${x}</li>`).join('')}</ul>`:'<p class="personal-model-empty">暂无需要处理的事项。</p>'}</section>`;
  if(panelOrg?.permissions?.manager&&creditActive()&&teamUsage)return managerOverview(hero,trend,connect,attention);
  return `<div class="overview-page">${hero}<div class="overview-grid">${trend}${connect}${attention}${modelsCta}</div></div>`;
 }
 function personalDashboardContent(){
  if(personalTab==='overview')return overviewContent();
  if(personalTab==='usage'&&!panelOrg&&!creditActive())return personalUsageContent();
  if(personalTab==='compare')return comparePanel();
  if(personalTab==='models'&&!panelOrg)return personalModelsContent();
  if(personalTab==='connect'&&!panelOrg)return personalConnectContent();
  if(personalTab==='keys'&&!panelOrg&&paidCredit?.enabled)return personalApiContent();
  const selected=personalCatalog().find(m=>m.id===personalSelected)||personalCatalog()[0];
  if(personalTab==='models'){
   const rows=personalCatalogRows(),rates=selected?personalBaseRate(selected):null,pilotSelected=Boolean(!panelOrg&&personalPilot?.enabled&&personalPilot.model_ids?.includes(selected?.id)),employeeSelected=Boolean(creditActive()&&employeeCredit.model_ids?.includes(selected?.id)),paidSelected=Boolean(!creditActive()&&paidCredit?.enabled&&paidCredit.models?.some(m=>m.id===selected?.id));
   const buyHead=!panelOrg&&!creditActive()?`<section class="personal-buy-strip"><div><strong>开始选购</strong><p>${personalBilling?.credit_split&&BigInt(personalBilling.credit_split.remaining_fen||0)?'你已有可用额度，选择模型后即可生成 Key 开始调用。':'还没有额度。选择模型后充值下单，即可生成 Key 开始调用。'}</p></div>${personalBilling?.payments_enabled?`<a class="overview-primary" href="#billing/personal">${ico('server')} 去充值下单</a>`:`<button class="live-button primary" type="button" data-live="personal-tab" data-tab="billing">查看充值</button>`}</section>`:'';
   return `<div class="personal-console-grid" style="--personal-model-share:${personalPaneShare}%"><section class="personal-model-panel">${buyHead}<div class="personal-section-title"><h2>模型目录</h2>${creditActive()?healthBar():''}<label class="personal-price-period">官网价 · ¥/百万 Token <select data-personal-price-period aria-label="DeepSeek 价格时段"><option value="offpeak" ${personalPricePeriod==='offpeak'?'selected':''}>空闲</option><option value="peak" ${personalPricePeriod==='peak'?'selected':''}>高峰</option></select></label></div><div class="personal-model-tools"><div class="personal-family" aria-label="按品牌筛选">${[['all','全部'],['deepseek','DeepSeek'],['glm','GLM']].map(([key,label])=>`<button type="button" data-live="personal-family" data-family="${key}" aria-pressed="${personalFamily===key}" class="${personalFamily===key?'active':''}">${label}</button>`).join('')}</div><label class="personal-use-filter">能力：<select data-personal-use aria-label="按能力筛选"><option value="all" ${personalUse==='all'?'selected':''}>全部能力</option><option value="writing" ${personalUse==='writing'?'selected':''}>对话写作</option><option value="reasoning" ${personalUse==='reasoning'?'selected':''}>深度推理</option><option value="coding" ${personalUse==='coding'?'selected':''}>编程</option><option value="vision" ${personalUse==='vision'?'selected':''}>视觉理解</option></select></label><label class="personal-model-search">${ico('search')}<input data-personal-search aria-label="搜索模型" placeholder="搜索模型名称…" value="${esc(personalSearch)}"></label></div><div class="personal-table-wrap"><table><thead><tr>${creditActive()?'<th class="col-pick" title="勾选后可直接生成限定这些模型的 Key"></th>':''}<th>模型</th><th class="col-status">状态<br><small>实测延迟</small></th><th class="col-cap">能力</th><th>输入价<br><small>未命中 · ¥/百万 Token</small></th><th>输出价<br><small>¥/百万 Token</small></th><th class="col-act">操作</th></tr></thead><tbody data-personal-rows>${rows.html}</tbody></table></div>${creditActive()&&directPicked.size?`<div class="pick-bar"><span>已勾选 <b>${directPicked.size}</b> 个模型</span><button type="button" class="pick-go" data-live="pick-generate">${ico('command')} 用这些模型生成 Key</button><button type="button" data-live="pick-clear">清空</button></div>`:''}<p class="personal-model-caption">${rows.count} 款公开型号 · DeepSeek 当前显示${personalPricePeriod==='peak'?'高峰':'空闲'}时段价，缓存价及完整规则见<a href="#market">完整价格</a>。${creditActive()||paidCredit?.enabled?'额度可用于账号已开放的模型。':'未开放型号暂不可调用。'}${creditActive()?'状态为平台每 10 分钟实测一次的结果，延迟是最短请求的响应时间。':'绿灯 = 本账号近 24 小时调用成功，不代表长期稳定。'}读取数据不耗 Token。${personalPilot?.enabled?`<button type="button" class="personal-evidence-refresh" data-live="pilot-refresh">刷新实测</button>`:''}</p></section><div class="personal-pane-handle" role="separator" tabindex="0" aria-label="调整模型目录和接入配置宽度" aria-orientation="vertical" aria-valuemin="39" aria-valuemax="72" aria-valuenow="${personalPaneShare}"><span></span></div><aside class="personal-connect-panel"><div class="personal-section-title"><h2>接入配置</h2><span class="pc-connect-status">${ico('clock')} ${employeeSelected?'可调用':paidSelected?'按用量付费':pilotSelected?'限量测试可用':'等待开放调用'}</span></div>${selected?`<ol class="pc-steps"><li class="pc-step"><span class="pc-step-no">1</span><div class="pc-step-body"><p class="pc-step-label">您选择的模型</p><div class="personal-selected-model"><i class="${selected.family}"></i><div><b>${esc(selected.name)}</b><small>${esc(selected.tags.slice(0,2).join('、'))}</small></div></div><p class="pc-step-sub">在左侧模型目录中点选可更换</p></div></li><li class="pc-step"><span class="pc-step-no">2</span><div class="pc-step-body"><p class="pc-step-label">您正在使用的 Agent 工具：请选择</p>${agentToolSelect()}</div></li><li class="pc-step${agentTool().unsupported?' pc-step-blocked':''}"><span class="pc-step-no">3</span><div class="pc-step-body"><p class="pc-step-label pc-step-label-strong">${agentStepTitle(selected)}</p>${agentTool().unsupported?`<p class="pc-step-warn">${esc(agentTool().unsupported)}</p>`:`<ol class="pc-howto">${agentTool().steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol><div class="pc-access-values" style="--kv-label:${labelEm(agentTool().base,agentTool().model,agentTool().key)}"><div><span>${esc(agentTool().base||'Base URL')}</span><code>${employeeSelected?esc(employeeCredit.base_url):paidSelected?esc(paidCredit.base_url):pilotSelected?esc(personalPilot.base_url):'待接入'}</code></div><div><span>${esc(agentTool().model||'模型名称')}</span><code>${esc(selected.upstreamId)}</code></div><div><span>${esc(agentTool().key||'API Key')}</span><code>${employeeSelected||paidSelected||pilotSelected?'到密钥页创建':'尚未生成'}</code></div></div>${employeeSelected?`<button class="personal-key-button personal-key-button-active" type="button" data-live="employee-open-keys">${ico('command')} 生成我的 API Key</button>`:paidSelected?`<button class="personal-key-button personal-key-button-active" type="button" data-live="paid-create">${ico('command')} 创建 ${esc(selected.name)} API Key</button>`:pilotSelected?`<button class="personal-key-button personal-key-button-active" type="button" data-live="pilot-open-keys">${ico('command')} 创建 ${esc(selected.name)} 测试 Key</button>`:`<button class="personal-key-button" type="button" disabled>${ico('settings')} 创建平台 Key 与配置 · 待开放</button>`}`}</div></li></ol><div class="pc-config-fields pc-price-fields"><div><span>输入价</span><strong>${personalPrice(rates.miss)} / 1M</strong></div><div><span>缓存命中</span><strong>${personalPrice(rates.hit)} / 1M</strong></div><div><span>输出价</span><strong>${personalPrice(rates.output)} / 1M</strong></div></div><p class="personal-connect-note">官网价；${selected.price.kind==='timed'?`DeepSeek 此处为${personalPricePeriod==='peak'?'高峰':'空闲'}时段价。`:'智谱此处为标准 API 价。'}${employeeSelected?'调用从公司额度扣除。':paidSelected?'调用按官网价扣除当前账户额度。':pilotSelected?'当前是限量真实测试，不扣客户余额。':'供应、收款和计量验收后开放。'}</p>${employeeSelected||paidSelected?purchaseEntry('models'):''}`:'<p class="personal-model-empty">模型目录暂不可读。</p>'}</aside></div>`;
  }
  if(personalTab==='keys'){
   if(!creditActive()&&paidCredit)return paidKeyPanel();
   if(creditActive())return employeeCreditKeys();
   if(panelOrg)return `<section class="personal-state-panel"><span class="live-eyebrow">API KEYS / 密钥</span><h2>公司额度还没有开通</h2><p>这个企业开通公司额度后，员工可以在这里生成自己的 Key，调用费用从公司额度扣除。</p></section>`;
   if(!personalPilot?.enabled)return `<section class="personal-state-panel personal-keys-guide"><span class="live-eyebrow">API KEYS / 密钥</span><h2>个人 API Key 即将开放</h2><p>模型调用正在做最后的供应、计费和付款验收。开放后，你可以在这里生成 Key，接入 Cursor、Claude Code 等工具。</p><div class="keys-guide-grid"><article><b>${ico('layers')} 现在可以</b><p><a href="#market">在模型广场看模型和价格</a>，或<a href="#support">提交工单</a>告诉我们你想用的模型。</p></article><article><b>${ico('building-2')} 如果你是企业员工</b><p>请公司管理者发邀请链接。加入后用公司额度生成 Key，不需要个人充值。</p></article><article><b>${ico('command')} 开放之后</b><p>先充值，再回到这里生成 Key，按实际用量扣费。</p></article></div></section>`;
   const keys=personalPilot.keys||[];
   return `<section class="personal-state-panel personal-pilot-keys"><span class="live-eyebrow">REAL PILOT / 限量测试</span><h2>创建自己的平台测试 Key</h2><p>每枚 Key 只用于选定的 DeepSeek 型号。每天最多 ${personalPilot.daily_limit} 次，今天已用 ${personalPilot.calls_today} 次；实际请求消耗我们的上游测试额度，不扣你的余额。当前只支持非流式纯文本，最多输入 4000 字符、输出 256 Token。</p><div class="pilot-key-setup"><div><small>接入地址</small><code>${esc(personalPilot.base_url)}</code></div><div><small>可选模型</small><code>${personalPilot.model_ids.map(esc).join(' / ')}</code></div></div><button class="personal-key-button personal-key-button-active" type="button" data-live="pilot-create">${ico('command')} 创建测试 Key</button><div class="pilot-key-list">${keys.length?keys.map(k=>`<div><span><b>${esc(k.label)}</b><small>尾号 ${esc(k.key_hint)} · ${esc(modelIntentNames[k.model_id]||k.model_id)} · ${k.revoked_at?'已停用':'可调用'}</small></span>${k.revoked_at?'':`<button type="button" data-live="pilot-revoke" data-id="${esc(k.id)}">停用</button>`}</div>`).join(''):'<p>尚未创建测试 Key。</p>'}</div><p>Key 只在创建时显示一次；请妥善保存。上游 DeepSeek Key 不会交付给你或出现在网页源代码里。</p></section>`;
  }
  if(!creditActive()&&paidCredit)return paidUsagePanel();
  if(personalPilot?.enabled||!(personalBilling?.usage_by_model||[]).length)return personalPilotUsage();
  const entries=(personalBilling?.entries||[]).slice(0,8);
  const usageViews=[['models','模型用量'],['ledger','资金流水'],['recent','最近调用']];
  return tabbedPage('personal-usage',usageViews,pageView('personal-usage',usageViews)==='recent'?personalRecent():pageView('personal-usage',usageViews)==='ledger'?`<section class="personal-ledger"><div class="personal-section-title"><h2>资金流水</h2><a href="#billing/personal">查看全部 ${ico('arrow-right')}</a></div>${entries.length?`<div class="personal-table-wrap"><table><thead><tr><th>时间</th><th>事项</th><th>金额</th><th>结余</th></tr></thead><tbody>${entries.map(e=>`<tr><td>${new Date(e.created_at).toLocaleString('zh-CN')}</td><td>${esc(e.reference_id?.startsWith('refund-fee:')?'退款手续费':({recharge:'充值',usage:'模型使用',refund:'退款',reversal:'冲正'}[e.kind]||'资金变动'))}</td><td>${personalMoney(e.amount_fen)}</td><td>${personalMoney(e.balance_after_fen)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="personal-empty-ledger">暂无真实资金流水。</p>'}</section>`:modelUsagePanel('personal',personalBilling?.usage_by_model||[]));
 }
 function replacePanelContent(target,html){
  if(target.innerHTML===html)return;
  const selectors=['.pc-stage','.personal-table-wrap','.personal-connect-panel','[data-personal-content]'];
  const saved=selectors.flatMap(selector=>[...(target.matches(selector)?[target]:target.querySelectorAll(selector))].map((el,index)=>({selector,index,top:el.scrollTop,left:el.scrollLeft})));
  const top=target.scrollTop,left=target.scrollLeft;
  target.innerHTML=html;
  target.scrollTop=top;target.scrollLeft=left;
  for(const pos of saved){const el=target.matches(pos.selector)?target:target.querySelectorAll(pos.selector)[pos.index];if(el){el.scrollTop=pos.top;el.scrollLeft=pos.left;}}
 }
 function updatePersonalDashboard(){
  if(location.hash.slice(1)!==current)return;
  if(!panelOrg){const routeTab=current==='personal'?'overview':current.startsWith('personal/')?current.split('/')[1]:null;if(routeTab!==personalTab)return;}
  const content=host?.querySelector('[data-personal-content]');if(!content)return;
  if(personalTab!=='compare'||!content.querySelector('.workspace-compare-frame'))replacePanelContent(content,personalDashboardContent());
  if(!panelOrg){const row=host.querySelector('.personal-console-stats');if(row)row.hidden=['overview','compare'].includes(personalTab);}
  syncPersonalUsageCharts();
  host.querySelectorAll('[data-personal-tab]').forEach(b=>{const active=b.dataset.tab===personalTab||(personalTab==='connect'&&b.dataset.tab===(current==='personal/connect/all'?'keys':'models'));b.classList.toggle('active',active);if(b.getAttribute('role')==='tab')b.setAttribute('aria-selected',String(active));else b.setAttribute('aria-current',active?'page':'false');});
 }
 async function account(ticket,earlyBilling){
  if(me?.upgrade?.status==='approved'&&me.upgrade.organization_id){location.hash='organization/'+me.upgrade.organization_id;return;}
  panelOrg=null;teamUsage=null;
  personalTab=current.startsWith('personal/')?current.split('/')[1]:'overview';
  if(!['overview','models','keys','usage','compare','connect','vip'].includes(personalTab))personalTab='overview';
  if(personalTab==='vip'){panelRedraw=null;mount(panelPage(null,'vip',`<iframe class="workspace-compare-frame personal-api" title="VIP 合作计划" src="/promotion/vip.html?embedded=1&personal=1"></iframe>`));return;}
  // The comparison endpoint owns eligibility; do not wait for unrelated dashboard data.
  if(personalTab==='compare'){panelRedraw=null;mount(panelPage(null,'compare',comparePanel()));return;}
  const intent=readModelIntent();if(current.startsWith('personal/connect/'))personalSelected=current.slice('personal/connect/'.length);else if(intent?.scope==='personal')personalSelected=intent.id;
  const billingPromise=earlyBilling?earlyBilling.then(result=>{if(result.error)throw result.error;return result.data;}):api('/api/billing/personal');
  const [billing,pilot,employee,credit]=await Promise.all([
   billingPromise.catch(e=>{if(e.status===401)throw e;return null;}),
   api('/api/pilot/status').catch(()=>({enabled:false})),
   api('/api/employee-credit/status').catch(()=>({enabled:false})),
   api('/api/customer-credit/status').catch(()=>null)
  ]);
  if(ticket!==generation)return;
  personalBilling=billing;personalPilot=pilot;employeeCredit=employee;paidCredit=credit;
  if(personalTab==='usage'&&!creditActive())await loadPersonalUsage(false);
  if(ticket!==generation)return;
  const usage=personalBilling?.usage_by_model||[];
  const pilotCalls=personalPilot?.enabled?(personalPilot.usage_by_model||[]).reduce((sum,row)=>sum+Number(row.successful_calls||0),0):0;
  const callCount=pilotCalls?pilotCalls.toLocaleString('zh-CN'):usage.length?usage.reduce((sum,row)=>sum+Number(row.calls||0),0).toLocaleString('zh-CN'):'—';
  panelRedraw=null;mount(panelPage(null,personalTab,`<div class="personal-console-stats" ${['overview','compare'].includes(personalTab)?'hidden':''}><div class="pc-stat-balance">${ico('server')}<span>官价额度</span><strong>${personalMoney(personalBilling?.list_credit_fen??personalBilling?.cash_balance_fen)}</strong></div><div class="pc-stat-spent">${ico('receipt-text')}<span>累计已用</span><strong>${personalMoney(personalBilling?.total_spent_fen)}</strong></div><div class="pc-stat-calls">${ico('chart-no-axes-combined')}<span>模型调用</span><strong>${callCount}</strong></div><div class="pc-stat-budget">${ico('clock')}<span>调用状态</span><strong>${personalPilot?.enabled?'限量测试':paidCredit?.enabled?'付费通道':'待开放'}</strong></div></div>${employeeCreditBand()}<div data-personal-content>${personalDashboardContent()}</div>`));
 }
 // 同一套页眉和目录：个人与企业只差权限，不差页面。
 let paidCredit=null;
 function paidScope(){return panelOrg?'?org='+encodeURIComponent(panelOrg.organization.id):'';}
 function updatePaidKeyPreview(form){
  const options=[...form.querySelectorAll('[name="models"]')];
  const selected=options.filter(option=>option.checked).length;
  const selectAll=form.querySelector('[data-paid-key-all]');
  selectAll.checked=options.length>0&&selected===options.length;
  selectAll.indeterminate=selected>0&&selected<options.length;
  const value=form.elements.limit_yuan.value;
  const available=BigInt(form.dataset.availableFen||0);
  const match=value.match(/^(\d{1,6})(?:\.(\d{1,2}))?$/);
  const requested=value===''?available:match?BigInt(match[1])*100n+BigInt((match[2]||'').padEnd(2,'0')):0n;
  form.querySelector('[data-paid-key-preview]').textContent=requested>0n?`本 Key 消费上限 ${yuanText(requested)}`:'本 Key 消费上限 —';
  form.querySelector('[data-paid-key-available]').textContent=`当前未分配额度 ${yuanText(available)}`;
  form.elements.limit_yuan.setCustomValidity(requested>available?'消费上限不能超过当前未分配额度。':value!==''&&!requested?'请输入大于零的金额，最多两位小数。':'');
  form.querySelector('[type=submit]').disabled=form.dataset.submitting==='true'||!selected||requested<=0n||requested>available;
 }
 function paidKeyCreateForm(credit){
  if(!credit.models.length)throw Error('当前没有已开放的付费模型，请稍后再试。');
  const savedIntent=!panelOrg?readModelIntent():null,intent=savedIntent?.scope==='personal'?savedIntent:null;
  const preferred=credit.models.some(model=>model.id===(intent?.id||personalSelected))?(intent?.id||personalSelected):credit.models[0].id;
  const chosen=new Set(!panelOrg&&!intent?personalChosenModels():[preferred]);
  const models=credit.models.map(model=>`<label><input type="checkbox" name="models" value="${esc(model.id)}" ${chosen.has(model.id)?'checked':''}> <span>${esc(model.name)}</span></label>`).join('');
  form('创建付费 Key',`<label>用途名称<input name="label" required maxlength="50"></label>
   <fieldset class="paid-key-models"><legend>允许模型（可多选）</legend><p class="live-small">同一把 Key 可调用所选模型；每次请求用 model 指定一个。</p>
    <label><input type="checkbox" data-paid-key-all> <span>全选已开放模型</span></label>
    <div>${models}</div>
   </fieldset>
   <label>消费上限（元，可留空）<input name="limit_yuan" inputmode="decimal" maxlength="9" placeholder="留空使用当前未分配额度" aria-describedby="paid-key-amount"></label>
   <div class="paid-key-amount" id="paid-key-amount" aria-live="polite"><strong data-paid-key-preview></strong><span data-paid-key-available></span></div>`,'live-paid-key','生成 Key');
  const editor=document.querySelector('#live-paid-key');
  editor.dataset.availableFen=credit.unallocated_fen;
  updatePaidKeyPreview(editor);
 }
 document.addEventListener('change',e=>{
  const editor=e.target.closest('#live-paid-key');
  if(!editor||!e.target.matches('[data-paid-key-all],[name="models"]'))return;
  if(e.target.matches('[data-paid-key-all]'))editor.querySelectorAll('[name="models"]').forEach(option=>{option.checked=e.target.checked;});
  updatePaidKeyPreview(editor);
 });
 document.addEventListener('input',e=>{
  if(e.target.matches('#live-paid-key [name="limit_yuan"]'))updatePaidKeyPreview(e.target.form);
 });
 let personalConnectIssued=null,personalConnectBusy=false,personalConnectStep='key';
 const personalConnectDrafts=new Map();
 let personalUnifiedConfigModel='';
 const personalUnifiedSelections=new Map();
 function prepareSelectedModelKey(){
  const chosen=new Set(personalChosenModels());
  const ids=(paidCredit?.enabled?paidCredit.models||[]:[]).filter(m=>chosen.has(m.id)).map(m=>m.id);
  if(!ids.length)return false;
  personalUnifiedSelections.set(personalConnectDraftKey('all'),ids);
  return true;
 }
 function personalUnifiedSelectedModels(){
  const key=personalConnectDraftKey('all');
  if(!personalUnifiedSelections.has(key))personalUnifiedSelections.set(key,(paidCredit?.models||[]).map(m=>m.id));
  const selected=new Set(personalUnifiedSelections.get(key));
  return (paidCredit?.models||[]).filter(m=>selected.has(m.id));
 }

 function personalConnectModelId(){return current.startsWith('personal/connect/')?current.slice('personal/connect/'.length):'';}
 function personalConnectDraftKey(id){return (me?.user?.id||'')+':'+id;}
 function savePersonalConnectDraft(){const form=host?.querySelector('#live-model-key');if(form)personalConnectDrafts.set(personalConnectDraftKey(personalConnectModelId()),{label:form.elements.label.value,limit:form.elements.limit_yuan.value});}
 function personalConnectConfig(model,options=[]){
  if(!model)return '<section class="mc-config"><h2>设置方法</h2><p class="mc-note">请先在模型清单中保留至少一个模型。</p></section>';
  const unified=personalConnectModelId()==='all';
  const tool=agentTool(),issued=personalConnectIssued?.owner===me?.user?.id&&personalConnectIssued?.modelId===personalConnectModelId()?personalConnectIssued:null;
  const base=issued?.base_url||personalModelAccess(model).base||'https://semifly.cn/v1',secret=issued?.secret||'YOUR_API_KEY';
  const config=tool.snippet?tool.snippet(base,secret,model.id):tool.id==='api'?curlExample(base,model.id,secret):`Base URL: ${base}\nAPI Key: ${secret}\nModel: ${model.id}`;
  const steps=tool.steps.map(step=>step.replaceAll('下面三项','地址、Key 和模型 ID').replaceAll('下面的模型名称','本页模型 ID').replaceAll('下面的配置','复制的配置').replace('在“curl / Python / Node”页复制示例。','点击“复制配置”获取 curl 示例。'));
  const field=(label,value)=>`<div class="mc-config-field"><span>${esc(label)}</span><code>${esc(value)}</code><button type="button" data-live="copy-text" data-text="${esc(value)}" aria-label="复制${esc(label)}">${ico('copy')}</button></div>`;
  return `<section class="mc-config" aria-labelledby="mc-config-title"><div class="mc-section-title"><h2 id="mc-config-title">设置方法</h2><a href="#docs">完整文档${ico('arrow-up-right')}</a></div><label class="mc-tool">使用工具${agentToolSelect()}</label>${tool.unsupported?`<p class="mc-message">${esc(tool.unsupported)}</p>`:`<div class="mc-config-fields">${field('API 地址',base)}${unified?`<div class="mc-config-field"><label for="mc-call-model">调用模型</label><select id="mc-call-model" data-unified-config-model aria-label="选择通用 Key 的调用模型">${options.map(m=>`<option value="${esc(m.id)}" ${m.id===model.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select><button type="button" data-live="copy-text" data-text="${esc(model.id)}" aria-label="复制模型 ID">${ico('copy')}</button></div>`:field('模型 ID',model.id)}</div><ol class="mc-steps">${steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol><button type="button" class="mc-copy-config" data-live="copy-text" data-text="${esc(config)}">${ico('copy')}复制${tool.id==='api'?'curl 示例':'配置'}</button><p class="mc-note">${issued?(unified?'切换模型只需更换模型 ID，地址和 Key 保持不变。':'配置中已包含刚生成的专属 Key。'):'生成 Key 后，再复制完整配置。'}</p>`}</section>`;
 }
 function personalConnectContent(){
  const id=personalConnectModelId(),unified=id==='all',p=paidCredit;
  const issued=personalConnectIssued?.owner===me?.user?.id&&personalConnectIssued?.modelId===id?personalConnectIssued:null;
  const allowed=unified?(issued?issued.key.model_ids.map(mid=>(p?.models||[]).find(m=>m.id===mid)||personalCatalog().find(m=>m.id===mid)||{id:mid,name:mid}):personalUnifiedSelectedModels()):[];
  const model=unified?(allowed.find(m=>m.id===personalUnifiedConfigModel)||allowed[0]):personalCatalog().find(m=>m.id===id);
  if(!unified&&!model)return '<section class="personal-api personal-connect"><a href="#personal/models">返回我的模型</a><h1>没有找到这个模型</h1></section>';
  const title=unified?'通用 Key':model.name+' 模型专属 Key';
  const access=unified?{action:p?.enabled&&p.models?.length?'paid-create':null,label:'暂未开放'}:personalModelAccess(model),paid=access.action==='paid-create',keys=(p?.keys||[]).filter(k=>!k.revoked_at),available=BigInt(p?.unallocated_fen||0),balance=wholeFen(p?.list_credit_fen||0);
  const draft=personalConnectDrafts.get(personalConnectDraftKey(id))||{label:unified?'通用 Key':model.name,limit:(Number(available>1000n?1000n:available)/100).toFixed(2)};
  const scope=unified?`<div class="mc-scope"><div class="mc-scope-heading"><span>${issued?'可调用模型':'包含模型'} · ${allowed.length}</span>${!issued&&allowed.length<(p?.models||[]).length?`<button type="button" data-live="connect-model-restore" ${personalConnectBusy?'disabled':''}>恢复全部</button>`:''}</div><ul class="mc-model-list">${allowed.map(m=>`<li><span>${esc(m.name)}</span>${issued?'':`<button type="button" data-live="connect-model-remove" data-id="${esc(m.id)}" aria-label="从通用 Key 移除 ${esc(m.name)}" title="移除此模型" ${personalConnectBusy?'disabled':''}>${ico('x')}</button>`}</li>`).join('')}</ul>${allowed.length?'':'<p class="mc-selection-empty">至少保留一个模型，请恢复全部后重新选择。</p>'}</div>`:'';
  let keyContent='';
  if(issued){keyContent=`<div class="mc-success">${ico('check')}Key 已生成</div><div class="mc-secret-label"><label for="mc-secret-value">API Key</label><div class="mc-secret"><input id="mc-secret-value" type="password" readonly value="${esc(issued.secret)}" aria-label="${esc(title)}" autocomplete="off" spellcheck="false"><button type="button" data-live="connect-secret-toggle" aria-controls="mc-secret-value" aria-label="显示密钥" title="显示密钥" aria-pressed="false">${ico('eye')}</button><button type="button" data-live="copy-text" data-text="${esc(issued.secret)}" aria-label="复制 Key">${ico('copy')}</button></div></div><dl class="mc-issued-meta">${unified?'':`<div><dt>允许模型</dt><dd>${esc(model.name)}</dd></div>`}<div><dt>${unified?'共用消费上限':'消费上限'}</dt><dd>¥${Number(issued.key.limit_yuan).toFixed(2)}</dd></div></dl><p class="mc-note">完整 Key 仅在本页显示，离开前请复制保存。</p><button type="button" class="pm-primary mc-mobile-next" data-live="connect-step" data-step="config">查看设置方法${ico('arrow-right')}</button>`;}
  else if(!paid){keyContent=`<p class="mc-message">${unified?'当前尚无已开放模型，开放后可创建通用 Key。':access.action==='pilot-create'?'此模型目前仅开放限量测试，可生成只调用此型号的测试 Key。':'此模型尚未开放调用，开放后可在这里生成专属 Key。'}</p>${access.action==='pilot-create'?'<button type="button" class="pm-primary" data-live="pilot-create">生成测试 Key</button>':'<a class="mc-text-link" href="#personal/models">返回我的模型</a>'}`;}
  else if(balance<=0n){keyContent='<p class="mc-message">先补充账户额度，再生成 Key。</p><a class="pm-primary" href="#billing/personal" data-live="connect-recharge">充值后继续</a>';}
  else if(keys.length>=5){keyContent='<p class="mc-message">已达 5 把有效 Key 上限。停用不再使用的 Key 后，可继续创建。</p><a class="pm-primary" href="#personal/keys">管理已有 Key</a>';}
  else if(available<=0n){keyContent='<p class="mc-message">当前额度已分配给其他 Key。调整已有 Key 的消费上限，或充值后继续。</p><a class="pm-primary" href="#personal/keys">调整已有 Key</a><a class="mc-text-link" href="#billing/personal" data-live="connect-recharge">充值</a>';}
  else{keyContent=`<form id="live-model-key" class="mc-form"><div class="mc-form-fields"><label>用途名称<input name="label" value="${esc(draft.label)}" required maxlength="50" autocomplete="off"></label><label>消费上限（元）<input name="limit_yuan" value="${esc(draft.limit)}" required inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" maxlength="9"></label></div><p class="mc-note">可分配 ${personalMoney(p.unallocated_fen)}。${unified?'所有模型共用此上限，按实际调用计费。':`此 Key 仅允许 ${esc(model.name)}。`}</p><div role="status" aria-live="polite"></div><button type="submit" class="pm-primary" ${personalConnectBusy||(unified&&!allowed.length)?'disabled':''}>${ico('key-round')}${personalConnectBusy?'正在生成…':unified?'一键生成通用 Key':'生成专属 Key'}</button>${unified?'<span class="mc-generate-note">可调用以上模型</span>':''}</form>`;}
  return `<section class="personal-api personal-connect ${unified?'mc-unified':''}" data-step="${personalConnectStep}" aria-labelledby="mc-title"><header class="mc-heading"><div><a class="mc-back" href="${unified?'#personal/keys':'#personal/models'}">${ico('arrow-left')}${unified?'API 密钥':'我的模型'}</a><h1 id="mc-title">${esc(title)}</h1><p>${unified?(issued?'一把 Key，调用以下模型。':(allowed.length<(p?.models||[]).length?'包含你选中的已开放模型，可继续移除或恢复全部。':'包含全部已开放模型，可移除不需要的型号。')):`只调用这个模型。<a class="mc-unified-link" href="#personal/connect/all" data-live="connect-unified">多模型共用？创建通用 Key ${ico('arrow-right')}</a>`}</p></div><a class="mc-manage" href="#personal/keys">管理 Key${ico('arrow-up-right')}</a></header><nav class="mc-tabs" aria-label="接入步骤"><button type="button" data-live="connect-step" data-step="key" aria-pressed="${personalConnectStep==='key'}">${unified?'通用 Key':'专属 Key'}</button><button type="button" data-live="connect-step" data-step="config" aria-pressed="${personalConnectStep==='config'}">设置方法</button></nav><div class="mc-layout"><section class="mc-key" aria-labelledby="mc-key-title"><div class="mc-section-title"><h2 id="mc-key-title">密钥与额度</h2><span>${paid?'可用额度 '+personalMoney(p.list_credit_fen):access.label}</span></div>${scope}${keyContent}</section>${personalConnectConfig(model,allowed)}</div></section>`;
 }
 async function createPersonalModelKey(id,label,limit,selectedModels){
  if(id!=='all'&&!personalCatalog().some(m=>m.id===id))throw Error('请选择有效模型。');
  const models=id==='all'?(Array.isArray(selectedModels)?[...new Set(selectedModels)]:[]):[id];
  if(!models.length)throw Error('请至少保留一个模型。');
  const credit=await api('/api/customer-credit/status');
  if(models.some(mid=>!credit.models?.some(m=>m.id===mid)))throw Error('所选模型的开放状态已变化，请刷新后重新选择。');
  if(!credit.enabled||!credit.models?.length||(id!=='all'&&!credit.models.some(m=>m.id===id)))throw Error('此模型当前未开放调用。');
  if(wholeFen(credit.list_credit_fen||0)<=0n)throw Error('请先充值账户额度。');
  if((credit.keys||[]).filter(k=>!k.revoked_at).length>=5)throw Error('已达 5 把有效 Key 上限，请先管理已有 Key。');
  const match=String(limit).match(/^(\d{1,6})(?:\.(\d{1,2}))?$/),fen=match?BigInt(match[1])*100n+BigInt((match[2]||'').padEnd(2,'0')):0n;
  if(fen<=0n||fen>BigInt(credit.unallocated_fen||0))throw Error('消费上限须大于零，且不超过当前可分配额度。');
  return api('/api/customer-credit/keys',{label,models,limit_yuan:String(limit)});
 }
 function personalRechargeNext(data){
  const intent=readModelIntent(),model=intent?.scope==='personal'?(intent.id==='all'?{id:'all',name:'通用 Key'}:(window.SemiflyModels||[]).find(m=>m.id===intent.id)):null,ready=BigInt(data.list_credit_fen??data.cash_balance_fen??0)>0n;
  return `<aside class="api-next"><div><strong>${ready?'额度已可用，继续接入':'充值后，继续配置 API Key'}</strong><p>${model?`已记住 ${esc(model.name)}。`:''}充值进入个人账户，可用于账户已开放的模型。</p></div><a href="${model?'#personal/connect/'+esc(model.id):'#personal/keys'}">${ready?'继续配置 API Key':'返回 API 配置'}${ico('arrow-right')}</a></aside>`;
 }
 function personalApiConnection(model){
  const p=paidCredit,copy=(label,value)=>`<div class="pm-config-row"><span>${label}</span><code>${esc(value)}</code><button type="button" data-live="copy-text" data-text="${esc(value)}" aria-label="复制${label}">${ico('copy')}</button></div>`;
  const tool=agentTool(),steps=(tool.steps||[]).map(step=>step.replaceAll('下面三项','API 地址、模型 ID 和密钥').replaceAll('下面的模型名称','此模型的 ID').replace('在“curl / Python / Node”页','在接入文档中'));
  const snippet=tool.snippet?tool.snippet(p.base_url,'你的 API Key',model.id):'';
  return `<section class="api-connection" id="api-connection"><div class="api-section-head"><h2>接入配置</h2><a href="#docs">完整文档${ico('arrow-up-right')}</a></div><label class="api-model-picker">调用模型<select data-api-model aria-label="选择调用模型">${p.models.map(m=>`<option value="${esc(m.id)}" ${m.id===model.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><div class="pm-config">${copy('API 地址',p.base_url)}${copy('模型 ID',model.id)}</div><p class="api-caption">使用允许此模型的 Key。完整密钥仅在创建时显示，请填入你保存的密钥。</p><details class="pm-guide" ${personalModelGuideOpen?'open':''}><summary>在 Agent 工具中配置</summary><label>选择工具${agentToolSelect()}</label>${tool.unsupported?`<p class="pm-note">${esc(tool.unsupported)}</p>`:`<ol>${steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol>${snippet?`<pre><code>${esc(snippet)}</code></pre><button type="button" class="pm-expand" data-live="copy-text" data-text="${esc(snippet)}">复制配置</button>`:''}`}</details></section>`;
 }
 function personalApiContent(){
  const p=paidCredit,keys=(p.keys||[]).filter(k=>!k.revoked_at),models=p.models||[];
  const usageMeter=k=>{
   const used=Math.max(0,Number(k.used_yuan)||0),limit=Math.max(0,Number(k.limit_yuan)||0),pct=limit>0?Math.min(100,used/limit*100):0,full=limit>0&&used>=limit;
   const text=`已用 ¥${used.toFixed(2)} / 上限 ¥${limit.toFixed(2)}`;
   return `<div class="ak-usage ${full?'is-full':pct>=80?'is-near':''}"><div class="ak-usage-label"><span>已用 <b>¥${used.toFixed(2)}</b> / 上限 ¥${limit.toFixed(2)}</span>${full?'<small>已达上限</small>':''}</div><div class="ak-usage-track" role="progressbar" aria-label="${esc(k.label)}额度使用" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(2)}" aria-valuetext="${text}"><span style="width:${pct}%"></span></div></div>`;
  };
  const rows=keys.map(k=>`<tr><td><strong>${esc(k.label)}</strong>${(k.model_ids||[]).length>1?'<span class="ak-kind">多模型</span>':''}<small>•••• ${esc(k.key_hint)}</small></td><td class="ak-model" data-label="对应模型">${(k.model_ids||[]).map(id=>`<span>${esc(models.find(m=>m.id===id)?.name||id)}</span>`).join('')}</td><td class="ak-budget" data-label="额度使用">${usageMeter(k)}</td><td><div class="api-row-actions"><button type="button" data-live="paid-limit" data-id="${esc(k.id)}" data-label="${esc(k.label)}" data-limit="${esc(k.limit_yuan)}">调整上限</button><button type="button" data-live="paid-revoke" data-id="${esc(k.id)}">停用</button></div></td></tr>`).join('');
  return `<section class="personal-api api-key-manager" aria-labelledby="api-title"><div class="api-page-head"><div><h1 id="api-title">API 密钥</h1><p>通用 Key 调用多个模型，专属 Key 只调用一个模型。</p></div><nav class="api-create-actions" aria-label="创建密钥"><a href="#personal/models">模型专属 Key</a><a class="pm-primary" href="#personal/connect/all" data-live="connect-unified">${ico('key-round')}创建通用 Key</a></nav></div><div class="api-balance-line"><span>账户额度 <b>${personalMoney(p.list_credit_fen)}</b></span><span>可分配额度 <b>${personalMoney(p.unallocated_fen)}</b></span><a href="#billing/personal">充值</a></div>${keys.length?`<div class="api-table-wrap"><table data-nosort><thead><tr><th>密钥</th><th>对应模型</th><th>额度使用</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="api-empty"><h2>还没有 API Key</h2><p>创建通用 Key 调用全部已开放模型，或从「我的模型」创建专属 Key。</p></div>'}<p class="api-caption">${keys.length} / 5 把有效 Key。充值后如需提高 Key 的消费上限，请在这里调整。</p></section>`;
 }
 function paidKeyPanel(){
  const p=paidCredit;
  const bill=panelOrg?'#billing/organization/'+esc(panelOrg.organization.id):'#billing/personal';
  const s=personalBilling?.credit_split;
  // 余额构成红绿条：与概览一致（虚线框=历史累计，左绿右红，已用实付透明露出）。
  const creditBar=s&&BigInt(s.max_face_fen||s.face_fen||0)?(f=>{const max=BigInt(f.max_face_fen||f.face_fen),green=BigInt(f.green_fen||0),red=BigInt(f.red_fen||0),spent=BigInt(f.spent_red_fen||0),pct=v=>Number(max)>0?Math.max(0,Math.min(100,Number(v)/Number(max)*100)):0,gw=pct(green),rw=pct(red),sw=pct(spent);return `<div class="credit-bar-block"><div class="credit-bar-head"><span>官价额度构成</span><b>可用 ${personalMoney(f.remaining_fen)} / 历史累计 ${personalMoney(f.max_face_fen||f.face_fen)}</b></div><div class="credit-bar-outline"><div class="credit-bar" role="img" aria-label="赠送 ${personalMoney(String(green))}，实付剩余 ${personalMoney(String(red))}，已用实付 ${personalMoney(String(spent))}"><i class="seg-green" style="width:${gw}%">${gw>=18?personalMoney(String(green)):''}</i><i class="seg-red" style="width:${rw}%">${rw>=18?personalMoney(String(red)):''}</i><i class="seg-spent-red" style="width:${sw}%"></i></div></div><div class="credit-bar-legend"><span><i class="dot-green"></i>赠送 ${personalMoney(String(green))}</span><span><i class="dot-red"></i>实付剩余 ${personalMoney(String(red))}</span><span><i class="dot-spent"></i>已用实付 ${personalMoney(String(spent))}</span></div></div>`;})(s):'';
  const keyRows=p.keys.map(k=>{const used=Number(k.used_yuan||0),limit=Number(k.limit_yuan||0),pct=limit>0?Math.min(100,used/limit*100):0;return `<div class="paid-key-row"><div class="paid-key-main"><b>${esc(k.label)}</b><small>尾号 ${esc(k.key_hint)} · ${(k.model_ids||[]).map(esc).join(' / ')} · ${new Date(k.created_at).toLocaleDateString('zh-CN')}${k.revoked_at?' · 已停用':''}</small></div><div class="paid-key-meter"><div class="paid-key-meter-bar"><i style="width:${pct}%"></i></div><small>已用 ¥${used.toFixed(2)} / 上限 ¥${limit.toFixed(2)} · ${k.calls||0} 次调用</small></div><div class="paid-key-actions">${k.revoked_at?'<span class="live-pill muted">已停用</span>':`<button type="button" data-live="paid-limit" data-id="${esc(k.id)}" data-label="${esc(k.label)}" data-limit="${limit}">调额度</button><button type="button" data-live="paid-revoke" data-id="${esc(k.id)}">停用</button>`}</div></div>`;}).join('');
  return `${purchaseEntry('keys')}<section class="personal-state-panel paid-keys-panel"><div class="paid-keys-head"><div><h2>我的付费 API Key</h2><p>调用按官网价扣官价额度；每把 Key 单独选模型、设消费上限，用到上限即停止。</p></div>${p.enabled?`<button class="live-button primary" data-live="paid-create">${ico('command')} 生成 Key</button>`:''}</div>${creditBar}<div class="paid-key-list">${keyRows||'<p class="personal-model-empty">还没有 Key。生成第一把 Key 后，这里会显示它的模型、消费上限和已用额度。</p>'}</div>${p.enabled?`<p class="live-small">最多保留 5 把有效 Key；Key 只在创建时显示一次。已停用的 Key 仍保留用量记录。</p>`:'<p class="live-small">付费调用尚未开放，生成 Key 的入口会在验收后开启。</p>'}<div class="paid-keys-foot"><a href="${bill}">${ico('receipt-text')} 购买额度 / 账单与退款</a><a href="#realtesting">${ico('arrow-left-right')} API 对比（我们与官方 API 逐项实测）</a></div></section>`; }
 let personalUsagePeriod='month',personalUsageView='models',personalUsagePage=0,personalUsageRequest=0,personalUsageState=null;
 for(const query of ['(max-width:700px)','(max-height:679px)'])window.matchMedia(query).addEventListener('change',()=>{if(personalTab==='usage'&&!panelOrg){personalUsagePage=0;if(personalUsageView==='calls')loadPersonalCalls();else updatePersonalDashboard();}});
 async function loadPersonalUsage(redraw=true){
  if(personalUsageView==='calls')loadPersonalCalls();
  const owner=me?.user?.id,period=personalUsagePeriod,request=++personalUsageRequest;
  personalUsageState={owner,period,loading:true};
  if(redraw)updatePersonalDashboard();
  try{
   const data=await api('/api/customer-credit/usage?period='+period);
   if(request===personalUsageRequest&&owner===me?.user?.id)personalUsageState={owner,period,data};
  }catch(error){if(request===personalUsageRequest&&owner===me?.user?.id)personalUsageState={owner,period,error:'用量暂时无法加载，请重试。'};}
  if(redraw&&request===personalUsageRequest&&personalTab==='usage'&&!panelOrg)updatePersonalDashboard();
 }
 let personalCallsState=null,personalCallsRequest=0;
 const personalCallsSize=()=>window.innerWidth<=700||window.innerHeight<680?2:3;
 async function loadPersonalCalls(){
  const owner=me?.user?.id,period=personalUsagePeriod,page=personalUsagePage,size=personalCallsSize(),request=++personalCallsRequest;
  personalCallsState={owner,period,page,size,loading:true};updatePersonalDashboard();
  try{const data=await api(`/api/customer-credit/usage/calls?period=${period}&page=${page}&size=${size}`);if(request===personalCallsRequest&&owner===me?.user?.id)personalCallsState={owner,period,page,size,data};}
  catch(error){if(request===personalCallsRequest)personalCallsState={owner,period,page,size,error:true};}
  if(request===personalCallsRequest&&personalTab==='usage'&&!panelOrg)updatePersonalDashboard();
 }
 function personalCallContent(){
  const state=personalCallsState?.owner===me?.user?.id&&personalCallsState.period===personalUsagePeriod&&personalCallsState.page===personalUsagePage?personalCallsState:null,data=state?.data;
  if(state?.error)return '<div class="pu-empty" role="alert"><p>调用明细暂时无法加载。</p><button type="button" data-live="usage-calls-retry">重新加载</button></div>';
  if(!data)return '<div class="pu-empty" role="status">正在加载调用明细…</div>';
  const labels={pending:'调用中',awaiting_bill:'待结算',settled:'已结算',failed:'失败 · 未扣费'},count=n=>n===null?'—':BigInt(n||0).toLocaleString('zh-CN');
  const rows=data.items.map(row=>`<tr><td><time datetime="${esc(row.created_at)}">${new Date(row.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</time><small>${esc(labels[row.status]||row.status)}</small></td><td><strong>${esc(row.model_name)}</strong><small>${esc(row.key_label)} · ${esc(row.key_hint)}</small></td><td><span>${count(row.input_tokens)} / ${count(row.output_tokens)}</span><small>缓存 ${count(row.cached_input_tokens)}</small></td><td><strong>${row.status==='settled'?personalMoney(row.cash_fen):row.status==='failed'?'¥0.00':'待结算'}</strong><small>${row.status==='settled'?'额度 '+employeeYuan(row.charged_yuan||0):''}</small></td></tr>`).join('');
  return `${rows?`<table class="pu-table pu-call-table" data-nosort><thead><tr><th>时间 / 状态</th><th>模型 / Key</th><th>输入 / 输出 Token</th><th>费用</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="pu-empty"><h2>这个时段还没有调用记录</h2></div>'}${personalUsagePage||data.has_more?`<nav class="pu-pages" aria-label="调用明细分页"><button type="button" data-live="usage-page" data-page="${personalUsagePage-1}" aria-label="上一页" ${personalUsagePage===0?'disabled':''}>${ico('chevron-left')}</button><span>第 ${personalUsagePage+1} 页</span><button type="button" data-live="usage-page" data-page="${personalUsagePage+1}" aria-label="下一页" ${data.has_more?'':'disabled'}>${ico('chevron-right')}</button></nav>`:''}`;
 }
 function personalUsageContent(){
  const state=personalUsageState?.owner===me?.user?.id&&personalUsageState.period===personalUsagePeriod?personalUsageState:null;
  const data=state?.data,rows=data?.[personalUsageView]||[],pageSize=window.innerWidth<=700||window.innerHeight<680?3:5,pages=Math.max(1,Math.ceil(rows.length/pageSize)),page=Math.min(personalUsagePage,pages-1);
  const count=n=>BigInt(n||0).toLocaleString('zh-CN'),money=n=>{const v=BigInt(n||0);return '¥'+(v/100n).toLocaleString('zh-CN')+'.'+String(v%100n).padStart(2,'0');};
  const totals=data?.totals;
  const content=personalUsageView==='calls'?personalCallContent():state?.error?`<div class="pu-empty" role="alert"><p>${state.error}</p><button type="button" data-live="usage-refresh">重新加载</button></div>`:!data?'<div class="pu-empty" role="status">正在加载用量…</div>':!rows.length?'<div class="pu-empty"><h2>这个时段还没有调用记录</h2><p>发起调用后，这里会显示模型和 Key 的用量。</p><a href="#personal/models">我的模型 '+ico('arrow-right')+'</a></div>':`<table class="pu-table" data-nosort><thead><tr><th>${personalUsageView==='models'?'模型':'API Key'}</th><th>输入 Token</th><th>输出 Token</th><th>费用</th></tr></thead><tbody>${rows.slice(page*pageSize,(page+1)*pageSize).map(row=>`<tr><td><strong>${esc(row.name)}</strong>${personalUsageView==='keys'?`<small>•••• ${esc(row.key_hint)}${row.revoked_at?' · 已停用':''}</small>`:''}</td><td>${count(row.input_tokens)}</td><td>${count(row.output_tokens)}</td><td>${money(row.cash_fen)}</td></tr>`).join('')}</tbody></table>`;
  return `<section class="personal-api personal-usage" aria-labelledby="pu-title"><header class="pu-heading"><h1 id="pu-title">用量</h1><select data-usage-period aria-label="用量时间范围">${[['month','本月'],['week','最近 7 天'],['all','累计']].map(([value,label])=>`<option value="${value}" ${value===personalUsagePeriod?'selected':''}>${label}</option>`).join('')}</select></header><div class="pu-summary">${totals?`<span>总用量 <b>${count(BigInt(totals.input_tokens||0)+BigInt(totals.output_tokens||0))}</b> Token</span><span>费用 <b>${money(totals.cash_fen)}</b></span>`:'<span>API 调用用量</span>'}</div><nav class="pu-tabs" aria-label="用量分组"><button type="button" data-live="usage-view" data-usage-view="models" aria-pressed="${personalUsageView==='models'}">按模型</button><button type="button" data-live="usage-view" data-usage-view="keys" aria-pressed="${personalUsageView==='keys'}">按 Key</button><button type="button" data-live="usage-view" data-usage-view="calls" aria-pressed="${personalUsageView==='calls'}">调用明细</button></nav><div class="pu-results" aria-live="polite">${content}</div><footer class="pu-foot"><p>费用为已结算实付消耗，赠送额度不计入。${Number(totals?.unsettled_calls||0)>0?` ${count(totals.unsettled_calls)} 次调用待结算。`:''}</p>${personalUsageView!=='calls'&&pages>1?`<nav class="pu-pages" aria-label="用量分页"><button type="button" data-live="usage-page" data-page="${page-1}" aria-label="上一页" ${page===0?'disabled':''}>${ico('chevron-left')}</button><span>${page+1} / ${pages}</span><button type="button" data-live="usage-page" data-page="${page+1}" aria-label="下一页" ${page===pages-1?'disabled':''}>${ico('chevron-right')}</button></nav>`:''}</footer></section>`;
 }
 function paidUsagePanel(){return `${purchaseEntry('usage')}<section class="personal-ledger"><h2>付费调用用量</h2><p>按调用时官网价格计量；实付款消耗按购买批次折算。没有可靠用量的请求暂时预留，不按估算强制扣费。</p><div class="personal-table-wrap"><table><thead><tr><th>时间</th><th>模型</th><th>输入 / 输出 Token</th><th>官价额度（元）</th><th>状态</th></tr></thead><tbody>${paidCredit.calls.map(c=>`<tr><td>${new Date(c.created_at).toLocaleString('zh-CN')}</td><td>${esc(c.model_id)}</td><td>${c.input_tokens??'—'} / ${c.output_tokens??'—'}</td><td>${c.charged_yuan==null?'待结算':Number(c.charged_yuan).toFixed(6)}</td><td>${esc({settled:'已结算',pending:'调用中',awaiting_bill:'等待用量',failed:'未扣费'}[c.status])}</td></tr>`).join('')}</tbody></table></div></section>`;}
 let panelData={tickets:null,sessions:null},panelRedraw=null;
 function loadPanelData(kind,path,redraw){const box=panelData;if(box[kind]||box['loading:'+kind])return;box['loading:'+kind]=true;api(path).catch(error=>{if(['sessions','smsBinding','tickets','answers'].includes(kind)){box['error:'+kind]=error.message;return null;}return [];}).then(value=>{box[kind]=value;if(box===panelData)redraw();});}
 function panelNav(org,active){
  const manager=Boolean(org&&lastOrg?.permissions?.manager),id=org?esc(org.id):'';
  const state=key=>`class="${(active===key||(active==='connect'&&key===(current==='personal/connect/all'?'keys':'models')))?'active':''}" aria-current="${(active===key||(active==='connect'&&key===(current==='personal/connect/all'?'keys':'models')))?'page':'false'}"`,inner=(icon,label)=>`${ico(icon)}<span>${label}</span>`;
  const tab=(key,icon,label)=>org?`<button type="button" data-live="org-tab" data-tab="${key}" data-nav="${key}" ${state(key)}>${inner(icon,label)}</button>`:`<button type="button" data-personal-tab data-live="personal-tab" data-tab="${key}" data-nav="${key}" ${state(key)}>${inner(icon,label)}</button>`;
  const link=(key,href,icon,label)=>`<a href="${href}" data-nav="${key}" ${state(key)}>${inner(icon,label)}</a>`;
  return tab('overview','layout-dashboard','概览')+tab('models','layers',org?'模型':'我的模型')+tab('keys','command',org?'密钥':'API 密钥')+tab('usage','chart-no-axes-combined','用量')+
   (org?tab('settings','settings','设置'):'')+
   (manager?tab('people','users-round','员工'):'')+
   (!org?link('billing','#billing/personal','receipt-text','充值与账单'):manager?link('billing','#billing/organization/'+id,'receipt-text','账单'):'')+
   (org?tab('support','circle-alert','支持'):link('support','#support','circle-alert','支持'))+
   tab('compare','layers','API 对比');
 }
 let personalVipState=null;
 function personalVipLabel(){
  const status=personalVipState&&personalVipState.userId===me?.user?.id?personalVipState.status:null;
  return status==='active'||(!status&&me?.user?.vip)?'VIP 工作台':status&&status!=='none'?'VIP 申请进度':'去申请 VIP';
 }
 window.addEventListener('message',event=>{
  const frame=host?.querySelector('iframe[title="VIP 合作计划"]');
  if(event.origin!==location.origin||!frame||event.source!==frame.contentWindow||event.data?.type!=='personal-vip-status')return;
  if(!['none','pending','confirmed','active','suspended','rejected'].includes(event.data.status))return;
  personalVipState={userId:me?.user?.id,status:event.data.status};
  const label=host.querySelector('[data-vip-label]');if(label)label.textContent=personalVipLabel();
 });
 const panelPage=(org,active,stage)=>`<div class="personal-console" data-workspace-scope="${org?esc(org.id):'personal'}">${customerHeader(org)}<aside class="pc-sidebar"><nav aria-label="工作台导航">${panelNav(org,active)}${me?.backoffice?.business?`<a href="#console/business/acquisition">${ico('briefcase-business')} 商务管理</a>`:''}${!org?`<a href="#security" data-nav="settings" class="pc-settings-link ${active==='settings'?'active':''}" aria-current="${active==='settings'?'page':'false'}">${ico('settings')}<span>个人设置</span></a><a href="#personal/vip" class="pc-vip-link ${active==='vip'?'active':''}" aria-current="${active==='vip'?'page':'false'}"><span class="pc-vip-label"><span data-vip-label>${personalVipLabel()}</span><svg class="pc-vip-circle" viewBox="0 0 150 48" fill="none" aria-hidden="true"><path d="M135 9C113 0 39 0 14 12C-7 24 6 43 62 44C112 48 150 34 145 20C142 10 127 7 114 6M19 8C-3 20 7 36 29 40"/></svg></span>${ico('arrow-up-right')}</a>`:''}</nav></aside><div class="pc-stage ${active==='billing'?'billing-stage':''}">${stage}</div>${window.SiteHeader.footer()}</div>`;
 const comparePanel=()=>`<iframe class="workspace-compare-frame${panelOrg?'':' personal-api'}" title="API 对比台" src="/compare.html?embedded=1${panelOrg?'':'&personal=1'}"></iframe>`;
 const panelBody=content=>`<div data-personal-content>${content}</div>`;
 const panelLoading='<p class="personal-model-empty">正在读取…</p>';
 const settingRow=(label,value)=>`<div class="org-setting-row"><span>${label}</span><b>${value}</b></div>`;
 let supportDraft={category:'question',subject:'',body:''},supportOwner=null,supportDetail=null,supportPageNumber=0,supportTextPage=0;
 // Bound both characters and line breaks, preserving all text across pages.
 function supportTextPages(value,width=30,rows=6){
  const pages=[];let page='',lines=0;
  for(const line of String(value||'').split(/(?<=\n)/u)){
   const chars=Array.from(line);for(let i=0;i<chars.length;i+=width){const part=chars.slice(i,i+width).join('');if(lines===rows){pages.push(page);page='';lines=0;}page+=part;lines++;}
  }
  if(page||!pages.length)pages.push(page);return pages;
 }
 function personalSupportContent(){
  if(supportOwner!==me.user.id){supportOwner=me.user.id;supportDraft={category:'question',subject:'',body:''};supportDetail=null;supportPageNumber=0;}
  const tickets=Array.isArray(panelData.tickets)?panelData.tickets:null,answers=Array.isArray(panelData.answers)?panelData.answers:null;
  const view=pageView('support',[['new'],['list'],['faq']]),labels={open:'待处理',in_progress:'处理中',closed:'已关闭'};
  const categories={question:'使用咨询',billing:'充值与扣费',invoice:'发票',bug:'故障',feedback:'意见反馈'};
  const tabs=[['new','提交问题'],['list','我的工单'],['faq','常见问题']];
  const pager=(page,pages,action)=>pages>1?`<nav class="pu-pages" aria-label="支持分页"><button type="button" data-live="${action}" data-page="${page-1}" aria-label="上一页" ${page===0?'disabled':''}>${ico('chevron-left')}</button><span>${page+1} / ${pages}</span><button type="button" data-live="${action}" data-page="${page+1}" aria-label="下一页" ${page===pages-1?'disabled':''}>${ico('chevron-right')}</button></nav>`:'';
  let content;
  const rows=view==='list'?tickets:answers,selected=supportDetail&&rows?.find(x=>String(x.id)===supportDetail);
  if(selected){
   const parts=view==='list'?[...(selected.staff_note?[{title:'客服回复',text:selected.staff_note}]:[]),{title:'问题描述',text:selected.body}]:[{title:'解答',text:selected.answer}];
   const pages=parts.flatMap(part=>supportTextPages(part.text,window.innerWidth<=700?22:60,window.innerHeight<700?4:6).map(text=>({title:part.title,text}))),page=Math.min(supportTextPage,pages.length-1);
   content=`<button class="ps-back" type="button" data-live="support-back">${ico('arrow-left')}返回${view==='list'?'我的工单':'常见问题'}</button><h2 class="support-subject">${esc(selected.subject||selected.question)}</h2>${view==='list'?`<p class="ps-muted">${esc(labels[selected.status]||selected.status)} · ${msTime(selected.created_at)}</p>`:''}<article class="support-answer"><h3>${pages[page].title}</h3><p>${esc(pages[page].text)}</p></article>${pager(page,pages.length,'support-text-page')}`;
  }else if(view==='new'){
   content=`<form id="live-ticket" class="live-form support-form"><div class="support-fields"><label>问题类型<select name="category">${Object.entries(categories).map(([key,label])=>`<option value="${key}" ${supportDraft.category===key?'selected':''}>${label}</option>`).join('')}</select></label><label>标题<input name="subject" required maxlength="120" value="${esc(supportDraft.subject)}" placeholder="简要说明遇到的问题"></label></div><label>问题描述<textarea name="body" required maxlength="4000" rows="4" placeholder="请说明现象、模型和发生时间。不要填写 API Key。">${esc(supportDraft.body)}</textarea></label><div id="live-form-message" role="status"></div><div class="support-submit"><button type="submit" class="live-button primary">提交问题</button><span>回复会显示在「我的工单」。</span></div></form>`;
  }else{
   const kind=view==='list'?'tickets':'answers',error=panelData['error:'+kind],pages=Math.max(1,Math.ceil((rows?.length||0)/3)),page=Math.min(supportPageNumber,pages-1);
   content=error?`<div class="pu-empty" role="alert"><p>暂时无法加载，请重试。</p><button type="button" data-live="support-retry" data-kind="${kind}">重新加载</button></div>`:!rows?panelLoading:!rows.length?`<div class="pu-empty"><h2>${view==='list'?'还没有工单':'暂无常见问题'}</h2><p>${view==='list'?'提交问题后，在这里查看回复。':'可查看使用文档，或直接提交问题。'}</p></div>`:`<div class="support-list">${rows.slice(page*3,page*3+3).map(row=>`<button type="button" data-live="support-detail" data-id="${esc(row.id)}"><span><strong>${esc(row.subject||row.question)}</strong><small>${view==='list'?msTime(row.created_at):esc(categories[row.category]||'使用帮助')}</small></span>${view==='list'?`<span class="support-status">${esc(labels[row.status]||row.status)}</span>`:''}${ico('chevron-right')}</button>`).join('')}</div>${pager(page,pages,'support-page')}${view==='list'&&rows.length>=50?'<p class="ps-muted">显示最近 50 条工单。</p>':''}`;
  }
  return `<section class="personal-api personal-settings personal-support"><header class="pu-heading"><h1>支持</h1><a href="#docs">使用文档 ${ico('arrow-up-right')}</a></header><nav class="pu-tabs" aria-label="支持栏目">${tabs.map(([key,label])=>`<button type="button" data-live="support-view" data-support-view="${key}" aria-pressed="${view===key}">${label}</button>`).join('')}</nav>${content}</section>`;
 }
 function supportContent(){
  if(!panelOrg)return personalSupportContent();
  const tickets=panelData.tickets,label={open:'待处理',in_progress:'处理中',closed:'已关闭'},answers=panelData.answers,categories={question:'使用咨询',billing:'充值与扣费',invoice:'发票',bug:'故障',feedback:'意见反馈'},views=[['new','提交工单'],['list',`我的工单${tickets?' · '+tickets.length:''}`],...(answers?.length?[['faq','常见问题']]:[])],view=pageView('support',views);
  const faq=answers?.length?`<div class="live-session-list">${answers.map(a=>`<article><b>${esc(a.question)}</b><small>${categories[a.category]||''}</small><p style="white-space:pre-wrap">${esc(a.answer)}</p></article>`).join('')}</div>`:'';
  const list=!tickets?panelLoading:tickets.length?`<div class="live-session-list">${tickets.map(t=>`<article><b>${esc(t.subject)} · ${label[t.status]||esc(t.status)}</b><small>${new Date(t.created_at).toLocaleString('zh-CN')}</small><p>${esc(t.body)}</p>${t.staff_note?`<p><b>回复：</b>${esc(t.staff_note)}</p>`:''}</article>`).join('')}</div>`:'<p class="personal-model-empty">还没有工单。</p>';
  const create=`<form id="live-ticket" class="live-form panel-form"><p class="live-small">描述现象、模型和时间，我们会在这里回复。请不要填写 API Key。</p><label>问题类型<select name="category">${Object.entries(categories).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label>标题<input name="subject" required maxlength="120"></label><label>问题描述<textarea name="body" required maxlength="4000" rows="5"></textarea></label><div id="live-form-message" role="status"></div><button class="live-button primary" type="submit">提交工单</button></form>`;
  return tabbedPage('support',views,view==='list'?list:view==='faq'?faq:create);
 }
 let phonePasswordReset=false;
 function passwordSettings(binding){
  const byPhone=me.user.phoneOnly;
  if(byPhone&&!phonePasswordAvailable)return '<p class="live-small">手机号密码暂时不可用。你可以继续使用短信验证码登录。</p>';
  if(byPhone&&typeof binding?.hasPassword!=='boolean'){
   const error=panelData['error:smsBinding'];
   return error?note(error,true):panelLoading;
  }
  const sms=byPhone&&(!binding.hasPassword||phonePasswordReset);
  const title=sms?(binding.hasPassword?'用短信重设密码':'设置密码'):'修改密码';
  return `<form id="live-${sms?'phone-password-settings':'password-form'}" class="live-form panel-form" ${sms?'data-sms-purpose="password"':''}>
   <h2 class="panel-title">${title}</h2>
   ${sms?`<p class="live-small">用绑定的手机号验证身份。保存后可用手机号和密码登录。</p>${smsFields()}`:passwordField('currentPassword','当前密码')}
   ${passwordField('newPassword','新密码',true)}
   <div id="live-form-message" role="status"></div>
   <button class="live-button primary" type="submit">保存并退出其他设备</button>
   ${byPhone&&binding.hasPassword?btn(sms?'用当前密码修改':'忘记密码？用短信重设','password-method','type="button"','quiet'):''}
  </form>`;
 }
 function redrawPasswordSettings(){
  if(panelOrg&&lastOrg)organizationV2(lastOrg);else securityPage();
 }
 let personalSettingsView='overview',personalSettingsPage=0;
 function personalDeviceName(agent=''){
  const browser=/Edg\//.test(agent)?'Edge':/Firefox\//.test(agent)?'Firefox':/Chrome\//.test(agent)?'Chrome':/Safari\//.test(agent)?'Safari':'浏览器';
  const system=/Android/.test(agent)?'Android':/iPhone|iPad/.test(agent)?'iOS':/Macintosh|Mac OS/.test(agent)?'macOS':/Windows/.test(agent)?'Windows':/Linux/.test(agent)?'Linux':'';
  return agent?browser+(system?' · '+system:''):'未知设备';
 }
 function personalSettingsContent(){
  const binding=panelData.smsBinding,sessions=Array.isArray(panelData.sessions)?panelData.sessions:null,byPhone=me.user.phoneOnly;
  const action=(label,view,disabled=false)=>`<button type="button" data-live="settings-view" data-settings-view="${view}" ${disabled?'disabled':''}>${label}</button>`;
  const row=(label,value,control='')=>`<div class="ps-row"><span>${label}</span><div class="ps-value">${value}</div>${control}</div>`;
  const back=`<button type="button" class="ps-back" data-live="settings-view" data-settings-view="overview">${ico('arrow-left')}个人设置</button>`;
  const errorRetry=kind=>`<button type="button" data-live="settings-retry" data-kind="${kind}">重新加载</button>`;
  if(personalSettingsView==='password')return `<section class="personal-api personal-settings ps-detail">${back}${passwordSettings(binding).replace(/<h2 class="panel-title">([^<]+)<\/h2>/,'<h1 class="panel-title">$1</h1>')}</section>`;
  if(personalSettingsView==='phone')return `<section class="personal-api personal-settings ps-detail">${back}<h1>${binding?.lastFour?'更换手机号':'绑定手机号'}</h1><form id="live-sms-bind" class="live-form panel-form">${smsFields(true)}<div id="live-form-message" role="status"></div><button class="live-button primary" type="submit">验证并绑定</button></form></section>`;
  if(personalSettingsView==='devices'){
   const pages=Math.max(1,Math.ceil((sessions?.length||0)/3)),page=Math.min(personalSettingsPage,pages-1);
   const list=panelData['error:sessions']?`<p role="status">${esc(panelData['error:sessions'])}</p>${/重新登录/.test(panelData['error:sessions'])?'':errorRetry('sessions')}`:!sessions?panelLoading:!sessions.length?'<p class="ps-muted">暂无登录记录。</p>':`<ul class="ps-devices">${sessions.slice(page*3,page*3+3).map(s=>`<li><strong>${esc(personalDeviceName(s.userAgent))}</strong><time>登录于 ${esc(new Date(s.createdAt).toLocaleString('zh-CN'))}</time></li>`).join('')}</ul>`;
   return `<section class="personal-api personal-settings ps-detail">${back}<div class="ps-device-head"><h1>登录设备</h1><button type="button" data-live="revoke-others" ${!sessions||sessions.length<2?'disabled':''}>退出其他设备</button></div><p class="ps-muted">${sessions?`${sessions.length} 个有效会话。`:''}退出其他设备不会影响当前登录。</p>${list}${pages>1?`<nav class="pu-pages" aria-label="设备分页"><button type="button" data-live="settings-page" data-page="${page-1}" aria-label="上一页" ${page===0?'disabled':''}>${ico('chevron-left')}</button><span>${page+1} / ${pages}</span><button type="button" data-live="settings-page" data-page="${page+1}" aria-label="下一页" ${page===pages-1?'disabled':''}>${ico('chevron-right')}</button></nav>`:''}</section>`;
  }
  const phone=phoneLoginAvailable||byPhone;
  const phoneValue=binding?.lastFour?'尾号 '+esc(binding.lastFour):panelData['error:smsBinding']?'暂时无法读取':binding?'未绑定':'正在读取…';
  const phoneAction=panelData['error:smsBinding']?errorRetry('smsBinding'):phoneLoginAvailable&&!byPhone?action(binding?.lastFour?'更换':'绑定','phone',!binding):'';
  const passwordLabel=byPhone&&binding?.hasPassword===false?'设置密码':'修改密码';
  const passwordAvailable=!byPhone||phonePasswordAvailable&&typeof binding?.hasPassword==='boolean';
  const needsFreshSession=/重新登录/.test(panelData['error:sessions']||'');
  const deviceValue=needsFreshSession?'需重新登录验证':panelData['error:sessions']?'暂时无法读取':sessions?`${sessions.length} 个有效会话`:'正在读取…';
  const upgrade=!(me.organizations||[]).length?`<a class="ps-upgrade" href="#upgrade">${me.upgrade?.status==='pending'?'企业升级审核中':'升级为企业账号'}${ico('arrow-up-right')}</a>`:'';
  return `<section class="personal-api personal-settings"><h1>个人设置</h1><div class="ps-columns"><section><h2>账户资料</h2>${row('姓名',esc(me.user.name||'—'))}${!byPhone&&me.user.email?row('登录邮箱',esc(me.user.email)):''}${phone?row('手机号',phoneValue,phoneAction):''}</section><section><h2>账户安全</h2>${row('登录密码',byPhone?(binding?.hasPassword?'已设置':'短信验证码登录'):'密码登录',passwordAvailable?action(passwordLabel,'password'):'')}${row('登录设备',deviceValue,needsFreshSession?action('查看说明','devices'):panelData['error:sessions']?errorRetry('sessions'):action('查看','devices',!sessions))}</section></div>${upgrade}</section>`;
 }
 function settingsContent(org=null){
  if(!org)return personalSettingsContent();
  const manager=Boolean(org&&lastOrg?.permissions?.manager),role=lastOrg?.membership?.role,list=panelData.sessions,u=me.upgrade;
  const depts=org?lastOrg?.departments||[]:[];
  const canUpgrade=!org&&!(me.organizations||[]).length;
  const smsBinding=panelData.smsBinding;
  const phone=phoneLoginAvailable&&!org;
  const passwordLabel=me.user.phoneOnly&&!smsBinding?.hasPassword?'设置密码':'修改密码';
  const name=me.user.name||'—',initial=(name||'?').trim().charAt(0).toUpperCase(),vip=!!me.user.vip;
  // 账户头部：头像 + 姓名 + 类型，右侧升级入口；正式 VIP 显示金色名与角标
  const nameBlock=vip?`<span class="account-name-vip"><b>${esc(name)}</b><i class="vip-badge" aria-hidden="true">VIP</i></span>`:`<b>${esc(name)}</b>`;
  const accountHead=`<div class="settings-profile${vip?' is-vip':''}"><div class="settings-avatar">${esc(initial)}</div><div class="settings-profile-id">${nameBlock}<small>${org?esc(org.name):(vip?'个人账号 · 正式 VIP':'个人账号')}</small></div>${canUpgrade?`<a class="live-button primary" href="#upgrade">${ico('building-2')} 升级为企业账号</a>`:''}</div>`;
  // 账户资料：分组信息卡片
  const infoGroup=(title,rows)=>`<div class="settings-info-group"><h3>${esc(title)}</h3>${rows.join('')}</div>`;
  const infoRow=(label,value,extra='')=>`<div class="settings-info-row"><span>${esc(label)}</span><div><b>${value}</b>${extra}</div></div>`;
  const phoneRow=phone?infoRow('短信登录',smsBinding?.lastFour?'手机号尾号 '+esc(smsBinding.lastFour):smsBinding?'未绑定手机号':panelData['error:smsBinding']?'暂时无法读取':'正在读取…',!me.user.phoneOnly?`<div class="settings-info-action">${btn(smsBinding?.lastFour?'更换手机号':'绑定手机号','sms-bind','','quiet')}</div>`:'')+'':infoRow('短信登录','未开放');
  const account=`<div class="panel-settings">${accountHead}${infoGroup('登录方式',[phoneRow])}${infoGroup('基本信息',org?[infoRow('企业',esc(org.name)),infoRow('我的身份',customerRoles[role]||'企业成员'),infoRow('权限范围',manager?'管理全公司的员工、额度和用量':'使用自己的额度和 Key'),infoRow('服务区域',org.region==='CN'?'中国区':esc(org.region||'中国区'))]:[infoRow('姓名',esc(name)),infoRow('登录邮箱',esc(me.user.email||'未绑定邮箱')),infoRow('账户类型','个人账号')])}${u?.status==='pending'?infoGroup('企业升级',[infoRow('状态','审核中')]):''}${manager&&teamUsage?infoGroup('企业设置',[infoRow('调用摘要记录',teamUsage.summaries_enabled?'已开启 · 保存最后一条提问的前 60 个字，30 天后删除':'未开启 · 只记录时间、模型、来源和费用',`<div class="settings-info-action">${btn(teamUsage.summaries_enabled?'关闭调用摘要':'开启调用摘要','toggle-summaries','','quiet')}${btn('查看操作记录','org-audit','','quiet')}</div>`)]):''}</div>`;
  const password=passwordSettings(smsBinding);
  const devices=panelData['error:sessions']?`<p class="live-small" role="status">${esc(panelData['error:sessions'])}</p>`:!list?panelLoading:`<p class="live-small">${list.length} 个有效会话。需要时可一次退出其他设备。</p>${btn('退出其他设备','revoke-others','','quiet')}<div class="live-session-list">${list.map(s=>`<article><b>${esc((s.userAgent||'未知设备').slice(0,100))}</b><small>创建于 ${new Date(s.createdAt).toLocaleString('zh-CN')}</small></article>`).join('')}</div>`;
  const departments=`<div class="dept-panel"><p class="live-small">员工申请加入、管理者编辑成员时，只能从这里选部门。改名会同步到所有成员；改成已有部门的名字会把两个部门合并；删除后，成员回到“未分组”。</p><form id="live-dept-create" class="dept-add"><input name="name" maxlength="40" required placeholder="新部门名称，例如：销售部" aria-label="新部门名称"><button class="live-button primary" type="submit">添加部门</button><div role="status"></div></form><div class="dept-list">${depts.map(d=>`<div class="dept-row"><span><b>${esc(d.name)}</b><small>${d.members} 位成员</small></span>${btn('改名','dept-rename',`data-id="${esc(d.id)}" data-name="${esc(d.name)}"`,'quiet')}${btn('删除','dept-delete',`data-id="${esc(d.id)}" data-name="${esc(d.name)}" data-members="${d.members}"`,'quiet')}</div>`).join('')||'<p class="personal-model-empty">还没有部门。添加后，员工和管理者就能从列表中选择。</p>'}</div></div>`;
  // 合并为单页：账户资料、修改密码、登录会话（企业再附部门），去掉多余 tab。
  return `<div class="settings-single"><section class="settings-block"><div class="settings-block-head">${ico('user-round')}<h2>${org?'企业与账户':'账户资料'}</h2></div>${account}</section><section class="settings-block"><div class="settings-block-head">${ico('shield-check')}<h2>${passwordLabel}</h2></div>${password}</section>${manager?`<section class="settings-block"><div class="settings-block-head">${ico('users-round')}<h2>部门管理</h2></div>${departments}</section>`:''}<section class="settings-block"><div class="settings-block-head">${ico('clock')}<h2>登录会话</h2></div>${devices}</section></div>`;
 }
 function upgradePage(){
  const u=me.upgrade,pending=u?.status==='pending',rejected=u?.status==='rejected';
  if(u?.status==='approved'){location.hash='organization/'+u.organization_id;return;}
  panelOrg=null;panelRedraw=null;mount(panelPage(null,'settings',panelBody(`<section class="pc-tab-page"><div class="pc-tab-body"><div class="panel-form"><h2 class="panel-title">升级为企业账号</h2><p class="live-small">企业账号在个人账号全部功能上，增加员工管理、全公司用量和额度分配。</p>${pending?`<h3>申请审核中</h3><p class="live-small">${esc(u.legal_name)} 的升级申请已提交，审核通过后个人工作区会转为企业空间。审核期间可以照常使用。</p>`:`${rejected?note('上次申请未通过：'+u.reject_reason,true):''}<form id="live-upgrade" class="live-form"><label>企业全称<input name="legal_name" required maxlength="160"></label><label>统一社会信用代码<input name="credit_code" required minlength="18" maxlength="18"></label><label>联系人<input name="contact_name" required maxlength="80"></label><label>联系电话<input name="contact_phone" required maxlength="40"></label><label class="demo-check"><input type="checkbox" name="confirm_irreversible" value="yes" required> 我确认升级后不能降级，现有余额和 Key 归入企业。</label><div id="live-form-message" role="status"></div><button class="live-button primary" type="submit">提交升级申请</button></form>`}</div></div></section>`)));
 }
 function supportPage(){if(supportOwner&&supportOwner!==me.user.id)panelData={tickets:null,sessions:null};panelOrg=null;panelRedraw=supportPage;const redraw=()=>{if(current==='support'&&pageViews.support&&pageViews.support!=='new')supportPage();};loadPanelData('tickets','/api/support/tickets',redraw);loadPanelData('answers','/api/support/answers',redraw);mount(panelPage(null,'support',panelBody(supportContent())));}
 function securityPage(){panelOrg=null;panelRedraw=securityPage;const redraw=()=>{if(current==='security'&&['overview','devices'].includes(personalSettingsView))securityPage();};loadPanelData('sessions','/api/auth/list-sessions',redraw);if(phoneLoginAvailable||me.user.phoneOnly)loadPanelData('smsBinding','/api/auth/sms/binding',redraw);mount(panelPage(null,'settings',panelBody(settingsContent())));}
 let orgTab='overview',orgShown=null;
 const organizationMoney=value=>{if(value===null||value===undefined)return '读取中';const cents=BigInt(value),absolute=cents<0n?-cents:cents;return `${cents<0n?'-':''}¥${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;};
 async function refreshOrganizationBilling(orgId,ticket){
  if(lastOrg?.organization?.id!==orgId)return;
  const {status,team}=await fetchOrgCredit(orgId,Boolean(lastOrg.permissions.manager));
  if(ticket!==generation||lastOrg?.organization?.id!==orgId||!current.startsWith('organization/'+orgId))return;
  employeeCredit=status;teamUsage=team;orgLoadedAt=Date.now();organizationV2(lastOrg);
 }
 const orgSections=['overview','budget','models','keys','compare','usage','people','support','settings'];
 const orgSection=section=>({budget:'usage'}[section]||(orgSections.includes(section)?section:'overview'));
 function surfaceSwitch(){
  const b=me?.backoffice;if(!b?.business&&!b?.technical)return '';
  return `<nav class="pc-surface" aria-label="切换面板"><a class="active" href="#workspace">${me?.organizations?.length?'企业管理工作台':'个人工作台'}</a>${b.business?'<a href="#console/business">商务后台</a>':''}${b.technical?'<a href="#console/technical">技术后台</a>':''}</nav>`;
 }
 const orgFreshMs=30000;
 async function fetchOrgCredit(orgId,manager){
  const [status,team]=await Promise.all([api('/api/employee-credit/status').catch(()=>({enabled:false})),manager?api('/api/employee-credit/team').catch(()=>null):null]);
  paidCredit=manager?await api('/api/customer-credit/status?org='+encodeURIComponent(orgId)).catch(()=>null):null;
  return {status,team:status.enabled&&status.organization_id===orgId?team:null};
 }
 function personalVisible(){const orgs=me.organizations||[];return !orgs.length||(me.upgrade?.status!=='approved'&&Boolean(me.personal_assets));}
 function customerHeader(org=null){
  const orgs=me.organizations||[],role=org?(customerRoles[lastOrg?.membership?.role]||'企业成员'):'个人账号',settings=org?`#organization/${esc(org.id)}/settings`:'#security';
  const spaces=[...(!org||personalVisible()?[{value:'personal',name:'个人工作区',current:!org}]:[]),...orgs.map(o=>({value:'organization/'+o.id,name:o.name,current:org?.id===o.id}))];
  const workspace=spaces.length>1?`<label class="pc-workspace">${ico('building-2')}<select data-workspace-select aria-label="当前工作空间">${spaces.map(s=>`<option value="${esc(s.value)}" ${s.current?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>`:org?`<span class="pc-workspace">${ico('building-2')}<span class="pc-workspace-name" title="${esc(org.name)}">${esc(org.name)}</span></span>`:'';
  return window.SiteHeader.render('workspace',{className:'pc-topbar',account:accountMenu(me.user,'customer',settings),tools:`${surfaceSwitch()||'<strong class="pc-product-title">工作台</strong>'}<div class="pc-topbar-actions"><span class="pc-identity">${role}</span>${workspace}${purchaseEntry('header',true)}<label class="pc-global-search">${ico('search')}<input data-personal-search aria-label="搜索模型" placeholder="搜索模型，回车查看" value="${esc(personalSearch)}"></label></div>`});
 }
 const analytics={range:'24h',data:null,at:0,loading:false,cost:'bar',calls:'trend'};
 function loadAnalytics(force=false){
  if(analytics.loading||(!force&&analytics.data?.range===analytics.range&&Date.now()-analytics.at<60000))return;
  analytics.loading=true;
  api('/api/employee-credit/team/analytics?range='+analytics.range).then(d=>{analytics.data=d;analytics.at=Date.now();}).catch(()=>{analytics.at=Date.now();}).finally(()=>{analytics.loading=false;if(panelOrg&&lastOrg&&orgTab==='usage')organizationV2(lastOrg);});
 }
 const niceMax=v=>{if(!(v>0))return 1;const p=10**Math.floor(Math.log10(v)),m=v/p;return (m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10)*p;};
 const axisLabel=v=>v===0?'0':v<0.01?v.toFixed(4):v<1?v.toFixed(2):v<1000?String(+v.toFixed(1)):v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':String(v);
 function svgChart({labels,series,mode,unit=''}){
  const W=640,H=230,pl=48,pr=10,pt=12,pb=30,iw=W-pl-pr,ih=H-pt-pb,n=labels.length;
  const totals=labels.map((_,i)=>series.reduce((s,x)=>s+x.values[i],0)),peak=mode==='line'?Math.max(0,...series.flatMap(s=>s.values)):Math.max(0,...totals),max=niceMax(peak);
  const x=i=>pl+(i+0.5)*iw/n,y=v=>pt+ih-v/max*ih,step=Math.max(1,Math.ceil(n/8));
  let g='';for(let k=0;k<=4;k++){const v=max*k/4,yy=y(v);g+=`<line x1="${pl}" x2="${W-pr}" y1="${yy}" y2="${yy}" class="an-grid"/><text x="${pl-6}" y="${yy+3}" class="an-axis" text-anchor="end">${axisLabel(v)}</text>`;}
  labels.forEach((l,i)=>{if(i%step===0||i===n-1)g+=`<text x="${x(i)}" y="${H-10}" class="an-axis" text-anchor="middle">${esc(l)}</text>`;});
  let body='';
  if(mode==='bar'){const bw=Math.max(3,Math.min(26,iw/n*0.62));labels.forEach((l,i)=>{let acc=0;series.forEach(s=>{const v=s.values[i];if(!v)return;const top=y(acc+v),h=y(acc)-top;acc+=v;body+=`<rect x="${x(i)-bw/2}" y="${top}" width="${bw}" height="${Math.max(h,1)}" fill="${s.color}" rx="2"><title>${esc(l)} · ${esc(s.name)} · ${unit}${axisLabel(v)}</title></rect>`;});});}
  else if(mode==='area'){const base=labels.map(()=>0);series.forEach(s=>{const lo=[...base];s.values.forEach((v,i)=>base[i]+=v);const up=base.map((v,i)=>`${x(i)},${y(v)}`),down=lo.map((v,i)=>`${x(i)},${y(v)}`).reverse();body+=`<polygon points="${[...up,...down].join(' ')}" fill="${s.color}" fill-opacity=".35" stroke="${s.color}" stroke-width="1.5"><title>${esc(s.name)}</title></polygon>`;});}
  else{series.forEach(s=>{body+=`<polyline points="${s.values.map((v,i)=>`${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`+s.values.map((v,i)=>v?`<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="${s.color}"><title>${esc(labels[i])} · ${esc(s.name)} · ${v} 次</title></circle>`:'').join('');});}
  return `<svg class="an-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="图表">${g}${body}</svg>`;
 }
 function analyticsPanel(){
  const d=analytics.data,palette=['#8e2deb','#17a673','#f58d09','#2f7de1','#e0457b','#5b6478','#0fb5ba','#c2410c'];
  const ranges=`<div class="an-ranges">${[['24h','24 小时'],['7d','7 天'],['30d','30 天']].map(([k,l])=>`<button type="button" data-live="analytics-range" data-range="${k}" class="${analytics.range===k?'active':''}">${l}</button>`).join('')}</div>`;
  if(!d||d.range!==analytics.range)return `<div class="an-head"><h3>调用统计</h3>${ranges}</div><p class="personal-model-empty">正在读取统计…</p>`;
  const hourly=d.unit==='hour',count=hourly?24:d.range==='7d'?7:30,now=new Date(Date.now()+8*3600000);
  const keys=Array.from({length:count},(_,i)=>{const t=new Date(now.getTime()-(count-1-i)*(hourly?3600000:86400000));const iso=t.toISOString();return hourly?`${iso.slice(0,10)} ${iso.slice(11,13)}:00`:`${iso.slice(0,10)} 00:00`;});
  const labels=keys.map(k=>hourly?k.slice(11,16):k.slice(5,10)),ids=d.models.map(m=>m.model_id),color=id=>palette[ids.indexOf(id)%palette.length];
  const series=field=>ids.map(id=>({name:id,color:color(id),values:keys.map(k=>Number(d.buckets.find(b=>b.bucket===k&&b.model_id===id)?.[field]||0))}));
  const calls=d.models.reduce((n,m)=>n+m.calls,0),tokens=d.models.reduce((n,m)=>n+Number(m.tokens),0),yuan=d.models.reduce((n,m)=>n+Number(m.yuan),0),failed=d.models.reduce((n,m)=>n+m.failed,0);
  const card=(label,value,note)=>`<div class="an-kpi"><span>${label}</span><b>${value}</b><small>${note}</small></div>`;
  const kpis=`<div class="an-kpis">${card('总调用',calls.toLocaleString('zh-CN'),failed?`失败 ${failed} 次`:'全部成功')}${card('总消费',yuan2(yuan),'按官网价扣除')}${card('Token 数',axisLabel(tokens),'输入 + 输出')}${card('平均 RPM',perMinute(calls,d.minutes),'每分钟请求数')}${card('平均 TPM',perMinute(tokens,d.minutes),'每分钟 Token 数')}${card('峰值 RPM',String(d.peak.peak_rpm),`峰值 TPM ${axisLabel(Number(d.peak.peak_tpm))}`)}</div>`;
  const legend=`<div class="trend-legend">${ids.map(id=>`<span><i class="team-dot" style="background:${color(id)}"></i>${esc(id)}</span>`).join('')}</div>`;
  const toggle=(group,items)=>`<div class="an-toggle">${items.map(([k,l])=>`<button type="button" data-live="analytics-view" data-an-group="${group}" data-an-view="${k}" class="${analytics[group]===k?'active':''}">${l}</button>`).join('')}</div>`;
  const empty='<p class="personal-model-empty">这个时间段没有调用。</p>';
  const cost=`<section class="an-card"><div class="an-card-head"><h3>消耗分布 <small>总计 ${yuan2(yuan)}</small></h3>${toggle('cost',[['bar','柱状图'],['area','面积图']])}</div>${calls?svgChart({labels,series:series('yuan'),mode:analytics.cost,unit:'¥'})+legend:empty}</section>`;
  const total=calls||1;let angle=0;const donut=`conic-gradient(${d.models.map(m=>{const from=angle;angle+=m.calls/total*360;return `${color(m.model_id)} ${from}deg ${angle}deg`;}).join(',')||'#eceff5 0deg 360deg'})`;
  const top=Math.max(1,...d.models.map(m=>m.calls));
  const callsBody=!calls?empty:analytics.calls==='share'?`<div class="an-donut-wrap"><div class="an-donut" style="background:${donut}"><span><b>${calls}</b><small>次调用</small></span></div><div class="an-donut-legend">${d.models.map(m=>`<div><i class="team-dot" style="background:${color(m.model_id)}"></i><span>${esc(m.model_id)}</span><b>${(m.calls/total*100).toFixed(1)}%</b><small>${m.calls} 次</small></div>`).join('')}</div></div>`:analytics.calls==='rank'?`<div class="an-rank">${d.models.map((m,i)=>`<div><span class="an-rank-no">${i+1}</span><span class="an-rank-name">${esc(m.model_id)}</span><span class="an-rank-bar"><i style="width:${(m.calls/top*100).toFixed(1)}%;background:${color(m.model_id)}"></i></span><b>${m.calls} 次</b><small>${perMinute(m.calls,d.minutes)} RPM</small></div>`).join('')}</div>`:svgChart({labels,series:series('calls'),mode:'line'})+legend;
  const callsCard=`<section class="an-card"><div class="an-card-head"><h3>模型调用分析 <small>总计 ${calls} 次</small></h3>${toggle('calls',[['trend','调用趋势'],['share','调用次数分布'],['rank','调用次数排行']])}</div>${callsBody}</section>`;
  return `<div class="an-head"><h3>调用统计 <small>${hourly?'按小时':'按天'} · RPM / TPM 为所选时段的平均值</small></h3>${ranges}</div>${kpis}<div class="an-grid">${cost}${callsCard}</div>`;
 }
 function teamUsageContent(team){
  const t=team.totals,palette=['#8e2deb','#17a673','#f58d09','#2f7de1','#e0457b','#5b6478'],modelIds=[...new Set(team.daily.map(d=>d.model_id))],color=id=>palette[modelIds.indexOf(id)%palette.length];
  const days=Array.from({length:14},(_,i)=>new Date(Date.now()+8*3600000-(13-i)*86400000).toISOString().slice(0,10));
  const dayRows=day=>team.daily.filter(d=>d.day===day),dayTotal=day=>dayRows(day).reduce((n,d)=>n+Number(d.yuan),0),max=Math.max(...days.map(dayTotal),0.000001);
  const bars=days.map(day=>`<div class="team-bar" title="${day} · ${employeeYuan(dayTotal(day))}">${dayRows(day).map(d=>`<i style="height:${Math.max(Number(d.yuan)/max*100,Number(d.yuan)>0?2:0)}%;background:${color(d.model_id)}" title="${esc(d.model_id)} · ${employeeYuan(d.yuan)} · ${d.calls} 次"></i>`).join('')}<small>${day.slice(5)}</small></div>`).join('');
  const hasCalls=t.calls_30d>0||team.recent_calls.length>0;
  const memberPage=pagedRows('team-members',team.members.filter(m=>m.status==='active')),recentPage=pagedRows('team-recent',team.recent_calls);
  const memberRows=memberPage.items.map(m=>{const left=Math.max(0,Number(m.granted_yuan)-Number(m.spent_yuan)-Number(m.held_yuan));return `<tr><td><span class="mgr-quota-title"><button type="button" class="member-link" data-live="member-detail" data-user="${esc(m.user_id)}">${esc(m.name)}</button>${rolePill(m.role)}</span><small>${esc(m.email)}</small></td><td class="usage-cell" data-sort="${usageShare(m.spent_yuan,m.granted_yuan).pct}"><span>${employeeYuan(m.spent_yuan)} / ${employeeYuan(m.granted_yuan)}</span>${usageBar(m.spent_yuan,m.granted_yuan)}</td><td>${employeeYuan(left)}</td><td>${m.calls_30d}</td><td>${Number(m.tokens_30d).toLocaleString('zh-CN')}</td><td>${m.last_call_at?new Date(m.last_call_at).toLocaleString('zh-CN'):'尚未使用'}</td><td>${m.active_keys}</td><td>${btn('调整额度','team-quota',`data-user="${esc(m.user_id)}" data-name="${esc(m.name)}"`,'quiet')}</td></tr>`;}).join('');
  const attention=team.members.filter(m=>m.status==='active'&&Number(m.granted_yuan)>0&&(Number(m.granted_yuan)-Number(m.spent_yuan)-Number(m.held_yuan))/Number(m.granted_yuan)<0.1).map(m=>`<li><b>${esc(m.name)}</b> 额度即将用完</li>`).join('');
  const models=team.models.map(m=>`<tr><td><i class="team-dot" style="background:${color(m.model_id)}"></i>${esc(m.model_id)}</td><td>${m.calls}${m.failed?` · 失败 ${m.failed}`:''}</td><td>${(Number(m.input_tokens)+Number(m.output_tokens)).toLocaleString('zh-CN')}</td><td>${employeeYuan(m.yuan)}</td>${loadCell(m)}</tr>`).join('');
  const state={pending:'进行中',awaiting_bill:'结算中',settled:'已结算',failed:'失败 · 未扣'};
  const recent=recentPage.items.map(c=>`<tr><td>${new Date(c.created_at).toLocaleString('zh-CN')}</td><td>${esc(c.name)}<small>${esc(c.key_label)}</small></td><td>${esc(c.client||'未记录')}</td><td>${esc(c.model_id)}</td><td>${c.input_tokens??'—'} / ${c.cached_input_tokens??'—'} / ${c.output_tokens??'—'}</td><td>${c.status==='settled'?employeeYuan(c.charged_yuan):c.status==='failed'?'¥0':'预留 '+employeeYuan(c.hold_yuan)}</td><td>${esc(state[c.status]||c.status)}</td></tr>`).join('');
  const keys=team.keys.length?keyTable(team.keys,{owner:true,action:'team-key-revoke'}):'';
  // 我的用量: the signed-in manager's own calls, tokens, keys and spending (their own company-credit account).
  const mine=employeeCredit?.enabled?employeeCredit:null;
  const views=[['trend','消费趋势'],['members','员工用量'],...(mine?[['mine','我的用量']]:[]),...(models?[['models','模型用量']]:[]),...(keys?[['keys','员工 Key']]:[]),...(recent?[['recent','调用历史']]:[])],view=pageView('team-usage',views);
  const mineView=mine?(()=>{const ks=mine.keys||[],live=ks.filter(k=>!k.revoked_at),tokens=ks.reduce((n,k)=>n+Number(k.tokens||0),0),granted=Number(mine.granted_yuan||0),spent=Number(mine.spent_yuan||0),pct=granted>0?Math.min(100,spent/granted*100):0;
   const byModel=Object.values((mine.daily||[]).reduce((m,d)=>{(m[d.model_id]||={model_id:d.model_id,calls:0,yuan:0});m[d.model_id].calls+=d.calls;m[d.model_id].yuan+=Number(d.yuan);return m;},{})).sort((a,b)=>b.yuan-a.yuan);
   const stat=(label,value,sub)=>`<div class="mine-stat"><small>${label}</small><b>${value}</b><span>${sub}</span></div>`;
   const stats=`<div class="mine-stats">${stat('我的额度已用',`${employeeYuan(spent)} / ${employeeYuan(granted)}`,`<span class="usage-meter low"><i style="width:${pct.toFixed(2)}%"></i></span> 剩余 ${employeeYuan(mine.available_yuan)}`)}${stat('本月消费',employeeYuan(mine.month_yuan),'按官方价结算')}${stat('近 30 天调用',`${Number(mine.calls_30d||0).toLocaleString('zh-CN')} 次`,mine.failed_30d?`失败 ${mine.failed_30d} 次（不扣费）`:'没有失败')}${stat('累计 Token',tokens.toLocaleString('zh-CN'),'所有 Key 的输入 + 输出')}${stat('有效 Key',`${live.length} 把`,`共 ${ks.length} 把，最多 ${mine.key_limit||5} 把`)}</div>`;
   const models=byModel.length?`<div class="personal-table-wrap"><table><thead><tr><th>模型</th><th>调用 <small>近 14 天</small></th><th>消费</th></tr></thead><tbody>${byModel.map(m=>`<tr><td><i class="team-dot" style="background:${color(m.model_id)}"></i>${esc(m.model_id)}</td><td>${m.calls} 次</td><td>${employeeYuan(m.yuan)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="personal-model-empty">近 14 天还没有调用。</p>';
   const calls=(mine.recent_calls||[]).map(c=>`<tr><td>${new Date(c.created_at).toLocaleString('zh-CN')}</td><td>${esc(c.key_label)}</td><td>${esc(c.client||'未记录')}</td><td>${esc(c.model_id)}</td><td>${c.input_tokens??'—'} / ${c.cached_input_tokens??'—'} / ${c.output_tokens??'—'}</td><td>${c.status==='settled'?employeeYuan(c.charged_yuan):c.status==='failed'?'¥0':'预留 '+employeeYuan(c.hold_yuan)}</td><td>${esc(state[c.status]||c.status)}</td></tr>`).join('');
   return `${stats}<h3 class="mine-h">按模型</h3>${models}<h3 class="mine-h">我的 Key</h3>${keyTable(ks,{action:'employee-revoke'})}<h3 class="mine-h">我最近的调用 <small>最近 30 次 · 只含你自己的 Key</small></h3>${calls?`<div class="personal-table-wrap"><table><thead><tr><th>时间</th><th>Key</th><th>来源</th><th>模型</th><th>输入 / 缓存 / 输出</th><th>金额</th><th>状态</th></tr></thead><tbody>${calls}</tbody></table></div>`:'<p class="personal-model-empty">还没有调用。</p>'}`;})():'';
  const modelYuan=team.models.reduce((n,m)=>n+Number(m.yuan),0),shareRow=(dot,label,yuan,total,extra)=>{const pct=total>0?Number(yuan)/total*100:0;return `<div class="trend-row"><span class="trend-name">${dot}${label}</span><span class="usage-meter low"><i style="width:${pct.toFixed(2)}%"></i></span><b>${pct.toFixed(pct<10?1:0)}%</b><span class="trend-amount">${yuan2(yuan)}</span><small>${extra}</small></div>`;};
  const spenders=team.members.filter(m=>m.status==='active'&&(Number(m.spent_yuan)>0||m.calls_30d>0)).sort((a,b)=>Number(b.spent_yuan)-Number(a.spent_yuan)).slice(0,6),spentTotal=spenders.reduce((n,m)=>n+Number(m.spent_yuan),0);
  const summaries=`<div class="trend-cards"><section class="trend-card"><h3>模型消费占比 <small>近 30 天</small></h3>${team.models.map(m=>shareRow(`<i class="team-dot" style="background:${color(m.model_id)}"></i>`,esc(m.model_id),m.yuan,modelYuan,`${m.calls} 次`)).join('')||'<p class="personal-model-empty">暂无数据。</p>'}</section><section class="trend-card"><h3>员工消费排行 <small>累计已用</small></h3>${spenders.map(m=>shareRow('',`<button type="button" class="member-link" data-live="member-detail" data-user="${esc(m.user_id)}">${esc(m.name)}</button>`,m.spent_yuan,spentTotal,`${m.calls_30d} 次`)).join('')||'<p class="personal-model-empty">暂无数据。</p>'}</section></div>`;
  if((pageViews['team-usage']||'trend')==='trend')loadAnalytics();
  const trend=`<div class="an-panel">${analyticsPanel()}</div>${hasCalls?summaries:'<p class="personal-model-empty">还没有员工调用。员工生成 Key 并开始调用后，这里会显示真实消费。</p>'}${attention?`<div class="team-attention"><b>需要关注</b><ul>${attention}</ul></div>`:''}`;
  const memberTable=`<div class="personal-table-wrap"><table><thead><tr><th>员工</th><th>已用 / 额度</th><th>剩余</th><th>调用</th><th>Token</th><th>最近使用</th><th>有效 Key</th><th>操作</th></tr></thead><tbody>${memberRows||'<tr><td colspan="8" class="personal-model-empty">暂无员工。</td></tr>'}</tbody></table></div>${memberPage.pager}`;
  const modelTable=`<div class="personal-table-wrap"><table><thead><tr><th>模型</th><th>调用 <small>30 天</small></th><th>Token</th><th>消费</th><th>RPM / TPM<br><small>24 小时平均</small></th></tr></thead><tbody>${models}</tbody></table></div>`;
  const recentTable=`<div class="personal-table-wrap"><table><thead><tr><th>时间</th><th>员工 / Key</th><th>来源</th><th>模型</th><th>输入 / 缓存 / 输出</th><th>金额</th><th>状态</th></tr></thead><tbody>${recent}</tbody></table></div>${recentPage.pager}`;
  return tabbedPage('team-usage',views,view==='mine'?mineView:view==='members'?memberTable:view==='models'?modelTable:view==='keys'?keys:view==='recent'?recentTable:trend);
 }
 function memberUsageContent(){
  const state={pending:'进行中',awaiting_bill:'结算中',settled:'已结算',failed:'失败 · 未扣'},rows=(employeeCredit.recent_calls||[]).map(x=>`<tr><td>${new Date(x.created_at).toLocaleString('zh-CN')}</td><td>${esc(x.model_id)}<small>${esc(x.key_label)}</small></td><td>${x.input_tokens??'—'} / ${x.cached_input_tokens??'—'} / ${x.output_tokens??'—'}</td><td>${x.status==='settled'?employeeYuan(x.charged_yuan):x.status==='failed'?'¥0':'预留 '+employeeYuan(x.hold_yuan)}</td><td>${esc(state[x.status]||x.status)}</td></tr>`).join('');
  return `<section class="personal-pilot-log"><div class="personal-section-title"><h2>我的调用</h2><span>最近 30 笔</span></div><div class="personal-table-wrap"><table><thead><tr><th>时间</th><th>模型 / Key</th><th>输入 / 缓存 / 输出</th><th>金额</th><th>状态</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="personal-model-empty">尚无调用记录。</td></tr>'}</tbody></table></div></section>`;
 }
 function organizationV2(data){
  const {organization:o,membership:m,members,permissions:p}=data;
  if(orgShown!==o.id)orgShown=o.id;
  lastOrg=data;panelOrg=data;
  if(['overview','models'].includes(orgTab))loadModelHealth(()=>{if(panelOrg&&lastOrg?.organization?.id===o.id&&['overview','models'].includes(orgTab))organizationV2(lastOrg);});
  const manager=Boolean(p.manager),credit=creditActive(),team=credit&&manager?teamUsage:null;
  const pending=data.joinRequests||[],joinLink=(data.joinLinks||[])[0],active=members.filter(person=>person.status==='active').length;
  panelRedraw=null;if(orgTab==='support'){loadPanelData('tickets','/api/support/tickets',()=>organizationV2(lastOrg));loadPanelData('answers','/api/support/answers',()=>organizationV2(lastOrg));}if(orgTab==='settings'){
   const redraw=()=>{if(orgTab==='settings'&&lastOrg?.organization.id===o.id)organizationV2(lastOrg);};
   loadPanelData('sessions','/api/auth/list-sessions',redraw);
   if(me.user.phoneOnly&&phonePasswordAvailable)loadPanelData('smsBinding','/api/auth/sms/binding',redraw);
  }
  if(![...'overview models keys compare usage support settings'.split(' '),...(manager?['people']:[])].includes(orgTab))orgTab='overview';
  const usageOf=person=>{const row=team?.members.find(x=>x.user_id===person.user_id);return row?`<span class="usage-cell"><span>${employeeYuan(row.spent_yuan)} / ${employeeYuan(row.granted_yuan)}</span>${usageBar(row.spent_yuan,row.granted_yuan)}</span>`:'—';};
  const memberRow=(person,index)=>{const self=person.user_id===me.user.id,on=person.status==='active';return `<tr><td><button type="button" class="member-link" data-live="member-detail" data-user="${esc(person.user_id)}">${esc(person.name)}</button>${self?' <span class="live-pill muted">当前账号</span>':''}<small>${esc(person.email)}</small></td><td>${customerRoles[person.role]||'企业成员'}</td><td>${esc(person.department)||'未分组'}</td><td><span class="live-pill ${on?'':'muted'}">${on?'已启用':'已停用'}</span></td><td class="org-usage-cell" data-sort="${(r=>r?usageShare(r.spent_yuan,r.granted_yuan).pct:'')(team?.members.find(x=>x.user_id===person.user_id))}">${usageOf(person)}</td><td class="org-actions">${credit&&on?btn('调整额度','team-quota',`data-user="${esc(person.user_id)}" data-name="${esc(person.name)}"`,'quiet'):''}${btn('管理','edit-member',`data-index="${index}"`,'quiet')}${self?'':btn(on?'停用':'启用','member-toggle',`data-index="${index}"`,'quiet')}</td></tr>`;};
  const pendingRow=i=>`<tr><td><b>${esc(i.display_name)}</b><small>${esc(i.email)}</small></td><td>申请加入</td><td>${esc(i.department)||'未分组'}</td><td><span class="live-pill muted">待审批</span></td><td class="org-usage-cell">—</td><td class="org-actions">${btn('批准','approve-request',`data-id="${i.id}"`,'primary')} ${btn('拒绝','reject-request',`data-id="${i.id}"`,'quiet')}</td></tr>`;
  const grantNote=credit?'批准后自动获得 ¥10 公司额度':'批准后加入企业空间';
  const people=`<section class="org-card org-people-card"><div class="org-card-head"><div><span class="org-kicker">TEAM</span><h3>员工</h3><p>把邀请链接发给同事；他们验证邮箱并提交申请后，由管理者批准。</p></div><div>${!joinLink?btn(ico('plus')+' 生成邀请链接','create-join-link','','primary'):''} ${btn('刷新申请','refresh-join-requests','','quiet')}</div></div>${joinLink?`<div class="org-join-link"><label>当前邀请链接 · ${new Date(joinLink.expires_at).toLocaleDateString('zh-CN')} 到期<input type="text" readonly value="${esc(joinLink.url)}" aria-label="企业邀请链接"></label>${btn('复制链接','copy-join-link',`data-url="${esc(joinLink.url)}"`,'quiet')}${btn('撤销链接','revoke-join-link',`data-id="${joinLink.id}"`,'quiet')}</div>`:`<p class="live-small">尚未生成邀请链接。${grantNote}。</p>`}<div class="live-table-wrap org-table-wrap"><table><thead><tr><th>姓名与邮箱</th><th>身份</th><th>部门</th><th>账户状态</th><th>已用 / 额度</th><th>操作</th></tr></thead><tbody>${members.map(memberRow).join('')+pending.map(pendingRow).join('')}</tbody></table></div><div class="org-table-foot"><span>已启用 ${active} · 待审批 ${pending.length}</span><span>${grantNote}</span></div></section>`;
  const stat=(cls,icon,label,value)=>`<div class="${cls}">${ico(icon)}<span>${label}</span><strong>${value}</strong></div>`;
  const stats=team?stat('pc-stat-balance','server','员工额度余额',employeeYuan(team.totals.available_yuan))+stat('pc-stat-spent','receipt-text','本月消费',employeeYuan(team.totals.month_yuan))+stat('pc-stat-calls','chart-no-axes-combined','30 天调用',team.totals.calls_30d.toLocaleString('zh-CN'))+stat('pc-stat-budget','users-round','活跃员工',`${team.totals.active_members} / ${team.totals.members}`):credit?stat('pc-stat-balance','server','我的额度',employeeYuan(employeeCredit.available_yuan))+stat('pc-stat-spent','receipt-text','已结算',employeeYuan(employeeCredit.spent_yuan))+stat('pc-stat-calls','chart-no-axes-combined','结算中',employeeYuan(employeeCredit.held_yuan))+stat('pc-stat-budget','clock','发放',employeeYuan(employeeCredit.granted_yuan)):(manager?stat('pc-stat-balance','users-round','团队成员',String(active))+stat('pc-stat-spent','receipt-text','待审批',String(pending.length))+stat('pc-stat-calls','chart-no-axes-combined','模型调用','—')+stat('pc-stat-budget','clock','公司额度','未开通'):stat('pc-stat-balance','server','我的额度','未开通')+stat('pc-stat-spent','receipt-text','已结算','—')+stat('pc-stat-calls','chart-no-axes-combined','结算中','—')+stat('pc-stat-budget','clock','发放','—'));
  if(['overview','models','keys'].includes(orgTab))personalTab=orgTab;
  const content=(orgTab==='usage'&&(team||credit)?purchaseEntry('usage'):'')+(orgTab==='compare'?comparePanel():orgTab==='people'?people:orgTab==='settings'?settingsContent(o):orgTab==='support'?supportContent():orgTab==='usage'?(team?teamUsageContent(team):credit?memberUsageContent():manager&&paidCredit?paidUsagePanel():'<section class="personal-state-panel"><h2>用量</h2><p>这个企业尚未开通公司额度，暂无用量数据。</p></section>'):personalDashboardContent());
  mount(panelPage(o,orgTab,`${['overview','compare','support','settings'].includes(orgTab)?'':`<div class="personal-console-stats">${stats}</div>`}<div data-personal-content>${content}</div>`));
 }
 let demoState=null;
 const yuan=fen=>'¥'+(Number(fen||0)/100).toFixed(2);
 function demoOrg(){return current.startsWith('demo/organization/')?current.slice('demo/organization/'.length):null;}
 async function demoPage(ticket=generation){const org=demoOrg(),data=await api(org?'/api/demo/organizations/'+encodeURIComponent(org):'/api/demo/personal');if(ticket!==generation)return;demoState=data;
  const name=code=>data.models.find(m=>m.code===code)?.name||code;
  const paid=Number(data.wallet.balance_fen)>0,ownKeys=data.keys.filter(k=>k.user_id===me.user.id);
  const ownAllocation=data.allocations.find(a=>a.user_id===me.user.id);
  const orgName=org?me.organizations.find(o=>o.id===org)?.name||'企业空间':'个人空间';
  const canBuy=!org||data.representative;
  const orders=data.orders.map(o=>`<article class="demo-line"><div><b>余额充值</b><small>${new Date(o.created_at).toLocaleString('zh-CN')} · ${esc(o.id.slice(0,8))}</small></div><strong>${yuan(o.amount_fen)}</strong><span class="demo-status ${o.status==='paid'?'done':''}">${o.status==='paid'?'模拟已付款':'待模拟付款'}</span>${o.status==='pending'&&canBuy?btn('模拟付款','demo-pay',`data-id="${o.id}"`,'primary'):''}</article>`).join('')||(org&&!data.representative?'<p class="demo-empty">采购由企业管理者管理。已购买的演示模型和你的额度在下方显示。</p>':'<p class="demo-empty">还没有充值单。先选择模型，再创建模拟充值单。</p>');
  const keys=data.keys.map(k=>`<article class="demo-line"><div><b>${esc(k.label)}</b><small>${esc((k.model_codes||[k.model_code]).map(name).join('、'))} · ${esc(k.id.slice(0,8))} · ${k.user_id===me.user.id?'我创建的':'团队成员创建的'}</small></div><span class="demo-status ${k.status==='active'?'done':''}">${k.status==='active'?'模拟接入中':'已停用'}</span>${k.user_id===me.user.id&&k.status==='active'?btn('模拟一次调用','demo-use',`data-id="${k.id}"`,'primary')+btn('停用','demo-revoke',`data-id="${k.id}"`,'quiet'):''}</article>`).join('')||'<p class="demo-empty">完成模拟付款后，创建一个演示接入。</p>';
  const usage=data.usage.map(u=>`<tr><td>${new Date(u.created_at).toLocaleString('zh-CN')}</td><td>${esc(name(u.model_code))}</td><td>${u.input_tokens.toLocaleString()} / ${u.output_tokens.toLocaleString()}</td><td>${yuan(u.cost_fen)}</td><td>${esc(u.user_id===me.user.id?'我':data.members.find(m=>m.user_id===u.user_id)?.name||'团队成员')}</td></tr>`).join('')||'<tr><td colspan="5" class="demo-empty">尚无模拟用量。完成一次模拟调用后，这里会留下记录。</td></tr>';
  const allocations=org&&data.representative?`<section class="demo-panel"><div class="demo-panel-head"><div><small>TEAM BUDGET</small><h2>员工额度</h2></div>${btn('分配额度','demo-allocate','','primary')}</div><div class="demo-allocations">${data.members.map(m=>{const a=data.allocations.find(a=>a.user_id===m.user_id);return `<article><b>${esc(m.name)}</b><small>${esc(m.email)}</small><span>额度 ${yuan(a?.limit_fen)} · 已用 ${yuan(a?.spent_fen)}</span></article>`;}).join('')}</div></section>`:org?`<section class="demo-panel"><div class="demo-panel-head"><div><small>MY BUDGET</small><h2>我的企业额度</h2></div></div><p>已分配 ${yuan(ownAllocation?.limit_fen)} · 已使用 ${yuan(ownAllocation?.spent_fen)} · 剩余 ${yuan(Number(ownAllocation?.limit_fen||0)-Number(ownAllocation?.spent_fen||0))}</p></section>`:'';
  mount(`<div class="demo-shell"><div class="demo-head"><div><a href="#${org?'organization/'+org+'/overview':'personal'}">← 返回${esc(orgName)}</a><span class="demo-tag">独立模拟环境</span><h1>${esc(orgName)} · 模拟体验台</h1><p>选模型、下订单、模拟付款、分配额度、创建演示接入、查看用量。这里不会收取真实费用，也不会调用供应商模型。</p></div><span class="demo-watermark">DEMO<br>ONLY</span></div><ol class="demo-steps"><li class="${data.orders.length||paid?'done':''}">01 选模型下单</li><li class="${paid?'done':''}">02 模拟付款</li><li class="${ownKeys.length?'done':''}">03 创建演示接入</li><li class="${data.usage.length?'done':''}">04 查看使用记录</li></ol><div class="demo-kpis"><article><span>模拟可用余额</span><strong>${yuan(data.wallet.balance_fen)}</strong></article><article><span>模拟累计使用</span><strong>${yuan(data.wallet.spent_fen)}</strong></article><article><span>演示接入</span><strong>${data.keys.filter(k=>k.status==='active').length}</strong></article><article><span>模拟调用</span><strong>${data.usage.length}</strong></article></div><div class="demo-grid"><section class="demo-panel"><div class="demo-panel-head"><div><small>01 / MODEL & ORDER</small><h2>计费流程演示</h2></div>${canBuy?btn('创建模拟订单','demo-order','','primary'):''}</div><p class="demo-muted">以下三个匿名模型仅用于测试订单、余额与扣费，不代表正式销售商品。正式选型将从品牌进入具体型号，依据供应验收与价格审核上架。<a href="#catalog">查看品牌目录 →</a></p><div class="demo-models">${data.models.map(m=>`<div><b>${esc(m.name)}</b><small>${esc(m.kind)} · ${data.purchased_models.includes(m.code)?'已模拟购买':'模拟可选'}</small></div>`).join('')}</div></section><section class="demo-panel"><div class="demo-panel-head"><div><small>02 / PAYMENT</small><h2>订单与模拟付款</h2></div></div><div class="demo-list">${orders}</div></section>${allocations}<section class="demo-panel"><div class="demo-panel-head"><div><small>03 / ACCESS</small><h2>接入状态</h2></div>${paid&&(!org||Number(ownAllocation?.limit_fen||0)>Number(ownAllocation?.spent_fen||0))?btn('创建演示接入','demo-key','','primary'):''}</div><p class="demo-muted">仅生成演示记录 ID，不生成可用于 API 的密钥。</p><div class="demo-list">${keys}</div></section><section class="demo-panel demo-usage"><div class="demo-panel-head"><div><small>04 / USAGE</small><h2>使用记录</h2></div></div><div class="live-table-wrap"><table><thead><tr><th>时间</th><th>模型</th><th>输入 / 输出 Token</th><th>模拟费用</th><th>使用者</th></tr></thead><tbody>${usage}</tbody></table></div></section></div><p class="demo-disclaimer">所有金额、余额、订单、接入状态和用量均为模拟数据；真实支付、API Key 和模型调用尚未开放。</p></div>`);
  const steps=host.querySelectorAll('.demo-steps li');
  if(!data.selected_models.length)host.querySelector('[data-live="demo-key"]')?.remove();
  if(steps[0]){steps[0].textContent='01 选择模型';steps[0].classList.toggle('done',data.selected_models.length>0);}
  if(steps[1])steps[1].textContent='02 余额充值';
  const panels=host.querySelectorAll('.demo-grid > .demo-panel');
  const choose=panels[0],payment=panels[1];
  if(choose){choose.querySelector('h2').textContent='选择可用模型';choose.querySelector('.demo-panel-head [data-live]')?.remove();if(canBuy)choose.querySelector('.demo-panel-head').insertAdjacentHTML('beforeend',btn('选择模型','demo-select','','primary'));choose.querySelectorAll('.demo-models > div').forEach((card,index)=>{const m=data.models[index];if(card&&m)card.querySelector('small').textContent=m.kind+' · '+(data.selected_models.includes(m.code)?'已选择':'未选择');});}
  if(payment){payment.querySelector('h2').textContent='充值与模拟付款';if(canBuy)payment.querySelector('.demo-panel-head').insertAdjacentHTML('beforeend',btn('创建充值单','demo-order','','primary')+(Number(data.wallet.balance_fen)>0?btn('模拟退款','demo-refund','','quiet'):''));for(const r of data.refunds||[])payment.querySelector('.demo-list').insertAdjacentHTML('beforeend',`<article class="demo-line"><div><b>模拟退款</b><small>${new Date(r.created_at).toLocaleString('zh-CN')} · 手续费 ¥0.00</small></div><strong>-${yuan(r.amount_fen)}</strong><span class="demo-status done">仅演示</span></article>`);}
  if(org&&data.representative){host.querySelector('.demo-panel-head [data-live="demo-allocate"]')?.remove();host.querySelectorAll('.demo-allocations article').forEach((row,index)=>{const member=data.members[index],a=data.allocations.find(a=>a.user_id===member.user_id);row.querySelector('span').textContent=`额度 ${yuan(a?.limit_fen)} · 已用 ${yuan(a?.spent_fen)} · 授权 ${a?.model_codes?.length||0} 款型号`;row.insertAdjacentHTML('beforeend',btn('设置额度与型号','demo-allocate',`data-id="${member.user_id}"`,'quiet'));});}
  host.querySelector('.demo-head p').textContent='选一个或多个模型，给个人或企业钱包充值，再创建限定型号的演示接入，查看扣费与用量。所有资金和调用均为模拟。';
  host.querySelector('.demo-disclaimer').textContent='所有金额、余额、订单、接入和用量仅为模拟数据。退款不会连接支付渠道；真实支付按红绿模型：只退红色实付剩余、无手续费，绿色赠送整条收回。真实支付、平台 Key 和模型调用尚未开放。';
  if(data.ledger?.length){const usagePanel=host.querySelector('.demo-usage');usagePanel?.insertAdjacentHTML('afterend',`<section class="demo-panel demo-usage"><div class="demo-panel-head"><div><small>ACCOUNT LEDGER</small><h2>模拟资金流水</h2></div></div><div class="live-table-wrap"><table><thead><tr><th>时间</th><th>事项</th><th>金额</th></tr></thead><tbody>${data.ledger.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString('zh-CN')}</td><td>${{payment:'模拟充值',usage:'模拟使用',refund:'模拟退款'}[x.kind]}</td><td>${x.amount_fen>0?'+':''}${yuan(x.amount_fen)}</td></tr>`).join('')}</tbody></table></div></section>`);}
 }
 function joinPage(){
  const invitation=joinPreview;if(!invitation)return;
  const body=me?`<div class="invite-confirm"><span class="live-eyebrow">企业加入申请</span><h2>申请加入 ${esc(invitation.organizationName)}</h2><p>以 <b>${esc(me.user.email)}</b> 提交申请。企业管理者批准前，你没有企业预算、模型权限或 API Key。</p>${(invitation.departments||[]).length?`<label class="invite-dept">所在部门（可选）<select data-join-department><option value="">暂不选择，由管理者分配</option>${invitation.departments.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></label>`:''}<div id="live-form-message" role="status"></div>${btn('提交加入申请','request-join','','primary')}</div>`:
  `<div class="invite-confirm"><span class="live-eyebrow">${authMode==='register'?'首次加入':'已有账号'}</span><h2>${authMode==='register'?'注册并申请加入':'登录并申请加入'}</h2><p>任意邮箱均可。${authMode==='register'?'注册后打开验证邮件，验证成功即提交入企申请。':'登录成功即提交入企申请。'}企业管理者随后逐一审批。</p><div class="live-tabs">${btn('已有账号登录','auth-mode','data-mode="login"',authMode==='login'?'selected':'')}${btn('注册新账号','auth-mode','data-mode="register"',authMode==='register'?'selected':'')}</div><form class="live-form invite-form" id="live-auth-form">${authMode==='register'?'<label>怎么称呼你<input name="name" autocomplete="name" required maxlength="80" placeholder="你的名字"></label>':''}<label>邮箱<input name="email" type="email" required placeholder="you@example.com"></label>${passwordField('password',authMode==='register'?'设置密码':'密码',authMode==='register')}<div id="live-form-message" role="status"></div><button class="live-button primary" type="submit">${authMode==='register'?'注册并验证邮箱':'登录并继续'} ${ico('arrow-right')}</button></form></div>`;
  mount(`<section class="invite-layout"><div class="invite-intro"><span class="live-eyebrow">JOIN A TEAM</span><h1>一起，把想法<br>变成下一步。</h1><p><b>${esc(invitation.organizationName)}</b> 邀请你申请加入企业空间。</p><div class="invite-target">申请方式 <strong>任意邮箱 · 逐人审批</strong></div><small>这条链接可分享给多人；提交申请不会自动获得预算或模型权限。</small></div><div class="invite-panel">${body}</div></section>`);
 }
 function dialog(title,content){document.querySelector('#config-dialog')?.classList.remove('wide-dialog');showDialog(`<div class="dialog-kicker">semifly.ai · WORKSPACE</div><h2 class="dialog-title">${title}</h2>${content}`);}
 function form(title,content,id,submit='保存'){dialog(title,`<form class="live-form" id="${id}">${content}<div id="live-dialog-message" role="status"></div><button class="live-button primary" type="submit">${submit}</button></form>`);}
 function staffLogin(){staff=null;opsPageCache.clear();mount(hero('STAFF CONSOLE','为团队，守好每一程。','深圳市格洛可半导体有限公司 · 内部员工专用')+`<section class="live-panel live-staff-entry"><h2>使用公司身份登录</h2><p>通过身份中心和多因素验证后，按semifly.ai岗位授权进入。客户身份不会自动变成公司员工。</p>${location.hash.includes('error=')?note('未能完成员工认证，请确认账户已开通并完成多因素验证。',true):''}<a class="live-button primary" href="/api/staff/login">公司员工登录 ${ico('arrow-right')}</a><p class="live-small">首次开通：先点下方链接，用指定的公司员工邮箱验证身份，自己设置密码并绑定验证器。已开通后再点公司员工登录。</p><a class="live-button quiet" href="https://login.glocalstorage.cn/if/flow/oneapi-staff-activation/">开通指定员工身份 ${ico('arrow-up-right')}</a><p class="live-small">如果身份中心显示 admin，请点 Not you? 切换账号。二维码用于绑定动态验证码，仅在确认是自己的员工账号时扫描。</p><a class="live-button quiet" href="#account">我是客户，进入个人或企业空间</a></section>`);}
 async function staffAccount(ticket){
  const info=await api('/api/staff/me');if(ticket!==generation)return;staff=info.staff;me=null;
  if(staff.status!=='active'){mount(hero('YOUR CREW','身份已确认，等待岗位授权。',`${esc(staff.name)} · ${esc(staff.email)}`)+note('你的公司身份已通过认证。请平台管理员在“员工与权限”中为你分配岗位，授权后重新登录。'));return;}
  let data='';
  if(staff.role==='platform_admin'){
   [staffList,customers]=await Promise.all([api('/api/staff/members'),api('/api/staff/customers')]);if(ticket!==generation)return;
   data=`<section class="live-panel"><div class="live-panel-title"><div><h2>员工与权限</h2><p>员工先通过公司身份登录申请，再由平台管理员授权。更改岗位会撤销该员工的既有会话。</p></div>${btn('查看审计','staff-audit')}</div><div class="live-table-wrap"><table><thead><tr><th>员工</th><th>商务</th><th>财务</th><th>技术</th><th>状态</th><th>操作</th></tr></thead><tbody>${staffList.map((s,i)=>`<tr><td><b>${esc(s.name)}</b><small>${esc(s.email)}</small></td><td>${s.role==='pending'?'关':'开'}</td><td>${s.role==='platform_admin'||(s.role!=='pending'&&s.finance_access)?'开':'关'}</td><td>${s.role==='platform_admin'||s.technical_access?'开':'关'}</td><td>${s.status==='active'?'有效':s.status==='pending'?'待授权':'已停用'}</td><td>${btn('设置权限','edit-staff',`data-index="${i}"`,'quiet')}</td></tr>`).join('')}</tbody></table></div></section>`;
  }else if(['operations','support'].includes(staff.role)){customers=await api('/api/staff/customers');if(ticket!==generation)return;}
  else customers=[];
  if(customers.length||staff.role!=='pending')data+=`<section class="live-panel"><div class="live-panel-title"><div><h2>客户账户</h2><p>最近 100 个真实注册账户；不会展示密码、会话凭据或客户 Key。</p></div></div><div class="live-table-wrap"><table><thead><tr><th>客户</th><th>邮箱验证</th><th>账户状态</th><th>操作</th></tr></thead><tbody>${customers.length?customers.map((u,i)=>`<tr><td><b>${esc(u.name)}</b><small>${esc(u.email)}</small></td><td>${u.emailVerified?'已验证':'未验证'}</td><td>${u.disabled?'已停用':'正常'}</td><td>${staff.role==='platform_admin'?btn(u.disabled?'恢复账户':'停用账户','customer-status',`data-index="${i}"`,'quiet'):'只读'}</td></tr>`).join(''):'<tr><td colspan="4" class="live-empty">暂无客户账户</td></tr>'}</tbody></table></div></section>`;
  const labEntry=`<section class="live-panel"><div class="live-module-grid"><a href="#console/business/overview">${ico('briefcase-business')}<h3>商务后台</h3><p>收入与利润、发票、供应商与客户、产品与折扣、客户支持。</p><b>进入商务后台 →</b></a>${staff.role==='platform_admin'||staff.technical_access?`<a href="#console/technical/overview">${ico('terminal')}<h3>技术运维后台</h3><p>Key 统一录入、型号探测、真实测试、计量核对与目录发布。</p><b>进入技术运维 →</b></a>`:''}</div></section>`;
  mount(hero('PLATFORM WORKSPACE',`你好，${esc(staff.name)}。`,'同一公司身份，按岗位进入业务运营或技术运维。')+labEntry+data);

 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-tech-sub]');if(!b)return;b.disabled=true;try{const response=await fetch('/api/staff/members/'+encodeURIComponent(b.dataset.techSub)+'/technical-access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:b.dataset.enabled==='true'})});const result=await response.json();if(!response.ok)throw Error(result.error);await route('staff-account')}catch(error){alert(error.message)}finally{b.disabled=false}});
 const supplyChecks={source:'供应来源',sales_rights:'服务与销售范围',model_version:'模型版本',protocol:'协议与能力',data_region:'数据处理地区',usage_billing:'用量与账单',capacity:'容量与限额'};
 const supplyStatus={candidate:'候选',reviewing:'资料核验中',blocked:'暂停',draft:'草稿'};
 const serviceTypes={unconfirmed:'待确认',model_api:'模型 API',managed_inference:'托管推理',gpu_rental:'GPU 租赁',software_optimization:'软件优化',other:'其他'};
 const sourceTypes={unconfirmed:'待确认',official:'模型官方',authorized_reseller:'授权转供',cloud_provider:'云服务商'};
 const testTypes={connectivity:'连通性',response:'模型响应',usage:'计量账单',capacity:'容量'};
 const testResults={passed:'通过',failed:'失败',inconclusive:'待确认'};
 function supplierProgress(s){
  const offers=supplyData.offers.filter(o=>o.supplier_id===s.id);
  if(s.status==='blocked')return {stage:'已暂停',next:s.next_action||'先处理暂停原因',offers};
  if(!offers.length)return {stage:'主体建档',next:s.next_action||'登记供应产品与权利材料',offers};
  if(s.latest_test?.result==='failed')return {stage:'测试失败',next:s.next_action||'排查最近测试失败原因',offers};
  const issues=offers.flatMap(o=>o.readiness?.issues||[]);
  if(issues.length)return {stage:'资料待澄清',next:s.next_action||`处理${issues[0]}问题`,offers};
  const incomplete=offers.find(o=>!o.readiness?.documents_complete);
  return incomplete?{stage:'资料核验',next:s.next_action||`补齐${incomplete.readiness?.missing?.[0]||'供应'}证据`,offers}:s.latest_test?{stage:'测试待复核',next:s.next_action||'完成其余能力、账单与容量复核',offers}:{stage:'待接口验证',next:s.next_action||'安排真实接口、计量与容量测试',offers};
 }
 async function supplierLandingPage(ticket){
  if(!await staffContext(ticket))return;
  supplyData=await api('/api/staff/suppliers');if(ticket!==generation)return;
  const write=staff.role!=='pending',items=supplyData.suppliers;
  const rows=items.map(s=>{const p=supplierProgress(s),t=s.latest_test;return `<a class="supply-intake-row" href="#ops/supply/${s.id}" aria-label="打开${esc(s.display_name)}的供应商详情"><span class="supply-intake-name"><b>${esc(s.display_name)}</b><small>${esc(s.legal_name)} · ${esc(s.region)}</small></span><span><small>供给类型</small><b>${serviceTypes[s.service_type]||'待确认'}</b></span><span><small>当前阶段</small><b>${p.stage}</b></span><span><small>负责人</small><b>${esc(s.owner_name||s.owner_email||'待指定')}</b></span><span class="supply-intake-next"><small>下一步</small><b>${esc(p.next)}</b></span><span><small>最近测试</small><b class="${t?'':'supply-no-test'}">${t?`${testTypes[t.test_type]} · ${testResults[t.result]}`:'未登记测试'}</b>${t?`<small>${esc(t.model_name)} · ${new Date(t.observed_at).toLocaleDateString('zh-CN')}</small>`:''}</span>${ico('arrow-right')}</a>`;}).join('');
  const blocked=items.filter(s=>s.status==='blocked').length;
  mount(`<div class="supply-shell"><aside class="supply-side"><b>${ico('building-2')} 供应管理台</b><a href="#staff-account">${ico('layout-dashboard')} 员工工作台</a><a class="active" href="#ops/supply">${ico('server')} 供应商引入</a><a href="#ops/promotions">${ico('gift')} 促销活动</a><a href="#market">${ico('layers')} 模型广场</a><small>内部工作空间 · ${esc(staffRoles[staff.role])}</small></aside><div class="supply-content supply-intake-content"><div class="supply-heading"><div><span class="org-kicker">SUPPLY OPERATIONS</span><h1>供应商引入</h1><p>一眼看清每家供方到了哪一步，再进入产品与证据详情。</p></div>${write?btn('新增候选供应商','supply-add-supplier','','primary'):''}</div><div class="supply-intake-kpis"><article><small>候选供应商</small><strong>${items.length}</strong><span>档案与真实产品分开管理</span></article><article><small>待推进</small><strong>${items.length-blocked}</strong><span>按负责人和下一步跟进</span></article><article><small>暂停</small><strong>${blocked}</strong><span>不纳入新产品采购</span></article><article><small>可售供应</small><strong>0</strong><span>真实接口、合同与计费未验收</span></article></div><section class="supply-panel supply-intake-panel"><div class="supply-intake-title"><div><span class="org-kicker">ONBOARDING PIPELINE</span><h2>供应商进度</h2><p>点击供应商查看来源、模型产品及逐项核验证据。</p></div><span>${items.length} 家</span></div><div class="supply-intake-list">${rows||'<div class="supply-empty">还没有供应商。先建立候选档案，再核对服务、权利和真实产品。</div>'}</div></section><p class="supply-intake-foot">“未登记测试”表示尚无带证据的测试记录；资料记录不等于技术通过或获准销售。</p></div></div>`);
  host.querySelector('.supply-side a.active')?.insertAdjacentHTML('afterend',`<a href="#ops/products">${ico('layers')} 模型商品设计</a><a href="#ops/payments">${ico('receipt-text')} 付费准备</a>`);
 }
 async function supplierPage(ticket,preferredOffer){
  if(!await staffContext(ticket))return;
  supplyData=await api('/api/staff/suppliers');if(ticket!==generation)return;
  const supplierId=current.match(/^ops\/supply\/([^/]+)$/)?.[1];
  const supplier=supplyData.suppliers.find(s=>s.id===supplierId);
  if(!supplier){location.hash='ops/supply';return;}
  supplyData={...supplyData,suppliers:[supplier],offers:supplyData.offers.filter(o=>o.supplier_id===supplierId)};
  const productData=await api('/api/staff/model-products');if(ticket!==generation)return;supplyData.products=productData.products.filter(p=>p.supplier_id===supplierId);
  const selected=[preferredOffer,offerDetail?.offer?.id,supplyData.offers[0]?.id].find(key=>supplyData.offers.some(o=>o.id===key));
  const [detail,validationData]=selected?await Promise.all([api('/api/staff/supplier-offers/'+encodeURIComponent(selected)),api('/api/staff/supplier-offers/'+encodeURIComponent(selected)+'/validations')]):[null,null];offerDetail=detail;if(ticket!==generation)return;
  const write=staff.role!=='pending',supplierOptions=supplyData.suppliers.filter(x=>x.status!=='blocked');
  const selectedOffer=offerDetail?.offer,checkRows=offerDetail?.checks||[];
  const readiness=offerDetail?.readiness;
  const validationGate=readiness?`<section class="supply-gate" aria-label="供应产品准入状态"><div><b>资料核验 ${readiness.documented}/${readiness.total}</b><small>${esc(readiness.next_step)}</small></div><span>不可售 · 真实探测、合同、定价及结算仍待验证</span></section>`:'';
  const testsPanel=selectedOffer?`<section class="supply-panel supply-check-panel"><div class="supply-panel-head"><div><span class="org-kicker">TEST EVIDENCE</span><h2>${esc(selectedOffer.model_name)} · 测试记录</h2><p>人工登记已有证据的测试结果；记录本身不会自动开售。</p></div>${write?btn('登记测试','supply-add-test','','primary'):''}</div><div class="supply-checks">${offerDetail.tests.length?offerDetail.tests.map(t=>`<article><div><b>${testTypes[t.test_type]} · ${testResults[t.result]}</b><small>${new Date(t.observed_at).toLocaleString('zh-CN')}${t.latency_ms===null?'':` · ${t.latency_ms} ms`} · <a href="${esc(t.evidence_url)}" target="_blank" rel="noopener noreferrer">查看证据</a>${t.notes?` · ${esc(t.notes)}`:''}</small></div></article>`).join(''):'<div class="supply-empty">尚未登记真实测试。取得测试账户和证据后再记录结果。</div>'}</div></section>`:'';
  const productPanel=`<section class="supply-panel supply-product-panel"><div class="supply-panel-head"><div><span class="org-kicker">MODEL PRODUCT DESIGN</span><h2>客户模型商品草稿</h2><p>产品名称与代码属于客户目录；必须先关联真实供应产品。草稿不会公开，也没有售价。</p></div>${write&&selectedOffer?btn('设计商品','supply-add-product','','primary'):''}</div><div class="supply-list">${supplyData.products.length?supplyData.products.map(product=>`<article><div><b>${esc(product.display_name)}</b><small>${esc(product.product_code)} · ${esc(product.supplier_name)} / ${esc(product.source_model)} · ${esc(product.region)}</small></div><span class="supply-state">内部草稿</span></article>`).join(''):'<div class="supply-empty">暂无客户商品草稿。先建立并核验供应产品，再设计客户看到的型号。</div>'}</div></section>`;
  mount(`<div class="supply-shell"><aside class="supply-side"><b>${ico('building-2')} 供应管理台</b><a href="#staff-account">${ico('layout-dashboard')} 员工工作台</a><a class="active" href="#ops/supply">${ico('server')} 供应商与验证</a><a href="#ops/promotions">${ico('gift')} 促销活动</a><a href="#market">${ico('layers')} 模型广场</a><small>内部工作空间 · ${esc(staffRoles[staff.role])}</small></aside><div class="supply-content"><div class="supply-heading"><div><span class="org-kicker">SUPPLY OPERATIONS</span><h1>供应商与产品验证</h1><p>记录真实来源、采购产品和核验依据。候选资料不会自动成为可售商品。</p></div>${write?btn('新增供应商','supply-add-supplier','','primary'):''}</div><div class="supply-kpis"><article><small>供应商档案</small><strong>${supplyData.suppliers.length}</strong><span>仅内部候选与资料记录</span></article><article><small>采购产品草稿</small><strong>${supplyData.offers.length}</strong><span>未接入真实调用</span></article><article><small>待核验产品</small><strong>${supplyData.offers.filter(o=>o.status!=='blocked').length}</strong><span>需要授权和测试证据</span></article><article><small>已开放销售</small><strong>0</strong><span>真实验证与支付未就绪</span></article></div><div class="supply-grid"><section class="supply-panel"><div class="supply-panel-head"><div><h2>供应商档案</h2><p>主体、来源与所在地区</p></div></div><div class="supply-list">${supplyData.suppliers.length?supplyData.suppliers.map(x=>`<article><div><b>${esc(x.display_name)}</b><small>${esc(x.legal_name)} · ${esc(x.region)}</small></div><span class="supply-state">${supplyStatus[x.status]}</span>${write?btn('管理','supply-edit-supplier',`data-id="${x.id}"`,'quiet'):''}</article>`).join(''):'<div class="supply-empty">还没有供应商。先建立主体档案，再添加其采购产品。</div>'}</div></section><section class="supply-panel"><div class="supply-panel-head"><div><h2>供应产品</h2><p>型号、协议、核验与可售状态</p></div>${write&&supplierOptions.length?btn('新增产品','supply-add-offer','','primary'):''}</div><div class="supply-list">${supplyData.offers.length?supplyData.offers.map(o=>`<button class="supply-offer ${selectedOffer?.id===o.id?'selected':''}" data-live="supply-select-offer" data-id="${o.id}"><span><b>${esc(o.model_name)}</b><small>${esc(o.supplier_name)} · ${esc(o.upstream_model_id)} · ${esc(o.region)}</small></span><em>${supplyStatus[o.status]} · ${o.readiness?.documented||0}/7</em></button>`).join(''):'<div class="supply-empty">还没有产品草稿。产品必须关联具体供应商。</div>'}</div></section></div>${validationGate}${testsPanel}${selectedOffer?`<section class="supply-panel supply-check-panel"><div class="supply-panel-head"><div><span class="org-kicker">PRODUCT VALIDATION</span><h2>${esc(selectedOffer.model_name)} · 核验记录</h2><p>人工资料核对与证据链接；“已记录”仅代表材料已登记，不代表接口测试通过。</p></div>${write?btn('修改产品状态','supply-edit-offer',`data-id="${selectedOffer.id}"`,'quiet'):''}</div><div class="supply-checks">${checkRows.map(c=>`<article><div><b>${supplyChecks[c.check_key]}</b><small>${c.result==='documented'?'资料已记录':c.result==='issue'?'发现问题':'待核对'}${c.evidence_url?` · <a href="${esc(c.evidence_url)}" target="_blank" rel="noopener noreferrer">查看证据</a>`:''}</small></div>${write?btn('记录','supply-edit-check',`data-key="${c.check_key}"`,'quiet'):''}</article>`).join('')}</div></section>`:''}${productPanel}<p class="supply-disclaimer">当前阶段没有采购账户、上游密钥、合同批准、真实探测、计费或可售商品。请勿在备注中填写密钥或密码。</p></div></div>`);
  if(selectedOffer){
   const runs=validationData.runs,latest=runs[0],summary=latest?`最近记录：${esc(latest.conclusion==='passed'?'报告通过':latest.conclusion==='failed'?'报告失败':'待复核')} · ${latest.success_count}/${latest.sample_count} 次成功 · ${((latest.success_count/latest.sample_count)*100).toFixed(1)}%（人工报告）`:'尚无成组验收记录';
   const rows=runs.map(r=>`<article><div><b>${esc(r.objective)} · ${r.conclusion==='passed'?'报告通过':r.conclusion==='failed'?'报告失败':'待复核'}</b><small>${new Date(r.window_start).toLocaleString('zh-CN')} — ${new Date(r.window_end).toLocaleString('zh-CN')} · ${r.success_count}/${r.sample_count} 次成功 · 首 Token p95 ${r.p95_ttft_ms??'—'} ms · 完整 p95 ${r.p95_total_ms??'—'} ms · 计量${r.usage_check==='matched'?'已核对':r.usage_check==='mismatched'?'有差异':'未核对'}</small><small>${esc(r.notes)} · <a href="${esc(r.evidence_url)}" target="_blank" rel="noopener noreferrer">查看报告</a></small></div></article>`).join('');
   const panel=`<section class="supply-panel supply-validation-panel"><div class="supply-panel-head"><div><span class="org-kicker">VALIDATION REPORTS</span><h2>${esc(selectedOffer.model_name)} · 验收统计</h2><p>${summary}。记录由员工录入，不等于自动探测或可售批准。</p></div>${write?btn('登记验收报告','supply-add-validation','','primary'):''}</div><div class="supply-list">${rows||'<div class="supply-empty">取得真实测试报告后，在此记录时间窗、样本、延迟和计量核对结果。</div>'}</div></section>`;
   host.querySelector('.supply-gate')?.insertAdjacentHTML('afterend',panel);
  }
  host.querySelector('.supply-heading > div')?.insertAdjacentHTML('afterbegin','<a class="supply-back-link" href="#ops/supply">← 返回供应商进度</a>');
  host.querySelector('.supply-side a.active')?.insertAdjacentHTML('afterend',`<a href="#ops/products">${ico('layers')} 模型商品设计</a>`);
  host.querySelector('.supply-heading h1').textContent=supplier.display_name+' · 产品验证';
  host.querySelector('.supply-heading p').textContent=`${supplier.legal_name} · ${serviceTypes[supplier.service_type]||'供给类型待确认'} · ${supplierProgress(supplier).next}`;
  const headingAction=host.querySelector('.supply-heading [data-live="supply-add-supplier"]');if(headingAction){headingAction.dataset.live='supply-edit-supplier';headingAction.dataset.id=supplier.id;headingAction.textContent='编辑供应商';}
  host.querySelector('.supply-product-panel .supply-panel-head > div')?.insertAdjacentHTML('beforeend','<a class="supply-back-link" href="#ops/products">查看全部商品进度 →</a>');
 }
 async function productLandingPage(ticket){
  if(!await staffContext(ticket))return;
  const [catalog,supply,prices,validation,reviews,decisions]=await Promise.all([api('/api/staff/model-products'),api('/api/staff/suppliers'),api('/api/staff/price-proposals'),api('/api/staff/validation-summary'),api('/api/staff/model-product-reviews'),api('/api/staff/price-decisions')]);if(ticket!==generation)return;
  const offers=new Map(supply.offers.map(o=>[o.id,o])),suppliers=new Map(supply.suppliers.map(s=>[s.id,s])),latestRuns=new Map(validation.latest.map(r=>[r.offer_id,r])),products=catalog.products,latestPrice=new Map(),latestReview=new Map();pricingData={products,proposals:prices.proposals,decisions:decisions.decisions};for(const q of prices.proposals)if(!latestPrice.has(q.model_product_id))latestPrice.set(q.model_product_id,q);for(const r of reviews.reviews)if(!latestReview.has(r.model_product_id))latestReview.set(r.model_product_id,r);reviewData={products,reviews:reviews.reviews,eligible:new Set(products.filter(p=>{const offer=offers.get(p.offer_id),run=latestRuns.get(p.offer_id);return offer?.readiness?.documents_complete&&run?.conclusion==='passed'&&run.usage_check==='matched'&&latestPrice.has(p.id);}).map(p=>p.id))};
  const rows=products.map(p=>{if(p.source_kind==='owned_service')return `<article class="supply-intake-row product-progress-row"><span class="supply-intake-name"><b>${esc(p.display_name)}</b><small>${esc(p.product_code)}</small></span><span><small>来源</small><b>semifly.ai 自有服务</b><small>${esc(p.source_description)}</small></span><span><small>服务验证</small><b>待真实验收</b><small>须证明底层能力与授权</small></span><span><small>价格设计</small><b>${latestPrice.has(p.id)?'内部草稿':'待设计'}</b></span><span><small>发布状态</small><b>内部草稿</b></span><span class="supply-intake-next"><small>下一步</small><b>补齐能力、测试与交付证据</b></span>${ico('arrow-right')}</article>`;const offer=offers.get(p.offer_id),supplier=suppliers.get(p.supplier_id),readiness=offer?.readiness,report=latestRuns.get(p.offer_id),paused=p.status==='blocked'||offer?.status==='blocked'||supplier?.status==='blocked',stage=paused?'已暂停':!readiness?.documents_complete?`资料 ${readiness?.documented||0}/7`:!report?'待技术验收':report.conclusion==='failed'?'报告有失败':report.conclusion==='inconclusive'?'报告待复核':'报告通过·待审批',next=paused?'先处理暂停原因':!readiness?.documents_complete?`补齐${readiness?.missing?.[0]||'供应'}资料`:!report?'登记真实测试的验收报告':'复核验收证据、计量与销售权';return `<a class="supply-intake-row product-progress-row" href="#ops/supply/${p.supplier_id}" aria-label="查看${esc(p.display_name)}的供给与核验证据"><span class="supply-intake-name"><b>${esc(p.display_name)}</b><small>${esc(p.product_code)}</small></span><span><small>来源供方</small><b>${esc(p.supplier_name)}</b><small>${esc(p.source_model)}</small></span><span><small>供给验证</small><b>${stage}</b>${report?`<small>人工报告 ${report.success_count}/${report.sample_count} 次成功</small>`:''}</span><span><small>价格设计</small><b>${latestPrice.has(p.id)?'内部草稿':'待设计'}</b>${latestPrice.has(p.id)?`<small>入 ¥${(Number(latestPrice.get(p.id).input_fen_per_million)/100).toFixed(2)} · 出 ¥${(Number(latestPrice.get(p.id).output_fen_per_million)/100).toFixed(2)} / 百万 tokens</small>`:''}</span><span><small>发布状态</small><b>内部草稿</b></span><span class="supply-intake-next"><small>下一步</small><b>${esc(next)}</b></span>${ico('arrow-right')}</a>`;}).join('');
  mount(`<div class="supply-shell"><aside class="supply-side"><b>${ico('building-2')} 平台运营台</b><a href="#staff-account">${ico('layout-dashboard')} 员工工作台</a><a href="#ops/supply">${ico('server')} 供应商引入</a><a class="active" href="#ops/products">${ico('layers')} 模型商品设计</a><a href="#ops/promotions">${ico('gift')} 促销活动</a><small>内部工作空间 · ${esc(staffRoles[staff.role])}</small></aside><div class="supply-content supply-intake-content"><div class="supply-heading"><div><span class="org-kicker">MODEL PRODUCT DESIGN</span><h1>模型商品进度</h1><p>从来源供给到资料、技术、价格与发布，一屏看清每款商品下一步。</p></div>${staff.role!=='pending'&&products.length?btn('设计价格草稿','price-add','','primary'):'<a class="live-button primary" href="#ops/supply">从供应商开始 '+ico('arrow-right')+'</a>'}</div><div class="supply-intake-kpis"><article><small>商品草稿</small><strong>${products.length}</strong><span>关联真实供给档案</span></article><article><small>待技术验收</small><strong>${products.filter(p=>offers.get(p.offer_id)?.readiness?.documents_complete).length}</strong><span>资料完整仍需真实探测</span></article><article><small>价格草稿</small><strong>${latestPrice.size}</strong><span>仅内部方案，尚未审核发布</span></article><article><small>公开销售</small><strong>0</strong><span>销售与调用尚未开放</span></article></div><section class="supply-panel supply-intake-panel"><div class="supply-intake-title"><div><span class="org-kicker">PRODUCT PIPELINE</span><h2>商品清单</h2><p>点击商品前往对应供方的验证与证据详情。</p></div><span>${products.length} 款</span></div><div class="supply-intake-list">${rows||'<div class="supply-empty">还没有客户商品草稿。先建立供应商与供应产品，再设计客户看到的商品。</div>'}</div></section><p class="supply-intake-foot">价格草稿仅供内部讨论，不是公开售价；模型广场仍为能力展示，订单与真实调用未开放。</p></div></div>`);
  host.querySelector('.supply-side a.active')?.insertAdjacentHTML('afterend',`<a href="#ops/payments">${ico('receipt-text')} 付费准备</a>`);
  if(staff.role!=='pending')host.querySelector('.supply-heading')?.insertAdjacentHTML('beforeend',btn('设计自有服务','owned-product-add','','quiet'));
  if(products.length)host.querySelector('.supply-intake-title > span')?.insertAdjacentHTML('beforebegin',btn('完善型号资料','product-profile-list','','quiet'));
  if(pricingData.proposals.length)host.querySelector('.supply-intake-title > span')?.insertAdjacentHTML('beforebegin',btn('查看价格草稿与依据','price-history','','quiet'));
  if(pricingData.proposals.length)host.querySelector('.supply-intake-title > span')?.insertAdjacentHTML('beforebegin',btn('价格内部复核','price-review-list','','quiet'));
  if(products.length)host.querySelector('.supply-intake-title > span')?.insertAdjacentHTML('beforebegin',btn('商品内部复核','review-list','','quiet'));
  const priceDecisions=new Map(decisions.decisions.map(d=>[d.price_proposal_id,d]));
  host.querySelectorAll('.product-progress-row').forEach((row,index)=>{const product=products[index],review=latestReview.get(product.id),price=latestPrice.get(product.id),decision=price&&priceDecisions.get(price.id);if(price){row.children[3].querySelector('b').textContent=decision?.status==='approved'&&review?.status==='internally_reviewed'&&review.price_proposal_id===price.id?'内部价格已批准':decision?.status==='rejected'?'价格已退回':review?.status==='internally_reviewed'&&review.price_proposal_id===price.id?'待独立价格复核':'内部草稿';}if(!review)return;const state=review.status==='requested'?'内部复核中':review.status==='changes_requested'?'复核退回':'内部复核完成';row.children[4].querySelector('b').textContent=state;row.querySelector('.supply-intake-next b').textContent=review.status==='requested'?'等待独立管理员复核':review.status==='changes_requested'?'补充证据后重新申请':decision?.status==='approved'?'待供给授权与真实收款接入':'待独立价格复核及商业发布';});
 }
 async function paymentPage(ticket){
  if(!await staffContext(ticket))return;
  const [catalog,prices,campaigns,status,decisions]=await Promise.all([api('/api/staff/model-products'),api('/api/staff/price-proposals'),api('/api/staff/promotion-campaigns'),api('/api/status'),api('/api/staff/price-decisions')]);if(ticket!==generation)return;
  const products=catalog.products,priced=new Set(prices.proposals.map(p=>p.model_product_id)),waiting=products.filter(p=>!priced.has(p.id));
  const steps=[['01','供应核验',products.length?`${products.length} 款商品草稿，仍须完成真实验证`:'先建立供应商与真实产品'],['02','价格与规则',`${priced.size} 款有内部价格草稿，尚无公开售价`],['03','商户与订单','待接入真实商户、订单状态及支付回调'],['04','资金与用量','待验收账本、对账、退款和调用计量']];
  mount(`<div class="supply-shell"><aside class="supply-side"><b>${ico('building-2')} 平台运营台</b><a href="#staff-account">${ico('layout-dashboard')} 员工工作台</a><a href="#ops/supply">${ico('server')} 供应商引入</a><a href="#ops/products">${ico('layers')} 模型商品设计</a><a class="active" href="#ops/payments">${ico('receipt-text')} 付费准备</a><a href="#ops/promotions">${ico('gift')} 促销活动</a><small>内部工作空间 · ${esc(staffRoles[staff.role])}</small></aside><div class="supply-content supply-intake-content"><div class="supply-heading"><div><span class="org-kicker">PAYMENT READINESS</span><h1>付费准备</h1><p>从可售商品、价格到订单和资金，逐项推进真实付款上线。</p></div><a class="live-button primary" href="#ops/products">查看商品价格 ${ico('arrow-right')}</a></div><div class="supply-intake-kpis"><article><small>价格草稿</small><strong>${priced.size}</strong><span>尚未成为公开售价</span></article><article><small>待设计价格</small><strong>${waiting.length}</strong><span>需要核对成本与计费单位</span></article><article><small>付款能力</small><strong>${status.payments_enabled?'已开放':'未开放'}</strong><span>不能创建真实订单</span></article><article><small>促销草稿</small><strong>${campaigns.campaigns.length}</strong><span>优惠与返佣未生效</span></article></div><section class="supply-panel supply-intake-panel"><div class="supply-intake-title"><div><span class="org-kicker">GO-LIVE PATH</span><h2>上线前的四步</h2><p>这张进度台只反映已记录的资料和代码状态，不代表已经可以收款。</p></div><span>内部工作台</span></div><div class="payment-step-list">${steps.map(([n,title,description])=>`<article><em>${n}</em><div><b>${title}</b><small>${esc(description)}</small></div></article>`).join('')}</div></section><p class="supply-intake-foot">真实收款、订单、退款、余额和佣金均未开放；接入商户后还需验签、幂等、对账和退款验证。</p></div></div>`);
  const approved=decisions.decisions.filter(d=>d.status==='approved').length;
  const approvalCard=host.querySelector('.supply-intake-kpis article:nth-child(2)');
  if(approvalCard)approvalCard.innerHTML=`<small>内部价格已批准</small><strong>${approved}</strong><span>仍无公开售价 · ${waiting.length} 款待定价</span>`;
 }
 async function promotionPage(ticket){
  if(!await staffContext(ticket))return;
  const [campaigns,products,prices,supply]=await Promise.all([api('/api/staff/promotion-campaigns'),api('/api/staff/model-products'),api('/api/staff/price-proposals'),api('/api/staff/suppliers')]);if(ticket!==generation)return;
  const liveOffers=new Map(supply.offers.map(o=>[o.id,o])),liveSuppliers=new Map(supply.suppliers.map(s=>[s.id,s])),eligible=new Set(products.products.filter(p=>p.status!=='blocked'&&(p.source_kind==='owned_service'||(liveOffers.get(p.offer_id)?.status!=='blocked'&&liveSuppliers.get(p.supplier_id)?.status!=='blocked'))).map(p=>p.id)),seen=new Set(),available=[];
  for(const q of prices.proposals)if(eligible.has(q.model_product_id)&&!seen.has(q.model_product_id)){available.push(q);seen.add(q.model_product_id);}
  promotionData={campaigns:campaigns.campaigns,products:products.products,priceOptions:available};
  const write=staff.role!=='pending';
  mount(`<div class="supply-shell"><aside class="supply-side"><b>${ico('building-2')} 平台运营台</b><a href="#staff-account">${ico('layout-dashboard')} 员工工作台</a><a href="#ops/supply">${ico('server')} 供应商与验证</a><a class="active" href="#ops/promotions">${ico('gift')} 促销活动</a><small>内部工作空间 · ${esc(staffRoles[staff.role])}</small></aside><div class="supply-content"><div class="supply-heading"><div><span class="org-kicker">PROMOTION DESIGN</span><h1>促销活动草稿</h1><p>基于一版内部价格草稿设计折扣、推广佣金和优惠预算。活动仍不能兑换。</p></div>${write&&available.length?btn('设计活动','promotion-add','','primary'):''}</div><div class="supply-kpis"><article><small>内部草稿</small><strong>${promotionData.campaigns.length}</strong><span>尚未发布活动码</span></article><article><small>可兑换活动</small><strong>0</strong><span>兑换服务尚未开放</span></article><article><small>推广佣金</small><strong>0</strong><span>真实消费计佣尚未开放</span></article><article><small>当前收款</small><strong>关闭</strong><span>商户与资金账本待验收</span></article></div><section class="supply-panel"><div class="supply-panel-head"><div><h2>活动清单</h2><p>百分比是未来业务规则草稿，未关联公开售价或客户权益。</p></div></div><div class="supply-list">${promotionData.campaigns.length?promotionData.campaigns.map(c=>`<article><div><b>${esc(c.name)}</b><small>${esc(c.model_product_name)} · 绑定价格 ${c.price_proposal_id?'草稿 '+c.price_proposal_id.slice(0,8):'未绑定'} · 客户价 ${c.customer_price_percent}% · 推广佣金 ${c.commission_percent}% · 优惠预算 ¥${Number(c.total_discount_budget_fen)/100} · ${new Date(c.starts_at).toLocaleDateString('zh-CN')}—${new Date(c.ends_at).toLocaleDateString('zh-CN')}</small></div><span class="supply-state">未发布</span></article>`).join(''):'<div class="supply-empty">暂无活动草稿。先建立模型商品与价格草稿，再设计活动；当前没有可兑换优惠。</div>'}</div></section><p class="supply-disclaimer">草稿不能兑换，不生成促销码，也不产生佣金或资金流水。活动发布仍须核对已审批售价、供给、商户、账本和推广规则。</p></div></div>`);
  host.querySelector('.supply-side a.active')?.insertAdjacentHTML('beforebegin',`<a href="#ops/products">${ico('layers')} 模型商品设计</a><a href="#ops/payments">${ico('receipt-text')} 付费准备</a>`);
 }
 const yuanText=fen=>{const v=BigInt(fen||0);return `¥${v/100n}.${String(v%100n).padStart(2,'0')}`;};
 // 支付宝电脑网站支付 / 微信 Native：选金额 → 支付宝跳转收银台或微信出码 → 轮询，核验后刷新余额。
 const alipayLogo='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" class="alipay-brand-icon" aria-hidden="true" fill="currentColor" fill-rule="evenodd">\n  <path d="M512 64c247.424 0 448 200.576 448 448S759.424 960 512 960 64 759.424 64 512 264.576 64 512 64m32.493 168c-69.66 0-86.056 16.843-86.709 39.079l-.02 1.426v46.623H291.45c-9.92 0-14.28 23.053-14.27 39.31 0 2.696 2.08 4.923 4.77 4.923h175.814v58.301h-116.5c-9.96 0-14.3 23.76-14.271 39.473a4.772 4.772 0 0 0 4.77 4.76l233.448.003c-4.527 41.056-15.432 77.58-30.716 109.315l-1.224 2.494-.32-.275c-60.244-28.47-120.431-52.577-194.407-52.577l-2.61.017c-84.982 1.112-144.718 56.503-145.916 127.04l-.018 1.222.019 2.123c1.238 70.399 63.566 126.452 148.525 126.452 61.245-.008 116.372-16.85 163.457-45.017a138.579 138.579 0 0 0 14.068-7.962c18.09-12.116 34.892-25.955 50.304-41.156l9.452 6.344 12.456 8.322c57.527 38.257 113.763 72.617 169.856 79.27a142.62 142.62 0 0 0 18.314 1.157c43.017 0 54.991-52.68 57.387-95.508l.145-2.84c.392-8.463-6.197-15.595-14.648-15.863-75.468-2.365-136.452-22.043-192.008-46.11l-6.267-2.742c35.146-56.8 56.657-121.816 57.155-186.661l.082-1.083c.401-5.515-3.997-10.198-9.52-10.198H549.33v-58.301h165.732c9.92 0 14.28-22.117 14.27-39.311-.01-2.686-2.089-4.922-4.779-4.922H549.32v-82.35c0-2.656-2.175-4.778-4.827-4.778m-216.5 351.847c54.627 0 107.073 22.417 158.09 52.19l5.77 3.402c-103.575 119.837-247.172 95.903-261.724 26.37a66.89 66.89 0 0 1-1.138-9.83l-.057-2.336.013-.907c.969-40.113 45.337-68.89 99.045-68.89"/>\n</svg>';
 const rechargeAmounts=data=>{
  const paid=BigInt(data.amount_fen??data.cash_fen),credit=BigInt(data.face_fen);
  return [['实付',yuanText(paid)],['赠送额度',yuanText(credit-paid)],['到账额度',yuanText(credit)]];
 };
 const rechargeBreakdown=data=>`<dl class="recharge-breakdown">${rechargeAmounts(data).map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
 const wechatLogo='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" class="payment-brand-icon wechat-brand-icon" aria-hidden="true"><path fill="currentColor" d="M16 3C8.3 3 2 8.2 2 14.7c0 3.6 2 6.9 5.2 9L6 29l5.7-3.1c1.4.4 2.8.6 4.3.6 7.7 0 14-5.3 14-11.8S23.7 3 16 3Z"/><path fill="#fff" d="m9 12 5 3 11-7-10 13a1.5 1.5 0 0 1-2.5-.2Z"/></svg>';
 function alipayPanel(scopeKey,channels){
  const cnFiling=document.documentElement.dataset.icpFiling;
  const filingNumber=cnFiling||'沪ICP备2024050749号-2';
  const filingDomain=cnFiling?'semifly.cn':'glocalstorage.cn';
  const o=alipayPay?.scope===scopeKey?alipayPay.order:null,ch=PAY_CHANNELS[o?.status==='pending'&&!o.expired&&o.provider?o.provider:payChannel],wechat=ch.path==='wechat';
  if(o?.status==='pending'&&!o.expired&&(o.qr_svg||o.pay_url)){
   const body=o.qr_svg
    ?`<div class="alipay-qr" aria-label="${ch.name}付款码">${o.qr_svg}</div><div class="alipay-pay-info"><span class="billing-chip">${ch.name} · 待付款</span>${rechargeBreakdown(o)}<p>请用手机微信扫码付款。付款码 ${new Date(o.expires_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 前有效。</p><p class="billing-pay-status" role="status" data-alipay-status>正在等待付款，支付后这里会自动更新，请勿重复付款。</p>${btn('我已付款，刷新状态','alipay-refresh','','')} ${btn('换个金额','alipay-reset','','')}</div>`
    :`<div class="alipay-pay-info"><span class="billing-chip">${ch.name} · 待付款</span>${rechargeBreakdown(o)}<p>已打开支付宝收银台。用支付宝扫码或登录付款；付完后回到本页，状态会自动更新。链接 ${new Date(o.expires_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 前有效。</p><p class="billing-pay-status" role="status" data-alipay-status>正在等待付款，请勿重复付款。</p><p><a class="live-button primary" href="${esc(o.pay_url)}" target="_blank" rel="noopener">再次打开支付宝收银台</a></p>${btn('我已付款，刷新状态','alipay-refresh','','')} ${btn('换个金额','alipay-reset','','')}</div>`;
   return `<div class="alipay-pay" id="alipay-pay">${wechat?'':alipayLogo}${body}</div>`;
  }
  const done=o?.status==='paid'?`<section class="alipay-result ok" aria-label="充值成功"><p role="status">充值成功</p>${rechargeBreakdown(o)}${o.paid_at?`<time datetime="${esc(o.paid_at)}">${billingTime(o.paid_at)}（北京时间）</time>`:''}</section>`:o?`<p class="alipay-result" role="status">上一笔付款订单已失效。可以在资金记录查看到账情况。</p>`:'';
  const presets=[5000,10000,50000,100000];
  const pick=channels.length>1?`<div class="alipay-presets pay-channels" role="radiogroup" aria-label="支付方式">${channels.map(c=>`<button type="button" role="radio" aria-checked="${c===payChannel}" class="alipay-preset ${c===payChannel?'active':''}" data-live="pay-channel" data-channel="${c}">${c==='wechat_native'?wechatLogo:alipayLogo}${PAY_CHANNELS[c].name}</button>`).join('')}</div>`:'';
  return `${done}${pick}<div class="recharge-layout"><div class="recharge-entry"><label class="recharge-amount-label" for="alipay-yuan">实付金额（元）</label><div class="recharge-amount"><span aria-hidden="true">¥</span><input id="alipay-yuan" inputmode="decimal" autocomplete="off" maxlength="8" aria-describedby="recharge-amount-help" placeholder="最低 5 元" value="${(alipayFen/100).toFixed(2)}"></div><p id="recharge-amount-help" class="recharge-help">实付最低 ¥5，最高 ¥50,000。使用优惠后，到账额度可能高于实付金额。</p><div class="alipay-presets recharge-presets" aria-label="常用充值额度">${presets.map(f=>`<button type="button" aria-pressed="${alipayFen===f}" class="alipay-preset ${alipayFen===f?'active':''}" data-live="alipay-amount" data-fen="${f}">¥${f/100}</button>`).join('')}</div><details class="recharge-promo" ${cwInputCode?'open':''}><summary>有促销码？</summary><label for="pack-promo">促销码（可不填）</label><input id="pack-promo" autocomplete="off" maxlength="40" placeholder="输入促销码" value="${esc(cwInputCode)}"><p class="recharge-help" id="cw-offer-help">${cwOfferHelp()}</p></details><div id="live-form-message" role="status"></div></div><section class="recharge-payment" data-provider="${wechat?'wechat':'alipay'}" aria-label="付款方式"><div class="recharge-provider-row"><div class="recharge-provider">${wechat?wechatLogo:alipayLogo}<div><strong>${wechat?'微信支付':'支付宝'}</strong><span>已开通 · ${wechat?'本页扫码':'官方收银台付款'}</span></div></div><details class="recharge-filing"><summary><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg><span>网站已完成 ICP 备案</span></summary><div class="recharge-filing-info"><a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" aria-label="${esc(filingNumber)}，打开工信部备案查询">${esc(filingNumber)}</a><p>备案域名：${esc(filingDomain)}<br>网站主办单位：上海艾泽可科技有限公司<br>支付收款方：深圳市格洛可半导体有限公司</p></div></details></div>${btn(wechat?'核对金额，继续微信付款':'核对金额，继续支付宝付款','alipay-create','type="button"','primary recharge-submit')}<details class="recharge-instructions"><summary>付款说明</summary><ol class="recharge-steps"><li>输入实付金额，核对赠送和到账额度</li><li>${wechat?'用微信扫描付款码':'在支付宝收银台扫码或登录付款'}</li><li>付款成功后返回，额度自动到账</li></ol></details><p class="recharge-help">点击后先确认金额，再进入付款。<br>收款方：深圳市格洛可半导体有限公司</p></section></div>`;
 }
 function alipayWatch(){
  clearInterval(alipayTimer);alipayTimer=null;
  if(alipayPay?.order?.status!=='pending')return;
  let ticks=0;
  alipayTimer=setInterval(async()=>{
   if(!host?.querySelector('#alipay-pay')||++ticks>400){clearInterval(alipayTimer);alipayTimer=null;return;}
   try{await alipayPoll(false);}catch{}
  },3000);
 }
 async function alipayPoll(manual){
  const payment=alipayPay;
  if(payment?.order?.status!=='pending')return;
  const r=await fetch('/api/billing/payment-orders/'+encodeURIComponent(payment.order.id),{credentials:'same-origin',cache:'no-store'});if(!r.ok){if(manual)throw Error('暂时无法查询订单，请稍后再试。');return;}
  const o=(await r.json()).order;
  if(payment!==alipayPay||payment.order.status!=='pending')return;
  payment.order=o;
  if(o.status==='paid'){clearInterval(alipayTimer);alipayTimer=null;lastOrgBilling=null;orgLoadedAt=0;panelDataAt=0;showToast(`充值成功，到账额度 ${yuanText(o.face_fen)}。`);await route(current);return;}
  if(o.status!=='pending'||o.expired){clearInterval(alipayTimer);alipayTimer=null;if(panelRedraw)panelRedraw();return;}
  if(manual){const st=host?.querySelector('[data-alipay-status]');if(st)st.textContent='还未收到付款结果。支付完成后通常几秒内到账。';}
 }
 const refundRoute='billing/personal/refunds', billingHistoryRoute='billing/personal/history';
 let focusRefundHeading=false;
 const personalBillingRoute=view=>['billing/personal','billing/personal/usage','billing/personal/invoices',refundRoute,billingHistoryRoute].includes(view);
 const refundableAmount=pack=>BigInt(pack.refundable_fen??pack.net_fen??0);
 const canRefundPack=pack=>!pack.refund_id&&!pack.refund_request_status&&!pack.refund_blocked&&refundableAmount(pack)>0n;
 const refundableTotal=packs=>packs.reduce((total,pack)=>canRefundPack(pack)?total+refundableAmount(pack):total,0n);
 const refundChannelName=pack=>PAY_CHANNELS[pack.payment_provider]?.name||(pack.source_kind==='bank'?'对公转账':'原支付方式');
 const billingTime=value=>new Date(value).toLocaleString('zh-CN',{hourCycle:'h23',timeZone:'Asia/Shanghai'});
 const refundDate=pack=>billingTime(pack.paid_at||pack.created_at);

 function refundProgress(pack){
  const submitted=pack.refund_request_at||pack.refund_submitted_at;
  const processing=pack.refund_processing_at;
  const completed=pack.refund_completed_at;
  const succeeded=pack.refund_status==='succeeded',failed=pack.refund_status==='failed'&&pack.refund_request_status!=='requested';
  if(!submitted&&!pack.refund_status&&!pack.refund_request_status)return '';
  const waitingForFinance=pack.refund_request_status==='requested';
  const inChannel=!waitingForFinance&&(processing||pack.refund_request_status==='processing');
  const currentStep=succeeded||failed?2:inChannel?1:0;
  const steps=[
   [pack.refund_request_status==='requested'?'已提交，待财务处理':'已提交申请',submitted],
   [currentStep===1?'渠道处理中':'渠道处理',pack.refund_request_status==='requested'?null:processing],
   [failed?'退款未成功':succeeded?'已原路退回':'原路退回',failed||succeeded?completed:null]
  ];
  const stages=steps.map(([label,time],index)=>{
   const state=index<currentStep?'done':index===currentStep?(failed?'failed':'active'):'';
   return `<li class="${state}"${index===currentStep?' aria-current="step"':''}>
    <span>${label}</span>${time?`<time datetime="${esc(time)}">${billingTime(time)}</time>`:index===1&&index<currentStep?'<span>时间未记录</span>':''}
   </li>`;
  }).join('');
  return `<ol class="refund-progress" aria-label="退款进度（北京时间）">${stages}</ol>`;
 }

 function personalRefundContent(packs,compact=false){
  const total=refundableTotal(packs);
  const rows=packs.map(pack=>{
   const amount=refundableAmount(pack),available=canRefundPack(pack);
   const pending=pack.refund_status==='pending'||pack.refund_request_status==='processing';
   const requested=pack.refund_request_status==='requested';
   const refunded=Boolean(pack.refund_id)&&!pending;
   const status=pending?(pack.refund_processing_at||pack.refund_request_status==='processing'?'退款处理中':'退款已提交'):requested?'退款申请待处理':pack.refund_status==='succeeded'?'已退款':refunded?'退款已登记':pack.refund_blocked||'无可退金额';
   const amountText=pending||refunded||requested?`${status} ${yuanText(pack.refund_amount_fen??amount)}`:available?`可退 ${yuanText(amount)}`:'暂不可退';
   const details=pending||requested?'请稍后刷新进度。':refunded?'款项请在原付款账户查看。':available?(BigInt(pack.bonus_fen||0)>0n?`退款后收回赠送额度 ${yuanText(pack.bonus_fen)}`:'退款后关闭可退部分。'):esc(status);
   return `<li class="refund-order">
    <div><strong>${refundChannelName(pack)}</strong><time datetime="${esc(pack.paid_at||pack.created_at)}">${refundDate(pack)}</time><span>实付 ${yuanText(pack.cash_fen)}</span></div>
    <div><strong>${amountText}</strong><span>${details}</span></div>
    ${available?btn('查看并退款','pack-refund',`type="button" data-id="${esc(pack.id)}" aria-label="查看并退款 ${yuanText(amount)}，${refundDate(pack)}"`):''}
    ${pack.manual_only?`<p class="refund-policy-note">不可自助退 ${yuanText(pack.non_refundable_fen)}：${(pack.refund_restrictions||[]).map(x=>esc(x.label)).join('、')}。仍可消费。<a href="#support">提交工单</a></p>`:''}
    ${refundProgress(pack)}
   </li>`;
  }).join('');
  return `<section class="billing-refunds" aria-labelledby="refund-heading">
   <div class="refund-heading">
    <div><h2 id="refund-heading" class="panel-title" tabindex="-1">申请退款</h2><p>选择一笔充值，仅退回符合条件的未消费实付款，无手续费。激活款、已开票及约定不可退部分请提交工单。退款进度按北京时间显示。</p></div>
    <div class="refund-total"><span>${compact?'本笔可自助退款':packs.length>=100?'所列订单可自助退款':'当前可自助退款'}</span><strong>${yuanText(total)}</strong></div>
   </div>
   <div class="refund-list-heading"><h3>充值订单</h3><button type="button" class="live-button quiet" data-live="refund-refresh">刷新进度</button></div>
   ${rows?`<ul class="refund-orders">${rows}</ul>`:'<p class="refund-empty">还没有充值订单。</p>'}
  </section>`;
 }

 // Personal billing keeps money paid, spendable credit and settled usage distinct.
 let billingView='recharge',billingRecordPage=0,billingInvoicePage=0,billingAmountDraft='100.00';
 const billingRoutesByView={recharge:'billing/personal',usage:'billing/personal/usage',history:billingHistoryRoute,refund:refundRoute,invoice:'billing/personal/invoices'};
 const billingQuotaMoney=value=>{
  const [whole='0',fraction='']=String(value??0).split('.'),cents=BigInt(whole),negative=cents<0n,abs=negative?-cents:cents;
  const tail=(String(abs%100n).padStart(2,'0')+fraction).slice(0,6).replace(/0+$/,'').padEnd(2,'0');
  if(abs===0n&&fraction.replace(/0/g,'')&&tail==='00')return '< ¥0.000001';
  return `${negative?'-':''}¥${abs/100n}.${tail}`;
 };
 const billingPager=(page,more,action='billing-record-page')=>page||more?`<nav class="pu-pages" aria-label="账单分页"><button type="button" data-live="${action}" data-page="${page-1}" aria-label="上一页" ${page===0?'disabled':''}>${ico('chevron-left')}</button><span>第 ${page+1} 页</span><button type="button" data-live="${action}" data-page="${page+1}" aria-label="下一页" ${more?'':'disabled'}>${ico('chevron-right')}</button></nav>`:'';
 function personalBalanceBar(data,{overview=false}={}){
  const split=data.credit_split;
  const paid=BigInt(split?.red_fen??data.cash_balance_fen??'0'),balance=wholeFen(data.list_credit_exact_fen??data.list_credit_fen??'0');
  const gift=split?BigInt(split.green_fen||'0'):(balance>paid?balance-paid:0n),total=paid+gift;
  const max=split?BigInt(split.max_face_fen||split.face_fen||'0'):total,scale=max>total?max:total;
  const width=v=>scale>0n?Number(v*10000n/scale)/100:0;
  const refund=split?.refundable_fen;
  return `<div class="pb-credit${overview?' ph-credit':''}"><div class="pb-credit-track" role="img" aria-label="实付剩余 ${personalMoney(String(paid))}，赠送剩余 ${personalMoney(String(gift))}"><span class="pb-credit-gift" style="width:${width(gift)}%"></span><span class="pb-credit-paid" style="width:${width(paid)}%"></span></div><div class="pb-credit-legend"><span><i class="pb-credit-paid"></i>实付 ${personalMoney(String(paid))}</span><span><i class="pb-credit-gift"></i>赠送 ${personalMoney(String(gift))}</span>${overview?`<span class="ph-credit-spent">累计消费 ${personalMoney(data.total_spent_fen)}</span>`:`<a href="#${refundRoute}">${refund==null?'查看可退金额':'当前可退 '+personalMoney(refund)} ${ico('arrow-right')}</a>`}</div></div>`;
 }
 function personalRechargeCompact(data){
  const channels=(data.recharge?.channels||[]).filter(c=>PAY_CHANNELS[c]);
  if(!channels.length)return `<div class="pb-empty"><p>当前账户暂未开放在线充值。</p><a href="#support">联系支持 ${ico('arrow-up-right')}</a></div>`;
  if(!channels.includes(payChannel))payChannel=channels[0];
  const o=alipayPay?.scope==='personal'?alipayPay.order:null;
  const intent=readModelIntent(),next=intent?.scope==='personal'?'#personal/connect/'+esc(intent.id):'#personal/keys';
  if(o?.status==='pending'&&!o.expired&&(o.qr_svg||o.pay_url))return alipayPanel('personal',channels);
  if(o?.status==='paid')return `<div class="pb-paid"><h2>${ico('check')} 充值成功</h2>${rechargeBreakdown(o)}<p>额度已到账，可继续配置模型和 Key。</p><div><a class="live-button primary" href="${next}">继续接入</a>${btn('继续充值','alipay-reset')}</div></div>`;
  return `<div class="pb-checkout"><div class="pb-amount-entry"><label for="alipay-yuan">充值金额（元）</label><div class="recharge-amount"><span aria-hidden="true">¥</span><input id="alipay-yuan" inputmode="decimal" autocomplete="off" maxlength="8" aria-describedby="pb-amount-help" value="${esc(billingAmountDraft)}"></div><div class="alipay-presets recharge-presets" aria-label="常用充值金额">${[5000,10000,50000,100000].map(f=>`<button type="button" aria-pressed="${Number(billingAmountDraft)*100===f}" class="alipay-preset ${Number(billingAmountDraft)*100===f?'active':''}" data-live="alipay-amount" data-fen="${f}">¥${f/100}</button>`).join('')}</div><p id="pb-amount-help" class="pb-muted">实付 ¥5–¥50,000，下一步核对到账额度。</p><label class="pb-promo" for="pack-promo">促销码 <span>选填</span><input id="pack-promo" autocomplete="off" maxlength="40" placeholder="有促销码可在此填写" value="${esc(cwInputCode)}"></label></div><div class="pb-pay-action"><span id="pb-channel-label">付款方式</span><div class="pb-payment-methods" role="group" aria-labelledby="pb-channel-label">${channels.map(c=>`<button type="button" class="pb-payment-method" data-live="pay-channel" data-channel="${c}" aria-label="${PAY_CHANNELS[c].name}" aria-pressed="${payChannel===c}">${c==='wechat_native'?'<img class="pb-wechat-logo" src="/assets/payments/wechat-pay.svg" alt="微信支付">':'<img class="pb-alipay-logo" src="/assets/payments/alipay.ico" alt="">支付宝'}<span class="pb-payment-check" aria-hidden="true">${payChannel===c?ico('check'):''}</span></button>`).join('')}</div><p class="pb-muted">实付金额 + 赠送额度 = 到账额度</p>${btn('核对金额，继续付款','alipay-create','type="button"','primary')}<p class="pb-payee">收款方：深圳市格洛可半导体有限公司</p><div id="live-form-message" role="status"></div></div></div>`;
 }
 async function personalBillingPage(ticket,data){
  billingView=Object.keys(billingRoutesByView).find(k=>billingRoutesByView[k]===current)||'recharge';
  const billingRecordCache={};billingRecordPage=0;billingInvoicePage=0;
  let invoiceData=null,invoiceLoading=false;
  const valid=()=>ticket===generation&&panelRedraw===draw;
  const draw=()=>{
   const sub=['refund','invoice','invoice-history'].includes(billingView),kind=billingView==='history'?'recharge':billingView,cacheKey=kind+':'+billingRecordPage;
   let records=billingRecordCache[cacheKey];
   if(['usage','recharge','refund'].includes(kind)&&billingView!=='recharge'&&!records){
    records=billingRecordCache[cacheKey]={loading:true};
    api(`/api/billing/personal/records?kind=${kind}&page=${billingRecordPage}`).then(r=>{billingRecordCache[cacheKey]=r;if(kind==='refund'&&valid())for(const p of r.items){data.packs=[...(data.packs||[]).filter(x=>x.id!==p.id),p];}},error=>{billingRecordCache[cacheKey]={failed:error.message};}).finally(()=>{if(valid())draw();});
   }
   if(billingView.startsWith('invoice')&&!invoiceData&&!invoiceLoading){invoiceLoading=true;api('/api/billing/personal/invoices').then(r=>{invoiceData=r;},error=>{invoiceData={failed:error.message};}).finally(()=>{invoiceLoading=false;if(valid())draw();});}
   let body='',foot='';
   if(billingView==='recharge')body=personalRechargeCompact(data);
   else if(billingView.startsWith('invoice')){
    if(!invoiceData)body='<p class="pb-empty" role="status">正在读取发票…</p>';
    else if(invoiceData.failed)body=`<div class="pb-empty" role="alert"><p>${esc(invoiceData.failed)}</p>${btn('重新读取','billing-retry')}</div>`;
    else if(billingView==='invoice-history'){
     const rows=(invoiceData.items||[]).slice(billingInvoicePage*2,billingInvoicePage*2+2),states={requested:'待开票',issued:'已开具',rejected:'已退回',voided:'已作废',reversed:'已红冲'};
     body=`<div class="pb-subhead"><h2>开票记录</h2>${btn('申请发票','billing-subview','data-billing-view="invoice"','quiet')}</div>${rows.length?`<ul class="pb-invoices">${rows.map(r=>`<li><div><strong>${esc(r.title)}</strong><small>${billingTime(r.created_at)}</small></div><div><b>${personalMoney(r.amount_fen)}</b><small>${esc(states[r.status]||r.status)}${r.invoice_number?' · '+esc(r.invoice_number):''}</small></div>${r.note?`<p>${esc(r.note)}</p>`:''}</li>`).join('')}</ul>`:'<p class="pb-empty">还没有开票申请。</p>'}`;
     foot=`<span>显示最近 50 条申请</span>${billingPager(billingInvoicePage,(invoiceData.items||[]).length>(billingInvoicePage+1)*2,'billing-invoice-page')}`;
    }else{
     body=`<div class="pb-subhead"><h2>申请发票</h2>${btn('开票记录','billing-subview','data-billing-view="invoice-history"','quiet')}</div><p class="pb-muted">可开票 ${personalMoney(invoiceData.available_fen)} · 按实付金额开票，付款后 30 天内可申请。</p><form id="live-invoice" class="live-form pb-invoice-form" data-path="/api/billing/personal/invoices"><input type="hidden" name="invoice_type" value="general"><label>发票抬头<input name="title" required maxlength="160" autocomplete="off"></label><label>税号（个人抬头可不填）<input name="tax_number" maxlength="20" autocomplete="off"></label><label>开票金额（元）<input name="amount_yuan" required inputmode="decimal" placeholder="0.00"></label><label>收票邮箱<input name="email" type="email" required maxlength="254" value="${esc(me.user.email||'')}"></label><div class="pb-invoice-submit"><p class="pb-muted">电子普通发票发送至邮箱。已申请或已开票部分不可自助退款。</p><div id="live-form-message" role="status"></div><button class="live-button primary" type="submit" ${BigInt(invoiceData.available_fen||0)>0n?'':'disabled'}>提交开票申请</button></div></form>`;
    }
   }else if(records?.loading)body='<p class="pb-empty" role="status">正在读取账单…</p>';
   else if(records?.failed)body=`<div class="pb-empty" role="alert"><p>账单读取失败，请重试。</p>${btn('重新读取','billing-retry')}</div>`;
   else if(billingView==='refund'){
    body=personalRefundContent(records?.items||[],true);
    foot=`<span>每页一笔充值，退款前可核对明细。</span>${billingPager(billingRecordPage,records?.has_more)}`;
   }else{
    const usage=billingView==='usage',rows=records?.items||[];
    const cell=(label,value)=>`<td data-label="${label}">${value}</td>`;
    body=rows.length?`<table class="pb-table${usage?' pb-usage-table':''}" data-nosort><thead><tr><th>${usage?'模型 / Key':'充值时间 / 方式'}</th><th>${usage?'扣减额度':'实付金额'}</th><th>${usage?'实付费用':'赠送额度'}</th>${usage?'':'<th>到账额度</th>'}</tr></thead><tbody>${rows.map(r=>`<tr>${cell(usage?'模型 / Key':'充值时间 / 方式',usage?`<strong>${esc(r.model_name)}</strong><small title="${esc(r.key_label)} · ${esc(r.key_hint)}">${esc(r.key_label)} · ${esc(r.key_hint)}</small><time>${billingTime(r.created_at)}</time>`:`<strong>${billingTime(r.paid_at||r.created_at)}</strong><small>${esc(refundChannelName(r))}${r.refund_status==='succeeded'?' · 已退款':r.refund_id?' · 退款处理中':''}</small>`)}${usage?[['扣减额度',r.quota_fen],['实付费用',r.cash_fen]].map(([label,value])=>cell(label,esc(billingQuotaMoney(value)))).join(''):[['实付金额',r.cash_fen],['赠送额度',String(BigInt(r.face_fen)-BigInt(r.cash_fen))],['到账额度',r.face_fen]].map(([label,value])=>cell(label,personalMoney(value))).join('')}</tr>`).join('')}</tbody></table>`:`<div class="pb-empty"><h2>${usage?'还没有消费记录':'还没有充值记录'}</h2><p>${usage?'模型调用结算后，扣减额度与实付费用会显示在这里。':'完成充值后，可在这里核对每笔到账金额。'}</p></div>`;
    foot=`<span>${usage?'实付费用按分累计结算，赠送不计费。仅列已结算消费。':'记录充值时到账额度；当前剩余额度见上方余额。'} 时间为北京时间。</span>${billingPager(billingRecordPage,records?.has_more)}`;
   }
   const balance=data.list_credit_exact_fen??data.list_credit_fen??data.cash_balance_fen??'0';
   const header=`<header class="pb-heading"><h1>充值与账单</h1><nav aria-label="账单服务">${sub?'<a href="#billing/personal">'+ico('arrow-left')+' 返回充值</a>':'<a href="#'+refundRoute+'">退款</a><a href="#billing/personal/invoices">发票</a>'}</nav></header>`;
   const activeOrder=billingView==='recharge'&&alipayPay?.scope==='personal'&&['pending','paid'].includes(alipayPay.order?.status)&&!alipayPay.order?.expired;
   const summary=sub||activeOrder?'':`<div class="pb-balance"><div><span>额度余额</span><strong>${personalMoney(balance)}</strong></div></div>${personalBalanceBar(data)}${billingView==='recharge'?'<p class="pb-explainer">先用实付，再用赠送；退款退可退实付，收回对应赠送。</p>':'<div class="pb-balance-gap"></div>'}<nav class="pu-tabs pb-tabs" aria-label="充值与账单">${[['recharge','充值'],['usage','消费账单'],['history','充值记录']].map(([key,label])=>`<a href="#${billingRoutesByView[key]}" ${billingView===key?'aria-current="page"':''}>${label}</a>`).join('')}</nav>`;
   mount(panelPage(null,'billing',panelBody(`<section class="personal-api personal-billing${sub?' pb-detail':''}">${header}${summary}<div class="pb-content">${body}</div>${foot?`<footer class="pb-foot">${foot}</footer>`:''}</section>`)));
   if(billingView==='refund'&&focusRefundHeading){host.querySelector('#refund-heading')?.focus();focusRefundHeading=false;}
   if(billingView==='recharge'&&alipayPay?.scope==='personal'&&!alipayTimer)alipayWatch();
  };
  panelRedraw=draw;draw();
 }

 async function billingPage(ticket,earlyBilling){
  const money=value=>{const cents=BigInt(value||0),negative=cents<0n,absolute=negative?-cents:cents;return `${negative?'-':''}¥${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;};
  const orgId=current.startsWith('billing/organization/')?current.slice('billing/organization/'.length):null;
  if(orgId){if(lastOrg?.organization?.id!==orgId)lastOrg=await api('/api/platform/organizations/'+encodeURIComponent(orgId));if(ticket!==generation)return;if(!lastOrg.permissions.manager){location.replace('#organization/'+orgId+'/overview');return;}}
  const prefetched=earlyBilling?await earlyBilling:null;if(prefetched?.error)throw prefetched.error;
  const cachedBilling=orgId&&lastOrgBilling?.id===orgId&&Date.now()-lastOrgBilling.at<orgFreshMs?lastOrgBilling.data:null;
  const data=prefetched?prefetched.data:cachedBilling||await api(orgId?'/api/billing/organizations/'+encodeURIComponent(orgId):'/api/billing/personal');if(ticket!==generation)return;
  if(!orgId&&current===refundRoute)pageViews.billing='refund';
  else if(!orgId&&current===billingHistoryRoute)pageViews.billing='history';
  else if(!orgId&&['refund','history'].includes(pageViews.billing))pageViews.billing='recharge';
  if(orgId&&!cachedBilling)lastOrgBilling={id:orgId,data,at:Date.now()};
  const org=orgId?lastOrg.organization:null;panelOrg=org?lastOrg:null;if(!orgId){personalBilling=data;return personalBillingPage(ticket,data);}
  // Invoice requests load on first visit to the tab; submitting re-runs this page, which fetches them again.
  const invoicePath=(orgId?'/api/billing/organizations/'+encodeURIComponent(orgId):'/api/billing/personal')+'/invoices',invoiceStates={requested:'待开票',issued:'已开具',rejected:'已退回',voided:'已作废',reversed:'已红冲'};let invoiceData=null,invoiceLoading=false;
  const draw=()=>{
   const name=org?org.name:'个人',bank=data.bank_transfer,views=[['recharge','充值'],...(org?[['transfer','对公转账']]:[]),['history',`资金记录 · ${data.entries.length}`],...(!org?[['refund','退款']]:[]),['invoice','发票']],view=pageView('billing',views);
   if(view==='invoice'&&!invoiceData&&!invoiceLoading){invoiceLoading=true;api(invoicePath).then(value=>{invoiceData=value;},error=>{invoiceData={failed:error.message,items:[],available_fen:'0'};}).finally(()=>{invoiceLoading=false;if(ticket===generation&&panelRedraw===draw)draw();});}
   const refundNote=data.refund?.policy||'退款只退红色实付剩余、不收手续费；绿色赠送额度整条收回并关闭额度包。用量永远先扣红色实付，扣完才扣绿色。实付长期有效，赠送额度半年内有效、过期作废。已申请或已开具发票的部分不可自助退款，需先处理发票；对公转账走人工。';
   const invoiceNote=data.invoice?.policy||'充值即可按实付价格开票，已开票部分不可自助退款；未开票部分按退款约定处理，已用的实付仍可开票；付款后 30 天内均可申请。';
   const invoice=!invoiceData?panelLoading:invoiceData.failed?note(invoiceData.failed,true):`<div class="billing-pay-head"><div><h2 class="panel-title">申请发票</h2><p class="live-small">可开票金额 ${money(invoiceData.available_fen)}，按<strong>实际付款</strong>扣除退款和已申请/已开具发票计算（不是官价额度）。充值即可开票，已开票部分不可自助退款；付款后 30 天内均可申请。财务开具后发到收票邮箱。</p><p class="live-small">${esc(invoiceNote)}</p><p class="live-small">${esc(refundNote)}</p></div><span class="billing-chip">电子发票</span></div><form id="live-invoice" class="live-form panel-form" data-path="${esc(invoicePath)}"><label>发票类型<select name="invoice_type"><option value="general">增值税普通发票</option>${org?'<option value="special">增值税专用发票</option>':''}</select></label><label>发票抬头<input name="title" required maxlength="160" value="${org?esc(name):''}"></label><label>纳税人识别号${org?'':'（个人抬头可不填）'}<input name="tax_number" maxlength="20" ${org?'required':''}></label><label>开票金额（元）<input name="amount_yuan" required inputmode="decimal" placeholder="0.00"></label><label>收票邮箱<input name="email" type="email" required maxlength="254" value="${esc(me.user.email)}"></label><label>备注<input name="note" maxlength="500"></label><div id="live-form-message" role="status"></div><button class="live-button primary" type="submit" ${BigInt(invoiceData.available_fen)>0n?'':'disabled'}>提交开票申请</button></form>${invoiceData.items.length?`<div class="personal-table-wrap" style="margin-top:18px"><table><thead><tr><th>申请时间</th><th>抬头</th><th>金额</th><th>状态</th><th>发票号码</th></tr></thead><tbody>${invoiceData.items.map(item=>`<tr><td>${new Date(item.created_at).toLocaleString('zh-CN')}</td><td>${esc(item.title)}</td><td>${money(item.amount_fen)}</td><td>${invoiceStates[item.status]||esc(item.status)}${item.status==='rejected'&&item.note?' · '+esc(item.note):''}</td><td>${item.invoice_number?esc(item.invoice_number)+' · '+esc(item.issued_day):'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="personal-model-empty">还没有开票申请。</p>'}`;
   const cell=(cls,icon,label,value)=>`<div class="${cls}">${ico(icon)}<span>${label}</span><strong>${value}</strong></div>`;
   const stats=`<div class="personal-console-stats">${cell('pc-stat-balance','server','官价额度',money(data.list_credit_fen??data.cash_balance_fen))}${cell('pc-stat-spent','receipt-text','累计已用',((data.usage_by_model||[]).some(x=>Number(x.charged_yuan)>0)&&BigInt(data.total_spent_fen||0)===0n?'不足 ¥0.01':money(data.total_spent_fen)))}${cell('pc-stat-calls','chart-no-axes-combined','累计实付',money(data.total_recharged_fen))}${cell('pc-stat-budget','building-2','资金账户',org?esc(name):'个人账户')}<span></span></div><details class="billing-policy"><summary>额度、发票与退款说明</summary><p>面板展示官价额度（按官网价可消费）。发票按实付金额申请。${esc(refundNote)}</p></details>`;
   const transferStates={submitted:'待核对到账',registered:'待财务复核',approved:'已入账',rejected:'已退回'};
   const transfer=`<div class="billing-pay-head"><div><h2 class="panel-title">对公转账</h2><p class="live-small">企业付款 → 提交转账信息 → 财务核对后入账。</p></div><button class="live-button" data-live="bank-refresh">刷新进度</button></div>${bank?.enabled?`<div class="billing-bank-fields"><div><span>收款户名</span><strong>${esc(bank.account_name)}</strong></div><div><span>开户银行及支行</span><strong>${esc(bank.bank_name)}</strong></div><div><span>银行账号</span><strong class="billing-bank-number">${esc(bank.account_number)}</strong><button class="live-button" data-live="copy-text" data-text="${esc(bank.account_number)}">复制账号</button></div></div><p class="billing-transfer-note">请使用企业账户付款，备注「${esc(name)}」及登录邮箱。保留银行回单；以财务核实的到账金额为准。</p><details class="billing-transfer-submit"><summary>我已转账，提交信息</summary><form id="live-bank-transfer" class="live-form panel-form" data-path="/api/billing/organizations/${esc(orgId)}/bank-transfers" data-key="${crypto.randomUUID()}"><label>付款户名<input name="payer_name" required maxlength="160" value="${esc(name)}" placeholder="与银行回单上的付款户名一致"></label><label>转账金额（元）<input name="cash_yuan" required inputmode="decimal" placeholder="0.00"></label><label>转账日期<input name="paid_on" type="date" required max="${new Date(Date.now()+8*3600000).toISOString().slice(0,10)}"></label><label>付款流水号<input name="payer_reference" required maxlength="120" placeholder="银行电子回单上的交易流水号"></label><label>备注（可选）<input name="note" maxlength="500" placeholder="如合同编号、付款说明"></label><p class="live-small">提交信息不代表到账，财务核对通过后才增加企业余额。</p><div id="live-form-message" role="status"></div><button class="live-button primary" type="submit">提交转账信息</button></form></details>`:'<p class="billing-transfer-pending">收款账户尚未核实，请暂勿转账。</p>'}<h3 class="billing-transfer-history">转账处理进度</h3>${bank?.notices?.length?`<div class="personal-table-wrap"><table><thead><tr><th>转账日期 / 付款户名</th><th>提交金额</th><th>付款流水号</th><th>处理进度</th></tr></thead><tbody>${bank.notices.map(n=>`<tr><td>${esc(n.paid_day)}<br>${esc(n.payer_name)}</td><td>${money(n.cash_fen)}</td><td>${esc(n.payer_reference)}</td><td>${esc(transferStates[n.status]||n.status)}${n.status==='approved'?`<br>实付 ${money(n.credited_cash_fen)} · 官价额度 ${money(n.credited_face_fen)}`:''}${n.review_note?'<br>'+esc(n.review_note):''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="personal-model-empty">还没有转账信息。付款后可在上方提交，入账后也会显示在「资金记录」中。</p>'}`;
   const channels=(data.recharge?.channels||[]).filter(c=>PAY_CHANNELS[c]),alipayOn=channels.length>0,scopeKey=org?'org:'+org.id:'personal';
   if(alipayOn&&!channels.includes(payChannel))payChannel=channels[0];
   const channelStatus=data.recharge?.channel_status||{};
   const unavailableMethods=Object.entries(PAY_CHANNELS).filter(([key])=>!channels.includes(key)).map(([key,ch])=>`${ch.name}：${channelStatus[key]==='restricted'?'当前账户暂未开放':'暂未开放'}`).join(' · ');
   const limited=Object.values(channelStatus).includes('restricted');
   const recent=(data.packs||[]).find(p=>p.source_kind==='payment'&&p.paid_at);
   const activePayment=alipayPay?.scope===scopeKey&&alipayPay.order;
   const lastReceipt=!activePayment&&recent?`<section class="recharge-receipt" aria-label="最近一笔充值">
    <p><strong>最近一笔充值</strong> <time datetime="${esc(recent.paid_at)}">${billingTime(recent.paid_at)}（北京时间）</time></p>
    ${rechargeBreakdown(recent)}
   </section>`:'';
   const recharge=`<section class="recharge-checkout${org?'':' personal-recharge-flow'}"><div class="billing-pay-head"><div><h2 class="panel-title">充值到${org?esc(name):'个人'}账户</h2><p class="recharge-help">${alipayOn?'付款前可核对实付金额、赠送额度和到账额度。':limited?'在线支付已接入，当前账户暂未开放充值。':'当前暂无可用的在线支付方式。'}</p></div></div>${!org?personalRechargeNext(data):''}${alipayOn?alipayPanel(scopeKey,channels):`<p class="billing-pay-status" role="status">如需充值，请通过<a href="${org?'#organization/'+esc(org.id)+'/support':'#support'}">支持与工单</a>联系平台。</p>`}${unavailableMethods?`<p class="recharge-unavailable">${unavailableMethods}</p>`:''}${lastReceipt}</section>`;
   const packs=`<div class="personal-table-wrap"><table><thead><tr><th>充值时间</th><th>实付</th><th>赠送额度</th><th>到账额度</th><th>赠送余额</th><th>实付剩余</th></tr></thead><tbody>${(data.packs||[]).map(p=>`<tr><td>${refundDate(p)}</td>${rechargeAmounts(p).map(([,value])=>`<td>${value}</td>`).join('')}<td>${money(p.refund_id?'0':p.bonus_fen)}</td><td>${money(p.refund_id?'0':p.red_fen??p.net_fen)}</td></tr>`).join('')}</tbody></table></div>`;
   const history=data.entries.length?`<div class="personal-table-wrap"><table><thead><tr><th>时间</th><th>事项</th><th>金额</th><th>结余</th></tr></thead><tbody>${data.entries.map(entry=>`<tr><td>${new Date(entry.created_at).toLocaleString('zh-CN')}</td><td>${entry.reference_id?.startsWith('refund-fee:')?'退款手续费':({recharge:'购包实付',usage:'模型使用',refund:'退款',reversal:'冲正'}[entry.kind]||'资金变动')}</td><td>${BigInt(entry.amount_fen)>0n?'+':''}${money(entry.amount_fen)}</td><td>${money(entry.balance_after_fen)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="personal-model-empty">还没有真实资金记录。完成首次充值后，每笔付款和使用会列在这里。</p>';
   const records=`<div class="billing-records">${(data.packs||[]).length?`<section><div class="refund-list-heading"><h2>充值记录</h2>${org?'':'<a href="#'+refundRoute+'">办理退款 →</a>'}</div>${packs}</section>`:''}<section><h2>资金流水</h2>${history}</section></div>`;
   const content={history:records,refund:view==='refund'?personalRefundContent(data.packs||[]):'',transfer,invoice,recharge};
   mount(panelPage(org,'billing',(view==='refund'?'':stats)+panelBody(tabbedPage('billing',views,content[view]))));
   if(view==='refund'&&focusRefundHeading){host.querySelector('#refund-heading')?.focus();focusRefundHeading=false;}
   if(alipayOn&&view==='recharge'&&alipayPay?.scope===scopeKey&&!alipayTimer)alipayWatch();
  };
  panelRedraw=draw;draw();
 }
 const spaceKey='semifly.workspace.v1';
 // 登录后的唯一落点：优先上次选择的空间，否则进入所属企业，没有企业才是个人空间。
 function personalRedirect(view){
  if(view==='upgrade'&&me.organizations?.length)return workspaceTarget('workspace');
  if(personalVisible())return '';
  const home=workspaceTarget('workspace'),manager=me.organizations.find(o=>home==='organization/'+o.id)?.is_manager;
  if(personalBillingRoute(view))return manager?'billing/'+home:home;
  if(view.startsWith('personal/connect/'))return home+'/models';
  return {personal:home,'personal/models':home+'/models','personal/keys':home+'/keys','personal/usage':home+'/usage','personal/compare':home+'/compare',support:home+'/support',security:home+'/settings'}[view]||'';
 }
 function workspaceTarget(view){
  const orgs=me.organizations||[];if(view!=='enterprise'&&personalVisible()&&readModelIntent()?.scope==='personal')return 'personal/connect/'+readModelIntent().id;if(view==='enterprise'&&!orgs.length)return 'upgrade';
  let saved='';try{saved=localStorage.getItem(spaceKey)||'';}catch{}
  if(view!=='enterprise'&&saved==='personal'&&personalVisible())return 'personal';
  const org=orgs.find(o=>saved==='organization/'+o.id)||orgs[0];return org?'organization/'+org.id:'personal';
 }
 async function route(view){
  focusRefundHeading=view===refundRoute&&current!==refundRoute;
  if(personalConnectIssued&&view!=='personal/connect/'+personalConnectIssued.modelId)personalConnectIssued=null;
  const previous=current,wasIdentityActive=document.body.classList.contains('identity-active');current=view;if(view==='security'&&previous!=='security')personalSettingsView='overview';authMode=['register','enterprise-register'].includes(view)?'register':'login';publicTicket++;const ticket=++generation;if(Date.now()-panelDataAt>60000){panelData={tickets:null,sessions:null};panelDataAt=Date.now();}panelRedraw=null;
  if(!host){host=document.createElement('div');host.id='identity-view';host.hidden=true;document.body.append(host);}
  document.body.classList.add('identity-route-pending');
  resetScrollOnMount=(!wasIdentityActive||previous!==view)&&!(previous.startsWith('ops/')&&view.startsWith('ops/'))&&!(previous.startsWith('organization/')&&view.startsWith('organization/')&&previous.split('/')[1]===view.split('/')[1]);
  if(wasIdentityActive&&staff&&previous.startsWith('ops/')&&!host.classList.contains('route-loading')){const oldShell=host.querySelector('.supply-shell');if(oldShell)opsPageCache.set(previous,oldShell.outerHTML);}
  const [,orgId,section]=view.match(/^organization\/([^/]+)\/?([^/]*)$/)||[];
  if(wasIdentityActive&&me?.user&&previous!==view&&(previous===`organization/${orgId}`||previous.startsWith(`organization/${orgId}/`))&&lastOrg?.organization?.id===orgId&&orgSections.includes(section)){
   orgTab=orgSection(section);organizationV2(lastOrg);
   if(Date.now()-orgLoadedAt<orgFreshMs)return;
   try{const updated=await api('/api/platform/organizations/'+encodeURIComponent(orgId));if(ticket===generation&&current===view&&JSON.stringify(updated)!==JSON.stringify(lastOrg))organizationV2(updated);if(ticket===generation&&current===view)refreshOrganizationBilling(orgId,ticket);}
   catch(e){if(ticket===generation){if(e.status===401){me=null;lastOrg=null;lastOrgBilling=null;authForm();}else if(e.status===403||e.status===404){lastOrg=null;lastOrgBilling=null;mount(hero('YOUR WORKSPACE','暂时无法打开这个空间。','请核对账号及企业权限。')+note(e.message,true)+'<a class="live-button" href="#workspace">返回工作台</a>');}}}
   return;
  }
  const staffView=view==='staff-account'||view==='admin'||view.startsWith('ops/');if(!host.innerHTML.trim())host.innerHTML=header()+'<main class="live-loading" role="status">正在打开你的工作空间…</main>'+window.SiteHeader.footer();
  // Coming from another view (console, landing): show this frame at once with a loading bar, instead of leaving the old page visible until data arrives.
  if(!wasIdentityActive){document.querySelectorAll('#market-view,#login-view').forEach(el=>el.hidden=true);window.LandingUI?.hide();window.UniverseScene?.setActive(false);document.body.classList.remove('market-active','welcome-active','universe-active','catalog-active');document.body.classList.add('identity-active');host.hidden=false;host.classList.add('route-loading');}
  if(wasIdentityActive&&staff&&view.startsWith('ops/')){
   const cached=opsPageCache.get(view);
   if(cached)mount(cached);
   else{const target=view.startsWith('ops/supply/')?'ops/supply':view;host.querySelectorAll('.supply-side a').forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#'+target));}
   host.classList.add('route-loading');
  }
  if(view==='enterprise-login'){location.replace('#workspace');return;}
  if(view==='enterprise-register'){location.replace('#register');return;}
  const earlyBilling=!me?.user&&(['personal','account'].includes(view)||personalBillingRoute(view))?api('/api/billing/personal').then(data=>({data}),error=>({error})):null;
  try{
   if(view==='reset-password'){me=null;staff=null;mount(hero('A FRESH START','重新出发，从这里开始。','重设密码后，其他登录会话会被撤销。')+`<section class="live-panel live-padding live-reset"><form id="live-reset-form" class="live-form">${passwordField('newPassword','新密码',true)}<div id="live-form-message" role="status">${resetToken?'':'没有有效的重设链接，请重新申请。'}</div><button class="live-button primary" ${resetToken?'':'disabled'} type="submit">保存新密码</button></form><a href="#workspace" class="live-button quiet">返回登录</a></section>`);return;}
   if(view==='staff'||view.startsWith('staff?')){me=null;staff=null;staffLogin();return;}
   if(view==='ops/verification'){location.hash='ops/supply';return;}
   if(view==='ops/models'){location.hash='ops/products';return;}
   if(view==='ops/supply'){try{await supplierLandingPage(ticket);}catch(e){if(ticket!==generation)return;if(e.status===401){staff=null;staffLogin();}else mount(hero('SUPPLY OPERATIONS','暂时无法打开供应管理台。','请检查员工岗位权限。')+note(e.message,true));}return;}
   if(view==='ops/products'){try{await productLandingPage(ticket);}catch(e){if(ticket!==generation)return;if(e.status===401){staff=null;staffLogin();}else mount(hero('MODEL PRODUCT DESIGN','暂时无法打开模型商品进度。','请检查员工岗位权限。')+note(e.message,true));}return;}
   if(view==='ops/payments'){try{await paymentPage(ticket);}catch(e){if(ticket!==generation)return;if(e.status===401){staff=null;staffLogin();}else mount(hero('PAYMENT READINESS','暂时无法打开付费准备。','请检查员工岗位权限。')+note(e.message,true));}return;}
   if(/^ops\/supply\/[^/]+$/.test(view)){try{await supplierPage(ticket);}catch(e){if(ticket!==generation)return;if(e.status===401){staff=null;staffLogin();}else mount(hero('SUPPLY OPERATIONS','暂时无法打开供应商详情。','请检查员工岗位权限。')+note(e.message,true));}return;}
   if(view==='ops/promotions'){try{await promotionPage(ticket);}catch(e){if(ticket!==generation)return;if(e.status===401){staff=null;staffLogin();}else mount(hero('PROMOTION DESIGN','暂时无法打开活动草稿。','请检查员工岗位权限。')+note(e.message,true));}return;}
   if(view==='staff-account'||view==='admin'||view.startsWith('ops/')){try{await staffAccount(ticket);}catch(e){if(ticket!==generation)return;me=null;staff=null;staffLogin();host.querySelector('.live-staff-entry').insertAdjacentHTML('afterbegin',note(e.message,e.status!==401));}return;}
   if(view.startsWith('join/')){staff=null;const apply=view.endsWith('/apply'),joinToken=view.slice(5,apply?-6:undefined);joinPreview=await api('/api/platform/join-links/preview?token='+encodeURIComponent(joinToken));try{me=await api('/api/platform/me');}catch(e){if(e.status!==401)throw e;me=null;authMode=apply?'login':'register';}if(ticket!==generation)return;if(apply&&me?.user){await api('/api/platform/join-requests',{token:joinToken});if(ticket!==generation)return;current='join/'+joinToken;mount(hero('JOIN REQUEST','入企申请已提交，等待企业管理者审批。','获批前没有企业预算、模型权限或 API Key。')+'<a class="live-button" href="#workspace">返回个人空间</a>');history.replaceState(null,'',location.pathname+'#'+current);return;}joinPage();return;}
   const methods=loadAuthMethods();staff=null;if(!me?.user)me=await api('/api/platform/me').catch(async error=>{await methods;throw error;});
   if(view==='security'||view.endsWith('/settings'))await methods;if(ticket!==generation)return;
   if(['workspace','account','register','enterprise'].includes(view)){
    const query=new URLSearchParams(cwAuthQuery());
    if(query.has('cw_join')){
     const vipParams=new URLSearchParams(),referrer=query.get('cw_join'),inviteCode=query.get('invite_code');
     if(referrer!=='1')vipParams.set('invite',referrer);
     if(inviteCode)vipParams.set('invite_code',inviteCode);
     location.replace('/promotion/vip.html'+(vipParams.size?'?'+vipParams:''));
     return;
    }
    location.replace('#'+(query.has('cw')?'billing/personal':workspaceTarget(view)));
    return;
   }
   const personalTarget=personalRedirect(view);if(personalTarget){location.replace('#'+personalTarget);return;}
   if(personalBillingRoute(view)||view.startsWith('billing/organization/'))await billingPage(ticket,earlyBilling);
   else if(view==='demo/personal'||view.startsWith('demo/organization/'))await demoPage(ticket);
   else if(view.startsWith('organization/')){const [orgId,section]=view.slice(13).split('/');if(lastOrg?.organization?.id===orgId&&Date.now()-orgLoadedAt<orgFreshMs){orgTab=orgSection(section);organizationV2(lastOrg);warmOrg(orgId);}else{const creditPromise=fetchOrgCredit(orgId,Boolean(me.organizations?.find(o=>o.id===orgId)?.is_manager));const data=await api('/api/platform/organizations/'+encodeURIComponent(orgId));const credit=await creditPromise;if(ticket===generation){orgTab=orgSection(section);employeeCredit=credit.status;teamUsage=credit.team;orgLoadedAt=Date.now();organizationV2(data);warmOrg(orgId);}}}
   else if(view==='upgrade')upgradePage();else if(view==='support')supportPage();
   else if(view==='security')securityPage();else await account(ticket,earlyBilling);
  }catch(e){if(ticket!==generation)return;if(e.status===401){me=null;authForm();}else mount(hero('YOUR WORKSPACE','暂时无法打开这个空间。','请核对账号及企业权限。')+note(e.message,true)+'<a class="live-button" href="#workspace">返回工作台</a>');}
 }
 function setPersonalPaneShare(grid,share){
  const width=grid.getBoundingClientRect().width;
  const lower=Math.max(39,Math.ceil(390/width*100)),upper=Math.min(72,Math.floor((width-330)/width*100));
  personalPaneShare=Math.max(lower,Math.min(upper,Math.round(share)));
  grid.style.setProperty('--personal-model-share',personalPaneShare+'%');
  grid.querySelector('.personal-pane-handle')?.setAttribute('aria-valuenow',String(personalPaneShare));
 }
 document.addEventListener('pointerdown',e=>{const handle=e.target.closest('.personal-pane-handle');if(!handle||matchMedia('(max-width:850px)').matches)return;personalPaneDrag=handle.parentElement;document.body.style.userSelect='none';e.preventDefault();});
 document.addEventListener('pointermove',e=>{if(!personalPaneDrag)return;const rect=personalPaneDrag.getBoundingClientRect();setPersonalPaneShare(personalPaneDrag,(e.clientX-rect.left)/rect.width*100);});
 document.addEventListener('pointerup',()=>{if(!personalPaneDrag)return;personalPaneDrag=null;document.body.style.userSelect='';try{localStorage.setItem('semifly.personal-pane-share',String(personalPaneShare));}catch{}});
 document.addEventListener('keydown',e=>{const handle=e.target.closest('.personal-pane-handle');if(!handle||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();setPersonalPaneShare(handle.parentElement,e.key==='Home'?39:e.key==='End'?72:personalPaneShare+(e.key==='ArrowLeft'?-3:3));try{localStorage.setItem('semifly.personal-pane-share',String(personalPaneShare));}catch{}});
 document.addEventListener('change',e=>{if(e.target.matches('[data-personal-price-period]')){personalPricePeriod=e.target.value==='peak'?'peak':'offpeak';updatePersonalDashboard();}});
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-live]');if(!b)return;const action=b.dataset.live;let message=host?.querySelector('#live-form-message');b.disabled=true;
  try{
   if(action==='personal-tab'){if(!panelOrg&&['overview','models','keys','usage','compare'].includes(b.dataset.tab)){const target=b.dataset.tab==='overview'?'personal':'personal/'+b.dataset.tab;if(target&&current!==target){location.hash=target;return;}}personalTab=b.dataset.tab;if(host?.querySelector('.personal-console')&&!panelRedraw&&current!=='upgrade')updatePersonalDashboard();else location.hash='personal';}
   else if(action==='billing-record-page'){billingRecordPage=Math.max(0,Number(b.dataset.page));panelRedraw?.();}
   else if(action==='billing-invoice-page'){billingInvoicePage=Math.max(0,Number(b.dataset.page));panelRedraw?.();}
   else if(action==='billing-subview'){billingView=b.dataset.billingView;panelRedraw?.();}
   else if(action==='billing-retry'){await route(current);}
   else if(action==='page-turn'){pageViews[b.dataset.group+':page']=Number(b.dataset.page);if(panelRedraw)panelRedraw();else if(panelOrg&&lastOrg)organizationV2(lastOrg);else updatePersonalDashboard();}
   else if(action==='support-view'){pageViews.support=b.dataset.supportView;supportDetail=null;supportPageNumber=0;supportTextPage=0;supportPage();}
   else if(action==='support-detail'){supportDetail=b.dataset.id;supportTextPage=0;supportPage();}
   else if(action==='support-back'){supportDetail=null;supportPage();}
   else if(action==='support-page'){supportPageNumber=Math.max(0,Number(b.dataset.page)||0);supportPage();}
   else if(action==='support-text-page'){supportTextPage=Math.max(0,Number(b.dataset.page)||0);supportPage();}
   else if(action==='support-retry'){const kind=b.dataset.kind;if(['tickets','answers'].includes(kind)){delete panelData['loading:'+kind];delete panelData['error:'+kind];panelData[kind]=null;supportPage();}}
   else if(action==='page-view'){
    pageViews[b.dataset.group]=b.dataset.pageView;
    if(b.dataset.group==='billing'&&personalBillingRoute(current)){
     const target={refund:refundRoute,history:billingHistoryRoute}[b.dataset.pageView]||'billing/personal';
     if(current!==target){location.hash=target;return;}
    }
    const panel=host?.querySelector('[data-key-agent-panel]');if(b.dataset.group==='agent-guide'&&panel&&employeeCredit)panel.outerHTML=employeeKeyPanel(employeeCredit);else if(panelRedraw)panelRedraw();else if(panelOrg&&lastOrg)organizationV2(lastOrg);else updatePersonalDashboard();}
   else if(action==='pay-channel'){if(host?.querySelector('.personal-billing'))billingAmountDraft=host.querySelector('#alipay-yuan')?.value??billingAmountDraft;cwInputCode=host.querySelector('#pack-promo')?.value??cwInputCode;payChannel=b.dataset.channel;if(panelRedraw)panelRedraw();}
   else if(action==='alipay-amount'){alipayFen=Number(b.dataset.fen);const input=host.querySelector('#alipay-yuan');if(input){input.value=(alipayFen/100).toFixed(2);input.dispatchEvent(new Event('input',{bubbles:true}));}}
   else if(action==='paid-create'){
    const scope=paidScope(),ticket=generation,credit=await api('/api/customer-credit/status'+scope);
    if(ticket!==generation)return;
    paidCredit=credit;
    if(!panelOrg&&wholeFen(credit.list_credit_fen||0)<=0n){location.hash='billing/personal';return;}
    if(!panelOrg&&BigInt(credit.unallocated_fen||0)<=0n){showToast('额度已分配给现有 Key，请调整消费上限或充值。');personalTab='keys';updatePersonalDashboard();return;}
    paidKeyCreateForm(credit);
   }
   else if(action==='paid-revoke'){await api('/api/customer-credit/keys/'+b.dataset.id+'/revoke'+paidScope(),{});paidCredit=await api('/api/customer-credit/status'+paidScope());if(panelRedraw)panelRedraw();else updatePersonalDashboard();}
   else if(action==='paid-limit'){const curLimit=Number(b.dataset.limit||0),otherSum=(paidCredit?.keys||[]).filter(k=>!k.revoked_at&&k.id!==b.dataset.id).reduce((n,k)=>n+Number(k.limit_yuan||0),0),remaining=(Number(paidCredit?.list_credit_fen||0)/100)-otherSum;form('调整这把 Key 的消费上限',`<input type="hidden" name="key_id" value="${esc(b.dataset.id)}"><p class="live-small">${esc(b.dataset.label)}</p><label>新的官价额度消费上限（元）<input name="limit_yuan" required inputmode="decimal" value="${esc(b.dataset.limit)}" placeholder="例如 10"></label><p class="live-small">这把 Key 加上其他 Key 的额度总和不能超过剩余官价额度，这把最多可设 <b>¥${Math.max(0,remaining).toFixed(2)}</b>。上限不是充值，不会增加余额；调低不能低于这把 Key 已经用掉的额度。</p>`,'live-paid-limit','保存上限');}
   else if(action==='refund-refresh'){await route(current);}
   else if(action==='pack-refund'){
    const pack=personalBilling?.packs?.find(p=>p.id===b.dataset.id);
    if(current!==refundRoute||!pack||!canRefundPack(pack))return;
    const amount=refundableAmount(pack),bonus=BigInt(pack.bonus_fen||0);
    form('确认退款',`<dl class="refund-confirm"><div><dt>预计退回</dt><dd><strong>${yuanText(amount)}</strong></dd></div><div><dt>退款方式</dt><dd>原路退回 · ${refundChannelName(pack)}</dd></div><div><dt>手续费</dt><dd>¥0.00</dd></div></dl>
     <p>${bonus>0n?`本订单的赠送额度 ${yuanText(bonus)} 将收回。`:''}申请后这笔额度包暂时冻结；成功后保留的不可退实付可继续消费，渠道拒绝则恢复全部冻结额度。</p>
     <label>退款原因<input name="reason" required maxlength="200"></label>
     <input type="hidden" name="pack_id" value="${esc(pack.id)}">
     <input type="hidden" name="amount_fen" value="${amount}">
     <input type="hidden" name="request_key" value="${crypto.randomUUID()}">`,'live-pack-refund',`确认退款 ${yuanText(amount)}`);
   }
   else if(action==='recharge-cancel'){
    rechargeReview=null;
    document.querySelector('#config-dialog').close();
    host.querySelector('#alipay-yuan')?.focus();
   }
   else if(action==='alipay-create'){
    const typed=host.querySelector('#alipay-yuan')?.value.trim();
    if(!typed){host.querySelector('#alipay-yuan')?.focus();throw Error('请先输入实付金额，最低 ¥5。');}
    if(typed){const m=/^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(typed);if(!m)throw Error('请输入正确金额，最多两位小数。');alipayFen=Number(m[1])*100+Number((m[2]||'').padEnd(2,'0'));}
    if(alipayFen<500||alipayFen>5000000)throw Error('充值金额须在 ¥5.00 至 ¥50,000.00 之间。');
    const orgId=current.startsWith('billing/organization/')?current.slice('billing/organization/'.length):null,scope=orgId?'org:'+orgId:'personal';
    const promo=host.querySelector('#pack-promo')?.value.trim()||'';cwInputCode=promo;
    const channel=payChannel,cashFen=alipayFen,ticket=generation;
    const quote=await api('/api/billing/quote',{cash_fen:cashFen,promo_code:promo,organization_id:orgId});
    if(ticket!==generation)return;
    rechargeReview={scope,orgId,channel,cashFen,promo,quote,ticket};
    dialog('核对充值金额',`<form class="live-form" id="live-recharge-confirm">
      <p class="live-small">付款方式 · ${PAY_CHANNELS[channel].name}</p>${rechargeBreakdown(quote)}
      ${quote.discount_snapshot?.refund_policy?.non_refundable?`<label class="refund-terms"><input type="checkbox" name="accept_refund_terms" required><span>我已阅读并同意：${esc(quote.discount_snapshot.refund_policy.reason)}</span></label>`:''}
      <div id="live-dialog-message" role="status"></div>
      <div class="recharge-confirm-actions">
        <button type="button" class="live-button quiet" data-live="recharge-cancel">返回修改</button>
        <button type="submit" class="live-button primary">确认支付 ${rechargeAmounts(quote)[0][1]}</button>
      </div>
    </form>`);
   }
   else if(action==='alipay-refresh'){await alipayPoll(true);}
   else if(action==='alipay-reset'){clearInterval(alipayTimer);alipayTimer=null;alipayPay=null;if(panelRedraw)panelRedraw();}
   else if(action==='usage-view'){personalUsageView=['keys','calls'].includes(b.dataset.usageView)?b.dataset.usageView:'models';personalUsagePage=0;if(personalUsageView==='calls')loadPersonalCalls();else updatePersonalDashboard();}
   else if(action==='usage-page'){personalUsagePage=Math.max(0,Number(b.dataset.page)||0);if(personalUsageView==='calls')loadPersonalCalls();else updatePersonalDashboard();}
   else if(action==='usage-calls-retry'){loadPersonalCalls();}
   else if(action==='usage-refresh'){await loadPersonalUsage();}
   else if(action==='personal-family'){personalFamily=b.dataset.family;updatePersonalDashboard();}
   else if(action==='personal-model'){personalSelected=b.dataset.id;updatePersonalDashboard();}
   else if(action==='personal-model-add-all'||action==='personal-model-clear'){setAllPersonalModels(action==='personal-model-add-all');updatePersonalDashboard();showToast(action==='personal-model-add-all'?'已加入全部模型。':'已清除模型清单，已有 Key 不受影响。');}
   else if(action==='connect-model-remove'||action==='connect-model-restore'){if(personalConnectBusy||personalConnectIssued||personalConnectModelId()!=='all')return;savePersonalConnectDraft();const selected=personalUnifiedSelectedModels();personalUnifiedSelections.set(personalConnectDraftKey('all'),action==='connect-model-restore'?(paidCredit?.models||[]).map(m=>m.id):selected.filter(m=>m.id!==b.dataset.id).map(m=>m.id));updatePersonalDashboard();host?.querySelector('[data-live=connect-model-restore]')?.focus({preventScroll:true});}
   else if(action==='connect-selected'){if(!prepareSelectedModelKey()){showToast('请先加入至少一个已开放模型。');return;}personalConnectStep='key';chooseModelIntent('all','personal');location.hash='personal/connect/all';}
   else if(action==='connect-unified'){savePersonalConnectDraft();personalUnifiedSelections.delete(personalConnectDraftKey('all'));personalConnectStep='key';chooseModelIntent('all','personal');location.hash='personal/connect/all';}
   else if(action==='connect-recharge'){if(chooseModelIntent(personalConnectModelId(),'personal'))location.hash='billing/personal';}
   else if(action==='connect-secret-toggle'){const input=host?.querySelector('#mc-secret-value');if(input){const visible=input.type==='password';input.type=visible?'text':'password';b.setAttribute('aria-pressed',String(visible));b.setAttribute('aria-label',visible?'隐藏密钥':'显示密钥');b.title=visible?'隐藏密钥':'显示密钥';b.innerHTML=ico(visible?'eye-off':'eye');}}
   else if(action==='connect-step'){savePersonalConnectDraft();personalConnectStep=b.dataset.step;updatePersonalDashboard();}
   else if(action==='personal-model-manage'){try{localStorage.removeItem(modelIntentKey);}catch{}location.hash='personal/keys';}
   else if(action==='personal-model-add'||action==='personal-model-remove'){if(setPersonalModelChoice(b.dataset.id,action==='personal-model-add')){updatePersonalDashboard();const selector=action==='personal-model-add'?'personal-model-use':'personal-model-add';host?.querySelector(`[data-live="${selector}"][data-id="${CSS.escape(b.dataset.id)}"]`)?.focus({preventScroll:true});}}
   else if(action==='personal-model-use'){setPersonalModelChoice(b.dataset.id,true);if(chooseModelIntent(b.dataset.id,'personal')){personalSelected=b.dataset.id;personalConnectStep='key';location.hash='personal/connect/'+b.dataset.id;}}
   else if(action==='api-config'){host?.querySelector('.api-connection')?.scrollIntoView({block:'start'});}
   else if(action==='clear-model-intent'){try{localStorage.removeItem(modelIntentKey);}catch{}updatePersonalDashboard();}

   else if(action==='pilot-open-keys'){personalTab='keys';updatePersonalDashboard();}
   else if(action==='pilot-refresh'){personalPilot=await api('/api/pilot/status');const rows=host?.querySelector('[data-personal-rows]');if(personalTab==='models'&&rows)rows.innerHTML=personalCatalogRows().html;if(personalTab==='usage')updatePersonalDashboard();showToast('实测数据已刷新；没有向模型发送请求。');}
   else if(action==='pilot-create'){form('创建平台测试 Key',`<label>用途名称<input name="label" required maxlength="50" placeholder="例如：我的 Agent"></label><label>调用模型<select name="model_id" required>${personalPilot.model_ids.map(id=>`<option value="${esc(id)}" ${id===personalSelected?'selected':''}>${esc(modelIntentNames[id]||id)}</option>`).join('')}</select></label><label><input type="checkbox" name="confirm_model" value="yes" required> 我确认这枚 Key 只能调用我选择的型号；两款模型共用每天 10 次测试额度。</label><p class="live-small">Key 只显示一次，请立即保存。正式付费 Key 还须由付款方确认可用模型和预算上限。</p>`,'live-pilot-create','生成测试 Key');}
   else if(action==='employee-open-keys'){if(panelOrg)location.hash='organization/'+panelOrg.organization.id+'/keys';else{personalTab='keys';updatePersonalDashboard();}}
   else if(action==='team-quota'){const row=teamUsage?.members.find(x=>x.user_id===b.dataset.user);if(!row)throw Error('额度数据还在读取，请稍后再试。');const granted=Number(row.granted_yuan),used=Number(row.spent_yuan)+Number(row.held_yuan),floor=(Math.ceil(used*100)/100).toFixed(2);form('调整 '+esc(b.dataset.name)+' 的额度',`<input type="hidden" name="user" value="${esc(b.dataset.user)}"><div class="quota-facts"><div><span>当前额度</span><b>${employeeYuan(granted)}</b></div><div><span>已用与结算中</span><b>${employeeYuan(used)}</b></div><div><span>剩余</span><b>${employeeYuan(Math.max(0,granted-used))}</b></div></div><div class="quota-field"><span>新的总额度（元）</span><div class="quota-input"><input type="range" data-quota-range data-used="${used}" min="${floor}" max="${Math.min(10000,Math.max(50,Math.ceil(Math.max(granted,used)*3/10)*10))}" step="any" value="${granted}" aria-label="拖动调整额度"><input name="yuan" data-quota-number inputmode="decimal" required value="${granted.toFixed(2)}" aria-label="新的总额度（元）"></div><div class="quota-scale"><span>最低 ¥${floor}</span><output data-quota-share>${used>0?`已用占新额度 ${(used/Math.max(granted,0.01)*100).toFixed(1)}%`:'尚未使用'}</output><span>¥${Math.min(10000,Math.max(50,Math.ceil(Math.max(granted,used)*3/10)*10))}</span></div></div><p class="live-small">调高即追加，调低即收回未使用的部分，最低 ¥${floor}。操作会写入操作记录。</p>${btn('收回全部剩余额度','quota-fill',`type="button" data-value="${floor}"`,'quiet')}`,'live-team-quota','保存额度');}
   else if(action==='quota-fill'){const f=document.querySelector('#live-team-quota');f.querySelector('[name=yuan]').value=b.dataset.value;syncQuota(f.querySelector('[name=yuan]'));}
   else if(action==='member-toggle'){const m=lastOrg.members[Number(b.dataset.index)];if(m.status==='active')dialog('停用 '+esc(m.name),`<p class="live-small">停用后，该员工不能进入企业空间，名下 Key 立即失效，已发额度保留。可以随时重新启用。</p>${btn('确认停用','confirm-toggle',`data-index="${b.dataset.index}"`,'danger')}`);else{await api(`/api/platform/organizations/${lastOrg.organization.id}/members/${m.id}`,{status:'active'},'PATCH');await route(current);showToast('已重新启用。');}}
   else if(action==='confirm-toggle'){const m=lastOrg.members[Number(b.dataset.index)];await api(`/api/platform/organizations/${lastOrg.organization.id}/members/${m.id}`,{status:'suspended'},'PATCH');document.querySelector('#config-dialog').close();await route(current);showToast('已停用。');}
   else if(action==='employee-key-manage'||action==='team-key-manage'){
    const manager=action==='team-key-manage',k=(manager?teamUsage?.keys:employeeCredit?.keys)?.find(x=>x.id===b.dataset.id);if(!k)throw Error('Key 数据还在读取，请稍后重试。');
    form('管理 Key',`<input type="hidden" name="key" value="${esc(k.id)}"><input type="hidden" name="scope" value="${manager?'team':'mine'}"><label>名称<input name="label" required maxlength="50" value="${esc(k.label)}"></label><label>消费上限（元）<input name="limit_yuan" inputmode="decimal" value="${esc(k.limit_yuan??'')}" placeholder="留空则共用员工额度"></label><p class="live-small">已用及预留 ${employeeYuan(k.used_yuan||0)}。上限可在员工当前可用额度内调整；多把 Key 共用员工总额度，不会增加余额。</p>`,'live-employee-key-manage','保存');
   }
   else if(action==='team-key-limits'){const k=teamUsage?.keys.find(x=>x.id===b.dataset.id);if(!k)throw Error('Key 数据还在读取，请稍后再试。');form('调整 '+esc(k.label)+' 的限流',`<input type="hidden" name="key" value="${esc(k.id)}"><label>同时进行的请求数（默认 10，最多 64）<input name="max_concurrent" inputmode="numeric" pattern="[0-9]*" placeholder="10" value="${k.max_concurrent??''}"></label><label>每分钟请求数（默认 60，最多 1200）<input name="per_minute" inputmode="numeric" pattern="[0-9]*" placeholder="60" value="${k.per_minute??''}"></label><p class="live-small">只对这把 Key 生效，留空即恢复默认。同时请求数按这位员工名下所有在途请求合计；每人还有 300 万 TPM 席位上限（所有 Key 共用）。操作会写入操作记录。</p>`,'live-team-key-limits','保存限流');}
   else if(action==='team-key-revoke'){if(confirm('停用后这枚 Key 将不能再调用，确定停用吗？')){await api('/api/employee-credit/team/keys/'+encodeURIComponent(b.dataset.id)+'/revoke',{});const open=document.querySelector('#config-dialog');if(open?.open)open.close();await refreshOrganizationBilling(lastOrg.organization.id,generation);showToast('Key 已停用。');}}
   else if(action==='employee-revoke'){if(confirm('停用后这枚 Key 将不能再调用，确定停用吗？')){await api('/api/employee-credit/keys/'+encodeURIComponent(b.dataset.id)+'/revoke',{});if(employeeIssuedKey?.id===b.dataset.id)employeeIssuedKey=null;employeeCredit=await api('/api/employee-credit/status');updatePersonalDashboard();showToast('Key 已停用。');}}
   else if(action==='pilot-copy'){await navigator.clipboard.writeText(document.querySelector('#pilot-secret')?.textContent||'');showToast('Key 已复制。');}
   else if(action==='go-my-usage'){pageViews['team-usage']='mine';location.hash='organization/'+lastOrg.organization.id+'/usage';}
   else if(action==='key-guide-copy'){await navigator.clipboard.writeText(b.dataset.copy);showToast(b.dataset.toast||'Key、地址、模型和示例已复制。');}
   else if(action==='pilot-revoke'){if(confirm('停用后这枚 Key 将不能再调用，确定停用吗？')){await api('/api/pilot/keys/'+encodeURIComponent(b.dataset.id)+'/revoke',{});personalPilot=await api('/api/pilot/status');updatePersonalDashboard();showToast('测试 Key 已停用。');}}
   else if(action==='auth-mode'){
    const email=host.querySelector('[name=email]')?.value||'',phone=host.querySelector('[name=phone]')?.value||'';
    authMode=b.dataset.mode;
    if(current.startsWith('join/'))joinPage();else authForm();
    const emailField=host.querySelector('[name=email]'),phoneField=host.querySelector('[name=phone]');
    if(emailField)emailField.value=email;
    if(phoneField)phoneField.value=phone;
    (emailField||phoneField)?.focus();
   }
   else if(action==='registration-email'){
    authMode=current.startsWith('join/')?'register':'email-register';await (current.startsWith('join/')?joinPage():authForm());host.querySelector('[name=email]')?.focus();
   }
   else if(action==='password-method'){
    phonePasswordReset=!phonePasswordReset;
    redrawPasswordSettings();
    host.querySelector('#live-phone-password-settings input,#live-password-form input')?.focus();
   }
   else if(action==='settings-view'){personalSettingsView=['password','phone','devices'].includes(b.dataset.settingsView)?b.dataset.settingsView:'overview';personalSettingsPage=0;securityPage();}
   else if(action==='settings-page'){personalSettingsPage=Math.max(0,Number(b.dataset.page)||0);securityPage();}
   else if(action==='settings-retry'){const kind=b.dataset.kind;if(['sessions','smsBinding'].includes(kind)){panelData[kind]=null;panelData['loading:'+kind]=false;delete panelData['error:'+kind];securityPage();}}
   else if(action==='sms-bind'){
    form('绑定短信登录手机号',smsFields(true),'live-sms-bind','验证并绑定');
   }
   else if(action==='sms-send'){
    const form=b.closest('form'),purpose=form.id==='live-sms-bind'?'bind':form.dataset.smsPurpose;
    const status=form.querySelector('[role=status]'),phone=form.elements.phone,password=form.elements.password;
    if(!phone.reportValidity())return;
    if(password&&!password.value){password.focus();throw Error('请填写当前密码。');}
    if(form.dataset.smsPhone===phone.value&&Date.now()<Number(form.dataset.smsRetryAt))throw Error('请在 60 秒后重新发送。');
    const phoneValue=phone.value;
    const result=await api('/api/auth/sms/send',{phone:phoneValue,purpose,password:password?.value});
    if(password){
     password.value='';password.type='password';password.required=false;
     const toggle=form.querySelector('[data-password-toggle]');toggle.textContent='显示';
     toggle.setAttribute('aria-pressed','false');toggle.setAttribute('aria-label','显示密码');
    }
    form.dataset.smsPhone=phoneValue;form.dataset.smsChallenge=result.challenge;form.dataset.smsRetryAt=String(Date.now()+result.retryAfter*1000);
    form.elements.code.value='';form.elements.code.focus();
    b.textContent='重新发送';
    status.innerHTML=note(purpose==='login'?'已受理验证码请求。首次使用请选择「去注册」。':'验证码已发送，有效期 5 分钟。');
   }
   else if(action==='refresh-join-requests'){await route(current);}
   else if(action==='resend'){const email=host.querySelector('[name=email]').value;if(!email)throw Error('请先填写邮箱。');await api('/api/auth/send-verification-email',{email,callbackURL:location.origin+'/'+cwAuthQuery()+'#'+current});message.innerHTML=verificationHelp(false);}
   else if(action==='logout'){if(b.dataset.sessionKind==='staff')await api('/api/staff/logout',{});else await api('/api/auth/sign-out',{});me=null;staff=null;lastOrg=null;lastOrgBilling=null;personalPilot=null;employeeCredit=null;employeeIssuedKey=null;panelOrg=null;teamUsage=null;opsPageCache.clear();try{localStorage.removeItem(modelIntentKey);}catch{}publicTicket++;document.querySelectorAll('[data-account-slot]').forEach(slot=>slot.innerHTML=accountMenu(null));const welcomeLabel=document.getElementById('welcome-continue-label');if(welcomeLabel)welcomeLabel.textContent='注册：开始我的旅程';document.querySelectorAll('.account-menu').forEach(el=>el.removeAttribute('open'));if(location.hash==='#universe')refreshPublic();else location.hash='universe';}
   else if(action==='create-org')location.hash='upgrade';
   else if(action==='org-tab'){location.hash='organization/'+lastOrg.organization.id+'/'+b.dataset.tab;}
   else if(action==='demo-select'){form('选择可用模型',`<p class="live-small">可同时选择多个演示型号。更改选择不会挪动余额；停用相关演示接入后可取消型号。</p>${demoState.models.map(m=>`<label class="demo-check"><input type="checkbox" name="model_codes" value="${esc(m.code)}" ${demoState.selected_models.includes(m.code)?'checked':''}><span><b>${esc(m.name)}</b><small>${esc(m.kind)} · 输入 ¥${(m.input_fen_per_1000*10).toFixed(2)} / 百万 Token · 输出 ¥${(m.output_fen_per_1000*10).toFixed(2)} / 百万 Token（演示）</small></span></label>`).join('')}`,'live-demo-select','保存模型选择');}
   else if(action==='demo-order'){form('创建模拟充值单',`<label>充值金额（元，最低 ¥5）<input name="amount_yuan" type="number" min="5" max="100000" step="1" value="100" required></label><p class="live-small">这笔模拟充值进入当前个人或企业钱包，可供已授权的不同型号共用。确认后仍需点击“模拟付款”；不会请求真实收银台。</p>`,'live-demo-order','创建充值单');}
   else if(action==='demo-refund'){form('模拟未用余额退款',`<label>退款金额（元）<input name="amount_yuan" type="number" min="0.01" max="${(demoState.wallet.balance_fen/100).toFixed(2)}" step="0.01" value="${(demoState.wallet.balance_fen/100).toFixed(2)}" required></label><p class="live-small">只从未用模拟实付余额扣除，并关联原模拟充值单；不执行真实退款。真实付款按红绿模型：用量先扣红色实付、无手续费退红色剩余，绿色赠送整条收回。</p>`,'live-demo-refund','确认模拟退款');}
   else if(action==='demo-pay'){dialog('确认模拟付款',`<p class="live-small">这一步会把演示订单标记为已付，并增加模拟余额。不会连接支付渠道、扣款或生成真实发票。</p>${btn('确认模拟付款','demo-pay-confirm',`data-id="${b.dataset.id}"`,'primary')}`);}
   else if(action==='demo-pay-confirm'){await api('/api/demo/orders/'+b.dataset.id+'/pay',{organization_id:demoOrg()});document.querySelector('#config-dialog').close();await demoPage();}
   else if(action==='demo-allocate'){const member=demoState.members.find(m=>m.user_id===b.dataset.id),allocation=demoState.allocations.find(a=>a.user_id===member.user_id);form('设置模拟额度与型号',`<input type="hidden" name="user_id" value="${esc(member.user_id)}"><p class="live-small">${esc(member.name)} · ${esc(member.email)}</p><label>总额度（元）<input name="limit_yuan" type="number" required min="0" max="1000000" step="1" value="${Number(allocation?.limit_fen||0)/100}"></label><p class="live-small">允许使用的型号</p>${demoState.models.filter(m=>demoState.selected_models.includes(m.code)).map(m=>`<label class="demo-check"><input type="checkbox" name="model_codes" value="${esc(m.code)}" ${(allocation?.model_codes||[]).includes(m.code)?'checked':''}><span>${esc(m.name)}</span></label>`).join('')}<p class="live-small">员工预算总额不能超过企业已模拟付款的资金；减少型号前要先停用相关演示接入。</p>`,'live-demo-allocation','保存模拟授权');}
   else if(action==='demo-key'){form('创建演示接入',`<label>接入名称<input name="label" required maxlength="80" placeholder="例如：产品开发环境"></label><p class="live-small">选择此接入可以使用的型号；仅保存演示记录 ID，不生成真实密钥。</p>${demoState.models.filter(m=>demoState.selected_models.includes(m.code)).map(m=>`<label class="demo-check"><input type="checkbox" name="model_codes" value="${esc(m.code)}" checked><span>${esc(m.name)}</span></label>`).join('')}`,'live-demo-key','创建演示接入');}
   else if(action==='demo-use'){const key=demoState.keys.find(k=>k.id===b.dataset.id);form('模拟一次模型调用',`<input type="hidden" name="key_id" value="${esc(b.dataset.id)}"><label>使用型号<select name="model_code">${(key.model_codes||[key.model_code]).map(code=>`<option value="${esc(code)}">${esc(demoState.models.find(m=>m.code===code)?.name||code)}</option>`).join('')}</select></label><label>输入 Token<input name="input_tokens" type="number" required min="1" max="1000000" value="1200"></label><label>输出 Token<input name="output_tokens" type="number" required min="1" max="1000000" value="600"></label><p class="live-small">按所选型号的演示价格扣减钱包及员工额度，记录用量；不会向供应商发送请求。</p>`,'live-demo-usage','生成模拟使用记录');}
   else if(action==='demo-revoke'){await api('/api/demo/keys/'+b.dataset.id+'/revoke',{organization_id:demoOrg()});await demoPage();}
   else if(action==='create-join-link'){await api(`/api/platform/organizations/${lastOrg.organization.id}/join-links`,{});await route(current);showToast('邀请链接已生成，可发给一人或多人。');}
   else if(action==='bank-refresh'){lastOrgBilling=null;await route(current);}
   else if(action==='copy-text'){await navigator.clipboard.writeText(b.dataset.text);showToast('已复制。');}
   else if(action==='copy-join-link'){await navigator.clipboard.writeText(b.dataset.url);showToast('邀请链接已复制。');}
   else if(action==='revoke-join-link'){await api(`/api/platform/organizations/${lastOrg.organization.id}/join-links/${b.dataset.id}/revoke`,{});await route(current);}
   else if(action==='approve-request'||action==='reject-request'){await api(`/api/platform/organizations/${lastOrg.organization.id}/join-requests/${b.dataset.id}/${action==='approve-request'?'approve':'reject'}`,{});await route(current);}
   else if(action==='member-detail'){openMemberDetail(b.dataset.user);}
   else if(action==='pick-model'){directPicked.has(b.dataset.id)?directPicked.delete(b.dataset.id):directPicked.add(b.dataset.id);redrawKeysOrModels();}
   else if(action==='pick-clear'){directPicked.clear();redrawKeysOrModels();}
   else if(action==='pick-generate'){pageViews['employee-keys']='direct';directIssued=null;if(panelOrg&&lastOrg)location.hash='organization/'+lastOrg.organization.id+'/keys';else{personalTab='keys';updatePersonalDashboard();}}
   else if(action==='direct-all'){(employeeCredit?.models||[]).forEach(m=>directPicked.add(m.id));redrawKeysOrModels();}
   else if(action==='direct-none'){directPicked.clear();redrawKeysOrModels();}
   else if(action==='health-refresh'){modelHealthLoading=true;if(panelOrg&&lastOrg)organizationV2(lastOrg);try{const r=await api('/api/employee-credit/model-health/refresh',{});modelHealth=new Map(r.models.map(m=>[m.model_id,m]));modelHealthAt=Date.parse(r.checked_at)||Date.now();modelHealthTried=Date.now();showToast(r.throttled?`刚刚已实测过，${r.retry_after_seconds} 秒后可再次实测。`:'已完成实测。');}finally{modelHealthLoading=false;if(panelOrg&&lastOrg)organizationV2(lastOrg);}}
   else if(action==='analytics-range'){analytics.range=b.dataset.range;loadAnalytics(true);organizationV2(lastOrg);}
   else if(action==='analytics-view'){analytics[b.dataset.anGroup]=b.dataset.anView;organizationV2(lastOrg);}
   else if(action==='toggle-summaries'){const on=!teamUsage?.summaries_enabled;dialog(on?'开启调用摘要':'关闭调用摘要',on?`<p class="live-small">开启后，每次调用会保存员工最后一条提问的前 60 个字，用来了解大致在做什么任务。密钥、邮箱、手机号、证件号、长数字会自动隐去；不保存完整对话和模型回复。摘要保存 30 天，只有企业管理者可见。员工生成 Key 的页面会显示这项提示。按《个人信息保护法》，请同时在公司制度中告知员工。</p>${btn('确认开启','confirm-summaries','data-on="1"','primary')}`:`<p class="live-small">关闭后不再记录，已保存的摘要会立即删除，无法恢复。来源、模型和费用记录不受影响。</p>${btn('确认关闭并删除','confirm-summaries','data-on="0"','danger')}`);}
   else if(action==='confirm-summaries'){await api('/api/employee-credit/team/summaries',{enabled:b.dataset.on==='1'},'PUT');document.querySelector('#config-dialog').close();await refreshOrganizationBilling(lastOrg.organization.id,generation);showToast(b.dataset.on==='1'?'已开启调用摘要。':'已关闭，已保存的摘要已删除。');}
   else if(action==='edit-member'){
    const m=lastOrg.members[Number(b.dataset.index)],self=m.user_id===me.user.id,isManagerRole=['owner','admin','billing'].includes(m.role),keys=(teamUsage?.keys||[]).filter(k=>k.owner_id===m.user_id&&!k.revoked_at);
    const roleField=self?'':`<label>企业身份<select name="role"><option value="${isManagerRole?m.role:'owner'}" ${isManagerRole?'selected':''}>企业管理者 · 管理员工、额度和账单</option><option value="member" ${!isManagerRole?'selected':''}>企业成员 · 只看自己的额度和 Key</option></select></label>`;
    const statusField=self?'':`<label>账户状态<select name="status"><option value="active" ${m.status==='active'?'selected':''}>使用中</option><option value="suspended" ${m.status==='suspended'?'selected':''}>停用</option></select></label>`;
    const keyList=teamUsage?`<div class="member-keys"><b>有效 Key · ${keys.length}</b>${keys.map(k=>`<div><span>${esc(k.label)}<small>尾号 ${esc(k.key_hint)} · 同时 ${k.max_concurrent??3} 个 · 每分钟 ${k.per_minute??60} 次</small></span>${btn('管理','team-key-manage',`type="button" data-id="${esc(k.id)}"`,'quiet')}${btn('限流','team-key-limits',`type="button" data-id="${esc(k.id)}"`,'quiet')}${btn('停用','team-key-revoke',`type="button" data-id="${esc(k.id)}"`,'quiet')}</div>`).join('')||'<p class="live-small">这位员工还没有生成 Key。</p>'}</div>`:'';
    form('管理 '+esc(m.name),`<input type="hidden" name="id" value="${m.id}">${roleField}<label>部门<select name="department"><option value="">未分组</option>${(lastOrg.departments||[]).map(d=>`<option value="${esc(d.name)}" ${d.name===m.department?'selected':''}>${esc(d.name)}</option>`).join('')}${m.department&&!(lastOrg.departments||[]).some(d=>d.name===m.department)?`<option value="${esc(m.department)}" selected>${esc(m.department)}（不在部门列表中）</option>`:''}</select><small class="live-small">部门列表在“设置 · 部门”中维护。</small></label>${statusField}${keyList}<p class="live-small">企业至少保留一位管理者。身份和状态变更会写入操作记录。</p>${self?'':btn('移出企业','remove-member',`type="button" data-id="${m.id}"`,'danger')}`,'live-member-update');
   }
   else if(action==='dept-rename'){form('部门改名',`<input type="hidden" name="id" value="${esc(b.dataset.id)}"><label>新名称<input name="name" maxlength="40" required value="${esc(b.dataset.name)}"></label><p class="live-small">所有成员会同步改名。改成已有部门的名字，会把两个部门合并。</p>`,'live-dept-rename','保存');}
   else if(action==='dept-delete'){dialog('删除部门 '+esc(b.dataset.name),`<p class="live-small">${Number(b.dataset.members)?`这个部门的 ${Number(b.dataset.members)} 位成员会回到“未分组”。`:'这个部门目前没有成员。'}操作会写入操作记录。</p>${btn('确认删除','confirm-dept-delete',`data-id="${esc(b.dataset.id)}"`,'danger')}`);}
   else if(action==='confirm-dept-delete'){await api(`/api/platform/organizations/${lastOrg.organization.id}/departments/${b.dataset.id}`,{},'DELETE');document.querySelector('#config-dialog').close();pageViews.settings='departments';await route(current);showToast('部门已删除。');}
   else if(action==='remove-member'){dialog('确认移出企业',`<p class="live-small">移出后，该成员不能再访问本企业，历史审计记录会保留。可通过新邀请链接重新申请加入。</p>${btn('确认移出','confirm-remove',`data-id="${b.dataset.id}"`,'danger')}`);}
   else if(action==='confirm-remove'){await api(`/api/platform/organizations/${lastOrg.organization.id}/members/${b.dataset.id}`,{},'DELETE');document.querySelector('#config-dialog').close();await route(current);}
   else if(action==='request-join'){await api('/api/platform/join-requests',{token:current.slice(5),department:document.querySelector('[data-join-department]')?.value||''});mount(hero('JOIN REQUEST','申请已提交，等待企业管理者审批。','获批前没有企业预算、模型权限或 API Key。')+'<a class="live-button" href="#workspace">返回个人空间</a>');}
   else if(action==='org-audit'||action==='staff-audit'){const data=await api(action==='org-audit'?`/api/platform/organizations/${lastOrg.organization.id}/audit`:'/api/staff/audit');dialog('操作记录',`<div class="live-session-list">${data.length?data.map(r=>`<article><b>${esc(r.action)}</b><small>${new Date(r.created_at).toLocaleString('zh-CN')} · ${esc(r.actor_id)}</small></article>`).join(''):'暂无记录'}</div>`);}
   else if(action==='supply-add-supplier'){form('建立候选供应商',`<p class="live-small">先填清楚供方是谁、提供什么服务；下一步再进入产品与证据核验。</p><label>供应商名称<input name="display_name" required maxlength="100" placeholder="例如：AutoKernel"></label><label>拟签约法律主体<input name="legal_name" required maxlength="160" placeholder="营业执照上的完整名称"></label><label>供给类型<select name="service_type">${Object.entries(serviceTypes).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><label>服务地区<input name="region" required maxlength="80" placeholder="例如：中国大陆"></label><details class="supply-extra-fields"><summary>补充来源、联系人与下一步</summary><label>来源关系<select name="source_type">${Object.entries(sourceTypes).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><label>联系邮箱<input name="contact_email" type="email"></label><label>官方来源链接<input name="reference_url" type="url" placeholder="https://..."></label><label>下一步待办<input name="next_action" maxlength="240" placeholder="例如：取得接口文档和 SLA"></label><label>备注（请勿填写密钥）<textarea name="notes" maxlength="1000"></textarea></label></details>`,'live-supply-supplier','保存候选档案');}
   else if(action==='supply-edit-supplier'){const x=supplyData.suppliers.find(x=>x.id===b.dataset.id);form('管理 '+esc(x.display_name),`<input type="hidden" name="id" value="${x.id}"><label>状态<select name="status">${['candidate','reviewing','blocked'].map(v=>`<option value="${v}" ${x.status===v?'selected':''}>${supplyStatus[v]}</option>`).join('')}</select></label><label>供给类型<select name="service_type">${Object.entries(serviceTypes).map(([v,t])=>`<option value="${v}" ${x.service_type===v?'selected':''}>${t}</option>`).join('')}</select></label><label>来源关系<select name="source_type">${Object.entries(sourceTypes).map(([v,t])=>`<option value="${v}" ${x.source_type===v?'selected':''}>${t}</option>`).join('')}</select></label><label>下一步待办<input name="next_action" maxlength="240" value="${esc(x.next_action)}" placeholder="明确下一项可核验动作"></label><details class="supply-extra-fields"><summary>联系方式和备注</summary><label>联系邮箱<input name="contact_email" type="email" value="${esc(x.contact_email)}"></label><label>来源链接<input name="reference_url" type="url" value="${esc(x.reference_url)}"></label><label>备注<textarea name="notes" maxlength="1000">${esc(x.notes)}</textarea></label></details>`,'live-supply-supplier-update');}
   else if(action==='supply-add-offer'){form('新增供应产品草稿',`<label>供应商<select name="supplier_id">${supplyData.suppliers.filter(x=>x.status!=='blocked').map(x=>`<option value="${x.id}">${esc(x.display_name)}</option>`).join('')}</select></label><label>模型名称<input name="model_name" required maxlength="100" placeholder="例如：DeepSeek Chat"></label><label>上游模型标识<input name="upstream_model_id" required maxlength="120" placeholder="供方文档中的实际型号"></label><label>协议<select name="protocol"><option value="openai_compatible">OpenAI 兼容</option><option value="native">供方原生</option><option value="other">其他</option></select></label><label>服务地区<input name="region" required maxlength="80" placeholder="例如：中国大陆"></label><label>备注（请勿填写密钥）<textarea name="notes" maxlength="1000"></textarea></label>`,'live-supply-offer','保存产品草稿');}
   else if(action==='supply-add-product'){form('设计客户模型商品',`<input type="hidden" name="offer_id" value="${offerDetail.offer.id}"><label>客户看到的名称<input name="display_name" required maxlength="100" placeholder="例如：DeepSeek 通用"></label><label>商品代码<input name="product_code" required minlength="3" maxlength="50" pattern="[a-z0-9][a-z0-9-]{2,49}" placeholder="例如：deepseek-chat-cn"></label><label>简短介绍<textarea name="summary" maxlength="500" placeholder="适合什么任务"></textarea></label><p class="live-small">关联供给：${esc(offerDetail.offer.supplier_name)} · ${esc(offerDetail.offer.model_name)}。这只是内部草稿，不设售价、不上架、不生成 API Key。</p>`,'live-supply-product','保存商品草稿');}
   else if(action==='owned-product-add'){form('设计 semifly.ai 自有服务',`<p class="live-small">请写明真实交付内容和底层能力；仅创建内部草稿，不宣称自研基础模型，也不会公开销售。</p><label>服务名称<input name="display_name" required maxlength="100" placeholder="例如：semifly.ai 结构化摘要"></label><label>商品代码<input name="product_code" required minlength="3" maxlength="50" pattern="[a-z0-9][a-z0-9-]{2,49}"></label><label>服务地区<input name="region" required maxlength="80" placeholder="例如：中国大陆"></label><label>一句话简介<textarea name="summary" maxlength="500"></textarea></label><label>实际服务与底层能力说明<textarea name="source_description" required maxlength="500" placeholder="描述自有处理逻辑、依赖的模型或供应路径及授权状态"></textarea></label>`,'live-owned-product','保存自有服务草稿');}
   else if(action==='product-profile-list'){dialog('完善型号资料',`<p class="live-small">品牌、型号、能力与限制要逐项核对。空缺保持待验证，不使用供应商宣传值冒充实测。</p><div class="live-session-list">${pricingData.products.map(p=>`<article><b>${esc(p.display_name)}</b><small>${p.source_kind==='owned_service'?'semifly.ai 自有服务':esc(p.supplier_name||'供应商')} · ${esc(p.product_code)} · ${p.profile_updated_at?'资料已录入':'待补资料'}</small>${btn('编辑型号资料','product-profile',`data-id="${p.id}"`,'quiet')}</article>`).join('')}</div>`);}
   else if(action==='product-profile'){const p=pricingData.products.find(p=>p.id===b.dataset.id),tags=[['text','文本'],['image','图片'],['audio','音频'],['video','视频'],['streaming','流式'],['tool_calling','工具调用'],['structured_output','结构化输出'],['reasoning','推理'],['embedding','向量']];form('型号资料 · '+esc(p.display_name),`<input type="hidden" name="id" value="${p.id}"><label>品牌<input name="brand" required maxlength="80" value="${esc(p.brand)}" placeholder="例如：模型原品牌或 semifly.ai"></label><label>模型家族<input name="family" required maxlength="80" value="${esc(p.family)}"></label><label>精确版本<input name="version_label" maxlength="80" value="${esc(p.version_label)}"></label><label>适用场景<textarea name="use_cases" required maxlength="500">${esc(p.use_cases)}</textarea></label><label>已知限制<textarea name="service_limits" maxlength="500">${esc(p.service_limits)}</textarea></label><label>上下文窗口（Token，可空）<input name="context_window_tokens" type="number" min="1" max="100000000" value="${p.context_window_tokens||''}"></label><label>最大输出（Token，可空）<input name="max_output_tokens" type="number" min="1" max="100000000" value="${p.max_output_tokens||''}"></label><p class="live-small">确认过的能力</p>${tags.map(([key,label])=>`<label class="demo-check"><input name="capability_tags" type="checkbox" value="${key}" ${(p.capability_tags||[]).includes(key)?'checked':''}><span>${label}</span></label>`).join('')}<p class="live-small">这里只记录内部产品资料；公开上架仍需独立审批。</p>`,'live-product-profile','保存型号资料');}
   else if(action==='price-add'){form('设计内部价格草稿',`<p class="live-small">请先核对供方报价、计费单位和成本依据。价格草稿不会展示给客户，也不会开启收款。</p><label>模型商品<select name="model_product_id">${pricingData.products.filter(p=>p.status!=='blocked').map(p=>`<option value="${p.id}">${esc(p.display_name)} · ${esc(p.product_code)}</option>`).join('')}</select></label><label>输入价格（元 / 百万 tokens）<input name="input_yuan_per_million" type="number" required min="0.01" max="1000000" step="0.01"></label><label>输出价格（元 / 百万 tokens）<input name="output_yuan_per_million" type="number" required min="0.01" max="1000000" step="0.01"></label><label>依据链接（HTTPS）<input name="evidence_url" type="url" required placeholder="https://..."></label><label>价格说明<textarea name="notes" maxlength="1000" placeholder="计价假设、适用范围及待确认事项；不要填写密钥"></textarea></label>`,'live-price-proposal','保存内部草稿');}
   else if(action==='price-history'){dialog('内部价格草稿与依据',`<p class="live-small">按创建时间列出内部记录。以下金额不是对外报价，重新设计会保留旧版。</p><div class="live-session-list">${pricingData.proposals.map(q=>`<article><b>${esc(q.model_product_name)} · 输入 ¥${(Number(q.input_fen_per_million)/100).toFixed(2)} / 输出 ¥${(Number(q.output_fen_per_million)/100).toFixed(2)}</b><small>每百万 tokens · ${new Date(q.created_at).toLocaleString('zh-CN')} · ${esc(q.created_by)}</small><small>${esc(q.notes)}</small><a href="${esc(q.evidence_url)}" target="_blank" rel="noopener noreferrer">查看依据 ${ico('arrow-up-right')}</a></article>`).join('')}</div>`);}
   else if(action==='price-review-list'){
    const latest=new Map(),reviews=new Map(),decisions=new Map(pricingData.decisions.map(d=>[d.price_proposal_id,d]));
    for(const q of pricingData.proposals)if(!latest.has(q.model_product_id))latest.set(q.model_product_id,q);
    for(const r of reviewData.reviews)if(!reviews.has(r.model_product_id))reviews.set(r.model_product_id,r);
    dialog('价格内部复核',`<p class="live-small">只复核与最新商品证据绑定的价格版本。设计人不能复核自己的价格；即使内部批准，也不会对客户显示价格或开启付款。</p><div class="live-session-list">${[...latest.values()].map(q=>{const r=reviews.get(q.model_product_id),d=decisions.get(q.id),ready=r?.status==='internally_reviewed'&&r.price_proposal_id===q.id;return `<article><b>${esc(q.model_product_name)}</b><small>输入 ¥${(Number(q.input_fen_per_million)/100).toFixed(2)} · 输出 ¥${(Number(q.output_fen_per_million)/100).toFixed(2)} / 百万 Token</small><small>${d?.status==='approved'?'内部已批准 · 仍未公开':d?.status==='rejected'?'价格已退回':ready?'商品已复核 · 待价格批准':'先完成对应商品的内部复核'}</small>${d?.notes?`<small>意见：${esc(d.notes)}</small>`:''}${ready&&!d&&q.created_by!==staff.subject&&staff.role!=='pending'?`${btn('批准内部价格','price-review-decision',`data-price-id="${q.id}" data-status="approved"`,'quiet')}${btn('退回价格','price-review-decision',`data-price-id="${q.id}" data-status="rejected"`,'quiet')}`:''}</article>`;}).join('')}</div>`);
   }
   else if(action==='price-review-decision'){form(b.dataset.status==='approved'?'批准内部价格':'退回价格',`<input type="hidden" name="price_id" value="${esc(b.dataset.priceId)}"><input type="hidden" name="status" value="${esc(b.dataset.status)}"><p class="live-small">核对最新商品复核、供给与测试证据，以及计费单位和价格依据。此操作不公开价格，也不启用收款。</p><label>复核意见<textarea name="notes" required minlength="10" maxlength="1000" placeholder="说明复核依据与结论"></textarea></label>`,'live-price-decision','保存内部结论');}
   else if(action==='review-list'){const latest=new Map();for(const r of reviewData.reviews)if(!latest.has(r.model_product_id))latest.set(r.model_product_id,r);dialog('商品内部复核',`<p class="live-small">供给资料、人工验收报告和价格版本齐备后可申请独立复核。复核完成不等于获得销售许可，客户仍不能下单。</p><div class="live-session-list">${reviewData.products.map(p=>{const r=latest.get(p.id),state=r?.status==='requested'?'待复核':r?.status==='changes_requested'?'退回补充':r?.status==='internally_reviewed'?'内部复核完成':'未申请';return `<article><b>${esc(p.display_name)} · ${state}</b><small>${esc(p.product_code)}${r?` · 申请人 ${esc(r.requested_by)} · ${new Date(r.created_at).toLocaleString('zh-CN')}`:''}</small>${r?.reviewer_notes?`<small>复核意见：${esc(r.reviewer_notes)}</small>`:''}${reviewData.eligible.has(p.id)&&staff.role!=='pending'&&(!r||r.status==='changes_requested')?btn('申请内部复核','review-request',`data-product-id="${p.id}"`,'quiet'):''}${r?.status==='requested'&&staff.role==='platform_admin'&&r.requested_by!==staff.subject?`${btn('完成内部复核','review-decision',`data-review-id="${r.id}" data-status="internally_reviewed"`,'quiet')}${btn('退回补充','review-decision',`data-review-id="${r.id}" data-status="changes_requested"`,'quiet')}`:''}</article>`;}).join('')}</div>`);}
   else if(action==='review-request'){form('申请商品内部复核',`<input type="hidden" name="product_id" value="${esc(b.dataset.productId)}"><p class="live-small">系统会锁定当前供给、最新验收报告和价格草稿版本。另一位平台管理员复核；此步骤不会公开销售。</p><label>申请说明<textarea name="notes" maxlength="1000" placeholder="需要复核的依据或待关注事项"></textarea></label>`,'live-review-request','提交复核');}
   else if(action==='review-decision'){form(b.dataset.status==='internally_reviewed'?'完成内部复核':'退回补充',`<input type="hidden" name="review_id" value="${esc(b.dataset.reviewId)}"><input type="hidden" name="status" value="${esc(b.dataset.status)}"><p class="live-small">请复核原始证据与锁定版本。完成内部复核不会开启客户购买或调用。</p><label>复核意见<textarea name="notes" required maxlength="1000"></textarea></label>`,'live-review-decision','保存复核结论');}
   else if(action==='promotion-add'){form('设计促销活动草稿',`<label>活动名称<input name="name" required maxlength="100" placeholder="例如：新朋友探索计划"></label><label>模型及价格草稿<select name="price_proposal_id">${promotionData.priceOptions.map(q=>`<option value="${q.id}">${esc(q.model_product_name)} · 入 ¥${(Number(q.input_fen_per_million)/100).toFixed(2)} / 出 ¥${(Number(q.output_fen_per_million)/100).toFixed(2)} · 每百万 tokens</option>`).join('')}</select></label><label>客户价占公开价比例（%）<input name="customer_price_percent" type="number" required min="1" max="100" step="1" placeholder="例如 90"></label><label>推广佣金比例（%）<input name="commission_percent" type="number" required min="0" max="30" step="1" placeholder="例如 5；无佣金填 0"></label><label>优惠预算上限（元，整数）<input name="total_discount_budget_yuan" type="number" required min="1" max="1000000" step="1" placeholder="例如 1000"></label><label>开始时间<input name="starts_at" type="datetime-local" required></label><label>结束时间<input name="ends_at" type="datetime-local" required></label><p class="live-small">这些数值仅保存为内部草稿。所选价格只是内部草稿。没有发布审批、支付和用量账本时，活动不能兑换或计佣。</p>`,'live-promotion','保存活动草稿');}
   else if(action==='supply-select-offer'){await supplierPage(generation,b.dataset.id);}
   else if(action==='supply-edit-offer'){const x=offerDetail.offer;form('管理 '+esc(x.model_name),`<input type="hidden" name="id" value="${x.id}"><label>状态<select name="status">${['draft','reviewing','blocked'].map(v=>`<option value="${v}" ${x.status===v?'selected':''}>${supplyStatus[v]}</option>`).join('')}</select></label><label>备注<textarea name="notes" maxlength="1000">${esc(x.notes)}</textarea></label><p class="live-small">资料核验中不表示可售；真实授权、协议测试和计费核对完成前不会发布。</p>`,'live-supply-offer-update');}
   else if(action==='supply-add-test'){const now=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);form('登记测试结果',`<p class="live-small">仅记录已经执行且有外部证据的测试；此操作不会启用销售或调用。</p><label>测试项目<select name="test_type">${Object.entries(testTypes).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><label>结果<select name="result"><option value="passed">通过</option><option value="failed">失败</option><option value="inconclusive">待确认</option></select></label><label>实际测试时间<input name="observed_at" type="datetime-local" value="${now}" required></label><label>延迟（毫秒，可空）<input name="latency_ms" type="number" min="0" max="600000"></label><label>证据链接<input name="evidence_url" type="url" required placeholder="https://..."></label><label>结果说明<textarea name="notes" maxlength="1000"></textarea></label>`,'live-supply-test','保存测试记录');}
   else if(action==='supply-add-validation'){form('登记成组验收报告',`<p class="live-small">填写已完成的真实测试统计，附上可复核的 HTTPS 报告。该记录属于人工报告，不会自动开放销售或调用。</p><label>验收目标<input name="objective" required maxlength="200" placeholder="例如：高峰时段 20 并发对话测试"></label><label>开始时间<input name="window_start" type="datetime-local" required></label><label>结束时间<input name="window_end" type="datetime-local" required></label><label>请求样本数<input name="sample_count" type="number" required min="1" max="1000000"></label><label>成功数<input name="success_count" type="number" required min="0" max="1000000"></label><label>首 Token 延迟 p95（毫秒，可空）<input name="p95_ttft_ms" type="number" min="0" max="600000"></label><label>完整耗时 p95（毫秒，可空）<input name="p95_total_ms" type="number" min="0" max="600000"></label><label>用量与账单核对<select name="usage_check"><option value="not_checked">尚未核对</option><option value="matched">已核对一致</option><option value="mismatched">有差异</option></select></label><label>本次报告结论<select name="conclusion"><option value="inconclusive">待复核</option><option value="passed">报告通过</option><option value="failed">报告失败</option></select></label><label>报告证据链接<input name="evidence_url" type="url" required placeholder="https://..."></label><label>问题与复测说明<textarea name="notes" maxlength="1000"></textarea></label>`,'live-supply-validation','保存验收报告');}
   else if(action==='supply-edit-check'){const x=offerDetail.checks.find(c=>c.check_key===b.dataset.key);form('记录：'+supplyChecks[x.check_key],`<input type="hidden" name="check_key" value="${x.check_key}"><label>记录状态<select name="result"><option value="pending" ${x.result==='pending'?'selected':''}>待核对</option><option value="documented" ${x.result==='documented'?'selected':''}>资料已记录</option><option value="issue" ${x.result==='issue'?'selected':''}>发现问题</option></select></label><label>证据链接（记录资料时必填）<input name="evidence_url" type="url" value="${esc(x.evidence_url)}" placeholder="https://..."></label><label>核验说明<textarea name="notes" maxlength="1000">${esc(x.notes)}</textarea></label><p class="live-small">这是一条人工资料记录。接口连通、能力和账单仍需真实测试。</p>`,'live-supply-check');}
   else if(action==='edit-staff'){const s=staffList[Number(b.dataset.index)],admin=s.role==='platform_admin';form('设置 '+esc(s.name)+' 的权限',`<input type="hidden" name="subject" value="${esc(s.subject)}"><input type="hidden" name="admin" value="${admin?'yes':''}">${admin?'<p class="live-small">平台管理员拥有商务、财务和技术全部权限。</p>':`<label class="demo-check"><input type="checkbox" name="business" value="yes" ${s.role!=='pending'?'checked':''}> 商务后台</label><label class="demo-check"><input type="checkbox" name="finance" value="yes" ${s.finance_access?'checked':''}> 财务（收入、成本、毛利、发票、退款；需同时打开商务后台）</label><label class="demo-check"><input type="checkbox" name="technical" value="yes" ${s.technical_access?'checked':''}> 技术后台</label>`}<label>状态<select name="status"><option value="active">有效</option><option value="suspended" ${s.status==='suspended'?'selected':''}>停用</option></select></label><p class="live-small">保存后撤销该员工当前会话，需重新登录。</p>`,'live-staff-update');}
   else if(action==='customer-status'){const u=customers[Number(b.dataset.index)];dialog(u.disabled?'恢复客户账户':'停用客户账户',`<p class="live-small">${esc(u.email)}。停用将撤销该客户所有semifly.ai会话；恢复后需要重新登录。</p>${btn('确认操作','confirm-customer-status',`data-index="${b.dataset.index}"`,'primary')}`);}
   else if(action==='confirm-customer-status'){const u=customers[Number(b.dataset.index)];await api(`/api/staff/customers/${encodeURIComponent(u.id)}/status`,{disabled:!u.disabled});document.querySelector('#config-dialog').close();await route(current);}
   else if(action==='revoke-others'){await api('/api/auth/revoke-other-sessions',{});panelData.sessions=null;panelData['loading:sessions']=false;delete panelData['error:sessions'];await route(current);showToast('其他设备已退出，当前登录保留。');}
  }catch(err){message=document.querySelector('#live-dialog-message')||host?.querySelector('#live-form-message');if(message)message.innerHTML=note(err.message,true);else showToast(err.message);}finally{b.disabled=false;}
 });
 document.addEventListener('submit',async e=>{
  // A field named "id" shadows form.id, so read the attribute.
  const form=e.target,formId=form.getAttribute('id')||'';if(!formId.startsWith('live-'))return;e.preventDefault();
  const values=Object.fromEntries(new FormData(form)),button=form.querySelector('[type=submit]'),message=form.querySelector('[role=status]');
  if(formId==='live-model-key'&&(button.disabled||personalConnectBusy))return;
  if(formId==='live-paid-key'){
   if(button.disabled)return;
   form.dataset.submitting='true';
  }
  if(formId==='live-recharge-confirm'&&button.disabled)return;
  button.disabled=true;message.innerHTML='';
  try{
   if(formId==='live-model-key'){
    const id=personalConnectModelId(),owner=me?.user?.id;personalConnectBusy=true;savePersonalConnectDraft();
    const result=await createPersonalModelKey(id,values.label,values.limit_yuan,id==='all'?personalUnifiedSelectedModels().map(m=>m.id):undefined);
    if(owner!==me?.user?.id)return;
    personalConnectIssued={...result,owner,modelId:id};personalConnectBusy=false;if(id!=='all')setPersonalModelChoice(id,true);
    try{localStorage.removeItem(modelIntentKey);}catch{}
    if(current!=='personal/connect/'+id)location.hash='personal/connect/'+id;else updatePersonalDashboard();
    const credit=await api('/api/customer-credit/status').catch(()=>null);
    if(owner===me?.user?.id&&credit){paidCredit=credit;if(current==='personal/connect/'+id)updatePersonalDashboard();}
   }
   else if(formId==='live-recharge-confirm'){
    const review=rechargeReview;
    if(!review||review.ticket!==generation)throw Error('请返回充值页重新核对金额。');
    const {scope,orgId,channel,cashFen,promo,quote}=review;
    const same=alipayPay?.pendingKey&&alipayPay.pendingFen===cashFen&&alipayPay.scope===scope&&alipayPay.pendingChannel===channel&&alipayPay.pendingPromo===promo&&alipayPay.pendingQuotedFace===quote.face_fen&&alipayPay.pendingQuotedCash===quote.amount_fen;
    const key=same?alipayPay.pendingKey:crypto.randomUUID();
    alipayPay={scope,pendingKey:key,pendingFen:cashFen,pendingChannel:channel,pendingPromo:promo,pendingQuotedFace:quote.face_fen,pendingQuotedCash:quote.amount_fen,order:alipayPay?.scope===scope?alipayPay.order:null};
    const base=orgId?'/api/billing/organizations/'+encodeURIComponent(orgId):'/api/billing/personal';
    const result=await api(base+'/'+PAY_CHANNELS[channel].path+'-orders',{cash_fen:cashFen,promo_code:promo,expected_cash_fen:quote.amount_fen,expected_face_fen:quote.face_fen,accepted_refund_policy:values.accept_refund_terms?quote.discount_snapshot?.refund_policy_key:undefined,idempotency_key:key});
    alipayPay={scope,order:result.order};
    if(review!==rechargeReview||review.ticket!==generation)return;
    rechargeReview=null;
    document.querySelector('#config-dialog').close();
    if(panelRedraw)panelRedraw();
    alipayWatch();
    if(result.order?.pay_url&&!window.open(result.order.pay_url,'_blank','noopener'))showToast('请允许弹窗，或点击「再次打开支付宝收银台」。');
   }else if(form.dataset.smsPurpose||formId==='live-sms-bind'){
    if(!form.dataset.smsChallenge||form.dataset.smsPhone!==values.phone)throw Error('请先为这个手机号获取验证码。');
    const binding=formId==='live-sms-bind';
    const purpose=binding?'bind':form.dataset.smsPurpose;
    const result=await api('/api/auth/sms/verify',{phone:values.phone,code:values.code,
     challenge:form.dataset.smsChallenge,purpose,newPassword:purpose==='password'?values.newPassword:undefined});
    if(binding){
     document.querySelector('#config-dialog').close();personalSettingsView='overview';panelData.smsBinding={lastFour:result.lastFour};securityPage();showToast('已绑定短信登录手机号。');
    }else if(purpose==='password'){
     panelData.smsBinding={...panelData.smsBinding,hasPassword:true};
     panelData.sessions=null;
     panelData['loading:sessions']=false;
     phonePasswordReset=false;
     redrawPasswordSettings();
     showToast('密码已保存，可以使用手机号和密码登录。');
    }else await route(current);
   }else if(formId==='live-phone-password-login'){
    await api('/api/auth/sms/sign-in-password',values);
    await route(current);
   }else if(formId==='live-auth-form'){
    const emailSignup=authMode==='register'||authMode==='email-register';
    if(emailSignup){
     const password=form.querySelector('[name=password]');
     const toggle=form.querySelector('[data-password-toggle]');
     password.type='password';password.value='';password.setCustomValidity('');
     toggle.textContent='显示';toggle.setAttribute('aria-pressed','false');toggle.setAttribute('aria-label','显示密码');
     const checks=form.querySelector('[data-password-checks]');if(checks)checks.textContent='';
    }
    if(authMode==='recover'){await api('/api/auth/request-password-reset',{email:values.email,redirectTo:location.origin+'/#reset-password'});message.innerHTML=note('如果该邮箱已注册，会收到重设链接。请同时检查垃圾邮件。');}
    else if(emailSignup){await api('/api/auth/sign-up/email',{...values,callbackURL:location.origin+'/'+cwAuthQuery()+'#'+(current.startsWith('join/')?current.replace(/\/apply$/,'')+'/apply':current)});message.innerHTML=verificationHelp(true);}
    else{await api('/api/auth/sign-in/email',{email:values.email,password:values.password});if(current.startsWith('join/')){const next=current.endsWith('/apply')?current:current+'/apply';history.replaceState(null,'',location.pathname+'#'+next);await route(next);}else await route(current);}
   }else if(formId==='live-demo-select'){await api('/api/demo/selections',{model_codes:new FormData(form).getAll('model_codes'),organization_id:demoOrg()});document.querySelector('#config-dialog').close();await demoPage();}
   else if(formId==='live-demo-order'){await api('/api/demo/orders',{amount_yuan:values.amount_yuan,organization_id:demoOrg()});document.querySelector('#config-dialog').close();await demoPage();}
   else if(formId==='live-demo-refund'){await api('/api/demo/refunds',{amount_fen:Math.round(Number(values.amount_yuan)*100),organization_id:demoOrg()});document.querySelector('#config-dialog').close();await demoPage();}
   else if(formId==='live-demo-allocation'){await api('/api/demo/allocations',{...values,model_codes:new FormData(form).getAll('model_codes'),organization_id:demoOrg()});document.querySelector('#config-dialog').close();await demoPage();}
   else if(formId==='live-demo-key'){await api('/api/demo/keys',{label:values.label,model_codes:new FormData(form).getAll('model_codes'),organization_id:demoOrg()});document.querySelector('#config-dialog').close();await demoPage();}
   else if(formId==='live-demo-usage'){await api('/api/demo/keys/'+values.key_id+'/usage',{model_code:values.model_code,input_tokens:values.input_tokens,output_tokens:values.output_tokens,organization_id:demoOrg()});document.querySelector('#config-dialog').close();await demoPage();}
   else if(formId==='live-employee-key-manage'){
    await api('/api/employee-credit/'+(values.scope==='team'?'team/':'')+'keys/'+encodeURIComponent(values.key)+'/manage',{label:values.label,limit_yuan:values.limit_yuan.trim()||null});
    document.querySelector('#config-dialog').close();
    if(lastOrg?.organization?.id)await refreshOrganizationBilling(lastOrg.organization.id,generation);else{employeeCredit=await api('/api/employee-credit/status');updatePersonalDashboard();}showToast('Key 已更新。');
   }
   else if(formId==='live-team-key-limits'){await api('/api/employee-credit/team/keys/'+encodeURIComponent(values.key)+'/limits',{max_concurrent:values.max_concurrent,per_minute:values.per_minute});document.querySelector('#config-dialog').close();await refreshOrganizationBilling(lastOrg.organization.id,generation);showToast('限流已更新。');}
   else if(formId==='live-team-quota'){await api('/api/employee-credit/team/members/'+encodeURIComponent(values.user)+'/quota',{yuan:values.yuan});document.querySelector('#config-dialog').close();await refreshOrganizationBilling(lastOrg.organization.id,generation);showToast('额度已更新。');}
   else if(formId==='live-direct-create'){
    const models=[...directPicked].filter(id=>(employeeCredit?.models||[]).some(m=>m.id===id));if(!models.length)throw Error('请至少勾选一个模型。');
    const result=await api('/api/employee-credit/keys',{label:values.label,models,limit_yuan:values.limit_yuan?.trim()||null});
    directIssued={secret:result.secret,label:result.key.label,models,limit:values.limit_yuan?.trim()||''};
    employeeCredit=await api('/api/employee-credit/status').catch(()=>employeeCredit);redrawKeysOrModels();showToast('Key 已生成，请在第 3 步复制保存。');
   }
   else if(formId==='live-employee-create'){
    const result=await api('/api/employee-credit/keys',{label:values.label});
    employeeIssuedKey={id:result.key.id,secret:result.secret};
    employeeCredit=await api('/api/employee-credit/status').catch(()=>employeeCredit);updatePersonalDashboard();
    host?.querySelector('[data-key-agent-panel]')?.scrollIntoView({block:'nearest'});showToast('Key 已生成，请在第 3 步复制保存。');
   }
   else if(formId==='live-pilot-create'){
    const result=await api('/api/pilot/keys',{label:values.label,model_id:values.model_id,confirm_model:values.confirm_model==='yes'});
    document.querySelector('#config-dialog').close();
    personalPilot=await api('/api/pilot/status');updatePersonalDashboard();
    dialog('平台测试 Key 已创建',keyIssuedGuide({secret:result.secret,baseUrl:personalPilot.base_url,modelIds:[result.key.model_id],note:`这把测试 Key 只能调用此型号，只支持非流式纯文本，最多输入 4000 字符、输出 256 Token，每天最多 ${personalPilot.daily_limit} 次。`}));
   }
   else if(formId==='live-upgrade'){await api('/api/platform/upgrade',{legal_name:values.legal_name,credit_code:values.credit_code,contact_name:values.contact_name,contact_phone:values.contact_phone,confirm_irreversible:values.confirm_irreversible==='yes'});me=await api('/api/platform/me');upgradePage();showToast('申请已提交。');}
   else if(formId==='live-ticket'){await api('/api/support/tickets',{subject:values.subject,body:values.body,category:values.category});supportDraft={category:'question',subject:'',body:''};supportDetail=null;supportPageNumber=0;delete panelData.tickets;delete panelData['loading:tickets'];delete panelData['error:tickets'];pageViews.support='list';await route(current);showToast('工单已提交。');}
   else if(formId==='live-paid-key'){
    const scope=paidScope(),models=new FormData(form).getAll('models'),payload={label:values.label,models,limit_yuan:values.limit_yuan};
    if(values.limit_yuan==='')payload.expected_unallocated_fen=form.dataset.availableFen;
    let result;
    try{result=await api('/api/customer-credit/keys'+scope,payload);}
    catch(err){
     if(err.status===409&&values.limit_yuan===''){
      const updated=await api('/api/customer-credit/status'+scope).catch(()=>null);
      if(updated)form.dataset.availableFen=updated.unallocated_fen;
      else throw Error('无法刷新可分配额度，请重新打开创建窗口后确认。');
     }
     throw err;
    }
    if(!panelOrg){for(const id of result.key.model_ids)setPersonalModelChoice(id,true);try{localStorage.removeItem(modelIntentKey);}catch{}}
    dialog('Key 只显示一次',keyIssuedGuide({secret:result.secret,baseUrl:result.base_url,modelIds:result.key.model_ids,note:`本 Key 消费上限 ¥${Number(result.key.limit_yuan).toFixed(2)}。调用按官网价扣额度。`}));
    // Show the one-time secret even if refreshing the list fails.
    const credit=await api('/api/customer-credit/status'+scope).catch(()=>null);
    if(credit&&paidScope()===scope){
     paidCredit=credit;
     if(panelRedraw)panelRedraw();else updatePersonalDashboard();
    }
   }
   else if(formId==='live-paid-limit'){await api('/api/customer-credit/keys/'+values.key_id+'/limit'+paidScope(),{limit_yuan:values.limit_yuan});document.querySelector('#config-dialog').close();paidCredit=await api('/api/customer-credit/status'+paidScope());if(panelRedraw)panelRedraw();else updatePersonalDashboard();showToast('消费上限已更新。');}
   else if(formId==='live-pack-refund'){
    const r=await api('/api/customer-credit/packs/'+encodeURIComponent(values.pack_id)+'/refund',{
     reason:values.reason,expected_amount_fen:Number(values.amount_fen),idempotency_key:values.request_key
    });
    form.closest('dialog')?.close();
    if(current===refundRoute)await route(refundRoute);
    showToast(r.status==='succeeded'?`已原路退回 ${yuanText(r.amount_fen)}。`:r.status==='failed'?'退款未成功，额度已恢复。':'退款处理中，请稍后刷新进度。');
   }
   else if(formId==='live-bank-transfer'){await api(form.dataset.path,{...values,idempotency_key:form.dataset.key});lastOrgBilling=null;await route(current);showToast('转账信息已提交，请等待财务核对。');}
   else if(formId==='live-invoice'){await api(form.dataset.path,{invoice_type:values.invoice_type,title:values.title,tax_number:values.tax_number,amount_yuan:values.amount_yuan,email:values.email,note:values.note});await route(current);showToast('开票申请已提交，财务开具后会发到收票邮箱。');}
   else if(formId==='live-dept-create'){await api(`/api/platform/organizations/${lastOrg.organization.id}/departments`,{name:values.name});pageViews.settings='departments';await route(current);showToast('部门已添加。');}
   else if(formId==='live-dept-rename'){const r=await api(`/api/platform/organizations/${lastOrg.organization.id}/departments/${values.id}`,{name:values.name},'PATCH');document.querySelector('#config-dialog').close();pageViews.settings='departments';await route(current);showToast(r.merged?'已合并到 '+r.name+'。':'已改名。');}
   else if(formId==='live-member-update'){await api(`/api/platform/organizations/${lastOrg.organization.id}/members/${values.id}`,values,'PATCH');document.querySelector('#config-dialog').close();await route(current);}
   else if(formId==='live-staff-update'){const admin=values.admin==='yes';await api(`/api/staff/members/${encodeURIComponent(values.subject)}`,{role:admin?'platform_admin':values.business==='yes'?'operations':'pending',status:values.status},'PATCH');if(!admin&&values.status==='active'){await api(`/api/staff/members/${encodeURIComponent(values.subject)}/technical-access`,{enabled:values.technical==='yes'},'PUT');await api(`/api/staff/members/${encodeURIComponent(values.subject)}/finance-access`,{enabled:values.finance==='yes'&&values.business==='yes'},'PUT');}document.querySelector('#config-dialog').close();await route(current);}
   else if(formId==='live-supply-supplier'){const created=await api('/api/staff/suppliers',values);document.querySelector('#config-dialog').close();location.hash='ops/supply/'+created.id;}
   else if(formId==='live-supply-supplier-update'){await api('/api/staff/suppliers/'+values.id,values,'PATCH');document.querySelector('#config-dialog').close();await supplierPage(generation);}
   else if(formId==='live-supply-test'){await api('/api/staff/supplier-offers/'+offerDetail.offer.id+'/tests',{...values,observed_at:new Date(values.observed_at).toISOString()});document.querySelector('#config-dialog').close();await supplierPage(generation,offerDetail.offer.id);showToast('测试证据已登记，仍需核验后才可用于发布决策。');}
   else if(formId==='live-supply-validation'){await api('/api/staff/supplier-offers/'+offerDetail.offer.id+'/validations',{...values,window_start:new Date(values.window_start).toISOString(),window_end:new Date(values.window_end).toISOString()});document.querySelector('#config-dialog').close();await supplierPage(generation,offerDetail.offer.id);showToast('验收报告已登记；产品仍不可售。');}
   else if(formId==='live-supply-offer'){const created=await api('/api/staff/supplier-offers',values);document.querySelector('#config-dialog').close();await supplierPage(generation,created.id);}
   else if(formId==='live-supply-product'){await api('/api/staff/model-products',values);document.querySelector('#config-dialog').close();await supplierPage(generation,values.offer_id);showToast('客户商品草稿已保存，尚未上架。');}
   else if(formId==='live-owned-product'){await api('/api/staff/owned-products',values);document.querySelector('#config-dialog').close();await productLandingPage(generation);showToast('自有服务草稿已保存，尚未上架。');}
   else if(formId==='live-product-profile'){await api('/api/staff/model-products/'+encodeURIComponent(values.id)+'/profile',{...values,capability_tags:new FormData(form).getAll('capability_tags')},'PATCH');document.querySelector('#config-dialog').close();await productLandingPage(generation);showToast('型号资料已保存，仍需验证和发布审批。');}
   else if(formId==='live-price-proposal'){await api('/api/staff/price-proposals',values);document.querySelector('#config-dialog').close();await productLandingPage(generation);showToast('价格草稿已保存，尚未审核或公开。');}
   else if(formId==='live-price-decision'){await api('/api/staff/price-proposals/'+encodeURIComponent(values.price_id)+'/decision',{status:values.status,notes:values.notes});document.querySelector('#config-dialog').close();await productLandingPage(generation);showToast('内部价格结论已记录；客户价格和付款仍未开放。');}
   else if(formId==='live-review-request'){await api('/api/staff/model-products/'+encodeURIComponent(values.product_id)+'/reviews',{notes:values.notes});document.querySelector('#config-dialog').close();await productLandingPage(generation);showToast('内部复核已提交，等待独立管理员处理。');}
   else if(formId==='live-review-decision'){await api('/api/staff/model-product-reviews/'+encodeURIComponent(values.review_id)+'/decision',{status:values.status,notes:values.notes});document.querySelector('#config-dialog').close();await productLandingPage(generation);showToast('复核结论已记录；商品仍未公开销售。');}
   else if(formId==='live-promotion'){const payload={...values,starts_at:new Date(values.starts_at).toISOString(),ends_at:new Date(values.ends_at).toISOString()};await api('/api/staff/promotion-campaigns',payload);document.querySelector('#config-dialog').close();await promotionPage(generation);showToast('活动草稿已保存，尚未发布。');}
   else if(formId==='live-supply-offer-update'){await api('/api/staff/supplier-offers/'+values.id,values,'PATCH');document.querySelector('#config-dialog').close();await supplierPage(generation,values.id);}
   else if(formId==='live-supply-check'){await api('/api/staff/supplier-offers/'+offerDetail.offer.id+'/checks/'+values.check_key,values,'PATCH');document.querySelector('#config-dialog').close();await supplierPage(generation,offerDetail.offer.id);}
   else if(formId==='live-password-form'){await api('/api/auth/change-password',{...values,revokeOtherSessions:true});panelData.sessions=null;panelData['loading:sessions']=false;delete panelData['error:sessions'];form.reset();message.innerHTML=note('密码已更新，其他设备已退出。');}
   else if(formId==='live-reset-form'){await api('/api/auth/reset-password',{token:resetToken,newPassword:values.newPassword});resetToken=null;form.reset();message.innerHTML=note('密码已重设，请返回登录。');}
  }catch(err){
   if(formId==='live-auth-form'&&err.code==='ACCOUNT_ALREADY_REGISTERED'){
    message.innerHTML=note('该邮箱已经注册。请直接登录、找回密码，或换个邮箱注册。',true)+registrationActions();
   }else if(formId==='live-sms-register'&&err.code==='SMS_PHONE_ALREADY_REGISTERED'){
    message.innerHTML=note(err.message,true)+btn('去登录','auth-mode','type="button" data-mode="sms"','quiet');
   }else message.innerHTML=note(err.message,true);
  }finally{
   if(formId==='live-model-key')personalConnectBusy=false;
   if(formId==='live-paid-key'&&form.isConnected){delete form.dataset.submitting;updatePaidKeyPreview(form);}
   else button.disabled=false;
  }
 });
 document.addEventListener('change',e=>{if(!e.target.matches('[data-usage-period]')||!['month','week','all'].includes(e.target.value))return;personalUsagePeriod=e.target.value;personalUsagePage=0;loadPersonalUsage();});
 document.addEventListener('input',e=>{if(e.target.closest('#live-model-key'))savePersonalConnectDraft();});
 document.addEventListener('input',e=>{if(!e.target.matches('[data-personal-search]'))return;personalSearch=e.target.value;host?.querySelectorAll('[data-personal-search]').forEach(input=>{if(input!==e.target)input.value=personalSearch;});const rows=personalCatalogRows();const body=host?.querySelector('[data-personal-rows]');if(body)body.innerHTML=rows.html;const count=host?.querySelector('[data-model-count]');if(count)count.textContent=rows.count+' 个模型';});
 document.addEventListener('change',e=>{if(!e.target.matches('[data-agent-tool]'))return;savePersonalConnectDraft();agentToolId=e.target.value;personalModelGuideOpen=Boolean(e.target.closest('.pm-guide')?.open);const panel=host?.querySelector('[data-key-agent-panel]');if(panel&&employeeCredit)panel.outerHTML=employeeKeyPanel(employeeCredit);else updatePersonalDashboard();});
 document.addEventListener('change',e=>{if(!e.target.matches('[data-unified-config-model]'))return;savePersonalConnectDraft();personalUnifiedConfigModel=e.target.value;updatePersonalDashboard();});
 document.addEventListener('change',e=>{if(!e.target.matches('[data-api-model]'))return;personalSelected=e.target.value;chooseModelIntent(personalSelected,'personal');updatePersonalDashboard();});
 document.addEventListener('change',e=>{if(!e.target.matches('[data-employee-key-model]'))return;employeeKeyModel=e.target.value;const panel=host?.querySelector('[data-key-agent-panel]');if(panel&&employeeCredit)panel.outerHTML=employeeKeyPanel(employeeCredit);});
 document.addEventListener('change',e=>{if(!e.target.matches('[data-personal-use]'))return;personalUse=e.target.value;updatePersonalDashboard();});
 document.addEventListener('click',e=>{document.querySelectorAll('.account-menu[open]').forEach(menu=>{if(!menu.contains(e.target)||e.target.closest('a'))menu.open=false;});});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.account-menu[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();});});
 window.addEventListener('focus',()=>{if(!document.body.classList.contains('identity-active'))refreshPublic();});
 let cwLookupVersion=0;
 async function lookupCWOffer(value){
  cwInputCode=value.trim();const version=++cwLookupVersion;cwOfferCode='';cwOfferKind='';
  try{
   const r=cwInputCode?await fetch('/api/cw/offers/'+encodeURIComponent(cwInputCode),{credentials:'same-origin'}):null;
   const offer=r?.ok?await r.json():null;
   if(version!==cwLookupVersion)return;
   if(offer){cwOfferCode=cwInputCode;cwOfferKind=offer.kind||'';}
  }catch{}
  if(version!==cwLookupVersion)return;
  const help=document.querySelector('#cw-offer-help');
  if(help)help.textContent=cwOfferHelp();
}
 document.addEventListener('input',event=>{if(event.target.closest('#live-ticket')&&!panelOrg&&['subject','body','category'].includes(event.target.name))supportDraft[event.target.name]=event.target.value;});
 document.addEventListener('change',event=>{if(event.target.closest('#live-ticket')&&!panelOrg&&event.target.name==='category')supportDraft.category=event.target.value;});
 document.addEventListener('input',event=>{if(event.target.id==='pack-promo'&&host?.querySelector('.personal-billing'))cwInputCode=event.target.value;});
 document.addEventListener('change',event=>{if(event.target.matches('[data-billing-channel]'))payChannel=event.target.value;if(event.target.id==='pack-promo')lookupCWOffer(event.target.value);});
 if(cwInputCode)lookupCWOffer(cwInputCode);
 window.IdentityUI={refreshPublic,chooseModelIntent,customerSignedIn,handles:v=>handles(v)||v.startsWith('staff?'),route,cancel:()=>{personalConnectIssued=null;host?.querySelector('.personal-connect')?.replaceChildren();generation++;lastOrg=null;lastOrgBilling=null;opsPageCache.clear();document.body.classList.remove('identity-route-pending');}};
 function syncQuota(source){
  const form=source.form,range=form?.querySelector('[data-quota-range]'),number=form?.querySelector('[data-quota-number]'),share=form?.querySelector('[data-quota-share]');if(!range||!number)return;
  if(source===range)number.value=Math.max(Number(range.min),Math.round(Number(range.value)*2)/2).toFixed(2);else if(number.value.trim()!==''&&Number.isFinite(Number(number.value)))range.value=number.value;
  const used=Number(range.dataset.used),total=Number(number.value);if(share)share.textContent=used>0&&total>0?`已用占新额度 ${Math.min(100,used/total*100).toFixed(1)}%`:'尚未使用';
 }
 document.addEventListener('input',e=>{if(e.target.matches?.('[data-quota-range],[data-quota-number]'))syncQuota(e.target);});
 function redrawKeysOrModels(){if(panelOrg&&lastOrg)organizationV2(lastOrg);else updatePersonalDashboard();}
 // Ticking a model only updates the button, so typed label and limit stay put.
 document.addEventListener('change',e=>{if(!e.target.matches?.('[data-direct-model]'))return;e.target.checked?directPicked.add(e.target.value):directPicked.delete(e.target.value);e.target.closest('.direct-model')?.classList.toggle('on',e.target.checked);const n=[...document.querySelectorAll('[data-direct-model]:checked')].length,btn=document.querySelector('[data-direct-submit]');if(btn){btn.disabled=!n;btn.innerHTML=`${ico('command')} 生成 API Key · ${n} 个模型`;}});
 // A new sort order starts again from page 1.
 document.addEventListener('table-sorted',e=>{const key=e.detail.group+':page';if((pageViews[key]||1)===1)return;pageViews[key]=1;if(panelRedraw)panelRedraw();else if(panelOrg&&lastOrg)organizationV2(lastOrg);else updatePersonalDashboard();});
 document.addEventListener('change',e=>{if(!e.target.matches('[data-workspace-select]'))return;try{localStorage.setItem(spaceKey,e.target.value);}catch{}location.hash=e.target.value;});
 document.addEventListener('keydown',e=>{if(e.key!=='Enter'||!e.target.closest?.('.pc-global-search')||host?.querySelector('[data-personal-rows]'))return;if(panelOrg&&lastOrg)location.hash='organization/'+lastOrg.organization.id+'/models';else{personalTab='models';if(panelRedraw)location.hash='personal';else updatePersonalDashboard();}});
})();
