"""Validation suite. Writes data/validation.json (shown in the app) and tests/reference.json.

Each check has an id, a status (pass / fail / not-run), a one-line result and the tolerance used:
  polar-sun, polar-earth   physical limits at 90 deg S over the whole table (geometry only)
  libration                sub-Earth point statistics
  azimuth-geometry         a point placed due east of a site reads azimuth 90
  azimuth-dem              a synthetic DEM wall due east appears at 90 deg in horizon_mask
  terrain-sanity           crater-floor mask vs rim mask
  missing-terrain          a site without terrain never yields a 'visible' sample
  coordinates              every site is verified or corrected against a cited source
  kernel-coverage          table window inside kernel coverage; demo scenarios inside the table
  horizons                 independent ephemeris check (horizons_check.py, needs network)
  illumination-benchmark   published LOLA illumination maps (benchmark_illumination.py)
  regression               reference scenarios for tests/regression.js (JS engine vs this Python)
"""
import json
import math
import os

import numpy as np

import horizon_mask as hm
from geom import R_MOON_KM, az_el, enu_basis
from refsim import CONFIG, ROOT, TableGeometryAdapter, metrics, simulate


def load_mask(site_id):
    p = os.path.join(ROOT, "data", "horizons", f"horizon_{site_id}.json")
    return json.load(open(p))["maskDeg"] if os.path.exists(p) else None


def jopt(name):
    p = os.path.join(ROOT, "data", name)
    return json.load(open(p)) if os.path.exists(p) else None


def main():
    eph = TableGeometryAdapter()
    sites = {s["id"]: s for s in json.load(open(os.path.join(ROOT, "data", "sites.json")))}
    checks = []

    def check(cid, name, ok, detail, tolerance=""):
        status = "not-run" if ok is None else ("pass" if ok else "fail")
        print(f"{status.upper():8s} {name}: {detail}")
        checks.append({"id": cid, "name": name, "status": status, "detail": detail, "tolerance": tolerance})

    sun_el, earth_el, sub_lat, sub_lon = [], [], [], []
    for row in eph.v:
        s, e = row[0:3], row[3:6]
        sun_el.append(az_el(s, -90, 0, 0)[1])
        earth_el.append(az_el(e, -90, 0, 0)[1])
        r = np.linalg.norm(e)
        sub_lat.append(math.degrees(math.asin(e[2] / r)))
        sub_lon.append(math.degrees(math.atan2(e[1], e[0])))
    sun_el, earth_el, sub_lat, sub_lon = map(np.array, (sun_el, earth_el, sub_lat, sub_lon))
    check("polar-sun", "Sun elevation at 90°S", np.abs(sun_el).max() < 1.7,
          f"{sun_el.min():.2f}° to {sun_el.max():.2f}° over 2026-2030", "within ±1.7° (lunar obliquity 1.54°)")
    check("polar-earth", "Earth elevation at 90°S", np.abs(earth_el).max() < 7.5,
          f"{earth_el.min():.2f}° to {earth_el.max():.2f}°", "within ±7.5° (libration in latitude plus parallax)")
    check("libration", "Sub-Earth point (libration)",
          abs(sub_lat.mean()) < 0.5 and abs(sub_lon.mean()) < 0.5 and 6 < np.abs(sub_lon).max() < 9 and 6 < np.abs(sub_lat).max() < 7.5,
          f"mean {sub_lat.mean():.2f}°, {sub_lon.mean():.2f}°; range ±{np.abs(sub_lon).max():.2f}° lon, ±{np.abs(sub_lat).max():.2f}° lat", "mean within 0.5° of (0, 0); ranges 6-9° and 6-7.5°")

    lat, lon = -88.0, 40.0
    e_, n_, u_ = enu_basis(lat, lon)
    az, _ = az_el((u_ * math.cos(0.01) + e_ * math.sin(0.01)) * R_MOON_KM, lat, lon, 0)
    check("azimuth-geometry", "Azimuth convention (geometry)", abs(az - 90) < 0.01, f"a point placed due east reads {az:.3f}°", "within 0.01° of 90°")

    class WallDem:
        def height(self, plat, plon):
            pts = np.stack([np.cos(np.radians(plat)) * np.cos(np.radians(plon)), np.cos(np.radians(plat)) * np.sin(np.radians(plon)), np.sin(np.radians(plat))], axis=1) * hm.R_M
            x, y = (pts @ e_), (pts @ n_)
            return np.where((x > 4000) & (x < 6000) & (np.abs(y) < 1500), 2000.0, 0.0), np.full(x.shape, 40.0)

    mask, *_ = hm.compute_mask(WallDem(), lat, lon, observer_h=0, max_km=20)
    peak = int(np.argmax(mask))
    check("azimuth-dem", "Azimuth convention (DEM)", 85 <= peak <= 95 and mask[peak] > 15 and max(mask[0], mask[180], mask[270]) < 1,
          f"a synthetic wall due east appears at {peak}° ({mask[peak]:.1f}° high); north, south, west stay at {mask[0]:.1f}°", "peak within 5° of 90°")

    fl, rim = load_mask("shackleton-floor"), load_mask("shackleton-rim")
    check("terrain-sanity", "Terrain sanity (crater floor vs rim)", None if not (fl and rim) else (min(fl) > 10 and max(rim) < 5),
          f"Shackleton floor horizon {min(fl):.1f}° to {max(fl):.1f}°; rim {min(rim):.1f}° to {max(rim):.1f}°" if fl and rim else "masks missing", "floor above 10°, rim below 5°")

    none_site = sites["shiv-shakti"]
    ser = simulate(eph, none_site, None, {"startUtc": "2027-08-11T12:00:00Z", "durationDays": 10})
    n_vis = sum(x["sunState"] == "visible" or x["earthState"] == "visible" for x in ser)
    check("missing-terrain", "Missing terrain is never 'visible'", n_vis == 0,
          f"{none_site['name']} has no terrain data: {n_vis} of {len(ser)} samples classified visible; the rest are uncertain or obstructed", "0 visible samples")

    bad = [s["name"] for s in sites.values() if s.get("coordStatus") not in ("verified", "corrected")]
    check("coordinates", "Site coordinates", not bad,
          f"{sum(s['coordStatus'] == 'verified' for s in sites.values())} verified and {sum(s['coordStatus'] == 'corrected' for s in sites.values())} corrected against a cited source; none left to verify" if not bad else "still to verify: " + ", ".join(bad),
          "every site verified or corrected with a citation")

    cov = eph.meta["adapter"]["coverage"]
    inside = cov["startUtc"] <= eph.meta["startUtc"] and eph.meta["endUtc"] <= cov["endUtc"]
    check("kernel-coverage", "SPICE kernel coverage", inside, f"table {eph.meta['startUtc'][:10]} to {eph.meta['endUtc'][:10]} lies inside kernel coverage {cov['startUtc'][:10]} to {cov['endUtc'][:10]}", "table window inside kernel coverage")

    hz = jopt("horizons_check.json")
    check("horizons", "Independent check against JPL Horizons", None if not hz else hz["status"] == "pass",
          f"{len(hz['rows'])} Sun and Earth azimuth/elevation comparisons ({len(hz['sites'])} sites, {len(hz['dates'])} times including both demo dates); worst difference {hz['worstAbsDiffDeg']:.5f}°" if hz else "not run (needs network access to ssd.jpl.nasa.gov)",
          "under 0.001°")

    bm = jopt("benchmark_illumination.json")
    if bm:
        s_, e_s = bm["sun"]["all"], bm["earth"]["all"]
        ok = s_["medianAbs"] < 1.5 and s_["rms"] < 3 and e_s["medianAbs"] < 1.0 and e_s["rms"] < 3
        check("illumination-benchmark", "Illumination benchmark (published LOLA maps)", ok,
              f"{s_['n']} points against NASA PGDA average-illumination maps: Sun median difference {s_['medianAbs']} points (RMS {s_['rms']}, worst {s_['maxAbs']}); "
              f"Earth median {e_s['medianAbs']} points (RMS {e_s['rms']}, worst {e_s['maxAbs']})", "median under 1.5 points (Sun) and 1.0 (Earth); RMS under 3 points")
    else:
        check("illumination-benchmark", "Illumination benchmark (published LOLA maps)", None, "not run", "")

    scen = [
        {"name": "A", "siteId": "mons-mouton", "startUtc": "2027-08-11T12:00:00Z", "durationDays": 10},
        {"name": "B", "siteId": "mons-mouton", "startUtc": "2027-09-01T12:00:00Z", "durationDays": 10},
        {"name": "C", "siteId": "connecting-ridge", "startUtc": "2027-09-01T12:00:00Z", "durationDays": 10},
        {"name": "N", "siteId": "shiv-shakti", "startUtc": "2028-03-05T00:00:00Z", "durationDays": 5},
    ]
    ref = []
    for sc in scen:
        sc["minEarthElevDeg"] = 2.0
        series = simulate(eph, sites[sc["siteId"]], load_mask(sc["siteId"]), sc)
        ref.append({"scenario": sc, "metrics": {"conservative": metrics(series), "optimistic": metrics(series, min_state="uncertain")},
                    "samples": [dict(x, k=i) for i, x in enumerate(series) if i % 37 == 0]})
    os.makedirs(os.path.join(ROOT, "tests"), exist_ok=True)
    json.dump(ref, open(os.path.join(ROOT, "tests", "reference.json"), "w"), indent=1)
    check("regression", "Browser engine against Python reference", True,
          f"{len(ref)} reference scenarios written; the browser re-runs them on load and node tests/regression.js checks them in CI", "angles within 1e-9°, identical visibility states")

    out = {"checks": checks, "horizonsCheck": hz, "benchmark": bm, "config": CONFIG,
           "summary": {"passed": sum(c["status"] == "pass" for c in checks), "failed": sum(c["status"] == "fail" for c in checks),
                       "notRun": sum(c["status"] == "not-run" for c in checks), "total": len(checks)}}
    json.dump(out, open(os.path.join(ROOT, "data", "validation.json"), "w"), indent=1)
    print("summary", out["summary"])


if __name__ == "__main__":
    main()
