/* SELENIX engine. Pure functions, no DOM. Browser: window.Engine. Node: module.exports.
 *
 * Pipeline: scenario inputs -> time generation -> geometry adapter (SPICE) -> local frame ->
 * terrain adapter (LOLA horizon) -> visibility classification -> interval aggregation ->
 * indicator records -> requirement proofs -> rule-based implications.
 *
 * Conventions (fixed): frame MOON_ME, km; site on a sphere R = 1737.4 km + elevation; planetocentric
 * latitude, east-positive longitude in [-180, 180]; azimuth 0 = local north, clockwise; UTC index;
 * apparent positions (LT+S); no refraction. Visibility is classified against the terrain horizon
 * with a tolerance: visible / uncertain / obstructed. Interfaces: docs/INTERFACES.md, schemas/.
 */
(function (root) {
  'use strict';
  const R_MOON_KM = 1737.4, AU_KM = 149597870.7, SOLAR_CONSTANT = 1361;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const CODE_VERSION = 'selenix-engine 2.0.0';
  const OBSTRUCTED = 0, UNCERTAIN = 1, VISIBLE = 2;
  const STATE_NAME = ['obstructed', 'uncertain', 'visible'];
  const DEFAULT_CONFIG = { toleranceDeg: 0.27, stepMin: 10 };
  const PANEL_TYPES = ['horizontal', 'vertical-fixed', 'vertical-tracking'];

  // ---------------------------------------------------------------- adapters
  /** Geometry adapter over the precomputed SPICE table. Same interface as precompute/adapters.py. */
  function SpiceTableAdapter(buffer, meta) {
    const data = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    if (data.length !== meta.count * meta.valuesPerRecord) throw new Error('ephemeris size mismatch');
    const t0 = meta.startEpochMs, stepMs = meta.stepSec * 1000, k = meta.valuesPerRecord, count = meta.count;
    const src = meta.adapter || {};
    const self = {
      id: 'spice-table', kind: 'geometry', version: '2.0.0', meta,
      describe() {
        return { id: self.id, kind: self.kind, version: self.version, derivedFrom: src.id + ' ' + src.version,
          provider: src.provider, sources: src.sources, sourceUrl: src.sourceUrl, toolkit: src.toolkit, frame: src.frame, frameNote: src.frameNote,
          timeSystem: src.timeSystem, aberration: src.aberration, aberrationNote: src.aberrationNote,
          sampling: `${meta.stepSec} s table, ${meta.interpolation}`, coverage: self.coverage(), generatedUtc: meta.generatedUtc };
      },
      coverage() { return { startUtc: new Date(t0).toISOString(), endUtc: new Date(t0 + (count - 1) * stepMs).toISOString(), startMs: t0, endMs: t0 + (count - 1) * stepMs }; },
      vectors(tMs) {
        const x = (tMs - t0) / stepMs, i = Math.floor(x);
        if (i < 0 || i + 1 >= count) return null;
        const f = x - i, a = i * k, b = a + k, v = new Array(6);
        for (let j = 0; j < 6; j++) v[j] = data[a + j] * (1 - f) + data[b + j] * f;
        return { sun: [v[0], v[1], v[2]], earth: [v[3], v[4], v[5]] };
      },
      query(site, tMs) {
        const v = self.vectors(tMs); if (!v) return null;
        const fr = site.pos ? site : siteFrame(site);
        const s = azEl(v.sun, fr), e = azEl(v.earth, fr);
        return { sun: { az: s.az, el: s.el, distKm: s.dist }, earth: { az: e.az, el: e.el, distKm: e.dist } };
      },
    };
    return self;
  }
  /** Terrain adapter over one horizon_<siteId>.json record. Missing terrain is never a 0-degree horizon. */
  function HorizonMaskAdapter(rec) {
    if (!rec) return null;
    const mask = rec.maskDeg;
    return {
      id: 'lola-horizon', kind: 'terrain', version: '2.0.0', rec,
      describe() { return { id: 'lola-horizon', kind: 'terrain', product: rec.dem && rec.dem.product, version: rec.dem && rec.dem.version, resolutionM: rec.dem && rec.dem.resolutionM,
        extentKm: rec.dem && rec.dem.extentKm, observerHeightM: rec.observerHeightM, azConvention: rec.azConvention, method: rec.method, userSupplied: !!rec.uploaded, sourceUrl: rec.dem && rec.dem.source }; },
      horizonAt(az) { const a = ((az % 360) + 360) % 360, i = Math.floor(a), f = a - i; return mask[i % 360] * (1 - f) + mask[(i + 1) % 360] * f; },
    };
  }

  // ---------------------------------------------------------------- geometry
  function enu(latDeg, lonDeg) {
    const la = latDeg * D2R, lo = lonDeg * D2R, cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
    return { east: [-so, co, 0], north: [-sl * co, -sl * so, cl], up: [cl * co, cl * so, sl] };
  }
  function siteFrame(site) {
    const b = enu(site.lat, site.lon), r = R_MOON_KM + (site.elevationM || 0) / 1000;
    return { ...b, pos: [b.up[0] * r, b.up[1] * r, b.up[2] * r] };
  }
  function azEl(target, fr) {
    const v0 = target[0] - fr.pos[0], v1 = target[1] - fr.pos[1], v2 = target[2] - fr.pos[2];
    const x = v0 * fr.east[0] + v1 * fr.east[1] + v2 * fr.east[2];
    const y = v0 * fr.north[0] + v1 * fr.north[1] + v2 * fr.north[2];
    const z = v0 * fr.up[0] + v1 * fr.up[1] + v2 * fr.up[2];
    let az = Math.atan2(x, y) * R2D; if (az < 0) az += 360;
    return { az, el: Math.atan2(z, Math.hypot(x, y)) * R2D, dist: Math.hypot(v0, v1, v2) };
  }
  function cosIncidence(panelType, sunAz, sunEl, panelAzDeg) {
    if (panelType === 'horizontal') return Math.max(0, Math.sin(sunEl * D2R));
    if (panelType === 'vertical-fixed') return Math.max(0, Math.cos(sunEl * D2R) * Math.cos((sunAz - panelAzDeg) * D2R));
    return Math.max(0, Math.cos(sunEl * D2R));
  }
  /** visible when el > threshold + tol; obstructed when el < threshold - tol; otherwise uncertain. */
  function classify(el, threshold, tol) { return el > threshold + tol ? VISIBLE : (el < threshold - tol ? OBSTRUCTED : UNCERTAIN); }

  // ---------------------------------------------------------------- simulation
  function simulate({ geometry, terrain, site, scenario, hw, config }) {
    const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
    const stepMin = cfg.stepMin, tol = cfg.toleranceDeg;
    const t0 = Date.parse(scenario.startUtc);
    const n = Math.round(scenario.durationDays * 24 * 60 / stepMin), N = n + 1, dtH = stepMin / 60;
    const cov = geometry.coverage();
    if (!(t0 >= cov.startMs && t0 + n * stepMin * 60000 <= cov.endMs)) throw new Error(`Scenario time is outside the SPICE table coverage (${cov.startUtc.slice(0, 10)} to ${cov.endUtc.slice(0, 10)}).`);
    const fr = siteFrame(site), hasMask = !!terrain;
    const s = { n: N, stepMin, t0, sunAz: new Float64Array(N), sunEl: new Float64Array(N), earthAz: new Float64Array(N), earthEl: new Float64Array(N),
      horizonSun: new Float64Array(N), horizonEarth: new Float64Array(N), sunDist: new Float64Array(N),
      sunState: new Uint8Array(N), earthState: new Uint8Array(N), power: new Float64Array(N), soc: new Float64Array(N) };
    for (let i = 0; i < N; i++) {
      const v = geometry.vectors(t0 + i * stepMin * 60000);
      const S = azEl(v.sun, fr), E = azEl(v.earth, fr);
      s.sunAz[i] = S.az; s.sunEl[i] = S.el; s.earthAz[i] = E.az; s.earthEl[i] = E.el; s.sunDist[i] = S.dist;
      const hS = hasMask ? terrain.horizonAt(S.az) : 0, hE = hasMask ? terrain.horizonAt(E.az) : 0;
      s.horizonSun[i] = hS; s.horizonEarth[i] = hE;
      let ss = classify(S.el, hS, tol), es = classify(E.el, Math.max(hE, hw.minEarthElevDeg), tol);
      // No terrain data: a body above the reference horizon is uncertain, never visible.
      if (!hasMask) { if (ss === VISIBLE) ss = UNCERTAIN; if (es === VISIBLE) es = UNCERTAIN; }
      s.sunState[i] = ss; s.earthState[i] = es;
    }
    const conservative = aggregate(s, hw, n, dtH, VISIBLE);   // uncertain counted as not visible
    const optimistic = aggregate(s, hw, n, dtH, UNCERTAIN);   // uncertain counted as visible
    const primary = hasMask ? conservative : optimistic;
    s.power = primary.series.power; s.soc = primary.series.soc;
    const shared = {
      sunUncertainPct: 100 * count(s.sunState, UNCERTAIN) / N, earthUncertainPct: 100 * count(s.earthState, UNCERTAIN) / N,
      maxSunElDeg: max(s.sunEl), maxEarthElDeg: max(s.earthEl), durationH: n * dtH,
    };
    const windows = { sun: intervals(s.sunState, dtH), earth: intervals(s.earthState, dtH) };
    refineWindows(windows, { geometry, terrain, hw, fr, tol, t0, stepMs: stepMin * 60000, N });
    return { series: s, metrics: { ...primary.metrics, ...shared }, bounds: { conservative: { ...conservative.metrics, ...shared }, optimistic: { ...optimistic.metrics, ...shared } },
      windows, geometryOnly: !hasMask, qualityState: hasMask ? (shared.sunUncertainPct + shared.earthUncertainPct > 0 ? 'supported' : 'supported') : 'limited',
      config: cfg, site, scenario, hw, terrain, geometry };
  }

  function aggregate(s, hw, n, dtH, minState) {
    const N = s.n, sunVis = new Uint8Array(N), earthVis = new Uint8Array(N), power = new Float64Array(N), soc = new Float64Array(N);
    const k = hw.panelAreaM2 * hw.efficiency * SOLAR_CONSTANT * (1 - hw.losses);
    const energy = { horizontal: 0, 'vertical-fixed': 0, 'vertical-tracking': 0 };
    const cap = hw.batteryWh, floor = cap * (1 - hw.dod);
    let charge = cap * (hw.initialSocPct ?? 100) / 100, minSoc = charge, minAt = 0, brownout = null, elSum = 0, elN = 0;
    for (let i = 0; i < N; i++) {
      const sv = s.sunState[i] >= minState ? 1 : 0;
      sunVis[i] = sv; earthVis[i] = s.earthState[i] >= minState ? 1 : 0;
      const flux = k * Math.pow(AU_KM / s.sunDist[i], 2) * sv;
      if (sv) { elSum += s.sunEl[i]; elN++; }
      for (const pt of PANEL_TYPES) {
        const p = flux * cosIncidence(pt, s.sunAz[i], s.sunEl[i], hw.panelAzDeg || 0);
        if (pt === hw.panelType) power[i] = p;
        if (i < n) energy[pt] += p * dtH;
      }
      soc[i] = charge;
      if (charge < minSoc - 1e-9) { minSoc = charge; minAt = i * dtH; }
      if (i < n) {
        charge = Math.min(cap, charge + (power[i] - hw.loadW) * dtH);
        if (charge <= floor) { if (brownout === null) brownout = (i + 1) * dtH; charge = floor; }
      }
    }
    const m = {};
    m.sunlitPct = 100 * sum(sunVis) / N; m.earthVisiblePct = 100 * sum(earthVis) / N;
    m.sunVisibleH = sum(sunVis) * dtH; m.earthVisibleH = sum(earthVis) * dtH;
    const dg = longestRun(sunVis, 0), eg = longestRun(earthVis, 0);
    m.longestDarkGapH = dg.len * dtH; m.longestDarkGapStartH = dg.len ? dg.start * dtH : null;
    m.longestNoEarthGapH = eg.len * dtH; m.longestNoEarthGapStartH = eg.len ? eg.start * dtH : null;
    m.sunlitAtStart = sunVis[0]; m.earthVisibleAtStart = earthVis[0];
    m.timeToSunsetH = timeToTransition(sunVis, 0, 1, 0, dtH); m.timeToSunriseH = timeToTransition(sunVis, 0, 0, 1, dtH);
    m.timeToEarthsetH = timeToTransition(earthVis, 0, 1, 0, dtH); m.timeToEarthriseH = timeToTransition(earthVis, 0, 0, 1, dtH);
    m.energyWh = energy[hw.panelType]; m.energyHorizontalWh = energy.horizontal; m.energyVerticalTrackingWh = energy['vertical-tracking'];
    m.verticalToHorizontalRatio = energy.horizontal > 1e-9 ? energy['vertical-tracking'] / energy.horizontal : null;
    m.loadEnergyWh = hw.loadW * n * dtH; m.energyBalanceWh = m.energyWh - m.loadEnergyWh;
    m.meanSunElDeg = elN ? elSum / elN : null;
    m.shadowLengthM = m.meanSunElDeg > 0 ? 1 / Math.tan(m.meanSunElDeg * D2R) : null;
    m.minSocPct = 100 * minSoc / cap; m.minSocAtH = minAt; m.socMarginPct = m.minSocPct - 100 * (1 - hw.dod);
    m.brownoutMetH = brownout; m.requiredStorageWh = hw.loadW * m.longestDarkGapH / hw.dod;
    return { metrics: m, series: { sunVis, earthVis, power, soc } };
  }
  function sum(a) { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
  function max(a) { let t = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > t) t = a[i]; return t; }
  function count(a, v) { let t = 0; for (let i = 0; i < a.length; i++) if (a[i] === v) t++; return t; }
  function longestRun(a, val) {
    let best = 0, bestStart = 0, cur = 0;
    for (let i = 0; i < a.length; i++) { if (a[i] === val) { cur++; if (cur > best) { best = cur; bestStart = i - cur + 1; } } else cur = 0; }
    return { len: best, start: bestStart };
  }
  function timeToTransition(arr, from, a, b, dtH) {
    for (let i = Math.max(from, 0) + 1; i < arr.length; i++) if (arr[i - 1] === a && arr[i] === b) return (i - from) * dtH;
    return null;
  }
  /** Continuous windows of equal state: [{state, startH, endH, durationH, samples, startIdx, endIdx}].
   *  startH = time of the first sample in the state; endH = time of the first sample in the next state
   *  (capped at the last sample). durationH = samples x step, the same accounting as the summary metrics. */
  function intervals(states, dtH) {
    const out = []; let st = 0;
    for (let i = 1; i <= states.length; i++) if (i === states.length || states[i] !== states[st]) {
      out.push({ state: STATE_NAME[states[st]], startH: st * dtH, endH: Math.min(i, states.length - 1) * dtH, durationH: (i - st) * dtH, samples: i - st, startIdx: st, endIdx: i - 1 });
      st = i;
    }
    return out;
  }
  /** Signed distance (deg) of a body above its visibility limit at time tMs (no tolerance applied). */
  function marginAt(ctx, body, tMs) {
    const v = ctx.geometry.vectors(tMs), p = azEl(v[body], ctx.fr);
    const h = ctx.terrain ? ctx.terrain.horizonAt(p.az) : 0;
    return p.el - (body === 'earth' ? Math.max(h, ctx.hw.minEarthElevDeg) : h);
  }
  /** Transition refinement (V1 spec 3.2, documented in docs/INTERFACES.md): for each change of state between
   *  samples k-1 and k, bisect the interpolated geometry for the moment the margin crosses the boundary between
   *  the two states (+tol between visible and uncertain, -tol between uncertain and obstructed, 0 when a step
   *  jumps straight from visible to obstructed). 16 halvings of a 10-min step give ~0.01 s numerically; the
   *  physical precision is limited by the 1-deg terrain bins and DEM, so times are reported to the minute. */
  function refineWindows(windows, ctx) {
    const bound = (a, b) => { const s = a + b; return s === 3 ? ctx.tol : s === 1 ? -ctx.tol : 0; }; // states 2+1, 1+0, 2+0
    const IDX = { visible: 2, uncertain: 1, obstructed: 0 };
    for (const body of ['sun', 'earth']) {
      const ws = windows[body], dt = ctx.stepMs / 3600000;
      const cut = (k, sa, sb) => {
        const b = bound(sa, sb); let lo = ctx.t0 + (k - 1) * ctx.stepMs, hi = ctx.t0 + k * ctx.stepMs;
        const g = t => marginAt(ctx, body, t) - b, glo = g(lo);
        if (Math.sign(glo) === Math.sign(g(hi))) return { h: (k - 0.5) * dt, bisected: false };
        for (let it = 0; it < 16; it++) { const mid = (lo + hi) / 2; if (Math.sign(g(mid)) === Math.sign(glo)) lo = mid; else hi = mid; }
        return { h: ((lo + hi) / 2 - ctx.t0) / 3600000, bisected: true };
      };
      for (let j = 0; j < ws.length; j++) {
        const w = ws[j];
        if (j === 0) { w.startRefH = 0; w.startRefined = false; }
        else { const c = cut(w.startIdx, IDX[ws[j - 1].state], IDX[w.state]); w.startRefH = c.h; w.startRefined = c.bisected; ws[j - 1].endRefH = c.h; ws[j - 1].endRefined = c.bisected; }
      }
      if (ws.length) { const last = ws[ws.length - 1]; last.endRefH = (ctx.N - 1) * dt; last.endRefined = false; last.endsWithMission = true; }
      ws.forEach(w => { w.durationRefH = w.endRefH - w.startRefH; });
    }
  }
  /** Minimum result record (V1 spec 8.3) for one sample and body. */
  function sampleRecord(run, k, body) {
    const s = run.series, sun = body === 'sun';
    return { scenario_id: scenarioId(run), timestamp: new Date(s.t0 + k * s.stepMin * 60000).toISOString(), mission_elapsed_time_h: k * s.stepMin / 60, body,
      azimuth_deg: sun ? s.sunAz[k] : s.earthAz[k], elevation_deg: sun ? s.sunEl[k] : s.earthEl[k],
      terrain_horizon_elevation_deg: run.geometryOnly ? null : (sun ? s.horizonSun[k] : s.horizonEarth[k]),
      visibility_state: STATE_NAME[sun ? s.sunState[k] : s.earthState[k]], quality_state: run.qualityState, tolerance_deg: run.config.toleranceDeg,
      method: CODE_VERSION, geometry: run.geometry.id + '@' + run.geometry.version, terrain: run.terrain ? 'horizon_' + run.site.id : null };
  }

  // ---------------------------------------------------------------- metric catalogue
  const GEOM_LIMITS = ['Disc centre is classified against the terrain horizon; within the tolerance the state is "uncertain" (partial disc or DEM-level error).',
    'Sampled every step: transitions are known to one step, windows shorter than a step can be missed.', 'No refraction (airless body).'];
  const POWER_LIMITS = ['Not modelled: dust, lander self-shadowing, temperature derating, reflected light, panel degradation.',
    'Uncertain (grazing) Sun samples are counted as no power.', 'No charge or discharge efficiency and no heater model beyond the constant load.'];
  const G = 'computed-geometry', EE = 'engineering-estimate';
  const METRICS = {
    sunlitPct: { label: 'Sun visible', unit: '%', fmt: 'pct', q: G, body: 'sun', method: 'Share of samples classified visible: Sun centre elevation above the terrain horizon at its azimuth by more than the tolerance.', limits: GEOM_LIMITS, unc: 'sunUncertainPct' },
    earthVisiblePct: { label: 'Earth visible', unit: '%', fmt: 'pct', q: G, body: 'earth', method: 'Share of samples classified visible: Earth centre above max(terrain horizon, minimum antenna elevation) by more than the tolerance.', limits: GEOM_LIMITS.concat(['Geometric line of sight only: not a communications link budget.']), unc: 'earthUncertainPct' },
    sunVisibleH: { label: 'Total Sun-visible duration', unit: 'h', fmt: 'h', q: G, body: 'sun', method: 'Number of visible samples times the sampling step.', limits: GEOM_LIMITS },
    earthVisibleH: { label: 'Total Earth-visible duration', unit: 'h', fmt: 'h', q: G, body: 'earth', method: 'Number of visible samples times the sampling step.', limits: GEOM_LIMITS },
    longestDarkGapH: { label: 'Longest Sun obstruction', unit: 'h', fmt: 'h', q: G, body: 'sun', at: 'longestDarkGapStartH', atLabel: 'from', method: 'Longest run of consecutive samples in which the Sun is not classified visible, times the step.', limits: GEOM_LIMITS.concat(['Truncated by the mission window: a gap that starts before T+0 or ends after the mission is cut.']) },
    longestNoEarthGapH: { label: 'Longest Earth obstruction', unit: 'h', fmt: 'h', q: G, body: 'earth', at: 'longestNoEarthGapStartH', atLabel: 'from', method: 'Longest run of consecutive samples in which Earth is not classified visible, times the step.', limits: GEOM_LIMITS },
    timeToSunsetH: { label: 'First sunset', unit: 'h', fmt: 'met', q: G, body: 'sun', method: 'From T+0, the first visible-to-not-visible Sun transition. Empty when none falls inside the mission.', limits: GEOM_LIMITS },
    timeToSunriseH: { label: 'First sunrise', unit: 'h', fmt: 'met', q: G, body: 'sun', method: 'From T+0, the first not-visible-to-visible Sun transition.', limits: GEOM_LIMITS },
    meanSunElDeg: { label: 'Mean Sun elevation while visible', unit: '°', fmt: 'deg', q: G, body: 'sun', method: 'Mean Sun centre elevation over visible samples.', limits: GEOM_LIMITS },
    maxSunElDeg: { label: 'Maximum Sun elevation', unit: '°', fmt: 'deg', q: G, body: 'sun', method: 'Highest Sun centre elevation in the mission, regardless of terrain.', limits: ['Positive elevation alone is not terrain-adjusted visibility.'] },
    maxEarthElDeg: { label: 'Maximum Earth elevation', unit: '°', fmt: 'deg', q: G, body: 'earth', method: 'Highest Earth centre elevation in the mission, regardless of terrain.', limits: ['Positive elevation alone is not terrain-adjusted visibility.'] },
    shadowLengthM: { label: 'Shadow of a 1 m rock', unit: 'm', fmt: 'm', q: G, body: 'sun', method: '1 m / tan(mean Sun elevation while visible), on flat ground.', limits: ['Flat-ground approximation; slopes change shadow length.'] },
    energyWh: { label: 'Generated energy (estimate)', unit: 'Wh', fmt: 'wh', q: EE, body: 'sun', method: 'Sum of P(t) x step, P = A x eta x 1361 W/m2 x (1 AU/r)^2 x cos(theta) x sunVisible x (1 - losses), selected panel type.', limits: POWER_LIMITS },
    verticalToHorizontalRatio: { label: 'Vertical vs horizontal array energy', unit: '×', fmt: 'x1', q: EE, body: 'sun', method: 'Energy of a vertical Sun-tracking array (cos theta = cos el) divided by a horizontal one (cos theta = sin el), same area and efficiency.', limits: POWER_LIMITS },
    minSocPct: { label: 'Minimum battery charge (estimate)', unit: '%', fmt: 'pct', q: EE, body: 'sun', at: 'minSocAtH', atLabel: 'at', method: 'Battery simulation: constant load, starts at the initial charge, charge clamped to capacity, discharge stops at the depth-of-discharge floor.', limits: POWER_LIMITS },
    socMarginPct: { label: 'Battery margin above floor (estimate)', unit: '% of capacity', fmt: 'pct', q: EE, body: 'sun', at: 'minSocAtH', atLabel: 'at', method: 'Minimum charge minus the depth-of-discharge floor (100% - DoD). Zero means the battery reached the floor.', limits: POWER_LIMITS },
    brownoutMetH: { label: 'Battery reaches floor (estimate)', unit: 'h', fmt: 'met', q: EE, body: 'sun', method: 'First mission time at which the charge reaches capacity x (1 - DoD).', limits: POWER_LIMITS },
    requiredStorageWh: { label: 'Storage for the longest Sun obstruction (estimate)', unit: 'Wh', fmt: 'wh', q: EE, body: 'sun', method: 'load x longest Sun obstruction / usable depth of discharge (rule of thumb).', limits: ['Rule-of-thumb sizing; ignores margins, ageing and heater power.'] },
    energyBalanceWh: { label: 'Energy balance (estimate)', unit: 'Wh', fmt: 'wh', q: EE, body: 'sun', method: 'Generated energy minus load energy over the mission.', limits: POWER_LIMITS },
  };

  // ---------------------------------------------------------------- indicator records + store
  function scenarioId(run) { return hash({ s: run.scenario.siteId || run.site.id, t: run.scenario.startUtc, d: run.scenario.durationDays, la: run.site.lat, lo: run.site.lon, m: run.terrain ? (run.terrain.rec.uploaded || run.terrain.rec.generatedUtc || 'mask') : null, hw: run.hw, c: run.config }); }
  /** Indicator record (schemas/indicator-record.schema.json): one derived value with its full lineage. */
  function indicatorRecord(run, metricId, ctx) {
    const d = METRICS[metricId]; if (!d) return null;
    const sid = scenarioId(run), s = run.series, hw = run.hw, estimate = d.q === EE;
    const value = run.metrics[metricId];
    const t = run.terrain && run.terrain.describe();
    const g = run.geometry.describe();
    const inputs = [`adapter:${g.id}@${g.version}`, t ? `product:horizon_${run.site.id}` : 'terrain:unavailable', `scenario:${sid}`];
    if (estimate) inputs.push('assumptions:hardware');
    return {
      id: `ind:${sid}:${metricId}`, metricId, label: d.label, value: value === undefined ? null : value, unit: d.unit, dataType: 'number',
      classification: d.q, qualityState: value === null || value === undefined ? 'unavailable' : (run.geometryOnly ? 'limited' : (d.unc && run.metrics[d.unc] > 0 ? 'uncertain' : 'supported')),
      bounds: { conservative: run.bounds.conservative[metricId], optimistic: run.bounds.optimistic[metricId], note: run.geometryOnly ? 'Terrain unavailable: the displayed value is the optimistic bound (no obstruction).' : 'Displayed value counts uncertain samples as not visible.' },
      uncertainSharePct: d.unc ? run.metrics[d.unc] : (d.body === 'sun' ? run.metrics.sunUncertainPct : run.metrics.earthUncertainPct),
      worstCase: d.at && run.metrics[d.at] !== null && run.metrics[d.at] !== undefined ? { metH: run.metrics[d.at], utc: new Date(s.t0 + run.metrics[d.at] * 3600000).toISOString(), relation: d.atLabel } : null,
      location: { siteId: run.site.id, name: run.site.name, lat: run.site.lat, lon: run.site.lon, elevationM: run.site.elevationM ?? null, frame: 'MOON_ME', convention: 'planetocentric latitude, east-positive longitude [-180, 180]', coordStatus: run.site.coordStatus || 'user-entered' },
      time: { startUtc: run.scenario.startUtc, endUtc: new Date(s.t0 + run.metrics.durationH * 3600000).toISOString(), standard: 'UTC', stepSec: s.stepMin * 60 },
      method: { id: 'selenix.' + metricId, version: CODE_VERSION, description: d.method,
        parameters: { toleranceDeg: run.config.toleranceDeg, stepMin: s.stepMin, observerHeightM: t ? t.observerHeightM : null, minEarthElevDeg: d.body === 'earth' ? hw.minEarthElevDeg : undefined,
          ...(estimate ? { panelType: hw.panelType, panelAreaM2: hw.panelAreaM2, efficiency: hw.efficiency, losses: hw.losses, loadW: hw.loadW, batteryWh: hw.batteryWh, dod: hw.dod, initialSocPct: hw.initialSocPct, assumptionsConfirmed: !!hw.confirmed } : {}) } },
      inputs,
      sources: [{ id: 'naif-spice', name: 'NAIF SPICE: ' + (g.sources || []).map(x => x.file).join(', '), version: `${g.toolkit}, frame ${g.frame}, ${g.aberration}`, url: g.sourceUrl }]
        .concat(t ? [{ id: 'lola-ldem', name: t.userSupplied ? 'User-supplied horizon mask' : 'LRO LOLA DEM ' + t.product, version: t.version || '', url: t.sourceUrl || '' }] : [])
        .concat(estimate ? [{ id: 'solar-constant', name: 'Total solar irradiance 1361 W/m2 (Kopp & Lean 2011)', version: '', url: 'https://doi.org/10.1029/2010GL045777' }] : []),
      limitations: d.limits.concat(run.geometryOnly ? ['Terrain data unavailable for this site: no sample can be classified visible.'] : []),
      validation: { refs: (ctx && ctx.validationRefs ? ctx.validationRefs(d) : []) },
      scenarioHash: sid, codeVersion: CODE_VERSION, createdUtc: new Date().toISOString(),
    };
  }
  function createStore() {
    const m = new Map();
    return {
      put(rec) { if (rec && rec.id) m.set(rec.id, rec); return rec; },
      get(id) { return m.get(id) || null; },
      list(filter) { const a = [...m.values()]; return filter ? a.filter(filter) : a; },
      clear() { m.clear(); },
      size() { return m.size; },
      /** Lineage chain for a record: record -> inputs -> sources. */
      lineage(id) { const r = m.get(id); return r ? { record: r.id, method: r.method && r.method.id, inputs: r.inputs || r.evidence || [], sources: (r.sources || []).map(s => s.name) } : null; },
    };
  }

  // ---------------------------------------------------------------- requirement checker -> proof objects
  function compare(op, a, b) {
    switch (op) { case '>=': return a >= b; case '<=': return a <= b; case '>': return a > b; case '<': return a < b; case '==': return a === b; case '!=': return a !== b; default: throw new Error('bad op ' + op); }
  }
  const REASON_LABEL = { terrain: 'terrain', close: 'close to threshold', grazing: 'grazing samples', defaults: 'default assumptions' };
  function subStateLabel(reasons) {
    if (!reasons.length) return null;
    if (reasons.length === 2 && reasons.includes('terrain') && reasons.includes('close')) return 'both';
    return reasons.map(r => REASON_LABEL[r]).join(' + ');
  }
  /** Returns a proof object (schemas/proof-object.schema.json). ctx: { marginPct } */
  function checkRequirement(req, run, ctx) {
    const marginPct = (ctx && ctx.marginPct) ?? 10, d = METRICS[req.metric] || {};
    const value = run.metrics[req.metric], thr = req.threshold === '' || req.threshold === null || req.threshold === undefined ? NaN : +req.threshold;
    const sid = scenarioId(run);
    const proof = { id: `proof:${sid}:${req.id}`, requirementId: req.id, label: req.label, statement: `${req.metric} ${req.op} ${req.threshold} ${req.unit || ''}`.trim(),
      metric: req.metric, op: req.op, threshold: Number.isNaN(thr) ? null : thr, unit: req.unit, marginPct, observed: { indicatorId: `ind:${sid}:${req.metric}`, value: value ?? null,
        at: d.at && run.metrics[d.at] !== null && run.metrics[d.at] !== undefined ? { metH: run.metrics[d.at], relation: d.atLabel } : null },
      bounds: { conservative: run.bounds.conservative[req.metric] ?? null, optimistic: run.bounds.optimistic[req.metric] ?? null },
      short: req.short || req.label, steps: [], reasons: [], evidence: [`ind:${sid}:${req.metric}`], scenarioHash: sid, method: CODE_VERSION, createdUtc: new Date().toISOString() };
    const step = (check, result, detail) => proof.steps.push({ check, result, detail });
    if (value === null || value === undefined || Number.isNaN(value) || Number.isNaN(thr)) {
      step('inputs-present', false, 'A required value or threshold is missing.');
      return { ...proof, verdict: 'unknown', subState: null, pass: null, driver: 'A required input or threshold is missing.' };
    }
    step('inputs-present', true, 'Indicator and threshold are available.');
    const pass = compare(req.op, value, thr);
    step('threshold', pass, `${fmtReq(value, d.fmt)} ${req.op} ${fmtReq(thr, d.fmt)} is ${pass}.`);
    let verdict = pass ? 'meets' : 'does not meet';
    const reasons = proof.reasons;
    if (req.visibilityDependent) {
      const c = proof.bounds.conservative, o = proof.bounds.optimistic;
      const passC = c !== null && compare(req.op, c, thr), passO = o !== null && compare(req.op, o, thr);
      if (run.geometryOnly) {
        if (passO) { reasons.push('terrain'); step('terrain-data', false, 'Terrain is unavailable for this site, so no sample can be classified visible. The value shown assumes no obstruction; real terrain can only reduce visibility.'); }
        else step('terrain-data', true, 'Terrain is unavailable, but the requirement fails even with no obstruction, so the result holds.');
      } else {
        step('terrain-data', true, `Terrain horizon applied (${run.terrain.describe().product || 'user mask'}).`);
        if (passC !== passO) { reasons.push('grazing'); step('uncertain-samples', false, `The verdict depends on how uncertain (near-horizon) samples are counted: ${fmtReq(c, d.fmt)} if obstructed, ${fmtReq(o, d.fmt)} if visible.`); }
        else step('uncertain-samples', true, `Same result whether uncertain samples are counted as obstructed (${fmtReq(c, d.fmt)}) or visible (${fmtReq(o, d.fmt)}).`);
      }
    }
    const margin = marginPct / 100 * Math.max(Math.abs(thr), 1e-9), near = Math.abs(value - thr) <= margin;
    if (near) reasons.push('close');
    step('margin', !near, near ? `Within ${marginPct}% of the threshold (${fmtReq(Math.abs(value - thr), d.fmt)} away).` : `More than ${marginPct}% away from the threshold.`);
    if (req.powerDependent) {
      const confirmed = !!run.hw.confirmed;
      if (!confirmed && pass) reasons.push('defaults');
      step('assumptions-confirmed', confirmed, confirmed ? 'Hardware values confirmed by the user.' : 'Power inputs are default assumptions, not confirmed mission values.');
    }
    if (reasons.length) {
      // a clear failure stays a failure: only "terrain"/"defaults" on a pass, or "close"/"grazing", send it to review
      verdict = 'needs review';
    }
    const at = proof.observed.at ? ` ${proof.observed.at.relation} T+${fmtHours(proof.observed.at.metH)}` : '';
    const driver = `${d.label || req.metric} is ${fmtReq(value, d.fmt)}${at}; the requirement is ${req.op} ${fmtReq(thr, d.fmt)}.`;
    return { ...proof, verdict, subState: verdict === 'needs review' ? subStateLabel(reasons) : null, pass, driver };
  }
  function fmtReq(v, f) { return format(v, f === 'met' ? 'h' : f); }

  // ---------------------------------------------------------------- rules
  function resolveVar(expr, metrics, ctx) {
    const [kind, key] = expr.split(':');
    if (kind === 'metric') return metrics[key];
    if (kind === 'hw') return key === 'dodPct' ? ctx.hw.dod * 100 : ctx.hw[key];
    if (kind === 'req') { const r = (ctx.requirements || []).find(x => x.id === key); return r ? +r.threshold : null; }
    if (kind === 'cfg') return ctx.config ? ctx.config[key] : null;
    return null;
  }
  function evalCondition(c, metrics, ctx) {
    if (c.all) return c.all.every(x => evalCondition(x, metrics, ctx));
    if (c.any) return c.any.some(x => evalCondition(x, metrics, ctx));
    if (c.flag) return !!(ctx.flags || {})[c.flag];
    if (c.comparison) return false;
    const v = metrics[c.metric], target = 'ref' in c ? resolveVar(c.ref, metrics, ctx) : c.value;
    if (c.op === '!=' && target === null) return v !== null && v !== undefined;
    if (c.op === '==' && target === null) return v === null || v === undefined;
    if (v === null || v === undefined || target === null || target === undefined) return false;
    return compare(c.op, v, target);
  }
  function evalRule(rule, metrics, ctx) {
    if (!evalCondition(rule.condition, metrics, ctx)) return { id: rule.id, fired: false };
    const values = {};
    for (const [name, expr] of Object.entries(rule.vars || {})) values[name] = resolveVar(expr, metrics, ctx);
    return { id: rule.id, fired: true, title: rule.title, severity: rule.severity, shared: !!rule.shared, text: fillTemplate(rule.log || rule.template, values), detail: fillTemplate(rule.template, values),
      chip: rule.chip ? fillTemplate(rule.chip, values) : null, values, vars: rule.vars, inputs: rule.inputs, qualityClass: rule.qualityClass, condition: rule.condition, template: rule.template };
  }
  function fillTemplate(t, values) { return t.replace(/\{(\w+)(?:\|(\w+))?\}/g, (_, name, f) => (name in values ? format(values[name], f) : `{${name}}`)); }

  // ---------------------------------------------------------------- formatting
  function format(v, f) {
    if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return '—';
    if (typeof v !== 'number') return String(v);
    switch (f) {
      case 'h': return fmtHours(v);
      case 'met': return 'T+' + fmtHours(v);
      case 'pct': return (Math.abs(v) >= 9.95 || Math.abs(v) < 0.05 ? Math.abs(v) < 0.05 ? '0' : v.toFixed(0) : v.toFixed(1)) + '%';
      case 'pct0': return v.toFixed(0) + '%';
      case 'pp': { const r = Math.round(v); return (r > 0 ? '+' : '') + r + ' points'; }
      case 'wh': return Math.abs(v) >= 10000 ? (v / 1000).toFixed(1) + ' kWh' : Math.round(v).toLocaleString('en-US') + ' Wh';
      case 'w': return Math.round(v) + ' W';
      case 'deg': return v.toFixed(1) + '°';
      case 'deg2': return v.toFixed(2) + '°';
      case 'x1': return v.toFixed(1) + '×';
      case 'm': return v.toFixed(v < 10 ? 1 : 0) + ' m';
      case 'int': return Math.round(v).toString();
      default: return (Math.round(v * 100) / 100).toString();
    }
  }
  /** Hours to "T+ d h min" style text with minute resolution (for refined transition times). */
  function fmtHM(h) {
    if (Math.round(h * 60) === 0) return '0';
    const m = Math.round(h * 60), d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
    return [d ? d + ' d' : '', hh ? hh + ' h' : '', mm || (!d && !hh) ? mm + ' min' : ''].filter(Boolean).join(' ');
  }
  function fmtHours(h) {
    if (h < 47.5) return (h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)) + ' h';
    const t = Math.round(h), d = Math.floor(t / 24), r = t - d * 24;
    return r ? `${d} d ${r} h` : `${d} d`;
  }
  function hash(obj) {
    const s = JSON.stringify(obj); let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  const Engine = { R_MOON_KM, AU_KM, SOLAR_CONSTANT, CODE_VERSION, PANEL_TYPES, METRICS, DEFAULT_CONFIG, OBSTRUCTED, UNCERTAIN, VISIBLE, STATE_NAME,
    SpiceTableAdapter, HorizonMaskAdapter, enu, siteFrame, azEl, classify, cosIncidence, simulate, intervals, timeToTransition, longestRun, sampleRecord,
    scenarioId, indicatorRecord, createStore, checkRequirement, subStateLabel, evalRule, evalCondition, fillTemplate, format, fmtHours, fmtHM, marginAt, hash };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
