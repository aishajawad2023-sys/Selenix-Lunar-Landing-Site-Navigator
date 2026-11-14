"""Shaded-relief south-pole map for the UI (data/polemap.png + data/polemap.json).

Crops LDEM_80S_80M to a square of +/- HALF_KM around the pole (polar stereographic, 0 deg E up,
90 deg E to the right, as the PDS product) and hill-shades it. The UI places site markers with
the same projection: x = r sin(lon), y = r cos(lon), r = 2R tan(pi/4 + lat/2).
Usage: python precompute/pole_map.py --dem-dir DIR
"""
import argparse
import json
import os

import numpy as np

from horizon_mask import Dem

HALF_KM = 175.0
PX = 640


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem-dir", required=True)
    a = ap.parse_args()
    render(os.path.join(a.dem_dir, "LDEM_80S_80M.IMG"), HALF_KM, "polemap", 2)
    render(os.path.join(a.dem_dir, "LDEM_85S_40M.IMG"), 30.0, "polemap_zoom", 1)


def render(img_path, HALF_KM, name, vexag):
    from matplotlib.colors import LightSource
    from PIL import Image

    d = Dem(img_path)
    half_px = HALF_KM * 1000 / d.scale
    c = d.l0
    i0, i1 = int(c - half_px), int(c + half_px)
    z = np.asarray(d.z[i0:i1, i0:i1], dtype=np.float32) * d.factor
    step = max(1, z.shape[0] // PX)
    z = z[::step, ::step]
    hs = LightSource(azdeg=315, altdeg=25).hillshade(z, vert_exag=vexag, dx=d.scale * step, dy=d.scale * step)
    zn = (z - z.min()) / (z.max() - z.min())
    img = np.clip(0.75 * hs + 0.25 * zn, 0, 1)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    Image.fromarray((img * 255).astype(np.uint8)).resize((PX, PX), Image.LANCZOS).save(os.path.join(root, "data", name + ".png"), optimize=True)
    json.dump({"halfKm": HALF_KM, "px": PX, "product": d.name, "version": d.version,
               "orientation": "0 deg E up, 90 deg E right (polar stereographic)",
               "heightRangeM": [float(z.min()), float(z.max())]},
              open(os.path.join(root, "data", name + ".json"), "w"), indent=1)
    print(name, img.shape)


if __name__ == "__main__":
    main()
