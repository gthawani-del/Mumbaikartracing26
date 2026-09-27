# Sea Link Cinematic

Standalone cinematic Sea Link race variant. It lives beside the existing game and does not modify the Marine Drive build.

## Run

From this directory:

```sh
npm install
npm run dev
```

Build with `npm run build`.
Run the race logic checks with `npm test`.

## Current scope

- Responsive race setup UI inspired by the supplied PlayGen reference.
- A separate Three.js point-to-point race scene that follows the cached Bandra-to-Worli OSM road alignment.
- Procedural bridge deck, railings, lighting, cable pylons, ocean, and skyline. A standalone GLB kart with an adult driver is loaded from `public/models/sea-link-kart.glb` for the player and configurable AI rivals, with a lightweight fallback if it cannot load.
- Configurable rival count, difficulty, time of day, crosswind and clean-line boost gate.
- Keyboard and touch controls, chase camera, speed and position HUD, pause, finish results, and restart.
- The existing Marine Drive game and its engine files remain untouched.

Controls: arrows or A/D steer, Up/W accelerates, Down/S brakes, Shift drifts, and E boosts. On touch screens, use the on-screen controls. The route geometry is simplified for gameplay; OSM provides the alignment and attribution, while the 3D bridge and surroundings are game-built.

The included route snapshot is derived from OpenStreetMap data and distributed under the Open Database License (ODbL). Display attribution: © OpenStreetMap contributors.
