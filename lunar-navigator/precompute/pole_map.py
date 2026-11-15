"""Map layers for the UI (JPEG, polar stereographic, 0 deg E up, 90 deg E right):

  data/maps/relief_region.jpg, relief_pole.jpg     LOLA shaded relief (LDEM_80S_80M, LDEM_85S_40M)
  data/maps/sun_region.jpg, sun_pole.jpg           published average solar illumination (PGDA product 69)
  data/maps/earth_region.jpg, earth_pole.jpg       published average Earth visibility (PGDA product 69)
  data/maps/maps.json                              extents, products, value ranges

The illumination and Earth layers are the LOLA team's published products, shown as context and
used as the benchmark. They are not computed by this tool.
The UI places markers with: x = r sin(lon), y = r cos(lon), r = 2R tan(pi/4 + lat/2).
Usage: python precompute/pole_map.py --dem-dir DIR --illum-dir DIR
"""
import argparse
import json
import os

import numpy as np

from horizon_mask import Dem

PX = 640
VIEWS = {"region": 175.0, "pole": 30.0}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def crop(d, half_km):
    half_px = half_km * 1000 / d.scale
    i0, i1 = int(round(d.l0 - half_px)), int(round(d.l0 + half_px))
    return np.asarray(d.z[i0:i1, i0:i1], dtype=np.float32) * d.factor


def shade(z, cell_m, vexag):
    from matplotlib.colors import LightSource
    step = max(1, z.shape[0] // PX)
    z = z[::step, ::step]
    hs = LightSource(azdeg=315, altdeg=25).hillshade(z, vert_exag=vexag, dx=cell_m * step, dy=cell_m * step)
    zn = (z - z.min()) / (z.max() - z.min())
    return np.clip(0.75 * hs + 0.25 * zn, 0, 1)


def save(arr_rgb, name):
    from PIL import Image
    im = Image.fromarray((np.clip(arr_rgb, 0, 1) * 255).astype(np.uint8)).resize((PX, PX), Image.LANCZOS)
    im.save(os.path.join(ROOT, "data", "maps", name + ".jpg"), quality=82, optimize=True)


def tint(value01, relief, rgb_hi):
    """Dark-to-colour ramp for a 0..1 field, lightly modulated by relief for context."""
    from PIL import Image
    v = np.asarray(Image.fromarray(value01.astype(np.float32)).resize((PX, PX), Image.BILINEAR))
    r = np.asarray(Image.fromarray(relief.astype(np.float32)).resize((PX, PX), Image.BILINEAR))
    lo = np.array([0.05, 0.06, 0.08])
    t = np.clip(v / 0.9, 0, 1)[..., None]            # published maximum is about 0.88
    col = lo + (np.array(rgb_hi) - lo) * (0.15 * t + 0.85 * t ** 2.2 + 0.25 * np.sqrt(t)) / 1.25
    return np.clip(col * (0.85 + 0.3 * r[..., None]), 0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem-dir", required=True)
    ap.add_argument("--illum-dir", required=True)
    a = ap.parse_args()
    os.makedirs(os.path.join(ROOT, "data", "maps"), exist_ok=True)
    dem = {"region": (Dem(os.path.join(a.dem_dir, "LDEM_80S_80M.IMG")), 2), "pole": (Dem(os.path.join(a.dem_dir, "LDEM_85S_40M.IMG")), 1)}
    ill = {"region": "AVGVISIB_75S_120M_201608", "pole": "AVGVISIB_85S_060M_201608"}
    meta = {"px": PX, "orientation": "polar stereographic, 0 deg E up, 90 deg E right", "views": {}}
    for view, half in VIEWS.items():
        d, vex = dem[view]
        relief = shade(crop(d, half), d.scale, vex)
        save(np.repeat(relief[..., None], 3, axis=2), f"relief_{view}")
        sun = Dem(os.path.join(a.illum_dir, ill[view] + ".IMG"))
        earth = Dem(os.path.join(a.illum_dir, ill[view] + "_EARTH.IMG"))
        save(tint(crop(sun, half), relief, (1.0, 0.86, 0.48)), f"sun_{view}")
        save(tint(crop(earth, half), relief, (0.45, 0.74, 1.0)), f"earth_{view}")
        meta["views"][view] = {"halfKm": half, "relief": d.name + " " + d.version, "published": ill[view]}
    meta["layers"] = {
        "relief": {"label": "Shaded relief", "source": "LRO LOLA gridded DEM (PDS)", "classification": "measured"},
        "sun": {"label": "Average solar illumination", "source": "NASA GSFC PGDA product 69 (Mazarico et al. 2011, 2016 update): share of time with any part of the Sun visible, 18.6-year average", "classification": "measured", "url": "https://pgda.gsfc.nasa.gov/products/69", "scale": "dark = 0%, gold = 100%"},
        "earth": {"label": "Average Earth visibility", "source": "NASA GSFC PGDA product 69: share of time with any part of Earth visible, 18.6-year average", "classification": "measured", "url": "https://pgda.gsfc.nasa.gov/products/69", "scale": "dark = 0%, blue = 100%"},
    }
    json.dump(meta, open(os.path.join(ROOT, "data", "maps", "maps.json"), "w"), indent=1)
    print("maps written", os.listdir(os.path.join(ROOT, "data", "maps")))


if __name__ == "__main__":
    main()
