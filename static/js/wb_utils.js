// wb_utils.js — workbench geometry, transforms, chain logic

// ── VIEWPORT ──────────────────────────────────────────────
function wbScale() { return WB.BASE_SCALE * WB.viewport.zoom; }

function wbToScreen(wx, wy) {
  const s = wbScale();
  return { x: WB.cssW/2 + WB.viewport.panX + wx*s, y: WB.cssH/2 + WB.viewport.panY - wy*s };
}

function wbToWorld(sx, sy) {
  const s = wbScale();
  return { x: (sx - WB.cssW/2 - WB.viewport.panX)/s, y: -(sy - WB.cssH/2 - WB.viewport.panY)/s };
}

function wbHyp(a, b) { return Math.sqrt(a*a + b*b); }

// ── NAMED POINT IN LOCAL SPACE ────────────────────────────
// Returns [lx, ly] in the mirror's own local coordinate system
function wbNamedPointLocal(mirror, pointName) {
  const p  = mirror.params;
  const f  = p.focal_length || 0.5;
  const D  = p.aperture     || 0.8;
  const w  = p.width        || 0.6;
  const ts = p.trim_start   || 0;
  const te = p.trim_end     || 1;
  const th = ((p.acceptance_angle || 30) * Math.PI / 180);
  const r  = (p.aperture || 0.6) / 2;

  if (mirror.type === 'parabolic') {
    if (pointName === 'vertex')    return [0, 0];
    if (pointName === 'focal')     return [0, f];
    if (pointName === 'left_tip')  { const x = -D/2 + ts*D; return [x, x*x/(4*f)]; }
    if (pointName === 'right_tip') { const x = -D/2 + te*D; return [x, x*x/(4*f)]; }
  }
  if (mirror.type === 'flat') {
    if (pointName === 'center')    return [(-w/2+ts*w + -w/2+te*w)/2, 0];
    if (pointName === 'left_tip')  return [-w/2 + ts*w, 0];
    if (pointName === 'right_tip') return [-w/2 + te*w, 0];
  }
  if (mirror.type === 'cpc') {
    const trunc = p.truncation_factor || 1;
    const tv = (Math.PI/2 + th) * trunc;
    const xR = r*(1+Math.sin(tv))*Math.cos(tv)/(1+Math.sin(th));
    const y  = r*(1+Math.sin(tv))*Math.sin(tv)/(1+Math.sin(th)) - r;
    if (pointName === 'left_tip')        return [-xR, y];
    if (pointName === 'right_tip')       return [ xR, y];
    if (pointName === 'receiver_center') return [0, -r];
  }
  return [0, 0];
}

// ── ORIGIN IN LOCAL SPACE ─────────────────────────────────
// The origin is the local point that lands at (tx, ty) in world space
function wbOriginLocal(mirror) {
  return wbNamedPointLocal(mirror, mirror.params.origin || 'vertex');
}

// ── LOCAL → WORLD ─────────────────────────────────────────
// Rotates around local origin, places origin at (tx, ty)
function wbLocalToWorld(mirror, lx, ly) {
  const [olx, oly] = wbOriginLocal(mirror);
  const rot = mirror.rotation * Math.PI / 180;
  const sx  = mirror.scaleX || 1;
  const sy  = mirror.scaleY || 1;
  const dx  = (lx - olx) * sx;
  const dy  = (ly - oly) * sy;
  const rx  = dx*Math.cos(rot) - dy*Math.sin(rot);
  const ry  = dx*Math.sin(rot) + dy*Math.cos(rot);
  return [rx + mirror.tx, ry + mirror.ty];
}

// ── WORLD → LOCAL (inverse) ───────────────────────────────
function wbWorldToLocal(mirror, wx, wy) {
  const [olx, oly] = wbOriginLocal(mirror);
  const rot = mirror.rotation * Math.PI / 180;
  const sx  = mirror.scaleX || 1;
  const sy  = mirror.scaleY || 1;
  const dx  = wx - mirror.tx;
  const dy  = wy - mirror.ty;
  const lxr = dx*Math.cos(-rot) - dy*Math.sin(-rot);
  const lyr = dx*Math.sin(-rot) + dy*Math.cos(-rot);
  return [lxr/sx + olx, lyr/sy + oly];
}

// Named point in WORLD space (always recomputed from current geometry)
function wbNamedPointWorld(mirror, pointName) {
  const [lx, ly] = wbNamedPointLocal(mirror, pointName);
  return wbLocalToWorld(mirror, lx, ly);
}

// ── HINGE WORLD POSITION (dynamic) ───────────────────────
// Always recomputed from mirrorA's current geometry — never stored
function wbComputeHingeWorld(hinge) {
  const mA = wbGetMirror(hinge.mirrorA.mirrorId);
  if (!mA) return [0, 0];
  return wbNamedPointWorld(mA, hinge.mirrorA.pointName);
}

// ── CHAIN RECONCILIATION ──────────────────────────────────
// Call before every draw and after any geometry change.
// Walks the hinge chain in parent-first order and snaps
// each child mirror's origin to the current hinge world position.
function wbReconcileChain() {
  const visited = new Set();
  const queue   = [];

  // Find root mirrors (no parentHingeId)
  for (const m of WB.mirrors) {
    if (m.parentHingeId === null) queue.push(m.id);
  }

  while (queue.length) {
    const mid = queue.shift();
    if (visited.has(mid)) continue;
    visited.add(mid);

    const mirror = wbGetMirror(mid); if (!mirror) continue;

    // Reconcile this mirror's position against its parent hinge
    if (mirror.parentHingeId !== null) {
      const hinge = wbGetHinge(mirror.parentHingeId);
      if (hinge) {
        // Hinge world = mirrorA's current named point (dynamic)
        const [hwx, hwy] = wbComputeHingeWorld(hinge);
        // Mirror B's named point must land on hinge world.
        // Since tx/ty is where mirrorB's local origin lands,
        // and mirrorB's joining point is hinge.mirrorB.pointName,
        // we need to compute the offset from origin to joining point
        // and adjust tx/ty accordingly.
        const [bjlx, bjly] = wbNamedPointLocal(mirror, hinge.mirrorB.pointName);
        const [olx,  oly]  = wbOriginLocal(mirror);
        const rot = mirror.rotation * Math.PI / 180;
        const sx  = mirror.scaleX || 1;
        const sy  = mirror.scaleY || 1;
        // Offset from origin to joining point in world space
        const dx  = (bjlx - olx) * sx;
        const dy  = (bjly - oly) * sy;
        const offWx = dx*Math.cos(rot) - dy*Math.sin(rot);
        const offWy = dx*Math.sin(rot) + dy*Math.cos(rot);
        // Set tx/ty so the joining point lands on hinge world
        mirror.tx = hwx - offWx;
        mirror.ty = hwy - offWy;
      }
    }

    // Queue children
    for (const childHingeId of (mirror.childHingeIds || [])) {
      const childHinge = wbGetHinge(childHingeId);
      if (childHinge) queue.push(childHinge.mirrorB.mirrorId);
    }
  }
}

// ── CHAIN ORDER (parent first) ────────────────────────────
function wbGetChainOrder() {
  const order   = [];
  const visited = new Set();
  const queue   = WB.mirrors.filter(m => m.parentHingeId === null).map(m => m.id);
  while (queue.length) {
    const mid = queue.shift();
    if (visited.has(mid)) continue;
    visited.add(mid);
    order.push(mid);
    const m = wbGetMirror(mid); if (!m) continue;
    for (const hid of (m.childHingeIds || [])) {
      const h = wbGetHinge(hid); if (h) queue.push(h.mirrorB.mirrorId);
    }
  }
  return order;
}

// ── TANGENT ANGLE ─────────────────────────────────────────
// Rotation of mirrorB so it is tangent to mirrorA at a named point
function wbTangentRotation(mirrorA, pointName) {
  if (mirrorA.type === 'parabolic') {
    const p = mirrorA.params;
    const f = p.focal_length || 0.5;
    const D = p.aperture || 0.8;
    let x = 0;
    if (pointName === 'left_tip')  x = -D/2 + (p.trim_start||0)*D;
    if (pointName === 'right_tip') x = -D/2 + (p.trim_end||1)*D;
    const localAngle = Math.atan(x/(2*f)) * 180/Math.PI;
    return mirrorA.rotation + localAngle;
  }
  // For flat mirror, tangent is just the same rotation
  return mirrorA.rotation;
}

// ── CURVE GENERATORS ──────────────────────────────────────
function wbParabolaFull(f, D, n) {
  const pts = [];
  for (let i=0;i<=n;i++) { const x=-D/2+(i/n)*D; pts.push([x,x*x/(4*f)]); }
  return pts;
}

function wbParabolaTrimmed(f, D, ts, te, n) {
  const xS=-D/2+ts*D, xE=-D/2+te*D, pts=[];
  for (let i=0;i<=n;i++) { const x=xS+(i/n)*(xE-xS); pts.push([x,x*x/(4*f)]); }
  return pts;
}

function wbCPCArms(aperture, acceptanceAngle, ts, te, n) {
  const r=aperture/2, th=acceptanceAngle*Math.PI/180;
  const tMax=(Math.PI/2+th)*te, tMin=(Math.PI/2+th)*ts;
  const right=[], left=[];
  for (let i=0;i<=n;i++) {
    const tv=tMin+(i/n)*(tMax-tMin);
    const x=r*(1+Math.sin(tv))*Math.cos(tv)/(1+Math.sin(th));
    const y=r*(1+Math.sin(tv))*Math.sin(tv)/(1+Math.sin(th))-r;
    right.push([x,y]); left.push([-x,y]);
  }
  return { right, left };
}

function wbNormalAt(pts, i) {
  const prev=pts[Math.max(0,i-1)], next=pts[Math.min(pts.length-1,i+1)];
  const tx=next[0]-prev[0], ty=next[1]-prev[1], len=Math.sqrt(tx*tx+ty*ty)||1;
  return [-ty/len, tx/len];
}

function wbParabolaTangentAngle(x, f) { return Math.atan(x/(2*f))*180/Math.PI; }

// Draw local-space path transformed to world then screen
function wbDrawTransformed(ctx, mirror, localPts, close) {
  if (!localPts.length) return;
  ctx.beginPath();
  for (let i=0;i<localPts.length;i++) {
    const [wx,wy]=wbLocalToWorld(mirror,localPts[i][0],localPts[i][1]);
    const s=wbToScreen(wx,wy);
    i===0?ctx.moveTo(s.x,s.y):ctx.lineTo(s.x,s.y);
  }
  if (close) ctx.closePath();
}

// 3×3 transform matrix for export
function wbTransformMatrix(mirror) {
  const rot=mirror.rotation*Math.PI/180, sx=mirror.scaleX||1, sy=mirror.scaleY||1;
  const c=Math.cos(rot), s=Math.sin(rot);
  return [[sx*c,-sy*s,mirror.tx],[sx*s,sy*c,mirror.ty],[0,0,1]];
}

// Arc length from curve start to normVal (for trim label)
function wbTrimLengthMm(mirror, normVal) {
  const p=mirror.params, N=100;
  if (mirror.type==='parabolic') {
    const f=p.focal_length||0.5, D=p.aperture||0.8;
    const xS=-D/2, xT=-D/2+normVal*D, step=(xT-xS)/N;
    let len=0;
    for(let i=0;i<N;i++){const x0=xS+i*step,x1=xS+(i+1)*step;len+=Math.sqrt((x1-x0)**2+(x1*x1/(4*f)-x0*x0/(4*f))**2);}
    return len*1000;
  }
  if (mirror.type==='flat') return normVal*(p.width||0.6)*1000;
  if (mirror.type==='cpc') {
    const r=(p.aperture||0.6)/2, th=(p.acceptance_angle||30)*Math.PI/180;
    const tMax=(Math.PI/2+th)*normVal, step=tMax/N;
    let len=0;
    for(let i=0;i<N;i++){
      const t0=i*step,t1=(i+1)*step;
      const x0=r*(1+Math.sin(t0))*Math.cos(t0)/(1+Math.sin(th)), y0=r*(1+Math.sin(t0))*Math.sin(t0)/(1+Math.sin(th))-r;
      const x1=r*(1+Math.sin(t1))*Math.cos(t1)/(1+Math.sin(th)), y1=r*(1+Math.sin(t1))*Math.sin(t1)/(1+Math.sin(th))-r;
      len+=Math.sqrt((x1-x0)**2+(y1-y0)**2);
    }
    return len*1000;
  }
  return 0;
}

// ── PROPAGATE MOVE THROUGH CHAIN ──────────────────────────
// When a mirror moves (dx,dy in world), move all its descendants too
function wbPropagateMoveToChildren(mirror, dWorldX, dWorldY, visited) {
  visited = visited || new Set();
  if (visited.has(mirror.id)) return;
  visited.add(mirror.id);
  for (const hid of (mirror.childHingeIds||[])) {
    const h=wbGetHinge(hid); if(!h) continue;
    const child=wbGetMirror(h.mirrorB.mirrorId); if(!child) continue;
    child.tx += dWorldX;
    child.ty += dWorldY;
    wbPropagateMoveToChildren(child, dWorldX, dWorldY, visited);
  }
}

// When a mirror ROTATES around a pivot, move all descendants
// by rerunning reconcileChain (since hinge world changes)
function wbPropagateRotateToChildren() {
  wbReconcileChain();
}

// ── EXPORTS ───────────────────────────────────────────────
window.wbScale                = wbScale;
window.wbToScreen             = wbToScreen;
window.wbToWorld              = wbToWorld;
window.wbHyp                  = wbHyp;
window.wbNamedPointLocal      = wbNamedPointLocal;
window.wbNamedPointWorld      = wbNamedPointWorld;
window.wbOriginLocal          = wbOriginLocal;
window.wbLocalToWorld         = wbLocalToWorld;
window.wbWorldToLocal         = wbWorldToLocal;
window.wbComputeHingeWorld    = wbComputeHingeWorld;
window.wbReconcileChain       = wbReconcileChain;
window.wbGetChainOrder        = wbGetChainOrder;
window.wbTangentRotation      = wbTangentRotation;
window.wbParabolaFull         = wbParabolaFull;
window.wbParabolaTrimmed      = wbParabolaTrimmed;
window.wbCPCArms              = wbCPCArms;
window.wbNormalAt             = wbNormalAt;
window.wbParabolaTangentAngle = wbParabolaTangentAngle;
window.wbDrawTransformed      = wbDrawTransformed;
window.wbTransformMatrix      = wbTransformMatrix;
window.wbTrimLengthMm         = wbTrimLengthMm;
window.wbPropagateMoveToChildren   = wbPropagateMoveToChildren;
window.wbPropagateRotateToChildren = wbPropagateRotateToChildren;