# SELENIX pitch materials

- `SELENIX_Technical_Review_Deck.pdf`: 21-slide technical review deck (16:9).
- `SELENIX_Technical_Document.pdf`: technical document (A4): problem, method, pipelines, datasets, validation, differentiation, usage, limits and roadmap.

Both are generated; every figure comes from the engine and data files, not typed by hand.

```bash
node docs/pitch/collect_facts.js   # figures -> facts.json
python docs/pitch/build_pitch.py   # -> deck.html, document.html
node docs/pitch/render_pdf.js      # -> the two PDFs (headless Chromium via Playwright)
```

Screenshots in `img/` come from `dist/app/index.html`; re-capture them after UI changes.
