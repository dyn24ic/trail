# trAIl Project Memory

## Project Overview
- Product: **trAIl** (Trail Guardian) — AI-powered SAR for hiking trails
- Working dir: `/Users/lsoffice/Desktop/trail/`
- Key file: `CLAUDE.md` contains full product spec

## File Structure
```
trail/
  CLAUDE.md          — Product spec (must read first)
  frontend/
    landing.html     — Landing page (Three.js mountain + Motion animations)
    dashboard.html   — Operator dashboard (3D Yosemite terrain)
  backend/           — Empty so far
```

## Frontend Stack (self-contained HTML files)
- **Three.js r0.169.0** via `https://esm.sh/three@0.169.0`
- **Motion 11** (Framer Motion) via `https://esm.sh/motion@11.11.17` — DOM animate/inView/stagger
- Google Fonts: Cinzel + Exo 2 (landing), Share Tech Mono + Barlow Condensed (dashboard)
- No build step — pure ESM modules via importmap/esm.sh

## Design Decisions
- **Landing page**: Dark night (#030A10), amber (#FF8C42) trail animation, slow camera orbit around procedural mountain, Motion.js for staggered text reveals
- **Dashboard**: Phosphor/mission-control CRT aesthetic, dark (#060C0C), green (#00FF88) primary accent, amber warnings, red alerts, scanline overlay

## Key Dashboard Features (Operator POV)
1. Drone fleet status (4 drones: deployed/standby/patrol/charging)
2. Sensor network grid (16 nodes with ok/warn/alert/off states)
3. Emergency call box status (5 units)
4. Active incidents with AI-predicted search zones
5. Responder routing with ETA and hazard flags
6. Trail risk index per route
7. AI recommendations panel
8. Weather/environmental conditions
9. Scrolling event log ticker
10. Layer toggles: sensors/drones/incidents/search zones

## Yosemite Terrain Generation
Custom heightmap function `yosemiteH(x,z)` with:
- Valley floor depression (east-west, ~0.22 normalized width)
- El Capitan: north wall, west end (-0.58, -0.38 normalized)
- Half Dome: east end, slight north (0.52, -0.1 normalized)
- Yosemite Falls: north wall center
- Nevada Falls: south-east upper
- Tuolumne plateau: east end
- Perlin-like noise (4 octaves)

## User Preferences
- No emojis in output unless asked
- Concise responses
