// datapanel.js — right side data panel

function renderDataPanel(s) {
  const body = document.getElementById('datapanel-body');
  if (!s) { body.innerHTML = '<div id="no-data">Run trace for metrics</div>'; return; }

  const eff = s.efficiency_pct;
  let effColor = '#ff4444';
  if (eff >= 70) effColor = '#00aaff';
  else if (eff >= 30) effColor = '#ffaa00';

  const circle = `<span style="display:inline-block;width:8px;height:8px;border-radius:50% !important;background:${effColor};margin-left:6px;vertical-align:middle;"></span>`;
  const row    = (k, v) => `<div class="dr"><span class="dk">${k}</span><span class="dv">${v}</span></div>`;

  let html = '';

  html += `<div class="ds"><div class="ds-title">Irradiance Info</div>
    ${row('Profile Angle',   s.sun_profile_deg + '°')}
    ${row('Effective DNI',   s.DNI_wm2 + ' W/m²  |  ' + (s.DNI_wm2 * 93).toFixed(0) + ' lm/m²')}
    ${row('Effective DHI',   s.DHI_wm2 + ' W/m²  |  ' + (s.DHI_wm2 * 93).toFixed(0) + ' lm/m²')}
    ${row('System GHI',      s.GHI_wm2 + ' W/m²  |  ' + (s.GHI_wm2 * 93).toFixed(0) + ' lm/m²')}
    ${row('Aperture Area',   s.collection_area_m2 + ' m²')}
  </div>`;

  html += `<div class="ds"><div class="ds-title">Power In</div>
    ${row('Total (GHI)',     s.power_in_total_w.toFixed(3) + ' W  |  ' + s.power_in_total_lm.toFixed(1) + ' lm')}
    ${row('DNI component',   s.power_in_dni_w.toFixed(3)   + ' W  |  ' + s.power_in_dni_lm.toFixed(1)   + ' lm')}
    ${row('DHI component',   s.power_in_dhi_w.toFixed(3)   + ' W  |  ' + s.power_in_dhi_lm.toFixed(1)   + ' lm')}
  </div>`;

  html += `<div class="ds"><div class="ds-title">Power Out</div>
    ${row('Output Power',    s.power_out_w.toFixed(3) + ' W  |  ' + s.power_out_lm.toFixed(1) + ' lm')}
    ${row('Total Loss',      s.total_loss_w.toFixed(3) + ' W  |  ' + s.total_loss_lm.toFixed(1) + ' lm')}
    <div class="dr"><span class="dk">Efficiency</span><span class="dv" style="display:flex;align-items:center;">${eff.toFixed(2)}% ${circle}</span></div>
    <div class="eff-bar-wrap"><div class="eff-bar" style="width:${Math.min(eff, 100)}%;"></div></div>
  </div>`;

  html += `<div class="ds"><div class="ds-title">Ray Statistics</div>
    ${row('Total Rays',      s.ray_count)}
    ${row('Alive (exit)',    s.alive_rays)}
    ${row('Dead (absorbed)', s.dead_rays)}
    ${row('Avg Bounces',     s.avg_bounces)}
  </div>`;

  html += `<div class="ds"><div class="ds-title">Beam Quality</div>
    ${row('Beam Spread',     s.beam_spread_deg.toFixed(3) + '°')}
    ${row('Exit Spread',     s.exit_spread_m.toFixed(4) + ' m')}
  </div>`;

  if (s.component_summary && s.component_summary.length > 0) {
    html += `<div class="ds"><div class="ds-title">Per Component Loss</div>
      <table class="comp-table">
        <tr><th>Comp</th><th>Hits</th><th>Loss W</th><th>Loss lm</th><th>%</th></tr>
        ${s.component_summary.map(c => `
          <tr>
            <td>${c.component}</td>
            <td>${c.hits}</td>
            <td>${c.loss_w}</td>
            <td>${c.loss_lm}</td>
            <td>${c.loss_pct}%</td>
          </tr>`).join('')}
      </table>
    </div>`;
  }

  body.innerHTML = html;
}
window.renderDataPanel = renderDataPanel;