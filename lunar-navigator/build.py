"""Build the static site into dist/:

  dist/index.html        SELENIX landing page (src/landing.html + screenshots in dist/assets/)
  dist/app/index.html    the platform: one self-contained file (data, engine and UI inlined)

Usage: python build.py   (run after any change to src/ or data/; no third-party packages needed)
"""
import base64
import datetime as dt
import glob
import json
import os
import shutil

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
    maps_meta = jload("data/maps/maps.json")
    imgs = {os.path.basename(p)[:-4]: b64(os.path.relpath(p, ROOT)) for p in sorted(glob.glob(os.path.join(ROOT, "data", "maps", "*.jpg")))}
    data = {
        "builtUtc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "config": jload("data/config.json"),
        "hardware": jload("data/hardware.json"),
        "ephemerisMeta": jload("data/ephemeris.meta.json"),
        "ephemerisB64": b64("data/ephemeris.bin"),
        "sites": jload("data/sites.json"),
        "requirements": jload("data/requirements.json"),
        "rules": jload("data/rules.json"),
        "sources": jload("data/sources.json"),
        "validation": jload("data/validation.json"),
        "sweep": jload("data/sweep.json"),
        "horizons": horizons,
        "maps": {"meta": maps_meta, "img": imgs},
        "reference": jload("tests/reference.json"),
    }
    html = read("src/index.template.html")
    payload = "window.NAV_DATA = " + json.dumps(data, separators=(",", ":")).replace("</", "<\\/") + ";"
    html = html.replace("/*STYLE*/", read("src/styles.css")).replace("/*DATA*/", payload)
    html = html.replace("/*ENGINE*/", read("src/engine.js")).replace("/*APP*/", read("src/app.js"))
    os.makedirs(os.path.join(ROOT, "dist", "app"), exist_ok=True)
    out = os.path.join(ROOT, "dist", "app", "index.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {out} ({os.path.getsize(out) / 1e6:.2f} MB)")

    landing = os.path.join(ROOT, "src", "landing.html")
    if os.path.exists(landing):
        v = data["validation"]
        bm, hz = v.get("benchmark") or {}, v.get("horizonsCheck") or {}
        page = read("src/landing.html")
        repl = {
            "{{CHECKS_PASSED}}": str(v["summary"]["passed"]), "{{CHECKS_TOTAL}}": str(v["summary"]["total"]),
            "{{HORIZONS_WORST}}": f"{hz.get('worstAbsDiffDeg', 0):.5f}", "{{HORIZONS_N}}": str(len(hz.get("rows", []))),
            "{{BENCH_SUN}}": str(bm.get("sun", {}).get("all", {}).get("medianAbs", "")), "{{BENCH_EARTH}}": str(bm.get("earth", {}).get("all", {}).get("medianAbs", "")),
            "{{BENCH_N}}": str(bm.get("sun", {}).get("all", {}).get("n", "")), "{{BUILT}}": data["builtUtc"][:10],
        }
        for k, val in repl.items():
            page = page.replace(k, val)
        with open(os.path.join(ROOT, "dist", "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
        assets = os.path.join(ROOT, "src", "assets")
        if os.path.isdir(assets):
            shutil.copytree(assets, os.path.join(ROOT, "dist", "assets"), dirs_exist_ok=True)
        print("wrote dist/index.html (landing)")


if __name__ == "__main__":
    main()
