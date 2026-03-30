// wb_state.js — workbench state

const WB = {
  dpr:  window.devicePixelRatio || 1,
  cssW: 0, cssH: 0,
  viewport:   { zoom: 1.0, panX: 0, panY: 0 },
  BASE_SCALE: 200,

  mirrors:  [], activeId: null, idCtr: 0,
  hinges:   [], hingeIdCtr: 0,
  
  // ── HISTORY STACKS ──
  undoStack: [], redoStack: [],

  drag:        { active: false, type: null, startMx: 0, startMy: 0, startVal: null },
  trimDrag:    null, contextMenu: null, hingeMode: null,
  pan:         { active: false, lastMx: 0, lastMy: 0 },
  datasheets:  {}, library: [],

  DEF: {
    parabolic: { focal_length: 0.5, aperture: 0.8, trim_start: 0.0, trim_end: 1.0, origin: 'vertex', material: 'aluminium', roughness_ra_um: 0.4, slope_error_mrad: 2.0, pv_error_um: 10.0, reflectivity: 0.92, substrate_thickness_mm: 2.0, manufacturing: 'stamped_aluminium', point_count: 75 },
    flat: { width: 0.6, trim_start: 0.0, trim_end: 1.0, origin: 'center', material: 'aluminium', roughness_ra_um: 0.4, slope_error_mrad: 1.0, pv_error_um: 5.0, reflectivity: 0.92, substrate_thickness_mm: 2.0, manufacturing: 'stamped_aluminium', point_count: 50 },
    cpc: { aperture: 0.6, acceptance_angle: 30.0, truncation_factor: 1.0, trim_start: 0.0, trim_end: 1.0, origin: 'receiver_center', material: 'aluminium', roughness_ra_um: 0.4, slope_error_mrad: 2.0, pv_error_um: 10.0, reflectivity: 0.90, substrate_thickness_mm: 2.0, manufacturing: 'stamped_aluminium', point_count: 75 },
  },

  MATERIALS:   ['aluminium','enhanced_aluminium','silver','gold','polished_steel'],
  MFG_METHODS: ['stamped_aluminium','cnc','sheet_metal','3d_print'],
  NAMED_POINTS: { parabolic: ['left_tip','right_tip','vertex','focal'], flat: ['left_tip','right_tip','center'], cpc: ['left_tip','right_tip','receiver_center'] },
  ORIGINS: { parabolic: ['vertex','left_tip','right_tip','focal'], flat: ['center','left_tip','right_tip'], cpc: ['receiver_center','aperture_center'] },
};

function wbNewMirror(type, overrides) {
  return { id: WB.idCtr++, type, tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1, parentHingeId: null, childHingeIds: [], params: { ...WB.DEF[type], ...(overrides || {}) } };
}

function wbActive()   { return WB.mirrors.find(m => m.id === WB.activeId) || null; }
function wbSelect(id) { WB.activeId = id; }
function wbDeselect() { WB.activeId = null; WB.contextMenu = null; }
function wbGetMirror(id)  { return WB.mirrors.find(m => m.id === id) || null; }
function wbGetHinge(id)   { return WB.hinges.find(h => h.id === id) || null; }

function wbSave() {
  try { localStorage.setItem('dls_wb', JSON.stringify({ mirrors: WB.mirrors, hinges: WB.hinges, viewport: WB.viewport, idCtr: WB.idCtr, hingeIdCtr: WB.hingeIdCtr })); } catch(e) {}
}

function wbRestore() {
  try {
    const raw = localStorage.getItem('dls_wb');
    if (!raw) return false;
    const d = JSON.parse(raw);
    WB.mirrors = d.mirrors || []; WB.hinges = d.hinges || []; WB.viewport = d.viewport || { zoom: 1, panX: 0, panY: 0 };
    WB.idCtr = d.idCtr || 0; WB.hingeIdCtr = d.hingeIdCtr || 0; WB.datasheets = {};
    return WB.mirrors.length > 0;
  } catch(e) { return false; }
}

// ── UNDO / REDO (Workbench) ───────────────────────────────
let _wbUndoTimeout = null;
function wbPushState() {
  clearTimeout(_wbUndoTimeout);
  _wbUndoTimeout = setTimeout(() => {
    const snapshot = JSON.stringify({ mirrors: WB.mirrors, hinges: WB.hinges, idCtr: WB.idCtr, hingeIdCtr: WB.hingeIdCtr });
    if (WB.undoStack.length === 0 || WB.undoStack[WB.undoStack.length - 1] !== snapshot) {
      WB.undoStack.push(snapshot);
      if (WB.undoStack.length > 50) WB.undoStack.shift();
      WB.redoStack = []; 
    }
  }, 200);
}

function _wbLoadSnapshot(snapJson) {
  const d = JSON.parse(snapJson);
  WB.mirrors = d.mirrors; WB.hinges = d.hinges; WB.idCtr = d.idCtr; WB.hingeIdCtr = d.hingeIdCtr;
  WB.datasheets = {};
  wbDeselect();
  if (typeof wbRenderList === 'function') wbRenderList();
  if (typeof wbRenderParams === 'function') wbRenderParams();
  if (typeof wbDraw === 'function') wbDraw();
  wbSave();
}

function wbUndo() {
  if (WB.undoStack.length <= 1) return; 
  WB.redoStack.push(WB.undoStack.pop());
  _wbLoadSnapshot(WB.undoStack[WB.undoStack.length - 1]);
}

function wbRedo() {
  if (WB.redoStack.length === 0) return;
  const next = WB.redoStack.pop();
  WB.undoStack.push(next);
  _wbLoadSnapshot(next);
}

window.WB = WB;
window.wbNewMirror = wbNewMirror; window.wbActive = wbActive; window.wbSelect = wbSelect; window.wbDeselect = wbDeselect;
window.wbSave = wbSave; window.wbRestore = wbRestore; window.wbGetMirror = wbGetMirror; window.wbGetHinge = wbGetHinge;
window.wbPushState = wbPushState; window.wbUndo = wbUndo; window.wbRedo = wbRedo;