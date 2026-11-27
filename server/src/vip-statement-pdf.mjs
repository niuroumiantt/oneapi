import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
export const statementMoney = value => {
 const n=BigInt(value||0),negative=n<0n,a=negative?-n:n;
 return (negative?'-':'')+(a/100n).toString()+'.'+(a%100n).toString().padStart(2,'0');
};
const font=fileURLToPath(new URL('../assets/fonts/StatementCJK.otf',import.meta.url));
export async function renderVipStatementPDF(s){
 const doc=new PDFDocument({size:'A4',margin:38,bufferPages:true,info:{Title:`semifly VIP ${s.month} 月账单`,Author:'semifly.ai',CreationDate:new Date(s.generated_at),Subject:'脱敏推广交易与消费提成明细'}});
 const chunks=[];const result=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.font(font);const navy='#20273d',muted='#64728a',line='#dfe5ed';let y=38;
 const text=(value,x,top,width,size=10,color=navy,align='left')=>doc.fontSize(size).fillColor(color).text(String(value),x,top,{width,align,lineGap:2});
 const header=()=>{text('semifly.ai  /  VIP 月账单'+(s.demo?'（演示）':''),38,32,400,18);text(`${s.month} · 第 ${s.revision} 版`,410,38,147,10,muted,'right');doc.moveTo(38,65).lineTo(557,65).strokeColor(line).stroke();y=82;};
 const ensure=h=>{if(y+h>757){doc.addPage();header();}};
 const paragraph=(value,size=9)=>{const h=doc.fontSize(size).heightOfString(value,{width:519,lineGap:3});ensure(h+10);text(value,38,y,519,size,muted);y+=h+12;};
 const heading=value=>{ensure(40);text(value,38,y,519,12);y+=25;};
 const table=(heads,widths,rows)=>{
   const row=(cells,isHead=false)=>{
     const h=Math.max(28,...cells.map((v,i)=>doc.fontSize(9).heightOfString(String(v),{width:widths[i]-12,lineGap:2})+14));
     if(y+h>757){doc.addPage();header();row(heads,true);}
     if(isHead)doc.rect(38,y,519,h).fill('#f2f5f8');
     let x=38;cells.forEach((v,i)=>{text(v,x+6,y+6,widths[i]-12,9,isHead?muted:navy);x+=widths[i];});
     doc.moveTo(38,y+h).lineTo(557,y+h).strokeColor(line).lineWidth(.5).stroke();y+=h;
   };
   row(heads,true);for(const cells of rows)row(cells);y+=18;
 };
 header();
 paragraph(`VIP 编号：${s.vip_code}    账期：${s.month}（北京时间自然月）`);
 const totals=s.totals;
 const metrics=[['客户本月实付',totals.paid_fen],['本月实际消费',totals.used_fen],['本月提成（税前）',totals.commission_fen]];
 metrics.forEach(([label,value],i)=>{text(label,38+i*178,y,163,10,muted);text('¥'+statementMoney(value),38+i*178,y+20,163,20);});y+=63;
 paragraph(`本月退款 ¥${statementMoney(totals.refunded_fen)}。实际消费仅统计实付额度的消耗，不含赠送额度；充值与消费分别按发生月份记账。`);
 paragraph('提成按每笔订单约定比例计算，以本月实际消费记录为准。充值产生的预计收益不计入本月提成；退款取消未使用额度对应的预计收益。');
 if(s.revision>1)paragraph('本账单为修订版，包含延迟结算记录，请以最新版本为准；历史版本保留在收件箱。');
 heading('各推广码汇总');
 table(['推广码','实付（元）','实际消费（元）','退款（元）','税前提成（元）'],[111,102,102,102,102],s.codes.map(k=>[k.model?k.code+'\n'+k.model:k.code,...['paid_fen','used_fen','refunded_fen','commission_fen'].map(key=>statementMoney(k[key]))]));
 heading('脱敏交易明细');
 if(!s.entries.length)paragraph('本月没有推广交易。');
 else table(['时间（北京）','推广码','匿名交易编号','类型','金额（元）','提成（元）'],[99,88,92,64,88,88],s.entries.map(e=>[e.time,e.code,e.reference,{paid:'实付充值',used:'实际消费',refund:'退款'}[e.kind],(e.face_fen!=null&&e.kind==='used'?statementMoney(e.cash_fen)+' 实付\n'+statementMoney(String(Math.round(Number(e.face_fen))))+' 额度':statementMoney(e.cash_fen)),e.kind==='used'?statementMoney(e.commission_fen):'-']));
 paragraph('隐私说明：账单不包含客户姓名、手机号、邮箱、支付账号、API Key 或调用内容。匿名编号仅供核对交易。');
 paragraph('账单提成为税前金额，提现到账以结算单为准。疑问请在工作台联系支持，并提供账期及匿名交易编号。');
 const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(i);text(`生成：${new Date(s.generated_at).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）`,38,785,360,8,muted);text(`${s.number} · ${i+1} / ${pages.count}`,390,785,167,8,muted,'right');}
 doc.end();return result;
}
