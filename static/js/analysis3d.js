// analysis3d.js — 3D Monte Carlo Raytracer Frontend

const A3D = {
  simPayload: null,
  lastStats: null,
  lastIrrMap: null,
};

window.onload = () => {
  loadSimState();
};

// 1. Pull the 2D layout directly from the Simulator's local storage
function loadSimState() {
  const raw = localStorage.getItem('dls_sim');
  if (!raw) {
    alert("No simulation data found! Please build a setup in the Simulator first.");
    return;
  }
  A3D.simPayload = JSON.parse(raw);
  console.log("Synced with 2D Simulator:", A3D.simPayload);
}

// 2. Send the data to the heavy-duty Python 3D engine
async function runTrace3D() {
  if (!A3D.simPayload) return alert("No sim state loaded.");
  
  // Verify a filter exists (needed for the Heatmap floor)
  const hasFilter = A3D.simPayload.components.some(c => c.type === 'filter');
  if (!hasFilter) {
    alert("WARNING: You must add a 'Filter Line (Sensor)' in the 2D Simulator to act as the floor/workplane for the 3D Heatmap!");
    return;
  }

  const btn = document.getElementById('btn-trace3d');
  btn.textContent = '⏳ COMPUTING (MAY TAKE A MINUTE)...';
  btn.disabled = true;

  // Package the data exactly how tracer3d.py expects it
  const payload = {
    rays: parseFloat(document.getElementById('rays').value) * 1000000,
    bounces: parseInt(document.getElementById('bounces').value),
    depth: parseFloat(document.getElementById('depth').value),
    sim_state: A3D.simPayload // Send the whole saved state!
  };

  try {
    // We will build this route in server.py next!
    const res = await fetch('/trace3d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    
    if (data.error) throw new Error(data.error);

    A3D.lastStats = data.stats;
    A3D.lastIrrMap = data.irr_map;
    A3D.w_bins = data.w_bins;
    A3D.z_bins = data.z_bins;

    renderDataPanel(data.stats);
    renderHeatmap(data.irr_map, data.stats.peak_irr);

  } catch(err) {
    console.error(err);
    alert('Computation failed: ' + err.message);
  }

  btn.textContent = '▶ Compute 3D Irradiance';
  btn.disabled = false;
}

// 3. Draw the Heatmap Grid
function renderHeatmap(irrMap, peak) {
  const canvas = document.getElementById('a3d-canvas');
  const ctx = canvas.getContext('2d');
  
  // Size canvas appropriately based on bins
  const cellPx = 15; // 15 pixels per bin
  const wBins = irrMap[0].length;
  const zBins = irrMap.length;
  
  canvas.width = wBins * cellPx;
  canvas.height = zBins * cellPx;

  // Clear background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let z = 0; z < zBins; z++) {
    for (let w = 0; w < wBins; w++) {
      const val = irrMap[z][w];
      const norm = peak > 0 ? (val / peak) : 0;
      
      // Draw pixel
      ctx.fillStyle = getColorScale(norm);
      ctx.fillRect(w * cellPx, (zBins - 1 - z) * cellPx, cellPx, cellPx);
    }
  }

  // Show legend
  document.getElementById('heatmap-legend').style.display = 'flex';
  document.getElementById('legend-max').textContent = `${peak.toFixed(1)} W/m²`;
}

// Map 0.0-1.0 to a Black -> Blue -> Cyan -> White color scale
function getColorScale(t) {
  if (t <= 0) return '#000000';
  if (t < 0.33) return `rgb(0, 0, ${Math.floor(t * 3 * 255)})`; // Black to Blue
  if (t < 0.66) return `rgb(0, ${Math.floor((t-0.33) * 3 * 255)}, 255)`; // Blue to Cyan
  return `rgb(${Math.floor((t-0.66) * 3 * 255)}, 255, 255)`; // Cyan to White
}

function renderDataPanel(s) {
  const body = document.getElementById('a3d-data-body');
  const row = (k, v) => `<div class="dr"><span class="dk">${k}</span><span class="dv">${v}</span></div>`;
  
  let html = '';
  
  html += `<div class="ds"><div class="ds-title">3D Energy Transfer</div>
    ${row('Total Rays', s.rays_total.toLocaleString())}
    ${row('Power In', s.energy_in_w.toFixed(2) + ' W')}
    ${row('Power Captured', s.energy_cap_w.toFixed(2) + ' W')}
    ${row('3D Efficiency', s.efficiency_pct.toFixed(2) + '%')}
    ${row('Lost / Dead Rays', s.dead_rays.toLocaleString())}
  </div>`;

  html += `<div class="ds"><div class="ds-title">Workplane Metrics</div>
    ${row('Peak Irradiance', s.peak_irr.toFixed(1) + ' W/m²')}
    ${row('Average Irradiance', s.avg_irr.toFixed(1) + ' W/m²')}
    ${row('Uniformity (Min/Max)', s.uniformity.toFixed(1) + '%')}
  </div>`;

  body.innerHTML = html;
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

// ── GLOBAL EXPORTS ──
window.loadSimState = loadSimState;
window.runTrace3D   = runTrace3D;
window.export3DCSV  = export3DCSV;