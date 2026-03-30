// wb_controls.js — mirror list, params, mouse, hinge flow

const WB_TRIM_R = 6;

// ── MIRROR LIST ───────────────────────────────────────────
function wbRenderList() {
  const el=document.getElementById('wb-mirror-list'); if(!el) return;
  if (!WB.mirrors.length) {
    el.innerHTML='<div style="color:#555;font-size:10px;">No mirrors added yet</div>';
    return;
  }
  el.innerHTML=WB.mirrors.map(m=>{
    const hp = m.parentHingeId!==null?' [child]':'';
    const hc = (m.childHingeIds||[]).length>0?' [parent]':'';
    return `<div class="wb-list-item ${m.id===WB.activeId?'sel':''}" onclick="wbSelectMirror(${m.id})">
      <span class="wb-li-name">${m.type.toUpperCase()} #${m.id}${hp}${hc}</span>
      <span class="wb-li-info">tx:${m.tx.toFixed(2)} ty:${m.ty.toFixed(2)} r:${m.rotation.toFixed(0)}°</span>
    </div>`;
  }).join('');
}

function wbSelectMirror(id) {
  wbSelect(id);
  wbRenderList(); wbRenderParams(); wbRenderDatasheet(); wbDraw();
}

function wbAddMirror(type) {
  const m=wbNewMirror(type);
  m.tx=(WB.mirrors.length*0.12)%1.0;
  WB.mirrors.push(m);
  wbSelectMirror(m.id);
  wbSave();
  wbPushState();
}

function wbDeleteActive() {
  if (WB.activeId===null) return;
  const m=wbActive();
  // Remove hinges involving this mirror
  if (m) {
    WB.hinges=WB.hinges.filter(h=>{
      if (h.mirrorA.mirrorId===m.id||h.mirrorB.mirrorId===m.id) {
        // Clean up parent/child refs
        const mA=wbGetMirror(h.mirrorA.mirrorId);
        const mB=wbGetMirror(h.mirrorB.mirrorId);
        if(mA) mA.childHingeIds=(mA.childHingeIds||[]).filter(id=>id!==h.id);
        if(mB) mB.parentHingeId=null;
        return false;
      }
      return true;
    });
  }
  WB.mirrors=WB.mirrors.filter(m=>m.id!==WB.activeId);
  delete WB.datasheets[WB.activeId];
  wbDeselect();
  wbRenderList(); wbRenderParams(); wbRenderDatasheet(); wbDraw();
  wbSave();
  wbPushState();
}

// ── PARAM PANEL ───────────────────────────────────────────
function wbRenderParams() {
  const m=wbActive();
  document.getElementById('wb-sec-object').style.display       = m?'flex':'none';
  document.getElementById('wb-params-parabolic').style.display = (m&&m.type==='parabolic')?'flex':'none';
  document.getElementById('wb-params-flat').style.display      = (m&&m.type==='flat')?'flex':'none';
  document.getElementById('wb-params-cpc').style.display       = (m&&m.type==='cpc')?'flex':'none';
  document.getElementById('wb-sec-material').style.display     = m?'flex':'none';
  document.getElementById('wb-sec-mfg').style.display          = m?'flex':'none';
  if (!m) return;

  wbSync('wb-tx',       m.tx);       wbLbl('wb-tx',       m.tx.toFixed(3)+' m');
  wbSync('wb-ty',       m.ty);       wbLbl('wb-ty',       m.ty.toFixed(3)+' m');
  wbSync('wb-rotation', m.rotation); wbLbl('wb-rotation', m.rotation.toFixed(1)+'°');
  wbSync('wb-scalex',   m.scaleX);   wbLbl('wb-scalex',   m.scaleX.toFixed(3));
  wbSync('wb-scaley',   m.scaleY);   wbLbl('wb-scaley',   m.scaleY.toFixed(3));

  const p=m.params;
  const originSel=document.getElementById('wb-origin');
  if (originSel) originSel.innerHTML=(WB.ORIGINS[m.type]||[]).map(o=>
    `<option value="${o}" ${p.origin===o?'selected':''}>${o.replace(/_/g,' ')}</option>`
  ).join('');

  if (m.type==='parabolic') {
    wbSync('wb-focal-length',p.focal_length); wbLbl('wb-focal-length',(p.focal_length*1000).toFixed(0)+' mm');
    wbSync('wb-aperture',    p.aperture);     wbLbl('wb-aperture',    (p.aperture*1000).toFixed(0)+' mm');
    _syncTrim(m,'wb-trim-start',p.trim_start||0);
    _syncTrim(m,'wb-trim-end',  p.trim_end||1);
  } else if (m.type==='flat') {
    wbSync('wb-width',p.width); wbLbl('wb-width',(p.width*1000).toFixed(0)+' mm');
    _syncTrim(m,'wb-trim-start',p.trim_start||0);
    _syncTrim(m,'wb-trim-end',  p.trim_end||1);
  } else if (m.type==='cpc') {
    wbSync('wb-aperture',    p.aperture);          wbLbl('wb-aperture',    (p.aperture*1000).toFixed(0)+' mm');
    wbSync('wb-accept-angle',p.acceptance_angle);  wbLbl('wb-accept-angle',p.acceptance_angle.toFixed(1)+'°');
    wbSync('wb-truncation',  p.truncation_factor); wbLbl('wb-truncation',  p.truncation_factor.toFixed(2));
    _syncTrim(m,'wb-trim-start',p.trim_start||0);
    _syncTrim(m,'wb-trim-end',  p.trim_end||1);
  }

  wbSync('wb-material',    p.material);
  wbSync('wb-mfg',         p.manufacturing);
  wbSync('wb-reflectivity',p.reflectivity);  wbLbl('wb-reflectivity',p.reflectivity.toFixed(3));
  wbSync('wb-roughness',   p.roughness_ra_um); wbLbl('wb-roughness',  p.roughness_ra_um.toFixed(2)+' μm');
  wbSync('wb-substrate-t', p.substrate_thickness_mm); wbLbl('wb-substrate-t',p.substrate_thickness_mm.toFixed(1)+' mm');
  wbSync('wb-slope-error', p.slope_error_mrad); wbLbl('wb-slope-error',p.slope_error_mrad.toFixed(2)+' mrad');
  wbSync('wb-pv-error',    p.pv_error_um);    wbLbl('wb-pv-error',   p.pv_error_um.toFixed(1)+' μm');
  wbSync('wb-point-count', p.point_count);    wbLbl('wb-point-count',p.point_count);
}

function _syncTrim(mirror,elId,normVal) {
  wbSync(elId,normVal);
  const mm=wbTrimLengthMm(mirror,normVal);
  wbLbl(elId,(normVal*100).toFixed(0)+'%  |  '+mm.toFixed(1)+' mm');
}

function wbSync(id,val){const el=document.getElementById(id);if(el)el.value=val;}
function wbLbl(id,text){const el=document.getElementById(id+'-val');if(el)el.textContent=text;}

function wbOnChange(key,val) {
  const m=wbActive(); if(!m) return;
  const num=parseFloat(val), v=isNaN(num)?val:num;
  if      (key==='tx')       m.tx=v;
  else if (key==='ty')       m.ty=v;
  else if (key==='rotation') m.rotation=v;
  else if (key==='scaleX')   m.scaleX=Math.max(0.01,v);
  else if (key==='scaleY')   m.scaleY=Math.max(0.01,v);
  else {
    m.params[key]=v;
    if(key==='trim_start') m.params.trim_start=Math.min(v,m.params.trim_end-0.05);
    if(key==='trim_end')   m.params.trim_end  =Math.max(v,m.params.trim_start+0.05);
  }
  // After any geometry change, reconcile runs in wbDraw automatically
  wbRenderList(); wbRenderParams(); wbDraw(); wbSave(); wbPushState();
}

function wbSetType(type) {
  const m=wbActive(); if(!m) return;
  m.type=type; m.params={...WB.DEF[type]};
  wbRenderList(); wbRenderParams(); wbDraw();
  WB.datasheets[m.id]=null; wbRenderDatasheet(); wbSave();
}

// ── ADD HINGE FLOW ────────────────────────────────────────
// hingeMode state machine:
// { step:0 }                                    → waiting for mirrorA click
// { step:1, mirrorAId, mx, my }                 → waiting for point selection on mirrorA
// { step:2, mirrorAId, pointA }                 → waiting for mirrorB click
// { step:3, mirrorBId, mirrorAId, pointA, mx, my } → waiting for point on mirrorB

function wbStartHingeMode() {
  WB.hingeMode = { step: 0 };
  WB.contextMenu = null;
  wbDraw();
}

function wbCancelHingeMode() {
  WB.hingeMode = null;
  wbDraw();
}

function _hingePickPoint(mirror, mx, my) {
  // Find which named point was clicked (screen coords)
  const pts = WB.NAMED_POINTS[mirror.type]||[];
  for (const ptName of pts) {
    const[wx,wy]=wbNamedPointWorld(mirror,ptName);
    const s=wbToScreen(wx,wy);
    if (wbHyp(mx-s.x,my-s.y)<12) return ptName;
  }
  return null;
}

function _finalizeHinge(mirrorAId, pointA, mirrorBId, pointB) {
  const mA=wbGetMirror(mirrorAId);
  const mB=wbGetMirror(mirrorBId);
  if (!mA||!mB) return;

  // Create hinge
  const hinge = {
    id:      WB.hingeIdCtr++,
    mirrorA: { mirrorId: mirrorAId, pointName: pointA },
    mirrorB: { mirrorId: mirrorBId, pointName: pointB },
  };
  WB.hinges.push(hinge);

  // Wire up parent-child
  if (!mA.childHingeIds) mA.childHingeIds=[];
  mA.childHingeIds.push(hinge.id);
  mB.parentHingeId=hinge.id;

  // Set mB rotation to be tangent to mA at pointA (if applicable)
  mB.rotation = wbTangentRotation(mA, pointA);

  // Reconcile will snap mB into position
  wbReconcileChain();
  WB.hingeMode=null;
  wbSelectMirror(mirrorBId);
  wbSave(); wbPushState();
}

// ── MOUSE ─────────────────────────────────────────────────
function wbInitMouse() {
  const canvas=document.getElementById('wb-canvas');

  // Escape cancels hinge mode
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'&&WB.hingeMode){wbCancelHingeMode();}
  });

  // Wheel zoom
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    const r=canvas.getBoundingClientRect();
    const mx=e.clientX-r.left, my=e.clientY-r.top;
    const s0=wbScale();
    const wx=(mx-WB.cssW/2-WB.viewport.panX)/s0;
    const wy=-(my-WB.cssH/2-WB.viewport.panY)/s0;
    const factor=e.deltaY<0?1.1:0.91;
    WB.viewport.zoom=Math.max(0.05,Math.min(30,WB.viewport.zoom*factor));
    const s1=wbScale();
    WB.viewport.panX=mx-WB.cssW/2-wx*s1;
    WB.viewport.panY=my-WB.cssH/2+wy*s1;
    wbDraw();
  },{passive:false});

  canvas.addEventListener('mousedown',e=>{
    const r=canvas.getBoundingClientRect();
    const mx=e.clientX-r.left, my=e.clientY-r.top;

    // ── HINGE MODE ──────────────────────────────────────
    if (WB.hingeMode!==null) {
      const hm=WB.hingeMode;
      if (e.button===2){wbCancelHingeMode();return;}

      if (hm.step===0) {
        // Click any mirror to select as mirrorA
        for (const m of [...WB.mirrors].reverse()) {
          const os=wbToScreen(m.tx,m.ty);
          if (wbHyp(mx-os.x,my-os.y)<20) {
            WB.hingeMode={step:1, mirrorAId:m.id, mx, my};
            wbDraw(); return;
          }
        }
        return;
      }

      if (hm.step===1) {
        // Click a named point on mirrorA
        const mA=wbGetMirror(hm.mirrorAId); if(!mA) return;
        const ptName=_hingePickPoint(mA,mx,my);
        if (ptName) {
          WB.hingeMode={step:2, mirrorAId:hm.mirrorAId, pointA:ptName};
          wbDraw();
        }
        return;
      }

      if (hm.step===2) {
        // Click mirrorB (different from mirrorA)
        for (const m of [...WB.mirrors].reverse()) {
          if (m.id===hm.mirrorAId) continue;
          const os=wbToScreen(m.tx,m.ty);
          if (wbHyp(mx-os.x,my-os.y)<20) {
            WB.hingeMode={step:3, mirrorAId:hm.mirrorAId, pointA:hm.pointA, mirrorBId:m.id, mx, my};
            wbDraw(); return;
          }
        }
        // No mirror hit — add a NEW flat mirror at click position
        const w=wbToWorld(mx,my);
        const newM=wbNewMirror('flat');
        newM.tx=w.x; newM.ty=w.y;
        WB.mirrors.push(newM);
        WB.hingeMode={step:3, mirrorAId:hm.mirrorAId, pointA:hm.pointA, mirrorBId:newM.id, mx, my};
        wbDraw(); return;
      }

      if (hm.step===3) {
        // Click named point on mirrorB
        const mB=wbGetMirror(hm.mirrorBId); if(!mB) return;
        const ptName=_hingePickPoint(mB,mx,my);
        if (ptName) {
          _finalizeHinge(hm.mirrorAId,hm.pointA,hm.mirrorBId,ptName);
          wbDraw();
        }
        return;
      }
      return;
    }

    // ── CONTEXT MENU ────────────────────────────────────
    if (WB.contextMenu) {
      const cm=WB.contextMenu;
      // Option 1: Add Hinge Here
      if (mx>=cm.sx&&mx<=cm.sx+220&&my>=cm.sy+0&&my<=cm.sy+26) {
        WB.contextMenu=null;
        // Start hinge mode pre-seeded with mirrorA and pointName
        WB.hingeMode={step:2, mirrorAId:cm.mirrorId, pointA:cm.pointName};
        wbDraw(); return;
      }
      // Option 2: Trace Tangent Mirror
      if (mx>=cm.sx&&mx<=cm.sx+220&&my>=cm.sy+26&&my<=cm.sy+52) {
        const traceMirrorId=cm.mirrorId, tracePoint=cm.pointName;
        WB.contextMenu=null;
        wbTraceTangentMirror(traceMirrorId,tracePoint);
        wbDraw(); return;
      }
      WB.contextMenu=null; wbDraw(); return;
    }

    // Right-click → context menu on named points
    if (e.button===2) {
      // Find nearest named point across all mirrors
      let bestDist=20, bestMirror=null, bestPoint=null;
      for (const m of WB.mirrors) {
        const pts=WB.NAMED_POINTS[m.type]||[];
        for (const ptName of pts) {
          const[wx,wy]=wbNamedPointWorld(m,ptName);
          const s=wbToScreen(wx,wy);
          const d=wbHyp(mx-s.x,my-s.y);
          if(d<bestDist){bestDist=d;bestMirror=m;bestPoint=ptName;}
        }
      }
      if (bestMirror) {
        WB.contextMenu={sx:mx,sy:my,mirrorId:bestMirror.id,pointName:bestPoint,mx,my};
        wbDraw();
      }
      return;
    }

    // Middle mouse pan
    if(e.button===1){WB.pan={active:true,lastMx:mx,lastMy:my};return;}

    const active=wbActive();
    if (active) {
      // Trim handle — parabolic
      if (active.type==='parabolic') {
        const p=active.params,f=p.focal_length||0.5,D=p.aperture||0.8;
        const xS=-D/2+(p.trim_start||0)*D,yS=xS*xS/(4*f);
        const xE=-D/2+(p.trim_end||1)*D,yE=xE*xE/(4*f);
        const[wsx,wsy]=wbLocalToWorld(active,xS,yS);
        const[wex,wey]=wbLocalToWorld(active,xE,yE);
        const sS=wbToScreen(wsx,wsy),sE=wbToScreen(wex,wey);
        if(wbHyp(mx-sS.x,my-sS.y)<WB_TRIM_R+4){WB.trimDrag={mirrorId:active.id,end:'start'};return;}
        if(wbHyp(mx-sE.x,my-sE.y)<WB_TRIM_R+4){WB.trimDrag={mirrorId:active.id,end:'end'};  return;}
      }
      // Trim handle — flat
      if (active.type==='flat') {
        const p=active.params,w=p.width||0.6,ts=p.trim_start||0,te=p.trim_end||1;
        const[wsx,wsy]=wbLocalToWorld(active,-w/2+ts*w,0);
        const[wex,wey]=wbLocalToWorld(active,-w/2+te*w,0);
        const sS=wbToScreen(wsx,wsy),sE=wbToScreen(wex,wey);
        if(wbHyp(mx-sS.x,my-sS.y)<WB_TRIM_R+4){WB.trimDrag={mirrorId:active.id,end:'start'};return;}
        if(wbHyp(mx-sE.x,my-sE.y)<WB_TRIM_R+4){WB.trimDrag={mirrorId:active.id,end:'end'};  return;}
      }

      // Gizmo handles
      const os=wbToScreen(active.tx,active.ty);
      // Pivot for rotation
      let pivotS=os;
      if (active.parentHingeId!==null) {
        const ph=wbGetHinge(active.parentHingeId);
        if(ph){const[pwx,pwy]=wbComputeHingeWorld(ph);pivotS=wbToScreen(pwx,pwy);}
      }
      const rotAng=(active.rotation+90)*Math.PI/180;
      const rhx=pivotS.x+32*Math.cos(rotAng), rhy=pivotS.y-32*Math.sin(rotAng);
      const scAng=active.rotation*Math.PI/180;
      const shx=os.x+42*Math.cos(scAng), shy=os.y-42*Math.sin(scAng);

      if(wbHyp(mx-rhx,my-rhy)<8){
        WB.drag={active:true,type:'rotate',startMx:mx,startMy:my,
          startVal:{rotation:active.rotation,pivotS}};
        return;
      }
      if(wbHyp(mx-shx,my-shy)<8){
        WB.drag={active:true,type:'scale',startMx:mx,startMy:my,
          startVal:{scaleX:active.scaleX,scaleY:active.scaleY}};
        return;
      }
      if(wbHyp(mx-os.x,my-os.y)<10){
        // Snapshot self and all ancestors' tx/ty for clean move
        const startVal={tx:active.tx,ty:active.ty};
        _snapshotTree(active,startVal);
        WB.drag={active:true,type:'move',startMx:mx,startMy:my,startVal};
        return;
      }
    }

    // Click to select
    for (const m of [...WB.mirrors].reverse()) {
      const os=wbToScreen(m.tx,m.ty);
      if(wbHyp(mx-os.x,my-os.y)<14){wbSelectMirror(m.id);return;}
    }
    wbDeselect(); wbRenderList(); wbRenderParams(); wbRenderDatasheet(); wbDraw();
  });

  canvas.addEventListener('mousemove',e=>{
    const r=canvas.getBoundingClientRect();
    const mx=e.clientX-r.left, my=e.clientY-r.top;

    if(WB.pan.active){
      WB.viewport.panX+=mx-WB.pan.lastMx;
      WB.viewport.panY+=my-WB.pan.lastMy;
      WB.pan.lastMx=mx; WB.pan.lastMy=my;
      wbDraw(); return;
    }

    if(WB.drag.active){
      const active=wbActive(); if(!active) return;
      const dx=mx-WB.drag.startMx, dy=my-WB.drag.startMy;
      const s=wbScale();

      if(WB.drag.type==='move'){
        const dWorldX=dx/s, dWorldY=-dy/s;
        // Move this mirror
        active.tx=WB.drag.startVal.tx+dWorldX;
        active.ty=WB.drag.startVal.ty+dWorldY;
        // Move all children using snapshotted positions
        _applyTreeMove(active,dWorldX,dWorldY,WB.drag.startVal);
        // Reconcile positions of all child chains
        wbReconcileChain();
      } else if(WB.drag.type==='rotate'){
        const ps=WB.drag.startVal.pivotS;
        const ang=Math.atan2(-(my-ps.y),mx-ps.x)*180/Math.PI;
        active.rotation=(ang-90+360)%360;
        // After rotation, reconcile children
        wbPropagateRotateToChildren();
      } else if(WB.drag.type==='scale'){
        const factor=1+dx/100;
        active.scaleX=Math.max(0.01,WB.drag.startVal.scaleX*factor);
        active.scaleY=Math.max(0.01,WB.drag.startVal.scaleY*factor);
        wbReconcileChain();
      }

      wbRenderList(); wbRenderParams(); wbDraw(); return;
    }

    if(WB.trimDrag){
      const mirror=WB.mirrors.find(m=>m.id===WB.trimDrag.mirrorId); if(!mirror) return;
      const p=mirror.params;
      const w=wbToWorld(mx,my);
      const[localX]=wbWorldToLocal(mirror,w.x,w.y);

      if(mirror.type==='parabolic'){
        const D=p.aperture||0.8;
        const norm=(localX+D/2)/D;
        const c=Math.max(0.01,Math.min(0.99,norm));
        if(WB.trimDrag.end==='start') p.trim_start=Math.min(c,p.trim_end-0.05);
        else                           p.trim_end  =Math.max(c,p.trim_start+0.05);
      } else if(mirror.type==='flat'){
        const w2=p.width||0.6;
        const norm=(localX+w2/2)/w2;
        const c=Math.max(0.01,Math.min(0.99,norm));
        if(WB.trimDrag.end==='start') p.trim_start=Math.min(c,p.trim_end-0.05);
        else                           p.trim_end  =Math.max(c,p.trim_start+0.05);
      }
      wbRenderParams(); wbDraw(); return;
    }
  });

  canvas.addEventListener('mouseup',()=>{
    if(WB.drag.active||WB.trimDrag) wbSave(); wbPushState();
    WB.drag.active=false; WB.pan.active=false; WB.trimDrag=null;
  });
  canvas.addEventListener('mouseleave',()=>{WB.drag.active=false;WB.pan.active=false;WB.trimDrag=null;});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('mousedown',e=>{
    if(e.button===1){const r=canvas.getBoundingClientRect();WB.pan={active:true,lastMx:e.clientX-r.left,lastMy:e.clientY-r.top};}
  });
}

// Snapshot tx/ty of all children recursively
function _snapshotTree(mirror,startVal,visited) {
  visited=visited||new Set(); if(visited.has(mirror.id)) return;
  visited.add(mirror.id);
  for(const hid of(mirror.childHingeIds||[])){
    const h=wbGetHinge(hid); if(!h) continue;
    const child=wbGetMirror(h.mirrorB.mirrorId); if(!child) continue;
    startVal['tx_'+child.id]=child.tx;
    startVal['ty_'+child.id]=child.ty;
    _snapshotTree(child,startVal,visited);
  }
}

// Apply world delta to all children using snapshotted positions
function _applyTreeMove(mirror,dWorldX,dWorldY,startVal,visited) {
  visited=visited||new Set(); if(visited.has(mirror.id)) return;
  visited.add(mirror.id);
  for(const hid of(mirror.childHingeIds||[])){
    const h=wbGetHinge(hid); if(!h) continue;
    const child=wbGetMirror(h.mirrorB.mirrorId); if(!child) continue;
    const snapX=startVal['tx_'+child.id];
    const snapY=startVal['ty_'+child.id];
    if(snapX!==undefined){child.tx=snapX+dWorldX;child.ty=snapY+dWorldY;}
    _applyTreeMove(child,dWorldX,dWorldY,startVal,visited);
  }
}

// ── TRACE TANGENT MIRROR ─────────────────────────────────
// Creates a new flat mirror tangent to mirrorA at a named point,
// auto-connects them with a hinge.
function wbTraceTangentMirror(mirrorId, pointName) {
  const src=wbGetMirror(mirrorId); if(!src) return;

  // World position of the join point
  const[joinWx,joinWy]=wbNamedPointWorld(src,pointName);

  // Tangent rotation
  const newRot=wbTangentRotation(src,pointName);

  // Create new flat mirror
  const flat=wbNewMirror('flat');
  flat.rotation=newRot;

  // Determine which end of the flat joins to the parabolic
  // If joining at right_tip of parabolic → flat's left_tip is the join end
  const joinEnd = (pointName==='right_tip'||pointName==='focal') ? 'left_tip' : 'right_tip';
  flat.params.origin=joinEnd;

  // Position: tx,ty is where flat's origin (joinEnd) lands → that should be joinWx,joinWy
  flat.tx=joinWx; flat.ty=joinWy;

  WB.mirrors.push(flat);

  // Create hinge reference
  const hinge={
    id:      WB.hingeIdCtr++,
    mirrorA: {mirrorId:src.id,   pointName},
    mirrorB: {mirrorId:flat.id,  pointName:joinEnd},
  };
  WB.hinges.push(hinge);
  if(!src.childHingeIds) src.childHingeIds=[];
  src.childHingeIds.push(hinge.id);
  flat.parentHingeId=hinge.id;

  wbReconcileChain();
  wbSelectMirror(flat.id);
  wbSave(); wbPushState();
}

// ── LIBRARY ───────────────────────────────────────────────
function wbRenderLibrary() {
  const el=document.getElementById('wb-library'); if(!el) return;
  if(!WB.library.length){el.innerHTML='<div style="color:#555;font-size:10px;">No exports yet</div>';return;}
  el.innerHTML=WB.library.map((entry,i)=>`
    <div class="wb-list-item">
      <span>${(entry.type||'SET').toUpperCase()} #${i}</span>
      <button class="wb-btn" style="width:auto;padding:2px 8px;" onclick="wbLoadLibraryEntry(${i})">Load</button>
    </div>`).join('');
}

function wbLoadLibraryEntry(i) {
  const entry=WB.library[i];
  const m=wbNewMirror(entry.type||'parabolic');
  Object.assign(m.params,entry.definition||{});
  if(entry.transform){m.tx=entry.transform.tx||0;m.ty=entry.transform.ty||0;m.rotation=entry.transform.rotation||0;}
  WB.mirrors.push(m);
  wbSelectMirror(m.id);
  wbSave(); wbPushState();
}

// ── GLOBAL EXPORTS ────────────────────────────────────────
window.wbAddMirror          = wbAddMirror;
window.wbDeleteActive       = wbDeleteActive;
window.wbSelectMirror       = wbSelectMirror;
window.wbSetType            = wbSetType;
window.wbOnChange           = wbOnChange;
window.wbRenderList         = wbRenderList;
window.wbRenderParams       = wbRenderParams;
window.wbRenderLibrary      = wbRenderLibrary;
window.wbLoadLibraryEntry   = wbLoadLibraryEntry;
window.wbInitMouse          = wbInitMouse;
window.wbStartHingeMode     = wbStartHingeMode;
window.wbCancelHingeMode    = wbCancelHingeMode;
window.wbTraceTangentMirror = wbTraceTangentMirror;