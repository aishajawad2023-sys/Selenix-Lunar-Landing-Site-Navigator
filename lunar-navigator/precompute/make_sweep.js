// Precompute the date sweep as static JSON with the same engine the browser runs.
// Output: data/sweep.json. The app reads it directly, so opening the sweep or clicking a cell never
// waits on a computation. If the user changes duration or antenna elevation, the app says so and
// recomputes live instead.
// Run: node precompute/make_sweep.js
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const root = path.join(__dirname, '..');
const J = p => JSON.parse(fs.readFileSync(path.join(root, p)));
const meta = J('data/ephemeris.meta.json');
const buf = fs.readFileSync(path.join(root, 'data/ephemeris.bin'));
const geometry = E.SpiceTableAdapter(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), meta);
const config = J('data/config.json');
const hw = J('data/hardware.json').defaults;
const sw = config.sweep;
const sites = J('data/sites.json').filter(s => s.id !== 'south-pole');
const dates = [];
for (let k = 0; k < sw.count; k++) dates.push(new Date(Date.parse(sw.startUtc) + k * sw.stepDays * 86400000).toISOString().replace('.000', ''));
const out = { generator: 'precompute/make_sweep.js', engine: E.CODE_VERSION, generatedUtc: new Date().toISOString(), startUtc: sw.startUtc, stepDays: sw.stepDays, count: sw.count,
  durationDays: sw.durationDays, minEarthElevDeg: hw.minEarthElevDeg, toleranceDeg: config.toleranceDeg, stepMin: config.stepMin, dates, sites: {} };
for (const s of sites) {
  const p = path.join(root, `data/horizons/horizon_${s.id}.json`);
  const terrain = fs.existsSync(p) ? E.HorizonMaskAdapter(JSON.parse(fs.readFileSync(p))) : null;
  out.sites[s.id] = dates.map(d => {
    const r = E.simulate({ geometry, terrain, site: s, scenario: { siteId: s.id, startUtc: d, durationDays: sw.durationDays }, hw, config });
    const m = r.metrics, r1 = x => Math.round(x * 10) / 10;
    return { sun: r1(m.sunlitPct), sunU: r1(m.sunUncertainPct), earth: r1(m.earthVisiblePct), earthU: r1(m.earthUncertainPct), dark: r1(m.longestDarkGapH), noEarth: r1(m.longestNoEarthGapH) };
  });
}
fs.writeFileSync(path.join(root, 'data/sweep.json'), JSON.stringify(out));
console.log(`sweep: ${sites.length} sites x ${dates.length} dates -> data/sweep.json (${(fs.statSync(path.join(root, 'data/sweep.json')).size / 1024).toFixed(0)} kB)`);
