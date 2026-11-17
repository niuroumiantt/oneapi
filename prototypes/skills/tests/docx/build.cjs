const fs = require('fs');
const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,ShadingType,HeadingLevel,AlignmentType}=require('docx');
const source=fs.readFileSync('input.md','utf8');
if(!source.includes('海风书店') || !source.includes('待确认')) throw new Error('Input not as expected');
const font='Noto Sans CJK SC';
const p=(text,opts={})=>new Paragraph({children:[new TextRun({text})],...opts});
const h=text=>p(text,{heading:HeadingLevel.HEADING_1});
function table(rows,widths){return new Table({width:{size:widths.reduce((a,b)=>a+b,0),type:WidthType.DXA},columnWidths:widths,rows:rows.map((row,i)=>new TableRow({tableHeader:i===0,cantSplit:true,children:row.map((text,j)=>new TableCell({width:{size:widths[j],type:WidthType.DXA},margins:{top:100,bottom:100,left:140,right:140},shading:i===0?{type:ShadingType.CLEAR,fill:'F2F2F2'}:undefined,children:[new Paragraph({spacing:{after:0},children:[new TextRun({text,bold:i===0,color:'000000'})]})]}))}))});}
const doc=new Document({styles:{default:{document:{run:{font,size:22,color:'000000'},paragraph:{spacing:{after:120,line:300}}},title:{run:{font,size:36,bold:true,color:'000000'},paragraph:{spacing:{before:0,after:160},keepNext:true}},heading1:{run:{font,size:26,bold:true,color:'000000'},paragraph:{spacing:{before:220,after:100},keepNext:true}}}},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1000,bottom:1000,left:1100,right:1100}}},children:[
p('海风书店 10月活动复盘',{heading:HeadingLevel.TITLE}),
p('统计期：2026 年 10 月　｜　复盘日期：2026-11-17'),
p('公开演示用的虚构测试材料，不含真实客户或员工资料。',{spacing:{after:160},children:[new TextRun({text:'公开演示用的虚构测试材料，不含真实客户或员工资料。',size:18,color:'444444'})]}),
h('简要结论'),p('本月共举办 4 场读书活动，报名 132 人，实际到场 118 人。活动在预算内完成：预算 18,000 元，实际支出 16,420 元，余额 1,580 元。'),p('缺少满意度问卷，不得声称满意度提升。'),
h('支出明细'),table([['项目','支出（元）'],['场地','6,000'],['讲师','5,200'],['物料','3,220'],['推广','2,000'],['合计','16,420']],[6106,3600]),
h('下月决策与行动'),p('下月先试行两场小型读书会，问卷收集后再决定是否增加场次。'),table([['事项','负责人','截止日期'],['整理报名与到场记录','陈晨','2026-11-20'],['设计 5 题反馈问卷','林悦','2026-11-22'],['联系下一期讲师','周宁','待确认']],[4806,1700,3200]),
h('未决事项'),p('1. 是否需要儿童专场。'),p('2. 场地是否提供额外桌椅。')]}]});
Packer.toBuffer(doc).then(b=>fs.writeFileSync('output.docx',b));
