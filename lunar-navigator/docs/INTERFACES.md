# Interfaces and schemas

SELENIX keeps data connectors, calculation, decision logic and presentation apart. This page is the
contract between them. The JSON Schemas are in `schemas/`; `tests/regression.js` exercises all of it.

## 1. Adapter interface (integration layer)

Every adapter, in Python and in JavaScript, exposes the same four things:

| Member | Meaning |
|---|---|
| `id`, `kind`, `version` | Stable identifiers. `kind` is `geometry` or `terrain`. |
| `describe()` | Provenance descriptor (`schemas/adapter-descriptor.schema.json`): sources, frame, time system, settings. |
| `coverage()` | Validity window. Callers check it before querying; out-of-coverage is an error, never a guess. |
| `query(site, time)` | The adapter's product for one site and instant. |

**Geometry adapters** return, for `sun` and `earth`: `{ az, el, distKm }` (azimuth 0 = local north,
clockwise; elevation above the local tangent plane of a sphere of radius 1737.4 km + site elevation),
and `vectors(time)` gives Moon-centred MOON_ME position vectors in km.

| Implementation | Where | Backed by |
|---|---|---|
| `SpiceGeometryAdapter` | `precompute/adapters.py` | NAIF SPICE via spiceypy: `spkpos(target, et, 'MOON_ME', 'LT+S', 'MOON')` |
| `TableGeometryAdapter` | `precompute/refsim.py` | the precomputed table, same interpolation as the browser |
| `SpiceTableAdapter` | `src/engine.js` | the precomputed table inlined in the page |

**Terrain adapters** expose `horizonAt(azimuthDeg)`. `HorizonMaskAdapter` (`src/engine.js`) wraps one
`horizon_<siteId>.json`. When no mask exists the adapter is `null`, and the engine classifies every
above-horizon sample as *uncertain*: missing terrain is never treated as an unobstructed horizon.

A new source (another ephemeris, a different DEM, a relay orbit) plugs in by implementing this
interface; the engine, checker and UI do not change.

## 2. Visibility classification

For each sample: `visible` when `elevation > limit + tolerance`, `obstructed` when
`elevation < limit - tolerance`, otherwise `uncertain`. The limit is the terrain horizon at the body's
azimuth (for Earth, the higher of that and the minimum antenna elevation). Tolerance and sampling step
are in `data/config.json` and shown in the provenance panel.

Every metric is aggregated twice: *conservative* (uncertain counted as not visible) and *optimistic*
(uncertain counted as visible). The displayed value is the conservative one when terrain exists and
the optimistic one, marked as a bound, when it does not. Both are kept in `bounds`.

## 3. Indicator record store

`Engine.indicatorRecord(run, metricId)` builds one record per indicator
(`schemas/indicator-record.schema.json`): value, unit, classification, quality state, bounds,
worst-case time, location and frame, time window and standard, method with parameters, input
identifiers, sources with versions, limitations, validation references, scenario hash and code
version. `Engine.createStore()` holds them: `put`, `get`, `list(filter)`, `lineage(id)`.

The evidence drawer renders a record directly, so a number without a record cannot be displayed.

## 4. Requirement checker and proof objects

`Engine.checkRequirement(requirement, run, { marginPct })` returns a proof object
(`schemas/proof-object.schema.json`). Checks, in order:

1. `inputs-present`: missing value or threshold gives `unknown`.
2. `threshold`: the plain comparison on the displayed value.
3. `terrain-data`: without terrain a passing visibility requirement becomes `needs review (terrain)`;
   a failing one stands, because terrain can only reduce visibility.
4. `uncertain-samples`: if the conservative and optimistic values give different answers, the verdict
   is `needs review (grazing samples)`.
5. `margin`: within `marginPct` of the threshold gives `needs review (close to threshold)`.
6. `assumptions-confirmed`: a passing power requirement on unconfirmed hardware values gives
   `needs review (default assumptions)`.

Terrain plus close-to-threshold is reported as `both`. The proof carries the observed value, when the
worst case occurs, both bounds, each step with its explanation, and the indicator record ids it rests on.

## 5. Sample result record

`Engine.sampleRecord(run, k, body)` gives the minimum result record of the V1 specification
(`schemas/sample-record.schema.json`) for one timestamp: azimuth, elevation, terrain horizon,
visibility state, quality state, and method and data versions.

## 6. Rules (mission log)

`data/rules.json`: `id`, `condition`, `log` (one-line entry), `template` (detail), `vars`, `inputs`,
`qualityClass`, optional `shared` + `sharedLog` + `chip`. Wording is data. `Engine.evalRule` fills the
templates; nothing is free-text generated.
