import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, stepRace, advanceRace } from './race-logic.js';

test('creates the requested rival field and an open point-to-point course', () => {
  const race = createRace({ length: 120, rivals: 7 });
  assert.equal(race.rivals.length, 7);
  assert.equal(race.length, 120);
  assert.equal(race.player.distance, 0);
});

test('forward input advances the player and rivals independently', () => {
  const race = createRace({ length: 120, rivals: 3 });
  for (let i = 0; i < 80; i++) stepRace(race, { accelerate: true }, 0.05);
  assert.ok(race.player.distance > 0);
  assert.ok(race.rivals.every((rival) => rival.distance > 0));
});

test('a slow frame advances the same race time as smaller physics steps', () => {
  const slow = createRace({ length: 1000, rivals: 0 });
  const regular = createRace({ length: 1000, rivals: 0 });
  advanceRace(slow, { accelerate: true }, 0.14);
  for (const dt of [0.05, 0.05, 0.04]) stepRace(regular, { accelerate: true }, dt);
  assert.ok(Math.abs(slow.player.distance - regular.player.distance) < 1e-8);
  assert.ok(Math.abs(slow.player.speed - regular.player.speed) < 1e-8);
  assert.ok(Math.abs(slow.elapsed - 0.14) < 1e-8);
});

test('left and right inputs move the kart toward the matching side of the route', () => {
  const leftRace = createRace({ length: 120, rivals: 0 });
  const rightRace = createRace({ length: 120, rivals: 0 });
  leftRace.player.speed = rightRace.player.speed = 20;
  stepRace(leftRace, { left: true }, 0.05);
  stepRace(rightRace, { right: true }, 0.05);
  assert.ok(leftRace.player.lane < 0);
  assert.ok(rightRace.player.lane > 0);
});

test('route events fire at their sectors and a centered player earns the boost', () => {
  const race = createRace({ length: 100, rivals: 0, events: ['crosswind', 'boost'] });
  race.player.distance = 39;
  const wind = stepRace(race, { accelerate: true }, 0.05);
  assert.ok(wind.events.some((event) => event.type === 'crosswind'));
  race.player.distance = 67.9;
  const gate = stepRace(race, { accelerate: true }, 0.05);
  assert.ok(gate.events.some((event) => event.type === 'gate'));
  assert.ok(race.player.boostTime > 0);
});

test('lane limits prevent leaving the bridge deck', () => {
  const race = createRace({ length: 100, rivals: 0 });
  race.player.lane = 6.49;
  race.player.speed = 20;
  const result = stepRace(race, { right: true, accelerate: true }, 0.05);
  assert.ok(Math.abs(race.player.lane) <= 6.5);
  assert.ok(result.collision);
});

test('race finishes once and progress cannot exceed the route end', () => {
  const race = createRace({ length: 5, rivals: 0 });
  race.player.speed = 40;
  race.player.distance = 4.9;
  const result = stepRace(race, { accelerate: true }, 0.05);
  assert.ok(result.events.some((event) => event.type === 'finish'));
  assert.equal(race.player.distance, 5);
  stepRace(race, { accelerate: true }, 0.05);
  assert.equal(race.elapsed, 0.05);
});
