/* Data adapter only. All API pages and actions are rendered by identity.js. */
(() => {
 'use strict';
 let status;
 const fen = value => String(Math.max(0, Math.floor((Number(value) || 0) * 100 + 1e-7)));
 const normalize = data => {
  status=data;
  return {...data, list_credit_fen:fen(data.available_yuan), unallocated_fen:fen(data.available_yuan), held_fen:'0',
   models:data.models||[], keys:(data.keys||[]).map(key=>({...key,model_ids:key.model_ids||data.model_ids||[]}))};
 };
 window.EmployeeApiContext={
  normalize,
  get status(){return status;},
  billing:data=>({list_credit_fen:fen(data.available_yuan),total_spent_fen:fen(data.spent_yuan),payments_enabled:false}),
  async request(path,body,method){
   if(!/^\/api\/customer-credit\/(?:status|usage(?:\/calls)?(?:\?.*)?|keys(?:\/[^/?]+\/(?:limit|revoke))?)$/.test(path))throw Error('员工 API 仅使用公司分配额度。');
   let target=path.replace('/api/customer-credit/','/api/staff/self-api/');
   if(target.endsWith('/limit')){
    const id=target.split('/').at(-2),key=status?.keys?.find(k=>k.id===id);
    if(!key)throw Error('密钥状态已变化，请刷新后重试。');
    target=target.replace(/\/limit$/,'/manage');body={...body,label:key.label};
   }
   const response=await fetch(target,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'});
   const data=await response.json();
   if(!response.ok){const error=Error(data.error||data.message||'暂时无法完成，请稍后重试。');error.status=response.status;throw error;}
   return path==='/api/customer-credit/status'?normalize(data):data;
  }
 };
})();
