import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');

function identityPage(hash){
 const requests=[],toasts=[],clicks=[];
 const account={innerHTML:'Signed in'};
 const menu={open:true,removeAttribute(name){if(name==='open')this.open=false;}};
 const document={
  addEventListener(name,handler){if(name==='click')clicks.push(handler);},
  getElementById:()=>null,
  querySelector:()=>null,
  querySelectorAll(selector){
   if(selector==='[data-account-slot]')return [account];
   if(selector==='.account-menu')return [menu];
   return [];
  }
 };
 const location=new URL('https://semifly.example/'+hash);
 const context={
  window:{
   NavigationData:{create:()=>({clear(){}})},
   SiteHeader:{accountMenu:user=>user?'Signed in':'Sign in'},
   matchMedia:()=>({addEventListener(){}}),
   addEventListener(){}
  },
  document,location,URL,URLSearchParams,
  confirm:()=>true,
  showToast:message=>toasts.push(message),
  fetch:async (path,options)=>{
   requests.push([path,options.method]);
   return {ok:true,status:200,json:async()=>({})};
  }
 };
 vm.runInNewContext(source,context);
 return {
  requests,toasts,account,menu,location,
  async click(dataset){
   const button={dataset,disabled:false};
   for(const handler of clicks)await handler({target:{closest:selector=>selector==='[data-live]'?button:null}});
   assert.equal(button.disabled,false);
  }
 };
}

for(const [sessionKind,hash,path] of [
 ['staff','#staff-account','/api/staff/logout'],
 ['customer','#personal','/api/auth/sign-out']
]){
 test(`${sessionKind} logout updates the account menu and leaves the workspace`,async()=>{
  const page=identityPage(hash);
  await page.click({live:'logout',sessionKind});
  assert.deepEqual(page.requests,[[path,'POST']]);
  assert.deepEqual(page.toasts,[]);
  assert.equal(page.account.innerHTML,'Sign in');
  assert.equal(page.menu.open,false);
  assert.equal(page.location.hash,'#universe');
 });
}

test('revoking an employee API key refreshes the remaining keys',async()=>{
 const page=identityPage('#organization/company/keys');
 await page.click({live:'employee-revoke',id:'key-id'});
 assert.deepEqual(page.requests,[
  ['/api/employee-credit/keys/key-id/revoke','POST'],
  ['/api/employee-credit/status','GET']
 ]);
 assert.deepEqual(page.toasts,['Key 已停用。']);
});
