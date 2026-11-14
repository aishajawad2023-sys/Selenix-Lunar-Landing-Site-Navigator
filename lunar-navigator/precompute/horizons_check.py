"""Independent ephemeris check: our table + geometry vs JPL Horizons (observer on the lunar surface).

Horizons: CENTER='coord@301', COORD_TYPE=GEODETIC (Moon sphere 1737.4 km, MEAN_ME frame, east lon),
QUANTITIES=4 (apparent az/el, airless). Ours: geometric (no aberration), interpolated from the
hourly table exactly as the browser does. Expected differences ~0.01 deg (aberration/light time).
Writes data/horizons_check.json (validate.py folds it into data/validation.json).
"""
import json
import os
import re
import urllib.parse
import urllib.request

from geom import az_el
from refsim import ROOT, Ephemeris, iso_to_unix

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
DATES = ["2026-06-01T00:00:00Z", "2027-08-11T12:00:00Z", "2029-12-24T06:30:00Z"]
SITES = ["mons-mouton", "connecting-ridge", "shiv-shakti"]


def horizons(target, site, when):
    t = when.replace("T", " ").replace("Z", "")[:16]
    q = {
        "format": "json", "COMMAND": f"'{target}'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{site['lon']},{site['lat']},{(site.get('elevationM') or 0) / 1000:.4f}'",
        "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'OBSERVER'", "TLIST": f"'{t}'", "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'", "EXTRA_PREC": "'YES'",
    }
    url = API + "?" + urllib.parse.urlencode(q)
    txt = json.load(urllib.request.urlopen(url, timeout=60))["result"]
    body = txt.split("$$SOE")[1].split("$$EOE")[0]
    nums = re.findall(r"-?\d+\.\d+", body.split(":")[-1])
    return float(nums[-2]), float(nums[-1])


def main():
    eph = Ephemeris()
    sites = {s["id"]: s for s in json.load(open(os.path.join(ROOT, "data", "sites.json")))}
    rows, worst = [], 0.0
    for sid in SITES:
        s = sites[sid]
        for d in DATES:
            sun, earth = eph.at(iso_to_unix(d))
            for name, code, vec in (("Sun", "10", sun), ("Earth", "399", earth)):
                haz, hel = horizons(code, s, d)
                az, el = az_el(vec, s["lat"], s["lon"], s.get("elevationM") or 0)
                daz = (az - haz + 180) % 360 - 180
                rows.append({"site": sid, "utc": d, "body": name, "horizonsAz": haz, "horizonsEl": hel,
                             "oursAz": round(az, 5), "oursEl": round(el, 5),
                             "dAz": round(daz, 5), "dEl": round(el - hel, 5)})
                worst = max(worst, abs(el - hel), abs(daz))
                print(f"{sid:18s} {d} {name:5s} H az {haz:9.4f} el {hel:8.4f} | ours az {az:9.4f} el {el:8.4f} | d {daz:+.4f} {el-hel:+.4f}")
    out = {"source": "JPL Horizons API (DE441), apparent az/el, airless", "rows": rows,
           "worstAbsDiffDeg": round(worst, 5), "tolerance": 0.05, "status": "pass" if worst < 0.05 else "fail"}
    json.dump(out, open(os.path.join(ROOT, "data", "horizons_check.json"), "w"), indent=1)
    print("worst |diff| deg:", worst)


if __name__ == "__main__":
    main()
