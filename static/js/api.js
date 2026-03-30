// api.js — Flask communication

async function runTrace() {
  const btn = document.querySelector('.btn.trace');
  const { lat, day, time, sysAz, dni, dhi } = getSolarInputs();
  const sol = calcSolar(lat, day, time, sysAz);

  if (sol.isNight) { alert("Cannot trace: It's night time."); return; }

  btn.textContent = 'TRACING...'; btn.disabled = true;

  const payload = {
    sun: { latitude: lat, day, time, sys_azimuth: sysAz, DNI: dni, DHI: dhi },
    ray_count:    parseInt(document.getElementById('rc').value),
    max_bounces:  parseInt(document.getElementById('mb').value),
    source_y:     State.sourceY,
    source_x:     State.sourceX,
    source_width: State.sourceWidth,
    source_rotation: State.sourceRotation || 0,
    components:   State.components.map(c => ({
      type:            c.type,
      position:        [c.position.x, c.position.y],
      rotation:        c.rotation,
      origin_offset_x: c.params.origin_offset_x || 0,
      origin_offset_y: c.params.origin_offset_y || 0,
      ...c.params
    }))
  };

  try {
    const res  = await fetch('/trace', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await res.json();
    State.rayPaths    = data.ray_paths;
    State.rayEnergies = data.ray_energies;
    State.lastStats   = data.stats;
    renderDataPanel(data.stats);
    draw();
  } catch(err) { alert('Server unreachable. Run: python server.py'); }

  btn.textContent = 'TRACE RAYS'; btn.disabled = false;
}

// ── LOAD FROM WORKBENCH ───────────────────────────────────
async function loadFromWorkbench() {
  try {
    const res  = await fetch('/workbench/load');
    const data = await res.json();
    const mirrors = data.mirrors;

    if (!mirrors || !mirrors.length) { alert('No mirrors exported from Workbench yet.'); return; }

    // Map: workbench mirror id → new sim component id
    const idMap = {};

    for (const entry of mirrors) {
      const def       = entry.definition || {};
      const transform = entry.transform  || {};
      const type      = entry.type || def.type || 'parabolic';

      // Compute the exact local origin offset from the workbench named point
      const originName = def.origin || 'vertex';
      const [olx, oly] = _computeNamedPointLocal(type, def, originName);

      let params = {};

      if (type === 'parabolic') {
        params = {
          focal_length:    def.focal_length    ?? 0.5,
          aperture:        def.aperture        ?? 0.8,
          reflectivity:    def.reflectivity    ?? 0.92,
          slope_error:     def.slope_error_mrad ? def.slope_error_mrad*0.057 : 0.2,
          trim_start:      def.trim_start      ?? 0.0,
          trim_end:        def.trim_end        ?? 1.0,
          origin_type:     originName,
          origin_offset_x: olx,
          origin_offset_y: oly,
          assembly_id:     entry.assemblyId    ?? null,
          parent_hinge_id: entry.parentHingeId ?? null,
        };
      } else if (type === 'flat') {
        params = {
          width:           def.width        ?? 0.6,
          reflectivity:    def.reflectivity ?? 0.92,
          trim_start:      def.trim_start   ?? 0.0,
          trim_end:        def.trim_end     ?? 1.0,
          origin_type:     originName,
          origin_offset_x: olx,
          origin_offset_y: oly,
          assembly_id:     entry.assemblyId    ?? null,
          parent_hinge_id: entry.parentHingeId ?? null,
        };
      } else if (type === 'cpc') {
        params = {
          acceptance_angle: def.acceptance_angle ?? 30,
          aperture:         def.aperture         ?? 0.6,
          reflectivity:     def.reflectivity     ?? 0.90,
          trim_start:       def.trim_start       ?? 0.0,
          trim_end:         def.trim_end         ?? 1.0,
          origin_type:      originName,
          origin_offset_x:  olx,
          origin_offset_y:  oly,
          assembly_id:      entry.assemblyId    ?? null,
          parent_hinge_id:  entry.parentHingeId ?? null,
        };
      }

      const newId = State.idCtr++;
      idMap[entry.wbMirrorId] = newId;

      State.components.push({
        id:       newId,
        type,
        // tx/ty from workbench IS where the origin lands in world space
        position: { x: transform.tx ?? 0, y: transform.ty ?? 0 },
        rotation: transform.rotation ?? 0,
        params,
      });
    }

    // Rebuild sim hinge list from workbench hinges
    // entry format: { wbHingeId, compAWbId, pointA, compBWbId, pointB }
    if (!State.simHinges) State.simHinges = [];
    const hinges = data.hinges || [];
    for (const wbHinge of hinges) {
      const compAId = idMap[wbHinge.compAWbId];
      const compBId = idMap[wbHinge.compBWbId];
      if (compAId === undefined || compBId === undefined) continue;
      State.simHinges.push({
        id:      State.simHinges.length,
        compAId,
        pointA:  wbHinge.pointA,
        compBId,
        pointB:  wbHinge.pointB,
      });
    }

    // Clear workbench store
    await fetch('/workbench/clear', { method: 'POST' });

    // Reconcile chain positions before drawing
    reconcileSimChain();
    renderList();
    draw();
    simSave();

    alert(`${mirrors.length} mirror(s) loaded from Workbench.`);
  } catch(err) {
    console.error(err);
    alert('Failed to load from Workbench.');
  }
}

// Compute local named point coords from a workbench mirror definition
function _computeNamedPointLocal(type, def, pointName) {
  if (type === 'parabolic') {
    const f  = def.focal_length ?? 0.5;
    const D  = def.aperture     ?? 0.8;
    const ts = def.trim_start   ?? 0;
    const te = def.trim_end     ?? 1;
    if (pointName === 'vertex')    return [0, 0];
    if (pointName === 'focal')     return [0, f];
    if (pointName === 'left_tip')  { const x=-D/2+ts*D; return [x, x*x/(4*f)]; }
    if (pointName === 'right_tip') { const x=-D/2+te*D; return [x, x*x/(4*f)]; }
  }
  if (type === 'flat') {
    const w  = def.width      ?? 0.6;
    const ts = def.trim_start ?? 0;
    const te = def.trim_end   ?? 1;
    if (pointName === 'center')    return [0, 0];
    if (pointName === 'left_tip')  return [-w/2+ts*w, 0];
    if (pointName === 'right_tip') return [-w/2+te*w, 0];
  }
  if (type === 'cpc') {
    const r  = (def.aperture||0.6)/2;
    const th = (def.acceptance_angle||30)*Math.PI/180;
    const tr = def.truncation_factor||1;
    const tv = (Math.PI/2+th)*tr;
    const xR = r*(1+Math.sin(tv))*Math.cos(tv)/(1+Math.sin(th));
    const y  = r*(1+Math.sin(tv))*Math.sin(tv)/(1+Math.sin(th))-r;
    if (pointName === 'left_tip')        return [-xR, y];
    if (pointName === 'right_tip')       return [ xR, y];
    if (pointName === 'receiver_center') return [0, -r];
  }
  return [0, 0];
}

function exportCSV() {
  if (!State.lastStats) { alert('Run a trace first.'); return; }
  const s = State.lastStats;
  const lines = [
    ['Parameter','Value W','Value lm','Unit'],
    ['Sun Profile',s.sun_profile_deg,'','deg'],
    ['DNI',s.DNI_wm2,s.DNI_wm2*93,'W/m² | lm/m²'],
    ['DHI',s.DHI_wm2,s.DHI_wm2*93,'W/m² | lm/m²'],
    ['GHI',s.GHI_wm2,s.GHI_wm2*93,'W/m² | lm/m²'],
    ['Collection Area',s.collection_area_m2,'','m²'],
    ['Power In Total',s.power_in_total_w,s.power_in_total_lm,'W | lm'],
    ['Power In DNI',s.power_in_dni_w,s.power_in_dni_lm,'W | lm'],
    ['Power In DHI',s.power_in_dhi_w,s.power_in_dhi_lm,'W | lm'],
    ['Power Out',s.power_out_w,s.power_out_lm,'W | lm'],
    ['Total Loss',s.total_loss_w,s.total_loss_lm,'W | lm'],
    ['Efficiency',s.efficiency_pct,'','%'],
    ['Ray Count',s.ray_count,'',''],
    ['Dead Rays',s.dead_rays,'',''],
    ['Alive Rays',s.alive_rays,'',''],
    ['Avg Bounces',s.avg_bounces,'',''],
    ['Beam Spread',s.beam_spread_deg,'','deg'],
    ['Exit Spread',s.exit_spread_m,'','m'],
    [],['--- Component Summary ---'],
    ['Component','Hits','Loss W','Loss lm','Loss %'],
    ...s.component_summary.map(c=>[c.component,c.hits,c.loss_w,c.loss_lm,c.loss_pct]),
    [],['--- Bounce Log ---'],
    ['Ray','Bounce','Component','Energy Before W','Energy After W','Loss W','Loss %','AOI deg'],
    ...s.bounce_log.map(b=>[b.ray,b.bounce,b.component,b.energy_before_w,b.energy_after_w,b.loss_w,b.loss_pct,b.aoi_deg])
  ];
  const csv = lines.map(r=>r.join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download = 'daylight_sim_'+Date.now()+'.csv';
  a.click();
}

window.runTrace          = runTrace;
window.exportCSV         = exportCSV;
window.loadFromWorkbench = loadFromWorkbench;