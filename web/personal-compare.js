/* Personal workspace presentation. Shared compare.js owns requests, billing and exports. */
(function(root){
 'use strict';
 function pages(text,width=40,rows=8){
  const out=[];let page='',line=1,col=0;
  for(const ch of Array.from(String(text))){
   const breaks=ch==='\n'||col>=width;
   if(breaks&&line>=rows){out.push(page);page='';line=1;col=0;}
   if(ch==='\n'){line++;col=0;}else{if(col>=width){line++;col=0;}col++;}
   page+=ch;
  }
  if(page||!out.length)out.push(page);return out;
 }
 if(typeof module==='object')module.exports={pages};
 if(typeof document==='undefined'||!document.documentElement.classList.contains('compare-personal'))return;
 const $=id=>document.getElementById(id),q=s=>document.querySelector(s);
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
 const button=(label,action)=>{const b=make('button','',label);b.type='button';b.onclick=action;return b;};
 const main=q('main'),workspace=q('.compare-workspace'),setup=$('setup-panel'),results=$('results-panel'),platform=q('.platform-panel'),reference=setup.querySelector('.connection'),composer=q('.composer');
 const header=make('div','cp-heading');header.append(make('h1','','API 对比'),make('p','','同一份任务，对比回答、速度和费用。'));main.prepend(header);
 const toolbar=q('.workspace-tabs');$('tab-setup').textContent='开始对比';$('tab-results').textContent='对比结果';toolbar.querySelector('span').remove();
 const advancedButton=button('更多设置',()=>showAdvanced('parameters'));advancedButton.className='cp-more';toolbar.append(advancedButton);
 // Keep original result nodes mounted for the existing exports and result calculations.
 const legacy=make('div','cp-legacy');legacy.hidden=true;
 while(results.firstChild)legacy.append(results.firstChild);results.append(legacy);
 const connections=make('div','cp-connections');connections.append(platform,reference);setup.prepend(connections);workspace.prepend(setup,results);q('.compare-content').remove();
 setup.append(composer);const charge=q('.charge-note');charge.textContent='开始后两侧分别计费。Key、任务及附件经本站转发至所选接口，不落库；停止请求不保证上游停止计费。';composer.append(charge);
 platform.querySelector('h2').textContent='semifly API';reference.querySelector('h2').textContent='参照 API';
 platform.querySelector('.connection-foot a').href='/#billing/personal';platform.querySelector('.connection-foot a').target='_parent';
 const warning=q('.key-warning');warning.className='cp-key-note';warning.querySelector('svg').remove();warning.textContent='请用临时测试 Key；测试后到供应商平台撤销。本站不保存 Key。';reference.append(warning);
 const cleanup=q('.key-cleanup');cleanup.querySelector('span').remove();$('clear-ref-key').textContent='清除 Key';reference.append(cleanup);
 const keyLabel=$('ref-key').closest('label');reference.insertBefore(keyLabel,reference.querySelector('.fields'));
 $('ref-key').placeholder='输入参照平台的测试 Key';$('load-ref').textContent='读取模型';
 const matching=$('matching');composer.append(matching);matching.querySelector('.end').remove();
 q('.composer-top h2').textContent='共同任务';q('.presets .small-hide').remove();
 // Secondary controls occupy their own bounded views instead of expanding the main page.
 const advanced=make('section','cp-advanced');advanced.hidden=true;advanced.setAttribute('aria-label','更多设置');workspace.append(advanced);
 const advNav=make('nav','cp-subnav');advanced.append(advNav);const advViews={};
 const headings={parameters:'共同参数',price:'预估单价',attachments:'附件与预览',method:'比较说明'};
 for(const [id,label] of Object.entries(headings)){advNav.append(button(label,()=>showAdvanced(id)));const box=make('div','cp-advanced-pane');box.dataset.view=id;advViews[id]=box;advanced.append(box);}
 const params=composer.querySelector('.params');params.open=true;params.querySelector('summary').hidden=true;params.querySelector('.param-grid p').textContent='两侧使用同一份最终参数。接口不支持时会报错，不会自动重试。';advViews.parameters.append(params);
 const refSettings=$('ref-settings');refSettings.querySelector('summary').hidden=true;refSettings.querySelector('p').textContent='填写服务商提供的 HTTPS API 地址。';
 const sourceLabel=$('ref-provider').closest('label'),modelLabel=$('ref-model-select').closest('label'),modelRow=make('div','cp-model-row');
 reference.querySelector('.fields').remove();
 const sourceRow=make('div','cp-source-row');sourceRow.append(sourceLabel,refSettings);reference.insertBefore(sourceRow,keyLabel);
 modelRow.append(modelLabel,$('manual-model-wrap'));keyLabel.after(modelRow);
 function connectionLayout(){sourceRow.classList.toggle('cp-custom',$('ref-provider').value==='custom');refSettings.hidden=$('ref-provider').value!=='custom';refSettings.open=!refSettings.hidden;modelRow.classList.toggle('cp-manual',$('ref-model-select').value==='__manual__');}
 connectionLayout();
 const price=q('.price-settings');price.open=true;price.querySelector('summary').hidden=true;advViews.price.append(price);
 const previewDetails=composer.querySelector('.params');previewDetails.open=true;previewDetails.querySelector('summary').hidden=true;advViews.attachments.append($('file-input'),$('attach-btn'),$('attachments'),$('image-confirm-wrap'),previewDetails);
 const method=$('method');method.open=true;method.querySelector('summary').hidden=true;advViews.method.append(method);
 const exports=make('div','cp-extra-exports');exports.append($('export-btn'),$('replay'));advViews.method.append(exports,make('p','cp-note','报告含任务与回答，分享前请检查。刷新后清空本次内容。'));
 const preview=$('input-preview'),previewText=make('pre','cp-preview-text'),previewNav=make('nav','cp-pager');preview.hidden=true;preview.after(previewText,previewNav);
 const attachLink=button('附件与参数',()=>showAdvanced('attachments'));q('.composer-bottom').prepend(attachLink);q('.composer-bottom .hint').remove();
 const back=button('返回对比',()=>{panel('setup');$('setup-panel').hidden=false;$('results-panel').hidden=true;$('tab-setup').setAttribute('aria-pressed','true');$('tab-results').setAttribute('aria-pressed','false');});back.className='cp-back';advanced.append(back);
 // Mobile uses two short steps; desktop shows both columns together.
 const steps=make('nav','cp-mobile-steps');const stepNames=['platform','reference','task'];
 ['平台','参照','任务'].forEach((label,i)=>steps.append(button(label,()=>step(stepNames[i]))));setup.prepend(steps);
 function step(name){setup.dataset.step=name;Array.from(steps.children).forEach((b,i)=>b.setAttribute('aria-pressed',String(stepNames[i]===name)));next.textContent=name==='platform'?'下一步：参照 API':'下一步：填写任务';}
 const next=button('下一步：参照 API',()=>step(setup.dataset.step==='platform'?'reference':'task'));next.className='cp-next';connections.append(next);step('platform');
 let snapshot=null,running=false,view='setup',resultView='answers',advancedView='parameters',previewPage=0,resultPages={a:0,b:0};
 const resultNav=make('nav','cp-subnav');results.prepend(resultNav);
 for(const [id,label] of [['answers','回答'],['cost','费用'],['metrics','用量与速度'],['reasoning','推理与说明']])resultNav.append(button(label,()=>{resultView=id;resultPages={a:0,b:0};render();}));
 const resultActions=make('div','cp-result-actions');resultActions.append($('clear'),$('pdf-btn'));resultNav.append(resultActions);
 const resultStatus=make('p','cp-note');results.append(resultStatus);
 const resultPair=make('div','cp-result-pair');results.append(resultPair);const panels={};
 for(const side of ['a','b']){const box=make('article','cp-result'),title=make('h2'),meta=make('p','cp-result-meta'),body=make('div','cp-result-body'),pager=make('nav','cp-pager');pager.setAttribute('aria-label',side==='a'?'平台回答分页':'参照回答分页');box.append(title,meta,body,pager);resultPair.append(box);panels[side]={title,meta,body,pager};}
 const resultNote=make('p','cp-note');results.append(resultNote);
 function panel(name){view=name;advanced.hidden=true;advancedButton.setAttribute('aria-pressed','false');setup.hidden=name!=='setup';results.hidden=name!=='results';render();}
 function showAdvanced(name){view='advanced';advancedView=name;advanced.hidden=false;setup.hidden=true;results.hidden=true;advancedButton.setAttribute('aria-pressed','true');for(const b of toolbar.querySelectorAll('#tab-setup,#tab-results'))b.setAttribute('aria-pressed','false');for(const [id,box] of Object.entries(advViews))box.hidden=id!==name;Array.from(advNav.children).forEach((b,i)=>b.setAttribute('aria-pressed',String(Object.keys(headings)[i]===name)));renderPreview();}
 function paging(node,nav,text,index,set){
  const rect=node.getBoundingClientRect(),style=getComputedStyle(node),font=parseFloat(style.fontSize)||14,line=parseFloat(style.lineHeight)||22;
  const chunks=pages(text,Math.max(10,Math.floor((rect.width-4)/font)),Math.max(2,Math.floor((rect.height-4)/line))),at=Math.min(index,chunks.length-1);node.textContent=chunks[at];nav.replaceChildren();
  if(chunks.length>1){const prev=button('上一页',()=>set(at-1)),next=button('下一页',()=>set(at+1));prev.disabled=at===0;next.disabled=at===chunks.length-1;nav.append(prev,make('span','',`${at+1} / ${chunks.length}`),next);}
 }
 function renderPreview(){if(view!=='advanced'||advancedView!=='attachments')return;paging(previewText,previewNav,preview.textContent,previewPage,n=>{previewPage=n;renderPreview();});}
 const states={complete:'已完成',truncated:'达到输出上限',failed:'调用失败',cancelled:'已停止',timeout:'请求超时',filtered:'内容受限'};
 const money=v=>v==null?'待结算':'¥'+Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:8});
 const count=v=>v==null?'未提供':Number(v).toLocaleString('zh-CN');
 function render(){
  if(view!=='results')return;const last=snapshot;
  Array.from(resultNav.children).slice(0,4).forEach((b,i)=>b.setAttribute('aria-pressed',String(['answers','cost','metrics','reasoning'][i]===resultView)));
  resultStatus.textContent=!last?'还没有对比结果。':running?'两侧正在运行，可随时停止。':'本次对比已结束。测试完请到供应商平台撤销 Key。';
  for(const side of ['a','b']){const r=last?.results[side],p=panels[side],a=side==='a';p.title.textContent=a?'semifly API':'参照 API';p.meta.textContent=(last?.models[side]||'等待任务')+(r?' · '+(states[r.status]||r.status):running?' · 运行中':'');
   let text='开始对比后，这里显示本次结果。';
   if(last){if(resultView==='answers')text=last.outputs[side]?.text||r?.error||(running?'等待回答…':'接口未返回可见回答。');
    if(resultView==='metrics'){const u=r?.usage,t=r?.timing;text=`输入 Token  ${count(u?.input_tokens)}\n输出 Token  ${count(u?.output_tokens)}\n缓存命中  ${count(u?.cached_input_tokens)}\n首字延迟  ${t?.first_text_ms==null?'未提供':(t.first_text_ms/1000).toFixed(2)+' 秒'}\n总耗时  ${t?.total_ms==null?'未提供':(t.total_ms/1000).toFixed(2)+' 秒'}\n端到端速度  ${r?.end_to_end_tokens_per_second==null?'未提供':r.end_to_end_tokens_per_second.toFixed(2)+' Token/秒'}`;}
    if(resultView==='cost'){const b=r?.billing,e=r?.estimate;text=a?`实付消费  ${b?.status==='settled'?money(SemiflyCostComparison.actualCost(b)):b?.status==='failed'?'未扣费':'待结算'}\n扣减额度  ${money(b?.charged_yuan)}\n\n`:`参照预估  ${e?.status==='estimated'?money(e.total_yuan):'无法估算'}\n\n`;const items=a?b?.calculation?.items:e?.items;
     if(items?.length)text+='单价 · 元 / 百万 Token\n'+items.map(i=>({input:'输入',cached:'缓存命中',output:'输出'}[i.kind]||i.kind)+' '+count(i.tokens)+' × ¥'+Number(i.rate_yuan_per_million)+' / 百万 = '+money(i.amount_yuan)).join('\n');
     text+='\n\n'+(a?'按本次实际消耗额度的购入成本计算，跨批次分别折算。':'费用为预估，以供应商账单为准。');
     if(!a&&e?.reason)text+='\n'+e.reason;
     if(!a&&e?.notes?.length)text+='\n'+e.notes.join(' ');
}
    if(resultView==='reasoning')text=(last.outputs[side]?.reasoning||'未返回推理内容。')+'\n\n'+($('warning-'+side).textContent||'')+'\n'+($('conclusion').textContent||'');
   }
   paging(p.body,p.pager,text,resultPages[side],n=>{resultPages[side]=n;render();});
  }
  if(resultView==='cost'){const c=SemiflyCostComparison.compare(last?.results.a,last?.results.b);resultNote.textContent=c.status==='compared'?`${c.label} · ${c.direction==='more'?'多花':'少花'} ${money(c.absolute_difference_yuan)}${c.percentage==null?'':' · '+c.percentage+'%'}。参照费用为预估，以供应商账单为准。`:c.reason||'等待两侧完成及费用结算。';}
  else resultNote.textContent=resultView==='metrics'?'缓存命中属于输入子项；未提供的指标不按 0 处理。':'单次对比不能鉴定模型身份。完整结果可导出 PDF 或在更多设置中导出 JSON。';
 }
 root.PersonalCompare={panel,update(last,busy){connectionLayout();if(last!==snapshot)resultPages={a:0,b:0};snapshot=last;running=busy;render();renderPreview();},unavailable(status,message){setup.hidden=true;advanced.hidden=true;results.hidden=true;toolbar.hidden=true;$('auth-error').replaceChildren(make('h2','',status===401?'登录后开始对比':status===402?'充值后开始对比':'暂时无法加载对比'),make('p','',message));const link=make('a','primary',status===401?'前往登录':status===402?'充值额度':'返回工作台');link.href=status===401?'/#personal':status===402?'/#billing/personal':'/#personal';link.target='_parent';$('auth-error').append(link);}};
 new MutationObserver(renderPreview).observe(preview,{childList:true,characterData:true,subtree:true});
 window.addEventListener('resize',()=>{render();renderPreview();});
 panel('setup');
})(typeof window==='object'?window:globalThis);
