import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace } from './race-logic.js';
import { createSimulation, advanceSimulation, FIXED_DT } from './simulation.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('30, 60, 120 Hz and uneven frames produce identical physics', () => {
  const schedules = [Array(120).fill(1 / 30), Array(240).fill(1 / 60), Array(480).fill(1 / 120), Array.from({ length: 80 }, () => [0.01, 0.04]).flat()];
  const states = schedules.map((frames) => {
    const race = createRace({ length: 5000, rivals: 3 });
    const simulation = createSimulation(race);
    frames.forEach((dt) => advanceSimulation(simulation, race, { accelerate: true }, dt));
    return race;
  });
  for (const race of states.slice(1)) {
    near(race.elapsed, states[0].elapsed);
    near(race.player.distance, states[0].player.distance);
    near(race.player.speed, states[0].player.speed);
    race.rivals.forEach((r, i) => near(r.distance, states[0].rivals[i].distance));
  }
});

test('120 Hz rendering advances smoothly between 60 Hz physics steps at top speed', () => {
  const race = createRace({ length: 5000, rivals: 0 });
  race.player.speed = 35;
  const simulation = createSimulation(race);
  advanceSimulation(simulation, race, { accelerate: true }, FIXED_DT);
  let previous = simulation.frame.player.distance;
  for (let i = 0; i < 120; i++) {
    const { frame } = advanceSimulation(simulation, race, { accelerate: true }, 1 / 120);
    near(frame.player.distance - previous, 35 / 120);
    previous = frame.player.distance;
  }
});

test('a dropped frame catches up in fixed steps and retains its fractional remainder', () => {
  const race = createRace({ length: 5000, rivals: 0 });
  const simulation = createSimulation(race);
  const result = advanceSimulation(simulation, race, {}, 0.14);
  assert.equal(result.steps, 8);
  near(simulation.accumulator, 0.14 - 8 * FIXED_DT);
  near(race.elapsed + simulation.accumulator, 0.14);
  assert.equal(advanceSimulation(simulation, race, {}, 10).steps, 15);
});

test('finish is rendered exactly and emits its event only once', () => {
  const race = createRace({ length: 5, rivals: 0 });
  race.player.distance = 4.9; race.player.speed = 35;
  const simulation = createSimulation(race);
  const result = advanceSimulation(simulation, race, {}, 0.1);
  assert.equal(result.frame.player.distance, 5);
  assert.equal(result.events.filter((e) => e.type === 'finish').length, 1);
  assert.equal(advanceSimulation(simulation, race, {}, 0.1).events.length, 0);
});
