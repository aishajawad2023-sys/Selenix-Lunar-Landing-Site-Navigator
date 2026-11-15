"""Adapter interface for the integration layer, and the SPICE geometry adapter that implements it.

Interface (see docs/INTERFACES.md and schemas/adapter-descriptor.schema.json). Every adapter exposes:

    id, kind, version                      stable identifiers
    describe() -> dict                     provenance descriptor (sources, frame, time system, settings)
    coverage() -> (start_utc, end_utc)     validity window; callers must check it before querying
    query(site, utc_iso) -> dict           the adapter's product for one site and instant

A geometry adapter returns, for body in (sun, earth):
    {"az": deg, "el": deg, "distKm": km}   azimuth 0 = local north, clockwise; elevation above the
                                           local tangent plane of a sphere R = 1737.4 km + elevation
and also offers vectors(utc_iso) -> Moon-centred MOON_ME position vectors (km), which is what the
precomputed browser table stores.

The browser implements the same interface over the precomputed table (src/engine.js,
SpiceTableAdapter); tests/regression.js checks that both agree.
"""
import datetime as dt
import os
from typing import Protocol, Tuple

import numpy as np
import spiceypy as sp

from geom import az_el

HERE = os.path.dirname(os.path.abspath(__file__))
KDIR = os.path.join(HERE, "kernels")


class GeometryAdapter(Protocol):
    id: str
    kind: str
    version: str

    def describe(self) -> dict: ...
    def coverage(self) -> Tuple[str, str]: ...
    def vectors(self, utc_iso: str) -> dict: ...
    def query(self, site: dict, utc_iso: str) -> dict: ...


class SpiceGeometryAdapter:
    """Sun and Earth geometry from NAIF SPICE kernels (authoritative source for the table)."""

    id = "spice-geometry"
    kind = "geometry"
    version = "2.0.0"
    KERNELS = [
        ("naif0012.tls", "LSK", "leap seconds"),
        ("de440s.bsp", "SPK", "planetary and lunar ephemeris DE440 (1849-2150)"),
        ("moon_pa_de440_200625.bpc", "PCK", "lunar orientation, principal axes, DE440"),
        ("moon_de440_250416.tf", "FK", "lunar frames MOON_PA / MOON_ME for DE440"),
        ("pck00011.tpc", "PCK", "planetary constants"),
    ]
    FRAME = "MOON_ME"

    def __init__(self, abcorr="LT+S", kernel_dir=KDIR):
        self.abcorr = abcorr
        self.kernel_dir = kernel_dir
        for name, _, _ in self.KERNELS:
            sp.furnsh(os.path.join(kernel_dir, name))

    # -- interface ---------------------------------------------------------
    def describe(self):
        return {
            "id": self.id, "kind": self.kind, "version": self.version,
            "provider": "NASA/JPL NAIF",
            "sources": [{"file": n, "type": t, "role": r,
                         "bytes": os.path.getsize(os.path.join(self.kernel_dir, n))} for n, t, r in self.KERNELS],
            "sourceUrl": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/",
            "toolkit": sp.tkvrsn("toolkit"),
            "frame": self.FRAME,
            "frameNote": "DE440 lunar mean-Earth/polar-axis frame; planetocentric latitude, east-positive longitude",
            "observer": "MOON (centre); site parallax applied by the caller",
            "timeSystem": "UTC input, converted to TDB with naif0012.tls (TDB = UTC + 69.184 s in 2017-2030+)",
            "aberration": self.abcorr,
            "aberrationNote": "LT+S: apparent position (one-way light time and stellar aberration), "
                              "the direction in which the body is actually seen",
            "coverage": dict(zip(("startUtc", "endUtc"), self.coverage())),
        }

    def coverage(self):
        cover = sp.spkcov(os.path.join(self.kernel_dir, "de440s.bsp"), 301)
        start, end = sp.wnfetd(cover, 0)
        f = "YYYY-MM-DDTHR:MN:SC ::UTC"
        return sp.timout(start, f) + "Z", sp.timout(end, f) + "Z"

    def vectors(self, utc_iso):
        et = sp.str2et(utc_iso.replace("Z", ""))
        return self.vectors_et(et)

    def vectors_et(self, et):
        s, _ = sp.spkpos("SUN", et, self.FRAME, self.abcorr, "MOON")
        e, _ = sp.spkpos("EARTH", et, self.FRAME, self.abcorr, "MOON")
        return {"sun": np.array(s), "earth": np.array(e)}

    def query(self, site, utc_iso):
        v = self.vectors(utc_iso)
        out = {}
        for body in ("sun", "earth"):
            az, el = az_el(v[body], site["lat"], site["lon"], site.get("elevationM") or 0)
            out[body] = {"az": az, "el": el, "distKm": float(np.linalg.norm(v[body]))}
        return out

    # -- helper ------------------------------------------------------------
    def et(self, utc: dt.datetime):
        return sp.str2et(utc.strftime("%Y-%m-%dT%H:%M:%S"))
