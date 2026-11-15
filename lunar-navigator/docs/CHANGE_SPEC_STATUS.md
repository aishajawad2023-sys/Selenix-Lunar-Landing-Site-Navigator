# V0.1 → V0.2 change specification: status

Status of every item in the change specification and the consolidated improvement list.
"Done" means it can be seen in `dist/app/index.html`.

## Credibility fixes

| Item | Status |
|---|---|
| Reconcile timeline power numbers with the default-assumptions tag | Done. Wattage removed from the timeline; battery % carries "est., default panel" until inputs are confirmed |
| Split "needs review" into sub-states | Done. terrain / close to threshold / both / grazing samples / default assumptions, each with its check in the proof |
| Timing on battery and dark-period cells | Done. e.g. "5 d 16 h from T+0 h", "0% at T+27 h" |
| Verify the primary demo site's coordinates | Done. Mons Mouton = IM-2 Athena position from LROC (84.7906°S, 29.1957°E), status verified |
| One coordinate convention | Done. Planetocentric latitude, east-positive longitude in [−180°, 180°], MOON_ME, stated in the site table and evidence |

## Presentation and density

| Item | Status |
|---|---|
| One persistent banner instead of per-cell warnings | Done. Appears only when a shown scenario lacks terrain or a validation check fails |
| Implications collapsed to one-line entries with expand | Done. Three entries per scenario, "Show n more" |
| Duplicates factored (panel orientation, shadows) | Done. Shown once under "All scenarios" with per-scenario chips |
| Requirement cells: value + verdict chip + tap for rationale | Done |
| "What changed and why" as a three-bullet difference | Done. Changed / Effect / Verdicts |
| Mission-log tone | Done. Imperative or indicative one-liners in `data/rules.json` |
| Date sweep as a colour scale | Done. Green 100%, amber 60–99%, hatched red below 60%; values on hover |
| Validation status as a persistent chip | Done. Opens the validation drawer |

## Demo flow

| Item | Status |
|---|---|
| Five-beat narrative | Done. Briefing → Baseline → Slip → Alternative → Decide |
| Reset / Next step / Show me why always visible | Done |
| Scenarios revealed one at a time | Done |
| Beat 5 ends on the trade-off, not a winner | Done. Table plus four sentences |
| Evidence drawer on every number, with templates | Done. Geometry-derived, model-derived, user-input, plus requirement rationale, rule and source-data views |

## Scientific credibility

| Item | Status |
|---|---|
| Terrain masks preloaded for demo sites | Done. 7 sites; file upload kept as a manual override |
| Horizons check on the demo dates, target under 0.001° | Done. Worst 0.00002° over 30 comparisons |
| Illumination benchmark against published LOLA products | Done. 45 points against NASA PGDA maps; tolerance and its limits documented |
| No coordinate left "to verify" | Done. 4 verified, 4 corrected with citations |
| Engine/kernel provenance chip | Done. Kernel files, coverage, frame, time system, aberration, terrain, tolerance, versions, timestamps |
| Quality vocabulary on every number | Done. Shown on hover and in the drawer |
| Near-horizon cases classified "uncertain" | Done. ±0.27° tolerance, shown in evidence; missing terrain also yields uncertain, never visible |

## Demo polish

| Item | Status |
|---|---|
| Non-demo sites behind "show all sites" | Done |
| "Add a site" behind a toggle | Done, together with the mask override |
| Date sweep precomputed as static JSON, stated on screen | Done. Falls back to live computation, and says so, if duration or antenna elevation differ |
| Rename the slip button | Done. "Duplicate → shift date +21 d" |
| Time playhead on the horizon view | Done. Solid trace so far, dotted to come, synced to the slider, with Play |
| Hardware and antenna inputs functional | Done. Drawer from the header chip |
| Sweep title and metric toggle | Done. "Sunlit % by site and date" / "Earth-visible % by site and date" |

## Engineering items

| Item | Status |
|---|---|
| One adapter (SPICE geometry) to the interface | Done. `precompute/adapters.py`, mirrored by `SpiceTableAdapter` in `src/engine.js`; `docs/INTERFACES.md` |
| Indicator record store to the schema | Done. `schemas/indicator-record.schema.json`, `Engine.createStore()` |
| Requirement checker emitting proof objects | Done. `schemas/proof-object.schema.json`, `Engine.checkRequirement()` |
| Scenario comparison as the central feature | Done. The guided flow and workspace are built around it |

## Not done, with disposition

| Item | Disposition |
|---|---|
| "Mark verified" / "change source" actions in the site table (5.7) | Dropped: no site is left to verify. Sources are in `data/sites.json` |
| "Run now" buttons on validation checks | Not applicable in a static build: Horizons and the benchmark need network and DEM access, so they run offline and their results are shipped. The browser regression does run live |
| Rehearsal on a projector with an unfamiliar viewer (6.5) | For the team. Layout verified at 1920×1080 with no horizontal scroll |
| "What this tool does not claim" preserved verbatim from V0.1 | The V0.1 text was not available here; the block states the same three points plus the V1 non-goals. Replace with the exact wording if required |
| Power, RF, thermal, relay, 3D globe, accounts | Out of scope by both specifications. Power stays as a labelled estimate |
