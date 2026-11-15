"""Precompute Sun and Earth position vectors in the MOON_ME frame through the SPICE geometry adapter.

Output
  data/ephemeris.bin        float32 little-endian, COUNT records of 6 values:
                            sun_x, sun_y, sun_z, earth_x, earth_y, earth_z (km, MOON_ME, observer = Moon centre)
  data/ephemeris.meta.json  start epoch (UTC), step, count, plus the adapter descriptor
                            (kernel files, frame, time system, aberration correction, coverage)

Method: SpiceGeometryAdapter.vectors() = spkpos(target, et, 'MOON_ME', 'LT+S', 'MOON') for SUN and EARTH.
Times are indexed by UTC; et = str2et(UTC). MOON_ME comes from the DE440 lunar orientation kernels, so
physical libration is included. No analytic Moon model.

Kernels (into precompute/kernels/ from https://naif.jpl.nasa.gov/pub/naif/generic_kernels/):
  lsk/naif0012.tls  spk/planets/de440s.bsp  pck/moon_pa_de440_200625.bpc
  fk/satellites/moon_de440_250416.tf  pck/pck00011.tpc

Usage: python precompute/make_ephemeris.py [--start 2026-01-01] [--end 2031-01-01] [--step 3600]
"""
import argparse
import datetime as dt
import json
import os

import numpy as np
import spiceypy as sp

from adapters import SpiceGeometryAdapter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NVAL = 6


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-01-01")
    ap.add_argument("--end", default="2031-01-01")
    ap.add_argument("--step", type=int, default=3600)
    a = ap.parse_args()
    adapter = SpiceGeometryAdapter()
    t0 = dt.datetime.fromisoformat(a.start).replace(tzinfo=dt.timezone.utc)
    t1 = dt.datetime.fromisoformat(a.end).replace(tzinfo=dt.timezone.utc)
    n = int((t1 - t0).total_seconds() // a.step) + 1
    et0 = adapter.et(t0)
    # UTC grid -> ET: exact while no leap second falls inside the window (checked here).
    assert abs(adapter.et(t1) - (et0 + (t1 - t0).total_seconds())) < 1e-3, "leap second inside window"
    out = np.zeros((n, NVAL))
    for i in range(n):
        v = adapter.vectors_et(et0 + i * a.step)
        out[i, 0:3] = v["sun"]
        out[i, 3:6] = v["earth"]
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    out.astype("<f4").tofile(os.path.join(ROOT, "data", "ephemeris.bin"))
    meta = {
        "startUtc": t0.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "endUtc": t1.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "startEpochMs": int(t0.timestamp() * 1000),
        "stepSec": a.step,
        "count": n,
        "valuesPerRecord": NVAL,
        "layout": ["sun_x", "sun_y", "sun_z", "earth_x", "earth_y", "earth_z"],
        "units": "km",
        "dtype": "float32 little-endian",
        "interpolation": "linear between hourly records (browser steps every 10 min)",
        "adapter": adapter.describe(),
        "generator": "precompute/make_ephemeris.py",
        "generatedUtc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    with open(os.path.join(ROOT, "data", "ephemeris.meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"wrote {n} records ({n * NVAL * 4 / 1e6:.2f} MB), aberration {adapter.abcorr}, "
          f"kernel coverage {adapter.coverage()}")


if __name__ == "__main__":
    main()
