import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKartContacts } from './kart-contact.js';
import { createRace, stepRace } from './race-logic.js';
const kart = (distance, lane, speed = 30, lateralSpeed = 0) => ({ distance, lane, speed, lateralSpeed, finishTime: null, gripTime: 0 });
const solve = (karts, previous = karts.map(k => ({ ...k })), contacts = new Set()) => resolveKartContacts(karts, previous, contacts, 1 / 60);

test('rear impact slows trailing kart and pushes leader, without swapping order', () => {
  const a = kart(10, 0, 250 / 3.6), b = kart(12, 0, 20);
  const events = solve([a, b]);
  assert.ok(a.speed < 250 / 3.6); assert.ok(b.speed > 20);
  assert.ok(b.distance - a.distance >= 3.2); assert.equal(events.length, 1);
  assert.ok(a.gripTime > 0);
});
test('side contact pushes both karts apart, including at a barrier', () => {
  const a = kart(10, 5.8, 30, 4), b = kart(10, 6.4, 30, 0);
  solve([a, b]);
  assert.ok(b.lane - a.lane >= 1.35 - 1e-8);
  assert.ok(b.lane <= 6.5); assert.ok(a.lateralSpeed < 4); assert.ok(b.lateralSpeed > 0);
  assert.equal(a.speed, 30);
});
test('swept impact stops a 250 km/h rear-end crossing in a long step', () => {
  const before = [kart(0, 0, 250 / 3.6), kart(3.3, 0, 0)];
  const after = before.map(k => ({ ...k, distance: k.distance + k.speed * .05 }));
  assert.equal(solve(after, before).length, 1);
  assert.ok(after[0].distance < after[1].distance);
});
test('clean overtake produces no impulse or contact feedback', () => {
  const before = [kart(0, -2, 70), kart(3.3, 2, 0)];
  const after = before.map(k => ({ ...k, distance: k.distance + k.speed * .05 }));
  assert.equal(solve(after, before).length, 0); assert.equal(after[0].speed, 70);
});
test('contact feedback does not repeat while karts remain touching', () => {
  const contacts = new Set(), karts = [kart(10, 0, 50), kart(12, 0, 20)];
  assert.equal(solve(karts, undefined, contacts).length, 1);
  karts[0].distance = karts[1].distance - 3.19; karts[0].speed = 50;
  assert.equal(solve(karts, undefined, contacts).length, 0);
});
test('rival-rival impacts work and AI preserves its sideways impulse next step', () => {
  const race = createRace({ length: 10000, rivals: 2 });
  race.player.distance = 100;
  Object.assign(race.rivals[0], kart(10, 0, 30, 4));
  Object.assign(race.rivals[1], kart(10, .8, 30));
  const result = stepRace(race, {}, 1 / 60);
  assert.ok(result.events.some(e => e.type === 'impact' && e.a === 1));
  const lane = race.rivals[1].lane;
  stepRace(race, {}, 1 / 60);
  assert.ok(Math.abs(race.rivals[1].lane - lane) < .2);
  assert.ok(Math.abs(race.rivals[1].lane - race.rivals[1].baseLane) > 1);
});
