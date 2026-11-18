import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../web/site-header.js',import.meta.url),'utf8');
function header(){
 const context=vm.createContext({URL,window:{},document:{currentScript:{src:'https://example.test/site-header.123.js'},querySelector:()=>null,querySelectorAll:()=>[]}});
 vm.runInContext(source,context);return context.window.SiteHeader;
}
test('shared navigation preserves order and marks exactly the active destination',()=>{
 const ui=header();
 for(const active of ['universe','market','skills','docs','workspace']){
  const html=ui.render(active);
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  assert.match(html,/首页<\/a>.*模型广场<\/a>.*Skills 广场<\/a>.*文档<\/a>.*工作台<\/a>/);
  assert.match(html,/href="https:\/\/example.test\/skills\/"/);
 }
});
test('shared account rendering escapes untrusted display names and preserves session kind',()=>{
 const html=header().accountMenu({name:'<img src=x onerror=alert(1)>',email:'a@example.test'},'staff');
 assert.doesNotMatch(html,/<img/);
 assert.match(html,/&lt;img/);
 assert.match(html,/data-session-kind="staff"/);
 assert.match(html,/href="#staff-account"/);
});
test('context tools stay outside global navigation and supplied account replaces the public slot',()=>{
 const html=header().render('workspace',{account:'<b>Account</b>',tools:'<input data-personal-search>'});
 assert.doesNotMatch(html,/data-account-slot/);
 assert.match(html,/<\/nav>.*Account.*site-tools.*data-personal-search/);
});
