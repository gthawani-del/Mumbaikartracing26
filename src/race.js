export const LAPS = 3;
export const ROAD_HALF_WIDTH = 8;
export const KART_HALF_WIDTH = 0.7;
export const LANE_LIMIT = ROAD_HALF_WIDTH - KART_HALF_WIDTH - 0.7;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function newRace(length) {
  return {
    length,
    time: 0,
    finished: false,
    player: {
      distance: 0,
      lane: 0,
      lateralSpeed: 0,
      speed: 0,
      boost: 0.65,
      drift: 0,
      finishTime: null,
    },
    rivals: Array.from({ length: 5 }, (_, i) => ({
      distance: 6 + i * 6,
      lane: [0, -3.2, 3.2, -3.2, 3.2][i],
      speed: 0,
      pace: 25.5 + i * 0.65,
      finishTime: null,
    })),
    traffic: Array.from({ length: 8 }, (_, i) => ({
      distance: ((i + 0.45) / 8) * length,
      lane: i % 2 ? 6.7 : -6.7,
      halfLength: i % 3 === 0 ? 4 : 2.1,
      halfWidth: i % 3 === 0 ? 1 : 0.75,
    })),
  };
}

export function tick(race, input, elapsed) {
  if (race.finished || !Number.isFinite(elapsed) || elapsed <= 0) return;

  // Clamp long frames (tab switches / slow phones) to avoid a physics jump.
  const dt = clamp(elapsed, 0, 0.05);
  race.time += dt;
  const player = race.player;
  const previousDistance = player.distance;
  // Positive lane offset projects to screen-left from the chase camera.
  const steer = Number(Boolean(input.left)) - Number(Boolean(input.right));
  const drifting = Boolean(input.drift) && steer !== 0 && player.speed > 9;
  const boosting =
    Boolean(input.boost) && Boolean(input.accelerate) && player.boost > 0.01 && !input.brake && player.speed > 4;

  const topSpeed = boosting ? 42 : 31;
  if (input.brake) player.speed = Math.max(0, player.speed - 34 * dt);
  else if (input.accelerate)
    player.speed = Math.min(topSpeed, player.speed + (boosting ? 25 : 18) * dt);
  else player.speed = Math.max(0, player.speed - 5 * dt);

  if (!boosting && player.speed > 31)
    player.speed = Math.max(31, player.speed - 18 * dt);

  const steeringSpeed = (drifting ? 8.2 : 5.4) * clamp(player.speed / 14, 0, 1);
  const desiredLateralSpeed = steer * steeringSpeed;
  const steeringResponse = drifting ? 4.5 : steer === 0 ? 7.5 : 10;
  player.lateralSpeed +=
    (desiredLateralSpeed - player.lateralSpeed) *
    Math.min(1, steeringResponse * dt);
  player.lane += player.lateralSpeed * dt;

  if (Math.abs(player.lane) > LANE_LIMIT) {
    player.lane = clamp(player.lane, -LANE_LIMIT, LANE_LIMIT);
    player.lateralSpeed = 0;
    player.speed = Math.max(0, player.speed - (steer ? 10 : 3) * dt);
  }

  const boostChange = boosting ? -0.38 : drifting ? 0.24 : 0.012;
  player.boost = clamp(player.boost + boostChange * dt, 0, 1);
  player.drift = drifting ? steer : 0;
  player.distance += player.speed * dt;

  let contactSpeedTarget = Infinity;
  for (let i = 0; i < race.rivals.length; i++) {
    const rival = race.rivals[i];
    const previousRivalDistance = rival.distance;
    rival.speed = Math.min(rival.pace, rival.speed + 12 * dt);
    rival.distance += rival.speed * dt;
    rival.lane = [0, -3.2, 3.2, -3.2, 3.2][i] + Math.sin(race.time * 0.35 + i * 2) * 0.35;

    const distanceGap = rival.distance - player.distance;
    const laneGap = Math.abs(rival.lane - player.lane);
    if (Math.abs(distanceGap) < 3.6 && laneGap < 1.55) {
      contactSpeedTarget = Math.min(contactSpeedTarget, rival.speed);
      const previousGap = previousRivalDistance - previousDistance;
      // Keep cars separated throughout contact, so they never pass through
      // each other and then snap apart.
      if (previousGap >= 0) player.distance = Math.min(player.distance, rival.distance - 3.6);
      else player.distance = Math.max(player.distance, rival.distance + 3.6);
    }
  }

  // Roadside traffic repeats with the circuit and blocks the racing line physically.
  const firstLap = Math.max(0, Math.floor(previousDistance / race.length));
  let blockedByTraffic = false;
  for (const vehicle of race.traffic) {
    if (Math.abs(vehicle.lane - player.lane) >= vehicle.halfWidth + KART_HALF_WIDTH) continue;
    const clearance = vehicle.halfLength + 1.8;
    for (let lap = firstLap; lap <= firstLap + 1; lap++) {
      const obstacleDistance = vehicle.distance + lap * race.length;
      const stopDistance = obstacleDistance - clearance;
      if (previousDistance <= stopDistance && player.distance > stopDistance) {
        player.distance = stopDistance;
      }
      const touchingVehicle =
        player.distance >= stopDistance - 0.01 &&
        player.distance <= obstacleDistance + clearance &&
        previousDistance <= obstacleDistance + clearance;
      if (touchingVehicle) {
        blockedByTraffic = true;
        contactSpeedTarget = 0;
      }
    }
  }
  if (Number.isFinite(contactSpeedTarget)) {
    // Keep speed and movement in sync without a one-frame impact impulse.
    const deceleration = blockedByTraffic ? 28 : 24;
    player.speed += clamp(
      contactSpeedTarget - player.speed,
      -deceleration * dt,
      deceleration * dt,
    );
  }

  const finishDistance = LAPS * race.length;
  for (const rival of race.rivals) {
    if (rival.finishTime != null) continue;
    if (rival.distance >= finishDistance) {
      const excess = rival.distance - finishDistance;
      rival.distance = finishDistance;
      rival.finishTime = race.time - Math.min(dt, excess / Math.max(rival.speed, 0.01));
    }
  }

  if (player.distance >= finishDistance) {
    player.distance = finishDistance;
    player.finishTime = race.time;
    race.finished = true;
  }
}

export function place(race) {
  if (race.finished && race.player.finishTime !== null) {
    return 1 + race.rivals.filter(
      (rival) => rival.finishTime != null && rival.finishTime <= race.player.finishTime,
    ).length;
  }
  return 1 + race.rivals.filter((rival) => rival.distance > race.player.distance).length;
}

export function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}
