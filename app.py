import streamlit as st
import numpy as np
import matplotlib.pyplot as plt
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from environment.sun import SunEnvironment
from components.parabolic import ParabolicMirror
from raytracer.rays import Ray, RayBundle

st.set_page_config(page_title="Daylight Sim", layout="wide")
st.title("🌞 Daylight Redirection Simulator")
st.markdown("---")

# ── SIDEBAR INPUTS ──────────────────────────────────────────
st.sidebar.header("☀️ Sun Environment")
altitude    = st.sidebar.slider("Sun Altitude (°)",  5,  90, 45)
azimuth     = st.sidebar.slider("Sun Azimuth (°)",   0, 360, 180)
DNI         = st.sidebar.number_input("DNI (W/m²)",  0, 1200, 900)
DHI         = st.sidebar.number_input("DHI (W/m²)",  0,  400, 150)

st.sidebar.markdown("---")
st.sidebar.header("🪞 Parabolic Mirror (CPC1)")
focal_length      = st.sidebar.slider("Focal Length (m)",        0.1, 2.0, 0.5)
aperture_diameter = st.sidebar.slider("Aperture Diameter (m)",   0.1, 2.0, 0.8)
reflectivity      = st.sidebar.slider("Reflectivity",            0.5, 1.0, 0.92)
slope_error       = st.sidebar.slider("Slope Error (°)",         0.0, 1.0, 0.2)

st.sidebar.markdown("---")
st.sidebar.header("⚙️ Simulation")
ray_count = st.sidebar.slider("Ray Count", 10, 1000, 100)

# ── BUILD OBJECTS ────────────────────────────────────────────
sun    = SunEnvironment(altitude, azimuth, DNI, DHI)
mirror = ParabolicMirror(focal_length, aperture_diameter, reflectivity, slope_error)
bundle = RayBundle(ray_count, sun, mirror)

# ── RAY TRACING ──────────────────────────────────────────────
mirror_x, mirror_y = mirror.get_profile()

for ray in bundle.rays:
    # find intersection with parabola
    # simple approach: find x on parabola closest to ray path
    best_x = None
    best_dist = float('inf')

    for mx in mirror_x:
        my = (mx ** 2) / (4 * mirror.f)
        mirror_pt = np.array([mx, my])

        # vector from ray origin to mirror point
        to_mirror = mirror_pt - ray.origin

        # project onto ray direction
        t = np.dot(to_mirror, ray.direction)

        if t <= 0:
            continue

        # closest point on ray to mirror point
        closest = ray.origin + t * ray.direction
        dist = np.linalg.norm(closest - mirror_pt)

        if dist < best_dist:
            best_dist = dist
            best_x = mx
            best_t = t

    if best_x is not None and best_dist < 0.02:
        # propagate to hit point
        ray.propagate(best_t)

        # reflect off mirror
        new_dir, energy_mult = mirror.reflect_ray(ray.direction, best_x)
        ray.redirect(new_dir, energy_mult)

        # propagate reflected ray forward
        ray.propagate(focal_length * 3)

# ── PLOTTING ─────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(10, 7))
fig.patch.set_facecolor('#0e1117')
ax.set_facecolor('#0e1117')

# draw mirror
ax.plot(mirror_x, mirror_y, color='#00aaff', linewidth=2, label='CPC1 Mirror')

# draw focal point
fp = mirror.get_focal_point()
ax.plot(fp[0], fp[1], 'ro', markersize=8, label='Focal Point')

# draw rays
for ray in bundle.rays:
    xs, ys = ray.get_path()
    alpha = float(ray.energy) / (DNI / ray_count + 1e-9)
    alpha = min(max(alpha, 0.1), 1.0)
    ax.plot(xs, ys, color='#ffdd00', linewidth=0.8, alpha=alpha)

# draw opaque surface (floor)
ax.axhline(y=0, color='#555555', linewidth=1, linestyle='--', label='Ground')

ax.set_xlabel("X (m)", color='white')
ax.set_ylabel("Y (m)", color='white')
ax.tick_params(colors='white')
ax.legend(facecolor='#1e1e1e', labelcolor='white')
ax.set_title("2D Ray Trace — Cross Section View", color='white')
ax.set_xlim(-aperture_diameter, aperture_diameter)
ax.set_ylim(-focal_length, aperture_diameter * 3)
ax.set_aspect('equal')
ax.grid(True, alpha=0.1, color='white')

st.pyplot(fig)

# ── METRICS ──────────────────────────────────────────────────
st.markdown("---")
col1, col2, col3 = st.columns(3)
initial_energy = DNI
col1.metric("GHI", f"{sun.get_GHI():.1f} W/m²")
col2.metric("Rays Alive", f"{len(bundle.get_alive_rays())}/{ray_count}")
col3.metric("Sun Altitude", f"{altitude}°")
