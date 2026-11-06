/* Procedural, illustrative universe. No external images or astronomical scale claims. */
(() => {
  'use strict';
  const canvas=document.getElementById('universe-canvas');
  if(!canvas)return;
  const context=canvas.getContext('2d',{alpha:false});
  if(!context)return;
  const scene=canvas.parentElement;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let active=false,paused=false,frame=0,last=0,time=0,width=0,height=0,dpr=1;
  let stars=[],backdrop=null,galaxy=null;
  let seed=76431;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const bell=()=>((random()+random()+random()+random())/4-.5)*2;
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
    if(!galaxy)galaxy=makeGalaxy();
    paint();
  }
  function paint(){
    if(!backdrop||!width)return;
    context.clearRect(0,0,width,height);
    context.drawImage(backdrop,0,0,width,height);
    const mobile=width<760;
    const gx=mobile?width*.86:width*.51;
    const gy=mobile?180:height*.245;
    const size=mobile?width*1.65:width*.69;
    context.save();context.translate(gx+Math.sin(time*.025)*4,gy+Math.cos(time*.022)*3);context.rotate(-.38+Math.sin(time*.012)*.008);
    context.globalAlpha=.95;context.drawImage(galaxy,-size/2,-size*650/1400/2,size,size*650/1400);context.restore();
    for(const star of stars){
      const a=.20+(Math.sin(time*star.speed+star.phase)+1)*.18;
      context.fillStyle=`rgba(222,232,255,${a})`;context.beginPath();context.arc(star.x,star.y,star.r,0,Math.PI*2);context.fill();
    }
    // Orbital arcs are illustrative, arranged around the foreground sun.
    const sx=width*(mobile?.4:.28),sy=mobile?351:height*.62;
    context.save();context.translate(sx,sy);context.rotate(-.24);
    const unit=mobile?width*.37:width*.205;
    for(let i=0;i<3;i++){
      const rx=unit*(.75+i*.45),ry=rx*.29;
      context.beginPath();context.ellipse(0,0,rx,ry,0,0,Math.PI*2);context.strokeStyle=`rgba(177,191,216,${.15-i*.025})`;context.lineWidth=.7;context.stroke();
      const a=time*(.024-i*.004)+i*2.1;
      context.fillStyle=i===1?'#e8c5aa':'#b0c4e4';context.beginPath();context.arc(Math.cos(a)*rx,Math.sin(a)*ry,i===1?2.5:1.6,0,Math.PI*2);context.fill();
    }
    context.restore();
  }
  function tick(now){
    frame=0;
    if(!active||paused||reduced.matches||document.hidden){last=0;return;}
    if(!last)last=now;
    const elapsed=now-last;
    // Limit canvas work to ~30fps; CSS handles the separate solar/planet layers.
    if(elapsed>=32){time+=Math.min(elapsed,80)/1000;last=now;paint();}
    frame=requestAnimationFrame(tick);
  }
  function update(){
    if(frame)cancelAnimationFrame(frame);frame=0;last=0;
    if(active&&!document.hidden){resize();if(!paused&&!reduced.matches)frame=requestAnimationFrame(tick);}
  }
  window.UniverseScene={
    setActive(value){active=value;paused=!!document.querySelector('.welcome-motion-paused');update();},
    setPaused(value){paused=value;update();}
  };
  new ResizeObserver(()=>{if(active)resize();}).observe(scene);
  document.addEventListener('visibilitychange',update);reduced.addEventListener('change',update);
  window.UniverseScene.setActive(location.hash==='#universe');
})();
