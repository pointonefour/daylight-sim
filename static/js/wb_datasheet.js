// wb_datasheet.js — datasheet panel, compute, exports

function wbRenderDatasheet() {
  const body = document.getElementById('wb-data-body');
  const m    = wbActive();
  const ds   = m ? WB.datasheets[m.id] : null;

  if (!m) {
    body.innerHTML = '<div style="color:#555555;text-align:center;margin-top:30px;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Select a mirror</div>';
    return;
  }
  if (!ds) {
    body.innerHTML = '<div style="color:#555555;text-align:center;margin-top:30px;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Press Compute</div>';
    return;
  }

  const row = (k, v) => `<div class="dr"><span class="dk">${k}</span><span class="dv">${v}</span></div>`;
  const mm  = v => (v*1000).toFixed(3)+' mm';
  const deg = v => parseFloat(v).toFixed(4)+'°';

  let html = '';

  // Transform matrix
  const mat = wbTransformMatrix(m);
  html += `<div class="ds"><div class="ds-title">World Transform</div>
    ${row('Position',  `(${m.tx.toFixed(4)}, ${m.ty.toFixed(4)}) m`)}
    ${row('Rotation',  `${m.rotation.toFixed(4)}°`)}
    ${row('Scale X/Y', `${m.scaleX.toFixed(4)} / ${m.scaleY.toFixed(4)}`)}
    <div style="font-family:monospace;font-size:9px;color:#aaaaaa;margin-top:6px;line-height:16px;">
      Transform Matrix (3×3):<br>
      [${mat[0].map(v=>v.toFixed(5)).join(', ')}]<br>
      [${mat[1].map(v=>v.toFixed(5)).join(', ')}]<br>
      [${mat[2].map(v=>v.toFixed(5)).join(', ')}]
    </div>
  </div>`;

  // Equation
  if (ds.equation) {
    html += `<div class="ds"><div class="ds-title">Curve Equation</div>
      <div style="font-family:monospace;font-size:10px;color:#ffffff;padding:4px 0;word-break:break-all;">${ds.equation}</div>
    </div>`;
  }

  // Key points
  if (ds.type === 'parabolic') {
    html += `<div class="ds"><div class="ds-title">Key Points (local space, m)</div>
      ${row('Vertex',       '(0, 0, 0)')}
      ${row('Focal Point',  `(${ds.focal_point.x}, ${ds.focal_point.y}, 0)`)}
      ${row('Tip Left',     `(${ds.tip_left.x}, ${ds.tip_left.y}, 0)`)}
      ${row('Tip Right',    `(${ds.tip_right.x}, ${ds.tip_right.y}, 0)`)}
      ${row('Origin',       `(${ds.origin_point.x}, ${ds.origin_point.y}, 0)  [${ds.origin_type}]`)}
    </div>`;

    html += `<div class="ds"><div class="ds-title">Geometry</div>
      ${row('Focal Length',        mm(ds.focal_length_m))}
      ${row('Full Aperture',       mm(ds.full_aperture_m))}
      ${row('Effective Aperture',  mm(ds.effective_aperture_m))}
      ${row('f/D Ratio',           ds.fd_ratio)}
      ${row('Chord Length',        mm(ds.chord_length_m))}
      ${row('Arc Length',          mm(ds.arc_length_m))}
      ${row('Sagitta',             mm(ds.sagitta_m))}
      ${row('ROC at Vertex',       mm(ds.radius_of_curvature_vertex_m))}
      ${row('Rim Angle Left',      deg(ds.rim_angle_left_deg))}
      ${row('Rim Angle Right',     deg(ds.rim_angle_right_deg))}
      ${row('Tangent at Left Tip', deg(ds.tangent_angle_left_tip_deg))}
      ${row('Tangent at Right Tip',deg(ds.tangent_angle_right_tip_deg))}
    </div>`;

  } else if (ds.type === 'flat') {
    html += `<div class="ds"><div class="ds-title">Key Points (local space, m)</div>
      ${row('Tip Left',  `(${ds.tip_left.x}, 0, 0)`)}
      ${row('Tip Right', `(${ds.tip_right.x}, 0, 0)`)}
      ${row('Origin',    `(${ds.origin_point.x}, ${ds.origin_point.y}, 0)  [${ds.origin_type}]`)}
      ${row('Width',     mm(ds.width_m))}
      ${row('Normal',    `(${ds.normal_vector.x}, ${ds.normal_vector.y}, 0)`)}
    </div>`;

  } else if (ds.type === 'cpc') {
    html += `<div class="ds"><div class="ds-title">Key Points (local space, m)</div>
      ${row('Aperture Left',  `(${ds.tip_left.x}, ${ds.tip_left.y}, 0)`)}
      ${row('Aperture Right', `(${ds.tip_right.x}, ${ds.tip_right.y}, 0)`)}
      ${row('Receiver Left',  `(${ds.receiver_left.x}, ${ds.receiver_left.y}, 0)`)}
      ${row('Receiver Right', `(${ds.receiver_right.x}, ${ds.receiver_right.y}, 0)`)}
    </div>`;
    html += `<div class="ds"><div class="ds-title">Geometry</div>
      ${row('Acceptance Half-Angle', deg(ds.acceptance_half_angle_deg))}
      ${row('Aperture',              mm(ds.aperture_m))}
      ${row('Receiver Width',        mm(ds.receiver_width_m))}
      ${row('Concentration Ratio',   ds.concentration_ratio_2d+'x (2D)')}
      ${row('Full Height',           mm(ds.full_height_m))}
      ${row('Truncated Height',      mm(ds.truncated_height_m))}
      ${row('Arc (one arm)',         mm(ds.arc_length_one_arm_m))}
    </div>`;
  }

  // Material
  html += `<div class="ds"><div class="ds-title">Material & Optical</div>
    ${row('Material',             ds.material)}
    ${row('Reflectivity @550nm',  (ds.reflectivity_550nm*100).toFixed(1)+'%')}
    ${row('Reflectivity avg vis', (ds.reflectivity_avg_vis*100).toFixed(1)+'%')}
    ${row('Roughness Ra',         ds.roughness_ra_um+' μm')}
    ${row('Substrate T',          ds.substrate_thickness_mm+' mm')}
  </div>`;

  // Manufacturing
  html += `<div class="ds"><div class="ds-title">Manufacturing</div>
    ${row('Method',             ds.manufacturing_method||'—')}
    ${row('Slope Error',        ds.slope_error_mrad+' mrad')}
    ${row('PV Form Error',      ds.pv_form_error_um+' μm')}
    ${row('Tolerance',          (ds.tolerance_mm||'—')+' mm')}
    ${row('Recommended Points', ds.recommended_points||'—')}
    ${row('Points Used',        ds.point_count_used)}
  </div>`;

  // Point table preview
  const pt = ds.point_table || ds.point_table_right_arm || [];
  if (pt.length) {
    const preview = pt.slice(0,5);
    html += `<div class="ds"><div class="ds-title">Point Table (${pt.length} pts, first 5)</div>
      <table class="comp-table">
        <tr><th>#</th><th>X (m)</th><th>Y (m)</th><th>Z</th></tr>
        ${preview.map((p,i)=>`<tr><td>${i+1}</td><td>${p.x}</td><td>${p.y}</td><td>0</td></tr>`).join('')}
      </table>
      <div style="color:#555555;font-size:9px;margin-top:4px;">Export TXT for full table</div>
    </div>`;
  }

  body.innerHTML = html;
}

// ── COMPUTE ───────────────────────────────────────────────
async function wbCompute() {
  const m = wbActive();
  if (!m) { alert('Select a mirror first.'); return; }

  const btn = document.getElementById('wb-btn-compute');
  btn.textContent = 'COMPUTING...'; btn.disabled = true;

  // Merge mirror transform into payload for server awareness
  const payload = { ...m.params, type: m.type, tx: m.tx, ty: m.ty, rotation: m.rotation, scaleX: m.scaleX, scaleY: m.scaleY };

  try {
    const res = await fetch('/workbench/compute', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    WB.datasheets[m.id] = await res.json();
    wbRenderDatasheet();
    wbDraw();
  } catch(e) { alert('Server unreachable.'); }

  btn.textContent = 'COMPUTE'; btn.disabled = false;
}

// ── EXPORT TO SIM ─────────────────────────────────────────

async function wbExportToSim() {
  if (!WB.mirrors.length) { alert('No mirrors to export.'); return; }

  // Build mirrors payload — each entry includes wbMirrorId for id mapping
  const mirrorsPayload = WB.mirrors.map(m => ({
    wbMirrorId:    m.id,
    type:          m.type,
    definition:    { ...m.params },
    transform:     { tx: m.tx, ty: m.ty, rotation: m.rotation, scaleX: m.scaleX, scaleY: m.scaleY },
    assemblyId:    m.assemblyId    ?? null,
    parentHingeId: m.parentHingeId ?? null,
    datasheet:     WB.datasheets[m.id] || null,
  }));

  // Build hinges payload using workbench hinge structure
  const hingesPayload = WB.hinges.map(h => ({
    wbHingeId:  h.id,
    compAWbId:  h.mirrorA.mirrorId,
    pointA:     h.mirrorA.pointName,
    compBWbId:  h.mirrorB.mirrorId,
    pointB:     h.mirrorB.pointName,
  }));

  try {
    const res = await fetch('/workbench/export', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mirrors: mirrorsPayload, hinges: hingesPayload })
    });
    const result = await res.json();
    if (result.status === 'ok') {
      alert(`${result.count} mirror(s) exported. Use "Load from Workbench" in the Simulator.`);
    }
  } catch(e) { alert('Export failed.'); }
}

// ── CSV EXPORT ────────────────────────────────────────────
function wbExportCSV() {
  const m  = wbActive();
  const ds = m ? WB.datasheets[m.id] : null;
  if (!ds) { alert('Compute first.'); return; }

  const mat = wbTransformMatrix(m);
  const lines = [
    ['Parameter','Value','Unit'],
    ['Mirror Type', ds.type, ''],
    ['--- World Transform ---'],
    ['Position X', m.tx, 'm'],
    ['Position Y', m.ty, 'm'],
    ['Rotation',   m.rotation, 'deg'],
    ['Scale X',    m.scaleX, ''],
    ['Scale Y',    m.scaleY, ''],
    ['Transform Matrix Row 0', mat[0].join(' '), ''],
    ['Transform Matrix Row 1', mat[1].join(' '), ''],
    ['Transform Matrix Row 2', mat[2].join(' '), ''],
    [],
  ];

  for (const [k,v] of Object.entries(ds)) {
    if (['point_table','point_table_right_arm','point_table_left_arm'].includes(k)) continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      lines.push([k, `(${v.x??''}, ${v.y??''}, ${v.z??0})`, 'm']);
    } else if (typeof v !== 'object') {
      lines.push([k, v, '']);
    }
  }

  lines.push([], ['--- Point Table ---'], ['#','X (m)','Y (m)','Z (m)']);
  const pt = ds.point_table || ds.point_table_right_arm || [];
  pt.forEach((p,i) => lines.push([i+1, p.x, p.y, 0]));

  if (ds.point_table_left_arm) {
    lines.push([], ['--- Left Arm ---'], ['#','X (m)','Y (m)','Z (m)']);
    ds.point_table_left_arm.forEach((p,i) => lines.push([i+1, p.x, p.y, 0]));
  }

  const csv = lines.map(r=>r.join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download = `mirror_${ds.type}_${Date.now()}.csv`;
  a.click();
}

// ── POINTS TXT ────────────────────────────────────────────
function wbExportPointsTXT() {
  const m  = wbActive();
  const ds = m ? WB.datasheets[m.id] : null;
  if (!ds) { alert('Compute first.'); return; }

  const pt = ds.point_table || ds.point_table_right_arm || [];
  let txt = `# Mirror Point Table — ${ds.type}\n# Units: meters  Z=0\n# Points: ${pt.length}\n\n`;
  txt += pt.map(p=>`${p.x}\t${p.y}\t0`).join('\n');

  if (ds.point_table_left_arm) {
    txt += `\n\n# Left Arm\n`;
    txt += ds.point_table_left_arm.map(p=>`${p.x}\t${p.y}\t0`).join('\n');
  }

  const a   = document.createElement('a');
  a.href    = 'data:text/plain;charset=utf-8,'+encodeURIComponent(txt);
  a.download = `mirror_${ds.type}_points_${Date.now()}.txt`;
  a.click();
}