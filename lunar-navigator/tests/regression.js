// Browser engine vs Python reference (precompute/validate.py -> tests/reference.json).
// Run: node tests/regression.js
const fs = require('fs');
const path = require('path');
const Engine = require('../src/engine.js');

const root = path.join(__dirname, '..');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'data/ephemeris.meta.json')));
const buf = fs.readFileSync(path.join(root, 'data/ephemeris.bin'));
const eph = Engine.loadEphemeris(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), meta);
const sites = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(root, 'data/sites.json'))).map(s => [s.id, s]));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference.json')));
const hw = { panelAreaM2: 2, efficiency: 0.28, losses: 0.1, panelType: 'vertical-tracking', panelAzDeg: 0, loadW: 150, batteryWh: 5000, dod: 0.8, minEarthElevDeg: 2 };

let worst = 0, fails = 0;
for (const r of ref) {
  const sc = r.scenario;
  const mp = path.join(root, `data/horizons/horizon_${sc.siteId}.json`);
  const mask = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp)).maskDeg : null;
  const { series, metrics } = Engine.simulate({ eph, site: sites[sc.siteId], mask, scenario: sc, hw });
  for (const smp of r.samples) {
    const k = smp.k;
    const daz = Math.abs(((series.sunAz[k] - smp.sunAz + 540) % 360) - 180);
    const d = Math.max(daz, Math.abs(series.sunEl[k] - smp.sunEl), Math.abs(series.earthEl[k] - smp.earthEl),
      Math.abs(((series.earthAz[k] - smp.earthAz + 540) % 360) - 180));
    worst = Math.max(worst, d);
    if (!!series.sunVis[k] !== smp.sunVisible || !!series.earthVis[k] !== smp.earthVisible) { fails++; console.log('visibility mismatch', sc.name, k); }
  }
  for (const key of ['sunlitPct', 'earthVisiblePct', 'longestDarkGapH', 'longestNoEarthGapH']) {
    if (Math.abs(metrics[key] - r.metrics[key]) > 1e-6) { fails++; console.log('metric mismatch', sc.name, key, metrics[key], r.metrics[key]); }
  }
  console.log(`${sc.name} ${sc.siteId}: sunlit ${metrics.sunlitPct.toFixed(1)}% earth ${metrics.earthVisiblePct.toFixed(1)}% (ref ${r.metrics.sunlitPct.toFixed(1)} / ${r.metrics.earthVisiblePct.toFixed(1)})`);
}
console.log(`worst angle difference ${worst.toExponential(2)} deg`);
if (worst > 1e-3 || fails) { console.log('FAIL'); process.exit(1); }
console.log('PASS');
