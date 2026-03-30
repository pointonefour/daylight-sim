from flask import Flask, request, jsonify, send_from_directory
import numpy as np
import os, sys

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from components.parabolic import ParabolicMirror
from raytracer.rays import Ray

app = Flask(__name__, static_folder='static')

DAYLIGHT_EFFICACY = 93.0

# Temporary in-memory store for workbench exports
_workbench_store = {'mirrors': [], 'hinges': []}

# ── WORKBENCH ROUTES ──────────────────────────────────────
@app.route('/workbench')
def workbench():
    return send_from_directory('static', 'workbench.html')

@app.route('/workbench/export', methods=['POST'])
def workbench_export():
    """
    Receives the full export payload from workbench:
    {
      mirrors: [ { wbMirrorId, type, definition, transform, assemblyId, parentHingeId } ],
      hinges:  [ { wbHingeId, compAWbId, pointA, compBWbId, pointB } ]
    }
    """
    data = request.json
    _workbench_store['mirrors'] = data.get('mirrors', [])
    _workbench_store['hinges']  = data.get('hinges',  [])
    return jsonify({'status': 'ok', 'count': len(_workbench_store['mirrors'])})

@app.route('/workbench/load', methods=['GET'])
def workbench_load():
    """Main sim fetches mirrors and hinges together."""
    return jsonify({
        'mirrors': _workbench_store.get('mirrors', []),
        'hinges':  _workbench_store.get('hinges',  []),
    })

@app.route('/workbench/clear', methods=['POST'])
def workbench_clear():
    _workbench_store['mirrors'] = []
    _workbench_store['hinges']  = []
    return jsonify({'status': 'ok'})

@app.route('/workbench/compute', methods=['POST'])
def workbench_compute():
    """
    Compute all derived parameters for a mirror definition.
    Receives mirror params, returns full CAD datasheet.
    """
    data     = request.json
    mtype    = data.get('type', 'parabolic')
    result   = {}

    if mtype == 'parabolic':
        result = compute_parabolic(data)
    elif mtype == 'flat':
        result = compute_flat(data)
    elif mtype == 'cpc':
        result = compute_cpc(data)

    return jsonify(result)


# ── PARABOLIC COMPUTATIONS ────────────────────────────────
def compute_parabolic(d):
    f           = d.get('focal_length', 0.5)
    D           = d.get('aperture', 0.8)
    trim_start  = d.get('trim_start', 0.0)   # 0-1 normalized
    trim_end    = d.get('trim_end',   1.0)
    mfg         = d.get('manufacturing', 'stamped_aluminium')
    material    = d.get('material', 'aluminium')
    roughness   = d.get('roughness_ra_um', 0.4)
    slope_err   = d.get('slope_error_mrad', 2.0)
    pv_error    = d.get('pv_error_um', 10.0)
    reflectivity= d.get('reflectivity', 0.92)
    point_count = d.get('point_count', 75)
    origin_type = d.get('origin', 'vertex')  # vertex | left_tip | right_tip | focal | custom
    substrate_t = d.get('substrate_thickness_mm', 2.0)

    # Full x range
    x_full = np.linspace(-D/2, D/2, 1000)

    # Trim bounds in x
    x_start = -D/2 + trim_start * D
    x_end   = -D/2 + trim_end   * D

    # Trimmed x range
    x_trim = np.linspace(x_start, x_end, point_count)
    y_trim = x_trim**2 / (4*f)

    # Key points
    tip_left  = (x_start, x_start**2 / (4*f))
    tip_right = (x_end,   x_end**2   / (4*f))
    vertex    = (0.0, 0.0)
    focal_pt  = (0.0, f)

    # Origin point
    if   origin_type == 'vertex':    origin = vertex
    elif origin_type == 'left_tip':  origin = tip_left
    elif origin_type == 'right_tip': origin = tip_right
    elif origin_type == 'focal':     origin = focal_pt
    else:                            origin = vertex  # fallback

    # Geometric properties
    chord_dx  = tip_right[0] - tip_left[0]
    chord_dy  = tip_right[1] - tip_left[1]
    chord_len = np.sqrt(chord_dx**2 + chord_dy**2)

    # Arc length (numerical integration)
    dx_arr = np.diff(x_trim)
    dy_arr = np.diff(y_trim)
    arc_len = float(np.sum(np.sqrt(dx_arr**2 + dy_arr**2)))

    # Sagitta (max depth from chord)
    # Midpoint of chord
    mx = (tip_left[0] + tip_right[0]) / 2
    my = (tip_left[1] + tip_right[1]) / 2
    # Vertex of trimmed arc (point on curve at midpoint x of trim range)
    mid_x  = (x_start + x_end) / 2
    mid_y  = mid_x**2 / (4*f)
    sagitta = abs(mid_y - my)

    # Width and height of bounding box
    width_bb  = abs(tip_right[0] - tip_left[0])
    height_bb = abs(tip_right[1] - tip_left[1])

    # Rim angle at each tip
    def rim_angle(x, f):
        return np.degrees(np.arctan(abs(x) / (2*f)))

    rim_left  = rim_angle(x_start, f)
    rim_right = rim_angle(x_end,   f)

    # Radius of curvature at vertex
    roc_vertex = 2 * f

    # Tangent angles at tips (for join planning)
    def tangent_angle_deg(x, f):
        dydx = x / (2*f)
        return np.degrees(np.arctan(dydx))

    tang_left  = tangent_angle_deg(x_start, f)
    tang_right = tangent_angle_deg(x_end,   f)

    # f/D ratio (effective aperture)
    eff_D = abs(x_end - x_start)
    fd_ratio = f / eff_D if eff_D > 0 else 0

    # Manufacturing point count recommendation
    tol_map = {'stamped_aluminium': 0.5, 'cnc': 0.05, 'sheet_metal': 1.0, '3d_print': 0.1}
    tol_mm  = tol_map.get(mfg, 0.5)

    # Minimum segments: segment_len < sqrt(8 * R_min * tol)
    R_min      = 2 * f * 1000  # convert m to mm
    max_seg_mm = np.sqrt(8 * R_min * tol_mm)
    arc_mm     = arc_len * 1000
    min_pts    = int(np.ceil(arc_mm / max_seg_mm)) + 1
    recommended_pts = max(50, min(100, min_pts))

    # Reflectivity at visible wavelengths (simple model)
    refl_map = {
        'aluminium':         {'550nm': 0.91, 'avg_vis': 0.89},
        'enhanced_aluminium':{'550nm': 0.95, 'avg_vis': 0.94},
        'silver':            {'550nm': 0.98, 'avg_vis': 0.97},
        'gold':              {'550nm': 0.70, 'avg_vis': 0.82},
        'polished_steel':    {'550nm': 0.65, 'avg_vis': 0.63},
    }
    refl_data = refl_map.get(material, {'550nm': reflectivity, 'avg_vis': reflectivity})

    # Point table (3D, z=0)
    point_table = [
        {'x': round(float(x_trim[i]), 6),
         'y': round(float(y_trim[i]), 6),
         'z': 0.0}
        for i in range(len(x_trim))
    ]

    return {
        'type': 'parabolic',
        'equation': f'y = x² / {round(4*f, 6)}  (i.e. y = x² / 4f, f = {f} m)',
        'focal_length_m':      f,
        'full_aperture_m':     D,
        'effective_aperture_m': round(eff_D, 6),
        'fd_ratio':            round(fd_ratio, 4),
        'trim_start_norm':     trim_start,
        'trim_end_norm':       trim_end,
        'trim_x_start_m':      round(x_start, 6),
        'trim_x_end_m':        round(x_end,   6),
        'tip_left':            {'x': round(tip_left[0],  6), 'y': round(tip_left[1],  6), 'z': 0.0},
        'tip_right':           {'x': round(tip_right[0], 6), 'y': round(tip_right[1], 6), 'z': 0.0},
        'vertex':              {'x': 0.0, 'y': 0.0, 'z': 0.0},
        'focal_point':         {'x': 0.0, 'y': round(f, 6), 'z': 0.0},
        'origin_point':        {'x': round(origin[0], 6), 'y': round(origin[1], 6), 'z': 0.0},
        'origin_type':         origin_type,
        'chord_length_m':      round(chord_len, 6),
        'arc_length_m':        round(arc_len,   6),
        'sagitta_m':           round(sagitta,   6),
        'bounding_box_w_m':    round(width_bb,  6),
        'bounding_box_h_m':    round(height_bb, 6),
        'radius_of_curvature_vertex_m': round(roc_vertex, 6),
        'rim_angle_left_deg':  round(rim_left,  4),
        'rim_angle_right_deg': round(rim_right, 4),
        'tangent_angle_left_tip_deg':  round(tang_left,  4),
        'tangent_angle_right_tip_deg': round(tang_right, 4),
        'material':            material,
        'reflectivity_550nm':  refl_data['550nm'],
        'reflectivity_avg_vis':refl_data['avg_vis'],
        'roughness_ra_um':     roughness,
        'substrate_thickness_mm': substrate_t,
        'manufacturing_method':  mfg,
        'slope_error_mrad':      slope_err,
        'slope_error_arcmin':    round(slope_err * 60 / (2*np.pi) * (360/60), 4),
        'pv_form_error_um':      pv_error,
        'tolerance_mm':          tol_mm,
        'recommended_points':    recommended_pts,
        'point_count_used':      point_count,
        'point_table': point_table
    }


# ── FLAT MIRROR COMPUTATIONS ──────────────────────────────
def compute_flat(d):
    width       = d.get('width', 0.6)
    reflectivity= d.get('reflectivity', 0.92)
    material    = d.get('material', 'aluminium')
    roughness   = d.get('roughness_ra_um', 0.4)
    slope_err   = d.get('slope_error_mrad', 1.0)
    substrate_t = d.get('substrate_thickness_mm', 2.0)
    point_count = d.get('point_count', 50)
    origin_type = d.get('origin', 'center')

    tip_left  = (-width/2, 0.0)
    tip_right = ( width/2, 0.0)
    origin    = (0.0, 0.0) if origin_type == 'center' else \
                tip_left   if origin_type == 'left_tip' else tip_right

    x_pts = np.linspace(-width/2, width/2, point_count)
    point_table = [{'x': round(float(x), 6), 'y': 0.0, 'z': 0.0} for x in x_pts]

    refl_map = {
        'aluminium': {'550nm': 0.91, 'avg_vis': 0.89},
        'silver':    {'550nm': 0.98, 'avg_vis': 0.97},
    }
    refl_data = refl_map.get(material, {'550nm': reflectivity, 'avg_vis': reflectivity})

    return {
        'type':               'flat',
        'width_m':            width,
        'normal_vector':      {'x': 0.0, 'y': 1.0, 'z': 0.0},
        'tip_left':           {'x': tip_left[0],  'y': 0.0, 'z': 0.0},
        'tip_right':          {'x': tip_right[0], 'y': 0.0, 'z': 0.0},
        'origin_point':       {'x': round(origin[0], 6), 'y': round(origin[1], 6), 'z': 0.0},
        'origin_type':        origin_type,
        'arc_length_m':       width,
        'chord_length_m':     width,
        'material':           material,
        'reflectivity_550nm': refl_data['550nm'],
        'reflectivity_avg_vis': refl_data['avg_vis'],
        'roughness_ra_um':    roughness,
        'slope_error_mrad':   slope_err,
        'substrate_thickness_mm': substrate_t,
        'point_count_used':   point_count,
        'point_table':        point_table
    }

# ── CPC COMPUTATIONS ──────────────────────────────────────
def compute_cpc(d):
    acceptance_angle = d.get('acceptance_angle', 30)
    aperture         = d.get('aperture', 0.6)
    reflectivity     = d.get('reflectivity', 0.90)
    material         = d.get('material', 'aluminium')
    roughness        = d.get('roughness_ra_um', 0.4)
    slope_err        = d.get('slope_error_mrad', 2.0)
    substrate_t      = d.get('substrate_thickness_mm', 2.0)
    point_count      = d.get('point_count', 75)
    truncation       = d.get('truncation_factor', 1.0)

    r    = aperture / 2
    th   = np.radians(acceptance_angle)
    npts = point_count

    CR = 1.0 / np.sin(th)
    receiver_w = aperture * np.sin(th)
    full_height = r * (1 + 1/np.sin(th)) * np.cos(th)
    trunc_height = full_height * truncation

    t_max = np.pi/2 + th
    tvs   = np.linspace(0, t_max * truncation, npts)
    xs_r  =  r*(1+np.sin(tvs))*np.cos(tvs)/(1+np.sin(th))
    ys_r  =  r*(1+np.sin(tvs))*np.sin(tvs)/(1+np.sin(th)) - r
    xs_l  = -xs_r
    ys_l  =  ys_r

    dx_arr = np.diff(xs_r); dy_arr = np.diff(ys_r)
    arc_len_one = float(np.sum(np.sqrt(dx_arr**2 + dy_arr**2)))

    right_pts = [{'x': round(float(xs_r[i]), 6), 'y': round(float(ys_r[i]), 6), 'z': 0.0} for i in range(npts)]
    left_pts  = [{'x': round(float(xs_l[i]), 6), 'y': round(float(ys_l[i]), 6), 'z': 0.0} for i in range(npts)]

    refl_map = {
        'aluminium': {'550nm': 0.91, 'avg_vis': 0.89},
        'silver':    {'550nm': 0.98, 'avg_vis': 0.97},
    }
    refl_data = refl_map.get(material, {'550nm': reflectivity, 'avg_vis': reflectivity})

    return {
        'type':                  'cpc',
        'acceptance_half_angle_deg': acceptance_angle,
        'aperture_m':            aperture,
        'receiver_width_m':      round(receiver_w, 6),
        'concentration_ratio_2d': round(CR, 4),
        'full_height_m':         round(full_height, 6),
        'truncated_height_m':    round(trunc_height, 6),
        'truncation_factor':     truncation,
        'arc_length_one_arm_m':  round(arc_len_one, 6),
        'tip_left':              {'x': round(float(xs_l[-1]), 6), 'y': round(float(ys_l[-1]), 6), 'z': 0.0},
        'tip_right':             {'x': round(float(xs_r[-1]), 6), 'y': round(float(ys_r[-1]), 6), 'z': 0.0},
        'receiver_left':         {'x': round(float(xs_l[0]),  6), 'y': round(float(ys_l[0]),  6), 'z': 0.0},
        'receiver_right':        {'x': round(float(xs_r[0]),  6), 'y': round(float(ys_r[0]),  6), 'z': 0.0},
        'material':              material,
        'reflectivity_550nm':    refl_data['550nm'],
        'reflectivity_avg_vis':  refl_data['avg_vis'],
        'roughness_ra_um':       roughness,
        'slope_error_mrad':      slope_err,
        'substrate_thickness_mm':substrate_t,
        'point_count_used':      point_count,
        'point_table_right_arm': right_pts,
        'point_table_left_arm':  left_pts
    }

# ── SOLAR POSITION MODEL ──────────────────────────────────
class SolarModel:
    def __init__(self, lat, day, time_h, sys_az):
        self.lat = np.radians(lat)
        self.day = day
        self.time_h = time_h
        self.sys_az = sys_az
        decl_deg = 23.45 * np.sin(np.radians(360.0/365.0 * (day - 81)))
        self.decl = np.radians(decl_deg)
        self.ha = np.radians(15.0 * (time_h - 12.0))
        sin_alt = np.sin(self.lat)*np.sin(self.decl) + np.cos(self.lat)*np.cos(self.decl)*np.cos(self.ha)
        self.alt = np.arcsin(np.clip(sin_alt, -1.0, 1.0))
        self.alt_deg = np.degrees(self.alt)
        cos_az = (np.sin(self.decl) - np.sin(self.lat)*np.sin(self.alt)) / (np.cos(self.lat)*np.cos(self.alt) + 1e-9)
        az_deg = np.degrees(np.arccos(np.clip(cos_az, -1.0, 1.0)))
        if self.ha > 0: az_deg = 360.0 - az_deg
        self.az_deg = az_deg
        self.rel_az = np.radians(self.az_deg - self.sys_az)
        self.is_night = self.alt_deg <= 0
        self.prof_deg = 0; self.cos_loss = 0; self.dni_factor = 0
        if not self.is_night:
            prof_rad = np.arctan2(np.tan(self.alt), np.cos(self.rel_az))
            if prof_rad < 0: prof_rad += np.pi
            self.prof_deg = np.degrees(prof_rad)
            self.cos_loss = abs(np.cos(self.rel_az))
            am = 1.0 / (np.sin(self.alt) + 0.50572 * (self.alt_deg + 6.07995)**(-1.6364))
            self.dni_factor = 0.7 ** (am ** 0.678)

    def get_ray_direction(self):
        rad = np.radians(self.prof_deg)
        return np.array([np.cos(rad), -np.sin(rad)])

# ── MAIN SIM ROUTES ───────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/trace', methods=['POST'])
def trace():
    data         = request.json
    lat          = data['sun'].get('latitude', 45)
    day          = data['sun'].get('day', 172)
    time_h       = data['sun'].get('time', 12)
    sys_az       = data['sun'].get('sys_azimuth', 180)
    base_dni     = data['sun'].get('DNI', 900)
    base_dhi     = data['sun'].get('DHI', 150)
    sol = SolarModel(lat, day, time_h, sys_az)
    if sol.is_night:
        return jsonify({'ray_paths': [], 'ray_energies': [], 'stats': None})
    
    ray_count    = data.get('ray_count', 100)
    components   = data.get('components', [])
    source_y     = data.get('source_y', 3.0)
    source_x     = data.get('source_x', 0.0)
    source_width = data.get('source_width', 3.0)
    source_rot   = np.radians(data.get('source_rotation', 0.0))  
    max_bounces  = data.get('max_bounces', 12)
    
    direction    = sol.get_ray_direction()
    ray_paths    = []; ray_energies = []
    collection_area = source_width * 1.0
    eff_dni = base_dni * sol.dni_factor * sol.cos_loss
    eff_dhi = base_dhi
    ghi = eff_dni + eff_dhi
    power_in_dni = eff_dni * collection_area
    power_in_dhi = eff_dhi * collection_area
    power_in_total = ghi * collection_area
    comp_names = [f"{c['type']}_{i}" for i,c in enumerate(components)]
    comp_hits = {n: 0 for n in comp_names}
    comp_loss_w = {n: 0.0 for n in comp_names}
    bounce_log = []
    total_energy_out = 0.0; total_energy_in = 0.0; dead_rays = 0; total_bounces = 0
    exit_positions = []; exit_dirs = []
    energy_per_ray = power_in_total / ray_count if ray_count > 0 else 0
    
    for i in range(ray_count):
        x_offset = -source_width/2 + (i / max(ray_count-1,1)) * source_width
        rx = x_offset * np.cos(source_rot)
        ry = x_offset * np.sin(source_rot)
        x_start = source_x + rx
        y_start = source_y + ry
        
        ray = Ray([x_start, y_start], direction.tolist(), energy_per_ray)
        total_energy_in += energy_per_ray
        bounce_num = 0; escaped = False
        
        for _ in range(max_bounces):
            if not ray.alive: break
            hit = find_nearest_hit(ray, components)
            if hit is None: escaped = True; break
            e_before = ray.energy
            apply_hit(ray, hit)
            e_after = getattr(ray, 'capture_energy', ray.energy) if ray.alive or getattr(ray, 'captured', False) else 0.0
            loss_w = e_before - e_after
            bounce_num += 1; total_bounces += 1
            comp_idx = hit.get('comp_idx', -1)
            comp_name = comp_names[comp_idx] if 0 <= comp_idx < len(comp_names) else 'unknown'
            comp_hits[comp_name] = comp_hits.get(comp_name, 0) + 1
            comp_loss_w[comp_name] = comp_loss_w.get(comp_name, 0.0) + loss_w
            bounce_log.append({'ray': i, 'bounce': bounce_num, 'component': comp_name,
                'energy_before_w': round(e_before,6), 'energy_after_w': round(e_after,6),
                'loss_w': round(loss_w,6), 'loss_pct': round(100*loss_w/e_before if e_before>0 else 0,2),
                'aoi_deg': round(hit.get('aoi_deg',0),2)})
                
        has_filter = any(c['type'] == 'filter' for c in components)
        
        if getattr(ray, 'captured', False):
            # Hit filter
            total_energy_out += getattr(ray, 'capture_energy', ray.energy)
            exit_positions.append(ray.origin.tolist())
            exit_dirs.append(ray.direction.tolist())
        elif ray.alive and escaped:
            if not has_filter:
                # No filter, count escaped as output
                ray.propagate(8.0)
                total_energy_out += ray.energy
                exit_positions.append(ray.origin.tolist())
                exit_dirs.append(ray.direction.tolist())
            else:
                # Missed filter, dies
                ray.kill()
                dead_rays += 1
        else:
            if ray.alive: ray.kill()
            dead_rays += 1
            
        ray_paths.append([[float(p[0]),float(p[1])] for p in ray.history])
        
        # ONLY APPEND 0 IF IT IS ACTUALLY DEAD (Not captured)
        is_valid = ray.alive or getattr(ray, 'captured', False)
        ray_energies.append(float(getattr(ray, 'capture_energy', ray.energy) if is_valid else 0.0))
        
    beam_spread_deg = 0.0
    if len(exit_dirs) > 1:
        dirs = np.array(exit_dirs); mean_dir = dirs.mean(axis=0); mean_dir /= np.linalg.norm(mean_dir)
        angles = [np.degrees(np.arccos(np.clip(np.dot(d/np.linalg.norm(d),mean_dir),-1,1))) for d in dirs]
        beam_spread_deg = float(np.std(angles))
        
    exit_spread_m = 0.0
    if len(exit_positions) > 1:
        pos = np.array(exit_positions); exit_spread_m = float(np.std(pos[:,0]))
        
    efficiency_pct = 100 * total_energy_out / total_energy_in if total_energy_in > 0 else 0
    total_loss_w = total_energy_in - total_energy_out
    comp_summary = []
    
    for n in comp_names:
        hits = comp_hits.get(n,0); lw = comp_loss_w.get(n,0.0)
        comp_summary.append({'component':n,'hits':hits,'loss_w':round(lw,4),
            'loss_lm':round(lw*DAYLIGHT_EFFICACY,2),'loss_pct':round(100*lw/total_energy_in if total_energy_in>0 else 0,2)})
            
    stats = {
        'sun_profile_deg': round(sol.prof_deg,2), 'DNI_wm2': round(eff_dni,2),
        'DHI_wm2': round(eff_dhi,2), 'GHI_wm2': round(ghi,2),
        'collection_area_m2': round(collection_area,4),
        'power_in_total_w': round(power_in_total,4), 'power_in_total_lm': round(power_in_total*DAYLIGHT_EFFICACY,2),
        'power_in_dni_w': round(power_in_dni,4), 'power_in_dni_lm': round(power_in_dni*DAYLIGHT_EFFICACY,2),
        'power_in_dhi_w': round(power_in_dhi,4), 'power_in_dhi_lm': round(power_in_dhi*DAYLIGHT_EFFICACY,2),
        'power_out_w': round(total_energy_out,4), 'power_out_lm': round(total_energy_out*DAYLIGHT_EFFICACY,2),
        'total_loss_w': round(total_loss_w,4), 'total_loss_lm': round(total_loss_w*DAYLIGHT_EFFICACY,2),
        'efficiency_pct': round(efficiency_pct,2), 'ray_count': ray_count,
        'dead_rays': dead_rays, 'alive_rays': ray_count-dead_rays,
        'avg_bounces': round(total_bounces/ray_count,2) if ray_count>0 else 0,
        'beam_spread_deg': round(beam_spread_deg,3), 'exit_spread_m': round(exit_spread_m,4),
        'component_summary': comp_summary, 'bounce_log': bounce_log
    }
    return jsonify({'ray_paths': ray_paths, 'ray_energies': ray_energies, 'stats': stats})

# ── RAY TRACE HELPERS ─────────────────────────────────────
def find_nearest_hit(ray, components):
    best = None; best_t = float('inf')
    for idx, comp in enumerate(components):
        result = test_component(ray, comp)
        if result is not None and result['t'] < best_t:
            best_t = result['t']; best = result; best['comp_idx'] = idx
    return best

def apply_hit(ray, hit):
    ray.propagate(hit['t'])
    if hit['type'] == 'reflect':
        ray.redirect(reflect(ray.direction, hit['normal']), hit['energy_mult'])
    elif hit['type'] == 'absorb':
        ray.kill()
    elif hit['type'] == 'filter':         
        setattr(ray, 'captured', True)
        setattr(ray, 'capture_energy', ray.energy)  # Snapshot energy!
        ray.kill()                                  # Stop it at the sensor line!
    elif hit['type'] == 'refract':
        ray.energy *= hit['energy_mult']
        new_d = np.array(hit['new_dir'], dtype=float)
        ray.direction = new_d / np.linalg.norm(new_d)
        ray.origin = ray.origin + ray.direction * 0.012
        ray.history.append(ray.origin.copy())
    elif hit['type'] == 'transmit':
        ray.energy *= hit['energy_mult']

def reflect(ray_dir, normal):
    n = np.array(normal, dtype=float); n /= np.linalg.norm(n)
    if np.dot(ray_dir, n) > 0: n = -n
    r = ray_dir - 2*np.dot(ray_dir, n)*n
    return r / np.linalg.norm(r)

def rot2d(x, y, a):
    return x*np.cos(a)-y*np.sin(a), x*np.sin(a)+y*np.cos(a)

def fresnel_transmission(cos_i, n1, n2):
    sin_t_sq = (n1/n2)**2 * max(0, 1-cos_i**2)
    if sin_t_sq >= 1.0: return 0.0
    cos_t = np.sqrt(1-sin_t_sq)
    rs = ((n1*cos_i - n2*cos_t)/(n1*cos_i + n2*cos_t))**2
    rp = ((n2*cos_i - n1*cos_t)/(n2*cos_i + n1*cos_t))**2
    return 1 - (rs+rp)/2

def snell_refract(ray_dir, normal, n1, n2):
    n = np.array(normal, dtype=float); n /= np.linalg.norm(n)
    if np.dot(ray_dir, n) > 0: n = -n
    cos_i = -np.dot(ray_dir, n); ratio = n1/n2
    sin_t_sq = ratio**2 * max(0, 1-cos_i**2)
    if sin_t_sq >= 1.0: return None
    cos_t = np.sqrt(1-sin_t_sq)
    r = ratio*ray_dir + (ratio*cos_i - cos_t)*n
    return r / np.linalg.norm(r)

def drf_efficiency(aoi_deg):
    if 18 <= aoi_deg <= 35: return 1.0
    elif aoi_deg < 18: return max(0.3, 0.3 + 0.7*(aoi_deg/18))
    else: return max(0.2, 1.0 - 0.02*(aoi_deg-35))

def test_filter(ray, comp):
    width = comp.get('width', 3.0)
    pos = comp.get('position', [0, 0])
    rot = np.radians(comp.get('rotation', 0))
    
    # Normal points "up" locally. Arrow points "down".
    normal = np.array([-np.sin(rot), np.cos(rot)])
    center = np.array(pos)
    along = np.array([np.cos(rot), np.sin(rot)])
    
    dot = np.dot(ray.direction, normal)
    if abs(dot) < 1e-6: return None
    
    t = np.dot(center - ray.origin, normal) / dot
    if t <= 0.01: return None
    
    hit_pt = ray.origin + t * ray.direction
    if abs(np.dot(hit_pt - center, along)) > width / 2: return None
    
    # Only capture rays travelling exactly opposite to the normal (in direction of the UI arrow)
    if dot > 0: return None
    
    return {'t': t, 'normal': normal, 'type': 'filter', 'energy_mult': 1.0, 'aoi_deg': 0}    

def test_component(ray, comp):
    t = comp['type']
    if   t == 'parabolic': return test_parabolic(ray, comp)
    elif t == 'flat':      return test_flat(ray, comp)
    elif t == 'cpc':       return test_cpc(ray, comp)
    elif t == 'glass':     return test_glass(ray, comp)
    elif t == 'filter':    return test_filter(ray, comp)
    return None

def test_parabolic(ray, comp):
    f            = comp.get('focal_length', 0.5)
    D            = comp.get('aperture', 0.8)
    reflectivity = comp.get('reflectivity', 0.92)
    slope_error  = comp.get('slope_error', 0.2)
    pos          = comp.get('position', [0, 0])
    rot_deg      = comp.get('rotation', 0)
    rot          = np.radians(rot_deg)
    trim_start   = comp.get('trim_start', 0.0)
    trim_end     = comp.get('trim_end',   1.0)
    olx          = comp.get('origin_offset_x', 0.0)
    oly          = comp.get('origin_offset_y', 0.0)
    mirror       = ParabolicMirror(f, D, reflectivity, slope_error)
    x_start = -D/2 + trim_start * D
    x_end   = -D/2 + trim_end   * D
    n_pts   = 300
    xs      = np.linspace(x_start, x_end, n_pts)
    ys      = xs**2 / (4*f)
    best_t = None; best_n = None; best_dist = 0.02
    for mx, my in zip(xs, ys):
        dx = mx - olx
        dy = my - oly
        rx = dx*np.cos(rot) - dy*np.sin(rot)
        ry = dx*np.sin(rot) + dy*np.cos(rot)
        rx += pos[0]; ry += pos[1]
        mp = np.array([rx, ry])
        to_m = mp - ray.origin
        t    = np.dot(to_m, ray.direction)
        if t <= 0.01: continue
        dist = np.linalg.norm(ray.origin + t*ray.direction - mp)
        if dist < best_dist:
            dydx = mx/(2*f)
            tang = np.array([1.0, dydx]); tang /= np.linalg.norm(tang)
            loc_n = np.array([-tang[1], tang[0]])
            nx = loc_n[0]*np.cos(rot) - loc_n[1]*np.sin(rot)
            ny = loc_n[0]*np.sin(rot) + loc_n[1]*np.cos(rot)
            wn = np.array([nx, ny])
            if np.dot(ray.direction, wn) >= 0: continue
            best_dist = dist; best_t = t; best_n = wn
    if best_t is None: return None
    if slope_error > 0:
        err = np.random.normal(0, np.radians(slope_error))
        c, s = np.cos(err), np.sin(err)
        best_n = np.array([c*best_n[0]-s*best_n[1], s*best_n[0]+c*best_n[1]])
    n = best_n/np.linalg.norm(best_n)
    if np.dot(ray.direction, n) > 0: n = -n
    aoi = np.degrees(np.arccos(np.clip(-np.dot(ray.direction, n), -1, 1)))
    return {'t': best_t, 'normal': best_n, 'type': 'reflect', 'energy_mult': reflectivity, 'aoi_deg': aoi}

def test_flat(ray, comp):
    width        = comp.get('width', 0.6)
    reflectivity = comp.get('reflectivity', 0.92)
    pos          = comp.get('position', [0, 0])
    rot_deg      = comp.get('rotation', 0)
    rot          = np.radians(rot_deg)
    trim_start   = comp.get('trim_start', 0.0)
    trim_end     = comp.get('trim_end',   1.0)
    olx          = comp.get('origin_offset_x', 0.0)
    oly          = comp.get('origin_offset_y', 0.0)
    x_start = -width/2 + trim_start * width
    x_end   = -width/2 + trim_end   * width
    normal = np.array([-np.sin(rot), np.cos(rot)])
    local_cx = (x_start + x_end) / 2
    dx = local_cx - olx; dy = 0.0 - oly
    rx = dx*np.cos(rot) - dy*np.sin(rot) + pos[0]
    ry = dx*np.sin(rot) + dy*np.cos(rot) + pos[1]
    center = np.array([rx, ry])
    along = np.array([np.cos(rot), np.sin(rot)])
    half_len = (x_end - x_start) / 2
    dot = np.dot(ray.direction, normal)
    if abs(dot) < 1e-6: return None
    t = np.dot(center - ray.origin, normal) / dot
    if t <= 0.01: return None
    hit_pt = ray.origin + t*ray.direction
    if abs(np.dot(hit_pt - center, along)) > half_len: return None
    if dot > 0: return {'t': t, 'type': 'absorb', 'normal': normal, 'energy_mult': 0, 'aoi_deg': 0}
    aoi = np.degrees(np.arccos(np.clip(-dot, -1, 1)))
    return {'t': t, 'normal': normal, 'type': 'reflect', 'energy_mult': reflectivity, 'aoi_deg': aoi}

def test_cpc(ray, comp):
    acceptance_angle=comp.get('acceptance_angle',30); aperture=comp.get('aperture',0.6)
    reflectivity=comp.get('reflectivity',0.90); pos=comp.get('position',[0,0])
    rot=np.radians(comp.get('rotation',0))
    r=aperture/2; th=np.radians(acceptance_angle); npts=150
    tvs=np.linspace(0,np.pi/2+th,npts)
    xs=r*(1+np.sin(tvs))*np.cos(tvs)/(1+np.sin(th))
    ys=r*(1+np.sin(tvs))*np.sin(tvs)/(1+np.sin(th))-r
    axs=np.concatenate([xs,-xs]); ays=np.concatenate([ys,ys])
    aidx=list(range(npts))+list(range(npts)); asides=[1]*npts+[-1]*npts
    best_t=None; best_n=None; best_dist=0.02
    for idx in range(len(axs)):
        rx,ry=rot2d(axs[idx],ays[idx],rot); rx+=pos[0]; ry+=pos[1]; mp=np.array([rx,ry])
        to_m=mp-ray.origin; t=np.dot(to_m,ray.direction)
        if t<=0.01: continue
        dist=np.linalg.norm(ray.origin+t*ray.direction-mp)
        if dist<best_dist:
            i=max(1,min(npts-2,aidx[idx])); dx=xs[i+1]-xs[i-1]; dy=ys[i+1]-ys[i-1]
            dx*=asides[idx]; tang=np.array([dx,dy]); tang/=np.linalg.norm(tang)
            loc_n=np.array([-tang[1],tang[0]]); nx,ny=rot2d(loc_n[0],loc_n[1],rot)
            best_dist=dist; best_t=t; best_n=np.array([nx,ny])
    if best_t is None: return None
    n=best_n/np.linalg.norm(best_n)
    if np.dot(ray.direction,n)>0: n=-n
    aoi=np.degrees(np.arccos(np.clip(-np.dot(ray.direction,n),-1,1)))
    return {'t':best_t,'normal':best_n,'type':'reflect','energy_mult':reflectivity,'aoi_deg':aoi}

def test_glass(ray, comp):
    width=comp.get('width',0.6); ior=comp.get('ior',1.50)
    transmission=comp.get('transmission',0.92); has_drf=comp.get('has_drf',1)
    pos=comp.get('position',[0,0]); rot=np.radians(comp.get('rotation',0))
    normal=np.array([-np.sin(rot),np.cos(rot)]); center=np.array(pos); along=np.array([np.cos(rot),np.sin(rot)])
    denom=np.dot(ray.direction,normal)
    if abs(denom)<1e-6: return None
    t=np.dot(center-ray.origin,normal)/denom
    if t<=0.01: return None
    hit=ray.origin+t*ray.direction
    if abs(np.dot(hit-center,along))>width/2: return None
    n=normal.copy()
    if np.dot(ray.direction,n)>0: n=-n
    cos_i=abs(np.dot(ray.direction,n))
    aoi_deg=np.degrees(np.arccos(np.clip(cos_i,0,1)))
    fresnel_t=fresnel_transmission(cos_i,1.0,ior)
    drf_mult=drf_efficiency(aoi_deg) if has_drf else 1.0
    total_mult=fresnel_t*transmission*drf_mult
    refracted_dir=snell_refract(ray.direction,normal,1.0,ior)
    if refracted_dir is None:
        return {'t':t,'type':'reflect','normal':normal,'energy_mult':0.05,'aoi_deg':aoi_deg}
    exit_dir=snell_refract(refracted_dir,-normal,ior,1.0)
    if exit_dir is None: exit_dir=refracted_dir
    return {'t':t,'type':'refract','new_dir':exit_dir,'energy_mult':total_mult,'normal':normal,'aoi_deg':aoi_deg}

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Daylight Sim running on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)