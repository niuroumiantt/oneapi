import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');
const account=source.slice(source.indexOf(' async function account('),source.indexOf(' // 同一套页眉和目录'));
function fixture(){
 let rendered;
 const ctx=vm.createContext({me:{user:{id:'test'}},current:'personal',generation:1,personalTab:'keys',panelOrg:null,teamUsage:null,personalSelected:'',personalBilling:null,personalPilot:null,employeeCredit:null,paidCredit:null,panelRedraw:null,
  readModelIntent:()=>null,api:async()=>({enabled:false,keys:[],usage_by_model:[]}),creditActive:()=>false,loadPersonalUsage:async()=>{},personalMoney:()=>'',ico:()=>'',employeeCreditBand:()=>'',panelPage:(_,tab)=>tab,mount:html=>rendered=html,
  comparePanel:()=>'<iframe>',personalDashboardContent:()=>''});
 vm.runInContext(account,ctx);
 return {ctx,rendered:()=>rendered,go:async route=>{ctx.current=route;await vm.runInContext('account(1)',ctx);}};
}
test('overview always renders on the root route after another personal page or browser history navigation',async()=>{
 const f=fixture();
 for(const route of ['personal/keys','personal/models','personal/usage','personal/connect/all','personal/compare']){
  await f.go(route);assert.equal(f.rendered(),route.split('/')[1]);
  await f.go('personal');assert.equal(f.rendered(),'overview');
  await f.go(route);assert.equal(f.rendered(),route.split('/')[1]);
 }
});
test('settings to overview discards the previous personal tab',async()=>{
 const f=fixture();f.ctx.current='security';f.ctx.personalTab='keys';await f.go('personal');assert.equal(f.rendered(),'overview');
});
test('comparison has its own recognized route so returning home does not depend on retained tab state',()=>{
 const ctx=vm.createContext({personalBillingRoute:()=>false});
 vm.runInContext(source.slice(source.indexOf(' const handles='),source.indexOf(' let orgLoadedAt=')),ctx);
 assert.equal(vm.runInContext("handles('personal/compare')",ctx),true);
});
