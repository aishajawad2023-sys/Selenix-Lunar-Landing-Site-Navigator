"""Illumination benchmark against the published LOLA polar illumination products (NASA GSFC PGDA
product 69; Mazarico et al. 2011, Icarus 211, 1066-1081, updated 2016):

  AVGVISIB_85S_060M_201608.IMG        share of hourly timesteps over 18.6 years in which the pixel is
                                      sunlit by any fraction of the solar disc (per the product label)
  AVGVISIB_85S_060M_201608_EARTH.IMG  the same for the Earth disc
Both were computed by the LOLA team from LDEM_85S_060M (60 m/pix).

For each test point (the curated sites plus a fixed-seed sample of pixels spread over the range of
published values) this script computes the same two quantities with OUR pipeline:
  SPICE geometry adapter (LT+S), hourly over 18.6 years  ->  our LOLA horizon mask at that pixel centre
  (observer at the surface, like the published product)  ->  any part of the disc above the horizon
  (centre elevation + angular radius > horizon)  ->  share of timesteps.
It repeats this for several near-field exclusion distances, because at grazing Sun angles the result
on ridge crests is dominated by metre-scale relief within a few DEM pixels, and reports the differences. Writes data/benchmark_illumination.json and docs/benchmark_illumination.png.

Usage: python precompute/benchmark_illumination.py --dem-dir DIR --illum-dir DIR
"""
import argparse
import datetime as dt
import json
import math
import os

import numpy as np
import spiceypy as sp

import horizon_mask as hm
from adapters import SpiceGeometryAdapter
from geom import R_MOON_KM, enu_basis

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R_SUN_KM, R_EARTH_KM = 695700.0, 6378.137
YEARS = 18.6
START = dt.datetime(2010, 1, 1, tzinfo=dt.timezone.utc)
N_SAMPLE = 40
SEED = 2011


class Published:
    def __init__(self, path, n=5058, scale=60.0, c=2528.5, factor=4e-5):
        self.a = np.memmap(path, dtype="<i2", mode="r").reshape(n, n)
        self.n, self.scale, self.c, self.factor = n, scale, c, factor

    def pix(self, lat, lon):
        r = 2 * hm.R_M * math.tan(math.pi / 4 + math.radians(lat) / 2) / self.scale
        return self.c - r * math.cos(math.radians(lon)), self.c + r * math.sin(math.radians(lon))

    def latlon(self, line, sample):
        x, y = (sample - self.c) * self.scale, (self.c - line) * self.scale
        return -90 + 2 * math.degrees(math.atan(math.hypot(x, y) / (2 * hm.R_M))), math.degrees(math.atan2(x, y))

    def value(self, line, sample):
        return float(self.a[line, sample]) * self.factor


def az_el_many(vecs, lat, lon, elev_m):
    e, n, u = enu_basis(lat, lon)
    v = vecs - u * (R_MOON_KM + elev_m / 1000.0)
    x, y, z = v @ e, v @ n, v @ u
    return np.degrees(np.arctan2(x, y)) % 360.0, np.degrees(np.arctan2(z, np.hypot(x, y))), np.linalg.norm(v, axis=1)


def mask_many(mask, az):
    i = np.floor(az).astype(int)
    f = az - i
    return mask[i % 360] * (1 - f) + mask[(i + 1) % 360] * f


NEAR_FIELDS_M = [0.0, 120.0, 300.0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem-dir", required=True)
    ap.add_argument("--illum-dir", required=True)
    a = ap.parse_args()
    sun_map = Published(os.path.join(a.illum_dir, "AVGVISIB_85S_060M_201608.IMG"))
    earth_map = Published(os.path.join(a.illum_dir, "AVGVISIB_85S_060M_201608_EARTH.IMG"))
    md = hm.MultiDem([hm.Dem(os.path.join(a.dem_dir, f)) for f in sorted(os.listdir(a.dem_dir)) if f.endswith(".IMG")])

    adapter = SpiceGeometryAdapter()
    n = int(YEARS * 365.25 * 24)
    ets = adapter.et(START) + np.arange(n) * 3600.0
    sun = np.array(sp.spkpos("SUN", ets, adapter.FRAME, adapter.abcorr, "MOON")[0])
    earth = np.array(sp.spkpos("EARTH", ets, adapter.FRAME, adapter.abcorr, "MOON")[0])

    pts = []
    for s in json.load(open(os.path.join(ROOT, "data", "sites.json"))):
        if s.get("terrain") == "lola" and s["lat"] < -83.2 and s["id"] != "south-pole":
            l, c = (int(round(v)) for v in sun_map.pix(s["lat"], s["lon"]))
            pts.append({"id": s["id"], "name": s["name"], "line": l, "sample": c, "kind": "site"})
    # fixed-seed sample spread over the published value range, within 2.5 deg of the pole
    rng = np.random.default_rng(SEED)
    half = int(2.5 * 30.3e3 / 60)
    c0 = int(sun_map.c)
    bins = np.linspace(0, 0.9, N_SAMPLE // 4 + 1)
    tries = 0
    counts = np.zeros(len(bins) - 1, int)
    while counts.sum() < N_SAMPLE and tries < 400000:
        tries += 1
        l, c = c0 + rng.integers(-half, half), c0 + rng.integers(-half, half)
        b = np.searchsorted(bins, sun_map.value(l, c), side="right") - 1
        if 0 <= b < len(counts) and counts[b] < 4:
            counts[b] += 1
            pts.append({"id": f"sample-{counts.sum():02d}", "name": "sample pixel", "line": int(l), "sample": int(c), "kind": "sample"})

    cfg = json.load(open(os.path.join(ROOT, "data", "config.json")))
    primary = float(cfg.get("nearFieldM", 0.0))
    nears = sorted(set(NEAR_FIELDS_M + [primary]))
    rows = []
    for p in pts:
        lat, lon = sun_map.latlon(p["line"], p["sample"])
        pub_sun, pub_earth = sun_map.value(p["line"], p["sample"]), earth_map.value(p["line"], p["sample"])
        row = {"id": p["id"], "name": p["name"], "kind": p["kind"], "lat": round(lat, 4), "lon": round(lon, 4),
               "publishedSunPct": round(100 * pub_sun, 2), "publishedEarthPct": round(100 * pub_earth, 2), "byNearFieldM": {}}
        for near in nears:
            mask, z, res, _ = hm.compute_mask(md, lat, lon, observer_h=0.0, max_km=200.0, near_m=near)
            saz, sel, sdist = az_el_many(sun, lat, lon, z)
            eaz, eel, edist = az_el_many(earth, lat, lon, z)
            ours_sun = float((sel + np.degrees(np.arcsin(R_SUN_KM / sdist)) > mask_many(mask, saz)).mean())
            ours_earth = float((eel + np.degrees(np.arcsin(R_EARTH_KM / edist)) > mask_many(mask, eaz)).mean())
            row["byNearFieldM"][f"{near:.0f}"] = {"oursSunPct": round(100 * ours_sun, 2), "dSunPct": round(100 * (ours_sun - pub_sun), 2),
                                                  "oursEarthPct": round(100 * ours_earth, 2), "dEarthPct": round(100 * (ours_earth - pub_earth), 2)}
        row.update(row["byNearFieldM"][f"{primary:.0f}"])
        rows.append(row)
        print(f"{p['id']:18s} {lat:9.4f} {lon:10.4f}  Sun pub {100*pub_sun:6.2f} | " + " | ".join(f"{k} m: {v['dSunPct']:+6.2f}" for k, v in row["byNearFieldM"].items())
              + f" || Earth pub {100*pub_earth:6.2f} | " + " | ".join(f"{k} m: {v['dEarthPct']:+6.2f}" for k, v in row["byNearFieldM"].items()), flush=True)

    def stats(key, kind=None, near=None):
        d = np.array([(r["byNearFieldM"][near][key] if near else r[key]) for r in rows if kind is None or r["kind"] == kind])
        return {"n": int(len(d)), "meanAbs": round(float(np.abs(d).mean()), 2), "medianAbs": round(float(np.median(np.abs(d))), 2), "median": round(float(np.median(d)), 2),
                "bias": round(float(d.mean()), 2), "rms": round(float(np.sqrt((d ** 2).mean())), 2), "maxAbs": round(float(np.abs(d).max()), 2)}

    out = {
        "reference": "NASA GSFC PGDA product 69: AVGVISIB_85S_060M_201608 (Sun) and _EARTH (share of hourly timesteps over 18.6 years with any fraction of the disc visible), "
                     "computed by the LOLA team from LDEM_85S_060M with the method of Mazarico et al. (2011), Icarus 211, 1066-1081",
        "referenceUrl": "https://pgda.gsfc.nasa.gov/products/69",
        "ours": f"SPICE {adapter.abcorr} hourly over {YEARS} years from {START.date()}; horizon masks from LDEM 40/80/120 m at the published pixel centre, observer at the surface; "
                "sunlit when centre elevation + angular radius exceeds the horizon (any fraction of the disc)",
        "differencesFrom": "DEM release and resolution (published 60 m, 2016; ours 40 m near field, 2017), 1 deg azimuth bins with a max over 5 sub-rays (ours, conservative), "
                           "start of the 18.6-year window, near-field treatment",
        "nearFieldM": primary,
        "nearFieldSensitivity": {f"{near:.0f}": {"sun": stats("dSunPct", None, f"{near:.0f}"), "earth": stats("dEarthPct", None, f"{near:.0f}")} for near in nears},
        "sun": {"all": stats("dSunPct"), "sites": stats("dSunPct", "site"), "samples": stats("dSunPct", "sample")},
        "earth": {"all": stats("dEarthPct"), "sites": stats("dEarthPct", "site"), "samples": stats("dEarthPct", "sample")},
        "rows": rows,
        "generatedUtc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    json.dump(out, open(os.path.join(ROOT, "data", "benchmark_illumination.json"), "w"), indent=1)
    print(json.dumps(out["nearFieldSensitivity"], indent=1))

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 2, figsize=(10, 4.6))
    for axx, kp, ko, title in ((ax[0], "publishedSunPct", "oursSunPct", "Average solar illumination (%)"), (ax[1], "publishedEarthPct", "oursEarthPct", "Average Earth visibility (%)")):
        for kind, col in (("sample", "#5b8def"), ("site", "#d9822b")):
            axx.scatter([r[kp] for r in rows if r["kind"] == kind], [r[ko] for r in rows if r["kind"] == kind], s=28, c=col, label="sample pixels" if kind == "sample" else "curated sites")
        axx.plot([0, 100], [0, 100], "k--", lw=1)
        axx.set_xlabel("published (PGDA / Mazarico et al.)")
        axx.set_ylabel(f"this pipeline (near field {primary:.0f} m)")
        axx.set_title(title)
        axx.legend()
        axx.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(ROOT, "docs", "benchmark_illumination.png"), dpi=90)


if __name__ == "__main__":
    main()
