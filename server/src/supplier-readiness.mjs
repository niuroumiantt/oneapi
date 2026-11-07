export const supplierCheckLabels = Object.freeze({
 source:'供应来源',sales_rights:'服务与销售范围',model_version:'模型版本',
 protocol:'协议与能力',data_region:'数据处理地区',usage_billing:'用量与账单',capacity:'容量与限额'
});

export function supplierReadiness(offer,checks){
 const byKey=new Map(checks.map(check=>[check.check_key,check]));
 const missing=[],issues=[];
 for(const [key,label] of Object.entries(supplierCheckLabels)){
  const check=byKey.get(key);
  if(check?.result==='issue')issues.push(label);
  else if(check?.result!=='documented'||!check.evidence_url)missing.push(label);
 }
 const documented=Object.keys(supplierCheckLabels).length-missing.length-issues.length;
 const paused=offer.status==='blocked'||offer.supplier_status==='blocked';
 return {
  documented,total:7,missing,issues,paused,
  documents_complete:documented===7&&!paused,
  technical_verified:false,commercial_approved:false,sale_ready:false,
  next_step:paused?'先处理暂停状态':issues.length?'先解决核验问题':missing.length?'补齐资料与证据':'资料齐全；仍需真实接口探测、合同与价格审批'
 };
}
