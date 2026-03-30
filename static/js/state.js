// state.js — single source of truth for sim

const State = {
  dpr:  window.devicePixelRatio || 1,
  cssW: 0, cssH: 0, scale: 100, ox: 0, oy: 0,

  viewport: { zoom: 1.0, panX: 0, panY: 0 },

  sourceX:        0,
  sourceY:        2.5,
  sourceWidth:    3.0,
  sourceRotation: 0,    // degrees — visual rotation of the source line only

  components:  [],
  selectedId:  null,
  idCtr:       0,

  simHinges:      [],
  rayPaths:       [],
  rayEnergies:    [],
  lastStats:      null,

  // ── HISTORY STACKS ──
  undoStack: [],
  redoStack: [],

  dragging:       null,
  dragOff:        { x: 0, y: 0 },
  dragChildSnap:  {},
  draggingSrc:    false,
  panning:        false,
  panLast:        { x: 0, y: 0 },

  DEF: {
    parabolic: {
      focal_length: 0.5, aperture: 0.8, reflectivity: 0.92, slope_error: 0.2,
      trim_start: 0.0, trim_end: 1.0, origin_type: 'vertex', origin_offset_x: 0, origin_offset_y: 0,
      assembly_id: null, parent_hinge_id: null,
    },
    flat: {
      width: 0.6, reflectivity: 0.92, trim_start: 0.0, trim_end: 1.0,
      origin_type: 'center', origin_offset_x: 0, origin_offset_y: 0,
      assembly_id: null, parent_hinge_id: null,
    },
    cpc: {
      acceptance_angle: 30, aperture: 0.6, reflectivity: 0.90, trim_start: 0.0, trim_end: 1.0,
      origin_type: 'receiver_center', origin_offset_x: 0, origin_offset_y: 0,
      assembly_id: null, parent_hinge_id: null,
    },
    glass: { width: 0.6, ior: 1.50, transmission: 0.92, has_drf: 1 },

    filter: { width: 3.0, origin_type: 'center', origin_offset_x: 0, origin_offset_y: 0 }
  },

  PR: {
    focal_length: [-.2, 2, .05], aperture: [.1, 2, .05], reflectivity: [.5, 1, .01],
    slope_error: [0, 1, .05], width: [.1, 15, .1], acceptance_angle: [5, 60, 1],
    transmission: [.5, 1, .01], ior: [1.4, 1.7, .01], has_drf: [0, 1, 1],
    trim_start: [0, 0.95, .01], trim_end: [0.05, 1, .01],
  }
};

function simSave() {
  try {
    localStorage.setItem('dls_sim', JSON.stringify({
      components:     State.components, simHinges: State.simHinges,
      sourceX:        State.sourceX, sourceY: State.sourceY,
      sourceWidth:    State.sourceWidth, sourceRotation: State.sourceRotation,
      viewport:       State.viewport, idCtr: State.idCtr,
    }));
  } catch(e) { console.warn('simSave failed', e); }
}

function simRestore() {
  try {
    const raw = localStorage.getItem('dls_sim');
    if (!raw) return false;
    const d = JSON.parse(raw);
    State.components     = d.components     || [];
    State.simHinges      = d.simHinges      || [];
    State.sourceX        = d.sourceX        ?? 0;
    State.sourceY        = d.sourceY        ?? 2.5;
    State.sourceWidth    = d.sourceWidth    ?? 3.0;
    State.sourceRotation = d.sourceRotation ?? 0;
    State.viewport       = d.viewport       || { zoom:1, panX:0, panY:0 };
    State.idCtr          = d.idCtr          || 0;
    return State.components.length > 0;
  } catch(e) { return false; }
}

// ── UNDO / REDO (Debounced to prevent slider spam) ────────
let _simUndoTimeout = null;
function pushState() {
  clearTimeout(_simUndoTimeout);
  _simUndoTimeout = setTimeout(() => {
    const snapshot = JSON.stringify({
      components: State.components, simHinges: State.simHinges,
      sourceX: State.sourceX, sourceY: State.sourceY, sourceWidth: State.sourceWidth, sourceRotation: State.sourceRotation,
      idCtr: State.idCtr
    });
    if (State.undoStack.length === 0 || State.undoStack[State.undoStack.length - 1] !== snapshot) {
      State.undoStack.push(snapshot);
      if (State.undoStack.length > 50) State.undoStack.shift();
      State.redoStack = []; 
    }
  }, 200); // Waits 200ms after last change before saving
}

function _loadSnapshot(snapJson) {
  const d = JSON.parse(snapJson);
  State.components = d.components; State.simHinges = d.simHinges;
  State.sourceX = d.sourceX; State.sourceY = d.sourceY; State.sourceWidth = d.sourceWidth; State.sourceRotation = d.sourceRotation;
  State.idCtr = d.idCtr;

  // Sync UI Sliders
  if(document.getElementById('srx')) document.getElementById('srx').value = State.sourceX;
  if(document.getElementById('sry')) document.getElementById('sry').value = State.sourceY;
  if(document.getElementById('srw')) document.getElementById('srw').value = State.sourceWidth;
  if(document.getElementById('src-rot')) document.getElementById('src-rot').value = State.sourceRotation;
  if(document.getElementById('sxv')) document.getElementById('sxv').textContent = State.sourceX.toFixed(1);
  if(document.getElementById('syv')) document.getElementById('syv').textContent = State.sourceY.toFixed(1);
  if(document.getElementById('swv')) document.getElementById('swv').textContent = State.sourceWidth.toFixed(1);
  if(document.getElementById('src-rot-val')) document.getElementById('src-rot-val').textContent = State.sourceRotation + '°';

  State.selectedId = null;
  if (document.getElementById('sp')) document.getElementById('sp').classList.remove('vis');
  
  if (typeof reconcileSimChain==='function') reconcileSimChain();
  if (typeof renderList==='function') renderList();
  if (typeof draw==='function') draw();
  simSave();
}

function undo() {
  if (State.undoStack.length <= 1) return; 
  State.redoStack.push(State.undoStack.pop());
  _loadSnapshot(State.undoStack[State.undoStack.length - 1]);
}

function redo() {
  if (State.redoStack.length === 0) return;
  const next = State.redoStack.pop();
  State.undoStack.push(next);
  _loadSnapshot(next);
}

window.State      = State;
window.simSave    = simSave;
window.simRestore = simRestore;
window.pushState  = pushState;
window.undo       = undo;
window.redo       = redo;