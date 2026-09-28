// Track-space boxes, in metres. Equal-mass arcade impulses with swept detection.
const LENGTH = 3.2, WIDTH = 1.35, EDGE = 6.5;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function resolveKartContacts(karts, previous, contacts) {
  const next = new Set(), impacts = [];
  for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
    const a = karts[i], b = karts[j];
    if (a.finished || b.finished || a.finishTime !== null || b.finishTime !== null) continue;
    const key = `${i}:${j}`;
    const from = [previous[i].distance - previous[j].distance, previous[i].lane - previous[j].lane];
    const to = [a.distance - b.distance, a.lane - b.lane];
    const sizes = [LENGTH, WIDTH];
    let enter = 0, exit = 1, axis = 0, hit = true;
    for (let d = 0; d < 2; d++) {
      const travel = to[d] - from[d];
      if (Math.abs(travel) < 1e-9) { if (Math.abs(from[d]) >= sizes[d]) hit = false; continue; }
      const t1 = (-sizes[d] - from[d]) / travel, t2 = (sizes[d] - from[d]) / travel;
      const near = Math.min(t1, t2), far = Math.max(t1, t2);
      if (near > enter) { enter = near; axis = d; }
      exit = Math.min(exit, far);
    }
    if (!hit || enter > exit || exit < 0 || enter > 1) continue;
    if (Math.abs(from[0]) < LENGTH && Math.abs(from[1]) < WIDTH) {
      axis = LENGTH - Math.abs(to[0]) < WIDTH - Math.abs(to[1]) ? 0 : 1;
    }
    const normal = Math.sign(from[axis] + (to[axis] - from[axis]) * enter) || (i < j ? -1 : 1);
    const position = axis === 0 ? 'distance' : 'lane';
    const velocity = axis === 0 ? 'speed' : 'lateralSpeed';
    const closing = Math.max(0, -(a[velocity] - b[velocity]) * normal);
    // Correct along the collision normal, including a complete high-speed crossing.
    const overlap = sizes[axis] - (a[position] - b[position]) * normal;
    if (overlap > 0) {
      const correction = overlap + .002;
      a[position] += normal * correction / 2;
      b[position] -= normal * correction / 2;
      if (axis === 1) {
        const spillA = a.lane - clamp(a.lane, -EDGE, EDGE);
        a.lane -= spillA; b.lane -= spillA;
        const spillB = b.lane - clamp(b.lane, -EDGE, EDGE);
        b.lane -= spillB; a.lane = clamp(a.lane - spillB, -EDGE, EDGE);
      } else {
        if (a.distance < 0) { b.distance -= a.distance; a.distance = 0; }
        if (b.distance < 0) { a.distance -= b.distance; b.distance = 0; }
      }
    }
    if (closing > 0) {
      const impulse = closing * .56;
      a[velocity] += normal * impulse;
      b[velocity] -= normal * impulse;
      a.speed = Math.max(0, a.speed); b.speed = Math.max(0, b.speed);
      if (closing > 12) { a.gripTime = Math.max(a.gripTime, .35); b.gripTime = Math.max(b.gripTime, .35); }
    }
    next.add(key);
    if (!contacts.has(key) && closing > .5) impacts.push({ a: i, b: j, speed: closing,
      distance: (a.distance + b.distance) / 2, lane: (a.lane + b.lane) / 2 });
  }
  // Keep a contact latched through tiny solver gaps; release once genuinely separated.
  for (const key of contacts) {
    const [i, j] = key.split(':').map(Number), a = karts[i], b = karts[j];
    if (Math.abs(a.distance - b.distance) < LENGTH + .15 && Math.abs(a.lane - b.lane) < WIDTH + .15) next.add(key);
  }
  contacts.clear(); for (const key of next) contacts.add(key);
  return impacts;
}
