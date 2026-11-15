// Browser engine vs Python reference (precompute/validate.py -> tests/reference.json), plus unit checks
// of the classifier, the requirement checker's proof objects and the indicator store.
// Run: node tests/regression.js
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');

const root = path.join(__dirname, '..');
const J = p => JSON.parse(fs.readFileSync(path.join(root, p)));
const meta = J('data/ephemeris.meta.json');
const buf = fs.readFileSync(path.join(root, 'data/ephemeris.bin'));
const geometry = E.SpiceTableAdapter(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), meta);
const sites = Object.fromEntries(J('data/sites.json').map(s => [s.id, s]));
const config = J('data/config.json');
const reqs = J('data/requirements.json');
const ref = J('tests/reference.json');
const hw = { panelAreaM2: 2, efficiency: 0.28, losses: 0.1, panelType: 'vertical-tracking', panelAzDeg: 0, loadW: 150, batteryWh: 5000, dod: 0.8, initialSocPct: 100, minEarthElevDeg: 2, confirmed: false };
const terrainFor = id => { const p = path.join(root, `data/horizons/horizon_${id}.json`); return fs.existsSync(p) ? E.HorizonMaskAdapter(JSON.parse(fs.readFileSync(p))) : null; };

let worst = 0, fails = 0;
const fail = (...a) => { fails++; console.log('FAIL', ...a); };
for (const r of ref) {
  const sc = r.scenario;
  const run = E.simulate({ geometry, terrain: terrainFor(sc.siteId), site: sites[sc.siteId], scenario: sc, hw, config });
  const s = run.series;
  for (const smp of r.samples) {
    const k = smp.k, dAz = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
    worst = Math.max(worst, dAz(s.sunAz[k], smp.sunAz), dAz(s.earthAz[k], smp.earthAz), Math.abs(s.sunEl[k] - smp.sunEl), Math.abs(s.earthEl[k] - smp.earthEl));
    if (E.STATE_NAME[s.sunState[k]] !== smp.sunState || E.STATE_NAME[s.earthState[k]] !== smp.earthState) fail('state mismatch', sc.name, k);
  }
  for (const mode of ['conservative', 'optimistic']) for (const key of Object.keys(r.metrics[mode])) {
    const mine = key.endsWith('UncertainPct') ? run.metrics[key] : run.bounds[mode][key];
    if (Math.abs(mine - r.metrics[mode][key]) > 1e-6) fail('metric mismatch', sc.name, mode, key, mine, r.metrics[mode][key]);
  }
  // adapter interface: query() must agree with the series
  const q = geometry.query(sites[sc.siteId], Date.parse(sc.startUtc));
  if (Math.abs(q.sun.el - s.sunEl[0]) > 1e-12 || Math.abs(q.earth.az - s.earthAz[0]) > 1e-12) fail('adapter query mismatch', sc.name);
  console.log(`${sc.name} ${sc.siteId}: Sun visible ${run.metrics.sunlitPct.toFixed(1)}% (uncertain ${run.metrics.sunUncertainPct.toFixed(1)}%), Earth ${run.metrics.earthVisiblePct.toFixed(1)}% (uncertain ${run.metrics.earthUncertainPct.toFixed(1)}%)${run.geometryOnly ? ' [terrain unavailable: optimistic bound]' : ''}`);
}
console.log(`worst angle difference ${worst.toExponential(2)} deg`);
if (worst > 1e-9) fail('angle difference too large');

// classifier and equality handling
const t = config.toleranceDeg;
if (E.classify(1 + t + 1e-9, 1, t) !== E.VISIBLE || E.classify(1 + t, 1, t) !== E.UNCERTAIN || E.classify(1 - t, 1, t) !== E.UNCERTAIN || E.classify(1 - t - 1e-9, 1, t) !== E.OBSTRUCTED) fail('classify boundaries');

// proofs: demo scenarios
const demo = (siteId, startUtc) => E.simulate({ geometry, terrain: terrainFor(siteId), site: sites[siteId], scenario: { siteId, startUtc, durationDays: 10 }, hw, config });
const A = demo('mons-mouton', '2027-08-11T12:00:00Z'), B = demo('mons-mouton', '2027-09-01T12:00:00Z'), N = demo('shiv-shakti', '2027-08-11T12:00:00Z');
const proofs = run => Object.fromEntries(reqs.requirements.map(q => [q.id, E.checkRequirement(q, run, { marginPct: reqs.marginPct })]));
const pA = proofs(A), pB = proofs(B), pN = proofs(N);
if (pA['REQ-SUN'].verdict !== 'meets') fail('A REQ-SUN should meet', pA['REQ-SUN'].verdict);
if (pB['REQ-DARK'].verdict !== 'does not meet' || !pB['REQ-DARK'].observed.at) fail('B REQ-DARK should fail with timing');
if (pA['REQ-POWER'].verdict !== 'needs review' || pA['REQ-POWER'].subState !== 'default assumptions') fail('A REQ-POWER sub-state', pA['REQ-POWER'].subState);
if (N.geometryOnly !== true) fail('no-terrain run flag');
if ([...N.series.sunState].some(x => x === E.VISIBLE)) fail('no-terrain run has a visible sample');
if (pN['REQ-SUN'].verdict === 'meets') fail('no-terrain run must not meet a visibility requirement');
if (!pN['REQ-SUN'].reasons.includes('terrain')) fail('no-terrain sub-state', pN['REQ-SUN'].reasons);
for (const p of Object.values(pA)) if (!p.id || !p.steps.length || !p.evidence.length || !p.statement) fail('proof object incomplete', p.requirementId);

// indicator store
const store = E.createStore();
for (const id of Object.keys(E.METRICS)) store.put(E.indicatorRecord(A, id));
const rec = store.get(pA['REQ-SUN'].evidence[0]);
if (!rec || rec.metricId !== 'sunlitPct' || rec.classification !== 'computed-geometry' || !rec.sources.length || !rec.inputs.length || rec.location.frame !== 'MOON_ME') fail('indicator record lineage');
if (store.size() !== Object.keys(E.METRICS).length || !store.lineage(rec.id)) fail('store');
const sr = E.sampleRecord(A, 6, 'sun');
for (const k of ['scenario_id', 'timestamp', 'mission_elapsed_time_h', 'body', 'azimuth_deg', 'elevation_deg', 'terrain_horizon_elevation_deg', 'visibility_state', 'quality_state', 'method']) if (!(k in sr)) fail('sample record field', k);

// records and proofs carry every field their JSON Schema requires
const req = (schema, obj, what) => { for (const k of J('schemas/' + schema).required) if (!(k in obj)) fail(what + ' missing required field', k); };
for (const r of store.list()) req('indicator-record.schema.json', r, r.id);
for (const p of Object.values(pA).concat(Object.values(pB), Object.values(pN))) req('proof-object.schema.json', p, p.id);
req('sample-record.schema.json', sr, 'sample record');
req('adapter-descriptor.schema.json', geometry.describe(), 'geometry adapter');
req('adapter-descriptor.schema.json', terrainFor('mons-mouton').describe(), 'terrain adapter');

console.log(`proofs: A ${Object.values(pA).map(p => p.verdict + (p.subState ? ' (' + p.subState + ')' : '')).join(' | ')}`);
console.log(`proofs: B ${Object.values(pB).map(p => p.verdict + (p.subState ? ' (' + p.subState + ')' : '')).join(' | ')}`);
console.log(fails ? `${fails} FAILURES` : 'PASS');
process.exit(fails ? 1 : 0);
