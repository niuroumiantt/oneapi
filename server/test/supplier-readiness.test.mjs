import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierCheckLabels,supplierReadiness } from '../src/supplier-readiness.mjs';

const allChecks=Object.keys(supplierCheckLabels).map(check_key=>({check_key,result:'documented',evidence_url:'https://example.test/evidence'}));

test('supplier documents never imply approval to sell',()=>{
 const state=supplierReadiness({status:'reviewing',supplier_status:'reviewing'},allChecks);
 assert.equal(state.documented,7);
 assert.equal(state.documents_complete,true);
 assert.equal(state.technical_verified,false);
 assert.equal(state.sale_ready,false);
});

test('missing, disputed and paused evidence produce explicit next actions',()=>{
 const checks=allChecks.slice(2);
 checks[0]={...checks[0],result:'issue'};
 const state=supplierReadiness({status:'draft',supplier_status:'candidate'},checks);
 assert.equal(state.documented,4);
 assert.equal(state.issues.length,1);
 assert.equal(state.missing.length,2);
 assert.match(state.next_step,/解决核验问题/);
 const paused=supplierReadiness({status:'blocked',supplier_status:'candidate'},allChecks);
 assert.equal(paused.documents_complete,false);
 assert.match(paused.next_step,/暂停/);
});
