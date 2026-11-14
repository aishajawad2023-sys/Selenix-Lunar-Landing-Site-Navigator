"""Precompute Sun and Earth position vectors in the MOON_ME frame.

Output
  data/ephemeris.bin        float32 little-endian, COUNT records of 6 values:
                            sun_x, sun_y, sun_z, earth_x, earth_y, earth_z (km, MOON_ME,
                            observer = Moon centre)
  data/ephemeris.meta.json  start epoch (UTC), step, count, frame, aberration, kernels

Method (SPICE, via spiceypy)
  spkpos(target, et, 'MOON_ME', 'NONE', 'MOON') for target SUN and EARTH.
  Times are indexed by UTC; et = str2et(UTC) (TDB = UTC + 69.184 s in 2026-2030).
  MOON_ME is realised from the DE440 lunar orientation (moon_pa_de440_200625.bpc +
  moon_de440_250416.tf), so physical libration is included. No simple analytic Moon model.

Kernels (download into precompute/kernels/ from https://naif.jpl.nasa.gov/pub/naif/generic_kernels/):
  lsk/naif0012.tls
  spk/planets/de440s.bsp
  pck/moon_pa_de440_200625.bpc
  fk/satellites/moon_de440_250416.tf
  pck/pck00011.tpc

Usage: python precompute/make_ephemeris.py [--start 2026-01-01] [--end 2031-01-01] [--step 3600]
"""
import argparse
import datetime as dt
import json
import os

import numpy as np
import spiceypy as sp

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
KDIR = os.path.join(HERE, "kernels")
KERNELS = [
    "naif0012.tls",
    "de440s.bsp",
    "moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf",
    "pck00011.tpc",
]
NVAL = 6


def furnish():
    for k in KERNELS:
        sp.furnsh(os.path.join(KDIR, k))


def vectors(utc_iso):
    """Return (sun_km[3], earth_km[3]) in MOON_ME for a UTC ISO string. Used by validators."""
    et = sp.str2et(utc_iso)
    s, _ = sp.spkpos("SUN", et, "MOON_ME", "NONE", "MOON")
    e, _ = sp.spkpos("EARTH", et, "MOON_ME", "NONE", "MOON")
    return np.array(s), np.array(e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-01-01")
    ap.add_argument("--end", default="2031-01-01")
    ap.add_argument("--step", type=int, default=3600)
    a = ap.parse_args()
    furnish()
    t0 = dt.datetime.fromisoformat(a.start).replace(tzinfo=dt.timezone.utc)
    t1 = dt.datetime.fromisoformat(a.end).replace(tzinfo=dt.timezone.utc)
    n = int((t1 - t0).total_seconds() // a.step) + 1
    et0 = sp.str2et(t0.strftime("%Y-%m-%dT%H:%M:%S"))
    # UTC index -> ET. Leap seconds: none scheduled through 2030 in naif0012, so
    # et = et0 + k*step is exact for a UTC grid in this window (checked below).
    ets = et0 + np.arange(n) * a.step
    et_end_check = sp.str2et(t1.strftime("%Y-%m-%dT%H:%M:%S"))
    assert abs(et_end_check - (et0 + (t1 - t0).total_seconds())) < 1e-3, "leap second inside window"
    out = np.zeros((n, NVAL), dtype=np.float64)
    for i, et in enumerate(ets):
        s, _ = sp.spkpos("SUN", et, "MOON_ME", "NONE", "MOON")
        e, _ = sp.spkpos("EARTH", et, "MOON_ME", "NONE", "MOON")
        out[i, 0:3] = s
        out[i, 3:6] = e
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    out.astype("<f4").tofile(os.path.join(ROOT, "data", "ephemeris.bin"))
    meta = {
        "startUtc": t0.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "startEpochMs": int(t0.timestamp() * 1000),
        "stepSec": a.step,
        "count": n,
        "valuesPerRecord": NVAL,
        "layout": ["sun_x", "sun_y", "sun_z", "earth_x", "earth_y", "earth_z"],
        "units": "km",
        "frame": "MOON_ME",
        "observer": "MOON (centre)",
        "aberration": "NONE (geometric). Light time and stellar aberration change apparent "
                      "Sun direction by ~0.006 deg; recorded as a limitation.",
        "timeIndex": "UTC; TDB = UTC + 69.184 s in this window (no leap seconds in naif0012)",
        "dtype": "float32 little-endian",
        "kernels": KERNELS,
        "toolkit": sp.tkvrsn("toolkit"),
        "generator": "precompute/make_ephemeris.py",
        "generatedUtc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    with open(os.path.join(ROOT, "data", "ephemeris.meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"wrote {n} records ({n*NVAL*4/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
