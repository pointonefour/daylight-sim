// wb_canvas.js — workbench canvas rendering

// Constants owned by canvas (trim handle radius lives in wb_controls.js)
const WB_REFLECT = '#1a3aaa';
const WB_BACK    = '#000000';
const WB_SELECT  = '#c46940';
const WB_GHOST   = '#588bf8';
const WB_ANNOT   = '#888888';
const WB_HINGE_R = 8;
const WB_TRIM_PICK_R = 10; // hit radius for trim handles on canvas

// ── MAIN DRAW ─────────────────────────────────────────────
function wbDraw() {
  const canvas = document.getElementById('wb-canvas'); if (!canvas) return;
  const ctx    = canvas.getContext('2d');

  // Always reconcile before drawing so geometry changes propagate
  wbReconcileChain();

  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.restore();

  wbDrawGrid(ctx);
  wbDrawChainLines(ctx);

  // Inactive mirrors first, active on top
  for (const m of WB.mirrors) if (m.id !== WB.activeId) wbDrawMirror(ctx,m,false);
  const active = wbActive(); if (active) wbDrawMirror(ctx,active,true);

  wbDrawHinges(ctx);
  wbDrawHingeMode(ctx);
  wbDrawContextMenu(ctx);
}

// ── GRID ──────────────────────────────────────────────────
function wbDrawGrid(ctx) {
  const s=wbScale(), W=WB.cssW, H=WB.cssH;
  const ox=W/2+WB.viewport.panX, oy=H/2+WB.viewport.panY;
  ctx.save();
  ctx.strokeStyle='#eeeeee'; ctx.lineWidth=0.5;
  for(let x=ox%s;x<W;x+=s){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=oy%s;y<H;y+=s){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  ctx.strokeStyle='#cccccc'; ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(ox,0);ctx.lineTo(ox,H);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,oy);ctx.lineTo(W,oy);ctx.stroke();
  ctx.fillStyle='#cccccc'; ctx.font='9px Segoe UI'; ctx.textAlign='center';
  for(let i=-20;i<=20;i++){
    if(!i) continue;
    const sw=wbToScreen(i*0.1,0); ctx.fillText((i*100)+'mm',sw.x,oy+12);
    const sh=wbToScreen(0,i*0.1); ctx.textAlign='right'; ctx.fillText((i*100)+'mm',ox-4,sh.y+3); ctx.textAlign='center';
  }
  ctx.restore();
}

// Dashed lines connecting hinged mirrors
function wbDrawChainLines(ctx) {
  ctx.save();
  ctx.strokeStyle='#cccccc'; ctx.lineWidth=0.75; ctx.setLineDash([4,4]);
  for (const h of WB.hinges) {
    const[hwx,hwy]=wbComputeHingeWorld(h);
    const mB=wbGetMirror(h.mirrorB.mirrorId); if(!mB) continue;
    const hs=wbToScreen(hwx,hwy), bs=wbToScreen(mB.tx,mB.ty);
    ctx.beginPath();ctx.moveTo(hs.x,hs.y);ctx.lineTo(bs.x,bs.y);ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// ── MIRROR ────────────────────────────────────────────────
function wbDrawMirror(ctx, mirror, isActive) {
  const p=mirror.params, N=200;
  ctx.save();

  if (mirror.type === 'parabolic') {
    const f=p.focal_length||0.5, D=p.aperture||0.8;
    const ts=p.trim_start||0, te=p.trim_end||1;

    // Ghost full curve
    const fullPts=wbParabolaFull(f,D,N);
    wbDrawTransformed(ctx,mirror,fullPts,false);
    ctx.strokeStyle=WB_GHOST; ctx.lineWidth=0.8; ctx.stroke();

    // Trimmed surface
    const trimPts=wbParabolaTrimmed(f,D,ts,te,N);

    // Opaque back fill
    const backPts=trimPts.map(([x,y])=>{
      const dydx=x/(2*f), len=Math.sqrt(1+dydx*dydx);
      return [x-0.007/len, y-0.007*dydx/len];
    });
    ctx.beginPath();
    for(let i=0;i<trimPts.length;i++){
      const[wx,wy]=wbLocalToWorld(mirror,trimPts[i][0],trimPts[i][1]);
      const s=wbToScreen(wx,wy); i===0?ctx.moveTo(s.x,s.y):ctx.lineTo(s.x,s.y);
    }
    for(let i=backPts.length-1;i>=0;i--){
      const[wx,wy]=wbLocalToWorld(mirror,backPts[i][0],backPts[i][1]);
      const s=wbToScreen(wx,wy); ctx.lineTo(s.x,s.y);
    }
    ctx.closePath(); ctx.fillStyle=WB_BACK; ctx.fill();

    // Reflecting face
    wbDrawTransformed(ctx,mirror,trimPts,false);
    ctx.strokeStyle=isActive?WB_SELECT:WB_REFLECT; ctx.lineWidth=isActive?2.5:2; ctx.stroke();

    // Focal point
    const[fwx,fwy]=wbLocalToWorld(mirror,0,f);
    const fs=wbToScreen(fwx,fwy);
    ctx.beginPath();ctx.arc(fs.x,fs.y,3,0,Math.PI*2);
    ctx.fillStyle=isActive?WB_SELECT:WB_REFLECT; ctx.fill();
    ctx.fillStyle=WB_ANNOT; ctx.font='8px Segoe UI'; ctx.textAlign='left';
    ctx.fillText('F',fs.x+5,fs.y-2);

    if (isActive) {
      // Normals
      [0,Math.floor(N/4),Math.floor(N/2),Math.floor(3*N/4),N].forEach(idx=>{
        const i=Math.min(idx,trimPts.length-1);
        const pt=trimPts[i], n=wbNormalAt(trimPts,i);
        const[wx0,wy0]=wbLocalToWorld(mirror,pt[0],pt[1]);
        const[wx1,wy1]=wbLocalToWorld(mirror,pt[0]+n[0]*0.03,pt[1]+n[1]*0.03);
        const s0=wbToScreen(wx0,wy0), s1=wbToScreen(wx1,wy1);
        ctx.strokeStyle='#4466cc'; ctx.lineWidth=0.75;
        ctx.beginPath();ctx.moveTo(s0.x,s0.y);ctx.lineTo(s1.x,s1.y);ctx.stroke();
      });
      // Trim handles
      const xS=-D/2+ts*D, yS=xS*xS/(4*f);
      const xE=-D/2+te*D, yE=xE*xE/(4*f);
      const[wsx,wsy]=wbLocalToWorld(mirror,xS,yS);
      const[wex,wey]=wbLocalToWorld(mirror,xE,yE);
      _drawTrimHandle(ctx,wsx,wsy,WB.trimDrag&&WB.trimDrag.end==='start');
      _drawTrimHandle(ctx,wex,wey,WB.trimDrag&&WB.trimDrag.end==='end');
      if (WB.datasheets[mirror.id]) _drawParabolaAnnot(ctx,mirror);
    }

  } else if (mirror.type === 'flat') {
    const w=p.width||0.6, ts=p.trim_start||0, te=p.trim_end||1;
    const xS=-w/2+ts*w, xE=-w/2+te*w;
    const pts=[[xS,0],[xE,0]], back=[[xS,-0.007],[xE,-0.007]];

    ctx.beginPath();
    for(let i=0;i<pts.length;i++){
      const[wx,wy]=wbLocalToWorld(mirror,pts[i][0],pts[i][1]);
      const s=wbToScreen(wx,wy); i===0?ctx.moveTo(s.x,s.y):ctx.lineTo(s.x,s.y);
    }
    for(let i=back.length-1;i>=0;i--){
      const[wx,wy]=wbLocalToWorld(mirror,back[i][0],back[i][1]);
      const s=wbToScreen(wx,wy); ctx.lineTo(s.x,s.y);
    }
    ctx.closePath(); ctx.fillStyle=WB_BACK; ctx.fill();
    wbDrawTransformed(ctx,mirror,pts,false);
    ctx.strokeStyle=isActive?WB_SELECT:WB_REFLECT; ctx.lineWidth=isActive?2.5:2; ctx.stroke();

    if (isActive) {
      const[wsx,wsy]=wbLocalToWorld(mirror,xS,0);
      const[wex,wey]=wbLocalToWorld(mirror,xE,0);
      _drawTrimHandle(ctx,wsx,wsy,WB.trimDrag&&WB.trimDrag.end==='start');
      _drawTrimHandle(ctx,wex,wey,WB.trimDrag&&WB.trimDrag.end==='end');
    }

  } else if (mirror.type === 'cpc') {
    const ts=p.trim_start||0, te=p.trim_end||1;
    const{right,left}=wbCPCArms(p.aperture||0.6,p.acceptance_angle||30,ts,te,N);
    [right,left].forEach(arm=>{
      wbDrawTransformed(ctx,mirror,arm,false);
      ctx.strokeStyle=isActive?WB_SELECT:WB_REFLECT; ctx.lineWidth=isActive?2.5:2; ctx.stroke();
    });
    const[rlwx,rlwy]=wbLocalToWorld(mirror,left[0][0],left[0][1]);
    const[rrwx,rrwy]=wbLocalToWorld(mirror,right[0][0],right[0][1]);
    ctx.strokeStyle='#888888'; ctx.lineWidth=0.75; ctx.setLineDash([3,3]);
    const sRL=wbToScreen(rlwx,rlwy), sRR=wbToScreen(rrwx,rrwy);
    ctx.beginPath();ctx.moveTo(sRL.x,sRL.y);ctx.lineTo(sRR.x,sRR.y);ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── ORIGIN GIZMO ──────────────────────────────────────
  const os=wbToScreen(mirror.tx,mirror.ty);
  let pivotS=os;
  if (mirror.parentHingeId!==null) {
    const ph=wbGetHinge(mirror.parentHingeId);
    if(ph){const[pwx,pwy]=wbComputeHingeWorld(ph);pivotS=wbToScreen(pwx,pwy);}
  }

  if (isActive) {
    ctx.beginPath();ctx.arc(os.x,os.y,7,0,Math.PI*2);
    ctx.fillStyle='#ffffff';ctx.strokeStyle='#000000';ctx.lineWidth=1.5;ctx.fill();ctx.stroke();
    ctx.strokeStyle='#000000';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(os.x-10,os.y);ctx.lineTo(os.x+10,os.y);ctx.stroke();
    ctx.beginPath();ctx.moveTo(os.x,os.y-10);ctx.lineTo(os.x,os.y+10);ctx.stroke();

    const rotAng=(mirror.rotation+90)*Math.PI/180;
    const rhx=pivotS.x+32*Math.cos(rotAng), rhy=pivotS.y-32*Math.sin(rotAng);
    ctx.beginPath();ctx.arc(rhx,rhy,5,0,Math.PI*2);
    ctx.fillStyle='#ffffff';ctx.strokeStyle='#000000';ctx.lineWidth=1.5;ctx.fill();ctx.stroke();
    ctx.strokeStyle='#cccccc';ctx.lineWidth=0.75;ctx.setLineDash([2,3]);
    ctx.beginPath();ctx.moveTo(pivotS.x,pivotS.y);ctx.lineTo(rhx,rhy);ctx.stroke();
    ctx.setLineDash([]);

    const scAng=mirror.rotation*Math.PI/180;
    const shx=os.x+42*Math.cos(scAng), shy=os.y-42*Math.sin(scAng);
    ctx.fillStyle='#ffffff';ctx.strokeStyle='#000000';ctx.lineWidth=1.5;
    ctx.fillRect(shx-4,shy-4,8,8);ctx.strokeRect(shx-4,shy-4,8,8);
  } else {
    ctx.beginPath();ctx.arc(os.x,os.y,3,0,Math.PI*2);
    ctx.fillStyle='#ffffff';ctx.strokeStyle='#888888';ctx.lineWidth=1;ctx.fill();ctx.stroke();
  }

  const hp=mirror.parentHingeId!==null?' [child]':'';
  const hc=(mirror.childHingeIds||[]).length>0?' [parent]':'';
  ctx.fillStyle=isActive?'#000000':'#888888';
  ctx.font=(isActive?'bold ':'')+' 9px Segoe UI'; ctx.textAlign='left';
  ctx.fillText(`${mirror.type.toUpperCase()} #${mirror.id}${hp}${hc}`,os.x+12,os.y-8);
  ctx.restore();
}

// ── HINGE MARKERS ─────────────────────────────────────────
function wbDrawHinges(ctx) {
  ctx.save();
  for (const h of WB.hinges) {
    const[hwx,hwy]=wbComputeHingeWorld(h);
    const hs=wbToScreen(hwx,hwy);
    ctx.beginPath();ctx.arc(hs.x,hs.y,WB_HINGE_R,0,Math.PI*2);
    ctx.fillStyle='#ffffff';ctx.strokeStyle='#000000';ctx.lineWidth=2;ctx.fill();ctx.stroke();
    ctx.strokeStyle='#000000';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(hs.x-WB_HINGE_R+2,hs.y);ctx.lineTo(hs.x+WB_HINGE_R-2,hs.y);ctx.stroke();
    ctx.beginPath();ctx.moveTo(hs.x,hs.y-WB_HINGE_R+2);ctx.lineTo(hs.x,hs.y+WB_HINGE_R-2);ctx.stroke();
    ctx.fillStyle='#000000';ctx.font='8px Segoe UI';ctx.textAlign='left';
    ctx.fillText('H'+h.id,hs.x+WB_HINGE_R+3,hs.y+3);
  }
  ctx.restore();
}

// ── HINGE MODE OVERLAY ────────────────────────────────────
function wbDrawHingeMode(ctx) {
  const hm=WB.hingeMode; if(!hm) return;
  ctx.save();
  const stepText=[
    'STEP 1/4 — Click first mirror',
    'STEP 2/4 — Choose point on first mirror',
    'STEP 3/4 — Click second mirror (or canvas to add new)',
    'STEP 4/4 — Choose point on second mirror',
  ][hm.step]||'';
  ctx.fillStyle='#000000';ctx.strokeStyle='#ffffff';ctx.lineWidth=1;
  ctx.fillRect(10,10,320,24);ctx.strokeRect(10,10,320,24);
  ctx.fillStyle='#ffffff';ctx.font='bold 10px Segoe UI';ctx.textAlign='left';
  ctx.fillText(stepText,18,26);
  ctx.fillStyle='#555555';ctx.font='9px Segoe UI';
  ctx.fillText('Press Esc to cancel',18,46);

  // Highlight named points on the pick target mirror
  const pickMirror = hm.step===1 ? wbGetMirror(hm.mirrorAId)
                   : hm.step===3 ? wbGetMirror(hm.mirrorBId)
                   : null;
  if (pickMirror) {
    const pts=WB.NAMED_POINTS[pickMirror.type]||[];
    pts.forEach(ptName=>{
      const[wx,wy]=wbNamedPointWorld(pickMirror,ptName);
      const s=wbToScreen(wx,wy);
      ctx.beginPath();ctx.arc(s.x,s.y,7,0,Math.PI*2);
      ctx.fillStyle='#ffffff';ctx.strokeStyle='#000000';ctx.lineWidth=2;ctx.fill();ctx.stroke();
      ctx.fillStyle='#000000';ctx.font='8px Segoe UI';ctx.textAlign='center';
      ctx.fillText(ptName.replace('_',' '),s.x,s.y-10);
    });
  }
  ctx.restore();
}

// ── CONTEXT MENU ──────────────────────────────────────────
function wbDrawContextMenu(ctx) {
  const cm=WB.contextMenu; if(!cm) return;
  ctx.save();
  ctx.fillStyle='#000000';ctx.strokeStyle='#ffffff';ctx.lineWidth=1;
  ctx.fillRect(cm.sx,cm.sy,220,52);ctx.strokeRect(cm.sx,cm.sy,220,52);
  ctx.fillStyle='#ffffff';ctx.font='10px Segoe UI';ctx.textAlign='left';
  ctx.fillText('Add Hinge Here',cm.sx+10,cm.sy+18);
  ctx.strokeStyle='#333333';ctx.lineWidth=0.5;
  ctx.beginPath();ctx.moveTo(cm.sx,cm.sy+26);ctx.lineTo(cm.sx+220,cm.sy+26);ctx.stroke();
  ctx.fillText('Trace Tangent Mirror',cm.sx+10,cm.sy+44);
  ctx.restore();
}

// ── PRIVATE HELPERS ───────────────────────────────────────
function _drawTrimHandle(ctx,wx,wy,active) {
  const s=wbToScreen(wx,wy);
  ctx.beginPath();ctx.arc(s.x,s.y,6,0,Math.PI*2);
  ctx.fillStyle=active?'#000000':'#ffffff';
  ctx.strokeStyle='#000000';ctx.lineWidth=1.5;ctx.fill();ctx.stroke();
}

function _drawParabolaAnnot(ctx,mirror) {
  const ds=WB.datasheets[mirror.id]; if(!ds) return;
  const[tlwx,tlwy]=wbLocalToWorld(mirror,ds.tip_left.x,ds.tip_left.y);
  const[trwx,trwy]=wbLocalToWorld(mirror,ds.tip_right.x,ds.tip_right.y);
  const tl=wbToScreen(tlwx,tlwy), tr=wbToScreen(trwx,trwy);
  ctx.save();
  ctx.strokeStyle='#cccccc';ctx.lineWidth=0.75;ctx.setLineDash([3,3]);
  ctx.beginPath();ctx.moveTo(tl.x,tl.y);ctx.lineTo(tr.x,tr.y);ctx.stroke();
  ctx.setLineDash([]);
  const mx=(tl.x+tr.x)/2, my=(tl.y+tr.y)/2;
  ctx.fillStyle=WB_ANNOT;ctx.font='8px Segoe UI';ctx.textAlign='center';
  ctx.fillText(`arc:${(ds.arc_length_m*1000).toFixed(1)}mm`,mx,my-8);
  ctx.restore();
}

function wbInitCanvas() {
  const canvas=document.getElementById('wb-canvas');
  const wrap=document.getElementById('wb-canvas-wrap');
  WB.dpr=window.devicePixelRatio||1;
  WB.cssW=wrap.clientWidth; WB.cssH=wrap.clientHeight;
  canvas.style.width=WB.cssW+'px'; canvas.style.height=WB.cssH+'px';
  canvas.width=Math.round(WB.cssW*WB.dpr); canvas.height=Math.round(WB.cssH*WB.dpr);
  canvas.getContext('2d').scale(WB.dpr,WB.dpr);
  wbDraw();
}

// ── EXPORTS (only what this file owns) ────────────────────
window.wbDraw       = wbDraw;
window.wbInitCanvas = wbInitCanvas;