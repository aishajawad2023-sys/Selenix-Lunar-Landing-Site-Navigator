"""Terrain horizon masks from LOLA south-polar DEMs (PDS3 LDEM_*.IMG, polar stereographic).

For each site and each 1 deg of azimuth (0 = local north, clockwise), march outward along the
great circle and keep the maximum elevation angle of the terrain, computed exactly in 3-D:
    P = (R + z(d)) * dir(d),  S = (R + z0) * up,  angle = asin(((P - S) . up) / |P - S|)
which equals atan2(z - z0 - d^2/(2R), d) to first order (the brief's formula).
z0 = DEM height at the site (bilinear) + observer height. Each 1 deg value is the maximum over
5 sub-rays spanning +/-0.5 deg (conservative: a ridge narrower than the bin is not missed).

The finest DEM that covers each sample point is used (multi-resolution: e.g. 40 m near the
pole, 80 m and 120 m farther out). Heights are DN * 0.5 m relative to 1737.4 km (see .LBL).

Projection (verified empirically against Shackleton and Malapert, see README):
  r = 2 R tan(pi/4 + lat/2)   (lat negative, south pole)
  sample = S0 + r sin(lon) / scale ;  line = L0 - r cos(lon) / scale   (0-based, S0 = L0 = *_PROJECTION_OFFSET)

Usage:
  python precompute/horizon_mask.py --dem-dir DIR [--sites data/sites.json] [--refine] [--plots docs/masks]
  Writes data/horizons/horizon_<siteId>.json for every site with "terrain": "lola" whose
  neighbourhood is covered by the DEMs, and (with --refine) updates refined coordinates and
  elevations in sites.json for sites marked "refine": {"radiusKm": ...}.
"""
import argparse
import datetime as dt
import json
import math
import os
import re

import numpy as np

from geom import R_MOON_KM, enu_basis

R_M = R_MOON_KM * 1000.0


class Dem:
    def __init__(self, img_path):
        lbl = open(img_path[:-4] + ".LBL").read()

        def kw(name):
            m = re.search(r"^\s*" + name + r"\s*=\s*\"?([^\"<\n]+)", lbl, re.M)
            return m.group(1).strip()

        self.name = os.path.basename(img_path)[:-4]
        self.lines = int(kw("LINES"))
        self.samples = int(kw("LINE_SAMPLES"))
        self.scale = float(kw("MAP_SCALE"))
        self.factor = float(kw("SCALING_FACTOR"))
        self.l0 = float(kw("LINE_PROJECTION_OFFSET"))
        self.s0 = float(kw("SAMPLE_PROJECTION_OFFSET"))
        self.max_lat = float(kw("MAXIMUM_LATITUDE"))
        self.version = kw("PRODUCT_VERSION_ID")
        self.created = kw("PRODUCT_CREATION_TIME")
        assert kw("MAP_PROJECTION_TYPE") == "POLAR STEREOGRAPHIC"
        assert float(kw("CENTER_LATITUDE")) == -90
        assert kw("SAMPLE_TYPE") == "LSB_INTEGER" and kw("SAMPLE_BITS") == "16"
        self.z = np.memmap(img_path, dtype="<i2", mode="r", shape=(self.lines, self.samples))

    def pix(self, lat, lon):
        r = 2 * R_M * np.tan(np.pi / 4 + np.radians(lat) / 2)
        return self.l0 - r * np.cos(np.radians(lon)) / self.scale, self.s0 + r * np.sin(np.radians(lon)) / self.scale

    def height(self, lat, lon):
        """Bilinear height (m) or NaN where outside the grid."""
        lat, lon = np.atleast_1d(lat), np.atleast_1d(lon)
        L, S = self.pix(lat, lon)
        out = np.full(L.shape, np.nan)
        ok = (L >= 0) & (S >= 0) & (L < self.lines - 1) & (S < self.samples - 1)
        l, s = L[ok], S[ok]
        i, j = np.floor(l).astype(int), np.floor(s).astype(int)
        fl, fs = l - i, s - j
        z = self.z
        v = (z[i, j] * (1 - fl) * (1 - fs) + z[i + 1, j] * fl * (1 - fs)
             + z[i, j + 1] * (1 - fl) * fs + z[i + 1, j + 1] * fl * fs)
        out[ok] = v * self.factor
        return out


class MultiDem:
    """Finest-available lookup across several DEMs (sorted fine to coarse)."""

    def __init__(self, dems):
        self.dems = sorted(dems, key=lambda d: d.scale)

    def height(self, lat, lon):
        lat, lon = np.atleast_1d(lat), np.atleast_1d(lon)
        out = np.full(lat.shape, np.nan)
        res = np.full(lat.shape, np.nan)
        for d in self.dems:
            need = np.isnan(out)
            if not need.any():
                break
            h = d.height(lat[need], lon[need])
            idx = np.where(need)[0]
            got = ~np.isnan(h)
            out[idx[got]] = h[got]
            res[idx[got]] = d.scale
        return out, res


def ray_points(lat, lon, az_deg, dists_m):
    """Lat/lon of points at arc distance d along azimuth az from the site (vector form, pole-safe)."""
    e, n, u = enu_basis(lat, lon)
    a = math.radians(az_deg)
    t = math.cos(a) * n + math.sin(a) * e
    ang = dists_m / R_M
    p = np.outer(np.cos(ang), u) + np.outer(np.sin(ang), t)
    plat = np.degrees(np.arcsin(np.clip(p[:, 2], -1, 1)))
    plon = np.degrees(np.arctan2(p[:, 1], p[:, 0]))
    return plat, plon, p


def distances(max_km, base_m):
    d, out = base_m, []
    while d <= max_km * 1000:
        out.append(d)
        d += max(base_m, d * 0.004)  # ~0.23 deg of arc per step at range
    return np.array(out)


def compute_mask(md, lat, lon, observer_h=2.0, max_km=200.0, sub=5):
    z_site, res_site = md.height(np.array([lat]), np.array([lon]))
    if np.isnan(z_site[0]):
        raise ValueError("site outside DEM coverage")
    z0 = z_site[0] + observer_h
    _, _, up = enu_basis(lat, lon)
    S = up * (R_M + z0)
    d = distances(max_km, res_site[0])
    mask = np.zeros(360)
    reach = np.zeros(360)
    for k in range(360):
        best = -90.0
        for o in np.linspace(-0.5, 0.5, sub):
            plat, plon, p = ray_points(lat, lon, k + o, d)
            h, _ = md.height(plat, plon)
            ok = ~np.isnan(h)
            if not ok.any():
                continue
            P = p[ok] * (R_M + h[ok])[:, None]
            v = P - S
            el = np.degrees(np.arcsin((v @ up) / np.linalg.norm(v, axis=1)))
            best = max(best, float(el.max()))
            reach[k] = max(reach[k], d[ok].max())
        mask[k] = best
    return mask, z_site[0], res_site[0], reach


def refine(md, lat, lon, radius_km):
    """Highest DEM point within radius (used for ridge/rim sites given approximately)."""
    best = (-1e9, lat, lon)
    for az in range(0, 360, 3):
        plat, plon, _ = ray_points(lat, lon, az, np.arange(0, radius_km * 1000 + 1, 20.0))
        h, _ = md.height(plat, plon)
        i = int(np.nanargmax(h))
        if h[i] > best[0]:
            best = (float(h[i]), float(plat[i]), float(plon[i]))
    return best


def plot(md, site, mask, out_png):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    lat, lon = site["lat"], site["lon"]
    e, n, u = enu_basis(lat, lon)
    half = 25000.0
    g = np.linspace(-half, half, 401)
    X, Y = np.meshgrid(g, g[::-1])
    P = u[None, None, :] + (X[..., None] * e + Y[..., None] * n) / R_M
    P /= np.linalg.norm(P, axis=2, keepdims=True)
    plat = np.degrees(np.arcsin(P[..., 2]))
    plon = np.degrees(np.arctan2(P[..., 1], P[..., 0]))
    H, _ = md.height(plat.ravel(), plon.ravel())
    H = H.reshape(X.shape)
    from matplotlib.colors import LightSource
    hs = LightSource(azdeg=315, altdeg=30).hillshade(np.nan_to_num(H, nan=np.nanmean(H)),
                                                      vert_exag=1, dx=g[1] - g[0], dy=g[1] - g[0])
    fig, ax = plt.subplots(1, 2, figsize=(12, 4.6), gridspec_kw={"width_ratios": [1, 1.6]})
    ax[0].imshow(hs, cmap="gray", extent=[-25, 25, -25, 25])
    ax[0].plot(0, 0, "r^")
    ax[0].set_title(f"{site['name']}: shaded relief (north up, 50 km)")
    ax[0].set_xlabel("east (km)")
    ax[0].set_ylabel("north (km)")
    ax[1].fill_between(np.arange(360), -5, mask, color="#555")
    ax[1].set_xlim(0, 359)
    ax[1].set_ylim(-3, max(8, mask.max() + 1))
    ax[1].set_xticks(range(0, 361, 45))
    ax[1].set_xlabel("azimuth (deg, 0 = N, clockwise)")
    ax[1].set_ylabel("horizon elevation (deg)")
    ax[1].set_title("terrain horizon mask")
    ax[1].grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_png, dpi=90)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem-dir", required=True)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--sites", default=os.path.join(root, "data", "sites.json"))
    ap.add_argument("--out", default=os.path.join(root, "data", "horizons"))
    ap.add_argument("--refine", action="store_true")
    ap.add_argument("--plots", default=None)
    ap.add_argument("--only", default=None)
    ap.add_argument("--max-km", type=float, default=200.0)
    a = ap.parse_args()
    dems = [Dem(os.path.join(a.dem_dir, f)) for f in sorted(os.listdir(a.dem_dir)) if f.endswith(".IMG")]
    md = MultiDem(dems)
    sites = json.load(open(a.sites))
    os.makedirs(a.out, exist_ok=True)
    if a.plots:
        os.makedirs(a.plots, exist_ok=True)
    for s in sites:
        if a.only and s["id"] != a.only:
            continue
        if s.get("terrain") != "lola":
            continue
        if a.refine and s.get("refine"):
            h, la, lo = refine(md, s["lat"], s["lon"], s["refine"]["radiusKm"])
            s["refine"]["from"] = [s["lat"], s["lon"]]
            s["lat"], s["lon"] = round(la, 4), round(lo, 4)
            s["refine"]["done"] = True
        try:
            mask, z, res, reach = compute_mask(md, s["lat"], s["lon"], max_km=a.max_km)
        except ValueError as ex:
            print(s["id"], "skipped:", ex)
            s["hasTerrainMask"] = False
            continue
        s["elevationM"] = round(float(z), 1)
        s["hasTerrainMask"] = True
        rec = {
            "siteId": s["id"],
            "azConvention": "0=N, clockwise",
            "stepDeg": 1,
            "maskDeg": [round(float(m), 3) for m in mask],
            "observerHeightM": 2.0,
            "siteHeightM": round(float(z), 1),
            "siteLat": s["lat"],
            "siteLon": s["lon"],
            "dem": {
                "product": "+".join(d.name for d in md.dems),
                "version": ", ".join(f"{d.name} {d.version} ({d.created})" for d in md.dems),
                "resolutionM": [d.scale for d in md.dems],
                "siteResolutionM": float(res),
                "extentKm": a.max_km,
                "minReachKm": round(float(reach.min()) / 1000, 1),
                "source": "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/",
            },
            "method": "radial max elevation angle with curvature correction (exact 3-D, sphere "
                      "R=1737.4 km), finest DEM per sample, 5 sub-rays per 1 deg bin (max)",
            "generator": "precompute/horizon_mask.py",
            "generatedUtc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        with open(os.path.join(a.out, f"horizon_{s['id']}.json"), "w") as f:
            json.dump(rec, f)
        print(f"{s['id']}: z={z:.0f} m, mask min {mask.min():.2f} max {mask.max():.2f} deg "
              f"at az {int(mask.argmax())}, reach >= {reach.min()/1000:.0f} km")
        if a.plots:
            plot(md, s, mask, os.path.join(a.plots, f"mask_{s['id']}.png"))
    with open(a.sites, "w") as f:
        json.dump(sites, f, indent=2)


if __name__ == "__main__":
    main()
