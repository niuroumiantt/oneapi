import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');
const frameCode=source.slice(source.indexOf(' function sameWorkspaceFrame('),source.indexOf(' function mount('));
const same=vm.runInNewContext(frameCode+';sameWorkspaceFrame');
const stage=src=>({querySelector:()=>src?{getAttribute:()=>src}:null});
test('comparison and VIP replace each other while a same-page refresh preserves the frame',()=>{
 const compare='/compare.html?embedded=1&personal=1',vip='/promotion/vip.html?embedded=1&personal=1';
 assert.equal(same(stage(compare),stage(vip)),false);
 assert.equal(same(stage(vip),stage(compare)),false);
 assert.equal(same(stage(compare),stage(compare)),true);
 assert.equal(same(stage(vip),stage(null)),false);
});
const updateCode=source.slice(source.indexOf(' function updatePersonalDashboard('),source.indexOf(' async function account('));
test('late usage requests never paint over billing, settings, VIP or a pending route change',()=>{
 for(const [current,hash] of [['billing/personal','#billing/personal'],['security','#security'],['personal/vip','#personal/vip'],['personal/usage','#billing/personal']]){
  let reads=0;vm.runInNewContext(updateCode+';updatePersonalDashboard()',{current,location:{hash},panelOrg:null,personalTab:'usage',host:{querySelector(){reads++;throw Error('stale view touched');}}});
  assert.equal(reads,0);
 }
});
test('active usage requests still update their own content',()=>{
 let rendered=0,synced=0;const content={querySelector:()=>null};
 vm.runInNewContext(updateCode+';updatePersonalDashboard()',{current:'personal/usage',location:{hash:'#personal/usage'},panelOrg:null,personalTab:'usage',host:{querySelector:s=>s==='[data-personal-content]'?content:null,querySelectorAll:()=>[]},personalDashboardContent:()=>'<h1>用量</h1>',replacePanelContent:()=>rendered++,syncPersonalUsageCharts:()=>synced++});
 assert.equal(rendered,1);assert.equal(synced,1);
});
