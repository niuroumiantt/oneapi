import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createServer} from 'node:http';
import {deflateRawSync} from 'node:zlib';
import {publicAddress,referenceTarget,publicFetch} from '../src/compare-network.mjs';
import {normalizeUsage,consumeCompletion} from '../src/compare-stream.mjs';
import {extractAttachment,sharedMessages} from '../src/compare-files.mjs';
import {docxText} from '../src/compare-docx.mjs';
import {customerCompareRoutes} from '../src/customer-compare.mjs';
import {hash,HttpError} from '../src/core.mjs';

const ownKey='sf_paid_'+'a'.repeat(43),refKey='sk-reference-test-secret',enc=new TextEncoder();
const chunk=(content,finish=null)=>({model:'model-returned',choices:[{delta:{content},finish_reason:finish}]});
function sse(events){return new Response(events.map(e=>'data: '+(typeof e==='string'?e:JSON.stringify(e))+'\r\n\r\n').join(''),{headers:{'content-type':'text/event-stream'}})}
function docx(xml,reportedSize){const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),data=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(data.length,20);central.writeUInt32LE(reportedSize??raw.length,24);central.writeUInt16LE(name.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+data.length,16);return Buffer.concat([local,name,data,central,name,end]);}
test('public transport rejects private, reserved, mapped and mixed DNS destinations',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','192.168.0.1','172.16.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','192.0.2.1','::1','fc00::1','fe80::1','::ffff:8.8.8.8','2001:db8::1','2002:0808:0808::1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
 for(const records of [[{address:'127.0.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]])await assert.rejects(publicFetch('https://example.com/v1/models',{},async()=>records),/公网地址/);
 for(const base_url of ['http://example.com/v1','https://a:b@example.com/v1','https://example.com:8443/v1','https://example.com/v1?key=x','https://example.com/v1#x','https://example.com/v1/chat/completions'])assert.throws(()=>referenceTarget({provider:'custom',base_url}));
 assert.equal(referenceTarget({provider:'glm',base_url:'https://attacker.example'}).base_url,'https://open.bigmodel.cn/api/paas/v4');
});
test('usage distinguishes absent values from real zero and does not double-count cache or reasoning',()=>{
 assert.equal(normalizeUsage(null),null);
 const a=normalizeUsage({prompt_tokens:100,completion_tokens:20,prompt_cache_hit_tokens:80,completion_tokens_details:{reasoning_tokens:10}});
 assert.equal(a.total_tokens,120);assert.equal(a.cached_input_tokens,80);assert.equal(a.reasoning_tokens,10);assert.equal(a.cache_write_tokens,null);
 assert.equal(normalizeUsage({prompt_tokens:0,completion_tokens:0}).cached_input_tokens,null);
 assert.equal(normalizeUsage({prompt_tokens:0,completion_tokens:0,prompt_cache_hit_tokens:0}).cached_input_tokens,0);
 assert.equal(normalizeUsage({prompt_tokens:1,prompt_cache_hit_tokens:2}).cached_input_tokens,null);
});
test('stream parser handles split UTF-8, CRLF, late usage, reasoning and completion',async()=>{
 const raw=enc.encode('data: '+JSON.stringify({model:'actual',choices:[{delta:{reasoning_content:'思考'}}]})+'\r\n\r\n'+[chunk('你好'),chunk('', 'stop'),{choices:[],usage:{prompt_tokens:10,completion_tokens:3}}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+'data: [DONE]\n\n');
 const response=new Response(new ReadableStream({start(c){for(let i=0;i<raw.length;i+=3)c.enqueue(raw.slice(i,i+3));c.close()}}),{headers:{'content-type':'text/event-stream'}}),deltas=[];
 const result=await consumeCompletion(response,{onDelta:d=>deltas.push(d)});assert.equal(result.status,'complete');assert.equal(deltas.map(d=>d.text).join(''),'你好');assert.equal(deltas.map(d=>d.reasoning).join(''),'思考');assert.equal(result.usage.total_tokens,13);assert.notEqual(result.timing.first_text_ms,null);assert.notEqual(result.timing.first_reasoning_ms,null);
});
test('truncated, malformed, incomplete and upstream errors never become successful results',async()=>{
 assert.equal((await consumeCompletion(sse([chunk('partial','length'),'[DONE]']))).status,'truncated');
 assert.equal((await consumeCompletion(sse([chunk('partial')]))).status,'failed');
 assert.equal((await consumeCompletion(sse(['bad-json']))).status,'failed');
 const result=await consumeCompletion(new Response(JSON.stringify({error:{message:'rejected '+refKey}}),{status:401}),{secrets:[refKey]});assert.equal(result.status,'failed');assert.ok(!result.error.includes(refKey));
 const json=await consumeCompletion(Response.json({choices:[{message:{content:'whole'},finish_reason:'stop'}]}));assert.equal(json.status,'complete');assert.match(json.warnings[0],/非流式/);assert.equal(json.usage,null);
});
test('attachments preserve shared text and reject unsupported, oversized and decompression-bomb input',async()=>{
 const text='你好\n100 台服务器';const f=await extractAttachment({name:'报价.txt',data:Buffer.from(text).toString('base64')});assert.equal(f.text,text);assert.equal(f.sha256.length,64);
 assert.deepEqual(sharedMessages('任务','系统',[f]).messages,[{role:'system',content:'系统'},{role:'user',content:'任务\n\n\n附件：报价.txt\n'+text}]);
 await assert.rejects(extractAttachment({name:'a.exe',data:'YWJj'}),/支持/);await assert.rejects(extractAttachment({name:'bad.pdf',data:'YWJj'}),/有效 PDF/);await assert.rejects(extractAttachment({name:'bad.txt',data:Buffer.from([255,255]).toString('base64')}),/UTF-8/);
 const word=docx('<w:document><w:p><w:r><w:t>合同 &amp; 条款</w:t></w:r></w:p></w:document>');assert.equal(docxText(word),'合同 & 条款\n');const extracted=await extractAttachment({name:'contract.docx',data:word.toString('base64')});assert.equal(extracted.text,'合同 & 条款\n');
 assert.throws(()=>docxText(docx('<w:t>'+'x'.repeat(3*1024*1024)+'</w:t>',100)),/larger|大|length/i);
 assert.throws(()=>sharedMessages('x'.repeat(120001),'',[]),/12 万/);
});
function events(raw){return raw.split('\n\n').filter(b=>b.includes('data: ')).map(b=>({event:b.match(/event: (.*)/)?.[1],data:JSON.parse(b.split('data: ')[1])}));}
async function fixture(t,opts={}){
 const seen=[],pool={async query(sql,args){if(sql.includes('request_limits'))return {rows:[{count:1}]};if(sql.includes('SELECT id FROM customer_api_keys'))return {rows:args[0]===hash(ownKey)&&args[1]==='user-a'?[{id:'key-a'}]:[]};if(sql.includes('upstream_model_flags'))return {rows:opts.blocked?[{model_id:'reference-model'}]:[]};if(sql.includes('SELECT status'))return {rows:[]};throw Error('Unexpected fixture SQL');}};
 const app=express();customerCompareRoutes(app,pool,{compareTimeoutMs:opts.timeout||2000,comparePlatformFetch:async(url,init)=>{if(url.endsWith('/models'))return Response.json({data:[{id:'deepseek-flash',capabilities:{input:['text','image']}}]});seen.push({side:'a',body:JSON.parse(init.body)});return sse([chunk('A','stop'),{usage:{prompt_tokens:12,completion_tokens:1}},'[DONE]'])},compareReferenceFetch:async(url,init)=>{seen.push({side:'b',body:init.body&&JSON.parse(init.body)});if(opts.hang){opts.started?.();if(opts.release)await opts.release;else await new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));}return opts.fail?new Response(JSON.stringify({error:{message:'bad '+refKey}}),{status:401}):sse([chunk('B','stop'),'[DONE]'])}},(req,res,next)=>{if(req.get('x-test-user')==='anonymous')return res.status(401).json({error:'请先登录'});req.customer={id:req.get('x-test-user')||'user-a'};next()});
 app.use((e,_req,res,_next)=>res.status(e.status||500).json({error:e.message}));const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()});const origin='http://127.0.0.1:'+server.address().port;
 const request={ours:{key:ownKey,model:'deepseek-flash'},reference:{provider:'custom',base_url:'https://reference.example/v1',model:'reference-model',key:refKey},prompt:'同一任务',system:'系统',attachments:[{name:'a.txt',kind:'text',text:'相同文件内容'}],parameters:{max_tokens:128,temperature:0}};
 const call=async(body=request,user='user-a')=>{const r=await fetch(origin+'/api/compare/run',{method:'POST',headers:{'content-type':'application/json','x-test-user':user},body:JSON.stringify(body)});return {status:r.status,text:await r.text()}};return {seen,request,call,origin};
}
test('comparison forwards equal frozen inputs, permits different names and retains both results',async t=>{
 const f=await fixture(t),r=await f.call();assert.equal(r.status,200,r.text);const es=events(r.text);assert.equal(es.filter(e=>e.event==='result').length,2);assert.equal(es.at(-1).event,'end');assert.equal(f.seen.length,2);
 const {model:a,...ap}=f.seen[0].body,{model:b,...bp}=f.seen[1].body;assert.notEqual(a,b);assert.deepEqual(ap,bp);assert.equal(es.find(e=>e.event==='result'&&e.data.side==='b').data.usage,null);assert.ok(!r.text.includes(ownKey));assert.ok(!r.text.includes(refKey));
});
test('anonymous, cross-owner, invalid images and invalid params cannot make paid requests',async t=>{
 const f=await fixture(t);assert.equal((await f.call(f.request,'anonymous')).status,401);assert.equal((await f.call(f.request,'other')).status,403);assert.equal((await f.call({...f.request,parameters:{max_tokens:999999}})).status,400);assert.equal((await f.call({...f.request,prompt:''})).status,400);assert.equal(f.seen.length,0);
});
test('single-side HTTP failure keeps other result and strips credentials from errors',async t=>{
 const f=await fixture(t,{fail:true}),r=await f.call(),results=events(r.text).filter(e=>e.event==='result').map(e=>e.data);assert.equal(results.find(r=>r.side==='a').status,'complete');assert.equal(results.find(r=>r.side==='b').status,'failed');assert.ok(!r.text.includes(refKey));
});
test('known output-cost quarantine also prevents reference calls',async t=>{
 const f=await fixture(t,{blocked:true}),r=await f.call();assert.equal(f.seen.filter(x=>x.side==='b').length,0);assert.equal(events(r.text).find(e=>e.event==='result'&&e.data.side==='b').data.status,'failed');
});
test('timeout closes only unfinished side; concurrent request does not duplicate spend',async t=>{
 let started,release;const begun=new Promise(r=>started=r),hold=new Promise(r=>release=r);
 const f=await fixture(t,{hang:true,timeout:30000,started,release:hold}),first=f.call();await begun;const second=await f.call();release();assert.equal(second.status,429);await first;assert.equal(f.seen.filter(x=>x.side==='b').length,1);
 const timed=await fixture(t,{hang:true,timeout:80}),r=await timed.call();assert.equal(events(r.text).find(e=>e.event==='result'&&e.data.side==='b').data.status,'timeout');assert.equal(events(r.text).find(e=>e.event==='result'&&e.data.side==='a').data.status,'complete');
});

test('PDF extraction returns actual page text and rejects image-only documents',async()=>{
 const pdf='%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj\n3 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>endobj\n4 0 obj<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>endobj\n5 0 obj<</Length 43>>stream\nBT /F1 12 Tf 20 100 Td (Compare PDF) Tj ET\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF';
 const parsed=await extractAttachment({name:'test.pdf',data:Buffer.from(pdf).toString('base64')});assert.match(parsed.text,/Compare PDF/);assert.equal(parsed.pages,1);
 await assert.rejects(extractAttachment({name:'empty.pdf',data:Buffer.from(pdf.replace('(Compare PDF)','()')).toString('base64')}),/未提取/);
});
