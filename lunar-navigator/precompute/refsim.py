"""Python reference of the browser engine's simulate() (same table, same interpolation).

Used by validate.py to write tests/reference.json, which tests/regression.js checks the
JavaScript engine against.
"""
import datetime as dt
import json
import math
import os

import numpy as np

from geom import az_el, mask_at

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AU_KM = 149597870.7


class Ephemeris:
    def __init__(self, root=ROOT):
        self.meta = json.load(open(os.path.join(root, "data", "ephemeris.meta.json")))
        n, k = self.meta["count"], self.meta["valuesPerRecord"]
        self.v = np.fromfile(os.path.join(root, "data", "ephemeris.bin"), dtype="<f4").reshape(n, k).astype(np.float64)
        self.t0 = self.meta["startEpochMs"] / 1000.0
        self.step = self.meta["stepSec"]

    def at(self, unix_s):
        x = (unix_s - self.t0) / self.step
        i = int(math.floor(x))
        if i < 0 or i + 1 >= len(self.v):
            raise ValueError("time outside ephemeris table")
        f = x - i
        r = self.v[i] * (1 - f) + self.v[i + 1] * f
        return r[0:3], r[3:6]


def iso_to_unix(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def simulate(eph, site, mask, scen, step_min=10):
    t0 = iso_to_unix(scen["startUtc"])
    n = int(round(scen["durationDays"] * 24 * 60 / step_min))
    out = []
    for k in range(n + 1):
        t = t0 + k * step_min * 60
        s, e = eph.at(t)
        saz, sel = az_el(s, site["lat"], site["lon"], site.get("elevationM") or 0)
        eaz, eel = az_el(e, site["lat"], site["lon"], site.get("elevationM") or 0)
        hs = mask_at(mask, saz) if mask is not None else 0.0
        he = mask_at(mask, eaz) if mask is not None else 0.0
        out.append({
            "metH": k * step_min / 60,
            "sunAz": saz, "sunEl": sel, "earthAz": eaz, "earthEl": eel,
            "sunVisible": sel > hs,
            "earthVisible": eel > max(he, scen.get("minEarthElevDeg", 2.0)),
            "sunDistAu": float(np.linalg.norm(s)) / AU_KM,
        })
    return out


def metrics(series, step_min=10):
    n = len(series)
    sun = [x["sunVisible"] for x in series]
    earth = [x["earthVisible"] for x in series]

    def longest_false(a):
        best = cur = 0
        for v in a:
            cur = 0 if v else cur + 1
            best = max(best, cur)
        return best * step_min / 60

    return {
        "sunlitPct": 100 * sum(sun) / n,
        "earthVisiblePct": 100 * sum(earth) / n,
        "longestDarkGapH": longest_false(sun),
        "longestNoEarthGapH": longest_false(earth),
    }
