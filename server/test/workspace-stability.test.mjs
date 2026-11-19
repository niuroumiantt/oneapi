import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../../web/'+name,import.meta.url),'utf8');
test('embedded comparison is selected before deferred app scripts or styles load',()=>{
 const html=read('compare.html');
 assert.ok(html.indexOf('src="compare-mode.js"')<html.indexOf('rel="stylesheet"'));
 for(const [search,expected] of [['?embedded=1',true],['',false],['?embedded=0',false]]){
  const classes=new Set();vm.runInNewContext(read('compare-mode.js'),{URLSearchParams,location:{search},document:{documentElement:{classList:{add:value=>classes.add(value)}}}});
  assert.equal(classes.has('compare-embedded'),expected);
 }
});
test('model content refresh retains container and nested scroll positions',()=>{
 const source=read('identity.js'),start=source.indexOf(' function replacePanelContent('),end=source.indexOf(' function updatePersonalDashboard(',start);
 let html='old';const child={scrollTop:90,scrollLeft:120};
 const target={scrollTop:80,scrollLeft:10,matches:()=>false,querySelectorAll:s=>s==='.personal-table-wrap'?[child]:[],get innerHTML(){return html},set innerHTML(v){html=v;this.scrollTop=0;this.scrollLeft=0;child.scrollTop=0;child.scrollLeft=0}};
 const context=vm.createContext({target});vm.runInContext(source.slice(start,end)+';replacePanelContent(target,"new");',context);
 assert.equal(target.innerHTML,'new');assert.equal(target.scrollTop,80);assert.equal(target.scrollLeft,10);assert.equal(child.scrollTop,90);assert.equal(child.scrollLeft,120);
});
