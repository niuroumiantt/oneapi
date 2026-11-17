const pptxgen = require('pptxgenjs');
const { applyTheme } = require('./.agents/skills/pptx/scripts/apply_theme.js');
const pres = new pptxgen();
pres.layout='LAYOUT_WIDE';
pres.author='海风书店'; pres.subject='虚构测试材料'; pres.title='海风书店 10月活动复盘'; pres.lang='zh-CN';
const THEME={name:'海风 · 深蓝暖灰',headFontFace:'Heiti SC',bodyFontFace:'Heiti SC',colors:{dk1:'172C46',lt1:'FFFFFF',dk2:'625E59',lt2:'F0EEEB',accent1:'274D72',accent2:'B44742',accent3:'85817C',accent4:'B7B1A9',accent5:'55748E',accent6:'D9D5D0',hlink:'274D72',folHlink:'625E59'}};
pres.theme={headFontFace:THEME.headFontFace,bodyFontFace:THEME.bodyFontFace};
const C=pres.SchemeColor;
function layout(name,dark,body){pres.defineSlideMaster({title:name,background:{color:dark?C.text1:C.background1},margin:0.6,objects:[
{placeholder:{text:'',options:{name:'title',type:'title',x:0.65,y:0.55,w:12,h:0.8,fontSize:36,bold:true,color:dark?C.background1:C.text1,margin:0}}},
...(body?[{placeholder:{text:'',options:{name:'body',type:'body',x:0.7,y:1.65,w:11.9,h:4.8,fontSize:22,color:dark?C.background1:C.text1,margin:0}}}]:[]),
{text:{text:'海风书店｜虚构演示材料 · 2026年10月',options:{x:0.65,y:7.02,w:10.5,h:0.22,fontSize:11,color:dark?C.background2:C.text2,margin:0,isTextBox:true}}}
],slideNumber:{x:12,y:6.98,w:0.65,h:0.3,fontSize:11,color:dark?C.background2:C.text2}});}
layout('Overview',true,false);layout('Budget',false,false);layout('Actions',false,false);layout('Decision',true,false);
function slide(name,title,section){pres.addSection({title:section});const s=pres.addSlide({masterName:name,sectionTitle:section});s.addText(title,{placeholder:'title'});return s;}
function text(s,t,x,y,w,h,size=22,color=C.text1,bold=false){s.addText(t,{x,y,w,h,fontSize:size,color,bold,margin:0,isTextBox:true,objectName:t.slice(0,20),breakLine:false});}
function box(s,x,y,w,h,color){s.addShape(pres.ShapeType.rect,{x,y,w,h,fill:{color},line:{color,transparency:100},objectName:'内容分组'});}
let s=slide('Overview','海风书店｜10月活动复盘','活动总览');
text(s,'预算内完成 4 场读书活动',0.7,1.7,11.8,0.6,28,C.background1,true);
[['4','场读书活动'],['132','人报名'],['118','人实际到场']].forEach((a,i)=>{let x=0.7+i*4.05;box(s,x,2.75,3.75,2.25,C.accent1);text(s,a[0],x+0.25,3,3.2,0.95,64,C.background1,true);text(s,a[1],x+0.25,4.2,3.2,0.5,22,C.background1);});
text(s,'统计期：2026 年 10 月',0.7,5.65,11.8,0.45,22,C.background1);text(s,'复盘日期：2026-11-17',0.7,6.2,11.8,0.4,18,C.background2);
s.addNotes('本页材料均为公开演示用的虚构测试材料。统计期为2026年10月，复盘日期为2026-11-17。共举办4场读书活动，报名132人，实际到场118人。活动在预算内完成；这些人数信息不代表满意度，缺少满意度问卷，不能声称满意度提升。');
s=slide('Budget','费用支出 16,420 元，预算内完成','预算复盘');
[['预算','18,000'],['实际支出','16,420'],['余额','1,580']].forEach((a,i)=>{let x=0.7+i*4.05;box(s,x,1.65,3.75,1.15,C.background2);text(s,a[0]+'（元）',x+0.2,1.8,3.3,0.3,18);text(s,a[1],x+0.2,2.18,3.3,0.45,28,i===2?C.accent2:C.text1,true);});
s.addChart(pres.ChartType.bar,[{name:'支出（元）',labels:['场地','讲师','物料','推广'],values:[6000,5200,3220,2000]}],{x:0.7,y:3.1,w:11.9,h:3.5,barDir:'col',catAxisLabelFontFace:'+mn-lt',valAxisLabelFontFace:'+mn-lt',dataLabelFormatCode:'#,##0',dataLabelPosition:'outEnd',dataLabelColor:C.text1,dataLabelBkgrdColor:C.background1,dataLabelFontFace:'+mn-lt',dataLabelFontSize:18,catAxisLabelFontSize:18,valAxisLabelFontSize:18,catAxisLabelColor:C.text1,valAxisLabelColor:C.text2,showValue:true,showTitle:true,title:'支出分项（元）',titleFontFace:'+mj-lt',titleFontSize:20,titleColor:C.text1,showLegend:false,chartColors:[THEME.colors.accent1],invertedColors:[THEME.colors.accent1],valGridLine:{color:THEME.colors.lt2,size:1},catGridLine:{style:'none'},showBorder:false,valAxisMinVal:0,valAxisMaxVal:7000,valAxisMajorUnit:2000});
s.addNotes('活动预算18000元，实际支出16420元，余额1580元。原生柱状图的四项支出为场地6000元、讲师5200元、物料3220元、推广2000元，合计16420元。预算和支出相减为1580元，活动在预算内完成。');
s=slide('Actions','三项行动：落实记录、问卷与讲师','行动清单');
s.addTable([['事项','负责人','截止日期'],['整理报名与到场记录','陈晨','2026-11-20'],['设计 5 题反馈问卷','林悦','2026-11-22'],['联系下一期讲师','周宁','待确认']],{x:0.7,y:1.85,w:11.9,colW:[6.6,1.8,3.5],rowH:0.95,fontSize:22,color:C.text1,fill:C.background2,border:{type:'solid',pt:1,color:C.background1},margin:0.18,autoPage:false,bold:false,align:'left',valign:'mid',verbose:false});
text(s,'讲师联系的截止日期仍待确认',0.7,6.1,11.9,0.5,22,C.accent2,true);
s.addNotes('行动一：陈晨负责整理报名与到场记录，截止2026-11-20。行动二：林悦负责设计5题反馈问卷，截止2026-11-22。行动三：周宁负责联系下一期讲师，截止日期尚未确定，保留待确认，不擅自补充日期。');
s=slide('Decision','下月先试行两场小型读书会','下月决策与未决问题');
box(s,0.7,1.75,7.3,4.8,C.accent1);text(s,'先试行',1,2.05,6.7,0.4,22,C.background1);text(s,'两场小型读书会',1,2.75,6.7,0.65,36,C.background1,true);text(s,'问卷收集后，再决定是否增加场次',1,4,6.6,1,24,C.background1);text(s,'满意度信息缺失\n不得声称满意度提升',1,5.35,6.5,0.9,20,C.background2);
text(s,'未决问题',8.5,1.9,4.1,0.5,26,C.background1,true);text(s,'01  是否需要儿童专场',8.5,3,4.1,0.8,22,C.background1);text(s,'02  场地是否提供\n      额外桌椅',8.5,4.4,4.1,1.2,22,C.background1);
s.addNotes('已确定的下月决策是先试行两场小型读书会，问卷收集后再决定是否增加场次。目前缺少满意度问卷，不能声称满意度提升。两项未决问题分别为是否需要儿童专场，以及场地是否提供额外桌椅；本次复盘未给出答案。');
(async()=>{await pres.writeFile({fileName:'output.pptx'});await applyTheme('output.pptx',THEME);console.log('Created output.pptx with theme, four layouts, sections, native chart/table and notes');})();
