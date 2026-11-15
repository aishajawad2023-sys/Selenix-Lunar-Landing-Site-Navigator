# SELENIX platform

A static, client-side decision-support tool for lunar south-pole sites and dates. Science is
precomputed offline in Python (SPICE geometry, LOLA terrain horizons, validation). The browser runs
the scenario engine, the requirement checker and the rule-based mission log. There is no backend.

Pipeline: scenario inputs → time generation → **geometry adapter** (SPICE) → local frame →
**terrain adapter** (LOLA horizon) → visibility classification → interval aggregation →
**indicator records** → **requirement proofs** → mission log → scenario comparison.

## The guided demo (five steps)

| Step | What appears | Result with the default data |
|---|---|---|
| 1 Briefing | Mission, site, date, assumed hardware, requirements. Nothing calculated. | |
| 2 Baseline | Scenario A: Mons Mouton (IM-2 Athena site), 11 Aug 2027 12:00 UTC, 10 days | Sun visible 100%, Earth in view 68%; all four visibility requirements met; battery margin in review until the hardware values are confirmed |
| 3 Slip | Scenario B: same site, 21 days later | Sun visible 43%, Earth 6.4%; lands in darkness until T+5 d 16 h; estimated battery reaches its floor at T+27 h; 5 not met |
| 4 Alternative | Scenario C: Connecting Ridge on the slipped date | Sun visible 100%, Earth 0%: no direct-to-Earth geometry |
| 5 Decide | Trade-off table and date sweep. No winner is picked. | Delaying to 7 Sep 2027 restores the baseline conditions at the original site |

Controls stay visible throughout: **Reset demo**, **Next step**, **Show me why** (opens the evidence
for the number that changed most), and **Explore freely** for the full editable workspace.

Default thresholds follow the V0.2 change specification: Sun visible ≥ 60%, longest Sun obstruction ≤ 72 h,
Earth visible ≥ 50%, longest gap without Earth ≤ 96 h, battery ≥ 10% above its 20% floor.

The timeline's **Show windows** lists every visible, uncertain and obstructed window per scenario with
start, end and duration (V1 specification 6.3).

Verdicts are *meets / needs review / does not meet / unknown*, never "feasible". "Needs review" always
says why: terrain, close to threshold, both, grazing samples, or default assumptions.

## Layout

```
precompute/              offline Python (numpy, spiceypy, matplotlib, pillow)
  adapters.py            adapter interface + SpiceGeometryAdapter (NAIF SPICE)
  make_ephemeris.py      Sun/Earth vectors in MOON_ME, LT+S, hourly 2026-2030 -> data/ephemeris.bin
  horizon_mask.py        LOLA DEMs -> data/horizons/horizon_<siteId>.json + docs/masks/*.png
  pole_map.py            map layers: shaded relief + published illumination and Earth visibility
  benchmark_illumination.py   comparison with NASA PGDA published illumination maps
  horizons_check.py      independent check against the JPL Horizons API
  validate.py            validation suite -> data/validation.json, tests/reference.json
  make_sweep.js          static date sweep with the browser engine -> data/sweep.json
  geom.py, refsim.py     Python reference of the browser engine
data/                    config, hardware defaults, sites, requirements, rules, sources, ephemeris,
                         horizons/, maps/, sweep, validation, benchmark
schemas/                 JSON Schemas: indicator record, proof object, adapter descriptor, sample record
src/engine.js            all maths and decision logic, no DOM
src/app.js               UI; src/index.template.html, src/styles.css; src/landing.html + src/assets/
tests/regression.js      JS engine vs Python reference, classifier, proofs, store, schema fields
build.py                 -> dist/index.html (landing) and dist/app/index.html (platform)
docs/                    INTERFACES.md, CHANGE_SPEC_STATUS.md, masks/, benchmark_illumination.png
```

## Conventions (fixed)

- Frame MOON_ME (DE440 mean-Earth/polar-axis), km. Planetocentric latitude, east-positive longitude
  in [−180°, 180°]. Site on a sphere of radius 1737.4 km plus elevation.
- Azimuth 0° = local north, clockwise. Elevation from the local tangent plane. No refraction.
- Apparent positions (SPICE `LT+S`). UTC time base (TDB = UTC + 69.184 s; no leap second in the window).
  Hourly table, linear interpolation to 10-minute samples.
- Visibility: `visible` when elevation > limit + 0.27°, `obstructed` when below limit − 0.27°,
  otherwise `uncertain`. The limit is the terrain horizon (for Earth, the higher of that and the
  minimum antenna elevation). Missing terrain is never a clear horizon: such samples are uncertain,
  values are shown as bounds, and visibility requirements cannot read "meets".
- Terrain horizons: LOLA LDEM 40/80/120 m, 1° azimuth bins (max of 5 sub-rays), rays to 200 km,
  observer 2 m, terrain closer than 120 m treated as the site (see the benchmark below).
- Power (labelled estimate): P = A·η·1361·(1 AU/r)²·cosθ·visible·(1 − losses). Battery: constant
  load, charge clamped to capacity, discharge stops at the depth-of-discharge floor.
- LOLA polar stereographic: r = 2R·tan(π/4 + lat/2); sample = S0 + r·sin(lon)/scale,
  line = L0 − r·cos(lon)/scale (0° E up, 90° E right).

## Validation (12 checks, shown in the app's Validation chip)

| Check | Result | Tolerance |
|---|---|---|
| JPL Horizons, 30 Sun/Earth angle comparisons (3 sites, both demo dates, sweep ends, one off-hour time) | worst 0.00002° | under 0.001° |
| Published LOLA illumination maps (NASA PGDA product 69), 45 points | Sun: median 0.97, RMS 1.97, worst 5.82 points. Earth: median 0.24, RMS 1.75, worst 7.4 points | median under 1.5 (Sun), 1.0 (Earth); RMS under 3 |
| Browser engine vs Python reference, 4 scenarios | 7e-15°, identical states | 1e-9° |
| Sun / Earth elevation at 90°S | ±1.59° / −7.10° to +6.61° | ±1.7° / ±7.5° |
| Sub-Earth point | mean (−0.07°, 0.02°), ±8.05° lon, ±6.86° lat | |
| Azimuth convention (geometry and synthetic DEM wall) | 90.000° and 94° | 0.01° / 5° |
| Terrain sanity | Shackleton floor horizon 19.8–23.6°, rim −2.6 to 1.0° | |
| Missing terrain never "visible" | 0 of 1441 samples | 0 |
| Site coordinates | 4 verified, 4 corrected against a cited source | none left to verify |
| Kernel coverage | table inside DE440s coverage | |

**About the illumination benchmark.** The published maps give the share of hourly timesteps over
18.6 years in which any part of the Sun (or Earth) disc is visible, computed by the LOLA team on a
60 m DEM. We compute the same quantity with our own pipeline at the same pixels. Agreement depends
strongly on how terrain within a few DEM cells of the observer is treated: with rays starting one
40 m cell away, ridge-crest pixels came out 10 to 40 points too dark. Excluding the nearest 120 m
(three cells) gives the figures above and is now the documented setting. The median differences are
sub-percent; individual points are not, mainly because of DEM release and resolution differences.

## Regenerating the data

```bash
pip install -r precompute/requirements.txt
# kernels -> precompute/kernels/ from https://naif.jpl.nasa.gov/pub/naif/generic_kernels/
#   lsk/naif0012.tls spk/planets/de440s.bsp pck/moon_pa_de440_200625.bpc fk/satellites/moon_de440_250416.tf pck/pck00011.tpc
# DEMs (+.LBL) from https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/: LDEM_85S_40M, LDEM_80S_80M, LDEM_75S_120M
# published maps (+.LBL) from https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/:
#   AVGVISIB_85S_060M_201608[_EARTH], AVGVISIB_75S_120M_201608[_EARTH]
cd precompute
python make_ephemeris.py
python horizon_mask.py --dem-dir DEMS --plots ../docs/masks
python pole_map.py --dem-dir DEMS --illum-dir ILLUM
python benchmark_illumination.py --dem-dir DEMS --illum-dir ILLUM
python horizons_check.py            # needs network access to ssd.jpl.nasa.gov
python validate.py
cd .. && node precompute/make_sweep.js && node tests/regression.js && python build.py
```

Rules, requirement thresholds, hardware defaults, tolerance and site metadata are JSON in `data/`.
Edit them and run `python build.py`; no code change is needed.

## Known limits

Disc-centre classification with a tolerance band, not a partial-disc model. Terrain finer than the
DEM, boulders and the lander itself are not modelled. Earth visibility is line of sight, not a link
budget; relays are out of scope. Power and battery are simple labelled estimates. Samples are 10
minutes apart, so transitions are known to one step. The sweep uses a 3-day grid. The comparison
difference (rule R6) is computed in `app.js`. QuickMap and Moon Trek are linked, not embedded.
