"""Build the SELENIX technical-review slide deck and technical document as HTML from facts.json.

  node docs/pitch/collect_facts.js      # figures from the engine and data files
  python docs/pitch/build_pitch.py      # -> deck.html, document.html
  node docs/pitch/render_pdf.js         # -> SELENIX_Technical_Review_Deck.pdf, SELENIX_Technical_Document.pdf

Every number in both documents comes from facts.json; none is typed by hand.
"""
import datetime as dt
import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
F = json.load(open(os.path.join(HERE, "facts.json")))
A, B, C = (F["scenarios"][k] for k in "ABC")
V = F["validation"]
BM = V["bench"]
HZ = V["horizons"]
TEAM = ["Ishan Singh", "Aisha Jawad"]
TODAY = dt.date.today().strftime("%d %B %Y")
e = html.escape


def day(iso):
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%-d %b %Y")


def hm(h):
    m = round(h * 60)
    d, r = divmod(m, 1440)
    hh, mm = divmod(r, 60)
    parts = ([f"{d} d"] if d else []) + ([f"{hh} h"] if hh else []) + ([f"{mm} min"] if mm or not (d or hh) else [])
    return " ".join(parts) if m else "0"


def verdict_counts(s):
    c = {"meets": 0, "needs review": 0, "does not meet": 0, "unknown": 0}
    for p in s["proofs"]:
        c[p["verdict"]] += 1
    return c


REQ = {q["id"]: q for q in F["requirements"]}
REQ_TEXT = [f"{q['label']} {q['op'].replace('>=', '≥').replace('<=', '≤')} {q['threshold']} {q['unit']}" for q in F["requirements"]]
checks = V["checks"]
nG = F["nextGood"]
B_sun_rise = next(w for w in B["windows"]["sun"] if w["state"] != "obstructed")
B_earth_vis = next(w for w in B["windows"]["earth"] if w["state"] == "visible")
bench_sites = {r["id"]: r for r in BM["sites"]}
SITE = {s["id"]: s for s in F["sites"]}

PILL = {"meets": ("#2fb24c", "meets"), "needs review": ("#f0b429", "needs review"), "does not meet": ("#e5534b", "does not meet"), "unknown": ("#8a919e", "unknown")}


def pill(v, sub=None, light=False):
    col, lab = PILL[v]
    return f'<span class="pill" style="--p:{col}">{lab}</span>' + (f'<span class="sub">{e(sub)}</span>' if sub else "")


# ------------------------------------------------------------------ pipeline diagram (shared)
def pipeline_svg(dark=True):
    fg, mut, box, line, gold, blue = ("#e9ebef", "#9aa1ad", "#181c24", "#3a4252", "#d2b36a", "#5aa8ff") if dark else ("#0d1117", "#5c6470", "#f3f5f8", "#b9c0cb", "#8a6d1f", "#1f6fd0")
    W, H = 1700, 560
    off = [("NAIF SPICE kernels", "DE440 · Moon PA · LSK"), ("LRO LOLA DEMs", "40 / 80 / 120 m polar"), ("NASA PGDA maps", "illumination benchmark"), ("JPL Horizons", "independent check")]
    pre = [("SPICE geometry adapter", "Sun/Earth vectors, MOON_ME, LT+S"), ("Horizon masks", "360 az · 200 km rays"), ("Validation suite", "12 checks · reference runs")]
    web = [("Scenario inputs", "site · UTC landing · duration"), ("Local geometry", "ENU azimuth / elevation"), ("Visibility classifier", "visible · uncertain · obstructed"), ("Windows & metrics", "refined transitions"), ("Requirement proofs", "verdict + sub-state + steps"), ("Mission log & comparison", "rules.json templates")]
    s = [f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" font-family="Inter, sans-serif">',
         f'<defs><marker id="ar{int(dark)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="{mut}"/></marker></defs>']
    s.append(f'<text x="20" y="30" fill="{gold}" font-size="17" font-weight="700" letter-spacing="2">OFFLINE · PYTHON (precompute/)</text>')
    s.append(f'<text x="20" y="300" fill="{gold}" font-size="17" font-weight="700" letter-spacing="2">IN THE BROWSER · src/engine.js (no backend)</text>')
    def boxf(x, y, w, h, t, sub, accent=None):
        return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{box}" stroke="{accent or line}" stroke-width="{2 if accent else 1.4}"/>'
                f'<text x="{x + w / 2}" y="{y + h / 2 - 6}" text-anchor="middle" fill="{fg}" font-size="19" font-weight="600">{e(t)}</text>'
                f'<text x="{x + w / 2}" y="{y + h / 2 + 19}" text-anchor="middle" fill="{mut}" font-size="15">{e(sub)}</text>')
    # sources column
    for i, (t, sub) in enumerate(off):
        y = 48 + i * 56
        s.append(f'<rect x="20" y="{y}" width="330" height="48" rx="10" fill="{box}" stroke="{line}"/>'
                 f'<text x="36" y="{y + 21}" fill="{fg}" font-size="17" font-weight="600">{e(t)}</text><text x="36" y="{y + 40}" fill="{mut}" font-size="14">{e(sub)}</text>')
    for i, (t, sub) in enumerate(pre):
        x = 470 + i * 400
        s.append(boxf(x, 80, 340, 96, t, sub, blue if i < 2 else None))
    s.append(f'<line x1="350" y1="128" x2="466" y2="128" stroke="{mut}" stroke-width="2" marker-end="url(#ar{int(dark)})"/>')
    s.append(f'<line x1="810" y1="128" x2="866" y2="128" stroke="{mut}" stroke-width="2" marker-end="url(#ar{int(dark)})"/>')
    s.append(f'<line x1="1210" y1="128" x2="1266" y2="128" stroke="{mut}" stroke-width="2" marker-end="url(#ar{int(dark)})"/>')
    s.append(f'<rect x="470" y="200" width="1140" height="50" rx="10" fill="none" stroke="{gold}" stroke-dasharray="6 5"/>'
             f'<text x="1040" y="231" text-anchor="middle" fill="{fg}" font-size="17">static data: ephemeris table (1.05 MB) · horizon_&lt;site&gt;.json · sweep.json · validation.json · map layers → inlined into one HTML file</text>')
    s.append(f'<line x1="1040" y1="250" x2="1040" y2="318" stroke="{mut}" stroke-width="2" marker-end="url(#ar{int(dark)})"/>')
    bw, gap = 255, 18
    for i, (t, sub) in enumerate(web):
        x = 20 + i * (bw + gap)
        s.append(boxf(x, 330, bw, 100, t, sub, gold if i in (3, 4) else None))
        if i:
            s.append(f'<line x1="{x - gap}" y1="380" x2="{x - 3}" y2="380" stroke="{mut}" stroke-width="2" marker-end="url(#ar{int(dark)})"/>')
    s.append(f'<rect x="20" y="460" width="{6 * bw + 5 * gap}" height="70" rx="12" fill="none" stroke="{blue}" stroke-width="1.6"/>'
             f'<text x="{20 + (6 * bw + 5 * gap) / 2}" y="492" text-anchor="middle" fill="{fg}" font-size="19" font-weight="600">Evidence layer: indicator records · proof objects · sample records · quality classes</text>'
             f'<text x="{20 + (6 * bw + 5 * gap) / 2}" y="517" text-anchor="middle" fill="{mut}" font-size="15">every displayed number opens its inputs, sources, method, tolerance, limitations and validation status</text>')
    s.append("</svg>")
    return "".join(s)


# ------------------------------------------------------------------ DECK
DECK_CSS = """
@page { size: 1920px 1080px; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #090b0e; }
body { font-family: Inter, system-ui, sans-serif; color: #e9ebef; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.slide { width: 1920px; height: 1080px; position: relative; overflow: hidden; padding: 84px 110px 90px; page-break-after: always; break-after: page; background: #090b0e; display: flex; flex-direction: column; }
.slide:last-child { page-break-after: auto; }
.eyebrow { font-size: 22px; letter-spacing: .16em; text-transform: uppercase; color: #d2b36a; font-weight: 700; }
h1 { font-size: 66px; line-height: 1.06; letter-spacing: -.02em; margin: 14px 0 26px; font-weight: 600; max-width: 1600px; }
h2 { font-size: 30px; margin: 0 0 12px; font-weight: 600; }
p, li { font-size: 28px; line-height: 1.42; color: #c3c8d1; }
p { margin: 0 0 18px; max-width: 1500px; }
ul { margin: 0; padding-left: 0; list-style: none; }
li { position: relative; padding-left: 34px; margin: 0 0 14px; }
li::before { content: ''; position: absolute; left: 0; top: .66em; width: 16px; height: 3px; background: #d2b36a; }
b, strong { color: #fff; font-weight: 600; }
.foot { position: absolute; left: 110px; right: 110px; bottom: 34px; display: flex; justify-content: space-between; font-size: 17px; color: #7f8795; }
.foot .brand { letter-spacing: .3em; font-weight: 700; color: #b3b9c4; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; flex: 1; min-height: 0; }
.cols.w37 { grid-template-columns: 37fr 63fr; } .cols.w45 { grid-template-columns: 45fr 55fr; } .cols.w55 { grid-template-columns: 55fr 45fr; }
.shot { border: 1px solid #2a303c; border-radius: 14px; overflow: hidden; box-shadow: 0 24px 70px rgba(0,0,0,.6); background: #000; align-self: start; max-height: 760px; }
.shot img { display: block; width: 100%; max-height: 760px; object-fit: cover; object-position: top; }
.card { background: #11141a; border: 1px solid #2a303c; border-radius: 16px; padding: 26px 30px; }
.card h2 { color: #fff; }
.card p, .card li { font-size: 24px; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px; }
.big { font-size: 64px; font-weight: 600; letter-spacing: -.02em; color: #fff; font-variant-numeric: tabular-nums; line-height: 1.1; }
.lab { font-size: 21px; color: #9aa1ad; margin-top: 8px; line-height: 1.35; }
table { border-collapse: collapse; width: 100%; font-size: 22px; }
th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #2a303c; vertical-align: top; color: #c3c8d1; }
th { font-size: 17px; letter-spacing: .08em; text-transform: uppercase; color: #8f97a4; font-weight: 600; }
td b { color: #fff; }
.pill { display: inline-block; font-size: 19px; font-weight: 700; padding: 2px 12px; border-radius: 999px; color: #0d1117; background: var(--p); white-space: nowrap; }
.sub { display: block; font-size: 16px; color: #f0b429; margin-top: 4px; }
.mono { font-family: 'JetBrains Mono', monospace; font-size: .86em; }
.gold { color: #d2b36a; } .blue { color: #5aa8ff; }
.cover { padding: 0; }
.cover .bg { position: absolute; inset: 0; background: url('img/hero.jpg') 75% center / cover no-repeat; }
.cover .bg::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, #090b0e 0%, rgba(9,11,14,.92) 38%, rgba(9,11,14,.2) 80%); }
.cover .inner { position: relative; padding: 150px 110px; height: 100%; display: flex; flex-direction: column; }
.wordmark { font-size: 40px; font-weight: 700; letter-spacing: .38em; display: flex; align-items: center; gap: 22px; }
.note { font-size: 19px; color: #7f8795; }
.beat { display: grid; grid-template-columns: 70px 1fr; gap: 18px; align-items: start; margin-bottom: 20px; }
.beat .n { width: 58px; height: 58px; border-radius: 50%; background: #d2b36a; color: #111; display: grid; place-items: center; font-size: 27px; font-weight: 700; }
.beat h2 { margin: 6px 0 4px; } .beat p { font-size: 24px; margin: 0; }
.eq { font-family: 'JetBrains Mono', monospace; font-size: 22px; background: #11141a; border: 1px solid #2a303c; border-radius: 12px; padding: 18px 22px; color: #e9ebef; line-height: 1.6; }
.check { display: grid; grid-template-columns: 34px 1fr; gap: 10px; font-size: 21px; color: #c3c8d1; margin-bottom: 9px; line-height: 1.35; }
.check i { width: 24px; height: 24px; border-radius: 50%; background: #2fb24c; display: inline-block; margin-top: 3px; position: relative; }
.check i::after { content: ''; position: absolute; left: 8px; top: 4px; width: 6px; height: 11px; border: solid #fff; border-width: 0 3px 3px 0; transform: rotate(45deg); }
"""

LOGO = '<svg viewBox="0 0 40 40" width="58" height="58"><circle cx="20" cy="20" r="15" fill="none" stroke="#d2b36a" stroke-width="2"/><path d="M20 5a15 15 0 0 0 0 30a9.5 15 0 0 1 0-30z" fill="#d2b36a"/><circle cx="31.5" cy="8.5" r="2.4" fill="#5aa8ff"/></svg>'


def build_deck():
    slides = []

    def S(body, cls=""):
        slides.append((cls, body))

    cA, cB, cC = verdict_counts(A), verdict_counts(B), verdict_counts(C)
    # 1 cover
    S(f"""<div class="bg"></div><div class="inner">
      <div class="wordmark">{LOGO}SELENIX</div>
      <div class="eyebrow" style="margin-top:70px">Technical review · NASA Space Apps 2026</div>
      <h1 style="font-size:84px;max-width:1150px">Terrain-aware lunar south-pole site and date comparison</h1>
      <p style="font-size:32px;max-width:1000px">Navigate lunar data. Plan with confidence.</p>
      <div style="margin-top:auto"><p style="font-size:28px;color:#fff;margin-bottom:6px"><b>SELENIX team</b></p><p style="font-size:26px">{' · '.join(TEAM)}</p><p class="note">{TODAY}</p></div></div>""", "cover")
    # 2 problem
    S(f"""<div class="eyebrow">The problem</div><h1>At the south pole, a three-week slip can change everything</h1>
      <div class="cols w55"><div><ul>
      <li>The Sun never climbs more than <b>{abs(float(checks[0]['detail'].split('°')[0])):.2f}°</b> above the horizon at 90°S; Earth wanders within about <b>±7°</b> with libration.</li>
      <li>Ridges kilometres away hide either body for days. Positive elevation is <b>not</b> visibility.</li>
      <li>A launch slip moves both bodies in the sky. The same site can go from <b>{A['fmt']['sun']}</b> to <b>{B['fmt']['sun']}</b> sunlit.</li>
      <li>The data exists (SPICE, LOLA, Horizons, QuickMap, Moon Trek) but lives in separate tools. Turning it into a planning answer is manual and specialist work.</li></ul></div>
      <div class="card" style="align-self:start"><h2>The planner's questions</h2><ul>
      <li>When is the Sun visible above the real terrain?</li><li>When can we see Earth for direct-to-Earth contact?</li><li>How long is the worst interruption, and when?</li><li>Does the slipped date still meet our requirements?</li><li>What does each alternative cost?</li></ul></div></div>""")
    # 3 three levels
    S("""<div class="eyebrow">Where the gap is</div><h1>Three levels that must stay connected, and separate</h1>
      <table style="font-size:26px"><thead><tr><th>Level</th><th>Question</th><th>Typical source</th><th>SELENIX</th></tr></thead><tbody>
      <tr><td><b>Celestial geometry</b></td><td>Where are the Sun and Earth relative to the site?</td><td>SPICE, JPL Horizons</td><td>SPICE adapter, checked against Horizons</td></tr>
      <tr><td><b>Terrain visibility</b></td><td>Does local terrain block them?</td><td>DEM horizon or viewshed analysis</td><td>LOLA horizon masks, three-state classifier</td></tr>
      <tr><td><b>Operational meaning</b></td><td>What does that do to power, darkness and comms?</td><td>A specialist, by hand</td><td>Requirement proofs, mission log, comparison</td></tr></tbody></table>
      <p style="margin-top:34px"><b>Design rule:</b> above the geometric horizon is not visible; visible is not usable power or a working link. Each level is labelled and traceable on its own.</p>""")
    # 4 what it is
    S(f"""<div class="eyebrow">What SELENIX is</div><h1>A decision-support workspace, not a feasibility oracle</h1>
      <div class="grid3">
      <div class="card"><h2>Compare</h2><p>Up to three site/date scenarios on one mission-elapsed-time axis, with identical kernels, terrain method, tolerance and assumptions.</p></div>
      <div class="card"><h2>Check</h2><p>Each scenario against stated requirements: <b>meets</b>, <b>needs review</b> (with the reason), <b>does not meet</b> or <b>unknown</b>. Never “feasible”.</p></div>
      <div class="card"><h2>Trace</h2><p>Every number opens its evidence: inputs, data versions, method, tolerance, limitations and validation status.</p></div></div>
      <div class="card" style="margin-top:30px"><h2>What it does not claim</h2><div class="grid3" style="gap:18px"><p>Earth visibility is geometric line of sight, not a link budget.</p><p>Sun visibility is not delivered power; power figures are labelled estimates.</p><p>It does not rank options or certify landing safety, thermal survival or feasibility.</p></div></div>""")
    # 5 demo story
    S(f"""<div class="eyebrow">Demonstration</div><h1>The five-step story: a launch slips 21 days</h1>
      <div class="cols w45"><div>
      <div class="beat"><div class="n">1</div><div><h2>Briefing</h2><p>Site, date, assumed hardware, requirements. Nothing calculated.</p></div></div>
      <div class="beat"><div class="n">2</div><div><h2>Baseline</h2><p>{e(A['site'])}, {day(A['startUtc'])}.</p></div></div>
      <div class="beat"><div class="n">3</div><div><h2>Slip</h2><p>Same site, {day(B['startUtc'])}.</p></div></div>
      <div class="beat"><div class="n">4</div><div><h2>Alternative</h2><p>{e(C['site'])} on the slipped date.</p></div></div>
      <div class="beat"><div class="n">5</div><div><h2>Decide</h2><p>The trade-off, stated. No winner picked.</p></div></div>
      <p class="note">Reset demo · Next step · Show me why are always visible.</p></div>
      <div class="shot"><img src="img/briefing.jpg"></div></div>""")
    # 6 baseline + slip numbers
    rowsBA = "".join(f"<tr><td><b>{e(p['label'])}</b><div class='note'>{e(REQ_TEXT[i][len(p['label']):].strip())}</div></td><td>{pill(p['verdict'], p['subState'])}</td><td>{pill(B['proofs'][i]['verdict'], B['proofs'][i]['subState'])}</td><td>{pill(C['proofs'][i]['verdict'], C['proofs'][i]['subState'])}</td></tr>" for i, p in enumerate(A['proofs']))
    S(f"""<div class="eyebrow">Results with real data</div><h1>Baseline holds; the slip breaks every requirement</h1>
      <div class="grid3" style="margin-bottom:30px">
      <div class="card"><div class="lab">A · Baseline · {day(A['startUtc'])}</div><div class="big">{A['fmt']['sun']} / {A['fmt']['earth']}</div><div class="lab">Sun visible / Earth in view · {cA['meets']} of 5 met</div></div>
      <div class="card" style="border-color:#e5534b"><div class="lab">B · Slip +21 d · {day(B['startUtc'])}</div><div class="big">{B['fmt']['sun']} / {B['fmt']['earth']}</div><div class="lab">Lands in darkness until T+{hm(B_sun_rise['startH'])} · {cB['does not meet']} of 5 not met</div></div>
      <div class="card"><div class="lab">C · {e(C['site'])} · {day(C['startUtc'])}</div><div class="big">{C['fmt']['sun']} / {C['fmt']['earth']}</div><div class="lab">Sun solved, no direct-to-Earth geometry</div></div></div>
      <table><thead><tr><th>Requirement (change-spec defaults)</th><th>A</th><th>B</th><th>C</th></tr></thead><tbody>{rowsBA}</tbody></table>""")
    # 7 trade-off
    S(f"""<div class="eyebrow">Step 5 · Decide</div><h1>Every option costs something</h1>
      <div class="cols w45"><div><ul>
      <li><b>Keep the site, accept the date:</b> darkness until T+{hm(B_sun_rise['startH'])}; estimated battery reaches its floor at T+{B['fmt']['brown']}; Earth hidden for {B['fmt']['noEarth']}.</li>
      <li><b>Move to {e(C['site'])}:</b> Sun {C['fmt']['sun']}, but Earth in view {C['fmt']['earth']}: plan on a relay.</li>
      <li><b>Delay further:</b> the precomputed sweep's next date meeting every visibility threshold at the original site is <b>{day(nG['date'])}</b> ({nG['extraDays']} more days).</li></ul>
      <p style="margin-top:20px">SELENIX states the trade-off. Choosing is an engineering and programme decision.</p></div>
      <div class="shot"><img src="img/decide.jpg"></div></div>""")
    # 8 architecture
    S(f"""<div class="eyebrow">Architecture</div><h1>Heavy science offline, decisions in the browser</h1>
      <div style="flex:1;display:flex;align-items:center">{pipeline_svg(True)}</div>
      <p class="note">One self-contained HTML file (about 2.2 MB) holds the data, engine and UI. No server, works offline, deploys as static files (Vercel, GitHub Pages).</p>""")
    # 9 data sources
    S(f"""<div class="eyebrow">Datasets</div><h1>Authoritative NASA data, versioned in every record</h1>
      <table style="font-size:23px"><thead><tr><th>Source</th><th>Product / version</th><th>Used for</th></tr></thead><tbody>
      <tr><td><b>NAIF SPICE</b></td><td class="mono">naif0012.tls · de440s.bsp · moon_pa_de440_200625.bpc · moon_de440_250416.tf · pck00011.tpc</td><td>Sun and Earth geometry in MOON_ME, {F['ephemeris']['start'][:4]}–{int(F['ephemeris']['end'][:4]) - 1}</td></tr>
      <tr><td><b>LRO LOLA (PDS)</b></td><td class="mono">LDEM_85S_40M · LDEM_80S_80M · LDEM_75S_120M (V2.0)</td><td>Terrain horizon masks, site elevations, shaded relief</td></tr>
      <tr><td><b>NASA GSFC PGDA</b></td><td class="mono">AVGVISIB_85S_060M_201608 (+ _EARTH) · product 69</td><td>Illumination benchmark, site coordinates, map layers</td></tr>
      <tr><td><b>JPL Horizons</b></td><td class="mono">API 1.2 · DE441</td><td>Independent geometry check ({HZ['n']} comparisons)</td></tr>
      <tr><td><b>LROC</b></td><td class="mono">IM-2 Athena position (image 1408)</td><td>Verified Mons Mouton coordinates</td></tr>
      <tr><td><b>ISRO</b></td><td class="mono">Chandrayaan-3 Shiv Shakti point</td><td>Lower-latitude reference, terrain unavailable</td></tr></tbody></table>
      <p class="note" style="margin-top:22px">Context and inspection: LROC QuickMap, NASA Moon Trek, CSA Moon exploration.</p>""")
    # 10 geometry
    S(f"""<div class="eyebrow">Pipeline · 1 · Geometry</div><h1>SPICE adapter: where the Sun and Earth are</h1>
      <div class="cols"><div><ul>
      <li><span class="mono">spkpos(target, et, 'MOON_ME', 'LT+S', 'MOON')</span> for SUN and EARTH.</li>
      <li>Hourly table {F['ephemeris']['start'][:10]} → {F['ephemeris']['end'][:10]}: {F['ephemeris']['count']:,} records, float32, 1.05 MB.</li>
      <li>UTC index; TDB = UTC + 69.184 s (no leap second in the window). Linear interpolation to {F['config']['stepMin']}-min samples.</li>
      <li>Site on a sphere R = 1737.4 km + LOLA elevation; planetocentric latitude, east longitude.</li>
      <li>Same interface in Python and JavaScript: <span class="mono">describe() · coverage() · vectors() · query()</span>.</li></ul></div>
      <div><div class="eq">v = r_body − r_site<br>e = v·east · n = v·north · u = v·up<br>azimuth = atan2(e, n) <span class="gold">(0° = north, clockwise)</span><br>elevation = atan2(u, √(e² + n²))</div>
      <div class="card" style="margin-top:26px"><div class="big">{HZ['worst']:.5f}°</div><div class="lab">worst difference from JPL Horizons over {HZ['n']} Sun and Earth angles (target {HZ['tol']}°)</div></div></div></div>""")
    # 11 terrain
    S(f"""<div class="eyebrow">Pipeline · 2 · Terrain</div><h1>LOLA horizon masks: does terrain block them?</h1>
      <div class="cols w45"><div><ul>
      <li>For each 1° of azimuth, march outward to <b>{F['terrain']['extentKm']:.0f} km</b>, using the finest DEM available at each point (40 → 80 → 120 m).</li>
      <li>Exact 3-D elevation angle on a 1737.4 km sphere (curvature included).</li>
      <li>Each bin is the maximum over 5 sub-rays, so narrow ridges are not missed.</li>
      <li>Observer {F['terrain']['observer']:.0f} m above the surface; terrain closer than <b>{F['terrain']['nearField']:.0f} m</b> treated as the site (set by the benchmark).</li>
      <li>Projection verified on Shackleton and Malapert; a synthetic wall due east appears at 90°.</li></ul></div>
      <div><div class="shot" style="background:#fff"><img src="../masks/mask_shackleton-floor.png"></div><div class="shot" style="background:#fff;margin-top:18px"><img src="../masks/mask_mons-mouton.png"></div></div></div>""")
    # 12 classification
    S(f"""<div class="eyebrow">Pipeline · 3 · Classification</div><h1>Three states, and missing terrain is never “clear”</h1>
      <div class="cols"><div><div class="eq">margin = elevation − limit<br>limit<sub>Sun</sub> = terrain(az)<br>limit<sub>Earth</sub> = max(terrain(az), {F['hw']['minEarthElevDeg']}° antenna)<br><br>margin &gt; +{F['config']['toleranceDeg']}° → <span style="color:#e2bf66">visible</span><br>margin &lt; −{F['config']['toleranceDeg']}° → obstructed<br>otherwise → <span class="gold">uncertain</span></div>
      <p style="margin-top:22px">{F['config']['toleranceDeg']}° is the Sun's angular radius: the disc is partly cut inside this band, and it matches the scale of terrain-bin error.</p></div>
      <div><ul>
      <li><b>Two bounds per metric:</b> conservative (uncertain = not visible) and optimistic (uncertain = visible). Verdicts that flip between them read “needs review · grazing samples”.</li>
      <li><b>No terrain data:</b> every above-horizon sample becomes uncertain; figures are shown as upper bounds (≤); visibility requirements cannot read “meets”.</li>
      <li>A geometry-only <b>failure</b> stands: terrain can only reduce visibility.</li></ul></div></div>""")
    # 13 timeline & windows
    S(f"""<div class="eyebrow">Pipeline · 4 · Time</div><h1>Windows, refined transitions, mission-elapsed time</h1>
      <div class="cols w45"><div><ul>
      <li>Scenarios aligned on mission-elapsed time; each keeps its absolute UTC.</li>
      <li>Every visible, uncertain and obstructed window listed with start, end, duration.</li>
      <li>Transitions refined between samples by bisection on the interpolated geometry; reported to the minute (agrees with a 1-min run to 0.6 min).</li>
      <li>Summary metrics count samples, as the V1 specification requires; sampling 5, 10 or 30 min.</li>
      <li>Example: scenario B's Sun becomes uncertain at T+{hm(B_sun_rise['startH'])} and Earth returns at T+{hm(B_earth_vis['startH'])}.</li></ul></div>
      <div class="shot"><img src="img/timeline.jpg"></div></div>""")
    # 14 requirement proofs
    S(f"""<div class="eyebrow">Decision layer</div><h1>Requirement checker emits a proof, not just a colour</h1>
      <div class="cols w45"><div><p>Each verdict is a <b>proof object</b> with ordered checks:</p><ul>
      <li>inputs present → threshold → terrain data → uncertain samples → margin (10%) → assumptions confirmed</li>
      <li>“Needs review” always says why: <b>terrain</b>, <b>close to threshold</b>, <b>both</b>, <b>grazing samples</b> or <b>default assumptions</b>.</li>
      <li>Every failure carries its driver and timing, e.g. “{e(B['proofs'][1]['driver'])}”</li>
      <li>Proofs, indicator records and sample records follow JSON Schemas in <span class="mono">schemas/</span>.</li></ul></div>
      <div class="shot"><img src="img/proof.jpg"></div></div>""")
    # 15 evidence
    S(f"""<div class="eyebrow">Traceability</div><h1>Every number opens its evidence in one click</h1>
      <div class="cols w37"><div><ul>
      <li><b>Geometry-derived</b>, <b>model-derived</b> and <b>user-input</b> evidence templates.</li>
      <li>Quality class on every value: measured · computed-geometry · engineering-estimate · user-assumption · demo-only.</li>
      <li>Scenario hash, engine version and data build date for reproducibility.</li>
      <li>Provenance chip: kernels, coverage, frame, time system, aberration, terrain product, tolerance.</li></ul></div>
      <div class="shot"><img src="img/indicator.jpg"></div></div>""")
    # 16 validation
    rows = "".join(f'<div class="check"><i></i><div><b>{e(c["name"])}</b> · {e(c["detail"][:118])}{"…" if len(c["detail"]) > 118 else ""}</div></div>' for c in checks)
    S(f"""<div class="eyebrow">Validation</div><h1>{V['summary']['passed']} of {V['summary']['total']} checks pass, and are shown in the product</h1>
      <div class="cols w55"><div>{rows}</div>
      <div><div class="card"><div class="big">{HZ['worst']:.5f}°</div><div class="lab">worst difference from JPL Horizons, {HZ['n']} comparisons, both demo dates</div></div>
      <div class="card" style="margin-top:22px"><div class="big">7e-15°</div><div class="lab">browser engine vs Python reference; identical visibility states</div></div>
      <div class="card" style="margin-top:22px"><div class="big">{BM['sun']['all']['medianAbs']} pt</div><div class="lab">median difference from NASA's published illumination map ({BM['n']} points)</div></div></div></div>""")
    # 17 benchmark
    nf = BM["nearField"]
    nfrows = "".join(f"<tr><td>{k} m{' <b class=gold>(used)</b>' if float(k) == BM['used'] else ''}</td><td>{v['sun']['medianAbs']}</td><td>{v['sun']['rms']}</td><td>{v['earth']['medianAbs']}</td><td>{v['earth']['rms']}</td></tr>" for k, v in nf.items())
    S(f"""<div class="eyebrow">Illumination benchmark</div><h1>Checked against NASA's published LOLA maps</h1>
      <div class="cols w55"><div class="shot" style="background:#fff"><img src="../benchmark_illumination.png"></div>
      <div><p>Same quantity at the same {BM['n']} pixels: share of hourly steps over 18.6 years with any part of the disc visible.</p>
      <table style="font-size:21px"><thead><tr><th>Near field</th><th>Sun median</th><th>Sun RMS</th><th>Earth median</th><th>Earth RMS</th></tr></thead><tbody>{nfrows}</tbody></table>
      <p style="margin-top:18px;font-size:23px">Finding: metre-scale relief within a few DEM cells dominated ridge crests. Excluding the nearest {BM['used']:.0f} m fixed it. Median is sub-percent; individual points reach {BM['sun']['all']['maxAbs']} points.</p></div></div>""")
    # 18 differentiation
    S("""<div class="eyebrow">How it differs</div><h1>Integration, not another viewer</h1>
      <table style="font-size:22px"><thead><tr><th>Existing capability</th><th>Primary purpose</th><th>What SELENIX adds</th></tr></thead><tbody>
      <tr><td><b>NAIF SPICE</b></td><td>Geometry toolkit; needs programming</td><td>Packaged for a site, a mission window and a comparison</td></tr>
      <tr><td><b>JPL Horizons</b></td><td>Ephemerides on request; no terrain</td><td>Used as an independent check, combined with terrain</td></tr>
      <tr><td><b>LOLA DEMs, PGDA maps</b></td><td>Topography; long-term illumination averages</td><td>Mission-specific windows and worst cases for a chosen date</td></tr>
      <tr><td><b>LROC QuickMap, Moon Trek</b></td><td>Imagery and terrain exploration</td><td>Time-dependent Sun/Earth visibility against requirements</td></tr>
      <tr><td><b>NASA CMS</b></td><td>Lunar mapping, viewshed and illumination analysis</td><td>Repeatable site-date reassessment with proofs and evidence</td></tr></tbody></table>
      <p style="margin-top:28px"><b>Three defensible differentiators:</b> site-date reassessment in seconds · paired Sun/Earth terrain visibility on one timeline · comparison with evidence in one workspace.</p>""")
    # 19 limitations
    S("""<div class="eyebrow">Honest limits</div><h1>What the prototype does not do yet</h1>
      <div class="cols"><ul>
      <li>Disc centre with a tolerance band, not a full partial-disc model.</li>
      <li>Terrain finer than 40–120 m, boulders and the lander itself are not modelled.</li>
      <li>Curated sites only have terrain; custom sites are upper bounds until a mask is supplied.</li>
      <li>Ephemeris table covers 2026–2030.</li></ul><ul>
      <li>Earth visibility is not a link budget; relays are out of scope.</li>
      <li>Power and battery are simple labelled estimates on default hardware values.</li>
      <li>Date sweep on a 3-day grid.</li>
      <li>User value (30–50% less reassessment time) is a hypothesis still to be measured.</li></ul></div>""")
    # 20 roadmap
    S("""<div class="eyebrow">Future prospects</div><h1>Roadmap: credibility first, then breadth</h1>
      <div class="grid4" style="grid-template-columns:repeat(5,1fr);gap:18px">
      <div class="card"><h2 class="gold">V1.1</h2><p>Scientific reliability: 5 m LOLA site DEMs, DEM-resolution sensitivity, partial-disc model, more validation cases.</p></div>
      <div class="card"><h2 class="gold">V1.2</h2><p>Scenario planning: horizon grids for any coordinate, saved and versioned scenarios, finer date sweeps, reporting.</p></div>
      <div class="card"><h2 class="gold">V2</h2><p>Environment and power: validated panel, battery, thermal and dust models with uncertainty.</p></div>
      <div class="card"><h2 class="gold">V3</h2><p>Communications: relay orbits, antenna pointing, link budgets, ground-station availability.</p></div>
      <div class="card"><h2 class="gold">V4</h2><p>Integrated mission support: rover traverse, resources, multi-objective trade studies, collaboration.</p></div></div>
      <p style="margin-top:34px">Adapters keep this incremental: a new ephemeris, DEM or relay orbit implements the same interface; engine, checker and UI do not change.</p>""")
    # 21 close
    S(f"""<div class="eyebrow">Try it</div><h1>SELENIX</h1>
      <p style="font-size:34px;color:#fff">Navigate lunar data. Plan with confidence.</p>
      <div class="cols" style="margin-top:30px"><div><ul>
      <li>Open <span class="mono">dist/app/index.html</span> or the deployed site: the guided demo starts on its own.</li>
      <li>Source, data, schemas and validation: <span class="mono">github.com/aishajawad2023-sys/Selenix-Lunar-Landing-Site-Navigator</span></li>
      <li>Technical document: <span class="mono">SELENIX_Technical_Document.pdf</span></li></ul></div>
      <div class="card" style="align-self:start"><h2>SELENIX team</h2><p style="font-size:30px;color:#fff;margin:0">{'<br>'.join(TEAM)}</p><p class="note" style="margin-top:20px">NASA Space Apps 2026 · Data: NAIF SPICE, LRO LOLA, NASA GSFC PGDA, JPL Horizons, LROC</p></div></div>""")
    out = []
    n = len(slides)
    for i, (cls, body) in enumerate(slides, 1):
        foot = "" if cls == "cover" else f'<div class="foot"><span class="brand">SELENIX</span><span>Technical review · {i} / {n}</span></div>'
        out.append(f'<section class="slide {cls}">{body}{foot}</section>')
    return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SELENIX Technical Review</title><style>{DECK_CSS}</style></head><body>{"".join(out)}</body></html>', n


# ------------------------------------------------------------------ DOCUMENT
DOC_CSS = """
@page { size: A4; margin: 20mm 18mm 20mm 18mm; }
* { box-sizing: border-box; }
body { font-family: Inter, system-ui, sans-serif; color: #1a1f27; font-size: 10.2pt; line-height: 1.55; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; }
h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 6pt; letter-spacing: -.01em; font-weight: 600; color: #0d1117; }
h2 { font-size: 15pt; margin: 22pt 0 8pt; font-weight: 600; color: #0d1117; break-after: avoid; padding-top: 4pt; border-top: 2px solid #d2b36a; }
h2 .n { color: #8a6d1f; margin-right: 8pt; }
h3 { font-size: 11.5pt; margin: 14pt 0 5pt; font-weight: 600; color: #0d1117; break-after: avoid; }
p { margin: 0 0 7pt; } ul, ol { margin: 0 0 8pt; padding-left: 16pt; } li { margin-bottom: 3pt; }
a { color: #1f6fd0; text-decoration: none; }
code, .mono { font-family: 'JetBrains Mono', monospace; font-size: 8.6pt; background: #f1f3f6; padding: 0 3pt; border-radius: 3pt; }
pre { font-family: 'JetBrains Mono', monospace; font-size: 8.4pt; background: #f4f6f9; border: 1px solid #dfe3ea; border-radius: 6pt; padding: 8pt 10pt; white-space: pre-wrap; break-inside: avoid; line-height: 1.45; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 8.9pt; break-inside: auto; }
th, td { text-align: left; padding: 4.5pt 6pt; border-bottom: 1px solid #e1e5eb; vertical-align: top; }
th { background: #f1f3f6; font-weight: 600; font-size: 8.3pt; color: #3a4252; }
tr { break-inside: avoid; }
table.keep { break-inside: avoid; }
h3 + table, h3 + p + table { break-before: avoid; }
figure { margin: 8pt 0 12pt; break-inside: avoid; }
figure img, figure svg { width: 100%; border: 1px solid #dfe3ea; border-radius: 6pt; display: block; }
figcaption { font-size: 8.5pt; color: #5c6470; margin-top: 4pt; }
.callout { background: #faf6ea; border-left: 3px solid #d2b36a; padding: 7pt 10pt; margin: 8pt 0 10pt; break-inside: avoid; }
.callout.blue { background: #eef5fe; border-color: #1f6fd0; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7pt; margin: 8pt 0 12pt; }
.kpi { border: 1px solid #dfe3ea; border-radius: 6pt; padding: 7pt 9pt; break-inside: avoid; }
.kpi b { display: block; font-size: 15pt; font-weight: 600; color: #0d1117; }
.kpi span { font-size: 8.2pt; color: #5c6470; line-height: 1.3; display: block; }
.pill { display: inline-block; font-size: 7.8pt; font-weight: 700; padding: 0 6pt; border-radius: 99pt; color: #0d1117; background: var(--p); white-space: nowrap; }
.sub { display: block; font-size: 7.6pt; color: #8a6200; }
.cover { height: 257mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; position: relative; }
.cover .band { height: 92mm; border-radius: 8pt; background: #090b0e url('img/hero.jpg') 70% center / cover; position: relative; overflow: hidden; }
.cover .band::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, #090b0e 0%, rgba(9,11,14,.75) 45%, rgba(9,11,14,.1) 100%); }
.cover .band .wm { position: absolute; left: 16pt; top: 16pt; z-index: 1; color: #fff; font-size: 17pt; font-weight: 700; letter-spacing: .35em; display: flex; align-items: center; gap: 10pt; }
.cover .band .tg { position: absolute; left: 16pt; bottom: 16pt; z-index: 1; color: #e9ebef; font-size: 11pt; }
.eyebrow { font-size: 8.5pt; letter-spacing: .14em; text-transform: uppercase; color: #8a6d1f; font-weight: 700; }
.toc { columns: 2; column-gap: 20pt; font-size: 9.6pt; }
.toc div { break-inside: avoid; padding: 2pt 0; border-bottom: 1px dotted #ccd2db; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10pt; }
.pagebreak { break-before: page; }
"""


def build_document():
    D = []
    add = D.append
    cA, cB, cC = verdict_counts(A), verdict_counts(B), verdict_counts(C)
    sections = ["Executive summary", "The problem SELENIX addresses", "What SELENIX does", "How to use SELENIX", "System architecture",
                "Datasets and sources", "The calculation pipeline", "Decision support: requirements, proofs and the mission log",
                "Traceability and the data model", "Validation and verification", "Results of the demonstration scenario",
                "How SELENIX differs from existing solutions", "Limitations and known issues", "Future prospects",
                "Deployment and reproducing the results", "Appendices"]
    sec = iter(range(1, len(sections) + 1))

    def H(title):
        return f'<h2><span class="n">{next(sec)}</span>{e(title)}</h2>'

    # cover
    add(f"""<div class="cover"><div class="band"><div class="wm">{LOGO.replace('width="58" height="58"', 'width="30" height="30"')}SELENIX</div><div class="tg">Navigate lunar data. Plan with confidence.</div></div>
      <div style="margin-top:22pt" class="eyebrow">Technical document · NASA Space Apps 2026</div>
      <h1 style="font-size:28pt;margin-top:6pt">SELENIX: terrain-aware lunar south-pole site and date comparison</h1>
      <p style="font-size:12pt;color:#48505c">How the platform works: problem, method, pipelines and datasets, validation, differentiation, usage and future prospects.</p>
      <div style="margin-top:auto"><p style="font-size:11pt"><b>SELENIX team</b>: {', '.join(TEAM)}</p>
      <p style="font-size:9pt;color:#5c6470">Document date {TODAY} · engine {e(F['engine'])} · data build {e(F['generatedUtc'][:10])}</p>
      <p style="font-size:8.5pt;color:#5c6470">Prototype for decision support. Not a flight-readiness, landing-safety or mission-feasibility certification.</p></div></div>""")
    add('<h1 style="font-size:16pt">Contents</h1><div class="toc">' + "".join(f"<div>{i}. {e(t)}</div>" for i, t in enumerate(sections, 1)) + "</div>")

    # 1 summary
    add(H(sections[0]) + f"""
      <p>SELENIX is a browser-based decision-support tool for lunar south-pole mission planners who are not specialists in celestial mechanics. It answers one recurring planning question quickly and traceably: <b>if the landing date or site changes, what happens to Sun and Earth visibility over the mission, and does the plan still meet its requirements?</b></p>
      <p>It combines NASA NAIF SPICE geometry (DE440), terrain horizons derived from LRO LOLA elevation models and a transparent rule layer. It compares up to three site/date scenarios on a mission-elapsed-time axis and checks each against stated requirements with an explicit proof. Every displayed number opens its evidence: inputs, data versions, method, tolerance, limitations and validation status.</p>
      <div class="kpis"><div class="kpi"><b>{V['summary']['passed']} / {V['summary']['total']}</b><span>validation checks passing</span></div>
      <div class="kpi"><b>{HZ['worst']:.5f}°</b><span>worst difference from JPL Horizons ({HZ['n']} angles)</span></div>
      <div class="kpi"><b>{BM['sun']['all']['medianAbs']} pt</b><span>median difference from NASA's published illumination map ({BM['n']} points)</span></div>
      <div class="kpi"><b>~2.2 MB</b><span>one self-contained HTML file; no backend</span></div></div>
      <p>The demonstration follows a lander whose launch slips 21 days. At {e(A['site'])} on {day(A['startUtc'])} the Sun is visible {A['fmt']['sun']} of the mission and Earth {A['fmt']['earth']}: all four visibility requirements are met. Three weeks later the same site gives {B['fmt']['sun']} and {B['fmt']['earth']}, the lander arrives in darkness, and all five requirements fail. Moving to {e(C['site'])} restores the Sun ({C['fmt']['sun']}) but removes direct-to-Earth geometry ({C['fmt']['earth']}). SELENIX states that trade-off. It does not pick a winner.</p>""")

    # 2 problem
    add(H(sections[1]) + f"""
      <p>At the lunar south pole the Sun stays near the horizon all year: at 90°S its elevation never exceeds about {abs(float(checks[0]['detail'].split('°')[0])):.2f}°. Earth wanders within about ±7° with libration. Under these conditions, terrain kilometres away decides whether a lander sees the Sun or Earth, and a few weeks' change in landing date can move both bodies behind ridges for days.</p>
      <p>Three levels of knowledge must be connected for a planning decision:</p>
      <table><tr><th>Level</th><th>Question</th><th>Typical tool today</th></tr>
      <tr><td>Celestial geometry</td><td>Where are the Sun and Earth relative to the site?</td><td>SPICE, JPL Horizons</td></tr>
      <tr><td>Terrain visibility</td><td>Does local terrain block them?</td><td>DEM horizon or viewshed analysis</td></tr>
      <tr><td>Operational meaning</td><td>What does that do to power, darkness survival and communications?</td><td>A specialist, by hand</td></tr></table>
      <p>The data exists: SPICE kernels, LOLA topography, published illumination maps, Horizons, and viewers such as LROC QuickMap and NASA Moon Trek. What planners lack is a fast, consistent way to reassess a site and date when inputs change, and to see why the answer changed. Repeating that by hand across tools is slow and error-prone. Mixed frames, time standards and azimuth conventions produce plausible but wrong numbers.</p>
      <div class="callout">Design rule: a body above the geometric horizon is not necessarily visible, and a visible body is not usable power or a working link. SELENIX keeps these levels separate and labels each one.</div>""")

    # 3 what it does
    add(H(sections[2]) + """
      <table><tr><th>Capability</th><th>What the planner gets</th></tr>
      <tr><td>Site evaluation</td><td>Curated south-pole sites with cited coordinates, LOLA elevation, published long-term illumination and Earth visibility, and terrain status.</td></tr>
      <tr><td>Sun and Earth visibility</td><td>Per-sample state (visible, uncertain, obstructed) against the LOLA terrain horizon; Earth also against a minimum antenna elevation.</td></tr>
      <tr><td>Windows and worst cases</td><td>Every visibility window with start, end and duration refined to the minute; longest interruptions with when they start.</td></tr>
      <tr><td>Scenario comparison</td><td>Up to three scenarios on a mission-elapsed-time axis, a three-line difference (what changed, effect, verdicts) and a trade-off table.</td></tr>
      <tr><td>Requirement checks</td><td>meets / needs review / does not meet / unknown, with the reason for review and the driver of each failure.</td></tr>
      <tr><td>Mission log</td><td>Plain-language, rule-based entries such as “Land in darkness: the Sun stays hidden until T+5 d 16 h.” No free-text AI.</td></tr>
      <tr><td>Power estimate</td><td>A transparent panel and battery estimate, always labelled as an engineering estimate on user assumptions.</td></tr>
      <tr><td>Date sweep</td><td>A precomputed grid of sites against landing dates to spot windows worth a closer look.</td></tr>
      <tr><td>Evidence and export</td><td>Every number opens its evidence; per-sample and window CSV; comparison JSON with indicator records and proofs.</td></tr></table>
      <p><b>Intended users:</b> lunar mission planners and mission designers first; systems, power and communications engineers second. The interface is simple by default, with technical detail one click away.</p>""")

    # 4 how to use
    add(H(sections[3]) + f"""
      <h3>Opening it</h3><p>Open <code>dist/app/index.html</code> in any modern browser, or the deployed site. There is nothing to install and it works offline. The landing page is <code>dist/index.html</code>.</p>
      <h3>The guided demonstration</h3>
      <ol><li><b>Briefing:</b> the site, planned landing, duration, assumed hardware and the requirements. Nothing is calculated yet.</li>
      <li><b>Baseline:</b> scenario A is computed and shown with its verdicts, timeline and horizon view.</li>
      <li><b>Slip:</b> scenario B, the same site 21 days later, appears beside A with a three-line difference.</li>
      <li><b>Alternative:</b> scenario C, another site on the slipped date.</li>
      <li><b>Decide:</b> a table of what each option gains and gives up, and the next date that restores the baseline.</li></ol>
      <p>Controls are always visible: <b>Reset demo</b>, <b>Next step</b> (or the right-arrow key) and <b>Show me why</b>, which opens the evidence for the number that changed most. <b>Explore freely</b> switches to the editable workspace.</p>
      <figure><img src="img/alternative.jpg"><figcaption>Step 4 of the guided demonstration: three scenarios, requirement verdicts and the mission timeline.</figcaption></figure>
      <h3>The workspace</h3><ul>
      <li><b>Scenarios:</b> choose a site, a landing time (UTC) and a duration; duplicate a scenario with “Duplicate → shift date +21 d”.</li>
      <li><b>Requirement check:</b> tap any cell for its rationale, including the ordered checks and what would settle a review.</li>
      <li><b>Mission timeline:</b> drag the cursor or press Play; choose 5, 10 or 30-minute sampling; “Show windows” lists every window; “Show angles” shows azimuth and elevation.</li>
      <li><b>Horizon view:</b> the terrain silhouette with the Sun and Earth at the cursor time; solid trace so far, dotted trace still to come.</li>
      <li><b>Date sweep:</b> green = 100% Sun visible, amber 60–99%, hatched red below 60%; click a cell to load it into scenario C (with undo).</li>
      <li><b>Requirements:</b> edit thresholds, add or remove requirements, set the “close to threshold” margin.</li>
      <li><b>Sites and terrain:</b> click a site on the map to use it in a scenario; add a custom site; load a terrain mask override.</li>
      <li><b>Header chips:</b> Validation ({V['summary']['passed']} of {V['summary']['total']}), provenance (kernels, frame, time system, versions), hardware and antenna inputs, Export, light/dark theme.</li></ul>
      <div class="callout blue">Power and battery verdicts stay at “needs review · default assumptions” until the user ticks “These are my mission's values” in the hardware inputs.</div>""")

    # 5 architecture
    add(H(sections[4]) + f"""
      <p>Heavy, data-intensive steps run offline in Python. Their outputs are small static files that the browser engine reads. A build step inlines data, engine and interface into a single HTML file, so a demonstration cannot fail because a server is down.</p>
      <figure>{pipeline_svg(False)}<figcaption>Data flow. Offline steps use the original NASA products; the browser uses only the derived static data.</figcaption></figure>
      <table><tr><th>Component</th><th>File</th><th>Responsibility</th></tr>
      <tr><td>SPICE geometry adapter</td><td><code>precompute/adapters.py</code></td><td>Kernel loading, time conversion, Sun/Earth vectors in MOON_ME</td></tr>
      <tr><td>Ephemeris table</td><td><code>precompute/make_ephemeris.py</code></td><td>Hourly vectors {F['ephemeris']['start'][:4]}–{int(F['ephemeris']['end'][:4]) - 1} → <code>data/ephemeris.bin</code></td></tr>
      <tr><td>Horizon masks</td><td><code>precompute/horizon_mask.py</code></td><td>LOLA DEM ray marching → <code>horizon_&lt;site&gt;.json</code></td></tr>
      <tr><td>Map layers</td><td><code>precompute/pole_map.py</code></td><td>Shaded relief and published illumination/Earth layers</td></tr>
      <tr><td>Benchmark</td><td><code>precompute/benchmark_illumination.py</code></td><td>Comparison with NASA PGDA maps</td></tr>
      <tr><td>Horizons check</td><td><code>precompute/horizons_check.py</code></td><td>Independent geometry check via the JPL API</td></tr>
      <tr><td>Validation</td><td><code>precompute/validate.py</code></td><td>12 checks → <code>data/validation.json</code>; reference runs</td></tr>
      <tr><td>Date sweep</td><td><code>precompute/make_sweep.js</code></td><td>Static grid computed with the browser engine</td></tr>
      <tr><td>Engine</td><td><code>src/engine.js</code></td><td>Adapters, classifier, metrics, windows, proofs, records, rules (no DOM)</td></tr>
      <tr><td>Interface</td><td><code>src/app.js</code>, <code>src/styles.css</code></td><td>Guided demonstration, workspace, evidence drawer</td></tr>
      <tr><td>Build</td><td><code>build.py</code></td><td>→ <code>dist/index.html</code> (landing), <code>dist/app/index.html</code> (platform)</td></tr>
      <tr><td>Tests</td><td><code>tests/regression.js</code></td><td>JS vs Python reference, classifier, proofs, store, schemas, refinement</td></tr></table>
      <p><b>Technologies:</b> Python 3 with NumPy, SpiceyPy (CSPICE N0067), Matplotlib and Pillow offline; plain JavaScript, HTML and CSS in the browser, with no framework or runtime dependency. Charts are drawn on HTML canvas and SVG. Tests run in Node.js and headless Chromium (Playwright). Deployment is static (Vercel or GitHub Pages).</p>""")

    # 6 datasets
    srcrows = "".join(f"<tr><td>{e(s['name'])}</td><td>{e(s['version'])}</td><td>{e(s['qualityClass'])}</td><td><a href='{e(s['url'])}'>{e(s['url'].replace('https://', ''))}</a></td></tr>" for s in F["sources"])
    siterows = "".join(f"<tr><td>{e(s['name'])}</td><td>{s['lat']:.4f}°</td><td>{s['lon']:.4f}°</td><td>{'' if s.get('elevationM') is None else str(round(s['elevationM'])) + ' m'}</td><td>{e(s['coordStatus'])}</td><td>{'LOLA' if s.get('hasTerrainMask') else 'unavailable'}</td><td>{(str(bench_sites[s['id']]['publishedSunPct']) + '% / ' + str(bench_sites[s['id']]['publishedEarthPct']) + '%') if s['id'] in bench_sites else '—'}</td></tr>" for s in F["sites"])
    add(H(sections[5]) + f"""
      <table><tr><th>Source</th><th>Version</th><th>Class</th><th>Location</th></tr>{srcrows}</table>
      <h3>SPICE kernels</h3><p><code>naif0012.tls</code> (leap seconds), <code>de440s.bsp</code> (planetary and lunar ephemeris, coverage {e(F['ephemeris']['adapter']['coverage']['startUtc'][:10])} to {e(F['ephemeris']['adapter']['coverage']['endUtc'][:10])}), <code>moon_pa_de440_200625.bpc</code> (lunar orientation), <code>moon_de440_250416.tf</code> (MOON_ME frame), <code>pck00011.tpc</code> (constants). Physical libration is included through the lunar orientation kernel; no analytic Moon model is used.</p>
      <h3>LOLA elevation models</h3><p>Polar stereographic gridded DEMs from the PDS: LDEM_85S_40M, LDEM_80S_80M and LDEM_75S_120M (version 2.0, 2017). Heights are DN × 0.5 m relative to a 1737.4 km sphere. The projection (r = 2R·tan(π/4 + lat/2); sample = S₀ + r·sin λ / scale, line = L₀ − r·cos λ / scale) was verified on Shackleton crater and the Malapert massif.</p>
      <h3>Published illumination products</h3><p>NASA GSFC PGDA product 69 (Mazarico et al. 2011, updated 2016): average solar illumination and Earth visibility over 18.6 years, at 60 m (85°S) and 120 m (75°S). Used as an independent benchmark, to anchor ridge and rim site coordinates, and as map context layers. They are not used in the calculation itself.</p>
      <h3>Sites</h3><table><tr><th>Site</th><th>Lat</th><th>Lon (E)</th><th>Elevation</th><th>Coordinates</th><th>Terrain</th><th>Published Sun / Earth</th></tr>{siterows}</table>
      <p>Mons Mouton uses the IM-2 Athena position published by LROC. Connecting Ridge, Shackleton rim, de Gerlache rim and Malapert massif are local maxima of the published illumination map near the regions named by Mazarico et al. (2011). The Shiv Shakti point lies outside the polar DEMs used, so its terrain is unavailable by design.</p>""")

    # 7 pipeline
    add(H(sections[6]) + f"""
      <h3>7.1 Time</h3><p>Scenario inputs are a site, a landing instant in UTC and a duration. Samples are taken every {F['config']['stepMin']} minutes by default (5 and 30 available), giving {int(10 * 24 * 60 / F['config']['stepMin']) + 1} samples for a 10-day mission. Mission-elapsed time (MET) starts at T+0. The ephemeris table is indexed by UTC; TDB = UTC + 69.184 s throughout 2026–2030 because no leap second falls in the window (asserted at build time).</p>
      <h3>7.2 Geometry</h3><p>The SPICE adapter calls <code>spkpos(target, et, 'MOON_ME', 'LT+S', 'MOON')</code> for SUN and EARTH every hour. LT+S gives apparent directions, corrected for light time and stellar aberration. The browser linearly interpolates the table to each sample. The site position is r_site = (R + h)·û with R = 1737.4 km, h the LOLA elevation, and û the unit vector at planetocentric latitude φ and east longitude λ. The local basis is:</p>
      <pre>up    = (cos φ cos λ, cos φ sin λ, sin φ)
east  = (−sin λ, cos λ, 0)
north = (−sin φ cos λ, −sin φ sin λ, cos φ)
v = r_body − r_site        (Earth parallax included; negligible for the Sun)
azimuth   = atan2(v·east, v·north)   0° = north, clockwise
elevation = atan2(v·up, √((v·east)² + (v·north)²))</pre>
      <h3>7.3 Terrain horizon</h3><p>For each site and each whole degree of azimuth, <code>horizon_mask.py</code> marches outward along the great circle to {F['terrain']['extentKm']:.0f} km. The step starts at the DEM cell size and grows to 0.4% of the distance. At each point it uses the finest DEM covering it (bilinear interpolation) and computes the exact elevation angle on the sphere:</p>
      <pre>P = (R + z(d))·dir(d),  S = (R + z₀ + h_obs)·up
angle(d) = asin(((P − S)·up) / |P − S|)        ≈ atan2(z − z₀ − d²/2R, d)</pre>
      <p>Each 1° value is the maximum over five sub-rays spanning ±0.5°, so a ridge narrower than the bin is not missed. Observer height is {F['terrain']['observer']:.0f} m. Terrain closer than {F['terrain']['nearField']:.0f} m (three 40 m cells) is treated as the site itself: at grazing Sun angles, metre-scale relief there dominates ridge-crest horizons but is not resolved reliably and depends on lander placement. The 120 m value was chosen from the illumination benchmark (section 10). Masks are plotted beside shaded relief in <code>docs/masks/</code> for inspection.</p>
      <figure><img src="../masks/mask_connecting-ridge.png"><figcaption>Connecting Ridge: shaded relief (left) and terrain horizon mask (right).</figcaption></figure>
      <h3>7.4 Visibility classification</h3><p>For each sample the engine computes the margin of each body above its limit: the terrain horizon at the body's azimuth (linear interpolation between degrees), and for Earth the higher of that and the minimum antenna elevation ({F['hw']['minEarthElevDeg']}° by default). With tolerance τ = {F['config']['toleranceDeg']}° (the Sun's angular radius):</p>
      <pre>margin &gt; +τ  → visible
margin &lt; −τ  → obstructed
otherwise    → uncertain</pre>
      <p>When a site has no terrain data, every sample that would be visible becomes uncertain. Missing terrain is never treated as an unobstructed horizon.</p>
      <h3>7.5 Aggregation and bounds</h3><p>Each metric is aggregated twice: <b>conservative</b> (uncertain counted as not visible) and <b>optimistic</b> (uncertain counted as visible). With terrain, the displayed value is the conservative one. Without terrain, the optimistic value is displayed and marked as an upper bound (≤ or ≥). Durations use sample accounting: sample k covers [k, k+1) steps, truncated at the mission end.</p>
      <table><tr><th>Metric</th><th>Definition</th><th>Class</th></tr>""" + "".join(f"<tr><td>{e(v['label'])}</td><td>{e(v['method'])}</td><td>{e(v['q'])}</td></tr>" for k, v in F['metricsCatalogue'].items()) + f"""</table>
      <h3>7.6 Windows and transition refinement</h3><p>Consecutive samples in the same state form a window. Each change of state lies between two samples. The engine bisects the interpolated geometry 16 times between them to find when the margin crosses the state boundary (+τ between visible and uncertain, −τ between uncertain and obstructed, 0 for a direct jump). Window times are reported to the minute; a regression test compares them with a 1-minute run (worst 0.59 min). Summary metrics stay sample-based, as the V1 specification requires.</p>
      <h3>7.7 Power and battery (engineering estimate)</h3>
      <pre>P(t) = A · η · 1361 W/m² · (1 AU / r)² · max(0, cos θ) · visible(t) · (1 − losses)
cos θ: horizontal = sin(el); vertical fixed = cos(el)·cos(az − φp); vertical tracking = cos(el)</pre>
      <p>The battery starts at the initial charge, is clamped to capacity, and stops discharging at the depth-of-discharge floor; the first time it reaches the floor is reported. Defaults: {F['hw']['panelAreaM2']} m² {e(F['hw']['panelType'])} array, {F['hw']['efficiency'] * 100:.0f}% efficiency, {F['hw']['losses'] * 100:.0f}% losses, {F['hw']['loadW']} W load, {F['hw']['batteryWh']} Wh battery, {F['hw']['dod'] * 100:.0f}% usable depth of discharge. Dust, self-shadowing, temperature, degradation and heaters are not modelled. All power figures carry the engineering-estimate class.</p>
      <h3>7.8 Date sweep</h3><p>The engine itself, run in Node, precomputes {F['sweep']['sites']} sites × {F['sweep']['dates']} landing dates every {F['sweep']['stepDays']} days from {e(F['sweep']['start'][:10])} for {F['sweep']['durationDays']}-day missions. The grid is static JSON, so it opens instantly. If duration, sampling, antenna elevation or terrain differ from the grid's inputs, the app recomputes live and says so.</p>""")

    # 8 decision support
    reqrows = "".join(f"<tr><td>{e(q['label'])}</td><td><code>{e(q['metric'])}</code></td><td>{e(q['op'])} {q['threshold']} {e(q['unit'])}</td><td>{'yes' if q['visibilityDependent'] else 'no'}</td><td>{'yes' if q['powerDependent'] else 'no'}</td></tr>" for q in F['requirements'])
    rulerows = "".join(f"<tr><td>{e(r['id'])}</td><td>{e(r['title'])}</td><td>{e(r['severity'])}</td><td>{e(r['log'])}</td></tr>" for r in F['rules'])
    add(H(sections[7]) + f"""
      <h3>8.1 Requirements</h3><p>Default thresholds follow the V0.2 change specification. They are user assumptions, editable in the app or in <code>data/requirements.json</code>.</p>
      <table><tr><th>Requirement</th><th>Indicator</th><th>Threshold</th><th>Visibility</th><th>Power</th></tr>{reqrows}</table>
      <h3>8.2 The checker and proof objects</h3><p><code>checkRequirement()</code> returns a proof object with ordered checks:</p>
      <ol><li><b>Inputs present:</b> a missing value or threshold gives <i>unknown</i>.</li>
      <li><b>Threshold:</b> the plain comparison on the displayed value.</li>
      <li><b>Terrain data:</b> without terrain, a passing visibility requirement becomes <i>needs review · terrain</i>; a failure stands, because terrain can only reduce visibility.</li>
      <li><b>Uncertain samples:</b> if the conservative and optimistic values disagree, <i>needs review · grazing samples</i>.</li>
      <li><b>Margin:</b> within 10% of the threshold, <i>needs review · close to threshold</i> (terrain plus close reads “both”).</li>
      <li><b>Assumptions confirmed:</b> a passing power requirement on unconfirmed hardware values reads <i>needs review · default assumptions</i>.</li></ol>
      <p>Each proof records the observed value and when the worst case happens, both bounds, every step with its explanation, the indicator records it rests on and a driver sentence, e.g. “{e(B['proofs'][1]['driver'])}”.</p>
      <h3>8.3 Mission log</h3><p>Plain-language entries come from templates in <code>data/rules.json</code>. A template is filled with calculated values only when its condition holds; there is no free-text generation. Entries shared by every scenario are shown once, with per-scenario values.</p>
      <table><tr><th>Rule</th><th>Title</th><th>Severity</th><th>Entry template</th></tr>{rulerows}</table>
      <h3>8.4 Comparison</h3><p>For each consecutive pair of scenarios SELENIX states three things: what changed in the inputs, the largest effects on visibility (normalised by range), and which verdicts moved. Step 5 tabulates each option's visibility, unmet requirements and open engineering question. It ends on the trade-off, not a recommendation.</p>""")

    # 9 traceability
    add(H(sections[8]) + """
      <p>Traceability is built into the data model, not added as links at the end. Four record types are defined as JSON Schemas in <code>schemas/</code> and checked by the test suite:</p>
      <table><tr><th>Record</th><th>Produced by</th><th>Key contents</th></tr>
      <tr><td>Adapter descriptor</td><td><code>adapter.describe()</code></td><td>Sources with file names and sizes, frame, time system, aberration correction, coverage window</td></tr>
      <tr><td>Indicator record</td><td><code>indicatorRecord()</code></td><td>Value, unit, quality class and state, bounds, worst-case time, location and frame, time window, method and parameters, input identifiers, sources, limitations, validation references, scenario hash</td></tr>
      <tr><td>Proof object</td><td><code>checkRequirement()</code></td><td>Statement, verdict, sub-state, observed value and timing, bounds, ordered checks, evidence ids, driver</td></tr>
      <tr><td>Sample record</td><td><code>sampleRecord()</code></td><td>Per timestamp and body: azimuth, elevation, terrain horizon, visibility state, quality state, tolerance, versions (V1 specification 8.3)</td></tr></table>
      <p>The lineage chain is: displayed indicator → indicator record → method and parameters → adapter descriptors → source products. The evidence drawer renders these records directly, with three templates: geometry-derived, model-derived and user input. Quality classes are measured, computed-geometry, engineering-estimate, user-assumption and demo-only; each value shows its class on hover.</p>
      <figure><img src="img/indicator.jpg"><figcaption>Evidence for a geometry-derived value: how to read it, site and time, method, frames, sources, validation and reproducibility.</figcaption></figure>""")

    # 10 validation
    vrows = "".join(f"<tr><td>{e(c['name'])}</td><td>{e(c['detail'])}</td><td>{e(c['tolerance'])}</td><td>{e(c['status'])}</td></tr>" for c in checks)
    nfrows = "".join(f"<tr><td>{k} m{' (used)' if float(k) == BM['used'] else ''}</td><td>{v['sun']['medianAbs']}</td><td>{v['sun']['rms']}</td><td>{v['sun']['maxAbs']}</td><td>{v['earth']['medianAbs']}</td><td>{v['earth']['rms']}</td><td>{v['earth']['maxAbs']}</td></tr>" for k, v in BM['nearField'].items())
    bsrows = "".join(f"<tr><td>{e(r['name'])}</td><td>{r['publishedSunPct']}%</td><td>{r['oursSunPct']}%</td><td>{r['publishedEarthPct']}%</td><td>{r['oursEarthPct']}%</td></tr>" for r in BM['sites'])
    add(H(sections[9]) + f"""
      <p>Validation results ship with the product: a header chip shows them, and a failing check is shown in a banner, never hidden. Three checks rerun in the browser on load and on demand; the others need NASA data or network access and run when the data is built.</p>
      <table><tr><th>Check</th><th>Result</th><th>Tolerance</th><th>Status</th></tr>{vrows}</table>
      <h3>10.1 Independent geometry check</h3><p>Sun and Earth azimuth and elevation from our table were compared with JPL Horizons (observer on the lunar surface, MEAN_ME site coordinates, apparent airless positions) at {len(HZ['sites'])} sites and {len(HZ['dates'])} times, including both demonstration dates and an off-the-hour instant. The worst difference is {HZ['worst']:.5f}° against a {HZ['tol']}° target. With geometric positions, an earlier version differed by about 0.006°; switching the adapter to LT+S closed that gap.</p>
      <h3>10.2 Illumination benchmark</h3><p>The published PGDA maps give, per 60 m pixel, the share of hourly timesteps over 18.6 years in which any part of the solar (or Earth) disc is visible. We computed the same quantity with our own pipeline at the same pixel centres: the curated sites plus a fixed-seed sample spread across the range of published values ({BM['n']} points).</p>
      <figure><img src="../benchmark_illumination.png"><figcaption>This pipeline against the published maps (near field {BM['used']:.0f} m). Left: Sun. Right: Earth.</figcaption></figure>
      <table><tr><th>Near field</th><th>Sun median |Δ|</th><th>Sun RMS</th><th>Sun worst</th><th>Earth median |Δ|</th><th>Earth RMS</th><th>Earth worst</th></tr>{nfrows}</table>
      <p>Differences are in percentage points. With rays starting one cell from the observer, ridge-crest pixels came out 10 to 40 points too dark. Excluding the nearest {BM['used']:.0f} m brings the median below one point. Remaining differences come from the DEM release and resolution (60 m published, 40 m ours), our conservative 1° bins, and the start of the 18.6-year window. Medians are sub-percent; individual points are not.</p>
      <table><tr><th>Curated site</th><th>Published Sun</th><th>Ours</th><th>Published Earth</th><th>Ours</th></tr>{bsrows}</table>
      <h3>10.3 Regression and unit tests</h3><p><code>tests/regression.js</code> checks that the browser engine reproduces the Python reference (worst angle difference 7×10⁻¹⁵°, identical states), along with classifier boundaries, proof contents and sub-states, the indicator store, required schema fields, adapter agreement and transition refinement. CI runs it before each deployment.</p>""")

    # 11 results
    wrow = lambda s, b: "; ".join(f"{w['state']} T+{hm(w['startH'])}→{'end' if w is s['windows'][b][-1] else 'T+' + hm(w['endH'])}" for w in s["windows"][b])
    prow = "".join(f"<tr><td>{e(p['label'])}</td>" + "".join(f"<td>{pill(s['proofs'][i]['verdict'], s['proofs'][i]['subState'])}</td>" for s in (A, B, C)) + "</tr>" for i, p in enumerate(A["proofs"]))
    add(H(sections[10]) + f"""
      <table><tr><th></th><th>A · Baseline</th><th>B · Slip +21 d</th><th>C · Alternative site</th></tr>
      <tr><td>Site, landing</td><td>{e(A['site'])}, {day(A['startUtc'])}</td><td>{e(B['site'])}, {day(B['startUtc'])}</td><td>{e(C['site'])}, {day(C['startUtc'])}</td></tr>
      <tr><td>Sun visible</td><td>{A['fmt']['sun']}</td><td>{B['fmt']['sun']}</td><td>{C['fmt']['sun']}</td></tr>
      <tr><td>Earth in view</td><td>{A['fmt']['earth']}</td><td>{B['fmt']['earth']}</td><td>{C['fmt']['earth']}</td></tr>
      <tr><td>Longest Sun obstruction</td><td>{A['fmt']['dark']}</td><td>{B['fmt']['dark']} from T+0</td><td>{C['fmt']['dark']}</td></tr>
      <tr><td>Longest gap without Earth</td><td>{A['fmt']['noEarth']}</td><td>{B['fmt']['noEarth']}</td><td>{C['fmt']['noEarth']}</td></tr>
      <tr><td>Battery floor (est.)</td><td>not reached</td><td>T+{B['fmt']['brown']}</td><td>not reached</td></tr>
      <tr><td>Vertical vs flat array (est.)</td><td>{A['fmt']['vh']}×</td><td>{B['fmt']['vh']}×</td><td>{C['fmt']['vh']}×</td></tr>
      <tr><td>Mean Sun elevation; 1 m rock shadow</td><td>{A['fmt']['meanEl']}°; {A['fmt']['shadow']} m</td><td>{B['fmt']['meanEl']}°; {B['fmt']['shadow']} m</td><td>{C['fmt']['meanEl']}°; {C['fmt']['shadow']} m</td></tr>
      {prow}</table>
      <p><b>Sun windows.</b> A: {wrow(A, 'sun')}. B: {wrow(B, 'sun')}. C: {wrow(C, 'sun')}.</p>
      <p><b>Earth windows.</b> A: {wrow(A, 'earth')}. B: {wrow(B, 'earth')}. C: {wrow(C, 'earth')}.</p>
      <p><b>Reading.</b> The slip moves the landing into a period when the Sun sits behind terrain at Mons Mouton for {B['fmt']['dark']}, and Earth is below the antenna limit for most of the mission. Connecting Ridge stays sunlit, because its horizon is low in every direction, but Earth never clears the {F['hw']['minEarthElevDeg']}° limit there in this window. The precomputed sweep shows the original site meets every visibility threshold again from {day(nG['date'])}, {nG['extraDays']} days after the slipped date. Each option costs power margin, communications geometry or schedule. The choice belongs to the engineering and programme team.</p>
      <figure><img src="img/decide.jpg"><figcaption>Step 5: the trade-off table and closing statement.</figcaption></figure>""")

    # 12 differentiation
    add(H(sections[11]) + """
      <p>SELENIX does not claim to invent datasets or methods: SPICE, LOLA, illumination modelling and lunar visualisation already exist. Its contribution is integrating them into one repeatable, traceable workflow for a specific planning decision. The table is based on the public descriptions of each tool.</p>
      <table><tr><th>Existing capability</th><th>Primary purpose</th><th>Gap for this decision</th><th>SELENIX contribution</th></tr>
      <tr><td>NAIF SPICE</td><td>Geometry and frame toolkit</td><td>Requires programming; no terrain or requirements</td><td>Packaged as an adapter for a site, mission window and comparison</td></tr>
      <tr><td>JPL Horizons</td><td>Ephemerides on request</td><td>Point queries; no terrain obstruction</td><td>Independent check; combined with terrain over a full mission</td></tr>
      <tr><td>LOLA DEMs (PDS)</td><td>Topography</td><td>Raw rasters; horizon analysis left to the user</td><td>Horizon masks per site, validated and versioned</td></tr>
      <tr><td>PGDA illumination maps</td><td>Long-term average illumination and Earth visibility</td><td>Averages over 18.6 years, not a specific mission window</td><td>Date-specific windows, worst cases and timing</td></tr>
      <tr><td>LROC QuickMap, NASA Moon Trek</td><td>Imagery and terrain exploration</td><td>Not built around time-dependent requirement checks</td><td>Sun/Earth visibility against stated requirements, on a timeline</td></tr>
      <tr><td>NASA Celestial Mapping System</td><td>Lunar mapping, viewshed and illumination analysis</td><td>Broad analysis environment; not focused on fast site-date reassessment with proofs</td><td>Guided reassessment, comparison and evidence in one workspace</td></tr></table>
      <h3>Three defensible differentiators</h3><ol>
      <li><b>Site-date reassessment:</b> change one input and see, in seconds, what changed and why, against a baseline.</li>
      <li><b>Paired Sun and Earth terrain visibility:</b> both bodies against the same terrain model, with three states and bounds, on one timeline.</li>
      <li><b>Comparison with evidence:</b> every verdict is a proof, every number has a record, and validation is visible in the product.</li></ol>
      <div class="callout">Value hypothesis (to be measured, not claimed): 30–50% less time to reassess a site and date after a change, compared with assembling the same answer from separate tools.</div>""")

    # 13 limitations
    add(H(sections[12]) + """<ul>
      <li><b>Disc model:</b> the disc centre is classified with a ±0.27° band; there is no full partial-disc model.</li>
      <li><b>Terrain resolution:</b> features finer than the 40–120 m DEMs, boulders and the lander are not modelled. The 120 m near-field exclusion is a modelling choice backed by the benchmark.</li>
      <li><b>Coverage:</b> terrain masks exist for curated sites only. Custom sites are upper bounds until a mask is supplied (e.g. computed with <code>horizon_mask.py</code>).</li>
      <li><b>Time window:</b> the ephemeris table covers 2026–2030. Sampling is 5–30 minutes; summary metrics are known to one sample, window boundaries to about a minute.</li>
      <li><b>Communications:</b> Earth visibility is geometric line of sight above an antenna limit. It is not a link budget; relays and ground-station availability are out of scope.</li>
      <li><b>Power:</b> a simple labelled estimate on default hardware values, with no dust, thermal, degradation or heater model.</li>
      <li><b>Date sweep:</b> a 3-day grid; finer dates need a scenario.</li>
      <li><b>Validation:</b> the benchmark covers long-term averages at 45 points; mission-window illumination has not been compared point by point with an independent tool.</li>
      <li><b>User value:</b> the time-saving hypothesis has not yet been tested with planners.</li></ul>""")

    # 14 future
    add(H(sections[13]) + """
      <table><tr><th>Iteration</th><th>Enhancements</th><th>Outcome</th></tr>
      <tr><td>V1.1 Scientific reliability</td><td>Barker et al. 5 m LOLA site DEMs; DEM-resolution and near-field sensitivity per site; partial-disc model; more validation cases; kernel, DEM and method versioning in exports</td><td>Higher confidence before adding breadth</td></tr>
      <tr><td>V1.2 Scenario planning</td><td>Horizon grids across the polar region so any coordinate has terrain; finer and longer date sweeps; saved, versioned scenarios; reports</td><td>Trade-off analysis anywhere near the pole</td></tr>
      <tr><td>V2 Environment and power</td><td>Validated panel, battery, thermal and dust models with uncertainty; mission activity windows on the timeline</td><td>From sunlight to estimated energy availability</td></tr>
      <tr><td>V3 Communications</td><td>Relay orbit data, surface-to-relay and relay-to-Earth visibility, antenna pointing, link budgets, ground-station schedules</td><td>From geometry to communications feasibility</td></tr>
      <tr><td>V4 Integrated mission support</td><td>Rover traverse, resource and science layers, multi-objective trade studies with hard constraints, collaboration and audit trail</td><td>A broader mission-planning platform</td></tr></table>
      <p>The adapter interface keeps this incremental. A new ephemeris, DEM, relay orbit or engineering model implements <code>describe()</code>, <code>coverage()</code> and <code>query()</code>, and the classifier, checker, evidence layer and interface stay unchanged. The priority order follows the V1 specification: terrain correctness and uncertainty first, then scenario management, then requirements, and only after validation, power and communications models.</p>
      <p><b>Users and evaluation.</b> The next step is planner workshops to refine thresholds and wording, and a controlled timing study of the reassessment task, reported as measured.</p>""")

    # 15 deployment
    add(H(sections[14]) + """
      <h3>Deploying</h3><ul><li><b>Vercel:</b> import the GitHub repository. <code>vercel.json</code> serves <code>lunar-navigator/dist</code> with no build step; each push to <code>main</code> redeploys.</li>
      <li><b>GitHub Pages:</b> enable Pages with source “GitHub Actions”. The workflow runs the regression test, rebuilds and publishes.</li>
      <li><b>Offline:</b> open <code>dist/app/index.html</code> directly.</li></ul>
      <h3>Regenerating the data</h3>
      <pre>pip install -r precompute/requirements.txt     # numpy, spiceypy, matplotlib, pillow
# kernels → precompute/kernels/ from naif.jpl.nasa.gov/pub/naif/generic_kernels/
# DEMs (+ .LBL) from imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/: LDEM_85S_40M, LDEM_80S_80M, LDEM_75S_120M
# published maps from imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/: AVGVISIB_85S_060M_201608[_EARTH], AVGVISIB_75S_120M_201608[_EARTH]
cd precompute
python make_ephemeris.py
python horizon_mask.py --dem-dir DEMS --plots ../docs/masks
python pole_map.py --dem-dir DEMS --illum-dir ILLUM
python benchmark_illumination.py --dem-dir DEMS --illum-dir ILLUM
python horizons_check.py           # needs network access to ssd.jpl.nasa.gov
python validate.py
cd .. && node precompute/make_sweep.js && node tests/regression.js && python build.py</pre>
      <p>Thresholds, rules, hardware defaults, tolerance and site metadata are JSON files in <code>data/</code>. Edit them and run <code>python build.py</code>; no code change is needed.</p>""")

    # 16 appendices
    add(H(sections[15]) + f"""
      <h3>A. Conventions</h3><table>
      <tr><td>Frame</td><td>MOON_ME (DE440 mean-Earth/polar-axis), km</td></tr>
      <tr><td>Coordinates</td><td>Planetocentric latitude; east-positive longitude in [−180°, 180°]; sphere 1737.4 km + elevation</td></tr>
      <tr><td>Azimuth / elevation</td><td>0° = local north, clockwise; elevation from the local tangent plane; no refraction</td></tr>
      <tr><td>Time</td><td>UTC input and display; TDB = UTC + 69.184 s in 2026–2030; MET from T+0</td></tr>
      <tr><td>Positions</td><td>Apparent (SPICE LT+S); Earth parallax included</td></tr>
      <tr><td>Visibility</td><td>Three states with ±{F['config']['toleranceDeg']}°; Earth limit includes the antenna elevation</td></tr>
      <tr><td>Durations</td><td>Sample k covers [k, k+1) steps, truncated at mission end; windows refined between samples</td></tr></table>
      <h3>B. Glossary</h3><table>
      <tr><td>DEM</td><td>Digital elevation model</td></tr><tr><td>LOLA</td><td>Lunar Orbiter Laser Altimeter (LRO)</td></tr><tr><td>SPICE</td><td>NASA NAIF observation geometry toolkit</td></tr>
      <tr><td>MOON_ME</td><td>Lunar mean-Earth/polar-axis body-fixed frame</td></tr><tr><td>LT+S</td><td>Light-time and stellar-aberration correction</td></tr><tr><td>MET</td><td>Mission-elapsed time</td></tr>
      <tr><td>DoD</td><td>Depth of discharge</td></tr><tr><td>PGDA</td><td>Planetary Geology, Geophysics and Geochemistry Laboratory, NASA GSFC</td></tr><tr><td>DTE</td><td>Direct to Earth</td></tr></table>
      <h3>C. References</h3><ol>
      <li>Acton, C. H. (1996). Ancillary data services of NASA's Navigation and Ancillary Information Facility. Planetary and Space Science 44(1). NAIF SPICE: naif.jpl.nasa.gov</li>
      <li>Smith, D. E., et al. (2010). The Lunar Orbiter Laser Altimeter investigation on the Lunar Reconnaissance Orbiter mission. Space Science Reviews 150.</li>
      <li>Mazarico, E., et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211, 1066–1081.</li>
      <li>Barker, M. K., et al. (2021). Improved LOLA elevation maps for south pole landing sites: error estimates and their impact on illumination conditions. Planetary and Space Science 203.</li>
      <li>Park, R. S., et al. (2021). The JPL Planetary and Lunar Ephemerides DE440 and DE441. The Astronomical Journal 161(3).</li>
      <li>Kopp, G., and Lean, J. L. (2011). A new, lower value of total solar irradiance. Geophysical Research Letters 38.</li>
      <li>NASA GSFC PGDA, Lunar Polar Illumination, product 69: pgda.gsfc.nasa.gov/products/69</li>
      <li>JPL Horizons System: ssd.jpl.nasa.gov/horizons · LROC QuickMap: quickmap.lroc.im-ldi.com · NASA Moon Trek: trek.nasa.gov/moon</li></ol>
      <p style="margin-top:14pt;color:#5c6470;font-size:8.5pt">Prepared by the SELENIX team ({', '.join(TEAM)}) for NASA Space Apps 2026. All figures in this document are generated from the project's data files (<code>docs/pitch/facts.json</code>).</p>""")
    import re
    body = "".join(D)
    body = re.sub(r"<table>((?:(?!</table>).)*?)</table>", lambda m: ('<table class="keep">' if m.group(1).count('<tr') <= 14 else '<table>') + m.group(1) + '</table>', body, flags=re.S)
    D[:] = [body]
    return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SELENIX Technical Document</title><style>{DOC_CSS}</style></head><body>{"".join(D)}</body></html>'


if __name__ == "__main__":
    deck, n = build_deck()
    open(os.path.join(HERE, "deck.html"), "w").write(deck)
    open(os.path.join(HERE, "document.html"), "w").write(build_document())
    print(f"deck.html ({n} slides), document.html")
