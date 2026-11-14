"""Inline everything into dist/index.html (self-contained, works offline except web fonts).

Usage: python build.py   (run after any change to src/ or data/)
"""
import base64
import datetime as dt
import glob
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))


def read(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return f.read()


def jload(p):
    return json.loads(read(p))


def b64(p):
    with open(os.path.join(ROOT, p), "rb") as f:
        return base64.b64encode(f.read()).decode()


def main():
    horizons = {}
    for p in sorted(glob.glob(os.path.join(ROOT, "data", "horizons", "horizon_*.json"))):
        rec = json.load(open(p))
        horizons[rec["siteId"]] = rec
    with open(os.path.join(ROOT, "data", "ephemeris.bin"), "rb") as f:
        eph_b64 = base64.b64encode(f.read()).decode()
    with open(os.path.join(ROOT, "data", "polemap.png"), "rb") as f:
        png_b64 = base64.b64encode(f.read()).decode()
    data = {
        "builtUtc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ephemerisMeta": jload("data/ephemeris.meta.json"),
        "ephemerisB64": eph_b64,
        "sites": jload("data/sites.json"),
        "requirements": jload("data/requirements.json"),
        "rules": jload("data/rules.json"),
        "sources": jload("data/sources.json"),
        "validation": jload("data/validation.json"),
        "horizons": horizons,
        "polemap": {"meta": jload("data/polemap.json"), "png": png_b64},
        "polemapZoom": {"meta": jload("data/polemap_zoom.json"), "png": b64("data/polemap_zoom.png")},
        "reference": jload("tests/reference.json"),
    }
    html = read("src/index.template.html")
    # </script> cannot appear inside inline JSON
    payload = "window.NAV_DATA = " + json.dumps(data, separators=(",", ":")).replace("</", "<\\/") + ";"
    html = html.replace("/*STYLE*/", read("src/styles.css"))
    html = html.replace("/*DATA*/", payload)
    html = html.replace("/*ENGINE*/", read("src/engine.js"))
    html = html.replace("/*APP*/", read("src/app.js"))
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    out = os.path.join(ROOT, "dist", "index.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {out} ({os.path.getsize(out)/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
