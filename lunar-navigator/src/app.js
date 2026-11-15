/* SELENIX platform UI. All maths lives in engine.js; this file only presents records, proofs and rules. */
(function () {
  'use strict';
  const D = window.NAV_DATA, E = window.Engine;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORE_KEY = 'selenix.v2', MAX_SCEN = 3, NAMES = ['A', 'B', 'C'], CV = ['--s1', '--s2', '--s3'];
  const CFG = D.config, F = E.format;

  const geometry = E.SpiceTableAdapter(new Float32Array(Uint8Array.from(atob(D.ephemerisB64), c => c.charCodeAt(0)).buffer), D.ephemerisMeta);
  const COV = geometry.coverage();
  const DEMO = [
    { siteId: 'mons-mouton', startUtc: '2027-08-11T12:00:00Z', durationDays: 10 },
    { siteId: 'mons-mouton', startUtc: '2027-09-01T12:00:00Z', durationDays: 10 },
    { siteId: 'connecting-ridge', startUtc: '2027-09-01T12:00:00Z', durationDays: 10 },
  ];
  const BEATS = ['Briefing', 'Baseline', 'Slip', 'Alternative', 'Decide'];
  function defaultState() {
    return { v: 2, mode: 'guided', beat: 1, scenarios: DEMO.map(s => ({ ...s })), hw: { ...D.hardware.defaults },
      requirements: JSON.parse(JSON.stringify(D.requirements.requirements)), marginPct: D.requirements.marginPct,
      customSites: [], uploadedMasks: {}, cursorH: 6, horizonIdx: 0, slipDays: 21, heatMetric: 'sun', mapLayer: 'sun', mapView: 'region',
      showAllSites: false, showAdvanced: false, theme: 'dark', logOpen: {}, readoutOpen: false };
  }
  let state;
  try { const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); state = saved && saved.v === 2 ? Object.assign(defaultState(), saved) : defaultState(); }
  catch (e) { state = defaultState(); }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ } };

  const allSites = () => D.sites.concat(state.customSites);
  const siteById = id => allSites().find(s => s.id === id);
  const maskRec = id => state.uploadedMasks[id] || D.horizons[id] || null;
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const color = i => cssVar(CV[i]);
  const published = id => (D.validation.benchmark ? D.validation.benchmark.rows : []).find(r => r.id === id);

  // ---------------------------------------------------------------- compute
  const cache = new Map();
  const store = E.createStore();
  function runScenario(sc) {
    const site = siteById(sc.siteId), mr = maskRec(sc.siteId);
    const key = E.hash({ sc, la: site.lat, lo: site.lon, el: site.elevationM, m: mr ? (mr.uploaded || mr.generatedUtc) : null, hw: state.hw });
    if (cache.has(key)) return cache.get(key);
    let out;
    try { out = { run: E.simulate({ geometry, terrain: E.HorizonMaskAdapter(mr), site, scenario: sc, hw: state.hw, config: CFG }), error: null }; }
    catch (err) { out = { run: null, error: err.message }; }
    if (cache.size > 400) cache.clear();
    cache.set(key, out);
    return out;
  }
  const shownCount = () => state.mode === 'free' ? state.scenarios.length : [0, 0, 1, 2, 3, 3][state.beat];
  const validationRefs = d => ['horizons', 'regression', d.body === 'sun' ? 'polar-sun' : 'polar-earth', 'illumination-benchmark', 'terrain-sanity'];
  let R = [];
  function compute() {
    store.clear();
    R = state.scenarios.slice(0, Math.min(shownCount(), MAX_SCEN)).map((sc, i) => {
      const o = runScenario(sc), res = { i, name: NAMES[i], sc, run: o.run, error: o.error, site: siteById(sc.siteId), proofs: [] };
      if (o.run) {
        for (const id of Object.keys(E.METRICS)) store.put(E.indicatorRecord(o.run, id, { validationRefs }));
        res.proofs = state.requirements.map(q => store.put(E.checkRequirement(q, o.run, { marginPct: state.marginPct })));
      }
      return res;
    });
    return R;
  }
  const ok = () => R.filter(r => r.run);
  const ruleCtx = res => ({ hw: state.hw, requirements: state.requirements, config: CFG, flags: { noTerrain: res.run.geometryOnly } });
  const firedRules = res => D.rules.rules.filter(r => !r.condition.comparison && !r.banner).map(r => E.evalRule(r, res.run.metrics, ruleCtx(res))).filter(x => x.fired);

  // ---------------------------------------------------------------- icons
  const IC = {
    meets: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.5 8.2l2.3 2.3 4.7-4.8" stroke="#fff" stroke-width="1.8" fill="none"/></svg>',
    review: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l7 13H1z" fill="currentColor"/><path d="M8 6v3.5M8 11.3v.2" stroke="#000" stroke-width="1.7" stroke-linecap="round"/></svg>',
    fail: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="3" fill="currentColor"/><path d="M5 5l6 6M11 5l-6 6" stroke="#fff" stroke-width="1.8"/></svg>',
    unknown: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 2"/></svg>',
    dot: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.5" fill="currentColor"/></svg>',
  };
  const VUI = { 'meets': ['st-meets', IC.meets, 'meets'], 'needs review': ['st-review', IC.review, 'needs review'], 'does not meet': ['st-fail', IC.fail, 'does not meet'], 'unknown': ['st-unknown', IC.unknown, 'unknown'] };
  const SEV = { critical: IC.fail, warning: IC.review, info: IC.dot };
  const pill = (v, sub) => { const [c, i, l] = VUI[v]; return `<span class="status ${c}">${i}${l}</span>${sub ? `<span class="substate">${esc(sub)}</span>` : ''}`; };

  // ---------------------------------------------------------------- helpers
  const fmtDate = iso => iso.slice(0, 16).replace('T', ' ') + ' UTC';
  const day = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const addDays = (iso, d) => new Date(Date.parse(iso) + d * 86400000).toISOString().replace('.000', '');
  const fmtCoord = s => `${Math.abs(s.lat).toFixed(4)}°${s.lat < 0 ? 'S' : 'N'}, ${s.lon.toFixed(4)}°E`;
  function toast(msg, undo) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button>Undo</button>' : ''}`;
    if (undo) t.querySelector('button').onclick = () => { undo(); t.remove(); };
    document.body.appendChild(t); setTimeout(() => t.remove(), undo ? 6000 : 2200);
  }
  function copy(text, msg) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg), () => {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(msg); } catch (e) { toast('Copy failed'); } ta.remove();
    });
  }
  const boundPrefix = (res, metricId) => { if (!res.run.geometryOnly) return ''; const q = state.requirements.find(x => x.metric === metricId); const up = q ? q.op.startsWith('>') : /Pct$|VisibleH$/.test(metricId); return up ? '≤ ' : '≥ '; };
  const fmtMetric = (id, v) => v === null || v === undefined ? '—' : F(v, (E.METRICS[id] || {}).fmt);

  // ---------------------------------------------------------------- evidence registry
  let EV = {}, evN = 0;
  const CLASS_OF = ev => ev.kind === 'indicator' ? ev.rec.classification : ev.kind === 'input' ? 'user-assumption' : ev.kind === 'proof' ? (E.METRICS[ev.proof.metric] || {}).q || 'computed-geometry' : ev.kind === 'model-sample' ? 'engineering-estimate' : ev.kind === 'measured' ? 'measured' : 'computed-geometry';
  function reg(ev) { const k = 'e' + (evN++); EV[k] = ev; return k; }
  function num(ev, text) { return `<button class="num" data-ev="${reg(ev)}" title="${CLASS_OF(ev)} · click for evidence">${esc(text)}</button>`; }
  function mnum(res, id, opts = {}) {
    const rec = store.get(`ind:${E.scenarioId(res.run)}:${id}`), v = res.run.metrics[id];
    const text = v === null || v === undefined ? (opts.none || 'none in mission') : boundPrefix(res, id) + fmtMetric(id, v);
    return num({ kind: 'indicator', rec, res: res.name }, text) + (rec.classification === 'engineering-estimate' && !opts.noEst ? '<span class="est">est.</span>' : '');
  }
  const inum = (label, value, text, o = {}) => num({ kind: 'input', label, value, text, ...o }, text);
  const snum = (res, k, body, field, text) => num({ kind: 'sample', res, k, body, field }, text);

  // ---------------------------------------------------------------- chips, demo bar, banner
  function selfTest() {
    let worst = 0, mism = 0;
    const hw = D.hardware.defaults;
    for (const r of D.reference) {
      const site = D.sites.find(s => s.id === r.scenario.siteId);
      const run = E.simulate({ geometry, terrain: E.HorizonMaskAdapter(D.horizons[r.scenario.siteId]), site, scenario: r.scenario, hw, config: CFG });
      for (const smp of r.samples) {
        const k = smp.k, s = run.series;
        worst = Math.max(worst, Math.abs(s.sunEl[k] - smp.sunEl), Math.abs(s.earthEl[k] - smp.earthEl), Math.abs(((s.sunAz[k] - smp.sunAz + 540) % 360) - 180));
        if (E.STATE_NAME[s.sunState[k]] !== smp.sunState || E.STATE_NAME[s.earthState[k]] !== smp.earthState) mism++;
      }
    }
    return { worst, mism, ok: worst < 1e-9 && !mism };
  }
  const ST = selfTest();
  function checks() {
    return D.validation.checks.map(c => c.id === 'regression' ? { ...c, status: ST.ok ? 'pass' : 'fail', detail: `run just now in this browser: ${D.reference.length} reference scenarios, worst angle difference ${ST.worst.toExponential(1)}°, ${ST.mism} state mismatches` } : c);
  }
  function renderChips() {
    const cs = checks(), pass = cs.filter(c => c.status === 'pass').length, fail = cs.filter(c => c.status === 'fail').length;
    const ad = geometry.describe();
    $('#chips').innerHTML = `
      <button class="chip ${fail ? 'bad' : pass < cs.length ? 'warn' : ''}" data-open="validation" title="Validation checks and tolerances"><span class="dot"></span>Validation <b>${pass} of ${cs.length} passed</b></button>
      <button class="chip" data-open="provenance" title="Kernels, frames, time system, terrain data, engine version">DE440 · ${esc(ad.frame)} · UTC · engine ${esc(E.CODE_VERSION.split(' ')[1])}</button>
      <button class="chip" data-open="hardware" title="Panel, load, battery and antenna inputs">Hardware and antenna inputs ${state.hw.confirmed ? '' : '<span class="muted">(defaults)</span>'}</button>
      <button class="chip" data-act="export" title="Copy scenarios, indicator records and proofs as JSON">Copy comparison JSON</button>
      <button class="chip" data-act="theme" title="Switch light and dark theme" aria-label="Switch theme">${state.theme === 'dark' ? '☀' : '☾'}</button>`;
  }
  function renderDemoBar() {
    const g = state.mode === 'guided';
    $('#demobar').innerHTML = `<div class="beats" role="tablist" aria-label="Demo steps">${g ? BEATS.map((b, i) => `<button class="beat ${i + 1 === state.beat ? 'on' : i + 1 < state.beat ? 'done' : ''}" data-beat="${i + 1}" role="tab" aria-selected="${i + 1 === state.beat}"><span class="bn">${i + 1}</span>${b}</button>`).join('') : '<span class="eyebrow" style="align-self:center">Free exploration</span><span class="muted small" style="align-self:center">Edit scenarios, requirements and sites. Guided demo returns to the story.</span>'}</div>
      <div class="democtl">
        <button class="btn" data-act="reset" title="Back to the briefing with the demo defaults">Reset demo</button>
        ${g ? `<button class="btn primary" data-act="next" ${state.beat >= 5 ? 'disabled' : ''}>${state.beat === 1 ? 'Run the baseline' : 'Next step'} →</button>
        <button class="btn gold" data-act="why" ${state.beat < 2 ? 'disabled' : ''} title="Open the evidence for the number that changed most in this step">Show me why</button>` : ''}
        <button class="btn ghost" data-act="mode">${g ? 'Explore freely' : 'Guided demo'}</button>
      </div>`;
  }
  function renderBanner() {
    const geo = ok().filter(r => r.run.geometryOnly), fail = checks().filter(c => c.status === 'fail');
    let h = '';
    if (fail.length) h += `<div class="banner bad">${IC.fail}<span><b>${fail.length} validation check${fail.length > 1 ? 's' : ''} failing</b>: ${esc(fail.map(c => c.name).join(', '))}. Treat results with caution.</span><button class="btn sm" data-open="validation">Details</button></div>`;
    if (geo.length) h += `<div class="banner">${IC.review}<span><b>Terrain unavailable</b> for scenario ${geo.map(r => r.name + ' (' + esc(r.site.name) + ')').join(', ')}. Its visibility figures are upper bounds and its verdicts cannot read “meets”.</span>
      <button class="btn sm" data-loadmask="${geo[0].site.id}">Load terrain mask</button><button class="btn sm ghost" data-open="whyterrain">Why this matters</button></div>`;
    $('#banner').innerHTML = h;
  }

  // ---------------------------------------------------------------- briefing (beat 1)
  function renderBriefing() {
    const sc = state.scenarios[0], site = siteById(sc.siteId), h = state.hw;
    return `<div class="brief"><section class="card">
      <span class="eyebrow">Mission briefing</span>
      <h1>A south-pole lander, and a launch that may slip ${state.slipDays} days.</h1>
      <p style="color:var(--text-2);max-width:760px">The plan is a ${sc.durationDays}-day surface mission at ${esc(site.name)}. If the launch slips, the Sun and Earth sit somewhere else in the sky when the lander arrives. The question for this session: does the site still work on the new date, and what does each alternative cost?</p>
      <dl class="kv">
        <dt>Site</dt><dd>${esc(site.name)} · ${num({ kind: 'measured', label: site.name + ': coordinates', text: fmtCoord(site), site }, fmtCoord(site))}</dd>
        <dt>Planned landing</dt><dd>${inum('Planned landing (T+0)', sc.startUtc, fmtDate(sc.startUtc), { where: 'scenario', note: 'Scenario input.' })}</dd>
        <dt>Surface mission</dt><dd>${inum('Mission duration', sc.durationDays, sc.durationDays + ' days', { where: 'scenario', note: 'Scenario input.' })}</dd>
        <dt>Hardware (assumed)</dt><dd>${inum('Panel area', h.panelAreaM2, h.panelAreaM2 + ' m²')} ${esc(h.panelType)} array, ${inum('Load', h.loadW, h.loadW + ' W')} load, ${inum('Battery', h.batteryWh, F(h.batteryWh, 'wh'))} battery, antenna needs Earth above ${inum('Minimum antenna elevation', h.minEarthElevDeg, h.minEarthElevDeg + '°')}</dd>
        <dt>Success means</dt><dd><ul class="reqlist" style="padding-left:16px;margin:0">${state.requirements.map(q => `<li>${esc(q.label)} ${esc(q.op)} ${inum(q.label + ' threshold', q.threshold, q.threshold + ' ' + q.unit, { where: 'requirements', note: 'Your stated requirement.' })}</li>`).join('')}</ul></dd>
      </dl>
      <p class="small muted" style="margin-top:14px">Hardware values and thresholds are demo defaults (user-assumption). Nothing has been calculated yet.</p>
    </section><section class="card">${mapHtml()}</section></div>`;
  }

  // ---------------------------------------------------------------- story line
  function counts(res) { const c = { 'meets': 0, 'needs review': 0, 'does not meet': 0, 'unknown': 0 }; res.proofs.forEach(p => c[p.verdict]++); return c; }
  function storyHtml() {
    const o = ok(); if (!o.length) return '';
    const last = o[o.length - 1], m = last.run.metrics, c = counts(last);
    let eyebrow, h, p;
    const sum = `Sun visible ${fmtMetric('sunlitPct', m.sunlitPct)}, Earth in view ${fmtMetric('earthVisiblePct', m.earthVisiblePct)}; ${c.meets} of ${last.proofs.length} requirements met, ${c['needs review']} in review, ${c['does not meet']} not met.`;
    if (state.mode === 'free') { eyebrow = 'Workspace'; h = `${o.length} scenario${o.length > 1 ? 's' : ''} compared on mission-elapsed time`; p = 'Same kernels, terrain method, tolerance and assumptions for every scenario. Click any number for its evidence.'; }
    else if (state.beat === 2) { eyebrow = 'Step 2 · Baseline'; h = `The original plan: ${esc(last.site.name)}, ${day(last.sc.startUtc)}`; p = sum; }
    else if (state.beat === 3) { const d = Math.round((Date.parse(last.sc.startUtc) - Date.parse(o[0].sc.startUtc)) / 86400000); eyebrow = 'Step 3 · Slip'; h = `The launch slips ${d} days: same site, landing ${day(last.sc.startUtc)}`; p = sum + (m.sunlitAtStart ? '' : ` The lander arrives in darkness; the Sun returns at ${F(m.timeToSunriseH, 'met')}.`); }
    else if (state.beat === 4) { eyebrow = 'Step 4 · Alternative'; h = `Try a different site on the slipped date: ${esc(last.site.name)}`; p = sum; }
    else { eyebrow = 'Step 5 · Decide'; h = 'Every option costs something'; p = 'The table below states what each option gains and gives up. SELENIX does not rank them.'; }
    return `<section class="card story"><div><span class="eyebrow">${eyebrow}</span><h1>${h}</h1><p>${p}</p></div></section>`;
  }

  // ---------------------------------------------------------------- scenarios
  function siteOptions(sel) {
    const groups = { candidate: 'Candidate sites', past: 'Past landings', other: 'Reference points', custom: 'Custom sites' };
    return Object.entries(groups).map(([g, label]) => { const ss = allSites().filter(s => (s.category || 'custom') === g);
      return ss.length ? `<optgroup label="${label}">${ss.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}${maskRec(s.id) ? '' : ' (terrain unavailable)'}</option>`).join('')}</optgroup>` : ''; }).join('');
  }
  function scenariosHtml() {
    const free = state.mode === 'free';
    const cards = R.map(res => {
      const i = res.i, sc = res.sc;
      if (!res.run) return `<div class="scen" style="--c:var(${CV[i]})"><div class="scen-name"><span class="sw"></span>Scenario ${res.name}</div><div class="line" style="color:var(--crit)">${esc(res.error)}</div>${free ? editRow(res) : ''}</div>`;
      const m = res.run.metrics, c = counts(res), rev = res.proofs.find(p => p.verdict === 'needs review');
      const unc = u => m[u] >= 0.05 ? ` <span class="muted small">(+${F(m[u], 'pct')} uncertain)</span>` : '';
      return `<div class="scen" style="--c:var(${CV[i]})">
        <div class="scen-head"><div class="scen-name"><span class="sw"></span>Scenario ${res.name}</div>
          <span>${c['does not meet'] ? `<span class="tag" style="border-color:var(--crit);color:var(--crit)">${c['does not meet']} not met</span> ` : ''}${c['needs review'] ? `<button class="tag warn" style="background:none;cursor:pointer;font:inherit;font-size:11.5px" data-ev="${reg({ kind: 'proof', proof: rev, res })}" title="Open the first verdict in review">${c['needs review']} of ${res.proofs.length} in review</button>` : ''}${!c['does not meet'] && !c['needs review'] ? '<span class="tag" style="border-color:var(--good);color:var(--good)">all met</span>' : ''}</span></div>
        <div class="line">${esc(res.site.name)} · ${day(sc.startUtc)} ${sc.startUtc.slice(11, 16)} UTC · ${sc.durationDays} d</div>
        <div class="line">Sun visible <b style="color:var(--text)">${mnum(res, 'sunlitPct')}</b>${unc('sunUncertainPct')} · Earth in view <b style="color:var(--text)">${mnum(res, 'earthVisiblePct')}</b>${unc('earthUncertainPct')}</div>
        ${free ? editRow(res) : ''}</div>`;
    }).join('');
    return `<section class="card"><h2>Scenarios <small>same kernels, terrain method, tolerance and assumptions</small></h2><div class="scen-grid">${cards}${free && state.scenarios.length < MAX_SCEN ? '<button class="add-scen" data-act="add">+ Add scenario</button>' : ''}</div></section>`;
  }
  function editRow(res) {
    const sc = res.sc, full = state.scenarios.length >= MAX_SCEN;
    return `<div class="row" data-i="${res.i}" style="border-top:1px solid var(--border);padding-top:8px">
      <label class="f" style="flex:1 1 100%">Site<select data-f="siteId">${siteOptions(sc.siteId)}</select></label>
      <label class="f" style="flex:1 1 170px">Landing (T+0), UTC<input type="datetime-local" data-f="startUtc" value="${sc.startUtc.slice(0, 16)}" min="${COV.startUtc.slice(0, 16)}" max="${COV.endUtc.slice(0, 16)}"></label>
      <label class="f">Duration (d)<input type="number" data-f="durationDays" min="1" max="30" step="1" value="${sc.durationDays}" style="width:70px"></label>
      <button class="btn sm" data-act="slip" ${full ? 'disabled' : ''}>Duplicate → shift date +${state.slipDays} d</button>
      <button class="btn sm ghost" data-act="dup" ${full ? 'disabled' : ''}>Duplicate</button>
      <button class="btn sm ghost" data-act="del" ${state.scenarios.length <= 1 ? 'disabled' : ''}>Remove</button></div>`;
  }

  // ---------------------------------------------------------------- requirement table
  function verdictsHtml() {
    const o = ok(); if (!o.length) return '';
    const rows = state.requirements.map((q, qi) => `<tr><td><b>${esc(q.label)}</b><div class="thr">${esc(q.op)} ${inum(q.label + ' threshold', q.threshold, q.threshold + ' ' + q.unit, { where: 'requirements', note: 'Your stated requirement.' })}</div></td>${o.map(res => {
      const p = res.proofs[qi], d = E.METRICS[q.metric] || {};
      const val = p.observed.value === null ? '—' : boundPrefix(res, q.metric) + fmtMetric(q.metric, p.observed.value);
      const gap = q.metric === 'longestDarkGapH' || q.metric === 'longestNoEarthGapH';
      const when = p.observed.at && (gap ? p.observed.value > 0 : p.observed.at.metH > 0) ? `${p.observed.at.relation} T+${E.fmtHours(p.observed.at.metH)}` : '';
      return `<td><button class="vcell" data-ev="${reg({ kind: 'proof', proof: p, res })}" title="${d.q || ''} · tap for rationale"><span class="val">${esc(val)}</span>${when ? `<span class="when">${esc(when)}</span>` : ''}${pill(p.verdict, p.subState)}</button></td>`;
    }).join('')}</tr>`).join('');
    return `<section class="card"><h2>Requirement check <small>value, verdict; tap a cell for the rationale</small></h2><div class="tablewrap"><table class="vt"><colgroup><col style="width:${o.length > 2 ? 28 : 34}%">${o.map(() => '<col>').join('')}</colgroup><thead><tr><th>Requirement</th>${o.map(res => `<th><span class="sw" style="--c:var(${CV[res.i]});margin-right:6px"></span>Scenario ${res.name}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  // ---------------------------------------------------------------- what changed (three-bullet difference)
  const DIFF_KEYS = [['sunlitPct', 'Sun visible', 100], ['earthVisiblePct', 'Earth in view', 100], ['longestDarkGapH', 'longest Sun obstruction', null], ['longestNoEarthGapH', 'longest gap without Earth', null]];
  function comparison(a, b) {
    const ma = a.run.metrics, mb = b.run.metrics, dur = Math.max(ma.durationH, mb.durationH);
    const deltas = DIFF_KEYS.map(([k, label, scale]) => ({ k, label, d: Math.abs((mb[k] ?? 0) - (ma[k] ?? 0)) / (scale || dur), from: ma[k], to: mb[k] })).sort((x, y) => y.d - x.d);
    const shiftD = (Date.parse(b.sc.startUtc) - Date.parse(a.sc.startUtc)) / 86400000;
    const changes = state.requirements.map((q, i) => a.proofs[i].verdict !== b.proofs[i].verdict ? { q, from: a.proofs[i], to: b.proofs[i] } : null).filter(Boolean);
    return { deltas, shiftD, changes, siteChanged: a.sc.siteId !== b.sc.siteId };
  }
  function diffHtml() {
    const o = ok(); if (o.length < 2) return '';
    const cards = o.slice(1).map((b, k) => {
      const a = o[k], c = comparison(a, b);
      const input = [c.siteChanged ? `site changes from ${esc(a.site.name)} to ${esc(b.site.name)}` : 'same site', Math.abs(c.shiftD) > 1e-6 ? `landing moves ${E.fmtHours(Math.abs(c.shiftD) * 24)} ${c.shiftD > 0 ? 'later' : 'earlier'} (${day(a.sc.startUtc)} → ${day(b.sc.startUtc)})` : 'same landing date'].join('; ');
      const order = DIFF_KEYS.map(x => x[0]), top = c.deltas.filter(x => x.d > 0.005).slice(0, 3).sort((x, y) => order.indexOf(x.k) - order.indexOf(y.k));
      const env = top.length ? top.map(x => `${x.label} ${mnum(a, x.k)} → ${mnum(b, x.k)}${x.k === 'longestDarkGapH' && b.run.metrics.longestDarkGapStartH !== null && x.to > 0 ? ` (from T+${E.fmtHours(b.run.metrics.longestDarkGapStartH)})` : ''}`).join('; ') : 'no material change in Sun or Earth visibility';
      const byTo = {}; c.changes.forEach(x => (byTo[x.to.verdict] = byTo[x.to.verdict] || []).push(x));
      const ver = c.changes.length ? `${c.changes.length} of ${state.requirements.length} verdicts change. ` + Object.entries(byTo).map(([v, xs]) => `Now <b>${VUI[v][2]}</b>: ` + xs.map(x => `<button class="num" data-ev="${reg({ kind: 'proof', proof: x.to, res: b })}" title="tap for rationale">${esc(x.q.short || x.q.label)}</button>`).join(', ')).join('. ') : 'no verdict changes';
      return `<div class="diffcard" style="--c:var(${CV[b.i]})"><b>${a.name} → ${b.name}</b><ul><li><b>Changed:</b> ${input}.</li><li><b>Effect:</b> ${env}.</li><li><b>Verdicts:</b> ${ver}.</li></ul></div>`;
    }).join('');
    return `<section class="card"><h2>What changed and why</h2><div class="diff">${cards}</div></section>`;
  }

  // ---------------------------------------------------------------- mission log
  const ORDER = { critical: 0, warning: 1, info: 2 };
  function logHtml() {
    const o = ok(); if (!o.length) return '';
    const fired = o.map(res => firedRules(res).sort((a, b) => ORDER[a.severity] - ORDER[b.severity]));
    const sharedIds = D.rules.rules.filter(r => r.shared).map(r => r.id).filter(id => o.length > 1 && fired.every(f => f.some(x => x.id === id)));
    const entry = (f, res) => `<button class="entry sev-${f.severity}" data-ev="${reg({ kind: 'rule', f, res })}" title="${f.qualityClass} · ${f.id} · click for the rule and its inputs">${SEV[f.severity]}<span>${esc(f.text)}</span></button>`;
    const cols = o.map((res, k) => {
      const list = fired[k].filter(f => !sharedIds.includes(f.id)), open = state.logOpen[res.name], show = open ? list : list.slice(0, 3);
      return `<div class="logcol"><h3><span class="sw" style="--c:var(${CV[res.i]})"></span>Scenario ${res.name} <span class="muted small" style="font-weight:400">mission log</span></h3>
        ${show.map(f => entry(f, res)).join('') || '<p class="muted small">Nothing to flag.</p>'}
        ${list.length > 3 ? `<button class="more" data-log="${res.name}">${open ? 'Show fewer' : `Show ${list.length - 3} more`}</button>` : ''}</div>`;
    }).join('');
    const shared = sharedIds.map(id => { const rule = D.rules.rules.find(r => r.id === id);
      return `<button class="entry sev-info" data-ev="${reg({ kind: 'rule', f: fired[0].find(x => x.id === id), res: o[0], sharedAll: o.map((res, k) => ({ res, f: fired[k].find(x => x.id === id) })) })}" title="${rule.qualityClass} · ${id} · click for the rule and its inputs">${SEV.info}<span>${esc(rule.sharedLog || rule.log)} <span class="vchips">${o.map((res, k) => `<span class="vchip" style="--c:var(${CV[res.i]})">${res.name} ${esc(fired[k].find(x => x.id === id).chip || '')}</span>`).join('')}</span></span></button>`; }).join('');
    return `<section class="card"><h2>What this means for the mission <small>rule-based log; click an entry for its rule and inputs</small></h2><div class="log">${cols}</div>${shared ? `<div style="border-top:1px solid var(--border);margin-top:10px;padding-top:8px"><span class="eyebrow">All scenarios</span>${shared}</div>` : ''}</section>`;
  }

  // ---------------------------------------------------------------- timeline
  let tl = null, playing = null;
  function timelineHtml() {
    const o = ok(); if (!o.length) return '';
    const maxH = Math.max(...o.map(x => x.sc.durationDays * 24));
    if (state.cursorH > maxH) state.cursorH = 0;
    tl = { maxH };
    return `<section class="card"><h2>Mission timeline <small>aligned on mission-elapsed time; ${CFG.stepMin}-min samples; drag the cursor</small></h2>
      <div class="legend"><span><i class="lk" style="background:var(--sun)"></i>Sun visible</span><span><i class="lk" style="background:var(--earth)"></i>Earth visible</span><span><i class="lk hatch" style="color:var(--text-2)"></i>uncertain (within ${CFG.toleranceDeg}° of the limit)</span><span>empty = obstructed</span><span>lines: battery charge (est.)</span></div>
      <div class="chartbox"><canvas id="tl-canvas" aria-label="Sun and Earth visibility states and estimated battery charge per scenario over mission-elapsed time"></canvas></div>
      <div class="cursor-row"><button class="btn sm" data-act="play" title="Animate the mission time">${playing ? '❚❚ Pause' : '▶ Play'}</button><input type="range" id="cursor" min="0" max="${maxH}" step="${1 / 6}" value="${state.cursorH}" aria-label="Mission time cursor"><span class="mono" id="cursor-lbl"></span>
        <button class="more" data-act="readout">${state.readoutOpen ? 'Hide angles' : 'Show angles'}</button></div>
      <div class="readout" id="readout"></div></section>`;
  }
  function drawTimeline(hoverH) {
    const cv = $('#tl-canvas'); if (!cv || !tl) return;
    const o = ok(), W = cv.clientWidth || 800, padL = 34, padR = 26, rowH = 36, socH = 110, top = 6;
    const H = top + o.length * rowH + 12 + socH + 26, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const x = h => padL + (W - padL - padR) * h / tl.maxH;
    const grid = cssVar('--grid'), muted = cssVar('--muted'), text2 = cssVar('--text-2'), track = cssVar('--surface-3');
    g.font = '11px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
    const stepD = tl.maxH > 24 * 20 ? 48 : 24;
    g.strokeStyle = grid; g.lineWidth = 1; g.fillStyle = muted; g.textAlign = 'center';
    for (let h = 0; h <= tl.maxH + 1e-9; h += stepD) { g.beginPath(); g.moveTo(x(h) + .5, top); g.lineTo(x(h) + .5, H - 20); g.stroke(); g.fillText('T+' + (h / 24) + ' d', x(h), H - 9); }
    const band = (states, col, yy, hh, dt) => {
      let st = 0;
      for (let i = 1; i <= states.length; i++) if (i === states.length || states[i] !== states[st]) {
        const v = states[st], X0 = x(st * dt), X1 = Math.max(X0 + 1, x(Math.min(i, states.length - 1) * dt));
        if (v === E.VISIBLE) { g.fillStyle = col; g.fillRect(X0, yy, X1 - X0, hh); }
        else if (v === E.UNCERTAIN) { g.save(); g.beginPath(); g.rect(X0, yy, X1 - X0, hh); g.clip(); g.globalAlpha = .28; g.fillStyle = col; g.fillRect(X0, yy, X1 - X0, hh); g.globalAlpha = 1; g.strokeStyle = col; g.lineWidth = 1.5;
          for (let xx = X0 - hh; xx < X1 + hh; xx += 5) { g.beginPath(); g.moveTo(xx, yy + hh); g.lineTo(xx + hh, yy); g.stroke(); } g.restore(); }
        st = i;
      }
    };
    o.forEach((res, j) => {
      const y0 = top + j * rowH, s = res.run.series, dt = s.stepMin / 60, end = x(res.sc.durationDays * 24);
      g.fillStyle = color(res.i); g.fillRect(4, y0 + 3, 4, 27);
      g.fillStyle = text2; g.textAlign = 'left'; g.font = '600 12px Inter, system-ui, sans-serif'; g.fillText(res.name, 13, y0 + 16); g.font = '11px Inter, system-ui, sans-serif';
      g.fillStyle = track; g.fillRect(x(0), y0 + 3, end - x(0), 14); g.fillRect(x(0), y0 + 20, end - x(0), 10);
      band(s.sunState, cssVar('--sun'), y0 + 3, 14, dt); band(s.earthState, cssVar('--earth'), y0 + 20, 10, dt);
    });
    const sy0 = top + o.length * rowH + 12, sy = v => sy0 + socH - socH * v / 100;
    g.strokeStyle = grid; g.fillStyle = muted; g.textAlign = 'right'; g.lineWidth = 1;
    for (const v of [0, 50, 100]) { g.beginPath(); g.moveTo(padL, sy(v) + .5); g.lineTo(W - padR, sy(v) + .5); g.stroke(); g.fillText(v + '%', padL - 4, sy(v)); }
    const floorPct = 100 * (1 - state.hw.dod);
    g.setLineDash([4, 4]); g.strokeStyle = cssVar('--crit'); g.beginPath(); g.moveTo(padL, sy(floorPct)); g.lineTo(W - padR, sy(floorPct)); g.stroke(); g.setLineDash([]);
    g.fillStyle = cssVar('--crit'); g.textAlign = 'left'; g.fillText('battery floor', padL + 4, sy(floorPct) - 8);
    const used = [];
    o.forEach(res => {
      const s = res.run.series, dt = s.stepMin / 60;
      g.strokeStyle = color(res.i); g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
      for (let i = 0; i < s.n; i++) { const X = x(i * dt), Y = sy(100 * s.soc[i] / state.hw.batteryWh); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
      g.stroke();
      let ly = sy(100 * s.soc[s.n - 1] / state.hw.batteryWh); while (used.some(u => Math.abs(u - ly) < 12)) ly += 12; used.push(ly);
      g.fillStyle = color(res.i); g.font = '600 11px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(res.name, Math.min(x((s.n - 1) * dt) + 5, W - 14), ly); g.font = '11px Inter, system-ui, sans-serif';
    });
    const line = (h, col, dash) => { g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x(h), top); g.lineTo(x(h), H - 20); g.stroke(); g.setLineDash([]); };
    if (hoverH !== undefined) line(hoverH, muted, [3, 3]);
    line(state.cursorH, cssVar('--text'));
    tl.geom = { padL, padR, W };
  }
  const sampleAt = (res, h) => { const s = res.run.series, i = Math.round(h * 60 / s.stepMin); return i >= 0 && i < s.n ? i : null; };
  function renderReadout() {
    const el = $('#readout'); if (!el || !tl) return;
    const h = state.cursorH; $('#cursor-lbl').textContent = 'T+' + E.fmtHours(h);
    el.innerHTML = ok().map(res => {
      const i = sampleAt(res, h);
      if (i === null) return `<div class="r" style="--c:var(${CV[res.i]})"><b>${res.name}</b> · mission ended</div>`;
      const s = res.run.series, dt = s.stepMin / 60, sv = Array.from(s.sunState, v => v === E.VISIBLE ? 1 : 0), ev = Array.from(s.earthState, v => v === E.VISIBLE ? 1 : 0);
      const utc = new Date(s.t0 + i * s.stepMin * 60000).toISOString().slice(0, 16).replace('T', ' ');
      const next = (arr, on, a, b) => { const t = E.timeToTransition(arr, i, on ? 1 : 0, on ? 0 : 1, dt); return t === null ? `no ${on ? a : b} before mission end` : `${on ? a : b} in ${E.fmtHours(t)}`; };
      const stS = E.STATE_NAME[s.sunState[i]], stE = E.STATE_NAME[s.earthState[i]];
      const limE = Math.max(res.run.geometryOnly ? 0 : s.horizonEarth[i], state.hw.minEarthElevDeg);
      const ang = state.readoutOpen ? `<br><span class="small">Sun az ${snum(res, i, 'sun', 'az', s.sunAz[i].toFixed(2) + '°')} el ${snum(res, i, 'sun', 'el', s.sunEl[i].toFixed(2) + '°')} vs terrain ${res.run.geometryOnly ? 'unavailable' : snum(res, i, 'sun', 'h', s.horizonSun[i].toFixed(2) + '°')} · Earth az ${snum(res, i, 'earth', 'az', s.earthAz[i].toFixed(2) + '°')} el ${snum(res, i, 'earth', 'el', s.earthEl[i].toFixed(2) + '°')} vs limit ${snum(res, i, 'earth', 'h', limE.toFixed(2) + '°')}</span>` : '';
      return `<div class="r" style="--c:var(${CV[res.i]})"><b>${res.name}</b> · ${utc} UTC · Sun <b>${snum(res, i, 'sun', 'state', stS)}</b>, ${next(sv, s.sunState[i] === E.VISIBLE, 'sunset', 'sunrise')}<br>
        Earth <b>${snum(res, i, 'earth', 'state', stE)}</b>, ${next(ev, s.earthState[i] === E.VISIBLE, 'Earthset', 'Earthrise')} · battery ${num({ kind: 'model-sample', res, k: i }, (100 * s.soc[i] / state.hw.batteryWh).toFixed(0) + '%')}<span class="est">est.${state.hw.confirmed ? '' : ', default panel'}</span>${ang}</div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- horizon view
  function horizonHtml() { return ok().length ? `<section class="card" id="horizon-card">${horizonInner()}</section>` : ''; }
  function horizonInner() {
    const o = ok(); if (state.horizonIdx >= o.length) state.horizonIdx = o.length - 1;
    const res = o[state.horizonIdx], s = res.run.series, i = sampleAt(res, state.cursorH) ?? 0, mask = res.run.terrain ? res.run.terrain.rec.maskDeg : null;
    const W = 900, H = 300, pl = 42, pr = 10, pt = 12, pb = 30;
    const yMax = Math.max(8, Math.ceil(Math.max(...(mask || [0]), res.run.metrics.maxEarthElDeg, 3) + 2)), yMin = Math.min(-4, Math.floor(Math.min(...(mask || [0]), -3)));
    const X = az => pl + (W - pl - pr) * az / 360, Y = el => pt + (H - pt - pb) * (yMax - Math.max(yMin, Math.min(yMax, el))) / (yMax - yMin);
    const path = mask ? `M${X(0)},${Y(yMin)} ` + mask.map((m, k) => `L${X(k).toFixed(1)},${Y(m).toFixed(1)}`).join(' ') + ` L${X(360)},${Y(mask[0])} L${X(360)},${Y(yMin)} Z` : '';
    const track = (azA, elA, a, b) => { let d = '', prev = null; for (let k = a; k <= b; k += 2) { const v = azA[k]; d += (prev === null || Math.abs(v - prev) > 180 ? 'M' : 'L') + X(v).toFixed(1) + ',' + Y(elA[k]).toFixed(1) + ' '; prev = v; } return d; };
    const tx = [0, 45, 90, 135, 180, 225, 270, 315, 360].map(a => `<line x1="${X(a)}" x2="${X(a)}" y1="${pt}" y2="${H - pb}" stroke="var(--grid)"/><text x="${X(a)}" y="${H - 9}" text-anchor="middle" font-size="13" fill="var(--muted)">${a}° ${({ 0: 'N', 90: 'E', 180: 'S', 270: 'W', 360: 'N' })[a] || ''}</text>`).join('');
    let ty = ''; for (let e = Math.ceil(yMin / 2) * 2; e <= yMax; e += (yMax - yMin > 20 ? 5 : 2)) ty += `<line x1="${pl}" x2="${W - pr}" y1="${Y(e)}" y2="${Y(e)}" stroke="var(--grid)"/><text x="${pl - 6}" y="${Y(e) + 4}" text-anchor="end" font-size="13" fill="var(--muted)">${e}°</text>`;
    const marker = (az, el, col, label, st) => { const right = X(az) > W - 190, vis = st === E.VISIBLE, unc = st === E.UNCERTAIN;
      return `<g><circle cx="${X(az)}" cy="${Y(el)}" r="8" fill="${vis ? col : 'var(--surface)'}" stroke="${col}" stroke-width="2.5" ${unc ? 'stroke-dasharray="3 2"' : ''}/><text x="${X(az) + (right ? -14 : 14)}" y="${Y(el) - 10}" text-anchor="${right ? 'end' : 'start'}" font-size="14.5" font-weight="600" fill="var(--text)" stroke="var(--surface)" stroke-width="3.5" paint-order="stroke">${label} ${el.toFixed(1)}° · ${E.STATE_NAME[st]}</text></g>`; };
    return `<h2>Horizon view <small>terrain silhouette with the Sun and Earth at T+${E.fmtHours(state.cursorH)}</small></h2>
      <div class="tabs" style="margin-bottom:8px">${o.map((x, k) => `<button class="btn sm" data-hz="${k}" aria-pressed="${k === state.horizonIdx}"><span class="sw" style="--c:var(${CV[x.i]});margin-right:6px"></span>${x.name} · ${esc(x.site.name)}</button>`).join('')}</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Terrain horizon by azimuth with Sun and Earth positions at the selected time">
        ${ty}${tx}<line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)"/>
        ${mask ? `<path d="${path}" fill="var(--terrain)" stroke="var(--terrain-edge)"/>` : `<text x="${W / 2}" y="${Y(0) + 20}" text-anchor="middle" font-size="13" fill="var(--warn)">Terrain unavailable for this site: no sample can be classified visible</text>`}
        <line x1="${pl}" x2="${W - pr}" y1="${Y(state.hw.minEarthElevDeg)}" y2="${Y(state.hw.minEarthElevDeg)}" stroke="var(--earth)" stroke-dasharray="6 5"/>
        <path d="${track(s.sunAz, s.sunEl, i, s.n - 1)}" fill="none" stroke="var(--sun)" stroke-width="1.5" stroke-dasharray="1 4" stroke-linecap="round"/><path d="${track(s.sunAz, s.sunEl, 0, i)}" fill="none" stroke="var(--sun)" stroke-width="2.2"/>
        <path d="${track(s.earthAz, s.earthEl, i, s.n - 1)}" fill="none" stroke="var(--earth)" stroke-width="1.5" stroke-dasharray="1 4" stroke-linecap="round"/><path d="${track(s.earthAz, s.earthEl, 0, i)}" fill="none" stroke="var(--earth)" stroke-width="2.2"/>
        ${marker(s.earthAz[i], s.earthEl[i], 'var(--earth)', 'Earth', s.earthState[i])}${marker(s.sunAz[i], s.sunEl[i], 'var(--sun)', 'Sun', s.sunState[i])}
      </svg>
      <p class="small muted">Solid trace = path so far, dotted = still to come. Dashed line = minimum antenna elevation. ${mask ? `Terrain: ${esc(res.run.terrain.rec.uploaded ? 'user-supplied mask' : 'LOLA ' + res.run.terrain.rec.dem.resolutionM.join('/') + ' m')}, observer ${res.run.terrain.rec.observerHeightM ?? '?'} m.` : `<button class="btn sm" data-loadmask="${res.site.id}">Load terrain mask for this site</button> <button class="btn sm ghost" data-open="whyterrain">Explain why this matters</button>`}</p>`;
  }

  // ---------------------------------------------------------------- decide (beat 5)
  function optionLabel(a, b) { const same = a.sc.siteId === b.sc.siteId, later = Date.parse(b.sc.startUtc) > Date.parse(a.sc.startUtc);
    return same && later ? 'Keep the site, accept the new date' : !same ? `Move to ${b.site.name}` : `Scenario ${b.name}`; }
  function sweepNext(siteId, afterUtc) {
    const sw = D.sweep, row = sw.sites[siteId]; if (!row) return null;
    const qs = Object.fromEntries(state.requirements.map(q => [q.metric, +q.threshold]));
    for (let k = 0; k < sw.dates.length; k++) if (Date.parse(sw.dates[k]) > Date.parse(afterUtc) && row[k].sun >= (qs.sunlitPct ?? 70) && row[k].earth >= (qs.earthVisiblePct ?? 40) && row[k].dark <= (qs.longestDarkGapH ?? 50)) return { date: sw.dates[k], c: row[k] };
    return null;
  }
  function decideHtml() {
    const o = ok(); if (o.length < 2) return '';
    const a = o[0], names = (res, v) => res.proofs.filter(p => p.verdict === v).map(p => p.short);
    const rows = o.slice(1).map(res => { const f = names(res, 'does not meet'), r = names(res, 'needs review'), m = res.run.metrics;
      return `<tr><td><span class="sw" style="--c:var(${CV[res.i]});margin-right:6px"></span><b>${esc(optionLabel(a, res))}</b><div class="muted small">Scenario ${res.name} · ${esc(res.site.name)}, ${day(res.sc.startUtc)}</div></td>
        <td style="white-space:nowrap">Sun ${mnum(res, 'sunlitPct')}<br>Earth ${mnum(res, 'earthVisiblePct')}</td>
        <td>${f.length ? 'Does not meet: ' + esc(f.join('; ')) + '.' : 'Meets every stated requirement' + (r.length ? ' that is not in review.' : '.')}${r.length ? ` <span class="muted">In review: ${esc(r.join('; '))}.</span>` : ''}</td>
        <td>${m.earthVisiblePct === 0 ? 'Is a relay available, or can the mission run without direct-to-Earth contact?' : m.brownoutMetH !== null ? `Can the lander survive ${E.fmtHours(m.longestDarkGapH)} without Sun (more storage, lower load, heaters)?` : !m.sunlitAtStart ? 'Is landing in darkness acceptable for descent and first-day operations?' : 'Confirm with detailed power and link analysis.'}</td></tr>`; }).join('');
    const nx = sweepNext(a.sc.siteId, o[1].sc.startUtc);
    const delay = `<tr><td><b>Delay further and reassess</b><div class="muted small">${esc(a.site.name)}, later landing dates</div></td><td style="white-space:nowrap">${nx ? `Sun ${nx.c.sun.toFixed(0)}%<br>Earth ${nx.c.earth.toFixed(0)}%` : '—'}</td>
      <td>${nx ? `On the ${D.sweep.stepDays}-day sweep grid, the next landing date that meets the Sun, darkness and Earth thresholds here is <b>${day(nx.date)}</b>. Costs schedule: ${Math.round((Date.parse(nx.date) - Date.parse(o[1].sc.startUtc)) / 86400000)} more days.` : 'No later date in the precomputed sweep meets the Sun, darkness and Earth thresholds at this site.'}</td><td>Does the programme tolerate the extra delay, and is the launch window compatible?</td></tr>`;
    const b = o[1], c = o[2], mb = b.run.metrics;
    const closing = [`Staying at ${esc(b.site.name)} on ${day(b.sc.startUtc)} means ${mb.sunlitAtStart ? 'the Sun is visible at landing' : `landing in darkness until ${F(mb.timeToSunriseH, 'met')}`}${mb.brownoutMetH !== null ? `, and the estimated battery reaches its floor at ${F(mb.brownoutMetH, 'met')}` : ''}.`,
      c ? `Moving to ${esc(c.site.name)} gives Sun visibility of ${fmtMetric('sunlitPct', c.run.metrics.sunlitPct)} but Earth in view ${fmtMetric('earthVisiblePct', c.run.metrics.earthVisiblePct)} of the mission${c.run.metrics.earthVisiblePct === 0 ? ', so there is no direct-to-Earth geometry in this window' : ''}.` : '',
      nx ? `Waiting until ${day(nx.date)} restores the baseline conditions at the original site at the cost of schedule.` : '',
      'Each option trades power margin, communications geometry or time. <b>SELENIX states the trade-off; choosing between them is an engineering and programme decision.</b>'].filter(Boolean).join(' ');
    return `<section class="card decide"><h2>What should we do? <small>the trade-off, stated; no winner picked</small></h2><div class="tablewrap"><table><thead><tr><th>Option</th><th>Visibility</th><th>What it costs</th><th>Open engineering question</th></tr></thead><tbody>${rows}${delay}</tbody></table></div><p class="closing">${closing}</p></section>`;
  }

  // ---------------------------------------------------------------- date sweep
  let prevScen = null;
  const liveCell = (id, d, dur) => { const o = runScenario({ siteId: id, startUtc: d, durationDays: dur }); if (!o.run) return null; const m = o.run.metrics; return { sun: m.sunlitPct, sunU: m.sunUncertainPct, earth: m.earthVisiblePct, earthU: m.earthUncertainPct, dark: m.longestDarkGapH, noEarth: m.longestNoEarthGapH }; };
  function sweepData() {
    const sw = D.sweep, dur = state.scenarios[0].durationDays;
    const isStatic = dur === sw.durationDays && state.hw.minEarthElevDeg === sw.minEarthElevDeg && !Object.keys(state.uploadedMasks).length;
    return { staticData: isStatic, dates: sw.dates, dur, get: (id, k) => isStatic && sw.sites[id] ? sw.sites[id][k] : liveCell(id, sw.dates[k], dur) };
  }
  function sweepHtml() {
    const sd = sweepData(), metric = state.heatMetric;
    const sites = allSites().filter(s => s.id !== 'south-pole' && (state.showAllSites || s.demo || state.scenarios.some(x => x.siteId === s.id) || s.category === 'candidate'));
    let grid = `<div class="heat" style="grid-template-columns: 180px repeat(${sd.dates.length}, minmax(15px, 1fr))">`;
    for (const s of sites) {
      const terr = !!maskRec(s.id);
      grid += `<div class="hl" title="${esc(s.name)}">${esc(s.name)}</div>`;
      sd.dates.forEach((d, k) => {
        const c = sd.get(s.id, k), v = c ? c[metric] : null, cls = v === null ? 'na' : v >= 99.95 ? 'g' : v >= 60 ? 'a' : 'r';
        const si = state.scenarios.findIndex(sc => sc.siteId === s.id && sc.startUtc.slice(0, 10) === d.slice(0, 10)), shown = si >= 0 && si < R.length;
        grid += `<button class="hc ${cls} ${terr ? '' : 'bound'} ${shown ? 'sel' : ''}" data-cell="${s.id}|${d}" data-tt="${esc(s.name)}|${day(d)}|${c ? `Sun visible ${terr ? '' : '≤ '}${c.sun.toFixed(0)}%, Earth in view ${terr ? '' : '≤ '}${c.earth.toFixed(0)}%` : 'outside the SPICE table'}|${c ? `longest Sun obstruction ${E.fmtHours(c.dark)}${terr ? '' : ' · terrain unavailable: upper bounds'} · click to load into scenario C` : ''}" aria-label="${esc(s.name)}, ${day(d)}: ${v === null ? 'not available' : v.toFixed(0) + ' percent'}">${shown ? NAMES[si] : ''}</button>`;
      });
    }
    grid += '<div></div>' + sd.dates.map((d, k) => `<div class="hx">${k % 2 === 0 ? d.slice(5, 10) : ''}</div>`).join('') + '</div>';
    return `<section class="card"><h2>${metric === 'sun' ? 'Sunlit % by site and date' : 'Earth-visible % by site and date'} <small>${sd.dur}-day missions landing at 12:00 UTC; click a cell to load it into scenario C</small></h2>
      <div class="row" style="margin-bottom:10px;align-items:center"><div class="tabs"><button class="btn sm" data-hm="sun" aria-pressed="${metric === 'sun'}">Sunlit %</button><button class="btn sm" data-hm="earth" aria-pressed="${metric === 'earth'}">Earth-visible %</button></div>
        <span class="key"><span><i style="background:var(--sw-good)"></i>100%</span><span><i style="background:var(--sw-warn)"></i>60–99%</span><span><i class="hc r" style="height:12px;min-width:14px"></i>below 60% (hatched)</span><span><i style="background:var(--surface-3);outline:1px dashed var(--muted)"></i>faded = terrain unavailable (upper bound)</span></span>
        <span class="small muted">${sd.staticData ? `Precomputed: static JSON built ${D.sweep.generatedUtc.slice(0, 10)} with the same engine.` : 'Inputs differ from the precomputed sweep, so this grid is recomputed live.'}</span></div>${grid}</section>`;
  }

  // ---------------------------------------------------------------- map + sites
  function mapHtml() {
    const view = state.mapView, layer = state.mapLayer, mm = D.maps.meta, half = mm.views[view].halfKm, L = mm.layers[layer];
    const R2 = 2 * E.R_MOON_KM, proj = (lat, lon) => { const r = R2 * Math.tan(Math.PI / 4 + lat * Math.PI / 360); return [50 + 50 * r * Math.sin(lon * Math.PI / 180) / half, 50 - 50 * r * Math.cos(lon * Math.PI / 180) / half]; };
    const used = state.scenarios.slice(0, Math.max(shownCount(), 1));
    const placed = [];
    const marks = allSites().filter(s => state.showAllSites || s.demo || used.some(u => u.siteId === s.id) || s.category === 'candidate').map(s => {
      const [x, y] = proj(s.lat, s.lon); if (x < 2 || x > 98 || y < 2 || y > 98) return '';
      const ui = used.findIndex(u => u.siteId === s.id), col = ui >= 0 ? `var(${CV[ui]})` : '#fff';
      const crowded = placed.some(p => Math.hypot(p[0] - x, p[1] - y) < 5); placed.push([x, y]);
      const right = x > 62;
      return `<g><circle cx="${x}" cy="${y}" r="${ui >= 0 ? 1.9 : 1.2}" fill="${col}" stroke="#000" stroke-width=".45"><title>${esc(s.name)} (${fmtCoord(s)})</title></circle>${crowded && ui < 0 ? '' : `<text x="${x + (right ? -2.6 : 2.6)}" y="${y + 1}" text-anchor="${right ? 'end' : 'start'}" font-size="2.7" fill="#fff" stroke="#000" stroke-width=".55" paint-order="stroke" font-weight="600">${esc(s.name.split(' (')[0])}</text>`}</g>`; }).join('');
    const rings = (view === 'pole' ? [-89.5, -89.75] : [-88, -86, -84]).map(lat => `<circle cx="50" cy="50" r="${50 * R2 * Math.tan(Math.PI / 4 + lat * Math.PI / 360) / half}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".22" stroke-dasharray="1 1"/>`).join('');
    const ticks = [0, 90, 180, 270].map(l => { const [x, y] = proj(view === 'pole' ? -89.2 : -85.2, l); return `<text x="${x}" y="${y + 1}" font-size="2.5" fill="#fff" fill-opacity=".8" stroke="#000" stroke-width=".5" paint-order="stroke" text-anchor="middle">${['0°', '90°E', '180°', '90°W'][l / 90]}</text>`; }).join('');
    return `<div class="mapwrap"><h2 style="margin:0">Lunar south pole <small>${esc(L.label)}</small></h2>
      <div class="tabs">${Object.entries(mm.layers).map(([k, v]) => `<button class="btn sm" data-layer="${k}" aria-pressed="${k === layer}">${esc(v.label)}</button>`).join('')}<span style="flex:1"></span><button class="btn sm" data-view="region" aria-pressed="${view === 'region'}">±175 km</button><button class="btn sm" data-view="pole" aria-pressed="${view === 'pole'}">±30 km</button></div>
      <div class="polemap"><img alt="${esc(L.label)} of the lunar south pole" src="data:image/jpeg;base64,${D.maps.img[layer + '_' + view]}"><svg viewBox="0 0 100 100">${rings}${marks}${ticks}</svg></div>
      <div class="mapcap">${esc(L.source)}${L.scale ? ' · ' + esc(L.scale) : ''}. ${layer === 'relief' ? '' : 'Published product shown for context and used as the benchmark; not computed by this tool. '}Polar stereographic, 0° longitude up; rings at ${view === 'pole' ? '89.5 and 89.75' : '88, 86 and 84'}°S.</div></div>`;
  }
  function sitesHtml() {
    const sitesShown = allSites().filter(s => state.showAllSites || s.demo || state.scenarios.some(x => x.siteId === s.id));
    const mv = (s, field, text) => num({ kind: 'measured', label: `${s.name}: ${field}`, text, site: s, field }, text);
    const rows = sitesShown.map(s => { const p = published(s.id), st = s.coordStatus || 'user-entered';
      return `<tr><td><b>${esc(s.name)}</b></td><td>${mv(s, 'latitude', s.lat.toFixed(4) + '°')}</td><td>${mv(s, 'longitude', s.lon.toFixed(4) + '°')}</td><td>${s.elevationM === null || s.elevationM === undefined ? '—' : mv(s, 'elevation', Math.round(s.elevationM) + ' m')}</td>
        <td>${p ? num({ kind: 'measured', label: `${s.name}: published average illumination`, text: p.publishedSunPct.toFixed(1) + '%', site: s, field: 'published', p }, p.publishedSunPct.toFixed(0) + '%') + ' / ' + num({ kind: 'measured', label: `${s.name}: published average Earth visibility`, text: p.publishedEarthPct.toFixed(1) + '%', site: s, field: 'published', p }, p.publishedEarthPct.toFixed(0) + '%') : '—'}</td>
        <td><span class="tag" style="${st === 'user-entered' ? '' : 'border-color:var(--good);color:var(--good)'}" title="${esc(s.source || '')}">${esc(st)}</span></td><td>${maskRec(s.id) ? `<span class="tag">${state.uploadedMasks[s.id] ? 'user mask' : 'LOLA'}</span>` : `<span class="tag warn">unavailable</span>`}</td>
        <td class="small"><button class="btn sm ghost" data-copy="${s.lat}, ${s.lon}" title="Copy latitude, longitude">copy</button>${s.id.startsWith('custom-') ? ` <button class="btn sm ghost" data-sdel="${s.id}">remove</button>` : ''}</td></tr>`; }).join('');
    return `<section class="card"><h2>Sites and terrain <small>planetocentric latitude, east-positive longitude in [−180°, 180°], MOON_ME frame</small></h2><div class="sites-grid"><div>${mapHtml()}</div><div>
      <div class="tablewrap"><table><thead><tr><th>Site</th><th>Lat</th><th>Lon</th><th>Elev.</th><th title="NASA PGDA 18.6-year averages at this point">Published Sun / Earth</th><th>Coordinates</th><th>Terrain</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-act="allsites">${state.showAllSites ? 'Show demo sites only' : `Show all ${allSites().length} sites`}</button><button class="btn sm ghost" data-act="advanced">${state.showAdvanced ? 'Hide' : 'Show'} add-site and mask override</button>
        <span class="small muted">Inspect terrain in <a href="https://quickmap.lroc.im-ldi.com/" target="_blank" rel="noopener">LROC QuickMap</a> or <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener">Moon Trek</a>.</span></div>
      ${state.showAdvanced ? `<div class="boxes"><div class="box"><h3>Add a site</h3><div class="row"><label class="f">Name<input id="cs-name" placeholder="My site"></label><label class="f">Lat (°)<input id="cs-lat" type="number" step="any" placeholder="-89.5"></label><label class="f">Lon (°E)<input id="cs-lon" type="number" step="any" placeholder="120"></label><label class="f">Elevation (m)<input id="cs-el" type="number" step="any" placeholder="0"></label></div><button class="btn sm" id="cs-add">Add site</button><p class="small muted">A custom site has no terrain data until you load a mask, so its results are upper bounds.</p></div>
        <div class="box"><h3>Terrain mask override</h3><p class="small muted">Masks for curated sites load automatically. To override one or supply terrain for a custom site, load a JSON in the horizon_&lt;siteId&gt;.json contract or a file with 360 values (1° steps, 0 = north, clockwise).</p>
          <div class="row"><select id="up-site">${allSites().map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><button class="btn sm" id="up-go">Choose file</button></div>
          <div class="small">${Object.keys(state.uploadedMasks).map(id => `User mask for ${esc(siteById(id)?.name || id)} <button class="btn sm ghost" data-unmask="${id}">remove</button>`).join('<br>')}</div></div></div>` : ''}
      </div></div></section>`;
  }

  // ---------------------------------------------------------------- requirements editor
  function reqEditorHtml() {
    const opts = sel => ['sunlitPct', 'earthVisiblePct', 'longestDarkGapH', 'longestNoEarthGapH', 'sunVisibleH', 'earthVisibleH', 'socMarginPct', 'minSocPct', 'energyBalanceWh', 'maxEarthElDeg'].map(m => `<option value="${m}" ${m === sel ? 'selected' : ''}>${esc((E.METRICS[m] || {}).label || m)}</option>`).join('');
    return `<section class="card"><h2>Requirements <small>your stated thresholds (user-assumption)</small></h2><div class="tablewrap"><table><thead><tr><th>Label</th><th>Indicator</th><th>Op</th><th>Threshold</th><th>Unit</th><th title="Uses Sun or Earth visibility states">Visibility</th><th title="Uses the hardware assumptions">Power</th><th></th></tr></thead><tbody>
      ${state.requirements.map((q, i) => `<tr data-ri="${i}"><td><input data-rf="label" value="${esc(q.label)}" style="width:100%;min-width:200px"></td><td><select data-rf="metric">${opts(q.metric)}</select></td><td><select data-rf="op">${['>=', '<=', '>', '<'].map(o => `<option ${o === q.op ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
        <td><input type="number" data-rf="threshold" value="${q.threshold}" step="any"></td><td><input data-rf="unit" value="${esc(q.unit)}" style="width:60px"></td><td><input type="checkbox" data-rf="visibilityDependent" ${q.visibilityDependent ? 'checked' : ''}></td><td><input type="checkbox" data-rf="powerDependent" ${q.powerDependent ? 'checked' : ''}></td><td><button class="btn sm ghost" data-rdel="${i}">Remove</button></td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px;align-items:center"><button class="btn sm" id="req-add">+ Add requirement</button><button class="btn sm ghost" id="req-reset">Reset to defaults</button><label class="small" style="display:flex;gap:6px;align-items:center">“Close to threshold” margin <input type="number" id="margin" value="${state.marginPct}" min="0" max="50" style="width:64px"> %</label></div></section>`;
  }

  // ---------------------------------------------------------------- footer: what this does not claim
  function renderFoot() {
    $('#foot').innerHTML = `<section class="card"><h2>What this tool does not claim</h2><div class="claims">
      <div>Earth visibility is geometric line of sight, not a communications link budget.</div><div>Sun visibility is not delivered electrical power; power and battery figures are labelled estimates.</div>
      <div>Sun and Earth are classified by disc centre against the terrain horizon; within ${CFG.toleranceDeg}° the state is “uncertain”.</div><div>It does not certify landing safety, thermal survival or overall mission feasibility.</div>
      <div>It does not rank scenarios or pick a winner; it states trade-offs for human engineering judgement.</div><div>Terrain finer than the 40 to 120 m DEM, boulders and the lander itself are not modelled.</div></div>
      <p class="small muted" style="margin-top:10px">SELENIX prototype, NASA Space Apps 2026. Data: NAIF SPICE (DE440), LRO LOLA (PDS), NASA GSFC PGDA illumination maps, cross-checked with JPL Horizons. Not a replacement for validated mission-analysis tools.</p></section>`;
  }

  // ---------------------------------------------------------------- drawer
  const ul = a => a && a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="muted">none recorded</span>';
  const srcList = a => a && a.length ? `<ul>${a.map(s => `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)} <span class="muted">${esc(s.version || '')}</span></li>`).join('')}</ul>` : '<span class="muted">none</span>';
  const QSTATE = { supported: 'Supported: data coverage present and checks passed.', limited: 'Limited: terrain unavailable, value is an upper bound.', uncertain: 'Some samples are uncertain (near the terrain horizon); they are not counted as visible.', unavailable: 'Unavailable: required data is missing.' };
  function valRefs(ids) { const cs = checks(); return `<ul>${ids.map(id => cs.find(c => c.id === id)).filter(Boolean).map(c => `<li>${c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '○'} <b>${esc(c.name)}</b>: ${esc(c.detail)}</li>`).join('')}</ul>`; }
  function drawer(title, html) {
    $('#drawer-title').textContent = title; $('#drawer-body').innerHTML = html;
    $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#drawer-body').scrollTop = 0; $('#drawer-close').focus();
  }
  const closeDrawer = () => { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); };
  const head = (kind, label, value, unit, cls, extra = '') => `<div class="ev-kind">${kind}</div><h3 style="font-size:16px;margin-top:2px">${esc(label)}</h3><div class="ev-value">${esc(value)} <small>${esc(unit || '')}</small></div><div style="margin-top:6px"><span class="qc">${esc(cls)}</span> ${extra}</div>`;
  const repro = (id, hash) => `<dt>Reproducibility</dt><dd class="mono">${esc(id || '')}<br>scenario ${esc(hash || '—')} · ${esc(E.CODE_VERSION)} · data built ${esc(D.builtUtc)}</dd>`;
  const copyBtn = obj => `<button class="btn sm" data-copyev="${reg({ kind: 'json', obj })}" style="margin-top:14px">Copy this record as JSON</button>`;

  function openIndicator(rec) {
    const d = E.METRICS[rec.metricId], est = rec.classification === 'engineering-estimate', p = rec.method.parameters;
    const val = rec.value === null ? '—' : F(rec.value, d.fmt), b = rec.bounds;
    const context = `<dt>How to read this value</dt><dd>${esc(QSTATE[rec.qualityState])}${b.conservative !== b.optimistic && b.conservative !== null && b.conservative !== undefined ? `<br>Counting uncertain samples as obstructed: <b>${esc(F(b.conservative, d.fmt))}</b>; as visible: <b>${esc(F(b.optimistic, d.fmt))}</b>.` : ''}${rec.uncertainSharePct ? `<br>Uncertain samples: ${F(rec.uncertainSharePct, 'pct')} of the mission (tolerance ±${p.toleranceDeg}°).` : ''}${rec.worstCase ? `<br>Worst case ${rec.worstCase.relation} T+${E.fmtHours(rec.worstCase.metH)} (${rec.worstCase.utc.slice(0, 16).replace('T', ' ')} UTC).` : ''}</dd>`;
    const where = `<dt>Site and time</dt><dd>${esc(rec.location.name)}, ${rec.location.lat.toFixed(4)}°, ${rec.location.lon.toFixed(4)}°, elevation ${rec.location.elevationM ?? 0} m (coordinates ${esc(rec.location.coordStatus)})<br>${esc(rec.time.startUtc.slice(0, 16).replace('T', ' '))} to ${esc(rec.time.endUtc.slice(0, 16).replace('T', ' '))} UTC, ${rec.time.stepSec / 60}-min samples</dd>`;
    let body;
    if (!est) {
      const g = geometry.describe();
      body = `${head('Geometry-derived result', rec.label, val, '', rec.classification, `<span class="qc">${esc(rec.qualityState)}</span>`)}<dl>${context}${where}
        <dt>Method</dt><dd>${esc(rec.method.description)}<br><span class="muted">Visible when elevation &gt; limit + ${p.toleranceDeg}°; obstructed when below limit − ${p.toleranceDeg}°; otherwise uncertain.${p.minEarthElevDeg !== undefined ? ` Limit = max(terrain horizon, ${p.minEarthElevDeg}° antenna elevation).` : ''}</span></dd>
        <dt>Frames and time</dt><dd>${esc(g.frame)} (${esc(rec.location.convention)}); ${esc(g.aberration)} apparent positions; ${esc(g.timeSystem)}</dd>
        <dt>Source data</dt><dd>${srcList(rec.sources)}${p.observerHeightM !== null && p.observerHeightM !== undefined ? `<span class="muted">Observer ${p.observerHeightM} m above the DEM surface; terrain closer than ${CFG.nearFieldM} m treated as the site.</span>` : ''}</dd>
        <dt>Validation</dt><dd>${valRefs(rec.validation.refs)}</dd><dt>Limitations</dt><dd>${ul(rec.limitations)}</dd>${repro(rec.id, rec.scenarioHash)}</dl>`;
    } else {
      const P = [['Panel type', p.panelType], ['Panel area', p.panelAreaM2 + ' m²'], ['Efficiency', (p.efficiency * 100).toFixed(0) + '%'], ['Losses', (p.losses * 100).toFixed(0) + '%'], ['Load', p.loadW + ' W'], ['Battery', p.batteryWh + ' Wh'], ['Usable depth of discharge', (p.dod * 100).toFixed(0) + '%'], ['Initial charge', p.initialSocPct + '%']];
      body = `${head('Model-derived estimate', rec.label, val, '', rec.classification, `<span class="qc">${p.assumptionsConfirmed ? 'inputs confirmed by user' : 'default inputs'}</span>`)}<dl>${context}
        <dt>Model</dt><dd>${esc(rec.method.description)}</dd>
        <dt>Parameters (user-assumption)</dt><dd><table>${P.map(r => `<tr><td class="muted">${r[0]}</td><td>${esc(r[1])}</td></tr>`).join('')}</table><button class="btn sm" data-open="hardware" style="margin-top:6px">Change these inputs</button></dd>
        <dt>Built on</dt><dd>${ul(rec.inputs)}<span class="muted">Sun geometry and visibility states come from the geometry-derived results for this scenario.</span></dd>${where}
        <dt>Not modelled</dt><dd>${ul(rec.limitations)}</dd><dt>Sources</dt><dd>${srcList(rec.sources)}</dd>${repro(rec.id, rec.scenarioHash)}</dl>`;
    }
    drawer('Evidence', body + copyBtn(rec));
  }
  function openEvidence(ev) {
    if (!ev) return;
    if (ev.kind === 'indicator') return openIndicator(ev.rec);
    if (ev.kind === 'input') {
      const where = ev.where || 'hardware', used = where === 'requirements' ? 'The requirement check: verdicts and “close to threshold” margins.' : where === 'scenario' ? 'Every result of this scenario.' : 'Power, battery and Earth-visibility results of every scenario.';
      return drawer('Evidence', `${head('User input', ev.label, ev.text, '', 'user-assumption', `<span class="qc">${where === 'hardware' && state.hw.confirmed ? 'confirmed by user' : where === 'hardware' ? 'demo default' : where === 'requirements' ? 'stated requirement' : 'scenario setting'}</span>`)}<dl>
        <dt>Where it comes from</dt><dd>${esc(ev.note || (state.hw.confirmed ? 'Entered or confirmed by the user.' : 'Demo default, not yet confirmed. Replace with your mission value.'))}</dd><dt>Used by</dt><dd>${used}</dd>
        <dt>Change it</dt><dd>${where === 'hardware' ? '<button class="btn sm" data-open="hardware">Open hardware and antenna inputs</button>' : where === 'requirements' ? '<button class="btn sm" data-act="goreq">Edit requirements</button>' : '<button class="btn sm" data-act="gofree">Edit scenarios</button>'}</dd>
        <dt>Limitations</dt><dd>This is an assumption, not a measured or calculated value. Results that depend on it inherit that status.</dd></dl>`);
    }
    if (ev.kind === 'proof') {
      const p = ev.proof, d = E.METRICS[p.metric] || {}, rec = store.get(p.evidence[0]);
      const settle = { terrain: 'Load a terrain mask for this site.', close: `Move further than ${p.marginPct}% from the threshold, or accept the margin.`, grazing: 'Higher-resolution terrain or a partial-disc model for the samples near the horizon.', defaults: 'Confirm the hardware and antenna inputs.' };
      return drawer('Rationale', `<div class="ev-kind">Requirement check · scenario ${esc(ev.res.name)}</div><h3 style="font-size:16px;margin-top:2px">${esc(p.label)}</h3><div style="margin:8px 0">${pill(p.verdict, p.subState)}</div><dl>
        <dt>Requirement</dt><dd>${esc(d.label || p.metric)} ${esc(p.op)} ${p.threshold === null ? '—' : esc(F(p.threshold, d.fmt === 'met' ? 'h' : d.fmt))}</dd>
        <dt>Driver</dt><dd>${esc(p.driver)}</dd>
        <dt>Checks</dt><dd><ul class="steps">${p.steps.map(s => `<li><span class="${s.result ? 'ok' : 'no'}">${s.result ? '✓' : '!'}</span><span>${esc(s.detail)}</span></li>`).join('')}</ul></dd>
        ${p.verdict === 'needs review' ? `<dt>What would settle it</dt><dd>${ul(p.reasons.map(r => settle[r]))}</dd>` : ''}
        ${rec ? `<dt>Evidence</dt><dd><button class="btn sm" data-ev="${reg({ kind: 'indicator', rec })}">Open the data and method behind ${esc(rec.value === null ? 'this value' : F(rec.value, d.fmt))}</button></dd>` : ''}${repro(p.id, p.scenarioHash)}</dl>` + copyBtn(p));
    }
    if (ev.kind === 'rule') {
      const f = ev.f, all = ev.sharedAll || [{ res: ev.res, f }];
      return drawer('Mission log entry', `<div class="ev-kind">Rule ${esc(f.id)} · ${esc(f.title)}</div><h3 style="font-size:15px;margin-top:4px;font-weight:500">${all.map(x => `<span class="sw" style="--c:var(${CV[x.res.i]});margin-right:6px"></span>${esc(x.f.detail)}`).join('<br><br>')}</h3><div style="margin-top:8px"><span class="qc">${esc(f.qualityClass)}</span></div><dl>
        <dt>How this entry is produced</dt><dd>A fixed template in rules.json is filled with calculated values when its condition holds. No free-text generation.</dd><dt>Condition</dt><dd class="mono">${esc(JSON.stringify(f.condition))}</dd>
        <dt>Values used</dt><dd>${all.map(x => `<b>${x.res.name}</b>: ${Object.entries(x.f.values).map(([n, v]) => `${n} = ${typeof v === 'number' ? Math.round(v * 1000) / 1000 : v} <span class="muted">(${esc(x.f.vars[n])})</span>`).join(', ') || '—'}`).join('<br>')}</dd>
        <dt>Inputs</dt><dd>${ul(f.inputs)}</dd>${repro('rule:' + f.id, E.scenarioId(ev.res.run))}</dl>`);
    }
    if (ev.kind === 'sample' || ev.kind === 'model-sample') {
      const res = ev.res, body = ev.body || 'sun', sr = E.sampleRecord(res.run, ev.k, body), s = res.run.series, tol = CFG.toleranceDeg;
      if (ev.kind === 'model-sample') return drawer('Evidence', `${head('Model-derived estimate', `Battery charge, scenario ${res.name} at T+${E.fmtHours(sr.mission_elapsed_time_h)}`, (100 * s.soc[ev.k] / state.hw.batteryWh).toFixed(0) + '%', '', 'engineering-estimate', `<span class="qc">${state.hw.confirmed ? 'inputs confirmed' : 'default inputs'}</span>`)}<dl>
        <dt>Model</dt><dd>${esc(E.METRICS.minSocPct.method)} Array output at this instant: ${F(s.power[ev.k], 'w')} (${esc(state.hw.panelType)}, ${state.hw.panelAreaM2} m², est.).</dd><dt>Parameters</dt><dd><button class="btn sm" data-open="hardware">Open hardware and antenna inputs</button></dd><dt>Not modelled</dt><dd>${ul(E.METRICS.minSocPct.limits)}</dd>${repro('sample', sr.scenario_id)}</dl>`);
      const lim = body === 'sun' ? sr.terrain_horizon_elevation_deg : Math.max(sr.terrain_horizon_elevation_deg ?? 0, state.hw.minEarthElevDeg);
      return drawer('Evidence', `${head('Geometry-derived result', `${body === 'sun' ? 'Sun' : 'Earth'}, scenario ${res.name} at T+${E.fmtHours(sr.mission_elapsed_time_h)}`, sr.visibility_state, '', 'computed-geometry', `<span class="qc">${esc(sr.quality_state)}</span>`)}<dl>
        <dt>Why this state</dt><dd>Elevation ${sr.elevation_deg.toFixed(3)}° at azimuth ${sr.azimuth_deg.toFixed(2)}°. ${res.run.geometryOnly ? 'Terrain is unavailable for this site, so the body cannot be classified visible.' : `Limit ${lim.toFixed(3)}° ${body === 'earth' ? '(the higher of terrain horizon and antenna elevation)' : '(terrain horizon at that azimuth)'}. Difference ${(sr.elevation_deg - lim).toFixed(3)}° against a tolerance of ±${tol}°.`}</dd>
        <dt>Result record</dt><dd><table>${Object.entries(sr).map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td class="mono">${esc(typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v)}</td></tr>`).join('')}</table></dd>
        <dt>Validation</dt><dd>${valRefs(['horizons', 'regression'])}</dd></dl>` + copyBtn(sr));
    }
    if (ev.kind === 'measured') {
      const s = ev.site, p = ev.p;
      return drawer('Evidence', `${head('Source data', ev.label, ev.text, '', p ? 'measured' : (s.coordStatus === 'user-entered' ? 'user-assumption' : 'measured'), `<span class="qc">${esc(p ? 'published product' : s.coordStatus || 'user-entered')}</span>`)}<dl>
        <dt>Source</dt><dd>${p ? 'NASA GSFC PGDA product 69 (AVGVISIB_85S_060M_201608): share of hourly timesteps over 18.6 years with any part of the disc visible, at this pixel.' : esc(s.source || 'User entry')}${(p || s.sourceUrl) ? ` <a href="${esc(p ? 'https://pgda.gsfc.nasa.gov/products/69' : s.sourceUrl)}" target="_blank" rel="noopener">source</a>` : ''}</dd>
        ${p ? `<dt>This pipeline at the same pixel</dt><dd>Sun ${p.oursSunPct}% (difference ${p.dSunPct > 0 ? '+' : ''}${p.dSunPct} points), Earth ${p.oursEarthPct}% (${p.dEarthPct > 0 ? '+' : ''}${p.dEarthPct}). Long-term averages; a 10-day mission can differ greatly.</dd>` : ''}
        ${ev.field === 'elevation' ? '<dt>Method</dt><dd>Bilinear LOLA DEM height at the site, relative to a 1737.4 km sphere.</dd>' : ''}
        <dt>Convention</dt><dd>Planetocentric latitude, east-positive longitude in [−180°, 180°], MOON_ME frame.</dd>${s.notes ? `<dt>Notes</dt><dd>${esc(s.notes)}</dd>` : ''}</dl>`);
    }
  }
  function openPanel(name) {
    if (name === 'validation') {
      const cs = checks(), bm = D.validation.benchmark, hz = D.validation.horizonsCheck;
      return drawer('Validation', `<p class="muted">${cs.filter(c => c.status === 'pass').length} of ${cs.length} checks passed. A failing or not-run check is shown here and in the banner, never hidden.</p>
        ${cs.map(c => `<div class="check"><span class="status ${c.status === 'pass' ? 'st-meets' : c.status === 'fail' ? 'st-fail' : 'st-unknown'}" style="padding:2px;height:18px">${c.status === 'pass' ? IC.meets : c.status === 'fail' ? IC.fail : IC.unknown}</span><div><b>${esc(c.name)}</b>${c.status === 'not-run' ? ' <span class="qc">not run</span>' : ''}<br>${esc(c.detail)}${c.tolerance ? `<br><span class="muted small">Tolerance: ${esc(c.tolerance)}</span>` : ''}</div></div>`).join('')}
        ${bm ? `<dl><dt>Illumination benchmark detail</dt><dd>Reference: <a href="${esc(bm.referenceUrl)}" target="_blank" rel="noopener">NASA GSFC PGDA product 69</a> (Mazarico et al. 2011 method). Differences come from: ${esc(bm.differencesFrom)}.
          <table style="margin-top:6px"><tr><th>Near field</th><th>Sun median</th><th>Sun RMS</th><th>Earth median</th><th>Earth RMS</th></tr>${Object.entries(bm.nearFieldSensitivity).map(([k, v]) => `<tr><td>${k} m${+k === bm.nearFieldM ? ' (used)' : ''}</td><td>${v.sun.medianAbs}</td><td>${v.sun.rms}</td><td>${v.earth.medianAbs}</td><td>${v.earth.rms}</td></tr>`).join('')}</table>
          <span class="muted small">Differences in percentage points over ${bm.sun.all.n} points. The near-field setting matters because at grazing Sun angles metre-scale relief within a few DEM cells dominates the horizon on ridge crests.</span></dd>
          <dt>Curated sites against the published maps</dt><dd><table><tr><th>Site</th><th>Published Sun</th><th>Ours</th><th>Published Earth</th><th>Ours</th></tr>${bm.rows.filter(r => r.kind === 'site').map(r => `<tr><td>${esc(r.name)}</td><td>${r.publishedSunPct}%</td><td>${r.oursSunPct}%</td><td>${r.publishedEarthPct}%</td><td>${r.oursEarthPct}%</td></tr>`).join('')}</table></dd></dl>` : ''}
        ${hz ? `<dl><dt>JPL Horizons detail</dt><dd>${esc(hz.source)}. Ours: ${esc(hz.ours)}. Worst difference ${hz.worstAbsDiffDeg}° against a ${hz.toleranceDeg}° target.</dd></dl>` : ''}`);
    }
    if (name === 'provenance') {
      const g = geometry.describe(), m0 = Object.values(D.horizons)[0], kc = D.ephemerisMeta.adapter.coverage || {};
      return drawer('Provenance', `<div class="ev-kind">Engine and data</div><dl>
        <dt>SPICE kernels</dt><dd><table>${(g.sources || []).map(k => `<tr><td class="mono">${esc(k.file)}</td><td>${esc(k.type)}</td><td class="muted">${esc(k.role)}</td></tr>`).join('')}</table><span class="muted">${esc(g.toolkit)} · <a href="${esc(g.sourceUrl)}" target="_blank" rel="noopener">NAIF generic kernels</a></span></dd>
        <dt>Coverage window</dt><dd>Table ${esc(COV.startUtc.slice(0, 10))} to ${esc(COV.endUtc.slice(0, 10))} (${esc(g.sampling)}); kernels ${esc((kc.startUtc || '').slice(0, 10))} to ${esc((kc.endUtc || '').slice(0, 10))}</dd>
        <dt>Lunar frame</dt><dd>${esc(g.frame)}: ${esc(g.frameNote)}</dd><dt>Time system</dt><dd>${esc(g.timeSystem)}</dd><dt>Aberration correction</dt><dd>${esc(g.aberration)}: ${esc(g.aberrationNote)}</dd>
        <dt>Terrain</dt><dd>${m0 ? `${esc(m0.dem.version)}<br>Horizon masks: 1° azimuth steps, rays to ${m0.dem.extentKm} km, observer ${m0.observerHeightM} m, near field ${m0.nearFieldM} m. ${esc(m0.method)}` : 'none'}</dd>
        <dt>Visibility tolerance</dt><dd>±${CFG.toleranceDeg}°. ${esc(CFG.toleranceRationale)}</dd><dt>Sampling</dt><dd>${CFG.stepMin}-minute samples; transitions are known to one step.</dd>
        <dt>Calculation version</dt><dd class="mono">${esc(E.CODE_VERSION)} · adapters ${esc(g.id)}@${esc(g.version)} (from ${esc(g.derivedFrom)}), lola-horizon@2.0.0</dd>
        <dt>Last updated</dt><dd>Ephemeris table ${esc(g.generatedUtc)} · sweep ${esc(D.sweep.generatedUtc.slice(0, 19))}Z · build ${esc(D.builtUtc)}</dd>
        <dt>All sources</dt><dd><ul>${D.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> <span class="muted">${esc(s.version)}</span> <span class="qc">${esc(s.qualityClass)}</span></li>`).join('')}</ul></dd>
        <dt>Quality vocabulary</dt><dd><span class="qc">measured</span> <span class="qc">computed-geometry</span> <span class="qc">engineering-estimate</span> <span class="qc">user-assumption</span> <span class="qc">demo-only</span><br><span class="muted">Hover any number to see its class; click it for the evidence.</span></dd></dl>`);
    }
    if (name === 'hardware') {
      const h = state.hw, f = (k, label, step, scale = 1) => `<label class="f">${label}<input type="number" data-hw="${k}" data-scale="${scale}" step="${step}" value="${+(h[k] * scale).toFixed(4)}"></label>`;
      return drawer('Hardware and antenna inputs', `<p class="muted">Shared by every scenario so comparisons stay like for like. All values are <span class="qc">user-assumption</span>. Power and battery results built on them are <span class="qc">engineering-estimate</span>.</p>
        <div class="row" style="margin-top:12px"><label class="f">Panel type<select data-hw="panelType">${E.PANEL_TYPES.map(t => `<option ${t === h.panelType ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${h.panelType === 'vertical-fixed' ? f('panelAzDeg', 'Panel facing azimuth (°)', 1) : ''}
          ${f('panelAreaM2', 'Panel area (m²)', 0.1)}${f('efficiency', 'Efficiency (%)', 1, 100)}${f('losses', 'Losses (%)', 1, 100)}${f('loadW', 'Load (W)', 5)}${f('batteryWh', 'Battery (Wh)', 100)}${f('dod', 'Usable depth of discharge (%)', 1, 100)}${f('initialSocPct', 'Initial charge (%)', 1)}${f('minEarthElevDeg', 'Minimum antenna elevation (°)', 0.5)}</div>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:14px"><input type="checkbox" id="hwconfirm" ${h.confirmed ? 'checked' : ''}> <span>These are my mission's values. Until this is ticked, power verdicts read “needs review · default assumptions”.</span></label>
        <button class="btn sm ghost" data-act="hwreset" style="margin-top:12px">Restore demo defaults</button>`);
    }
    if (name === 'whyterrain') return drawer('Why terrain matters', `<p>Near the lunar south pole the Sun never climbs more than a few degrees above the horizon, and Earth sits low too. A ridge a few kilometres away can hide either one for days.</p><p style="margin-top:10px">Without a terrain horizon for a site, SELENIX cannot tell whether a body above the smooth-sphere horizon is really visible. It therefore classifies those samples as <b>uncertain</b>, reports the figures as upper bounds, and never returns “meets” for a visibility requirement.</p><p style="margin-top:10px">Curated sites load their LOLA-derived masks automatically. For another site, compute one with <span class="mono">precompute/horizon_mask.py</span> and load it here.</p>`);
  }

  // ---------------------------------------------------------------- export
  function exportJSON() {
    const o = ok();
    const out = { generator: E.CODE_VERSION, exportedUtc: new Date().toISOString(), provenance: geometry.describe(), config: CFG, hardware: state.hw, marginPct: state.marginPct, requirements: state.requirements,
      scenarios: o.map(res => ({ name: res.name, scenarioHash: E.scenarioId(res.run), site: { id: res.site.id, name: res.site.name, lat: res.site.lat, lon: res.site.lon, elevationM: res.site.elevationM, coordStatus: res.site.coordStatus }, startUtc: res.sc.startUtc, durationDays: res.sc.durationDays,
        qualityState: res.run.qualityState, metrics: res.run.metrics, bounds: res.run.bounds, windows: res.run.windows, proofs: res.proofs, missionLog: firedRules(res).map(x => ({ id: x.id, text: x.text })) })),
      differences: o.slice(1).map((b, k) => { const c = comparison(o[k], b); return { from: o[k].name, to: b.name, siteChanged: c.siteChanged, landingShiftDays: c.shiftD, deltas: c.deltas.map(x => ({ metric: x.k, from: x.from, to: x.to })), verdictChanges: c.changes.map(x => ({ requirement: x.q.id, from: x.from.verdict, to: x.to.verdict })) }; }),
      indicatorRecords: store.list(r => r.id.startsWith('ind:')), validation: checks() };
    copy(JSON.stringify(out, null, 2), 'Comparison, records and proofs copied as JSON');
  }

  // ---------------------------------------------------------------- render
  function renderAll() {
    EV = {}; evN = 0; compute();
    document.documentElement.dataset.theme = state.theme;
    renderChips(); renderDemoBar(); renderBanner();
    const free = state.mode === 'free', b = state.beat;
    let h;
    if (!free && b === 1) h = renderBriefing();
    else h = storyHtml() + (b === 5 && !free ? decideHtml() : '') + scenariosHtml()
      + `<div class="cols"><div class="col">${verdictsHtml()}${diffHtml()}</div><div class="col">${timelineHtml()}${horizonHtml()}</div></div>${logHtml()}`
      + (free || b === 5 ? sweepHtml() : '') + (free ? reqEditorHtml() + sitesHtml() : '');
    $('#app').innerHTML = h;
    renderFoot(); drawTimeline(); renderReadout(); save();
  }
  function renderLive() { drawTimeline(); renderReadout(); const hc = $('#horizon-card'); if (hc) hc.innerHTML = horizonInner(); const c = $('#cursor'); if (c) c.value = state.cursorH; }
  function whyTarget() {
    const o = ok(); if (!o.length) return null;
    const cur = o[o.length - 1];
    if (o.length === 1) { const p = cur.proofs.find(x => x.verdict !== 'meets') || cur.proofs[0]; return { kind: 'proof', proof: p, res: cur }; }
    const c = comparison(o[o.length - 2], cur), k = c.deltas[0].k, qi = state.requirements.findIndex(q => q.metric === k);
    const ch = c.changes.find(x => x.q.metric === k) || c.changes[0];
    return ch ? { kind: 'proof', proof: ch.to, res: cur } : qi >= 0 ? { kind: 'proof', proof: cur.proofs[qi], res: cur } : { kind: 'indicator', rec: store.get(`ind:${E.scenarioId(cur.run)}:${k}`) };
  }
  function stopPlay() { if (playing) { clearInterval(playing); playing = null; } }

  // ---------------------------------------------------------------- events
  let maskSite = null;
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-ev],[data-copyev],[data-open],[data-act],[data-beat],[data-hz],[data-hm],[data-layer],[data-view],[data-cell],[data-rdel],[data-copy],[data-unmask],[data-sdel],[data-log],[data-loadmask],#drawer-close,#req-add,#req-reset,#cs-add,#up-go');
    if (!t) { if (!e.target.closest('#drawer') && e.target.id !== 'tl-canvas') closeDrawer(); return; }
    if (t.dataset.ev) return openEvidence(EV[t.dataset.ev]);
    if (t.dataset.copyev) return copy(JSON.stringify(EV[t.dataset.copyev].obj, null, 2), 'Record copied');
    if (t.id === 'drawer-close') return closeDrawer();
    if (t.dataset.open) return openPanel(t.dataset.open);
    if (t.dataset.beat) { stopPlay(); state.beat = +t.dataset.beat; closeDrawer(); renderAll(); return scrollTo({ top: 0 }); }
    if (t.dataset.loadmask) { maskSite = t.dataset.loadmask; return $('#mask-file').click(); }
    if (t.id === 'up-go') { maskSite = $('#up-site').value; return $('#mask-file').click(); }
    const a = t.dataset.act;
    if (a) {
      const card = t.closest('[data-i]'), i = card ? +card.dataset.i : -1;
      if (a === 'reset') { stopPlay(); const th = state.theme; state = defaultState(); state.theme = th; cache.clear(); closeDrawer(); renderAll(); return scrollTo({ top: 0 }); }
      if (a === 'next') { state.beat = Math.min(5, state.beat + 1); closeDrawer(); renderAll(); return scrollTo({ top: 0 }); }
      if (a === 'why') { const w = whyTarget(); return w && openEvidence(w); }
      if (a === 'mode' || a === 'gofree') { stopPlay(); state.mode = a === 'gofree' || state.mode === 'guided' ? 'free' : 'guided'; if (state.mode === 'guided') state.beat = Math.max(2, Math.min(5, state.scenarios.length + 1)); closeDrawer(); renderAll(); return; }
      if (a === 'goreq') { state.mode = 'free'; closeDrawer(); renderAll(); const el = document.querySelector('[data-rf]'); return el && el.scrollIntoView({ block: 'center' }); }
      if (a === 'theme') { state.theme = state.theme === 'dark' ? 'light' : 'dark'; return renderAll(); }
      if (a === 'export') return exportJSON();
      if (a === 'play') { if (playing) stopPlay(); else { if (state.cursorH >= tl.maxH) state.cursorH = 0; playing = setInterval(() => { state.cursorH = Math.min(tl.maxH, state.cursorH + 1); renderLive(); if (state.cursorH >= tl.maxH) { stopPlay(); const pb = document.querySelector('[data-act=play]'); if (pb) pb.textContent = '▶ Play'; } }, 70); } t.textContent = playing ? '❚❚ Pause' : '▶ Play'; return; }
      if (a === 'readout') { state.readoutOpen = !state.readoutOpen; t.textContent = state.readoutOpen ? 'Hide angles' : 'Show angles'; return renderReadout(); }
      if (a === 'allsites') { state.showAllSites = !state.showAllSites; return renderAll(); }
      if (a === 'advanced') { state.showAdvanced = !state.showAdvanced; return renderAll(); }
      if (a === 'hwreset') { state.hw = { ...D.hardware.defaults }; cache.clear(); renderAll(); return openPanel('hardware'); }
      if (a === 'add') state.scenarios.push({ ...state.scenarios[state.scenarios.length - 1] });
      if (a === 'dup') state.scenarios.splice(i + 1, 0, { ...state.scenarios[i] });
      if (a === 'slip') state.scenarios.splice(i + 1, 0, { ...state.scenarios[i], startUtc: addDays(state.scenarios[i].startUtc, state.slipDays) });
      if (a === 'del') state.scenarios.splice(i, 1);
      state.scenarios = state.scenarios.slice(0, MAX_SCEN);
      return renderAll();
    }
    if (t.dataset.hz !== undefined) { state.horizonIdx = +t.dataset.hz; return renderLive(); }
    if (t.dataset.hm) { state.heatMetric = t.dataset.hm; return renderAll(); }
    if (t.dataset.layer) { state.mapLayer = t.dataset.layer; return renderAll(); }
    if (t.dataset.view) { state.mapView = t.dataset.view; return renderAll(); }
    if (t.dataset.log) { state.logOpen[t.dataset.log] = !state.logOpen[t.dataset.log]; return renderAll(); }
    if (t.dataset.cell) {
      const [siteId, startUtc] = t.dataset.cell.split('|');
      prevScen = JSON.parse(JSON.stringify(state.scenarios));
      const sc = { siteId, startUtc, durationDays: state.scenarios[0].durationDays };
      if (state.scenarios.length < MAX_SCEN) state.scenarios.push(sc); else state.scenarios[MAX_SCEN - 1] = sc;
      if (state.mode === 'guided' && state.beat < 4) state.beat = 4;
      renderAll(); return toast(`Loaded into scenario ${NAMES[state.scenarios.length - 1]}: ${siteById(siteId).name}, ${day(startUtc)}`, () => { state.scenarios = prevScen; renderAll(); });
    }
    if (t.dataset.rdel !== undefined) { state.requirements.splice(+t.dataset.rdel, 1); return renderAll(); }
    if (t.id === 'req-add') { state.requirements.push({ id: 'REQ-' + Date.now().toString(36).toUpperCase(), label: 'New requirement', metric: 'sunlitPct', op: '>=', threshold: '', unit: '%', visibilityDependent: true, powerDependent: false }); return renderAll(); }
    if (t.id === 'req-reset') { state.requirements = JSON.parse(JSON.stringify(D.requirements.requirements)); state.marginPct = D.requirements.marginPct; return renderAll(); }
    if (t.dataset.copy) return copy(t.dataset.copy, 'Coordinates copied');
    if (t.dataset.unmask) { delete state.uploadedMasks[t.dataset.unmask]; cache.clear(); return renderAll(); }
    if (t.dataset.sdel) { state.customSites = state.customSites.filter(s => s.id !== t.dataset.sdel); state.scenarios.forEach(s => { if (s.siteId === t.dataset.sdel) s.siteId = 'mons-mouton'; }); return renderAll(); }
    if (t.id === 'cs-add') {
      const name = $('#cs-name').value.trim() || 'Custom site', lat = +$('#cs-lat').value, lon = +$('#cs-lon').value, el = $('#cs-el').value === '' ? 0 : +$('#cs-el').value;
      if ($('#cs-lat').value === '' || $('#cs-lon').value === '' || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 360)) return toast('Enter a latitude in [-90, 90] and a longitude in degrees east');
      state.customSites.push({ id: 'custom-' + Date.now().toString(36), name, lat, lon: lon > 180 ? lon - 360 : lon, elevationM: el, category: 'custom', terrain: 'none', coordStatus: 'user-entered', source: 'User entry', notes: '' });
      return renderAll();
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.f) {
      const sc = state.scenarios[+t.closest('[data-i]').dataset.i];
      if (t.dataset.f === 'startUtc') { if (!t.value) return; sc.startUtc = new Date(t.value + ':00Z').toISOString().replace('.000', ''); }
      else if (t.dataset.f === 'durationDays') sc.durationDays = Math.max(1, Math.min(30, +t.value || 1));
      else sc[t.dataset.f] = t.value;
      return renderAll();
    }
    if (t.dataset.hw) { const k = t.dataset.hw; state.hw[k] = k === 'panelType' ? t.value : (+t.value) / (+t.dataset.scale || 1); state.hw.confirmed = false; cache.clear(); renderAll(); return openPanel('hardware'); }
    if (t.id === 'hwconfirm') { state.hw.confirmed = t.checked; cache.clear(); return renderAll(); }
    if (t.id === 'margin') { state.marginPct = +t.value; return renderAll(); }
    if (t.dataset.rf) { const q = state.requirements[+t.closest('tr').dataset.ri], f = t.dataset.rf; q[f] = t.type === 'checkbox' ? t.checked : (f === 'threshold' ? (t.value === '' ? '' : +t.value) : t.value); return renderAll(); }
    if (t.id === 'mask-file' && t.files[0] && maskSite) {
      const file = t.files[0], sid = maskSite;
      file.text().then(txt => {
        let mask; try { mask = JSON.parse(txt).maskDeg; } catch (err) { mask = txt.split(/[\s,;]+/).filter(Boolean).map(Number); }
        if (!Array.isArray(mask) || mask.length !== 360 || mask.some(x => !Number.isFinite(x))) return toast('Need exactly 360 numeric values (1° steps, 0 = north, clockwise)');
        state.uploadedMasks[sid] = { siteId: sid, maskDeg: mask, uploaded: new Date().toISOString(), observerHeightM: null, azConvention: '0=N, clockwise', method: 'user-supplied mask', dem: { product: 'user upload: ' + file.name, resolutionM: [], version: '' } };
        cache.clear(); renderAll(); toast('Terrain mask loaded for ' + siteById(sid).name);
      }); t.value = '';
    }
  });
  document.addEventListener('input', e => { if (e.target.id === 'cursor') { stopPlay(); state.cursorH = +e.target.value; renderLive(); save(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); if (e.key === 'ArrowRight' && state.mode === 'guided' && !e.target.closest('input,select,textarea') && state.beat < 5) { state.beat++; renderAll(); } });

  const tip = $('#tooltip');
  function showTip(html, ev) { tip.innerHTML = html; tip.classList.add('on'); const w = tip.offsetWidth, h = tip.offsetHeight; let x = ev.clientX + 14, y = ev.clientY + 14; if (x + w > innerWidth - 8) x = ev.clientX - w - 14; if (y + h > innerHeight - 8) y = ev.clientY - h - 14; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
  const hideTip = () => tip.classList.remove('on');
  const tlHour = e => { const r = e.target.getBoundingClientRect(), gm = tl.geom; return Math.max(0, Math.min(tl.maxH, (e.clientX - r.left - gm.padL) / (gm.W - gm.padL - gm.padR) * tl.maxH)); };
  document.addEventListener('mousemove', e => {
    const c = e.target.closest && e.target.closest('[data-tt]');
    if (c) { const [n, d, v, extra] = c.dataset.tt.split('|'); return showTip(`<div class="tt-h">${esc(n)} · ${esc(d)}</div>${esc(v)}<br><span class="muted">${esc(extra)}</span>`, e); }
    if (e.target.id === 'tl-canvas' && tl && tl.geom) {
      const h = tlHour(e); drawTimeline(h);
      return showTip(`<div class="tt-h">T+${E.fmtHours(h)}</div>` + ok().map(res => { const i = sampleAt(res, h); if (i === null) return `${res.name}: ended`; const s = res.run.series;
        return `<b>${res.name}</b> Sun ${E.STATE_NAME[s.sunState[i]]} (${s.sunEl[i].toFixed(1)}°), Earth ${E.STATE_NAME[s.earthState[i]]}, battery ${(100 * s.soc[i] / state.hw.batteryWh).toFixed(0)}% est.`; }).join('<br>') + '<br><span class="muted">click to move the cursor</span>', e);
    }
    hideTip();
  });
  document.addEventListener('click', e => { if (e.target.id === 'tl-canvas' && tl && tl.geom) { stopPlay(); state.cursorH = Math.round(tlHour(e) * 6) / 6; renderLive(); save(); } });
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => drawTimeline(), 120); });

  renderAll();
})();
