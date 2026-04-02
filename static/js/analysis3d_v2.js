// analysis3d_v2.js - 3D Monte Carlo raytracer frontend

const A3D = {
  simPayload: null,
  lastStats: null,
  lastIrrMap: null,
  lastVizPng: null,
  w_bins: 0,
  z_bins: 0,
  depthRisk: null,
  runTimer: null,
  runStartedAt: 0,
  estimatedSeconds: 0,
  activeView: 'heatmap',
  dayRangeResults: null,
};

window.onload = () => {
  loadSimState();
  const depthInput = document.getElementById('depth');
  if (depthInput) depthInput.addEventListener('input', updateDepthWarning);
  wireControlPersistence();
  restoreAnalysisState();
};

function loadSimState() {
  const raw = localStorage.getItem('dls_sim');
  if (!raw) {
    alert("No simulation data found! Please build a setup in the Simulator first.");
    return;
  }
  A3D.simPayload = JSON.parse(raw);
  console.log("Synced with 2D Simulator:", A3D.simPayload);
  updateDepthWarning();
  const saved = typeof analysis3dRestore === 'function' ? analysis3dRestore() : null;
  updateStaleWarning(saved?.simFingerprint || null);
}

function wireControlPersistence() {
  ['rays', 'bounces', 'depth', 'sun-mode', 'day-start', 'day-end', 'day-step'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', persistAnalysisState);
      el.addEventListener('input', persistAnalysisState);
    }
  });
}

function restoreAnalysisState() {
  const saved = typeof analysis3dRestore === 'function' ? analysis3dRestore() : null;
  if (!saved) {
    updateStaleWarning(null);
    syncAnalysisView();
    return;
  }

  setControlValue('rays', saved.controls?.rays, v => document.getElementById('r-val').textContent = v);
  setControlValue('bounces', saved.controls?.bounces, v => document.getElementById('b-val').textContent = v);
  setControlValue('depth', saved.controls?.depth, v => document.getElementById('d-val').textContent = `${v} m`);
  setControlValue('sun-mode', saved.controls?.sunMode || 'true3d');
  setControlValue('day-start', saved.controls?.dayStart || '160');
  setControlValue('day-end', saved.controls?.dayEnd || '220');
  setControlValue('day-step', saved.controls?.dayStep || '1.0');

  A3D.activeView = saved.activeView || 'heatmap';
  A3D.lastStats = saved.lastStats || null;
  A3D.lastIrrMap = saved.lastIrrMap || null;
  A3D.lastVizPng = saved.lastVizPng || null;
  A3D.w_bins = saved.w_bins || 0;
  A3D.z_bins = saved.z_bins || 0;
  A3D.dayRangeResults = saved.dayRangeResults || null;

  updateDepthWarning();

  if (A3D.lastStats && A3D.lastIrrMap && A3D.lastIrrMap.length) {
    renderDataPanel(A3D.lastStats);
    renderHeatmap(A3D.lastIrrMap, A3D.lastStats.peak_irr || 0);
  }
  if (A3D.lastVizPng) renderModelView(A3D.lastVizPng);
  renderDayRangePanel(A3D.dayRangeResults);
  updateStaleWarning(saved.simFingerprint || null);
  syncAnalysisView();
}

function setControlValue(id, value, onUpdate) {
  if (value === undefined || value === null) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  if (onUpdate) onUpdate(value);
}

function persistAnalysisState() {
  if (typeof analysis3dSave !== 'function') return;
  analysis3dSave({
    controls: {
      rays: document.getElementById('rays')?.value ?? '0.5',
      bounces: document.getElementById('bounces')?.value ?? '12',
      depth: document.getElementById('depth')?.value ?? '1.0',
      sunMode: document.getElementById('sun-mode')?.value ?? 'true3d',
      dayStart: document.getElementById('day-start')?.value ?? '160',
      dayEnd: document.getElementById('day-end')?.value ?? '220',
      dayStep: document.getElementById('day-step')?.value ?? '1.0',
    },
    activeView: A3D.activeView,
    lastStats: A3D.lastStats,
    lastIrrMap: A3D.lastIrrMap,
    lastVizPng: A3D.lastVizPng,
    dayRangeResults: A3D.dayRangeResults,
    w_bins: A3D.w_bins,
    z_bins: A3D.z_bins,
    simFingerprint: getCurrentSimFingerprint(),
    savedAt: Date.now(),
  });
}

function getCurrentSimFingerprint() {
  if (!A3D.simPayload) return null;
  const sim = A3D.simPayload;
  const payload = {
    sourceX: sim.sourceX,
    sourceY: sim.sourceY,
    sourceWidth: sim.sourceWidth,
    sourceRotation: sim.sourceRotation,
    sun: sim.sun,
    components: sim.components,
  };
  return JSON.stringify(payload);
}

function updateStaleWarning(savedFingerprint) {
  const box = document.getElementById('stale-warning');
  const body = document.getElementById('stale-warning-body');
  if (!box || !body) return;

  const currentFingerprint = getCurrentSimFingerprint();
  const stale = !!savedFingerprint && !!currentFingerprint && savedFingerprint !== currentFingerprint;
  if (!stale) {
    box.style.display = 'none';
    return;
  }

  const sun = A3D.simPayload?.sun || {};
  body.textContent = `Current simulator state has changed since this 3D result was computed. The displayed rays and heatmap do not match the current 2D setup until you press Compute again. Current sun time: ${sun.time ?? 'unknown'}.`;
  box.style.display = 'block';
}

async function runTrace3D() {
  if (!A3D.simPayload) return alert("No sim state loaded.");

  const hasFilter = A3D.simPayload.components.some(c => c.type === 'filter');
  if (!hasFilter) {
    alert("WARNING: You must add a 'Filter Line (Sensor)' in the 2D Simulator to act as the floor/workplane for the 3D Heatmap!");
    return;
  }

  const btn = document.getElementById('btn-trace3d');
  btn.textContent = 'COMPUTING...';
  btn.disabled = true;

  const payload = {
    rays: parseFloat(document.getElementById('rays').value) * 1000000,
    bounces: parseInt(document.getElementById('bounces').value, 10),
    depth: parseFloat(document.getElementById('depth').value),
    sun_mode: document.getElementById('sun-mode')?.value || 'true3d',
    include_viz: true,
    sim_state: A3D.simPayload
  };

  beginRunStatus(payload);

  try {
    const res = await fetch('/trace3d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_err) {
      const looksLikeHtml = raw.trim().startsWith('<');
      if (looksLikeHtml) {
        throw new Error('The backend returned an HTML error page instead of JSON. Check Railway runtime logs for the first traceback after the /trace3d request.');
      }
      throw new Error('The backend returned an invalid response for 3D tracing.');
    }
    if (data.error) {
      if (data.viz_png_base64) {
        A3D.lastStats = data.stats || null;
        A3D.lastIrrMap = data.irr_map || null;
        A3D.lastVizPng = data.viz_png_base64;
        A3D.w_bins = data.w_bins || 0;
        A3D.z_bins = data.z_bins || 0;
        if (A3D.lastStats) renderDataPanel(A3D.lastStats);
        if (A3D.lastIrrMap && A3D.lastIrrMap.length) {
          renderHeatmap(A3D.lastIrrMap, A3D.lastStats?.peak_irr || 0);
        }
        renderModelView(A3D.lastVizPng);
        A3D.activeView = 'model';
        syncAnalysisView();
        persistAnalysisState();
      }
      throw new Error(data.error);
    }

    A3D.lastStats = data.stats;
    A3D.lastIrrMap = data.irr_map;
    A3D.lastVizPng = data.viz_png_base64 || null;
    A3D.w_bins = data.w_bins;
    A3D.z_bins = data.z_bins;

    updateDepthWarning();
    renderDataPanel(data.stats);
    renderHeatmap(data.irr_map, data.stats.peak_irr);
    if (A3D.lastVizPng) renderModelView(A3D.lastVizPng);
    syncAnalysisView();
    persistAnalysisState();
    updateStaleWarning(getCurrentSimFingerprint());
  } catch (err) {
    console.error(err);
    alert('Computation failed: ' + err.message);
  } finally {
    endRunStatus();
  }
}

function beginRunStatus(payload) {
  A3D.runStartedAt = Date.now();
  A3D.estimatedSeconds = estimateRunSeconds(payload);
  setRunStatusValues('Launching solver', 0, A3D.estimatedSeconds, Math.round(payload.rays).toLocaleString());

  const status = document.getElementById('run-status');
  const overlay = document.getElementById('loading-overlay');
  if (status) status.classList.add('active');
  if (overlay) overlay.classList.add('active');

  if (A3D.runTimer) clearInterval(A3D.runTimer);
  A3D.runTimer = window.setInterval(() => {
    const elapsed = (Date.now() - A3D.runStartedAt) / 1000;
    const stage = elapsed < 1.5 ? 'Sending request' : 'Tracing rays';
    setRunStatusValues(stage, elapsed, A3D.estimatedSeconds, Math.round(payload.rays).toLocaleString());
  }, 250);
}

function endRunStatus() {
  if (A3D.runTimer) {
    clearInterval(A3D.runTimer);
    A3D.runTimer = null;
  }

  const btn = document.getElementById('btn-trace3d');
  btn.textContent = 'Compute 3D Irradiance';
  btn.disabled = false;

  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('active');

  const elapsed = A3D.runStartedAt ? (Date.now() - A3D.runStartedAt) / 1000 : 0;
  setRunStatusValues('Complete', elapsed, A3D.estimatedSeconds, document.getElementById('rs-rays')?.textContent || '0');
}

function estimateRunSeconds(payload) {
  const raysMillions = payload.rays / 1000000;
  const bounces = payload.bounces;
  const depth = payload.depth;
  const estimate = 8 + raysMillions * 55 + bounces * 1.2 + depth * 1.8;
  return Math.max(6, estimate);
}

function setRunStatusValues(stage, elapsedSec, expectedSec, raysLabel) {
  const elapsed = formatDuration(elapsedSec);
  let expected = 'Estimating...';
  if (expectedSec > 0) {
    expected = elapsedSec > expectedSec
      ? `Exceeded by ${formatDuration(elapsedSec - expectedSec)}`
      : `~${formatDuration(expectedSec)}`;
  }

  const rsStage = document.getElementById('rs-stage');
  const rsElapsed = document.getElementById('rs-elapsed');
  const rsExpected = document.getElementById('rs-expected');
  const rsRays = document.getElementById('rs-rays');
  const loadingElapsed = document.getElementById('loading-elapsed');
  const loadingExpected = document.getElementById('loading-expected');

  if (rsStage) rsStage.textContent = stage;
  if (rsElapsed) rsElapsed.textContent = elapsed;
  if (rsExpected) rsExpected.textContent = expected;
  if (rsRays) rsRays.textContent = raysLabel;
  if (loadingElapsed) loadingElapsed.textContent = elapsed;
  if (loadingExpected) loadingExpected.textContent = expected;
}

function formatDuration(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function computeSolarModel(latDeg, day, timeH, sysAzDeg, mode = 'true3d') {
  const lat = latDeg * Math.PI / 180;
  const decl = (23.45 * Math.sin((360 / 365 * (day - 81)) * Math.PI / 180)) * Math.PI / 180;
  const ha = (15 * (timeH - 12)) * Math.PI / 180;
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const altDeg = alt * 180 / Math.PI;
  if (altDeg <= 0) return null;

  const cosAz = (Math.sin(decl) - Math.sin(lat) * Math.sin(alt)) / (Math.cos(lat) * Math.cos(alt) + 1e-9);
  let azDeg = Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180 / Math.PI;
  if (ha > 0) azDeg = 360 - azDeg;

  const relAz = (azDeg - sysAzDeg) * Math.PI / 180;
  let dir;
  if (mode === 'profile2d') {
    const prof = Math.atan2(Math.tan(alt), Math.cos(relAz));
    dir = {
      x: Math.cos(prof),
      y: -Math.sin(prof),
      z: 0,
    };
  } else {
    dir = {
      x: Math.cos(alt) * Math.cos(relAz),
      y: -Math.sin(alt),
      z: Math.cos(alt) * Math.sin(relAz),
    };
  }
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= len;
  dir.y /= len;
  dir.z /= len;

  return { altDeg, azDeg, dir };
}

function getComponentSpan(comp) {
  const p = comp.params || {};
  if (comp.type === 'flat' || comp.type === 'filter') return p.width || 0;
  if (comp.type === 'parabolic' || comp.type === 'cpc') return p.aperture || 0;
  return 0;
}

function estimateDepthRisk() {
  if (!A3D.simPayload || !A3D.simPayload.components) return null;

  const depth = parseFloat(document.getElementById('depth').value);
  const sunMode = document.getElementById('sun-mode')?.value || 'true3d';
  const sun = A3D.simPayload.sun || {};
  const sol = computeSolarModel(
    parseFloat(sun.lat ?? 45),
    parseFloat(sun.day ?? 172),
    parseFloat(sun.time ?? 12),
    parseFloat(sun.sysAz ?? 180),
    sunMode
  );
  if (!sol) return null;

  const filter = A3D.simPayload.components.find(c => c.type === 'filter');
  const mirrors = A3D.simPayload.components.filter(c => c.type !== 'filter');
  if (!filter || !mirrors.length) return null;

  const filterX = filter.position?.x ?? 0;
  const crossTravel = Math.max(
    ...mirrors.map(comp => {
      const span = getComponentSpan(comp);
      const cx = comp.position?.x ?? 0;
      return Math.abs(filterX - cx) + span * 0.5;
    }),
    0
  );

  const absDx = Math.abs(sol.dir.x);
  const absDz = Math.abs(sol.dir.z);
  const absDy = Math.abs(sol.dir.y);

  if (sunMode === 'profile2d' || absDz < 1e-6) {
    return {
      level: 'ok',
      depth,
      requiredDepth: 0,
      axialDrift: 0,
      crossTravel,
      axialRatio: 0,
      verticalRatio: absDy > 1e-6 ? absDz / absDy : 0,
      message: 'Sun is nearly aligned with the 2D cross-section plane, so axial depth loss should stay low for this run.',
    };
  }

  if (absDx < 0.02) {
    return {
      level: 'warn',
      depth,
      requiredDepth: Number.POSITIVE_INFINITY,
      axialDrift: Number.POSITIVE_INFINITY,
      crossTravel,
      axialRatio: Number.POSITIVE_INFINITY,
      verticalRatio: absDy > 1e-6 ? absDz / absDy : 0,
      message: 'The true 3D sun vector is almost parallel to the trough axis, so axial walk-off becomes effectively unbounded. Use 2.5D Profile mode for a 2D-equivalent check, or treat this as an extreme finite-depth loss case.',
    };
  }

  const axialRatio = absDz / absDx;
  const axialDrift = crossTravel * axialRatio;
  const requiredDepth = axialDrift * 1.15;

  let level = 'ok';
  if (depth < requiredDepth * 0.65) level = 'danger';
  else if (depth < requiredDepth) level = 'warn';

  const message =
    level === 'ok'
      ? `Current depth should be long enough for this sun angle. Estimated axial walk-off to the sensor is about ${axialDrift.toFixed(1)} m.`
      : `Strong along-axis sun component detected. Estimated axial walk-off to the sensor is about ${axialDrift.toFixed(1)} m, while the current extrusion depth is ${depth.toFixed(1)} m. 3D efficiency can drop sharply even when the 2D profile still looks efficient.`;

  return {
    level,
    depth,
    requiredDepth,
    axialDrift,
    crossTravel,
    axialRatio,
    verticalRatio: absDy > 1e-6 ? absDz / absDy : 0,
    message,
  };
}

function updateDepthWarning() {
  const box = document.getElementById('depth-warning');
  const body = document.getElementById('depth-warning-body');
  if (!box || !body) return;

  const risk = estimateDepthRisk();
  A3D.depthRisk = risk;

  if (!risk) {
    box.style.display = 'none';
    return;
  }

  if (risk.level === 'ok') {
    if (A3D.lastStats && A3D.lastStats.efficiency_pct <= 0.01 && risk.axialDrift > risk.depth * 0.8) {
      box.style.display = 'block';
      box.dataset.level = 'warn';
      body.innerHTML = [
        `<span class="warn-line warn-drift">Estimated axial walk-off to the sensor is about ${risk.axialDrift.toFixed(1)}m.</span>`,
        `<span class="warn-line warn-depth">Suggested debug depth: about ${Math.max(risk.requiredDepth, risk.depth).toFixed(1)}m or more.</span>`
      ].join('');
      return;
    }
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  box.dataset.level = risk.level;
  body.innerHTML = [
    `<span class="warn-line warn-drift">${Number.isFinite(risk.axialDrift) ? `Estimated axial walk-off to the sensor is about ${risk.axialDrift.toFixed(1)}m.` : 'Estimated axial walk-off is extremely large because the true 3D sun vector is nearly parallel to the trough axis.'}</span>`,
    `<span class="warn-line warn-depth">${Number.isFinite(risk.requiredDepth) ? `Suggested debug depth: about ${risk.requiredDepth.toFixed(1)}m or more.` : 'Suggested debug depth would be impractically large in True 3D mode; switch to 2.5D Profile for 2D-equivalent debugging.'}</span>`
  ].join('');
}

function renderHeatmap(irrMap, peak) {
  const canvas = document.getElementById('a3d-canvas');
  const ctx = canvas.getContext('2d');
  const cellPx = 15;
  const wBins = irrMap[0].length;
  const zBins = irrMap.length;

  canvas.width = wBins * cellPx;
  canvas.height = zBins * cellPx;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let z = 0; z < zBins; z++) {
    for (let w = 0; w < wBins; w++) {
      const val = irrMap[z][w];
      const norm = peak > 0 ? (val / peak) : 0;
      ctx.fillStyle = getColorScale(norm);
      ctx.fillRect(w * cellPx, (zBins - 1 - z) * cellPx, cellPx, cellPx);
    }
  }

  document.getElementById('heatmap-legend').style.display = 'flex';
  document.getElementById('legend-max').textContent = `${peak.toFixed(1)} W/m2`;
  syncAnalysisView();
}

function renderModelView(base64Png) {
  const img = document.getElementById('model-view');
  if (!img || !base64Png) return;
  img.src = `data:image/png;base64,${base64Png}`;
}

function setAnalysisView(view) {
  if (view === 'model' && !A3D.lastVizPng) {
    alert("No 3D model image is available yet. Run compute first.");
    return;
  }
  A3D.activeView = view === 'model' ? 'model' : 'heatmap';
  syncAnalysisView();
  persistAnalysisState();
}

function syncAnalysisView() {
  const canvas = document.getElementById('a3d-canvas');
  const legend = document.getElementById('heatmap-legend');
  const model = document.getElementById('model-view');
  const heatBtn = document.getElementById('view-heatmap');
  const modelBtn = document.getElementById('view-model');
  const canShowModel = !!A3D.lastVizPng;
  const showModel = A3D.activeView === 'model' && canShowModel;

  if (canvas) canvas.classList.toggle('hidden', showModel);
  if (legend) legend.classList.toggle('hidden', showModel);
  if (model) model.classList.toggle('active', showModel);
  if (heatBtn) heatBtn.classList.toggle('active', !showModel);
  if (modelBtn) {
    modelBtn.classList.toggle('active', showModel);
    modelBtn.disabled = false;
    modelBtn.style.opacity = canShowModel ? '1' : '0.6';
    modelBtn.style.cursor = 'pointer';
  }
}

function getColorScale(t) {
  if (t <= 0) return '#000000';
  if (t < 0.33) return `rgb(0, 0, ${Math.floor(t * 3 * 255)})`;
  if (t < 0.66) return `rgb(0, ${Math.floor((t - 0.33) * 3 * 255)}, 255)`;
  return `rgb(${Math.floor((t - 0.66) * 3 * 255)}, 255, 255)`;
}

function renderDataPanel(s) {
  const body = document.getElementById('a3d-data-body');
  const row = (k, v) => `<div class="dr"><span class="dk">${k}</span><span class="dv">${v}</span></div>`;
  const risk = A3D.depthRisk || estimateDepthRisk();

  let html = '';

  html += `<div class="ds"><div class="ds-title">3D Energy Transfer</div>
    ${row('Total Rays', s.rays_total.toLocaleString())}
    ${row('Power In', s.energy_in_w.toFixed(2) + ' W')}
    ${row('Power Captured', s.energy_cap_w.toFixed(2) + ' W')}
    ${row('3D Efficiency', s.efficiency_pct.toFixed(2) + '%')}
    ${row('Lost / Dead Rays', s.dead_rays.toLocaleString())}
  </div>`;

  html += `<div class="ds"><div class="ds-title">Workplane Metrics</div>
    ${row('Peak Irradiance', s.peak_irr.toFixed(1) + ' W/m2')}
    ${row('Average Irradiance', s.avg_irr.toFixed(1) + ' W/m2')}
    ${row('Uniformity (Min/Max)', s.uniformity.toFixed(1) + '%')}
  </div>`;

  if (risk) {
    html += `<div class="ds"><div class="ds-title">Depth-Loss Check</div>
      ${row('Axial Walk-Off', Number.isFinite(risk.axialDrift) ? risk.axialDrift.toFixed(2) + ' m' : 'Effectively unbounded')}
      ${row('Suggested Depth', Number.isFinite(risk.requiredDepth) ? risk.requiredDepth.toFixed(2) + ' m' : 'Impractically large')}
      ${row('Current Depth', risk.depth.toFixed(2) + ' m')}
      ${row('Axis Drift Ratio', Number.isFinite(risk.axialRatio) ? risk.axialRatio.toFixed(2) + ' z/x' : 'Very large')}
    </div>`;
  }

  body.innerHTML = html;
}

function formatScanTime(hours) {
  const wholeHours = Math.floor(hours);
  const mins = Math.round((hours - wholeHours) * 60);
  const normalizedHours = (mins === 60 ? wholeHours + 1 : wholeHours);
  const normalizedMins = mins === 60 ? 0 : mins;
  return `${String(normalizedHours).padStart(2, '0')}:${String(normalizedMins).padStart(2, '0')}`;
}

function renderDayRangePanel(results) {
  const body = document.getElementById('a3d-rec-body');
  if (!body) return;

  if (!results || !Array.isArray(results.recommendations) || !results.recommendations.length) {
    body.innerHTML = `<div id="no-rec" style="color:#666666; text-align:center; font-size:10px; text-transform:uppercase; letter-spacing:1px; margin:10px 0;">Run day range analysis to get recommendations</div>`;
    return;
  }

  const rows = results.recommendations.map((rec, idx) => `
    <div class="ds">
      <div class="ds-title">Rank ${idx + 1}: Day ${rec.day}</div>
      <div class="dr"><span class="dk">Best Time</span><span class="dv">${formatScanTime(rec.time)}</span></div>
      <div class="dr"><span class="dk">3D Efficiency</span><span class="dv">${rec.efficiency_pct.toFixed(2)}%</span></div>
      <div class="dr"><span class="dk">Peak Irradiance</span><span class="dv">${rec.peak_irr.toFixed(2)} W/m2</span></div>
      <div class="dr"><span class="dk">Solar Altitude</span><span class="dv">${rec.alt_deg.toFixed(1)}°</span></div>
      <div class="dr"><span class="dk">Profile Angle</span><span class="dv">${rec.prof_deg.toFixed(1)}°</span></div>
      <div class="dr"><span class="dk">Axial Walk-Off</span><span class="dv">${Number.isFinite(rec.axial_walkoff_m) ? rec.axial_walkoff_m.toFixed(2) + ' m' : 'Very large'}</span></div>
      <div class="dr"><span class="dk">Suggested Depth</span><span class="dv">${Number.isFinite(rec.suggested_depth_m) ? rec.suggested_depth_m.toFixed(2) + ' m' : 'Impractically large'}</span></div>
    </div>
  `).join('');

  body.innerHTML = `
    <div class="ds">
      <div class="ds-title">Day Range Recommendations</div>
      <div class="dr"><span class="dk">Range</span><span class="dv">Day ${results.day_start} to ${results.day_end}</span></div>
      <div class="dr"><span class="dk">Time Step</span><span class="dv">${results.time_step.toFixed(1)} h</span></div>
      <div class="dr"><span class="dk">Sample Rays</span><span class="dv">${results.sample_rays.toLocaleString()}</span></div>
      <div class="dr"><span class="dk">Mode</span><span class="dv">${results.sun_mode === 'profile2d' ? '2.5D Profile' : 'True 3D'}</span></div>
      <div class="dr"><span class="dk">Samples Evaluated</span><span class="dv">${results.samples_evaluated.toLocaleString()}</span></div>
    </div>
    ${rows}
  `;
}

async function runDayRangeAnalysis() {
  if (!A3D.simPayload) return alert("No sim state loaded.");

  const payload = {
    sim_state: A3D.simPayload,
    depth: parseFloat(document.getElementById('depth').value),
    bounces: parseInt(document.getElementById('bounces').value, 10),
    sun_mode: document.getElementById('sun-mode')?.value || 'true3d',
    day_start: parseInt(document.getElementById('day-start').value, 10),
    day_end: parseInt(document.getElementById('day-end').value, 10),
    time_step: parseFloat(document.getElementById('day-step').value),
  };

  const runButton = document.getElementById('btn-trace3d');
  const originalLabel = runButton ? runButton.textContent : '';
  if (runButton) {
    runButton.disabled = true;
    runButton.textContent = 'BUSY...';
  }
  beginRunStatus({ rays: 0, bounces: payload.bounces, depth: payload.depth });
  setRunStatusValues('Scanning day range', 0, 0, `${payload.day_start}-${payload.day_end}`);

  try {
    const res = await fetch('/analysis3d/day-range', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_err) {
      const looksLikeHtml = raw.trim().startsWith('<');
      if (looksLikeHtml) {
        throw new Error('The backend returned an HTML page instead of JSON. Restart the Flask server so the new /analysis3d/day-range route is loaded.');
      }
      throw new Error('The backend returned an invalid response for day-range analysis.');
    }
    if (data.error) throw new Error(data.error);

    A3D.dayRangeResults = data;
    renderDayRangePanel(data);
    persistAnalysisState();
  } catch (err) {
    console.error(err);
    alert('Day range analysis failed: ' + err.message);
  } finally {
    endRunStatus();
    if (runButton) runButton.textContent = originalLabel || 'Compute 3D Irradiance';
  }
}

function export3DCSV() {
  if (!A3D.lastIrrMap) return alert("Run compute first.");

  let csv = "Width_Index,Depth_Index,Irradiance_Wm2\n";
  for (let z = 0; z < A3D.z_bins; z++) {
    for (let w = 0; w < A3D.w_bins; w++) {
      csv += `${w},${z},${A3D.lastIrrMap[z][w].toFixed(4)}\n`;
    }
  }

  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = '3D_irradiance_map_' + Date.now() + '.csv';
  a.click();
}

function downloadHeatmapImage() {
  const canvas = document.getElementById('a3d-canvas');
  if (!canvas || !A3D.lastIrrMap) return alert("Run compute first.");

  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = '3D_irradiance_map_' + Date.now() + '.png';
  a.click();
}

window.loadSimState = loadSimState;
window.runTrace3D = runTrace3D;
window.runDayRangeAnalysis = runDayRangeAnalysis;
window.export3DCSV = export3DCSV;
window.setAnalysisView = setAnalysisView;
window.downloadHeatmapImage = downloadHeatmapImage;
