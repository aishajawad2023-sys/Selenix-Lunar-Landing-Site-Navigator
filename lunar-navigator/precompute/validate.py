"""Validation checks (brief section 10). Writes data/validation.json and tests/reference.json.

  1. Physical limits at 90 deg S (geometry only, no terrain): Sun elevation within ~+/-1.6 deg,
     Earth within ~+/-7 deg, over the whole ephemeris window.
  2. Sub-Earth point statistics (libration).
  3. Azimuth convention: (a) a point placed due east of a site reads az 90 in the engine
     geometry; (b) a synthetic DEM wall east of a site appears at 90 deg in horizon_mask.
  5. (part) Terrain sanity: crater floor mask >> rim masks.
  6. Regression reference for 3 scenarios (sampled steps and metrics) for tests/regression.js.
  4. Illumination benchmark over the full window for rim/ridge sites (sunlit % of time,
     Sun centre above terrain mask), compared against published ranges (to verify).
Horizons cross-check (2) is in horizons_check.py (needs network).
"""
import json
import math
import os

import numpy as np

import horizon_mask as hm
from geom import R_MOON_KM, az_el, enu_basis, mask_at
from refsim import ROOT, Ephemeris, metrics, simulate


def load_mask(site_id):
    p = os.path.join(ROOT, "data", "horizons", f"horizon_{site_id}.json")
    return json.load(open(p))["maskDeg"] if os.path.exists(p) else None


def check(name, ok, detail):
    print(("PASS " if ok else "FAIL ") + name + ": " + detail)
    return {"name": name, "status": "pass" if ok else "fail", "detail": detail}


def main():
    eph = Ephemeris()
    sites = {s["id"]: s for s in json.load(open(os.path.join(ROOT, "data", "sites.json")))}
    results = []

    # 1. polar limits
    sun_el, earth_el, sub_lat, sub_lon = [], [], [], []
    for row in eph.v:
        s, e = row[0:3], row[3:6]
        sun_el.append(az_el(s, -90, 0, 0)[1])
        earth_el.append(az_el(e, -90, 0, 0)[1])
        r = np.linalg.norm(e)
        sub_lat.append(math.degrees(math.asin(e[2] / r)))
        sub_lon.append(math.degrees(math.atan2(e[1], e[0])))
    sun_el, earth_el = np.array(sun_el), np.array(earth_el)
    results.append(check("Polar limit: Sun elevation at 90S", np.abs(sun_el).max() < 1.7,
                         f"range {sun_el.min():.2f} to {sun_el.max():.2f} deg (expected within about +/-1.6; lunar obliquity to ecliptic 1.54 deg)"))
    results.append(check("Polar limit: Earth elevation at 90S", np.abs(earth_el).max() < 7.5,
                         f"range {earth_el.min():.2f} to {earth_el.max():.2f} deg (expected within about +/-7, libration in latitude)"))
    # 2. libration
    sub_lat, sub_lon = np.array(sub_lat), np.array(sub_lon)
    results.append(check("Sub-Earth point (libration)",
                         abs(sub_lat.mean()) < 0.5 and abs(sub_lon.mean()) < 0.5 and 6 < np.abs(sub_lon).max() < 9 and 6 < np.abs(sub_lat).max() < 7.5,
                         f"mean lat {sub_lat.mean():.2f}, mean lon {sub_lon.mean():.2f}; "
                         f"lon range +/-{np.abs(sub_lon).max():.2f}, lat range +/-{np.abs(sub_lat).max():.2f} deg"))

    # 3a. azimuth convention, geometry
    lat, lon = -88.0, 40.0
    e_, n_, u_ = enu_basis(lat, lon)
    target = (u_ * math.cos(0.01) + e_ * math.sin(0.01)) * R_MOON_KM
    az, _ = az_el(target, lat, lon, 0)
    results.append(check("Azimuth convention (geometry)", abs(az - 90) < 0.01,
                         f"point placed due east reads az {az:.3f} deg (0=N, clockwise)"))

    # 3b. azimuth convention, DEM wall
    class WallDem:
        def height(self, plat, plon):
            pts = np.stack([np.cos(np.radians(plat)) * np.cos(np.radians(plon)),
                            np.cos(np.radians(plat)) * np.sin(np.radians(plon)),
                            np.sin(np.radians(plat))], axis=1) * hm.R_M
            x, y = (pts @ e_), (pts @ n_)
            h = np.where((x > 4000) & (x < 6000) & (np.abs(y) < 1500), 2000.0, 0.0)
            return h, np.full(h.shape, 40.0)

    mask, *_ = hm.compute_mask(WallDem(), lat, lon, observer_h=0, max_km=20)
    peak = int(np.argmax(mask))
    results.append(check("Azimuth convention (DEM wall)", 85 <= peak <= 95 and mask[peak] > 15 and mask[0] < 1 and mask[180] < 1 and mask[270] < 1,
                         f"wall built due east appears at az {peak} deg with height {mask[peak]:.1f} deg; "
                         f"N/S/W {mask[0]:.1f}/{mask[180]:.1f}/{mask[270]:.1f} deg"))

    # 5. terrain sanity
    fl, rim = load_mask("shackleton-floor"), load_mask("shackleton-rim")
    if fl and rim:
        results.append(check("Terrain sanity: crater floor vs rim", min(fl) > 10 and max(rim) < 5,
                             f"Shackleton floor horizon {min(fl):.1f} to {max(fl):.1f} deg; rim {min(rim):.1f} to {max(rim):.1f} deg"))

    # 4. illumination benchmark (whole window, hourly)
    bench = {"connecting-ridge": [80, 95], "shackleton-rim": [75, 95], "de-gerlache-rim": [70, 92],
             "malapert-massif": [55, 85], "shackleton-floor": [0, 0.01]}
    illum = {}
    for sid, (lo, hi) in bench.items():
        m, s = load_mask(sid), sites[sid]
        if m is None:
            continue
        lit = 0
        for row in eph.v:
            az, el = az_el(row[0:3], s["lat"], s["lon"], s["elevationM"])
            lit += el > mask_at(m, az)
        pct = 100 * lit / len(eph.v)
        illum[sid] = round(pct, 1)
        results.append(check(f"Illumination plausibility: {s['name']}", lo <= pct <= hi,
                             f"sunlit {pct:.1f}% of 2026-2030 (Sun centre above terrain); plausible range {lo}-{hi}% "
                             f"from published south-polar illumination maps (Mazarico et al. 2011; Glaser et al. 2018), to verify"))

    # 6. regression reference
    scen = [
        {"name": "A", "siteId": "mons-mouton", "startUtc": "2027-08-11T12:00:00Z", "durationDays": 10},
        {"name": "B", "siteId": "mons-mouton", "startUtc": "2027-09-01T12:00:00Z", "durationDays": 10},
        {"name": "C", "siteId": "shiv-shakti", "startUtc": "2028-03-05T00:00:00Z", "durationDays": 5},
    ]
    ref = []
    for sc in scen:
        sc["minEarthElevDeg"] = 2.0
        site = sites[sc["siteId"]]
        series = simulate(eph, site, load_mask(sc["siteId"]), sc)
        ref.append({"scenario": sc, "metrics": metrics(series),
                    "samples": [dict(x, k=i) for i, x in enumerate(series) if i % 37 == 0]})
    os.makedirs(os.path.join(ROOT, "tests"), exist_ok=True)
    json.dump(ref, open(os.path.join(ROOT, "tests", "reference.json"), "w"), indent=1)

    hz_path = os.path.join(ROOT, "data", "horizons_check.json")
    hz = json.load(open(hz_path)) if os.path.exists(hz_path) else None
    out = {"checks": results, "illuminationPct2026_2030": illum, "horizonsCheck": hz}
    json.dump(out, open(os.path.join(ROOT, "data", "validation.json"), "w"), indent=1)
    print("wrote data/validation.json and tests/reference.json")


if __name__ == "__main__":
    main()
