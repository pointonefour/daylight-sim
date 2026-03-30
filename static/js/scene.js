// scene.js — simulation canvas rendering

function draw() {
  const canvas=document.getElementById('canvas');
  const ctx=canvas.getContext('2d');
  State.ox=State.cssW/2; State.oy=State.cssH/2;
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.restore();
  drawGrid(ctx);
  drawRays(ctx);
  drawSource(ctx);
  drawComponents(ctx);
}

function drawGrid(ctx) {
  const W=State.cssW, H=State.cssH, s=simScale();
  const ox=W/2+State.viewport.panX, oy=H/2+State.viewport.panY;
  ctx.save();
  ctx.lineWidth=0.5; ctx.strokeStyle='#e0e0e0';
  for(let x=ox%s;x<W;x+=s){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=oy%s;y<H;y+=s){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  ctx.lineWidth=1; ctx.strokeStyle='#cccccc';
  ctx.beginPath();ctx.moveTo(ox,0);ctx.lineTo(ox,H);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,oy);ctx.lineTo(W,oy);ctx.stroke();
  ctx.fillStyle='#000000'; ctx.font='10px Segoe UI'; ctx.textAlign='center';
  for(let i=-8;i<=8;i++){
    if(!i) continue;
    const sv=toScreen(i,0); ctx.fillText(i,sv.x,oy+13);
    const sy=toScreen(0,i); ctx.textAlign='right'; ctx.fillText(i,ox-4,sy.y+3); ctx.textAlign='center';
  }
  ctx.restore();
}

function drawSource(ctx) {
  const{lat,day,time,sysAz,dni}=getSolarInputs();
  const sol=calcSolar(lat,day,time,sysAz);
  const center=toScreen(State.sourceX, State.sourceY);
  const hw=State.sourceWidth/2*simScale();

  // sourceRotation rotates the LINE visually — does NOT affect ray direction
  const lineRot=(State.sourceRotation||0)*Math.PI/180;

  // Endpoints of the rotated source line
  const cosR=Math.cos(lineRot), sinR=Math.sin(lineRot);
  const p1x=center.x - hw*cosR, p1y=center.y + hw*sinR;
  const p2x=center.x + hw*cosR, p2y=center.y - hw*sinR;

  ctx.save();

  // Draw rotated source line
  ctx.strokeStyle='#000000'; ctx.lineWidth=1.5; ctx.setLineDash([6,4]);
  ctx.beginPath(); ctx.moveTo(p1x,p1y); ctx.lineTo(p2x,p2y); ctx.stroke();
  ctx.setLineDash([]);

  // Center handle
  ctx.strokeStyle='#000000'; ctx.fillStyle='#ffffff'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(center.x,center.y,5,0,Math.PI*2); ctx.fill(); ctx.stroke();

  if (sol.isNight) {
    ctx.fillStyle='#888888'; ctx.font='bold 11px Segoe UI'; ctx.textAlign='center';
    ctx.fillText('NIGHT TIME',center.x,center.y-30);
  } else {
    // Arc gizmo (always horizontal reference)
    const arcRadius=75;
    ctx.strokeStyle='rgba(0,0,0,0.1)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(center.x,center.y,arcRadius,Math.PI,0); ctx.stroke();

    // Ray direction from SOLAR CALCULATION — independent of sourceRotation
    const rad=sol.profDeg*Math.PI/180;
    const dx=Math.cos(rad), dy=Math.sin(rad);
    const sunX=center.x-arcRadius*dx, sunY=center.y-arcRadius*dy;
    const effDNI=dni*sol.dniFactor*sol.cosLoss;
    const rSun=Math.max(3,16*sol.dniFactor);

    ctx.beginPath(); ctx.arc(sunX,sunY,rSun,0,Math.PI*2);
    ctx.fillStyle='#ffffff'; ctx.fill();
    ctx.strokeStyle='#000000'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='#000000'; ctx.font='bold 9px Segoe UI'; ctx.textAlign='left';
    ctx.fillText(`DNI: ${Math.round(effDNI)} W/m²`,sunX+rSun+6,sunY-4);
    ctx.font='9px Segoe UI';
    ctx.fillText(`PROF: ${Math.round(sol.profDeg)}°`,sunX+rSun+6,sunY+6);

    // Ray arrows shoot from the ROTATED line in the SOLAR direction
    // Sample points along the rotated line
    const steps=Math.floor(hw/34);
    for(let i=-steps;i<=steps;i++){
      const px=center.x+i*34*cosR;
      const py=center.y-i*34*sinR;
      const ex=px+dx*20, ey=py+dy*20;
      ctx.strokeStyle='#000000'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(ex,ey); ctx.stroke();
      const ang=Math.atan2(dy,dx);
      ctx.beginPath(); ctx.moveTo(ex,ey);
      ctx.lineTo(ex-6*Math.cos(ang-.4),ey-6*Math.sin(ang-.4));
      ctx.lineTo(ex-6*Math.cos(ang+.4),ey-6*Math.sin(ang+.4));
      ctx.closePath(); ctx.fillStyle='#000000'; ctx.fill();
    }
  }

  // Label — source rotation shown separately from ray angle
  ctx.fillStyle='#000000'; ctx.font='10px Segoe UI'; ctx.textAlign='left';
  const rotLabel=(State.sourceRotation||0)!==0 ? `  ROT:${(State.sourceRotation||0).toFixed(0)}°` : '';
  ctx.fillText(
    `Y=${State.sourceY.toFixed(1)}  X=${State.sourceX.toFixed(1)}  W=${State.sourceWidth.toFixed(1)}${rotLabel}`,
    p1x, center.y+20
  );
  ctx.restore();
}

function drawRays(ctx) {
  if(!State.rayPaths.length) return;
  const maxE=Math.max(...State.rayEnergies,0.001);
  ctx.save();
  for(let i=0;i<State.rayPaths.length;i++){
    const path=State.rayPaths[i]; if(path.length<2) continue;
    const alpha=Math.max(0.1,(State.rayEnergies[i]/maxE)*0.8);
    ctx.strokeStyle=`rgba(0,100,255,${alpha})`; ctx.lineWidth=0.85;
    ctx.beginPath();
    for(let j=0;j<path.length;j++){const p=toScreen(path[j][0],path[j][1]);j===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}
    ctx.stroke();
  }
  ctx.restore();
}

function drawSharpPath(ctx,pts,stroke,lw){
  ctx.beginPath();
  for(let i=0;i<pts.length;i++){const s=toScreen(pts[i][0],pts[i][1]);i===0?ctx.moveTo(s.x,s.y):ctx.lineTo(s.x,s.y);}
  ctx.strokeStyle=stroke; ctx.lineWidth=lw; ctx.stroke();
}

function drawComponents(ctx) {
  ctx.save();
  drawAssemblyLinks(ctx);
  for(const c of State.components){
    const rot=c.rotation*Math.PI/180;
    const cx=c.position.x, cy=c.position.y;
    const sel=c.id===State.selectedId;
    const front=sel?'#000000':'#bbbbbb';
    const lw=sel?2:1.5;
    const[olx,oly]=getOriginLocal(c);

    if(c.type==='parabolic'){
      const f=c.params.focal_length||0.5, D=c.params.aperture||0.8;
      const ts=c.params.trim_start||0, te=c.params.trim_end||1;
      const lp=parabolaPoints(f,D,120,ts,te);
      const wp=applyTransform(lp,cx,cy,rot,olx,oly);
      const bp=applyTransform(offsetPath(lp,-.06),cx,cy,rot,olx,oly);
      ctx.beginPath();
      for(let i=0;i<wp.length;i++){const s=toScreen(wp[i][0],wp[i][1]);i===0?ctx.moveTo(s.x,s.y):ctx.lineTo(s.x,s.y);}
      for(let i=bp.length-1;i>=0;i--){const s=toScreen(bp[i][0],bp[i][1]);ctx.lineTo(s.x,s.y);}
      ctx.closePath(); ctx.fillStyle='#000000'; ctx.fill();
      drawSharpPath(ctx,wp,front,lw);

    } else if(c.type==='flat'){
      const w=c.params.width||0.6;
      const ts=c.params.trim_start||0, te=c.params.trim_end||1;
      const xS=-w/2+ts*w, xE=-w/2+te*w;
      const lp=[[xS,0],[xE,0]];
      const wp=applyTransform(lp,cx,cy,rot,olx,oly);
      const bl=applyTransform([[xS,-.055],[xE,-.055]],cx,cy,rot,olx,oly);
      ctx.beginPath();
      const sf0=toScreen(wp[0][0],wp[0][1]),sf1=toScreen(wp[1][0],wp[1][1]);
      const sb0=toScreen(bl[0][0],bl[0][1]),sb1=toScreen(bl[1][0],bl[1][1]);
      ctx.moveTo(sf0.x,sf0.y);ctx.lineTo(sf1.x,sf1.y);ctx.lineTo(sb1.x,sb1.y);ctx.lineTo(sb0.x,sb0.y);
      ctx.closePath(); ctx.fillStyle='#000000'; ctx.fill();
      drawSharpPath(ctx,wp,front,lw);

    } else if(c.type==='cpc'){
      const ap=c.params.aperture||0.6, theta=c.params.acceptance_angle||30;
      const ts=c.params.trim_start||0, te=c.params.trim_end||1;
      const r=ap/2, th=theta*Math.PI/180, npts=80;
      const tMax=(Math.PI/2+th)*te, tMin=(Math.PI/2+th)*ts;
      const tvs=Array.from({length:npts+1},(_,i)=>tMin+(i/npts)*(tMax-tMin));
      const xs=tvs.map(tv=>r*(1+Math.sin(tv))*Math.cos(tv)/(1+Math.sin(th)));
      const ys=tvs.map(tv=>r*(1+Math.sin(tv))*Math.sin(tv)/(1+Math.sin(th))-r);
      const rl=xs.map((x,i)=>[x,ys[i]]), ll=xs.map((x,i)=>[-x,ys[i]]);
      [rl,ll].forEach(lp=>{
        const wp=applyTransform(lp,cx,cy,rot,olx,oly);
        const bp=applyTransform(offsetPath(lp,-.05),cx,cy,rot,olx,oly);
        ctx.beginPath();
        for(let i=0;i<wp.length;i++){const s=toScreen(wp[i][0],wp[i][1]);i===0?ctx.moveTo(s.x,s.y):ctx.lineTo(s.x,s.y);}
        for(let i=bp.length-1;i>=0;i--){const s=toScreen(bp[i][0],bp[i][1]);ctx.lineTo(s.x,s.y);}
        ctx.closePath(); ctx.fillStyle='#000000'; ctx.fill();
        drawSharpPath(ctx,wp,front,lw);
      });

    } else if(c.type==='glass'){
      const w=c.params.width||0.6;
      const lp=[[-w/2,0],[w/2,0]];
      const wp=applyTransform(lp,cx,cy,rot,olx,oly);
      ctx.globalAlpha=0.2; drawSharpPath(ctx,wp,front,6); ctx.globalAlpha=1;
      drawSharpPath(ctx,wp,front,1);
    }

    else if (c.type === 'filter') {
      const w = c.params.width || 3.0;
      const lp = [[-w/2, 0], [w/2, 0]];
      const wp = applyTransform(lp, cx, cy, rot, olx, oly);
      
      // Dashed Line
      ctx.beginPath();
      const p0 = toScreen(wp[0][0], wp[0][1]);
      const p1 = toScreen(wp[1][0], wp[1][1]);
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = sel ? '#000000' : '#00ff88';
      ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke();
      ctx.setLineDash([]);

      // Capture Direction Arrow (Points "Down" locally)
      const midPts = [[0, 0], [0, -0.4]]; 
      const wpMid = applyTransform(midPts, cx, cy, rot, olx, oly);
      const m0 = toScreen(wpMid[0][0], wpMid[0][1]);
      const m1 = toScreen(wpMid[1][0], wpMid[1][1]);
      
      ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.lineTo(m1.x, m1.y);
      ctx.strokeStyle = sel ? '#000000' : '#00ff88'; ctx.lineWidth = 1.5; ctx.stroke();
      
      const ang = Math.atan2(m1.y - m0.y, m1.x - m0.x);
      ctx.beginPath();
      ctx.moveTo(m1.x, m1.y);
      ctx.lineTo(m1.x - 6 * Math.cos(ang - 0.4), m1.y - 6 * Math.sin(ang - 0.4));
      ctx.lineTo(m1.x - 6 * Math.cos(ang + 0.4), m1.y - 6 * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fillStyle = sel ? '#ffffff' : '#00ff88'; ctx.fill();
    }

    const sc=toScreen(cx,cy);
    ctx.beginPath(); ctx.arc(sc.x,sc.y,sel?5:3.5,0,Math.PI*2);
    ctx.strokeStyle='#000000'; ctx.lineWidth=1.5; ctx.fillStyle='#ffffff';
    ctx.fill(); ctx.stroke();
    ctx.fillStyle='#000000'; ctx.font=(sel?'bold ':'')+' 10px Segoe UI'; ctx.textAlign='left';
    ctx.fillText(`${c.type.toUpperCase()} #${c.id}`,sc.x+10,sc.y-7);
  }
  ctx.restore();
}

function drawAssemblyLinks(ctx) {
  if(!State.simHinges||!State.simHinges.length) return;
  ctx.save();
  ctx.strokeStyle='#dddddd'; ctx.lineWidth=0.75; ctx.setLineDash([4,4]);
  const seen=new Set();
  for(const h of State.simHinges){
    const key=Math.min(h.compAId,h.compBId)+'_'+Math.max(h.compAId,h.compBId);
    if(seen.has(key)) continue; seen.add(key);
    const cA=State.components.find(c=>c.id===h.compAId);
    const cB=State.components.find(c=>c.id===h.compBId);
    if(!cA||!cB) continue;
    const a=toScreen(cA.position.x,cA.position.y);
    const b=toScreen(cB.position.x,cB.position.y);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function initCanvas() {
  const canvas=document.getElementById('canvas');
  const dpr=window.devicePixelRatio||1;
  const wrap=document.getElementById('canvas-wrap');
  State.dpr=dpr; State.cssW=wrap.clientWidth; State.cssH=wrap.clientHeight;
  canvas.style.width=State.cssW+'px'; canvas.style.height=State.cssH+'px';
  canvas.width=Math.round(State.cssW*dpr); canvas.height=Math.round(State.cssH*dpr);
  canvas.getContext('2d').scale(dpr,dpr);
  draw();
}

window.draw       = draw;
window.initCanvas = initCanvas;