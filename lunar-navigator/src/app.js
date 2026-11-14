/* Lunar Mission Decision-Support Navigator: UI. All maths lives in engine.js. */
(function () {
  'use strict';
  const D = window.NAV_DATA;
  const E = window.Engine;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORE = 'lunarNav.v1';
  const MAX_SCEN = 3;
  const NAMES = ['A', 'B', 'C'];
  const COLOR_VARS = ['--s1', '--s2', '--s3'];

  // ---------- data ----------
  const ephBytes = Uint8Array.from(atob(D.ephemerisB64), c => c.charCodeAt(0));
  const eph = E.loadEphemeris(new Float32Array(ephBytes.buffer), D.ephemerisMeta);
  const [EPH_START, EPH_END] = E.ephRange(eph);

  const DEFAULT_HW = { panelAreaM2: 2, efficiency: 0.28, losses: 0.10, panelType: 'vertical-tracking', panelAzDeg: 0, loadW: 150, batteryWh: 5000, dod: 0.8, initialSocPct: 100, minEarthElevDeg: 2, confirmed: false };
  const DEFAULT_SCEN = [
    { siteId: 'mons-mouton', startUtc: '2027-08-11T12:00:00Z', durationDays: 10 },
    { siteId: 'mons-mouton', startUtc: '2027-09-01T12:00:00Z', durationDays: 10 },
    { siteId: 'connecting-ridge', startUtc: '2027-09-01T12:00:00Z', durationDays: 10 },
  ];
  function defaultState() {
    return {
      scenarios: DEFAULT_SCEN.map(s => ({ ...s })), hw: { ...DEFAULT_HW },
      requirements: JSON.parse(JSON.stringify(D.requirements.requirements)), marginPct: D.requirements.marginPct,
      customSites: [], uploadedMasks: {}, cursorH: 6, mapZoom: false, horizonIdx: 0, slipDays: 21,
      heat: { metric: 'sunlitPct', startUtc: '2027-07-03T12:00:00Z', stepDays: 3, count: 36 },
    };
  }
  let state;
  try { state = Object.assign(defaultState(), JSON.parse(localStorage.getItem(STORE) || 'null') || {}); }
  catch (e) { state = defaultState(); }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage unavailable */ } }

  function allSites() { return D.sites.concat(state.customSites); }
  function siteById(id) { return allSites().find(s => s.id === id); }
  function maskRec(siteId) { return state.uploadedMasks[siteId] || D.horizons[siteId] || null; }
  function color(i) { return getComputedStyle(document.documentElement).getPropertyValue(COLOR_VARS[i]).trim(); }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  // ---------- evidence registry ----------
  let EV = {};
  let evN = 0;
  function num(rec, text) {
    const k = 'e' + (evN++);
    EV[k] = rec;
    return `<button class="num" data-ev="${k}" title="Open evidence">${esc(text)}</button>`;
  }
  function inputEvidence(label, value, unit, note) {
    return { label, value, unit, qualityClass: 'user-assumption', fidelity: 'n/a', method: 'Entered by the user (or demo default).',
      inputs: ['user input'], assumptions: [note || (state.hw.confirmed ? 'Confirmed by the user.' : 'Demo default, not yet confirmed by the user.')],
      limitations: ['Replace with your mission hardware values.'], sources: [], codeVersion: E.CODE_VERSION };
  }

  // ---------- compute ----------
  const cache = new Map();
  function run(sc, stepMin = 10) {
    const site = siteById(sc.siteId);
    const mrec = maskRec(sc.siteId);
    const key = E.hash({ sc: { siteId: sc.siteId, startUtc: sc.startUtc, durationDays: sc.durationDays }, site, m: mrec ? mrec.siteId + (mrec.uploaded || '') : null, hw: state.hw, stepMin });
    if (cache.has(key)) return cache.get(key);
    let out;
    try {
      const r = E.simulate({ eph, site, mask: mrec ? mrec.maskDeg : null, scenario: sc, hw: state.hw, stepMin });
      out = { ...r, site, mrec, hash: key, error: null };
    } catch (err) { out = { error: err.message, site, mrec, hash: key }; }
    if (cache.size > 600) cache.clear();
    cache.set(key, out);
    return out;
  }
  function results() { return state.scenarios.map((sc, i) => ({ sc: { ...sc, name: NAMES[i] }, i, r: run({ ...sc, name: NAMES[i] }) })); }
  function ev(res, metricId, extra) {
    return E.evidence({ metricId, value: res.r.metrics[metricId], scenario: res.sc, site: res.r.site, mask: res.r.mrec, hw: state.hw, hash: res.r.hash, sources: D.sources, extra });
  }
  function fmtMetric(id, v) { return E.format(v, (E.METRICS[id] || {}).fmt); }
  function mnum(res, id) { const v = res.r.metrics[id]; return num(ev(res, id), v === null || v === undefined ? (id.startsWith('time') || id === 'brownoutMetH' ? 'none in mission' : '—') : fmtMetric(id, v)); }
  function ctxFor(res) { return { hasMask: !!res.r.mrec, hwConfirmed: state.hw.confirmed, marginPct: state.marginPct, hw: state.hw, requirements: state.requirements, flags: { noTerrain: !res.r.mrec } }; }

  // ---------- icons ----------
  const IC = {
    meets: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.5 8.2l2.3 2.3 4.7-4.8" stroke="#fff" stroke-width="1.8" fill="none"/></svg>',
    review: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l7 13H1z" fill="currentColor"/><path d="M8 6v3.5M8 11.3v.2" stroke="#000" stroke-width="1.7" stroke-linecap="round"/></svg>',
    fail: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="3" fill="currentColor"/><path d="M5 5l6 6M11 5l-6 6" stroke="#fff" stroke-width="1.8"/></svg>',
    unknown: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 2"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1M8 11.3v.2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 7v4.5M8 4.6v.2" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };
  const STATE_UI = { 'meets': ['st-meets', IC.meets, 'Meets'], 'needs review': ['st-review', IC.review, 'Needs review'], 'does not meet': ['st-fail', IC.fail, 'Does not meet'], 'unknown': ['st-unknown', IC.unknown, 'Unknown'] };
  const SEV_ICON = { critical: IC.fail, warning: IC.review, info: IC.info };
  function statusPill(st) { const [c, i, l] = STATE_UI[st]; return `<span class="status ${c}">${i}${l}</span>`; }

  // ---------- helpers ----------
  const fmtDate = iso => iso.slice(0, 16).replace('T', ' ') + ' UTC';
  const toLocalInput = iso => iso.slice(0, 16);
  const fromLocalInput = v => new Date(v + ':00Z').toISOString().replace('.000', '');
  function addDays(iso, d) { return new Date(Date.parse(iso) + d * 86400000).toISOString().replace('.000', ''); }
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }
  function siteOptions(sel) {
    const groups = { candidate: 'Candidate sites', past: 'Past landings', other: 'Reference points', custom: 'Custom sites' };
    return Object.entries(groups).map(([g, label]) => {
      const ss = allSites().filter(s => (s.category || 'custom') === g);
      return ss.length ? `<optgroup label="${label}">${ss.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}${maskRec(s.id) ? '' : ' (no terrain)'}</option>`).join('')}</optgroup>` : '';
    }).join('');
  }
  function fidelityBadge(site) {
    const m = maskRec(site.id);
    if (m) return `<span class="badge terrain" title="Terrain horizon mask present">⛰ Terrain: ${m.uploaded ? 'uploaded mask' : 'LOLA ' + (m.dem?.resolutionM || []).join('/') + ' m'}</span>`;
    return '<span class="badge noterrain" title="No terrain mask: visibility is geometry-only and optimistic">⚠ Geometry only, no terrain</span>';
  }

  // ---------- 1. scenarios + hardware ----------
  function renderScenarios() {
    const html = state.scenarios.map((sc, i) => {
      const site = siteById(sc.siteId);
      return `<div class="scen" style="--c:var(${COLOR_VARS[i]})" data-i="${i}">
        <div class="scen-head"><div class="scen-name"><span class="chip"></span>Scenario ${NAMES[i]}</div>${fidelityBadge(site)}</div>
        <label class="f">Site<select data-f="siteId">${siteOptions(sc.siteId)}</select></label>
        <div class="row"><label class="f">Landing (T+0), UTC<input type="datetime-local" data-f="startUtc" value="${toLocalInput(sc.startUtc)}" min="2026-01-01T00:00" max="2030-12-20T00:00"></label>
        <label class="f" style="flex:0 0 90px">Duration (d)<input type="number" data-f="durationDays" min="1" max="30" step="1" value="${sc.durationDays}"></label></div>
        <div class="row">
          <button class="btn sm" data-act="slip" ${state.scenarios.length >= MAX_SCEN ? 'disabled' : ''} title="Copy this scenario with the start moved later">Copy with launch slip +${state.slipDays} d</button>
          <button class="btn sm ghost" data-act="dup" ${state.scenarios.length >= MAX_SCEN ? 'disabled' : ''}>Duplicate</button>
          <button class="btn sm ghost" data-act="del" ${state.scenarios.length <= 1 ? 'disabled' : ''}>Remove</button>
        </div></div>`;
    }).join('') + (state.scenarios.length < MAX_SCEN ? '<button class="add-scen btn ghost" data-act="add">+ Add scenario</button>' : '');
    $('#scenarios').innerHTML = `<div class="scen-grid">${html}</div>
      <div class="row small muted" style="margin-top:8px">Launch slip for the copy button: <input type="number" id="slipdays" value="${state.slipDays}" min="1" max="120" style="width:70px"> days. Ephemeris covers ${new Date(EPH_START).toISOString().slice(0, 10)} to ${new Date(EPH_END).toISOString().slice(0, 10)}.</div>`;
  }
  function renderHardware() {
    const h = state.hw;
    const f = (k, label, step, scale = 1, unit = '') => `<label class="f">${label}<input type="number" data-hw="${k}" data-scale="${scale}" step="${step}" value="${+(h[k] * scale).toFixed(4)}">${unit ? '' : ''}</label>`;
    $('#hardware').innerHTML = `<div class="hw"><h3>Shared mission configuration <span class="muted small" style="font-weight:400">(applies to every scenario so the comparison is fair)</span></h3>
      <div class="row">
        <label class="f">Panel type<select data-hw="panelType">${E.PANEL_TYPES.map(t => `<option ${t === h.panelType ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        ${h.panelType === 'vertical-fixed' ? f('panelAzDeg', 'Panel facing az (°)', 1) : ''}
        ${f('panelAreaM2', 'Panel area (m²)', 0.1)}${f('efficiency', 'Efficiency (%)', 1, 100)}${f('losses', 'Losses (%)', 1, 100)}
        ${f('loadW', 'Load (W)', 5)}${f('batteryWh', 'Battery (Wh)', 100)}${f('dod', 'Usable depth of discharge (%)', 1, 100)}${f('initialSocPct', 'Initial charge (%)', 1)}
        ${f('minEarthElevDeg', 'Min antenna elevation (°)', 0.5)}
      </div>
      <label class="row small" style="margin-top:10px;align-items:center;gap:6px"><input type="checkbox" id="hwconfirm" ${h.confirmed ? 'checked' : ''}> These are my mission's values (otherwise power verdicts stay at “needs review” because they rest on demo defaults).</label></div>`;
  }

  // ---------- 2. verdicts + key metrics + what changed ----------
  function verdictsFor(res) { return state.requirements.map(q => E.checkRequirement(q, res.r.metrics, ctxFor(res))); }
  function renderVerdicts(R) {
    $('#keymetrics').innerHTML = `<div class="kpis">${R.map(res => {
      if (res.r.error) return `<div class="kpi" style="--c:var(${COLOR_VARS[res.i]})"><b>Scenario ${res.sc.name}</b>: ${esc(res.r.error)}</div>`;
      return `<div class="kpi" style="--c:var(${COLOR_VARS[res.i]})">
        <div class="kpi-title"><b>${res.sc.name}</b> ${esc(res.r.site.name)} · ${fmtDate(res.sc.startUtc)} · ${res.sc.durationDays} d</div>
        <div class="kpi-grid">
          <div><span class="v">${mnum(res, 'sunlitPct')}</span><span class="l">sunlit</span></div>
          <div><span class="v">${mnum(res, 'earthVisiblePct')}</span><span class="l">Earth visible (≥ ${state.hw.minEarthElevDeg}°)</span></div>
          <div><span class="v">${mnum(res, 'longestDarkGapH')}</span><span class="l">longest dark gap</span></div>
          <div><span class="v">${mnum(res, 'minSocPct')}</span><span class="l">minimum battery charge</span></div>
          <div><span class="v">${mnum(res, 'energyWh')}</span><span class="l">generated (${state.hw.panelType})</span></div>
          <div><span class="v">${res.r.metrics.brownoutMetH === null ? num(ev(res, 'brownoutMetH'), 'none') : mnum(res, 'brownoutMetH')}</span><span class="l">brownout</span></div>
        </div></div>`;
    }).join('')}</div>`;

    const ok = R.filter(x => !x.r.error);
    const V = ok.map(verdictsFor);
    let rows = state.requirements.map((q, qi) => `<tr><td><b>${esc(q.label)}</b><div class="muted small">${esc(q.metric)} ${esc(q.op)} ${num(inputEvidence(q.label + ' threshold', +q.threshold, q.unit, 'Your stated requirement (quality class user-assumption).'), q.threshold + ' ' + q.unit)}${q.visibilityDependent ? ' · visibility-dependent' : ''}</div></td>${ok.map((res, si) => {
      const v = V[si][qi];
      const evid = ev(res, q.metric, { verdict: v.state, threshold: `${q.op} ${q.threshold} ${q.unit}`, verdictReasons: v.reasons, driver: `${q.metric} = ${E.format(v.value, (E.METRICS[q.metric] || {}).fmt)} vs ${q.op} ${q.threshold} ${q.unit}` });
      return `<td>${statusPill(v.state)} <span style="margin-left:6px">${v.value === null || v.value === undefined ? '—' : num(evid, fmtMetric(q.metric, v.value))}</span><div class="reasons">${v.reasons.slice(1).map(esc).join(' ')}</div></td>`;
    }).join('')}</tr>`).join('');
    $('#verdicts').innerHTML = `<div class="tablewrap"><table><thead><tr><th>Requirement</th>${ok.map(res => `<th><span class="chip" style="--c:var(${COLOR_VARS[res.i]})"></span>Scenario ${res.sc.name}<div class="muted" style="font-weight:400">${esc(res.r.site.name)}, ${res.sc.startUtc.slice(0, 10)}</div></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
    $('#changes').innerHTML = ok.length > 1 ? `<div class="changes"><h3 style="margin:0">What changed and why</h3>${ok.slice(1).map((res, k) => changeCard(ok[0], res, V[0], V[k + 1])).join('')}</div>` : '';
  }
  function describe(res) { return `${res.r.site.name}, ${res.sc.startUtc.slice(0, 10)}`; }
  function comparison(a, b, va, vb) {
    const ma = a.r.metrics, mb = b.r.metrics;
    const scale = { sunlitPct: 100, earthVisiblePct: 100, longestDarkGapH: Math.max(ma.durationH, mb.durationH), longestNoEarthGapH: Math.max(ma.durationH, mb.durationH), minSocPct: 100 };
    const label = { sunlitPct: 'sunlit time', earthVisiblePct: 'Earth visibility', longestDarkGapH: 'the longest dark gap', longestNoEarthGapH: 'the longest no-Earth gap', minSocPct: 'minimum battery charge' };
    let best = null;
    for (const k of Object.keys(scale)) {
      const d = Math.abs((mb[k] ?? 0) - (ma[k] ?? 0)) / scale[k];
      if (!best || d > best.d) best = { k, d };
    }
    const shiftD = (Date.parse(b.sc.startUtc) - Date.parse(a.sc.startUtc)) / 86400000;
    const why = [];
    if (a.sc.siteId !== b.sc.siteId) why.push(`site changes from ${a.r.site.name} to ${b.r.site.name}`);
    if (Math.abs(shiftD) > 1e-6) why.push(`start moves ${shiftD > 0 ? 'later' : 'earlier'} by ${E.fmtHours(Math.abs(shiftD) * 24)}`);
    if (!ma.sunlitAtStart !== !mb.sunlitAtStart) why.push(mb.sunlitAtStart ? `${b.sc.name} lands in sunlight` : `${b.sc.name} lands in darkness (first sunrise ${E.format(mb.timeToSunriseH, 'met')})`);
    if (!!a.r.mrec !== !!b.r.mrec) why.push(`terrain fidelity differs (${b.r.mrec ? 'terrain' : 'geometry only'} for ${b.sc.name})`);
    const changes = state.requirements.map((q, i) => va[i].state !== vb[i].state ? { q, from: va[i], to: vb[i] } : null).filter(Boolean);
    return { best, label, why, changes, shiftD, dSun: mb.sunlitPct - ma.sunlitPct };
  }
  function changeCard(a, b, va, vb) {
    const c = comparison(a, b, va, vb);
    const r6 = D.rules.rules.find(r => r.id === 'R6');
    const text = E.fillTemplate(r6.template, { A: describe(a), B: describe(b), d: c.dSun, metric: c.label[c.best.k] });
    const evid = { label: `R6 slip delta, ${a.sc.name} → ${b.sc.name}`, value: c.dSun, unit: 'percentage points', qualityClass: r6.qualityClass, fidelity: a.r.mrec && b.r.mrec ? 'terrain (LOLA)' : 'at least one scenario geometry-only',
      method: 'Difference of sunlit %; main driver = metric with the largest change normalised by its range (pct/100, gaps/mission length).', inputs: [`scenario ${a.sc.name} (${a.r.hash})`, `scenario ${b.sc.name} (${b.r.hash})`],
      assumptions: ['Both scenarios share hardware and requirement assumptions.'], limitations: ['Rule R6 is evaluated in app.js, not by evalRule.'], sources: [], rule: r6.template, codeVersion: E.CODE_VERSION };
    return `<div class="change" style="border-left:4px solid var(${COLOR_VARS[b.i]})"><div>${num(evid, '△')} ${esc(text)}</div>
      <ul>${c.why.map(w => `<li>${esc(w[0].toUpperCase() + w.slice(1))}.</li>`).join('')}
      ${c.changes.map(x => `<li>${esc(x.q.label)}: ${STATE_UI[x.from.state][2]} → <b>${STATE_UI[x.to.state][2]}</b> (${esc(fmtMetric(x.q.metric, x.from.value))} → ${esc(fmtMetric(x.q.metric, x.to.value))})</li>`).join('')}
      ${c.changes.length ? '' : '<li>No requirement verdict changes.</li>'}</ul></div>`;
  }

  // ---------- 3. implications ----------
  function renderImplications(R) {
    const ORDER = { critical: 0, warning: 1, info: 2 };
    $('#implications').innerHTML = `<div class="impl-grid">${R.filter(x => !x.r.error).map(res => {
      const fired = D.rules.rules.filter(r => !r.condition.comparison).map(r => E.evalRule(r, res.r.metrics, ctxFor(res))).filter(x => x.fired).sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
      return `<div class="impl-col"><h3><span class="chip" style="--c:var(${COLOR_VARS[res.i]})"></span>Scenario ${res.sc.name} <span class="muted small" style="font-weight:400">${esc(res.r.site.name)}</span></h3>
      ${fired.map(f => {
        const k = 'e' + (evN++);
        EV[k] = { label: `Rule ${f.id}: ${f.title}`, value: null, qualityClass: f.qualityClass, fidelity: res.r.mrec ? 'terrain (LOLA)' : 'geometry only, no terrain', method: 'Rule-based template from rules.json (no free-text AI).',
          inputs: f.inputs, assumptions: Object.entries(f.values).map(([n, v]) => `${n} = ${typeof v === 'number' ? (Math.round(v * 1000) / 1000) : v} (from ${f.vars[n]})`),
          limitations: ['Wording is a template; it inherits the limitations of its input metrics.'], sources: [], condition: f.condition, scenarioHash: res.r.hash, codeVersion: E.CODE_VERSION };
        return `<button class="impl sev-${f.severity}" data-ev="${k}">${SEV_ICON[f.severity]}<span>${esc(f.text)}<br><span class="rid">${f.id} · ${esc(f.title)} · ${f.severity}</span></span></button>`;
      }).join('') || '<p class="muted">No rules fired.</p>'}</div>`;
    }).join('')}</div>`;
  }

  // ---------- 4. timeline ----------
  let tl = null;
  function renderTimeline(R) {
    const maxH = Math.max(...R.map(x => x.sc.durationDays * 24));
    if (state.cursorH > maxH) state.cursorH = 0;
    $('#timeline').innerHTML = `<div class="legend"><span><i class="sw" style="background:var(--sun)"></i>Sun visible (above terrain)</span><span><i class="sw" style="background:var(--earth);opacity:.75"></i>Earth visible (≥ min antenna elevation)</span><span>Lines: battery state of charge, one per scenario</span></div>
      <div class="chartbox"><canvas id="tl-canvas" aria-label="Timeline of Sun and Earth visibility and battery charge per scenario"></canvas></div>
      <div class="cursor-row"><label for="cursor" class="small">Cursor</label><input type="range" id="cursor" min="0" max="${maxH}" step="${1 / 6}" value="${state.cursorH}"><span class="mono" id="cursor-lbl"></span></div>
      <div class="readout" id="readout"></div>`;
    tl = { R: R.filter(x => !x.r.error), maxH };
    drawTimeline();
    renderReadout();
  }
  function drawTimeline(hoverH) {
    const cv = $('#tl-canvas'); if (!cv || !tl) return;
    const W = cv.clientWidth || 800, padL = 46, padR = 26, rowH = 34, socH = 130, top = 8;
    const H = top + tl.R.length * rowH + 14 + socH + 28;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const x = h => padL + (W - padL - padR) * h / tl.maxH;
    g.font = '11px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
    const grid = cssVar('--grid'), muted = cssVar('--muted'), text2 = cssVar('--text-2');
    // day grid
    const stepD = tl.maxH > 24 * 20 ? 48 : 24;
    g.strokeStyle = grid; g.lineWidth = 1;
    for (let h = 0; h <= tl.maxH + 1e-9; h += stepD) { g.beginPath(); g.moveTo(x(h) + .5, top); g.lineTo(x(h) + .5, H - 22); g.stroke(); }
    g.fillStyle = muted; g.textAlign = 'center';
    for (let h = 0; h <= tl.maxH + 1e-9; h += stepD) g.fillText('T+' + (h / 24) + 'd', x(h), H - 10);
    // rows
    tl.R.forEach((res, j) => {
      const y0 = top + j * rowH, s = res.r.series, dt = s.stepMin / 60;
      g.fillStyle = text2; g.textAlign = 'left'; g.font = '600 12px Inter, system-ui, sans-serif'; g.fillText(res.sc.name, 6, y0 + 13);
      g.font = '11px Inter, system-ui, sans-serif';
      g.fillStyle = cssVar('--surface-2'); g.fillRect(x(0), y0 + 3, x(res.sc.durationDays * 24) - x(0), 13); g.fillRect(x(0), y0 + 19, x(res.sc.durationDays * 24) - x(0), 9);
      const runs = (arr, color, yy, hh, alpha) => {
        g.fillStyle = color; g.globalAlpha = alpha;
        let st = -1;
        for (let i = 0; i <= arr.length; i++) {
          const on = i < arr.length && arr[i];
          if (on && st < 0) st = i;
          if (!on && st >= 0) { g.fillRect(x(st * dt), yy, Math.max(1, x(i * dt) - x(st * dt)), hh); st = -1; }
        }
        g.globalAlpha = 1;
      };
      runs(s.sunVis, cssVar('--sun'), y0 + 3, 13, 1);
      runs(s.earthVis, cssVar('--earth'), y0 + 19, 9, .75);
      g.fillStyle = color(res.i); g.fillRect(padL - 8, y0 + 3, 4, 25);
    });
    // SoC chart
    const sy0 = top + tl.R.length * rowH + 14, sy = v => sy0 + socH - socH * v / 100;
    g.strokeStyle = grid; g.fillStyle = muted; g.textAlign = 'right';
    for (const v of [0, 50, 100]) { g.beginPath(); g.moveTo(padL, sy(v) + .5); g.lineTo(W - padR, sy(v) + .5); g.stroke(); g.fillText(v + '%', padL - 6, sy(v)); }
    const floorPct = 100 * (1 - state.hw.dod);
    g.setLineDash([4, 4]); g.strokeStyle = cssVar('--crit'); g.beginPath(); g.moveTo(padL, sy(floorPct)); g.lineTo(W - padR, sy(floorPct)); g.stroke(); g.setLineDash([]);
    g.fillStyle = cssVar('--crit'); g.textAlign = 'left'; g.fillText('DoD floor', padL + 4, sy(floorPct) - 8);
    const used = [];
    tl.R.forEach(res => {
      const s = res.r.series, dt = s.stepMin / 60;
      g.strokeStyle = color(res.i); g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
      for (let i = 0; i < s.n; i++) { const X = x(i * dt), Y = sy(100 * s.soc[i] / state.hw.batteryWh); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
      g.stroke();
      const last = s.n - 1; g.fillStyle = color(res.i); g.font = '600 11px Inter, system-ui, sans-serif'; g.textAlign = 'left';
      let ly = sy(100 * s.soc[last] / state.hw.batteryWh) - 8; while (used.some(u => Math.abs(u - ly) < 12)) ly += 12; used.push(ly);
      g.fillText(res.sc.name, Math.min(x(last * dt) + 4, W - 14), ly);
      g.font = '11px Inter, system-ui, sans-serif';
    });
    // cursor + hover
    const line = (h, col, dash) => { g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x(h), top); g.lineTo(x(h), H - 22); g.stroke(); g.setLineDash([]); };
    if (hoverH !== undefined) line(hoverH, muted, [3, 3]);
    line(state.cursorH, cssVar('--text'));
    tl.geom = { x, padL, padR, W };
  }
  function sampleAt(res, h) {
    const s = res.r.series, i = Math.round(h * 60 / s.stepMin);
    return i >= 0 && i < s.n ? i : null;
  }
  function renderReadout() {
    if (!tl) return;
    const h = state.cursorH;
    $('#cursor-lbl').textContent = 'T+' + E.fmtHours(h);
    $('#readout').innerHTML = tl.R.map(res => {
      const i = sampleAt(res, h);
      if (i === null) return `<div class="r" style="--c:var(${COLOR_VARS[res.i]})"><b>${res.sc.name}</b>: mission already ended</div>`;
      const s = res.r.series, dt = s.stepMin / 60;
      const ins = (label, v, unit, method) => num({ label, value: v, unit, qualityClass: 'computed-geometry', fidelity: res.r.mrec ? 'terrain (LOLA)' : 'geometry only, no terrain', method, inputs: ['ephemeris', res.r.mrec ? 'horizon_' + res.r.site.id : 'no mask', `${res.sc.name} at T+${E.fmtHours(h)}`], assumptions: ['Azimuth 0 = local north, clockwise. Disc centre.'], limitations: ['Geometric, no aberration (~0.006°).'], sources: D.sources.filter(x => x.id === 'naif-spice'), scenarioHash: res.r.hash, codeVersion: E.CODE_VERSION }, (unit === '°' ? v.toFixed(2) + '°' : E.format(v, unit)));
      const utc = new Date(s.t0 + i * s.stepMin * 60000).toISOString().slice(0, 16).replace('T', ' ');
      const nextSet = E.timeToTransition(s.sunVis, i, 1, 0, dt), nextRise = E.timeToTransition(s.sunVis, i, 0, 1, dt);
      const nextEset = E.timeToTransition(s.earthVis, i, 1, 0, dt), nextErise = E.timeToTransition(s.earthVis, i, 0, 1, dt);
      const tt = (v, w) => v === null ? `no ${w} before mission end` : `${w} in ${num({ label: 'Time to ' + w, value: v, unit: 'h', qualityClass: 'computed-geometry', method: 'Steps from the cursor to the next transition.', inputs: ['visibility series'], assumptions: [], limitations: ['Null when no transition falls within the mission.'], sources: [], codeVersion: E.CODE_VERSION }, E.fmtHours(v))}`;
      return `<div class="r" style="--c:var(${COLOR_VARS[res.i]})"><b>${res.sc.name}</b> · ${utc} UTC<br>
        Sun az ${ins('Sun azimuth', s.sunAz[i], '°', 'Azimuth of the Moon-to-Sun vector in the site ENU frame.')} el ${ins('Sun elevation', s.sunEl[i], '°', 'Elevation of the Sun centre above the local tangent plane.')} vs terrain ${ins('Terrain horizon at Sun azimuth', s.horizonSun[i], '°', 'Horizon mask, linear interpolation in azimuth.')} → <b>${s.sunVis[i] ? 'visible' : 'hidden'}</b>, ${s.sunVis[i] ? tt(nextSet, 'sunset') : tt(nextRise, 'sunrise')}<br>
        Earth az ${ins('Earth azimuth', s.earthAz[i], '°', 'Azimuth of the site-to-Earth vector (parallax included).')} el ${ins('Earth elevation', s.earthEl[i], '°', 'Elevation of the Earth centre (site-to-Earth vector).')} → <b>${s.earthVis[i] ? 'visible' : 'hidden'}</b>, ${s.earthVis[i] ? tt(nextEset, 'Earthset') : tt(nextErise, 'Earthrise')}<br>
        Power ${num({ label: 'Array power', value: s.power[i], unit: 'W', qualityClass: 'engineering-estimate', method: 'P = A·η·1361·(1 AU/r)²·cosθ·sunVisible·(1−losses)', inputs: ['Sun geometry', 'hardware'], assumptions: [`Panel ${state.hw.panelType}`], limitations: ['No dust, self-shadowing, temperature, degradation.'], sources: D.sources.filter(x => x.id === 'solar-constant'), codeVersion: E.CODE_VERSION }, E.format(s.power[i], 'w'))} · battery ${num({ label: 'Battery state of charge', value: 100 * s.soc[i] / state.hw.batteryWh, unit: '%', qualityClass: 'engineering-estimate', method: 'Constant-load battery simulation.', inputs: ['power series', 'hardware'], assumptions: [], limitations: ['No charge efficiency or thermal model.'], sources: [], codeVersion: E.CODE_VERSION }, (100 * s.soc[i] / state.hw.batteryWh).toFixed(0) + '%')}</div>`;
    }).join('');
  }

  // ---------- 5. horizon view ----------
  function renderHorizon(R) {
    const ok = R.filter(x => !x.r.error);
    if (state.horizonIdx >= ok.length) state.horizonIdx = 0;
    const res = ok[state.horizonIdx];
    if (!res) { $('#horizon').innerHTML = ''; return; }
    const mask = res.r.mrec ? res.r.mrec.maskDeg : null;
    const s = res.r.series, i = sampleAt(res, state.cursorH) ?? 0;
    const W = 900, H = 300, pl = 40, pr = 10, pt = 14, pb = 30;
    const yMax = Math.max(10, Math.ceil(Math.max(...(mask || [0]), s.earthEl.reduce((a, b) => Math.max(a, b), -90), 3) + 2));
    const yMin = Math.min(-4, Math.floor(Math.min(...(mask || [0]), -3)));
    const X = az => pl + (W - pl - pr) * az / 360, Y = el => pt + (H - pt - pb) * (yMax - el) / (yMax - yMin);
    let path = '';
    if (mask) { path = `M${X(0)},${Y(yMin)} ` + mask.map((m, k) => `L${X(k).toFixed(1)},${Y(m).toFixed(1)}`).join(' ') + ` L${X(360)},${Y(mask[0])} L${X(360)},${Y(yMin)} Z`; }
    const track = (azA, elA) => { let d = '', prev = null; for (let k = 0; k < s.n; k += 3) { const a = azA[k]; d += (prev === null || Math.abs(a - prev) > 180 ? 'M' : 'L') + X(a).toFixed(1) + ',' + Y(elA[k]).toFixed(1) + ' '; prev = a; } return d; };
    const ticksX = [0, 45, 90, 135, 180, 225, 270, 315, 360].map(a => `<line x1="${X(a)}" x2="${X(a)}" y1="${pt}" y2="${H - pb}" stroke="var(--grid)"/><text x="${X(a)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--muted)">${a}° ${({ 0: 'N', 90: 'E', 180: 'S', 270: 'W', 360: 'N' })[a] || ''}</text>`).join('');
    const ticksY = []; for (let e = Math.ceil(yMin / 2) * 2; e <= yMax; e += (yMax - yMin > 20 ? 5 : 2)) ticksY.push(`<line x1="${pl}" x2="${W - pr}" y1="${Y(e)}" y2="${Y(e)}" stroke="var(--grid)"/><text x="${pl - 6}" y="${Y(e) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${e}°</text>`);
    const sunAz = s.sunAz[i], sunEl = s.sunEl[i], eAz = s.earthAz[i], eEl = s.earthEl[i];
    const marker = (az, el, col, label, vis) => { const right = X(az) > W - 170; return `<g><circle cx="${X(az)}" cy="${Y(el)}" r="8" fill="${vis ? col : 'none'}" stroke="${col}" stroke-width="2.5"/><circle cx="${X(az)}" cy="${Y(el)}" r="11" fill="none" stroke="var(--surface)" stroke-width="2"/><text x="${X(az) + (right ? -14 : 14)}" y="${Y(el) - 10}" text-anchor="${right ? 'end' : 'start'}" font-size="12" font-weight="600" fill="var(--text)" stroke="var(--surface)" stroke-width="3" paint-order="stroke">${label} ${el.toFixed(1)}°${vis ? '' : ' (hidden)'}</text></g>`; };
    $('#horizon').innerHTML = `<div class="tabs">${ok.map((x, k) => `<button class="btn sm" data-hz="${k}" aria-pressed="${k === state.horizonIdx}"><span class="chip" style="--c:var(${COLOR_VARS[x.i]});margin-right:6px"></span>${x.sc.name}: ${esc(x.r.site.name)}</button>`).join('')}</div>
      <div class="legend"><span><i class="sw" style="background:var(--terrain)"></i>Terrain horizon (LOLA)</span><span><i class="sw" style="background:var(--sun)"></i>Sun (filled = visible)</span><span><i class="sw" style="background:var(--earth)"></i>Earth</span><span>Dotted: paths over the mission · dashed: min antenna elevation</span><span class="mono">T+${E.fmtHours(state.cursorH)}</span></div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Horizon view: terrain silhouette by azimuth with Sun and Earth positions">
        ${ticksY.join('')}${ticksX}
        <line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)" stroke-width="1"/>
        ${mask ? `<path d="${path}" fill="var(--terrain)" stroke="var(--terrain-edge)" stroke-width="1"/>` : `<text x="${W / 2}" y="${Y(0) + 18}" text-anchor="middle" font-size="12" fill="var(--muted)">No terrain mask: geometric horizon at 0° (optimistic)</text>`}
        <line x1="${pl}" x2="${W - pr}" y1="${Y(state.hw.minEarthElevDeg)}" y2="${Y(state.hw.minEarthElevDeg)}" stroke="var(--earth)" stroke-dasharray="6 5" stroke-width="1"/>
        <path d="${track(s.sunAz, s.sunEl)}" fill="none" stroke="var(--sun)" stroke-width="1.5" stroke-dasharray="1 3" stroke-linecap="round"/>
        <path d="${track(s.earthAz, s.earthEl)}" fill="none" stroke="var(--earth)" stroke-width="1.5" stroke-dasharray="1 3" stroke-linecap="round"/>
        ${marker(eAz, eEl, 'var(--earth)', 'Earth', !!s.earthVis[i])}${marker(sunAz, sunEl, 'var(--sun)', 'Sun', !!s.sunVis[i])}
      </svg>
      <p class="small muted">Azimuth 0° = local north, clockwise. ${mask ? `Mask: ${esc(res.r.mrec.uploaded ? 'uploaded by user' : res.r.mrec.dem.product)}, observer ${res.r.mrec.observerHeightM ?? 2} m, ray range ${res.r.mrec.dem?.extentKm ?? '?'} km.` : ''} A 1 m rock now casts a ${sunEl > 0 ? num({ label: 'Shadow of a 1 m rock (now)', value: 1 / Math.tan(sunEl * Math.PI / 180), unit: 'm', qualityClass: 'computed-geometry', method: '1 / tan(Sun elevation), flat ground.', inputs: ['Sun elevation at cursor'], assumptions: ['Flat ground'], limitations: ['Slopes change shadow length'], sources: [], codeVersion: E.CODE_VERSION }, E.format(1 / Math.tan(sunEl * Math.PI / 180), 'm')) : 'endless (Sun below 0°)'} shadow.</p>`;
  }

  // ---------- 6. heatmap ----------
  const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
  function rampColor(v) { const t = Math.max(0, Math.min(1, v / 100)) * (RAMP.length - 1); return RAMP[Math.round(t)]; }
  let heatTimer = null;
  function renderHeatmap() {
    const h = state.heat;
    const dur = state.scenarios[0]?.durationDays || 10;
    const sites = allSites().filter(s => s.category !== 'other' || s.id === 'shackleton-floor');
    const dates = []; for (let k = 0; k < h.count; k++) dates.push(addDays(h.startUtc, k * h.stepDays));
    $('#heatmap').innerHTML = `<div class="row" style="margin-bottom:10px">
        <div class="tabs" style="margin:0"><button class="btn sm" data-hm="sunlitPct" aria-pressed="${h.metric === 'sunlitPct'}">Sunlit %</button><button class="btn sm" data-hm="earthVisiblePct" aria-pressed="${h.metric === 'earthVisiblePct'}">Earth-visible %</button></div>
        <label class="f">First start date (UTC)<input type="date" id="hm-start" value="${h.startUtc.slice(0, 10)}"></label>
        <label class="f">Step (days)<input type="number" id="hm-step" value="${h.stepDays}" min="1" max="30"></label>
        <span class="ramp">0%<span class="bar" style="background:linear-gradient(90deg,${RAMP.join(',')})"></span>100%</span>
        <span class="small muted">${dur}-day missions (Scenario A's duration), 10-min steps, landing at 12:00 UTC</span></div><div id="heat-grid" class="muted small">Computing…</div>`;
    clearTimeout(heatTimer);
    heatTimer = setTimeout(() => {
      const cols = dates.length;
      let html = `<div class="heat" style="grid-template-columns: 170px repeat(${cols}, minmax(16px, 1fr))">`;
      for (const s of sites) {
        html += `<div class="hl" title="${esc(s.name)}">${esc(s.name)}${maskRec(s.id) ? '' : ' ⚠'}</div>`;
        for (const d of dates) {
          const r = run({ siteId: s.id, startUtc: d, durationDays: dur });
          const v = r.error ? null : r.metrics[h.metric];
          const selIdx = state.scenarios.findIndex(sc => sc.siteId === s.id && sc.startUtc.slice(0, 10) === d.slice(0, 10));
          html += `<button class="hc ${selIdx >= 0 ? 'sel' : ''}" style="background:${v === null ? 'var(--surface-2)' : rampColor(v)};${selIdx >= 0 ? `--c:var(${COLOR_VARS[selIdx]})` : ''}" data-cell="${s.id}|${d}" data-tt="${esc(s.name)}|${d.slice(0, 10)}|${v === null ? 'outside table' : v.toFixed(0) + '%'}|${r.error ? '' : r.metrics.sunlitPct.toFixed(0) + '% sunlit, ' + r.metrics.earthVisiblePct.toFixed(0) + '% Earth, dark gap ' + E.fmtHours(r.metrics.longestDarkGapH)}${maskRec(s.id) ? '' : ' (geometry only)'}" aria-label="${esc(s.name)} ${d.slice(0, 10)}: ${v === null ? 'n/a' : v.toFixed(0) + '%'}"></button>`;
        }
      }
      html += '<div></div>' + dates.map((d, k) => `<div class="hx">${k % 2 === 0 ? d.slice(5, 10) : ''}</div>`).join('') + '</div>';
      html += `<p class="small muted">Rows marked ⚠ have no terrain mask (optimistic). Dots mark the loaded scenarios. Click a cell to load it into the last scenario slot (or a new slot if fewer than 3).</p>`;
      $('#heat-grid').outerHTML = html;
    }, 30);
  }

  // ---------- 7. requirements editor ----------
  function renderReqEditor() {
    const metricOpts = sel => ['sunlitPct', 'earthVisiblePct', 'longestDarkGapH', 'longestNoEarthGapH', 'minSocPct', 'socMarginPct', 'energyBalanceWh', 'requiredStorageWh', 'meanSunElDeg', 'maxEarthElDeg'].map(m => `<option ${m === sel ? 'selected' : ''}>${m}</option>`).join('');
    $('#reqedit').innerHTML = `<div class="tablewrap"><table><thead><tr><th>Label</th><th>Metric</th><th>Op</th><th>Threshold</th><th>Unit</th><th>Visibility-dependent</th><th>Power-dependent</th><th></th></tr></thead><tbody>
      ${state.requirements.map((q, i) => `<tr data-ri="${i}"><td><input data-rf="label" value="${esc(q.label)}" style="width:100%;min-width:180px"></td><td><select data-rf="metric">${metricOpts(q.metric)}</select></td>
        <td><select data-rf="op">${['>=', '<=', '>', '<'].map(o => `<option ${o === q.op ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
        <td><input type="number" data-rf="threshold" value="${q.threshold}" step="any"></td><td><input data-rf="unit" value="${esc(q.unit)}" style="width:60px"></td>
        <td><input type="checkbox" data-rf="visibilityDependent" ${q.visibilityDependent ? 'checked' : ''}></td><td><input type="checkbox" data-rf="powerDependent" ${q.powerDependent ? 'checked' : ''}></td>
        <td><button class="btn sm ghost" data-rdel="${i}">Remove</button></td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" id="req-add">+ Add requirement</button><button class="btn sm ghost" id="req-reset">Reset to defaults</button>
      <label class="row small" style="align-items:center;gap:6px">“Needs review” margin <input type="number" id="margin" value="${state.marginPct}" min="0" max="50" style="width:70px"> % of threshold</label></div>
      <p class="small muted">Empty threshold → “unknown”. Visibility-dependent requirements cannot read “meets” without a terrain mask (fidelity rule). Power-dependent ones stay “needs review” until you confirm the hardware values.</p>`;
  }

  // ---------- 8. sites ----------
  function renderSites() {
    const pm = state.mapZoom ? D.polemapZoom : D.polemap;
    const R2 = 2 * E.R_MOON_KM;
    const proj = (lat, lon) => { const r = R2 * Math.tan(Math.PI / 4 + lat * Math.PI / 360); return [50 + 50 * r * Math.sin(lon * Math.PI / 180) / pm.meta.halfKm, 50 - 50 * r * Math.cos(lon * Math.PI / 180) / pm.meta.halfKm]; };
    const used = new Set(state.scenarios.map(s => s.siteId));
    const placed = [];
    const markers = allSites().map(s => { const [x, y] = proj(s.lat, s.lon); if (x < 0 || x > 100 || y < 0 || y > 100) return ''; const u = used.has(s.id);
      const crowded = placed.some(p => Math.hypot(p[0] - x, p[1] - y) < 4); placed.push([x, y]);
      if (crowded && !u) return `<circle cx="${x}" cy="${y}" r="1.2" fill="#fff" stroke="#000" stroke-width=".4"><title>${esc(s.name)}</title></circle>`;
      return `<g><circle cx="${x}" cy="${y}" r="${u ? 1.6 : 1.2}" fill="${u ? 'var(--sun)' : '#fff'}" stroke="#000" stroke-width=".4"/><text x="${x + 2.2}" y="${y + 1}" font-size="2.6" fill="#fff" stroke="#000" stroke-width=".5" paint-order="stroke" font-weight="600">${esc(s.name.split(' (')[0])}</text></g>`; }).join('');
    const ticks = [0, 90, 180, 270].map(l => { const [x, y] = proj(state.mapZoom ? -89.3 : -85, l); return `<text x="${x}" y="${y}" font-size="2.6" fill="#fff" stroke="#000" stroke-width=".5" paint-order="stroke" text-anchor="middle">${l === 0 ? '0°' : l === 90 ? '90°E' : l === 180 ? '180°' : '90°W'}</text>`; }).join('');
    const ring = lat => { const r = 50 * R2 * Math.tan(Math.PI / 4 + lat * Math.PI / 360) / pm.meta.halfKm; return `<circle cx="50" cy="50" r="${r}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".25" stroke-dasharray="1 1"/>`; };
    const links = s => `<a href="https://quickmap.lroc.im-ldi.com/" target="_blank" rel="noopener">QuickMap</a> · <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener">Moon Trek</a> · <button class="btn sm ghost" data-copy="${s.lat}, ${s.lon}" title="Copy latitude, longitude">copy</button>`;
    const siteEv = (s, field, v, unit) => num({ label: `${s.name}: ${field}`, value: v, unit, qualityClass: field === 'elevation' ? (s.terrain === 'lola' ? 'measured' : 'user-assumption') : (s.coordStatus === 'verified' ? 'measured' : 'user-assumption'), fidelity: 'n/a',
      method: field === 'elevation' ? 'Bilinear LOLA DEM height at the site, relative to 1737.4 km.' : (s.refine?.done ? `Refined: ${s.refine.rule} within ${s.refine.radiusKm} km of (${s.refine.from.join(', ')}).` : 'As listed in sites.json.'),
      inputs: ['sites.json'], assumptions: [`Coordinate status: ${s.coordStatus || 'user-entered'}`], limitations: s.coordStatus === 'verified' ? [] : ['Coordinates approximate: verify against the primary source before use.'], sources: [{ name: s.source || 'user entry', version: '', url: '' }], codeVersion: E.CODE_VERSION }, v === null || v === undefined ? '—' : (unit === '°' ? v.toFixed(3) + '°' : Math.round(v) + ' m'));
    $('#sites').innerHTML = `<div class="sites-grid"><div><div class="polemap"><img alt="Shaded relief of the lunar south pole from LOLA" src="data:image/png;base64,${pm.png}"><svg viewBox="0 0 100 100">${state.mapZoom ? ring(-89.5) + ring(-89.75) : ring(-89) + ring(-88) + ring(-86) + ring(-84)}${markers}${ticks}</svg></div>
      <div class="tabs" style="margin-top:8px"><button class="btn sm" data-zoom="0" aria-pressed="${!state.mapZoom}">Region ±175 km</button><button class="btn sm" data-zoom="1" aria-pressed="${state.mapZoom}">Pole ±30 km</button></div>
      <div class="mapcap">LOLA ${esc(pm.meta.product)} shaded relief, ±${pm.meta.halfKm} km polar stereographic, 0° longitude up. Rings at ${state.mapZoom ? '89.5, 89.75' : '89, 88, 86, 84'}°S. Yellow = used in a scenario.</div></div>
      <div class="tablewrap"><table><thead><tr><th>Site</th><th>Lat</th><th>Lon</th><th>Elev.</th><th>Terrain</th><th>Coords</th><th>Inspect</th></tr></thead><tbody>
      ${allSites().map(s => `<tr><td><b>${esc(s.name)}</b><div class="small muted">${esc(s.category || 'custom')}${s.notes ? ' · ' + esc(s.notes) : ''}</div></td><td>${siteEv(s, 'latitude', s.lat, '°')}</td><td>${siteEv(s, 'longitude', s.lon, '°')}</td><td>${siteEv(s, 'elevation', s.elevationM, 'm')}</td>
        <td>${fidelityBadge(s)}</td><td class="small">${esc(s.coordStatus || 'user-entered')}${s.refine?.done ? '<br><span class="muted">refined to DEM high point</span>' : ''}</td><td class="small">${links(s)}${s.id.startsWith('custom-') ? ` · <button class="btn sm ghost" data-sdel="${s.id}">remove</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="uploads">
        <div class="box"><h3>Upload a horizon mask</h3><p class="small muted" style="margin:0">JSON in the <span class="mono">horizon_&lt;siteId&gt;.json</span> contract (360 <span class="mono">maskDeg</span>, 0 = N, clockwise) or a text/CSV file with 360 numbers. Marked user-supplied in the evidence.</p>
          <div class="row"><select id="up-site">${allSites().map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><input type="file" id="up-file" accept=".json,.csv,.txt"></div>
          <div class="small">${Object.keys(state.uploadedMasks).map(id => `Uploaded for ${esc(siteById(id)?.name || id)} <button class="btn sm ghost" data-unmask="${id}">remove</button>`).join('<br>')}</div></div>
        <div class="box"><h3>Add a custom site</h3><div class="row"><label class="f">Name<input id="cs-name" placeholder="My site"></label><label class="f">Lat (°)<input id="cs-lat" type="number" step="any" placeholder="-89.5"></label><label class="f">Lon (°E)<input id="cs-lon" type="number" step="any" placeholder="120"></label><label class="f">Elevation (m)<input id="cs-el" type="number" step="any" placeholder="0"></label></div>
          <button class="btn sm" id="cs-add">Add site</button><p class="small muted" style="margin:0">Custom sites have no terrain mask (geometry only) until you upload one.</p></div>
        <div class="box"><h3>Explore the terrain with NASA tools</h3><p class="small" style="margin:0">Use <a href="https://quickmap.lroc.im-ldi.com/" target="_blank" rel="noopener">LROC QuickMap</a> for imagery and slopes, <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener">Moon Trek</a> for 3-D terrain, and <a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noopener">JPL Horizons</a> for an independent Sun and Earth position. Background: <a href="https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/" target="_blank" rel="noopener">CSA Moon exploration</a>.</p></div>
      </div>`;
  }

  // ---------- 9. validation ----------
  function selfTest() {
    let worst = 0, mism = 0;
    for (const r of D.reference) {
      const site = D.sites.find(s => s.id === r.scenario.siteId);
      const m = D.horizons[r.scenario.siteId];
      const out = E.simulate({ eph, site, mask: m ? m.maskDeg : null, scenario: r.scenario, hw: DEFAULT_HW });
      for (const smp of r.samples) {
        const k = smp.k;
        worst = Math.max(worst, Math.abs(out.series.sunEl[k] - smp.sunEl), Math.abs(out.series.earthEl[k] - smp.earthEl), Math.abs(((out.series.sunAz[k] - smp.sunAz + 540) % 360) - 180));
        if (!!out.series.sunVis[k] !== smp.sunVisible || !!out.series.earthVis[k] !== smp.earthVisible) mism++;
      }
    }
    return { worst, mism, ok: worst < 1e-3 && !mism };
  }
  function renderValidation() {
    const st = selfTest();
    const v = D.validation;
    const hz = v.horizonsCheck;
    const checkRow = (ok, name, detail) => `<div class="check">${ok ? `<span class="status st-meets" style="padding:2px">${IC.meets}</span>` : `<span class="status st-fail" style="padding:2px">${IC.fail}</span>`}<div><b>${esc(name)}</b>: ${esc(detail)}</div></div>`;
    $('#validation').innerHTML = `<div class="two"><div><h3>Checks</h3><div class="checks">
      ${checkRow(st.ok, 'Browser engine vs Python reference (run now)', `worst angle difference ${st.worst.toExponential(1)}°, ${st.mism} visibility mismatches over ${D.reference.length} scenarios`)}
      ${hz ? checkRow(hz.status === 'pass', 'Independent check vs JPL Horizons', `${hz.rows.length} Sun/Earth az/el comparisons at 3 sites and 3 dates; worst difference ${hz.worstAbsDiffDeg}° (tolerance ${hz.tolerance}°). Mostly light-time aberration, which our geometric table omits.`) : checkRow(false, 'Independent check vs JPL Horizons', 'not run')}
      ${v.checks.map(c => checkRow(c.status === 'pass', c.name, c.detail)).join('')}
      </div></div>
      <div><h3>Known limits</h3><ul class="limits small">
        <li>Visibility uses the Sun and Earth disc centres; partial discs (Sun 0.27°, Earth 0.95° radius) are not modelled.</li>
        <li>Terrain masks: LOLA 40/80/120 m polar DEMs, 1° azimuth bins, 200 km rays, 2 m observer. Sub-pixel boulders and the lander itself are not modelled. Shiv Shakti and custom sites have no terrain (geometry only).</li>
        <li>Earth visibility is geometric line of sight above a minimum antenna elevation. It is not a link budget; relay satellites are out of scope.</li>
        <li>Power is an engineering estimate: no dust, self-shadowing, temperature derating, reflected light, degradation or heater model beyond the constant load.</li>
        <li>Ephemeris 2026-2030, hourly, interpolated to 10-min steps; geometric (no aberration, ~0.006°).</li>
        <li>Most site coordinates are approximate (marked in the site table). Ridge and rim sites were refined to the local LOLA high point.</li>
        <li>Illumination benchmarks use published ranges (Mazarico 2011, Gläser 2018) as plausibility bounds, not point-by-point comparisons.</li>
        <li>Time to sunset/sunrise is empty when no transition falls inside the mission.</li>
      </ul>
      <h3>Data sources</h3><ul class="small">${D.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> <span class="muted">${esc(s.version)}</span> <span class="qc">${esc(s.qualityClass)}</span></li>`).join('')}</ul>
      <p class="small muted">Quality classes: <span class="qc">measured</span> <span class="qc">computed-geometry</span> <span class="qc">engineering-estimate</span> <span class="qc">user-assumption</span> <span class="qc">demo-only</span>. Engine ${esc(E.CODE_VERSION)}; data built ${esc(D.builtUtc)}.</p></div></div>`;
  }

  // ---------- evidence drawer ----------
  function openDrawer(rec) {
    const list = a => a && a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="muted">none recorded</span>';
    const val = rec.value === null || rec.value === undefined ? '—' : (typeof rec.value === 'number' ? (Math.round(rec.value * 1000) / 1000).toLocaleString('en-US') : esc(rec.value));
    $('#drawer-body').innerHTML = `<div class="muted small">${esc(rec.metricId || '')}</div><h3 style="font-size:16px">${esc(rec.label)}</h3>
      <div class="ev-value">${val} <span style="font-size:14px;font-weight:400">${esc(rec.unit || '')}</span></div>
      <dl><dt>Quality class</dt><dd><span class="qc">${esc(rec.qualityClass)}</span></dd>
      ${rec.fidelity && rec.fidelity !== 'n/a' ? `<dt>Fidelity</dt><dd>${esc(rec.fidelity)}</dd>` : ''}
      ${rec.verdict ? `<dt>Verdict</dt><dd>${statusPill(rec.verdict)} against ${esc(rec.threshold)}${list(rec.verdictReasons)}</dd>` : ''}
      ${rec.driver ? `<dt>Driver</dt><dd class="mono">${esc(rec.driver)}</dd>` : ''}
      <dt>Method</dt><dd>${esc(rec.method)}</dd>
      ${rec.rule ? `<dt>Rule template</dt><dd class="mono">${esc(rec.rule)}</dd>` : ''}
      ${rec.condition ? `<dt>Rule condition</dt><dd class="mono">${esc(JSON.stringify(rec.condition))}</dd>` : ''}
      <dt>Inputs</dt><dd>${list(rec.inputs)}</dd><dt>Assumptions</dt><dd>${list(rec.assumptions)}</dd><dt>Limitations</dt><dd>${list(rec.limitations)}</dd>
      <dt>Sources</dt><dd>${rec.sources && rec.sources.length ? `<ul>${rec.sources.map(s => `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)} <span class="muted">${esc(s.version || '')}</span></li>`).join('')}</ul>` : '<span class="muted">user input / derived</span>'}</dd>
      <dt>Reproducibility</dt><dd class="mono small">scenario ${esc(rec.scenarioHash || '—')} · ${esc(rec.codeVersion || '')}</dd></dl>
      <button class="btn sm" id="ev-copy" style="margin-top:14px">Copy evidence record as JSON</button>`;
    $('#ev-copy').onclick = () => copy(JSON.stringify(rec, null, 2), 'Evidence copied');
    $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
    $('#drawer-close').focus();
  }
  function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); }
  function copy(text, msg) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg), () => {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(msg); } catch (e) { toast('Copy failed'); } ta.remove();
    });
  }
  function exportJSON() {
    const R = results().filter(x => !x.r.error);
    const out = { generator: E.CODE_VERSION, exportedUtc: new Date().toISOString(), hardware: state.hw, marginPct: state.marginPct, requirements: state.requirements,
      scenarios: R.map(res => ({ name: res.sc.name, site: { id: res.r.site.id, name: res.r.site.name, lat: res.r.site.lat, lon: res.r.site.lon, elevationM: res.r.site.elevationM }, startUtc: res.sc.startUtc, durationDays: res.sc.durationDays,
        fidelity: res.r.mrec ? 'terrain' : 'geometry only, no terrain', scenarioHash: res.r.hash, metrics: res.r.metrics,
        verdicts: verdictsFor(res).map(v => ({ reqId: v.reqId, state: v.state, value: v.value, threshold: v.threshold, op: v.op, reasons: v.reasons })),
        implications: D.rules.rules.filter(r => !r.condition.comparison).map(r => E.evalRule(r, res.r.metrics, ctxFor(res))).filter(x => x.fired).map(x => ({ id: x.id, text: x.text })) })),
      comparisons: R.slice(1).map(b => { const c = comparison(R[0], b, verdictsFor(R[0]), verdictsFor(b)); return { from: R[0].sc.name, to: b.sc.name, sunlitDeltaPoints: c.dSun, mainDriver: c.label[c.best.k], why: c.why, verdictChanges: c.changes.map(x => ({ req: x.q.id, from: x.from.state, to: x.to.state })) }; }) };
    copy(JSON.stringify(out, null, 2), 'Comparison copied as JSON');
  }

  // ---------- render orchestration ----------
  function renderAll() {
    EV = {}; evN = 0;
    const R = results();
    renderScenarios(); renderHardware(); renderVerdicts(R); renderImplications(R); renderTimeline(R); renderHorizon(R); renderHeatmap(); renderReqEditor(); renderSites(); renderValidation();
    save();
  }
  function renderLive() { // cursor moves: no full rebuild
    const R = results();
    drawTimeline(); renderReadout(); renderHorizon(R); save();
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-ev],[data-act],[data-hz],[data-hm],[data-zoom],[data-cell],[data-rdel],[data-copy],[data-unmask],[data-sdel],#btn-export,#btn-reset,#drawer-close,#req-add,#req-reset,#cs-add');
    if (!t) { if (!e.target.closest('#drawer')) closeDrawer(); return; }
    if (t.dataset.ev) { openDrawer(EV[t.dataset.ev]); return; }
    if (t.id === 'drawer-close') return closeDrawer();
    if (t.id === 'btn-export') return exportJSON();
    if (t.id === 'btn-reset') { if (confirm('Reset scenarios, hardware and requirements to the demo defaults?')) { state = defaultState(); cache.clear(); renderAll(); } return; }
    if (t.dataset.act) {
      const card = t.closest('.scen'), i = card ? +card.dataset.i : -1;
      if (t.dataset.act === 'add') state.scenarios.push({ ...state.scenarios[state.scenarios.length - 1] });
      if (t.dataset.act === 'dup') state.scenarios.splice(i + 1, 0, { ...state.scenarios[i] });
      if (t.dataset.act === 'slip') state.scenarios.splice(i + 1, 0, { ...state.scenarios[i], startUtc: addDays(state.scenarios[i].startUtc, state.slipDays) });
      if (t.dataset.act === 'del') state.scenarios.splice(i, 1);
      state.scenarios = state.scenarios.slice(0, MAX_SCEN);
      return renderAll();
    }
    if (t.dataset.hz !== undefined) { state.horizonIdx = +t.dataset.hz; return renderHorizon(results()); }
    if (t.dataset.zoom !== undefined) { state.mapZoom = t.dataset.zoom === '1'; return renderSites(); }
    if (t.dataset.hm) { state.heat.metric = t.dataset.hm; return renderHeatmap(); }
    if (t.dataset.cell) {
      const [siteId, startUtc] = t.dataset.cell.split('|');
      const sc = { siteId, startUtc, durationDays: state.scenarios[0].durationDays };
      if (state.scenarios.length < MAX_SCEN) state.scenarios.push(sc); else state.scenarios[MAX_SCEN - 1] = sc;
      renderAll(); toast(`Loaded as scenario ${NAMES[state.scenarios.length - 1]}`); return;
    }
    if (t.dataset.rdel !== undefined) { state.requirements.splice(+t.dataset.rdel, 1); return renderAll(); }
    if (t.id === 'req-add') { state.requirements.push({ id: 'REQ-' + Date.now().toString(36).toUpperCase(), label: 'New requirement', metric: 'sunlitPct', op: '>=', threshold: '', unit: '%', visibilityDependent: true, powerDependent: false }); return renderAll(); }
    if (t.id === 'req-reset') { state.requirements = JSON.parse(JSON.stringify(D.requirements.requirements)); state.marginPct = D.requirements.marginPct; return renderAll(); }
    if (t.dataset.copy) return copy(t.dataset.copy, 'Coordinates copied');
    if (t.dataset.unmask) { delete state.uploadedMasks[t.dataset.unmask]; cache.clear(); return renderAll(); }
    if (t.dataset.sdel) { state.customSites = state.customSites.filter(s => s.id !== t.dataset.sdel); state.scenarios.forEach(s => { if (s.siteId === t.dataset.sdel) s.siteId = 'mons-mouton'; }); return renderAll(); }
    if (t.id === 'cs-add') {
      const name = $('#cs-name').value.trim() || 'Custom site', lat = +$('#cs-lat').value, lon = +$('#cs-lon').value, el = $('#cs-el').value === '' ? 0 : +$('#cs-el').value;
      if (!(lat >= -90 && lat <= 90) || $('#cs-lat').value === '' || !(lon >= -180 && lon <= 360) || $('#cs-lon').value === '') return toast('Enter a valid latitude and longitude');
      state.customSites.push({ id: 'custom-' + Date.now().toString(36), name, lat, lon, elevationM: el, category: 'custom', terrain: 'none', coordStatus: 'user-entered', source: 'User entry', notes: '' });
      return renderAll();
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.f) {
      const i = +t.closest('.scen').dataset.i, sc = state.scenarios[i];
      if (t.dataset.f === 'startUtc') { if (!t.value) return; sc.startUtc = fromLocalInput(t.value); }
      else if (t.dataset.f === 'durationDays') sc.durationDays = Math.max(1, Math.min(30, +t.value || 1));
      else sc[t.dataset.f] = t.value;
      return renderAll();
    }
    if (t.dataset.hw) {
      const k = t.dataset.hw;
      state.hw[k] = k === 'panelType' ? t.value : (+t.value) / (+t.dataset.scale || 1);
      state.hw.confirmed = false; cache.clear(); return renderAll();
    }
    if (t.id === 'hwconfirm') { state.hw.confirmed = t.checked; return renderAll(); }
    if (t.id === 'slipdays') { state.slipDays = Math.max(1, +t.value || 21); return renderScenarios(); }
    if (t.id === 'margin') { state.marginPct = +t.value; return renderAll(); }
    if (t.dataset.rf) {
      const q = state.requirements[+t.closest('tr').dataset.ri], f = t.dataset.rf;
      q[f] = t.type === 'checkbox' ? t.checked : (f === 'threshold' ? (t.value === '' ? '' : +t.value) : t.value);
      return renderAll();
    }
    if (t.id === 'hm-start' && t.value) { state.heat.startUtc = t.value + 'T12:00:00Z'; return renderHeatmap(); }
    if (t.id === 'hm-step') { state.heat.stepDays = Math.max(1, +t.value || 3); return renderHeatmap(); }
    if (t.id === 'up-file' && t.files[0]) {
      const siteId = $('#up-site').value;
      t.files[0].text().then(txt => {
        let mask;
        try { const j = JSON.parse(txt); mask = j.maskDeg; } catch (err) { mask = txt.split(/[\s,;]+/).filter(Boolean).map(Number); }
        if (!Array.isArray(mask) || mask.length !== 360 || mask.some(x => !Number.isFinite(x))) return toast('Need exactly 360 numeric values (1° steps, 0 = N, clockwise)');
        state.uploadedMasks[siteId] = { siteId, maskDeg: mask, uploaded: new Date().toISOString(), observerHeightM: null, dem: { product: 'user upload: ' + t.files[0].name } };
        cache.clear(); renderAll(); toast('Mask loaded for ' + siteById(siteId).name);
      });
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'cursor') { state.cursorH = +e.target.value; renderLive(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  // tooltips: heatmap cells + timeline hover
  const tip = $('#tooltip');
  function showTip(html, ev) { tip.innerHTML = html; tip.classList.add('on'); const w = tip.offsetWidth, h = tip.offsetHeight; let x = ev.clientX + 14, y = ev.clientY + 14; if (x + w > innerWidth - 8) x = ev.clientX - w - 14; if (y + h > innerHeight - 8) y = ev.clientY - h - 14; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
  function hideTip() { tip.classList.remove('on'); }
  document.addEventListener('mousemove', e => {
    const c = e.target.closest('[data-tt]');
    if (c) { const [n, d, v, extra] = c.dataset.tt.split('|'); return showTip(`<div class="tt-h">${esc(n)}</div>${esc(d)} · <b>${esc(v)}</b><br><span class="muted">${esc(extra)}</span>`, e); }
    if (e.target.id === 'tl-canvas' && tl && tl.geom) {
      const rect = e.target.getBoundingClientRect(), px = e.clientX - rect.left, gm = tl.geom;
      const h = Math.max(0, Math.min(tl.maxH, (px - gm.padL) / (gm.W - gm.padL - gm.padR) * tl.maxH));
      drawTimeline(h);
      return showTip(`<div class="tt-h">T+${E.fmtHours(h)}</div>` + tl.R.map(res => { const i = sampleAt(res, h); if (i === null) return `${res.sc.name}: ended`; const s = res.r.series;
        return `<b>${res.sc.name}</b> Sun ${s.sunVis[i] ? 'visible' : 'hidden'} (${s.sunEl[i].toFixed(1)}°), Earth ${s.earthVis[i] ? 'visible' : 'hidden'}, battery ${(100 * s.soc[i] / state.hw.batteryWh).toFixed(0)}%`; }).join('<br>') + '<br><span class="muted">click to move the cursor</span>', e);
    }
    hideTip();
  });
  document.addEventListener('mouseleave', hideTip);
  document.addEventListener('click', e => {
    if (e.target.id === 'tl-canvas' && tl && tl.geom) {
      const rect = e.target.getBoundingClientRect(), gm = tl.geom;
      state.cursorH = Math.round(Math.max(0, Math.min(tl.maxH, (e.clientX - rect.left - gm.padL) / (gm.W - gm.padL - gm.padR) * tl.maxH)) * 6) / 6;
      $('#cursor').value = state.cursorH; renderLive();
    }
  });
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => drawTimeline(), 120); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => renderAll());

  renderAll();
})();
