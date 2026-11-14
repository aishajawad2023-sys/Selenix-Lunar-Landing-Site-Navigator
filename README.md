# Selenix: Lunar Mission Decision-Support Navigator

NASA Space Apps 2026 hackathon MVP for lunar south-pole mission planners who are not
celestial-mechanics specialists. It turns Sun and Earth geometry and LOLA terrain into plain-language
mission consequences: power, darkness survival and direct-to-Earth contact. You can compare up to three
site/date scenarios on a mission-elapsed-time axis. Every number opens an evidence record.

> Demo question: *"Our launch slipped 3 weeks. Does our site still work, and is there a better option?"*

**Open the app:** `lunar-navigator/dist/index.html`. It is one self-contained file and works offline.
The GitHub Pages workflow publishes it on every push to `main` once Pages is enabled
(Settings → Pages → Source: GitHub Actions).

See [`lunar-navigator/README.md`](lunar-navigator/README.md) for the architecture, conventions, how to
regenerate the data, and validation results.
