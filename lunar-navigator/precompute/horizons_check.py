"""Independent ephemeris check: our table + geometry vs JPL Horizons (observer on the lunar surface).

Horizons: CENTER='coord@301', COORD_TYPE=GEODETIC (sphere 1737.4 km, MEAN_ME frame, east longitude),
QUANTITIES=4 (apparent azimuth/elevation, airless). Ours: apparent (LT+S) SPICE vectors interpolated
from the hourly table exactly as the browser does. Dates: the two demo landing dates, both ends of
the date sweep, and one off-the-hour instant to exercise the interpolation. Target: under 0.001 deg.
Writes data/horizons_check.json (validate.py folds it into data/validation.json).
"""
import json
import os
import re
import urllib.parse
import urllib.request

from geom import az_el
from refsim import CONFIG, ROOT, TableGeometryAdapter, iso_to_unix

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
DATES = ["2027-08-11T12:00:00Z", "2027-09-01T12:00:00Z", "2027-07-03T12:00:00Z", "2027-10-16T12:00:00Z", "2027-08-16T06:30:00Z"]
SITES = ["mons-mouton", "connecting-ridge", "shiv-shakti"]
TOLERANCE = 0.001


def horizons(target, site, when):
    t = when.replace("T", " ").replace("Z", "")[:16]
    q = {
        "format": "json", "COMMAND": f"'{target}'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{site['lon']},{site['lat']},{(site.get('elevationM') or 0) / 1000:.4f}'",
        "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'OBSERVER'", "TLIST": f"'{t}'", "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'", "EXTRA_PREC": "'YES'",
    }
    txt = json.load(urllib.request.urlopen(API + "?" + urllib.parse.urlencode(q), timeout=60))["result"]
    body = txt.split("$$SOE")[1].split("$$EOE")[0]
    nums = re.findall(r"-?\d+\.\d+", body.split(":")[-1])
    return float(nums[-2]), float(nums[-1])


def main():
    eph = TableGeometryAdapter()
    sites = {s["id"]: s for s in json.load(open(os.path.join(ROOT, "data", "sites.json")))}
    rows, worst = [], 0.0
    for sid in SITES:
        s = sites[sid]
        for d in DATES:
            v = eph.vectors_unix(iso_to_unix(d))
            for name, code, key in (("Sun", "10", "sun"), ("Earth", "399", "earth")):
                haz, hel = horizons(code, s, d)
                az, el = az_el(v[key], s["lat"], s["lon"], s.get("elevationM") or 0)
                daz = (az - haz + 180) % 360 - 180
                rows.append({"site": sid, "utc": d, "body": name, "horizonsAz": haz, "horizonsEl": hel,
                             "oursAz": round(az, 6), "oursEl": round(el, 6), "dAz": round(daz, 6), "dEl": round(el - hel, 6)})
                worst = max(worst, abs(el - hel), abs(daz))
                print(f"{sid:18s} {d} {name:5s} H az {haz:10.5f} el {hel:9.5f} | d az {daz:+.5f} el {el-hel:+.5f}")
    out = {"source": "JPL Horizons API (DE441), apparent azimuth/elevation, airless, MEAN_ME site coordinates",
           "ours": f"SPICE DE440 {eph.meta['adapter']['aberration']} table, hourly, linear interpolation",
           "rows": rows, "dates": DATES, "sites": SITES, "worstAbsDiffDeg": round(worst, 6), "toleranceDeg": TOLERANCE,
           "status": "pass" if worst < TOLERANCE else "fail"}
    json.dump(out, open(os.path.join(ROOT, "data", "horizons_check.json"), "w"), indent=1)
    print("worst |diff| deg:", worst, out["status"])


if __name__ == "__main__":
    main()
