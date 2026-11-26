import {HttpError} from './core.mjs';

export const isBusinessOwner = staff => staff?.status === 'active' && staff.role === 'platform_admin';
// Employee access is an allowlist. Historic finance/technical switches do not widen it.
const employeeReads = new Set([
 '/api/staff/self-api/status','/api/staff/self-api/compare/config',
 '/api/staff/me','/api/staff/customers','/api/staff/console','/api/staff/console.js',
 '/api/staff/select-menu.js','/api/staff/table-sort.js',
 '/api/staff/workspace/console','/api/staff/workspace/console.js','/api/staff/workspace/view','/api/staff/workspace/bridge.js','/api/staff/workspace/access',
 '/api/staff/business/dashboard','/api/staff/business/acquisition','/api/staff/business/direct-codes/:grant/qr',
 '/api/staff/business/customers','/api/staff/business/customers/:customer','/api/staff/business/support',
 '/api/staff/cw','/api/staff/cw/order-lookup','/api/staff/cw/:partner'
]);
const employeeWrites = new Set([
 '/api/staff/self-api/keys','/api/staff/self-api/keys/:key/manage','/api/staff/self-api/keys/:key/revoke',
 '/api/staff/self-api/compare/models','/api/staff/self-api/compare/attachment','/api/staff/self-api/compare/run',
 '/api/staff/business/customers/:customer','/api/staff/business/customers/:customer/notes',
 '/api/staff/business/tickets/:ticket/reply','/api/staff/business/tickets/:ticket/triage',
 '/api/staff/cw/invite-codes','/api/staff/cw/invite-codes/:code/status',
 '/api/staff/cw/:partner/followups','/api/staff/cw/:partner/confirm','/api/staff/cw/:partner/activate',
 '/api/staff/cw/:partner/activation-exceptions','/api/staff/cw/:partner/task-code','/api/staff/cw/:partner/discount-requests'
]);
export function enforceStaffSurface(req) {
 if(isBusinessOwner(req.staff))return;
 const route=req.route?.path||(req.baseUrl+req.path),method=req.method==='HEAD'?'GET':req.method;
 if(route==='/api/staff/me')return;
 if(req.staff?.status!=='active'||req.staff.role==='pending')throw new HttpError(403,'员工工作台尚未授权');
 if(req.query?.surface==='owner')throw new HttpError(403,'老板工作台需要独立的老板身份');
 if(method==='GET'&&employeeReads.has(route))return;
 if(method==='POST'&&employeeWrites.has(route))return;
 if(method==='POST'&&route==='/api/staff/business/discounts'&&req.body?.business_line==='direct')return;
 if(method==='POST'&&route==='/api/staff/business/discounts/:grant/:action'&&req.params?.action==='revoke')return;
 if(method==='POST'&&route==='/api/staff/cw/:partner/private'&&req.body?.scope==='contact')return;
 throw new HttpError(403,'员工仅可招揽客户、跟进 VIP 和服务自己负责的客户；此操作需要老板身份');
}
export const customerScope = (alias='c',owner='$1',subject='$2') => `(${owner}::boolean OR ${alias}.owner_subject=${subject})`;
// Tickets are personal-account scoped in the current schema. Owning an enterprise
// does not expose its members' unrelated personal tickets.
export const ticketScope = (alias='t',owner='$1',subject='$2') => `(${owner}::boolean OR EXISTS (SELECT 1 FROM customers scope_customer WHERE scope_customer.user_id=${alias}.user_id AND scope_customer.owner_subject=${subject}))`;
export async function lockOwnedCustomer(db,staff,customerId) {
 const row=(await db.query(`SELECT id,owner_subject FROM customers c WHERE c.id=$1 AND ${customerScope('c','$2','$3')} FOR SHARE`,[customerId,isBusinessOwner(staff),staff.subject])).rows[0];
 if(!row)throw new HttpError(404,'客户不存在或不在你的负责范围内');
 return row;
}
