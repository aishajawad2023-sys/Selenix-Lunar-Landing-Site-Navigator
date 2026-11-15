// Collects every figure quoted in the slide deck and technical document from the engine and data files,
// so the documents never carry hand-typed numbers. Run: node docs/pitch/collect_facts.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const E = require(path.join(root, 'src/engine.js'));
const J = p => JSON.parse(fs.readFileSync(path.join(root, p)));
const meta = J('data/ephemeris.meta.json');
const buf = fs.readFileSync(path.join(root, 'data/ephemeris.bin'));
const geometry = E.SpiceTableAdapter(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), meta);
const config = J('data/config.json'), hw = J('data/hardware.json').defaults, reqs = J('data/requirements.json');
const sites = J('data/sites.json'), byId = Object.fromEntries(sites.map(s => [s.id, s]));
const terrainFor = id => { const p = path.join(root, `data/horizons/horizon_${id}.json`); return fs.existsSync(p) ? E.HorizonMaskAdapter(JSON.parse(fs.readFileSync(p))) : null; };
const scen = { A: ['mons-mouton', '2027-08-11T12:00:00Z'], B: ['mons-mouton', '2027-09-01T12:00:00Z'], C: ['connecting-ridge', '2027-09-01T12:00:00Z'] };
const out = { scenarios: {}, generatedUtc: new Date().toISOString() };
for (const [k, [siteId, startUtc]] of Object.entries(scen)) {
  const run = E.simulate({ geometry, terrain: terrainFor(siteId), site: byId[siteId], scenario: { siteId, startUtc, durationDays: 10 }, hw, config });
  const proofs = reqs.requirements.map(q => E.checkRequirement(q, run, { marginPct: reqs.marginPct }));
  const m = run.metrics;
  out.scenarios[k] = { siteId, site: byId[siteId].name, startUtc, metrics: m, proofs: proofs.map(p => ({ id: p.requirementId, label: p.label, short: p.short, verdict: p.verdict, subState: p.subState, value: p.observed.value, at: p.observed.at, driver: p.driver })),
    windows: { sun: run.windows.sun.map(w => ({ state: w.state, startH: w.startRefH, endH: w.endRefH, durH: w.durationRefH })), earth: run.windows.earth.map(w => ({ state: w.state, startH: w.startRefH, endH: w.endRefH, durH: w.durationRefH })) },
    fmt: { sun: E.format(m.sunlitPct, 'pct'), earth: E.format(m.earthVisiblePct, 'pct'), dark: E.fmtHours(m.longestDarkGapH), noEarth: E.fmtHours(m.longestNoEarthGapH), rise: m.timeToSunriseH === null ? null : E.fmtHours(m.timeToSunriseH),
      brown: m.brownoutMetH === null ? null : E.fmtHours(m.brownoutMetH), vh: m.verticalToHorizontalRatio === null ? null : m.verticalToHorizontalRatio.toFixed(1), shadow: m.shadowLengthM === null ? null : m.shadowLengthM.toFixed(0), meanEl: m.meanSunElDeg === null ? null : m.meanSunElDeg.toFixed(1) } };
}
// next date at the original site meeting the visibility thresholds (from the static sweep)
const sw = J('data/sweep.json'), th = Object.fromEntries(reqs.requirements.map(q => [q.metric, +q.threshold]));
const row = sw.sites['mons-mouton'];
const k = sw.dates.findIndex((d, i) => Date.parse(d) > Date.parse(scen.B[1]) && row[i].sun >= th.sunlitPct && row[i].earth >= th.earthVisiblePct && row[i].dark <= th.longestDarkGapH && row[i].noEarth <= th.longestNoEarthGapH);
out.nextGood = k >= 0 ? { date: sw.dates[k], cell: row[k], extraDays: Math.round((Date.parse(sw.dates[k]) - Date.parse(scen.B[1])) / 86400000) } : null;
const val = J('data/validation.json');
out.validation = { summary: val.summary, checks: val.checks, horizons: { worst: val.horizonsCheck.worstAbsDiffDeg, n: val.horizonsCheck.rows.length, tol: val.horizonsCheck.toleranceDeg, sites: val.horizonsCheck.sites, dates: val.horizonsCheck.dates },
  bench: { n: val.benchmark.sun.all.n, sun: val.benchmark.sun, earth: val.benchmark.earth, nearField: val.benchmark.nearFieldSensitivity, used: val.benchmark.nearFieldM, sites: val.benchmark.rows.filter(r => r.kind === 'site') } };
out.config = config; out.hw = hw; out.requirements = reqs.requirements; out.sites = sites; out.sources = J('data/sources.json'); out.rules = J('data/rules.json').rules.map(r => ({ id: r.id, title: r.title, severity: r.severity, log: r.log || r.template }));
out.ephemeris = { start: meta.startUtc, end: meta.endUtc, count: meta.count, step: meta.stepSec, adapter: meta.adapter };
const m0 = JSON.parse(fs.readFileSync(path.join(root, 'data/horizons/horizon_mons-mouton.json')));
out.terrain = { product: m0.dem.product, version: m0.dem.version, res: m0.dem.resolutionM, extentKm: m0.dem.extentKm, observer: m0.observerHeightM, nearField: m0.nearFieldM, method: m0.method };
out.engine = E.CODE_VERSION; out.metricsCatalogue = Object.fromEntries(Object.entries(E.METRICS).map(([k, v]) => [k, { label: v.label, unit: v.unit, q: v.q, method: v.method }]));
out.sweep = { sites: Object.keys(sw.sites).length, dates: sw.dates.length, stepDays: sw.stepDays, start: sw.startUtc, durationDays: sw.durationDays };
fs.writeFileSync(path.join(__dirname, 'facts.json'), JSON.stringify(out, null, 1));
for (const [k, s] of Object.entries(out.scenarios)) console.log(k, s.site, s.fmt, s.proofs.map(p => p.verdict + (p.subState ? '(' + p.subState + ')' : '')).join(' | '));
console.log('next good', out.nextGood && out.nextGood.date, out.nextGood && out.nextGood.extraDays, 'validation', out.validation.summary, 'horizons', out.validation.horizons.worst, 'bench sun', out.validation.bench.sun.all.medianAbs);
