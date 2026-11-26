import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../private/workspace.js',import.meta.url),'utf8');
const settle=()=>new Promise(r=>setImmediate(r));
function app(fetch){
 const nodes=new Map(),events={},location={hash:'#transfers',origin:'https://test.invalid'},parent={};
 const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',classList:{toggle(){}}});return nodes.get(s)};
 const context=vm.createContext({fetch,AbortSignal,location,parent,document:{body:node('body'),querySelector:node,addEventListener(){}},addEventListener:(k,f)=>events[k]=f});
 vm.runInContext(source,context);return {nodes,events,location,parent,html:()=>node('#content').innerHTML};
}
const summary={staff:{finance:true,technical:true},counts:{}};
const record={entries:[{id:'test-entry',customer_name:'Test company',customer_kind:'enterprise',customer_code:'E-test',cash_fen:1,face_fen:1,status:'approved',created_by:'admin',decided_by:'admin',decision_role:'platform_admin',created_by_name:'Test admin',decided_by_name:'Test admin',decided_at:'2026-11-16T08:41:01Z',decision_note:'Verified bank receipt'}]};
const response=data=>({ok:true,json:async()=>data});
test('transfer page and refresh never wait for unrelated finance statistics',async()=>{
 const paths=[];let current=record;
 const a=app(async p=>{paths.push(p);if(p.endsWith('?summary=1'))return response(summary);if(p.endsWith('bank-transfers'))return response(current);return new Promise(()=>{});});
 await settle();assert.match(a.html(),/¥0.01/);assert.match(a.html(),/管理员本人复核/);assert.match(a.html(),/Verified bank receipt/);
 assert.deepEqual(paths,['/api/staff/business/dashboard?summary=1','/api/staff/business/bank-transfers']);
 current={entries:[]};a.events.message({origin:a.location.origin,source:a.parent,data:{type:'workspace-navigate'}});await settle();assert.match(a.html(),/还没有对公转账登记/);assert.doesNotMatch(a.html(),/Verified bank receipt/);
});
test('failed transfer reads show an error instead of stale or empty accounting data',async()=>{
 const a=app(async p=>p.endsWith('?summary=1')?response(summary):{ok:false,status:503,json:async()=>({})});
 await settle();assert.match(a.html(),/503/);assert.match(a.html(),/刷新重试/);assert.doesNotMatch(a.html(),/还没有对公转账登记/);
});
test('an old in-flight transfer request cannot overwrite a newer refresh',async()=>{
 let finish,reads=0;const a=app(async p=>p.endsWith('?summary=1')?response(summary):++reads===1?new Promise(r=>finish=r):response(record));
 await settle();a.events.message({origin:a.location.origin,source:a.parent,data:{type:'workspace-navigate'}});await settle();assert.match(a.html(),/¥0.01/);
 finish(response({entries:[]}));await settle();assert.match(a.html(),/¥0.01/);
});
test('navigation away from a slow overview immediately loads transfers',async()=>{
 const paths=[];const a=app(async p=>{paths.push(p);if(p.endsWith('?summary=1'))return response(summary);if(p.endsWith('bank-transfers'))return response(record);return new Promise(()=>{});});
 await settle();a.location.hash='#overview';a.events.hashchange();await settle();assert.match(a.html(),/正在读取/);
 a.location.hash='#transfers';a.events.hashchange();await settle();assert.match(a.html(),/Verified bank receipt/);assert.ok(paths.includes('/api/staff/business/dashboard'));
});
test('expired staff authentication does not expose cached transfer records',async()=>{
 let expired=false;const a=app(async p=>expired?{ok:false,status:401,json:async()=>({error:'请重新登录'})}:response(p.endsWith('?summary=1')?summary:record));
 await settle();expired=true;a.events.message({origin:a.location.origin,source:a.parent,data:{type:'workspace-navigate'}});await settle();assert.match(a.html(),/请重新登录/);assert.doesNotMatch(a.html(),/Verified bank receipt/);
});
