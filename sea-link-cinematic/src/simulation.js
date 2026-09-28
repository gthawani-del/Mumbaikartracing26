import { stepRace } from './race-logic.js';

export const FIXED_DT = 1 / 60;
const FIELDS = ['distance', 'lane', 'speed', 'lateralSpeed'];
function copy(source, target = {}) {
  for (const key of FIELDS) target[key] = source[key] ?? 0;
  return target;
}

export function createSimulation(race) {
  return {
    accumulator: 0,
    previous: { player: copy(race.player), rivals: race.rivals.map((r) => copy(r)) },
    frame: { player: copy(race.player), rivals: race.rivals.map((r) => copy(r)) },
  };
}

// Physics always advances 1/60 s; rendering blends the two most recent states.
// The 250 ms catch-up budget bounds work after a stall. Hidden tabs are paused.
export function advanceSimulation(simulation, race, input, elapsed) {
  const events = []; let collision = false; let steps = 0;
  simulation.accumulator += Number.isFinite(elapsed) ? Math.max(0, Math.min(elapsed, 0.25)) : 0;
  while (simulation.accumulator + 1e-10 >= FIXED_DT && !race.finished) {
    copy(race.player, simulation.previous.player);
    race.rivals.forEach((r, i) => copy(r, simulation.previous.rivals[i]));
    const result = stepRace(race, input, FIXED_DT);
    events.push(...result.events); collision ||= result.collision;
    simulation.accumulator = Math.max(0, simulation.accumulator - FIXED_DT); steps++;
  }
  const alpha = race.finished ? 1 : simulation.accumulator / FIXED_DT;
  const interpolate = (previous, current, output) => {
    for (const key of FIELDS) output[key] = previous[key] + ((current[key] ?? 0) - previous[key]) * alpha;
  };
  interpolate(simulation.previous.player, race.player, simulation.frame.player);
  race.rivals.forEach((r, i) => interpolate(simulation.previous.rivals[i], r, simulation.frame.rivals[i]));
  if (race.finished) simulation.accumulator = 0;
  return { events, collision, steps, frame: simulation.frame };
}
