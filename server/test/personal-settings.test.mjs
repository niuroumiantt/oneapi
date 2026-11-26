import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf(" let personalSettingsView="),source.indexOf(' function settingsContent('));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render({user={},panel={},view='overview',page=0,phone=true,password=true}={}){
 const ctx=vm.createContext({me:{user:{name:'<Alice>',email:'alice@example.test',...user},organizations:[]},panelData:{sessions:[],smsBinding:{lastFour:'1234',hasPassword:true},...panel},phoneLoginAvailable:phone,phonePasswordAvailable:password,ico:()=>'',esc,panelLoading:'正在读取…'});
 vm.runInContext(code,ctx);ctx.view=view;ctx.page=page;
 return vm.runInContext('personalSettingsView=view;personalSettingsPage=page;personalSettingsContent()',ctx);
}
test('settings overview keeps facts escaped and security forms behind explicit actions',()=>{
 const html=render();assert.match(html,/&lt;Alice&gt;/);assert.match(html,/alice@example.test/);assert.match(html,/修改密码/);assert.doesNotMatch(html,/<form|Mozilla|settings-avatar/);
});
test('phone accounts do not show synthetic emails or unsupported phone replacement',()=>{
 const html=render({user:{phoneOnly:true,email:'private-synthetic@example.test'},panel:{smsBinding:{lastFour:'5678',hasPassword:false}}});
 assert.doesNotMatch(html,/private-synthetic|登录邮箱|data-settings-view="phone"/);assert.match(html,/设置密码/);
 assert.doesNotMatch(render({user:{phoneOnly:true},password:false}),/data-settings-view="password"/);
 assert.match(render({panel:{smsBinding:null,'error:smsBinding':'network'}}),/data-kind="smsBinding"/);
});
test('device pagination keeps every session reachable and does not emit raw user agent strings',()=>{
 const sessions=Array.from({length:7},(_,i)=>({userAgent:'<script>secret</script> Chrome/140 Macintosh',createdAt:new Date(2026,10,i+1).toISOString()}));
 const first=render({view:'devices',panel:{sessions}}),last=render({view:'devices',page:99,panel:{sessions}});
 assert.equal((first.match(/<li>/g)||[]).length,3);assert.equal((last.match(/<li>/g)||[]).length,1);assert.match(last,/3 \/ 3/);assert.doesNotMatch(first,/secret|<script>/);assert.match(first,/Chrome · macOS/);
 assert.match(render({view:'devices',panel:{sessions:null,'error:sessions':'network'}}),/data-kind="sessions"/);
});
