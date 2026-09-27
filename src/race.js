export const LAPS = 3;
export const ROAD_HALF_WIDTH = 8;
export const KART_HALF_WIDTH = 0.7;
export const LANE_LIMIT = ROAD_HALF_WIDTH - KART_HALF_WIDTH - 0.7;
export const HANDLING = Object.freeze({
  topSpeed: 32,
  boostTopSpeed: 44,
  acceleration: 22,
  boostAcceleration: 28,
  coastDeceleration: 3.5,
  brakeDeceleration: 32,
  steeringSpeed: 6.3,
  driftSteeringSpeed: 9.2,
  steeringResponse: 12,
  steeringReturnResponse: 6.5,
  driftResponse: 5.5,
  wallBounceSpeed: 1.6,
  spinoutSpeedThreshold: 20,
  spinoutDuration: 0.9,
  spinoutDeceleration: 34,
  impactCooldown: 0.3,
  spinoutCooldown: 1.2,
});

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
      spinoutTime: 0,
      spinoutDirection: 1,
      spinoutAngle: 0,
      impactCooldown: 0,
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
  if (race.finished || !Number.isFinite(elapsed) || elapsed <= 0)
    return { collision: false, boosting: false, drifting: false };

  // Clamp long frames (tab switches / slow phones) to avoid a physics jump.
  const dt = clamp(elapsed, 0, 0.05);
  race.time += dt;
  const player = race.player;
  const previousDistance = player.distance;
  const spinningAtStepStart = player.spinoutTime > 0;
  player.impactCooldown = Math.max(0, player.impactCooldown - dt);
  if (spinningAtStepStart) {
    player.spinoutTime = Math.max(0, player.spinoutTime - dt);
    const fullTurn = Math.PI * 2;
    player.spinoutAngle =
      (player.spinoutAngle +
        player.spinoutDirection * fullTurn * (dt / HANDLING.spinoutDuration) +
        fullTurn) %
      fullTurn;
  }

  let impact = false;
  let impactSpeed = 0;
  let impactType = null;
  let impactSide = 0;
  let spinoutStarted = false;
  const registerImpact = (type, speed, side = 0, severeThreshold = Infinity) => {
    if (player.impactCooldown > 0) return;
    impact = true;
    impactSpeed = speed;
    impactType = type;
    impactSide = side;
    const severe = !spinningAtStepStart && speed >= severeThreshold;
    player.impactCooldown = severe
      ? HANDLING.spinoutCooldown
      : HANDLING.impactCooldown;
    if (severe) {
      player.spinoutTime = HANDLING.spinoutDuration;
      player.spinoutDirection = Math.sign(side || 1);
      player.spinoutAngle = 0;
      player.lateralSpeed *= 0.35;
      player.speed = Math.max(
        0,
        player.speed - HANDLING.spinoutDeceleration * dt,
      );
      spinoutStarted = true;
    }
  };

  // Positive lane offset projects to screen-left from the chase camera.
  const steer = spinningAtStepStart
    ? 0
    : Number(Boolean(input.left)) - Number(Boolean(input.right));
  const drifting =
    !spinningAtStepStart && Boolean(input.drift) && steer !== 0 && player.speed > 9;
  const boosting =
    !spinningAtStepStart &&
    Boolean(input.boost) &&
    Boolean(input.accelerate) &&
    player.boost > 0.01 &&
    !input.brake &&
    player.speed > 4;

  const topSpeed = boosting ? HANDLING.boostTopSpeed : HANDLING.topSpeed;
  if (spinningAtStepStart)
    player.speed = Math.max(0, player.speed - HANDLING.spinoutDeceleration * dt);
  else if (input.brake)
    player.speed = Math.max(0, player.speed - HANDLING.brakeDeceleration * dt);
  else if (input.accelerate)
    player.speed = Math.min(
      topSpeed,
      player.speed +
        (boosting ? HANDLING.boostAcceleration : HANDLING.acceleration) * dt,
    );
  else player.speed = Math.max(0, player.speed - HANDLING.coastDeceleration * dt);

  if (!boosting && player.speed > HANDLING.topSpeed)
    player.speed = Math.max(HANDLING.topSpeed, player.speed - 18 * dt);

  const steeringSpeed =
    (drifting ? HANDLING.driftSteeringSpeed : HANDLING.steeringSpeed) *
    clamp(player.speed / 14, 0, 1);
  const desiredLateralSpeed = steer * steeringSpeed;
  const steeringResponse = spinningAtStepStart
    ? HANDLING.steeringReturnResponse
    : drifting
      ? HANDLING.driftResponse
      : steer === 0
        ? HANDLING.steeringReturnResponse
        : HANDLING.steeringResponse;
  player.lateralSpeed +=
    (desiredLateralSpeed - player.lateralSpeed) *
    Math.min(1, steeringResponse * dt);
  player.lane += player.lateralSpeed * dt;

  let wallScrape = false;
  if (Math.abs(player.lane) > LANE_LIMIT) {
    const wallSide = Math.sign(player.lane);
    player.lane = clamp(player.lane, -LANE_LIMIT, LANE_LIMIT);
    player.lateralSpeed = -wallSide * HANDLING.wallBounceSpeed;
    player.speed = Math.max(0, player.speed - (steer ? 10 : 3) * dt);
    wallScrape = true;
    registerImpact("wall", player.speed, wallSide);
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
      registerImpact(
        "rival",
        Math.abs(player.speed - rival.speed),
        Math.sign(player.lane - rival.lane),
      );
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
        const bus = vehicle.halfLength >= 4;
        registerImpact(
          "traffic",
          player.speed,
          Math.sign(player.lane - vehicle.lane),
          bus
            ? HANDLING.spinoutSpeedThreshold
            : HANDLING.spinoutSpeedThreshold + 6,
        );
      }
    }
  }
  if (Number.isFinite(contactSpeedTarget)) {
    // Keep speed and movement in sync without a one-frame impact impulse.
    const deceleration = blockedByTraffic ? HANDLING.brakeDeceleration : 24;
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

  return {
    collision: wallScrape || Number.isFinite(contactSpeedTarget),
    impact,
    impactSpeed,
    impactType,
    impactSide,
    spinoutStarted,
    boosting: boosting && !spinoutStarted,
    drifting: drifting && !spinoutStarted,
  };
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
