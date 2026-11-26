import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../private/workspace.js',import.meta.url),'utf8');
const settle=()=>new Promise(r=>setImmediate(r));
function app(fetch,search='?surface=owner'){
 const nodes=new Map(),events={},domEvents={},location={search,hash:'#transfers',origin:'https://test.invalid'},parent={};
 const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',classList:{toggle(){}}});return nodes.get(s)};
 const context=vm.createContext({fetch,AbortSignal,URLSearchParams,location,parent,document:{body:node('body'),querySelector:node,addEventListener:(k,f)=>domEvents[k]=f},addEventListener:(k,f)=>events[k]=f});
 vm.runInContext(readFileSync(new URL('../../web/staff-api.js',import.meta.url),'utf8'),context);
 vm.runInContext(source,context);return {nodes,events,domEvents,location,parent,html:()=>node('#content').innerHTML};
}
const summary={staff:{finance:true,technical:true,admin:true,role:'platform_admin'},counts:{}};
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
test('employee home loads only summary and support, not company financial aggregates',async()=>{
 const paths=[];
 const a=app(async p=>{paths.push(p);return response(p.includes('dashboard')?{staff:{role:'support',name:'客服',finance:false},counts:{tickets:1,invoices_requested:8}}:p.endsWith('bank-transfers')?record:{tickets:[],answers:[]});},'');
 await settle();paths.length=0;a.location.hash='#home';a.events.hashchange();await settle();
 assert.match(a.html(),/待处理工单/);assert.doesNotMatch(a.html(),/发票申请待处理/);
 assert.deepEqual(paths,['/api/staff/business/support']);
});
test('employee home distinguishes a failed support read from an empty queue',async()=>{
 const a=app(async p=>p.includes('dashboard')?response(summary):p.endsWith('bank-transfers')?response(record):{ok:false,status:503,json:async()=>({})});
 await settle();a.location.hash='#home';a.events.hashchange();await settle();
 assert.match(a.html(),/503/);assert.doesNotMatch(a.html(),/目前没有未结工单/);
});
test('employee home never shows company tasks even with legacy finance flags and escapes content',async()=>{
 const a=app(async p=>response(p.includes('dashboard')?{staff:{role:'finance',finance:true,name:'财务'},counts:{tickets:2,bank_transfers_pending:1}}:p.endsWith('bank-transfers')?record:{tickets:[{id:'t1',subject:'<script>bad()</script>',name:'Example',status:'open',created_at:'2026-11-26',tier:'first_line'}]}),'');
 await settle();a.location.hash='#home';a.events.hashchange();await settle();
 assert.doesNotMatch(a.html(),/对公到账待复核|经营损益|上游供应商/);assert.match(a.html(),/客户推广/);
 assert.match(a.html(),/&lt;script&gt;/);assert.doesNotMatch(a.html(),/<script>/);
});

test('employee promotion channels keep overview, codes and applications separate',async()=>{
 const data={invite_codes:[{code:'VIP_INVITE',max_uses:5,used_count:1,status:'active'}],owners:[],partners:[{id:'vip1',legal_name:'VIP_ONLY',status:'confirmed',discount_pending:1,owner_subject:'me'}],codes:[{id:'code1',partner_id:'vip1',legal_name:'VIP_ONLY',code:'VIP_CODE',state:'active',customer_price_percent:50,commission_bps:1000}],vip_orders:[],grants:[{id:'g1',promo_code:'CUSTOMER_CODE',name:'Customer grant',status:'pending',state:'pending',customer_price_percent:40,created_by:'me'}],orders:[{account_id:'a1',customer_name:'CUSTOMER_ONLY',promo_code:'CUSTOMER_CODE',status:'paid',amount_fen:10000,created_by:'me'}]};
 const a=app(async p=>response(p.includes('dashboard')?{staff:{role:'operations',admin:false},counts:{}}:data),'');
 await settle();
 for(const page of ['customeroverview','direct','customerapplications']){a.location.hash='#'+page;a.events.hashchange();await settle();assert.match(a.html(),/CUSTOMER_CODE/);assert.doesNotMatch(a.html(),/VIP_ONLY|VIP_CODE|商务管理/);}
 for(const page of ['vipoverview','promotions','vipapplications']){a.location.hash='#'+page;a.events.hashchange();await settle();assert.match(a.html(),/VIP_ONLY/);assert.doesNotMatch(a.html(),/CUSTOMER_ONLY|CUSTOMER_CODE|商务管理/);}
 a.location.hash='#vipcodes';a.events.hashchange();await settle();assert.match(a.html(),/VIP_INVITE/);assert.doesNotMatch(a.html(),/CUSTOMER_CODE|VIP_CODE/);
 const nav=a.nodes.get('#nav').innerHTML;assert.match(nav,/<summary>客户推广<\/summary>/);assert.match(nav,/<summary>VIP推广<\/summary>/);assert.doesNotMatch(nav,/招揽/);
 a.location.hash='#approvals';a.events.hashchange();await settle();assert.match(a.html(),/CUSTOMER_CODE/);assert.doesNotMatch(a.html(),/VIP_ONLY/);
});

test('navigation retains manual group collapse when pages change',async()=>{
 const a=app(async p=>response(p.includes('dashboard')?{staff:{role:'operations'},counts:{}}:{grants:[],orders:[],partners:[],codes:[],vip_orders:[]}),'');await settle();
 const group={matches:()=>true,isConnected:true,dataset:{navGroup:'客户推广'},open:false};
 a.domEvents.toggle({target:group});a.location.hash='#direct';a.events.hashchange();await settle();
 assert.match(a.nodes.get('#nav').innerHTML,/data-nav-group="客户推广" ><summary>/);
 assert.match(a.nodes.get('#nav').innerHTML,/data-nav-group="VIP推广" ><summary>/);
 group.open=true;a.domEvents.toggle({target:group});a.location.hash='#vipoverview';a.events.hashchange();await settle();
 assert.match(a.nodes.get('#nav').innerHTML,/data-nav-group="客户推广" open/);
 a.location.hash='#direct';a.events.hashchange();await settle();assert.match(a.nodes.get('#nav').innerHTML,/data-nav-group="客户推广" open/);
});
test('employee API pages show company allowance and never purchase or payment controls',async()=>{
 const data={enabled:true,organization_name:'Test company',granted_yuan:50,spent_yuan:10,held_yuan:2,available_yuan:38,models:[{id:'test-model',name:'Test model',tags:['对话'],input_yuan:1,output_yuan:2}],base_url:'https://test.invalid/v1',keys:[],recent_calls:[],daily:[],key_limit:5};
 const paths=[],a=app(async p=>{paths.push(p);return response(p.includes('dashboard')?{staff:{role:'operations'},counts:{}}:data)},'');await settle();
 for(const page of ['apioverview','apimodels','apikeys','apiusage']){a.location.hash='#'+page;a.events.hashchange();await settle();assert.match(a.html(),/公司分配额度/);assert.doesNotMatch(a.html(),/充值|购买|支付|退款|billing\/personal/);}
 assert.ok(paths.includes('/api/staff/self-api/status'));assert.ok(paths.every(p=>!p.includes('customer-credit')));
});
