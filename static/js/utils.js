// utils.js — sim math, solar, coordinates, chain reconciliation

// ── SOLAR ─────────────────────────────────────────────────
function formatTime(decimal) {
  const hrs  = Math.floor(decimal);
  const mins = Math.floor((decimal - hrs) * 60).toString().padStart(2, '0');
  return `${hrs}:${mins}`;
}

function calcSolar(lat, day, time, sysAz) {
  const latRad = lat * Math.PI / 180;
  const decl   = 23.45 * Math.sin((360/365)*(day-81)*Math.PI/180) * Math.PI/180;
  const ha     = 15*(time-12)*Math.PI/180;
  const sinAlt = Math.sin(latRad)*Math.sin(decl) + Math.cos(latRad)*Math.cos(decl)*Math.cos(ha);
  const alt    = Math.asin(Math.max(-1,Math.min(1,sinAlt)));
  const altDeg = alt*180/Math.PI;
  const cosAz  = (Math.sin(decl)-Math.sin(latRad)*Math.sin(alt))/(Math.cos(latRad)*Math.cos(alt)+1e-9);
  let azDeg    = Math.acos(Math.max(-1,Math.min(1,cosAz)))*180/Math.PI;
  if (ha>0) azDeg=360-azDeg;
  const relAz  = (azDeg-sysAz)*Math.PI/180;
  const isNight = altDeg<=0;
  let profDeg=0, cosLoss=0, dniFactor=0;
  if (!isNight) {
    let profRad=Math.atan2(Math.tan(alt),Math.cos(relAz));
    if(profRad<0) profRad+=Math.PI;
    profDeg=profRad*180/Math.PI;
    cosLoss=Math.abs(Math.cos(relAz));
    const am=1/(Math.sin(alt)+0.50572*Math.pow(altDeg+6.07995,-1.6364));
    dniFactor=Math.pow(0.7,Math.pow(am,0.678));
  }
  return {altDeg,azDeg,profDeg,cosLoss,dniFactor,isNight};
}

function getSolarInputs() {
  return {
    lat:   parseFloat(document.getElementById('lat').value),
    day:   parseFloat(document.getElementById('day').value),
    time:  parseFloat(document.getElementById('time').value),
    sysAz: parseFloat(document.getElementById('sysaz').value),
    dni:   parseFloat(document.getElementById('dni').value),
    dhi:   parseFloat(document.getElementById('dhi').value),
  };
}

// ── VIEWPORT-AWARE COORDINATE TRANSFORMS ──────────────────
function simScale() { return State.scale * State.viewport.zoom; }

function toScreen(wx, wy) {
  const s = simScale();
  return {
    x: State.cssW/2 + State.viewport.panX + wx*s,
    y: State.cssH/2 + State.viewport.panY - wy*s,
  };
}

function toWorld(sx, sy) {
  const s = simScale();
  return {
    x:  (sx - State.cssW/2 - State.viewport.panX) / s,
    y: -(sy - State.cssH/2 - State.viewport.panY) / s,
  };
}

function hyp(a, b) { return Math.sqrt(a*a + b*b); }

// ── GEOMETRY HELPERS ──────────────────────────────────────
function parabolaPoints(f, D, n, trimStart, trimEnd) {
  trimStart = trimStart ?? 0;
  trimEnd   = trimEnd   ?? 1;
  const xS  = -D/2 + trimStart*D;
  const xE  = -D/2 + trimEnd*D;
  const pts = [];
  for (let i=0; i<=n; i++) {
    const x = xS + (i/n)*(xE-xS);
    pts.push([x, x*x/(4*f)]);
  }
  return pts;
}

// Rotate local points around a local origin, then place in world
// origin_lx/ly = the local pivot point (default 0,0 = vertex)
function applyTransform(pts, worldX, worldY, rotRad, origin_lx, origin_ly) {
  origin_lx = origin_lx ?? 0;
  origin_ly = origin_ly ?? 0;
  return pts.map(([lx, ly]) => {
    const dx = lx - origin_lx;
    const dy = ly - origin_ly;
    const rx = dx*Math.cos(rotRad) - dy*Math.sin(rotRad);
    const ry = dx*Math.sin(rotRad) + dy*Math.cos(rotRad);
    return [rx + worldX, ry + worldY];
  });
}

function offsetPath(pts, d) {
  return pts.map((p, i) => {
    const prev = pts[Math.max(0,i-1)];
    const next = pts[Math.min(pts.length-1,i+1)];
    const tx=next[0]-prev[0], ty=next[1]-prev[1];
    const len=Math.sqrt(tx*tx+ty*ty)||1;
    return [p[0]+(-ty/len)*d, p[1]+(tx/len)*d];
  });
}

// Get local-space origin/pivot for a sim component
// Uses origin_offset_x/y if stored (set by loadFromWorkbench),
// otherwise falls back to type defaults.
function getOriginLocal(comp) {
  const p = comp.params;
  // Explicit stored offset takes priority (set when imported from workbench)
  if (p.origin_offset_x !== undefined && p.origin_offset_y !== undefined) {
    return [p.origin_offset_x, p.origin_offset_y];
  }
  // Fallback defaults
  if (comp.type === 'parabolic') {
    const f  = p.focal_length || 0.5;
    const D  = p.aperture     || 0.8;
    const ts = p.trim_start   || 0;
    const te = p.trim_end     || 1;
    const ot = p.origin_type  || 'vertex';
    if (ot === 'vertex')    return [0, 0];
    if (ot === 'left_tip')  { const x=-D/2+ts*D; return [x, x*x/(4*f)]; }
    if (ot === 'right_tip') { const x=-D/2+te*D; return [x, x*x/(4*f)]; }
    if (ot === 'focal')     return [0, f];
  }
  if (comp.type === 'flat') {
    const w  = p.width      || 0.6;
    const ts = p.trim_start || 0;
    const te = p.trim_end   || 1;
    const ot = p.origin_type || 'center';
    if (ot === 'left_tip')  return [-w/2+ts*w, 0];
    if (ot === 'right_tip') return [-w/2+te*w, 0];
    return [0, 0];
  }
  return [0, 0];
}

// ── SIM CHAIN RECONCILIATION ──────────────────────────────
// Called before every draw when assembly components are present.
// Walks hinges in parent-first order and snaps child positions.

// Get named point in local space for a sim component
function _simNamedPointLocal(comp, pointName) {
  const p  = comp.params;
  const f  = p.focal_length || 0.5;
  const D  = p.aperture     || 0.8;
  const w  = p.width        || 0.6;
  const ts = p.trim_start   || 0;
  const te = p.trim_end     || 1;

  if (comp.type === 'parabolic') {
    if (pointName === 'vertex')    return [0, 0];
    if (pointName === 'focal')     return [0, f];
    if (pointName === 'left_tip')  { const x=-D/2+ts*D; return [x, x*x/(4*f)]; }
    if (pointName === 'right_tip') { const x=-D/2+te*D; return [x, x*x/(4*f)]; }
  }
  if (comp.type === 'flat') {
    if (pointName === 'center')    return [0, 0];
    if (pointName === 'left_tip')  return [-w/2+ts*w, 0];
    if (pointName === 'right_tip') return [-w/2+te*w, 0];
  }
  if (comp.type === 'cpc') {
    const r  = (p.aperture||0.6)/2;
    const th = (p.acceptance_angle||30)*Math.PI/180;
    const tr = p.truncation_factor||1;
    const tv = (Math.PI/2+th)*tr;
    const xR = r*(1+Math.sin(tv))*Math.cos(tv)/(1+Math.sin(th));
    const y  = r*(1+Math.sin(tv))*Math.sin(tv)/(1+Math.sin(th))-r;
    if (pointName === 'left_tip')        return [-xR, y];
    if (pointName === 'right_tip')       return [ xR, y];
    if (pointName === 'receiver_center') return [0, -r];
  }
  return [0, 0];
}

// Named point in world space for a sim component
function _simNamedPointWorld(comp, pointName) {
  const [lx, ly] = _simNamedPointLocal(comp, pointName);
  const [olx, oly] = getOriginLocal(comp);
  const rot = comp.rotation * Math.PI / 180;
  const dx = lx - olx, dy = ly - oly;
  const rx = dx*Math.cos(rot) - dy*Math.sin(rot);
  const ry = dx*Math.sin(rot) + dy*Math.cos(rot);
  return [rx + comp.position.x, ry + comp.position.y];
}

// Compute hinge world position from the parent component's current geometry
function computeSimHingeWorld(hinge, components) {
  const mA = components.find(c => c.id === hinge.compAId);
  if (!mA) return [0, 0];
  return _simNamedPointWorld(mA, hinge.pointA);
}

// Snap child component so its joining point lands on the hinge world position
function _snapChildToHinge(child, hinge, hingeWorld) {
  const [bjlx, bjly] = _simNamedPointLocal(child, hinge.pointB);
  const [olx,  oly]  = getOriginLocal(child);
  const rot = child.rotation * Math.PI / 180;
  // Offset from child's local origin to its joining point, in world space
  const dx  = bjlx - olx, dy = bjly - oly;
  const offWx = dx*Math.cos(rot) - dy*Math.sin(rot);
  const offWy = dx*Math.sin(rot) + dy*Math.cos(rot);
  child.position.x = hingeWorld[0] - offWx;
  child.position.y = hingeWorld[1] - offWy;
}

// Walk hinges in parent-first order and reconcile child positions
function reconcileSimChain() {
  const hinges = State.simHinges;
  if (!hinges || !hinges.length) return;
  const components = State.components;

  // Build parent map: compId → hingeId where comp is child (mirrorB)
  const parentHinge = {};
  for (const h of hinges) parentHinge[h.compBId] = h;

  // Find roots (no parent hinge)
  const visited = new Set();
  const queue   = components.filter(c => !parentHinge[c.id]).map(c => c.id);

  while (queue.length) {
    const cid = queue.shift();
    if (visited.has(cid)) continue;
    visited.add(cid);

    // Find all hinges where this comp is the parent
    const childHinges = hinges.filter(h => h.compAId === cid);
    for (const h of childHinges) {
      const child = components.find(c => c.id === h.compBId);
      if (!child) continue;
      const hw = computeSimHingeWorld(h, components);
      _snapChildToHinge(child, h, hw);
      queue.push(child.id);
    }
  }
}

window.simScale              = simScale;
window.toScreen              = toScreen;
window.toWorld               = toWorld;
window.hyp                   = hyp;
window.parabolaPoints        = parabolaPoints;
window.applyTransform        = applyTransform;
window.offsetPath            = offsetPath;
window.getOriginLocal        = getOriginLocal;
window.reconcileSimChain     = reconcileSimChain;
window.computeSimHingeWorld  = computeSimHingeWorld;
window.formatTime            = formatTime;
window.calcSolar             = calcSolar;
window.getSolarInputs        = getSolarInputs;