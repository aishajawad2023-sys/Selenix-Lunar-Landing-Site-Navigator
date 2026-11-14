"""Shared geometry, Python reference implementation of the conventions used in src/engine.js.

Conventions (fixed, see README):
  Frame MOON_ME, km. Site on a sphere of radius R_MOON + elevation.
  Azimuth 0 deg = local north, increasing clockwise (90 = east).
  Elevation measured from the local plane tangent to that sphere. No refraction.
"""
import math

import numpy as np

R_MOON_KM = 1737.4


def enu_basis(lat_deg, lon_deg):
    la, lo = math.radians(lat_deg), math.radians(lon_deg)
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    north = np.array([-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)])
    return east, north, up


def site_vector(lat_deg, lon_deg, elev_m=0.0):
    _, _, up = enu_basis(lat_deg, lon_deg)
    return up * (R_MOON_KM + (elev_m or 0.0) / 1000.0)


def az_el(target_km, lat_deg, lon_deg, elev_m=0.0):
    """Azimuth/elevation (deg) of a MOON_ME position (km, Moon-centred) seen from the site."""
    e, n, u = enu_basis(lat_deg, lon_deg)
    v = np.asarray(target_km) - site_vector(lat_deg, lon_deg, elev_m)
    x, y, z = v @ e, v @ n, v @ u
    az = math.degrees(math.atan2(x, y)) % 360.0
    el = math.degrees(math.atan2(z, math.hypot(x, y)))
    return az, el


def mask_at(mask, az):
    """Linear interpolation of a 360-value horizon mask (1 deg steps, index k = azimuth k)."""
    a = az % 360.0
    i = int(math.floor(a))
    f = a - i
    return mask[i % 360] * (1 - f) + mask[(i + 1) % 360] * f
