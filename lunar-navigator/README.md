# Lunar Mission Decision-Support Navigator

A static, client-side decision-support tool for lunar south-pole landing sites and dates. Heavy
science is precomputed offline in Python (SPICE ephemeris, LOLA horizon masks). The browser runs the
scenario engine, requirement checker and rule-based implications. There is no backend.

Wording discipline: verdicts are **meets / needs review / does not meet / unknown**, never "feasible".
Fidelity rule: without a terrain mask, a visibility-dependent requirement cannot read "meets" (it shows
"needs review (no terrain)"). A geometry-only *failure* still stands, because terrain can only reduce
visibility.

## Demo (defaults)

| Scenario | Site | T+0 (UTC) | Sunlit | Earth visible (≥ 2°) | Story |
|---|---|---|---|---|---|
| A | Mons Mouton plateau | 2027-08-11 12:00, 10 d | 100% | 70% | Baseline: meets sun, darkness and DTE requirements |
| B | Mons Mouton plateau | 2027-09-01 12:00 (+21 d slip) | 44% | 8.5% | Lands in darkness; first sunrise T+5 d 14 h; battery hits its DoD floor at T+27 h |
| C | Connecting Ridge | 2027-09-01 12:00 | 100% | 0% | Power solved, but no direct-to-Earth: relay needed (trade-off) |

All values use LOLA terrain masks. Hardware defaults are a 2 m² vertical sun-tracking array, 28%
efficiency, 10% losses, 150 W load, 5000 Wh battery, 80% DoD and 2° minimum antenna elevation. They
are marked *user-assumption*, and power verdicts stay at "needs review" until the user confirms them.

Suggested walk-through: section 2 verdicts and "what changed and why", then section 3 implications
(R9 landing in darkness, R4 brownout, R8 no DTE), then section 4 timeline cursor and section 5
horizon view. Then use the section 6 date sweep to find a better date, and click any number to open
its evidence.

## Layout

```
precompute/            offline Python (python -I, numpy, spiceypy, matplotlib, pillow)
  make_ephemeris.py    Sun/Earth vectors in MOON_ME from NAIF SPICE (DE440 + Moon PA DE440), hourly 2026-2030
  horizon_mask.py      LOLA polar DEMs -> data/horizons/horizon_<siteId>.json (360 values) + docs/masks/*.png
  pole_map.py          shaded-relief maps for the UI (data/polemap*.png)
  geom.py, refsim.py   Python reference of the engine conventions
  validate.py          physical-limit, libration, azimuth, terrain, illumination checks; tests/reference.json
  horizons_check.py    independent cross-check against the JPL Horizons API
data/                  ephemeris.bin(+meta), sites, requirements, rules, sources, horizons/, validation
src/engine.js          all maths, pure functions, no DOM (simulate, checkRequirement, evalRule, evidence)
src/app.js             UI; src/index.template.html, src/styles.css
tests/regression.js    JS engine vs Python reference (node tests/regression.js)
build.py               inlines everything into dist/index.html (~2.2 MB, self-contained)
docs/masks/            each horizon mask plotted beside LOLA shaded relief (terrain sanity check)
```

## Conventions (fixed)

- Frame MOON_ME (DE440 lunar mean-Earth/polar axis), km. The site is on a sphere of R = 1737.4 km plus elevation.
- Azimuth 0° = local north, increasing clockwise (90° = east). Elevation is from the local tangent plane.
- Time is indexed by UTC (TDB = UTC + 69.184 s; there is no leap second in the window). The browser steps
  every 10 min, linearly interpolating the hourly table. MET starts at T+0.
- Visibility uses the disc centre. Earth also needs the minimum antenna elevation. No refraction.
  Earth parallax is included (site-to-Earth vector).
- Power: P = A·η·1361·(1 AU/r)²·cosθ·sunVisible·(1 − losses), with cosθ = sin(el) (horizontal),
  cos(el)·cos(az − φp) (vertical-fixed), or cos(el) (vertical-tracking).
- Battery: constant load, starts at the initial charge, clamped to capacity. Discharge stops at the
  DoD floor (brownout time recorded). Required storage = load × longest dark gap / DoD.
- LOLA DEM projection (verified on Shackleton and Malapert): r = 2R·tan(π/4 + lat/2);
  sample = S0 + r·sin(lon)/scale, line = L0 − r·cos(lon)/scale (0° E up, 90° E right).

## Regenerating the data

```bash
pip install -r precompute/requirements.txt
# SPICE kernels -> precompute/kernels/ (from https://naif.jpl.nasa.gov/pub/naif/generic_kernels/):
#   lsk/naif0012.tls spk/planets/de440s.bsp pck/moon_pa_de440_200625.bpc fk/satellites/moon_de440_250416.tf pck/pck00011.tpc
python precompute/make_ephemeris.py
# LOLA DEMs (+.LBL) from https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/ into a separate folder:
#   LDEM_85S_40M, LDEM_80S_80M, LDEM_75S_120M (~115 MB each)
cd precompute
python horizon_mask.py --dem-dir /path/to/dems --refine --plots ../docs/masks   # --refine only once
python pole_map.py --dem-dir /path/to/dems
python horizons_check.py      # needs network access to ssd.jpl.nasa.gov
python validate.py
cd .. && node tests/regression.js && python build.py
```

Rules, requirement thresholds and site metadata are JSON in `data/` and can be edited without code
changes. Run `python build.py` afterwards.

## Validation (all shown in-app, section 9)

| Check | Result |
|---|---|
| Sun elevation at 90°S, 2026-2030 | −1.59° to +1.59° (expected ±~1.6°) |
| Earth elevation at 90°S | −7.10° to +6.61° (expected ±~7°) |
| Sub-Earth point (libration) | mean −0.07°, 0.02°; ±8.05° lon, ±6.86° lat |
| Azimuth convention | a point due east reads 90.000°; a synthetic DEM wall due east appears at 94° (1° bins, 5 sub-rays) |
| JPL Horizons, 3 sites × 3 dates × Sun/Earth | worst difference 0.0059°, almost all of it the light-time aberration we omit |
| JS engine vs Python reference | worst difference 7e-15°, no visibility mismatches |
| Terrain sanity | Shackleton floor horizon 19.8–23.6°; rim −2.5 to 1.1° (see `docs/masks/`) |
| Illumination (Sun centre above terrain, 2026-2030) | Connecting Ridge 88.4%, Shackleton rim 81.7%, de Gerlache rim 80.8%, Malapert 72.0%, Shackleton floor 0.0% |

The illumination figures sit inside published ranges (Mazarico et al. 2011; Gläser et al. 2018). Those
are plausibility bounds, not point comparisons: they depend on exact coordinates, epoch span and the
full-disc versus centre definition.

## Handoff TODO status

1. Terrain masks: **done** for 7 sites from real LOLA DEMs (multi-resolution 40/80/120 m, 200 km rays),
   plotted against shaded relief and embedded in the build. Shiv Shakti (69°S) is outside these tiles
   and intentionally stays geometry-only.
2. Coordinates and elevations: elevations come from LOLA. Ridge and rim sites were refined to the local
   DEM high point. Only Shiv Shakti and 90°S are verified; **the rest still need checking against
   primary sources** (`coordStatus` in `sites.json`).
3. Horizons cross-check: **done** (3 dates, 3 sites).
4. Illumination benchmark: **done** as plausibility bounds; a point-by-point comparison is still to do.
5. Final requirement thresholds and rule wording: JSON only (`data/requirements.json`, `data/rules.json`).
6. Deploy: the GitHub Pages workflow is included (enable Pages → GitHub Actions). Record a backup demo video.
7. Pitch materials.

## Known limits

Disc-centre visibility (no partial discs). No aberration (~0.006°). Masks use 1° bins and 2 m observer
height, and do not model boulders or the lander. Earth visibility is line of sight, not a link budget,
and relays are out of scope. Power ignores dust, self-shadowing, temperature, degradation and heaters
beyond the constant load. Time to sunset or sunrise is empty when no transition falls inside the
mission. The R6 comparison rule runs in `app.js`, not `evalRule`. Google Fonts fall back to system
fonts offline. The QuickMap and Moon Trek links open the tools; coordinates are copied manually.
