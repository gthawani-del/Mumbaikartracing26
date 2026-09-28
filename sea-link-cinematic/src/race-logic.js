export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const LANE_LIMIT_METERS = 6.5;

const DIFFICULTY_PACE = { Easy: 29, Medium: 33, Hard: 37 };

export function createRace({ length, rivals = 7, difficulty = 'Medium', events = [] }) {
  if (!Number.isFinite(length) || length <= 0) throw new Error('Race length must be positive.');
  const pace = DIFFICULTY_PACE[difficulty] ?? DIFFICULTY_PACE.Medium;
  const grid = [
    { distance: 8, lane: -4.2 }, { distance: 8, lane: 4.2 },
    { distance: 19, lane: -4.2 }, { distance: 19, lane: 4.2 },
    { distance: 31, lane: -4.2 }, { distance: 31, lane: 4.2 },
    { distance: 43, lane: 0 },
  ];
  return {
    length,
    elapsed: 0,
    finished: false,
    eventsEnabled: new Set(events),
    eventState: { windFired: false, gateFired: false, windTime: 0, windSide: 1 },
    sectors: [null, null],
    player: { distance: 0, lane: 0, lateralSpeed: 0, speed: 0, charge: 0.65, boostTime: 0, impacts: 0, finishTime: null },
    rivals: Array.from({ length: rivals }, (_, index) => ({
      distance: grid[index]?.distance ?? 48 + (index - grid.length + 1) * 9,
      lane: grid[index]?.lane ?? (index % 2 ? 4.2 : -4.2),
      baseLane: grid[index]?.lane ?? (index % 2 ? 4.2 : -4.2),
      speed: 0,
      pace: pace + (index - (rivals - 1) / 2) * 0.55,
      finished: false,
      finishTime: null,
    })),
  };
}

export function stepRace(race, input, elapsed) {
  if (race.finished || !Number.isFinite(elapsed) || elapsed <= 0) return { events: [], collision: false };
  const dt = clamp(elapsed, 0, 0.05);
  const player = race.player;
  const previousDistance = player.distance;
  const messages = [];
  race.elapsed += dt;

  // Positive lateral position is the driver's right side in the route frame.
  const steer = Number(Boolean(input.right)) - Number(Boolean(input.left));
  const drifting = Boolean(input.drift) && steer !== 0 && player.speed > 8;
  const manualBoost = Boolean(input.boost) && player.charge > 0.01 && player.speed > 4 && !input.brake;
  const gateBoost = player.boostTime > 0;
  const boosting = manualBoost || gateBoost;
  const topSpeed = boosting ? 45 : 35;

  if (input.brake) player.speed = Math.max(0, player.speed - 31 * dt);
  else if (input.accelerate) player.speed = Math.min(topSpeed, player.speed + (boosting ? 27 : 21) * dt);
  else player.speed = Math.max(0, player.speed - 3.2 * dt);
  if (manualBoost) player.charge = Math.max(0, player.charge - 0.42 * dt);
  else if (drifting) player.charge = Math.min(1, player.charge + 0.3 * dt);
  else player.charge = Math.min(1, player.charge + 0.018 * dt);
  player.boostTime = Math.max(0, player.boostTime - dt);

  const targetLateralSpeed = steer * (drifting ? 5.2 : 4.3) * clamp(player.speed / 16, 0, 1);
  player.lateralSpeed += (targetLateralSpeed - player.lateralSpeed) * Math.min(1, (drifting ? 6 : 11) * dt);
  if (race.eventState.windTime > 0) {
    race.eventState.windTime = Math.max(0, race.eventState.windTime - dt);
    player.lateralSpeed += race.eventState.windSide * 3.2 * dt;
  }
  player.lane += player.lateralSpeed * dt;

  let collision = false;
  if (Math.abs(player.lane) >= LANE_LIMIT_METERS && Math.sign(player.lane) === Math.sign(player.lateralSpeed)) {
    player.lane = clamp(player.lane, -LANE_LIMIT_METERS, LANE_LIMIT_METERS);
    player.lateralSpeed = -Math.sign(player.lane) * 1.25;
    player.speed = Math.max(0, player.speed - 8 * dt);
    collision = true;
    player.impacts++;
    messages.push({ type: 'barrier', text: 'Barrier scrape' });
  }

  player.distance = Math.min(race.length, player.distance + player.speed * dt);

  // Event cues are tied to route sectors, so surprises are variable but readable.
  if (race.eventsEnabled.has('crosswind') && !race.eventState.windFired && player.distance >= race.length * 0.39) {
    race.eventState.windFired = true;
    race.eventState.windTime = 1.6;
    race.eventState.windSide = 1;
    messages.push({ type: 'crosswind', text: 'Coastal gust! Hold your line.' });
  }
  if (race.eventsEnabled.has('boost') && !race.eventState.gateFired && player.distance >= race.length * 0.68) {
    race.eventState.gateFired = true;
    if (Math.abs(player.lane) < 1.05) {
      player.boostTime = 2.4;
      player.speed = Math.min(45, player.speed + 7);
      messages.push({ type: 'gate', text: 'Clean line! Cable-shadow boost.' });
    } else messages.push({ type: 'gate-missed', text: 'Boost gate missed — reset your line.' });
  }

  for (let index = 0; index < race.sectors.length; index++) {
    const split = race.length * ((index + 1) / 3);
    if (race.sectors[index] === null && previousDistance < split && player.distance >= split) {
      race.sectors[index] = race.elapsed;
      messages.push({ type: 'sector', text: `Sector ${index + 1} complete` });
    }
  }

  for (const rival of race.rivals) {
    if (rival.finished) continue;
    const prior = rival.distance;
    rival.speed = Math.min(rival.pace, rival.speed + 14 * dt);
    rival.distance = Math.min(race.length, rival.distance + rival.speed * dt);
    rival.lane = rival.baseLane + Math.sin(race.elapsed * 0.5 + prior * 0.04) * 0.14;
    rival.finished = rival.distance >= race.length;
    if (rival.finished) rival.finishTime = race.elapsed - dt + (race.length - prior) / rival.speed;
    if (Math.abs(rival.distance - player.distance) < 3.2 && Math.abs(rival.lane - player.lane) < 1.35) {
      player.speed = Math.max(0, player.speed - 7 * dt);
      player.lateralSpeed += Math.sign(player.lane - rival.lane || 1) * 0.5;
      collision = true;
      messages.push({ type: 'rival', text: 'Kart contact — keep racing.' });
    }
  }

  if (player.distance >= race.length) {
    race.finished = true;
    player.finishTime = race.elapsed - dt + (race.length - previousDistance) / player.speed;
    if (race.sectors[1] === null) race.sectors[1] = race.elapsed;
    messages.push({ type: 'finish', text: 'Finish!' });
  }
  const position = racePosition(race);
  return { events: messages, collision, drifting, boosting, position };
}

export function racePosition(race) {
  return 1 + race.rivals.filter((rival) => {
    if (race.player.finishTime !== null) return rival.finishTime !== null && rival.finishTime <= race.player.finishTime;
    return rival.distance > race.player.distance;
  }).length;
}

export function advanceRace(race, input, elapsed) {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return { events: [], collision: false };
  const events = []; let collision = false; let result = { events, collision };
  let remaining = Math.min(elapsed, 0.25);
  while (remaining > 1e-8 && !race.finished) {
    const step = Math.min(remaining, 0.05);
    result = stepRace(race, input, step);
    events.push(...result.events); collision ||= result.collision;
    remaining -= step;
  }
  return { ...result, events, collision };
}
