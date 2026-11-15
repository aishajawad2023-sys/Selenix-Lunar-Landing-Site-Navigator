# SELENIX

**Navigate lunar data. Plan with clarity.**

SELENIX is a lunar mission-planning and analysis prototype (NASA Space Apps 2026). It compares
lunar south-pole landing sites and dates: when the Sun and Earth are visible above the real terrain,
what that means for darkness, power estimates and direct-to-Earth geometry, and what changes when a
launch slips. Every number opens its evidence.

> Demo question: *"Our launch slipped three weeks. Does our site still work, and what does each
> alternative cost?"*

| | |
|---|---|
| Landing page | `lunar-navigator/dist/index.html` |
| Platform (guided demo and workspace) | `lunar-navigator/dist/app/index.html` (one self-contained file, works offline) |
| Architecture, conventions, validation | [`lunar-navigator/README.md`](lunar-navigator/README.md) |
| Adapter interface and schemas | [`lunar-navigator/docs/INTERFACES.md`](lunar-navigator/docs/INTERFACES.md) |
| V0.2 change-spec status | [`lunar-navigator/docs/CHANGE_SPEC_STATUS.md`](lunar-navigator/docs/CHANGE_SPEC_STATUS.md) |

## Put it online

- **Vercel:** import this repository at vercel.com. `vercel.json` already points at
  `lunar-navigator/dist` with no build step, so the first deploy is the live site.
- **GitHub Pages:** Settings → Pages → Source: *GitHub Actions*. The included workflow runs the
  regression test, rebuilds and publishes on every push to `main`.
