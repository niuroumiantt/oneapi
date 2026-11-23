import assert from 'node:assert/strict';
import test from 'node:test';
import {pnvsSms} from '../src/sms-auth.mjs';

test('PNVS signs requests with cached IMDSv2 role credentials and uses the binding template',async()=>{
 const calls=[];
 const mock=async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/api/token'))return new Response('test-imds-token');
  if(url.includes('/security-credentials/'))return Response.json({
   Code:'Success',AccessKeyId:'temporary-key',AccessKeySecret:'temporary-secret',SecurityToken:'temporary-token',
   Expiration:new Date(Date.now()+3600000).toISOString(),
  });
  const body=new URLSearchParams(options.body);
  return Response.json({Code:'OK',Success:true,Model:{OutId:body.get('OutId'),VerifyResult:'PASS'}});
 };
 const sms=pnvsSms({roleName:'oneapi-shanghai-pnvs',signName:'测试签名',templateCode:'100001',bindTemplateCode:'100004'},mock);
 assert.equal(await sms.send('19900000047','binding-test','bind'),true);
 assert.equal(await sms.verify('19900000047','binding-test','123456'),true);
 assert.equal(calls.length,4);
 assert.deepEqual(calls.slice(0,2).map(c=>c.url),[
  'http://100.100.100.200/latest/api/token',
  'http://100.100.100.200/latest/meta-data/ram/security-credentials/oneapi-shanghai-pnvs',
 ]);
 assert.equal(calls[0].options.method,'PUT');
 assert.equal(calls[1].options.headers['X-aliyun-ecs-metadata-token'],'test-imds-token');
 const sent=new URLSearchParams(calls[2].options.body),verified=new URLSearchParams(calls[3].options.body);
 assert.equal(sent.get('TemplateCode'),'100004');
 assert.equal(sent.get('ReturnVerifyCode'),'false');
 for(const request of [sent,verified]){
  assert.equal(request.get('AccessKeyId'),'temporary-key');
  assert.equal(request.get('SecurityToken'),'temporary-token');
  assert.ok(request.get('Signature'));
  assert.equal(request.has('AccessKeySecret'),false);
 }
});

test('unavailable IMDSv2 credentials prevent cloud SMS requests',async()=>{
 let calls=0;
 const sms=pnvsSms({roleName:'oneapi-shanghai-pnvs'},async(url)=>{
  calls++;
  assert.equal(url,'http://100.100.100.200/latest/api/token');
  return new Response(null,{status:401});
 });
 await assert.rejects(sms.send('19900000047','binding-test','bind'),/metadata token unavailable/);
 assert.equal(calls,1);
});
