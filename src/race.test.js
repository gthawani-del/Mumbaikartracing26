import { test } from "node:test";
import assert from "node:assert/strict";
import { newRace, tick, place, LANE_LIMIT } from "./race.js";
const drive = { accelerate: true };
test("three laps finish once and freeze the race", () => {
  const r = newRace(100);
  r.rivals = [];
  for (let i = 0; i < 2000; i++) tick(r, drive, 0.016);
  assert.equal(r.finished, true);
  assert.equal(r.player.distance, 300);
  const t = r.time;
  tick(r, drive, 0.016);
  assert.equal(r.time, t);
});
test("road bounds hold and braking stops without reversing", () => {
  const r = newRace(10000);
  r.rivals = [];
  for (let i = 0; i < 500; i++) tick(r, { ...drive, right: true }, 0.016);
  assert.ok(r.player.lane <= 6.6);
  for (let i = 0; i < 300; i++) tick(r, { brake: true }, 0.016);
  assert.equal(r.player.speed, 0);
});
test("drift recharges and boost consumes its bounded reserve", () => {
  const r = newRace(10000);
  r.rivals = [];
  r.player.boost = 0.3;
  r.player.speed = 25;
  for (let i = 0; i < 50; i++)
    tick(r, { ...drive, drift: true, right: true }, 0.016);
  assert.ok(r.player.boost > 0.3);
  const b = r.player.boost;
  for (let i = 0; i < 50; i++) tick(r, { ...drive, boost: true }, 0.016);
  assert.ok(r.player.boost < b);
  assert.ok(r.player.speed > 31);
});
test("lapping a rival never teleports the player", () => {
  const r = newRace(100);
  r.player.distance = 201;
  r.player.speed = 31;
  r.rivals = [{ distance: 102, lane: 0, speed: 20, pace: 20 }];
  tick(r, drive, 0.016);
  assert.ok(r.player.distance > 198 && r.player.distance < 202);
  assert.equal(place(r), 1);
});

test("screen-relative steering is speed-sensitive and stays in the lane", () => {
  const r = newRace(10000);
  r.rivals = [];
  r.player.speed = 0;
  tick(r, { right: true }, 0.05);
  assert.equal(r.player.lane, 0);

  r.player.speed = 25;
  for (let i = 0; i < 30; i++) tick(r, { right: true }, 0.05);
  assert.ok(r.player.lane < 0);
  for (let i = 0; i < 500; i++) tick(r, { right: true }, 0.05);
  assert.ok(r.player.lane >= -LANE_LIMIT);
  assert.equal(r.player.lateralSpeed, 0);

  const left = newRace(10000);
  left.rivals = [];
  left.player.speed = 25;
  for (let i = 0; i < 30; i++) tick(left, { left: true }, 0.05);
  assert.ok(left.player.lane > 0);
});

test("frame time is capped, and invalid time does not change race state", () => {
  const r = newRace(10000);
  r.rivals = [];
  r.player.speed = 20;
  tick(r, drive, 10);
  assert.equal(r.time, 0.05);
  assert.ok(r.player.distance < 2);
  const state = { ...r.player };
  tick(r, drive, Number.NaN);
  assert.deepEqual(r.player, state);
});

test("kart contact keeps separation and changes speed without a jolt", () => {
  const r = newRace(10000);
  r.player.speed = 31;
  r.rivals = [{ distance: 6, lane: 0, speed: 24, pace: 24 }];
  let previousDistance = r.player.distance;
  let previousSpeed = r.player.speed;
  let firstContactSpeed;
  for (let i = 0; i < 90; i++) {
    tick(r, drive, 0.016);
    assert.ok(r.player.distance >= previousDistance);
    assert.ok(r.player.distance - previousDistance <= 31 * 0.016 + 1e-6);
    assert.ok(previousSpeed - r.player.speed <= 24 * 0.016 + 1e-6);
    previousDistance = r.player.distance;
    previousSpeed = r.player.speed;
    assert.ok(r.rivals[0].distance - r.player.distance >= 3.6 - 1e-6);
    if (
      firstContactSpeed === undefined &&
      r.rivals[0].distance - r.player.distance <= 3.6 + 1e-6
    ) {
      firstContactSpeed = r.player.speed;
    }
  }
  assert.ok(firstContactSpeed > 28);
  assert.ok(r.player.speed < firstContactSpeed);
  assert.ok(r.player.speed >= r.rivals[0].speed - 1e-6);
});

test("road traffic blocks the racing line on every lap and can be passed around", () => {
  const r = newRace(100);
  r.rivals = [];
  r.traffic = [{ distance: 10, lane: 0, halfLength: 4, halfWidth: 1 }];
  r.player.distance = 103;
  r.player.speed = 24;

  const stopDistance = 110 - 5.8;
  tick(r, { accelerate: true }, 0.05);
  assert.ok(r.player.distance <= stopDistance + 1e-6);
  assert.ok(r.player.speed < 24);
  for (let i = 0; i < 50; i++) tick(r, { accelerate: true }, 0.05);
  assert.ok(r.player.distance <= stopDistance + 1e-6);
  assert.equal(r.player.speed, 0);

  r.player.lane = 3;
  tick(r, { accelerate: true }, 0.05);
  assert.ok(r.player.distance > stopDistance);
});

test("boost cannot drain below zero or exceed the regular speed limit", () => {
  const r = newRace(10000);
  r.rivals = [];
  r.player.boost = 0.01;
  r.player.speed = 41;
  for (let i = 0; i < 100; i++) tick(r, { ...drive, boost: true }, 0.05);
  assert.ok(r.player.boost >= 0 && r.player.boost <= 1);
  assert.ok(r.player.speed <= 42);
  for (let i = 0; i < 100; i++) tick(r, drive, 0.05);
  assert.ok(r.player.speed <= 31);
});

test("boost does not activate without throttle", () => {
  const r = newRace(10000);
  r.rivals = [];
  r.player.boost = 0.5;
  r.player.speed = 20;
  tick(r, { boost: true }, 0.05);
  assert.ok(r.player.boost > 0.5);
  assert.ok(r.player.speed < 20);
});

test("rivals stop at the finish and finish order determines the result", () => {
  const r = newRace(10);
  r.traffic = [];
  r.rivals = [{ distance: 29.5, lane: 3, speed: 30, pace: 30, finishTime: null }];
  r.player.distance = 29.5;
  r.player.lane = -3;
  r.player.speed = 31;
  tick(r, drive, 0.05);
  assert.equal(r.finished, true);
  assert.equal(r.rivals[0].distance, 30);
  assert.equal(place(r), 2);
});
