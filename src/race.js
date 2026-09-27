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
      collisionCooldown: 0,
      finishTime: null,
    },
    rivals: Array.from({ length: 5 }, (_, i) => ({
      distance: 6 + i * 6,
      lane: [0, -3.2, 3.2, -3.2, 3.2][i],
      speed: 0,
      pace: 25.5 + i * 0.65,
      finishTime: null,
    })),
  };
}

export function tick(race, input, elapsed) {
  if (race.finished || !Number.isFinite(elapsed) || elapsed <= 0) return;

  // Clamp long frames (tab switches / slow phones) to avoid a physics jump.
  const dt = clamp(elapsed, 0, 0.05);
  race.time += dt;
  const player = race.player;
  const steer = Number(Boolean(input.right)) - Number(Boolean(input.left));
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
  player.collisionCooldown = Math.max(0, player.collisionCooldown - dt);
  player.distance += player.speed * dt;

  for (let i = 0; i < race.rivals.length; i++) {
    const rival = race.rivals[i];
    rival.speed = Math.min(rival.pace, rival.speed + 12 * dt);
    rival.distance += rival.speed * dt;
    rival.lane = [0, -3.2, 3.2, -3.2, 3.2][i] + Math.sin(race.time * 0.35 + i * 2) * 0.35;

    const distanceGap = rival.distance - player.distance;
    const laneGap = Math.abs(rival.lane - player.lane);
    if (
      player.collisionCooldown === 0 &&
      Math.abs(distanceGap) < 3.6 &&
      laneGap < 1.55
    ) {
      player.speed = Math.max(0, Math.min(player.speed, rival.speed) - 2.5);
      if (distanceGap >= 0) player.distance = rival.distance - 3.6;
      else player.distance = Math.max(player.distance, rival.distance + 3.6);
      player.collisionCooldown = 0.55;
    }
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
