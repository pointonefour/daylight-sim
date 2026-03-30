// controls.js — sidebar component management, zoom/pan, assembly-aware drag

function addComp(type) {
  const c = {
    id:       State.idCtr++,
    type,
    position: { x: (Math.random()-.5)*2, y: (Math.random()-.5)*1.5 },
    rotation: type==='flat' ? 45 : 0,
    params:   { ...State.DEF[type] }
  };
  State.components.push(c);
  selComp(c.id);
  renderList();
  draw();
  simSave();
  pushState();
}

function delComp() {
  const id = State.selectedId;
  State.components  = State.components.filter(c => c.id !== id);
  // Remove any hinges involving this component
  if (State.simHinges) {
    State.simHinges = State.simHinges.filter(h => h.compAId !== id && h.compBId !== id);
  }
  State.selectedId  = null;
  State.rayPaths    = [];
  State.rayEnergies = [];
  document.getElementById('sp').classList.remove('vis');
  renderList();
  draw();
  simSave();
  pushState();
}

function selComp(id) {
  State.selectedId = id;
  renderList();
  renderSP();
  draw();
}

function renderList() {
  document.getElementById('cl').innerHTML = State.components.map(c => `
    <div class="ci ${c.id===State.selectedId?'sel':''}" onclick="selComp(${c.id})">
      <div class="cn">${c.type} #${c.id}${c.params.assembly_id!=null?' [A'+c.params.assembly_id+']':''}</div>
      <div class="cs">X:${c.position.x.toFixed(2)} Y:${c.position.y.toFixed(2)} R:${c.rotation.toFixed(0)}°</div>
    </div>`).join('');
}

function renderSP() {
  const c = State.components.find(c => c.id === State.selectedId);
  if (!c) return;
  document.getElementById('sp').classList.add('vis');
  let h = `
    <label>X <span id="lx">${c.position.x.toFixed(2)}</span></label>
    <input type="range" min="-5" max="5" step=".05" value="${c.position.x}" oninput="upd(${c.id},'px',this.value)">
    <label>Y <span id="ly">${c.position.y.toFixed(2)}</span></label>
    <input type="range" min="-5" max="5" step=".05" value="${c.position.y}" oninput="upd(${c.id},'py',this.value)">
    <label>Rotation <span id="lr">${c.rotation.toFixed(0)}°</span></label>
    <input type="range" min="-180" max="180" step="1" value="${c.rotation}" oninput="upd(${c.id},'rot',this.value)">`;
  for (const [k, v] of Object.entries(c.params)) {
    const r = State.PR[k]; if (!r) continue;
    h += `<label>${k.replace(/_/g,' ').toUpperCase()} <span id="p_${k}">${parseFloat(v).toFixed(2)}</span></label>
    <input type="range" min="${r[0]}" max="${r[1]}" step="${r[2]}" value="${v}" oninput="upd(${c.id},'p_${k}',this.value)">`;
  }
  document.getElementById('sparams').innerHTML = h;
}

function upd(id, key, val) {
  const c = State.components.find(c => c.id === id); if (!c) return;
  val = parseFloat(val);
  if      (key==='px')  { c.position.x=val; const el=document.getElementById('lx'); if(el) el.textContent=val.toFixed(2); }
  else if (key==='py')  { c.position.y=val; const el=document.getElementById('ly'); if(el) el.textContent=val.toFixed(2); }
  else if (key==='rot') { c.rotation=val;   const el=document.getElementById('lr'); if(el) el.textContent=val.toFixed(0)+'°'; }
  else if (key.startsWith('p_')) {
    const pk=key.slice(2); c.params[pk]=val;
    const el=document.getElementById('p_'+pk); if(el) el.textContent=val.toFixed(2);
    if(pk==='trim_start') c.params.trim_start=Math.min(val,c.params.trim_end-0.05);
    if(pk==='trim_end')   c.params.trim_end  =Math.max(val,c.params.trim_start+0.05);
  }
  reconcileSimChain();
  renderList(); draw(); simSave(); pushState();
}

// ── MOUSE ─────────────────────────────────────────────────
function initMouseEvents() {
  const canvas = document.getElementById('canvas');

  // Wheel zoom
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r  = canvas.getBoundingClientRect();
    const mx = e.clientX-r.left, my = e.clientY-r.top;
    const s0 = simScale();
    const wx = (mx-State.cssW/2-State.viewport.panX)/s0;
    const wy = -(my-State.cssH/2-State.viewport.panY)/s0;
    const factor = e.deltaY<0 ? 1.1 : 0.91;
    State.viewport.zoom = Math.max(0.1, Math.min(20, State.viewport.zoom*factor));
    const s1 = simScale();
    State.viewport.panX = mx-State.cssW/2-wx*s1;
    State.viewport.panY = my-State.cssH/2+wy*s1;
    draw();
  }, { passive: false });

  canvas.addEventListener('mousedown', e => {
    const r  = canvas.getBoundingClientRect();
    const mx = e.clientX-r.left, my = e.clientY-r.top;
    const w  = toWorld(mx, my);

    if (e.button===1) { State.panning=true; State.panLast={x:mx,y:my}; return; }

    const ss = toScreen(State.sourceX, State.sourceY);
    if (hyp(mx-ss.x, my-ss.y)<16) { State.draggingSrc=true; return; }

    // Check components — only allow dragging ROOT components (no parent hinge)
    for (const c of [...State.components].reverse()) {
      const s = toScreen(c.position.x, c.position.y);
      if (hyp(mx-s.x, my-s.y) < 14) {
        // Check if this component is a child in any hinge
        const isChild = State.simHinges && State.simHinges.some(h => h.compBId === c.id);
        if (isChild) {
          // Child components: select but don't drag freely
          // They can still rotate around their hinge via the sidebar slider
          selComp(c.id); return;
        }
        // Root component — drag freely, children follow via reconcileSimChain
        State.dragging = c.id;
        State.dragOff  = { x: w.x-c.position.x, y: w.y-c.position.y };
        // Snapshot all children positions at drag start
        State.dragChildSnap = {};
        if (State.simHinges) {
          _snapshotSimChildren(c.id, State.dragChildSnap);
        }
        selComp(c.id);
        return;
      }
    }

    State.selectedId = null;
    document.getElementById('sp').classList.remove('vis');
    renderList(); draw();
  });

  canvas.addEventListener('mousemove', e => {
    const r  = canvas.getBoundingClientRect();
    const mx = e.clientX-r.left, my = e.clientY-r.top;
    const w  = toWorld(mx, my);

    if (State.panning) {
      State.viewport.panX += mx-State.panLast.x;
      State.viewport.panY += my-State.panLast.y;
      State.panLast = {x:mx,y:my};
      draw(); return;
    }

    if (State.draggingSrc) {
      State.sourceX=w.x; State.sourceY=w.y;
      document.getElementById('sry').value=State.sourceY.toFixed(1);
      document.getElementById('srx').value=State.sourceX.toFixed(1);
      document.getElementById('syv').textContent=State.sourceY.toFixed(1);
      document.getElementById('sxv').textContent=State.sourceX.toFixed(1);
      draw(); return;
    }

    if (State.dragging!==null) {
      const c = State.components.find(c=>c.id===State.dragging);
      if (c) {
        const newX = w.x - State.dragOff.x;
        const newY = w.y - State.dragOff.y;
        const dWorldX = newX - c.position.x;
        const dWorldY = newY - c.position.y;
        c.position.x = newX;
        c.position.y = newY;
        // Move all children using snapshotted positions
        if (State.simHinges && State.dragChildSnap) {
          _applySimChildMove(c.id, dWorldX, dWorldY, State.dragChildSnap);
        }
        // Reconcile chain to enforce hinge constraints
        reconcileSimChain();
        renderList(); renderSP(); draw();
      }
      return;
    }

    const ss = toScreen(State.sourceX, State.sourceY);
    canvas.style.cursor = hyp(mx-ss.x, my-ss.y)<16 ? 'move' : 'default';
  });

  canvas.addEventListener('mouseup', () => {
    if (State.dragging!==null) simSave(); pushState();
    State.dragging    = null;
    State.draggingSrc = false;
    State.panning     = false;
    State.dragChildSnap = {};
  });

  canvas.addEventListener('mouseleave', () => {
    State.dragging    = null;
    State.draggingSrc = false;
    State.panning     = false;
  });
}

// Snapshot all descendant positions recursively
function _snapshotSimChildren(compId, snap, visited) {
  visited = visited || new Set();
  if (visited.has(compId)) return;
  visited.add(compId);
  if (!State.simHinges) return;
  for (const h of State.simHinges) {
    if (h.compAId !== compId) continue;
    const child = State.components.find(c=>c.id===h.compBId); if(!child) continue;
    snap['x_'+child.id] = child.position.x;
    snap['y_'+child.id] = child.position.y;
    _snapshotSimChildren(child.id, snap, visited);
  }
}

// Apply world delta to all descendants using snapshotted positions
function _applySimChildMove(compId, dWorldX, dWorldY, snap, visited) {
  visited = visited || new Set();
  if (visited.has(compId)) return;
  visited.add(compId);
  if (!State.simHinges) return;
  for (const h of State.simHinges) {
    if (h.compAId !== compId) continue;
    const child = State.components.find(c=>c.id===h.compBId); if(!child) continue;
    const snapX = snap['x_'+child.id];
    const snapY = snap['y_'+child.id];
    if (snapX !== undefined) { child.position.x = snapX+dWorldX; child.position.y = snapY+dWorldY; }
    _applySimChildMove(child.id, dWorldX, dWorldY, snap, visited);
  }
}

function getXY(e) {
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { mx: e.clientX-r.left, my: e.clientY-r.top };
}

window.addComp         = addComp;
window.delComp         = delComp;
window.selComp         = selComp;
window.upd             = upd;
window.renderList      = renderList;
window.renderSP        = renderSP;
window.initMouseEvents = initMouseEvents;