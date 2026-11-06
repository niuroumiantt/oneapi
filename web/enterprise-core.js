/* Pure, in-memory design-preview rules. Not authentication or a production ledger. */
(function (root) {
  'use strict';
  const roles = {
    owner: {label:'企业所有者', scope:'all', manage:true, appoint:true},
    admin: {label:'企业管理员', scope:'all', manage:true},
    department: {label:'研发部门管理员', scope:'研发部', manage:true},
    billing: {label:'财务', scope:'all', manage:false},
    member: {label:'普通成员 · 陈晨', scope:'self', manage:false}
  };
  const cents = value => {
    const text = String(value).trim();
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) throw Error('请输入有效金额，最多保留两位小数。');
    const [whole, decimal=''] = text.split('.');
    return Number(whole)*100+Number(decimal.padEnd(2,'0'));
  };
  class Workspace {
    constructor() {
      this.funded=100000; this.actor='owner'; this.sequence=10;
      const names=['陈晨','林悦','周航','赵宁','许安','李言','王珂','宋青','刘川','吴悠'];
      const spent=[3000,2400,8100,1250,3600,4200,900,1800,2550,800];
      this.members=names.map((name,i)=>({id:'M'+(i+1),name,department:i<5?'研发部':'业务部',role:'member',status:'active',budget:10000,spent:spent[i],held:i===0?500:0,requests:[408,362,821,173,420,503,125,218,302,110][i]}));
      this.events=[{id:1,time:'初始快照',actor:'企业所有者',action:'批量分配',detail:'10 位成员，每人 ¥100；企业累计充值 ¥1,000。'}];
      this.requests=[];
    }
    setActor(actor) { if(!roles[actor])throw Error('未知演示身份'); this.actor=actor; }
    get policy(){return roles[this.actor];}
    visible(member){return this.policy.scope==='all'||(this.policy.scope==='self'?member.id==='M1':member.department===this.policy.scope);}
    get(id){const member=this.members.find(m=>m.id===id);if(!member||!this.visible(member))throw Error('无权访问此成员。');return member;}
    manageable(id){const member=this.get(id);if(!this.policy.manage)throw Error('当前身份没有成员或预算管理权限。');if(member.status==='removed')throw Error('成员已移除，历史记录只读。');if(member.role==='admin'&&!this.policy.appoint)throw Error('只有企业所有者可以管理管理员。');return member;}
    remaining(m){return m.budget-m.spent-m.held;}
    totals(){const sum=field=>this.members.reduce((n,m)=>n+m[field],0);return {funded:this.funded,spent:sum('spent'),held:sum('held'),allocated:sum('budget'),unassigned:this.funded-sum('budget'),remaining:sum('budget')-sum('spent')-sum('held'),balance:this.funded-sum('spent')};}
    record(action,detail){this.events.unshift({id:this.events.length+1,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),actor:this.policy.label,action,detail});}
    transfer(from,to,amount){
      const a=this.manageable(from),b=this.manageable(to);
      if(a===b)throw Error('请选择不同的转出和接收成员。');
      if(b.status!=='active')throw Error('接收成员需处于正常状态。');
      if(!Number.isSafeInteger(amount)||amount<=0)throw Error('调拨金额必须大于零。');
      if(amount>this.remaining(a))throw Error('可调额度不足；已消费和在途占用不能调出。');
      a.budget-=amount;b.budget+=amount;
      this.record('额度调拨',`${a.name} → ${b.name}：¥${(amount/100).toFixed(2)}`);
    }
    allocate(ids,budget){
      if(!ids.length)throw Error('请先选择成员。');
      if(new Set(ids).size!==ids.length)throw Error('成员不能重复。');
      if(!Number.isSafeInteger(budget)||budget<0)throw Error('预算金额无效。');
      const members=ids.map(id=>this.manageable(id));
      if(members.some(m=>m.status==='pending'))throw Error('待加入成员接受邀请后才能分配额度。');
      if(members.some(m=>budget<m.spent+m.held))throw Error('预算不能低于任一成员已消费与在途占用之和。');
      const delta=members.reduce((sum,m)=>sum+budget-m.budget,0);
      if(delta>0&&this.policy.scope!=='all')throw Error('部门管理员只能在本部门内调拨；新增预算请由企业管理员分配。');
      if(delta>this.totals().unassigned)throw Error(`企业未分配额度不足，缺少 ¥${((delta-this.totals().unassigned)/100).toFixed(2)}。`);
      members.forEach(m=>{m.budget=budget;});
      this.record('预算调整',`${members.length} 位成员，调整后每人预算 ¥${(budget/100).toFixed(2)}`);
    }
    status(id,next,reclaim=false){
      const m=this.manageable(id);
      if(!['active','paused','removed'].includes(next))throw Error('不支持的成员状态。');
      if(m.status==='pending')throw Error('邀请尚未接受，不能模拟真实加入。');
      if(next===m.status)throw Error('成员已经处于该状态。');
      const returned=(reclaim||next==='removed')?this.remaining(m):0;
      if(returned)m.budget-=returned;
      m.status=next;
      this.record(next==='removed'?'移除成员':next==='paused'?'暂停成员':'恢复成员',`${m.name}；回收未使用额度 ¥${(returned/100).toFixed(2)}；历史费用保留。`);
    }
    invite(name,department,role){
      if(!this.policy.manage)throw Error('无邀请权限。');
      name=String(name).trim();if(!name||name.length>30)throw Error('演示成员称呼须为 1–30 字。');
      if(!['研发部','业务部'].includes(department))throw Error('请选择有效部门。');
      if(this.policy.scope!=='all'&&department!==this.policy.scope)throw Error('只能邀请本部门成员。');
      if(!['member','viewer','billing','admin'].includes(role))throw Error('角色无效。');
      if(role!=='member'&&role!=='viewer'&&!this.policy.appoint)throw Error('仅企业所有者可任命财务或企业管理员。');
      const m={id:'M'+(++this.sequence),name,department,role,status:'pending',budget:0,spent:0,held:0,requests:0};this.members.push(m);this.record('邀请预览',`${name} · ${department}；未发送邀请，待加入，预算为零。`);return m;
    }
    request(amount,reason){
      if(this.actor!=='member')throw Error('请以普通成员身份提交申请。');
      if(!Number.isSafeInteger(amount)||amount<=0)throw Error('申请金额必须大于零。');
      reason=String(reason).trim();if(!reason||reason.length>100)throw Error('请填写 1–100 字的申请原因。');
      if(this.requests.some(r=>r.member==='M1'&&r.status==='pending'))throw Error('已有待处理申请，请等待管理员处理。');
      this.requests.unshift({id:this.requests.length+1,member:'M1',amount,reason,status:'pending'});this.record('额度申请',`陈晨申请增加 ¥${(amount/100).toFixed(2)}`);
    }
    review(id,approve){
      const r=this.requests.find(r=>r.id===id);if(!r||r.status!=='pending')throw Error('申请已处理或不存在。');
      const m=this.manageable(r.member);
      if(approve)this.allocate([m.id],m.budget+r.amount);
      r.status=approve?'approved':'rejected';this.record(approve?'通过申请':'拒绝申请',`${m.name} · ¥${(r.amount/100).toFixed(2)}`);
    }
  }
  const api={Workspace,roles,cents};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.EnterpriseDemo=api;
})(typeof globalThis==='undefined'?this:globalThis);
