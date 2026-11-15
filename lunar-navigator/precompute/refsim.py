"""Python reference of the browser engine (same table, interpolation, classification and accounting).

validate.py uses it to write tests/reference.json, which tests/regression.js checks the JavaScript
engine against. TableGeometryAdapter implements the same adapter interface as SpiceGeometryAdapter.
"""
import datetime as dt
import json
import math
import os

import numpy as np

from geom import az_el, mask_at

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AU_KM = 149597870.7
OBSTRUCTED, UNCERTAIN, VISIBLE = 0, 1, 2
STATE_NAME = ["obstructed", "uncertain", "visible"]
CONFIG = json.load(open(os.path.join(ROOT, "data", "config.json")))


class TableGeometryAdapter:
    id, kind, version = "spice-table", "geometry", "2.0.0"

    def __init__(self, root=ROOT):
        self.meta = json.load(open(os.path.join(root, "data", "ephemeris.meta.json")))
        n, k = self.meta["count"], self.meta["valuesPerRecord"]
        self.v = np.fromfile(os.path.join(root, "data", "ephemeris.bin"), dtype="<f4").reshape(n, k).astype(np.float64)
        self.t0 = self.meta["startEpochMs"] / 1000.0
        self.step = self.meta["stepSec"]

    def describe(self):
        return dict(self.meta["adapter"], id=self.id, derivedFrom=self.meta["adapter"]["id"])

    def coverage(self):
        return self.meta["startUtc"], self.meta["endUtc"]

    def vectors_unix(self, unix_s):
        x = (unix_s - self.t0) / self.step
        i = int(math.floor(x))
        if i < 0 or i + 1 >= len(self.v):
            raise ValueError("time outside ephemeris table")
        f = x - i
        r = self.v[i] * (1 - f) + self.v[i + 1] * f
        return {"sun": r[0:3], "earth": r[3:6]}

    def vectors(self, utc_iso):
        return self.vectors_unix(iso_to_unix(utc_iso))

    def query(self, site, utc_iso):
        v = self.vectors(utc_iso)
        out = {}
        for body in ("sun", "earth"):
            az, el = az_el(v[body], site["lat"], site["lon"], site.get("elevationM") or 0)
            out[body] = {"az": az, "el": el, "distKm": float(np.linalg.norm(v[body]))}
        return out


Ephemeris = TableGeometryAdapter  # backwards-compatible name


def iso_to_unix(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def classify(el, threshold, tol):
    return VISIBLE if el > threshold + tol else (OBSTRUCTED if el < threshold - tol else UNCERTAIN)


def simulate(eph, site, mask, scen, step_min=None, tol=None):
    step_min = step_min or CONFIG["stepMin"]
    tol = CONFIG["toleranceDeg"] if tol is None else tol
    t0 = iso_to_unix(scen["startUtc"])
    n = int(round(scen["durationDays"] * 24 * 60 / step_min))
    out = []
    for k in range(n + 1):
        v = eph.vectors_unix(t0 + k * step_min * 60)
        saz, sel = az_el(v["sun"], site["lat"], site["lon"], site.get("elevationM") or 0)
        eaz, eel = az_el(v["earth"], site["lat"], site["lon"], site.get("elevationM") or 0)
        hs = mask_at(mask, saz) if mask is not None else 0.0
        he = mask_at(mask, eaz) if mask is not None else 0.0
        ss = classify(sel, hs, tol)
        es = classify(eel, max(he, scen.get("minEarthElevDeg", 2.0)), tol)
        if mask is None:  # missing terrain is never "visible"
            ss, es = min(ss, UNCERTAIN), min(es, UNCERTAIN)
        out.append({"metH": k * step_min / 60, "sunAz": saz, "sunEl": sel, "earthAz": eaz, "earthEl": eel,
                    "sunState": STATE_NAME[ss], "earthState": STATE_NAME[es]})
    return out


def metrics(series, step_min=None, min_state="visible"):
    """min_state 'visible' = conservative (uncertain not visible); 'uncertain' = optimistic."""
    step_min = step_min or CONFIG["stepMin"]
    n = len(series)
    ok = {"visible"} if min_state == "visible" else {"visible", "uncertain"}
    sun = [x["sunState"] in ok for x in series]
    earth = [x["earthState"] in ok for x in series]

    def longest_false(a):
        best = cur = 0
        for v in a:
            cur = 0 if v else cur + 1
            best = max(best, cur)
        return best * step_min / 60

    return {
        "sunlitPct": 100 * sum(sun) / n,
        "earthVisiblePct": 100 * sum(earth) / n,
        "sunUncertainPct": 100 * sum(x["sunState"] == "uncertain" for x in series) / n,
        "earthUncertainPct": 100 * sum(x["earthState"] == "uncertain" for x in series) / n,
        "longestDarkGapH": longest_false(sun),
        "longestNoEarthGapH": longest_false(earth),
    }
