export const LAPS = 3;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function newRace(length) {
  return {
    length,
    time: 0,
    finished: false,
    player: { distance: 0, lane: 0, speed: 0, boost: 1, drift: 0 },
    rivals: Array.from({ length: 5 }, (_, i) => ({
      distance: 8 + i * 6,
      lane: ((i % 3) - 1) * 4,
      speed: 0,
      pace: 25 + i * 0.7,
    })),
  };
}
export function tick(r, input, dt) {
  if (r.finished) return;
  dt = clamp(dt, 0, 0.05);
  r.time += dt;
  const p = r.player;
  const steering = Number(!!input.right) - Number(!!input.left);
  const drifting = input.drift && !!steering && p.speed > 9;
  const boosting = input.boost && p.boost > 0.01 && !input.brake && p.speed > 4;
  const top = boosting ? 43 : 31;
  const acceleration = input.brake ? -38 : input.accelerate ? 18 : -9;
  p.speed = clamp(p.speed + acceleration * dt, 0, top);
  if (!boosting && p.speed > 31) p.speed = Math.max(31, p.speed - 16 * dt);
  p.lane += steering * dt * (drifting ? 8 : 6) * Math.min(1, p.speed / 6);
  if (Math.abs(p.lane) > 6.6) {
    p.lane = clamp(p.lane, -6.6, 6.6);
    p.speed = Math.max(0, p.speed - 22 * dt);
  }
  p.boost = clamp(
    p.boost + (boosting ? -0.28 : drifting ? 0.19 : 0.022) * dt,
    0,
    1,
  );
  p.drift = drifting ? steering : 0;
  p.distance += p.speed * dt;
  for (let i = 0; i < r.rivals.length; i++) {
    const o = r.rivals[i];
    o.speed = Math.min(o.pace, o.speed + 12 * dt);
    o.distance += o.speed * dt;
    o.lane = Math.sin(r.time * 0.35 + i * 2) * 4.9;
    let gap = (((o.distance - p.distance) % r.length) + r.length) % r.length;
    if (gap < 3 && Math.abs(o.lane - p.lane) < 1.6 && p.speed > o.speed) {
      p.speed = Math.max(0, o.speed - 3);
      p.distance = Math.max(0, p.distance - (3 - gap));
    }
  }
  if (p.distance >= LAPS * r.length) {
    p.distance = LAPS * r.length;
    r.finished = true;
  }
}
export function place(r) {
  return 1 + r.rivals.filter((o) => o.distance > r.player.distance).length;
}
export function formatTime(t) {
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
}
