/* Procedural, illustrative universe. No external images or astronomical scale claims. */
(() => {
  'use strict';
  const canvas=document.getElementById('universe-canvas');
  if(!canvas)return;
  const context=canvas.getContext('2d',{alpha:false});
  if(!context)return;
  const scene=canvas.parentElement;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let active=false,paused=false,frame=0,last=0,time=0,width=0,height=0,dpr=1,speed=.1,explicitMotion=false;
  let stars=[],backdrop=null,galaxy=null;
  let seed=76431;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const bell=()=>((random()+random()+random()+random())/4-.5)*2;
  const planetData=[
    {id:'mercury',name:'Mercury / 水星',orbit:.20,size:9,period:12,phase:1.8},
    {id:'venus',name:'Venus / 金星',orbit:.28,size:14,period:16,phase:4.1},
    {id:'earth',name:'Earth / 地球',orbit:.37,size:17,period:21,phase:.3},
    {id:'mars',name:'Mars / 火星',orbit:.46,size:12,period:26,phase:2.7},
    {id:'jupiter',name:'Jupiter / 木星',orbit:.58,size:33,period:33,phase:5.3},
    {id:'saturn',name:'Saturn / 土星',orbit:.70,size:27,period:40,phase:1.2},
    {id:'uranus',name:'Uranus / 天王星',orbit:.81,size:22,period:48,phase:3.5},
    {id:'neptune',name:'Neptune / 海王星',orbit:.91,size:21,period:56,phase:5.9},
    {id:'pluto',name:'Pluto / 冥王星',orbit:1,size:9,period:64,phase:2.2}
  ];
  const holder=document.getElementById('solar-bodies');
  holder.innerHTML=[{id:'sun',name:'Sun / 太阳'},...planetData,{id:'moon',name:'Moon / 月球'}].map(body=>'<div class="solar-body solar-'+body.id+'" data-body="'+body.id+'"><span class="solar-sphere">'+(body.id==='saturn'?'<i class="solar-ring"></i>':'')+'</span><span class="solar-label">'+body.name+'</span></div>').join('');
  const nodes=Object.fromEntries([...holder.children].map(node=>[node.dataset.body,node]));
  function geometry(){
    const mobile=width<860;
    return {mobile,x:width*(mobile?.5:.30)+Math.sin(time*.85)*(mobile?5:12),y:(mobile?390:height*.62)+Math.sin(time*.61)*(mobile?4:7),r:mobile?width*.39:Math.min(width*.245,height*.39,325),flatten:mobile?.68:.40,tilt:-.12,scale:mobile?.65:Math.min(1,height/620)};
  }
  function point(g,r,a){
    const x=Math.cos(a)*r,y=Math.sin(a)*r*g.flatten;
    return {x:g.x+x*Math.cos(g.tilt)-y*Math.sin(g.tilt),y:g.y+x*Math.sin(g.tilt)+y*Math.cos(g.tilt)};
  }
  const bodyPositions={},labelSizes={};
  function place(id,x,y,size,depth){
    bodyPositions[id]={x,y,size};
    const node=nodes[id];node.style.transform='translate3d('+x.toFixed(2)+'px,'+y.toFixed(2)+'px,0)';node.style.setProperty('--body-size',size+'px');node.style.zIndex=String(depth);
  }
  function solarSystem(){
    const g=geometry();
    place('sun',g.x,g.y,g.mobile?30:48*g.scale,30);
    context.save();context.translate(g.x,g.y);context.rotate(g.tilt);
    for(const planet of planetData){
      const r=g.r*planet.orbit,a=time*Math.PI*2/planet.period+planet.phase;
      context.beginPath();context.ellipse(0,0,r,r*g.flatten,0,0,Math.PI*2);context.strokeStyle='rgba(173,192,222,.21)';context.lineWidth=.65;context.stroke();
      // A short trail makes the direction and distance of travel easy to see.
      for(let i=0;i<9;i++){
        context.beginPath();context.ellipse(0,0,r,r*g.flatten,0,a-.38+i*.04,a-.34+i*.04);context.strokeStyle='rgba(188,210,243,'+(.025+i*.014)+')';context.lineWidth=1.5;context.stroke();
      }
      const pos=point(g,r,a);
      place(planet.id,pos.x,pos.y,Math.max(6,planet.size*g.scale),pos.y<g.y?20:40);
      if(planet.id==='earth'){
        const moonR=g.mobile?18:28,ma=time*Math.PI*2/4;
        const mx=pos.x+Math.cos(ma)*moonR,my=pos.y+Math.sin(ma)*moonR*.72;
        context.save();context.rotate(-g.tilt);context.translate(pos.x-g.x,pos.y-g.y);context.beginPath();context.ellipse(0,0,moonR,moonR*.72,0,0,Math.PI*2);context.strokeStyle='rgba(210,222,247,.3)';context.lineWidth=.55;context.stroke();context.restore();
        place('moon',mx,my,g.mobile?5:7,45);
      }
    }
    context.restore();
    arrangeLabels(g);
  }
  function arrangeLabels(g){
    const occupied=[];
    for(const id of ['sun',...planetData.map(p=>p.id),'moon']){
      const p=bodyPositions[id],label=nodes[id].querySelector('.solar-label');
      const size=labelSizes[id]||{width:68,height:12},w=size.width,h=size.height;
      const base=p.size/2+7;
      let chosen=null;
      for(const dy of [base,-base-h,base+14,-base-h-14,base+28,-base-h-28]){
        for(const dx of [0,-24,24,-48,48]){
          const box={x:p.x+dx-w/2,y:p.y+dy,w,h};
          if(box.x<12||box.x+w>(g.mobile?width-12:width*.6-16)||box.y<0||box.y+h>(g.mobile?535:height-86))continue;
          if(occupied.some(b=>box.x<b.x+b.w+5&&box.x+w+5>b.x&&box.y<b.y+b.h+3&&box.y+h+3>b.y))continue;
          if(Object.values(bodyPositions).some(b=>box.x<b.x+b.size/2+3&&box.x+w>b.x-b.size/2-3&&box.y<b.y+b.size/2+3&&box.y+h>b.y-b.size/2-3))continue;
          chosen={...box,dx,dy};break;
        }
        if(chosen)break;
      }
      if(!chosen)chosen={x:p.x-w/2,y:p.y+base,w,h,dx:0,dy:base};
      occupied.push(chosen);label.style.left=chosen.dx+'px';label.style.top=chosen.dy+'px';label.style.bottom='auto';
      if(chosen.dx||chosen.dy!==base){context.beginPath();context.moveTo(p.x,p.y+p.size/2);context.lineTo(chosen.x+w/2,chosen.y+h/2);context.strokeStyle='rgba(186,201,222,.25)';context.lineWidth=.5;context.stroke();}
    }
  }
  function syncControls(){
    const stopped=paused||(reduced.matches&&!explicitMotion);
    document.getElementById('solar-state').textContent=stopped?'已暂停':'公转中';
    if(active){
      const page=document.querySelector('.welcome-page');page.classList.toggle('welcome-motion-paused',stopped);
      const button=document.querySelector('[data-welcome-motion]');button.setAttribute('aria-pressed',String(stopped));button.setAttribute('aria-label',stopped?'播放天体公转':'暂停天体公转');button.querySelector('[data-motion-label]').textContent=stopped?'播放公转':'暂停公转';
    }
  }
  function makeGalaxy(){
    const image=document.createElement('canvas');image.width=1400;image.height=650;
    const c=image.getContext('2d');const cx=700,cy=325;
    c.save();c.translate(cx,cy);c.scale(1,.28);
    let halo=c.createRadialGradient(0,0,4,0,0,650);
    halo.addColorStop(0,'rgba(255,230,187,.72)');halo.addColorStop(.08,'rgba(240,213,193,.34)');halo.addColorStop(.27,'rgba(177,163,198,.17)');halo.addColorStop(.58,'rgba(114,140,196,.07)');halo.addColorStop(1,'rgba(100,136,193,0)');
    c.fillStyle=halo;c.fillRect(-700,-700,1400,1400);c.restore();
    // Fine stars form a tilted, dusty spiral disk; the image is rendered once.
    for(let i=0;i<21000;i++){
      const r=Math.pow(random(),.72)*630;
      const arm=i%2*Math.PI;
      const angle=r*.009+arm+bell()*(.4+r/950);
      const scatter=8+r*.075;
      const x=cx+Math.cos(angle)*r+bell()*scatter;
      const y=cy+Math.sin(angle)*r*.24+bell()*scatter*.4;
      const alpha=(1-r/760)*(.08+random()*.4);
      c.fillStyle=r<150?`rgba(255,225,183,${alpha})`:`rgba(${175+Math.floor(random()*65)},${187+Math.floor(random()*45)},244,${alpha})`;
      const radius=.25+random()*.85;c.beginPath();c.arc(x,y,radius,0,Math.PI*2);c.fill();
    }
    c.save();c.translate(cx,cy);c.scale(1,.43);
    const core=c.createRadialGradient(0,0,0,0,0,145);
    core.addColorStop(0,'rgba(255,248,219,.97)');core.addColorStop(.04,'rgba(255,235,196,.95)');core.addColorStop(.16,'rgba(255,218,181,.61)');core.addColorStop(.45,'rgba(235,201,177,.20)');core.addColorStop(1,'rgba(230,199,193,0)');
    c.fillStyle=core;c.fillRect(-150,-150,300,300);c.restore();
    return image;
  }
  function resize(){
    const rect=scene.getBoundingClientRect();
    if(rect.width<1||rect.height<1)return;
    width=rect.width;height=rect.height;dpr=Math.min(window.devicePixelRatio||1,1.5);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    context.setTransform(dpr,0,0,dpr,0,0);
    seed=76431;
    backdrop=document.createElement('canvas');backdrop.width=canvas.width;backdrop.height=canvas.height;
    const c=backdrop.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);
    c.fillStyle='#0a1126';c.fillRect(0,0,width,height);
    const wash=c.createRadialGradient(width*.6,height*.38,0,width*.6,height*.38,width*.8);
    wash.addColorStop(0,'#1a2843');wash.addColorStop(.5,'#101a31');wash.addColorStop(1,'#080d1e');c.fillStyle=wash;c.fillRect(0,0,width,height);
    const count=Math.min(1300,Math.round(width*height/850));
    stars=[];
    for(let i=0;i<count;i++){
      const x=random()*width,y=random()*height,r=.25+Math.pow(random(),4)*1.3,a=.18+random()*.55;
      c.fillStyle=`rgba(${190+Math.floor(random()*65)},${205+Math.floor(random()*45)},255,${a})`;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();
      if(i%19===0)stars.push({x,y,r:r+.4,phase:random()*Math.PI*2,speed:.3+random()*.3});
    }
    for(const [id,node] of Object.entries(nodes)){const label=node.querySelector('.solar-label');labelSizes[id]={width:label.offsetWidth,height:label.offsetHeight};}
    if(!galaxy)galaxy=makeGalaxy();
    paint();
  }
  function paint(){
    if(!backdrop||!width)return;
    context.clearRect(0,0,width,height);
    context.drawImage(backdrop,0,0,width,height);
    const mobile=width<860;
    const gx=mobile?width*.86:width*.51;
    const gy=mobile?180:height*.28;
    const size=mobile?width*1.65:width*.69;
    context.save();context.translate(gx+Math.sin(time*.025)*4,gy+Math.cos(time*.022)*3);context.rotate(-.38+Math.sin(time*.012)*.008);
    context.globalAlpha=.95;context.drawImage(galaxy,-size/2,-size*650/1400/2,size,size*650/1400);context.restore();
    for(const star of stars){
      const a=.20+(Math.sin(time*star.speed+star.phase)+1)*.18;
      context.fillStyle=`rgba(222,232,255,${a})`;context.beginPath();context.arc(star.x,star.y,star.r,0,Math.PI*2);context.fill();
    }
    solarSystem();
  }

  function tick(now){
    frame=0;
    if(!active||paused||(reduced.matches&&!explicitMotion)||document.hidden){last=0;return;}
    if(!last)last=now;
    const elapsed=now-last;
    // Limit canvas work to ~30fps; CSS handles the separate solar/planet layers.
    if(elapsed>=32){time+=Math.min(elapsed,100)/1000*speed;last=now;paint();}
    frame=requestAnimationFrame(tick);
  }
  function update(){
    syncControls();
    updateClock();
    if(frame)cancelAnimationFrame(frame);frame=0;last=0;
    if(active&&!document.hidden){resize();if(!paused&&(!reduced.matches||explicitMotion))frame=requestAnimationFrame(tick);}
  }
  window.UniverseScene={
    setActive(value){active=value;paused=!!document.querySelector('.welcome-motion-paused');update();if(!active){const b=document.querySelector('[data-welcome-motion]');b.setAttribute('aria-label',paused?'播放装饰动效':'暂停装饰动效');b.querySelector('[data-motion-label]').textContent=paused?'播放动效':'暂停动效';}},
    setPaused(value){paused=value;if(!value)explicitMotion=true;update();}
  };
  new ResizeObserver(()=>{if(active)resize();}).observe(scene);
  const slider=document.getElementById('solar-speed'),speedOutput=document.getElementById('solar-speed-value');
  slider.addEventListener('input',()=>{
    const position=Number(slider.value),raw=.05*Math.pow(160,position/1000);
    speed=Number(raw.toFixed(raw<=1?2:1));
    speedOutput.value=(speed<=1?speed.toFixed(2):speed.toFixed(1))+'×';
    slider.setAttribute('aria-valuetext',speed+' 倍');slider.style.setProperty('--speed-progress',position/10+'%');
  });
  const clock=document.getElementById('universe-clock');
  const clockFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let clockFrame=0,clockSecond=-1,clockPrefix='';
  function clockTick(){
    clockFrame=0;if(!active||document.hidden||!clock)return;
    const now=new Date(),second=Math.floor(now.getTime()/1000);
    if(second!==clockSecond){clockSecond=second;clockPrefix=clockFormat.format(now);clock.dateTime=now.toISOString();}
    clock.textContent=clockPrefix+'.'+String(now.getMilliseconds()).padStart(3,'0');
    clockFrame=requestAnimationFrame(clockTick);
  }
  function updateClock(){if(clockFrame)cancelAnimationFrame(clockFrame);clockFrame=0;clockTick();}
  document.addEventListener('visibilitychange',update);reduced.addEventListener('change',()=>{explicitMotion=false;update();});
  window.UniverseScene.setActive(document.body.classList.contains('universe-active'));
})();
