/* Lunar Mission Decision-Support Navigator: engine.
 * Pure functions, no DOM. Works in the browser (window.Engine) and in Node (module.exports).
 *
 * Conventions (fixed): frame MOON_ME, km; site on a sphere R = 1737.4 km + elevation;
 * azimuth 0 = local north, clockwise; UTC index (TDB = UTC + 69.184 s); visibility by disc centre;
 * no refraction. Power P = A*eta*1361*(1AU/r)^2*cos(incidence)*sunVisible*(1-losses).
 */
(function (root) {
  'use strict';
  const R_MOON_KM = 1737.4;
  const AU_KM = 149597870.7;
  const SOLAR_CONSTANT = 1361;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const CODE_VERSION = 'navigator-engine 1.0.0';

  // ---------- ephemeris ----------
  function loadEphemeris(buffer, meta) {
    const data = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    if (data.length !== meta.count * meta.valuesPerRecord) throw new Error('ephemeris size mismatch');
    return { data, t0: meta.startEpochMs, stepMs: meta.stepSec * 1000, count: meta.count, k: meta.valuesPerRecord, meta };
  }
  function ephRange(eph) { return [eph.t0, eph.t0 + (eph.count - 1) * eph.stepMs]; }
  function ephAt(eph, tMs) {
    const x = (tMs - eph.t0) / eph.stepMs;
    const i = Math.floor(x);
    if (i < 0 || i + 1 >= eph.count) return null;
    const f = x - i, a = i * eph.k, b = a + eph.k, d = eph.data;
    const v = new Array(6);
    for (let j = 0; j < 6; j++) v[j] = d[a + j] * (1 - f) + d[b + j] * f;
    return { sun: [v[0], v[1], v[2]], earth: [v[3], v[4], v[5]] };
  }

  // ---------- geometry ----------
  function enu(latDeg, lonDeg) {
    const la = latDeg * D2R, lo = lonDeg * D2R;
    const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
    return { east: [-so, co, 0], north: [-sl * co, -sl * so, cl], up: [cl * co, cl * so, sl] };
  }
  function siteFrame(site) {
    const b = enu(site.lat, site.lon);
    const r = R_MOON_KM + (site.elevationM || 0) / 1000;
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
  function maskAt(mask, az) {
    if (!mask) return 0;
    const a = ((az % 360) + 360) % 360, i = Math.floor(a), f = a - i;
    return mask[i % 360] * (1 - f) + mask[(i + 1) % 360] * f;
  }
  function cosIncidence(panelType, sunAz, sunEl, panelAzDeg) {
    if (panelType === 'horizontal') return Math.max(0, Math.sin(sunEl * D2R));
    if (panelType === 'vertical-fixed') return Math.max(0, Math.cos(sunEl * D2R) * Math.cos((sunAz - panelAzDeg) * D2R));
    return Math.max(0, Math.cos(sunEl * D2R)); // vertical-tracking
  }

  // ---------- simulation ----------
  const PANEL_TYPES = ['horizontal', 'vertical-fixed', 'vertical-tracking'];

  function simulate({ eph, site, mask, scenario, hw, stepMin = 10 }) {
    const t0 = Date.parse(scenario.startUtc);
    const n = Math.round(scenario.durationDays * 24 * 60 / stepMin);
    const N = n + 1, dtH = stepMin / 60;
    const fr = siteFrame(site);
    const s = {
      n: N, stepMin, t0,
      sunAz: new Float64Array(N), sunEl: new Float64Array(N), earthAz: new Float64Array(N), earthEl: new Float64Array(N),
      horizonSun: new Float64Array(N), horizonEarth: new Float64Array(N),
      sunVis: new Uint8Array(N), earthVis: new Uint8Array(N), power: new Float64Array(N), soc: new Float64Array(N),
    };
    const minE = hw.minEarthElevDeg;
    const k = hw.panelAreaM2 * hw.efficiency * SOLAR_CONSTANT * (1 - hw.losses);
    const energy = { horizontal: 0, 'vertical-fixed': 0, 'vertical-tracking': 0 };
    const cap = hw.batteryWh, floor = cap * (1 - hw.dod);
    let soc = cap * (hw.initialSocPct ?? 100) / 100, minSoc = soc, brownout = null;
    let sunElSum = 0, sunElN = 0, maxEarthEl = -90;
    for (let i = 0; i < N; i++) {
      const e = ephAt(eph, t0 + i * stepMin * 60000);
      if (!e) throw new Error('Scenario time outside the ephemeris table (2026-2030).');
      const S = azEl(e.sun, fr), E = azEl(e.earth, fr);
      s.sunAz[i] = S.az; s.sunEl[i] = S.el; s.earthAz[i] = E.az; s.earthEl[i] = E.el;
      const hS = maskAt(mask, S.az), hE = maskAt(mask, E.az);
      s.horizonSun[i] = hS; s.horizonEarth[i] = hE;
      const sv = S.el > hS ? 1 : 0, ev = E.el > Math.max(hE, minE) ? 1 : 0;
      s.sunVis[i] = sv; s.earthVis[i] = ev;
      if (ev) maxEarthEl = Math.max(maxEarthEl, E.el);
      const flux = k * Math.pow(AU_KM / S.dist, 2) * sv;
      if (sv) { sunElSum += S.el; sunElN++; }
      for (const pt of PANEL_TYPES) {
        const p = flux * cosIncidence(pt, S.az, S.el, hw.panelAzDeg || 0);
        if (pt === hw.panelType) s.power[i] = p;
        if (i < n) energy[pt] += p * dtH;
      }
      s.soc[i] = soc;
      if (soc < minSoc) minSoc = soc;
      if (i < n) {
        soc = Math.min(cap, soc + (s.power[i] - hw.loadW) * dtH);
        if (soc <= floor) { if (brownout === null) brownout = (i + 1) * dtH; soc = floor; }
      }
    }
    if (soc < minSoc) minSoc = soc;
    const m = {};
    m.sunlitPct = 100 * sum(s.sunVis) / N;
    m.earthVisiblePct = 100 * sum(s.earthVis) / N;
    m.longestDarkGapH = longestRun(s.sunVis, 0) * dtH;
    m.longestNoEarthGapH = longestRun(s.earthVis, 0) * dtH;
    m.sunlitAtStart = s.sunVis[0];
    m.earthVisibleAtStart = s.earthVis[0];
    m.timeToSunsetH = timeToTransition(s.sunVis, 0, 1, 0, dtH);
    m.timeToSunriseH = timeToTransition(s.sunVis, 0, 0, 1, dtH);
    m.timeToEarthsetH = timeToTransition(s.earthVis, 0, 1, 0, dtH);
    m.timeToEarthriseH = timeToTransition(s.earthVis, 0, 0, 1, dtH);
    m.energyWh = energy[hw.panelType];
    m.energyHorizontalWh = energy.horizontal;
    m.energyVerticalFixedWh = energy['vertical-fixed'];
    m.energyVerticalTrackingWh = energy['vertical-tracking'];
    m.verticalToHorizontalRatio = energy.horizontal > 1e-9 ? energy['vertical-tracking'] / energy.horizontal : null;
    m.loadEnergyWh = hw.loadW * n * dtH;
    m.energyBalanceWh = m.energyWh - m.loadEnergyWh;
    m.meanSunElDeg = sunElN ? sunElSum / sunElN : null;
    m.shadowLengthM = m.meanSunElDeg > 0 ? 1 / Math.tan(m.meanSunElDeg * D2R) : null;
    m.maxSunElDeg = Math.max(...s.sunEl);
    m.maxEarthElDeg = maxEarthEl > -90 ? maxEarthEl : null;
    m.minSocPct = 100 * minSoc / cap;
    m.socMarginPct = m.minSocPct - 100 * (1 - hw.dod);
    m.brownoutMetH = brownout;
    m.requiredStorageWh = hw.loadW * m.longestDarkGapH / hw.dod;
    m.durationH = n * dtH;
    return { series: s, metrics: m };
  }
  function sum(a) { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
  function longestRun(a, val) {
    let best = 0, cur = 0;
    for (let i = 0; i < a.length; i++) { cur = a[i] === val ? cur + 1 : 0; if (cur > best) best = cur; }
    return best;
  }
  /** Hours from step `from` until the first transition from `a` to `b` (null if none inside the mission). */
  function timeToTransition(arr, from, a, b, dtH) {
    for (let i = Math.max(from, 0) + 1; i < arr.length; i++) if (arr[i - 1] === a && arr[i] === b) return (i - from) * dtH;
    return null;
  }

  // ---------- metric catalogue (drives evidence records) ----------
  const GEOM_LIMITS = ['Visibility uses the disc centre (Sun radius 0.27 deg, Earth 0.95 deg): partial discs not modelled.',
    'Geometric ephemeris (no light-time/aberration, ~0.006 deg).', 'No refraction (airless).'];
  const POWER_LIMITS = ['Not modelled: dust, lander self-shadowing, temperature derating, reflected light, panel degradation.',
    'Partial solar disc not modelled (on/off at disc centre).'];
  const METRICS = {
    sunlitPct: { label: 'Sunlit', unit: '%', fmt: 'pct', q: 'computed-geometry', vis: true,
      method: 'Fraction of 10-min steps with Sun centre elevation above the terrain horizon mask at the Sun azimuth.', limits: GEOM_LIMITS },
    earthVisiblePct: { label: 'Earth visible', unit: '%', fmt: 'pct', q: 'computed-geometry', vis: true,
      method: 'Fraction of steps with Earth centre above both the terrain mask and the minimum antenna elevation. Geometric visibility only, not a link budget.', limits: GEOM_LIMITS.concat(['Geometric line of sight is not a working link (no antenna, power or ground-station model).']) },
    longestDarkGapH: { label: 'Longest dark gap', unit: 'h', fmt: 'h', q: 'computed-geometry', vis: true,
      method: 'Longest run of consecutive steps without sunVisible, times the step.', limits: GEOM_LIMITS.concat(['Bounded by the mission window: gaps that start before T+0 or end after the mission are truncated.']) },
    longestNoEarthGapH: { label: 'Longest no-Earth gap', unit: 'h', fmt: 'h', q: 'computed-geometry', vis: true,
      method: 'Longest run of consecutive steps without earthVisible, times the step.', limits: GEOM_LIMITS },
    timeToSunsetH: { label: 'First sunset', unit: 'h', fmt: 'met', q: 'computed-geometry', vis: true,
      method: 'From T+0, steps until the first visible-to-hidden Sun transition. Empty if none inside the mission.', limits: GEOM_LIMITS },
    timeToSunriseH: { label: 'First sunrise', unit: 'h', fmt: 'met', q: 'computed-geometry', vis: true,
      method: 'From T+0, steps until the first hidden-to-visible Sun transition.', limits: GEOM_LIMITS },
    timeToEarthsetH: { label: 'First Earthset', unit: 'h', fmt: 'met', q: 'computed-geometry', vis: true,
      method: 'From T+0, steps until the first visible-to-hidden Earth transition.', limits: GEOM_LIMITS },
    energyWh: { label: 'Generated energy', unit: 'Wh', fmt: 'wh', q: 'engineering-estimate', vis: true,
      method: 'Sum of P(t)*step with P = A*eta*1361*(1 AU/r)^2*max(0,cos(theta))*sunVisible*(1-losses), for the selected panel type.', limits: POWER_LIMITS },
    verticalToHorizontalRatio: { label: 'Vertical / horizontal energy', unit: '×', fmt: 'x1', q: 'engineering-estimate', vis: true,
      method: 'Energy of a vertical sun-tracking array (cos theta = cos el) divided by a horizontal one (cos theta = sin el), same area and efficiency.', limits: POWER_LIMITS },
    meanSunElDeg: { label: 'Mean Sun elevation (sunlit)', unit: '°', fmt: 'deg', q: 'computed-geometry', vis: true,
      method: 'Mean Sun centre elevation over sunlit steps.', limits: GEOM_LIMITS },
    shadowLengthM: { label: 'Shadow of a 1 m rock', unit: 'm', fmt: 'm', q: 'computed-geometry', vis: true,
      method: '1 m / tan(mean sunlit Sun elevation), on flat ground.', limits: ['Flat-ground approximation; slopes change shadow length.'] },
    maxEarthElDeg: { label: 'Max Earth elevation (visible)', unit: '°', fmt: 'deg', q: 'computed-geometry', vis: true,
      method: 'Highest Earth centre elevation among steps where Earth is visible.', limits: GEOM_LIMITS },
    minSocPct: { label: 'Minimum battery SoC', unit: '%', fmt: 'pct', q: 'engineering-estimate', vis: true,
      method: 'Battery simulation: constant load, SoC starts at the initial value, charge clamped to capacity, discharge clamped at the depth-of-discharge floor (load shed).', limits: POWER_LIMITS.concat(['No charge/discharge efficiency, no thermal/heater model beyond the constant load.']) },
    socMarginPct: { label: 'Battery margin above DoD floor', unit: '% of capacity', fmt: 'pct', q: 'engineering-estimate', vis: true,
      method: 'Minimum SoC minus the depth-of-discharge floor (100% - DoD). Zero means the battery hit the floor (brownout).', limits: POWER_LIMITS.concat(['No charge/discharge efficiency, no thermal/heater model beyond the constant load.']) },
    brownoutMetH: { label: 'Brownout', unit: 'h', fmt: 'met', q: 'engineering-estimate', vis: true,
      method: 'First MET at which SoC reaches capacity*(1-DoD).', limits: POWER_LIMITS },
    requiredStorageWh: { label: 'Storage for longest dark gap', unit: 'Wh', fmt: 'wh', q: 'engineering-estimate', vis: true,
      method: 'load * longest dark gap / usable depth of discharge (rule of thumb).', limits: ['Rule-of-thumb sizing; ignores margins, ageing and heater power.'] },
    energyBalanceWh: { label: 'Energy balance', unit: 'Wh', fmt: 'wh', q: 'engineering-estimate', vis: true,
      method: 'Generated energy minus load energy over the mission.', limits: POWER_LIMITS },
  };

  function evidence({ metricId, value, scenario, site, mask, hw, hash, sources, extra }) {
    const d = METRICS[metricId] || { label: metricId, unit: '', q: 'computed-geometry', method: '', limits: [] };
    const assumptions = [];
    if (d.vis) assumptions.push(mask ? `Terrain horizon mask from LOLA (${mask.dem?.product || 'DEM'}), observer height ${mask.observerHeightM} m.` : 'No terrain mask: geometry-only horizon (0 deg). Visibility is optimistic.');
    if (d.q === 'engineering-estimate') assumptions.push(
      `Panel ${hw.panelType}, ${hw.panelAreaM2} m², efficiency ${(hw.efficiency * 100).toFixed(0)}%, losses ${(hw.losses * 100).toFixed(0)}%, load ${hw.loadW} W, battery ${hw.batteryWh} Wh, DoD ${(hw.dod * 100).toFixed(0)}% (user-assumption${hw.confirmed ? ', confirmed by user' : ', default'}).`);
    if (metricId === 'earthVisiblePct' || metricId === 'longestNoEarthGapH') assumptions.push(`Minimum antenna elevation ${hw.minEarthElevDeg}° (user-assumption).`);
    assumptions.push(`Site ${site.name} at ${site.lat.toFixed(4)}°, ${site.lon.toFixed(4)}°, elevation ${site.elevationM ?? 0} m (coordinates ${site.coordStatus || 'unverified'}).`);
    const srcIds = ['naif-spice'].concat(d.vis && mask ? ['lola-ldem'] : []).concat(d.q === 'engineering-estimate' ? ['solar-constant'] : []);
    return {
      metricId, label: d.label, value, unit: d.unit, qualityClass: mask || !d.vis ? d.q : d.q,
      fidelity: d.vis ? (mask ? 'terrain (LOLA)' : 'geometry only, no terrain') : 'n/a',
      inputs: ['ephemeris (MOON_ME, hourly, linear interpolation to 10 min)', mask ? `horizon_${site.id}` : 'no horizon mask', `scenario ${scenario.name || ''}: ${scenario.startUtc}, ${scenario.durationDays} d`],
      method: d.method, assumptions, limitations: d.limits,
      sources: (sources || []).filter(s => srcIds.includes(s.id)).map(s => ({ name: s.name, version: s.version, url: s.url })),
      scenarioHash: hash, codeVersion: CODE_VERSION, ...(extra || {}),
    };
  }

  // ---------- requirement checker ----------
  function compare(op, a, b) {
    switch (op) {
      case '>=': return a >= b; case '<=': return a <= b; case '>': return a > b; case '<': return a < b;
      case '==': return a === b; case '!=': return a !== b; default: throw new Error('bad op ' + op);
    }
  }
  /** ctx: { hasMask, hwConfirmed, marginPct } */
  function checkRequirement(req, metrics, ctx) {
    const value = metrics[req.metric];
    const base = { reqId: req.id, metric: req.metric, value, threshold: req.threshold, op: req.op, unit: req.unit, reasons: [] };
    if (value === null || value === undefined || Number.isNaN(value) || req.threshold === null || req.threshold === '' || Number.isNaN(+req.threshold)) {
      return { ...base, state: 'unknown', reasons: ['A required input or threshold is missing.'] };
    }
    const thr = +req.threshold;
    const pass = compare(req.op, value, thr);
    const margin = (ctx.marginPct ?? 10) / 100 * Math.max(Math.abs(thr), 1e-9);
    const near = Math.abs(value - thr) <= margin;
    let state = pass ? 'meets' : 'does not meet';
    if (pass && near) { state = 'needs review'; base.reasons.push(`Within ${ctx.marginPct ?? 10}% of the threshold.`); }
    if (!pass && near) { state = 'needs review'; base.reasons.push(`Misses the threshold by less than ${ctx.marginPct ?? 10}%.`); }
    if (req.visibilityDependent && !ctx.hasMask) {
      if (state === 'meets' || (state === 'needs review' && pass)) { state = 'needs review'; base.reasons.push('needs review (no terrain): geometry-only visibility is optimistic.'); }
      else if (state === 'does not meet') base.reasons.push('Holds without terrain: terrain can only reduce visibility.');
    }
    if (req.powerDependent && !ctx.hwConfirmed && pass) { state = 'needs review'; base.reasons.push('Uses default hardware assumptions; confirm them to finalise.'); }
    base.reasons.unshift(`${fmtNum(value, req.unit)} ${req.op} ${fmtNum(thr, req.unit)}: ${pass ? 'passes' : 'fails'} the stated threshold.`);
    return { ...base, state, pass };
  }

  // ---------- rules ----------
  function resolveVar(expr, metrics, ctx) {
    const [kind, key] = expr.split(':');
    if (kind === 'metric') return metrics[key];
    if (kind === 'hw') return key === 'dodPct' ? ctx.hw.dod * 100 : ctx.hw[key];
    if (kind === 'req') { const r = (ctx.requirements || []).find(x => x.id === key); return r ? +r.threshold : null; }
    return null;
  }
  function evalCondition(c, metrics, ctx) {
    if (c.all) return c.all.every(x => evalCondition(x, metrics, ctx));
    if (c.any) return c.any.some(x => evalCondition(x, metrics, ctx));
    if (c.flag) return !!(ctx.flags || {})[c.flag];
    if (c.comparison) return false; // handled by the app (R6)
    const v = metrics[c.metric];
    const target = 'ref' in c ? resolveVar(c.ref, metrics, ctx) : c.value;
    if (c.op === '!=' && target === null) return v !== null && v !== undefined;
    if (c.op === '==' && target === null) return v === null || v === undefined;
    if (v === null || v === undefined || target === null || target === undefined) return false;
    return compare(c.op, v, target);
  }
  function evalRule(rule, metrics, ctx) {
    if (!evalCondition(rule.condition, metrics, ctx)) return { id: rule.id, fired: false };
    const values = {};
    for (const [name, expr] of Object.entries(rule.vars || {})) values[name] = resolveVar(expr, metrics, ctx);
    const text = fillTemplate(rule.template, values);
    return { id: rule.id, fired: true, title: rule.title, severity: rule.severity, text, values, vars: rule.vars, inputs: rule.inputs, qualityClass: rule.qualityClass, condition: rule.condition };
  }
  function fillTemplate(t, values) {
    return t.replace(/\{(\w+)(?:\|(\w+))?\}/g, (_, name, f) => (name in values ? format(values[name], f) : `{${name}}`));
  }

  // ---------- formatting ----------
  function format(v, f) {
    if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return '—';
    if (typeof v !== 'number') return String(v);
    switch (f) {
      case 'h': return fmtHours(v);
      case 'met': return 'T+' + fmtHours(v);
      case 'pct': return v.toFixed(v >= 10 || v === 0 ? 0 : 1) + '%';
      case 'pct0': return v.toFixed(0) + '%';
      case 'pp': { const r = Math.round(v); return (r > 0 ? '+' : '') + r + ' points'; }
      case 'wh': return Math.abs(v) >= 10000 ? (v / 1000).toFixed(1) + ' kWh' : Math.round(v).toLocaleString('en-US') + ' Wh';
      case 'w': return Math.round(v) + ' W';
      case 'deg': return v.toFixed(1) + '°';
      case 'x1': return v.toFixed(1);
      case 'm': return v.toFixed(v < 10 ? 1 : 0) + ' m';
      case 'int': return Math.round(v).toString();
      default: return (Math.round(v * 100) / 100).toString();
    }
  }
  function fmtHours(h) {
    if (h < 47.5) return (h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)) + ' h';
    const t = Math.round(h), d = Math.floor(t / 24), r = t - d * 24;
    return r ? `${d} d ${r} h` : `${d} d`;
  }
  function fmtNum(v, unit) {
    if (unit === 'h') return fmtHours(v);
    if (unit === '%') return v.toFixed(1) + '%';
    return (Math.round(v * 10) / 10) + (unit ? ' ' + unit : '');
  }

  // ---------- misc ----------
  function hash(obj) {
    const s = JSON.stringify(obj);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  const Engine = { R_MOON_KM, AU_KM, SOLAR_CONSTANT, CODE_VERSION, PANEL_TYPES, METRICS,
    loadEphemeris, ephAt, ephRange, enu, siteFrame, azEl, maskAt, cosIncidence, simulate, timeToTransition, longestRun,
    evidence, checkRequirement, evalRule, evalCondition, fillTemplate, format, fmtHours, hash };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
