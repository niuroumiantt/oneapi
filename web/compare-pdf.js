/* One-page, local-only PDF. CJK text is rasterized at print resolution, no font/CDN upload. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SemiflyPDF=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function pdfBytes(jpeg,width,height){
 const enc=new TextEncoder(),parts=[],offsets=[0];let length=0;
 const put=v=>{const b=typeof v==='string'?enc.encode(v):v;parts.push(b);length+=b.length;};
 const obj=(id,body)=>{offsets[id]=length;put(id+' 0 obj\n');put(body);put('\nendobj\n');};
 put('%PDF-1.4\n');obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 obj(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
 offsets[4]=length;put('4 0 obj\n<< /Type /XObject /Subtype /Image /Width '+width+' /Height '+height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\nstream\n');put(jpeg);put('\nendstream\nendobj\n');
 const commands='q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';obj(5,'<< /Length '+enc.encode(commands).length+' >>\nstream\n'+commands+'\nendstream');
 const xref=length;put('xref\n0 6\n0000000000 65535 f \n');for(let i=1;i<=5;i++)put(String(offsets[i]).padStart(10,'0')+' 00000 n \n');put('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');
 const out=new Uint8Array(length);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;
}
function render(data){
 const canvas=document.createElement('canvas');canvas.width=1240;canvas.height=1754;const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,1240,1754);c.textBaseline='top';let y=48;
 function text(value,x,top,width,maxLines=1,size=20,bold=false){c.font=(bold?'600 ':'')+size+'px sans-serif';c.fillStyle='#1c2541';let line='',lines=[];for(const ch of String(value??'未提供').replace(/\s+/g,' ')){if(c.measureText(line+ch).width>width){lines.push(line);line='';}line+=ch;}lines.push(line);if(lines.length>maxLines){lines=lines.slice(0,maxLines);lines[maxLines-1]=lines[maxLines-1].slice(0,-2)+'…';}lines.forEach((v,i)=>c.fillText(v,x,top+i*(size+6)));return lines.length*(size+6);}
 function heading(t){y+=12;text(t,48,y,1144,1,23,true);y+=36;}
 text('semifly.ai  /  API 对比测试报告',48,y,1144,1,32,true);y+=48;
 text(data.meta,48,y,1144,2,18);y+=52;
 text(data.parameters,48,y,1144,2,18);y+=50;
 heading('共同任务摘要');text(data.prompt,48,y,1144,3,20);y+=78;
 text(data.attachments,48,y,1144,1,17);y+=27;
 heading('回答摘要');text('A · 我们的 API',48,y,550,1,20,true);text('B · 参照 API',640,y,550,1,20,true);y+=30;
 text(data.answers[0],48,y,548,4,20);text(data.answers[1],640,y,548,4,20);y+=108;
 heading('模型与运行指标');
 const rows=[['指标','A · 我们的 API','B · 参照 API'],...data.rows];
 for(let i=0;i<rows.length;i++){const h=rows[i][0].includes('ID')||rows[i][0].includes('模型')?48:30;c.fillStyle=i===0?'#e9edf3':i%2?'#f7f8fa':'#fff';c.fillRect(48,y,1144,h);text(rows[i][0],58,y+5,250,2,17,i===0);text(rows[i][1],320,y+5,415,2,17);text(rows[i][2],750,y+5,430,2,17);y+=h;}
 heading('Token 计价与费用');for(const row of data.costRows){text(row[0],48,y,250,1,18,true);text(row[1],320,y,415,2,18);text(row[2],750,y,430,2,18);y+=48;}
 text(data.savings,48,y,1144,2,22,true);y+=62;
 text(data.notice,48,y,1144,3,17);y+=65;
 text('一页摘要报告 · 长文本以省略号截断，完整任务、回答、价格快照及附件信息请另存 JSON。密钥不导出。',48,y,1144,2,16);
 if(y+44>1710)throw Error('报告内容超过一页，请导出 JSON');
 const jpeg=Uint8Array.from(atob(canvas.toDataURL('image/jpeg',0.94).split(',')[1]),v=>v.charCodeAt(0));return pdfBytes(jpeg,canvas.width,canvas.height);
}
return {pdfBytes,render};
});
