// project.js — .dlsim file save/load

const DLSIM_VERSION = 1;

// ── SAVE ──────────────────────────────────────────────────
function saveProject() {
  const payload = {
    version:   DLSIM_VERSION,
    saved:     new Date().toISOString(),
    sim: {
      components:  State.components,
      simHinges:   State.simHinges  || [],
      sourceX:     State.sourceX,
      sourceY:     State.sourceY,
      sourceWidth: State.sourceWidth,
      sourceRotation: State.sourceRotation || 0,
      viewport:    State.viewport,
      idCtr:       State.idCtr,
      sun: {
        lat:   parseFloat(document.getElementById('lat')?.value   || 45),
        day:   parseFloat(document.getElementById('day')?.value   || 172),
        time:  parseFloat(document.getElementById('time')?.value  || 12),
        sysAz: parseFloat(document.getElementById('sysaz')?.value || 180),
        dni:   parseFloat(document.getElementById('dni')?.value   || 900),
        dhi:   parseFloat(document.getElementById('dhi')?.value   || 150),
      }
    },
    workbench: {
      mirrors:      (typeof WB !== 'undefined') ? WB.mirrors     : [],
      hinges:       (typeof WB !== 'undefined') ? WB.hinges      : [],
      assemblies:   (typeof WB !== 'undefined') ? (WB.assemblies||[]) : [],
      viewport:     (typeof WB !== 'undefined') ? WB.viewport    : { zoom:1, panX:0, panY:0 },
      idCtr:        (typeof WB !== 'undefined') ? WB.idCtr       : 0,
      hingeIdCtr:   (typeof WB !== 'undefined') ? WB.hingeIdCtr  : 0,
    }
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'project_' + Date.now() + '.dlsim';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── LOAD ──────────────────────────────────────────────────
function loadProject(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      if (!d.version) throw new Error('Not a valid .dlsim file');

      // ── Restore sim state ──
      if (d.sim) {
        const s = d.sim;
        State.components     = s.components    || [];
        State.simHinges      = s.simHinges     || [];
        State.sourceX        = s.sourceX       ?? 0;
        State.sourceY        = s.sourceY       ?? 2.5;
        State.sourceWidth    = s.sourceWidth   ?? 3.0;
        State.sourceRotation = s.sourceRotation ?? 0;
        State.viewport       = s.viewport      || { zoom:1, panX:0, panY:0 };
        State.idCtr          = s.idCtr         || 0;
        State.rayPaths       = [];
        State.rayEnergies    = [];
        State.lastStats      = null;

        // Restore sun sliders
        if (s.sun) {
          _setSlider('lat',   s.sun.lat);
          _setSlider('day',   s.sun.day);
          _setSlider('time',  s.sun.time);
          _setSlider('sysaz', s.sun.sysAz);
          _setVal('dni', s.sun.dni);
          _setVal('dhi', s.sun.dhi);
          // Update displayed labels
          const lv=document.getElementById('latv');  if(lv) lv.textContent=s.sun.lat+'°';
          const dv=document.getElementById('dayv');  if(dv) dv.textContent=s.sun.day;
          const tv=document.getElementById('timev'); if(tv && typeof formatTime==='function') tv.textContent=formatTime(s.sun.time);
          const sv=document.getElementById('sysazv');if(sv) sv.textContent=s.sun.sysAz+'°';
          // Source line rotation label
          const srv=document.getElementById('src-rot-val');
          if(srv) srv.textContent=(State.sourceRotation||0).toFixed(0)+'°';
          const srSlider=document.getElementById('src-rot');
          if(srSlider) srSlider.value=State.sourceRotation||0;
        }

        simSave();
        if (typeof reconcileSimChain === 'function') reconcileSimChain();
        if (typeof renderList === 'function') renderList();
        if (typeof draw === 'function') draw();
      }

      // ── Restore workbench state (if on workbench page) ──
      if (d.workbench && typeof WB !== 'undefined') {
        const wb = d.workbench;
        WB.mirrors     = wb.mirrors    || [];
        WB.hinges      = wb.hinges     || [];
        WB.assemblies  = wb.assemblies || [];
        WB.viewport    = wb.viewport   || { zoom:1, panX:0, panY:0 };
        WB.idCtr       = wb.idCtr      || 0;
        WB.hingeIdCtr  = wb.hingeIdCtr || 0;
        WB.datasheets  = {};
        wbSave();
        if (typeof wbRenderList  === 'function') wbRenderList();
        if (typeof wbRenderParams=== 'function') wbRenderParams();
        if (typeof wbDraw        === 'function') wbDraw();
      }

      alert('Project loaded.');
    } catch(err) {
      alert('Failed to load: ' + err.message);
      console.error(err);
    }
  };
  reader.readAsText(file);
}

// ── DRAG AND DROP ─────────────────────────────────────────
function initProjectDragDrop() {
  document.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!file.name.endsWith('.dlsim') && !file.name.endsWith('.json')) {
      alert('Drop a .dlsim file to load a project.');
      return;
    }
    loadProject(file);
  });
}

// ── FILE INPUT TRIGGER ────────────────────────────────────
function triggerLoadProject() {
  const input = document.createElement('input');
  input.type  = 'file';
  input.accept = '.dlsim,.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (file) loadProject(file);
  };
  input.click();
}

// ── HELPERS ───────────────────────────────────────────────
function _setSlider(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

// ── EXPORTS ───────────────────────────────────────────────
window.saveProject        = saveProject;
window.loadProject        = loadProject;
window.triggerLoadProject = triggerLoadProject;
window.initProjectDragDrop = initProjectDragDrop;
