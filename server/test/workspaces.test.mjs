import test from 'node:test';
import assert from 'node:assert/strict';
import {requireTechnical,requireBusiness,acceptanceResult} from '../src/workspaces.mjs';
test('technical access is explicit and independent from a business role',()=>{
 assert.throws(()=>requireTechnical({staff:{role:'supply',status:'active'}}),/技术运维权限/);
 assert.throws(()=>requireTechnical({staff:{role:'platform_admin',status:'suspended'}}));
 assert.doesNotThrow(()=>requireTechnical({staff:{role:'support',status:'active',technical_access:true}}));
 assert.doesNotThrow(()=>requireBusiness({staff:{role:'supply',status:'active'}}));
 assert.throws(()=>requireBusiness({staff:{role:'pending',status:'pending'}}));
});
test('acceptance cannot confuse missing accounting evidence with a passing report',()=>{
 const ids=['arithmetic','json','chinese','context'],run={status:'completed',case_ids:ids};
 const tx=ids.map(case_id=>({case_id,created_at:'2026-11-10T01:00:00Z',quality_score:100,error_code:null,estimated_cost_yuan:'0.0001',checks:{usage_present_and_consistent:true,model_matches_request:true}}));
 const bill={period_start:'2026-11-10T00:00:00Z',period_end:'2026-11-10T02:00:00Z',difference_yuan:'0.000000000000'};
 assert.equal(acceptanceResult(run,tx,null).conclusion,'inconclusive');
 assert.equal(acceptanceResult(run,tx,bill).conclusion,'passed');
 assert.equal(acceptanceResult(run,tx,{...bill,difference_yuan:'0.000000000001'}).usage,'mismatched');
 assert.equal(acceptanceResult(run,tx,{...bill,period_end:'2026-11-10T00:30:00Z'}).conclusion,'inconclusive');
 assert.throws(()=>acceptanceResult(run,tx.slice(0,3),bill));
 assert.throws(()=>acceptanceResult(run,[tx[0],tx[0],tx[2],tx[3]],bill));
 assert.equal(acceptanceResult(run,[{...tx[0],checks:{model_matches_request:false}},...tx.slice(1)],bill).conclusion,'failed');
});
