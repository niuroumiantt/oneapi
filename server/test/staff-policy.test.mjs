import test from 'node:test';
import assert from 'node:assert/strict';
import {enforceStaffSurface,isBusinessOwner} from '../src/staff-policy.mjs';
import {hasFinance} from '../src/business-console.mjs';
const employee={subject:'employee-a',role:'operations',status:'active',finance_access:true,technical_access:true};
const request=(route,method='GET',staff=employee,extra={})=>({route:{path:route},method,staff,query:{},params:{},body:{},...extra});
test('all employee roles deny company management even with legacy privilege switches',()=>{
 for(const role of ['operations','support','finance','supply'])for(const path of ['/api/staff/business/finance','/api/staff/business/suppliers','/api/staff/payments/orders','/api/staff/workspace/overview','/api/staff/workspace/business','/api/staff/lab/credentials','/api/staff/audit','/api/staff/members']){
  const staff={...employee,role};assert.equal(hasFinance(staff),false);
  assert.throws(()=>enforceStaffSurface(request(path,'GET',staff)),{status:403});
 }
});
test('employee workflow allows recruitment, own-customer handlers, service and applications',()=>{
 for(const route of ['/api/staff/business/acquisition','/api/staff/business/customers','/api/staff/business/support','/api/staff/cw','/api/staff/cw/:partner'])assert.doesNotThrow(()=>enforceStaffSurface(request(route)));
 for(const route of ['/api/staff/business/customers/:customer/notes','/api/staff/business/tickets/:ticket/reply','/api/staff/cw/invite-codes','/api/staff/cw/:partner/followups','/api/staff/cw/:partner/discount-requests'])assert.doesNotThrow(()=>enforceStaffSurface(request(route,'POST')));
 assert.doesNotThrow(()=>enforceStaffSurface(request('/api/staff/business/discounts','POST',employee,{body:{business_line:'direct'}})));
 assert.throws(()=>enforceStaffSurface(request('/api/staff/business/discounts','POST')), {status:403});
});
test('owner surface, approval decisions, public answer edits and unknown future APIs fail closed',()=>{
 assert.throws(()=>enforceStaffSurface(request('/api/staff/workspace/view','GET',employee,{query:{surface:'owner'}})),{status:403});
 for(const route of ['/api/staff/cw/:partner/owner','/api/staff/cw/:partner/discount-requests/:request/decision','/api/staff/business/answers','/api/staff/future-financial-api'])assert.throws(()=>enforceStaffSurface(request(route,'POST')),{status:403});
 assert.throws(()=>enforceStaffSurface(request('/api/staff/business/discounts/:grant/:action','POST',employee,{params:{action:'approve'}})),{status:403});
});
test('only active owner identity has company capabilities; suspended admin has none',()=>{
 const owner={...employee,role:'platform_admin'};assert.equal(isBusinessOwner(owner),true);assert.equal(hasFinance(owner),true);
 assert.doesNotThrow(()=>enforceStaffSurface(request('/api/staff/business/finance','GET',owner)));
 assert.throws(()=>enforceStaffSurface(request('/api/staff/business/finance','GET',{...owner,status:'suspended'})),{status:403});
});
