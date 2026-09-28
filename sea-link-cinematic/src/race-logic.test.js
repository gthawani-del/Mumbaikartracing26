import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, stepRace, advanceRace, racePosition } from './race-logic.js';

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

test('a rival who crosses the finish first stays ahead of the player', () => {
  const race = createRace({ length: 300, rivals: 3, difficulty: 'Hard' });
  while (!race.finished) advanceRace(race, { accelerate: true }, 1 / 60);
  assert.ok(race.rivals[0].finishTime < race.player.finishTime);
  assert.equal(racePosition(race), 4);
});

test('180 km/h base and 250 km/h boost are reachable, with gradual boost recovery', () => {
  const race = createRace({ length: 10000, rivals: 0 });
  for (let i = 0; i < 240; i++) stepRace(race, { accelerate: true }, 1 / 60);
  assert.ok(Math.abs(race.player.speed * 3.6 - 180) < 1e-8);
  for (let i = 0; i < 40; i++) stepRace(race, { accelerate: true, boost: true }, 1 / 60);
  assert.ok(Math.abs(race.player.speed * 3.6 - 250) < 1e-8);
  assert.ok(race.player.boosting);
  const before = race.player.speed;
  stepRace(race, { accelerate: true }, 1 / 60);
  assert.ok(before - race.player.speed < 0.3);
  assert.equal(race.player.boosting, false);
  stepRace(race, { brake: true, boost: true }, 1 / 60);
  assert.equal(race.player.boosting, false);
});

test('a fast step crossing a rival still registers contact', () => {
  const race = createRace({ length: 10000, rivals: 1 });
  race.player.distance = 0; race.player.lane = race.rivals[0].lane;
  race.player.speed = 400;
  const result = stepRace(race, {}, 0.05);
  assert.ok(result.collision);
  assert.ok(result.events.some(e => e.type === 'impact'));
});

test('boost alone accelerates, depleted boost cannot pulse, release rearms it', () => {
  const race = createRace({ length: 100000, rivals: 0 });
  stepRace(race, { boost: true }, 1 / 60);
  assert.ok(race.player.speed > 0);
  assert.ok(race.player.boosting);
  for (let i = 0; i < 600; i++) stepRace(race, { boost: true }, 1 / 60);
  assert.equal(race.player.boosting, false);
  assert.equal(race.player.boostExhausted, true);
  assert.ok(race.player.speed <= 180 / 3.6);
  for (let i = 0; i < 60; i++) {
    stepRace(race, { boost: true }, 1 / 60);
    assert.equal(race.player.boosting, false);
  }
  stepRace(race, {}, 1 / 60);
  stepRace(race, { boost: true }, 1 / 60);
  assert.equal(race.player.boosting, true);
});

test('brake overrides both throttle and boost without consuming charge', () => {
  const race = createRace({ length: 10000, rivals: 0 });
  race.player.speed = 250 / 3.6;
  const charge = race.player.charge;
  stepRace(race, { accelerate: true, boost: true, brake: true }, 1 / 60);
  assert.ok(race.player.speed < 250 / 3.6);
  assert.ok(race.player.charge >= charge);
  assert.equal(race.player.boosting, false);
});

test('boost speed stays capped across frame rates and repeated activations', () => {
  for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.05]) {
    const race = createRace({ length: 100000, rivals: 0 });
    race.player.speed = 180 / 3.6;
    for (let i = 0; i < 1000; i++) {
      stepRace(race, { accelerate: true, boost: i % 150 < 100 }, dt);
      assert.ok(race.player.speed <= 250 / 3.6);
      assert.ok(race.player.charge >= 0 && race.player.charge <= 1);
    }
  }
});


test('drift provides throttle with steering, and brake still wins', () => {
  const race = createRace({ length: 10000, rivals: 0 });
  for (let i = 0; i < 30; i++) stepRace(race, { drift: true, left: true }, 1 / 60);
  assert.ok(race.player.speed > 0); assert.ok(race.player.lane < 0);
  const speed = race.player.speed;
  stepRace(race, { drift: true, brake: true }, 1 / 60);
  assert.ok(race.player.speed < speed);
});

test('fresh boost from rest reaches 250 before its initial charge runs out', () => {
  const race = createRace({ length: 10000, rivals: 0 });
  for (let i = 0; i < 150; i++) stepRace(race, { boost: true }, 1 / 60);
  assert.equal(race.player.speed * 3.6, 250);
  assert.ok(race.player.charge > 0 && race.player.boosting);
});
