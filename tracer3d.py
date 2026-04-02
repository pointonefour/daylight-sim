"""
tracer3d.py — Daylight Sim 3D Ray Tracer
=========================================
Standalone script. No Flask dependency.

Usage:
    python tracer3d.py project.dlsim [options]

Options:
    --rays      N       Total ray count (default 5000)
    --bounces   N       Max bounces per ray (default 12)
    --show              Open interactive Matplotlib window
    --export    path    Save figure as PNG
    --csv       path    Save irradiance grid as CSV
    --stats             Print detailed stats

Physical model:
    Rays are sampled from a virtual aperture plane placed ABOVE the mirror
    assembly, offset upstream in the solar direction so that every ray in the
    aperture travels through the mirror opening.  The solar disk subtends
    0.53° so each ray direction is perturbed by a uniformly-sampled angle
    within that cone (spherical cap).  Trough mirrors are extruded in Z by
    the per-component 'depth' param.  The filter plane is a virtual sensor
    placed at the output opening; only rays crossing it count as captured.
"""

import sys, json, argparse, math, warnings, io, base64
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D          # noqa: F401
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
warnings.filterwarnings('ignore')

SUN_HALF_ANGLE_DEG = 0.265
DAYLIGHT_EFFICACY  = 93.0
_EPS               = 1e-7

def empty_trace_stats():
    return dict(
        rays_total=0,
        energy_in_w=0.0,
        energy_cap_w=0.0,
        energy_in_lm=0.0,
        energy_cap_lm=0.0,
        efficiency_pct=0.0,
        avg_bounces=0.0,
        dead_rays=0,
        peak_irr=0.0,
        avg_irr=0.0,
        uniformity=0.0,
    )

# ══════════════════════════════════════════════════════════
#  SOLAR MODEL
# ══════════════════════════════════════════════════════════
def solar_model(lat_deg, day, time_h, sys_az_deg, base_dni, base_dhi, mode='true3d'):
    lat  = math.radians(lat_deg)
    decl = math.radians(23.45*math.sin(math.radians(360/365*(day-81))))
    ha   = math.radians(15*(time_h-12))
    s_alt = math.sin(lat)*math.sin(decl) + math.cos(lat)*math.cos(decl)*math.cos(ha)
    alt  = math.asin(max(-1., min(1., s_alt)))
    alt_deg = math.degrees(alt)
    if alt_deg <= 0:
        return None

    c_az = (math.sin(decl)-math.sin(lat)*math.sin(alt)) / \
           (math.cos(lat)*math.cos(alt)+1e-9)
    az_deg = math.degrees(math.acos(max(-1.,min(1.,c_az))))
    if ha > 0:
        az_deg = 360-az_deg

    rel_az   = math.radians(az_deg-sys_az_deg)
    prof_rad = math.atan2(math.tan(alt), math.cos(rel_az))
    if prof_rad < 0: prof_rad += math.pi
    prof_deg = math.degrees(prof_rad)

    cos_loss = abs(math.cos(rel_az))
    am       = 1./(math.sin(alt)+0.50572*(alt_deg+6.07995)**-1.6364)
    dni_fac  = 0.7**(am**0.678)
    eff_dni  = base_dni*dni_fac*cos_loss
    ghi      = eff_dni+base_dhi

    rel_3d = math.radians(az_deg-sys_az_deg)
    if mode == 'profile2d':
        # 2.5D mode: match the 2D simulator by collapsing the sun vector into
        # the X-Y cross-section plane using the solar profile angle.
        prof = math.radians(prof_deg)
        cd = np.array([
            math.cos(prof),
            -math.sin(prof),
            0.0,
        ], dtype=np.float64)
    else:
        # True 3D mode: preserve the along-axis Z component from azimuth.
        cd = np.array([
            math.cos(alt) * math.cos(rel_3d),
            -math.sin(alt),
            math.cos(alt) * math.sin(rel_3d),
        ], dtype=np.float64)
    cd /= np.linalg.norm(cd)

    return dict(alt_deg=alt_deg, az_deg=az_deg, prof_deg=prof_deg,
                cos_loss=cos_loss, dni_factor=dni_fac,
                eff_dni=eff_dni, ghi=ghi, central_dir=cd, mode=mode)

# ══════════════════════════════════════════════════════════
#  SAMPLING
#  Source origins are placed on an aperture plane that is
#  the bounding box of all mirror surfaces, offset upstream
#  in the solar direction by a fixed standoff.
# ══════════════════════════════════════════════════════════
def build_aperture(surfaces, central_dir, standoff=2.0):
    """
    Compute a launch aperture on a horizontal plane y = const above the scene.
    The aperture bounds are found by back-projecting the whole mirror assembly
    onto that plane along the solar direction, so off-axis sun vectors still
    cover the full 3D geometry.
    """
    all_pts = []
    for surf in surfaces:
        vlist = surf['verts'] if isinstance(surf['verts'],list) else [surf['verts']]
        for v in vlist:
            all_pts.append(v.reshape(-1,3))
    pts = np.vstack(all_pts)

    y_max = pts[:,1].max()
    aper_y = y_max + standoff

    if abs(central_dir[1]) <= 1e-6:
        raise ValueError("Solar direction is nearly horizontal; cannot build a stable aperture plane.")

    t_back = (pts[:,1] - aper_y) / central_dir[1]
    proj_x = pts[:,0] - t_back * central_dir[0]
    proj_z = pts[:,2] - t_back * central_dir[2]

    margin = 0.05  # 5cm margin
    aper_x_min = proj_x.min() - margin
    aper_x_max = proj_x.max() + margin
    aper_z_min = proj_z.min() - margin
    aper_z_max = proj_z.max() + margin

    return aper_x_min, aper_x_max, aper_y, aper_z_min, aper_z_max

def sample_solar_cone(central_dir, n, rng):
    """Uniform spherical-cap sampling within the solar disk."""
    half     = math.radians(SUN_HALF_ANGLE_DEG)
    cos_half = math.cos(half)
    u   = rng.uniform(0,1,n);  v = rng.uniform(0,1,n)
    ct  = 1-u*(1-cos_half)
    st  = np.sqrt(np.maximum(0,1-ct**2))
    ph  = 2*math.pi*v
    c   = central_dir
    t_  = np.array([1.,0.,0.]) if abs(c[0])<0.9 else np.array([0.,1.,0.])
    u_  = np.cross(c,t_); u_ /= np.linalg.norm(u_)
    v_  = np.cross(c,u_)
    dirs = st[:,None]*np.cos(ph[:,None])*u_ \
         + st[:,None]*np.sin(ph[:,None])*v_ \
         + ct[:,None]*c
    dirs /= np.linalg.norm(dirs,axis=1,keepdims=True)
    return dirs   # (N,3)

def sample_aperture_origins(ax0,ax1,ay,az0,az1, n, rng):
    xs = rng.uniform(ax0,ax1,n)
    ys = np.full(n,ay)
    zs = rng.uniform(az0,az1,n)
    return np.stack([xs,ys,zs],axis=1)   # (N,3)

def build_source_plane_z_range(surfaces, src_x, src_y, src_rot_deg, central_dir):
    """
    Back-project all mirror vertices onto the user-defined source plane so the
    launch z-range actually maps onto the finite trough depth.
    """
    rot = math.radians(src_rot_deg)
    plane_normal = np.array([-math.sin(rot), math.cos(rot), 0.0], dtype=np.float64)
    plane_origin = np.array([src_x, src_y, 0.0], dtype=np.float64)
    denom = float(np.dot(central_dir, plane_normal))
    if abs(denom) <= 1e-8:
        return 0.0, 1.0

    projected_z = []
    for surf in surfaces:
        vlist = surf['verts'] if isinstance(surf['verts'], list) else [surf['verts']]
        for verts in vlist:
            pts = verts.reshape(-1, 3)
            t = ((pts - plane_origin) @ plane_normal) / denom
            origins = pts - t[:, None] * central_dir
            projected_z.extend(origins[:, 2].tolist())

    if not projected_z:
        return 0.0, 1.0

    z0 = min(projected_z)
    z1 = max(projected_z)
    if abs(z1 - z0) < 1e-6:
        z1 = z0 + 1.0
    return z0, z1

def sample_source_strip_origins(src_x, src_y, src_width, src_rot_deg, z0, z1, n, rng):
    """
    Match the 2D simulator's launch model: rays are born from the user-placed
    source line, extruded through the source plane depth band that back-projects
    onto the actual 3D mirror assembly.
    """
    rot = math.radians(src_rot_deg)
    offsets = rng.uniform(-src_width / 2.0, src_width / 2.0, n)
    xs = src_x + offsets * math.cos(rot)
    ys = src_y + offsets * math.sin(rot)
    zs = rng.uniform(z0, z1, n)
    return np.stack([xs, ys, zs], axis=1)

def _flatten_surface_triangles(surfaces):
    v0s, v1s, v2s, normals = [], [], [], []
    for surf in surfaces:
        for (v0, v1, v2), n in zip(surf['tris'], surf['tri_norms']):
            v0s.append(np.asarray(v0, dtype=np.float64))
            v1s.append(np.asarray(v1, dtype=np.float64))
            v2s.append(np.asarray(v2, dtype=np.float64))
            normals.append(np.asarray(n, dtype=np.float64))
    return v0s, v1s, v2s, normals

def sample_aperture_rays(surfaces, central_dir, n, rng, standoff=2.0, chunk_size=None, max_attempt_factor=40):
    """
    Sample rays from the horizontal launch plane, but only keep candidates whose
    first path segment actually intersects the front side of a mirror triangle.
    This avoids spending most rays in empty bounding-box space when the beam is
    strongly skewed relative to the trough axis.
    """
    ax0, ax1, ay, az0, az1 = build_aperture(surfaces, central_dir, standoff=standoff)
    bbox_area = max(0.0, (ax1 - ax0) * (az1 - az0))
    if n <= 0 or bbox_area <= 0:
        return np.zeros((0, 3)), np.zeros((0, 3)), {
            'ax0': ax0, 'ax1': ax1, 'ay': ay, 'az0': az0, 'az1': az1,
            'bbox_area': bbox_area, 'effective_area': 0.0, 'hit_fraction': 0.0,
            'attempts': 0,
        }

    v0s, v1s, v2s, tri_normals = _flatten_surface_triangles(surfaces)
    if not v0s:
        return np.zeros((0, 3)), np.zeros((0, 3)), {
            'ax0': ax0, 'ax1': ax1, 'ay': ay, 'az0': az0, 'az1': az1,
            'bbox_area': bbox_area, 'effective_area': 0.0, 'hit_fraction': 0.0,
            'attempts': 0,
        }

    if chunk_size is None:
        chunk_size = max(4 * n, 512)

    accepted_origins = []
    accepted_dirs = []
    attempts = 0
    max_attempts = max(chunk_size, n * max_attempt_factor)

    while len(accepted_origins) < n and attempts < max_attempts:
        batch_n = min(chunk_size, max_attempts - attempts)
        cand_origins = sample_aperture_origins(ax0, ax1, ay, az0, az1, batch_n, rng)
        cand_dirs = sample_solar_cone(central_dir, batch_n, rng)
        attempts += batch_n

        nearest_t = np.full(batch_n, np.inf)
        nearest_n = np.zeros((batch_n, 3), dtype=np.float64)

        for v0, v1, v2, tri_n in zip(v0s, v1s, v2s, tri_normals):
            tt = _mt(cand_origins, cand_dirs, v0, v1, v2)
            hit = np.isfinite(tt) & (tt < nearest_t)
            if not hit.any():
                continue
            nearest_t[hit] = tt[hit]
            nearest_n[hit] = tri_n

        front_hit = np.isfinite(nearest_t) & ((cand_dirs * nearest_n).sum(axis=1) < 0.0)
        for i in np.where(front_hit)[0]:
            accepted_origins.append(cand_origins[i])
            accepted_dirs.append(cand_dirs[i])
            if len(accepted_origins) >= n:
                break

    accepted = len(accepted_origins)
    hit_fraction = accepted / attempts if attempts > 0 else 0.0
    effective_area = bbox_area * hit_fraction

    if accepted == 0:
        origins = np.zeros((0, 3))
        dirs = np.zeros((0, 3))
    else:
        origins = np.asarray(accepted_origins[:n], dtype=np.float64)
        dirs = np.asarray(accepted_dirs[:n], dtype=np.float64)

    return origins, dirs, {
        'ax0': ax0,
        'ax1': ax1,
        'ay': ay,
        'az0': az0,
        'az1': az1,
        'bbox_area': bbox_area,
        'effective_area': effective_area,
        'hit_fraction': hit_fraction,
        'attempts': attempts,
    }

# ══════════════════════════════════════════════════════════
#  MÖLLER–TRUMBORE  (N rays × 1 triangle, vectorised)
# ══════════════════════════════════════════════════════════
def _mt(origins, dirs, v0, v1, v2):
    """Returns t (N,); np.inf where no hit."""
    e1 = v1-v0;  e2 = v2-v0
    h  = np.cross(dirs, e2)          # (N,3)
    a  = (h*e1).sum(axis=1)          # (N,)
    t_out = np.full(len(origins),np.inf)
    ok = np.abs(a) > _EPS
    if not ok.any(): return t_out
    f  = np.where(ok, 1./np.where(ok,a,1.), 0.)
    s  = origins - v0                 # (N,3)
    u  = f*(s*h).sum(axis=1)         # (N,)
    ok &= (u>=0)&(u<=1)
    if not ok.any(): return t_out
    q  = np.cross(s, e1)             # (N,3)
    vv = f*(dirs*q).sum(axis=1)      # (N,)
    ok &= (vv>=0)&(u+vv<=1)
    if not ok.any(): return t_out
    tt = f*(e2*q).sum(axis=1)        # (N,)  ← correct: dot(e2,q) per ray
    ok &= (tt>_EPS)
    t_out[ok] = tt[ok]
    return t_out

# ══════════════════════════════════════════════════════════
#  SURFACE BUILDERS
# ══════════════════════════════════════════════════════════
def _xform(lx,ly, ox,oy, cr,sr, tx,ty):
    dx=lx-ox; dy=ly-oy
    return dx*cr-dy*sr+tx, dx*sr+dy*cr+ty

def _mesh(verts, normals_3d):
    """(nP,nD,3) grid → triangle list + normal list."""
    tris,norms=[],[]
    nP,nD,_=verts.shape
    for i in range(nP-1):
        for j in range(nD-1):
            v00=verts[i,j]; v10=verts[i+1,j]
            v01=verts[i,j+1]; v11=verts[i+1,j+1]
            n=(normals_3d[i]+normals_3d[i+1])*.5
            n/=(np.linalg.norm(n)+1e-12)
            tris+=[(v00,v10,v11),(v00,v11,v01)]
            norms+=[n,n]
    return tris,norms

def make_parabolic_trough(p, xf, depth, nP=80, nD=12):
    f   = p.get('focal_length',0.5);  D   = p.get('aperture',0.8)
    ts  = p.get('trim_start',0.0);    te  = p.get('trim_end',1.0)
    ref = p.get('reflectivity',0.92)
    se  = math.radians(p.get('slope_error',0.2)*1e-3*57.3)
    ox  = p.get('origin_offset_x',0.); oy = p.get('origin_offset_y',0.)
    rot = math.radians(xf.get('rotation',0))
    cr,sr = math.cos(rot),math.sin(rot)
    tx,ty = xf['tx'],xf['ty']

    xl = np.linspace(-D/2+ts*D, -D/2+te*D, nP)
    yl = xl**2/(4*f)
    wx,wy = _xform(xl,yl, ox,oy, cr,sr, tx,ty)

    dydx=xl/(2*f); nlen=np.sqrt(1+dydx**2)
    # Match the 2D simulator's parabolic reflection normal exactly:
    # local normal = (-dydx, 1), then rotate into world space.
    wnx=(-dydx/nlen)*cr - (1./nlen)*sr
    wny=(-dydx/nlen)*sr + (1./nlen)*cr

    zs=np.linspace(0,depth,nD)
    verts=np.zeros((nP,nD,3))
    for j,z in enumerate(zs):
        verts[:,j,0]=wx; verts[:,j,1]=wy; verts[:,j,2]=z

    n3d=np.stack([wnx,wny,np.zeros(nP)],axis=1)
    tris,norms=_mesh(verts,n3d)
    return dict(type='parabolic',verts=verts,tris=tris,tri_norms=norms,
                reflectivity=ref,slope_error_rad=se,depth=depth)

def make_flat_mirror(p, xf, depth, nD=12):
    w   = p.get('width',0.6)
    ts  = p.get('trim_start',0.0);  te = p.get('trim_end',1.0)
    ref = p.get('reflectivity',0.92)
    se  = math.radians(p.get('slope_error',0.2)*1e-3*57.3)
    ox  = p.get('origin_offset_x',0.); oy = p.get('origin_offset_y',0.)
    rot = math.radians(xf.get('rotation',0))
    cr,sr = math.cos(rot),math.sin(rot)
    tx,ty = xf['tx'],xf['ty']

    xl=np.array([-w/2+ts*w, -w/2+te*w])
    wx,wy=_xform(xl,np.zeros(2), ox,oy, cr,sr, tx,ty)
    n3=np.array([-sr,cr,0.]); n3/=np.linalg.norm(n3)

    zs=np.linspace(0,depth,nD)
    verts=np.zeros((2,nD,3))
    for j,z in enumerate(zs):
        verts[0,j]=[wx[0],wy[0],z]; verts[1,j]=[wx[1],wy[1],z]

    n3d=np.array([n3,n3])
    tris,norms=_mesh(verts,n3d)
    return dict(type='flat',verts=verts,tris=tris,tri_norms=norms,
                reflectivity=ref,slope_error_rad=se,depth=depth)

def make_cpc(p, xf, depth, nP=80, nD=12):
    ap    = p.get('aperture',0.6)
    theta = math.radians(p.get('acceptance_angle',30))
    trunc = p.get('truncation_factor',1.0)
    ref   = p.get('reflectivity',0.90)
    se    = math.radians(p.get('slope_error',0.2)*1e-3*57.3)
    ox    = p.get('origin_offset_x',0.); oy = p.get('origin_offset_y',0.)
    rot   = math.radians(xf.get('rotation',0))
    cr,sr = math.cos(rot),math.sin(rot)
    tx,ty = xf['tx'],xf['ty']

    r=ap/2; tMax=(math.pi/2+theta)*trunc
    tvs=np.linspace(0,tMax,nP)
    xr= r*(1+np.sin(tvs))*np.cos(tvs)/(1+np.sin(theta))
    yr= r*(1+np.sin(tvs))*np.sin(tvs)/(1+np.sin(theta))-r

    all_tris,all_norms,all_verts=[],[],[]
    for xl,yl,side in [(xr,yr,1),(-xr,yr,-1)]:
        wx,wy=_xform(xl,yl, ox,oy, cr,sr, tx,ty)
        dxt=np.gradient(xl); dyt=np.gradient(yl)
        lnx=-dyt*side; lny=dxt*side
        nl=np.sqrt(lnx**2+lny**2)+1e-12
        lnx/=nl; lny/=nl
        wnx=lnx*cr-lny*sr; wny=lnx*sr+lny*cr
        zs=np.linspace(0,depth,nD)
        verts=np.zeros((nP,nD,3))
        for j,z in enumerate(zs):
            verts[:,j,0]=wx; verts[:,j,1]=wy; verts[:,j,2]=z
        n3d=np.stack([wnx,wny,np.zeros(nP)],axis=1)
        t,n=_mesh(verts,n3d)
        all_tris+=t; all_norms+=n; all_verts.append(verts)

    return dict(type='cpc',verts=all_verts,tris=all_tris,tri_norms=all_norms,
                reflectivity=ref,slope_error_rad=se,depth=depth)

# ══════════════════════════════════════════════════════════
#  FILTER PLANE
# ══════════════════════════════════════════════════════════
def make_filter_plane(p, xf, max_z):
    w   = p.get('width',1.0)
    dep = float(p.get('depth',max_z if max_z>0 else 0.6))
    ox  = p.get('origin_offset_x',0.); oy = p.get('origin_offset_y',0.)
    rot = math.radians(xf.get('rotation',0))
    cr,sr = math.cos(rot),math.sin(rot)
    tx,ty = xf['tx'],xf['ty']

    lx=np.array([-w/2,w/2,w/2,-w/2])
    ly=np.zeros(4)
    lz=np.array([0.,0.,dep,dep])
    wx,wy=_xform(lx,ly, ox,oy, cr,sr, tx,ty)
    corners=np.stack([wx,wy,lz],axis=1)   # (4,3)

    n=np.array([-sr,cr,0.]); n/=(np.linalg.norm(n)+1e-12)

    # Consistent winding so MT gives positive t for rays going toward filter
    tris=[(corners[0],corners[1],corners[2]),
          (corners[0],corners[2],corners[3])]
    e1=corners[1]-corners[0]; e2=corners[2]-corners[0]
    if np.dot(np.cross(e1,e2),n)<0:
        tris=[(corners[0],corners[2],corners[1]),
              (corners[0],corners[3],corners[2])]

    W,Z=30,20
    return dict(corners=corners,normal=n,width=w,depth=dep,
                tris=tris,irr_map=np.zeros((Z,W)),w_bins=W,z_bins=Z)

def record_fp_hit(fp, pt, e):
    c=fp['corners']
    wa=c[1]-c[0]; wa/=(np.linalg.norm(wa)+1e-12)
    za=c[3]-c[0]; za/=(np.linalg.norm(za)+1e-12)
    r=pt-c[0]
    wc=np.clip(np.dot(r,wa)/fp['width'],0,1)
    zc=np.clip(np.dot(r,za)/fp['depth'],0,1)
    wi=int(wc*(fp['w_bins']-1)); zi=int(zc*(fp['z_bins']-1))
    fp['irr_map'][zi,wi]+=e

# ══════════════════════════════════════════════════════════
#  REFLECT + PERTURB
# ══════════════════════════════════════════════════════════
def reflect_3d(dirs,normals):
    dot=(dirs*normals).sum(axis=1,keepdims=True)
    r=dirs-2*dot*normals
    r/=(np.linalg.norm(r,axis=1,keepdims=True)+1e-12)
    return r

def perturb_normals(normals,se_rad,rng):
    if se_rad<=0: return normals.copy()
    N=len(normals)
    ang=rng.normal(0,se_rad,N)
    rv=rng.standard_normal((N,3))
    axes=np.cross(normals,rv)
    axes/=(np.linalg.norm(axes,axis=1,keepdims=True)+1e-12)
    ca=np.cos(ang)[:,None]; sa=np.sin(ang)[:,None]
    dot=(normals*axes).sum(axis=1,keepdims=True)
    out=normals*ca+np.cross(axes,normals)*sa+axes*dot*(1-ca)
    out/=(np.linalg.norm(out,axis=1,keepdims=True)+1e-12)
    return out

# ══════════════════════════════════════════════════════════
#  CORE TRACER
# ══════════════════════════════════════════════════════════
def trace_3d(surfaces, fp, origins, ray_dirs, e_per, max_bounces, rng):
    N=len(origins)
    o=origins.copy(); d=ray_dirs.copy()
    E=np.full(N,e_per); alive=np.ones(N,dtype=bool)
    total_in=E.sum(); total_cap=0.; dead=0
    bc=np.zeros(N,dtype=int)

    # Flatten mirror geometry with per-tri properties
    V0,V1,V2,TN,TR,TSE=[],[],[],[],[],[]
    for surf in surfaces:
        r_=surf['reflectivity']; se_=surf['slope_error_rad']
        for (v0,v1,v2),tn in zip(surf['tris'],surf['tri_norms']):
            V0.append(np.array(v0)); V1.append(np.array(v1))
            V2.append(np.array(v2)); TN.append(tn)
            TR.append(r_);           TSE.append(se_)
    nT=len(V0)

    fp_v=[(np.array(t[0]),np.array(t[1]),np.array(t[2])) for t in fp['tris']]

    VIZ=min(300,N)
    viz=set(np.random.choice(N,VIZ,replace=False).tolist())
    vp={i:[o[i].copy()] for i in viz}

    OFF=1e-3

    for _b in range(max_bounces):
        idx=np.where(alive)[0]
        if len(idx)==0: break
        oi=o[idx]; di=d[idx]; ei=E[idx]; M=len(idx)

        # Filter plane — double-sided
        fp_t=np.full(M,np.inf); fp_pt=np.zeros((M,3)); fp_hit=np.zeros(M,dtype=bool)
        for v0,v1,v2 in fp_v:
            tt=_mt(oi,di,v0,v1,v2)
            # Accept both winding directions
            tt2=_mt(oi,di,v2,v1,v0)
            tt=np.minimum(tt,tt2)
            mask=np.isfinite(tt)&(tt<fp_t)
            fp_t[mask]=tt[mask]
            fp_pt[mask]=oi[mask]+tt[mask,None]*di[mask]
            fp_hit|=mask

        # Mirror intersections
        mt=np.full(M,np.inf); mn=np.zeros((M,3)); mr=np.full(M,.92); mse=np.zeros(M)
        for k in range(nT):
            tt=_mt(oi,di,V0[k],V1[k],V2[k])
            mask=np.isfinite(tt)&(tt<mt)
            if not mask.any(): continue
            mt[mask]=tt[mask]; mn[mask]=TN[k]
            mr[mask]=TR[k];    mse[mask]=TSE[k]

        cap  = fp_hit & (~np.isfinite(mt)|(fp_t<mt))
        mir  = np.isfinite(mt) & (~fp_hit|(mt<=fp_t))
        lost = ~cap & ~mir

        for li in np.where(cap)[0]:
            gi=idx[li]; total_cap+=ei[li]
            alive[gi]=False; record_fp_hit(fp,fp_pt[li],ei[li])
            if gi in viz: vp[gi].append(fp_pt[li].copy())

        for li in np.where(lost)[0]:
            gi=idx[li]; dead+=1; alive[gi]=False
            if gi in viz: vp[gi].append((oi[li]+di[li]*4.).copy())

        mi = np.where(mir)[0]
        if not len(mi): continue
        
        ob=oi[mi]; db=di[mi]; eb=ei[mi]
        tb=mt[mi]; nb=mn[mi].copy(); rb=mr[mi]; seb=mse[mi]
        hp=ob+tb[:,None]*db

        # 1. Calculate which side of the mirror was hit
        dot_dn = (db * nb).sum(axis=1)

        # (Notice we DELETED the old batch normal flipping and reflection here!)

        for si, li in enumerate(mi):
            gi = idx[li]

            # 2. Hit the opaque back? Kill the ray!
            if dot_dn[si] > 0:
                alive[gi] = False
                dead += 1
                if gi in viz: vp[gi].append(hp[si].copy())
                continue

            # 3. Hit the front! Process reflection for this specific ray
            n_p = nb[si]
            if seb[si] > 0:
                n_p = perturb_normals(nb[si:si+1], float(seb[si]), rng)[0]

            dn_single = reflect_3d(db[si:si+1], n_p[None, :])[0]
            
            # 4. Step 1mm off the surface and bounce!
            o[gi] = hp[si] + dn_single * OFF
            d[gi] = dn_single
            E[gi] = eb[si] * rb[si]
            bc[gi] += 1
            
            if gi in viz: vp[gi].append(hp[si].copy())
            if E[gi] < 1e-6: alive[gi] = False

            
    vp_list=[pts for pts in vp.values() if len(pts)>=2]
    eff=total_cap/total_in*100 if total_in>0 else 0.

    return vp_list, dict(
        rays_total    =N,
        energy_in_w   =round(total_in,4),
        energy_cap_w  =round(total_cap,4),
        energy_in_lm  =round(total_in*DAYLIGHT_EFFICACY,2),
        energy_cap_lm =round(total_cap*DAYLIGHT_EFFICACY,2),
        efficiency_pct=round(eff,2),
        avg_bounces   =round(bc.mean(),2),
        dead_rays     =dead,
    )

# ══════════════════════════════════════════════════════════
#  VISUALISATION
# ══════════════════════════════════════════════════════════
def _build_visualisation_figure(surfaces,fp,ray_paths,stats,sol):
    fig=plt.figure(figsize=(16,8),facecolor='white')
    ax3=fig.add_subplot(1,2,1,projection='3d')
    ax3.set_facecolor('#f8f8f8')
    COLS={'parabolic':'#1a3aaa','flat':'#444444','cpc':'#156a6a'}

    for surf in surfaces:
        col=COLS.get(surf['type'],'#888888')
        vl=surf['verts'] if isinstance(surf['verts'],list) else [surf['verts']]
        for v in vl:
            ax3.plot_wireframe(v[:,:,0],v[:,:,2],v[:,:,1],color=col,lw=0.5,alpha=0.7)

    c=fp['corners']
    poly=Poly3DCollection([[[p[0],p[2],p[1]] for p in [c[0],c[1],c[2],c[3]]]],
                          alpha=0.35,facecolor='lime',edgecolor='green',lw=1.5)
    ax3.add_collection3d(poly)

    for pts in ray_paths[:200]:
        ax3.plot([p[0] for p in pts],[p[2] for p in pts],[p[1] for p in pts],
                 color='#0064ff',alpha=0.18,lw=0.6)

    sd=sol['central_dir']
    if ray_paths:
        starts = np.array([pts[0] for pts in ray_paths if len(pts) > 0], dtype=float)
        arrow_origin = starts.mean(axis=0) if len(starts) else np.array([0., 0., 0.])
    else:
        all_pts = []
        for surf in surfaces:
            vlist = surf['verts'] if isinstance(surf['verts'], list) else [surf['verts']]
            for verts in vlist:
                all_pts.append(verts.reshape(-1, 3))
        arrow_origin = np.vstack(all_pts).mean(axis=0) if all_pts else np.array([0., 0., 0.])
        arrow_origin[1] += 1.0

    all_scene_pts = []
    for surf in surfaces:
        vlist = surf['verts'] if isinstance(surf['verts'], list) else [surf['verts']]
        for verts in vlist:
            all_scene_pts.append(verts.reshape(-1, 3))
    all_scene_pts.append(fp['corners'])
    scene_pts = np.vstack(all_scene_pts)
    scene_span = np.maximum(scene_pts.max(axis=0) - scene_pts.min(axis=0), 1e-6)
    arrow_len = 0.18 * float(np.linalg.norm(scene_span))
    ax3.quiver(
        arrow_origin[0], arrow_origin[2], arrow_origin[1],
        sd[0] * arrow_len, sd[2] * arrow_len, sd[1] * arrow_len,
        color='orange', lw=2, arrow_length_ratio=.3
    )
    ax3.set_xlabel('X (m)',fontsize=8); ax3.set_ylabel('Z (m)',fontsize=8)
    ax3.set_zlabel('Y (m)',fontsize=8)
    ax3.set_title('3D Ray Trace',fontsize=11,fontweight='bold')
    ax3.tick_params(labelsize=7)
    from matplotlib.lines import Line2D
    ax3.legend(handles=[
        Line2D([0],[0],color='#1a3aaa',lw=2,label='Parabolic'),
        Line2D([0],[0],color='#444444',lw=2,label='Flat'),
        Line2D([0],[0],color='#156a6a',lw=2,label='CPC'),
        Line2D([0],[0],color='lime',   lw=2,label='Filter'),
        Line2D([0],[0],color='#0064ff',lw=1,label='Rays'),
        Line2D([0],[0],color='orange', lw=2,label='Sun dir'),
    ],fontsize=7,loc='upper right')

    ax2=fig.add_subplot(1,2,2)
    irr=fp['irr_map']
    ca=(fp['width']/fp['w_bins'])*(fp['depth']/fp['z_bins'])
    iw=irr/ca if ca>0 else irr
    im=ax2.imshow(iw,origin='lower',aspect='auto',cmap='inferno',
                  extent=[0,fp['width'],0,fp['depth']])
    plt.colorbar(im,ax=ax2,label='Irradiance (W/m²)')
    ax2.set_xlabel('Width (m)',fontsize=9); ax2.set_ylabel('Depth (m)',fontsize=9)
    ax2.set_title('Irradiance Map — Filter Plane',fontsize=11,fontweight='bold')

    illum=iw[iw>0]
    uni=illum.min()/illum.max()*100 if len(illum)>0 else 0

    fig.text(.52,.02,
        f"Rays:            {stats['rays_total']:,}\n"
        f"Energy in:       {stats['energy_in_w']:.1f} W  ({stats['energy_in_lm']:.0f} lm)\n"
        f"Energy captured: {stats['energy_cap_w']:.1f} W  ({stats['energy_cap_lm']:.0f} lm)\n"
        f"Efficiency:      {stats['efficiency_pct']:.1f}%\n"
        f"Avg bounces:     {stats['avg_bounces']:.2f}\n"
        f"Peak irradiance: {iw.max():.1f} W/m²\n"
        f"Uniformity:      {uni:.1f}%\n"
        f"Solar altitude:  {sol['alt_deg']:.1f}°\n"
        f"Profile angle:   {sol['prof_deg']:.1f}°\n"
        f"Eff DNI:         {sol['eff_dni']:.1f} W/m²",
        fontsize=8,family='monospace',va='bottom',
        bbox=dict(boxstyle='round',facecolor='#f0f0f0',alpha=0.85))

    plt.suptitle(
        f"Daylight Sim 3D  -  Alt {sol['alt_deg']:.1f}°  "
        f"Prof {sol['prof_deg']:.1f}°  DNI {sol['eff_dni']:.0f} W/m²",
        fontsize=12,fontweight='bold',y=0.98)
    plt.tight_layout(rect=[0,.14,1,.96])

    return fig

def render_visualisation_png_base64(surfaces, fp, ray_paths, stats, sol):
    fig = _build_visualisation_figure(surfaces, fp, ray_paths, stats, sol)
    buf = io.BytesIO()
    fig.savefig(buf, dpi=150, bbox_inches='tight', format='png')
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('ascii')

def visualise(surfaces,fp,ray_paths,stats,sol,show,export):
    fig = _build_visualisation_figure(surfaces, fp, ray_paths, stats, sol)

    if export:
        fig.savefig(export,dpi=150,bbox_inches='tight')
        print(f"Figure saved -> {export}")
    if show:
        try:
            import matplotlib
            matplotlib.use('TkAgg')
            plt.show()
        except Exception:
            print("Interactive window unavailable - use --export to save.")
    plt.close(fig)

# ══════════════════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════════════════
def main():
    ap=argparse.ArgumentParser(description='Daylight Sim 3D Ray Tracer')
    ap.add_argument('dlsim')
    ap.add_argument('--rays',   type=int,default=5000)
    ap.add_argument('--bounces',type=int,default=12)
    ap.add_argument('--depth',  type=float,default=None,
                    help='Override extrusion depth in meters for all 3D mirror surfaces and the filter plane.')
    ap.add_argument('--show',   action='store_true')
    ap.add_argument('--export', default=None)
    ap.add_argument('--csv',    default=None)
    ap.add_argument('--stats',  action='store_true')
    args=ap.parse_args()

    with open(args.dlsim) as f: proj=json.load(f)
    sim=proj.get('sim',{}); sun=sim.get('sun',{}); comps=sim.get('components',[])

    src_x=sim.get('sourceX',0.); src_y=sim.get('sourceY',2.5)
    src_w=sim.get('sourceWidth',3.); src_rot=sim.get('sourceRotation',0.)

    sol=solar_model(sun.get('lat',20),sun.get('day',172),sun.get('time',12),
                    sun.get('sysAz',180),sun.get('dni',900),sun.get('dhi',150))
    if sol is None: print("Night time."); sys.exit(0)

    if args.stats:
        print(f"\nSolar: alt={sol['alt_deg']:.2f}°  az={sol['az_deg']:.2f}°  prof={sol['prof_deg']:.2f}°")
        print(f"Dir: {sol['central_dir']}")
        print(f"Eff DNI={sol['eff_dni']:.1f}  GHI={sol['ghi']:.1f} W/m²")

    surfaces=[]; fp_comp=None; fp_xf=None; max_z=0.0

    for c in comps:
        typ=c.get('type',''); p=c.get('params',{})
        pos=c.get('position',{'x':0,'y':0})
        xf={'tx':pos['x'],'ty':pos['y'],'rotation':c.get('rotation',0)}
        dep=float(args.depth if args.depth is not None else p.get('depth',0.6))
        max_z=max(max_z,dep)
        if   typ=='parabolic': surfaces.append(make_parabolic_trough(p,xf,dep))
        elif typ=='flat':      surfaces.append(make_flat_mirror(p,xf,dep))
        elif typ=='cpc':       surfaces.append(make_cpc(p,xf,dep))
        elif typ=='filter':    fp_comp=p; fp_xf=xf
        
    if not surfaces: print("No mirror surfaces."); sys.exit(1)
    if max_z<=0: max_z=0.6

    if fp_comp is None:
        print("No filter component — default at y=0.")
        fp_comp={'width':src_w,'depth':max_z,'origin_offset_x':0.,'origin_offset_y':0.}
        fp_xf={'tx':src_x,'ty':0.,'rotation':0}

    fp=make_filter_plane(fp_comp,fp_xf,max_z)

    rng=np.random.default_rng(42)

    src_z0, src_z1 = build_source_plane_z_range(surfaces, src_x, src_y, src_rot, sol['central_dir'])
    origins=sample_source_strip_origins(src_x, src_y, src_w, src_rot, src_z0, src_z1, args.rays, rng)
    dirs=sample_solar_cone(sol['central_dir'],args.rays,rng)
    source_area = max(src_w, 0.0) * max(src_z1 - src_z0, 0.0)

    if args.stats:
        print(f"\nSource strip: center=({src_x:.2f},{src_y:.2f}) width={src_w:.2f} m rot={src_rot:.1f}° z=[{src_z0:.2f},{src_z1:.2f}]")
        print(f"Launch area: {source_area:.3f} m²")

    if len(origins) == 0 or source_area <= 0:
        print("No valid launch rays from source strip.")
        stats = empty_trace_stats()
        if args.show or args.export:
            visualise(surfaces, fp, [], stats, sol, args.show, args.export)
        sys.exit(1)

    e_per=sol['ghi']*source_area/len(origins)

    if args.stats:
        print(f"Energy/ray={e_per:.6f} W  Total={e_per*len(origins):.2f} W")

    print(f"\nTracing {len(origins):,} rays through {len(surfaces)} surface(s)...")
    ray_paths,stats=trace_3d(surfaces,fp,origins,dirs,e_per,args.bounces,rng)
    print("Done.")

    if args.stats:
        print("\n-- Results ------------------------------")
        for k,v in stats.items(): print(f"  {k:<22} {v}")

    if args.csv:
        rows=["w_m,z_m,energy_w"]
        for zi in range(fp['z_bins']):
            for wi in range(fp['w_bins']):
                rows.append(f"{wi/fp['w_bins']*fp['width']:.4f},"
                            f"{zi/fp['z_bins']*fp['depth']:.4f},"
                            f"{fp['irr_map'][zi,wi]:.6f}")
        with open(args.csv,'w') as f: f.write('\n'.join(rows))
        print(f"CSV -> {args.csv}")

    if args.show or args.export:
        visualise(surfaces,fp,ray_paths,stats,sol,args.show,args.export)

if __name__=='__main__':
    main()
