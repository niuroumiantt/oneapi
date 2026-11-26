// Local design fixture only. Never import this file into production code.
export const models = [
  {id:'deepseek-flash',name:'DeepSeek Flash',color:'#5867cc'},
  {id:'glm-5.3',name:'GLM-5.3',color:'#269c99'},
  {id:'glm-5.3-flash',name:'GLM-5.3-Flash',color:'#d69b3b'},
];
const lastWeek = [[92000,68000,21000],[118000,34000,28000],[44000,38000,0],[154000,86000,42000],[128000,52000,32000],[171000,97000,38000],[86000,45000,19000]];
export const days = Array.from({length:92},(_,i)=>{
  const date = new Date(Date.UTC(2026,7,27+i)).toISOString().slice(0,10);
  const inactive = i%11===0 || (i<48&&i%7===3) || (i<25&&i%3===0);
  const values = i>=85?lastWeek[i-85]:models.map((_,m)=>inactive?0:Math.round((Math.sin(i*1.71+m*2.3)+1.15)*(19000+i*360)*(m===0?1.3:m===1?.8:.35)/100)*100);
  return {date,values,total:values.reduce((a,b)=>a+b,0)};
});
