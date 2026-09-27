# Mumbai Kart Racing 26

A browser arcade racer on a Marine Drive circuit. Three laps, six auto-rickshaws, keyboard and touch controls, drift-to-charge boost, lap timing, local best time, pause/restart, minimap and synthesized engine audio.

## Run

Requires Node.js 22.12+.

```sh
npm ci
npm run dev
npm test
npm run build
```

Deploy as a Vite static project: build command `npm run build`, output directory `dist`. No API keys, backend, paid generation or external model downloads are needed at runtime. All GLBs are in `public/assets`.

## Controls

- W / Up: accelerate; S / Down: brake.
- A / D or Left / Right: move across the road.
- Space + steer: drift and recharge boost.
- Shift: boost. Escape: pause/resume.
- Touch: automatic acceleration, on-screen steering, brake, drift and boost.

This is assisted arcade steering: the kart follows the circuit heading, while the player controls lateral placement and speed. It is not a free-steering driving simulator.

## Asset provenance

Environment: Higgsfield 3D Jutsu project `892dd658-f8d6-42ae-ad0d-13d8af6abcc7`, revision 2. The driving spline is recovered from its 144 centerline markers, matching the exported 16-metre road.

Meshy remesh tasks:

| File | Task | Triangles |
| --- | --- | ---: |
| auto.glb | 01a0df76-17d2-77c4-a363-ff784fc9ed28 | 14,894 |
| bus.glb | 01a0df76-21f3-728d-8590-3e0808eae538 | 18,380 |
| taxi.glb | 01a0df76-2b7a-772b-905d-0e55ce795d0a | 10,134 |
| building.glb | 01a0df76-19d4-7680-9f31-8feebd7ebc9b | 10,834 |
| palm.glb | 01a0df78-ee40-72a2-a0e0-0e06240ee973 | 1,777 |

Existing paid jobs were recovered, with no regeneration. Each remesh task reports 5 credits. Embedded textures are reduced to a maximum 1024 pixels with the included `scripts/optimize-textures.py` (requires Pillow), without changing geometry or UVs. Models share geometry and textures between instances.

## Verification and current limits

Production build and 10 Node simulation tests pass. They cover lap completion and finish order, braking, steering response and road limits, drift and boost, frame-time spikes, collision spacing, and boost input rules. Race controls are keyboard-based on desktop and use touch buttons with automatic acceleration on touchscreens.

The circuit now uses a dusk palette, smaller roadside buildings, a lower chase camera, warm promenade lights, differentiated autos, procedural drivers, rotating procedural wheels, tuned asphalt, and filtered engine audio. The base auto remains a single Meshy mesh, so the added wheels and drivers are visual attachments rather than a full vehicle rig.

The Vercel build completed successfully on `main`. Full gameplay QA could not be completed in the cloud browser because that browser reports WebGL as unavailable. Run the deployed game on a WebGL-capable desktop and phone before treating it as a release candidate. There is no multiplayer or server leaderboard.
