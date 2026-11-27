import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../web/screen-pages.js',import.meta.url),'utf8');
function fixture({height=240,content=900,width=400,contentWidth=400}={}){
 const frames=[],listeners={},controls=[],classes=new Set();let observer;
 const body={append(el){controls.push(el);}};
 const region={id:'content',isConnected:true,clientHeight:height,scrollHeight:content,clientWidth:width,scrollWidth:contentWidth,scrollTop:0,scrollLeft:0,style:{paddingBottom:''},parentElement:body,
  classList:{add(c){classes.add(c)}},getClientRects:()=>[{}],closest:()=>null,matches:()=>false,
  getBoundingClientRect:()=>({top:100,bottom:100+height,left:20,right:20+width,width,height}),addEventListener(){},scrollTo({top,left}){this.scrollTop=top;this.scrollLeft=left;}};
 const document={body,readyState:'complete',documentElement:{classList:{contains:()=>false}},querySelector:()=>null,querySelectorAll:s=>s==='main,aside,section,article,nav,pre,div,dialog'?[region]:[],addEventListener(){},
  createElement(){const nodes=new Map();return {style:{},setAttribute(){},addEventListener(type,fn){this[type]=fn},querySelector(s){if(!nodes.has(s))nodes.set(s,{});return nodes.get(s)},remove(){this.removed=true}};}};
 const context={window:{},document,innerHeight:720,innerWidth:1280,getComputedStyle:()=>({overflowY:'auto',overflowX:'auto',paddingBottom:'0'}),requestAnimationFrame:fn=>(frames.push(fn),frames.length),addEventListener:(key,fn)=>listeners[key]=fn,MutationObserver:class{constructor(fn){observer=fn}observe(){}}};
 vm.runInNewContext(source,context);
 const flush=()=>{while(frames.length)frames.shift()();};flush();
 return {region,controls,flush,listeners,context,changed:()=>observer([{type:'childList',target:{}}]),click(action){controls[0].click({target:{closest:()=>({dataset:{sp:action}})}})}};
}
test('paging overlaps boundaries and reaches the exact final edge without moving the frame',()=>{
 const f=fixture(),c=f.controls[0];assert.equal(c.querySelector('output').textContent,'1 / 5');assert.equal(c.style.top,'308px');
 const starts=[0];for(let i=0;i<4;i++){f.click('down');starts.push(f.region.scrollTop);}
 assert.deepEqual(starts,[0,164,328,492,660]);assert.equal(c.querySelector('[data-sp="down"]').disabled,true);
 assert.equal(c.querySelector('output').textContent,'5 / 5');assert.equal(c.style.top,'308px');
 f.click('up');assert.equal(f.region.scrollTop,496);
});
test('wide tables are accessible by field groups and reset on route changes',()=>{
 const f=fixture({content:240,contentWidth:1100});f.click('right');assert.equal(f.region.scrollLeft,352);f.click('right');assert.equal(f.region.scrollLeft,700);
 assert.equal(f.controls[0].querySelector('[data-sp="right"]').disabled,true);
 f.listeners.hashchange();f.flush();assert.equal(f.region.scrollLeft,0);assert.equal(f.region.scrollTop,0);
});
test('removed content releases controls and fitting content has no pager',()=>{
 const fitting=fixture({content:240});assert.equal(fitting.controls.length,0);
 const f=fixture();f.region.isConnected=false;f.changed();f.flush();assert.equal(f.controls[0].removed,true);
});
